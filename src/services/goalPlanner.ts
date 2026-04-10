/**
 * Goal-Conditioned Backward Planner.
 *
 * Given a compliance GOAL (e.g. "file STR for case X", "close case Y",
 * "freeze account Z within 24h") this module computes an ordered plan
 * of ACTIONS that transforms the current state into the goal state.
 *
 * Algorithm: STRIPS-style backward chaining.
 *
 *   1. Each Action has preconditions (state predicates that must hold)
 *      and effects (predicates added / removed).
 *   2. Starting from the goal, the planner recursively finds actions
 *      whose effects satisfy unmet goals.
 *   3. Action preconditions become new sub-goals.
 *   4. The search is depth-limited + cycle-detected.
 *
 * The plan is ordered to satisfy preconditions before dependent steps,
 * and every action carries a regulatory citation — so the final plan
 * is both executable and defensible.
 *
 * Example goal: "state = { strFiled, caseClosed }"
 * Example plan:
 *   1. screen_entity           (pre: ∅, eff: entityScreened)
 *   2. collect_evidence         (pre: entityScreened, eff: evidenceCollected)
 *   3. draft_str_narrative      (pre: evidenceCollected, eff: narrativeDrafted)
 *   4. approve_str              (pre: narrativeDrafted, eff: strApproved)
 *   5. submit_goaml_xml         (pre: strApproved, eff: strFiled)
 *   6. close_case               (pre: strFiled, eff: caseClosed)
 *
 * Regulatory basis:
 *   - FDL Art.20 (CO must document decision pathway)
 *   - Cabinet Res 74/2020 (freeze deadline planning)
 *   - EOCN STR submission workflow
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Predicate = string;

export interface PlanAction {
  name: string;
  description: string;
  preconditions: readonly Predicate[];
  addEffects: readonly Predicate[];
  deleteEffects?: readonly Predicate[];
  regulatoryRef?: string;
  /** Human-time cost in hours — used for shortest-time plan selection. */
  estimatedHours?: number;
}

export interface PlanningProblem {
  initialState: ReadonlySet<Predicate>;
  goal: readonly Predicate[];
  actions: readonly PlanAction[];
  maxDepth?: number;
}

