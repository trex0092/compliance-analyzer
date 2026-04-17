/**
 * Weaponized Brain — Phase 15 Adaptive Meta-Planning & Self-Learning (#110-#114).
 *
 * One cohesive meta-layer that sits above every other subsystem in the brain.
 * Six linked capabilities — all diagnostic, all browser-safe, none mutate the
 * final verdict. The verdict remains on the existing clamp pipeline; this
 * layer adds intelligence, self-learning, reasoning, data analysis, and
 * deep thinking on top of the existing signals.
 *
 *   #110 Adaptive Meta-Planner + Reliability Self-Learning
 *        - runAdaptiveMeta         — attention / focus brief over all signals
 *        - recordMlroOutcome       — EWMA reliability update per subsystem
 *
 *   #111 Reasoning Chain Composer (deep thinking)
 *        - composeReasoningChain   — explicit multi-step inference trace
 *
 *   #112 Threshold Self-Calibrator (self-learning #2)
 *        - calibrateThresholds     — learns per-subsystem optimal cutoff
 *                                    from MLRO outcome history (Youden's J)
 *
 *   #113 Signal Pattern Miner (data analysis)
 *        - minePatternClusters     — Jaccard clustering of recurring
 *                                    signal sets across cases
 *
 *   #114 Hypothesis Generator (reasoning)
 *        - generateHypotheses      — enumerates competing explanations
 *                                    with Bayesian-weighted posteriors
 *
 * Job 1 — meta-planning (attention).
 *      With ~109 subsystems firing per case, an MLRO cannot possibly read
 *      every output. The planner ranks each high-confidence signal by
 *      (strength x regulatory priority x reliability x freshness) and
 *      surfaces the top-K dominant signals as a focus brief. Low-weight
 *      signals are deprioritised (still logged, never deleted — FDL
 *      No.10/2025 Art.24 audit-trail retention is absolute).
 *
 * Job 2 — self-learning (reliability).
 *      Every MLRO final verdict is a label. For each subsystem whose
 *      impliedVerdict equalled the MLRO's verdict we nudge that
 *      subsystem's reliability upward; for dissenters we nudge it
 *      downward. The update is EWMA — conservative, no retraining, no
 *      heavy ML, bounded to [0.05, 0.95], and every update produces an
 *      audit entry citing the outcome record.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.19    (risk-based review — prioritise higher risk)
 *   - FDL No.10/2025 Art.20-21 (CO duty of care in decision support)
 *   - FDL No.10/2025 Art.24    (audit trail of every weight change)
 *   - Cabinet Res 134/2025 Art.5  (risk appetite — priority weights mirror appetite)
 *   - Cabinet Res 134/2025 Art.19 (internal review deadlines drive freshness decay)
 *
 * Design constraints (from CLAUDE.md):
 *   - Browser-safe: pure TypeScript, no Node built-ins, no fetch.
 *   - Diagnostic only — MUST NOT mutate the final verdict. Verdicts stay
 *     on the existing clamp pipeline. This layer produces reports, not
 *     decisions.
 *   - Self-learning state is dependency-injected via a Registry object so
 *     persistence (Netlify Blobs, memory, test double) is plugged in at
 *     the call site without this module depending on any backend.
 *   - Weights live in [0.05, 0.95]: never 0 (prevents permanent silencing
 *     of a subsystem) and never 1 (keeps epistemic humility).
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
// Reliability registry — pluggable persistence via dependency injection.
// ---------------------------------------------------------------------------

export interface SubsystemReliability {
  /** Subsystem name, e.g. 'sanctionsScreen', 'uboLayering'. */
  readonly name: string;
  /** Reliability score in [0.05, 0.95]. */
  readonly reliability: number;
  /** Total MLRO outcomes observed against this subsystem. */
  readonly observationCount: number;
  /** Last time this entry was updated (ISO-8601). */
  readonly lastUpdated: string;
}

export interface ReliabilityRegistry {
  /** Lookup — returns DEFAULT_RELIABILITY when the subsystem is unknown. */
  get(name: string): SubsystemReliability;
  /** Upsert a reliability record. Callers do not construct this directly. */
  upsert(record: SubsystemReliability): void;
  /** Snapshot of all known entries (for audit / persistence). */
  snapshot(): ReadonlyArray<SubsystemReliability>;
}

/** New subsystems start neutral — 0.5. Bounded updates keep them in range. */
export const DEFAULT_RELIABILITY = 0.5 as const;

/** Floor / ceiling on learned reliability. */
const RELIABILITY_MIN = 0.05;
const RELIABILITY_MAX = 0.95;

