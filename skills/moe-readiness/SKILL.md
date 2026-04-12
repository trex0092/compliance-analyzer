---
model: sonnet
allowed-tools: [Read, Grep, Glob, Bash, Agent]
context: [src/services/trajectoryTracker.ts, src/services/approvalGates.ts, src/domain/constants.ts]
hooks: { post-run: "echo '[AUDIT] /moe-readiness completed $(date -u +%Y-%m-%dT%H:%M:%SZ)'" }
risk-level: high
regulatory-refs: [MoE Circular 08/AML/2021, FDL No.10/2025, Cabinet Res 134/2025]
---

# /moe-readiness — Ministry of Economy Inspection Readiness

Assess readiness against the full 25-item MOE AML/CFT audit checklist. Returns a scored report showing exactly what the inspector will look for and what's missing.

## Usage
```
/moe-readiness
```

## Instructions

### The 25-Point MOE Audit Checklist

Evaluate EVERY item. Score 0 (absent), 0.5 (partial), or 1 (complete):

**Category 1: Governance & Organization (AC-01 to AC-04)**
- AC-01: Board/senior management approval of AML/CFT policies
- AC-02: Designated Compliance Officer (CO/MLRO) appointment letter
- AC-03: CO independence and direct reporting line to Board
- AC-04: Adequate compliance budget and resources

**Category 2: Policies & Procedures (AC-05 to AC-08)**
- AC-05: Written AML/CFT/CPF compliance manual (current version)
- AC-06: Customer acceptance policy aligned with risk appetite
- AC-07: STR/SAR internal escalation and filing procedures
- AC-08: TFS/sanctions screening procedures and asset freeze protocol

**Category 3: Risk Assessment (AC-09 to AC-11)**
- AC-09: Enterprise-Wide Risk Assessment (EWRA) — current, aligned with NRA 2024
- AC-10: Business-Wide Risk Assessment (BWRA) — sector-specific
- AC-11: Customer Risk Assessment (CRA) methodology documented

**Category 4: CDD & KYC (AC-12 to AC-15)**
- AC-12: CDD procedures for all customers (onboarding + ongoing)
- AC-13: EDD procedures for high-risk customers, PEPs, complex structures
- AC-14: Beneficial ownership identification and verification (>25%)
- AC-15: Ongoing monitoring and periodic CDD review schedule

**Category 5: Transaction Monitoring (AC-16 to AC-17)**
- AC-16: Transaction monitoring system (rules, thresholds, alerts)
- AC-17: Cash transaction reporting (AED 55,000 threshold CTR)

**Category 6: Sanctions & TFS (AC-18 to AC-19)**
- AC-18: Sanctions screening system (all relevant lists)
- AC-19: Asset freeze capability and EOCN reporting procedure

**Category 7: Reporting (AC-20 to AC-21)**
- AC-20: goAML registration and filing capability
- AC-21: STR/SAR/CTR filing log with timeliness tracking

**Category 8: Record Keeping (AC-22)**
- AC-22: Record retention system (minimum 5 years, FDL Art.24)

**Category 9: Training (AC-23 to AC-24)**
- AC-23: AML/CFT training program (annual, role-based)
- AC-24: Training completion records and assessment results

**Category 10: Internal Audit (AC-25)**
- AC-25: Independent internal audit/review of AML/CFT controls (annual)

### Assessment Process

For each item:
1. Check if the feature exists in the codebase (use code-review-graph)
2. Check if there's data/evidence in localStorage proving it's used
3. Check if there's documentation (compliance manual, procedures)
4. Score: 0 (not implemented), 0.5 (partially), 1 (fully compliant)

### Output Report

```
═══════════════════════════════════════════════════════════════
     MOE INSPECTION READINESS ASSESSMENT
     Date: [today]
     Entity: [active company]
     Assessed by: Hawkeye Sterling V2
═══════════════════════════════════════════════════════════════

OVERALL READINESS: [N]% ([N]/25 points)

RISK OF PENALTY: [LOW / MEDIUM / HIGH / CRITICAL]
(Cabinet Res 71/2024: AED 10,000 — AED 100,000,000)

═══════════════════════════════════════════════════════════════
DETAILED ASSESSMENT
═══════════════════════════════════════════════════════════════

| # | Item | Score | Evidence | Gap |
|---|------|-------|----------|-----|
| AC-01 | Board policy approval | [0/0.5/1] | [what exists] | [what's missing] |
| AC-02 | CO appointment | [0/0.5/1] | [what exists] | [what's missing] |
| ... | ... | ... | ... | ... |
| AC-25 | Internal audit | [0/0.5/1] | [what exists] | [what's missing] |

═══════════════════════════════════════════════════════════════
CATEGORY SCORES
═══════════════════════════════════════════════════════════════

| Category | Max | Score | % |
|----------|-----|-------|---|
| Governance | 4 | [N] | [N]% |
| Policies | 4 | [N] | [N]% |
| Risk Assessment | 3 | [N] | [N]% |
| CDD/KYC | 4 | [N] | [N]% |
| Transaction Monitoring | 2 | [N] | [N]% |
| Sanctions/TFS | 2 | [N] | [N]% |
| Reporting | 2 | [N] | [N]% |
| Record Keeping | 1 | [N] | [N]% |
| Training | 2 | [N] | [N]% |
| Internal Audit | 1 | [N] | [N]% |

═══════════════════════════════════════════════════════════════
CRITICAL GAPS (fix before inspection)
═══════════════════════════════════════════════════════════════

1. [gap] — Regulation: [ref] — Penalty risk: [amount range]
2. ...

═══════════════════════════════════════════════════════════════
INSPECTOR WILL ASK FOR (prepare these documents)
═══════════════════════════════════════════════════════════════

1. [ ] AML/CFT Compliance Manual (latest version, signed by Board)
2. [ ] CO appointment letter and reporting structure
3. [ ] EWRA and BWRA documents
4. [ ] Customer risk assessment methodology
5. [ ] Sample CDD files (high-risk, medium, low — 3 each)
6. [ ] Sanctions screening system demo
7. [ ] goAML registration proof
8. [ ] STR/SAR filing log (last 12 months)
9. [ ] Training records (all staff, last 12 months)
10. [ ] Internal audit report (last review)
11. [ ] Transaction monitoring rules and alert log
12. [ ] Record retention policy and proof of 5-year storage
13. [ ] TFS procedures and asset freeze log
14. [ ] UBO register (complete, current)
15. [ ] Supply chain due diligence records (if DPMS)
```
