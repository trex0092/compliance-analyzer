# /audit — Enhanced Compliance Audit Report Generator

Generate a comprehensive compliance audit report using code-review-graph analysis,
multi-model AI validation, and transaction monitoring telemetry.

## Usage
```
/audit [area]
```

Areas: `all`, `cra`, `tfs`, `str`, `ubo`, `supply-chain`, `training`, `evidence`,
`transaction-monitoring`, `code-quality`, `security`

## Instructions

When this skill is invoked, follow these steps:

### Step 1: Gather Data
1. Call `get_minimal_context(task="compliance audit")`.
2. Call `get_architecture_overview()` to understand module structure.
3. Call `list_flows()` to identify critical compliance flows.
4. Call `find_large_functions(min_lines=100)` to flag decomposition risks.

### Step 2: Automated Code Checks
Run these and capture results:
```bash
npx tsc --noEmit 2>&1 | grep "error" | wc -l     # TypeScript errors
npx eslint src/ --ext .ts,.tsx 2>&1 | grep "error" | wc -l  # Lint errors
npx vitest run 2>&1                                 # Test results
```

### Step 3: Compliance Audit Checklist

For each area, verify implementation against UAE regulatory requirements:

**Customer Risk Assessment (CRA/CDD/EDD)**
- [ ] Risk scoring model implemented (FDL Art.12-14)
- [ ] Scoring uses `calcFlagScore()` with likelihood × impact formula
- [ ] Context multipliers applied for jurisdiction, PEP, cash, sanctions
- [ ] CDD for all customers (Cabinet Res 134/2025 Art.7-10)
- [ ] SDD for score < 6, CDD for 6-15, EDD for >= 16
- [ ] EDD for high-risk customers, PEPs (Art.14)
- [ ] Four-eyes approval for high-risk onboarding
- [ ] CDD review frequencies: 3mo (high), 6mo (medium), 12mo (low)
- [ ] All thresholds imported from `src/domain/constants.ts`

**Targeted Financial Sanctions (TFS)**
- [ ] Sanctions screening on onboarding (Cabinet Res 74/2020)
- [ ] All 6 lists checked: UN, OFAC, EU, UK, UAE, EOCN
- [ ] Re-screening on list updates
- [ ] Fuzzy matching with threshold >= 0.75 (from `FUZZY_MATCH_THRESHOLD`)
- [ ] Asset freeze capability IMMEDIATELY (`EOCN_FREEZE_IMMEDIATELY`, EOCN TFS Guidance 2025)
- [ ] CNMR filing within 5 business days (`CNMR_FILING_DEADLINE_BUSINESS_DAYS`)
- [ ] EOCN reporting mechanism
- [ ] Multi-model consensus screening available for high-risk matches

**STR/SAR Filing**
- [ ] STR case management workflow (FDL Art.26-27)
- [ ] goAML XML export capability with schema validation
- [ ] No tipping-off safeguards (FDL Art.29) — STR status never exposed to subject
- [ ] Filing deadline: 10 business days (`STR_FILING_DEADLINE_BUSINESS_DAYS`)
- [ ] Post-filing enhanced monitoring
- [ ] Deadline tracking uses `src/utils/businessDays.ts`

**Transaction Monitoring**
- [ ] 12 TM rules implemented (`src/risk/transactionMonitoring.ts`)
- [ ] Real-time engine with behavioral profiling (`src/services/transactionMonitoringEngine.ts`)
- [ ] Circuit breaker for alert volume spikes (critical alerts pass through)
- [ ] Velocity tracking (frequency analysis per customer)
- [ ] Cumulative exposure tracking (rolling 30-day window)
- [ ] Cross-border detection at AED 60,000 threshold
- [ ] Structuring detection at 73% of AED 55,000
- [ ] Dormancy reactivation at 90 days / AED 20,000

**UBO Register**
- [ ] Beneficial ownership tracking (Cabinet Decision 109/2023)
- [ ] 25% ownership threshold enforcement (`UBO_OWNERSHIP_THRESHOLD_PCT`)
- [ ] Re-verification within 15 working days (`UBO_REVERIFICATION_WORKING_DAYS`)

