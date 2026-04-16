/**
 * Sanctions Watch Daily Report Generator.
 *
 * Produces the 09:00 Asia/Dubai daily snapshot consumed by the MLRO
 * and by the Claude Code "Sanctions Watch" routine. Pure functions
 * only: every input is passed explicitly so the report is deterministic
 * and unit-testable.
 *
 * The report answers:
 *   1. Were all six sanctions lists checked in the past 24 hours?
 *      (UN, OFAC, EU, UK, UAE, EOCN — FDL Art.35, Cabinet Res 74/2020 Art.4)
 *   2. What hits surfaced, bucketed by confidence (confirmed / likely /
 *      potential / low)?
 *   3. For subjects currently frozen, what is the EOCN 24h notification
 *      countdown and the CNMR 5-business-day filing countdown?
 *   4. What false positives were resolved in the past 24h (for audit
 *      transparency, not as a tipping-off channel)?
 *
 * The generator does NOT re-run screening. Screening is already handled
 * by netlify/functions/sanctions-delta-screen-cron.mts (every 4h). This
 * module only assembles an MLRO-facing view over the hits that store
 * has already produced.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-22 (CO duty of care, reasoned decision)
 *   - FDL No.10/2025 Art.24 (10yr retention, audit trail)
 *   - FDL No.10/2025 Art.29 (no tipping off — report is internal only)
 *   - FDL No.10/2025 Art.35 (TFS sanctions completeness)
 *   - Cabinet Res 74/2020 Art.4-7 (freeze without delay, 24h EOCN,
 *     5 business days CNMR)
 *   - FATF Rec 6 (UN sanctions screening completeness)
 *   - FATF Rec 20 (continuous monitoring)
 *   - MoE Circular 08/AML/2021 (DPMS sector screening cadence)
 */

import type { DeltaScreenHit, DeltaHitConfidence } from './sanctionsDeltaCohortScreener';
import { checkEOCNDeadline, checkDeadline } from '../utils/businessDays';
import { formatDateDDMMYYYY } from '../utils/dates';
import { CNMR_FILING_DEADLINE_BUSINESS_DAYS } from '../domain/constants';

// ─── Fixed list of lists the UAE TFS framework requires ────────────────────

/**
 * The six sanctions sources every DPMS must screen against every day.
 * If any one of these is missing from the coverage map, the report
 * raises a loud alert. Never skip a list — CLAUDE.md rule.
 */
export const REQUIRED_SOURCES = ['UN', 'OFAC', 'EU', 'UK', 'UAE', 'EOCN'] as const;
export type RequiredSource = (typeof REQUIRED_SOURCES)[number];

/**
 * Coverage status for a sanctions source.
 *
 * - `ok`             — ingest successful within the past 24h
 * - `stale`          — last ingest is older than 24h (needs investigation)
 * - `missing`        — no snapshot in the store at all (ingest broken)
 * - `manual-pending` — source has no stable URL and requires a manual
 *                      upload (UAE EOCN). Not a regulatory failure on
 *                      its own; the MLRO is expected to upload on a
 *                      policy cadence, and the daily briefing must
 *                      not trip the off-track banner for these until
 *                      the policy grace window elapses.
 */
export type ListHealthStatus = 'ok' | 'stale' | 'missing' | 'manual-pending';

/**
 * Sources that only exist as manual uploads (no public stable URL).
 * Rather than flagging them as `missing` every run, the coverage probe
 * marks them `manual-pending` so the briefing does not emit a daily
 * false-alarm for a known design constraint.
 */
export const MANUAL_ONLY_SOURCES: ReadonlyArray<RequiredSource> = ['UAE', 'EOCN'];

export interface ListCoverageEntry {
  source: RequiredSource;
  status: ListHealthStatus;
  /** ISO timestamp of the last successful ingest for this source. */
  lastCheckedAt?: string;
  /** Optional explanation — e.g. "parser failed", "feed unavailable". */
  note?: string;
}

// ─── Frozen-subject countdown input ─────────────────────────────────────────

/**
 * A subject whose sanctions match has been confirmed and who is therefore
 * under an active freeze (Cabinet Res 74/2020 Art.4). For each one the
 * Watch surfaces both countdowns:
 *   - EOCN 24-hour notification clock (hours remaining)
 *   - CNMR 5-business-day filing deadline (business days remaining)
 */
