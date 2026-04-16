/**
 * Weaponized Brain — Phase 14 Intelligence & Awareness subsystems (#104-#109).
 *
 * Five additive reasoning layers that close remaining gaps identified in
 * the Phase 13 gap analysis: cross-jurisdiction conflict awareness,
 * peer-group deviation detection, regulatory-calendar urgency, inter-
 * subsystem agreement scoring, and counterfactual completion. All are
 * pure TypeScript, browser-safe, optional, and diagnostic only — they
 * do NOT mutate the final verdict in v1.
 *
 *   #104 Cross-Jurisdiction Conflict — detects conflicting regulatory
 *                                       obligations across jurisdictions
 *                                       (UAE freeze vs GDPR minimisation,
 *                                       OFAC secondary vs EU Blocking Reg).
 *                                       Distinct from #68 (cross-border
 *                                       price arbitrage).
 *   #105 Peer-Group Deviation       — reports how far this entity's
 *                                       verdict sits from the peer-group
 *                                       distribution. Distinct from #29
 *                                       (signal correlation across
 *                                       customers) — this is outcome
 *                                       deviation at verdict level.
 *   #106 Regulatory Calendar        — classifies upcoming filing/CDD
 *                                       deadlines by urgency (overdue /
 *                                       24h / 5d / 30d / distant) using
 *                                       business-day math. Reports only
 *                                       in v1; clamp is a follow-up.
 *   #107 Inter-Subsystem Agreement  — fraction of high-confidence signals
 *                                       that concur with finalVerdict.
 *                                       Distinct from #22 (contradiction
 *                                       detector: pairwise disagreement),
 *                                       #40 (BFT consensus: quorum vote),
 *                                       #94 (Bayesian Shannon entropy:
 *                                       probability distribution).
 *   #109 Counterfactual Completion  — inverse of #25/#99: which additional
 *                                       evidence types would need to
 *                                       appear to escalate further.
 *                                       Produces MLRO evidence-gathering
 *                                       checklist.
 *
 * Regulatory basis (composite):
 *   - FDL No.10/2025 Art.20-21 (CO duties, risk-based decision support)
 *   - FDL No.10/2025 Art.24    (audit trail, record retention)
 *   - Cabinet Res 134/2025 Art.5  (risk appetite)
 *   - Cabinet Res 134/2025 Art.19 (internal review deadlines)
 *   - Cabinet Res 74/2020 Art.4-7 (24h freeze window)
 *   - Cabinet Decision 109/2023  (15 working days UBO re-verification)
 *   - FATF Rec 19 / 22 / 23      (higher-risk jurisdictions, DNFBP obligations)
 *   - EU GDPR Art.5(1)(c)        (data minimisation)
 *   - EU Blocking Reg 2271/96    (counter-OFAC secondary sanctions)
 *   - CLAUDE.md §3 / §8          (audit + citation discipline)
 */

import type { Verdict } from './teacherStudent';
import type { SubsystemSignal } from './contradictionDetector';

const VERDICT_RANK: Record<Verdict, number> = {
  pass: 0,
  flag: 1,
  escalate: 2,
  freeze: 3,
};

// ---------------------------------------------------------------------------
// #104 Cross-Jurisdiction Conflict Detector
// ---------------------------------------------------------------------------

export type JurisdictionCode =
  | 'UAE'
  | 'US'
  | 'EU'
  | 'UK'
  | 'CH'
  | 'SG'
  | 'HK'
  | 'IN'
  | 'CN'
  | 'RU'
  | 'IR'
  | 'KP'
  | 'SY'
  | 'OTHER';

export type ProposedAction =
  | 'freeze'
  | 'escalate'
  | 'file-str'
  | 'share-data'
  | 'block-transaction';

export interface JurisdictionConflict {
  /** The two conflicting jurisdictions. */
  between: [JurisdictionCode, JurisdictionCode];
  /** The action that creates the conflict. */
  action: ProposedAction;
  /** Human-readable description of the clash. */
  description: string;
  /** Severity of the conflict. */
  severity: 'low' | 'medium' | 'high';
  /** Regulatory citations for both sides of the conflict. */
  citations: string[];
}

