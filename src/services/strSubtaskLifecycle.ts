/**
 * STR Parent-Child Subtask Lifecycle — Asana weaponization pass.
 *
 * When the STR drafter saves a draft, we can't leave the lifecycle in
 * limbo. Every STR must move deterministically through seven stages:
 *
 *   1. MLRO review        — MLRO reads the draft (Cabinet Res 134/2025 Art.19)
 *   2. Four-eyes approval — two independent approvers (Art.19)
 *   3. goAML XML generate — build schema-valid FIU XML
 *   4. Submit to FIU      — upload to goAML portal (FDL Art.26-27)
 *   5. Retain 10 years    — file in cold storage (FDL Art.24)
 *   6. Monitor ack        — track FIU acknowledgement
 *   7. Close              — parent closes when every subtask done
 *
 * This module emits one parent Asana task plus those seven subtasks in
 * a single dispatch call. The parent carries the STR custom fields
 * (risk, verdict, deadline) from asanaCustomFields.ts so Asana's native
 * dashboards pick up the filing at rollup time.
 *
 * Mirrors the shape of fourEyesSubtasks.ts — a pure payload builder
 * plus a dispatcher so unit tests can exercise every stage without
 * touching the Asana API.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (10yr retention)
 *   - FDL No.10/2025 Art.26-27 (STR filing obligations)
 *   - FDL No.10/2025 Art.29 (no tipping off — reviewer names only,
 *     never the subject entity name in subtask titles)
 *   - Cabinet Res 134/2025 Art.19 (four-eyes internal review)
 *   - MoE Circular 08/AML/2021 (goAML XML + FIU submission chain)
 */

import {
  asanaRequestWithRetry,
  createAsanaTask,
  isAsanaConfigured,
  type AsanaTaskPayload,
} from './asanaClient';
import { buildComplianceCustomFields } from './asanaCustomFields';
import { addTaskLink } from './asanaTaskLinks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The seven lifecycle stages. Order is significant — downstream
 * dashboards rely on this sequence for the funnel rollup.
 */
export const STR_SUBTASK_STAGES = [
  'mlro-review',
  'four-eyes',
  'goaml-xml',
  'submit-fiu',
  'retain-10y',
  'monitor-ack',
  'close',
] as const;

export type StrSubtaskStage = (typeof STR_SUBTASK_STAGES)[number];

export interface StrLifecycleContext {
  /** Local STR draft id (used as the task link key). */
  strId: string;
  /** Local case id. */
  caseId: string;
  /**
   * Entity reference to use in the parent notes and subtask notes.
   * The STR page already strips the legal name to avoid tipping-off
   * (FDL Art.29). Pass the case id as the entity ref by default and
   * the drafter can override with a safe synonym when appropriate.
   */
  entityRef: string;
  /** Risk level from the case. */
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  /** Free-form reason the STR was triggered. */
  reasonForSuspicion: string;
  /** Optional regulatory basis override. */
  regulatoryBasis?: string;
  /** Asana project to dispatch the parent + subtasks into. */
  projectGid: string;
  /** ISO timestamp the STR was drafted (clock start). */
  draftedAtIso: string;
}

export interface StrSubtaskPayload {
  stage: StrSubtaskStage;
  name: string;
  notes: string;
  due_on: string;
}

export interface StrLifecycleDispatchResult {
  ok: boolean;
  parentGid?: string;
  subtaskGids: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Deadline table
// ---------------------------------------------------------------------------

/**
 * Business-day deadlines per stage, measured from the draft timestamp.
 * These are *internal* SLAs — the regulatory deadline is the overall
 * STR filing window (FDL Art.26-27 "without delay"), these just
 * decompose the window across the seven stages so each stage has its
 * own due date.
 */
const STAGE_DUE_DAYS: Record<StrSubtaskStage, number> = {
  'mlro-review': 1,
  'four-eyes': 2,
  'goaml-xml': 3,
  'submit-fiu': 5,
  'retain-10y': 6,
  'monitor-ack': 10,
  close: 12,
};

const STAGE_LABEL: Record<StrSubtaskStage, string> = {
  'mlro-review': 'MLRO review',
  'four-eyes': 'Four-eyes approval',
  'goaml-xml': 'Generate goAML XML',
  'submit-fiu': 'Submit to FIU',
  'retain-10y': 'File for 10-year retention',
  'monitor-ack': 'Monitor FIU acknowledgement',
  close: 'Close STR lifecycle',
};

const STAGE_NOTE_BODY: Record<StrSubtaskStage, string> = {
  'mlro-review':
    'MLRO must read the parent STR draft, verify the narrative, and mark this subtask complete to release the case for four-eyes review.',
  'four-eyes':
    'Two INDEPENDENT approvers must sign off per Cabinet Res 134/2025 Art.19. Do not coordinate decisions. Each reviewer must mark their own sub-subtask complete.',
  'goaml-xml':
    'Build goAML schema-valid XML via src/utils/goamlValidator.ts. Never hand-write XML. Attach the validated XML to this subtask.',
  'submit-fiu':
    'Upload the validated XML to the UAE FIU goAML portal. Paste the reference number into this subtask description before marking complete.',
  'retain-10y':
    'Move the filing + evidence bundle into 10-year cold storage per FDL No.10/2025 Art.24. Record the storage URI in this subtask.',
  'monitor-ack':
    'Watch for FIU acknowledgement. If ack is not received within 10 business days, escalate to the MLRO breakglass channel.',
  close:
    'All previous subtasks must be complete before this one. Record the final disposition and close the parent task.',
};

function addBusinessDays(fromIso: string, days: number): string {
  const start = new Date(fromIso);
  if (!Number.isFinite(start.getTime())) {
    throw new Error(`strSubtaskLifecycle: invalid draftedAtIso ${fromIso}`);
  }
  let added = 0;
  const cursor = new Date(start);
  while (added < days) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      added++;
    }
  }
  return cursor.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Pure builders — unit-test friendly