/**
 * In-memory registry factory. For durable persistence, wrap this with the
 * brainMemoryBlobStore pattern (load snapshot at startup, save after each
 * update). Tests can pass `seed` to prime the registry.
 */
export function createInMemoryReliabilityRegistry(
  seed: ReadonlyArray<SubsystemReliability> = []
): ReliabilityRegistry {
  const store = new Map<string, SubsystemReliability>();
  for (const r of seed) store.set(r.name, r);
  return {
    get(name: string): SubsystemReliability {
      const hit = store.get(name);
      if (hit) return hit;
      return {
        name,
        reliability: DEFAULT_RELIABILITY,
        observationCount: 0,
        lastUpdated: new Date(0).toISOString(),
      };
    },
    upsert(record: SubsystemReliability): void {
      store.set(record.name, record);
    },
    snapshot(): ReadonlyArray<SubsystemReliability> {
      return Array.from(store.values());
    },
  };
}

// ---------------------------------------------------------------------------
// Regulatory priority table — derived from CLAUDE.md "Regulatory Domain
// Knowledge" section. Values are multiplicative weights in [0.5, 2.0] and
// intentionally small in magnitude so reliability and signal confidence
// continue to dominate the ranking.
//
// Extending this table is PR-only and every new entry must cite the
// Article/Circular/Guidance that justifies its weight. See CLAUDE.md §8.
// ---------------------------------------------------------------------------

export interface RegulatoryPriority {
  /** Subsystem name, matches SubsystemSignal.name. */
  readonly name: string;
  /** Multiplicative weight in [0.5, 2.0]. 1.0 means no boost. */
  readonly priority: number;
  /** Regulatory citation that justifies the weight. */
  readonly citation: string;
}

export const DEFAULT_REGULATORY_PRIORITIES: ReadonlyArray<RegulatoryPriority> = [
  // Sanctions + freeze path — highest priority (24h EOCN clock, FDL Art.35).
  {
    name: 'sanctionsScreen',
    priority: 2.0,
    citation: 'FDL No.10/2025 Art.35 + Cabinet Res 74/2020 Art.4-7',
  },
  {
    name: 'sanctionsDedupe',
    priority: 2.0,
    citation: 'FDL No.10/2025 Art.35',
  },
  {
    name: 'taintPropagator',
    priority: 1.8,
    citation: 'FATF Rec 15 + FDL No.10/2025 Art.20-21',
  },
  // UBO / beneficial ownership — Cabinet Decision 109/2023 threshold work.
  {
    name: 'uboLayering',
    priority: 1.6,
    citation: 'Cabinet Decision 109/2023 + FATF Rec 10',
  },
  { name: 'uboGraph', priority: 1.6, citation: 'Cabinet Decision 109/2023' },
  {
    name: 'ownershipMotifs',
    priority: 1.5,
    citation: 'Cabinet Decision 109/2023',
  },
  // Structuring + cash thresholds — MoE DPMS circular.
  {
    name: 'transactionAnomaly',
    priority: 1.5,
    citation: 'MoE Circular 08/AML/2021 + FATF Rec 10',
  },
  {
    name: 'crossBorderCash',
    priority: 1.5,
    citation: 'Cabinet Res 134/2025 Art.16',
  },
  // PEP + adverse media — EDD triggers.
  {
    name: 'pepProximity',
    priority: 1.4,
    citation: 'Cabinet Res 134/2025 Art.14',
  },
  {
    name: 'adverseMediaRanker',
    priority: 1.3,
    citation: 'Cabinet Res 134/2025 Art.14 + FATF Rec 10',
  },
  // Filing / STR path.
  {
    name: 'strAutoClassifier',
    priority: 1.4,
    citation: 'FDL No.10/2025 Art.26-27',
  },
  { name: 'strNarrativeBuilder', priority: 1.2, citation: 'FDL No.10/2025 Art.26-27' },
  // Gold-specific for DPMS.
  {
    name: 'lbmaFixPriceChecker',
    priority: 1.2,
    citation: 'LBMA RGG v9 + UAE MoE RSG Framework',
  },
  {
    name: 'goldOriginTracer',
    priority: 1.2,
    citation: 'OECD DDG + UAE MoE RSG Framework',
  },
  // Meta / reasoning quality — above baseline but below enforcement paths.
  { name: 'contradictionDetector', priority: 1.1, citation: 'Cabinet Res 134/2025 Art.19' },
  { name: 'reflectionCritic', priority: 1.1, citation: 'Cabinet Res 134/2025 Art.19' },
];

function priorityOf(name: string, priorities: ReadonlyArray<RegulatoryPriority>): number {
  for (const p of priorities) if (p.name === name) return p.priority;
  return 1.0;
}

