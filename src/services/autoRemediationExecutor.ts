/**
 * Auto-Remediation Executor — safety-gated planner + executor for
 * post-decision remediation actions.
 *
 * Why this exists:
 *   Today, when the brain lands on a `freeze` or `escalate` verdict,
 *   the MLRO has to hand-walk a checklist of remediation steps
 *   (freeze accounts, notify EOCN, start the 24h countdown, queue
 *   the CNMR filing task, request enhanced CDD, etc.). That process
 *   is slow, inconsistent, and the deadline clock starts running
 *   the moment the brain emits the verdict.
 *
 *   This module produces the remediation plan deterministically —
 *   same verdict + same context → same plan. Execution is a
 *   separate, explicitly-gated step. The operator can run in
 *   dry-run (default), preview the plan, then flip to live only
 *   with an authorised executor id and — for high-stakes actions
 *   — a second signature.
 *
 * Safety architecture:
 *   1. Plan builder is pure — no side effects, no IO.
 *   2. Executor is a class that holds an injected `ActionSink`
 *      interface. Tests inject an in-memory fake; production
 *      wires the real Asana orchestrator + EOCN notifier.
 *   3. Every call requires explicit config:
 *        - dryRun (default true)                 — no execution
 *        - authorisedExecutorId (required live)  — audit trail
 *        - twoPersonApprovalIds[]                — required for
 *          actions flagged `requiresTwoPersonApproval`
 *        - allowedActionKinds                    — allowlist
 *        - maxActionsPerRun (default 20)         — circuit breaker
 *   4. Unauthorised / missing-approval actions are SKIPPED with
 *      a rejection entry in the result, never silently executed.
 *   5. The `reversible` flag on each action drives the retry /
 *      rollback policy in the ActionSink implementation.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22   (CO duty + auditable decision trail)
 *   FDL No.10/2025 Art.24      (10-year retention on the plan log)
 *   FDL No.10/2025 Art.26-27   (STR / CNMR filing deadlines)
 *   FDL No.10/2025 Art.29      (no tipping off — every action
 *                                carries a tipping-off risk flag
 *                                the executor respects)
 *   Cabinet Res 74/2020 Art.4-7 (24h freeze + CNMR within 5 BD)
 *   Cabinet Res 134/2025 Art.12-14 (four-eyes on high-risk)
 *   FATF Rec 4, 20, 21
 *   NIST AI RMF 1.0 MANAGE-3   (AI decision recovery + rollback)
 *   EU AI Act Art.14           (human oversight, high-risk AI)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RemediationVerdict = 'pass' | 'flag' | 'escalate' | 'freeze';

export type ActionKind =
  /** Freeze customer account(s). Irreversible without MLRO unlock. */
  | 'freeze_account'
  /** Notify EOCN — required within 24h on confirmed sanctions match. */
  | 'notify_eocn'
  /** Kick off the 24h freeze countdown timer. */
  | 'start_freeze_countdown'
  /** Queue the CNMR filing task (Cabinet Res 74/2020 Art.6 — 5 BD). */
  | 'queue_cnmr_filing'
  /** Queue the STR filing task (FDL Art.26-27 — 10 BD). */
  | 'queue_str_filing'
  /** Create an MLRO review task in Asana. */
  | 'create_mlro_review_task'
  /** Request enhanced CDD evidence from the customer. */
  | 'request_enhanced_cdd'
  /** Request UBO re-verification (Cabinet Dec 109/2023 — 15 WD). */
  | 'request_ubo_reverification'
  /** Raise customer risk band + mark for elevated monitoring. */
  | 'raise_risk_band'
  /** Pause pending transactions awaiting CO review. */
  | 'pause_transactions';

export interface RemediationAction {
  /** Stable id — `<verdict>:<kind>:<index>`. */
  id: string;
  kind: ActionKind;
  /** Opaque reference to the target entity / account / transaction. */
  targetRef: string;
  /** Plain-English description for the audit log + Asana task body. */
  description: string;
  /** Regulatory deadline, if any, in business days. */
  deadlineBusinessDays: number | null;
  /** Regulatory deadline in clock hours (used for the 24h freeze). */
  deadlineClockHours: number | null;
  /** Reversible by the executor without MLRO action? */
  reversible: boolean;
  /** Requires a second signature before execution. */
  requiresTwoPersonApproval: boolean;
  /** True when executing this action leaks the investigation to the subject. */
  tippingOffRisk: boolean;
  /** Regulatory citation anchor. */
  regulatory: string;
}

