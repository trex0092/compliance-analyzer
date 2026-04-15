# ASANA WORKFLOW — Four-Eyes Approval

Cabinet Res 134/2025 Art.12-14 requires two independent approvers
for high-risk decisions. Self-approval and same-party approval are
prohibited under FATF Rec 1 and the EU AI Act Art.14 human-oversight
requirement.

We materialise the four-eyes contract as **paired Asana tasks**.
Approver B's task lists Approver A's task as a dependency. Asana
itself enforces the dependency: B cannot complete until A is done.

This is how we make four-eyes visible, auditable, and impossible to
bypass without a regulatory citation.

---

## File map

| File | Role |
|---|---|
| `src/services/asana/fourEyesSubtaskCreator.ts` | Creates paired tasks |
| `src/services/asanaFourEyesAsTasks.ts` | High-level helper |
| `src/services/fourEyes.ts` | Brain-side four-eyes contract enforcer |

---

## Triggers — when four-eyes fires

1. **Sanctions match confirmation** (score ≥ 0.5) → CO + MLRO pair
2. **STR / SAR draft narrative** → MLRO + CO pair
3. **Asset freeze execution** → CO + MLRO + senior management triple
4. **CDD level upgrade to EDD** → MLRO + CO pair
5. **Break-glass override** → originator + different CO pair
6. **Clamp suggestion accept** → MLRO + CO pair
7. **Tenant onboarding completion** → CO + Board pair
8. **Quarterly DPMSR submission** → MLRO + CO pair

This list lives in code at
`src/services/fourEyes.ts:FOUR_EYES_TRIGGER_LIST`.

---

## Pair task shape

For each four-eyes trigger, the orchestrator creates **two** Asana
tasks:

### Task A (Approver A — the proposer)

- Title: `[A] <verdict> — <case-id>`
- Section: `Pending Approval (Step 1 of 2)`
- Assignee: the user who proposed the action
- Custom field `Four-Eyes Pair`: GID of Task B
- Custom field `Four-Eyes Role`: `approver-a`
- Description includes the verdict, evidence, and regulatory citation

### Task B (Approver B — the second pair of eyes)

- Title: `[B] <verdict> — <case-id>`
- Section: `Pending Approval (Step 2 of 2)`
- Assignee: a **different** user with the same role
- Dependency: Task A (Asana enforces this)
- Custom field `Four-Eyes Pair`: GID of Task A
- Custom field `Four-Eyes Role`: `approver-b`
- Description: same as Task A + a note that B may not complete until A
  is complete

---

## Assignee selection — exclusion rule

The B task assignee is selected from the user pool with this rule:

```typescript
const eligible = usersWithRole(requiredRole)
  .filter(u => u.gid !== proposerGid)         // not the proposer
  .filter(u => u.gid !== ctx.authorGid)       // not the comment author
  .filter(u => u.active === true)
  .filter(u => !u.outOfOffice);

const assigneeB = roundRobin(eligible, caseId);
```

The round-robin is keyed by `caseId` so the same case always lands
on the same B user — operators see continuity across reviews of the
same case.

If the eligible pool is empty, the orchestrator escalates to the CO
pool. If THAT is empty, it escalates to the Board pool. If THAT is
empty, the case is logged as `four-eyes-blocked` and an incident
record is created.

---

## Self-approval rejection

The `fourEyesSubtaskCreator` enforces self-approval rejection at
multiple layers:

1. **At task creation** — assignee B is filtered to exclude proposer
2. **At task assignment change** — webhook `customFieldChangedHandler`
   detects if the B task is reassigned to the proposer and rejects
3. **At task completion** — completion handler verifies the completer
   is the assignee, not the proposer

Defence in depth — even if Asana rules are bypassed, the brain-side
audit refuses to record the approval.

---

## Lifecycle

