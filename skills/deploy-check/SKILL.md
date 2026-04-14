# /deploy-check — Pre-Deployment Compliance Verification

Run a comprehensive pre-deployment check to ensure no compliance regressions before pushing to production.

## Usage
```
/deploy-check
```

## Instructions

### Step 1: Run All Tests
```bash
npx vitest run
```
ALL tests must pass. If any fail:
- **constants.test.ts failure** = regulatory constant was changed — BLOCK deployment
- **decisions.test.ts failure** = risk scoring logic changed — BLOCK deployment
- **businessDays.test.ts failure** = deadline calculation changed — BLOCK deployment
- **scoring.test.ts failure** = risk calculation changed — BLOCK deployment

### Step 2: Security Scan
Run the pre-commit security hook:
```bash
bash hooks/pre-commit-security.sh
```
Must pass with 0 issues. Check for:
- [ ] No hardcoded secrets/tokens
- [ ] No eval() or new Function()
- [ ] No dangerouslySetInnerHTML without sanitization
- [ ] No console.log (only console.warn/error)

### Step 3: Compliance Logic Verification
Using code-review-graph, check:
1. `get_impact_radius` for all changed files
2. If ANY of these files changed, flag for manual CO review:
   - `compliance-suite.js` (core compliance logic)
   - `auth-rbac.js` (access control)
   - `goaml-export.js` (regulatory filing)
   - `tfs-refresh.js` (sanctions screening)
   - `threshold-monitor.js` (CTR thresholds)
   - `workflow-engine.js` (automation rules)
   - `src/risk/scoring.ts` (risk calculation)
   - `src/risk/decisions.ts` (case decisions)
   - `src/domain/constants.ts` (regulatory constants)
   - `src/utils/businessDays.ts` (deadline calculations)

### Step 4: Data Integrity
- [ ] No migration scripts that could lose data
- [ ] localStorage keys unchanged (check SK object in compliance-suite.js)
- [ ] IndexedDB schema backward-compatible

### Step 5: CSP & Headers
- [ ] netlify.toml headers intact
- [ ] No unsafe-inline in script-src
- [ ] CORS policy unchanged

### Step 6: Asana Env Validation
Run the deploy-readiness env validator. This catches missing env vars
that would silently break the autopilot dispatcher, the cross-project
mirrors (audit log + central MLRO + inspector), the webhook receiver,
the four-eyes flow, and the per-customer status update cron.

```bash
npm run asana:env:check
```

The validator categorises every check as:
- 🚫 **BLOCKER** — missing → core feature broken, deploy will fail
- ⚠ **WARNING** — missing → enhancement degrades to a no-op silently
- ✓ **INFO** — confirmation that a feature is fully wired

Exit code:
- `0` when all blockers pass
- `1` when any blocker is present

For a strict deploy (treat warnings as blockers too):
```bash
npm run asana:env:check -- --strict
```

**Block deployment** if:
- ANY blocker is reported (HTTP token missing, four-eyes
  misconfigured, placeholder REPLACE_ME values still present,
  non-HTTPS webhook target)
- Solo-MLRO mode is enabled but `HAWKEYE_APPROVER_KEYS` is empty
- Standard four-eyes mode and fewer than 2 approvers configured

**Warnings are acceptable for deploy** but indicate features that
will silently degrade — track and fix in the next pass.

### Output
```
## Pre-Deployment Check

### Test Results
- Total: [N] tests
- Passed: [N] ✓
- Failed: [N] ✗

### Security Scan
- Issues: [N]
- Status: [PASS/FAIL]

### Compliance Impact
- Files changed: [N]
- Compliance-critical files changed: [list]
- CO Review Required: [YES/NO]

### Verdict
[SAFE TO DEPLOY / BLOCKED — reason]
```