// ---------------------------------------------------------------------------
// #110 Adaptive Meta-Planner — attention & focus brief.
// ---------------------------------------------------------------------------

export interface SignalFocus {
  readonly name: string;
  readonly impliedVerdict: Verdict;
  /** Raw signal confidence in [0, 1]. */
  readonly strength: number;
  /** Regulatory priority multiplier (from the table). */
  readonly priority: number;
  /** Learned reliability from the registry. */
  readonly reliability: number;
  /** Freshness multiplier in [0, 1]; 1 means fresh, decays with age. */
  readonly freshness: number;
  /** Composite attention score = strength * priority * reliability * freshness. */
  readonly attention: number;
  /** Regulatory citation for the priority tier (when applicable). */
  readonly citation?: string;
}

export interface AdaptiveMetaReport {
  /** Top-K signals, ranked by attention (descending). */
  readonly topFocus: ReadonlyArray<SignalFocus>;
  /** Names of signals that fell below the attention cutoff (not deleted, just deprioritised). */
  readonly deprioritised: ReadonlyArray<string>;
  /** Shannon entropy of the normalised attention distribution (bits). Low = concentrated focus. */
  readonly attentionEntropyBits: number;
  /** The single highest-attention signal (null when no signals available). */
  readonly dominantSignal: SignalFocus | null;
  /** Plain-English MLRO focus brief. Safe to paste into a case file. */
  readonly narrative: string;
}

