/**
 * Uncertainty Interval — structured credible interval on the brain's
 * confidence score, derived from the consensus ensemble's
 * perturbation votes.
 *
 * Why this exists:
 *   The brain emits a single point-estimate confidence in [0, 1].
 *   That number is honest about the central tendency but mute about
 *   the BOUNDARY: how sensitive the decision is to small input
 *   perturbations. Two cases that both score 0.72 can be very
 *   different — one may be dead-centre of the flag band, the other
 *   may be sitting on the freeze boundary and the next decimal of
 *   noise would flip it.
 *
 *   MLROs need to see the boundary distance. Regulators (MoE, LBMA)
 *   explicitly favour uncertainty-aware AI outputs (NIST AI RMF
 *   1.0 MEASURE-2, FATF Rec 20). Point estimates alone are no
 *   longer defensible at inspection.
 *
 *   This module turns the EnsembleReport (which already runs the
 *   brain N times under controlled perturbations) into a structured
 *   interval on the base confidence: { lower, upper, width, stddev,
 *   coverage }. It does NOT claim to be a Bayesian posterior — it
 *   is a variance-style interval computed from a perturbation
 *   sample. The summary explicitly labels it as such so the MLRO
 *   doesn't overclaim in an STR narrative.
 *
 *   Pure function, no network, no state. Same input always
 *   produces the same interval. Safe to call on every super-run.
 *
 * How the interval is derived:
 *
 *   1. For each run in the ensemble, compute an implied confidence
 *      ∈ [0, 1] from the run's (matchCount, severity) tuple. This
 *      is a deterministic mapping — severity dominates, match count
 *      breaks ties within a band.
 *
 *   2. Compute the sample mean and standard deviation of the run
 *      implied confidences.
 *
 *   3. Compute a symmetric width around the base (point-estimate)
 *      confidence proportional to both the sample stddev and the
 *      disagreement rate (1 - agreement). The disagreement weight
 *      amplifies uncertainty when runs disagree on the top
 *      typology — a more conservative signal than raw stddev.
 *
 *   4. Clamp the [lower, upper] interval to [0, 1] and compute a
 *      "coverage band" label (point, narrow, moderate, wide,
 *      critical) the UI can render without calling us.
 *
 * Calibration disclaimer (intentional):
 *   This is NOT a Bayesian 90% credible interval. It is a
 *   variance-aware envelope derived from a small perturbation
 *   sample. We label it as "variance_interval" so downstream
 *   consumers (Asana task body, STR narrative) never claim
 *   statistical coverage we can't defend at audit.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO duty — reasoned, auditable AI)
 *   FATF Rec 20              (continuous monitoring + escalation)
 *   NIST AI RMF 1.0 MEASURE-2 (quantitative AI risk measurement)
 *   NIST AI RMF 1.0 MEASURE-4 (test, evaluate, verify, validate)
 *   EU AI Act Art.15         (accuracy + robustness for high-risk AI)
 */

import type { EnsembleReport, EnsembleVote } from './brainConsensusEnsemble';
import type { TypologyReport } from './fatfTypologyMatcher';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CoverageBand = 'point' | 'narrow' | 'moderate' | 'wide' | 'critical';

export interface UncertaintyInterval {
  /** Kind discriminator — surfaced in UI + audit logs. */
  kind: 'variance_interval';
  /** The base point-estimate confidence the interval is centred on. */
  pointEstimate: number;
  /** Lower bound of the interval, clamped to [0, 1]. */
  lower: number;
  /** Upper bound of the interval, clamped to [0, 1]. */
  upper: number;
  /** upper - lower. */
  width: number;
  /** Sample stddev of the per-run implied confidences. */
  stddev: number;
  /** Number of runs contributing to the interval. */
  sampleSize: number;
  /** Ensemble agreement rate at the time of computation. */
  agreement: number;
  /** UI band derived from `width`. */
  coverage: CoverageBand;
  /** Plain-English summary for Asana + STR narrative. */
  summary: string;
  /** Regulatory citation anchor. */
  regulatory: string;
}

// ---------------------------------------------------------------------------
// Severity weighting
//
// Maps a typology-report severity band to a confidence anchor that
// the per-run implied confidence pulls towards. The weights are
// hand-picked from the FATF severity ladder and must stay
// monotonically non-decreasing. Tests pin the exact values so a
// silent drift bumps the suite.
// ---------------------------------------------------------------------------

const SEVERITY_ANCHOR: Record<TypologyReport['topSeverity'], number> = {
  none: 0.1,
  low: 0.35,
  medium: 0.55,
  high: 0.75,
  critical: 0.9,
};