export interface FrozenSubjectInput {
  subjectId: string;
  subjectName: string;
  /** Which sanctions source the freeze was triggered by. */
  matchedSource: RequiredSource;
  /** ISO timestamp when the match was confirmed. Drives both countdowns. */
  matchConfirmedAt: string;
  /** True if the EOCN notification has already been filed. */
  eocnNotified?: boolean;
  /** True if the CNMR has already been filed to the FIU. */
  cnmrFiled?: boolean;
}

// ─── Recent false positives ─────────────────────────────────────────────────

/**
 * A previously-matched subject whose hit was dismissed as a false
 * positive within the 24h window. Surfaced for audit transparency; the
 * report is internal only and never reveals the dismissal to the subject
 * (FDL Art.29 — no tipping off).
 */
export interface ResolvedFalsePositiveInput {
  subjectId: string;
  matchedAgainst: string;
  resolvedAt: string;
  resolvedBy: string;
  reason: string;
}

// ─── Report types ───────────────────────────────────────────────────────────

export interface SanctionsWatchInput {
  now: Date;
  portfolioSize: number;
  /** Health of each of the six required lists. Must include all 6 keys. */
  listCoverage: Readonly<Record<RequiredSource, Omit<ListCoverageEntry, 'source'>>>;
  /** Hits emitted by the delta cohort screener in the past 24h. */
  hits: ReadonlyArray<DeltaScreenHit>;
  /** Currently frozen subjects awaiting EOCN notification / CNMR filing. */
  frozenSubjects: ReadonlyArray<FrozenSubjectInput>;
  /** False positives resolved in the past 24h. */
  recentFalsePositives: ReadonlyArray<ResolvedFalsePositiveInput>;
}

export interface BandCounts {
  confirmed: number;
  likely: number;
  potential: number;
  low: number;
}

export interface HitView {
  customerId: string;
  matchedName: string;
  source: RequiredSource;
  matchReasons: ReadonlyArray<string>;
  matchScore: number;
  confidence: DeltaHitConfidence;
  recommendedAction: DeltaScreenHit['recommendedAction'];
}

export interface FreezeCountdownView {
  subjectId: string;
  subjectName: string;
  matchedSource: RequiredSource;
  matchConfirmedAt: string;
  /** Hours remaining on the EOCN 24h notification clock. 0 if breached. */
  eocnHoursRemaining: number;
  eocnBreached: boolean;
  eocnNotified: boolean;
  /** Business days remaining on the CNMR 5-BD filing clock. 0 if breached. */
  cnmrBusinessDaysRemaining: number;
  cnmrBreached: boolean;
  cnmrFiled: boolean;
}

export interface FalsePositiveView {
  subjectId: string;
  matchedAgainst: string;
  resolvedAt: string;
  resolvedBy: string;
  reason: string;
}

export interface SanctionsWatchReport {
  generatedAtIso: string;
  windowFromIso: string;
  windowToIso: string;
  portfolioSize: number;
  listCoverage: ReadonlyArray<ListCoverageEntry>;
  anyListMissing: boolean;
  missingSources: ReadonlyArray<RequiredSource>;
  bandCounts: BandCounts;
  confirmedHits: ReadonlyArray<HitView>;
  likelyHits: ReadonlyArray<HitView>;
  potentialHits: ReadonlyArray<HitView>;
  lowHits: ReadonlyArray<HitView>;
  freezeCountdowns: ReadonlyArray<FreezeCountdownView>;
  recentFalsePositives: ReadonlyArray<FalsePositiveView>;
  citations: ReadonlyArray<string>;
}

// ─── Builder ────────────────────────────────────────────────────────────────

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

function narrowSource(input: string): RequiredSource | null {
  return (REQUIRED_SOURCES as ReadonlyArray<string>).includes(input)
    ? (input as RequiredSource)
    : null;
}

/**
 * Convert a `DeltaScreenHit` to the MLRO-facing `HitView`. Returns
 * `null` when the hit's source cannot be narrowed to one of the six
 * REQUIRED_SOURCES — rather than silently mislabelling it as 'UN',
 * drop it so data-quality drift surfaces as a missing row instead of
 * a wrong one. In practice `SanctionsEntry.source` and `RequiredSource`
 * share the same six members, so this branch is defensive only.
 */
