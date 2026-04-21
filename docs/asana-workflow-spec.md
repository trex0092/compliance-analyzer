# Asana Workflow Spec — 19-Project Catalog

**Locked:** 2026-04-21 by the MLRO.
**Workspace:** `1213645083721316` (HAWKEYE STERLING V2 team).
**Regulatory basis:** FDL No.(10)/2025 Art.20-21 (CO duty of care), Art.24 (10-year record retention), Cabinet Res 134/2025 Art.19 (internal review), Fed Decree-Law 32/2021 (whistleblower confidentiality).

---

## The 19 projects

| # | Project | Env var | GID |
|---|---|---|---|
| 1 | Screening — Sanctions & Adverse Media | `ASANA_SCREENINGS_PROJECT_GID` | `1214148660020527` |
| 2 | Central MLRO — Daily Digest | `ASANA_CENTRAL_MLRO_PROJECT_GID` | `1214148631086118` |
| 3 | Audit Log — 10-Year Trail | `ASANA_AUDIT_LOG_PROJECT_GID` | `1214148643197211` |
| 4 | Four-Eyes Approvals | `ASANA_FOUR_EYES_PROJECT_GID` | `1214148660376942` |
| 5 | STR/SAR/CTR/PMR — goAML Filings | `ASANA_STR_PROJECT_GID` | `1214148631336502` |
| 6 | FFR — Incidents & Asset Freezes | `ASANA_INCIDENTS_PROJECT_GID` | `1214148643568798` |
| 7 | CDD/SDD/EDD/KYC — Customer Due Diligence | `ASANA_CDD_PROJECT_GID` + `ASANA_KYC_CDD_TRACKER_PROJECT_GID` | `1214148898062562` |
| 8 | Transaction Monitoring | `ASANA_TM_PROJECT_GID` | `1214148661083263` |
| 9 | Compliance Ops — Daily & Weekly Tasks | `ASANA_COMPLIANCE_TASKS_PROJECT_GID` | `1214148898610839` |
| 10 | Shipments — Tracking | `ASANA_SHIPMENTS_PROJECT_GID` | `1214148898360626` |
| 11 | Employees | `ASANA_EMPLOYEES_PROJECT_GID` | `1214148854421310` |
| 12 | Training | `ASANA_TRAINING_PROJECT_GID` | `1214148854927671` |
| 13 | Compliance Governance | `ASANA_GOVERNANCE_PROJECT_GID` (+ deprecated alias `ASANA_AI_GOVERNANCE_PROJECT_GID`) | `1214148855187093` |
| 14 | Routines — Scheduled | `ASANA_ROUTINES_PROJECT_GID` | `1214148910147230` |
| 15 | MLRO Workbench | `ASANA_WORKBENCH_PROJECT_GID` | `1214148910059926` |
| 16 | Supply Chain, ESG & LBMA Gold | `ASANA_ESG_LBMA_PROJECT_GID` | `1214148855758874` |
| 17 | Export Control & Dual-Use | `ASANA_EXPORT_CONTROL_PROJECT_GID` | `1214148895117190` |
| 18 | Regulator Portal Handoff | `ASANA_INSPECTOR_PROJECT_GID` | `1214148894992036` |
| 19 | Incidents & Grievances | `ASANA_GRIEVANCES_PROJECT_GID` | `1214148895117145` |

---

## Event → project routing

Every compliance-generating event in the tool maps to exactly one primary project below. High-severity events **additionally** mirror to #2 (Central MLRO) and #3 (Audit Log).

| Event (examples) | Primary project |
|---|---|
| Sanctions list hit, PEP flag, adverse-media match | #1 Screening |
| Daily morning briefing, cross-module digest, MLRO war-room summary | #2 Central MLRO |
| Every decision hash, every dispatch, retention mirror | #3 Audit Log |
| Any decision flagged `four_eyes_required=true` | #4 Four-Eyes Approvals |
| STR / SAR / CTR / DPMSR / PMR / CNMR filing created or submitted | #5 goAML Filings |
| Confirmed sanctions match, 24h freeze order, EOCN report | #6 FFR |
| New customer onboarding, periodic CDD review, tier change (SDD→CDD→EDD), KYC expiry alert, UBO re-verification | #7 CDD/SDD/EDD/KYC |
| TM alert, AED 55K / 60K threshold breach, Benford anomaly, peer outlier | #8 Transaction Monitoring |
| MLRO daily / weekly checklist item (human-driven) | #9 Compliance Ops |
| Shipment created, status change, chain-of-custody update | #10 Shipments |
| Staff record change, access / role change, certification expiry | #11 Employees |
| Course assignment, completion, attestation | #12 Training |
| Policy change, RACI update, committee minutes, AI governance self-audit | #13 Compliance Governance |
| Scheduled cron run (33 cron functions) — dry-run and apply-mode records | #14 Routines |
| Cross-module MLRO action (manual intervention, override, release) | #15 MLRO Workbench |
| ESG / LBMA RGG v9 / CAHRA / responsible-sourcing event | #16 Supply Chain ESG |
| Dual-use / strategic-goods / PF screening event | #17 Export Control |
| Evidence packet prepared for MoE / LBMA / EOCN inspection | #18 Regulator Portal |
| Operational incident (non-sanctions), whistleblower report, customer complaint | #19 Incidents & Grievances |

### Severity escalation rules

- `severity ≥ high` → also mirror to **#2 Central MLRO**.
- Any event persisted by `asanaAuditLogMirror` → also mirror to **#3 Audit Log**.
- `four_eyes_required=true` → also mirror to **#4 Four-Eyes Approvals**.
- `sanctions_confirmed=true` → also mirror to **#6 FFR** (primary) and **#4 Four-Eyes** (block).

### Tipping-off guard (FDL Art.29)

No event routed to #1 (Screening), #5 (goAML), or #6 (FFR) may contain the subject's live notification channels (email, phone, WhatsApp). Enforced by the dispatcher schema before POST.

---

## Dropped from scope (on purpose)

| Env var | Where the events go now |
|---|---|
| `ASANA_ONBOARDING_PROJECT_GID` | Routed into **#7 CDD/SDD/EDD/KYC** (onboarding is the first CDD step). |
| `ASANA_COUNTERPARTIES_PROJECT_GID` | Routed into the pre-existing **Customer Database** project (outside the 19 catalog). |
| `ASANA_AUDIT_INSPECTION_PROJECT_GID` | Folded into **#18 Regulator Portal Handoff** and **#3 Audit Log**. |
| `ASANA_DEFAULT_PROJECT_GID` | No catch-all project. Unrouted events are logged only to Netlify Blobs `auditChain`; the dispatcher emits a warning so they surface in the daily digest for triage. |

## Deprecations

- `ASANA_EMPLOYEES_TRAINING_PROJECT_GID` — kept empty as a fallback. Dispatcher prefers the split `ASANA_EMPLOYEES_PROJECT_GID` + `ASANA_TRAINING_PROJECT_GID`.
- `ASANA_AI_GOVERNANCE_PROJECT_GID` — points at the same GID as `ASANA_GOVERNANCE_PROJECT_GID`. Removed in a follow-up once all callers migrate.

---

## Verification

Confirm all 19 slots resolve to real Asana projects:

```bash
ASANA_TOKEN=<your PAT> \
set -a && . ./.env && set +a && \
npx tsx scripts/asana-smoke-test.ts
```

Expected output: 20 ✅ rows (19 distinct GIDs + the duplicate KYC-tracker alias), 0 ❌.
