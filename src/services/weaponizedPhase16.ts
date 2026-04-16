/**
 * Weaponized Brain — Phase 16 Operational Hardening.
 *
 * Four pure-TypeScript weapons that bolt onto the MLRO operational
 * surface. All diagnostic in v1 — they produce structured reports;
 * callers act on them through the existing approval and audit gates.
 *
 *   1. scoreBehavioralTrust()       Behavioural biometrics trust score
 *                                   for approver sessions. Modulates
 *                                   effective approval authority when
 *                                   session signals drift from the
 *                                   baseline. Insider-threat hedge.
 *                                   Cites FDL Art.20-21 (CO duty of
 *                                   care), NIST AI RMF MANAGE.
 *
 *   2. detectFourEyesDefection()    Rolling-window stats on approver-pair
 *                                   concentration. Flags independence
 *                                   failures when a single pair
 *                                   rubber-stamps too high a share of
 *                                   decisions. Cites Cabinet Res
 *                                   134/2025 Art.19 (independence of
 *                                   reviewer) + FATF Rec 22/23.
 *
 *   3. runRegulatorVoiceWarGame()   Self-administered 10-question MoE
 *                                   inspection readiness quiz. Each
 *                                   question maps to a regulatory
 *                                   citation. Produces a readiness
 *                                   score + red-item list before the
 *                                   inspector actually shows up.
 *                                   Cites MoE Circular 08/AML/2021 +
 *                                   Cabinet Res 134/2025 Art.19.
 *
 *   4. buildMlroWarRoomView()       Unified open-items dashboard across
 *                                   open STRs, active EOCN freezes,
 *                                   four-eyes queue, upcoming filing
 *                                   deadlines. Enforces hard-coded
 *                                   transition invariants (e.g. STR
 *                                   cannot close without goAML receipt).
 *                                   Cites FDL Art.24 (audit trail) +
 *                                   CLAUDE.md §3 (audit discipline).
 *
 * Scope boundaries (v1 non-goals):
 *   - Does NOT ingest live typing-cadence / device-fingerprint streams;
 *     caller pre-aggregates signals before calling scoreBehavioralTrust.
 *   - Does NOT close, complete, or delete any STR / freeze / task.
 *   - Does NOT auto-rotate approver-pairs; it reports the defection
 *     risk for CO to action via the existing asana/coLoadBalancer.ts.
 *   - Does NOT run the inspection itself; it produces the readiness
 *     score + checklist so the MLRO can fix red items first.
 *   - Does NOT modify the MLRO war-room UI; it produces the data a
 *     downstream React surface renders.
 */

// ---------------------------------------------------------------------------
// 1. Behavioural biometrics trust score
// ---------------------------------------------------------------------------

export interface BehavioralBaseline {
  /** User identifier. */
  userId: string;
  /** Typical approved-action velocity, approvals per hour. */
  medianApprovalsPerHour: number;
  /** Typical session duration in minutes. */
  medianSessionMinutes: number;
  /** Geo origin(s) historically seen for this user (ISO country codes). */
  expectedGeos: readonly string[];
}

export interface BehavioralSignals {
  userId: string;
  /** Approvals observed in this session. */
  sessionApprovalsPerHour: number;
  /** Current session duration so far, in minutes. */
  sessionMinutes: number;
  /** Observed geo (ISO country code). */
  observedGeo: string;
  /** True when the session originates from a device not seen before. */
  newDevice: boolean;
  /** True when the session is occurring outside typical working hours. */
  outOfHours: boolean;
}

export interface BehavioralTrustResult {
  userId: string;
  /** Trust score in [0, 1]. 1 = strongly trusted, 0 = high concern. */
  trust: number;
  /** Effective approval tier granted at this trust level. */
  effectiveApprovalTier: 'standard' | 'downgraded' | 'suspended';
  /** Ordered list of flags that reduced the score. */
  flags: string[];
  narrative: string;
}

/**
 * Score a user's current session against their behavioural baseline.
 * Pure function — the caller supplies baseline + signals. When the
 * trust score drops below 0.5, approval authority is downgraded;
 * below 0.25, it is suspended (pending CO review).
 *
 * Regulatory basis: FDL No.10/2025 Art.20-21 (CO duty of care),
 * NIST AI RMF MANAGE (monitor & govern).
 */
