/**
 * Asana Breakglass Channel — F12.
 *
 * Emergency-only path for critical compliance events. The orchestrator
 * routes the most severe events through this module so they land in
 * a dedicated "Break Glass" project with @-mention paging and a
 * 15-minute first-response SLA.
 *
 * Triggers (in order of severity):
 *   - Sanctioned beneficial owner detected (Cabinet Decision 109/2023)
 *   - Confirmed sanctions match (≥0.9 confidence)
 *   - Audit chain anchor verification failed
 *   - Multiple subsystem failures in a single decision
 *   - Brain itself failed catastrophically
 *
 * Pure compute. The orchestrator handles the actual @-mention via
 * asanaClient.
 *
 * Regulatory basis:
 *   Cabinet Res 74/2020 Art.4-7 (24h freeze)
 *   FDL Art.20 (CO duty of care)
 *   FDL Art.24 (audit chain integrity)
 */

export type BreakglassTrigger =
  | 'sanctioned_ubo'
  | 'confirmed_sanctions_match'
  | 'audit_chain_verification_failed'
  | 'multiple_subsystem_failures'
  | 'brain_catastrophic_failure';

export interface BreakglassEvent {
  trigger: BreakglassTrigger;
  /** Tenant scope. */
  tenantId: string;
  /** ISO timestamp the event landed. */
  detectedAtIso: string;
  /** Short title — surfaces directly in the Asana task name. */
  title: string;
  /** Plain-English context for the on-call MLRO. */
  details: string;
  /** Optional decision id this event relates to. */
  decisionId?: string;
}

export interface BreakglassTaskInput {
  /** Asana task name (limited to 200 chars by Asana). */
  name: string;
  /** Markdown task description. */
  notes: string;
  /** ISO timestamp the on-call must respond by (15 min for criticals). */
  dueAtIso: string;
  /** True for the most severe triggers — the orchestrator pages on-call. */
  pageOnCall: boolean;
  /** Asana custom-field-friendly severity tag. */
  severity: 'high' | 'critical';
  /** Regulatory citation displayed alongside the task. */
  regulatory: string;
}

const REG_BY_TRIGGER: Record<BreakglassTrigger, string> = {
  sanctioned_ubo: 'Cabinet Decision 109/2023; Cabinet Res 74/2020 Art.4-7',
  confirmed_sanctions_match: 'Cabinet Res 74/2020 Art.4-7; FDL Art.22',
  audit_chain_verification_failed: 'FDL No.10/2025 Art.24',
  multiple_subsystem_failures: 'FDL Art.20-21',
  brain_catastrophic_failure: 'FDL Art.20-21',
};

const SEV_BY_TRIGGER: Record<BreakglassTrigger, BreakglassTaskInput['severity']> = {
  sanctioned_ubo: 'critical',
  confirmed_sanctions_match: 'critical',
  audit_chain_verification_failed: 'critical',
  multiple_subsystem_failures: 'high',
  brain_catastrophic_failure: 'critical',
};

const PAGE_BY_TRIGGER: Record<BreakglassTrigger, boolean> = {
  sanctioned_ubo: true,
  confirmed_sanctions_match: true,
  audit_chain_verification_failed: true,
  multiple_subsystem_failures: false,
  brain_catastrophic_failure: true,
};

export function buildBreakglassTask(event: BreakglassEvent): BreakglassTaskInput {
  // 15 minutes for critical pageable events; 1 hour otherwise.
  const isCritical = SEV_BY_TRIGGER[event.trigger] === 'critical';
  const dueMs = new Date(event.detectedAtIso).getTime() + (isCritical ? 15 : 60) * 60 * 1000;
  const notes =
    `**Trigger:** ${event.trigger}\n` +
    `**Tenant:** ${event.tenantId}\n` +
    `**Detected at:** ${event.detectedAtIso}\n` +
    (event.decisionId ? `**Decision id:** ${event.decisionId}\n` : '') +
    `\n${event.details}\n\n` +
    `_Regulatory basis: ${REG_BY_TRIGGER[event.trigger]}._\n\n` +
    `Do NOT contact the subject. Document every decision in the audit chain (FDL Art.24).`;
  return {
    name: `🚨 BREAK GLASS — ${event.title}`.slice(0, 200),
    notes,
    dueAtIso: new Date(dueMs).toISOString(),
    pageOnCall: PAGE_BY_TRIGGER[event.trigger],
    severity: SEV_BY_TRIGGER[event.trigger],
    regulatory: REG_BY_TRIGGER[event.trigger],
  };
}
