# asana-sync-cron

**Owner:** SRE on-call
**Endpoint:** `/.netlify/functions/asana-sync-cron`
**Schedule:** hourly
**Regulatory anchor:** Cabinet Res 134/2025 Art.19; FDL Art.20-22

## Purpose
Reconciles brain state (in the `brain-memory` blob store) with Asana
task state. Any task whose verdict has changed since last sync is
updated; any verdict without a task is dispatched via the
orchestrator. Drains old idempotency records (>30d).

## Expected healthy state
- Runs once per hour, exits within 2 minutes per tenant
- Produces at most a handful of updates per run (brain is the source of truth; Asana changes rarely reverse a verdict)
- Cleanup counter `asana.idem.cleanup.count` ticks each run

## Common failure modes

| Symptom | First check |
|---|---|
| `401` from Asana | `ASANA_ACCESS_TOKEN` expired — regenerate |
| `429` from Asana | Hit rate limit — check `asanaQueue.ts` backoff |
| Task exists in Asana but not in brain state | Manual Asana creation — should be deleted or re-imported |
| Brain verdict exists but no Asana task | Dispatch path broken — see `asana-retry-queue-cron.md` |
| Idempotency cleanup stuck at 0 | Cleanup loop crashing — check blob count growth |

## Recovery steps
1. Check `asana-sync-audit` blob for the last run
2. Verify `ASANA_ACCESS_TOKEN` and `ASANA_WORKSPACE_GID` env vars
3. Test a direct Asana API call: `GET /api/1.0/workspaces/$GID`
4. If dispatch broken, inspect dead-letter queue depth (see `asana-retry-queue-cron.md`)
5. For stuck idempotency cleanup, manually list `asana:idem:*` and check TTL values