function freshnessOf(ageDays: number | undefined): number {
  if (ageDays === undefined || ageDays <= 0) return 1;
  // Cabinet Res 134/2025 Art.19 sets internal-review cadences of 3/6/12 months.
  // Half-life of 90 days lines up with the EDD 3-month review trigger.
  const halfLifeDays = 90;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

function shannonEntropyBits(weights: ReadonlyArray<number>): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let h = 0;
  for (const w of weights) {
    if (w <= 0) continue;
    const p = w / total;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Optional shape for signals carrying an age hint. We extend SubsystemSignal
 * locally rather than forcing every caller to change — missing `ageDays` is
 * treated as fresh.
 */
export interface AgedSignal extends SubsystemSignal {
  /** Age of the underlying evidence in days, for freshness decay. */
  readonly ageDays?: number;
}

export interface AdaptiveMetaInput {
  readonly signals: ReadonlyArray<AgedSignal>;
  readonly registry?: ReliabilityRegistry;
  readonly regulatoryPriorities?: ReadonlyArray<RegulatoryPriority>;
  /** Minimum signal confidence to be considered (default 0.4). */
  readonly confidenceFloor?: number;
  /** Top-K focus cutoff (default 5). */
  readonly topK?: number;
}

export function runAdaptiveMeta(input: AdaptiveMetaInput): AdaptiveMetaReport {
  const registry = input.registry ?? createInMemoryReliabilityRegistry();
  const priorities = input.regulatoryPriorities ?? DEFAULT_REGULATORY_PRIORITIES;
  const floor = input.confidenceFloor ?? 0.4;
  const topK = input.topK ?? 5;

  const focused: SignalFocus[] = [];
  for (const s of input.signals) {
    if (s.confidence < floor) continue;
    const priority = priorityOf(s.name, priorities);
    const reliability = registry.get(s.name).reliability;
    const freshness = freshnessOf(s.ageDays);
    const attention = s.confidence * priority * reliability * freshness;
    const cite = priorities.find((p) => p.name === s.name)?.citation;
    focused.push({
      name: s.name,
      impliedVerdict: s.impliedVerdict,
      strength: s.confidence,
      priority,
      reliability,
      freshness,
      attention: Math.round(attention * 10000) / 10000,
      citation: cite,
    });
  }

  focused.sort((a, b) => b.attention - a.attention);

  const topFocus = focused.slice(0, topK);
  const deprioritised = focused.slice(topK).map((f) => f.name);
  const entropy = shannonEntropyBits(focused.map((f) => f.attention));
  const dominant = focused[0] ?? null;

  const narrativeLines: string[] = [];
  if (!dominant) {
    narrativeLines.push(
      'Adaptive meta-planner: no signals cleared the confidence floor — case proceeds on baseline clamps only.'
    );
  } else {
    narrativeLines.push(
      `Adaptive meta-planner focus: dominant signal is "${dominant.name}" ` +
        `(verdict=${dominant.impliedVerdict}, attention=${dominant.attention.toFixed(3)}; ` +
        `strength=${dominant.strength.toFixed(2)}, priority=${dominant.priority}, ` +
        `reliability=${dominant.reliability.toFixed(2)}, freshness=${dominant.freshness.toFixed(2)}).`
    );
    if (topFocus.length > 1) {
      const rest = topFocus
        .slice(1)
        .map((f) => `${f.name} (${f.attention.toFixed(3)})`)
        .join(', ');
      narrativeLines.push(`MLRO should also review: ${rest}.`);
    }
    if (deprioritised.length > 0) {
      narrativeLines.push(
        `${deprioritised.length} lower-attention signal(s) deprioritised but retained in the audit log (FDL No.10/2025 Art.24).`
      );
    }
    narrativeLines.push(
      `Attention entropy: ${entropy.toFixed(2)} bits ` +
        `(${entropy < 1.0 ? 'focused' : entropy < 2.0 ? 'moderate' : 'diffuse'}).`
    );
  }

  return {
    topFocus,
    deprioritised,
    attentionEntropyBits: Math.round(entropy * 1000) / 1000,
    dominantSignal: dominant,
    narrative: narrativeLines.join(' '),
  };
}

// ---------------------------------------------------------------------------
// Self-learning — EWMA reliability update from MLRO outcomes.
// ---------------------------------------------------------------------------

export interface MlroOutcome {
  /** Case id for the audit trail. */
  readonly caseId: string;
  /** The final MLRO verdict for this case. */
  readonly finalVerdict: Verdict;
  /** Signals active at the time of the verdict — with their implied verdicts. */
  readonly signals: ReadonlyArray<SubsystemSignal>;
  /** When the MLRO signed off. */
  readonly decidedAt: string | Date;
}

export interface ReliabilityUpdate {
  readonly name: string;
  readonly previous: number;
  readonly updated: number;
  /** +1 = concurring signal rewarded, -1 = dissenting signal penalised. */
  readonly direction: 1 | -1;
}

export interface LearningRecord {
  readonly caseId: string;
  readonly decidedAt: string;
  readonly updates: ReadonlyArray<ReliabilityUpdate>;
  /** Regulatory citation for the learning event. */
  readonly citation: string;
}

/** Conservative EWMA step. 0.05 keeps single outcomes from dominating. */
const EWMA_ALPHA = 0.05;
/** Minimum signal confidence to be considered for learning. */
const LEARNING_CONFIDENCE_FLOOR = 0.5;

function clamp01(v: number): number {
  if (v < RELIABILITY_MIN) return RELIABILITY_MIN;
  if (v > RELIABILITY_MAX) return RELIABILITY_MAX;
  return v;
}

/**
 * Apply the MLRO outcome to the reliability registry. Conservative EWMA:
 * each concurring signal nudges reliability toward 1.0; each dissenting
 * signal nudges reliability toward 0.0. Bounded to [0.05, 0.95] so a
 * subsystem can never be silenced or treated as infallible.
 *
 * Returns the audit record describing every update — callers should
 * persist this alongside the case file per FDL No.10/2025 Art.24.
 */
export function recordMlroOutcome(
  registry: ReliabilityRegistry,
  outcome: MlroOutcome
): LearningRecord {
  const decidedAt =
    outcome.decidedAt instanceof Date ? outcome.decidedAt.toISOString() : outcome.decidedAt;
  const updates: ReliabilityUpdate[] = [];
  for (const s of outcome.signals) {
    if (s.confidence < LEARNING_CONFIDENCE_FLOOR) continue;
    const concurring = VERDICT_RANK[s.impliedVerdict] === VERDICT_RANK[outcome.finalVerdict];
    const target = concurring ? 1 : 0;
    const current = registry.get(s.name);
    const next = clamp01((1 - EWMA_ALPHA) * current.reliability + EWMA_ALPHA * target);
    registry.upsert({
      name: s.name,
      reliability: Math.round(next * 10000) / 10000,
      observationCount: current.observationCount + 1,
      lastUpdated: decidedAt,
    });
    updates.push({
      name: s.name,
      previous: current.reliability,
      updated: Math.round(next * 10000) / 10000,
      direction: concurring ? 1 : -1,
    });
  }
  return {
    caseId: outcome.caseId,
    decidedAt,
    updates,
    citation: 'FDL No.10/2025 Art.24 (audit trail) + Cabinet Res 134/2025 Art.19 (internal review)',
  };
}

// ---------------------------------------------------------------------------
// #111 Reasoning Chain Composer — deep thinking.
//
// Builds an explicit multi-step inference chain from focused signals to the
// final verdict. Each step names its premise, its regulatory citation, and
// the confidence it contributes. The MLRO reads this as a defensible
// narrative: "given A (Art.X), then B (Art.Y), therefore C". Pairs with
// #101 (reasoning-chain DAG) by producing a linear, paste-ready prose form.
// ---------------------------------------------------------------------------

export interface ReasoningStep {
  readonly index: number;
  readonly premise: string;
  readonly sourceSubsystem: string;
  readonly impliedVerdict: Verdict;
  readonly stepConfidence: number;
  readonly citation?: string;
}

export interface ReasoningChainReport {
  readonly steps: ReadonlyArray<ReasoningStep>;
  readonly convergedVerdict: Verdict;
  /** Product of step confidences, bounded to [0, 1]. Monotone in chain length. */
  readonly chainConfidence: number;
  /** True when every step implies the same verdict. */
  readonly coherent: boolean;
  readonly narrative: string;
}

export function composeReasoningChain(input: {
  readonly focus: ReadonlyArray<SignalFocus>;
  readonly finalVerdict: Verdict;
  readonly maxSteps?: number;
}): ReasoningChainReport {
  const maxSteps = input.maxSteps ?? 7;
  const ordered = [...input.focus].sort((a, b) => b.attention - a.attention).slice(0, maxSteps);

  const steps: ReasoningStep[] = ordered.map((f, i) => ({
    index: i + 1,
    premise:
      `Subsystem "${f.name}" implies ${f.impliedVerdict} at strength ` +
      `${f.strength.toFixed(2)} (priority ${f.priority}, reliability ${f.reliability.toFixed(2)}).`,
    sourceSubsystem: f.name,
    impliedVerdict: f.impliedVerdict,
    stepConfidence: Math.round(f.strength * f.reliability * 1000) / 1000,
    citation: f.citation,
  }));

  let convergedVerdict: Verdict = 'pass';
  for (const s of steps) {
    if (VERDICT_RANK[s.impliedVerdict] > VERDICT_RANK[convergedVerdict]) {
      convergedVerdict = s.impliedVerdict;
    }
  }

  const chainConfidence =
    steps.length === 0
      ? 0
      : Math.round(steps.reduce((acc, s) => acc * s.stepConfidence, 1) * 10000) / 10000;
  const coherent =
    steps.length > 0 && steps.every((s) => s.impliedVerdict === steps[0]?.impliedVerdict);

  const lines = steps.map(
    (s) => `  Step ${s.index}. ${s.premise}` + (s.citation ? ` [${s.citation}]` : '')
  );

  const narrative =
    steps.length === 0
      ? 'Reasoning chain empty — no focused signals available.'
      : `Reasoning chain (${steps.length} steps, ${coherent ? 'coherent' : 'mixed'}):\n` +
        lines.join('\n') +
        `\n  Converges to: ${convergedVerdict}. ` +
        `Chain confidence: ${chainConfidence.toFixed(3)}. ` +
        `MLRO final verdict: ${input.finalVerdict}.` +
        (convergedVerdict !== input.finalVerdict
          ? ' Chain-verdict vs final-verdict divergence — document justification (Cabinet Res 134/2025 Art.19).'
          : '');

  return {
    steps,
    convergedVerdict,
    chainConfidence,
    coherent,
    narrative,
  };
}

// ---------------------------------------------------------------------------
// #112 Threshold Self-Calibrator — self-learning #2.
//
// For each subsystem, scans past MLRO outcomes and finds the confidence
// cutoff that maximises Youden's J = TPR - FPR. Produces a recommended
// per-subsystem threshold plus supporting counts. Diagnostic only — the
// existing clamp pipeline keeps its thresholds until a human reviews the
// recommendation. Follows CLAUDE.md §8 (every weight change is audited).
// ---------------------------------------------------------------------------

export interface LabeledOutcomeSample {
  /** Which subsystem fired. */
  readonly subsystem: string;
  /** Confidence it reported. */
  readonly confidence: number;
  /** True when the MLRO's final verdict matched the subsystem's implied verdict. */
  readonly correct: boolean;
}

export interface ThresholdRecommendation {
  readonly subsystem: string;
  readonly recommendedThreshold: number;
  readonly youdenJ: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly trueNegatives: number;
  readonly falseNegatives: number;
  readonly sampleSize: number;
  readonly citation: string;
}

export interface ThresholdCalibrationReport {
  readonly recommendations: ReadonlyArray<ThresholdRecommendation>;
  readonly narrative: string;
}

/** Minimum samples before we trust the recommendation. */
const MIN_CALIBRATION_SAMPLES = 20;

export function calibrateThresholds(
  samples: ReadonlyArray<LabeledOutcomeSample>
): ThresholdCalibrationReport {
  const bySubsystem = new Map<string, LabeledOutcomeSample[]>();
  for (const s of samples) {
    const bucket = bySubsystem.get(s.subsystem);
    if (bucket) bucket.push(s);
    else bySubsystem.set(s.subsystem, [s]);
  }
  const recs: ThresholdRecommendation[] = [];
  for (const [name, group] of bySubsystem) {
    if (group.length < MIN_CALIBRATION_SAMPLES) continue;
    let bestJ = -Infinity;
    let bestThr = 0.5;
    let bestTp = 0;
    let bestFp = 0;
    let bestTn = 0;
    let bestFn = 0;
    const thresholds = new Set<number>();
    for (const s of group) thresholds.add(Math.round(s.confidence * 100) / 100);
    thresholds.add(0.5);
    for (const thr of thresholds) {
      let tp = 0;
      let fp = 0;
      let tn = 0;
      let fn = 0;
      for (const s of group) {
        const positivePrediction = s.confidence >= thr;
        if (positivePrediction && s.correct) tp += 1;
        else if (positivePrediction && !s.correct) fp += 1;
        else if (!positivePrediction && s.correct) fn += 1;
        else tn += 1;
      }
      const tpr = tp + fn === 0 ? 0 : tp / (tp + fn);
      const fpr = fp + tn === 0 ? 0 : fp / (fp + tn);
      const j = tpr - fpr;
      if (j > bestJ) {
        bestJ = j;
        bestThr = thr;
        bestTp = tp;
        bestFp = fp;
        bestTn = tn;
        bestFn = fn;
      }
    }
    recs.push({
      subsystem: name,
      recommendedThreshold: Math.round(bestThr * 1000) / 1000,
      youdenJ: Math.round(bestJ * 1000) / 1000,
      truePositives: bestTp,
      falsePositives: bestFp,
      trueNegatives: bestTn,
      falseNegatives: bestFn,
      sampleSize: group.length,
      citation: 'Cabinet Res 134/2025 Art.5 (risk appetite) + Art.19 (internal review)',
    });
  }
  recs.sort((a, b) => b.youdenJ - a.youdenJ);
  const narrative =
    recs.length === 0
      ? `Threshold calibrator: insufficient samples (need >=${MIN_CALIBRATION_SAMPLES} per subsystem). No recommendations issued.`
      : `Threshold calibrator: ${recs.length} subsystem recommendation(s). ` +
        `Top: "${recs[0]?.subsystem}" threshold=${recs[0]?.recommendedThreshold.toFixed(2)} (J=${recs[0]?.youdenJ.toFixed(2)}). ` +
        'All recommendations are diagnostic — require MLRO sign-off before rollout (Cabinet Res 134/2025 Art.19).';
  return { recommendations: recs, narrative };
}

// ---------------------------------------------------------------------------
// #113 Signal Pattern Miner — data analysis.
//
// Groups past cases by the set of subsystems that fired. Uses Jaccard
// similarity with a simple single-link clustering step to find recurring
// "signal signatures". Each cluster returns its exemplar case, its typical
// verdict, and its frequency — the MLRO sees patterns like "these 12 cases
// all fired {uboLayering, sanctionsScreen, transactionAnomaly} and all ended
// as STR filings".
// ---------------------------------------------------------------------------

export interface PastCaseSignature {
  readonly caseId: string;
  readonly finalVerdict: Verdict;
  /** Set of subsystem names that fired for this case. */
  readonly firedSubsystems: ReadonlyArray<string>;
}

export interface PatternCluster {
  readonly clusterId: string;
  readonly exemplarCaseId: string;
  /** Intersection of firedSubsystems across the cluster. */
  readonly commonSubsystems: ReadonlyArray<string>;
  readonly memberCaseIds: ReadonlyArray<string>;
  readonly dominantVerdict: Verdict;
  /** Fraction of members matching dominantVerdict, in [0, 1]. */
  readonly verdictAgreement: number;
}

export interface PatternMiningReport {
  readonly clusters: ReadonlyArray<PatternCluster>;
  /** Cases not assigned to any cluster. */
  readonly unclustered: ReadonlyArray<string>;
  readonly narrative: string;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function minePatternClusters(input: {
  readonly cases: ReadonlyArray<PastCaseSignature>;
  /** Jaccard threshold to merge two cases into the same cluster (default 0.7). */
  readonly mergeThreshold?: number;
}): PatternMiningReport {
  const threshold = input.mergeThreshold ?? 0.7;
  const clusters: PatternCluster[] = [];
  const unclustered: string[] = [];
  const caseSets = input.cases.map((c) => ({
    raw: c,
    set: new Set(c.firedSubsystems),
  }));

  const assigned = new Set<string>();
  for (let i = 0; i < caseSets.length; i++) {
    const seed = caseSets[i];
    if (!seed || assigned.has(seed.raw.caseId)) continue;
    const members: typeof caseSets = [seed];
    assigned.add(seed.raw.caseId);
    for (let j = i + 1; j < caseSets.length; j++) {
      const other = caseSets[j];
      if (!other || assigned.has(other.raw.caseId)) continue;
      if (jaccard(seed.set, other.set) >= threshold) {
        members.push(other);
        assigned.add(other.raw.caseId);
      }
    }
    if (members.length < 2) {
      unclustered.push(seed.raw.caseId);
      assigned.delete(seed.raw.caseId);
      continue;
    }
    // Intersect subsystem sets across all members.
    let intersection: Set<string> | null = null;
    for (const m of members) {
      if (intersection === null) intersection = new Set(m.set);
      else for (const x of Array.from(intersection)) if (!m.set.has(x)) intersection.delete(x);
    }
    // Count verdicts to find dominant.
    const counts = new Map<Verdict, number>();
    for (const m of members) {
      counts.set(m.raw.finalVerdict, (counts.get(m.raw.finalVerdict) ?? 0) + 1);
    }
    let dominant: Verdict = 'pass';
    let dominantCount = 0;
    for (const [v, c] of counts) {
      if (c > dominantCount) {
        dominant = v;
        dominantCount = c;
      }
    }
    clusters.push({
      clusterId: `cluster-${clusters.length + 1}`,
      exemplarCaseId: seed.raw.caseId,
      commonSubsystems: Array.from(intersection ?? []).sort(),
      memberCaseIds: members.map((m) => m.raw.caseId),
      dominantVerdict: dominant,
      verdictAgreement: Math.round((dominantCount / members.length) * 1000) / 1000,
    });
  }
  const narrative =
    clusters.length === 0
      ? `Pattern miner: no recurring signal signatures at Jaccard >= ${threshold}. ${unclustered.length} unclustered case(s).`
      : `Pattern miner: ${clusters.length} recurring pattern(s). ` +
        `Largest cluster: ${clusters[0]?.memberCaseIds.length ?? 0} cases sharing ` +
        `{${clusters[0]?.commonSubsystems.join(', ') ?? ''}} -> dominant verdict ${clusters[0]?.dominantVerdict}. ` +
        'Patterns inform CDD/EDD case-routing heuristics (Cabinet Res 134/2025 Art.5).';
  return { clusters, unclustered, narrative };
}

// ---------------------------------------------------------------------------
// #114 Hypothesis Generator — reasoning.
//
// Given focused signals, enumerates competing compliance hypotheses
// (e.g. layering vs. legitimate bulk order, PEP-by-association vs.
// coincidence) and scores each with a simple Bayesian-style posterior.
// Priors and likelihoods are small, explicit tables — extensible only by
// PR with regulatory citation per CLAUDE.md §8.
// ---------------------------------------------------------------------------

export type HypothesisId =
  | 'sanctions_evasion'
  | 'structuring'
  | 'trade_based_ml'
  | 'layering'
  | 'pep_related'
  | 'legitimate_activity';

export interface Hypothesis {
  readonly id: HypothesisId;
  readonly label: string;
  readonly prior: number;
  /** Which subsystems, when firing, support this hypothesis and with what likelihood ratio. */
  readonly supportingSubsystems: Readonly<Record<string, number>>;
  readonly citation: string;
}

export interface HypothesisPosterior {
  readonly id: HypothesisId;
  readonly label: string;
  readonly prior: number;
  readonly posterior: number;
  readonly supportingEvidence: ReadonlyArray<string>;
  readonly citation: string;
}

export interface HypothesisReport {
  readonly ranked: ReadonlyArray<HypothesisPosterior>;
  readonly mostLikely: HypothesisPosterior | null;
  readonly narrative: string;
}

// Likelihood ratios reflect the positive predictive value of each subsystem
// firing for its hypothesis. Values are chosen so that at max attenuation
// (strength=1, reliability=1) a single strong red-flag signal overtakes the
// legitimate-activity prior. Lower reliability or confidence dampens the
// update multiplicatively in log-space.
export const DEFAULT_HYPOTHESES: ReadonlyArray<Hypothesis> = [
  {
    id: 'sanctions_evasion',
    label: 'Sanctions evasion',
    prior: 0.05,
    supportingSubsystems: {
      sanctionsScreen: 50,
      sanctionsDedupe: 40,
      taintPropagator: 20,
      nameVariantExpander: 8,
    },
    citation: 'FDL No.10/2025 Art.35 + Cabinet Res 74/2020 Art.4-7',
  },
  {
    id: 'structuring',
    label: 'Cash structuring below AED 55K threshold',
    prior: 0.1,
    supportingSubsystems: {
      transactionAnomaly: 25,
      crossBorderCash: 15,
      buyBackRisk: 8,
    },
    citation: 'MoE Circular 08/AML/2021 + FATF Rec 10',
  },
  {
    id: 'trade_based_ml',
    label: 'Trade-based money laundering',
    prior: 0.08,
    supportingSubsystems: {
      tradeBasedMLDetector: 30,
      priceAnomaly: 15,
      lbmaFixPriceChecker: 10,
      crossBorderArbitrageDetector: 10,
    },
    citation: 'FATF TBML Best Practices + MoE Circular 08/AML/2021',
  },
  {
    id: 'layering',
    label: 'Ownership-layering / shell-company obfuscation',
    prior: 0.1,
    supportingSubsystems: {
      uboLayering: 30,
      uboGraph: 15,
      ownershipMotifs: 15,
      corporateGraphWalker: 10,
    },
    citation: 'Cabinet Decision 109/2023 + FATF Rec 10',
  },
  {
    id: 'pep_related',
    label: 'PEP or PEP-by-association risk',
    prior: 0.07,
    supportingSubsystems: {
      pepProximity: 25,
      adverseMediaRanker: 10,
    },
    citation: 'Cabinet Res 134/2025 Art.14',
  },
  {
    id: 'legitimate_activity',
    label: 'Legitimate activity — no predicate offence',
    prior: 0.6,
    supportingSubsystems: {
      // Absence of red-flag fires is what supports this hypothesis — handled
      // implicitly by the normalisation step below (low posterior when any
      // red-flag hypothesis has strong evidence).
    },
    citation: 'FDL No.10/2025 Art.19 (risk-based review)',
  },
];

export function generateHypotheses(input: {
  readonly focus: ReadonlyArray<SignalFocus>;
  readonly hypotheses?: ReadonlyArray<Hypothesis>;
}): HypothesisReport {
  const catalog = input.hypotheses ?? DEFAULT_HYPOTHESES;
  const firedMap = new Map<string, SignalFocus>();
  for (const f of input.focus) firedMap.set(f.name, f);

  // Bayesian update in log-space. Evidence contribution is
  //   effectiveEvidence * log(LR),
  // equivalent to treating each signal as an independent likelihood ratio
  // raised to the power of (strength * reliability). Attenuation stays in
  // [0, 1], so weak or unreliable signals contribute little and a perfect
  // signal contributes the full LR. This dominates the legitimate-activity
  // baseline when a strong, reliable red-flag signal fires — consistent
  // with Cabinet Res 134/2025 Art.5 (risk appetite) and Art.19 (review).
  const scored = catalog.map((h) => {
    let logScore = Math.log(Math.max(h.prior, 1e-6));
    const supporting: string[] = [];
    for (const [name, lr] of Object.entries(h.supportingSubsystems)) {
      const hit = firedMap.get(name);
      if (!hit) continue;
      const effectiveEvidence = hit.strength * hit.reliability;
      if (effectiveEvidence <= 0) continue;
      const logLr = Math.log(Math.max(lr, 1e-6));
      const contribution = effectiveEvidence * logLr;
      if (contribution > 0) {
        logScore += contribution;
        supporting.push(name);
      }
    }
    return { h, logScore, supporting };
  });

  const maxLog = scored.reduce((m, s) => (s.logScore > m ? s.logScore : m), -Infinity);
  const exp = scored.map((s) => ({
    ...s,
    weight: Math.exp(s.logScore - (Number.isFinite(maxLog) ? maxLog : 0)),
  }));
  const total = exp.reduce((a, b) => a + b.weight, 0);

  const ranked: HypothesisPosterior[] = exp
    .map((s) => ({
      id: s.h.id,
      label: s.h.label,
      prior: s.h.prior,
      posterior: total === 0 ? s.h.prior : Math.round((s.weight / total) * 10000) / 10000,
      supportingEvidence: s.supporting,
      citation: s.h.citation,
    }))
    .sort((a, b) => b.posterior - a.posterior);

  const mostLikely = ranked[0] ?? null;
  const narrative = !mostLikely
    ? 'Hypothesis generator: no hypotheses available.'
    : `Hypothesis generator: most likely = "${mostLikely.label}" ` +
      `(P=${(mostLikely.posterior * 100).toFixed(0)}%, prior=${(mostLikely.prior * 100).toFixed(0)}%). ` +
      `Supporting evidence: ${mostLikely.supportingEvidence.length === 0 ? 'none (prior-driven)' : mostLikely.supportingEvidence.join(', ')}. ` +
      `Citation: ${mostLikely.citation}.`;

  return { ranked, mostLikely, narrative };
}
