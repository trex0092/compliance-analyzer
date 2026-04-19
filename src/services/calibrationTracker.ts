/**
 * Calibration Tracker — reliability diagnostics for the deliberative
 * brain's posteriors. Answers the audit question: "Does the system's
 * 80% actually come true 80% of the time?"
 *
 * Keeps a rolling buffer of (predicted posterior, realised outcome)
 * pairs. From that buffer it computes:
 *
 *   - Brier score       — mean squared error on probabilistic predictions,
 *                         in [0, 1], lower is better. 0.25 is the base rate.
 *   - ECE               — Expected Calibration Error across 10 equal-width
 *                         bins; measures "when I say 70% am I right 70% of
 *                         the time?".
 *   - reliability curve — per-bin (avgPredicted, observedFrequency, n) so
 *                         the auditor can render a classic calibration plot.
 *
 * The tracker is deliberately DEPENDENCY-FREE. It takes data in, reports
 * diagnostics out. Storage and persistence are the caller's concern —
 * typically the Netlify function that owns the blob-store CAS envelope.
 *
 * Pure computation; no I/O, deterministic given the same observation
 * sequence.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20      CO must know when to trust the model
 *   FATF Rec 1                 risk-based approach — quantify residual risk
 *   EU AI Act Art.15           accuracy / robustness / cyber of high-risk AI
 *   NIST AI RMF Measure 2.4    accuracy / reliability metrics
 *   NIST AI RMF Govern 4.1     trust calibration
 *   ISO/IEC 42001 § 6.1.3      AI decision auditability
 */

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface CalibrationObservation {
  /** Posterior probability produced by the brain at decision time, in [0, 1]. */
  predicted: number;
  /** Realised outcome: true = confirmed true match, false = false positive. */
  outcome: boolean;
  /** Optional ISO timestamp — retained for drift analysis upstream. */
  observedAtIso?: string;
}

export interface CalibrationBin {
  /** Left edge of the bin (inclusive), in [0, 1]. */
  lowerBound: number;
  /** Right edge of the bin (exclusive), in [0, 1]. */
  upperBound: number;
  /** Number of observations in the bin. */
  count: number;
  /** Mean predicted probability in the bin. */
  avgPredicted: number;
  /** Observed frequency of positive outcome in the bin, in [0, 1]. */
  observedFrequency: number;
  /** Absolute calibration error on this bin. */
  gap: number;
}

export interface CalibrationReport {
  /** Total observations across all bins. */
  sampleSize: number;
  /** Brier score in [0, 1], lower is better. */
  brier: number;
  /** Expected Calibration Error in [0, 1], lower is better. */
  ece: number;
  /** Maximum per-bin gap in [0, 1]. */
  maxBinGap: number;
  /** 10 equal-width bins sorted ascending. */
  bins: readonly CalibrationBin[];
  /** Qualitative band. */
  band: 'WELL_CALIBRATED' | 'ACCEPTABLE' | 'MISCALIBRATED' | 'INSUFFICIENT_DATA';
  /** Plain-text summary for the Asana trace. */
  summary: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const BIN_COUNT = 10;

/**
 * Produce a calibration report from a sequence of observations. The
 * buffer is NOT mutated.
 */
export function evaluateCalibration(
  observations: readonly CalibrationObservation[]
): CalibrationReport {
  const n = observations.length;
  if (n === 0) {
    return {
      sampleSize: 0,
      brier: 0,
      ece: 0,
      maxBinGap: 0,
      bins: [],
      band: 'INSUFFICIENT_DATA',
      summary: 'No calibration observations recorded yet',
    };
  }

  let squaredErrorSum = 0;
  const bins: CalibrationBin[] = [];
  for (let i = 0; i < BIN_COUNT; i += 1) {
    bins.push({
      lowerBound: i / BIN_COUNT,
      upperBound: (i + 1) / BIN_COUNT,
      count: 0,
      avgPredicted: 0,
      observedFrequency: 0,
      gap: 0,
    });
  }

  // Accumulate into mutable bins; we'll freeze to readonly after.
  const mutable = bins.map((b) => ({
    ...b,
    sumPredicted: 0,
    sumOutcome: 0,
  }));

  for (const o of observations) {
    const p = Math.max(0, Math.min(1, o.predicted));
    const y = o.outcome ? 1 : 0;
    squaredErrorSum += (p - y) * (p - y);
    const idx = p === 1 ? BIN_COUNT - 1 : Math.min(BIN_COUNT - 1, Math.floor(p * BIN_COUNT));
    const bin = mutable[idx];
    bin.count += 1;
    bin.sumPredicted += p;
    bin.sumOutcome += y;
  }

  let eceSum = 0;
  let maxGap = 0;
  const normalisedBins: CalibrationBin[] = mutable.map((b) => {
    const avgPredicted = b.count > 0 ? b.sumPredicted / b.count : 0;
    const observedFrequency = b.count > 0 ? b.sumOutcome / b.count : 0;
    const gap = Math.abs(avgPredicted - observedFrequency);
    eceSum += (b.count / n) * gap;
    if (gap > maxGap && b.count > 0) maxGap = gap;
    return {
      lowerBound: b.lowerBound,
      upperBound: b.upperBound,
      count: b.count,
      avgPredicted,
      observedFrequency,
      gap,
    };
  });

  const brier = squaredErrorSum / n;
  const ece = eceSum;

  let band: CalibrationReport['band'];
  if (n < 30) band = 'INSUFFICIENT_DATA';
  else if (ece <= 0.05 && brier <= 0.15) band = 'WELL_CALIBRATED';
  else if (ece <= 0.1 && brier <= 0.22) band = 'ACCEPTABLE';
  else band = 'MISCALIBRATED';

  const summary =
    band === 'INSUFFICIENT_DATA'
      ? `n=${n} — need at least 30 observations before calibration can be asserted`
      : `n=${n} Brier=${brier.toFixed(3)} ECE=${(ece * 100).toFixed(1)}% maxBinGap=${(maxGap * 100).toFixed(1)}% — ${band}`;

  return {
    sampleSize: n,
    brier,
    ece,
    maxBinGap: maxGap,
    bins: normalisedBins,
    band,
    summary,
  };
}

/**
 * Rolling in-memory buffer — convenience for callers that don't have a
 * persistent store wired. The dispatcher can feed this directly and
 * read the report without plumbing a blob store.
 */
export class CalibrationBuffer {
  private readonly cap: number;
  private readonly buf: CalibrationObservation[] = [];

  constructor(cap = 1000) {
    this.cap = Math.max(1, cap);
  }

  record(observation: CalibrationObservation): void {
    this.buf.push(observation);
    if (this.buf.length > this.cap) {
      this.buf.splice(0, this.buf.length - this.cap);
    }
  }

  snapshot(): readonly CalibrationObservation[] {
    return this.buf.slice();
  }

  evaluate(): CalibrationReport {
    return evaluateCalibration(this.buf);
  }

  size(): number {
    return this.buf.length;
  }

  clear(): void {
    this.buf.length = 0;
  }
}
