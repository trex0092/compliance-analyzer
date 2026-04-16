/**
 * Weaponized Brain — Phase 13 Reasoning & Analysis subsystems (#99-#103).
 *
 * Five additive, read-only reasoning layers that deepen the explainability
 * and audit discipline of the Weaponized Brain without modifying any
 * prior subsystem. All are pure TypeScript, browser-safe, and optional
 * (skipped when inputs are absent). None of them clamp the verdict in v1
 * — they produce diagnostic reports for MLRO review.
 *
 *   #99  Factor Ablation       — necessity test: hold out each input
 *                                 signal, check whether the aggregate
 *                                 verdict would de-escalate. Complements
 *                                 #25 (counterfactualFlipper) which seeks
 *                                 the minimum perturbation to flip.
 *   #100 Citation Integrity    — every verdict-impacting clamp reason
 *                                 must carry a recognised regulatory
 *                                 citation (FDL / Cabinet Res / FATF /
 *                                 LBMA / EU AI Act). Fails closed on gaps.
 *   #101 Reasoning-Chain DAG   — structured lineage of signal → clamp →
 *                                 verdict. Feeds xyflow UI. Distinct from
 *                                 #22 (contradiction) and #79 (cycle
 *                                 detection) — this is provenance.
 *   #102 Benign-Narrative      — adversarial counter-hypothesis: "most
 *                                 innocent reading" of the evidence.
 *                                 Surfaces alongside the verdict to guard
 *                                 against over-conviction. Uses an
 *                                 injected generator (browser-safe stub
 *                                 when omitted).
 *   #103 Evidence Freshness    — age-weighted exponential decay on signal
 *                                 confidences. A 3-year-old adverse-media
 *                                 hit is weaker than a 3-month-old one.
 *
 * Regulatory basis (composite — each subsystem cites its own basis also):
 *   - FDL No.10/2025 Art.19   (risk-based internal review)
 *   - FDL No.10/2025 Art.24   (audit trail of decision rationale)
 *   - Cabinet Res 134/2025 Art.14 (EDD justification)
 *   - Cabinet Res 134/2025 Art.19 (internal review before decision)
 *   - EU AI Act Art.13         (transparency)
 *   - EU AI Act Art.15         (bias / fairness)
 *   - FATF Rec 10              (ongoing monitoring, evidence recency)
 *   - CLAUDE.md §8             (regulatory citation discipline)
 */

import type { Verdict } from './teacherStudent';
import type { SubsystemSignal } from './contradictionDetector';

// Local verdict ordering. Duplicated intentionally to keep this module
// decoupled from weaponizedBrain.ts (no cyclic import).
const VERDICT_RANK: Record<Verdict, number> = {
  pass: 0,
  flag: 1,
  escalate: 2,
  freeze: 3,
};

// ---------------------------------------------------------------------------
// #99 Factor Ablation / Do-Calculus Holdout
// ---------------------------------------------------------------------------

export interface FactorAblationResult {
  /** Signal that was held out. */
  signalName: string;
  /** Aggregate verdict computed with this signal excluded. */
  ablatedVerdict: Verdict;
  /** VERDICT_RANK delta vs. baseline. Negative means removing de-escalated. */
  rankDelta: number;
  /** True when removing this signal lowers the verdict — signal is load-bearing. */
  necessary: boolean;
}

export interface FactorAblationReport {
  /** Baseline verdict when all signals are present. */
  baselineVerdict: Verdict;
  /** One result per input signal. */
  results: FactorAblationResult[];
  /** Names of signals whose removal de-escalates the verdict. */
  necessarySignals: string[];
  /** Names of signals that could be removed with no verdict change. */
  redundantSignals: string[];
  /** Human-readable narrative. */
  narrative: string;
}

