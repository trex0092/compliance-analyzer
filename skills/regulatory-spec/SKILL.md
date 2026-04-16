# /regulatory-spec — Spec-First Regulatory Implementation

Drive a new regulatory feature through the **Regulation → Spec → Code → Test → Evidence**
chain that MoE, LBMA, and internal audit expect to see. Adapts the spec-driven
pattern from `vendor/claude-code-spec-workflow` (Pimzino/claude-code-spec-workflow,
MIT) to UAE AML/CFT/CPF compliance work.

Use this skill **before** writing any code for a new regulation, circular, or
sanctions-list update. It is the spec-first companion to `/regulatory-update`,
which handles in-place changes to existing regulatory constants.

## When to use

- A new law, Cabinet Resolution, or MoE Circular needs a brand-new feature
  (not just a constant bump — for that, use `/regulatory-update`).
- A new STR/SAR/CTR/DPMSR/CNMR filing type is being introduced.
- A new CDD/EDD workflow stage is being added.
- A new sanctions list, screening source, or risk multiplier is being added.
- Any work where the auditor will later ask "show me the spec, the code that
  implements it, the test that proves it, and the evidence it ran."

## When NOT to use

- Constant value bumps → `/regulatory-update`
- One-line fixes, typos, lint repairs → no skill needed
- Pure UI changes with no regulatory logic → no skill needed
- Bug fixes in existing compliance logic → `/incident` (if MLRO-visible) or a
  plain plan + edit cycle (if not)

## Usage

```
/regulatory-spec [regulation-name or feature description]
```

Examples:

- `/regulatory-spec Cabinet Resolution 200/2026 new VASP licensing regime`
- `/regulatory-spec MoE Circular 03/2026 quarterly DPMS narrative report`
- `/regulatory-spec FATF Rec 16 wire transfer travel rule for AED 3,500+`
- `/regulatory-spec EOCN bulk freeze API integration`

## The Five-Phase Chain

This skill enforces five phases. Each phase has a written artifact stored under
`.compliance-specs/<feature-slug>/`. Auditors can replay the chain from any
phase forward.

### Phase 1: Regulation (`regulation.md`)

**Goal:** capture the source of truth in plain language.

Required fields:

