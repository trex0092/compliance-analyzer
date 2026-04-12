---
model: sonnet
allowed-tools: [Read, Grep, Glob, Bash, Agent]
context: [src/domain/constants.ts, src/services/weaponizedConsensus.ts, CLAUDE.md]
hooks: { post-run: "echo '[AUDIT] /review-pr completed $(date -u +%Y-%m-%dT%H:%M:%SZ)'" }
risk-level: medium
regulatory-refs: [FATF Rec 26, FDL No.10/2025 Art.20]
---

# /review-pr — Enhanced Risk-Scored Pull Request Review

Review a pull request with compliance-aware risk scoring using code-review-graph,
multi-model AI consensus, and real-time transaction monitoring validation.

## Usage
```
/review-pr [PR number or branch]
```

## Instructions

When this skill is invoked, follow these steps:

### Step 1: Graph-Informed Context
1. Call `get_minimal_context(task="review PR")` to understand overall project state.
2. Call `detect_changes()` to get a risk-scored list of all changes.
3. Call `get_affected_flows()` to identify downstream execution paths impacted.
4. Call `get_review_context()` for graph-informed review focus areas.

### Step 2: Prioritized Code Review (by Risk Tier)

#### Critical/High Risk Changes
Read the actual code. Check exhaustively for:
- **Security**: hardcoded secrets, missing input validation, XSS, eval(), SQL injection
- **Compliance**: UAE FDL No.10/2025 violations, missing audit trails, tipping off
- **Logic**: incorrect risk scoring, wrong thresholds (must use constants.ts), broken sanctions
- **Type safety**: unsafe casts, missing null checks, unhandled promise rejections
- **Test coverage**: verify changed functions have corresponding test updates

#### Medium Risk Changes
- Check blast radius with `get_impact_radius()`
- Review key logic paths only
- Verify no magic numbers (thresholds must come from `src/domain/constants.ts`)

#### Low Risk Changes
- Skim for obvious issues
- No deep review needed

### Step 3: Multi-Model Compliance Validation
For changes touching compliance-critical code, use the multi-model screening engine
(`src/services/multiModelScreening.ts`) pattern to validate:

1. **Sanctions screening logic** — verify all 6 lists checked (UN, OFAC, EU, UK, UAE, EOCN)
2. **Risk scoring changes** — run `npx vitest run tests/scoring.test.ts tests/decisions.test.ts tests/constants.test.ts` before and after
3. **Threshold values** — must import from `src/domain/constants.ts`, never hardcoded
4. **Filing deadlines** — must use `src/utils/businessDays.ts`, never calendar days
5. **STR workflow** — verify no tipping off (FDL Art.29): never expose STR status to subject
6. **Four-eyes** — high-risk decisions require two independent approvers

### Step 4: Transaction Monitoring Impact
If changes affect `src/risk/transactionMonitoring.ts` or `src/services/transactionMonitoringEngine.ts`:
1. Verify circuit breaker logic still allows critical alerts to pass through
2. Confirm cumulative exposure thresholds use `DPMS_CASH_THRESHOLD_AED` from constants
3. Run `npx vitest run tests/transactionMonitoringEngine.test.ts` and verify all pass
4. Check behavioral deviation multipliers are documented

### Step 5: Regulatory Cross-Reference
For any change touching these areas, verify regulatory alignment:

| Area | Regulation | Key Check |
|------|-----------|-----------|
| CDD/CRA | FDL Art.12-14, Cabinet Res 134/2025 Art.7-10 | Score thresholds, review frequencies |
| STR/SAR filing | FDL Art.26-27 | No tipping off, deadline tracking |
| Sanctions/TFS | Cabinet Res 74/2020 | 24h freeze, 5-day CNMR, EOCN notification |
| UBO records | Cabinet Decision 109/2023 | 25% threshold, 15-day re-verify |
| Cash thresholds | FDL Art.16, MoE Circular 08/AML/2021 | AED 55,000 CTR, AED 60,000 cross-border |
| Supply chain | LBMA RGG v9, MoE RSG Framework | Origin traceability, CAHRA screening |
| PF controls | Cabinet Res 156/2025 | Dual-use keywords, PF risk assessment |
| Penalties | Cabinet Res 71/2024 | AED 10K–100M range |

### Step 6: Automated Checks
Run these commands and report results:
```bash
npx tsc --noEmit                    # Zero TS errors
npx eslint src/ --ext .ts,.tsx      # Zero lint errors
npx prettier --check 'src/**/*.{ts,tsx}'  # Zero format issues
npx vitest run                      # All tests passing
```

### Step 7: Report
Provide a structured review:

```
## PR Review Summary
**Risk Level**: [Critical/High/Medium/Low]
**Files Changed**: N files (N high-risk, N medium, N low)
**Affected Flows**: [list from get_affected_flows]
**Test Coverage**: [N/N tests passing, coverage gaps noted]

### Critical Findings
- [blocking issues that MUST be fixed]

### Warnings
- [non-blocking concerns, suggestions]

### Compliance Checklist
- [ ] No hardcoded secrets or API keys
- [ ] Input validation on all user-facing inputs
- [ ] Audit trail maintained (timestamp, user, action)
- [ ] Regulatory references correct and current
- [ ] Thresholds imported from constants.ts (not hardcoded)
- [ ] Filing deadlines use businessDays.ts
- [ ] No tipping off in STR/SAR workflows
- [ ] Four-eyes principle enforced for high-risk decisions
- [ ] TypeScript strict mode passes (tsc --noEmit)
- [ ] All tests passing (vitest run)
- [ ] Prettier formatting clean

### Security Checklist
- [ ] No eval(), new Function(), or dynamic code execution
- [ ] No innerHTML with unsanitized user input
- [ ] JSON.parse wrapped in try/catch
- [ ] Promise chains have .catch() handlers
- [ ] Environment variables used for all credentials
- [ ] Rate limiting considered for new endpoints

### Verdict
[APPROVE / REQUEST CHANGES / NEEDS DISCUSSION]
[Rationale in 1-2 sentences]
```
