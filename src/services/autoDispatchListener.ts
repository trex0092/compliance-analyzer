/**
 * Auto-Dispatch Listener — fires the super-brain when a new case
 * lands in the local store.
 *
 * The MLRO should not have to open Brain Console every time a case
 * is saved. This module registers a lightweight listener that the
 * SPA install code calls on boot: whenever a case is saved (via
 * store.saveCase), the listener checks whether the super-brain has
 * already dispatched for that case, and if not, enqueues a
 * dispatch via dispatchSuperBrainPlan.
 *
 * Design goals:
 *   - Idempotent: re-saving the same case never re-dispatches
 *     (we check the dispatch audit log first)
 *   - Non-blocking: the listener runs async and never blocks the
 *     store save
 *   - Fail-open: a dispatch error never prevents the case save
 *   - Respects the retry queue: failures land there, not on the
 *     main loop
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.19-21 (CO/MLRO duty of care — no case
 *     left uncategorized)
 *   - Cabinet Res 134/2025 Art.19 (auditable internal review)
 */

import type { ComplianceCase } from '../domain/cases';
import type { CustomerProfile } from '../domain/customers';
import { COMPANY_REGISTRY } from '../domain/customers';
import { dispatchSuperBrainPlan } from './asanaSuperBrainDispatcher';
import { pickFourEyesFromPersistentPool } from './approverPool';
import { readAuditLog, recordDispatch } from './dispatchAuditLog';
import { flushAuditLogToAsana, isAuditMirrorConfigured } from './asanaAuditLogMirror';
import {
  isCentralMlroMirrorConfigured,
  mirrorDispatchToCentralMlro,
} from './asanaCentralMlroMirror';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ListenerStatus = 'disabled' | 'enabled' | 'dispatching' | 'error';

export interface ListenerState {
  status: ListenerStatus;
  lastDispatchAtIso?: string;
  lastCaseId?: string;
  lastError?: string;
  dispatchCount: number;
}

const LISTENER_STORAGE_KEY = 'fgl_auto_dispatch_listener_enabled';
const STATE_KEY = 'fgl_auto_dispatch_listener_state';
const DEFAULT_PROJECT_FALLBACK = '1213759768596515';

function readEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(LISTENER_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setAutoDispatchEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LISTENER_STORAGE_KEY, String(enabled));
  } catch {
    /* storage quota — degrade silently */
  }
}

export function isAutoDispatchEnabled(): boolean {
  return readEnabled();
}

function readState(): ListenerState {
  try {
    if (typeof localStorage === 'undefined') {
      return { status: 'disabled', dispatchCount: 0 };
    }
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return { status: readEnabled() ? 'enabled' : 'disabled', dispatchCount: 0 };
    return JSON.parse(raw) as ListenerState;
  } catch {
    return { status: 'disabled', dispatchCount: 0 };
  }
}

function writeState(state: ListenerState): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    /* empty */
  }
}

export function readListenerState(): ListenerState {
  return readState();
}

// ---------------------------------------------------------------------------
// Idempotency check
// ---------------------------------------------------------------------------

/**
 * Has this case already been dispatched through the super-brain?
 * Walks the dispatch audit log and returns true on the first hit.
 * Pure read of localStorage — no network.
 */
export function hasCaseBeenDispatched(caseId: string): boolean {
  const entries = readAuditLog({ caseId, limit: 1 });
  return entries.length > 0;
}

// ---------------------------------------------------------------------------
// Project resolution
// ---------------------------------------------------------------------------

function projectGidForCase(caseObj: ComplianceCase): string {
  const customer: CustomerProfile | (typeof COMPANY_REGISTRY)[number] | undefined =
    caseObj.linkedCustomerId
      ? COMPANY_REGISTRY.find((c) => c.id === caseObj.linkedCustomerId)
      : undefined;
  return (
    customer?.asanaComplianceProjectGid ??
    customer?.asanaWorkflowProjectGid ??
    DEFAULT_PROJECT_FALLBACK
  );
}

// ---------------------------------------------------------------------------
// Listener hook — called by the store wrapper on saveCase
// ---------------------------------------------------------------------------

/**
 * Run the super-brain dispatcher against a case. Non-blocking:
 * callers should `void handleCaseSaved(...)` instead of awaiting.
 *
 * Skip conditions:
 *   - Listener is disabled
 *   - Case has already been dispatched (audit log hit)
 *
 * On dispatch the listener:
 *   - Picks a four-eyes pair from the persistent approver pool
 *   - Calls dispatchSuperBrainPlan
 *   - Records the result in the dispatch audit log with
 *     trigger='listener'
 */
export async function handleCaseSaved(
  caseObj: ComplianceCase,
  options: { force?: boolean } = {}
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  if (!options.force && !readEnabled()) {
    return { ok: true, skipped: 'Listener disabled' };
  }
  if (!options.force && hasCaseBeenDispatched(caseObj.id)) {
    return { ok: true, skipped: 'Case already dispatched' };
  }

  const state = readState();
  writeState({ ...state, status: 'dispatching', lastCaseId: caseObj.id });

  try {
    const approvers = pickFourEyesFromPersistentPool();
    const result = await dispatchSuperBrainPlan({
      case: caseObj,
      projectGid: projectGidForCase(caseObj),
      fourEyesApprovers: approvers.ok ? approvers.pair : undefined,
    });

    // Record in the audit log with the listener trigger.
    const auditEntry = recordDispatch({
      caseId: caseObj.id,
      verdict: result.plan.verdict,
      confidence: result.plan.enrichment.customFields
        ? ((result.plan.enrichment.customFields.confidence as number) ?? 0.8)
        : 0.8,
      suggestedColumn: result.plan.suggestedColumn,
      parentGid: result.parentGid,
      strSubtaskCount: result.strLifecycle?.subtaskGids.length ?? 0,
      fourEyesCount: result.fourEyesGids.length,
      kanbanMoveOk: result.kanbanMoveOk,
      annotatedCount: result.annotatedCount,
      errors: result.errors,
      warnings: result.plan.warnings,
      trigger: 'listener',
    });

    // Central MLRO triage mirror — fire-and-forget. The mirror
    // applies its own freeze/escalate/blocked filter so passes are
    // skipped automatically. No-op when ASANA_CENTRAL_MLRO_PROJECT_GID
    // is unset. Errors swallowed so a triage mirror failure never
    // fails an otherwise-successful dispatch.
    if (isCentralMlroMirrorConfigured()) {
      void mirrorDispatchToCentralMlro(auditEntry).catch(() => {});
    }

    writeState({
      status: result.ok ? 'enabled' : 'error',
      lastDispatchAtIso: new Date().toISOString(),
      lastCaseId: caseObj.id,
      lastError: result.ok ? undefined : result.errors.join('; '),
      dispatchCount: state.dispatchCount + 1,
    });

    // FDL Art.24 durable mirror — fire-and-forget. The mirror is
    // a no-op when ASANA_AUDIT_LOG_PROJECT_GID is unset, so this
    // never blocks dispatch. Errors are swallowed so a mirror
    // failure doesn't fail an otherwise-successful dispatch.
    if (isAuditMirrorConfigured()) {
      void flushAuditLogToAsana({ limit: 10 }).catch(() => {});
    }

    return result.ok ? { ok: true } : { ok: false, error: result.errors.join('; ') };
  } catch (err) {
    const message = (err as Error).message;
    writeState({
      ...state,
      status: 'error',
      lastError: message,
    });
    return { ok: false, error: message };
  }
}
