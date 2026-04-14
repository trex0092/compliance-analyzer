/**
 * Brain Adversarial Debate — deterministic prosecution-vs-defence
 * scoring engine that surfaces both sides of a borderline
 * compliance case.
 *
 * Why this exists:
 *   The brain emits a single verdict + confidence. When the case
 *   is dead-centre of a band the verdict is fine. When it is on a
 *   boundary (high-stddev confidence, ensemble disagreement, drift
 *   review_recommended), the MLRO needs to see BOTH the worst-case
 *   and best-case interpretations of the same evidence so they
 *   can defend their override decision at audit.
 *
 *   Today the brain forces the MLRO to reconstruct that opposing
 *   view themselves — read the StrFeatures, re-imagine the
 *   strongest possible escalation argument, then re-imagine the
 *   strongest possible "clear the case" argument, then synthesise.
 *   That reconstruction is slow and inconsistent across reviewers.
 *
 *   This module produces both arguments in a single pass with
 *   deterministic scoring. No LLM, no network, no nondeterminism
 *   — same input always produces the same debate transcript.
 *
 * Stances:
 *   Prosecution (escalation-biased)
 *     - Treats every red feature as decisive
 *     - Weights for false-negative aversion: missing a real STR
 *       is more costly than filing one false alarm
 *     - Anchors at FATF Rec 1 (risk-based, err on the side of
 *       caution) + FDL Art.20 (CO duty of care)
 *
 *   Defence (clear-the-case-biased)
 *     - Treats every red feature as innocent until corroborated
 *     - Weights for false-positive aversion: tipping off + over-
 *       filing harms legitimate customers (FDL Art.29) and
 *       degrades the FIU signal-to-noise ratio
 *     - Anchors at FATF Rec 10 (risk-based — no over-classification)
 *       + FDL Art.27 (proportional STR filing)
 *
 *   Judge
 *     - Reports the gap between scores
 *     - Picks the stronger stance only when the gap exceeds a
 *       defensible threshold (default 0.15)
 *     - On a tie, returns 'undetermined' and recommends MLRO
 *       review — never silently clobbers the existing brain verdict
 *
 * Cost-gating:
 *   The engine is cheap (pure arithmetic), but the orchestration
 *   layer should still only invoke it when the case is borderline
 *   — see `shouldDebate(decisionConfidence, uncertainty)`. Skip
 *   debating clear-cut cases to keep audit logs lean.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO reasoned, defensible decision)
 *   FDL No.10/2025 Art.27    (proportional STR filing)
 *   FDL No.10/2025 Art.29    (no tipping off — defence stance
 *                             explicitly weights this)
 *   FATF Rec 1               (risk-based approach — both stances)
 *   FATF Rec 10              (CDD — proportionality)
 *   NIST AI RMF 1.0 GOVERN-3 (multi-stakeholder review)
 *   EU AI Act Art.14         (human oversight of high-risk AI)
 */

import type { StrFeatures } from './predictiveStr';
import type { UncertaintyInterval } from './uncertaintyInterval';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DebateStance = 'prosecution' | 'defence';

export interface DebateArgument {
  /** Which stance produced this argument. */
  stance: DebateStance;
  /** Stable feature key the argument references. */
  feature: keyof StrFeatures;
  /** Plain-English claim the stance makes about the feature. */
  claim: string;
  /** Weighted contribution to the stance's score in [0, 1]. */
  weight: number;
  /** Raw feature value cited as evidence. */
  evidence: number | boolean;
}

export interface StanceReport {
  stance: DebateStance;
  /** Sum of weighted arguments, clamped to [0, 1]. */
  score: number;
  /** Top arguments sorted by weight desc. */
  arguments: readonly DebateArgument[];
  /** Plain-English position statement. */
  position: string;
  /** Regulatory anchor used by the stance. */
  regulatory: string;
}

export type DebateOutcome = 'prosecution_wins' | 'defence_wins' | 'undetermined';

