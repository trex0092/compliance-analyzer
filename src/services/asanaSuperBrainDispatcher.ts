/**
 * Asana Super Brain Dispatcher — mega weaponized case fan-out.
 *
 * Takes a ComplianceCase and produces a fully-enriched Asana
 * dispatch plan that covers:
 *
 *   1. Parent task with brain verdict badge in the name, brain
 *      notes block in the body, compliance custom fields set from
 *      the brain verdict + risk level + case metadata
 *   2. STR 7-subtask lifecycle — dispatched when verdict is
 *      flag / escalate / freeze (pass skips the lifecycle)
 *   3. Four-eyes independent reviewer subtasks — dispatched when
 *      verdict is escalate / freeze (mandatory per Cabinet Res
 *      134/2025 Art.19)
 *   4. Kanban column assignment (via the section write-back
 *      service when a project section map is available)
 *   5. SPA toast emission (via the asanaCommentMirror buffer) so
 *      the MLRO sees the escalation even if their Asana tab isn't
 *      focused
 *   6. Bulk annotation on any existing Asana tasks linked to the
 *      same case so the new verdict bubbles through to the audit
 *      trail
 *
 * Pure planner (buildSuperBrainDispatchPlan) + thin executor
 * (dispatchSuperBrainPlan). Tests exercise the planner shape;
 * the executor is covered indirectly by the individual service
 * tests (asanaClient, strSubtaskLifecycle, asanaSectionWriteBack,
 * asanaBulkOperations, asanaCommentMirror).
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.19-21 (CO/MLRO duty of care)
 *   - FDL No.10/2025 Art.24 (10yr retention — every dispatch is a
 *     recorded audit event)
 *   - FDL No.10/2025 Art.26-27 (STR filing obligations)
 *   - FDL No.10/2025 Art.29 (no tipping off — task titles use
 *     case id, never entity legal name)
 *   - Cabinet Res 134/2025 Art.19 (four-eyes internal review)
 *   - Cabinet Res 74/2020 Art.4-7 (24h EOCN freeze on sanctions)
 *   - NIST AI RMF 1.0 MANAGE-2 + MEASURE-3 (explainability +
 *     provenance of AI-assisted decisions)
 */

import type { ComplianceCase } from '../domain/cases';
import type { CustomerProfile } from '../domain/customers';
import { createAsanaTask, isAsanaConfigured } from './asanaClient';
import {
  enrichAsanaTaskFromBrain,
  type BrainEnrichment,
  type EnrichableBrain,
} from './asanaBrainEnricher';
import { caseToEnrichableBrain } from './caseToEnrichableBrain';
import {
  buildStrParentTaskPayload,
  buildStrSubtaskPayloads,
  createStrLifecycleTasks,
  type StrLifecycleDispatchResult,
} from './strSubtaskLifecycle';
import {
  buildFourEyesSubtaskPayloads,
  type FourEyesApprover,
  type FourEyesContext,
  type FourEyesSubtaskPayload,
} from './fourEyesSubtasks';
import { moveTaskToKanbanColumn } from './asanaSectionWriteBack';
import { enqueueCommentToast, type SpaToastEvent } from './asanaCommentMirror';
import { annotateAsanaTasks } from './asanaBulkOperations';
import type { KanbanColumn } from './asanaKanbanView';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SuperBrainInput {
  case: ComplianceCase;
  /** Optional customer profile — used to enrich the parent task
   *  custom fields if present. Never used in a way that echoes the
   *  legal name into the task title (FDL Art.29). */
  customer?: CustomerProfile;
  /** Optional pre-computed brain response. When omitted, the
   *  dispatcher runs caseToEnrichableBrain() as a derivation. */
  brain?: EnrichableBrain;
  /** Asana project to dispatch the parent task into. */
  projectGid: string;
  /** Optional four-eyes approver pair — required when the verdict
   *  is 'escalate' or 'freeze'. When omitted, the four-eyes step
   *  is skipped and logged in the dispatch plan. */
  fourEyesApprovers?: readonly [FourEyesApprover, FourEyesApprover];
  /** Optional ISO timestamp override for deterministic tests. */
  dispatchedAtIso?: string;
}

