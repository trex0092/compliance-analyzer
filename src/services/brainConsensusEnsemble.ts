/**
 * Brain Consensus Ensemble — run the brain N times with small input
 * perturbations and return a consensus verdict plus a disagreement
 * score.
 *
 * Why this matters:
 *   The compliance brain is deterministic, but the INPUT feature
 *   vector is noisy. Real-world cases arrive with estimates like
 *   "about 50K AED cash ratio" or "roughly 10 prior alerts". A
 *   brain that produces different verdicts for 50K vs 55K is
 *   sitting on a decision boundary — a regulator challenge or a
 *   small data error can flip the verdict after the fact.
 *
 *   The ensemble detects these boundary cases by running the
 *   full typology matcher over a small grid of perturbed input
 *   vectors and comparing the results. If every perturbation
 *   produces the same set of top typologies, the decision is
 *   robust. If perturbations flip verdicts, the case is marked
 *   "unstable" and recommended for four-eyes review regardless
 *   of the base verdict.
 *
 * This is a pure function: deterministic, fast, no state, no
 * network. It does NOT call runWeaponizedBrain because that would
 * be too expensive for N ≥ 5 runs per case. Instead it uses the
 * FATF typology matcher, which is the subsystem most sensitive to
 * input noise and already gives a stable severity band the
 * ensemble can vote on.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO reasoned decision — the MLRO
 *                             must know when a decision is
 *                             sitting on a boundary)
 *   Cabinet Res 134/2025 Art.19 (internal review before decision)
 *   FATF Rec 1 (risk-based — boundary instability is a risk
 *                signal in itself)
 *   NIST AI RMF 1.0 MANAGE-2 (AI decision provenance — ensemble
 *                             disagreement is a provenance artefact)
 */

import type { StrFeatures } from './predictiveStr';
import {
  matchFatfTypologies,
  type TypologyReport,
} from './fatfTypologyMatcher';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnsembleConfig {
  /** Number of perturbation runs (odd recommended so ties break). */
  runs?: number;
  /** Relative perturbation size for numeric fields. Default 0.1 (±10%). */
  perturbation?: number;
  /** Deterministic seed so tests are reproducible. Default 42. */
  seed?: number;
}

export interface EnsembleVote {
  /** Which perturbation this is (0 = base, 1..N = perturbed). */
  runIndex: number;
  /** Features used for this run. */
  features: StrFeatures;
  /** Top typology id chosen (null if no match). */
  topTypologyId: string | null;
  /** Top severity observed in this run. */
  topSeverity: TypologyReport['topSeverity'];
  /** Count of typologies matched. */
  matchCount: number;
}

export interface EnsembleReport {
  /** Count of runs performed. */
  runs: number;
  /** Mean match count across runs. */
  meanMatchCount: number;
  /** Top typology id that won the most votes. Null when no run matched. */
  majorityTypologyId: string | null;
  /** Number of runs that voted for the majority typology. */
  majorityVoteCount: number;
  /** Agreement 0..1: majorityVoteCount / runs. */
  agreement: number;
  /** True when agreement < stabilityThreshold (default 0.8). */
  unstable: boolean;
  /** Severity band with the most votes. */
  majoritySeverity: TypologyReport['topSeverity'];
  /** Individual votes for drill-down. */
  votes: readonly EnsembleVote[];
  /** Plain-English summary safe for Asana / STR narrative. */
  summary: string;
  /** Regulatory citation. */
  regulatory: string;
}

// ---------------------------------------------------------------------------
// Deterministic LCG — seedable, no network, no Math.random() noise.
// ---------------------------------------------------------------------------

function lcg(seed: number): () => number {
  // Numerical Recipes LCG constants.
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    // Return a number in [-1, 1).
    return (state / 0x1_0000_0000) * 2 - 1;
  };
}

function perturbNumeric(
  value: number,
  rng: () => number,
  amount: number,
  min = 0,
  max = Infinity
): number {
  const delta = value * amount * rng();
  const next = value + delta;
  return Math.min(max, Math.max(min, next));
}

