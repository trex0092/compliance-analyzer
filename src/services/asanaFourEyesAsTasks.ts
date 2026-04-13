/**
 * Asana Four-Eyes as Tasks — F5.
 *
 * Represent the FDL Art.20-21 four-eyes principle as Asana tasks:
 *
 *     parent task (decision)
 *       └── subtask 1 — primary review (assigned to MLRO A)
 *       └── subtask 2 — secondary review (assigned to MLRO B)
 *
 * The parent task closes ONLY when:
 *   - Both subtasks are completed.
 *   - The two completing assignees are different.
 *   - Both completion timestamps are recorded in the audit chain.
 *
 * Pure compute. The orchestrator translates the result into the
 * sequence of Asana create-task + create-subtask calls.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO duty of care, four-eyes)
 *   Cabinet Res 134/2025 Art.14 (EDD senior management approval)
 *   Cabinet Res 74/2020 Art.4-7 (freeze confirmation)
 *   FATF Rec 26 (internal controls)
 */

export type FourEyesDecisionType =
  | 'sanctions_freeze'
  | 'str_filing'
  | 'sar_filing'
  | 'cnmr_filing'
  | 'edd_escalation'
  | 'pep_approval'
  | 'high_value_transaction'
  | 'cdd_override'
  | 'false_positive_dismiss'
  | 'account_termination';

export type ReviewerRole = 'mlro' | 'senior_mlro' | 'co' | 'analyst';

export interface FourEyesTaskInputs {
  decisionId: string;
  decisionType: FourEyesDecisionType;
  /** Plain-English headline of the decision. */
  title: string;
  /** Optional case-folder reference id (Asana task gid for the parent). */
  parentTaskGid?: string;
  /** Suggested primary reviewer role. */
  primaryRole?: ReviewerRole;
  /** Suggested secondary reviewer role. */
  secondaryRole?: ReviewerRole;
  /** ISO timestamp the decision opened. */
  openedAtIso: string;
  /** Hard SLA in hours (the orchestrator's SLA enforcer overrides if set). */
  slaHours?: number;
  /** Markdown description shared by both subtasks. */
  notes?: string;
}

export interface FourEyesTaskPayload {
  /** Stable id within the payload graph — used to express ordering. */
  id: string;
  name: string;
  notes: string;
  assigneeRole: ReviewerRole;
  /** ISO timestamp Asana should set as `due_at`. */
  dueAtIso: string;
  /** True for the parent task. */
  isParent: boolean;
  /** Parent task id (only set on subtasks). */
  parentId?: string;
}

export interface FourEyesPlan {
  decisionId: string;
  decisionType: FourEyesDecisionType;
  parent: FourEyesTaskPayload;
  primary: FourEyesTaskPayload;
  secondary: FourEyesTaskPayload;
}

const DEFAULT_SLA_HOURS: Record<FourEyesDecisionType, number> = {
  sanctions_freeze: 24,
  str_filing: 240, // 10 business days
  sar_filing: 240,
  cnmr_filing: 120, // 5 business days
  edd_escalation: 72,
  pep_approval: 72,
  high_value_transaction: 8,
  cdd_override: 24,
  false_positive_dismiss: 48,
  account_termination: 48,
};

function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 60 * 60 * 1000).toISOString();
}

/**
 * Produce the parent + 2 subtask payload for a four-eyes decision.
 * The orchestrator persists `parent` first, gets back its Asana gid,
 * then persists `primary` and `secondary` with `parent: <gid>`.
 */
export function buildFourEyesPlan(input: FourEyesTaskInputs): FourEyesPlan {
  const slaHours = input.slaHours ?? DEFAULT_SLA_HOURS[input.decisionType];
  const dueAtIso = addHours(input.openedAtIso, slaHours);
  const notes = input.notes ?? `Four-eyes review for decision ${input.decisionId}.`;

  const parent: FourEyesTaskPayload = {
    id: 'parent',
    name: `[FOUR-EYES] ${input.title}`,
    notes:
      notes +
      `\n\nThis parent task closes only when BOTH subtasks complete and the two completing assignees are different (FDL Art.20-21).`,
    assigneeRole: 'mlro',
    dueAtIso,
    isParent: true,
  };

  const primary: FourEyesTaskPayload = {
    id: 'primary',
    name: 'Primary review',
    notes:
      notes +
      `\n\nFirst independent review. The completer must NOT be the same authenticated user as the secondary reviewer.`,
    assigneeRole: input.primaryRole ?? 'mlro',
    dueAtIso,
    isParent: false,
    parentId: 'parent',
  };

  const secondary: FourEyesTaskPayload = {
    id: 'secondary',
    name: 'Secondary review',
    notes:
      notes +
      `\n\nSecond independent review. Must be a DIFFERENT authenticated user than the primary reviewer.`,
    assigneeRole: input.secondaryRole ?? 'senior_mlro',
    dueAtIso,
    isParent: false,
    parentId: 'parent',
  };

  return {
    decisionId: input.decisionId,
    decisionType: input.decisionType,
    parent,
    primary,
    secondary,
  };
}

/**
 * Validate that a completed four-eyes plan satisfies the
 * "two distinct authenticated users" rule. Returns null on success
 * or a string error message on violation. Pure check — does not
 * mutate the plan or talk to Asana.
 */
export function validateFourEyesCompletion(input: {
  primaryUserId: string;
  secondaryUserId: string;
  primaryCompletedAtIso?: string;
  secondaryCompletedAtIso?: string;
}): string | null {
  if (!input.primaryUserId || !input.secondaryUserId) {
    return 'Both reviewers must be authenticated.';
  }
  if (input.primaryUserId === input.secondaryUserId) {
    return `Four-eyes violation: ${input.primaryUserId} cannot complete both reviews.`;
  }
  if (!input.primaryCompletedAtIso || !input.secondaryCompletedAtIso) {
    return 'Both subtasks must be marked complete before the parent can close.';
  }
  return null;
}
