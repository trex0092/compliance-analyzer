/**
 * Asana Compliance Orchestrator.
 *
 * Top-level glue that decides which Asana side-effects to spawn for
 * a given compliance event. The orchestrator is the only module the
 * Netlify endpoints (decision hook, dispatch endpoint, cron jobs)
 * need to talk to — it composes the helper modules added in F1-F14
 * into a coherent set of create-task payloads.
 *
 * Pure compute. No I/O. The Netlify functions take the
 * `OrchestratedAsanaPlan` and translate each entry into a real
 * `createAsanaTask` call via the existing `asanaClient`.
 *
 * Why pure: testability. Every routing decision is deterministic
 * given the input event, so the regression suite can lock in the
 * full mapping table without mocking the Asana API.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO duty of care, four-eyes)
 *   FDL Art.24 (record reconstruction)
 *   FDL Art.26-27 (STR shape + without-delay filing)
 *   Cabinet Res 74/2020 Art.4-7 (24h freeze + 5d CNMR)
 *   Cabinet Res 134/2025 Art.5, Art.14, Art.19 (dynamic risk + EDD + review)
 *   Cabinet Decision 109/2023 (UBO)
 */

import {
  getTemplate,
  topoSort,
  type TemplateId,
  type TaskTemplate,
  type TaskTemplateNode,
} from './asanaTaskTemplateRegistry';
import {
  buildFourEyesPlan,
  type FourEyesDecisionType,
  type FourEyesPlan,
} from './asanaFourEyesAsTasks';
import { computeSla, type RegulatoryDeadlineKind, type SlaPlan } from './asanaSlaEnforcer';
import { routeDecisionToCustomFields, type RouterDecisionInput } from './asanaCustomFieldRouter';
import {
  buildReplayTaskNotes,
  type ReplayInput,
  type ReplayVerdict,
} from './asanaDecisionReplayPoster';
import {
  buildBreakglassTask,
  type BreakglassEvent,
  type BreakglassTrigger,
  type BreakglassTaskInput,
} from './asanaBreakglassChannel';

// ---------------------------------------------------------------------------
// Public input shape
// ---------------------------------------------------------------------------

export type OrchestrationEventKind =
  | 'decision_landed'
  | 'sanctions_match'
  | 'sanctioned_ubo'
  | 'freeze_initiated'
  | 'str_drafted'
  | 'edd_required'
  | 'ubo_change_detected'
  | 'drift_significant'
  | 'red_team_miss'
  | 'breach_detected'
  | 'audit_finding_logged'
  | 'policy_circular_detected'
  | 'weekly_digest';

