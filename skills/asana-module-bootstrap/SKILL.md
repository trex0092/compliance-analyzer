# /asana-module-bootstrap — One-click provisioning of the 16-project Asana module catalog

Run the one-shot setup endpoint that creates every board in the
approved 16-project catalog on your Asana workspace. Idempotent —
safe to re-run after a partial failure; every project + section is
matched by name and reused if already present.

## Usage

```
/asana-module-bootstrap                        # real run, all 16
/asana-module-bootstrap --dry-run              # list what WOULD be created
/asana-module-bootstrap --keys=transaction_monitoring,str_cases
```

## Prerequisites

1. `ASANA_TOKEN` (or `ASANA_ACCESS_TOKEN` / `ASANA_API_TOKEN`) set on
   Netlify env. Personal access token with workspace-admin scope.
2. `ASANA_WORKSPACE_GID` set on Netlify env. Found at Asana admin
   settings → Organisation → General.
3. `HAWKEYE_BRAIN_TOKEN` set and your MLRO session active.

## Flow

### Step 1 · Dry-run first
```
curl -X POST https://<app>.netlify.app/api/setup/asana-modules \
  -H "Authorization: Bearer $HAWKEYE_BRAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'
```
Returns the 16 projects + 168 sections that would be created. Zero
writes to Asana.

### Step 2 · Real bootstrap
```
curl -X POST https://<app>.netlify.app/api/setup/asana-modules \
  -H "Authorization: Bearer $HAWKEYE_BRAIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```
Creates every project + section. Rate-limited 2 requests / 15 min per
IP so repeated clicks cannot flood the Asana API.

### Step 3 · Copy the env snippet
The response returns:
```json
{
  "ok": true,
  "workspaceGid": "…",
  "projects": [...],
  "envSnippet": "ASANA_TM_PROJECT_GID=…\nASANA_STR_PROJECT_GID=…\n…"
}
```
Paste `envSnippet` into Netlify env vars. Redeploy. Every downstream
function immediately routes to the correct per-module board via
`getModuleProjectGid()`.

### Step 4 · Verify
```
curl https://<app>.netlify.app/api/asana/config \
  -H "Authorization: Bearer $HAWKEYE_BRAIN_TOKEN"
```
Every one of the 16 keys should now carry a non-null GID. Any null
value = env var missing on Netlify.

## What gets created

See `src/services/asanaModuleProjects.ts` for the authoritative list.
Summary:

| # | Key | Board name |
|---|---|---|
| 1 | screening_and_watchlist | Subject Screening & Watchlist |
| 2 | transaction_monitoring | Transaction Monitoring |
| 3 | str_cases | STR / SAR / CTR / DPMSR / CNMR Cases |
| 4 | cdd_ubo_pep | Customer Due Diligence — UBO & PEP |
| 5 | esg_supply_lbma | ESG, Supply Chain & LBMA RGG |
| 6 | dual_use_export_control | Dual-Use & Export Control |
| 7 | governance_and_retention | Governance, Regulatory Updates & Records Retention |
| 8 | audit_inspection | Audit & Inspection Readiness |
| 9 | mlro_digest | MLRO Central Digest |
| 10 | employees_and_training | Employees, Access & Training |
| 11 | onboarding_workbench | Onboarding Workbench |
| 12 | compliance_tasks | Compliance Tasks — Master Queue |
| 13 | four_eyes_queue | Four-Eyes Approvals Queue |
| 14 | shipments_logistics | Shipments & Trade Logistics |
| 15 | counterparties_accounts | Counterparties & Approved Accounts |
| 16 | incidents_whistleblower | Incidents & Whistleblower |

## Audit trail

Every bootstrap run is logged to the `setup-audit` Netlify Blob store
under `asana-modules/<iso-timestamp>` with:
- workspaceGid
- dryRun flag
- per-project + per-section outcomes (created / reused / error)
- MLRO principal that ran the bootstrap
- timestamp

10-year retention per FDL No.10/2025 Art.24.

## Regulatory basis

- FDL No.10/2025 Art.20-22 — CO visibility: one dedicated board per
  compliance domain so nothing hides under a generic queue.
- FDL No.10/2025 Art.24 — 10-yr audit trail: every board is the
  authoritative record for its domain; bootstrap is logged.
- Cabinet Res 134/2025 Art.18 — arrangement notification: provisioning
  new boards is a governance change recorded in setup-audit.
- Cabinet Res 134/2025 Art.19 — internal review cadence: per-domain
  boards drive the weekly compliance digest.

## Related skills

- `/screen`, `/goaml`, `/incident`, `/onboard` — every compliance skill
  writes to the Asana board this bootstrap provisions.
- `/audit-pack`, `/evidence-bundle` — aggregate across every board.
- `/moe-readiness` — verifies the 16 boards are present + populated
  before an MoE inspection.