```
trigger (e.g., sanctions match score ≥ 0.5)
        │
        ▼
fourEyesSubtaskCreator.createPair(...)
        ├── creates Task A → Pending Approval (Step 1 of 2)
        └── creates Task B → Pending Approval (Step 2 of 2), dep=A
        │
        ▼
Approver A reviews Task A
        ├── approves → Task A marked complete
        │   └── Task B becomes actionable (dependency met)
        │
        ▼
Approver B reviews Task B
        ├── approves → Task B marked complete
        │   └── Brain verdict is unlocked + applied
        │
        └── rejects → Task B marked complete with rejection note
            └── Brain verdict is rolled back + incident logged
```

---

## Custom field schema

| Field | Type | Purpose |
|---|---|---|
| `Four-Eyes Pair` | task reference | GID of the paired task |
| `Four-Eyes Role` | enum (`approver-a` / `approver-b`) | Which side of the pair |
| `Four-Eyes Trigger` | text | Citation for why four-eyes fired |
| `Four-Eyes Decision` | enum (`pending` / `approved` / `rejected`) | Final state |
| `Four-Eyes Decision At` | date | When B completed their task |

Schema migration handled by `asanaSchemaMigrator.ts` — safe to call
on every deploy.

---

## Audit trail

Every four-eyes decision writes a record:

```
audit:four-eyes:<tenantId>:<caseId>:<epochMs>
{
  trigger: 'sanctions-match-confirmation',
  caseId: 'case-1',
  approverA: { gid, role, decision, decidedAt },
  approverB: { gid, role, decision, decidedAt },
  finalDecision: 'approved' | 'rejected',
  regulatoryCitation: 'Cabinet Res 134/2025 Art.12-14',
  evidenceBundleHash: '<sha3-512>',
}
```

Retention: forever (FDL Art.24).

---

## Edge cases

### Approver A is also the proposer
Caught at task creation — proposer is excluded from the eligible pool
for B but is the natural assignee for A. If the original proposer is
not in the role pool at all (e.g., a system trigger), A is assigned
to the most-recently-active user in the role pool.

### Approver B leaves the company mid-review
The exclusion list now includes inactive users. The next sync cron
detects the orphaned B task and re-assigns to the next eligible user
via `asanaSchemaMigrator.reassignOrphans()`.

### Both approvers approve on the same minute
Asana's optimistic concurrency catches the second write. The brain
side handles 409 by retrying the verdict apply with the latest state.

### Approver A approves, Approver B never reviews
The SLA enforcer catches the stale B task. Default SLA is 8 hours
for the four-eyes pair. Breach → escalation to the next level (CO
or Board).

### Three-eyes (e.g., asset freeze)
Some triggers require triple approval. The creator chains:
A (proposer) → B (CO) → C (senior management). Each task lists the
previous as a dependency. C cannot complete until B completes; B
cannot complete until A completes.

---

## What four-eyes does NOT cover

- Read-only operations (reports, screening dry-runs)
- Comment posts on existing cases
- Routine CDD reviews (only escalations)
- Telemetry queries

The principle: four-eyes gates **decisions that mutate compliance
state**. Read paths are not gated because gating them would create
operational drag without a corresponding regulatory benefit.

---

## Testing

Tests live in `tests/asana/fourEyes.test.ts`:

- Pair creation creates A + B with B depending on A
- B assignee is different from A assignee
- Self-approval rejected at all three layers
- Round-robin selection is stable per case ID
- Empty eligible pool escalates to next level
- Asana 409 on concurrent approve handled gracefully
- Three-eyes chain enforced correctly
- Audit trail entry written with both approvers
- Brain verdict rolled back on rejection
- SLA breach on stale B task escalates correctly

---

## Audit-time questions and answers

| Auditor question | Answer |
|---|---|
| "How do you prevent self-approval?" | Three layers: filter, webhook check, completion check. Plus brain-side audit refuses. |
| "Where are four-eyes decisions logged?" | `audit:four-eyes:*` blob, retention forever |
| "What if B never reviews?" | SLA enforcer escalates after 8 hours |
| "Can the CO approve their own action?" | No — exclusion list catches them |
| "Three-eyes for high-risk?" | Yes — chain A → B → C with dependencies |
| "Brain verdict applied without four-eyes?" | Impossible — four-eyes gate is at the orchestrator layer, not the runner |
