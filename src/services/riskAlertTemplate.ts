/**
 * Risk Alert Template — unified Asana task builder for immediate
 * risk notifications.
 *
 * Single template covers every immediate-alert path:
 *   - sanctions-ingest delta (NEW / AMENDMENT / DELISTING)
 *   - adverse-media hot-ingest hit
 *   - PEP status change
 *   - UBO status change on the subject's legal entity
 *
 * Adapts automatically to:
 *   - resolved vs unresolved identity (FATF Rec 10 clamp)
 *   - severity band (ALERT / POSSIBLE / CHANGE)
 *   - trigger source (cron name + runId rendered in SOURCE block)
 *
 * Pure function — no I/O, no Asana calls. The dispatcher layer
 * (src/services/immediateRiskAlerts.ts) feeds the output of this
 * module to createAsanaTask().
 *
 * Regulatory basis (rendered into every task body):
 *   FATF Rec 10                positive ID
 *   FDL No.10/2025 Art.12      CDD
 *   FDL No.10/2025 Art.20-21   CO duty
 *   FDL No.10/2025 Art.24      10yr retention
 *   FDL No.10/2025 Art.26-27   STR filing
 *   FDL No.10/2025 Art.29      no tipping off (RENDERED AT BOTTOM OF EVERY TASK)
 *   FDL No.10/2025 Art.35      TFS — freezes apply to THE subject
 *   Cabinet Res 74/2020 Art.4  freeze without delay (EOCN TFS Guidance
 *                              July 2025: 1-2 h max)
 *   Cabinet Res 74/2020 Art.6  CNMR within 5 business days
 */

import type { WatchlistEntry } from './screeningWatchlist';
import type { IdentityMatchBreakdown, IdentityClassification } from './identityMatchScore';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type RiskAlertTrigger =
  | 'sanctions-ingest'
  | 'adverse-media-hot'
  | 'pep-status'
  | 'ubo-change';

export type RiskAlertChangeType = 'NEW' | 'AMENDMENT' | 'DELISTING';

export interface RiskAlertMatch {
  /** Which list / feed produced the hit. */
  list: string;
  /** Source-stable reference on that list (e.g. QDi.123, SDN-12345). */
  reference: string;
  /** Primary name as it appears on the list entry. */
  entryName: string;
  /** Up to 3 aliases on the list entry — further truncated by the renderer. */
  entryAliases?: string[];
  /** Date of birth on the list entry (any format — rendered verbatim). */
  entryDob?: string;
  /** Nationality / country of designation (ISO-2 preferred). */
  entryNationality?: string;
  /** ID number on the list entry, if published. */
  entryId?: string;
  /** Date listed / effective date — rendered verbatim. */
  listedOn?: string;
  /** Designation reason / listing reason — truncated to 300 chars. */
  reason?: string;
  /** NEW / AMENDMENT / DELISTING — drives the ACTION block. */
  changeType: RiskAlertChangeType;
  /** For AMENDMENT: what changed (free-text summary). */
  amendmentSummary?: string;
}

export interface RiskAlertScore {
  composite: number;
  breakdown: IdentityMatchBreakdown;
  classification: IdentityClassification;
  /** True when the 'alert' band was clamped to 'possible' by the unresolved-identity rule. */
  clamped: boolean;
}

export interface RiskAlertContext {
  trigger: RiskAlertTrigger;
  /** Cron name / run identifier, rendered into SOURCE. */
  runId: string;
  /** ISO timestamp of the event that generated the alert. */
  generatedAtIso: string;
  /** Optional git sha of the deployed bot for audit. */
  commitSha?: string;
}

export interface RiskAlertInput {
  subject: WatchlistEntry;
  match: RiskAlertMatch;
  score: RiskAlertScore;
  ctx: RiskAlertContext;
}

export interface RiskAlertTask {
  title: string;
  notes: string;
  tags: string[];
  /** ALERT / POSSIBLE / CHANGE — drives assignee + due-date logic in the dispatcher. */
  severity: 'ALERT' | 'POSSIBLE' | 'CHANGE';
  /** Whether this task needs CO escalation (alerts do, possibles don't). */
  requiresCoEscalation: boolean;
}

// ---------------------------------------------------------------------------
// Severity resolver
// ---------------------------------------------------------------------------

