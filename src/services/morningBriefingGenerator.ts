/**
 * Weekday Morning Briefing Generator.
 *
 * Produces the 08:00 Asia/Dubai weekday snapshot consumed by the MLRO
 * and by the Claude Code "Compliance Morning Briefing" routine. Pure
 * functions only: every input passed explicitly so the report is
 * deterministic and unit-testable.
 *
 * Complementary to the daily Sanctions Watch (which is a deep sanctions
 * view) and the weekly CDD Status Report (which is a portfolio review).
 * The Morning Briefing is the MLRO's single screen before opening the
 * laptop — "what must happen today, what happened overnight, what is
 * at risk of breach".
 *
 * Sections:
 *   1. Critical today — countdowns near breach (EOCN < 4h, CNMR due
 *      today, filings due today).
 *   2. Overnight activity — cron health + new hit counts + new filings
 *      acknowledged in the past ~16h.
 *   3. Action list — approvals pending > 48h, overdue reviews, overdue
 *      filings.
 *   4. List coverage — six-source freshness (FDL Art.35).
 *
 * Internal only (FDL Art.29 — no tipping off). The report must never
 * be shared with any subject listed in it.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-22 (CO duty of care, reasoned decision)
 *   - FDL No.10/2025 Art.24 (record retention, audit trail)
 *   - FDL No.10/2025 Art.29 (no tipping off)
 *   - FDL No.10/2025 Art.35 (TFS sanctions completeness)
 *   - Cabinet Res 74/2020 Art.4-7 (freeze without delay, 24h EOCN, 5BD CNMR)
 *   - Cabinet Res 134/2025 Art.14 (Senior Management approvals)
 *   - Cabinet Res 134/2025 Art.19 (internal review cadence)
 *   - MoE Circular 08/AML/2021 (DPMS cadence)
 */

import type {
  FrozenSubjectInput,
  ListCoverageEntry,
  ListHealthStatus,
  RequiredSource,
} from './sanctionsWatchGenerator';
import { REQUIRED_SOURCES } from './sanctionsWatchGenerator';
import type { ApprovalRequest } from '../domain/approvals';
import type { FilingRecord } from './screeningComplianceReport';
import { checkEOCNDeadline, checkDeadline } from '../utils/businessDays';
import { formatDateDDMMYYYY, isSameDubaiDate } from '../utils/dates';
import { CNMR_FILING_DEADLINE_BUSINESS_DAYS } from '../domain/constants';

// ─── Input types ────────────────────────────────────────────────────────────

/**
 * Per-cron health snapshot over the past 24 hours. Each record is one
 * audit-store prefix the cron writes into.
 */
export interface CronHealthRecord {
  /** Human-readable cron identifier, e.g. "sanctions-delta-screen-cron". */
  cronId: string;
  /** Number of audit entries recorded in the past 24h. */
  runCount: number;
  /** Number of those entries that reported `ok: true` or equivalent. */
  okCount: number;
  /** Most recent run ISO timestamp, if any. */
  lastRunAtIso?: string;
  /** Freeform note, e.g. "no runs in the past 24h" or "last run failed". */
  note?: string;
}

export interface ReviewDueTodayInput {
  customerId: string;
  customerName: string;
  tier: 'SDD' | 'CDD' | 'EDD';
  nextReviewDate: string; // ISO
}

export interface OvernightActivitySummary {
  /** Confirmed sanctions hits emitted in the past ~16h. */
  newConfirmedHits: number;
  /** Likely / potential hits emitted in the past ~16h. */
  newLikelyHits: number;
  newPotentialHits: number;
  /** Delta screening runs in the past ~16h. */
  deltaScreenRuns: number;
  /** Sanctions ingests in the past ~16h. */
  sanctionsIngestRuns: number;
}