export interface Plan {
  steps: PlanAction[];
  totalEstimatedHours: number;
  satisfiedGoal: boolean;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Backward chaining planner
// ---------------------------------------------------------------------------

export function plan(problem: PlanningProblem): Plan {
  const maxDepth = problem.maxDepth ?? 20;
  const stepsInReverse: PlanAction[] = [];
  const satisfied = new Set<Predicate>(problem.initialState);
  const tried = new Set<string>();
  const notes: string[] = [];

  const goalStack: Predicate[] = [...problem.goal];

  while (goalStack.length > 0) {
    if (stepsInReverse.length >= maxDepth) {
      notes.push(`max depth ${maxDepth} reached — plan may be incomplete`);
      break;
    }
    const current = goalStack.pop()!;
    if (satisfied.has(current)) continue;

    const candidates = problem.actions.filter(
      (a) => a.addEffects.includes(current) && !tried.has(a.name),
    );
    if (candidates.length === 0) {
      notes.push(`no action achieves ${current} — goal unreachable`);
      return {
        steps: [],
        totalEstimatedHours: 0,
        satisfiedGoal: false,
        notes,
      };
    }

    // Prefer actions whose preconditions are already satisfied.
    candidates.sort((a, b) => {
      const ap = a.preconditions.filter((p) => !satisfied.has(p)).length;
      const bp = b.preconditions.filter((p) => !satisfied.has(p)).length;
      if (ap !== bp) return ap - bp;
      return (a.estimatedHours ?? 0) - (b.estimatedHours ?? 0);
    });

    const chosen = candidates[0];
    tried.add(chosen.name);
    stepsInReverse.push(chosen);
    for (const eff of chosen.addEffects) satisfied.add(eff);
    for (const eff of chosen.deleteEffects ?? []) satisfied.delete(eff);
    for (const pre of chosen.preconditions) {
      if (!satisfied.has(pre)) goalStack.push(pre);
    }
  }

  // Reverse to get topological order.
  const steps = orderPlan(stepsInReverse.reverse(), problem.initialState);
  const totalHours = steps.reduce((s, a) => s + (a.estimatedHours ?? 0), 0);
  const satisfiedGoal = problem.goal.every((g) =>
    steps.some((s) => s.addEffects.includes(g)) || problem.initialState.has(g),
  );

  return {
    steps,
    totalEstimatedHours: round2(totalHours),
    satisfiedGoal,
    notes,
  };
}

function orderPlan(
  actions: readonly PlanAction[],
  initial: ReadonlySet<Predicate>,
): PlanAction[] {
  // Topological ordering by precondition dependency.
  const out: PlanAction[] = [];
  const satisfied = new Set<Predicate>(initial);
  const remaining = [...actions];
  while (remaining.length > 0) {
    const idx = remaining.findIndex((a) =>
      a.preconditions.every((p) => satisfied.has(p)),
    );
    if (idx < 0) {
      // Cycle or unsatisfiable — append the remaining in current order.
      out.push(...remaining);
      break;
    }
    const [next] = remaining.splice(idx, 1);
    out.push(next);
    for (const eff of next.addEffects) satisfied.add(eff);
    for (const eff of next.deleteEffects ?? []) satisfied.delete(eff);
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Pre-baked compliance action library
// ---------------------------------------------------------------------------

export const STR_FILING_ACTIONS: readonly PlanAction[] = [
  {
    name: 'screen_entity',
    description: 'Run sanctions + PEP + adverse-media screening',
    preconditions: [],
    addEffects: ['entityScreened'],
    regulatoryRef: 'FDL Art.22; FATF Rec 6',
    estimatedHours: 0.25,
  },
  {
    name: 'collect_evidence',
    description: 'Gather transactions, documents, CCTV, interviews',
    preconditions: ['entityScreened'],
    addEffects: ['evidenceCollected'],
    regulatoryRef: 'FDL Art.19',
    estimatedHours: 4,
  },
  {
    name: 'identify_red_flags',
    description: 'Map evidence to typology indicators',
    preconditions: ['evidenceCollected'],
    addEffects: ['redFlagsIdentified'],
    regulatoryRef: 'FATF DPMS Typologies 2022',
    estimatedHours: 1,
  },
  {
    name: 'draft_str_narrative',
    description: 'Compose EOCN-structured narrative',
    preconditions: ['redFlagsIdentified'],
    addEffects: ['narrativeDrafted'],
    regulatoryRef: 'FDL Art.26; EOCN STR Guidelines v3',
    estimatedHours: 2,
  },
  {
    name: 'approve_str',
    description: 'CO + MLRO four-eyes approval',
    preconditions: ['narrativeDrafted'],
    addEffects: ['strApproved'],
    regulatoryRef: 'FDL Art.20; Cabinet Res 134/2025 Art.19',
    estimatedHours: 1,
  },
  {
    name: 'generate_goaml_xml',
    description: 'Emit UAE FIU goAML XML',
    preconditions: ['strApproved'],
    addEffects: ['goamlGenerated'],
    regulatoryRef: 'EOCN goAML Technical Guide v2',
    estimatedHours: 0.5,
  },
  {
    name: 'submit_to_fiu',
    description: 'Upload to goAML portal',
    preconditions: ['goamlGenerated'],
    addEffects: ['strFiled'],
    regulatoryRef: 'FDL Art.26-27',
    estimatedHours: 0.25,
  },
  {
    name: 'update_case_status',
    description: 'Mark case as STR-filed',
    preconditions: ['strFiled'],
    addEffects: ['caseClosed'],
    regulatoryRef: 'FDL Art.24',
    estimatedHours: 0.1,
  },
];

export const FREEZE_ACTIONS: readonly PlanAction[] = [
  {
    name: 'verify_sanctions_match',
    description: 'Confirm the sanctions match is genuine',
    preconditions: [],
    addEffects: ['sanctionsMatchVerified'],
    regulatoryRef: 'FDL Art.22',
    estimatedHours: 1,
  },
  {
    name: 'initiate_freeze',
    description: 'Apply freeze to all accounts and holdings',
    preconditions: ['sanctionsMatchVerified'],
    addEffects: ['freezeApplied'],
    regulatoryRef: 'Cabinet Res 74/2020 Art.4',
    estimatedHours: 2,
  },
  {
    name: 'notify_eocn',
    description: 'Report freeze to EOCN within 24 hours',
    preconditions: ['freezeApplied'],
    addEffects: ['eocnNotified'],
    regulatoryRef: 'Cabinet Res 74/2020 Art.5',
    estimatedHours: 1,
  },
  {
    name: 'file_cnmr',
    description: 'Submit CNMR within 5 business days',
    preconditions: ['eocnNotified'],
    addEffects: ['cnmrFiled'],
    regulatoryRef: 'Cabinet Res 74/2020 Art.7',
    estimatedHours: 2,
  },
];
