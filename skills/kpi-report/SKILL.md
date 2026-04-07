# /kpi-report — UAE DPMS Compliance KPI Report

Generate a comprehensive KPI report aligned with MoE, EOCN, FIU, FATF, and LBMA requirements for Dealers in Precious Metals & Stones.

## Usage
```
/kpi-report [period] [entity]
```
Examples:
- `/kpi-report Q1-2026 "FINE GOLD LLC"`
- `/kpi-report 2025 all`
- `/kpi-report monthly "MADISON JEWELLERY"`

## Instructions

### Step 1: Collect Data
Gather measurements for all 30 KPIs defined in `src/domain/kpiFramework.ts`.
Pull data from localStorage keys and system state.

### Step 2: Generate Report

```
╔══════════════════════════════════════════════════════════════════════╗
║  UAE DPMS COMPLIANCE KPI REPORT                                     ║
║  Entity: [name]                                                     ║
║  Period: [Q1-2026]                                                  ║
║  Generated: [date] | Classification: CONFIDENTIAL                   ║
╚══════════════════════════════════════════════════════════════════════╝

══════════════════════════════════════════════════════════════════════
EXECUTIVE DASHBOARD
══════════════════════════════════════════════════════════════════════

  Overall Compliance Score: [N]% [🟢/🟡/🔴]

  ┌──────────────────────────────────┬───────┬────────┐
  │ Category                         │ Score │ Status │
  ├──────────────────────────────────┼───────┼────────┤
  │ Customer Due Diligence & KYC     │ [N]%  │ [RAG]  │
  │ Sanctions Screening & TFS        │ [N]%  │ [RAG]  │
  │ FIU Reporting & goAML            │ [N]%  │ [RAG]  │
  │ Risk Assessment & Monitoring     │ [N]%  │ [RAG]  │
  │ Training & Awareness             │ [N]%  │ [RAG]  │
  │ Supply Chain DD (LBMA/OECD)      │ [N]%  │ [RAG]  │
  │ Governance & Internal Controls   │ [N]%  │ [RAG]  │
  │ Record Keeping & Audit Trail     │ [N]%  │ [RAG]  │
  └──────────────────────────────────┴───────┴────────┘

  KPIs: [N] Green | [N] Amber | [N] Red | Total: [N]

══════════════════════════════════════════════════════════════════════
1. CUSTOMER DUE DILIGENCE & KYC
   Regulatory: FDL Art.12-14, Cabinet Res 134/2025 Art.7-10
   Reporting to: Ministry of Economy
══════════════════════════════════════════════════════════════════════

  KPI-CDD-001  CDD Completion Rate
  ─────────────────────────────────
  Value:    [N]%
  Target:   100%
  Status:   [🟢 GREEN / 🟡 AMBER / 🔴 RED]
  Basis:    FDL No.10/2025 Art.12-13, Cabinet Res 134/2025 Art.7-10

  KPI-CDD-002  CDD Review Timeliness
  ─────────────────────────────────
  Value:    [N]%
  Target:   100%
  Status:   [RAG]
  Detail:   High-risk: [N]/[N] on time (3mo cycle)
            Medium-risk: [N]/[N] on time (6mo cycle)
            Low-risk: [N]/[N] on time (12mo cycle)
  Basis:    Cabinet Res 134/2025 Art.9

  KPI-CDD-003  EDD for High-Risk/PEP Customers
  ─────────────────────────────────
  Value:    [N]%
  Target:   100%
  Status:   [RAG]
  Detail:   [N] high-risk customers, [N] PEPs, [N] with complete EDD
  Basis:    FDL Art.14, Cabinet Res 134/2025 Art.14

  KPI-CDD-004  UBO Register Completeness
  ─────────────────────────────────
  Value:    [N]%
  Target:   100%
  Status:   [RAG]
  Detail:   [N] customers, [N] with UBOs identified (>25%)
  Basis:    Cabinet Decision 109/2023

  KPI-CDD-005  UBO Re-verification Timeliness
  ─────────────────────────────────
  Value:    [N]%
  Target:   100%
  Detail:   [N] ownership changes, [N] re-verified within 15 working days
  Basis:    Cabinet Decision 109/2023

  KPI-CDD-006  Evidence Completeness
  ─────────────────────────────────
  Value:    [N]%
  Target:   95%
  Detail:   [N] documents linked, [N] missing, [N] expired
  Basis:    FDL Art.12, MoE DPMS Guidance

══════════════════════════════════════════════════════════════════════
2. SANCTIONS SCREENING & TARGETED FINANCIAL SANCTIONS
   Regulatory: Cabinet Res 74/2020, FDL Art.35, EOCN TFS Guidance
   Reporting to: Executive Office for Control & Non-Proliferation (EOCN)
══════════════════════════════════════════════════════════════════════

  KPI-TFS-001  Screening Coverage at Onboarding
  Value: [N]% | Target: 100% | Status: [RAG]
  Lists: UN ✓ | OFAC ✓ | EU ✓ | UK ✓ | UAE ✓ | EOCN ✓

  KPI-TFS-002  Sanctions List Currency
  Value: [N] days since refresh | Target: ≤1 day | Status: [RAG]
  Last refresh: [date]

  KPI-TFS-003  Asset Freeze Response Time
  Value: [N] hours avg | Target: <24h | Status: [RAG]
  Incidents: [N] | All within 24h: [YES/NO]

  KPI-TFS-004  CNMR Filing Timeliness
  Value: [N]% on time | Target: 100% | Status: [RAG]
  Filed: [N] | Within 5 business days: [N]

  KPI-TFS-005  Re-screening After List Updates
  Value: [N]% | Target: 100% | Status: [RAG]
  List updates this period: [N] | Full re-screens completed: [N]

  KPI-TFS-006  PEP Screening Rate
  Value: [N]% | Target: 100% | Status: [RAG]

══════════════════════════════════════════════════════════════════════
3. FIU REPORTING & goAML
   Regulatory: FDL Art.26-27, MoE Circular 08/AML/2021
   Reporting to: UAE Financial Intelligence Unit (FIU)
══════════════════════════════════════════════════════════════════════

  KPI-FIU-001  STR/SAR Filing Timeliness
  Value: [N]% within 10 business days | Target: 100% | Status: [RAG]
  Filed: [N] STRs, [N] SARs | Average filing time: [N] business days

  KPI-FIU-002  CTR/DPMSR Filing Timeliness
  Value: [N]% within 15 business days | Target: 100% | Status: [RAG]
  Cash transactions ≥ AED 55,000: [N] | CTRs filed: [N]

  KPI-FIU-003  goAML Registration Active
  Value: [Active/Inactive] | Target: Active | Status: [RAG]

  KPI-FIU-004  Quarterly DPMS Report
  Value: [Submitted/Pending] | Target: Submitted | Status: [RAG]
  Due: [date] | Submitted: [date or "pending"]

  KPI-FIU-005  FIU Information Requests
  Value: [N]% responded within deadline | Target: 100% | Status: [RAG]
  Requests received: [N] | Responded: [N]

  KPI-FIU-006  No Tipping-Off Incidents
  Value: [N] incidents | Target: 0 | Status: [RAG]

══════════════════════════════════════════════════════════════════════
4. RISK ASSESSMENT & MONITORING
══════════════════════════════════════════════════════════════════════

  KPI-RA-001  EWRA Currency: [date last updated] | [RAG]
  KPI-RA-002  Risk Appetite Adherence: [N]% | [RAG]
  KPI-RA-003  TM Alert Resolution: [N]% within 5 days | [RAG]

══════════════════════════════════════════════════════════════════════
5. TRAINING & AWARENESS
══════════════════════════════════════════════════════════════════════

  KPI-TR-001  Annual AML/CFT Training: [N]% completed | [RAG]
  Staff total: [N] | Completed: [N] | Outstanding: [N]

  KPI-TR-002  CO/MLRO Specialist Training: [Complete/Incomplete] | [RAG]

══════════════════════════════════════════════════════════════════════
6. SUPPLY CHAIN DUE DILIGENCE (LBMA/OECD)
══════════════════════════════════════════════════════════════════════

  KPI-SC-001  KYS Completion: [N]% | [RAG]
  Active suppliers: [N] | With DD: [N]

  KPI-SC-002  CAHRA Assessment: [N]% | [RAG]
  CAHRA-origin suppliers: [N] | Assessed: [N]

  KPI-SC-003  Independent Audit: [Complete/Pending] | [RAG]
  Last audit: [date] | Auditor: [name]

══════════════════════════════════════════════════════════════════════
7. GOVERNANCE & INTERNAL CONTROLS
══════════════════════════════════════════════════════════════════════

  KPI-GOV-001  Compliance Manual: [Current/Outdated] | [RAG]
  KPI-GOV-002  Board Reporting: [Submitted/Pending] | [RAG]
  KPI-GOV-003  Internal Audit: [Complete/Pending] | [RAG]
  KPI-GOV-004  Gap Remediation: [N]% | [RAG]
  Open gaps: [N] | Critical: [N] | Remediated: [N]

══════════════════════════════════════════════════════════════════════
8. RECORD KEEPING & AUDIT TRAIL
══════════════════════════════════════════════════════════════════════

  KPI-RK-001  Record Retention: [N]% compliant | [RAG]
  Records: [N] | Retained ≥5 years: [N]

  KPI-RK-002  Audit Trail Integrity: [VERIFIED/FAILED] | [RAG]
  Hash-chain verification: [passed/failed at entry #N]

══════════════════════════════════════════════════════════════════════
CRITICAL FINDINGS (RED KPIs)
══════════════════════════════════════════════════════════════════════

  [N] KPIs in RED status require immediate action:

  1. [KPI-ID] [Name]: [value] vs target [target]
     Regulation: [ref]
     Risk: [penalty range per Cabinet Res 71/2024]
     Action: [recommended remediation]

══════════════════════════════════════════════════════════════════════
RECOMMENDATIONS
══════════════════════════════════════════════════════════════════════

  Priority 1 (Immediate):
  - [action items for RED KPIs]

  Priority 2 (This Quarter):
  - [action items for AMBER KPIs]

  Priority 3 (Ongoing):
  - [improvements for GREEN KPIs to maintain status]

══════════════════════════════════════════════════════════════════════
REGULATORY PENALTY EXPOSURE
══════════════════════════════════════════════════════════════════════

  Based on RED findings, estimated penalty exposure:
  - Per Cabinet Res 71/2024: AED [min] — AED [max]
  - Criminal liability risk: [YES/NO]
  - License suspension risk: [YES/NO]

══════════════════════════════════════════════════════════════════════
SIGN-OFF
══════════════════════════════════════════════════════════════════════

  Prepared by:  _________________________  Date: __________
  (Compliance Officer / MLRO)

  Reviewed by:  _________________________  Date: __________
  (Senior Management)

  Approved by:  _________________________  Date: __________
  (Board / Managing Director)

╔══════════════════════════════════════════════════════════════════════╗
║  CONFIDENTIAL — For authorized compliance personnel only.          ║
║  Hawkeye Sterling V2 — Where Vision Meets Vigilance                ║
╚══════════════════════════════════════════════════════════════════════╝
```
