/**
 * Asana Tenant Bootstrap State Machine — Phase 19 W-D (pure compute).
 *
 * Tenant bootstrap is a multi-step workflow: project create, section
 * create, custom-field provisioning, webhook registration, idempotency
 * namespace seeding, registry row write. Today each step is fire-and-
 * forget. If any step fails, the operator debugs from log fragments
 * and re-runs the whole workflow, which may re-create a project or
 * re-provision a field that already exists.
 *
 * This module produces a resumable plan: given the current state of a
 * tenant's bootstrap (read from the setup-audit blob), it returns the
 * ordered list of steps that still need to run. A re-run after a
 * partial failure skips completed steps and retries only the ones
 * that are still pending.
 *
 * The module does not perform I/O. Callers read the prior-state blob,
 * pass it in, receive the plan, execute each step, and write the
 * updated state back.
 *
 * Design:
 *   - Each step has a stable name. Re-running the planner with the
 *     same prior state produces the same plan (deterministic).
 *   - A step can be in one of four states: pending, in_progress,
 *     done, failed. The planner treats in_progress conservatively —
 *     it does NOT re-run an in-flight step on a second invocation,
 *     because a concurrent run would fight over Asana state. The
 *     caller handles stale in_progress via a separate staleness
 *     check (default: 10 minutes).
 *   - failed is re-runnable. The planner includes a failed step in
 *     the next plan so a fix-forward retry can succeed.
 *   - Ordering is enforced by the static STEPS array. A step is only
 *     included in the plan if all its predecessors are done.
 *
 * Regulatory anchor:
 *   FDL No. 10 of 2025 Art.20 — MLRO visibility; a partially
 *     bootstrapped tenant means the MLRO cannot see the full queue.
 *   Cabinet Resolution 134/2025 Art.18 — MLRO arrangement
 *     notification; tenant bootstrap is where that lands, and a
 *     failed bootstrap is not a tolerable silent outcome.
 *   Cabinet Resolution 134/2025 Art.19 — internal review; the audit
 *     trail produced by this state machine is what the review reads.
 */

export type BootstrapStepName =
  | 'validate_inputs'
  | 'create_project_compliance'
  | 'create_project_workflow'
  | 'create_sections'
  | 'provision_custom_fields'
  | 'emit_custom_field_env_vars'
  | 'register_webhook'
  | 'seed_idempotency_namespace'
  | 'write_registry_row';

export type BootstrapStepState = 'pending' | 'in_progress' | 'done' | 'failed';

export interface BootstrapStepRecord {
  name: BootstrapStepName;
  state: BootstrapStepState;
  /** Millisecond timestamp of the last state transition. */
  updatedAtMs: number;
  /** Per-step output blob (project gid, section gid, webhook gid, etc.). */
  output?: Record<string, unknown>;
  /** Populated when state === 'failed'. */
  error?: string;
}

export interface BootstrapState {
  tenantId: string;
  startedAtMs: number;
  /** One record per step that has started. Missing steps are pending. */
  steps: Readonly<Record<string, BootstrapStepRecord>>;
}

/**
 * Canonical ordering. A step is only considered for the next-plan
 * output if every predecessor has state === 'done'. This enforces
 * the dependency chain without the planner having to re-derive it
 * from a graph walk.
 */
export const STEPS: readonly BootstrapStepName[] = [
  'validate_inputs',
  'create_project_compliance',
  'create_project_workflow',
  'create_sections',
  'provision_custom_fields',
  'emit_custom_field_env_vars',
  'register_webhook',
  'seed_idempotency_namespace',
  'write_registry_row',
];

export interface PlanOptions {
  /**
   * Milliseconds after which an in_progress step is considered
   * stale (abandoned by a prior run) and safe to restart. Default
   * 10 minutes — long enough to absorb a slow Asana call but short
   * enough that operator re-runs aren't blocked forever.
   */
  staleInProgressMs?: number;
  /** Current wall clock; caller-supplied for deterministic testing. */
  nowMs: number;
}

