/**
 * Asana → Local Case Bidirectional Resolution Sync.
 *
 * When an Asana task closes (via the UI or via an automation rule),
 * we need the local ComplianceCase to reflect that — otherwise the
 * Cases page shows the case as open even though the work is done.
 * This module is the pure side of that bridge:
 *
 *   1. Look up the local case id via asanaTaskLinks.findLinkByAsanaGid
 *   2. Build a resolution plan (ResolvedCaseUpdate) carrying the
 *      next ComplianceCase status + audit log entry
 *   3. Hand the plan to the caller (which applies it against the
 *      IndexedDB store)
 *
 * Pure, unit-testable. No fetch, no store mutation.
 *
 * Resolution routing:
 *
 *   Asana parent task closed + verdict=freeze → status='escalated'
 *   Asana parent task closed + verdict=escalate → status='under-review'
 *   Asana parent task closed + verdict=flag/pass → status='closed'
 *   Asana parent task re-opened → status reverts to 'open'
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (audit trail on both sides)
 *   - Cabinet Res 134/2025 Art.19 (auditable internal review)
 */

import type { ComplianceCase, CaseStatus, AuditAction } from '../domain/cases';
import type { Verdict } from './asanaCustomFields';
import { findLinkByAsanaGid, markLinkCompleted } from './asanaTaskLinks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AsanaTaskResolutionEvent {
  asanaGid: string;
  /** Whether Asana reports the task as completed. */
  completed: boolean;
  /** Optional verdict carried on the task custom field. */
  verdict?: Verdict;
  /** Timestamp from Asana, used for the audit log entry. */
  atIso?: string;
  /** User that closed it in Asana, if known. */
  closedBy?: string;
}

export interface ResolvedCaseUpdate {
  caseId: string;
  nextStatus: CaseStatus;
  auditLogEntry: {
    at: string;
    by: string;
    action: AuditAction;
    note: string;
  };
  /** True when the local case was not found — caller ignores it. */
  notFound?: boolean;
}

// ---------------------------------------------------------------------------
// Pure resolver
// ---------------------------------------------------------------------------

function statusForVerdict(verdict: Verdict | undefined, completed: boolean): CaseStatus {
  if (!completed) return 'open';
  switch (verdict) {
    case 'freeze':
      return 'escalated';
    case 'escalate':
      return 'under-review';
    case 'flag':
    case 'pass':
    case undefined:
      return 'closed';
  }
}

/**
 * Build a resolution plan for an inbound Asana event. Pure — the
 * caller applies the nextStatus + auditLogEntry to its store.
 * Returns `notFound: true` when no local case links to the Asana
 * gid; the caller should ignore it (the task isn't ours).
 */
export function buildResolutionPlan(
  event: AsanaTaskResolutionEvent
): ResolvedCaseUpdate | { notFound: true } {
  const link = findLinkByAsanaGid(event.asanaGid);
  if (!link) return { notFound: true };

  const atIso = event.atIso ?? new Date().toISOString();
  const nextStatus = statusForVerdict(event.verdict, event.completed);
  const by = event.closedBy ?? 'asana-bidirectional-sync';
  const verdictTag = event.verdict ?? (event.completed ? 'unknown' : 'reopened');

  return {
    caseId: link.localId,
    nextStatus,
    auditLogEntry: {
      at: atIso,
      by,
      // Use the 'status-changed' AuditAction for both close + reopen
      // (the note carries the distinction). This keeps the local
      // audit log compatible with the existing AuditAction enum
      // in src/domain/cases.ts without adding new variants.
      action: 'status-changed',
      note: `Asana task ${event.asanaGid} ${event.completed ? 'closed' : 'reopened'} (verdict=${verdictTag}) — status → ${nextStatus}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Applier — pure function producing the next ComplianceCase shape
// ---------------------------------------------------------------------------

/**
 * Apply a resolution plan to a ComplianceCase. Returns a new case
 * object with the status + appended audit log. Pure — no store
 * mutation. Idempotent — re-applying the same plan is a no-op
 * except for the audit log entry (callers should dedupe by
 * auditLogEntry.at + action when idempotency matters).
 */
export function applyResolutionPlan(
  caseObj: ComplianceCase,
  plan: ResolvedCaseUpdate
): ComplianceCase {
  return {
    ...caseObj,
    status: plan.nextStatus,
    updatedAt: plan.auditLogEntry.at,
    auditLog: [
      ...caseObj.auditLog,
      {
        id: `aud_${plan.auditLogEntry.at}_${plan.auditLogEntry.action}`,
        at: plan.auditLogEntry.at,
        by: plan.auditLogEntry.by,
        action: plan.auditLogEntry.action,
        note: plan.auditLogEntry.note,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Side-effect helper: mark the task link completed
// ---------------------------------------------------------------------------

/**
 * Convenience wrapper for callers that want to record completion
 * on the local task-link side channel too.
 */
export function markAsanaLinkResolved(event: AsanaTaskResolutionEvent): void {
  if (event.completed) {
    markLinkCompleted(event.asanaGid);
  }
}