export function scoreBehavioralTrust(input: {
  readonly baseline: BehavioralBaseline;
  readonly signals: BehavioralSignals;
}): BehavioralTrustResult {
  let trust = 1;
  const flags: string[] = [];

  // Velocity anomaly: session rate more than 3× baseline → -0.3.
  if (
    input.baseline.medianApprovalsPerHour > 0 &&
    input.signals.sessionApprovalsPerHour > 3 * input.baseline.medianApprovalsPerHour
  ) {
    trust -= 0.3;
    flags.push('velocity-3x-over-baseline');
  }
  // Session-duration anomaly: > 4× baseline → -0.2.
  if (
    input.baseline.medianSessionMinutes > 0 &&
    input.signals.sessionMinutes > 4 * input.baseline.medianSessionMinutes
  ) {
    trust -= 0.2;
    flags.push('session-duration-4x-over-baseline');
  }
  // Geo anomaly: observed geo not in the expected set → -0.25.
  if (!input.baseline.expectedGeos.includes(input.signals.observedGeo)) {
    trust -= 0.25;
    flags.push(`geo-mismatch-${input.signals.observedGeo}`);
  }
  // New device → -0.15.
  if (input.signals.newDevice) {
    trust -= 0.15;
    flags.push('new-device');
  }
  // Out-of-hours → -0.1.
  if (input.signals.outOfHours) {
    trust -= 0.1;
    flags.push('out-of-hours');
  }

  trust = Math.max(0, Math.min(1, Math.round(trust * 100) / 100));

  let effectiveApprovalTier: BehavioralTrustResult['effectiveApprovalTier'];
  if (trust >= 0.5) effectiveApprovalTier = 'standard';
  else if (trust >= 0.25) effectiveApprovalTier = 'downgraded';
  else effectiveApprovalTier = 'suspended';

  return {
    userId: input.baseline.userId,
    trust,
    effectiveApprovalTier,
    flags,
    narrative:
      `Behavioural trust ${trust.toFixed(2)} → approval tier '${effectiveApprovalTier}'. ` +
      (flags.length === 0
        ? 'Session nominal against baseline.'
        : `Flags: ${flags.join(', ')} (FDL Art.20-21 / NIST AI RMF MANAGE).`),
  };
}

// ---------------------------------------------------------------------------
// 2. Four-eyes defection detector
// ---------------------------------------------------------------------------

export interface ApprovalPairEvent {
  /** Primary approver user GID. */
  approverA: string;
  /** Secondary approver user GID. */
  approverB: string;
  /** ISO-8601 timestamp of the approval. */
  atIso: string;
}

export interface FourEyesDefectionReport {
  /** Approver pairs sorted by share of approvals (descending). */
  pairs: Array<{
    approverA: string;
    approverB: string;
    count: number;
    share: number;
  }>;
  /** Pair whose share exceeded the threshold. Empty when no defection. */
  defectingPairs: Array<{ approverA: string; approverB: string; share: number }>;
  /** Threshold used (fraction in [0,1]). */
  thresholdShare: number;
  narrative: string;
}

/**
 * Detect approver-pair concentration above a share threshold over a
 * rolling window of events. The default threshold (0.4) means no pair
 * may account for > 40% of all approvals.
 *
 * Regulatory basis: Cabinet Res 134/2025 Art.19 (independence of
 * reviewer), FATF Rec 22/23 (DNFBP governance).
 */
export function detectFourEyesDefection(input: {
  readonly events: ReadonlyArray<ApprovalPairEvent>;
  readonly thresholdShare?: number;
}): FourEyesDefectionReport {
  const threshold = input.thresholdShare ?? 0.4;
  const counts = new Map<string, { a: string; b: string; n: number }>();
  for (const e of input.events) {
    // Canonicalise the pair order so (A,B) === (B,A).
    const [a, b] = [e.approverA, e.approverB].sort();
    const key = `${a}::${b}`;
    const existing = counts.get(key);
    if (existing) existing.n += 1;
    else counts.set(key, { a, b, n: 1 });
  }
  const total = input.events.length;
  const pairs = Array.from(counts.values())
    .map((p) => ({
      approverA: p.a,
      approverB: p.b,
      count: p.n,
      share: total === 0 ? 0 : Math.round((p.n / total) * 1000) / 1000,
    }))
    .sort((x, y) => y.share - x.share);

  const defectingPairs = pairs
    .filter((p) => p.share > threshold)
    .map((p) => ({ approverA: p.approverA, approverB: p.approverB, share: p.share }));

  const narrative =
    defectingPairs.length === 0
      ? `Four-eyes concentration within tolerance (threshold ${(threshold * 100).toFixed(0)}%). No defection detected.`
      : `Four-eyes DEFECTION — ${defectingPairs.length} pair(s) exceed ${(threshold * 100).toFixed(0)}% ` +
        `share over ${total} approvals. Rotate pairs via asana/coLoadBalancer.ts ` +
        `(Cabinet Res 134/2025 Art.19).`;

  return { pairs, defectingPairs, thresholdShare: threshold, narrative };
}