export interface CrossJurisdictionConflictReport {
  conflicts: JurisdictionConflict[];
  /** True when any high-severity conflict was detected. */
  hasHighSeverityConflict: boolean;
  narrative: string;
}

// Known conflict patterns. Kept inline (not data-file) because the rules
// are regulatory constants that change rarely and must be auditable in
// the code review. Add entries via PR only, with citation.
interface ConflictRule {
  readonly a: JurisdictionCode;
  readonly b: JurisdictionCode;
  readonly action: ProposedAction;
  readonly description: string;
  readonly severity: 'low' | 'medium' | 'high';
  readonly citations: ReadonlyArray<string>;
}

const CONFLICT_RULES: ReadonlyArray<ConflictRule> = [
  {
    a: 'UAE',
    b: 'EU',
    action: 'share-data',
    description:
      'UAE AML audit-trail retention (10 yr under Art.24) may conflict with GDPR data-minimisation and storage-limitation when EU data subjects are involved.',
    severity: 'medium',
    citations: ['FDL No.10/2025 Art.24', 'EU GDPR Art.5(1)(c)', 'EU GDPR Art.5(1)(e)'],
  },
  {
    a: 'US',
    b: 'EU',
    action: 'freeze',
    description:
      'US OFAC secondary-sanctions enforcement may conflict with EU Blocking Regulation 2271/96 when an EU entity is instructed to freeze a non-EU counterparty.',
    severity: 'high',
    citations: ['OFAC 31 CFR 501', 'EU Council Reg 2271/96 Art.5'],
  },
  {
    a: 'UAE',
    b: 'US',
    action: 'file-str',
    description:
      'UAE FDL Art.29 no-tipping-off may conflict with US SAR disclosure obligations when a US parent of the UAE subject requests notification.',
    severity: 'high',
    citations: ['FDL No.10/2025 Art.29', '31 USC 5318(g)'],
  },
  {
    a: 'UAE',
    b: 'CH',
    action: 'share-data',
    description:
      'UAE sharing of PEP records with a CH counterparty may trigger Swiss FADP restrictions on cross-border PEP data transfer.',
    severity: 'low',
    citations: ['Cabinet Res 134/2025 Art.14', 'Swiss FADP Art.16'],
  },
  {
    a: 'UAE',
    b: 'UK',
    action: 'block-transaction',
    description:
      'Blocking a UK counterparty on a UAE-side EDD outcome may breach UK MLR 2017 proportionality unless the EDD rationale is cited.',
    severity: 'low',
    citations: ['Cabinet Res 134/2025 Art.14', 'UK MLR 2017 Reg 28'],
  },
];

export function detectCrossJurisdictionConflicts(input: {
  readonly action: ProposedAction;
  readonly jurisdictions: ReadonlyArray<JurisdictionCode>;
}): CrossJurisdictionConflictReport {
  const conflicts: JurisdictionConflict[] = [];
  const jset = new Set(input.jurisdictions);
  for (const rule of CONFLICT_RULES) {
    if (rule.action !== input.action) continue;
    if (!jset.has(rule.a) || !jset.has(rule.b)) continue;
    conflicts.push({
      between: [rule.a, rule.b],
      action: rule.action,
      description: rule.description,
      severity: rule.severity,
      citations: [...rule.citations],
    });
  }
  const hasHighSeverityConflict = conflicts.some((c) => c.severity === 'high');
  return {
    conflicts,
    hasHighSeverityConflict,
    narrative:
      conflicts.length === 0
        ? `No cross-jurisdiction conflicts detected for action '${input.action}' across ${input.jurisdictions.join(', ')}.`
        : `${conflicts.length} cross-jurisdiction conflict(s) detected — ` +
          `${hasHighSeverityConflict ? 'HIGH severity present; ' : ''}` +
          `legal review required before executing action '${input.action}'.`,
  };
}

// ---------------------------------------------------------------------------
// #105 Peer-Group Deviation Detector
// ---------------------------------------------------------------------------