- **Regulation name** (full title, e.g. "Cabinet Resolution 200/2026")
- **Issuing authority** (MoE, EOCN, CBUAE, FATF, LBMA, etc.)
- **Effective date** (dd/mm/yyyy — UAE format per CLAUDE.md)
- **Implementation deadline** (typically 30 days for MoE circulars)
- **Article / section references** (exact citations, copy-paste verbatim)
- **In-scope obligations** (what we MUST do)
- **Out-of-scope** (what other regulations cover, so we don't double-implement)
- **Penalty range** (link to Cabinet Res 71/2024 administrative penalties)

Output a single `regulation.md` with these sections, all populated. **No
guessing.** If a field is unknown, mark it `TBD — confirm with CO` and stop.

### Phase 2: Requirements (`requirements.md`)

**Goal:** turn the regulation into testable requirements.

Required structure (one block per requirement):

```
### REQ-<id>: <short name>
- **Source:** <regulation citation, exact article>
- **User story:** As a <role>, I need <capability>, so that <regulatory outcome>.
- **Acceptance criteria:**
  - GIVEN <state> WHEN <action> THEN <observable outcome>
  - (one or more)
- **Failure mode:** what happens if this requirement is violated (penalty,
  filing breach, sanctions exposure)
- **Four-eyes required?** yes / no
- **Tip-off risk?** yes / no  (if yes, never expose to subject — FDL Art.29)
```

Number requirements `REQ-<feature-slug>-001`, `-002`, etc. Every requirement
**must** trace to a specific article. Untraceable requirements are rejected.

### Phase 3: Design (`design.md`)

**Goal:** map requirements to the existing architecture without inventing new
patterns where existing ones fit.

Required sections:

- **Constants impact:** which entries in `src/domain/constants.ts` are added or
  changed? (Reminder: every regulatory value lives there. Bump
  `REGULATORY_CONSTANTS_VERSION`.)
- **Service impact:** which `src/services/*.ts` modules are touched?
- **Agent / orchestration impact:** new agents, new orchestration steps, new
  handoffs? Reference `src/agents/orchestration/` and the integrated frameworks
  table in CLAUDE.md.
- **Filing impact:** does this introduce a new goAML XML schema variant? If
  yes, validate via `src/utils/goamlValidator.ts` — never hand-write XML.
- **Deadline impact:** all date math must use `src/utils/businessDays.ts`. If
  this is a 24-hour clock-time deadline (e.g. EOCN freeze under Cabinet Res
  74/2020 Art.4-7), use `checkEOCNDeadline()`, not business days.
- **UI / MLRO surface:** what does the MLRO see? Confirm no tip-off.
- **Audit trail:** every action timestamped + user + action (CLAUDE.md
  Coding Rule 3).
- **Blast radius:** run `get_impact_radius_tool` against the most-affected file
  and paste the output.
- **Open questions:** any decisions that need CO sign-off before Phase 4.

### Phase 4: Tasks (`tasks.md`)

**Goal:** atomic, agent-friendly task list with explicit ordering.

Each task has:

```
### TASK-<id>: <verb-phrase>
- **Implements:** REQ-<...>, REQ-<...>
- **Files touched:** <list>
- **Depends on:** TASK-<...> (or "none")
- **Test added:** <path to new/modified test>
- **Estimated risk:** low / medium / high (per detect_changes_tool output)
- **Executor model:** Sonnet (default) / Opus (only if escalation trigger fires)
```

Order tasks so that **constants come first**, then services, then orchestration,
then UI, then docs. Tests for each task are added in the same task — never
deferred to a "tests" task at the end.

### Phase 5: Evidence (`evidence.md`)

**Goal:** prove the spec was implemented faithfully. Filled in **after** code
lands.

Required sections:

- **Commits:** SHA + one-line summary per commit, all citing the Article per
  CLAUDE.md §8.
- **Test runs:** `vitest run` output for the new tests, paste the green run.
- **Constants bump:** before / after value of
  `REGULATORY_CONSTANTS_VERSION`.
- **Graph rebuild:** confirmation that `build_or_update_graph_tool` was run
  after the last code change.
- **CO approval:** signature line + date. Required for high-risk tasks.
- **Audit log entry:** copy of the audit-trail row for the change.
- **Effective date confirmation:** evidence the change is live in production
  before the regulatory deadline.

## Instructions

### Step 1: Initialise the spec folder

Create `.compliance-specs/<feature-slug>/` with empty stubs for the five
artifacts. The slug must match the regulation (e.g. `cabres-200-2026-vasp`).

### Step 2: Run Phase 1 (Regulation)

Populate `regulation.md`. Do not advance until every required field is filled
or marked `TBD`.

### Step 3: Run Phase 2 (Requirements)

Convert obligations into REQ blocks. Every REQ must cite an Article. Stop and
ask the CO if any obligation is ambiguous — never invent a requirement.

### Step 4: Run Phase 3 (Design)

Use `code-review-graph` first per CLAUDE.md "Token-Efficient Workflow":

1. `get_minimal_context_tool(task="design <feature>")`
2. `query_graph_tool` for any function the design touches
3. `get_impact_radius_tool` on the most-affected file
4. Only **then** read source files, with `offset` + `limit`

Output `design.md`. Pause for CO review **before** Phase 4.

### Step 5: Run Phase 4 (Tasks)

Decompose into atomic tasks. Apply CLAUDE.md §1 model routing: Sonnet by
default, Opus advisor when one of the six escalation triggers fires.

### Step 6: Implement (Tasks → Code)

Execute tasks in order. After each task:

- Run `vitest run` for the touched test file
- Run `tsc --noEmit` for type safety
- If `tests/constants.test.ts` is touched, follow the
  "When modifying risk scoring logic" decision tree in CLAUDE.md

Use the four-eyes pattern for any task tagged `high` risk.

### Step 7: Run Phase 5 (Evidence)

Fill `evidence.md` with commit SHAs, test runs, and CO approval. This is the
artifact the auditor opens first.

### Step 8: Rebuild the graph

Run `build_or_update_graph_tool` so subsequent queries see the new code.

### Step 9: Update `/traceability`

Add an entry to the regulatory traceability matrix mapping the new Article →
spec folder → code paths → test paths → evidence file.

## Output

```
## Regulatory Spec Report

### Feature
- Slug: <feature-slug>
- Regulation: <full citation>
- Effective: dd/mm/yyyy
- Implementation deadline: dd/mm/yyyy

### Phase Status
| Phase | Artifact | Status |
|-------|----------|--------|
| 1. Regulation | regulation.md | Complete |
| 2. Requirements | requirements.md | Complete (N reqs) |
| 3. Design | design.md | Awaiting CO review |
| 4. Tasks | tasks.md | Pending Phase 3 sign-off |
| 5. Evidence | evidence.md | Pending implementation |

### Blast Radius (from get_impact_radius_tool)
<paste summary>

### Open Questions for CO
1. <question> — needed before Phase 4 starts
2. ...

### Next Action
<single concrete next step>
```

## Composition with other skills

- `/regulatory-update` — for constant-only bumps. Use **instead of** this skill
  when nothing structural changes.
- `/traceability` — runs **after** Phase 5 to register the spec in the master
  matrix.
- `/audit-pack` — pulls `evidence.md` directly into inspection bundles.
- `/agent-orchestrate` — when Phase 4 produces tasks complex enough to need a
  PEER-pattern multi-agent workflow.
- `/deploy-check` — gate before the implementation deadline.

## Compliance carve-outs

Per CLAUDE.md "Compliance Carve-Outs", these phases must remain **verbose and
fully cited** even when token-efficient output rules apply elsewhere:

- All `regulation.md` content (verbatim citations, no compression)
- All REQ blocks (full GIVEN/WHEN/THEN, no shorthand)
- The MLRO-facing rationale in `evidence.md`
- Any narrative drafted for STR/SAR/CTR/DPMSR/CNMR

Compress the *how*, never the *what* or the *why*.
