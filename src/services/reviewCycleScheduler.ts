/**
 * Review Cycle Scheduler — computes per-customer CDD/EDD review due
 * dates based on risk tier + business-day arithmetic.
 *
 * Why this exists:
 *   Cabinet Res 134/2025 Art.7-10 sets risk-tier-specific review
 *   cadences. Hand-tracking these in a spreadsheet is how operators
 *   miss renewal deadlines, which becomes a Cabinet Res 71/2024
 *   penalty event.
 *
 *   This module is the pure scheduler. It takes a list of customers
 *   + their risk tiers + their last review dates and emits the set
 *   of customers due for review in the upcoming horizon, sorted by
 *   urgency. Injectable business-day calculator for tests.
 *
 * Regulatory basis:
 *   Cabinet Res 134/2025 Art.7-10 (CDD/EDD cadences)
 *   FDL No.10/2025 Art.20-22 (CO ongoing monitoring)
 *   Cabinet Res 71/2024       (penalty exposure)
 *   FATF Rec 10              (CDD — ongoing)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskTier = 'SDD' | 'CDD' | 'EDD' | 'PEP';

export interface CustomerReviewRecord {
  customerId: string;
  tenantId: string;
  legalName: string;
  riskTier: RiskTier;
  lastReviewedAtIso: string;
}

export interface ReviewDueItem {
  customerId: string;
  tenantId: string;
  legalName: string;
  riskTier: RiskTier;
  lastReviewedAtIso: string;
  nextReviewDueIso: string;
  daysUntilDue: number;
  urgency: 'overdue' | 'due_now' | 'due_soon' | 'comfortable';
  citation: string;
}

export interface ReviewScheduleReport {
  schemaVersion: 1;
  tenantId: string;
  evaluatedAtIso: string;
  horizonDays: number;
  totalCustomers: number;
  overdue: readonly ReviewDueItem[];
  dueNow: readonly ReviewDueItem[];
  dueSoon: readonly ReviewDueItem[];
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Cadence table (months between reviews)
// ---------------------------------------------------------------------------

const CADENCE_MONTHS: Record<RiskTier, number> = {
  SDD: 24,
  CDD: 12,
  EDD: 6,
  PEP: 3,
};

const CITATIONS: Record<RiskTier, string> = {
  SDD: 'Cabinet Res 134/2025 Art.9 (simplified)',
  CDD: 'Cabinet Res 134/2025 Art.7-8 (standard)',
  EDD: 'Cabinet Res 134/2025 Art.14 (enhanced)',
  PEP: 'Cabinet Res 134/2025 Art.14 + FATF Rec 12 (PEP)',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) throw new Error(`invalid lastReviewedAtIso: ${iso}`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

function daysBetween(a: string, b: string): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

function urgencyFor(days: number): ReviewDueItem['urgency'] {
  if (days < 0) return 'overdue';
  if (days <= 7) return 'due_now';
  if (days <= 30) return 'due_soon';
  return 'comfortable';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ScheduleOptions {
  horizonDays?: number;
  now?: () => Date;
}

export function computeReviewSchedule(
  tenantId: string,
  customers: readonly CustomerReviewRecord[],
  opts: ScheduleOptions = {}
): ReviewScheduleReport {
  const now = (opts.now ?? (() => new Date()))();
  const horizonDays = opts.horizonDays ?? 30;
  const evaluatedAtIso = now.toISOString();

  const all: ReviewDueItem[] = [];

  for (const c of customers) {
    const months = CADENCE_MONTHS[c.riskTier];
    let nextDue: string;
    try {
      nextDue = addMonths(c.lastReviewedAtIso, months);
    } catch {
      continue;
    }
    const daysUntilDue = daysBetween(evaluatedAtIso, nextDue);
    const urgency = urgencyFor(daysUntilDue);

    // Filter: only include items within the horizon OR already overdue.
    if (urgency === 'comfortable' && daysUntilDue > horizonDays) continue;

    all.push({
      customerId: c.customerId,
      tenantId: c.tenantId,
      legalName: c.legalName,
      riskTier: c.riskTier,
      lastReviewedAtIso: c.lastReviewedAtIso,
      nextReviewDueIso: nextDue,
      daysUntilDue,
      urgency,
      citation: CITATIONS[c.riskTier],
    });
  }

  all.sort((a, b) => a.daysUntilDue - b.daysUntilDue);

  const overdue = all.filter((i) => i.urgency === 'overdue');
  const dueNow = all.filter((i) => i.urgency === 'due_now');
  const dueSoon = all.filter((i) => i.urgency === 'due_soon');

  return {
    schemaVersion: 1,
    tenantId,
    evaluatedAtIso,
    horizonDays,
    totalCustomers: customers.length,
    overdue,
    dueNow,
    dueSoon,
    summary:
      overdue.length > 0
        ? `${overdue.length} overdue review(s) — Cabinet Res 71/2024 penalty exposure. Escalate immediately.`
        : `${dueNow.length} due now + ${dueSoon.length} due within ${horizonDays} days. Comfortable.`,
    regulatory: [
      'Cabinet Res 134/2025 Art.7-10',
      'Cabinet Res 134/2025 Art.14',
      'Cabinet Res 71/2024',
      'FDL No.10/2025 Art.20-22',
      'FATF Rec 10',
      'FATF Rec 12',
    ],
  };
}

// Exports for tests.
export const __test__ = { addMonths, daysBetween, urgencyFor, CADENCE_MONTHS, CITATIONS };