export interface DebateReport {
  /** Schema version — bump when the shape changes. */
  schemaVersion: 1;
  prosecution: StanceReport;
  defence: StanceReport;
  /** Absolute score gap between prosecution and defence. */
  gap: number;
  /** Threshold used to decide an outcome. */
  threshold: number;
  outcome: DebateOutcome;
  /** Plain-English judge synthesis. */
  judgeSynthesis: string;
  /** Regulatory citations relied on by the judge. */
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Compress an unbounded positive numeric feature into [0, 1] via a
 * smooth saturation curve. Avoids the hard cliffs of a step function.
 */
function saturate(value: number, scale: number): number {
  if (value <= 0) return 0;
  return clamp01(value / (value + scale));
}

// ---------------------------------------------------------------------------
// Stance scorers
// ---------------------------------------------------------------------------

/**
 * Build the prosecution case. Weights are tuned so an "average
 * borderline case" with one red feature lands around 0.3-0.4 and
 * a "stack of red flags" approaches 1.0 without ever exceeding it.
 */
function buildProsecution(features: StrFeatures): StanceReport {
  const args: DebateArgument[] = [];

  // Sanctions — single most decisive prosecution lever.
  if (features.sanctionsMatchScore > 0) {
    args.push({
      stance: 'prosecution',
      feature: 'sanctionsMatchScore',
      claim:
        `Sanctions name-match score ${features.sanctionsMatchScore.toFixed(2)} ` +
        `is non-zero. FDL Art.35 + Cabinet Res 74/2020 require treating any ` +
        `non-zero match as a confirmed exposure pending verification.`,
      weight: clamp01(features.sanctionsMatchScore * 0.4 + 0.05),
      evidence: features.sanctionsMatchScore,
    });
  }

  // PEP exposure — escalation trigger under Art.14 EDD.
  if (features.isPep) {
    args.push({
      stance: 'prosecution',
      feature: 'isPep',
      claim:
        `UBO is a PEP. Cabinet Res 134/2025 Art.14 mandates EDD ` +
        `with senior management approval. Treat as escalation candidate.`,
      weight: 0.18,
      evidence: true,
    });
  }

  // Adverse media — corroborating signal.
  if (features.hasAdverseMedia) {
    args.push({
      stance: 'prosecution',
      feature: 'hasAdverseMedia',
      claim:
        `Unresolved adverse media hit. FATF Rec 10 requires elevated ` +
        `due diligence on any negative-news exposure.`,
      weight: 0.15,
      evidence: true,
    });
  }

  // High-risk jurisdiction.
  if (features.highRiskJurisdiction) {
    args.push({
      stance: 'prosecution',
      feature: 'highRiskJurisdiction',
      claim:
        `Counterparty in a FATF high-risk jurisdiction. Implies elevated ` +
        `predicate risk under FATF Rec 19.`,
      weight: 0.12,
      evidence: true,
    });
  }

  // Structuring proxy — near-threshold count.
  if (features.nearThresholdCount30d > 0) {
    args.push({
      stance: 'prosecution',
      feature: 'nearThresholdCount30d',
      claim:
        `${features.nearThresholdCount30d} transaction(s) within 10% of the ` +
        `AED 55K DPMS threshold in the last 30 days. Classic structuring ` +
        `pattern (FATF Glossary "smurfing").`,
      weight: saturate(features.nearThresholdCount30d, 5) * 0.25,
      evidence: features.nearThresholdCount30d,
    });
  }

  // Cash ratio — DPMS-specific risk multiplier.
  if (features.cashRatio30d >= 0.5) {
    args.push({
      stance: 'prosecution',
      feature: 'cashRatio30d',
      claim:
        `Cash ratio ${features.cashRatio30d.toFixed(2)} ≥ 0.5 over the last ` +
        `30 days. MoE Circular 08/AML/2021 flags high-cash DPMS activity ` +
        `as elevated risk.`,
      weight: clamp01(features.cashRatio30d * 0.2),
      evidence: features.cashRatio30d,
    });
  }

  // Prior alert pile-up — recidivism signal.
  if (features.priorAlerts90d > 0) {
    args.push({
      stance: 'prosecution',
      feature: 'priorAlerts90d',
      claim:
        `${features.priorAlerts90d} prior alert(s) in the last 90 days. ` +
        `Pattern of recurring red flags weighs against any "isolated ` +
        `incident" defence.`,
      weight: saturate(features.priorAlerts90d, 4) * 0.18,
      evidence: features.priorAlerts90d,
    });
  }

  args.sort((a, b) => b.weight - a.weight);
  const score = clamp01(args.reduce((s, a) => s + a.weight, 0));

  return {
    stance: 'prosecution',
    score,
    arguments: args,
    position:
      args.length === 0
        ? `Prosecution finds no decisive escalation triggers in the feature ` +
          `vector. Default to base brain verdict.`
        : `Prosecution argues escalation. ${args.length} corroborating signal(s) ` +
          `with combined weight ${score.toFixed(2)}. Top: ${args[0]!.feature}.`,
    regulatory: 'FDL No.10/2025 Art.20-21; FATF Rec 1; Cabinet Res 134/2025 Art.14',
  };
}

/**
 * Build the defence case. Mirrors the prosecution lever-by-lever
 * but inverts the inference: every red feature is contextualised
 * with a plausible non-AML explanation, and the absence of a
 * feature is treated as exculpatory.
 */
function buildDefence(features: StrFeatures): StanceReport {
  const args: DebateArgument[] = [];

  // Tenure — long onboarding history is the single strongest
  // defence lever per FATF Rec 10 simplified-CDD criteria.
  if (features.daysSinceOnboarding >= 365) {
    args.push({
      stance: 'defence',
      feature: 'daysSinceOnboarding',
      claim:
        `${features.daysSinceOnboarding} days since onboarding. Long tenure ` +
        `with no prior STR is a recognised SDD indicator under FATF Rec 10 ` +
        `and Cabinet Res 134/2025 Art.7-10.`,
      weight: clamp01(saturate(features.daysSinceOnboarding - 365, 730) * 0.3 + 0.05),
      evidence: features.daysSinceOnboarding,
    });
  }

  // No sanctions hit.
  if (features.sanctionsMatchScore === 0) {
    args.push({
      stance: 'defence',
      feature: 'sanctionsMatchScore',
      claim:
        `Sanctions match score 0 across all six lists (UN/OFAC/EU/UK/UAE/EOCN). ` +
        `Absence of a hit is the most decisive single negative under FDL Art.35.`,
      weight: 0.22,
      evidence: 0,
    });
  }

  // Not a PEP.
  if (!features.isPep) {
    args.push({
      stance: 'defence',
      feature: 'isPep',
      claim: `No PEP exposure. Cabinet Res 134/2025 Art.14 EDD trigger absent.`,
      weight: 0.12,
      evidence: false,
    });
  }

  // No adverse media.
  if (!features.hasAdverseMedia) {
    args.push({
      stance: 'defence',
      feature: 'hasAdverseMedia',
      claim: `No unresolved adverse media. FATF Rec 10 elevation absent.`,
      weight: 0.1,
      evidence: false,
    });
  }

  // No structuring proxy.
  if (features.nearThresholdCount30d === 0) {
    args.push({
      stance: 'defence',
      feature: 'nearThresholdCount30d',
      claim:
        `Zero near-threshold transactions in the last 30 days. No structuring ` +
        `pattern under FATF Glossary "smurfing".`,
      weight: 0.15,
      evidence: 0,
    });
  }

  // Low cash ratio — DPMS-friendly profile.
  if (features.cashRatio30d < 0.3) {
    args.push({
      stance: 'defence',
      feature: 'cashRatio30d',
      claim:
        `Cash ratio ${features.cashRatio30d.toFixed(2)} below the MoE Circular ` +
        `08/AML/2021 high-risk threshold of 0.5. Predominantly traceable ` +
        `transaction profile.`,
      weight: clamp01((0.3 - features.cashRatio30d) * 0.4),
      evidence: features.cashRatio30d,
    });
  }

  // No prior alerts — clean recent history.
  if (features.priorAlerts90d === 0) {
    args.push({
      stance: 'defence',
      feature: 'priorAlerts90d',
      claim:
        `Zero prior alerts in the last 90 days. No pattern of recurring ` +
        `red flags; FDL Art.27 proportionality favours non-escalation.`,
      weight: 0.12,
      evidence: 0,
    });
  }

  args.sort((a, b) => b.weight - a.weight);
  const score = clamp01(args.reduce((s, a) => s + a.weight, 0));

  return {
    stance: 'defence',
    score,
    arguments: args,
    position:
      args.length === 0
        ? `Defence finds no exculpatory signals. Yields to prosecution position.`
        : `Defence argues against escalation. ${args.length} negative signal(s) ` +
          `with combined weight ${score.toFixed(2)}. Top: ${args[0]!.feature}.`,
    regulatory: 'FDL No.10/2025 Art.27, Art.29; FATF Rec 10',
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DebateConfig {
  /** Score gap required to declare a winner. Default 0.15. */
  threshold?: number;
}

const DEFAULT_THRESHOLD = 0.15;

/**
 * Run a deterministic adversarial debate over a feature vector.
 * Pure function — no network, no state, same input → same output.
 */
export function runAdversarialDebate(features: StrFeatures, cfg: DebateConfig = {}): DebateReport {
  const threshold = typeof cfg.threshold === 'number' ? cfg.threshold : DEFAULT_THRESHOLD;
  const prosecution = buildProsecution(features);
  const defence = buildDefence(features);
  const gap = Math.abs(prosecution.score - defence.score);

  let outcome: DebateOutcome;
  let judgeSynthesis: string;
  if (gap < threshold) {
    outcome = 'undetermined';
    judgeSynthesis =
      `Judge: undetermined. Score gap ${gap.toFixed(3)} below threshold ` +
      `${threshold.toFixed(2)}. Prosecution ${prosecution.score.toFixed(3)} vs ` +
      `defence ${defence.score.toFixed(3)}. MLRO must apply human judgment ` +
      `under FDL Art.20 — the brain verdict alone does not resolve this case.`;
  } else if (prosecution.score > defence.score) {
    outcome = 'prosecution_wins';
    judgeSynthesis =
      `Judge: prosecution wins by ${gap.toFixed(3)}. Strongest argument: ` +
      `${prosecution.arguments[0]?.claim ?? 'n/a'} ` +
      `Defence's strongest counter: ` +
      `${defence.arguments[0]?.claim ?? 'no exculpatory evidence found'}`;
  } else {
    outcome = 'defence_wins';
    judgeSynthesis =
      `Judge: defence wins by ${gap.toFixed(3)}. Strongest argument: ` +
      `${defence.arguments[0]?.claim ?? 'n/a'} ` +
      `Prosecution's strongest claim: ` +
      `${prosecution.arguments[0]?.claim ?? 'no escalation triggers found'}`;
  }

  return {
    schemaVersion: 1,
    prosecution,
    defence,
    gap,
    threshold,
    outcome,
    judgeSynthesis,
    regulatory: [
      'FDL No.10/2025 Art.20-21',
      'FDL No.10/2025 Art.27',
      'FDL No.10/2025 Art.29',
      'FATF Rec 1',
      'FATF Rec 10',
      'NIST AI RMF 1.0 GOVERN-3',
      'EU AI Act Art.14',
    ],
  };
}

/**
 * Cost gate — should the orchestrator invoke the debate engine?
 * Returns true only when the case is borderline. Skip debating
 * clear-cut cases to keep audit logs lean.
 */
export function shouldDebate(
  baseConfidence: number,
  uncertainty: UncertaintyInterval | null | undefined
): boolean {
  // Confidence in the "wide ambiguity zone" always triggers debate.
  if (baseConfidence >= 0.4 && baseConfidence <= 0.7) return true;
  // Otherwise gate on the uncertainty width: anything moderate or
  // wider deserves the debate.
  if (!uncertainty) return false;
  return (
    uncertainty.coverage === 'moderate' ||
    uncertainty.coverage === 'wide' ||
    uncertainty.coverage === 'critical'
  );
}

// Exports for tests.
export const __test__ = {
  buildProsecution,
  buildDefence,
  saturate,
  clamp01,
  DEFAULT_THRESHOLD,
};