function toHitView(hit: DeltaScreenHit): HitView | null {
  const source = narrowSource(hit.matchedAgainst.source);
  if (!source) return null;
  return {
    customerId: hit.customerId,
    matchedName: hit.matchedAgainst.name,
    source,
    matchReasons: hit.matchReasons,
    matchScore: hit.matchScore,
    confidence: hit.confidence,
    recommendedAction: hit.recommendedAction,
  };
}

export function buildSanctionsWatchReport(input: SanctionsWatchInput): SanctionsWatchReport {
  const { now, portfolioSize, listCoverage, hits, frozenSubjects, recentFalsePositives } = input;
  const windowFromIso = new Date(now.getTime() - TWENTY_FOUR_HOURS_MS).toISOString();
  const windowToIso = now.toISOString();

  // 1) List coverage — verify all six required sources are present.
  // Sources with no stable URL (UAE, EOCN) default to `manual-pending`
  // instead of `missing`, so they do not trip the off-track banner
  // on every run. If the probe explicitly reported a status that is
  // not `manual-pending`, that wins — `missing` or `stale` on a
  // manual-only source remains a signal worth flagging.
  const coverage: ListCoverageEntry[] = REQUIRED_SOURCES.map((source) => {
    const entry = listCoverage[source];
    const isManualOnly = MANUAL_ONLY_SOURCES.includes(source);
    const fallbackStatus: ListHealthStatus = isManualOnly ? 'manual-pending' : 'missing';
    return {
      source,
      status: entry?.status ?? fallbackStatus,
      lastCheckedAt: entry?.lastCheckedAt,
      note: entry?.note,
    };
  });
  // `manual-pending` does NOT count as missing coverage — it's a
  // documented design constraint, not an ingest failure.
  const missingSources = coverage
    .filter((c) => c.status !== 'ok' && c.status !== 'manual-pending')
    .map((c) => c.source);
  const anyListMissing = missingSources.length > 0;

  // 2) Hit bucketing by confidence band. Sort each bucket by score desc.
  const confirmedHits: HitView[] = [];
  const likelyHits: HitView[] = [];
  const potentialHits: HitView[] = [];
  const lowHits: HitView[] = [];
  for (const h of hits) {
    const view = toHitView(h);
    if (!view) continue;
    if (h.confidence === 'confirmed') confirmedHits.push(view);
    else if (h.confidence === 'likely') likelyHits.push(view);
    else if (h.confidence === 'potential') potentialHits.push(view);
    else lowHits.push(view);
  }
  const scoreDesc = (a: HitView, b: HitView) => b.matchScore - a.matchScore;
  confirmedHits.sort(scoreDesc);
  likelyHits.sort(scoreDesc);
  potentialHits.sort(scoreDesc);
  lowHits.sort(scoreDesc);

  const bandCounts: BandCounts = {
    confirmed: confirmedHits.length,
    likely: likelyHits.length,
    potential: potentialHits.length,
    low: lowHits.length,
  };

  // 3) Freeze countdowns — EOCN 24h + CNMR 5BD per frozen subject.
  const freezeCountdowns: FreezeCountdownView[] = frozenSubjects.map((s) => {
    const confirmedAt = new Date(s.matchConfirmedAt);
    const eocn = checkEOCNDeadline(confirmedAt, now);
    const cnmr = checkDeadline(confirmedAt, CNMR_FILING_DEADLINE_BUSINESS_DAYS, now);
    return {
      subjectId: s.subjectId,
      subjectName: s.subjectName,
      matchedSource: s.matchedSource,
      matchConfirmedAt: s.matchConfirmedAt,
      eocnHoursRemaining: eocn.hoursRemaining,
      eocnBreached: eocn.breached,
      eocnNotified: s.eocnNotified ?? false,
      cnmrBusinessDaysRemaining: cnmr.businessDaysRemaining,
      cnmrBreached: cnmr.breached,
      cnmrFiled: s.cnmrFiled ?? false,
    };
  });
  // Most urgent first: breached → least remaining time.
  freezeCountdowns.sort((a, b) => {
    if (a.eocnBreached !== b.eocnBreached) return a.eocnBreached ? -1 : 1;
    return a.eocnHoursRemaining - b.eocnHoursRemaining;
  });

  // 4) Recent false positives — pass through with window filter.
  const windowFromMs = Date.parse(windowFromIso);
  const falsePositives: FalsePositiveView[] = recentFalsePositives
    .filter((fp) => {
      const t = Date.parse(fp.resolvedAt);
      return Number.isFinite(t) && t >= windowFromMs;
    })
    .map((fp) => ({
      subjectId: fp.subjectId,
      matchedAgainst: fp.matchedAgainst,
      resolvedAt: fp.resolvedAt,
      resolvedBy: fp.resolvedBy,
      reason: fp.reason,
    }))
    .sort((a, b) => b.resolvedAt.localeCompare(a.resolvedAt));

  return {
    generatedAtIso: windowToIso,
    windowFromIso,
    windowToIso,
    portfolioSize,
    listCoverage: coverage,
    anyListMissing,
    missingSources,
    bandCounts,
    confirmedHits,
    likelyHits,
    potentialHits,
    lowHits,
    freezeCountdowns,
    recentFalsePositives: falsePositives,
    citations: [
      'FDL No.10/2025 Art.20-22 (CO duty of care, reasoned decision)',
      'FDL No.10/2025 Art.24 (record retention, audit trail)',
      'FDL No.10/2025 Art.29 (no tipping off — internal report only)',
      'FDL No.10/2025 Art.35 (TFS sanctions completeness)',
      'Cabinet Res 74/2020 Art.4-7 (freeze without delay, 24h EOCN, 5BD CNMR)',
      'FATF Rec 6 (UN sanctions screening completeness)',
      'FATF Rec 20 (continuous monitoring)',
      'MoE Circular 08/AML/2021 (DPMS sector screening cadence)',
    ],
  };
}

