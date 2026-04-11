/**
 * Scheduled Compliance Reports — OCA-inspired scheduled report runner.
 *
 * Defines the canonical set of scheduled compliance reports the DPMS
 * operator must run on a cadence, computes the next run time, and
 * returns a ready-to-dispatch task list. Inspired by OCA/reporting-
 * engine's scheduled-actions pattern: declarative definitions + cron
 * evaluation + dispatch.
 *
 * No actual cron runner here — that's provided by GitHub Actions +
 * Netlify scheduled functions. This module just declares what, when,
 * and what regulation it satisfies.
 *
 * Regulatory basis:
 *   - MoE Circular 08/AML/2021 (quarterly DPMSR — AED 55K threshold)
 *   - FDL No.10/2025 Art.24 (5yr retention of scheduled outputs)
 *   - Cabinet Res 134/2025 Art.19 (periodic internal review)
 *   - FATF Rec 20 (timely STR filing)
 *   - LBMA RGG v9 (annual responsible-gold audit)
 *   - Cabinet Decision 109/2023 (UBO re-verification scheduling)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Cadence = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';

export interface ScheduledReportDefinition {
  id: string;
  name: string;
  cadence: Cadence;
  /** Human-readable reason why the report exists. */
  purpose: string;
  citation: string;
  /** Output formats the report generates. */
  outputs: ReadonlyArray<'html' | 'json' | 'markdown' | 'xlsx' | 'pdf' | 'goaml_xml'>;
  /** Which Asana project / recipient should receive the output. */
  dispatchTo: 'mlro' | 'compliance_project' | 'regulator_portal' | 'cold_storage';
}

export interface ScheduledRunPlan {
  reportId: string;
  nextRunIso: string;
  overdueBy?: number; // days
}

// ---------------------------------------------------------------------------
// Canonical schedule
// ---------------------------------------------------------------------------

export const SCHEDULED_REPORTS: readonly ScheduledReportDefinition[] = [
  {
    id: 'daily_screening_heartbeat',
    name: 'Daily screening heartbeat',
    cadence: 'daily',
    purpose: 'Screen all customers against sanctions lists + adverse media',
    citation: 'FATF Rec 10 + Cabinet Res 134/2025 Art.19',
    outputs: ['html', 'json', 'markdown'],
    dispatchTo: 'compliance_project',
  },
  {
    id: 'weekly_sla_rollup',
    name: 'Weekly SLA rollup',
    cadence: 'weekly',
    purpose: 'Report every open case + filing with days-remaining bucket',
    citation: 'Cabinet Res 134/2025 Art.19',
    outputs: ['xlsx', 'json'],
    dispatchTo: 'mlro',
  },
  {
    id: 'monthly_ubo_reverification',
    name: 'Monthly UBO re-verification',
    cadence: 'monthly',
    purpose: 'Re-verify UBO disclosure for all customers whose data is older than 15 working days',
    citation: 'Cabinet Decision 109/2023',
    outputs: ['xlsx', 'html'],
    dispatchTo: 'compliance_project',
  },
  {
    id: 'quarterly_dpmsr',
    name: 'Quarterly DPMS return (MoE)',
    cadence: 'quarterly',
    purpose: 'DPMS quarterly report covering all AED 55K+ cash transactions',
    citation: 'MoE Circular 08/AML/2021 + FDL No.10/2025 Art.26-27',
    outputs: ['goaml_xml', 'xlsx', 'pdf'],
    dispatchTo: 'regulator_portal',
  },
  {
    id: 'quarterly_kpi_report',
    name: 'Quarterly 30-KPI compliance report',
    cadence: 'quarterly',
    purpose: '30-KPI rollup per the MoE DPMS framework',
    citation: 'MoE Circular 08/AML/2021',
    outputs: ['xlsx', 'html', 'pdf'],
    dispatchTo: 'mlro',
  },
  {
    id: 'annual_lbma_audit',
    name: 'Annual LBMA Responsible Gold Guidance audit',
    cadence: 'annual',
    purpose: 'LBMA RGG v9 5-step framework annual audit pack',
    citation: 'LBMA Responsible Gold Guidance v9',
    outputs: ['xlsx', 'pdf', 'html'],
    dispatchTo: 'regulator_portal',
  },
  {
    id: 'annual_model_card',
    name: 'Annual AI Governance model card',
    cadence: 'annual',
    purpose: 'EU AI Act Art.11 + Annex IV technical documentation refresh',
    citation: 'EU Reg 2024/1689 Art.11',
    outputs: ['markdown', 'json'],
    dispatchTo: 'cold_storage',
  },
];

// ---------------------------------------------------------------------------
// Next-run calculator
// ---------------------------------------------------------------------------

export function computeNextRun(
  cadence: Cadence,
  from: Date = new Date()
): string {
  const next = new Date(from);
  next.setUTCHours(0, 0, 0, 0);
  switch (cadence) {
    case 'daily':
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case 'weekly': {
      // Next Monday
      const dow = next.getUTCDay();
      const daysToAdd = dow === 0 ? 1 : (8 - dow) % 7 || 7;
      next.setUTCDate(next.getUTCDate() + daysToAdd);
      break;
    }
    case 'monthly':
      next.setUTCMonth(next.getUTCMonth() + 1, 1);
      break;
    case 'quarterly': {
      const month = next.getUTCMonth();
      const nextQuarterStart = Math.floor(month / 3) * 3 + 3;
      next.setUTCMonth(nextQuarterStart, 1);
      break;
    }
    case 'annual':
      next.setUTCFullYear(next.getUTCFullYear() + 1, 0, 1);
      break;
  }
  return next.toISOString();
}

// ---------------------------------------------------------------------------
// Plan builder
// ---------------------------------------------------------------------------

export interface PlanInput {
  lastRunAt: Readonly<Record<string, string>>; // reportId → last ISO
  now?: Date;
}

export function buildRunPlan(input: PlanInput): ScheduledRunPlan[] {
  const now = input.now ?? new Date();
  const plans: ScheduledRunPlan[] = [];
  for (const def of SCHEDULED_REPORTS) {
    const lastRun = input.lastRunAt[def.id];
    if (!lastRun) {
      // Never run — due now.
      plans.push({ reportId: def.id, nextRunIso: now.toISOString(), overdueBy: Infinity });
      continue;
    }
    const nextFromLast = computeNextRun(def.cadence, new Date(lastRun));
    const nextMs = Date.parse(nextFromLast);
    const diffDays = (now.getTime() - nextMs) / 86_400_000;
    plans.push({
      reportId: def.id,
      nextRunIso: nextFromLast,
      overdueBy: diffDays > 0 ? Math.floor(diffDays) : undefined,
    });
  }
  return plans;
}
