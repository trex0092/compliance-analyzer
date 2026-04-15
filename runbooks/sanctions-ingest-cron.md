# sanctions-ingest-cron

**Owner:** MLRO on-call
**Endpoint:** `/.netlify/functions/sanctions-ingest-cron`
**Schedule:** every 4 hours
**Regulatory anchor:** Cabinet Res 74/2020 Art.4; FDL Art.22; FATF Rec 6/7

## Purpose
Fetches UN, OFAC SDN/Consolidated, EU, UK OFSI sanctions lists in
parallel, normalises to `SanctionsEntry[]`, diffs against the prior
snapshot, and writes:

- `sanctions-snapshots/<source>/<day>.json` — full current snapshot
- `sanctions-deltas/<source>/<day>.json` — per-source delta
- `sanctions-deltas/latest.json` — merged latest delta consumed by `sanctions-delta-screen-cron`
- `sanctions-ingest-audit/<day>/<runId>.json` — per-run audit

## Expected healthy state
- Runs every 4 hours with ~95% success rate per source
- Individual source failures do NOT block others
- EOCN list is NOT auto-fetched — it is loaded manually from circular PDFs

## Common failure modes

| Symptom | First check |
|---|---|
| Single source 403 / 503 | Upstream outage — other sources still ingested |
| UN XML parse failure | UN feed schema change — see `parseUnConsolidatedXml` |
| OFAC CSV format drift | OFAC added / removed columns — see `parseOfacSdnCsv` |
| Every source failing | Netlify network egress broken — check Netlify status |
| `latest.json` not updated | Merge step failed — audit log will show which source |

## Recovery steps
1. Check Netlify function log for the last run
2. Identify which source failed — the audit blob has per-source detail
3. Try the upstream URL manually with `curl`
4. If a parser crashed, roll back to the last known good commit of `sanctionsIngest.ts`
5. For EOCN updates, upload the new list via the manual upload endpoint
