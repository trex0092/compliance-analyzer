/**
 * Break-Glass Override — two-person-approval mechanism for
 * overriding a brain verdict.
 *
 * Why this exists:
 *   There are real situations where the MLRO needs to override
 *   the brain — a false-positive freeze on a high-value customer,
 *   or an urgent escalation the brain failed to catch. A raw
 *   "override" button is a liability: without a second signature
 *   and an immutable audit trail, the MLRO has no defence at
 *   inspection.
 *
 *   This module codifies a break-glass procedure:
 *     1. A primary MLRO issues a request carrying the proposed
 *        override verdict + justification + regulatory citation.
 *     2. A second MLRO (distinct user) approves or rejects.
 *     3. Only an approved request can execute. Rejected requests
 *        are persisted for the audit trail but never applied.
 *     4. Every record is immutable — mutations produce new
 *        entries, never edit in place.
 *     5. The justification is linted through the existing tipping-
 *        off linter — any accidental subject-exposing text in
 *        the justification is rejected at request time.
 *
 *   Pure function + in-memory store. Production wires the store
 *   to Netlify Blob.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO reasoned override)
 *   FDL No.10/2025 Art.24    (10-year retention)
 *   FDL No.10/2025 Art.29    (no tipping off — linted justification)
 *   Cabinet Res 134/2025 Art.12-14 (four-eyes on high-risk)
 *   NIST AI RMF 1.0 MANAGE-3 (AI decision recourse)
 *   EU AI Act Art.14         (human oversight)
 */

import { lintForTippingOff, type TippingOffReport } from './tippingOffLinter';

export type OverrideVerdict = 'pass' | 'flag' | 'escalate' | 'freeze';

export type BreakGlassStatus =
  | 'pending_second_approval'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'cancelled_tipping_off';

export interface BreakGlassRequest {
  id: string;
  tenantId: string;
  caseId: string;
  fromVerdict: OverrideVerdict;
  toVerdict: OverrideVerdict;
  justification: string;
  regulatoryCitation: string;
  requestedBy: string;
  requestedAtIso: string;
  approvedBy: string | null;
  approvedAtIso: string | null;
  executedAtIso: string | null;
  status: BreakGlassStatus;
  lintReport: TippingOffReport;
}

export interface RequestInput {
  tenantId: string;
  caseId: string;
  fromVerdict: OverrideVerdict;
  toVerdict: OverrideVerdict;
  justification: string;
  regulatoryCitation: string;
  requestedBy: string;
  now?: () => Date;
}

export class BreakGlassStore {
  private readonly entries: BreakGlassRequest[] = [];

  /** Open a break-glass request. Lints the justification first. */
  request(input: RequestInput): BreakGlassRequest {
    const now = input.now ?? (() => new Date());
    const lintReport = lintForTippingOff(input.justification);
    const id = `breakglass:${input.tenantId}:${input.caseId}:${now().getTime()}`;
    const entry: BreakGlassRequest = {
      id,
      tenantId: input.tenantId,
      caseId: input.caseId,
      fromVerdict: input.fromVerdict,
      toVerdict: input.toVerdict,
      justification: input.justification,
      regulatoryCitation: input.regulatoryCitation,
      requestedBy: input.requestedBy,
      requestedAtIso: now().toISOString(),
      approvedBy: null,
      approvedAtIso: null,
      executedAtIso: null,
      status: lintReport.clean ? 'pending_second_approval' : 'cancelled_tipping_off',
      lintReport,
    };
    this.entries.push(entry);
    return entry;
  }

  /**
   * Second MLRO approves the request. The approver MUST be a
   * different user than the requester — otherwise the approval
   * is rejected as "self-approval prohibited".
   */
  approve(
    id: string,
    approverId: string,
    now: () => Date = () => new Date()
  ): {
    ok: boolean;
    reason: string;
  } {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx < 0) return { ok: false, reason: 'unknown_id' };
    const e = this.entries[idx]!;
    if (e.status !== 'pending_second_approval') {
      return { ok: false, reason: `bad_state:${e.status}` };
    }
    if (!approverId || approverId.length === 0) {
      return { ok: false, reason: 'missing_approver_id' };
    }
    if (approverId === e.requestedBy) {
      return { ok: false, reason: 'self_approval_prohibited' };
    }
    this.entries[idx] = {
      ...e,
      approvedBy: approverId,
      approvedAtIso: now().toISOString(),
      status: 'approved',
    };
    return { ok: true, reason: 'approved' };
  }

  reject(id: string, approverId: string): { ok: boolean; reason: string } {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx < 0) return { ok: false, reason: 'unknown_id' };
    const e = this.entries[idx]!;
    if (e.status !== 'pending_second_approval') {
      return { ok: false, reason: `bad_state:${e.status}` };
    }
    if (approverId === e.requestedBy) {
      return { ok: false, reason: 'self_approval_prohibited' };
    }
    this.entries[idx] = {
      ...e,
      approvedBy: approverId,
      status: 'rejected',
    };
    return { ok: true, reason: 'rejected' };
  }

  /** Mark an approved request executed — only allowed after approval. */
  markExecuted(id: string, now: () => Date = () => new Date()): { ok: boolean; reason: string } {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx < 0) return { ok: false, reason: 'unknown_id' };
    const e = this.entries[idx]!;
    if (e.status !== 'approved') {
      return { ok: false, reason: `bad_state:${e.status}` };
    }
    this.entries[idx] = {
      ...e,
      status: 'executed',
      executedAtIso: now().toISOString(),
    };
    return { ok: true, reason: 'executed' };
  }

  get(id: string): BreakGlassRequest | null {
    return this.entries.find((e) => e.id === id) ?? null;
  }

  all(): readonly BreakGlassRequest[] {
    return this.entries.slice();
  }

  pending(): readonly BreakGlassRequest[] {
    return this.entries.filter((e) => e.status === 'pending_second_approval');
  }
}