/**
 * Factor ablation (do-calculus holdout) over subsystem signals. For each
 * signal, recompute the aggregate verdict excluding that signal and report
 * whether the verdict would de-escalate.
 *
 * Regulatory basis: EU AI Act Art.13 (transparency), Cabinet Res 134/2025
 * Art.14 (EDD justification). Strictly read-only — does NOT clamp.
 */
export function runFactorAblation(input: {
  readonly baselineVerdict: Verdict;
  readonly signals: ReadonlyArray<SubsystemSignal>;
}): FactorAblationReport {
  const baselineRank = VERDICT_RANK[input.baselineVerdict];
  const results: FactorAblationResult[] = [];
  const necessarySignals: string[] = [];
  const redundantSignals: string[] = [];

  for (let i = 0; i < input.signals.length; i += 1) {
    const held = input.signals[i];
    const remaining = input.signals.filter((_, j) => j !== i);
    const ablatedVerdict = aggregateVerdict(remaining, input.baselineVerdict);
    const rankDelta = VERDICT_RANK[ablatedVerdict] - baselineRank;
    const necessary = rankDelta < 0;
    results.push({
      signalName: held.name,
      ablatedVerdict,
      rankDelta,
      necessary,
    });
    if (necessary) necessarySignals.push(held.name);
    else redundantSignals.push(held.name);
  }

  return {
    baselineVerdict: input.baselineVerdict,
    results,
    necessarySignals,
    redundantSignals,
    narrative: buildAblationNarrative(input.baselineVerdict, necessarySignals, redundantSignals),
  };
}

function aggregateVerdict(signals: ReadonlyArray<SubsystemSignal>, fallback: Verdict): Verdict {
  // Max-rank verdict among signals with confidence >= 0.5. Signals below
  // the confidence floor do not contribute. If nothing contributes, return
  // the caller's fallback (usually the MegaBrain baseline).
  if (signals.length === 0) return fallback;
  let best: Verdict = 'pass';
  let bestRank = -1;
  for (const s of signals) {
    if (s.confidence < 0.5) continue;
    const r = VERDICT_RANK[s.impliedVerdict];
    if (r > bestRank) {
      best = s.impliedVerdict;
      bestRank = r;
    }
  }
  return bestRank < 0 ? fallback : best;
}

function buildAblationNarrative(
  baseline: Verdict,
  necessary: ReadonlyArray<string>,
  redundant: ReadonlyArray<string>
): string {
  const nec =
    necessary.length === 0
      ? 'none (decision is over-determined — any single signal suffices)'
      : necessary.join(', ');
  const red = redundant.length === 0 ? 'none' : redundant.join(', ');
  return `Baseline verdict ${baseline}. Necessary signals: ${nec}. Redundant signals: ${red}.`;
}

// ---------------------------------------------------------------------------
// #100 Citation Integrity Checker
// ---------------------------------------------------------------------------

export interface CitationDefect {
  /** Origin of the offending text. */
  source: 'clampReason' | 'narrativeLine';
  /** The text that is missing a citation. */
  text: string;
  /** Reason the checker flagged it. */
  reason: string;
}

export interface CitationIntegrityReport {
  /** True when every checked item carries a recognised regulatory citation. */
  complete: boolean;
  /** Count of clamp reasons inspected. */
  clampReasonsChecked: number;
  /** Items missing a citation. */
  defects: CitationDefect[];
  /** Fraction of clamp reasons that carry a citation, in [0, 1]. */
  coverage: number;
  /** Human-readable summary. */
  narrative: string;
}

// Patterns recognised as valid regulatory citations per CLAUDE.md §8.
// Kept in this module (not imported) so the checker is self-contained.
const CITATION_PATTERNS: ReadonlyArray<RegExp> = [
  /FDL\s+(No\.)?\s*10\/2025\s+Art\./i,
  /Cabinet\s+Res(olution)?\s+\d+\/\d+\s+Art\./i,
  /Cabinet\s+Decision\s+\d+\/\d+/i,
  /MoE\s+Circular\s+\d+\/AML\/\d+/i,
  /FATF\s+Rec(\.|ommendation)?\s*\d+/i,
  /LBMA\s+RGG(\s+v\d+)?/i,
  /EU\s+AI\s+Act\s+Art\.\s*\d+/i,
  /NIST\s+AI\s+RMF/i,
  /ISO\/IEC\s+42001/i,
  /OECD\s+DDG/i,
  /ISSB\s+IFRS\s+S\d+/i,
  /Dodd-Frank\s+§\s*\d+/i,
];

