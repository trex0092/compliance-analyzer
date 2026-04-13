/**
 * Four-Eyes Completion Detector — Tier C1.
 *
 * Watches subtask-completion webhook events and closes the
 * parent STR lifecycle task when all required four-eyes
 * subtasks are done. Server-side backup for Asana's native
 * "all subtasks complete → parent complete" rule — we can't
 * guarantee every customer project has that rule configured.
 *
 * Pure plan builder + async applier. The builder takes a list
 * of subtask completions + a subtask registry; it returns the
 * set of parent gids that should be auto-closed.
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (four-eyes internal review)
 *   - FDL No.10/2025 Art.26-27 (STR lifecycle closure discipline)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubtaskRegistryEntry {
  parentGid: string;
  stage: string;
  subtaskGid: string;
  required: boolean;
}

export interface CompletionEvent {
  subtaskGid: string;
  completed: boolean;
  completedAtIso: string;
}

export interface CompletionPlan {
  /** Parent task GIDs that should be closed. */
  parentsToClose: string[];
  /** Parent GIDs with pending required subtasks. */
  parentsPending: Array<{
    parentGid: string;
    pendingStages: string[];
  }>;
}

// ---------------------------------------------------------------------------
// Pure planner
// ---------------------------------------------------------------------------

/**
 * Walk the registry + completion events and decide which
 * parents are ready to close. A parent closes when every
 * `required: true` subtask under it is marked complete.
 */
export function buildCompletionPlan(
  registry: readonly SubtaskRegistryEntry[],
  completions: readonly CompletionEvent[]
): CompletionPlan {
  const completedSet = new Set(completions.filter((c) => c.completed).map((c) => c.subtaskGid));
  const byParent = new Map<string, SubtaskRegistryEntry[]>();
  for (const entry of registry) {
    const list = byParent.get(entry.parentGid) ?? [];
    list.push(entry);
    byParent.set(entry.parentGid, list);
  }

  const parentsToClose: string[] = [];
  const parentsPending: Array<{ parentGid: string; pendingStages: string[] }> = [];

  for (const [parentGid, subtasks] of byParent) {
    const required = subtasks.filter((s) => s.required);
    const pendingStages = required
      .filter((s) => !completedSet.has(s.subtaskGid))
      .map((s) => s.stage);
    if (pendingStages.length === 0 && required.length > 0) {
      parentsToClose.push(parentGid);
    } else if (pendingStages.length > 0) {
      parentsPending.push({ parentGid, pendingStages });
    }
  }

  return { parentsToClose, parentsPending };
}
