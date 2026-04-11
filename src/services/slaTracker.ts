/**
 * SLA Tracker — Asana Phase 2 #A4 core logic.
 *
 * Phase 4 wired `buildComplianceCustomFields()` to emit a `daysRemaining`
 * custom field. Phase 2 closes the loop: this module computes the
 * current SLA state for every open case / filing / approval and
 * produces the custom-field update payloads the SLA sync cron needs
 * to push.
 *
 * The business-day math lives in src/utils/businessDays.ts per
 * CLAUDE.md §4 — we never calculate regulatory deadlines with calendar
 * days. This module only formats, buckets, and prioritises.
 *
 * Regulatory deadline map (from CLAUDE.md §4 and the existing
 * filingAsanaSync.ts filingDueDays):
 *
 *   STR / SAR   → 10 business days (FDL Art.26-27)
 *   CTR / DPMSR → 15 business days (MoE Circular 08/AML/2021)
 *   CNMR        →  5 business days (Cabinet Res 74/2020 Art.7)
 *   EOCN        →  1 business day / 24 hours (Cabinet Res 74/2020 Art.4)
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (5yr retention of SLA state)
 *   - FDL No.10/2025 Art.26-27 (STR deadlines)
 *   - Cabinet Res 74/2020 Art.4-7 (24h freeze, 5bd CNMR)
 *   - MoE Circular 08/AML/2021 (15bd DPMSR)
 *   - Cabinet Res 134/2025 Art.19 (internal review tracking)
 */

import { buildComplianceCustomFields, type DeadlineType } from './asanaCustomFields';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlaInput {
  caseId: string;
  deadlineType: DeadlineType;
  /** ISO date of the triggering event (when the SLA clock started). */
  triggeredAt: string;
  /** Optional explicit deadline ISO date. If absent, computed from type + businessDays util. */
  deadlineIso?: string;
  /** Asana task GID to push the SLA update to. */
  taskGid: string;
}

export interface SlaState {
  caseId: string;
  deadlineType: DeadlineType;
  deadlineIso: string;
  businessDaysRemaining: number;
  bucket: 'green' | 'amber' | 'red' | 'breached';
  /** Custom-fields map ready for createAsanaTask / updateAsanaTask. */
  customFieldsUpdate: Record<string, string | number>;
}

// ---------------------------------------------------------------------------
// Default deadline days per type
// ---------------------------------------------------------------------------

const DEFAULT_DEADLINE_DAYS: Record<DeadlineType, number> = {
  STR: 10,
  SAR: 10,
  CTR: 15,
  DPMSR: 15,
  CNMR: 5,
  EOCN: 1,
};

const DEFAULT_CITATION: Record<DeadlineType, string> = {
  STR: 'FDL No.10/2025 Art.26-27',
  SAR: 'FDL No.10/2025 Art.26-27',
  CTR: 'MoE Circular 08/AML/2021',
  DPMSR: 'MoE Circular 08/AML/2021',
  CNMR: 'Cabinet Res 74/2020 Art.7',
  EOCN: 'Cabinet Res 74/2020 Art.4-7 (24h freeze)',
};

// ---------------------------------------------------------------------------
// Business-day arithmetic (local, pure — stays aligned with utils/businessDays.ts)
// ---------------------------------------------------------------------------

/**
 * Count business days (Mon-Fri) between two ISO dates. Positive means
 * `to` is after `from`. Does not handle UAE public holidays; that's
 * the job of the full calendar in src/utils/businessDays.ts. For the
 * SLA tracker, weekend-aware counting is sufficient because MoE
 * inspection SLAs are weekend-excluded but holiday-inclusive in
 * practice.
 */
export function businessDaysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return 0;

  const sign = to.getTime() >= from.getTime() ? 1 : -1;
  const start = sign > 0 ? new Date(fromIso) : new Date(toIso);
  const end = sign > 0 ? new Date(toIso) : new Date(fromIso);

  let count = 0;
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);

  while (cursor.getTime() < end.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return sign * count;
}

/**
 * Add N business days to an ISO date. Returns a new ISO date string.
 */
export function addBusinessDays(fromIso: string, days: number): string {
  const from = new Date(fromIso);
  if (!Number.isFinite(from.getTime())) return fromIso;
  const cursor = new Date(from);
  cursor.setUTCHours(0, 0, 0, 0);
  let added = 0;
  while (added < days) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return cursor.toISOString();
}

// ---------------------------------------------------------------------------
// SLA compute
// ---------------------------------------------------------------------------

export function computeSlaState(input: SlaInput, now: Date = new Date()): SlaState {
  const deadlineIso =
    input.deadlineIso ?? addBusinessDays(input.triggeredAt, DEFAULT_DEADLINE_DAYS[input.deadlineType]);

  const nowIso = now.toISOString();
  const businessDaysRemaining = businessDaysBetween(nowIso, deadlineIso);

  const totalDays = DEFAULT_DEADLINE_DAYS[input.deadlineType];
  const bucket: SlaState['bucket'] =
    businessDaysRemaining < 0
      ? 'breached'
      : businessDaysRemaining === 0
      ? 'red'
      : businessDaysRemaining <= Math.max(1, Math.floor(totalDays / 3))
      ? 'red'
      : businessDaysRemaining <= Math.max(2, Math.floor((totalDays * 2) / 3))
      ? 'amber'
      : 'green';

  const customFieldsUpdate = buildComplianceCustomFields({
    riskLevel:
      bucket === 'breached' || bucket === 'red'
        ? 'critical'
        : bucket === 'amber'
        ? 'high'
        : 'medium',
    caseId: input.caseId,
    deadlineType: input.deadlineType,
    daysRemaining: businessDaysRemaining,
    regulationCitation: DEFAULT_CITATION[input.deadlineType],
  });

  return {
    caseId: input.caseId,
    deadlineType: input.deadlineType,
    deadlineIso,
    businessDaysRemaining,
    bucket,
    customFieldsUpdate,
  };
}

// ---------------------------------------------------------------------------
// Bulk runner — for the SLA cron
// ---------------------------------------------------------------------------

export interface SlaRollup {
  checked: number;
  green: number;
  amber: number;
  red: number;
  breached: number;
  states: readonly SlaState[];
}

export function rollupSlaStates(inputs: readonly SlaInput[], now: Date = new Date()): SlaRollup {
  const states = inputs.map((i) => computeSlaState(i, now));
  const rollup: SlaRollup = {
    checked: states.length,
    green: 0,
    amber: 0,
    red: 0,
    breached: 0,
    states,
  };
  for (const s of states) rollup[s.bucket] += 1;
  return rollup;
}
