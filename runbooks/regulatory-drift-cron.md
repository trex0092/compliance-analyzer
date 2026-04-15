# regulatory-drift-cron

**Owner:** Compliance Officer
**Endpoint:** `/.netlify/functions/regulatory-drift-cron`
**Schedule:** daily
**Regulatory anchor:** FDL Art.22; Cabinet Res 134/2025 Art.19

## Purpose
Captures a daily snapshot of `src/domain/constants.ts` and diffs it
against the stored baseline. Any drift (value change,
REGULATORY_CONSTANTS_VERSION change) is logged. Critical severity
changes fire an alert via the `alertDispatcher`.

## Expected healthy state
- Daily run completes in under 30 seconds
- Drift is zero on typical days
- After an authorised regulatory update PR, drift is ONE finding at
  low/medium severity for the updated constant — this is expected
- After an UNAUTHORISED change, drift fires at critical severity

## Common failure modes

| Symptom | First check |
|---|---|
| Drift detected but no PR merged | Check `git log -- src/domain/constants.ts` — might be a tamper |
| Drift severity always critical | Threshold is too strict — review `severityForDelta` |
| Cron never runs | Schedule not registered — check `netlify.toml` |
| Baseline never captured | Boot path didn't call `captureRegulatoryBaseline` |

## Recovery steps
1. Open the latest `regulatory-drift-audit/<date>.json`
2. Identify the drifted key + value change
3. Confirm via `git log` that a legitimate regulatory PR caused the change
4. If it was NOT an authorised change, **immediately escalate to CO** and investigate for tampering
5. After an authorised change, re-baseline: `POST /api/brain/regulatory-drift` with `action: rebaseline`