/**
 * Verify that every verdict-impacting clamp reason and every regulatory
 * narrative line cites at least one recognised regulation. Reports defects
 * without changing the verdict.
 *
 * Regulatory basis: FDL No.10/2025 Art.24 (audit trail) + CLAUDE.md §8.
 */
export function checkCitationIntegrity(input: {
  readonly clampReasons: ReadonlyArray<string>;
  readonly narrativeLines?: ReadonlyArray<string>;
}): CitationIntegrityReport {
  const defects: CitationDefect[] = [];
  let clampReasonsChecked = 0;
  let withCitation = 0;

  for (const reason of input.clampReasons) {
    // Only enforce on strings that announce themselves as clamps.
    if (!/clamp/i.test(reason)) continue;
    clampReasonsChecked += 1;
    if (hasCitation(reason)) {
      withCitation += 1;
    } else {
      defects.push({
        source: 'clampReason',
        text: reason,
        reason:
          'clamp reason does not cite any recognised regulation (FDL / Cabinet Res / FATF / LBMA / EU AI Act)',
      });
    }
  }

  for (const line of input.narrativeLines ?? []) {
    // Narrative lines that announce a regulatory-weight outcome must cite a rule.
    if (/freeze|escalate|STR|CNMR|CTR|DPMSR|SAR/i.test(line) && !hasCitation(line)) {
      defects.push({
        source: 'narrativeLine',
        text: line,
        reason: 'verdict-impacting narrative line lacks regulatory citation',
      });
    }
  }

  const coverage = clampReasonsChecked === 0 ? 1 : withCitation / clampReasonsChecked;
  return {
    complete: defects.length === 0,
    clampReasonsChecked,
    defects,
    coverage,
    narrative: buildCitationNarrative(defects.length, coverage),
  };
}

function hasCitation(text: string): boolean {
  return CITATION_PATTERNS.some((p) => p.test(text));
}

function buildCitationNarrative(defectCount: number, coverage: number): string {
  const pct = (coverage * 100).toFixed(0);
  if (defectCount === 0) {
    return `Citation integrity complete (${pct}% coverage) — every verdict-impacting clamp carries a regulatory citation.`;
  }
  return (
    `Citation integrity INCOMPLETE — ${defectCount} defect(s), ${pct}% coverage. ` +
    `Regulator-ready narratives require every clamp to cite FDL / Cabinet Res / FATF / LBMA (CLAUDE.md §8, FDL Art.24).`
  );
}

// ---------------------------------------------------------------------------
// #101 Reasoning-Chain DAG Lineage
// ---------------------------------------------------------------------------

export interface ReasoningDagNode {
  /** Stable, unique ID within the DAG. */
  id: string;
  /** Node class. */
  kind: 'signal' | 'clamp' | 'verdict';
  /** Human-readable label. */
  label: string;
  /** Associated verdict (for signal/verdict nodes). */
  verdict?: Verdict;
}

export interface ReasoningDagEdge {
  from: string;
  to: string;
  /** Semantics: a signal contributes to a clamp, a clamp escalates the verdict. */
  kind: 'contributes' | 'escalates' | 'corroborates';
}

export interface ReasoningDagReport {
  nodes: ReasoningDagNode[];
  edges: ReasoningDagEdge[];
  /** Ordered IDs from MegaBrain verdict through clamps to final verdict. */
  criticalPath: string[];
  /** Narrative summary suitable for the audit record. */
  narrative: string;
}

