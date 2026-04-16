/**
 * Asana ↔ Brain State Reconciler — Phase 19 W-C (pure compute).
 *
 * Closes the window where an Asana task status transitions (e.g. MLRO
 * completes a four-eyes subtask) but the webhook mirroring that change
 * back into the brain's audit trail is missed or late. The sync cron
 * catches most cases, but anything that runs between crons shows up
 * as "awaiting approval" in the brain while Asana already shows done.
 *
 * This module is pure compute. Callers supply:
 *   - the current brain-side state of every open case for a tenant
 *   - the current Asana-side state of every task that maps to a case
 *
 * The reconciler compares the two snapshots and returns the set of
 * reconciliation actions that would bring the brain into agreement
 * with Asana. Callers execute the actions and write audit rows.
 *
 * Design:
 *   - Three classes of drift:
 *       1. Asana shows completed, brain shows pending → brain must
 *          be advanced. This is the most common case (completed
 *          webhook missed).
 *       2. Asana shows in-progress, brain shows completed → brain
 *          must NOT be rolled back. A completed audit trail event
 *          is legally load-bearing; rolling it back would break the
 *          chain. Instead, flag it for MLRO attention and surface
 *          in the next daily digest.
 *       3. Case exists in brain but no mapped task exists in Asana
 *          → either the dispatch was skipped or the task was
 *          deleted. Flag for MLRO attention; never silently re-
 *          dispatch (a silent re-dispatch could create duplicate
 *          four-eyes obligations).
 *   - Freshness cutoff — any drift observed for less than the
 *     cutoff window is tolerated (probably just a webhook in flight).
 *     Default 10 minutes, matching the Phase 19 spec.
 *   - Results include a machine-readable `action` tag so audit rows
 *     can be indexed and the MLRO dashboard can filter.
 *
 * Regulatory anchor:
 *   FDL No. 10 of 2025 Art.20 — MLRO visibility; brain and Asana
 *     must agree or the MLRO sees conflicting information.
 *   FDL No. 10 of 2025 Art.24 — 10-year retention of reconciliation
 *     decisions as part of the audit trail.
 *   Cabinet Resolution 134/2025 Art.12-14 — four-eyes integrity;
 *     a missed Asana-to-brain mirror of a completed four-eyes gate
 *     threatens that integrity.
 */

export type BrainCaseState = 'pending' | 'awaiting_four_eyes' | 'completed' | 'rejected';

export type AsanaTaskState = 'open' | 'in_progress' | 'completed' | 'rejected' | 'missing';

export interface BrainCase {
  caseId: string;
  tenantId: string;
  state: BrainCaseState;
  /** Last time brain state changed (ms since epoch). */
  updatedAtMs: number;
  /** The Asana task GID this case was dispatched to, if any. */
  asanaTaskGid?: string;
}

export interface AsanaTaskSnapshot {
  taskGid: string;
  /** Case id captured in the task's Asana custom field. */
  caseId: string;
  tenantId: string;
  state: AsanaTaskState;
  /** Last time Asana state changed (ms since epoch), best-effort. */
  updatedAtMs: number;
}

export type ReconcileActionKind =
  | 'advance_brain_to_completed'
  | 'advance_brain_to_rejected'
  | 'flag_for_mlro_brain_ahead_of_asana'
  | 'flag_for_mlro_task_missing'
  | 'no_op';

export interface ReconcileAction {
  kind: ReconcileActionKind;
  caseId: string;
  tenantId: string;
  asanaTaskGid?: string;
  /** Human-readable reason, suitable for the audit row narrative. */
  narrative: string;
}

export interface ReconcileOptions {
  /** Milliseconds after which drift stops being tolerated. Default 10 min. */
  toleranceMs?: number;
  /** Current wall clock. */
  nowMs: number;
}

