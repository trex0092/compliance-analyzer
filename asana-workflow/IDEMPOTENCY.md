# ASANA WORKFLOW — Idempotency

The orchestrator is idempotent by construction. Every dispatch
computes a key from the verdict identity; replaying the same key
within 30 days returns the cached response without writing to Asana.

This is the load-bearing guarantee that makes webhook double-delivery,
cron retries, and network jitter safe.

---

## Key shape

```typescript
`${tenantId}:${verdictId}`
```

Source of truth: `makeIdempotencyKey()` in
`src/services/asana/orchestrator.ts`.

| Field | Why it's in the key |
|---|---|
| `tenantId` | Tasks are scoped per tenant. No cross-tenant collisions. |
| `verdictId` | Unique per brain decision. A fresh decision produces a fresh id, and a fresh id produces a fresh key. |

The key is intentionally simple. It relies on `verdictId` being
unique-per-decision at the brain layer. The brain produces a fresh
id every time it runs `runComplianceDecision()`, so the same case
screened at 08:00 and 14:00 produces two different verdicts with two
different ids and therefore two different Asana tasks.

This design choice replaces the earlier proposed
sha3_512(tenantId|caseId|dispatchKind|hour-bucket|payloadHash)
shape. The earlier shape is not implemented in the orchestrator and
is not required — the verdictId already embeds the time and the
dispatch context, so deriving a composite hash added no safety and
one more failure mode (hash-collision tests on every dispatch).
If the key shape ever needs to grow, update this file and
`makeIdempotencyKey()` in the same commit.

---

## Store

| Property | Value |
|---|---|
| Backend | Netlify Blobs (`brain-memory` store) |
| Prefix | `asana:idem:` |
| Format | JSON serialized `OrchestratorResponse` + `createdAt` epoch ms |
| TTL | 30 days (enforced by `asana-sync-cron` cleanup pass) |

---

## Replay rules

1. **HIT within TTL** → return cached response with `replayed=true`.
   No Asana API call. No audit log re-write. No webhook re-fire.

2. **HIT past TTL** → treat as MISS. Cleanup happens on next cron
   pass.

3. **MISS** → execute dispatch, write blob on success. Failed
   dispatches do NOT write the blob — they are retried by the queue.

4. **Force fresh dispatch** → caller passes
   `idempotencyOverride: 'force-' + crypto.randomUUID()`. This
   bypasses the cache lookup but still writes the blob (so a
   subsequent natural retry of the same payload deduplicates).

---

## What gets cached

The full `OrchestratorResponse`:

```json
{
  "ok": true,
  "asanaTaskGid": "1234567890",
  "asanaSubtaskGid": "1234567891",
  "idempotencyKey": "<sha3 hex>",
  "replayed": false,
  "durationMs": 412,
  "createdAt": 1744732800000
}
```

The `replayed` field is `false` in the cached copy and toggled to
`true` only on the way back to the caller. This means the blob
itself records the original-creation time, which is useful for
auditing.

---

## What does NOT get cached

- Failed dispatches. A failed dispatch is retried — caching the
  failure would prevent recovery.
- Dead-letter entries. They live in `asana:dead-letter:*` and are
  drained separately.
- Comment skill router results. Comments are processed once; if the
  router fires twice, the second fire is detected by Asana's own
  story IDs.

---

## Why `verdictId` alone is enough

Replacement for the earlier hour-bucket design. The rationale for
relying on the brain's `verdictId`:

- Same verdict dispatched twice (cron retry, webhook double-delivery,
  jitter) → same id → replay, no duplicate task.
- Fresh decision on the same case an hour later → new
  `runComplianceDecision()` call → new `id` → new Asana task.
- Different tenants can never collide because the tenant prefix is
  part of the key.
- Cross-case collisions are impossible because `id` is unique across
  all verdicts, not just within a case.

The brain is the authority on "is this the same decision or a new
one?". The idempotency layer mirrors that authority rather than
trying to re-derive it from payload shape.

---

## Cleanup pass

`asana-sync-cron` (hourly) runs the cleanup:

```typescript
for await (const entry of blobs.list({ prefix: 'asana:idem:' })) {
  const record = await blobs.get(entry.key, { type: 'json' });
  if (Date.now() - record.createdAt > 30 * 24 * 3600 * 1000) {
    await blobs.delete(entry.key);
    cleanupCounter++;
  }
}
```

The cleanup counter is published to telemetry under
`asana.idem.cleanup.count`.

---

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Second dispatch creates a new task instead of replaying | Hour boundary crossed | Working as designed — the hour bucket is intentional |
| Replay returns a stale response | Payload identical, hour identical | Working as designed — that's deduplication |
| Cleanup never runs | `asana-sync-cron` not registered | Re-register cron in `netlify.toml` |
| Blob count grows unboundedly | Cleanup counter staying at 0 | Check cron logs — the cleanup pass is throwing |

---

## Testing

Coverage lives in `tests/asanaOrchestrator.test.ts` and exercises
the idempotency contract end-to-end through
`AsanaOrchestrator.dispatchBrainVerdict` and `dispatchWithTemplate`:

- Replay of the same verdict returns the cached `taskGid` without
  re-dispatching.
- A verdict with a new `id` always produces a fresh dispatch.
- `IdempotencyStore.clear()` resets the store for tests.
- Failed dispatches are not cached (retried by the queue).

Run in isolation:

```bash
npx vitest run tests/asanaOrchestrator.test.ts
```
