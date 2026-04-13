/**
 * Asana Bulk Operations — close N / reassign N / tag N.
 *
 * Rate-limited, retry-aware wrappers around asanaClient so the MLRO
 * can triage a backlog in one action instead of clicking through
 * tasks one at a time.
 *
 * Three operations:
 *   - closeAsanaTasks(gids)        — mark N tasks complete
 *   - reassignAsanaTasks(gids, to) — reassign N tasks to a user GID
 *   - tagAsanaTasks(gids, notes)   — append a note to N tasks
 *
 * Pure planner (buildBulkPlan) + dispatcher pair so unit tests can
 * exercise the ordering, batching, and retry logic without touching
 * fetch.
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (auditable internal review —
 *     bulk actions are logged individually so the audit chain still
 *     has one entry per task)
 *   - FDL No.10/2025 Art.24 (10yr retention — no task is silently
 *     deleted, only closed or re-annotated)
 */

import { asanaRequestWithRetry, isAsanaConfigured, updateAsanaTask } from './asanaClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BulkOperationResult {
  gid: string;
  ok: boolean;
  error?: string;
}

export interface BulkOperationSummary {
  total: number;
  succeeded: number;
  failed: number;
  results: BulkOperationResult[];
  /** Duration in ms for the entire batch. */
  durationMs: number;
  /** Abort reason if the whole batch bailed out (e.g. "Asana not configured"). */
  aborted?: string;
}

export interface BulkCloseOptions {
  /** Max concurrent requests. Default 1 — respect the adaptive rate
   * limiter in asanaClient. */
  concurrency?: number;
  /** Stop after this many consecutive failures. Default 5. */
  consecutiveFailureLimit?: number;
}

// ---------------------------------------------------------------------------
// Pure planner — drives the tests
// ---------------------------------------------------------------------------

export interface BulkPlan {
  total: number;
  deduped: string[];
  skipped: string[];
}

/**
 * Deduplicate a list of task GIDs and drop empty / whitespace
 * entries. Returns the pruned list plus the list of skipped inputs
 * so the caller can report which entries were ignored.
 */
export function buildBulkPlan(taskGids: readonly string[]): BulkPlan {
  const seen = new Set<string>();
  const deduped: string[] = [];
  const skipped: string[] = [];
  for (const raw of taskGids) {
    const trimmed = raw?.trim();
    if (!trimmed) {
      skipped.push(raw);
      continue;
    }
    if (seen.has(trimmed)) {
      skipped.push(trimmed);
      continue;
    }
    seen.add(trimmed);
    deduped.push(trimmed);
  }
  return { total: taskGids.length, deduped, skipped };
}

// ---------------------------------------------------------------------------
// Dispatchers
// ---------------------------------------------------------------------------

async function runBatch(
  items: readonly string[],
  op: (gid: string) => Promise<{ ok: boolean; error?: string }>,
  options: BulkCloseOptions = {}
): Promise<BulkOperationSummary> {
  const startedAt = Date.now();
  const consecutiveLimit = options.consecutiveFailureLimit ?? 5;
  const results: BulkOperationResult[] = [];
  let succeeded = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  let aborted: string | undefined;

  for (const gid of items) {
    const outcome = await op(gid);
    const result: BulkOperationResult = {
      gid,
      ok: outcome.ok,
      error: outcome.error,
    };
    results.push(result);
    if (outcome.ok) {
      succeeded++;
      consecutiveFailures = 0;
    } else {
      failed++;
      consecutiveFailures++;
      if (consecutiveFailures >= consecutiveLimit) {
        aborted = `Aborted after ${consecutiveFailures} consecutive failures — check Asana connectivity or credentials`;
        break;
      }
    }
  }

  return {
    total: items.length,
    succeeded,
    failed,
    results,
    durationMs: Date.now() - startedAt,
    aborted,
  };
}

/**
 * Bulk close — mark every task complete. Respects the adaptive rate
 * limiter in asanaClient. Stops early after consecutive failures so
 * we don't hammer a dead endpoint.
 */
export async function closeAsanaTasks(
  taskGids: readonly string[],
  options: BulkCloseOptions = {}
): Promise<BulkOperationSummary> {
  if (!isAsanaConfigured()) {
    return {
      total: taskGids.length,
      succeeded: 0,
      failed: 0,
      results: [],
      durationMs: 0,
      aborted: 'Asana not configured',
    };
  }
  const plan = buildBulkPlan(taskGids);
  return runBatch(plan.deduped, (gid) => updateAsanaTask(gid, { completed: true }), options);
}

/**
 * Bulk reassign — set a new assignee on every task.
 */
export async function reassignAsanaTasks(
  taskGids: readonly string[],
  newAssigneeGid: string,
  options: BulkCloseOptions = {}
): Promise<BulkOperationSummary> {
  if (!isAsanaConfigured()) {
    return {
      total: taskGids.length,
      succeeded: 0,
      failed: 0,
      results: [],
      durationMs: 0,
      aborted: 'Asana not configured',
    };
  }
  if (!newAssigneeGid || newAssigneeGid.trim().length === 0) {
    return {
      total: taskGids.length,
      succeeded: 0,
      failed: 0,
      results: [],
      durationMs: 0,
      aborted: 'reassignAsanaTasks: newAssigneeGid is required',
    };
  }
  const plan = buildBulkPlan(taskGids);
  return runBatch(
    plan.deduped,
    async (gid) => {
      const result = await asanaRequestWithRetry(`/tasks/${encodeURIComponent(gid)}`, {
        method: 'PUT',
        body: JSON.stringify({ data: { assignee: newAssigneeGid } }),
      });
      return { ok: result.ok, error: result.error };
    },
    options
  );
}

/**
 * Bulk annotate — append a note block to every task. Used for mass
 * regulatory updates ("reviewed under Cabinet Res 156/2025 Art.7 on
 * 2026-04-13 by MLRO — no further action").
 */
export async function annotateAsanaTasks(
  taskGids: readonly string[],
  annotation: string,
  options: BulkCloseOptions = {}
): Promise<BulkOperationSummary> {
  if (!isAsanaConfigured()) {
    return {
      total: taskGids.length,
      succeeded: 0,
      failed: 0,
      results: [],
      durationMs: 0,
      aborted: 'Asana not configured',
    };
  }
  if (!annotation || annotation.trim().length === 0) {
    return {
      total: taskGids.length,
      succeeded: 0,
      failed: 0,
      results: [],
      durationMs: 0,
      aborted: 'annotateAsanaTasks: annotation text is required',
    };
  }
  const plan = buildBulkPlan(taskGids);
  return runBatch(
    plan.deduped,
    async (gid) => {
      const result = await asanaRequestWithRetry(`/tasks/${encodeURIComponent(gid)}/stories`, {
        method: 'POST',
        body: JSON.stringify({ data: { text: annotation } }),
      });
      return { ok: result.ok, error: result.error };
    },
    options
  );
}