export interface BootstrapPlan {
  tenantId: string;
  nextSteps: readonly BootstrapStepName[];
  alreadyDone: readonly BootstrapStepName[];
  failed: readonly BootstrapStepName[];
  /** Steps that are in_progress and not yet considered stale. */
  inProgressFresh: readonly BootstrapStepName[];
  /** True when every step is done (tenant fully provisioned). */
  complete: boolean;
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

const DEFAULT_STALE_IN_PROGRESS_MS = 10 * 60 * 1000;

/**
 * Produce the list of steps that should run next for this tenant.
 * Pure function of (state, now, options). Safe to call any number
 * of times; it does not mutate the input state.
 */
export function planBootstrap(state: BootstrapState, options: PlanOptions): BootstrapPlan {
  const staleMs = options.staleInProgressMs ?? DEFAULT_STALE_IN_PROGRESS_MS;
  const records = state.steps;

  const done: BootstrapStepName[] = [];
  const failed: BootstrapStepName[] = [];
  const inProgressFresh: BootstrapStepName[] = [];
  const next: BootstrapStepName[] = [];
  let blockedByPredecessor = false;

  for (const step of STEPS) {
    const record = records[step];

    if (!record) {
      // No record yet — this is a pending step. Schedule only if no
      // predecessor is blocking.
      if (!blockedByPredecessor) {
        next.push(step);
        // Continue the loop; subsequent steps may also be pending
        // and will be gated below.
        blockedByPredecessor = true;
      }
      continue;
    }

    if (record.state === 'done') {
      done.push(step);
      continue;
    }

    if (record.state === 'failed') {
      failed.push(step);
      // A failed step blocks its successors AND is itself a candidate
      // for the next plan — fix-forward retry.
      if (!blockedByPredecessor) {
        next.push(step);
        blockedByPredecessor = true;
      }
      continue;
    }

    if (record.state === 'in_progress') {
      const age = options.nowMs - record.updatedAtMs;
      if (age >= staleMs) {
        // Stale — treat as failed for planning purposes; the caller
        // can force-restart this step.
        if (!blockedByPredecessor) {
          next.push(step);
          blockedByPredecessor = true;
        }
      } else {
        inProgressFresh.push(step);
        blockedByPredecessor = true;
      }
      continue;
    }

    // Explicit pending state (caller can set pending instead of
    // omitting the record). Treated the same as a missing record.
    if (!blockedByPredecessor) {
      next.push(step);
      blockedByPredecessor = true;
    }
  }

  return {
    tenantId: state.tenantId,
    nextSteps: next,
    alreadyDone: done,
    failed,
    inProgressFresh,
    complete: done.length === STEPS.length,
  };
}

// ---------------------------------------------------------------------------
// State transitions (pure)
// ---------------------------------------------------------------------------

/**
 * Produce a new BootstrapState with one step's record updated.
 * Immutable — input is not modified.
 */
export function withStepState(
  state: BootstrapState,
  step: BootstrapStepName,
  patch: Partial<Omit<BootstrapStepRecord, 'name'>> & { state: BootstrapStepState },
  nowMs: number
): BootstrapState {
  const existing = state.steps[step];
  const record: BootstrapStepRecord = {
    name: step,
    state: patch.state,
    updatedAtMs: nowMs,
    output: patch.output ?? existing?.output,
    error: patch.state === 'failed' ? patch.error : undefined,
  };
  return {
    ...state,
    steps: { ...state.steps, [step]: record },
  };
}

/**
 * Convenience: build an initial state for a brand-new tenant
 * bootstrap. No steps are recorded; planBootstrap will return
 * every step as next.
 */
export function initialState(tenantId: string, nowMs: number): BootstrapState {
  return { tenantId, startedAtMs: nowMs, steps: {} };
}
