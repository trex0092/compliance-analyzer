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
import type { CalibratedIdentityScore, IdentityCounterfactual } from './identityScoreBayesian';
import type { SubjectCorroboration } from './multiListCorroboration';
import type { DeliberativeBrainResult } from './deliberativeBrainChain';
import type { ForensicInvestigation } from './forensicInvestigator';
import { buildStrNarrativeDraft } from './strNarrativePreDraft';

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
  /**
   * Bayesian calibration of the identity match. Optional for backwards
   * compatibility with the ~40 existing call sites; when omitted the
   * task renders exactly as before. When provided, the renderer emits
   * three additional blocks: calibrated posterior + uncertainty
   * interval, top counterfactuals, and an alerting on contradictions.
   */
  calibrated?: CalibratedIdentityScore;
  /**
   * Multi-list cross-corroboration for THIS subject (not this match).
   * Rendered as a single line when boost > 0 so the MLRO sees the
   * strength-in-numbers signal immediately.
   */
  corroboration?: SubjectCorroboration;
  /**
   * Optional five-step deliberative brain chain — dynamic prior →
   * calibrated posterior → hypothesis ranking → temporal decay →
   * confidence triage. Renders a multi-block chain-of-thought trace
   * that makes the MLRO's reasoning auditable under FDL Art.20-21 +
   * EU AI Act Art.13 + NIST AI RMF Measure 2.9.
   */
  brain?: DeliberativeBrainResult;
  /**
   * Optional forensic investigation packet — findings + prioritised
   * next investigative steps. Rendered as a detective's notebook so
   * the MLRO sees the shortest path to a defensible decision.
   */
  forensic?: ForensicInvestigation;
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

/**
 * Surrogate-safe truncation. `String.prototype.slice` cuts at UTF-16
 * code units, which splits astral-plane characters (emoji, some CJK,
 * rare scripts) mid-surrogate-pair and produces an invalid UTF-16
 * sequence. Asana (and any JSON consumer) can silently mangle or
 * reject the payload when that happens. We truncate at grapheme-safe
 * code points via the Array iterator.
 */
function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  const codePoints = Array.from(s);
  if (codePoints.length <= n) return s;
  return codePoints.slice(0, n - 1).join('') + '…';
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

// ---------------------------------------------------------------------------
// Reasoning block — explains WHY the score landed where it did so the
// MLRO can read a short narrative instead of interpreting raw weights.
// Renders:
//   - Which identifiers corroborated the match (name, DoB, nat, ID, alias)
//   - Which identifiers were missing or conflicted
//   - Near-miss warnings when the composite is within 0.05 of a band boundary
//   - The dominant signal that drove the classification
// ---------------------------------------------------------------------------

const ALERT_BAND = 0.8;
const POSSIBLE_BAND = 0.5;
const NEAR_MISS_WINDOW = 0.05;

function describeComponent(
  label: string,
  raw: number,
  hitValue: string | undefined,
  subjectValue: string | undefined
): string | null {
  if (raw >= 0.999) {
    return `  ✓ ${label.padEnd(13)} exact match${subjectValue ? ` (${subjectValue})` : ''}`;
  }
  if (raw >= 0.5) {
    return `  ~ ${label.padEnd(13)} partial match${subjectValue ? ` (subj: ${subjectValue}, hit: ${hitValue ?? '?'})` : ''}`;
  }
  if (raw > 0) {
    return `  ~ ${label.padEnd(13)} weak signal (${fmt2(raw)})`;
  }
  if (subjectValue && hitValue && subjectValue !== hitValue) {
    return `  ✗ ${label.padEnd(13)} MISMATCH (subj: ${subjectValue}, hit: ${hitValue})`;
  }
  if (!subjectValue) {
    return `  · ${label.padEnd(13)} subject has no ${label.toLowerCase()} on file`;
  }
  if (!hitValue) {
    return `  · ${label.padEnd(13)} list entry carries no ${label.toLowerCase()}`;
  }
  return null;
}

function dominantSignal(b: IdentityMatchBreakdown): string {
  // Weighted contributions per the published formula.
  const contrib: Array<[string, number]> = [
    ['name', b.name * 0.3],
    ['dob', b.dob * 0.3],
    ['nationality', b.nationality * 0.2],
    ['id', b.id * 0.2],
    ['alias bonus', b.alias],
  ];
  contrib.sort((a, b2) => b2[1] - a[1]);
  const [top, topVal] = contrib[0];
  if (topVal <= 0) return 'none (every component is zero)';
  return `${top} (contribution ${fmt2(topVal)})`;
}