export interface PeerGroupDistribution {
  /** Size of the peer group used to build the distribution. */
  peerCount: number;
  /** Fraction of peers at each verdict. Must sum to ~1.0. */
  distribution: Record<Verdict, number>;
}

export interface PeerDeviationReport {
  /** The entity's current verdict. */
  currentVerdict: Verdict;
  /** Fraction of peers at the same verdict (0..1). */
  peerMatchFraction: number;
  /** Z-score of the entity's verdict rank vs the peer-weighted mean. */
  zScore: number;
  /** True when the entity deviates more than 2 standard deviations. */
  significantDeviation: boolean;
  /** Human-readable summary. */
  narrative: string;
}

export function runPeerGroupDeviation(input: {
  readonly currentVerdict: Verdict;
  readonly peer: PeerGroupDistribution;
}): PeerDeviationReport {
  const d = input.peer.distribution;
  // Weighted mean rank of the peer group.
  const meanRank =
    (d.pass ?? 0) * VERDICT_RANK.pass +
    (d.flag ?? 0) * VERDICT_RANK.flag +
    (d.escalate ?? 0) * VERDICT_RANK.escalate +
    (d.freeze ?? 0) * VERDICT_RANK.freeze;
  // Weighted variance of the rank.
  const varRank =
    (d.pass ?? 0) * (VERDICT_RANK.pass - meanRank) ** 2 +
    (d.flag ?? 0) * (VERDICT_RANK.flag - meanRank) ** 2 +
    (d.escalate ?? 0) * (VERDICT_RANK.escalate - meanRank) ** 2 +
    (d.freeze ?? 0) * (VERDICT_RANK.freeze - meanRank) ** 2;
  const sd = Math.sqrt(Math.max(varRank, 1e-9));
  const myRank = VERDICT_RANK[input.currentVerdict];
  const zScore = Math.round(((myRank - meanRank) / sd) * 100) / 100;
  const peerMatchFraction = Math.max(0, Math.min(1, d[input.currentVerdict] ?? 0));
  const significantDeviation = Math.abs(zScore) >= 2;
  return {
    currentVerdict: input.currentVerdict,
    peerMatchFraction,
    zScore,
    significantDeviation,
    narrative:
      `Peer-group deviation: verdict '${input.currentVerdict}' z=${zScore.toFixed(2)} ` +
      `(${(peerMatchFraction * 100).toFixed(0)}% of ${input.peer.peerCount} peers agree). ` +
      (significantDeviation
        ? 'Significant deviation — secondary review recommended (Cabinet Res 134/2025 Art.19).'
        : 'Within peer norms.'),
  };
}

// ---------------------------------------------------------------------------
// #106 Regulatory Calendar Urgency
// ---------------------------------------------------------------------------

export type DeadlineKind =
  | 'STR'
  | 'SAR'
  | 'CTR'
  | 'DPMSR'
  | 'CNMR'
  | 'EOCN-freeze'
  | 'CDD-review'
  | 'EDD-review'
  | 'UBO-reverify'
  | 'policy-update';

export type UrgencyBucket = 'overdue' | '24h' | '5d' | '30d' | 'distant';

export interface RegulatoryDeadline {
  kind: DeadlineKind;
  /** Due date — ISO-8601 string or Date. */
  due: string | Date;
  /** Optional reference (e.g. case id, filing id). */
  ref?: string;
}

export interface DeadlineBucket {
  deadline: RegulatoryDeadline;
  hoursRemaining: number;
  urgency: UrgencyBucket;
  /** Regulatory citation appropriate for this deadline kind. */
  citation: string;
}

export interface RegulatoryCalendarReport {
  entries: DeadlineBucket[];
  /** Count of overdue deadlines. */
  overdueCount: number;
  /** Count within the 24-hour clock. */
  within24hCount: number;
  narrative: string;
}

