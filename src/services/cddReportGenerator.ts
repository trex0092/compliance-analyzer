/**
 * Weekly CDD Status Report Generator.
 *
 * Produces the Monday-morning report consumed by the MLRO and by the
 * Claude Code "Weekly CDD Status Report" routine. Pure functions only:
 * all inputs are passed explicitly so the report is deterministic,
 * unit-testable, and cheap to re-run.
 *
 * Report answers five questions:
 *   1. How many customers are on SDD / CDD / EDD right now?
 *   2. Which CDD reviews are overdue or due within the next 30 days?
 *   3. Which PEP / EDD cases are pending Senior Management approval?
 *   4. Filing snapshot: STRs / CTRs / DPMSRs / CNMRs filed this week,
 *      plus any overdue filings flagged by businessDays.checkDeadline.
 *   5. Sanctions matches resolved within the past 7 days.
 *
 * The generator intentionally does NOT perform I/O — the Netlify cron
 * in netlify/functions/cdd-weekly-status-cron.mts is responsible for
 * loading data and dispatching the output. This module stays pure so
 * tests can pin every field without mocking network calls.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.12-14 (CDD tiers, review cadence)
 *   - FDL No.10/2025 Art.14   (PEP enhanced due diligence)
 *   - FDL No.10/2025 Art.24   (record retention, audit trail)
 *   - FDL No.10/2025 Art.26-27 (STR / CTR filing obligations)
 *   - FDL No.10/2025 Art.29   (no tipping off — report is internal only)
 *   - Cabinet Res 134/2025 Art.5 (risk appetite)
 *   - Cabinet Res 134/2025 Art.7-10 (CDD tiers)
 *   - Cabinet Res 134/2025 Art.14 (Senior Management approval for PEP/EDD)
 *   - Cabinet Res 134/2025 Art.19 (internal review cadence)
 *   - Cabinet Res 74/2020 Art.6 (CNMR 5 business days)
 *   - MoE Circular 08/AML/2021 (DPMSR quarterly / CTR 15 business days)
 */

import type { CustomerProfile } from '../domain/customers';
import type { PeriodicReviewSchedule } from '../domain/periodicReview';
import { checkReviewStatus } from '../domain/periodicReview';
import type { ApprovalRequest } from '../domain/approvals';
import type { FilingRecord } from './screeningComplianceReport';
import type { ScreeningRun } from '../domain/screening';
import { checkDeadline } from '../utils/businessDays';
import { formatDateDDMMYYYY } from '../utils/dates';
import {
  CDD_REVIEW_HIGH_RISK_MONTHS,
  CDD_REVIEW_MEDIUM_RISK_MONTHS,
  CDD_REVIEW_LOW_RISK_MONTHS,
  STR_FILING_DEADLINE_BUSINESS_DAYS,
  CTR_FILING_DEADLINE_BUSINESS_DAYS,
  CNMR_FILING_DEADLINE_BUSINESS_DAYS,
} from '../domain/constants';

// ─── Tier mapping ───────────────────────────────────────────────────────────

/**
 * Map `CustomerProfile.riskRating` to the CDD tier the UAE AML regime
 * assigns to that risk level (FDL Art.12-14, Cabinet Res 134/2025 Art.7-10).
 */
export type CddTier = 'SDD' | 'CDD' | 'EDD';

export function tierForRiskRating(rating: CustomerProfile['riskRating']): CddTier {
  if (rating === 'high') return 'EDD';
  if (rating === 'medium') return 'CDD';
  return 'SDD';
}

// ─── Report types ───────────────────────────────────────────────────────────

export interface CddTierRollup {
  sdd: number;
  cdd: number;
  edd: number;
  total: number;
}

export interface OverdueReview {
  customerId: string;
  customerName: string;
  tier: CddTier;
  nextReviewDate: string; // ISO
  status: 'overdue' | 'due';
}

export interface PendingApproval {
  approvalId: string;
  caseId: string;
  requiredFor: ApprovalRequest['requiredFor'];
  requestedAt: string; // ISO
  requestedBy: string;
  urgency: ApprovalRequest['urgency'];
  ageInDays: number;
}

