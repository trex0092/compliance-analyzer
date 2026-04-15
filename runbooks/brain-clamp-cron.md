# brain-clamp-cron

**Owner:** MLRO on-call
**Endpoint:** `/.netlify/functions/brain-clamp-cron`
**Schedule:** hourly (`0 * * * *`)
**Regulatory anchor:** NIST AI RMF GOVERN-4; FATF Rec 20

## Purpose
Walks the prior 7 days of brain telemetry for every tenant in
`HAWKEYE_CLAMP_CRON_TENANTS` and produces Tier C clamp-suggestion
records under `tierC:clamp-suggestion:*`. MLROs review and accept
each suggestion via the Brain Console TIER C OPS panel. The cron
**NEVER** auto-applies a suggestion — accepting merely marks it for
a human to open a PR to `src/domain/constants.ts`.

## Expected healthy state
- Runs once per hour, exits within 30 seconds per tenant.
- Writes 0-3 new suggestions per run per tenant during normal ops.
- Audit blob at `tierC:clamp-suggestion:cron-audit/<ISO>.json` shows
  `ok: true` and `tenantsProcessed` == number of configured tenants.

## Common failure modes

| Symptom | First check |
|---|---|
| Skipped with `HAWKEYE_CLAMP_CRON_TENANTS not configured` | Env var missing or empty — add tenant IDs |
| `telemetry_store_unavailable` | Netlify Blob store offline — see status page |
| `brain:telemetry:*` returns empty | Telemetry writes failing — check `brain-analyze` logs |
| Suggestions never generated | Verify clamp confidence floor not set too high |

## Recovery steps
1. Check cron log in Netlify → Functions → `brain-clamp-cron`
2. Verify `HAWKEYE_CLAMP_CRON_TENANTS` is set and includes the expected tenants
3. Test the downstream blob store with a manual `POST /api/brain/diagnostics`
4. If the telemetry read is failing, run the brain-analyze smoke test
5. File an incident if the cron has failed 3+ consecutive runs