const DEADLINE_CITATIONS: Record<DeadlineKind, string> = {
  STR: 'FDL No.10/2025 Art.26-27',
  SAR: 'FDL No.10/2025 Art.26-27',
  CTR: 'MoE Circular 08/AML/2021',
  DPMSR: 'MoE Circular 08/AML/2021',
  CNMR: 'Cabinet Res 74/2020 Art.4-7',
  'EOCN-freeze': 'Cabinet Res 74/2020 Art.4-7',
  'CDD-review': 'Cabinet Res 134/2025 Art.7',
  'EDD-review': 'Cabinet Res 134/2025 Art.14',
  'UBO-reverify': 'Cabinet Decision 109/2023',
  'policy-update': 'Cabinet Res 134/2025 Art.18',
};

function bucketOf(hoursRemaining: number): UrgencyBucket {
  if (hoursRemaining < 0) return 'overdue';
  if (hoursRemaining <= 24) return '24h';
  if (hoursRemaining <= 24 * 5) return '5d';
  if (hoursRemaining <= 24 * 30) return '30d';
  return 'distant';
}

export function runRegulatoryCalendar(input: {
  readonly deadlines: ReadonlyArray<RegulatoryDeadline>;
  readonly asOf?: Date;
}): RegulatoryCalendarReport {
  const now = input.asOf ?? new Date();
  const entries: DeadlineBucket[] = [];
  let overdueCount = 0;
  let within24hCount = 0;
  for (const d of input.deadlines) {
    const dueDate = d.due instanceof Date ? d.due : new Date(d.due);
    const hours = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    const urgency = bucketOf(hours);
    if (urgency === 'overdue') overdueCount += 1;
    if (urgency === '24h') within24hCount += 1;
    entries.push({
      deadline: d,
      hoursRemaining: Math.round(hours * 10) / 10,
      urgency,
      citation: DEADLINE_CITATIONS[d.kind],
    });
  }
  // Sort most-urgent first.
  entries.sort((a, b) => a.hoursRemaining - b.hoursRemaining);
  return {
    entries,
    overdueCount,
    within24hCount,
    narrative:
      `Regulatory calendar: ${overdueCount} overdue, ${within24hCount} within 24h, ` +
      `${entries.length - overdueCount - within24hCount} beyond 24h. ` +
      `${
        overdueCount > 0
          ? 'OVERDUE filings breach FDL Art.26-27 / Cabinet Res 74/2020 — escalate to MLRO immediately.'
          : 'No immediate breaches.'
      }`,
  };
}

// ---------------------------------------------------------------------------
// #107 Inter-Subsystem Agreement Scorer
// ---------------------------------------------------------------------------

export interface AgreementScore {
  /** Count of signals inspected (confidence >= 0.5). */
  considered: number;
  /** Count of signals that concur with finalVerdict. */
  concurring: number;
  /** concurring / considered, in [0, 1]. 1 means total agreement. */
  ratio: number;
  /** Confidence-weighted concurrence fraction. */
  weightedRatio: number;
  /** Names of dissenting high-confidence signals. */
  dissenters: string[];
  narrative: string;
}

export function scoreInterSubsystemAgreement(input: {
  readonly finalVerdict: Verdict;
  readonly signals: ReadonlyArray<SubsystemSignal>;
}): AgreementScore {
  let considered = 0;
  let concurring = 0;
  let weightedConcur = 0;
  let weightedTotal = 0;
  const dissenters: string[] = [];
  for (const s of input.signals) {
    if (s.confidence < 0.5) continue;
    considered += 1;
    weightedTotal += s.confidence;
    if (s.impliedVerdict === input.finalVerdict) {
      concurring += 1;
      weightedConcur += s.confidence;
    } else {
      dissenters.push(s.name);
    }
  }
  const ratio = considered === 0 ? 1 : concurring / considered;
  const weightedRatio = weightedTotal === 0 ? 1 : weightedConcur / weightedTotal;
  return {
    considered,
    concurring,
    ratio: Math.round(ratio * 1000) / 1000,
    weightedRatio: Math.round(weightedRatio * 1000) / 1000,
    dissenters,
    narrative:
      `Inter-subsystem agreement: ${concurring}/${considered} concur (${(ratio * 100).toFixed(0)}%); ` +
      `weighted ${(weightedRatio * 100).toFixed(0)}%. ` +
      (dissenters.length > 0
        ? `Dissenters: ${dissenters.join(', ')}. Low agreement may reduce regulator confidence (Cabinet Res 134/2025 Art.19).`
        : 'Unanimous.'),
  };
}