export interface OrchestrationEvent {
  kind: OrchestrationEventKind;
  /** Tenant scope. */
  tenantId: string;
  /** ISO timestamp the event landed. */
  occurredAtIso: string;
  /** Stable identifier so re-runs are idempotent. */
  refId: string;
  /** The compliance decision that triggered this event, when applicable. */
  decision?: RouterDecisionInput & ReplayInput;
  /** Optional event-specific payload. */
  payload?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Public output shape
// ---------------------------------------------------------------------------

export interface OrchestratedAsanaTask {
  /** Stable id within the plan — used by the executor to express deps. */
  id: string;
  /** Asana task name (≤200 chars). */
  name: string;
  /** Markdown description. */
  notes: string;
  /** Suggested role — the executor resolves to a real assignee gid. */
  assigneeRole: TaskTemplateNode['assigneeRole'];
  /** ISO timestamp Asana should set as `due_at`. */
  dueAtIso: string;
  /** Other plan-internal ids that must complete before this one starts. */
  dependsOn: readonly string[];
  /** Severity tag applied to the task. */
  severity: TaskTemplateNode['severity'];
  /** Optional regulatory citation. */
  regulatory?: string;
  /** Optional template id this task originated from. */
  templateId?: TemplateId;
  /** Optional SLA plan attached to this task. */
  sla?: SlaPlan;
  /** Pre-computed custom field payload (orchestrator passes to asanaCustomFields builder). */
  customFields?: ReturnType<typeof routeDecisionToCustomFields>;
}

export interface OrchestratedAsanaPlan {
  /** The originating event. */
  event: OrchestrationEvent;
  /** The Asana project name to create / re-use. */
  projectName: string;
  /** Sections to ensure exist in the project, in display order. */
  sections: readonly string[];
  /** Tasks to create, in topological order. */
  tasks: readonly OrchestratedAsanaTask[];
  /** Optional four-eyes parent + subtasks plan. */
  fourEyes?: FourEyesPlan;
  /** Optional breakglass override — when set, the executor MUST also page on-call. */
  breakglass?: BreakglassTaskInput;
}

// ---------------------------------------------------------------------------
// Routing table
// ---------------------------------------------------------------------------

/**
 * Map every event kind onto the template it spawns. When a single
 * event needs multiple templates (e.g. a confirmed sanctions match
 * needs both `sanctions_freeze` and a four-eyes parent), the
 * orchestrator handles that explicitly below.
 */
const TEMPLATE_BY_EVENT: Partial<Record<OrchestrationEventKind, TemplateId>> = {
  str_drafted: 'str_filing',
  freeze_initiated: 'sanctions_freeze',
  sanctions_match: 'sanctions_freeze',
  sanctioned_ubo: 'sanctions_freeze',
  edd_required: 'edd_onboarding',
  ubo_change_detected: 'ubo_reverify',
  drift_significant: 'drift_incident',
  breach_detected: 'breach_response',
  audit_finding_logged: 'audit_findings',
  red_team_miss: 'red_team_miss',
  policy_circular_detected: 'policy_update',
  weekly_digest: 'weekly_digest',
};

const SLA_BY_EVENT: Partial<Record<OrchestrationEventKind, RegulatoryDeadlineKind>> = {
  freeze_initiated: 'eocn_freeze_24h',
  sanctions_match: 'eocn_freeze_24h',
  sanctioned_ubo: 'eocn_freeze_24h',
  str_drafted: 'str_without_delay',
  ubo_change_detected: 'ubo_15_working_days',
  policy_circular_detected: 'policy_update_30_days',
  audit_finding_logged: 'audit_finding_corrective',
  drift_significant: 'cdd_periodic_review',
};

const FOUR_EYES_BY_EVENT: Partial<Record<OrchestrationEventKind, FourEyesDecisionType>> = {
  str_drafted: 'str_filing',
  freeze_initiated: 'sanctions_freeze',
  sanctions_match: 'sanctions_freeze',
  sanctioned_ubo: 'sanctions_freeze',
  edd_required: 'edd_escalation',
};

const BREAKGLASS_BY_EVENT: Partial<Record<OrchestrationEventKind, BreakglassTrigger>> = {
  sanctioned_ubo: 'sanctioned_ubo',
  // We treat any "sanctions_match" event as "confirmed" only when the
  // event payload carries `confirmed: true` — see orchestrate() below.
  breach_detected: 'audit_chain_verification_failed',
};

// ---------------------------------------------------------------------------
// Orchestrate
// ---------------------------------------------------------------------------

function templateNodeToTask(
  node: TaskTemplateNode,
  template: TaskTemplate,
  startIso: string
): OrchestratedAsanaTask {
  const dueMs = new Date(startIso).getTime() + node.dueInHours * 60 * 60 * 1000;
  return {
    id: node.id,
    name: `[${template.id.toUpperCase()}] ${node.name}`,
    notes: node.notes,
    assigneeRole: node.assigneeRole,
    dueAtIso: new Date(dueMs).toISOString(),
    dependsOn: node.dependsOn,
    severity: node.severity,
    regulatory: node.regulatory,
    templateId: template.id,
  };
}

/**
 * Top-level entry. Given an OrchestrationEvent, returns the full
 * Asana plan the executor should apply.
 */
export function orchestrateAsanaForEvent(event: OrchestrationEvent): OrchestratedAsanaPlan {
  const templateId = TEMPLATE_BY_EVENT[event.kind];
  if (!templateId) {
    throw new Error(`orchestrateAsanaForEvent: unknown event kind ${event.kind}`);
  }
  const template = getTemplate(templateId);

  // Topologically sort the template nodes so the executor creates
  // them in dependency order.
  const order = topoSort(template);
  const nodeById = new Map(template.nodes.map((n) => [n.id, n]));
  const orderedTasks: OrchestratedAsanaTask[] = order.map((id) =>
    templateNodeToTask(nodeById.get(id)!, template, event.occurredAtIso)
  );

  // SLA enforcement on the first node when the event has a regulatory
  // deadline — propagate the SLA plan onto every task in the bundle.
  const slaKind = SLA_BY_EVENT[event.kind];
  if (slaKind) {
    const sla = computeSla({ startedAtIso: event.occurredAtIso, kind: slaKind });
    for (const t of orderedTasks) t.sla = sla;
  }

  // Custom fields + replay narrative when the event carries a decision.
  if (event.decision) {
    const cf = routeDecisionToCustomFields(event.decision);
    for (const t of orderedTasks) t.customFields = cf;
    // Replace the first task's notes with the decision-replay narrative
    // so the assignee sees the brain's reasoning at the top of the case.
    if (orderedTasks.length > 0) {
      orderedTasks[0] = {
        ...orderedTasks[0],
        notes: buildReplayTaskNotes(event.decision),
      };
    }
  }

  // Four-eyes parent + subtask plan when the event requires dual approval.
  let fourEyes: FourEyesPlan | undefined;
  const fourEyesKind = FOUR_EYES_BY_EVENT[event.kind];
  if (fourEyesKind) {
    fourEyes = buildFourEyesPlan({
      decisionId: event.refId,
      decisionType: fourEyesKind,
      title: event.kind.replace(/_/g, ' '),
      openedAtIso: event.occurredAtIso,
      notes: event.decision ? buildReplayTaskNotes(event.decision) : undefined,
    });
  }

  // Breakglass override: spawned in addition to the normal template
  // when the event matches a critical trigger.
  let breakglass: BreakglassTaskInput | undefined;
  const breakglassTrigger = BREAKGLASS_BY_EVENT[event.kind];
  const isConfirmedSanctions =
    event.kind === 'sanctions_match' && event.payload?.['confirmed'] === true;
  if (breakglassTrigger || isConfirmedSanctions) {
    const trigger: BreakglassTrigger = isConfirmedSanctions
      ? 'confirmed_sanctions_match'
      : (breakglassTrigger as BreakglassTrigger);
    const eventPayload: BreakglassEvent = {
      trigger,
      tenantId: event.tenantId,
      detectedAtIso: event.occurredAtIso,
      title: event.kind.replace(/_/g, ' '),
      details:
        event.decision?.auditNarrative ??
        `Event ${event.refId} fired the ${trigger} breakglass channel.`,
      decisionId: event.decision?.id,
    };
    breakglass = buildBreakglassTask(eventPayload);
  }

  return {
    event,
    projectName: template.projectName,
    sections: template.sections,
    tasks: orderedTasks,
    fourEyes,
    breakglass,
  };
}

// Re-export the verdict alias so consumers don't need to import from
// the replay poster directly.
export type { ReplayVerdict };
