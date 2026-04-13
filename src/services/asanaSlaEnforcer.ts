/**
 * Asana SLA Enforcer — F2.
 *
 * Given a task tied to a regulatory deadline (24h EOCN freeze, 5d
 * CNMR, 10d STR, 15d UBO re-verify, 30d policy update), this module
 * decides:
 *
 *   1. The Asana `due_at` ISO timestamp.
 *   2. The pre-deadline reminder time (T-2h for ≤24h SLAs, T-1d for
 *      ≤7d, T-3d otherwise).
 *   3. The escalation tier when a task crosses its deadline.
 *
 * Pure compute — no I/O. The orchestrator passes the resulting
 * `SlaPlan` to `asanaClient.createAsanaTask` + a follow-up reminder.
 *
 * Regulatory basis:
 *   Cabinet Res 74/2020 Art.4 (24h EOCN freeze)
 *   Cabinet Res 74/2020 Art.6 (5 business day CNMR)
 *   FDL Art.26-27 (STR without delay)
 *   Cabinet Decision 109/2023 (15 working days UBO)
 *   CLAUDE.md "30 days: Policy update deadline after new MoE circular"
 */

export type RegulatoryDeadlineKind =
  | 'eocn_freeze_24h'
  | 'cnmr_5_business_days'
  | 'str_without_delay'
  | 'ctr_15_business_days'
  | 'ubo_15_working_days'
  | 'policy_update_30_days'
  | 'cdd_periodic_review'
  | 'audit_finding_corrective';

export interface SlaInput {
  /** ISO timestamp the clock starts (e.g. confirmation timestamp). */
  startedAtIso: string;
  kind: RegulatoryDeadlineKind;
  /** Optional override of the default duration. */
  overrideHours?: number;
}

export interface SlaPlan {
  kind: RegulatoryDeadlineKind;
  startedAtIso: string;
  /** Asana `due_at` value. */
  dueAtIso: string;
  /** When to fire the "you have N hours left" reminder. */
  reminderAtIso: string;
  /** Severity to apply if breached. */
  breachSeverity: 'medium' | 'high' | 'critical';
  /** Plain-English description of the deadline for task notes. */
  description: string;
  /** Regulatory citation. */
  regulatory: string;
  /** True when the deadline is measured in clock hours, not business days. */
  clockHours: boolean;
}

const DEFAULT_HOURS: Record<RegulatoryDeadlineKind, number> = {
  eocn_freeze_24h: 24,
  cnmr_5_business_days: 5 * 24, // worst case — orchestrator may pass a business-day-aware override
  str_without_delay: 4,
  ctr_15_business_days: 15 * 24,
  ubo_15_working_days: 15 * 24,
  policy_update_30_days: 30 * 24,
  cdd_periodic_review: 30 * 24,
  audit_finding_corrective: 14 * 24,
};

const REGULATORY: Record<RegulatoryDeadlineKind, string> = {
  eocn_freeze_24h: 'Cabinet Res 74/2020 Art.4-7 — 24-hour freeze',
  cnmr_5_business_days: 'Cabinet Res 74/2020 Art.6 — 5 business day CNMR filing',
  str_without_delay: 'FDL No.10/2025 Art.26-27 — STR without delay',
  ctr_15_business_days: 'MoE Circular 08/AML/2021 — 15 business day CTR filing',
  ubo_15_working_days: 'Cabinet Decision 109/2023 — 15 working day UBO re-verification',
  policy_update_30_days: 'CLAUDE.md "30 days: Policy update deadline after new MoE circular"',
  cdd_periodic_review: 'Cabinet Res 134/2025 Art.13 — periodic CDD review',
  audit_finding_corrective: 'Internal — corrective action SLA',
};

const SEVERITY: Record<RegulatoryDeadlineKind, SlaPlan['breachSeverity']> = {
  eocn_freeze_24h: 'critical',
  cnmr_5_business_days: 'critical',
  str_without_delay: 'critical',
  ctr_15_business_days: 'high',
  ubo_15_working_days: 'high',
  policy_update_30_days: 'medium',
  cdd_periodic_review: 'medium',
  audit_finding_corrective: 'high',
};

function reminderOffsetHours(totalHours: number): number {
  if (totalHours <= 24) return Math.max(2, totalHours / 12); // ≥2h before due
  if (totalHours <= 7 * 24) return 24;
  return 3 * 24;
}

export function computeSla(input: SlaInput): SlaPlan {
  const hours = input.overrideHours ?? DEFAULT_HOURS[input.kind];
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error(`computeSla: invalid hours for ${input.kind}: ${hours}`);
  }
  const startMs = new Date(input.startedAtIso).getTime();
  if (!Number.isFinite(startMs)) {
    throw new Error(`computeSla: invalid startedAtIso: ${input.startedAtIso}`);
  }
  const dueMs = startMs + hours * 60 * 60 * 1000;
  const reminderHours = reminderOffsetHours(hours);
  const reminderMs = dueMs - reminderHours * 60 * 60 * 1000;
  return {
    kind: input.kind,
    startedAtIso: new Date(startMs).toISOString(),
    dueAtIso: new Date(dueMs).toISOString(),
    reminderAtIso: new Date(reminderMs).toISOString(),
    breachSeverity: SEVERITY[input.kind],
    description: `Deadline: ${REGULATORY[input.kind]}. Reminder fires ${reminderHours}h before due.`,
    regulatory: REGULATORY[input.kind],
    clockHours: input.kind === 'eocn_freeze_24h',
  };
}

/**
 * Decide whether an in-flight task has breached its SLA. Returns the
 * minutes overdue (positive) or remaining (negative) plus a severity
 * recommendation that the orchestrator translates into a follow-up
 * task or a breakglass escalation.
 */
export function evaluateSlaStatus(
  plan: SlaPlan,
  nowIso: string = new Date().toISOString()
): {
  status: 'on-time' | 'reminder-window' | 'breached';
  minutesUntilDue: number;
  severity: SlaPlan['breachSeverity'] | 'low';
} {
  const dueMs = new Date(plan.dueAtIso).getTime();
  const reminderMs = new Date(plan.reminderAtIso).getTime();
  const nowMs = new Date(nowIso).getTime();
  const minutesUntilDue = Math.round((dueMs - nowMs) / 60_000);
  if (nowMs >= dueMs) {
    return { status: 'breached', minutesUntilDue, severity: plan.breachSeverity };
  }
  if (nowMs >= reminderMs) {
    return { status: 'reminder-window', minutesUntilDue, severity: plan.breachSeverity };
  }
  return { status: 'on-time', minutesUntilDue, severity: 'low' };
}
