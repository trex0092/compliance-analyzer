/**
 * Brain Self-Monitor — verdict distribution drift detector.
 *
 * Why this exists:
 *   The brain produces a verdict distribution (counts of pass / flag /
 *   escalate / freeze) every day. If today's distribution looks
 *   materially different from yesterday's, *something* changed:
 *     - upstream feature data drifted
 *     - a constant moved (regulatory or accidental)
 *     - a new typology pattern hit the population
 *     - silent feed corruption
 *
 *   Today nobody watches this. Operators discover drift only when a
 *   downstream counter (Asana queue depth, freeze-section backlog)
 *   ticks. By then the brain has been mis-firing for hours or days.
 *
 *   This module is the first watcher. It compares two
 *   `VerdictDistribution` snapshots using a Kolmogorov-Smirnov style
 *   test on the cumulative distribution and flags significant
 *   divergence. It is PURE — no I/O. The cron wrapper provides the
 *   yesterday/today snapshots from the existing brainTelemetryStore.
 *
 * Algorithm:
 *   1. Convert each snapshot to a probability vector over the four
 *      verdicts.
 *   2. Compute the cumulative distribution (CDF) for each.
 *   3. KS statistic = max(|CDF_a[i] - CDF_b[i]|) over the four
 *      verdict positions.
 *   4. Flag DRIFT if KS > threshold (default 0.15) AND both
 *      snapshots have ≥ MIN_SAMPLES (default 30 each).
 *
 *   Below MIN_SAMPLES the test is statistically meaningless and we
 *   return `insufficient_data` rather than a false positive.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO continuous monitoring)
 *   FDL No.10/2025 Art.24    (audit trail of detected drift)
 *   Cabinet Res 134/2025 Art.19 (internal review)
 *   FATF Rec 1               (continuous risk assessment)
 *   FATF Rec 20              (ongoing monitoring)
 *   NIST AI RMF 1.0 MEASURE-4 (validation + drift detection)
 *   NIST AI RMF 1.0 MANAGE-3 (incident response on AI degradation)
 *   EU AI Act Art.15         (accuracy + robustness)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Verdict = 'pass' | 'flag' | 'escalate' | 'freeze';

export interface VerdictDistribution {
  pass: number;
  flag: number;
  escalate: number;
  freeze: number;
}

export type DriftStatus =
  | 'stable'
  | 'drift_detected'
  | 'insufficient_data';

export type DriftSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface SelfMonitorReport {
  schemaVersion: 1;
  status: DriftStatus;
  /** Kolmogorov-Smirnov statistic in [0, 1]. */
  ksStatistic: number;
  /** Threshold used for the test. */
  ksThreshold: number;
  /** Severity band derived from the KS statistic. */
  severity: DriftSeverity;
  /** Sample size of the baseline snapshot. */
  baselineSampleSize: number;
  /** Sample size of the current snapshot. */
  currentSampleSize: number;
  /** Per-verdict deltas (current - baseline, as fractions). */
  perVerdictDelta: Record<Verdict, number>;
  /** Plain-English finding safe for the daily digest. */
  finding: string;
  /** Regulatory anchors. */
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_KS_THRESHOLD = 0.15;
export const MIN_SAMPLES = 30;
const VERDICT_ORDER: readonly Verdict[] = ['pass', 'flag', 'escalate', 'freeze'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function totalCount(d: VerdictDistribution): number {
  return d.pass + d.flag + d.escalate + d.freeze;
}

function asProbabilities(d: VerdictDistribution): Record<Verdict, number> {
  const total = totalCount(d);
  if (total === 0) {
    return { pass: 0, flag: 0, escalate: 0, freeze: 0 };
  }
  return {
    pass: d.pass / total,
    flag: d.flag / total,
    escalate: d.escalate / total,
    freeze: d.freeze / total,
  };
}

function asCdf(p: Record<Verdict, number>): Record<Verdict, number> {
  let acc = 0;
  const out: Record<Verdict, number> = { pass: 0, flag: 0, escalate: 0, freeze: 0 };
  for (const v of VERDICT_ORDER) {
    acc += p[v];
    out[v] = acc;
  }
  return out;
}

export function ksDistance(
  a: VerdictDistribution,
  b: VerdictDistribution
): number {
  const cdfA = asCdf(asProbabilities(a));
  const cdfB = asCdf(asProbabilities(b));
  let maxDiff = 0;
  for (const v of VERDICT_ORDER) {
    const diff = Math.abs(cdfA[v] - cdfB[v]);
    if (diff > maxDiff) maxDiff = diff;
  }
  return maxDiff;
}

function severityForKs(ks: number): DriftSeverity {
  if (ks >= 0.4) return 'critical';
  if (ks >= 0.3) return 'high';
  if (ks >= 0.2) return 'medium';
  if (ks >= 0.1) return 'low';
  return 'none';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SelfMonitorOptions {
  /** Override the KS drift threshold. Default 0.15. */
  ksThreshold?: number;
  /** Override the minimum sample size required. Default 30. */
  minSamples?: number;
}

/**
 * Compare two verdict distributions and produce a drift report.
 * Pure function. Same input → same output.
 */
export function detectVerdictDrift(
  baseline: VerdictDistribution,
  current: VerdictDistribution,
  opts: SelfMonitorOptions = {}
): SelfMonitorReport {
  const ksThreshold = opts.ksThreshold ?? DEFAULT_KS_THRESHOLD;
  const minSamples = opts.minSamples ?? MIN_SAMPLES;
  const baselineN = totalCount(baseline);
  const currentN = totalCount(current);
  const ksStatistic = ksDistance(baseline, current);

  const baseProbs = asProbabilities(baseline);
  const curProbs = asProbabilities(current);
  const perVerdictDelta: Record<Verdict, number> = {
    pass: curProbs.pass - baseProbs.pass,
    flag: curProbs.flag - baseProbs.flag,
    escalate: curProbs.escalate - baseProbs.escalate,
    freeze: curProbs.freeze - baseProbs.freeze,
  };

  if (baselineN < minSamples || currentN < minSamples) {
    return {
      schemaVersion: 1,
      status: 'insufficient_data',
      ksStatistic,
      ksThreshold,
      severity: 'none',
      baselineSampleSize: baselineN,
      currentSampleSize: currentN,
      perVerdictDelta,
      finding:
        `Insufficient sample size for drift test ` +
        `(baseline=${baselineN}, current=${currentN}, min=${minSamples}). ` +
        `KS statistic ${ksStatistic.toFixed(3)} reported but not actionable.`,
      regulatory: [
        'FDL No.10/2025 Art.20-22',
        'NIST AI RMF 1.0 MEASURE-4',
      ],
    };
  }

  const status: DriftStatus = ksStatistic > ksThreshold ? 'drift_detected' : 'stable';
  const severity = severityForKs(ksStatistic);

  let finding: string;
  if (status === 'stable') {
    finding =
      `Verdict distribution stable. KS statistic ${ksStatistic.toFixed(3)} ` +
      `(threshold ${ksThreshold.toFixed(2)}). Baseline n=${baselineN}, current n=${currentN}.`;
  } else {
    const topShift = Object.entries(perVerdictDelta).sort(
      (a, b) => Math.abs(b[1]) - Math.abs(a[1])
    )[0]!;
    finding =
      `DRIFT DETECTED. KS statistic ${ksStatistic.toFixed(3)} > threshold ${ksThreshold.toFixed(2)}. ` +
      `Largest shift: "${topShift[0]}" by ${(topShift[1] * 100).toFixed(1)}%. ` +
      `Severity ${severity}. Investigate upstream feature data, recent constants ` +
      `changes, and population shift before the next freeze cycle.`;
  }

  return {
    schemaVersion: 1,
    status,
    ksStatistic,
    ksThreshold,
    severity,
    baselineSampleSize: baselineN,
    currentSampleSize: currentN,
    perVerdictDelta,
    finding,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'FDL No.10/2025 Art.24',
      'Cabinet Res 134/2025 Art.19',
      'FATF Rec 1',
      'FATF Rec 20',
      'NIST AI RMF 1.0 MEASURE-4',
      'NIST AI RMF 1.0 MANAGE-3',
      'EU AI Act Art.15',
    ],
  };
}

// Exports for tests.
export const __test__ = {
  totalCount,
  asProbabilities,
  asCdf,
  severityForKs,
};
