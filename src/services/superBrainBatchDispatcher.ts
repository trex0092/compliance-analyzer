/**
 * Super Brain Batch Dispatcher — dispatch N cases with rate limits +
 * per-case circuit breaker + exponential backoff.
 *
 * The single-case dispatcher at `asanaSuperBrainDispatcher.ts` is
 * the right primitive. This module layers a batch loop on top so
 * the autopilot cron, the "dispatch all open" button, and any
 * future webhook-driven replay path can fan out a full day's
 * worth of cases without hammering the Asana rate limiter.
 *
 * Design:
 *   - Sequential by default (concurrency=1) to respect the
 *     adaptive rate limiter in asanaClient
 *   - Consecutive-failure circuit breaker (default: abort after
 *     5 consecutive failures)
 *   - Per-case retry via dispatcherBackoff (exponential 1-16s)
 *   - Every dispatch recorded in the dispatch audit log with
 *     the trigger the caller supplies (cron / manual / webhook)
 *
 * Pure batching logic around the real dispatcher. Tests cover the
 * circuit breaker + dedupe + skip paths via a stubbed dispatcher.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (never drop an audit-relevant case)
 *   - Cabinet Res 134/2025 Art.19 (auditable internal review)
 *   - NIST AI RMF 1.0 MANAGE-2 (AI decision provenance at scale)
 */

import type { ComplianceCase } from '../domain/cases';
import { COMPANY_REGISTRY } from '../domain/customers';
import {
  dispatchSuperBrainPlan,
  type SuperBrainDispatchResult,
  type SuperBrainInput,
} from './asanaSuperBrainDispatcher';
import { recordDispatch, hasCaseInAuditLogCheck } from './dispatchAuditHelpers';
import { runWithBackoff, type BackoffOptions } from './dispatcherBackoff';
import { pickFourEyesFromPersistentPool } from './approverPool';

const DEFAULT_PROJECT_FALLBACK = '1213759768596515';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BatchTrigger = 'cron' | 'manual' | 'webhook' | 'listener' | 'batch';

export interface SuperBrainBatchOptions {
  /** Trigger label recorded on every dispatch. */
  trigger: BatchTrigger;
  /** Consecutive failure threshold. Default 5. */
  consecutiveFailureLimit?: number;
  /** Skip cases that already appear in the dispatch audit log. Default true. */
  skipAlreadyDispatched?: boolean;
  /** Backoff options passed to each per-case retry. */
  backoff?: BackoffOptions;
  /** Optional dispatcher injection for tests. */
  dispatcher?: (input: SuperBrainInput) => Promise<SuperBrainDispatchResult>;
  /** Optional now() injection for deterministic tests. */
  nowIso?: string;
}

export interface SuperBrainBatchItemResult {
  caseId: string;
  ok: boolean;
  skipped?: string;
  verdict?: string;
  error?: string;
  attempts?: number;
}

export interface SuperBrainBatchSummary {
  total: number;
  dispatched: number;
  skipped: number;
  failed: number;
  aborted?: string;
  durationMs: number;
  items: SuperBrainBatchItemResult[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function projectGidForCase(caseObj: ComplianceCase): string {
  const customer = caseObj.linkedCustomerId
    ? COMPANY_REGISTRY.find((c) => c.id === caseObj.linkedCustomerId)
    : undefined;
  return (
    customer?.asanaComplianceProjectGid ??
    customer?.asanaWorkflowProjectGid ??
    DEFAULT_PROJECT_FALLBACK
  );
}

// ---------------------------------------------------------------------------
// Batch runner
// ---------------------------------------------------------------------------

/**
 * Run the super-brain against a batch of cases. Respects the
 * circuit breaker, skip-already-dispatched guard, and per-case
 * exponential backoff. Emits one audit log entry per successful
 * dispatch.
 */
export async function runSuperBrainBatch(
  cases: readonly ComplianceCase[],
  options: SuperBrainBatchOptions
): Promise<SuperBrainBatchSummary> {
  const startedAtMs = Date.now();
  const items: SuperBrainBatchItemResult[] = [];
  const consecutiveLimit = options.consecutiveFailureLimit ?? 5;
  const skipAlreadyDispatched = options.skipAlreadyDispatched ?? true;
  const dispatcher = options.dispatcher ?? dispatchSuperBrainPlan;

  let dispatched = 0;
  let skipped = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  let aborted: string | undefined;

  for (const caseObj of cases) {
    if (skipAlreadyDispatched && hasCaseInAuditLogCheck(caseObj.id)) {
      items.push({ caseId: caseObj.id, ok: true, skipped: 'already-dispatched' });
      skipped++;
      continue;
    }

    const approvers = pickFourEyesFromPersistentPool();
    const input: SuperBrainInput = {
      case: caseObj,
      projectGid: projectGidForCase(caseObj),
      fourEyesApprovers: approvers.ok ? approvers.pair : undefined,
      dispatchedAtIso: options.nowIso,
    };

    const backoffResult = await runWithBackoff(() => dispatcher(input), options.backoff);

    if (backoffResult.ok && backoffResult.value) {
      const result = backoffResult.value;
      recordDispatch({
        caseId: caseObj.id,
        verdict: result.plan.verdict,
        confidence: 0.8,
        suggestedColumn: result.plan.suggestedColumn,
        parentGid: result.parentGid,
        strSubtaskCount: result.strLifecycle?.subtaskGids.length ?? 0,
        fourEyesCount: result.fourEyesGids.length,
        kanbanMoveOk: result.kanbanMoveOk,
        annotatedCount: result.annotatedCount,
        errors: result.errors,
        warnings: result.plan.warnings,
        trigger: options.trigger,
        atIso: options.nowIso,
      });
      items.push({
        caseId: caseObj.id,
        ok: result.ok,
        verdict: result.plan.verdict,
        attempts: backoffResult.attempts,
        error: result.ok ? undefined : result.errors.join('; '),
      });
      if (result.ok) {
        dispatched++;
        consecutiveFailures = 0;
      } else {
        failed++;
        consecutiveFailures++;
      }
    } else {
      failed++;
      consecutiveFailures++;
      items.push({
        caseId: caseObj.id,
        ok: false,
        error: String(backoffResult.error ?? 'unknown backoff error'),
        attempts: backoffResult.attempts,
      });
    }

    if (consecutiveFailures >= consecutiveLimit) {
      aborted = `Aborted after ${consecutiveFailures} consecutive failures — check Asana connectivity`;
      break;
    }
  }

  return {
    total: cases.length,
    dispatched,
    skipped,
    failed,
    aborted,
    durationMs: Date.now() - startedAtMs,
    items,
  };
}
