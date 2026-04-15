# sanctions-delta-screen-cron

**Owner:** MLRO on-call
**Endpoint:** `/.netlify/functions/sanctions-delta-screen-cron`
**Schedule:** every 4 hours (`0 */4 * * *`)
**Regulatory anchor:** Cabinet Res 74/2020 Art.4-7; FDL Art.35; FATF Rec 6

## Purpose
Re-screens the per-tenant cohort against the most recent sanctions
delta (added + modified entries) produced by `sanctions-ingest-cron`.
Hits are categorised by confidence (confirmed / likely / potential)
and dispatched to Asana via the orchestrator. Confirmed hits route
straight to the `EOCN Freeze Required` section with a 24-hour SLA.

## Expected healthy state
- Runs every 4 hours, exits within 2 minutes per tenant.
- Most runs produce zero hits — lists change slowly.
- Audit blob at `sanctions-delta-screen-audit/<day>/<runId>.json`
  shows `ok: true` and `totalHits` matches dispatched task count.

## Common failure modes

| Symptom | First check |
|---|---|
| `HAWKEYE_DELTA_SCREEN_TENANTS not configured` | Env var missing |
| `no latest delta in sanctions-deltas blob store` | `sanctions-ingest-cron` is stale — fix it first |
| Cohort empty per tenant | Operator hasn't uploaded customers yet — see `tenant_cohort` empty state |
| Many potential hits, zero confirmed | Matching thresholds may be too permissive — review confidence bands |
| Asana dispatch failures | See `asana-retry-queue-cron.md` |

## Recovery steps
1. Verify `HAWKEYE_DELTA_SCREEN_TENANTS` is set with the right tenants
2. Check that `sanctions-ingest-cron` ran successfully in the last 4 hours
3. Verify the cohort blob at `sanctions-cohort/<tenantId>/cohort.json` exists
4. Run the screener manually via the cron URL with a bearer token
5. For confirmed hits, verify the resulting Asana tasks landed in `EOCN Freeze Required`
6. **Regulatory watchdog:** if confirmed hits appeared but no task was created within 24h, file an incident **immediately** — this is a Cabinet Res 74/2020 Art.4 exposure event