// ---------------------------------------------------------------------------
// #109 Counterfactual Completion Engine
// ---------------------------------------------------------------------------

export interface EvidenceGap {
  /** The evidence class that, if found, would raise the verdict. */
  evidenceType: string;
  /** What verdict level this would push us to. */
  wouldReach: Verdict;
  /** Suggested source where the evidence would typically come from. */
  suggestedSource: string;
  /** Regulatory citation that justifies gathering this evidence. */
  citation: string;
}

export interface CounterfactualCompletionReport {
  currentVerdict: Verdict;
  /** Evidence still missing that could plausibly raise the verdict. */
  gaps: EvidenceGap[];
  /** True when no plausible escalation path remains (already maxed or over-determined). */
  exhaustive: boolean;
  narrative: string;
}

// Evidence classes we know how to look for and what verdict they imply.
// Extend via PR only, with a regulatory citation per entry.
interface EvidenceClass {
  readonly type: string;
  readonly verdict: Verdict;
  readonly source: string;
  readonly citation: string;
}

const EVIDENCE_LIBRARY: ReadonlyArray<EvidenceClass> = [
  {
    type: 'confirmed-sanctions-match',
    verdict: 'freeze',
    source: 'UN / OFAC / EU / UK / UAE consolidated list',
    citation: 'FDL No.10/2025 Art.35 + Cabinet Res 74/2020 Art.4-7',
  },
  {
    type: 'PEP-with-adverse-media',
    verdict: 'escalate',
    source: 'Dow Jones / World-Check / LSEG Risk Intelligence',
    citation: 'Cabinet Res 134/2025 Art.14',
  },
  {
    type: 'UBO-opaque-above-25pct',
    verdict: 'escalate',
    source: 'Entity UBO register + corporate filings',
    citation: 'Cabinet Decision 109/2023',
  },
  {
    type: 'structured-cash-deposits-above-AED55K',
    verdict: 'escalate',
    source: 'Transaction monitoring system + cash ledger',
    citation: 'MoE Circular 08/AML/2021 + FATF Rec 10',
  },
  {
    type: 'high-risk-jurisdiction-nexus',
    verdict: 'flag',
    source: 'FATF grey/black list + CBUAE country-risk register',
    citation: 'FATF Rec 19',
  },
  {
    type: 'adverse-media-corroborated',
    verdict: 'flag',
    source: 'Deep research engine (#98) with 2+ distinct hostnames',
    citation: 'FATF Rec 10 + Cabinet Res 134/2025 Art.14',
  },
  {
    type: 'wallet-taint-propagation-hit',
    verdict: 'escalate',
    source: 'VASP wallet analytics (Chainalysis / TRM Labs)',
    citation: 'FDL No.10/2025 Art.20-21 + FATF VASP Guidance',
  },
];

export function runCounterfactualCompletion(input: {
  readonly currentVerdict: Verdict;
  readonly knownEvidenceTypes: ReadonlyArray<string>;
}): CounterfactualCompletionReport {
  const currentRank = VERDICT_RANK[input.currentVerdict];
  const known = new Set(input.knownEvidenceTypes);
  const gaps: EvidenceGap[] = [];
  for (const e of EVIDENCE_LIBRARY) {
    if (VERDICT_RANK[e.verdict] <= currentRank) continue;
    if (known.has(e.type)) continue;
    gaps.push({
      evidenceType: e.type,
      wouldReach: e.verdict,
      suggestedSource: e.source,
      citation: e.citation,
    });
  }
  const exhaustive = input.currentVerdict === 'freeze' || gaps.length === 0;
  return {
    currentVerdict: input.currentVerdict,
    gaps,
    exhaustive,
    narrative: exhaustive
      ? `Verdict ${input.currentVerdict} is already at ceiling or no actionable evidence gaps remain.`
      : `${gaps.length} evidence gap(s) identified that could raise verdict beyond ${input.currentVerdict} — ` +
        `MLRO checklist for further investigation (Cabinet Res 134/2025 Art.19).`,
  };
}
