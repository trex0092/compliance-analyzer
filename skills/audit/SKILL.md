# /audit — Compliance Audit Report Generator

Generate a comprehensive compliance audit report for the current state of the system.

## Usage
```
/audit [area]
```

Areas: `all`, `cra`, `tfs`, `str`, `ubo`, `supply-chain`, `training`, `evidence`

## Instructions

When this skill is invoked, follow these steps:

### Step 1: Gather Data
1. Call `get_minimal_context(task="compliance audit")`.
2. Call `get_architecture_overview()` to understand module structure.
3. Call `list_flows()` to identify critical compliance flows.

### Step 2: Audit Checklist

For each area, verify implementation against UAE regulatory requirements:

**Customer Risk Assessment (CRA/CDD/EDD)**
- [ ] Risk scoring model implemented (FDL Art.12-14)
- [ ] CDD for all customers (Cabinet Res 134/2025 Art.7-10)
- [ ] EDD for high-risk customers, PEPs (Art.14)
- [ ] Four-eyes approval for high-risk onboarding
- [ ] Annual CRA refresh mechanism

**Targeted Financial Sanctions (TFS)**
- [ ] Sanctions screening on onboarding (Cabinet Res 74/2020)
- [ ] Re-screening on list updates
- [ ] Asset freeze capability within 24h
- [ ] CNMR filing within 5 business days
- [ ] EOCN reporting mechanism

**STR/SAR Filing**
- [ ] STR case management workflow (FDL Art.26-27)
- [ ] goAML XML export capability
- [ ] No tipping-off safeguards (FDL Art.29)
- [ ] Post-filing enhanced monitoring

**UBO Register**
- [ ] Beneficial ownership tracking (Cabinet Decision 109/2023)
- [ ] 25% ownership threshold enforcement
- [ ] Re-verification within 15 working days on changes

**Supply Chain (LBMA RGG v9)**
- [ ] Five-step framework tracking
- [ ] CAHRA risk assessment
- [ ] Mine-to-market chain of custody
- [ ] Annual third-party audit preparation

**Evidence & Record Retention**
- [ ] Evidence expiry tracking
- [ ] 5-year retention (FDL Art.24)
- [ ] Tamper-proof audit trail

### Step 3: Generate Report

```
# Compliance Audit Report
Date: [today]
Entity: [active company]

## Executive Summary
[overall compliance posture — compliant / partially compliant / non-compliant]

## Findings by Area
### [Area Name]
- Status: [Compliant / Gap / Critical Gap]
- Regulatory Reference: [...]
- Finding: [...]
- Recommendation: [...]
- Priority: [Critical / High / Medium / Low]

## Gap Register
| # | Area | Gap | Regulation | Priority | Remediation |
|---|------|-----|-----------|----------|-------------|

## Action Items
1. [action] — Owner: [role] — Deadline: [date]
```