export interface FilingThisWeek {
  filingType: FilingRecord['filingType'];
  referenceNumber: string;
  filingDate: string; // ISO
  status: FilingRecord['status'];
  deadlineMet: boolean;
}

export interface OverdueFiling {
  filingType: FilingRecord['filingType'];
  referenceNumber: string;
  filingDate: string; // ISO of triggering event
  businessDaysElapsed: number;
  deadlineBusinessDays: number;
}

export interface FilingSnapshot {
  countsByType: Record<FilingRecord['filingType'], number>;
  filedThisWeek: FilingThisWeek[];
  overdue: OverdueFiling[];
}

export interface SanctionsResolution {
  runId: string;
  subjectType: ScreeningRun['subjectType'];
  subjectId: string;
  executedAt: string; // ISO
  resolution: string;
  analyst: string;
}

export interface WeeklyCddReportInput {
  /** Fixed "now" for deterministic output and testing. */
  now: Date;
  /** All customers in scope. */
  customers: ReadonlyArray<CustomerProfile>;
  /** Review schedules. Keyed off customerId. */
  reviewSchedules: ReadonlyArray<PeriodicReviewSchedule>;
  /** Open approval requests (pending, approved, or rejected). */
  approvals: ReadonlyArray<ApprovalRequest>;
  /** Filings recorded in the system. Week-in-review + overdue logic applied. */
  filings: ReadonlyArray<FilingRecord>;
  /** Screening runs resolved in any outcome. Week-in-review applied. */
  screeningRuns: ReadonlyArray<ScreeningRun>;
  /**
   * Names of data sources NOT yet wired into a persistence layer.
   * Surfaced as a loud "INCOMPLETE BRIEFING" banner so the MLRO does
   * not infer "all clear" from a wiring gap (FDL Art.20-22).
   */
  unwiredDataSources?: ReadonlyArray<string>;
}

export interface WeeklyCddReport {
  generatedAtIso: string;
  windowFromIso: string;
  windowToIso: string;
  tierRollup: CddTierRollup;
  overdueReviews: OverdueReview[];
  pendingApprovals: PendingApproval[];
  filingSnapshot: FilingSnapshot;
  sanctionsResolvedThisWeek: SanctionsResolution[];
  unwiredDataSources: ReadonlyArray<string>;
  /** Regulatory citations this report attests to. */
  citations: ReadonlyArray<string>;
}

// ─── Builder ────────────────────────────────────────────────────────────────

const SEVEN_DAYS_MS = 7 * 86_400_000;
const APPROVALS_RELEVANT_FOR: ReadonlyArray<ApprovalRequest['requiredFor']> = [
  'pep-onboarding',
  'high-risk-onboarding',
  'edd-continuation',
];
const FILING_TYPES: ReadonlyArray<FilingRecord['filingType']> = [
  'STR',
  'SAR',
  'CTR',
  'DPMSR',
  'CNMR',
  'EOCN_FREEZE',
];

function deadlineForFilingType(type: FilingRecord['filingType']): number | null {
  switch (type) {
    case 'STR':
    case 'SAR':
      return STR_FILING_DEADLINE_BUSINESS_DAYS;
    case 'CTR':
    case 'DPMSR':
      return CTR_FILING_DEADLINE_BUSINESS_DAYS;
    case 'CNMR':
      return CNMR_FILING_DEADLINE_BUSINESS_DAYS;
    case 'EOCN_FREEZE':
      // EOCN freeze is a 24h clock, not business days. Not covered by this
      // snapshot — see checkEOCNDeadline in businessDays.ts.
      return null;
  }
}