const COVERAGE_THRESHOLDS: Array<{ upTo: number; band: CoverageBand }> = [
  { upTo: 0.02, band: 'point' },
  { upTo: 0.08, band: 'narrow' },
  { upTo: 0.2, band: 'moderate' },
  { upTo: 0.35, band: 'wide' },
  { upTo: 1.0, band: 'critical' },
];

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
 * Map a single ensemble vote to an implied confidence in [0, 1].
 * The severity anchor dominates; the match count is a tie-breaker
 * within ±0.05 of the anchor so two runs with the same severity
 * can still differ when one matched more typologies than the other.
 */
export function impliedConfidenceFromVote(vote: EnsembleVote): number {
  const anchor = SEVERITY_ANCHOR[vote.topSeverity] ?? 0;
  // matchCount is unbounded positive. We compress it with a small
  // saturating bonus so the contribution never dominates severity.
  const matchBonus = Math.min(0.05, 0.01 * Math.max(0, vote.matchCount));
  return clamp01(anchor + matchBonus);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

function stddev(values: readonly number[], mu: number): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += (v - mu) * (v - mu);
  return Math.sqrt(s / values.length);
}

function bandForWidth(width: number): CoverageBand {
  for (const t of COVERAGE_THRESHOLDS) {
    if (width <= t.upTo) return t.band;
  }
  return 'critical';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive a structured uncertainty interval from an ensemble report
 * and a base confidence. Pure function — no I/O, no state.
 *
 * Width formula:
 *   halfWidth = sqrt(stddev^2 + (disagreement * baseConfidence * 0.5)^2)
 *
 * Rationale:
 *   - stddev captures how much the implied confidence moves across
 *     runs (classical sensitivity analysis)
 *   - disagreement * baseConfidence * 0.5 captures *categorical*
 *     disagreement on the winning typology, scaled by the point
 *     estimate so a low-confidence case with high disagreement
 *     doesn't explode past [0, 1]
 *   - the L2 combine of the two keeps the width smooth even when
 *     one term is tiny
 */
export function deriveUncertaintyInterval(
  ensemble: EnsembleReport,
  baseConfidence: number
): UncertaintyInterval {
  const base = clamp01(baseConfidence);
  const votes = ensemble.votes ?? [];
  const sampleSize = votes.length;

  if (sampleSize === 0) {
    return {
      kind: 'variance_interval',
      pointEstimate: base,
      lower: base,
      upper: base,
      width: 0,
      stddev: 0,
      sampleSize: 0,
      agreement: typeof ensemble.agreement === 'number' ? ensemble.agreement : 1,
      coverage: 'point',
      summary:
        `No ensemble runs available — interval collapses to the point ` +
        `estimate ${base.toFixed(3)}. Treat as an uncalibrated signal.`,
      regulatory: 'NIST AI RMF 1.0 MEASURE-2; FATF Rec 20',
    };
  }

  const implied = votes.map(impliedConfidenceFromVote);
  const mu = mean(implied);
  const sd = stddev(implied, mu);

  const agreement = clamp01(ensemble.agreement);
  const disagreement = 1 - agreement;

  const disagreementTerm = disagreement * base * 0.5;
  const halfWidth = Math.sqrt(sd * sd + disagreementTerm * disagreementTerm);
  const lower = clamp01(base - halfWidth);
  const upper = clamp01(base + halfWidth);
  const width = upper - lower;
  const coverage = bandForWidth(width);

  const summary =
    `Confidence point estimate ${base.toFixed(3)} with variance interval ` +
    `[${lower.toFixed(3)}, ${upper.toFixed(3)}] (width ${width.toFixed(3)}, ` +
    `sd ${sd.toFixed(3)}, agreement ${agreement.toFixed(2)}, ` +
    `coverage=${coverage}). ` +
    `This is a perturbation-variance envelope, not a Bayesian credible ` +
    `interval — MLRO must not claim statistical coverage in an STR narrative.`;

  return {
    kind: 'variance_interval',
    pointEstimate: base,
    lower,
    upper,
    width,
    stddev: sd,
    sampleSize,
    agreement,
    coverage,
    summary,
    regulatory: 'NIST AI RMF 1.0 MEASURE-2; FATF Rec 20',
  };
}

// Exports for tests.
export const __test__ = {
  clamp01,
  mean,
  stddev,
  bandForWidth,
  SEVERITY_ANCHOR,
  COVERAGE_THRESHOLDS,
};