function perturbFeatures(
  base: StrFeatures,
  rng: () => number,
  amount: number
): StrFeatures {
  return {
    priorAlerts90d: Math.round(perturbNumeric(base.priorAlerts90d, rng, amount)),
    txValue30dAED: perturbNumeric(base.txValue30dAED, rng, amount),
    nearThresholdCount30d: Math.round(
      perturbNumeric(base.nearThresholdCount30d, rng, amount)
    ),
    crossBorderRatio30d: perturbNumeric(base.crossBorderRatio30d, rng, amount, 0, 1),
    // Booleans stay fixed — they are not noisy inputs.
    isPep: base.isPep,
    highRiskJurisdiction: base.highRiskJurisdiction,
    hasAdverseMedia: base.hasAdverseMedia,
    daysSinceOnboarding: Math.round(
      perturbNumeric(base.daysSinceOnboarding, rng, amount)
    ),
    sanctionsMatchScore: perturbNumeric(
      base.sanctionsMatchScore,
      rng,
      amount,
      0,
      1
    ),
    cashRatio30d: perturbNumeric(base.cashRatio30d, rng, amount, 0, 1),
  };
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

const DEFAULT_RUNS = 5;
const DEFAULT_PERTURBATION = 0.1;
const DEFAULT_SEED = 42;
const STABILITY_THRESHOLD = 0.8;

export function runBrainEnsemble(
  base: StrFeatures,
  cfg: EnsembleConfig = {}
): EnsembleReport {
  const runs = Math.max(1, cfg.runs ?? DEFAULT_RUNS);
  const perturbation = Math.max(0, cfg.perturbation ?? DEFAULT_PERTURBATION);
  const seed = cfg.seed ?? DEFAULT_SEED;
  const rng = lcg(seed);
  const votes: EnsembleVote[] = [];

  // Run 0 is the base vector.
  const baseReport = matchFatfTypologies(base);
  votes.push({
    runIndex: 0,
    features: base,
    topTypologyId: baseReport.matches[0]?.typology.id ?? null,
    topSeverity: baseReport.topSeverity,
    matchCount: baseReport.matches.length,
  });

  for (let i = 1; i < runs; i++) {
    const perturbed = perturbFeatures(base, rng, perturbation);
    const report = matchFatfTypologies(perturbed);
    votes.push({
      runIndex: i,
      features: perturbed,
      topTypologyId: report.matches[0]?.typology.id ?? null,
      topSeverity: report.topSeverity,
      matchCount: report.matches.length,
    });
  }

  // Majority voting on top typology id.
  const typologyCounts = new Map<string, number>();
  for (const v of votes) {
    const key = v.topTypologyId ?? '__none__';
    typologyCounts.set(key, (typologyCounts.get(key) ?? 0) + 1);
  }
  let majorityTypologyId: string | null = null;
  let majorityVoteCount = 0;
  for (const [key, count] of typologyCounts) {
    if (count > majorityVoteCount) {
      majorityVoteCount = count;
      majorityTypologyId = key === '__none__' ? null : key;
    }
  }

  // Majority voting on severity.
  const severityCounts = new Map<string, number>();
  for (const v of votes) {
    severityCounts.set(
      v.topSeverity,
      (severityCounts.get(v.topSeverity) ?? 0) + 1
    );
  }
  let majoritySeverity: TypologyReport['topSeverity'] = 'none';
  let topSeverityCount = 0;
  for (const [key, count] of severityCounts) {
    if (count > topSeverityCount) {
      topSeverityCount = count;
      majoritySeverity = key as TypologyReport['topSeverity'];
    }
  }

  const agreement = majorityVoteCount / runs;
  const unstable = agreement < STABILITY_THRESHOLD;
  const totalMatches = votes.reduce((s, v) => s + v.matchCount, 0);
  const meanMatchCount = totalMatches / runs;

  const summary = unstable
    ? `Ensemble UNSTABLE — only ${majorityVoteCount}/${runs} runs agreed on the top typology (agreement ${(agreement * 100).toFixed(0)}%). ` +
      `Case is sitting on a decision boundary; recommend four-eyes review regardless of base verdict.`
    : `Ensemble STABLE — ${majorityVoteCount}/${runs} runs agreed on ${majorityTypologyId ?? 'no-match'} (agreement ${(agreement * 100).toFixed(0)}%). ` +
      `Mean match count ${meanMatchCount.toFixed(1)}; majority severity ${majoritySeverity}.`;

  return {
    runs,
    meanMatchCount,
    majorityTypologyId,
    majorityVoteCount,
    agreement,
    unstable,
    majoritySeverity,
    votes,
    summary,
    regulatory:
      'FDL No.10/2025 Art.20-21; Cabinet Res 134/2025 Art.19; FATF Rec 1; NIST AI RMF 1.0 MANAGE-2',
  };
}

// Exports for tests.
export const __test__ = {
  lcg,
  perturbFeatures,
  DEFAULT_RUNS,
  DEFAULT_PERTURBATION,
  STABILITY_THRESHOLD,
};