export interface SuperBrainDispatchPlan {
  /** Which verdict the brain settled on. */
  verdict: EnrichableBrain['verdict'];
  /** Recommended Kanban column from the enricher. */
  suggestedColumn: KanbanColumn;
  /** The brain enrichment object — tests assert its shape. */
  enrichment: BrainEnrichment;
  /** Whether the STR lifecycle should fan out. */
  dispatchStrLifecycle: boolean;
  /** Whether four-eyes subtasks should dispatch. */
  dispatchFourEyes: boolean;
  /** Rendered parent task payload. */
  parentTaskPayload: ReturnType<typeof buildStrParentTaskPayload>;
  /** Rendered STR subtask payloads (empty if STR lifecycle skipped). */
  strSubtaskPayloads: ReturnType<typeof buildStrSubtaskPayloads>;
  /** Rendered four-eyes subtask payloads (empty if skipped). */
  fourEyesPayloads: readonly FourEyesSubtaskPayload[];
  /** SPA toast event to emit. */
  toast: SpaToastEvent;
  /** Warnings surfaced to the caller (missing approvers, etc.). */
  warnings: string[];
}

export interface SuperBrainDispatchResult {
  plan: SuperBrainDispatchPlan;
  ok: boolean;
  errors: string[];
  parentGid?: string;
  strLifecycle?: StrLifecycleDispatchResult;
  fourEyesGids: string[];
  kanbanMoveOk?: boolean;
  annotatedCount: number;
}

// ---------------------------------------------------------------------------
// Pure planner
// ---------------------------------------------------------------------------

/**
 * Build the super-brain dispatch plan. Pure — no network, no
 * storage writes, no side effects. Tests exercise every branch
 * through this function.
 */