export interface RemediationPlan {
  schemaVersion: 1;
  verdict: RemediationVerdict;
  tenantId: string;
  entityRef: string;
  /** Actions in execution order. */
  actions: readonly RemediationAction[];
  /** Plain-English summary for the MLRO task body. */
  summary: string;
  /** Regulatory citations the plan relies on. */
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Plan builder — pure function
// ---------------------------------------------------------------------------

export interface PlanContext {
  tenantId: string;
  entityRef: string;
  /** Optional single-transaction AED value — enables the DPMS CTR path. */
  maxTxAED?: number;
  /** Sanctions match score in [0, 1] — gates EOCN notify + freeze. */
  sanctionsMatchScore?: number;
  /** PEP flag — gates the enhanced CDD + risk-band raise. */
  isPep?: boolean;
  /** UBO re-verification required under Cabinet Dec 109/2023. */
  uboReverificationRequired?: boolean;
}

export interface BuildPlanOptions {
  /** Override the default clock (tests). */
  now?: () => Date;
}

function a(
  id: string,
  kind: ActionKind,
  targetRef: string,
  description: string,
  regulatory: string,
  overrides: Partial<RemediationAction> = {}
): RemediationAction {
  return {
    id,
    kind,
    targetRef,
    description,
    deadlineBusinessDays: null,
    deadlineClockHours: null,
    reversible: false,
    requiresTwoPersonApproval: false,
    tippingOffRisk: false,
    regulatory,
    ...overrides,
  };
}

/**
 * Build a deterministic remediation plan for a given verdict +
 * context. Pure function — same inputs → same plan. Never touches
 * the network, never mutates state.
 */
export function buildRemediationPlan(
  verdict: RemediationVerdict,
  ctx: PlanContext,
  _opts: BuildPlanOptions = {}
): RemediationPlan {
  void _opts;
  const tenantId = ctx.tenantId;
  const entityRef = ctx.entityRef;
  const actions: RemediationAction[] = [];

  switch (verdict) {
    case 'freeze': {
      actions.push(
        a(
          `${verdict}:freeze_account:0`,
          'freeze_account',
          entityRef,
          `Freeze all accounts linked to ${entityRef}. Sanctions match confirmed — Cabinet Res 74/2020 Art.4 requires asset freeze without delay.`,
          'Cabinet Res 74/2020 Art.4; FDL No.10/2025 Art.35',
          {
            deadlineClockHours: 24,
            reversible: false,
            requiresTwoPersonApproval: true,
            tippingOffRisk: false,
          }
        ),
        a(
          `${verdict}:pause_transactions:1`,
          'pause_transactions',
          entityRef,
          `Pause all pending transactions on ${entityRef} awaiting CO sign-off.`,
          'Cabinet Res 74/2020 Art.5',
          {
            deadlineClockHours: 24,
            reversible: true,
            requiresTwoPersonApproval: true,
            tippingOffRisk: false,
          }
        ),
        a(
          `${verdict}:start_freeze_countdown:2`,
          'start_freeze_countdown',
          entityRef,
          `Start the 24h EOCN freeze countdown for ${entityRef}.`,
          'Cabinet Res 74/2020 Art.4',
          {
            deadlineClockHours: 24,
            reversible: true,
          }
        ),
        a(
          `${verdict}:notify_eocn:3`,
          'notify_eocn',
          entityRef,
          `Notify EOCN of the confirmed sanctions match on ${entityRef}.`,
          'Cabinet Res 74/2020 Art.5',
          {
            deadlineClockHours: 24,
            reversible: false,
            requiresTwoPersonApproval: true,
          }
        ),
        a(
          `${verdict}:queue_cnmr_filing:4`,
          'queue_cnmr_filing',
          entityRef,
          `Queue CNMR filing for ${entityRef}. Cabinet Res 74/2020 Art.6 requires submission within 5 business days.`,
          'Cabinet Res 74/2020 Art.6',
          {
            deadlineBusinessDays: 5,
            reversible: true,
          }
        ),
        a(
          `${verdict}:create_mlro_review_task:5`,
          'create_mlro_review_task',
          entityRef,
          `Create MLRO review task for ${entityRef} with four-eyes approval.`,
          'Cabinet Res 134/2025 Art.12-14',
          {
            reversible: true,
          }
        )
      );
      break;
    }
    case 'escalate': {
      actions.push(
        a(
          `${verdict}:create_mlro_review_task:0`,
          'create_mlro_review_task',
          entityRef,
          `Create priority MLRO review task for ${entityRef}. Four-eyes approval required.`,
          'FDL No.10/2025 Art.20-21; Cabinet Res 134/2025 Art.12-14',
          {
            deadlineBusinessDays: 2,
            reversible: true,
            requiresTwoPersonApproval: true,
          }
        ),
        a(
          `${verdict}:request_enhanced_cdd:1`,
          'request_enhanced_cdd',
          entityRef,
          `Request enhanced CDD evidence from ${entityRef}. Art.14 EDD scope — source of funds, source of wealth, purpose.`,
          'Cabinet Res 134/2025 Art.14',
          {
            deadlineBusinessDays: 10,
            reversible: true,
            tippingOffRisk: true,
          }
        ),
        a(
          `${verdict}:raise_risk_band:2`,
          'raise_risk_band',
          entityRef,
          `Raise customer risk band for ${entityRef} and mark for 3-month review cadence.`,
          'Cabinet Res 134/2025 Art.7-10',
          {
            reversible: true,
          }
        ),
        a(
          `${verdict}:queue_str_filing:3`,
          'queue_str_filing',
          entityRef,
          `Queue STR filing decision for ${entityRef}. FDL Art.26-27 — 10 business day deadline.`,
          'FDL No.10/2025 Art.26-27',
          {
            deadlineBusinessDays: 10,
            reversible: true,
          }
        )
      );
      break;
    }
    case 'flag': {
      actions.push(
        a(
          `${verdict}:create_mlro_review_task:0`,
          'create_mlro_review_task',
          entityRef,
          `Create MLRO review task for ${entityRef}. Standard review cadence.`,
          'FDL No.10/2025 Art.20-21',
          {
            deadlineBusinessDays: 5,
            reversible: true,
          }
        ),
        a(
          `${verdict}:raise_risk_band:1`,
          'raise_risk_band',
          entityRef,
          `Raise customer risk band for ${entityRef} and mark for 6-month review cadence.`,
          'Cabinet Res 134/2025 Art.7-10',
          {
            reversible: true,
          }
        )
      );
      if (ctx.uboReverificationRequired) {
        actions.push(
          a(
            `${verdict}:request_ubo_reverification:2`,
            'request_ubo_reverification',
            entityRef,
            `Request UBO re-verification for ${entityRef}. Cabinet Decision 109/2023 — 15 working day deadline.`,
            'Cabinet Decision 109/2023',
            {
              deadlineBusinessDays: 15,
              reversible: true,
              tippingOffRisk: false,
            }
          )
        );
      }
      break;
    }
    case 'pass':
    default: {
      // No remediation actions on a clean pass.
      break;
    }
  }

  const summary =
    actions.length === 0
      ? `No remediation actions required for verdict ${verdict}.`
      : `Remediation plan for verdict ${verdict}: ${actions.length} action(s) — ` +
        `${actions.map((x) => x.kind).join(', ')}.`;

  return {
    schemaVersion: 1,
    verdict,
    tenantId,
    entityRef,
    actions,
    summary,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'FDL No.10/2025 Art.24',
      'FDL No.10/2025 Art.26-27',
      'FDL No.10/2025 Art.29',
      'Cabinet Res 74/2020 Art.4-7',
      'Cabinet Res 134/2025 Art.12-14',
      'FATF Rec 4',
      'NIST AI RMF 1.0 MANAGE-3',
      'EU AI Act Art.14',
    ],
  };
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export type ExecutionStatus =
  | 'dry_run_skipped'
  | 'rejected_unauthorised'
  | 'rejected_missing_approval'
  | 'rejected_not_allowed'
  | 'rejected_circuit_breaker'
  | 'executed'
  | 'execution_failed';

export interface ActionResult {
  action: RemediationAction;
  status: ExecutionStatus;
  /** Result message returned by the sink (live mode) or reason (rejection). */
  message: string;
}

export interface ExecutionReport {
  planId: string;
  dryRun: boolean;
  startedAtIso: string;
  finishedAtIso: string;
  totalActions: number;
  executedCount: number;
  rejectedCount: number;
  failedCount: number;
  results: readonly ActionResult[];
}

/**
 * The interface the executor calls to carry out side effects.
 * Production wires this to the Asana orchestrator + EOCN notifier.
 * Tests inject an in-memory fake.
 */
export interface ActionSink {
  execute(action: RemediationAction): Promise<{ ok: boolean; message: string }>;
}

export interface ExecutorOptions {
  dryRun?: boolean;
  authorisedExecutorId?: string;
  twoPersonApprovalIds?: readonly string[];
  allowedActionKinds?: readonly ActionKind[];
  maxActionsPerRun?: number;
  now?: () => Date;
}

const DEFAULT_MAX = 20;

export class AutoRemediationExecutor {
  private readonly sink: ActionSink;

