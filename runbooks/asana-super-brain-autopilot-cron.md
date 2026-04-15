# asana-super-brain-autopilot-cron

**Owner:** MLRO on-call
**Endpoint:** `/.netlify/functions/asana-super-brain-autopilot-cron`
**Schedule:** every 15 minutes
**Regulatory anchor:** FDL Art.19-21; Cabinet Res 134/2025 Art.19

## Purpose
Walks open compliance cases in the `compliance-cases` blob store,
dispatches any that haven't been recorded in the audit log to the
super brain, and records the batch result. Server-side twin of the
in-SPA auto-dispatch listener.

## Expected healthy state
- Runs every 15 minutes
- Dispatches fresh cases within 15 minutes of landing in the blob store
- Audit log shows `dispatched: N` matching the number of new cases

## Common failure modes

| Symptom | First check |
|---|---|
| `ASANA_API_TOKEN not configured` | Env var missing — autopilot cannot dispatch |
| `case store unavailable` | Netlify Blob store offline or missing `compliance-cases` store |
| Cases staying open forever | Autopilot NOT hitting them — check audit log for errors |
| Duplicate dispatches | Idempotency key collision — rare; investigate |
| `dispatcher crash` | Downstream dispatcher throwing — check brainSuperRunner log |

## Recovery steps
1. Verify `ASANA_API_TOKEN` is set
2. Check the `compliance-cases/open-cases.json` blob for the current open set
3. Confirm the audit blob records each dispatched case id
4. If a case is stuck open, check the brain verdict emitted for it
5. For repeat failures on the same case, move it to a quarantine blob for manual review