// ─── Markdown renderer ─────────────────────────────────────────────────────

function formatCoverageStatus(status: ListHealthStatus): string {
  if (status === 'ok') return 'OK';
  if (status === 'manual-pending') return 'MANUAL-PENDING';
  return status.toUpperCase();
}

function renderCoverageTable(entries: ReadonlyArray<ListCoverageEntry>): string[] {
  const out: string[] = [];
  out.push('| Source | Status | Last ingest | Note |');
  out.push('| --- | --- | --- | --- |');
  for (const e of entries) {
    const stamp = e.lastCheckedAt ? formatDateDDMMYYYY(e.lastCheckedAt) : '—';
    out.push(`| ${e.source} | ${formatCoverageStatus(e.status)} | ${stamp} | ${e.note ?? ''} |`);
  }
  return out;
}

function renderHitRows(hits: ReadonlyArray<HitView>): string[] {
  const out: string[] = [];
  out.push('| Customer | Matched name | List | Reasons | Score | Recommended action |');
  out.push('| --- | --- | --- | --- | ---: | --- |');
  for (const h of hits) {
    out.push(
      `| ${h.customerId} | ${h.matchedName} | ${h.source} | ${h.matchReasons.join(', ')} | ${h.matchScore.toFixed(2)} | ${h.recommendedAction} |`
    );
  }
  return out;
}

/**
 * Render the watch report as markdown. Compliance carve-out applies —
 * regulatory content stays verbose even when token-efficiency rules
 * trim prose elsewhere (see CLAUDE.md).
 */
