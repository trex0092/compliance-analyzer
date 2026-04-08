# /traceability — Regulatory Traceability Matrix

Map every regulatory requirement to its implementation in code, its test, and its audit evidence. This is the ultimate proof of compliance for auditors.

## Usage
```
/traceability [regulation]
```
Examples:
- `/traceability all` — full matrix
- `/traceability fdl` — FDL No.10/2025 only
- `/traceability cabinet-134` — Cabinet Res 134/2025
- `/traceability lbma` — LBMA RGG v9

## Instructions

### Step 1: Build Matrix
Use code-review-graph to find implementations. For each regulatory requirement:

1. **Requirement**: The specific article and what it mandates
2. **Implementation**: The file, function, and line number that implements it
3. **Test**: The test that verifies the implementation
4. **Constant**: The threshold/value in constants.ts (if applicable)
5. **Evidence**: What audit evidence the system generates
6. **Status**: Implemented / Partial / Missing

### Step 2: Generate Matrix

```
═══════════════════════════════════════════════════════════════
     REGULATORY TRACEABILITY MATRIX
     Generated: [date]
     Regulations covered: [N]
     Requirements traced: [N]
     Implementation coverage: [N]%
═══════════════════════════════════════════════════════════════

FDL No.10/2025 — UAE AML/CFT/CPF Law
─────────────────────────────────────────────────────────────

| Art. | Requirement | Implementation | Test | Constant | Evidence | Status |
|------|-------------|---------------|------|----------|----------|--------|
| 12 | Customer identification | compliance-suite.js:renderCRATab() | — | — | CRA records | ✓ |
| 13 | Risk-based approach | src/risk/scoring.ts:applyContextMultiplier() | scoring.test.ts:12 | RISK_THRESHOLDS | Risk scores | ✓ |
| 14 | Enhanced due diligence | compliance-suite.js:renderEDDSection() | — | — | EDD records | ✓ |
| 15 | Suspicious indicators | src/risk/redFlags.ts:RED_FLAGS[] | — | — | Alert log | ✓ |
| 16 | Cash threshold CTR | threshold-monitor.js:scanShipments() | constants.test.ts:5 | DPMS_CASH_THRESHOLD_AED=55000 | CTR queue | ✓ |
| 17 | Cross-border declaration | — | constants.test.ts:9 | CROSS_BORDER_CASH_THRESHOLD_AED=60000 | — | PARTIAL |
| 20-21 | CO duties | auth-rbac.js:ROLES/PERMISSIONS | — | — | Auth log | ✓ |
| 24 | Record retention 5yr | — | constants.test.ts:37 | RECORD_RETENTION_YEARS=5 | — | PARTIAL |
| 26 | STR filing 10 biz days | goaml-export.js:exportSTR() | businessDays.test.ts:8 | STR_FILING_DEADLINE_BUSINESS_DAYS=10 | goAML log | ✓ |
| 27 | SAR filing | goaml-export.js:exportSTR() | — | — | goAML log | ✓ |
| 29 | No tipping off | — | — | — | — | ⚠️ MANUAL |
| 35 | TFS obligations | tfs-refresh.js | — | — | Screening log | ✓ |

Cabinet Res 74/2020 — TFS / Asset Freeze
─────────────────────────────────────────────────────────────

| Art. | Requirement | Implementation | Test | Constant | Evidence | Status |
|------|-------------|---------------|------|----------|----------|--------|
| 4 | Freeze IMMEDIATELY | src/utils/businessDays.ts:checkEOCNDeadline() | businessDays.test.ts:14 | EOCN_FREEZE_IMMEDIATELY=true | Incident log | ✓ |
| 6 | CNMR within 5 biz days | src/utils/businessDays.ts:checkDeadline() | businessDays.test.ts:8 | CNMR_FILING_DEADLINE_BUSINESS_DAYS=5 | CNMR log | ✓ |

[continue for all regulations...]

═══════════════════════════════════════════════════════════════
COVERAGE SUMMARY
═══════════════════════════════════════════════════════════════

| Regulation | Total Req. | Implemented | Partial | Missing | Coverage |
|-----------|-----------|-------------|---------|---------|----------|
| FDL 10/2025 | [N] | [N] | [N] | [N] | [N]% |
| Cabinet 134/2025 | [N] | [N] | [N] | [N] | [N]% |
| Cabinet 74/2020 | [N] | [N] | [N] | [N] | [N]% |
| Cabinet 156/2025 | [N] | [N] | [N] | [N] | [N]% |
| LBMA RGG v9 | [N] | [N] | [N] | [N] | [N]% |
| FATF Rec 22/23 | [N] | [N] | [N] | [N] | [N]% |

TOTAL: [N] requirements, [N]% traced to code, [N]% tested
```
