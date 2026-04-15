# ai-governance-self-audit-cron

**Owner:** Compliance Officer
**Endpoint:** `/.netlify/functions/ai-governance-self-audit-cron`
**Schedule:** daily at 02:00 UTC
**Regulatory anchor:** NIST AI RMF 1.0; EU AI Act Art.14-15; ISO/IEC 42001

## Purpose
Runs the AI Governance self-audit against the compliance analyzer
itself. Scores the brain against four frameworks (EU AI Act, NIST AI
RMF, ISO/IEC 42001, UAE AI audit). If the composite score drops
below 80 the cron auto-creates a critical Asana task on the CO queue.

## Expected healthy state
- Daily run at 02:00 UTC, completes in under 5 minutes
- Composite score stays in the 85-95 range
- Zero critical findings under normal ops
- Report stored at `ai-governance-audit/<date>.json`

## Common failure modes

| Symptom | First check |
|---|---|
| Score drops below 80 | Investigate the failing framework item — see report detail |
| Report shows critical findings | Review the specific control that failed |
| Cron skipped | Timer not registered — check `netlify.toml` schedule |
| New framework version | Update the framework binding in `aiGovernanceAgent.ts` |

## Recovery steps
1. Open the latest `ai-governance-audit/<date>.json` report
2. Identify which framework dimension failed
3. For EU AI Act Art.14/15 regressions, check recent changes to four-eyes or fuzzer
4. For NIST AI RMF GOVERN-4 regressions, check the feedback loop + clamp suggestion pipeline
5. File an Asana task on the CO queue with the specific remediation steps
6. Do NOT disable the cron — if it's noisy, tune the thresholds in `aiGovernanceAgent.ts`
