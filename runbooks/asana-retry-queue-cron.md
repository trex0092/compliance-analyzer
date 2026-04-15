# asana-retry-queue-cron

**Owner:** SRE on-call
**Endpoint:** `/.netlify/functions/asana-retry-queue-cron`
**Schedule:** every 15 minutes
**Regulatory anchor:** Cabinet Res 134/2025 Art.19; FDL Art.24

## Purpose
Drains the Asana dead-letter queue (`asana:dead-letter:*`). For each
entry, re-attempts dispatch through the orchestrator with the
original idempotency key so retries don't create duplicates.

## Expected healthy state
- Runs every 15 minutes
- Most runs drain 0 entries — healthy Asana + healthy brain = empty dead letter
- Counter `asana.dead-letter.drained` ticks when entries are successfully drained
- Counter `asana.dead-letter.retry-failed` ticks on persistent failures

## Common failure modes

| Symptom | First check |
|---|---|
| Dead-letter depth > 10 | Alert fires — see `alertDispatcher.ts` rule `deadLetter.depth` |
| Dead-letter depth > 50 | Critical alert — Asana API outage or permission problem |
| Depth growing monotonically | Drain cron is failing — check cron log |
| Depth growing then flattening | Asana outage — wait for upstream recovery |
| Permanently stuck entries | Workspace GID mismatch or permission revoke — purge manually |

## Recovery steps
1. Check `asana.dead-letter.depth` in the health dashboard
2. Read one dead-letter entry:
   ```bash
   netlify blobs:get brain-memory "asana:dead-letter:tenant-a:brain-verdict:<ts>"
   ```
3. Inspect `lastError` — if it's 401/403, rotate the Asana PAT
4. If it's a permanent error (404 on workspace), purge the entry with a logged reason
5. Force a manual drain: `POST /api/asana-retry-queue-cron` with bearer token
6. **Never** silently delete dead-letter entries — always log the purge to the audit trail
