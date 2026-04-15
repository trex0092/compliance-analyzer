/**
 * Calibration Scorer — computes reliability-diagram statistics on
 * the brain's reported confidence vs empirical success rate.
 *
 * Why this exists:
 *   `confidenceCalibrator.ts` implements Platt-style calibration
 *   (it RESHAPES confidence values). This module is complementary:
 *   it MEASURES calibration quality. The two work together — the
 *   scorer identifies miscalibration and recommends re-fitting
 *   via the calibrator.
 *
 *   Takes a list of (reportedConfidence, actualCorrect) pairs and
 *   produces:
 *     - Reliability diagram (bucketed calibration curve)
 *     - Expected Calibration Error (ECE)
 *     - Maximum Calibration Error (MCE)
 *     - Brier score
 *
 *   Pure function. No I/O.
 *
 * Regulatory basis:
 *   EU AI Act Art.15         (accuracy + robustness)
 *   NIST AI RMF 1.0 MEASURE-2 (quantitative measurement)
 *   NIST AI RMF 1.0 MEASURE-4 (continuous validation)
 *   FDL No.10/2025 Art.20-22 (CO defensible confidence)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalibrationSample {
  reportedConfidence: number;
  actualCorrect: boolean;
}

export interface ReliabilityBucket {
  binLower: number;
  binUpper: number;
  midpoint: number;
  sampleCount: number;
  avgConfidence: number;
  empiricalAccuracy: number;
  /** accuracy - confidence. Negative = overconfident. */
  gap: number;
}

export interface CalibrationReport {
  schemaVersion: 1;
  sampleCount: number;
  ece: number;
  mce: number;
  brierScore: number;
  severity: 'well_calibrated' | 'acceptable' | 'poorly_calibrated' | 'insufficient_data';
  buckets: readonly ReliabilityBucket[];
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_BIN_COUNT = 10;
export const MIN_SAMPLE_SIZE = 100;
const ECE_WELL_CALIBRATED = 0.05;
const ECE_ACCEPTABLE = 0.1;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function scoreCalibration(
  samples: readonly CalibrationSample[],
  binCount: number = DEFAULT_BIN_COUNT
): CalibrationReport {
  if (samples.length < MIN_SAMPLE_SIZE) {
    return {
      schemaVersion: 1,
      sampleCount: samples.length,
      ece: 0,
      mce: 0,
      brierScore: 0,
      severity: 'insufficient_data',
      buckets: [],
      summary:
        `Insufficient samples for calibration (n=${samples.length} < ${MIN_SAMPLE_SIZE}). ` +
        `Continue collecting MLRO confirmations before scoring.`,
      regulatory: ['EU AI Act Art.15', 'NIST AI RMF 1.0 MEASURE-2'],
    };
  }

  const buckets: ReliabilityBucket[] = [];
  for (let i = 0; i < binCount; i++) {
    const lower = i / binCount;
    const upper = (i + 1) / binCount;
    buckets.push({
      binLower: lower,
      binUpper: upper,
      midpoint: (lower + upper) / 2,
      sampleCount: 0,
      avgConfidence: 0,
      empiricalAccuracy: 0,
      gap: 0,
    });
  }

  const bucketData: { confSum: number; correctCount: number; count: number }[] = buckets.map(
    () => ({ confSum: 0, correctCount: 0, count: 0 })
  );

  for (const s of samples) {
    if (!Number.isFinite(s.reportedConfidence)) continue;
    const clamped = Math.min(0.9999, Math.max(0, s.reportedConfidence));
    const idx = Math.min(binCount - 1, Math.floor(clamped * binCount));
    const d = bucketData[idx]!;
    d.confSum += clamped;
    d.correctCount += s.actualCorrect ? 1 : 0;
    d.count += 1;
  }

  let ece = 0;
  let mce = 0;
  const total = samples.length;
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i]!;
    const d = bucketData[i]!;
    b.sampleCount = d.count;
    b.avgConfidence = d.count > 0 ? d.confSum / d.count : b.midpoint;
    b.empiricalAccuracy = d.count > 0 ? d.correctCount / d.count : 0;
    b.gap = b.empiricalAccuracy - b.avgConfidence;
    if (d.count > 0) {
      const weight = d.count / total;
      ece += weight * Math.abs(b.gap);
      if (Math.abs(b.gap) > mce) mce = Math.abs(b.gap);
    }
  }

  let brierSum = 0;
  for (const s of samples) {
    const p = Math.min(1, Math.max(0, s.reportedConfidence));
    const actual = s.actualCorrect ? 1 : 0;
    brierSum += (p - actual) * (p - actual);
  }
  const brierScore = brierSum / total;

  let severity: CalibrationReport['severity'];
  if (ece <= ECE_WELL_CALIBRATED) severity = 'well_calibrated';
  else if (ece <= ECE_ACCEPTABLE) severity = 'acceptable';
  else severity = 'poorly_calibrated';

  return {
    schemaVersion: 1,
    sampleCount: total,
    ece,
    mce,
    brierScore,
    severity,
    buckets,
    summary:
      severity === 'well_calibrated'
        ? `Well calibrated — ECE ${ece.toFixed(3)}, Brier ${brierScore.toFixed(3)} across ${total} samples.`
        : severity === 'acceptable'
          ? `Acceptably calibrated — ECE ${ece.toFixed(3)}. Monitor.`
          : `Poorly calibrated — ECE ${ece.toFixed(3)} > ${ECE_ACCEPTABLE}. Re-fit via confidenceCalibrator.ts.`,
    regulatory: [
      'EU AI Act Art.15',
      'NIST AI RMF 1.0 MEASURE-2',
      'NIST AI RMF 1.0 MEASURE-4',
      'FDL No.10/2025 Art.20-22',
    ],
  };
}

// Exports for tests.
export const __test__ = { ECE_WELL_CALIBRATED, ECE_ACCEPTABLE };