export interface MorningBriefingInput {
  now: Date;
  /** Full six-source coverage map — same shape as SanctionsWatch. */
  listCoverage: Readonly<
    Record<RequiredSource, { status: ListHealthStatus; lastCheckedAt?: string; note?: string }>
  >;
  /** Cron audit summaries for the system-health section. */
  cronHealth: ReadonlyArray<CronHealthRecord>;
  /** Reviews scheduled for today. */
  reviewsDueToday: ReadonlyArray<ReviewDueTodayInput>;
  /** Overnight activity counts, precomputed by the cron. */
  overnightActivity: OvernightActivitySummary;
  /** Subjects currently frozen — used to compute imminent breaches. */
  frozenSubjects: ReadonlyArray<FrozenSubjectInput>;
  /** Approvals pending review — filtered to ages > 48h. */
  pendingApprovals: ReadonlyArray<ApprovalRequest>;
  /** Filings in the system — used to pick out filings due today. */
  filings: ReadonlyArray<FilingRecord>;
  /**
   * Names of data sources that are NOT yet wired into a persistence
   * layer (so the corresponding input arrays will be empty regardless
   * of real-world activity). When non-empty, the briefing renders a
   * loud "INCOMPLETE BRIEFING" banner so the MLRO knows the absence
   * of items in those sections is a wiring gap, not a clean state.
   * The cron is responsible for declaring this honestly.
   */
  unwiredDataSources?: ReadonlyArray<string>;
}

// ─── Output types ───────────────────────────────────────────────────────────

export interface ImminentFreezeBreach {
  subjectId: string;
  subjectName: string;
  matchedSource: RequiredSource;
  eocnHoursRemaining: number;
  eocnBreached: boolean;
  cnmrBusinessDaysRemaining: number;
  cnmrBreached: boolean;
}

export interface FilingDueToday {
  filingType: FilingRecord['filingType'];
  referenceNumber: string;
  deadlineDate: string; // ISO
  status: FilingRecord['status'];
}

export interface OverdueFilingItem {
  filingType: FilingRecord['filingType'];
  referenceNumber: string;
  filingDate: string; // ISO
  businessDaysElapsed: number;
  deadlineBusinessDays: number;
}

export interface PendingApprovalOver48h {
  approvalId: string;
  caseId: string;
  requiredFor: ApprovalRequest['requiredFor'];
  requestedAt: string;
  requestedBy: string;
  urgency: ApprovalRequest['urgency'];
  ageInHours: number;
}

export interface OverdueReviewItem {
  customerId: string;
  customerName: string;
  tier: 'SDD' | 'CDD' | 'EDD';
  nextReviewDate: string;
  daysOverdue: number;
}