function renderReasoningBlock(
  severity: 'ALERT' | 'POSSIBLE' | 'CHANGE',
  subject: WatchlistEntry,
  match: RiskAlertMatch,
  score: RiskAlertScore
): string {
  const lines: string[] = ['WHY THIS ALERT'];
  const rid = subject.resolvedIdentity;
  const b = score.breakdown;

  const nameLine = describeComponent('Name', b.name, match.entryName, subject.subjectName);
  if (nameLine) lines.push(nameLine);
  const dobLine = describeComponent('Date of birth', b.dob, match.entryDob, rid?.dob);
  if (dobLine) lines.push(dobLine);
  const natLine = describeComponent(
    'Nationality',
    b.nationality,
    match.entryNationality,
    rid?.nationality
  );
  if (natLine) lines.push(natLine);
  const idLine = describeComponent('ID number', b.id, match.entryId, rid?.idNumber);
  if (idLine) lines.push(idLine);
  if (b.alias > 0) {
    lines.push('  ✓ Alias       hit matched a recorded alias of the subject');
  }

  if (rid?.listEntryRef) {
    const pinMatches =
      rid.listEntryRef.list.trim().toUpperCase() === match.list.trim().toUpperCase() &&
      rid.listEntryRef.reference.trim() === match.reference.trim();
    lines.push(
      pinMatches
        ? `  ✓ Designation pin matches THIS entry (${match.list}/${match.reference})`
        : `  · Pinned to ${rid.listEntryRef.list}/${rid.listEntryRef.reference}; this hit is a different designation`
    );
  } else if (rid) {
    lines.push('  · No designation pin set — identifier match only, no list-ref anchor');
  } else {
    lines.push('  ⚠ No resolved identity on file — FATF Rec 10 clamp active');
  }

  lines.push(`  Dominant signal: ${dominantSignal(b)}`);

  if (severity === 'POSSIBLE' && score.composite >= ALERT_BAND - NEAR_MISS_WINDOW) {
    lines.push(
      `  ⚠ Near the ALERT band (${fmt2(score.composite)} vs ${fmt2(ALERT_BAND)}); pinning the identity is likely to promote this to ALERT.`
    );
  } else if (
    score.classification === 'suppress' &&
    score.composite >= POSSIBLE_BAND - NEAR_MISS_WINDOW
  ) {
    lines.push(
      `  ⚠ Near the POSSIBLE band (${fmt2(score.composite)} vs ${fmt2(POSSIBLE_BAND)}); if the subject has a second identifier in common this could flip to POSSIBLE.`
    );
  }
  if (score.clamped) {
    lines.push(
      '  ⚠ Classification was auto-downgraded from "alert" to "possible" because the subject has no resolved identity (FATF Rec 10).'
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Bayesian calibration blocks — the Refinitiv-World-Check-tier layer.
// These blocks only render when the dispatcher passed a calibrated
// score. They NEVER replace the linear composite score above; they
// supplement it with:
//   - A calibrated posterior probability P(match | observed evidence)
//   - A min/max uncertainty interval over unobserved identifiers
//   - The top-3 counterfactual actions ranked by log-odds delta
//   - Cross-list corroboration (same subject on UN + OFAC + EU + …)
//   - FIU-ready STR narrative pre-draft (ALERT severity only)
// All blocks are deterministic and re-rendering-stable so the audit
// trail diffs cleanly across re-runs.
// ---------------------------------------------------------------------------

function pct1(p: number): string {
  const clamped = Math.max(0, Math.min(1, p));
  return `${(clamped * 100).toFixed(1)}%`;
}

function fmtDelta(x: number): string {
  if (!Number.isFinite(x)) return '0.00';
  const sign = x > 0 ? '+' : '';
  return `${sign}${x.toFixed(2)}`;
}

function renderUncertaintyBlock(c: CalibratedIdentityScore): string {
  const lines: string[] = ['CALIBRATED POSTERIOR'];
  const [lo, hi] = c.interval;
  lines.push(
    `  P(same person | evidence) = ${pct1(c.probability)}   (log-odds ${fmtDelta(c.logOdds)})`
  );
  lines.push(`  Uncertainty interval: [${pct1(lo)} .. ${pct1(hi)}]`);
  lines.push(
    '  Interval widens with the evidence we have NOT yet observed (missing DoB, id, nationality, alias, pin).'
  );
  if (c.unobserved.length > 0) {
    lines.push(`  Unobserved identifiers: ${c.unobserved.join(', ')}`);
  } else {
    lines.push('  Unobserved identifiers: none — the evidence set is complete on both sides.');
  }
  if (c.contradictions.length > 0) {
    lines.push(
      `  ⚠ Contradictions observed: ${c.contradictions.join(', ')} — investigate before filing.`
    );
  }
  return lines.join('\n');
}

function describeCounterfactual(cf: IdentityCounterfactual): string {
  const cls = cf.projectedClassification.toUpperCase().padEnd(8);
  const delta = fmtDelta(cf.logOddsDelta);
  return `  ${cls} if ${cf.action}   (Δcomposite→${fmt2(cf.projectedComposite)}, Δlog-odds ${delta})`;
}

function renderCounterfactualsBlock(c: CalibratedIdentityScore): string {
  if (c.counterfactuals.length === 0) {
    return ['COUNTERFACTUALS', '  (no counterfactual moves available — evidence is complete)'].join(
      '\n'
    );
  }
  const lines: string[] = ['COUNTERFACTUALS'];
  lines.push('  The following evidence moves would change the classification. Ranked by');
  lines.push('  log-odds delta so the MLRO sees the highest-leverage next action first:');
  for (const cf of c.counterfactuals.slice(0, 3)) {
    lines.push(describeCounterfactual(cf));
  }
  return lines.join('\n');
}

function renderCorroborationBlock(corro: SubjectCorroboration): string {
  if (corro.lists.length <= 1 || corro.boost <= 0) {
    return '';
  }
  const lines: string[] = ['CROSS-LIST CORROBORATION'];
  lines.push(
    `  Same subject is concurrently flagged on ${corro.lists.length} sanctions lists: ${corro.lists.join(' + ')}`
  );
  lines.push(`  Total dispatches this window: ${corro.dispatchCount}`);
  lines.push(
    `  Confidence booster: +${corro.boost.toFixed(2)} (orders-of-magnitude stronger than a single-list hit).`
  );
  lines.push('  FATF Rec 6 + FDL Art.35: consolidated-designation view enables the freeze.');
  return lines.join('\n');
}

function renderBrainChainBlock(brain: DeliberativeBrainResult): string {
  const lines: string[] = ['DELIBERATIVE BRAIN CHAIN'];
  lines.push('  Five-step chain-of-thought (FDL Art.20-21; EU AI Act Art.13; NIST AI RMF 2.9):');
  for (const line of brain.trace) {
    lines.push(`  ${line}`);
  }
  return lines.join('\n');
}

function renderHypothesisBlock(brain: DeliberativeBrainResult): string {
  const lines: string[] = ['HYPOTHESIS RANKING'];
  lines.push('  Five competing explanations for this hit; posteriors normalised to 100%.');
  for (const h of brain.hypotheses.ranked) {
    const pct = (h.posterior * 100).toFixed(1).padStart(5);
    const tag = h.hypothesis.padEnd(17);
    lines.push(`  ${pct}%  ${tag}  ${h.description}`);
    if (h.supporting.length > 0) {
      lines.push(`          supports: ${h.supporting.join('; ')}`);
    }
    if (h.refuting.length > 0) {
      lines.push(`          refutes:  ${h.refuting.join('; ')}`);
    }
    lines.push(`          next:     ${h.nextAction}`);
  }
  const { leading, decisive } = brain.hypotheses;
  lines.push(
    `  Leader: ${leading.hypothesis} (${(leading.posterior * 100).toFixed(1)}%, margin ${(leading.margin * 100).toFixed(1)} pp) — ${decisive ? 'DECISIVE' : 'AMBIGUOUS'}`
  );
  return lines.join('\n');
}

function renderTriageBlock(brain: DeliberativeBrainResult): string {
  const lines: string[] = ['CONFIDENCE TRIAGE'];
  lines.push(`  Band:      ${brain.triage.band.toUpperCase()}`);
  lines.push(`  Verdict:   ${brain.triage.verdict}`);
  if (brain.triage.deadlineBusinessHours !== undefined) {
    lines.push(`  Deadline:  ${brain.triage.deadlineBusinessHours} business hours`);
  }
  lines.push(`  Approvers: ${brain.triage.approvers.join(', ')}`);
  if (brain.triage.filings.length > 0) {
    lines.push(`  Filings:   ${brain.triage.filings.join(', ')}`);
  }
  lines.push('  Actions:');
  for (const a of brain.triage.actions) {
    lines.push(`    - ${a}`);
  }
  return lines.join('\n');
}

function renderTemporalDecayBlock(brain: DeliberativeBrainResult): string {
  const lines: string[] = ['TEMPORAL DECAY'];
  lines.push(
    `  Evidence age: ${brain.decay.ageDays.toFixed(1)} days   multiplier: ${brain.decay.multiplier.toFixed(2)}   (${brain.decay.freshness})`
  );
  lines.push(
    `  Age-weighted posterior: ${pct1(brain.decayedProbability)}   (half-life 90d; FATF Rec 10 + Cabinet Res 134/2025 Art.19)`
  );
  return lines.join('\n');
}

function renderCounterfactualBlock(brain: DeliberativeBrainResult): string {
  const c = brain.counterfactual;
  const lines: string[] = ['COUNTERFACTUAL ATTRIBUTION'];
  lines.push(`  ${c.summary}`);
  lines.push('  Per-feature contribution (sorted by absolute LLR):');
  for (const a of c.attributions) {
    const sign = a.contributionPp >= 0 ? '+' : '';
    lines.push(
      `    ${a.feature.padEnd(12)} LLR ${a.llr.toFixed(2).padStart(6)}   dom ${(a.dominance * 100).toFixed(0).padStart(3)}%   Δ ${sign}${a.contributionPp.toFixed(1)}pp`
    );
  }
  return lines.join('\n');
}

function renderRedTeamBlock(brain: DeliberativeBrainResult): string {
  const r = brain.redTeam;
  const lines: string[] = ['RED-TEAM CHALLENGES'];
  lines.push(`  ${r.summary}`);
  for (const c of r.challenges) {
    const flag = c.plausibility >= 0.4 ? '[ELEVATED]' : '[reviewed]';
    lines.push(`  ${flag} ${c.scenario} @ ${(c.plausibility * 100).toFixed(0)}%`);
    lines.push(`              ${c.description}`);
    if (c.supportingSignals.length > 0) {
      lines.push(`              Signals: ${c.supportingSignals.join('; ')}`);
    }
    lines.push(`              Probe: ${c.probe}`);
    lines.push(`              Regulatory: ${c.regulatoryAnchor}`);
  }
  return lines.join('\n');
}

function renderCausalInterventionsBlock(brain: DeliberativeBrainResult): string {
  const ci = brain.interventions;
  const lines: string[] = ['CAUSAL INTERVENTIONS (do-calculus)'];
  lines.push(`  ${ci.summary}`);
  if (ci.projections.length === 0) {
    lines.push('  No informational probe available — all identifiers fully corroborated.');
  } else {
    lines.push('  Probe priorities (sorted by informational value):');
    for (const p of ci.projections) {
      lines.push(
        `    ${p.target.padEnd(12)} value ${p.interventionValue.toFixed(1).padStart(5)}pp   uplift +${p.uplift.toFixed(1)}pp / drop -${p.drop.toFixed(1)}pp`
      );
      lines.push(`              Action: ${p.action}`);
      lines.push(`              Regulatory: ${p.regulatoryAnchor}`);
    }
  }
  return lines.join('\n');
}

function renderPeerComparisonBlock(brain: DeliberativeBrainResult): string {
  if (!brain.peers) return '';
  const p = brain.peers;
  const lines: string[] = ['PEER COMPARISON (k-NN reference class)'];
  lines.push(`  ${p.summary}`);
  for (const n of p.neighbours) {
    lines.push(
      `    ${n.case.caseId.padEnd(16)} verdict=${n.case.verdict.padEnd(9)} distance=${n.distance.toFixed(2)}   sim=${(n.similarity * 100).toFixed(0)}%`
    );
    if (n.case.note) lines.push(`              Note: ${n.case.note}`);
  }
  return lines.join('\n');
}

function renderMetaCognitionBlock(brain: DeliberativeBrainResult): string {
  const m = brain.metaCognition;
  const lines: string[] = ['METACOGNITION SELF-AUDIT'];
  lines.push(`  Band: ${m.band}   ${m.summary}`);
  for (const check of m.checks) {
    const icon = check.passed ? '✓' : '✗';
    lines.push(`    ${icon} ${check.dimension.padEnd(22)} ${check.observation}`);
  }
  if (m.warnings.length > 0) {
    lines.push('  MLRO must address before sign-off:');
    for (const w of m.warnings) lines.push(`    ! ${w}`);
  }
  return lines.join('\n');
}

function renderForensicBlock(f: ForensicInvestigation): string {
  const lines: string[] = ['FORENSIC INVESTIGATION'];
  lines.push(`  Overall severity: ${f.overallSeverity.toUpperCase()}`);
  lines.push(`  Verdict: ${f.verdict}`);
  if (f.findings.length === 0) {
    lines.push('  No findings — evidence set is complete and unambiguous.');
  } else {
    lines.push(`  Findings (${f.findings.length}):`);
    for (const finding of f.findings) {
      const sev = finding.severity.toUpperCase().padEnd(10);
      lines.push(`    [${sev}] ${finding.label}`);
      lines.push(`              ${finding.detail}`);
      lines.push(`              Regulatory: ${finding.regulatory}`);
    }
  }
  if (f.nextSteps.length > 0) {
    lines.push('  Next investigative steps (sorted by expected probability gain):');
    for (const step of f.nextSteps.slice(0, 5)) {
      lines.push(
        `    +${step.expectedProbabilityGain.toFixed(1)} pp  [${step.identifier}]  ${step.action}`
      );
      lines.push(`              Regulatory: ${step.regulatory}`);
    }
  }
  return lines.join('\n');
}

function renderStrDraftBlock(
  input: RiskAlertInput,
  severity: 'ALERT' | 'POSSIBLE' | 'CHANGE'
): string {
  if (severity !== 'ALERT') return '';
  if (!input.calibrated || !input.corroboration) return '';
  const draft = buildStrNarrativeDraft({
    subject: input.subject,
    match: input.match,
    score: input.score,
    calibrated: input.calibrated,
    corroboration: input.corroboration,
    generatedAtIso: input.ctx.generatedAtIso,
    runId: input.ctx.runId,
  });
  const lines: string[] = [];
  lines.push('┌─ STR NARRATIVE PRE-DRAFT ─────────────────────────────────────┐');
  lines.push('│ DRAFT — MLRO MUST REVIEW BEFORE FILING                        │');
  lines.push('│ This draft is NOT auto-filed. goAML submission still routes   │');
  lines.push('│ through the four-eyes gate. FDL Art.29 (no tipping off).      │');
  lines.push('└───────────────────────────────────────────────────────────────┘');
  lines.push('');
  lines.push(draft.paragraph);
  lines.push('');
  lines.push('FACTS CITED (cross-check before submission):');
  for (const fact of draft.factList) {
    lines.push(`  • ${fact}`);
  }
  lines.push('');
  const strDeadlineText =
    draft.filingDeadline.strBusinessDays === 0
      ? 'file without delay (FDL Art.26-27)'
      : `${draft.filingDeadline.strBusinessDays} business days (FDL Art.27)`;
  lines.push(
    `FILING DEADLINES: STR ${strDeadlineText} · CNMR ${draft.filingDeadline.cnmrBusinessDays} business days (Cabinet Res 74/2020 Art.6).`
  );
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

  const brainBlocks: string[] = [];
  if (input.calibrated) {
    brainBlocks.push('', renderUncertaintyBlock(input.calibrated));
    brainBlocks.push('', renderCounterfactualsBlock(input.calibrated));
  }
  if (input.corroboration) {
    const corroLines = renderCorroborationBlock(input.corroboration);
    if (corroLines.length > 0) {
      brainBlocks.push('', corroLines);
    }
  }
  if (input.brain) {
    brainBlocks.push('', renderBrainChainBlock(input.brain));
    brainBlocks.push('', renderHypothesisBlock(input.brain));
    brainBlocks.push('', renderTemporalDecayBlock(input.brain));
    brainBlocks.push('', renderTriageBlock(input.brain));
    brainBlocks.push('', renderCounterfactualBlock(input.brain));
    brainBlocks.push('', renderRedTeamBlock(input.brain));
    brainBlocks.push('', renderMetaCognitionBlock(input.brain));
    brainBlocks.push('', renderCausalInterventionsBlock(input.brain));
    brainBlocks.push('', renderPeerComparisonBlock(input.brain));
  }
  if (input.forensic) {
    brainBlocks.push('', renderForensicBlock(input.forensic));
  }
  const strBlock = renderStrDraftBlock(input, severity);

  const notes = [
    header,
    '',
    renderSubjectBlock(subject),
    '',
    renderMatchBlock(match),
    '',
    renderScoreBlock(score),
    '',
    renderReasoningBlock(severity, subject, match, score),
    ...brainBlocks,
    '',
    REGULATORY_BLOCK,
    '',
    renderActionBlock(severity, subject.id),
    ...(strBlock.length > 0 ? ['', strBlock] : []),
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