/**
 * Build a directed-acyclic provenance graph from subsystem signals, clamp
 * reasons, and the baseline + final verdicts. Feeds xyflow-style UI and
 * the audit narrative. Read-only.
 *
 * Regulatory basis: FDL Art.24 (record retention), EU AI Act Art.13
 * (transparency), CLAUDE.md §3 (audit trail).
 */
export function buildReasoningDag(input: {
  readonly signals: ReadonlyArray<SubsystemSignal>;
  readonly clampReasons: ReadonlyArray<string>;
  readonly megaVerdict: Verdict;
  readonly finalVerdict: Verdict;
}): ReasoningDagReport {
  const nodes: ReasoningDagNode[] = [];
  const edges: ReasoningDagEdge[] = [];

  const megaId = 'verdict.mega';
  const finalId = 'verdict.final';
  nodes.push({
    id: megaId,
    kind: 'verdict',
    label: 'MegaBrain verdict',
    verdict: input.megaVerdict,
  });
  nodes.push({
    id: finalId,
    kind: 'verdict',
    label: 'Final verdict',
    verdict: input.finalVerdict,
  });

  for (const s of input.signals) {
    const id = `signal.${s.name}`;
    nodes.push({ id, kind: 'signal', label: s.name, verdict: s.impliedVerdict });
    if (s.impliedVerdict !== 'pass' && s.confidence >= 0.5) {
      edges.push({ from: id, to: finalId, kind: 'contributes' });
    }
  }

  input.clampReasons.forEach((reason, i) => {
    const id = `clamp.${i}`;
    const label = reason.length > 80 ? `${reason.slice(0, 77)}...` : reason;
    nodes.push({ id, kind: 'clamp', label });
    edges.push({ from: id, to: finalId, kind: 'escalates' });
    // Link signals referenced by name in the clamp text.
    for (const s of input.signals) {
      if (reason.toLowerCase().includes(s.name.toLowerCase())) {
        edges.push({ from: `signal.${s.name}`, to: id, kind: 'contributes' });
      }
    }
  });

  edges.push({ from: megaId, to: finalId, kind: 'escalates' });

  const criticalPath = [megaId, ...input.clampReasons.map((_, i) => `clamp.${i}`), finalId];

  return {
    nodes,
    edges,
    criticalPath,
    narrative:
      `Reasoning DAG: ${nodes.length} node(s), ${edges.length} edge(s). ` +
      `Critical path has ${criticalPath.length} step(s) from MegaBrain (${input.megaVerdict}) ` +
      `to final (${input.finalVerdict}).`,
  };
}

// ---------------------------------------------------------------------------
// #102 Benign-Narrative Probe
// ---------------------------------------------------------------------------

export interface BenignNarrativeResult {
  /** The counter-narrative text (most innocent interpretation). Empty when not run. */
  text: string;
  /** Plausibility in [0,1], clamped. 0.5 = neutral. */
  plausibility: number;
  /** Short list of factors that support the benign reading. */
  supportingFactors: string[];
  /** Whether the probe was actually invoked (false when no generator provided). */
  ran: boolean;
  /** Human-readable summary. */
  narrative: string;
}

export type BenignNarrativeGenerator = (ctx: {
  readonly entitySummary: string;
  readonly signals: ReadonlyArray<SubsystemSignal>;
}) => Promise<{
  text: string;
  plausibility: number;
  supportingFactors: string[];
}>;

/**
 * Generate the most-innocent plausible interpretation of the evidence.
 * Acts as a counterweight to the adversarial verdict; does not change it.
 *
 * The generator is dep-injected so this module stays browser-safe. When
 * the generator is omitted, the probe is a no-op.
 *
 * Regulatory basis: EU AI Act Art.15 (bias / fairness), FATF Rec 10
 * (risk-based proportionate scrutiny).
 */