// ---------------------------------------------------------------------------
// 3. Regulator-voice war-game (MoE readiness self-test)
// ---------------------------------------------------------------------------

export interface WarGameQuestion {
  id: string;
  question: string;
  citation: string;
  /** Category used when aggregating red items. */
  category:
    | 'governance'
    | 'cdd'
    | 'str'
    | 'freeze'
    | 'records'
    | 'training'
    | 'screening'
    | 'goaml';
}

/**
 * Canonical 10-question MoE readiness quiz. Curated so each question
 * maps to exactly one regulatory citation. Expand via PR only.
 */
export const WAR_GAME_QUESTIONS: ReadonlyArray<WarGameQuestion> = [
  {
    id: 'q1',
    category: 'governance',
    question: 'Is a named backup MLRO appointed in writing and reachable?',
    citation: 'FDL No.10/2025 Art.20-21',
  },
  {
    id: 'q2',
    category: 'governance',
    question: 'Is the AML policy signed by MLRO → CO → Board within the last 12 months?',
    citation: 'Cabinet Res 134/2025 Art.5',
  },
  {
    id: 'q3',
    category: 'cdd',
    question:
      'Are all customers risk-tiered (SDD/CDD/EDD/PEP) with tier-appropriate review cadences?',
    citation: 'Cabinet Res 134/2025 Art.7',
  },
  {
    id: 'q4',
    category: 'cdd',
    question: 'Are UBOs >25% recorded and re-verified within 15 working days of ownership change?',
    citation: 'Cabinet Decision 109/2023',
  },
  {
    id: 'q5',
    category: 'str',
    question: 'Can every STR filed in the last 12 months be produced with goAML receipt ID?',
    citation: 'FDL No.10/2025 Art.26-27',
  },
  {
    id: 'q6',
    category: 'freeze',
    question:
      'For every confirmed sanctions match, was the 24-hour freeze window met and CNMR filed within 5 business days?',
    citation: 'Cabinet Res 74/2020 Art.4-7',
  },
  {
    id: 'q7',
    category: 'records',
    question:
      'Are all compliance records retained per the documented retention schedule and produced on demand?',
    citation: 'FDL No.10/2025 Art.24',
  },
  {
    id: 'q8',
    category: 'training',
    question: 'Has quarterly AML training been completed by all staff with attendance evidence?',
    citation: 'Cabinet Res 134/2025 Art.19',
  },
  {
    id: 'q9',
    category: 'screening',
    question:
      'Are ALL sanctions lists (UN, OFAC, EU, UK, UAE, EOCN) screened on every customer event?',
    citation: 'FDL No.10/2025 Art.35',
  },
  {
    id: 'q10',
    category: 'goaml',
    question:
      'Is the firm registered on the UAE FIU goAML portal with current MLRO + backup MLRO users?',
    citation: 'MoE Circular 08/AML/2021',
  },
];

export interface WarGameAnswers {
  /** Map of question id → true (pass) | false (fail). */
  answers: Readonly<Record<string, boolean>>;
}

export interface WarGameResult {
  /** Score as a fraction in [0,1]. */
  score: number;
  /** Passed count. */
  passed: number;
  /** Total questions in the quiz. */
  total: number;
  /** Red items the MLRO must fix before inspection. */
  redItems: Array<{ id: string; question: string; citation: string; category: string }>;
  /** Readiness verdict. */
  verdict: 'ready' | 'mostly-ready' | 'not-ready';
  narrative: string;
}