**Supply Chain (LBMA RGG v9 / MoE RSG Framework)**
- [ ] Five-step framework tracking
- [ ] CAHRA risk assessment with scoring (`SUPPLY_CHAIN_RISK_POINTS`)
- [ ] Mine-to-market chain of custody
- [ ] Annual third-party audit preparation
- [ ] ASM compliance tracking

**Evidence & Record Retention**
- [ ] Evidence expiry tracking
- [ ] 5-year retention (FDL Art.24, `RECORD_RETENTION_YEARS`)
- [ ] Tamper-proof audit trail with cryptographic signatures
- [ ] Audit chain validation (`src/utils/auditChain.ts`)

**Code Quality & Security**
- [ ] Zero TypeScript errors (`tsc --noEmit`)
- [ ] Zero ESLint errors
- [ ] All tests passing with 136+ tests
- [ ] No hardcoded secrets (GitGuardian / pre-commit hooks)
- [ ] No `eval()`, `new Function()`, or dynamic code execution
- [ ] `innerHTML` usage sanitized with `escapeHtml()`
- [ ] `JSON.parse` calls wrapped in try/catch
- [ ] Promise chains have error handlers
- [ ] RBAC enforced on all sensitive operations
- [ ] Environment variables for all credentials

### Step 4: Risk Scoring

Score each area using the standard framework:

| Rating | Score | Criteria |
|--------|-------|----------|
| Compliant | 0 | All checks pass, evidence complete |
| Minor Gap | 1-5 | Non-critical missing items, easy remediation |
| Material Gap | 6-10 | Regulatory risk, needs prioritized remediation |
| Critical Gap | 11+ | Immediate regulatory exposure, block deployment |

### Step 5: Generate Report

```markdown
# Compliance Audit Report
Date: [dd/mm/yyyy]
Entity: [active company]
Auditor: [role]
Constants Version: [REGULATORY_CONSTANTS_VERSION from constants.ts]

## Executive Summary
[overall compliance posture — compliant / partially compliant / non-compliant]
[total score / max possible]

## Code Health
- TypeScript errors: [N]
- Lint errors: [N]
- Test results: [N/N passing]
- Large functions (>100 lines): [N flagged]

## Findings by Area

### [Area Name]
- **Status**: [Compliant / Minor Gap / Material Gap / Critical Gap]
- **Score**: [N/max]
- **Regulatory Reference**: [...]
- **Finding**: [...]
- **Evidence**: [file paths, test names]
- **Recommendation**: [...]
- **Priority**: [Critical / High / Medium / Low]
- **Remediation Deadline**: [dd/mm/yyyy]

## Transaction Monitoring Health
- Active TM rules: [N/12]
- Behavioral profiling: [enabled/disabled]
- Circuit breaker status: [armed/tripped]
- Alert volume (last session): [N alerts, N critical]

## Multi-Model Screening Status
- Models configured: [N]
- Consensus mode: [enabled/disabled]
- Last screening run: [timestamp]

## Gap Register
| # | Area | Gap | Regulation | Priority | Owner | Deadline | Status |
|---|------|-----|-----------|----------|-------|----------|--------|

## Action Items
1. [action] — Owner: [role] — Deadline: [dd/mm/yyyy] — Regulation: [ref]

## Regulatory Constants Verification
Verify these constants match current law:
- DPMS_CASH_THRESHOLD_AED: [value] ← MoE Circular 08/AML/2021
- CROSS_BORDER_CASH_THRESHOLD_AED: [value] ← Cabinet Res 134/2025
- EOCN_FREEZE_IMMEDIATELY: [value] ← Cabinet Res 74/2020, EOCN TFS Guidance July 2025
- UBO_OWNERSHIP_THRESHOLD_PCT: [value] ← Cabinet Decision 109/2023
- REGULATORY_CONSTANTS_VERSION: [value]
```