export interface MorningBriefingReport {
  generatedAtIso: string;
  windowFromIso: string;
  windowToIso: string;
  listCoverage: ReadonlyArray<ListCoverageEntry>;
  anyListMissing: boolean;
  missingSources: ReadonlyArray<RequiredSource>;
  criticalToday: {
    imminentFreezeBreaches: ReadonlyArray<ImminentFreezeBreach>;
    filingsDueToday: ReadonlyArray<FilingDueToday>;
    reviewsDueToday: ReadonlyArray<ReviewDueTodayInput>;
  };
  overnightActivity: OvernightActivitySummary;
  cronHealth: ReadonlyArray<CronHealthRecord>;
  actionList: {
    pendingApprovalsOver48h: ReadonlyArray<PendingApprovalOver48h>;
    overdueFilings: ReadonlyArray<OverdueFilingItem>;
  };
  /** Pass-through: data sources the cron declared as not yet wired. */
  unwiredDataSources: ReadonlyArray<string>;
  citations: ReadonlyArray<string>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const SIXTEEN_HOURS_MS = 16 * 60 * 60 * 1000;
const IMMINENT_EOCN_THRESHOLD_HOURS = 4;
const APPROVAL_AGE_THRESHOLD_HOURS = 48;

function deadlineForFilingType(type: FilingRecord['filingType']): number | null {
  switch (type) {
    case 'STR':
    case 'SAR':
      return 0;
    case 'CTR':
    case 'DPMSR':
      return 15;
    case 'CNMR':
      return CNMR_FILING_DEADLINE_BUSINESS_DAYS;
    case 'EOCN_FREEZE':
      return null;
  }
}

// Dubai-local same-day comparison. The cron runs in UTC; using
// `getDate()` directly returns the UTC day-of-month, which is off by
// one for any instant between 20:00 UTC and 24:00 UTC (= 00:00 to
// 04:00 Dubai). For a "is the deadline today in Dubai?" check we
// must compare Dubai-local calendar dates explicitly.
const isSameDate = isSameDubaiDate;

// ─── Builder ────────────────────────────────────────────────────────────────

export function buildMorningBriefingReport(input: MorningBriefingInput): MorningBriefingReport {
  const {
    now,
    listCoverage,
    cronHealth,
    reviewsDueToday,
    overnightActivity,
    frozenSubjects,
    pendingApprovals,
    filings,
  } = input;
  const windowFromIso = new Date(now.getTime() - SIXTEEN_HOURS_MS).toISOString();
  const windowToIso = now.toISOString();

  // List coverage (same contract as the Sanctions Watch report).
  const coverage: ListCoverageEntry[] = REQUIRED_SOURCES.map((source) => {
    const entry = listCoverage[source];
    return {
      source,
      status: entry?.status ?? 'missing',
      lastCheckedAt: entry?.lastCheckedAt,
      note: entry?.note,
    };
  });
  const missingSources = coverage.filter((c) => c.status !== 'ok').map((c) => c.source);

  // Imminent freeze breaches — EOCN < 4h remaining OR CNMR due today/breached.
  const imminentFreezeBreaches: ImminentFreezeBreach[] = [];
  for (const s of frozenSubjects) {
    const confirmedAt = new Date(s.matchConfirmedAt);
    const eocn = checkEOCNDeadline(confirmedAt, now);
    const cnmr = checkDeadline(confirmedAt, CNMR_FILING_DEADLINE_BUSINESS_DAYS, now);
    const cnmrDueToday = isSameDate(cnmr.deadlineDate, now);
    const eocnImminent = eocn.breached || eocn.hoursRemaining <= IMMINENT_EOCN_THRESHOLD_HOURS;
    if (!eocnImminent && !cnmr.breached && !cnmrDueToday) continue;
    imminentFreezeBreaches.push({
      subjectId: s.subjectId,
      subjectName: s.subjectName,
      matchedSource: s.matchedSource,
      eocnHoursRemaining: eocn.hoursRemaining,
      eocnBreached: eocn.breached,
      cnmrBusinessDaysRemaining: cnmr.businessDaysRemaining,
      cnmrBreached: cnmr.breached,
    });
  }
  imminentFreezeBreaches.sort((a, b) => a.eocnHoursRemaining - b.eocnHoursRemaining);

  // Filings due today — pending filings whose deadline lands on today's
  // calendar date (Dubai-local day equivalence via isSameDate).
  const filingsDueToday: FilingDueToday[] = [];
  const overdueFilings: OverdueFilingItem[] = [];
  for (const f of filings) {
    const deadline = deadlineForFilingType(f.filingType);
    const filingMs = Date.parse(f.filingDate);
    if (!Number.isFinite(filingMs) || deadline === null) continue;
    const check = checkDeadline(new Date(filingMs), deadline, now);
    if (check.breached || f.status === 'overdue' || !f.deadlineMet) {
      overdueFilings.push({
        filingType: f.filingType,
        referenceNumber: f.referenceNumber,
        filingDate: f.filingDate,
        businessDaysElapsed: check.businessDaysElapsed,
        deadlineBusinessDays: deadline,
      });
      continue;
    }
    // By this point, filings with `!f.deadlineMet` or `status === 'overdue'`
    // have already been bucketed into `overdueFilings` and the loop
    // continued. Any pending filing that reaches here has `deadlineMet`
    // true, so the only remaining check is whether the deadline lands
    // today.
    if (f.status === 'pending' && isSameDate(check.deadlineDate, now)) {
      filingsDueToday.push({
        filingType: f.filingType,
        referenceNumber: f.referenceNumber,
        deadlineDate: check.deadlineDate.toISOString(),
        status: f.status,
      });
    }
  }
  filingsDueToday.sort((a, b) => a.filingType.localeCompare(b.filingType));
  overdueFilings.sort((a, b) => b.businessDaysElapsed - a.businessDaysElapsed);

  // Pending approvals > 48h.
  const pendingApprovalsOver48h: PendingApprovalOver48h[] = [];
  for (const a of pendingApprovals) {
    if (a.status !== 'pending') continue;
    const reqMs = Date.parse(a.requestedAt);
    if (!Number.isFinite(reqMs)) continue;
    const ageInHours = (now.getTime() - reqMs) / (1000 * 60 * 60);
    if (ageInHours < APPROVAL_AGE_THRESHOLD_HOURS) continue;
    pendingApprovalsOver48h.push({
      approvalId: a.id,
      caseId: a.caseId,
      requiredFor: a.requiredFor,
      requestedAt: a.requestedAt,
      requestedBy: a.requestedBy,
      urgency: a.urgency,
      ageInHours: Math.round(ageInHours * 10) / 10,
    });
  }
  pendingApprovalsOver48h.sort((a, b) => b.ageInHours - a.ageInHours);

  return {
    generatedAtIso: windowToIso,
    windowFromIso,
    windowToIso,
    unwiredDataSources: input.unwiredDataSources ?? [],
    listCoverage: coverage,
    anyListMissing: missingSources.length > 0,
    missingSources,
    criticalToday: {
      imminentFreezeBreaches,
      filingsDueToday,
      reviewsDueToday,
    },
    overnightActivity,
    cronHealth,
    actionList: {
      pendingApprovalsOver48h,
      overdueFilings,
    },
    citations: [
      'FDL No.10/2025 Art.20-22 (CO duty of care)',
      'FDL No.10/2025 Art.24 (record retention)',
      'FDL No.10/2025 Art.29 (no tipping off — internal only)',
      'FDL No.10/2025 Art.35 (TFS sanctions completeness)',
      'Cabinet Res 74/2020 Art.4-7 (freeze, 24h EOCN, 5BD CNMR)',
      'Cabinet Res 134/2025 Art.14 (Senior Management approvals)',
      'Cabinet Res 134/2025 Art.19 (internal review cadence)',
      'MoE Circular 08/AML/2021 (DPMS cadence)',
    ],
  };
}

// ─── Markdown renderer ─────────────────────────────────────────────────────

export function renderMorningBriefingMarkdown(report: MorningBriefingReport): string {
  const lines: string[] = [];
  const today = formatDateDDMMYYYY(report.generatedAtIso);

  lines.push('# Compliance Morning Briefing');
  lines.push('');
  lines.push(`Generated: ${today}`);
  lines.push(
    `Window: ${formatDateDDMMYYYY(report.windowFromIso)} to ${formatDateDDMMYYYY(report.windowToIso)}`
  );
  lines.push('');

  // Honesty banner: if any data source is not yet wired into a
  // persistence layer, the corresponding sections will be empty no
  // matter what is happening operationally. The MLRO must verify
  // those sections manually until the persistence layer ships.
  if (report.unwiredDataSources.length > 0) {
    lines.push(
      `**⚠ INCOMPLETE BRIEFING — ${report.unwiredDataSources.length} data source(s) not yet wired: ${report.unwiredDataSources.join(', ')}.**`
    );
    lines.push(
      'Empty sections below for these sources do NOT mean "all clear" — they mean the persistence layer is not yet feeding the briefing. Verify manually before relying on this report (FDL No.10/2025 Art.20-22 — CO duty of care).'
    );
    lines.push('');
  }

  // 1) Critical today.
  lines.push('## 1. Critical today');
  lines.push('');
  const imm = report.criticalToday.imminentFreezeBreaches;
  const fdt = report.criticalToday.filingsDueToday;
  const rdt = report.criticalToday.reviewsDueToday;

  if (imm.length === 0 && fdt.length === 0 && rdt.length === 0) {
    lines.push('No critical items for today.');
    lines.push('');
  } else {
    if (imm.length > 0) {
      lines.push('### Imminent freeze breaches (Cabinet Res 74/2020 Art.4-7)');
      lines.push('');
      lines.push(
        '| Subject | List | EOCN remaining | EOCN breached | CNMR BD remaining | CNMR breached |'
      );
      lines.push('| --- | --- | ---: | :---: | ---: | :---: |');
      for (const b of imm) {
        lines.push(
          `| ${b.subjectName} | ${b.matchedSource} | ${b.eocnBreached ? 'BREACHED' : `${b.eocnHoursRemaining.toFixed(1)} h`} | ${b.eocnBreached ? 'YES' : 'no'} | ${b.cnmrBreached ? 'BREACHED' : `${b.cnmrBusinessDaysRemaining} BD`} | ${b.cnmrBreached ? 'YES' : 'no'} |`
        );
      }
      lines.push('');
    }
    if (fdt.length > 0) {
      lines.push('### Filings due today (FDL Art.26-27, Cabinet Res 74/2020 Art.6)');
      lines.push('');
      lines.push('| Type | Reference | Deadline | Status |');
      lines.push('| --- | --- | --- | --- |');
      for (const f of fdt) {
        lines.push(
          `| ${f.filingType} | ${f.referenceNumber} | ${formatDateDDMMYYYY(f.deadlineDate)} | ${f.status} |`
        );
      }
      lines.push('');
    }
    if (rdt.length > 0) {
      lines.push('### Reviews due today (Cabinet Res 134/2025 Art.19)');
      lines.push('');
      lines.push('| Customer | Tier | Next review date |');
      lines.push('| --- | --- | --- |');
      for (const r of rdt) {
        lines.push(`| ${r.customerName} | ${r.tier} | ${formatDateDDMMYYYY(r.nextReviewDate)} |`);
      }
      lines.push('');
    }
  }

  // 2) Overnight activity.
  lines.push('## 2. Overnight activity');
  lines.push('');
  const oa = report.overnightActivity;
  lines.push('| Metric | Count |');
  lines.push('| --- | ---: |');
  lines.push(`| Sanctions ingests | ${oa.sanctionsIngestRuns} |`);
  lines.push(`| Delta screening runs | ${oa.deltaScreenRuns} |`);
  lines.push(`| New confirmed hits | ${oa.newConfirmedHits} |`);
  lines.push(`| New likely hits | ${oa.newLikelyHits} |`);
  lines.push(`| New potential hits | ${oa.newPotentialHits} |`);
  lines.push('');

  // 3) System health.
  lines.push('## 3. System health (past 24h)');
  lines.push('');
  if (report.cronHealth.length === 0) {
    lines.push('No cron health data available.');
  } else {
    lines.push('| Cron | Runs | OK | Last run | Note |');
    lines.push('| --- | ---: | ---: | --- | --- |');
    for (const h of report.cronHealth) {
      const last = h.lastRunAtIso ? formatDateDDMMYYYY(h.lastRunAtIso) : '—';
      lines.push(`| ${h.cronId} | ${h.runCount} | ${h.okCount} | ${last} | ${h.note ?? ''} |`);
    }
  }
  lines.push('');

  // 4) Action list.
  lines.push('## 4. Action list');
  lines.push('');
  const pa = report.actionList.pendingApprovalsOver48h;
  const of = report.actionList.overdueFilings;
  if (pa.length === 0 && of.length === 0) {
    lines.push('No overdue approvals or filings.');
    lines.push('');
  } else {
    if (pa.length > 0) {
      lines.push('### Approvals pending > 48h (FDL Art.14, Cabinet Res 134/2025 Art.14)');
      lines.push('');
      lines.push('| Case | Required for | Urgency | Requested by | Age (hours) |');
      lines.push('| --- | --- | --- | --- | ---: |');
      for (const p of pa) {
        lines.push(
          `| ${p.caseId} | ${p.requiredFor} | ${p.urgency ?? 'standard'} | ${p.requestedBy} | ${p.ageInHours} |`
        );
      }
      lines.push('');
    }
    if (of.length > 0) {
      lines.push('### Overdue filings');
      lines.push('');
      lines.push('| Type | Reference | Filing date | BD elapsed | Deadline (BD) |');
      lines.push('| --- | --- | --- | ---: | ---: |');
      for (const f of of) {
        lines.push(
          `| ${f.filingType} | ${f.referenceNumber} | ${formatDateDDMMYYYY(f.filingDate)} | ${f.businessDaysElapsed} | ${f.deadlineBusinessDays} |`
        );
      }
      lines.push('');
    }
  }

  // 5) List coverage.
  lines.push('## 5. List coverage (FDL Art.35, Cabinet Res 74/2020 Art.4)');
  lines.push('');
  if (report.anyListMissing) {
    lines.push(
      `**ALERT: ${report.missingSources.length} required source(s) missing or stale: ${report.missingSources.join(', ')}.** Investigate the ingest pipeline.`
    );
    lines.push('');
  }
  lines.push('| Source | Status | Last ingest |');
  lines.push('| --- | --- | --- |');
  for (const c of report.listCoverage) {
    const label =
      c.status === 'ok'
        ? 'OK'
        : c.status === 'manual-pending'
          ? 'MANUAL-PENDING'
          : c.status.toUpperCase();
    lines.push(
      `| ${c.source} | ${label} | ${c.lastCheckedAt ? formatDateDDMMYYYY(c.lastCheckedAt) : '—'} |`
    );
  }
  lines.push('');

  lines.push('## Regulatory basis');
  lines.push('');
  for (const c of report.citations) {
    lines.push(`- ${c}`);
  }
  lines.push('');
  lines.push(
    'This briefing is internal to the Compliance Officer and Senior Management. It must not be shared with any subject listed above (FDL No.10/2025 Art.29 — no tipping off).'
  );
  lines.push('');

  return lines.join('\n');
}