export function resolveSeverity(
  score: RiskAlertScore,
  match: RiskAlertMatch,
  hasResolvedIdentity: boolean
): 'ALERT' | 'POSSIBLE' | 'CHANGE' {
  if (match.changeType === 'AMENDMENT' || match.changeType === 'DELISTING') {
    return 'CHANGE';
  }
  if (score.classification === 'alert' && hasResolvedIdentity) {
    return 'ALERT';
  }
  return 'POSSIBLE';
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function fmt2(n: number): string {
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}

function listSlug(list: string): string {
  return list
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function renderSubjectBlock(entry: WatchlistEntry): string {
  const lines: string[] = [];
  lines.push('SUBJECT');
  lines.push(`  Customer:     ${entry.subjectName}  (id: ${entry.id})`);
  lines.push(`  Risk tier:    ${entry.riskTier}`);
  const rid = entry.resolvedIdentity;
  if (rid) {
    const who = rid.resolvedBy ? ` by ${rid.resolvedBy}` : '';
    const when = rid.resolvedAtIso ? ` ${rid.resolvedAtIso.slice(0, 10)}` : '';
    lines.push(`  Identity:     PINNED${when}${who}`);
    if (rid.dob) lines.push(`  DoB:          ${rid.dob}`);
    if (rid.nationality) lines.push(`  Nationality:  ${rid.nationality}`);
    if (rid.idNumber) {
      const type = rid.idType ?? 'id';
      const issuer = rid.idIssuingCountry ? ` (${rid.idIssuingCountry})` : '';
      lines.push(`  ID:           ${type} ${rid.idNumber}${issuer}`);
    }
    if (rid.aliases && rid.aliases.length > 0) {
      lines.push(`  Aliases:      ${rid.aliases.join(', ')}`);
    }
    if (rid.listEntryRef) {
      lines.push(`  Pin ref:      ${rid.listEntryRef.list}/${rid.listEntryRef.reference}`);
    }
    if (rid.resolutionNote) {
      lines.push(`  Note:         ${truncate(rid.resolutionNote, 200)}`);
    }
  } else {
    lines.push('  Identity:     UNRESOLVED');
    lines.push('    FATF Rec 10: NOT yet positively identified. Any "alert" band is');
    lines.push('    auto-downgraded to "possible" until the MLRO pins or dismisses the');
    lines.push('    identity in Screening Command.');
  }
  return lines.join('\n');
}

function renderMatchBlock(match: RiskAlertMatch): string {
  const lines: string[] = [];
  lines.push('MATCH');
  lines.push(`  List:         ${match.list}`);
  lines.push(`  Entry ref:    ${match.reference}`);
  lines.push(`  Entry name:   ${match.entryName}`);
  if (match.entryAliases && match.entryAliases.length > 0) {
    lines.push(
      `  Entry aliases: ${match.entryAliases
        .slice(0, 3)
        .map((a) => `"${a}"`)
        .join(', ')}`
    );
  }
  if (match.entryDob) lines.push(`  Entry DoB:    ${match.entryDob}`);
  if (match.entryNationality) lines.push(`  Entry nat:    ${match.entryNationality}`);
  if (match.entryId) lines.push(`  Entry ID:     ${match.entryId}`);
  if (match.listedOn) lines.push(`  Listed:       ${match.listedOn}`);
  if (match.reason) lines.push(`  Reason:       ${truncate(match.reason, 300)}`);
  lines.push(`  Change type:  ${match.changeType}`);
  if (match.amendmentSummary) {
    lines.push(`  What changed: ${truncate(match.amendmentSummary, 300)}`);
  }
  return lines.join('\n');
}

function renderScoreBlock(score: RiskAlertScore): string {
  const b = score.breakdown;
  const lines: string[] = [];
  lines.push('SCORE BREAKDOWN');
  lines.push(
    `  name ${fmt2(b.name)}   dob ${fmt2(b.dob)}   nationality ${fmt2(b.nationality)}   id ${fmt2(b.id)}   alias ${fmt2(b.alias)}`
  );
  lines.push('  Weights:      name 0.30, dob 0.30, nat 0.20, id 0.20, alias bonus 0.10');
  lines.push(`  Composite:    ${fmt2(score.composite)}  → ${score.classification}`);
  lines.push(`  Clamp:        ${score.clamped ? "'alert' → 'possible' (unresolved)" : 'none'}`);
  return lines.join('\n');
}

const REGULATORY_BLOCK = [
  'REGULATORY BASIS',
  '  FATF Rec 10              positive identification required',
  '  FDL No.10/2025 Art.12    CDD',
  '  FDL No.10/2025 Art.20    CO monitoring',
  '  FDL No.10/2025 Art.35    targeted financial sanctions apply to THE subject',
  '  FDL No.10/2025 Art.29    no tipping off',
  '  Cabinet Res 74/2020 Art.4 + EOCN TFS Guidance July 2025',
  '                           freeze immediately (1-2 h max) on confirmed match',
  '  Cabinet Res 74/2020 Art.6  CNMR within 5 business days',
].join('\n');

function renderActionBlock(severity: 'ALERT' | 'POSSIBLE' | 'CHANGE', subjectId: string): string {
  const lines: string[] = ['ACTION REQUIRED'];
  if (severity === 'ALERT') {
    lines.push(`  [ ] 1. FREEZE all assets/accounts under ${subjectId} NOW (1-2 h max).`);
    lines.push('  [ ] 2. Notify EOCN (goAML) within 5 business days — CNMR.');
    lines.push('  [ ] 3. Draft STR/SAR, validate via /goaml, upload to FIU portal.');
    lines.push('  [ ] 4. Log freeze timestamp + 4-eyes approver in audit trail.');
    lines.push('  [ ] 5. DO NOT notify subject (FDL Art.29).');
  } else if (severity === 'POSSIBLE') {
    lines.push('  [ ] 1. Open Screening Command → matched candidates row.');
    lines.push('  [ ] 2. Click "Pin as subject" (if this person IS the customer)');
    lines.push('         OR "Not the subject" (if coincidence).');
    lines.push('  [ ] 3. If pinned: composite rescores on next monitor run. A pinned');
    lines.push('         composite >= 0.80 escalates to ALERT + freeze path automatically.');
    lines.push('  [ ] 4. DO NOT notify subject (FDL Art.29).');
  } else {
    lines.push('  [ ] 1. Read the amendment / delisting above.');
    lines.push('  [ ] 2. Decide if existing freeze remains sufficient or needs extension.');
    lines.push('  [ ] 3. Update STR file if material; re-file to FIU if required.');
    lines.push('  [ ] 4. DO NOT notify subject (FDL Art.29).');
  }
  return lines.join('\n');
}

function renderSourceBlock(ctx: RiskAlertContext): string {
  const lines: string[] = [];
  lines.push('SOURCE');
  lines.push(`  Trigger:   ${ctx.trigger}`);
  lines.push(`  Run:       ${ctx.runId}`);
  lines.push(`  At:        ${ctx.generatedAtIso}`);
  if (ctx.commitSha) lines.push(`  Commit:    ${ctx.commitSha}`);
  return lines.join('\n');
}

const TIPOFF_FOOTER = [
  '──────────────────────────────────────────────────────────────────',
  'Do NOT notify the subject — FDL No.10/2025 Art.29 (no tipping off).',
  '──────────────────────────────────────────────────────────────────',
].join('\n');

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildRiskAlertTask(input: RiskAlertInput): RiskAlertTask {
  const { subject, match, score, ctx } = input;
  const hasResolved = Boolean(subject.resolvedIdentity);
  const severity = resolveSeverity(score, match, hasResolved);

  const pinMarker =
    hasResolved && subject.resolvedIdentity?.listEntryRef
      ? ` (PIN:${subject.resolvedIdentity.listEntryRef.list}/${subject.resolvedIdentity.listEntryRef.reference})`
      : '';
  const title = truncate(
    `[SCREEN:${severity}] ${match.list} — ${subject.subjectName}${pinMarker}`,
    300
  );

  const tags: string[] = ['screening', severity.toLowerCase(), listSlug(match.list)];
  tags.push(hasResolved ? 'pinned-match' : 'unresolved-identity');
  tags.push(`trigger-${ctx.trigger}`);

  const header = [
    '┌───────────────────────────────────────────────────────────────┐',
    `│ POTENTIAL MATCH                                               │`,
    `│ Severity: ${severity.padEnd(51)} │`,
    `│ Composite score: ${fmt2(score.composite)}  →  ${score.classification.padEnd(38)} │`,
    `│ Generated: ${ctx.generatedAtIso.padEnd(50)} │`,
    '└───────────────────────────────────────────────────────────────┘',
  ].join('\n');

  const notes = [
    header,
    '',
    renderSubjectBlock(subject),
    '',
    renderMatchBlock(match),
    '',
    renderScoreBlock(score),
    '',
    REGULATORY_BLOCK,
    '',
    renderActionBlock(severity, subject.id),
    '',
    renderSourceBlock(ctx),
    '',
    TIPOFF_FOOTER,
  ].join('\n');

  return {
    title,
    notes: truncate(notes, 60_000),
    tags,
    severity,
    requiresCoEscalation: severity === 'ALERT',
  };
}
