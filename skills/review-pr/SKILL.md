# /review-pr — Risk-Scored Pull Request Review

Review a pull request with compliance-aware risk scoring using the code-review-graph.

## Usage
```
/review-pr [PR number or branch]
```

## Instructions

When this skill is invoked, follow these steps:

### Step 1: Get Context
1. Call `get_minimal_context(task="review PR")` to understand overall project state.
2. Call `detect_changes()` to get a risk-scored list of all changes.
3. Call `get_review_context()` for graph-informed review focus areas.

### Step 2: Analyze by Risk
- **Critical/High risk changes**: Read the actual code, check for:
  - Security: hardcoded secrets, missing input validation, XSS, eval()
  - Compliance: UAE FDL No.10/2025 violations, missing audit trails
  - Logic: incorrect risk scoring, wrong thresholds (AED 55,000), broken sanctions checks
- **Medium risk**: Check blast radius with `get_impact_radius()`, review key logic only.
- **Low risk**: Skim for obvious issues, no deep review needed.

### Step 3: Check Compliance Impact
For any change touching these areas, verify regulatory alignment:
- Customer Risk Assessment → FDL Art.12-14, Cabinet Res 134/2025
- STR/SAR filing → FDL Art.26-27 (no tipping off)
- Sanctions/TFS → Cabinet Res 74/2020, EOCN protocols
- UBO records → Cabinet Decision 109/2023
- Thresholds → FDL Art.16, AED 55,000
- Supply chain → LBMA RGG v9, OECD DDG

### Step 4: Report
Provide a structured review:
```
## PR Review Summary
**Risk Level**: [Critical/High/Medium/Low]
**Files Changed**: N files (N high-risk, N medium, N low)

### Critical Findings
- [blocking issues]

### Warnings
- [non-blocking concerns]

### Compliance Check
- [ ] No hardcoded secrets
- [ ] Input validation present
- [ ] Audit trail maintained
- [ ] Regulatory references correct

### Verdict
[APPROVE / REQUEST CHANGES / NEEDS DISCUSSION]
```