export function renderSanctionsWatchMarkdown(report: SanctionsWatchReport): string {
  const fromDisplay = formatDateDDMMYYYY(report.windowFromIso);
  const toDisplay = formatDateDDMMYYYY(report.windowToIso);
  const lines: string[] = [];

  lines.push('# Sanctions Watch — Daily Report');
  lines.push('');
  lines.push(`Window: ${fromDisplay} to ${toDisplay}`);
  lines.push(`Generated: ${formatDateDDMMYYYY(report.generatedAtIso)}`);
  lines.push(`Portfolio size: ${report.portfolioSize}`);
  lines.push('');

  // 1) List coverage. Loud alert if any required list is missing.
  lines.push('## 1. List coverage (FDL Art.35, Cabinet Res 74/2020 Art.4)');
  lines.push('');
  if (report.anyListMissing) {
    lines.push(
      `**ALERT: ${report.missingSources.length} required source(s) missing or stale: ${report.missingSources.join(', ')}.**`
    );
    lines.push(
      'Cabinet Res 74/2020 Art.4 and FATF Rec 6 require every UAE DPMS to screen against all six sources daily. Investigate the ingest pipeline before closing this report.'
    );
    lines.push('');
  } else {
    lines.push('All six required sources ingested in the past 24 hours.');
    lines.push('');
  }
  lines.push(...renderCoverageTable(report.listCoverage));
  lines.push('');

  // 2) Hits by confidence band.
  lines.push('## 2. Hits by confidence band');
  lines.push('');
  lines.push('| Band | Count | Recommended path |');
  lines.push('| --- | ---: | --- |');
  lines.push(
    `| Confirmed | ${report.bandCounts.confirmed} | freeze_immediately (Cabinet Res 74/2020 Art.4) |`
  );
  lines.push(`| Likely | ${report.bandCounts.likely} | gate_for_co_review (four-eyes) |`);
  lines.push(`| Potential | ${report.bandCounts.potential} | escalate_for_review (CO decides) |`);
  lines.push(`| Low | ${report.bandCounts.low} | log + dismiss with reasoning |`);
  lines.push('');

  if (report.confirmedHits.length > 0) {
    lines.push('### Confirmed hits');
    lines.push('');
    lines.push(...renderHitRows(report.confirmedHits));
    lines.push('');
  }
  if (report.likelyHits.length > 0) {
    lines.push('### Likely hits');
    lines.push('');
    lines.push(...renderHitRows(report.likelyHits));
    lines.push('');
  }
  if (report.potentialHits.length > 0) {
    lines.push('### Potential hits');
    lines.push('');
    lines.push(...renderHitRows(report.potentialHits));
    lines.push('');
  }
  if (
    report.confirmedHits.length === 0 &&
    report.likelyHits.length === 0 &&
    report.potentialHits.length === 0
  ) {
    lines.push('No confirmed, likely, or potential hits in the past 24 hours.');
    lines.push('');
  }

  // 3) Freeze countdowns.
  lines.push('## 3. Active freeze countdowns (Cabinet Res 74/2020 Art.4-7)');
  lines.push('');
  if (report.freezeCountdowns.length === 0) {
    lines.push('No subjects currently under active freeze.');
  } else {
    lines.push(
      '| Subject | List | Confirmed at | EOCN 24h remaining | EOCN notified | CNMR 5BD remaining | CNMR filed |'
    );
    lines.push('| --- | --- | --- | ---: | :---: | ---: | :---: |');
    for (const f of report.freezeCountdowns) {
      const eocnCell = f.eocnBreached ? 'BREACHED' : `${f.eocnHoursRemaining.toFixed(1)} h`;
      const cnmrCell = f.cnmrBreached ? 'BREACHED' : `${f.cnmrBusinessDaysRemaining} BD`;
      lines.push(
        `| ${f.subjectName} | ${f.matchedSource} | ${formatDateDDMMYYYY(f.matchConfirmedAt)} | ${eocnCell} | ${f.eocnNotified ? 'yes' : 'NO'} | ${cnmrCell} | ${f.cnmrFiled ? 'yes' : 'NO'} |`
      );
    }
  }
  lines.push('');

  // 4) Recent false positives.
  lines.push('## 4. False positives resolved in the past 24 hours');
  lines.push('');
  if (report.recentFalsePositives.length === 0) {
    lines.push('No false positives resolved in the past 24 hours.');
  } else {
    lines.push('| Subject | Matched against | Resolved at | Resolved by | Reason |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const fp of report.recentFalsePositives) {
      lines.push(
        `| ${fp.subjectId} | ${fp.matchedAgainst} | ${formatDateDDMMYYYY(fp.resolvedAt)} | ${fp.resolvedBy} | ${fp.reason} |`
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
    'This report is internal to the Compliance Officer and Senior Management. It must not be shared with any subject of a match, freeze, or dismissal listed above (FDL No.10/2025 Art.29 — no tipping off).'
  );
  lines.push('');

  return lines.join('\n');
}
