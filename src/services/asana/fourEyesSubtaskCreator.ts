/**
 * Four-Eyes Subtask Creator.
 *
 * When the brain produces a decision with a `fourEyes` gate, this
 * helper creates a single Asana SUBTASK under the parent task gid
 * returned by the main dispatch. The subtask carries a checklist
 * of the required approver roles so the MLRO can see at a glance
 * which role still needs to sign off.
 *
 * Why a subtask and not a top-level task?
 *   - Keeps the gate inside the main case task. Closing the case
 *     is a single parent-task operation on the MLRO's end.
 *   - Eliminates any possibility of a duplicate top-level task
 *     for the same verdict id — the subtask lives under the
 *     parent gid and is never itself a root dispatch.
 *   - Lets Asana's native subtask completion track approvals
 *     without us having to build a custom approval widget.
 *
 * Dedup invariants:
 *   - Never called unless the main dispatch succeeded and
 *     returned a real parent gid.
 *   - Uses its own idempotency key derived from the parent gid
 *     (`fourEyes:<parentGid>`) so replays never create a second
 *     subtask on the same parent.
 *   - No project field is set — Asana attaches subtasks to the
 *     parent's project automatically.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO duty)
 *   Cabinet Res 134/2025 Art.12-14 (four-eyes approver roles)
 *   Cabinet Res 74/2020 Art.4-7 (sanctions freeze 24-hour gate)
 *   FDL No.10/2025 Art.26-27 (STR filing approval)
 */

import type { CreateTaskFn } from './productionDispatchAdapter';
import { lintForTippingOff } from '../tippingOffLinter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FourEyesSubtaskInput {
  /** Parent task gid returned by the main Asana dispatch. */
  parentTaskGid: string;
  /** decisionType from fourEyesEnforcer (e.g. 'str_filing'). */
  decisionType: string;
  /** Approval count already received. */
  approvalCount: number;
  /** Required approval count. */
  requiredCount: number;
  /** Missing role labels (human-readable, e.g. "compliance_officer"). */
  missingRoles: readonly string[];
  /** Hours remaining on the four-eyes timeout window. */
  hoursRemaining: number;
  /** Regulatory reference citation. */
  regulatoryRef: string;
}

export interface FourEyesSubtaskResult {
  /** The subtask gid when created. */
  subtaskGid?: string;
  /** Reason the creation was skipped or failed. */
  skipped?: string;
}

export interface FourEyesSubtaskConfig {
  createTask: CreateTaskFn;
  /**
   * Optional idempotency set. The adapter uses it to prevent
   * duplicate subtask creation on the same parent gid.
   */
  idempotency?: {
    has(key: string): boolean | Promise<boolean>;
    set(key: string, value: string): void | Promise<void>;
  };
  /** Optional logging hook for Netlify function observability. */
  onCreate?: (result: {
    parentTaskGid: string;
    subtaskGid: string | null;
    skipped: string | null;
  }) => void;
}

// ---------------------------------------------------------------------------
// Body builder — deterministic, tipping-off-linter safe
// ---------------------------------------------------------------------------

export function buildFourEyesSubtaskBody(input: FourEyesSubtaskInput): string {
  const lines = [
    '# Four-Eyes Approval Gate',
    '',
    `- **Decision type:** ${input.decisionType}`,
    `- **Approvals:** ${input.approvalCount}/${input.requiredCount}`,
    `- **Hours remaining:** ${input.hoursRemaining}`,
    `- **Regulatory basis:** ${input.regulatoryRef}`,
    '',
    '## Missing roles',
    '',
  ];
  if (input.missingRoles.length === 0) {
    lines.push('- (all required roles have signed off)');
  } else {
    for (const role of input.missingRoles) {
      lines.push(`- [ ] ${role}`);
    }
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(
    '_Cabinet Res 134/2025 Art.12-14 — dual approval required. Each signatory must be a distinct human in the roles listed above. Replay-safe: this subtask is idempotent on the parent gid._'
  );
  lines.push('');
  lines.push(
    '_FDL No.10/2025 Art.29 — no tipping off. Do not share this subtask or its contents with the subject._'
  );
  return lines.join('\n');
}

export function buildFourEyesSubtaskTitle(input: FourEyesSubtaskInput): string {
  const emoji = input.decisionType === 'sanctions_freeze' ? '🚨' : '⚠';
  const missing = input.requiredCount - input.approvalCount;
  const title = `${emoji} Four-Eyes Gate · ${input.decisionType} · ${missing} approval(s) missing`;
  return title.length <= 256 ? title : title.slice(0, 255) + '…';
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a createFourEyesSubtask function bound to a real
 * asanaClient.createAsanaTask. Tests inject a fake createTask.
 *
 * The returned function:
 *   1. Short-circuits if the parent gid is already known to the
 *      idempotency set (skipped: 'already_created').
 *   2. Builds the subtask body + title.
 *   3. Runs lintForTippingOff on the body (belt-and-braces).
 *   4. Calls createTask with parent = parentTaskGid (no project
 *      field — Asana inherits the parent's project).
 *   5. Records the new gid in the idempotency set so replays
 *      cannot create a second subtask.
 *   6. Returns { subtaskGid } on success or { skipped: reason }
 *      on any failure. Never throws.
 */
export function createFourEyesSubtaskCreator(
  cfg: FourEyesSubtaskConfig
): (input: FourEyesSubtaskInput) => Promise<FourEyesSubtaskResult> {
  return async (input) => {
    const logResult = (result: FourEyesSubtaskResult) => {
      if (cfg.onCreate) {
        cfg.onCreate({
          parentTaskGid: input.parentTaskGid,
          subtaskGid: result.subtaskGid ?? null,
          skipped: result.skipped ?? null,
        });
      }
    };

    if (!input.parentTaskGid) {
      const r = { skipped: 'missing_parent_gid' };
      logResult(r);
      return r;
    }

    const idempotencyKey = `fourEyes:${input.parentTaskGid}`;
    if (cfg.idempotency) {
      const already = await cfg.idempotency.has(idempotencyKey);
      if (already) {
        const r = { skipped: 'already_created' };
        logResult(r);
        return r;
      }
    }

    const notes = buildFourEyesSubtaskBody(input);
    const lint = lintForTippingOff(notes);
    if (!lint.clean && (lint.topSeverity === 'critical' || lint.topSeverity === 'high')) {
      const r = {
        skipped: `tipping_off_blocked:${lint.findings.map((f) => f.patternId).join(',')}`,
      };
      logResult(r);
      return r;
    }

    const title = buildFourEyesSubtaskTitle(input);

    try {
      const response = await cfg.createTask({
        name: title,
        notes,
        // No project field — Asana attaches subtasks to the parent's project
        // automatically via the parent gid. We do NOT pass a separate project.
        projects: [],
        tags: ['brain/four-eyes', `brain/decision/${input.decisionType}`],
      });
      if (cfg.idempotency) {
        await cfg.idempotency.set(idempotencyKey, response.gid);
      }
      const r = { subtaskGid: response.gid };
      logResult(r);
      return r;
    } catch (err) {
      const r = {
        skipped: `createTask_error:${err instanceof Error ? err.message : String(err)}`,
      };
      logResult(r);
      return r;
    }
  };
}

// Exports for tests.
export const __test__ = {
  buildFourEyesSubtaskBody,
  buildFourEyesSubtaskTitle,
};