export function runRegulatorVoiceWarGame(input: WarGameAnswers): WarGameResult {
  const total = WAR_GAME_QUESTIONS.length;
  let passed = 0;
  const redItems: WarGameResult['redItems'] = [];
  for (const q of WAR_GAME_QUESTIONS) {
    if (input.answers[q.id] === true) passed += 1;
    else
      redItems.push({
        id: q.id,
        question: q.question,
        citation: q.citation,
        category: q.category,
      });
  }
  const score = Math.round((passed / total) * 100) / 100;
  let verdict: WarGameResult['verdict'];
  if (score >= 0.9) verdict = 'ready';
  else if (score >= 0.7) verdict = 'mostly-ready';
  else verdict = 'not-ready';
  return {
    score,
    passed,
    total,
    redItems,
    verdict,
    narrative:
      `Regulator-voice war game: ${passed}/${total} passed (${(score * 100).toFixed(0)}%) → ` +
      `${verdict}. ${redItems.length} red item(s) to resolve before MoE inspection ` +
      `(Cabinet Res 134/2025 Art.19).`,
  };
}

// ---------------------------------------------------------------------------
// 4. MLRO war-room view
// ---------------------------------------------------------------------------

export type MlroItemKind =
  | 'open-str'
  | 'active-eocn-freeze'
  | 'four-eyes-pending'
  | 'filing-deadline'
  | 'sanctions-match';

export interface MlroOpenItem {
  kind: MlroItemKind;
  /** Primary key appropriate to the item's domain. */
  id: string;
  /** Title for the UI. */
  title: string;
  /** ISO-8601 due / deadline date, where applicable. */
  dueIso?: string;
  /** Free-form metadata carried through for rendering. */
  meta?: Readonly<Record<string, string>>;
}

export interface MlroWarRoomView {
  /** Items grouped by urgency bucket. */
  buckets: {
    overdue: MlroOpenItem[];
    within24h: MlroOpenItem[];
    within5d: MlroOpenItem[];
    distant: MlroOpenItem[];
  };
  /** Hard invariants violated by incoming items. */
  invariantViolations: string[];
  /** Total count inspected. */
  inspected: number;
  narrative: string;
}

/**
 * Build the MLRO war-room view from raw open items. Enforces hard
 * invariants:
 *
 *   - An STR cannot be marked closed without a goAML receipt-ID meta.
 *   - An active EOCN freeze must have a start-timestamp meta.
 *   - A four-eyes-pending item must have at least one approver meta.
 *
 * Violations are surfaced but do not filter the items — the MLRO must
 * see them to correct them.
 *
 * Regulatory basis: FDL No.10/2025 Art.24 (audit trail), CLAUDE.md §3.
 */
export function buildMlroWarRoomView(input: {
  readonly items: ReadonlyArray<MlroOpenItem>;
  readonly asOf?: Date;
}): MlroWarRoomView {
  const now = input.asOf ?? new Date();
  const buckets: MlroWarRoomView['buckets'] = {
    overdue: [],
    within24h: [],
    within5d: [],
    distant: [],
  };
  const violations: string[] = [];

  for (const item of input.items) {
    // Hard invariant checks.
    if (item.kind === 'open-str') {
      const closed = item.meta?.['status'] === 'closed';
      const hasReceipt = !!item.meta?.['goamlReceiptId'];
      if (closed && !hasReceipt) {
        violations.push(
          `STR ${item.id} marked closed without goAML receipt ID — FDL Art.26-27 / Art.24 breach.`
        );
      }
    }
    if (item.kind === 'active-eocn-freeze' && !item.meta?.['freezeStartIso']) {
      violations.push(
        `Active EOCN freeze ${item.id} missing freezeStartIso meta — cannot drive the 24h countdown.`
      );
    }
    if (
      item.kind === 'four-eyes-pending' &&
      !item.meta?.['approverA'] &&
      !item.meta?.['approverB']
    ) {
      violations.push(
        `Four-eyes item ${item.id} missing approver meta — Cabinet Res 134/2025 Art.19 violation.`
      );
    }

    // Urgency bucketing by dueIso (items without a due date → distant).
    if (!item.dueIso) {
      buckets.distant.push(item);
      continue;
    }
    const hours = (new Date(item.dueIso).getTime() - now.getTime()) / (1000 * 60 * 60);
    if (hours < 0) buckets.overdue.push(item);
    else if (hours <= 24) buckets.within24h.push(item);
    else if (hours <= 24 * 5) buckets.within5d.push(item);
    else buckets.distant.push(item);
  }

  return {
    buckets,
    invariantViolations: violations,
    inspected: input.items.length,
    narrative:
      `MLRO war room: ${buckets.overdue.length} overdue, ${buckets.within24h.length} within 24h, ` +
      `${buckets.within5d.length} within 5d, ${buckets.distant.length} distant. ` +
      (violations.length === 0
        ? 'All invariants green.'
        : `${violations.length} invariant violation(s) — resolve before end of day.`),
  };
}
