---
model: opus
allowed-tools: [Read, Grep, Glob, Bash, Agent, Edit]
context: [src/domain/constants.ts, tests/constants.test.ts, CLAUDE.md]
hooks: { post-run: "echo '[AUDIT] /regulatory-update completed $(date -u +%Y-%m-%dT%H:%M:%SZ)'" }
risk-level: critical
regulatory-refs: [FDL No.10/2025, Cabinet Res 134/2025, Cabinet Res 74/2020]
---

# /regulatory-update — Process New Regulation & Update Codebase

Process a new regulation, circular, or sanctions list update and identify all code that needs to change.

## Usage
```
/regulatory-update [regulation-name or description]
```

Examples:
- `/regulatory-update FATF adds Country X to Grey List`
- `/regulatory-update MoE Circular 02/2026 new DPMS threshold`
- `/regulatory-update Cabinet Resolution 200/2026 new penalty ranges`
- `/regulatory-update EOCN new designation: Entity Y`
- `/regulatory-update LBMA RGG v10 released`

## Instructions

### Step 1: Analyze the Regulation
Determine:
- What changed? (threshold, country list, deadline, procedure, penalty)
- Effective date?
- Which UAE law/article does it amend?
- Implementation deadline? (usually 30 days for MoE circulars)

### Step 2: Impact Analysis
Use code-review-graph to find all affected code:

1. Call `get_minimal_context(task="regulatory update: [description]")`
2. For threshold changes → search `src/domain/constants.ts` for the affected constant
3. For country list changes → search `FATF_GREY_LIST`, `EU_HIGH_RISK_COUNTRIES`, `PF_HIGH_RISK_JURISDICTIONS` in constants.ts
4. Call `get_impact_radius` on `src/domain/constants.ts` to find all downstream consumers
5. Search for any hardcoded values in root .js files that also need updating

### Step 3: Generate Change Plan

For each affected file, specify:
- What line(s) to change
- Old value → New value
- Regulatory reference for the change

### Step 4: Update Constants
Always update `src/domain/constants.ts` FIRST:
- Change the constant value
- Update `REGULATORY_CONSTANTS_VERSION` to today's date
- Update `REGULATORY_CONSTANTS_NOTES` with the regulation reference

### Step 5: Update Tests
Update `tests/constants.test.ts` to reflect new values.
Tests must pass BEFORE and AFTER the change (before = verify old value, after = verify new value).

### Step 6: Update CLAUDE.md
If the regulation affects:
- Key Legislation table → update the table
- Critical Thresholds → update the list
- Coding Rules → add/modify rules

### Step 7: Rebuild Graph
Run `build_or_update_graph_tool` to keep the knowledge graph current.

### Output
```
## Regulatory Update Report

### Regulation
- Name: [full regulation name]
- Effective: [date]
- Implementation deadline: [date]

### Impact Analysis
| File | Line(s) | Change | Status |
|------|---------|--------|--------|
| constants.ts | [N] | [old] → [new] | Updated |
| [other files] | ... | ... | ... |

### Tests Updated
- constants.test.ts: [N] test(s) modified

### Compliance Timeline
- [x] Constants updated
- [x] Tests updated
- [x] Graph rebuilt
- [ ] CO review and approval
- [ ] Deploy to production
- [ ] Confirm in compliance log

### Regulatory Reference
[full citation]
```