// ---------------------------------------------------------------------------

/**
 * Build the parent STR task payload. Carries compliance custom fields
 * so Asana rollups can pick up risk/verdict/deadline without the
 * compliance-analyzer needing to mirror a dashboard surface.
 */
export function buildStrParentTaskPayload(ctx: StrLifecycleContext): AsanaTaskPayload {
  const notes = [
    'STR parent lifecycle task — do NOT close this task manually.',
    'It closes automatically when all seven subtasks are complete.',
    '',
    `STR draft: ${ctx.strId}`,
    `Case: ${ctx.caseId}`,
    `Entity ref: ${ctx.entityRef}`,
    `Risk: ${ctx.riskLevel}`,
    '',
    'Reason for suspicion:',
    ctx.reasonForSuspicion,
    '',
    `Regulatory basis: ${ctx.regulatoryBasis ?? 'FDL No.10/2025 Art.26-27'}`,
    '',
    '--- FDL Art.29 — NO TIPPING OFF ---',
    'This task is visible only to the compliance team. Never share',
    'subject identifiers, task name, or URL outside the team.',
  ].join('\n');

  return {
    name: `[STR] ${ctx.caseId} — lifecycle`,
    notes,
    projects: [ctx.projectGid],
    due_on: addBusinessDays(ctx.draftedAtIso, STAGE_DUE_DAYS.close),
    custom_fields: buildComplianceCustomFields({
      riskLevel: ctx.riskLevel,
      verdict: 'escalate',
      caseId: ctx.caseId,
      deadlineType: 'STR',
      daysRemaining: STAGE_DUE_DAYS.close,
      regulationCitation: ctx.regulatoryBasis ?? 'FDL No.10/2025 Art.26-27',
    }),
  };
}

/**
 * Build every subtask payload for the STR lifecycle. Pure — no I/O.
 *
 * Returns an array of exactly seven entries in STR_SUBTASK_STAGES
 * order. Tests should assert the order because dashboards depend on it.
 */
export function buildStrSubtaskPayloads(
  ctx: StrLifecycleContext
): StrSubtaskPayload[] {
  return STR_SUBTASK_STAGES.map((stage) => {
    const label = STAGE_LABEL[stage];
    const noteBody = STAGE_NOTE_BODY[stage];
    const due = addBusinessDays(ctx.draftedAtIso, STAGE_DUE_DAYS[stage]);
    return {
      stage,
      name: `[${stage.toUpperCase()}] ${label} — ${ctx.caseId}`,
      notes: [
        noteBody,
        '',
        `Parent STR draft: ${ctx.strId}`,
        `Case: ${ctx.caseId}`,
        `Risk: ${ctx.riskLevel}`,
        `Stage: ${stage} (${STR_SUBTASK_STAGES.indexOf(stage) + 1}/${STR_SUBTASK_STAGES.length})`,
        `Due: ${due}`,
        '',
        'Regulatory basis: FDL No.10/2025 Art.26-27; Cabinet Res 134/2025 Art.19.',
        '',
        'FDL Art.29 — no tipping off. Do not contact the subject.',
      ].join('\n'),
      due_on: due,
    };
  });
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Create the parent STR task plus its seven subtasks. Links every
 * created task into the local task-link store keyed by the STR id so
 * downstream monitors (Kanban view, health tile, breach escalation)
 * can find them.
 *
 * The subtasks are created sequentially to respect the adaptive rate
 * limiter in asanaClient. On the first failure we stop and return the
 * partial result — the caller should inspect `errors` and decide
 * whether to retry, escalate, or enqueue to asanaQueue.
 */
export async function createStrLifecycleTasks(
  ctx: StrLifecycleContext
): Promise<StrLifecycleDispatchResult> {
  if (!isAsanaConfigured()) {
    return {
      ok: false,
      subtaskGids: [],
      errors: ['Asana not configured'],
    };
  }

  const parentPayload = buildStrParentTaskPayload(ctx);
  const parent = await createAsanaTask(parentPayload);
  if (!parent.ok || !parent.gid) {
    return {
      ok: false,
      subtaskGids: [],
      errors: [parent.error ?? 'createAsanaTask returned no gid'],
    };
  }

  addTaskLink(ctx.strId, 'filing', parent.gid, ctx.projectGid);

  const subtaskPayloads = buildStrSubtaskPayloads(ctx);
  const subtaskGids: string[] = [];
  const errors: string[] = [];

  for (const payload of subtaskPayloads) {
    const res = await asanaRequestWithRetry<{ gid: string }>(
      `/tasks/${encodeURIComponent(parent.gid)}/subtasks`,
      {
        method: 'POST',
        body: JSON.stringify({
          data: {
            name: payload.name,
            notes: payload.notes,
            due_on: payload.due_on,
          },
        }),
      }
    );
    if (res.ok && res.data?.gid) {
      subtaskGids.push(res.data.gid);
    } else {
      errors.push(`${payload.stage}: ${res.error ?? 'unknown error'}`);
      // Stop on first failure to avoid partial fan-out. The parent task
      // is already created — the caller can retry the subtask creation
      // loop against the known parent gid.
      break;
    }
  }

  return {
    ok: errors.length === 0 && subtaskGids.length === STR_SUBTASK_STAGES.length,
    parentGid: parent.gid,
    subtaskGids,
    errors,
  };
}