export function buildWeeklyCddReport(input: WeeklyCddReportInput): WeeklyCddReport {
  const { now, customers, reviewSchedules, approvals, filings, screeningRuns } = input;
  const windowFromIso = new Date(now.getTime() - SEVEN_DAYS_MS).toISOString();
  const windowToIso = now.toISOString();

  // 1) Tier rollup.
  const tierRollup: CddTierRollup = { sdd: 0, cdd: 0, edd: 0, total: 0 };
  for (const c of customers) {
    const tier = tierForRiskRating(c.riskRating);
    if (tier === 'SDD') tierRollup.sdd++;
    else if (tier === 'CDD') tierRollup.cdd++;
    else tierRollup.edd++;
    tierRollup.total++;
  }

  // 2) Overdue + due-soon reviews.
  const overdueReviews: OverdueReview[] = [];
  for (const schedule of reviewSchedules) {
    const live = checkReviewStatus(schedule);
    if (live.status !== 'overdue' && live.status !== 'due') continue;
    const source = customers.find((c) => c.id === schedule.customerId);
    const tier = source
      ? tierForRiskRating(source.riskRating)
      : tierForRiskRating(schedule.riskRating);
    overdueReviews.push({
      customerId: schedule.customerId,
      customerName: schedule.customerName,
      tier,
      nextReviewDate: schedule.nextReviewDate,
      status: live.status,
    });
  }
  // Overdue first, then due-soon. Within each bucket sort by date.
  overdueReviews.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'overdue' ? -1 : 1;
    return a.nextReviewDate.localeCompare(b.nextReviewDate);
  });

  // 3) Pending Senior Management approvals (PEP / EDD / high-risk onboarding).
  const pendingApprovals: PendingApproval[] = [];
  for (const a of approvals) {
    if (a.status !== 'pending') continue;
    if (!APPROVALS_RELEVANT_FOR.includes(a.requiredFor)) continue;
    const requestedAtMs = Date.parse(a.requestedAt);
    const ageInDays = Number.isFinite(requestedAtMs)
      ? Math.max(0, Math.floor((now.getTime() - requestedAtMs) / 86_400_000))
      : 0;
    pendingApprovals.push({
      approvalId: a.id,
      caseId: a.caseId,
      requiredFor: a.requiredFor,
      requestedAt: a.requestedAt,
      requestedBy: a.requestedBy,
      urgency: a.urgency,
      ageInDays,
    });
  }
  // Oldest first — FIFO exposure is the MLRO's risk surface.
  pendingApprovals.sort((a, b) => b.ageInDays - a.ageInDays);

  // 4) Filing snapshot.
  const countsByType: Record<FilingRecord['filingType'], number> = {
    STR: 0,
    SAR: 0,
    CTR: 0,
    DPMSR: 0,
    CNMR: 0,
    EOCN_FREEZE: 0,
  };
  const filedThisWeek: FilingThisWeek[] = [];
  const overdue: OverdueFiling[] = [];
  const windowFromMs = Date.parse(windowFromIso);

  for (const f of filings) {
    countsByType[f.filingType]++;
    const filingMs = Date.parse(f.filingDate);
    if (Number.isFinite(filingMs) && filingMs >= windowFromMs) {
      filedThisWeek.push({
        filingType: f.filingType,
        referenceNumber: f.referenceNumber,
        filingDate: f.filingDate,
        status: f.status,
        deadlineMet: f.deadlineMet,
      });
    }

    // Overdue = the source recorded it as overdue OR deadline was not met.
    // For pending filings we also defensively recompute via businessDays
    // in case the source system has not yet re-tagged a stale pending
    // filing as overdue. Submitted / acknowledged filings are trusted.
    const deadline = deadlineForFilingType(f.filingType);
    let breached = f.status === 'overdue' || !f.deadlineMet;
    if (!breached && f.status === 'pending' && deadline !== null && Number.isFinite(filingMs)) {
      const check = checkDeadline(new Date(filingMs), deadline, now);
      breached = check.breached;
    }
    if (breached) {
      const check =
        deadline !== null && Number.isFinite(filingMs)
          ? checkDeadline(new Date(filingMs), deadline, now)
          : null;
      overdue.push({
        filingType: f.filingType,
        referenceNumber: f.referenceNumber,
        filingDate: f.filingDate,
        businessDaysElapsed: check?.businessDaysElapsed ?? 0,
        deadlineBusinessDays: deadline ?? 0,
      });
    }
  }
  filedThisWeek.sort((a, b) => b.filingDate.localeCompare(a.filingDate));
  overdue.sort((a, b) => b.businessDaysElapsed - a.businessDaysElapsed);

  // 5) Sanctions resolutions this week.
  const sanctionsResolvedThisWeek: SanctionsResolution[] = [];
  for (const r of screeningRuns) {
    if (!r.falsePositiveResolution) continue;
    const execMs = Date.parse(r.executedAt);
    if (!Number.isFinite(execMs) || execMs < windowFromMs) continue;
    sanctionsResolvedThisWeek.push({
      runId: r.id,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      executedAt: r.executedAt,
      resolution: r.falsePositiveResolution,
      analyst: r.analyst,
    });
  }
  sanctionsResolvedThisWeek.sort((a, b) => b.executedAt.localeCompare(a.executedAt));

  return {
    generatedAtIso: windowToIso,
    windowFromIso,
    windowToIso,
    tierRollup,
    overdueReviews,
    pendingApprovals,
    filingSnapshot: { countsByType, filedThisWeek, overdue },
    sanctionsResolvedThisWeek,
    unwiredDataSources: input.unwiredDataSources ?? [],
    citations: [
      'FDL No.10/2025 Art.12-14 (CDD tiers, review cadence)',
      'FDL No.10/2025 Art.14 (PEP enhanced due diligence)',
      'FDL No.10/2025 Art.24 (record retention, audit trail)',
      'FDL No.10/2025 Art.26-27 (STR / CTR filing obligations)',
      'FDL No.10/2025 Art.29 (no tipping off — internal report only)',
      'Cabinet Res 134/2025 Art.7-10 (CDD tiers)',
      'Cabinet Res 134/2025 Art.14 (Senior Management approval)',
      'Cabinet Res 134/2025 Art.19 (internal review cadence)',
      'Cabinet Res 74/2020 Art.6 (CNMR 5 business days)',
      'MoE Circular 08/AML/2021 (DPMSR / CTR threshold and cadence)',
    ],
  };
}

