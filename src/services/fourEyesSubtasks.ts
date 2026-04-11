/**
 * Four-Eyes Subtasks — Asana Phase 2 #A7.
 *
 * Cabinet Res 134/2025 Art.19 requires dual-approver review for
 * high-risk compliance decisions. Today we track four-eyes state in
 * src/domain/approvals.ts. This module pushes that state into Asana
 * as parent-task + 2 subtasks so Asana's native "all subtasks
 * complete → parent complete" rules handle the gate without our own
 * state machine.
 *
 * Exports:
 *   createFourEyesSubtasks(parentGid, approvers, context)
 *     — creates two subtasks under the parent approval task, one
 *       assigned to each approver. Both subtasks must be marked
 *       complete before the parent can be closed (Asana native rule,
 *       configured at project level).
 *
 *   buildFourEyesSubtaskPayloads(parentGid, approvers, context)
 *     — pure function that returns the subtask payloads for testing.
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (internal review — two independent
 *     approvers for high-risk decisions)
 *   - FDL No.10/2025 Art.20-21 (CO + MLRO duty of care)
 *   - FATF Rec 18 (internal controls proportionate to risk)
 */

import { asanaRequestWithRetry, isAsanaConfigured } from './asanaClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FourEyesApprover {
  /** Asana user GID. */
  gid: string;
  /** Human-readable name. */
  name: string;
}

export interface FourEyesContext {
  caseId: string;
  caseType: string;
  entityName: string;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  regulatoryBasis: string;
}

export interface FourEyesSubtaskPayload {
  name: string;
  notes: string;
  assignee: string;
  /** Number of days the approver has to respond. */
  due_on: string;
}

export interface FourEyesDispatchResult {
  ok: boolean;
  subtaskGids: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Pure payload builder
// ---------------------------------------------------------------------------

export function buildFourEyesSubtaskPayloads(
  approvers: readonly [FourEyesApprover, FourEyesApprover],
  context: FourEyesContext
): [FourEyesSubtaskPayload, FourEyesSubtaskPayload] {
  // Rigid 2-element tuple — four-eyes is ALWAYS two reviewers.
  // Neither more, nor less: one would be single-eyes, three would
  // be committee review which is a different control.
  const dueDays = context.riskLevel === 'critical' ? 1 : 2;
  const dueOn = new Date(Date.now() + dueDays * 86400000).toISOString().slice(0, 10);

  const build = (approver: FourEyesApprover, role: 'primary' | 'independent'): FourEyesSubtaskPayload => ({
    name: `[4-EYES ${role.toUpperCase()}] ${context.caseType} — ${context.entityName}`,
    notes: [
      `Four-eyes approval required under Cabinet Res 134/2025 Art.19.`,
      '',
      `Reviewer role: ${role}`,
      `Reviewer: ${approver.name}`,
      `Case ID: ${context.caseId}`,
      `Entity: ${context.entityName}`,
      `Risk level: ${context.riskLevel}`,
      '',
      `Regulatory basis: ${context.regulatoryBasis}`,
      '',
      '---',
      'Your role as the ' + role + ' reviewer: read the parent case,',
      'verify the recommended action is correct, and mark this subtask',
      'complete to record your approval. Asana project rules will close',
      'the parent task once both subtasks are complete.',
      '',
      'IMPORTANT: the two reviewers MUST act independently.',
      'Do not coordinate the decision before recording it.',
      '',
      'This subtask expires in ' + dueDays + ' business day(s).',
    ].join('\n'),
    assignee: approver.gid,
    due_on: dueOn,
  });

  return [build(approvers[0], 'primary'), build(approvers[1], 'independent')];
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function createFourEyesSubtasks(
  parentGid: string,
  approvers: readonly [FourEyesApprover, FourEyesApprover],
  context: FourEyesContext
): Promise<FourEyesDispatchResult> {
  // Approvers must be distinct — Cabinet Res 134/2025 Art.19 requires
  // INDEPENDENT reviewers. Same-person four-eyes is fraud. This
  // invariant check runs BEFORE the isAsanaConfigured guard because
  // it's a pure compliance rule that applies regardless of whether
  // Asana is reachable.
  if (approvers[0].gid === approvers[1].gid) {
    return {
      ok: false,
      subtaskGids: [],
      errors: [
        'Four-eyes requires two DIFFERENT approvers — same-user assignment violates Cabinet Res 134/2025 Art.19',
      ],
    };
  }
  if (!isAsanaConfigured()) {
    return { ok: false, subtaskGids: [], errors: ['Asana not configured'] };
  }

  const payloads = buildFourEyesSubtaskPayloads(approvers, context);
  const subtaskGids: string[] = [];
  const errors: string[] = [];

  for (const payload of payloads) {
    const result = await asanaRequestWithRetry<{ gid: string }>(
      `/tasks/${encodeURIComponent(parentGid)}/subtasks`,
      {
        method: 'POST',
        body: JSON.stringify({ data: payload }),
      }
    );
    if (result.ok && result.data) {
      subtaskGids.push(result.data.gid);
    } else {
      errors.push(result.error ?? 'unknown error');
    }
  }

  return {
    ok: errors.length === 0,
    subtaskGids,
    errors,
  };
}