export interface ReconcileResult {
  tenantId: string;
  actions: readonly ReconcileAction[];
  /** Cases that were already in agreement; reported for telemetry. */
  inAgreement: readonly string[];
  /** Cases where drift is fresh and tolerated; reported for telemetry. */
  tolerated: readonly string[];
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

const DEFAULT_TOLERANCE_MS = 10 * 60 * 1000;

function maxTimestamp(a: BrainCase, b?: AsanaTaskSnapshot): number {
  if (!b) return a.updatedAtMs;
  return Math.max(a.updatedAtMs, b.updatedAtMs);
}

/**
 * Compare brain-side and Asana-side snapshots for a single tenant
 * and produce the list of reconciliation actions that bring the
 * brain into agreement. Pure — does not mutate inputs.
 */
export function reconcileTenant(
  tenantId: string,
  brainCases: readonly BrainCase[],
  asanaTasks: readonly AsanaTaskSnapshot[],
  options: ReconcileOptions
): ReconcileResult {
  const toleranceMs = options.toleranceMs ?? DEFAULT_TOLERANCE_MS;
  const actions: ReconcileAction[] = [];
  const inAgreement: string[] = [];
  const tolerated: string[] = [];

  // Build a case-id → task lookup.
  const tasksByCase = new Map<string, AsanaTaskSnapshot>();
  for (const task of asanaTasks) {
    if (task.tenantId === tenantId) {
      tasksByCase.set(task.caseId, task);
    }
  }

  for (const brainCase of brainCases) {
    if (brainCase.tenantId !== tenantId) continue;

    const task = tasksByCase.get(brainCase.caseId);

    // Class 3: brain has case, Asana has no mapped task.
    if (!task || task.state === 'missing') {
      const age = options.nowMs - brainCase.updatedAtMs;
      if (age < toleranceMs) {
        tolerated.push(brainCase.caseId);
        continue;
      }
      actions.push({
        kind: 'flag_for_mlro_task_missing',
        caseId: brainCase.caseId,
        tenantId,
        asanaTaskGid: brainCase.asanaTaskGid,
        narrative: `Brain has case ${brainCase.caseId} in state "${brainCase.state}" but no mapped Asana task is visible. Either the dispatch was skipped or the task was deleted.`,
      });
      continue;
    }

    // Agreement check.
    if (statesAgree(brainCase.state, task.state)) {
      inAgreement.push(brainCase.caseId);
      continue;
    }

    const age = options.nowMs - maxTimestamp(brainCase, task);
    if (age < toleranceMs) {
      tolerated.push(brainCase.caseId);
      continue;
    }

    // Class 2: brain is ahead of Asana (should not auto-rollback).
    if (brainCaseAheadOfAsana(brainCase.state, task.state)) {
      actions.push({
        kind: 'flag_for_mlro_brain_ahead_of_asana',
        caseId: brainCase.caseId,
        tenantId,
        asanaTaskGid: task.taskGid,
        narrative: `Brain shows case ${brainCase.caseId} as "${brainCase.state}" but Asana task ${task.taskGid} is still "${task.state}". Brain-side audit entries are load-bearing and will not be rolled back automatically; MLRO review required.`,
      });
      continue;
    }

    // Class 1: Asana is ahead of brain — advance brain to match.
    if (task.state === 'completed') {
      actions.push({
        kind: 'advance_brain_to_completed',
        caseId: brainCase.caseId,
        tenantId,
        asanaTaskGid: task.taskGid,
        narrative: `Asana task ${task.taskGid} completed at ${new Date(task.updatedAtMs).toISOString()}. Advancing brain case ${brainCase.caseId} from "${brainCase.state}" to "completed" to match (FDL Art.20 visibility).`,
      });
      continue;
    }
    if (task.state === 'rejected') {
      actions.push({
        kind: 'advance_brain_to_rejected',
        caseId: brainCase.caseId,
        tenantId,
        asanaTaskGid: task.taskGid,
        narrative: `Asana task ${task.taskGid} rejected at ${new Date(task.updatedAtMs).toISOString()}. Advancing brain case ${brainCase.caseId} from "${brainCase.state}" to "rejected" to match.`,
      });
      continue;
    }

    // Catch-all: not agreement, not tolerated, not a handled class.
    // Safer to flag than to guess.
    actions.push({
      kind: 'flag_for_mlro_brain_ahead_of_asana',
      caseId: brainCase.caseId,
      tenantId,
      asanaTaskGid: task.taskGid,
      narrative: `Brain shows case ${brainCase.caseId} as "${brainCase.state}" but Asana task ${task.taskGid} is "${task.state}". Drift exceeds tolerance but the transition is not a handled class; MLRO review required.`,
    });
  }

  return { tenantId, actions, inAgreement, tolerated };
}

// ---------------------------------------------------------------------------
// State agreement rules
// ---------------------------------------------------------------------------

function statesAgree(brain: BrainCaseState, asana: AsanaTaskState): boolean {
  if (brain === 'completed' && asana === 'completed') return true;
  if (brain === 'rejected' && asana === 'rejected') return true;
  if (brain === 'awaiting_four_eyes' && (asana === 'open' || asana === 'in_progress')) {
    return true;
  }
  if (brain === 'pending' && (asana === 'open' || asana === 'in_progress')) {
    return true;
  }
  return false;
}

function brainCaseAheadOfAsana(brain: BrainCaseState, asana: AsanaTaskState): boolean {
  // Brain terminal but Asana still live → brain is ahead.
  const brainTerminal = brain === 'completed' || brain === 'rejected';
  const asanaLive = asana === 'open' || asana === 'in_progress';
  return brainTerminal && asanaLive;
}