// ─── Markdown renderer ─────────────────────────────────────────────────────

function filingTypeDeadlineLabel(type: FilingRecord['filingType']): string {
  const days = deadlineForFilingType(type);
  if (days === null) return '24-hour clock (Cabinet Res 74/2020 Art.4)';
  if (days === 0) return 'without delay (FDL Art.26-27)';
  return `${days} business days`;
}

/**
 * Render the weekly CDD report as a markdown document suitable for
 * posting to Asana, emailing to the MLRO, or archiving to a blob.
 *
 * Carve-out: compliance content stays verbose even when the rest of
 * the project trims output. See CLAUDE.md "Token-Efficient Output
 * Rules → Compliance Carve-Outs".
 */
export function renderWeeklyCddReportMarkdown(report: WeeklyCddReport): string {
  const fromDisplay = formatDateDDMMYYYY(report.windowFromIso);
  const toDisplay = formatDateDDMMYYYY(report.windowToIso);
  const lines: string[] = [];

  lines.push('# Weekly CDD Status Report');
  lines.push('');
  lines.push(`Window: ${fromDisplay} to ${toDisplay}`);
  lines.push(`Generated: ${formatDateDDMMYYYY(report.generatedAtIso)}`);
  lines.push('');

  if (report.unwiredDataSources.length > 0) {
    lines.push(
      `**⚠ INCOMPLETE BRIEFING — ${report.unwiredDataSources.length} data source(s) not yet wired: ${report.unwiredDataSources.join(', ')}.**`
    );
    lines.push(
      'Empty sections below for these sources do NOT mean "all clear" — verify manually until the persistence layer ships (FDL Art.20-22).'
    );
    lines.push('');
  }

  // 1) Tier rollup.
  lines.push('## 1. CDD tier rollup');
  lines.push('');
  lines.push('| Tier | Count | Review cadence |');
  lines.push('| --- | ---: | --- |');
  lines.push(`| SDD | ${report.tierRollup.sdd} | every ${CDD_REVIEW_LOW_RISK_MONTHS} months |`);
  lines.push(`| CDD | ${report.tierRollup.cdd} | every ${CDD_REVIEW_MEDIUM_RISK_MONTHS} months |`);
  lines.push(`| EDD | ${report.tierRollup.edd} | every ${CDD_REVIEW_HIGH_RISK_MONTHS} months |`);
  lines.push(`| **Total** | **${report.tierRollup.total}** | |`);
  lines.push('');

  // 2) Overdue reviews.
  lines.push('## 2. Reviews overdue or due within 30 days');
  lines.push('');
  if (report.overdueReviews.length === 0) {
    lines.push('No overdue or imminent reviews. All customers on cadence.');
  } else {
    lines.push('| Status | Customer | Tier | Next review date |');
    lines.push('| --- | --- | --- | --- |');
    for (const r of report.overdueReviews) {
      lines.push(
        `| ${r.status.toUpperCase()} | ${r.customerName} | ${r.tier} | ${formatDateDDMMYYYY(r.nextReviewDate)} |`
      );
    }
  }
  lines.push('');

  // 3) Pending approvals.
  lines.push('## 3. Pending Senior Management approvals (FDL Art.14, Cabinet Res 134/2025 Art.14)');
  lines.push('');
  if (report.pendingApprovals.length === 0) {
    lines.push('No pending PEP / EDD / high-risk onboarding approvals.');
  } else {
    lines.push('| Case | Required for | Urgency | Requested by | Age (days) |');
    lines.push('| --- | --- | --- | --- | ---: |');
    for (const a of report.pendingApprovals) {
      lines.push(
        `| ${a.caseId} | ${a.requiredFor} | ${a.urgency ?? 'standard'} | ${a.requestedBy} | ${a.ageInDays} |`
      );
    }
  }
  lines.push('');

  // 4) Filing snapshot.
  lines.push('## 4. Filing snapshot');
  lines.push('');
  lines.push('### Counts by type (lifetime)');
  lines.push('');
  lines.push('| Type | Count | Deadline |');
  lines.push('| --- | ---: | --- |');
  for (const t of FILING_TYPES) {
    lines.push(
      `| ${t} | ${report.filingSnapshot.countsByType[t]} | ${filingTypeDeadlineLabel(t)} |`
    );
  }
  lines.push('');

  lines.push('### Filed this week');
  lines.push('');
  if (report.filingSnapshot.filedThisWeek.length === 0) {
    lines.push('No filings recorded in the past 7 days.');
  } else {
    lines.push('| Type | Reference | Filed on | Status | Deadline met |');
    lines.push('| --- | --- | --- | --- | :---: |');
    for (const f of report.filingSnapshot.filedThisWeek) {
      lines.push(
        `| ${f.filingType} | ${f.referenceNumber} | ${formatDateDDMMYYYY(f.filingDate)} | ${f.status} | ${f.deadlineMet ? 'yes' : 'NO'} |`
      );
    }
  }
  lines.push('');

  lines.push('### Overdue filings');
  lines.push('');
  if (report.filingSnapshot.overdue.length === 0) {
    lines.push('No overdue filings detected.');
  } else {
    lines.push('| Type | Reference | Event date | Business days elapsed | Deadline |');
    lines.push('| --- | --- | --- | ---: | ---: |');
    for (const f of report.filingSnapshot.overdue) {
      lines.push(
        `| ${f.filingType} | ${f.referenceNumber} | ${formatDateDDMMYYYY(f.filingDate)} | ${f.businessDaysElapsed} | ${f.deadlineBusinessDays} |`
      );
    }
  }
  lines.push('');

  // 5) Sanctions resolutions.
  lines.push('## 5. Sanctions matches resolved this week');
  lines.push('');
  if (report.sanctionsResolvedThisWeek.length === 0) {
    lines.push('No sanctions matches resolved in the past 7 days.');
  } else {
    lines.push('| Run | Subject | Resolved on | Analyst | Resolution |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const r of report.sanctionsResolvedThisWeek) {
      lines.push(
        `| ${r.runId} | ${r.subjectType}:${r.subjectId} | ${formatDateDDMMYYYY(r.executedAt)} | ${r.analyst} | ${r.resolution} |`
      );
    }
  }
  lines.push('');

  lines.push('## Regulatory basis');
  lines.push('');
  for (const c of report.citations) {
    lines.push(`- ${c}`);
  }
  lines.push('');
  lines.push(
    'This report is internal to the Compliance Officer and Senior Management. It must not be shared with the subject of any customer, UBO, or transaction listed above (FDL No.10/2025 Art.29 — no tipping off).'
  );
  lines.push('');

  return lines.join('\n');
}