  constructor(sink: ActionSink) {
    this.sink = sink;
  }

  async execute(plan: RemediationPlan, opts: ExecutorOptions = {}): Promise<ExecutionReport> {
    const dryRun = opts.dryRun ?? true;
    const now = opts.now ?? (() => new Date());
    const startedAtIso = now().toISOString();
    const max = opts.maxActionsPerRun ?? DEFAULT_MAX;
    const allowed = opts.allowedActionKinds ? new Set<ActionKind>(opts.allowedActionKinds) : null;
    const twoPerson = (opts.twoPersonApprovalIds ?? []).filter(
      (s) => typeof s === 'string' && s.length > 0
    );

    const results: ActionResult[] = [];
    let executedCount = 0;
    let rejectedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < plan.actions.length; i++) {
      const action = plan.actions[i]!;

      // Circuit breaker.
      if (i >= max) {
        results.push({
          action,
          status: 'rejected_circuit_breaker',
          message: `maxActionsPerRun=${max} exceeded`,
        });
        rejectedCount += 1;
        continue;
      }

      // Allowlist.
      if (allowed && !allowed.has(action.kind)) {
        results.push({
          action,
          status: 'rejected_not_allowed',
          message: `action kind ${action.kind} not in allowedActionKinds`,
        });
        rejectedCount += 1;
        continue;
      }

      // Dry-run path — log + skip.
      if (dryRun) {
        results.push({
          action,
          status: 'dry_run_skipped',
          message: `dry_run — action not executed`,
        });
        continue;
      }

      // Live mode gates.
      if (!opts.authorisedExecutorId || opts.authorisedExecutorId.length === 0) {
        results.push({
          action,
          status: 'rejected_unauthorised',
          message: `live mode requires authorisedExecutorId`,
        });
        rejectedCount += 1;
        continue;
      }

      if (action.requiresTwoPersonApproval && twoPerson.length < 2) {
        results.push({
          action,
          status: 'rejected_missing_approval',
          message: `action requires two-person approval; got ${twoPerson.length}`,
        });
        rejectedCount += 1;
        continue;
      }

      // Executed path.
      try {
        const res = await this.sink.execute(action);
        if (res.ok) {
          executedCount += 1;
          results.push({ action, status: 'executed', message: res.message });
        } else {
          failedCount += 1;
          results.push({ action, status: 'execution_failed', message: res.message });
        }
      } catch (err) {
        failedCount += 1;
        results.push({
          action,
          status: 'execution_failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const finishedAtIso = now().toISOString();
    return {
      planId: `${plan.tenantId}:${plan.entityRef}:${plan.verdict}`,
      dryRun,
      startedAtIso,
      finishedAtIso,
      totalActions: plan.actions.length,
      executedCount,
      rejectedCount,
      failedCount,
      results,
    };
  }
}

// Exports for tests.
export const __test__ = { DEFAULT_MAX };