export async function runBenignNarrativeProbe(input: {
  readonly entitySummary: string;
  readonly signals: ReadonlyArray<SubsystemSignal>;
  readonly generator?: BenignNarrativeGenerator;
}): Promise<BenignNarrativeResult> {
  if (!input.generator) {
    return {
      text: '',
      plausibility: 0,
      supportingFactors: [],
      ran: false,
      narrative: 'Benign-narrative probe skipped — no generator provided.',
    };
  }
  const raw = await input.generator({
    entitySummary: input.entitySummary,
    signals: input.signals,
  });
  const plausibility = Math.max(0, Math.min(1, raw.plausibility));
  const supportingFactors = [...raw.supportingFactors].slice(0, 10);
  return {
    text: raw.text,
    plausibility,
    supportingFactors,
    ran: true,
    narrative:
      `Benign-narrative plausibility ${(plausibility * 100).toFixed(0)}% — ` +
      `${supportingFactors.length} supporting factor(s). Surfaced for MLRO review (EU AI Act Art.15).`,
  };
}

// ---------------------------------------------------------------------------
// #103 Evidence Freshness Decay
// ---------------------------------------------------------------------------

export interface FreshnessScored {
  signalName: string;
  ageDays: number;
  originalConfidence: number;
  /** Multiplier applied to the original confidence, in (0, 1]. */
  decayFactor: number;
  /** originalConfidence * decayFactor, clamped to [0, 1]. */
  adjustedConfidence: number;
}

export interface EvidenceFreshnessReport {
  adjustments: FreshnessScored[];
  /** Half-life used for exponential decay, in days. */
  halfLifeDays: number;
  /** Count of signals that dropped below confidence 0.5 after decay. */
  demoted: number;
  narrative: string;
}

export interface DatedSignal extends SubsystemSignal {
  /** ISO-8601 string or Date — when the underlying evidence was collected. */
  asOf?: string | Date;
}

/**
 * Apply exponential decay to signal confidences based on evidence age.
 * A 3-year-old adverse-media hit should carry less weight than a
 * 3-month-old hit. Default half-life: 180 days. Read-only — does not
 * mutate the source signals and does not clamp the verdict.
 *
 * Regulatory basis: FATF Rec 10 (ongoing monitoring with current data),
 * Cabinet Res 134/2025 Art.7 (CDD recency requirements).
 */
export function runEvidenceFreshness(input: {
  readonly signals: ReadonlyArray<DatedSignal>;
  readonly asOf?: Date;
  readonly halfLifeDays?: number;
}): EvidenceFreshnessReport {
  const halfLife = Math.max(1, input.halfLifeDays ?? 180);
  const now = input.asOf ?? new Date();
  const adjustments: FreshnessScored[] = [];
  let demoted = 0;

  for (const s of input.signals) {
    const asOfDate = s.asOf instanceof Date ? s.asOf : s.asOf ? new Date(s.asOf) : now;
    const ageMs = now.getTime() - asOfDate.getTime();
    const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24));
    // half-life decay: f(t) = 0.5 ^ (t / halfLife)
    const decay = Math.pow(0.5, ageDays / halfLife);
    const adjusted = Math.max(0, Math.min(1, s.confidence * decay));
    if (s.confidence >= 0.5 && adjusted < 0.5) demoted += 1;
    adjustments.push({
      signalName: s.name,
      ageDays: Math.round(ageDays * 10) / 10,
      originalConfidence: s.confidence,
      decayFactor: Math.round(decay * 1000) / 1000,
      adjustedConfidence: Math.round(adjusted * 1000) / 1000,
    });
  }

  return {
    adjustments,
    halfLifeDays: halfLife,
    demoted,
    narrative:
      `Evidence freshness decay applied (half-life ${halfLife}d). ` +
      `${demoted} signal(s) demoted below 0.5 confidence due to age — ` +
      `may no longer satisfy FATF Rec 10 ongoing-monitoring recency bar.`,
  };
}
