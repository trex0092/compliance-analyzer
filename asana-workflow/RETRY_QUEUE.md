# ASANA WORKFLOW — Retry Queue + Dead Letter

`src/services/asanaQueue.ts` is the only file that actually calls
`fetch()` against `app.asana.com`. Every Asana write flows through
the queue. The queue gives us:

- Exponential backoff on transient failures
- Bounded retry budget (we never retry forever)
- A dead-letter store for failures that exhaust the budget
- Per-tenant rate limit protection
- Telemetry on every attempt

---

## Configuration

```typescript
const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000];   // 4 retries
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;     // 5 total

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404, 422]);
```

- **Retryable:** rate limit (429), transient server errors (5xx)
- **Non-retryable:** caller error (4xx) — retrying makes it worse,
  the cause is upstream

---

## Lifecycle

```
enqueue
   │
   ▼
attempt 1 ─── success ──► return {ok:true, gid}
   │
   ├── retryable failure → wait 2s
   ▼
attempt 2 ─── success ──► return {ok:true, gid}
   │
   ├── retryable failure → wait 4s
   ▼
attempt 3 ─── success ──► return {ok:true, gid}
   │
   ├── retryable failure → wait 8s
   ▼
attempt 4 ─── success ──► return {ok:true, gid}
   │
   ├── retryable failure → wait 16s
   ▼
attempt 5 ─── success ──► return {ok:true, gid}
   │
   └── still failing → dead letter
        │
        ▼
   asana:dead-letter:<tenantId>:<dispatchKind>:<timestamp>
```

Non-retryable failures (4xx) skip the wait/retry sequence and go
straight to the dead letter with the original status code preserved.

---

## Dead letter

| Property | Value |
|---|---|
| Backend | Netlify Blobs (`brain-memory` store) |
| Prefix | `asana:dead-letter:` |
| Key format | `asana:dead-letter:<tenantId>:<dispatchKind>:<epochMs>` |
| Retention | Until drained (no auto-expiry) |

### Record shape

```json
{
  "tenantId": "tenant-a",
  "caseId": "case-1",
  "dispatchKind": "brain-verdict",
  "task": { "name": "...", "notes": "...", "custom_fields": {} },
  "lastError": {
    "status": 503,
    "body": "...",
    "attempts": 5
  },
  "firstAttemptAt": 1744732800000,
  "lastAttemptAt": 1744732830000,
  "idempotencyKey": "<sha3 hex>"
}
```

---

## Drain cron

`netlify/functions/asana-retry-queue-cron.mts` runs every 15 minutes:

```
*/15 * * * *
```

Each run:

1. Lists all dead-letter blobs (capped at 100 per run to bound
   execution time)
2. For each blob, attempts the dispatch fresh through the
   orchestrator (this re-enters the queue with a new attempt
   counter)
3. On success: deletes the dead-letter blob, increments
   `asana.dead-letter.drained` counter
4. On failure: leaves the blob in place, increments
   `asana.dead-letter.retry-failed` counter

The drain pass uses the **original** idempotency key, so if Asana
has since accepted an identical request, the orchestrator's idem
cache short-circuits and the dead letter is cleared without a
duplicate task.

---

## Observability

Telemetry exported by the queue (per call):

| Counter | Description |
|---|---|
| `asana.queue.attempt.{1..5}` | Attempt count distribution |
| `asana.queue.success` | Successful dispatches |
| `asana.queue.dead-letter` | Dispatches that exhausted retries |
| `asana.queue.non-retryable` | 4xx failures (no retry) |
| `asana.queue.duration_ms` | Wall-clock duration histogram |
| `asana.dead-letter.depth` | Current dead-letter blob count |
| `asana.dead-letter.drained` | Successful drains |
| `asana.dead-letter.retry-failed` | Failed drain attempts |

These surface in the Brain Console UI under "Asana ops".

---

## Manual drain

If the cron is paused or the dead letter has grown, drain manually:

```bash
curl -X POST $BASE/api/asana-retry-queue-cron \
  -H "Authorization: Bearer $HAWKEYE_BRAIN_TOKEN"
```

To inspect a single dead-letter entry:

```bash
netlify blobs:get brain-memory \
  "asana:dead-letter:tenant-a:brain-verdict:1744732800000"
```

To purge a permanently bad entry (e.g., wrong workspace GID — never
going to succeed):

```bash
netlify blobs:delete brain-memory \
  "asana:dead-letter:tenant-a:brain-verdict:1744732800000"
```

Always log the purge to the audit trail. Dropped tasks are the
operator's responsibility.

---

## Backoff jitter

The retry delays above are deterministic. To avoid thundering-herd
on a recovering Asana instance, the queue adds ±20% jitter:

```typescript
const jittered = delay * (0.8 + Math.random() * 0.4);
```

So 2000ms becomes 1600-2400ms, etc. Jitter is applied per attempt,
not globally.

---

## Why bounded retries

Unbounded retries hide outages. With 4 retries and 30 seconds total
budget, an Asana outage exceeding 30 seconds turns into dead-letter
entries that are visible to operators via the Brain Console UI.
Operators see the queue depth grow → they know to investigate.

If we retried forever in-memory, the queue would absorb the outage
silently and operators would only discover it when their tasks
stopped showing up.

The dead letter is the alarm bell, not a failure mode.

---

## Testing

Tests live in `tests/asana/queue.test.ts`:

- Success on attempt 1
- Success on attempt 3 after two 503s
- Dead letter after 5 failed attempts
- 4xx skips retry sequence
- Backoff timing matches `RETRY_DELAYS_MS`
- Jitter stays within ±20% bound
- Drain cron clears resolved entries
- Drain cron leaves still-failing entries in place
