# /audit-pack — Complete Audit Pack Generator

Generate a comprehensive, auditor-ready compliance pack for any entity or time period. This is the single most powerful command for MoE inspections, LBMA audits, and internal reviews.

## Usage
```
/audit-pack [entity-name] [period]
```
Examples:
- `/audit-pack "MADISON JEWELLERY" Q1-2026`
- `/audit-pack all 2025`
- `/audit-pack "FINE GOLD LLC" last-12-months`

## Instructions

### PHASE 1: Gather All Data

For the specified entity and period, collect from localStorage:

1. **Customer Profile** (fgl_cra_v2)
   - Legal name, trade license, registration
   - Risk classification and CDD tier
   - All risk assessment history

2. **CDD/EDD Records** (fgl_cra_v2)
   - Initial CDD date and level
   - All review dates and outcomes
   - EDD triggers and documentation
   - Source of funds/wealth declarations

3. **UBO Register** (fgl_ubo_v2)
   - All beneficial owners (>25% threshold)
   - Verification dates
   - Ownership chain documentation

4. **Sanctions Screening Log** (fgl_tfs_events_v2)
   - Every screening run: date, lists checked, result
   - All matches: true hits, false positives, potential matches
   - Analyst decisions and reasoning
   - Re-screening after list updates

5. **STR/SAR/CTR Filings** (fgl_goaml_reports)
   - All reports: type, date created, date filed, status
   - Filing timeliness (business days — use checkDeadline from businessDays.ts)
   - goAML reference numbers

6. **Transaction Records** (fgl_threshold_ctr_queue)
   - Cash transactions >= AED 55,000
   - Structuring detection alerts
   - Threshold breach history

7. **Evidence Register** (from alertEngine evidence checks)
   - All documents: type, upload date, expiry date, status
   - Missing evidence list
   - Expired evidence list

8. **Approval Chain** (fgl_approvals_v2)
   - All approvals: who requested, who approved, when
   - Four-eyes compliance verification
   - Rejected approvals and reasoning

9. **Incident History** (fgl_workflow_log)
   - All compliance incidents
   - Response timelines
   - EOCN reports and asset freezes

10. **Training Records** (if tracked)
    - Staff training dates and topics
    - AML/CFT/CPF certification status

### PHASE 2: Compliance Assessment

For each area, calculate:
- **Status**: Compliant / Partially Compliant / Non-Compliant
- **Evidence**: What documents support this status
- **Gaps**: What's missing
- **Regulatory Reference**: Which article applies

### PHASE 3: Generate Report

```
═══════════════════════════════════════════════════════════════
          COMPLIANCE AUDIT PACK — [ENTITY NAME]
          Period: [start] to [end]
          Generated: [date] by Hawkeye Sterling V2
          Classification: CONFIDENTIAL
═══════════════════════════════════════════════════════════════

TABLE OF CONTENTS
1. Executive Summary
2. Entity Profile & Risk Classification
3. CDD/EDD Compliance Record
4. UBO Register & Verification
5. Sanctions Screening History
6. STR/SAR/CTR Filing Record
7. Transaction Monitoring Alerts
8. Evidence & Documentation Register
9. Approval Chain & Four-Eyes Log
10. Incident Response History
11. Gap Register
12. Filing Timeliness Report
13. Regulatory Mapping Matrix
14. Remediation Action Plan

─────────────────────────────────────────────────────────────
1. EXECUTIVE SUMMARY
─────────────────────────────────────────────────────────────

Overall Compliance Posture: [COMPLIANT / PARTIALLY / NON-COMPLIANT]
Risk Level: [LOW / MEDIUM / HIGH / CRITICAL]
Audit Readiness Score: [N]% (based on 25-point MOE checklist)

Key Metrics:
| Metric | Value | Status |
|--------|-------|--------|
| CDD Reviews On Time | [N]% | [✓/✗] |
| STR Filing Timeliness | [N]% | [✓/✗] |
| Screening Runs (period) | [N] | [✓/✗] |
| Evidence Completion | [N]% | [✓/✗] |
| Open Critical Alerts | [N] | [✓/✗] |
| Overdue Reviews | [N] | [✓/✗] |
| Pending Approvals | [N] | [✓/✗] |

Critical Findings: [N]
High-Priority Gaps: [N]
Remediation Items: [N]

─────────────────────────────────────────────────────────────
2. ENTITY PROFILE & RISK CLASSIFICATION
─────────────────────────────────────────────────────────────

[Full entity details, risk assessment history, CDD tier]

─────────────────────────────────────────────────────────────
3. CDD/EDD COMPLIANCE RECORD
─────────────────────────────────────────────────────────────

| Review Date | Type | Reviewer | Outcome | Next Due |
|-------------|------|----------|---------|----------|
[all reviews with dates and outcomes]

Regulatory Ref: FDL Art.12-14, Cabinet Res 134/2025 Art.7-10

─────────────────────────────────────────────────────────────
5. SANCTIONS SCREENING HISTORY
─────────────────────────────────────────────────────────────

| Date | Lists Screened | Result | Analyst | Decision |
|------|---------------|--------|---------|----------|
[every screening with full audit trail]

Total Screenings: [N]
True Hits: [N]
False Positives: [N]
Pending Review: [N]

Regulatory Ref: Cabinet Res 74/2020, FDL Art.35

─────────────────────────────────────────────────────────────
12. FILING TIMELINESS REPORT
─────────────────────────────────────────────────────────────

| Report | Created | Filed | Deadline | Biz Days Used | Status |
|--------|---------|-------|----------|---------------|--------|
[all filings with business day calculation]

On-Time Filing Rate: [N]%
Average Filing Time: [N] business days

Regulatory Ref: FDL Art.26 (STR: 10bd), Art.16 (CTR: 15bd)

─────────────────────────────────────────────────────────────
13. REGULATORY MAPPING MATRIX
─────────────────────────────────────────────────────────────

| Regulation | Article | Requirement | Implementation | Evidence | Status |
|-----------|---------|-------------|----------------|----------|--------|
| FDL 10/2025 | Art.12 | Customer identification | compliance-suite.js:CRA | CDD record | ✓ |
| FDL 10/2025 | Art.13 | Risk-based approach | src/risk/scoring.ts | Risk scores | ✓ |
| FDL 10/2025 | Art.14 | Enhanced due diligence | compliance-suite.js:EDD | EDD records | ✓ |
| ... | ... | ... | ... | ... | ... |

─────────────────────────────────────────────────────────────
14. REMEDIATION ACTION PLAN
─────────────────────────────────────────────────────────────

| # | Gap | Regulation | Priority | Owner | Deadline | Status |
|---|-----|-----------|----------|-------|----------|--------|
[all gaps with assigned owners and deadlines]

═══════════════════════════════════════════════════════════════
END OF AUDIT PACK
═══════════════════════════════════════════════════════════════
```

### PHASE 4: Cross-Reference
Verify every claim in the audit pack has supporting evidence:
- Every "Compliant" status → cite the specific record/document
- Every filing → cite the goAML reference
- Every screening → cite the log entry with timestamp
- Every approval → cite the approver name and timestamp
