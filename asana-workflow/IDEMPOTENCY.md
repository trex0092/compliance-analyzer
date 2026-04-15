# ASANA WORKFLOW — Idempotency

The orchestrator is idempotent by construction. Every dispatch
computes a key from the request shape; replaying the same key within
30 days returns the cached response without writing to Asana.

This is the load-bearing guarantee that makes webhook double-delivery,
cron retries, and network jitter safe.

---

## Key shape

```
sha3_512(
  tenantId        + '|' +
  caseId          + '|' +
  dispatchKind    + '|' +
  Math.floor(Date.now() / 3_600_000) + '|' +    // hour bucket
  sha3_512(JSON.stringify(payload))
)
```

| Field | Why it's in the key |
|---|---|
| `tenantId` | Tasks are scoped per tenant. No cross-tenant collisions. |
| `caseId` | Same case, different verdicts → different tasks. |
| `dispatchKind` | A four-eyes pair and a brain-verdict task for the same case are different keys. |
| `hour bucket` | Same call within the same hour deduplicates; an hour later is a fresh event. |
| `payload hash` | If the verdict changes, the key changes. |

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

## Hour-bucket rationale

The hour bucket is the most important part of the key shape. Without
it, the same payload would deduplicate forever — including a stale
verdict from yesterday that should have triggered a fresh task today.

With it:

- Same payload, same hour → 1 task (deduplication works)
- Same payload, next hour → 2 tasks (operator sees the new event)
- Different payload, same hour → 2 tasks (different key)

Choose 1 hour because:

- Fast enough to recover from a brief outage with a fresh task
- Slow enough to deduplicate Asana webhook double-delivery (they
  retry within minutes)
- Aligned with the `asana-sync-cron` schedule (also hourly)

Do not change this without a regression test on the cron sync path.

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

Tests live in `tests/asana/idempotency.test.ts` and cover:

- HIT within TTL returns cached response with `replayed=true`
- HIT past TTL is treated as MISS
- MISS executes dispatch and writes blob
- Failed dispatch does NOT write blob
- Hour boundary creates a fresh key
- `idempotencyOverride` bypasses cache lookup but still writes
- Two concurrent calls with same key — only one writes (last writer
  wins on the blob)

Run them in isolation:

```bash
npx vitest run tests/asana/idempotency.test.ts
```
