/**
 * Conformal Prediction Wrapper — distribution-free prediction
 * intervals for the brain confidence with a calibrated coverage
 * guarantee.
 *
 * Why this exists:
 *   uncertaintyInterval.ts already produces a variance-style
 *   envelope on the confidence point estimate, but it explicitly
 *   refuses to claim statistical coverage. Inspectors who care
 *   about EU AI Act Art.15 "appropriate level of accuracy" or
 *   NIST AI RMF 1.0 MEASURE-2/4 want a defensible coverage
 *   guarantee — "this interval traps the true label with at
 *   least 90% probability under the exchangeability assumption".
 *
 *   Conformal prediction gives exactly that guarantee without
 *   distributional assumptions on the brain. We use the simplest
 *   inductive (split) variant:
 *     1. Split historical telemetry into a calibration set.
 *     2. For each calibration entry, compute a non-conformity
 *        score |true_label - predicted_confidence|. Since we do
 *        not have ground-truth labels we use the implied label
 *        (1 if verdict in {flag,escalate,freeze}, else 0).
 *     3. The (1 - alpha) quantile of the calibration scores is
 *        the conformal threshold q_hat.
 *     4. New prediction interval = [confidence - q_hat,
 *                                   confidence + q_hat],
 *        clamped to [0, 1].
 *
 *   With finite-sample correction for split conformal:
 *     k = ceil((n + 1) * (1 - alpha))
 *     q_hat = sorted_scores[k - 1]
 *
 *   Pure function. Same input -> same interval. Deterministic.
 *
 * Calibration disclaimer (kept narrower than the variance one):
 *   The coverage guarantee only holds if the calibration set is
 *   exchangeable with the new case. We label the interval kind
 *   `conformal_split` so downstream consumers know the guarantee
 *   class.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO reasoned, defensible AI)
 *   FATF Rec 20              (continuous monitoring)
 *   NIST AI RMF 1.0 MEASURE-2 (quantitative AI risk measurement)
 *   NIST AI RMF 1.0 MEASURE-4 (test, evaluate, verify, validate)
 *   EU AI Act Art.15         (accuracy + robustness for high-risk AI)
 */

import type { BrainTelemetryEntry } from './brainTelemetryStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConformalCoverage = 'exact' | 'narrow' | 'moderate' | 'wide' | 'critical';

export interface ConformalInterval {
  /** Kind discriminator. */
  kind: 'conformal_split';
  /** Target miscoverage rate alpha (e.g. 0.1 = 90% coverage). */
  alpha: number;
  /** Calibration set size used to derive q_hat. */
  calibrationSize: number;
  /** Threshold q_hat from the (1 - alpha) quantile. */
  qHat: number;
  /** Centre of the interval — the brain's point-estimate confidence. */
  pointEstimate: number;
  /** Lower bound, clamped to [0, 1]. */
  lower: number;
  /** Upper bound, clamped to [0, 1]. */
  upper: number;
  /** upper - lower. */
  width: number;
  /** UI band derived from `width`. */
  coverage: ConformalCoverage;
  /** Plain-English summary safe for STR narrative + Asana. */
  summary: string;
  /** Regulatory anchor. */
  regulatory: string;
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
 * Map a telemetry entry to (confidence, impliedLabel) so we can
 * compute a non-conformity score against it. The implied label
 * follows the same convention as the brain's verdict:
 *   1 if verdict in { flag, escalate, freeze }
 *   0 if verdict === 'pass'
 */
function impliedLabel(entry: BrainTelemetryEntry): 0 | 1 {
  return entry.verdict === 'pass' ? 0 : 1;
}

function nonConformityScore(entry: BrainTelemetryEntry): number {
  const label = impliedLabel(entry);
  return Math.abs(label - clamp01(entry.confidence));
}

const COVERAGE_THRESHOLDS: Array<{ upTo: number; band: ConformalCoverage }> = [
  { upTo: 0.02, band: 'exact' },
  { upTo: 0.08, band: 'narrow' },
  { upTo: 0.2, band: 'moderate' },
  { upTo: 0.35, band: 'wide' },
  { upTo: 1.0, band: 'critical' },
];

function bandForWidth(width: number): ConformalCoverage {
  for (const t of COVERAGE_THRESHOLDS) {
    if (width <= t.upTo) return t.band;
  }
  return 'critical';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ConformalOptions {
  /** Target miscoverage rate. Default 0.1 (i.e. 90% coverage). */
  alpha?: number;
}

const DEFAULT_ALPHA = 0.1;
const MIN_CALIBRATION = 20;

/**
 * Compute a split-conformal prediction interval on a new brain
 * confidence using a calibration set of historical telemetry
 * entries.
 *
 * Returns a degenerate point interval when calibrationSize <
 * MIN_CALIBRATION (defaults to 20). MLROs MUST treat the result
 * as uncalibrated until the calibration set grows.
 */
export function conformalIntervalForConfidence(
  pointEstimate: number,
  calibration: readonly BrainTelemetryEntry[],
  opts: ConformalOptions = {}
): ConformalInterval {
  const alpha = typeof opts.alpha === 'number' ? clamp01(opts.alpha) : DEFAULT_ALPHA;
  const point = clamp01(pointEstimate);
  const n = calibration.length;

  if (n < MIN_CALIBRATION) {
    return {
      kind: 'conformal_split',
      alpha,
      calibrationSize: n,
      qHat: 0,
      pointEstimate: point,
      lower: point,
      upper: point,
      width: 0,
      coverage: 'exact',
      summary:
        `Insufficient calibration set (n=${n} < ${MIN_CALIBRATION}). ` +
        `Conformal interval collapses to the point estimate ` +
        `${point.toFixed(3)}. Treat as uncalibrated until the brain ` +
        `accumulates more telemetry.`,
      regulatory: 'NIST AI RMF 1.0 MEASURE-2; FATF Rec 20',
    };
  }

  // Compute non-conformity scores + sort ascending.
  const scores = calibration.map(nonConformityScore).sort((a, b) => a - b);

  // Split-conformal finite-sample correction:
  // k = ceil((n + 1) * (1 - alpha)).
  const k = Math.ceil((n + 1) * (1 - alpha));
  // Clamp so we never index past the end.
  const idx = Math.min(scores.length - 1, Math.max(0, k - 1));
  const qHat = scores[idx]!;

  const lower = clamp01(point - qHat);
  const upper = clamp01(point + qHat);
  const width = upper - lower;
  const coverage = bandForWidth(width);

  const summary =
    `Conformal split interval [${lower.toFixed(3)}, ${upper.toFixed(3)}] ` +
    `centred on ${point.toFixed(3)} with target coverage ${((1 - alpha) * 100).toFixed(0)}% ` +
    `(n=${n}, q_hat=${qHat.toFixed(3)}, coverage=${coverage}). ` +
    `Guarantee holds under the exchangeability assumption between the ` +
    `calibration set and the new case.`;

  return {
    kind: 'conformal_split',
    alpha,
    calibrationSize: n,
    qHat,
    pointEstimate: point,
    lower,
    upper,
    width,
    coverage,
    summary,
    regulatory: 'NIST AI RMF 1.0 MEASURE-2; EU AI Act Art.15; FATF Rec 20',
  };
}

// Exports for tests.
export const __test__ = {
  clamp01,
  impliedLabel,
  nonConformityScore,
  bandForWidth,
  DEFAULT_ALPHA,
  MIN_CALIBRATION,
};