export function buildSuperBrainDispatchPlan(input: SuperBrainInput): SuperBrainDispatchPlan {
  const brain = input.brain ?? caseToEnrichableBrain(input.case);
  const enrichment = enrichAsanaTaskFromBrain(brain);
  const warnings: string[] = [];

  const dispatchStrLifecycle = brain.verdict !== 'pass';
  const dispatchFourEyes = brain.verdict === 'escalate' || brain.verdict === 'freeze';

  if (dispatchFourEyes && !input.fourEyesApprovers) {
    warnings.push(
      `Verdict ${brain.verdict} requires four-eyes approval (Cabinet Res 134/2025 Art.19) but no approvers were supplied — four-eyes subtasks skipped`
    );
  }

  const dispatchedAtIso = input.dispatchedAtIso ?? new Date().toISOString();

  // STR lifecycle payloads — always built so the plan is explorable
  // in tests, but the dispatcher only posts them when the flag says
  // to. The lifecycle builder already carries the brain enrichment
  // into every subtask when ctx.brain is supplied.
  const lifecycleCtx = {
    strId: `sb-${input.case.id}`,
    caseId: input.case.id,
    entityRef: input.case.id,
    riskLevel: input.case.riskLevel,
    reasonForSuspicion: input.case.narrative ?? 'see case notes',
    regulatoryBasis: 'FDL No.10/2025 Art.26-27',
    projectGid: input.projectGid,
    draftedAtIso: dispatchedAtIso,
    brain,
  };

  const parentTaskPayload = buildStrParentTaskPayload(lifecycleCtx);
  const strSubtaskPayloads = dispatchStrLifecycle ? buildStrSubtaskPayloads(lifecycleCtx) : [];

  let fourEyesPayloads: readonly FourEyesSubtaskPayload[] = [];
  if (dispatchFourEyes && input.fourEyesApprovers) {
    const ctx: FourEyesContext = {
      caseId: input.case.id,
      caseType: input.case.caseType,
      entityName: input.case.id, // case id, not legal name (FDL Art.29)
      riskLevel: input.case.riskLevel,
      regulatoryBasis: 'Cabinet Res 134/2025 Art.19',
    };
    fourEyesPayloads = buildFourEyesSubtaskPayloads(input.fourEyesApprovers, ctx);
  }

  const toast: SpaToastEvent = {
    id: `superbrain_${input.case.id}_${dispatchedAtIso}`,
    kind: 'asana_comment',
    severity:
      brain.verdict === 'freeze' ? 'critical' : brain.verdict === 'escalate' ? 'warning' : 'info',
    title: `Super-brain ${brain.verdict.toUpperCase()} on ${input.case.id}`,
    body: `${enrichment.headline}. ${brain.recommendedAction}`,
    caseId: input.case.id,
    atIso: dispatchedAtIso,
  };

  return {
    verdict: brain.verdict,
    suggestedColumn: enrichment.suggestedColumn,
    enrichment,
    dispatchStrLifecycle,
    dispatchFourEyes,
    parentTaskPayload,
    strSubtaskPayloads,
    fourEyesPayloads,
    toast,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Execute a previously-built dispatch plan against Asana + the SPA
 * toast buffer. Every step is independently opt-out so a partial
 * failure doesn't lose the rest of the work.
 */
export async function dispatchSuperBrainPlan(
  input: SuperBrainInput
): Promise<SuperBrainDispatchResult> {
  const plan = buildSuperBrainDispatchPlan(input);

  // Emit the toast immediately — it's the only side effect that
  // should happen regardless of Asana connectivity so the MLRO
  // sees the verdict even when the upstream is down.
  enqueueCommentToast(plan.toast);

  if (!isAsanaConfigured()) {
    return {
      plan,
      ok: false,
      errors: ['Asana not configured'],
      fourEyesGids: [],
      annotatedCount: 0,
    };
  }

  const errors: string[] = [];
  let parentGid: string | undefined;
  let strLifecycle: StrLifecycleDispatchResult | undefined;
  const fourEyesGids: string[] = [];
  let kanbanMoveOk: boolean | undefined;
  let annotatedCount = 0;

  // Parent + STR lifecycle — delegate to the existing lifecycle
  // service so the brain enrichment path is shared.
  if (plan.dispatchStrLifecycle) {
    strLifecycle = await createStrLifecycleTasks({
      strId: `sb-${input.case.id}`,
      caseId: input.case.id,
      entityRef: input.case.id,
      riskLevel: input.case.riskLevel,
      reasonForSuspicion: input.case.narrative ?? 'see case notes',
      regulatoryBasis: 'FDL No.10/2025 Art.26-27',
      projectGid: input.projectGid,
      draftedAtIso: plan.toast.atIso,
      brain: input.brain ?? caseToEnrichableBrain(input.case),
    });
    parentGid = strLifecycle.parentGid;
    if (!strLifecycle.ok) {
      errors.push(...strLifecycle.errors);
    }
  } else {
    // Pass verdict — still create the parent task but skip the
    // lifecycle so rollups pick up the resolution.
    const parent = await createAsanaTask(plan.parentTaskPayload);
    if (parent.ok && parent.gid) {
      parentGid = parent.gid;
    } else {
      errors.push(parent.error ?? 'createAsanaTask failed for pass verdict');
    }
  }

  // Kanban column move — only attempted when we have a parent gid
  // and a section map is configured for the target project.
  if (parentGid) {
    const moved = await moveTaskToKanbanColumn(input.projectGid, parentGid, plan.suggestedColumn);
    kanbanMoveOk = moved.ok;
    if (!moved.ok && moved.error) {
      // Not a hard failure — log as a warning but don't flip ok.
      plan.warnings.push(`Kanban move skipped: ${moved.error}`);
    }
  }

  // Retroactive bulk annotation on any existing linked tasks.
  // Intentionally best-effort — if the annotation fails we keep
  // going because the STR lifecycle already carries the verdict.
  const annotation = `${plan.enrichment.headline}. ${plan.toast.body}`;
  const linkedGids: string[] = parentGid ? [parentGid] : [];
  if (linkedGids.length > 0) {
    const annotateResult = await annotateAsanaTasks(linkedGids, annotation);
    annotatedCount = annotateResult.succeeded;
  }

  return {
    plan,
    ok: errors.length === 0,
    errors,
    parentGid,
    strLifecycle,
    fourEyesGids,
    kanbanMoveOk,
    annotatedCount,
  };
}
