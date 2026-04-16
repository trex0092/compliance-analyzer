/**
 * TM Statistical Layer — anomaly detection via Benford's Law
 * first-digit test, Z-score outlier detection, velocity burst
 * counting, and dormancy-break detection.
 *
 * Why this exists:
 *   The rule engine catches hard thresholds (AED 55K CTR, etc.).
 *   The typology matcher catches multi-tx patterns (smurfing,
 *   layering, etc.). This layer catches individual and aggregate
 *   statistical anomalies that don't map to any specific rule:
 *
 *     - Benford first-digit drift: the first-digit distribution
 *       of AED amounts across a customer's transaction window
 *       should follow Benford's Law. Deviation is a known money
 *       laundering indicator (fabricated invoices produce uniform
 *       digit distributions).
 *     - Z-score outlier: a single transaction whose AED amount is
 *       >3 standard deviations from the customer's historical mean
 *       is flagged.
 *     - Velocity burst: more than N transactions within a 24h
 *       window (default N=5 per VELOCITY_24H_COUNT_THRESHOLD).
 *     - Dormancy break: a customer that had zero transactions for
 *       >90 days suddenly transacts. Classic reactivation pattern.
 *
 * Pure. No I/O. Tests inject the transaction list directly.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.15     (suspicious transaction monitoring)
 *   FATF Rec 10, 20, 21       (ongoing CDD + STR)
 *   FATF Typologies Report 2021 — Gold & Precious Metals
 *   Cabinet Res 134/2025 Art.14 (EDD ongoing monitoring)
 */

import {
  VELOCITY_24H_COUNT_THRESHOLD,
  clusterByVelocity,
  type TmFinding,
  type Transaction,
} from '../domain/transaction';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

function makeFindingId(customerId: string, kind: string, txIds: readonly string[]): string {
  return `${customerId}:${kind}:${shortHash([...txIds].sort().join(','))}`;
}

// ---------------------------------------------------------------------------
// 1. Benford's Law first-digit test
// ---------------------------------------------------------------------------

/**
 * Benford expected probabilities for first digits 1-9.
 * P(d) = log10(1 + 1/d). Standard textbook formula.
 */
export const BENFORD_EXPECTED: readonly number[] = [
  0.301, // digit 1
  0.176, // digit 2
  0.125, // digit 3
  0.097, // digit 4
  0.079, // digit 5
  0.067, // digit 6
  0.058, // digit 7
  0.051, // digit 8
  0.046, // digit 9
];

/**
 * Compute the first-digit distribution of a list of positive
 * numbers. Returns an array of 9 frequencies (index 0 = digit 1,
 * index 8 = digit 9). Frequencies sum to 1.0 (or 0 if the input
 * is empty / all zeros).
 */
export function firstDigitDistribution(amounts: readonly number[]): readonly number[] {
  const counts = Array(9).fill(0) as number[];
  let total = 0;
  for (const raw of amounts) {
    const amt = Math.abs(raw);
    if (amt < 1) continue;
    const firstChar = String(Math.floor(amt))[0];
    if (!firstChar) continue;
    const d = parseInt(firstChar, 10);
    if (d >= 1 && d <= 9) {
      counts[d - 1]!++;
      total++;
    }
  }
  if (total === 0) return Array(9).fill(0);
  return counts.map((c) => c / total);
}

/**
 * Chi-squared statistic comparing an observed first-digit distribution
 * against the Benford expected distribution. Higher values indicate
 * greater deviation. A chi-sq > 15.51 (df=8, alpha=0.05) is
 * statistically significant — the distribution is NOT Benford.
 */
export function benfordChiSquared(observed: readonly number[], sampleSize: number): number {
  if (sampleSize === 0) return 0;
  let chiSq = 0;
  for (let i = 0; i < 9; i++) {
    const expected = BENFORD_EXPECTED[i]! * sampleSize;
    const obs = observed[i]! * sampleSize;
    if (expected > 0) {
      chiSq += (obs - expected) ** 2 / expected;
    }
  }
  return chiSq;
}

/** Critical value for chi-squared test, df=8, alpha=0.05. */
export const BENFORD_CHI_SQ_CRITICAL = 15.51;

function detectBenfordDrift(txs: readonly Transaction[]): TmFinding | null {
  const amounts = txs.map((t) => t.amountAed).filter((a) => a >= 1);
  if (amounts.length < 30) return null; // too few for statistical significance
  const dist = firstDigitDistribution(amounts);
  const chiSq = benfordChiSquared(dist, amounts.length);
  if (chiSq <= BENFORD_CHI_SQ_CRITICAL) return null;
  const customerId = txs[0]?.customerId ?? '';
  return {
    id: makeFindingId(
      customerId,
      'benford-first-digit-drift',
      txs.map((t) => t.id)
    ),
    customerId,
    kind: 'benford-first-digit-drift',
    severity: 'medium',
    message: `Benford first-digit drift: chi-squared = ${chiSq.toFixed(2)} (critical = ${BENFORD_CHI_SQ_CRITICAL}, df=8, alpha=0.05) across ${amounts.length} transactions. The amount distribution does not follow Benford's Law — investigate for fabricated invoices or structuring.`,
    regulatory: 'FATF Typologies Report 2021 / FDL Art.15',
    triggeringTxIds: txs.map((t) => t.id),
    confidence: Math.min(1, chiSq / (BENFORD_CHI_SQ_CRITICAL * 3)),
    suggestedAction: 'flag',
  };
}

// ---------------------------------------------------------------------------
// 2. Z-score outlier detection
// ---------------------------------------------------------------------------

function detectZscoreOutliers(txs: readonly Transaction[], threshold = 3): readonly TmFinding[] {
  if (txs.length < 10) return []; // too few for meaningful stats
  const amounts = txs.map((t) => t.amountAed);
  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const variance = amounts.reduce((a, v) => a + (v - mean) ** 2, 0) / amounts.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return []; // all amounts identical
  const out: TmFinding[] = [];
  for (const tx of txs) {
    const z = Math.abs((tx.amountAed - mean) / stdDev);
    if (z > threshold) {
      out.push({
        id: makeFindingId(tx.customerId, 'amount-zscore-outlier', [tx.id]),
        customerId: tx.customerId,
        kind: 'amount-zscore-outlier',
        severity: 'medium',
        message: `Amount outlier: AED ${tx.amountAed.toLocaleString('en-AE')} is ${z.toFixed(1)} standard deviations from the customer mean (AED ${Math.round(mean).toLocaleString('en-AE')}, stddev ${Math.round(stdDev).toLocaleString('en-AE')}).`,
        regulatory: 'FDL Art.15 / FATF Rec 20',
        triggeringTxIds: [tx.id],
        confidence: Math.min(1, z / 5),
        suggestedAction: 'flag',
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. Velocity burst detection
// ---------------------------------------------------------------------------

function detectVelocityBurst(
  txs: readonly Transaction[],
  threshold = VELOCITY_24H_COUNT_THRESHOLD
): readonly TmFinding[] {
  const clusters = clusterByVelocity(txs);
  const out: TmFinding[] = [];
  for (const cluster of clusters) {
    if (cluster.length >= threshold) {
      const customerId = txs[0]?.customerId ?? '';
      out.push({
        id: makeFindingId(customerId, 'velocity-burst', cluster),
        customerId,
        kind: 'velocity-burst',
        severity: 'high',
        message: `Velocity burst: ${cluster.length} transactions within a 24-hour window (threshold: ${threshold}). Investigate for automated or batch structuring.`,
        regulatory: 'FATF Rec 20 / FDL Art.15',
        triggeringTxIds: cluster,
        confidence: Math.min(1, cluster.length / (threshold * 2)),
        suggestedAction: 'escalate',
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. Dormancy break detection
// ---------------------------------------------------------------------------

function detectDormancyBreak(txs: readonly Transaction[], dormancyDays = 90): TmFinding | null {
  if (txs.length < 2) return null;
  const sorted = [...txs].sort((a, b) => Date.parse(a.atIso) - Date.parse(b.atIso));
  // Find the latest gap > dormancyDays between consecutive txs.
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  let maxGapDays = 0;
  let gapEndTx: Transaction | null = null;
  for (let i = 1; i < sorted.length; i++) {
    const gap = (Date.parse(sorted[i]!.atIso) - Date.parse(sorted[i - 1]!.atIso)) / MS_PER_DAY;
    if (gap > maxGapDays) {
      maxGapDays = gap;
      gapEndTx = sorted[i]!;
    }
  }
  if (maxGapDays < dormancyDays || !gapEndTx) return null;
  const customerId = txs[0]?.customerId ?? '';
  return {
    id: makeFindingId(customerId, 'dormancy-break', [gapEndTx.id]),
    customerId,
    kind: 'dormancy-break',
    severity: 'medium',
    message: `Dormancy break: ${Math.round(maxGapDays)}-day gap followed by transaction on ${gapEndTx.dateDdMmYyyy}. Account reactivation after extended inactivity is a typology red flag.`,
    regulatory: 'FATF Rec 20 / FDL Art.15',
    triggeringTxIds: [gapEndTx.id],
    confidence: Math.min(1, maxGapDays / (dormancyDays * 3)),
    suggestedAction: 'flag',
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface StatisticalLayerOptions {
  readonly zscoreThreshold?: number;
  readonly velocityThreshold?: number;
  readonly dormancyDays?: number;
}

/**
 * Run the full statistical layer over a single customer's
 * transaction window. Pure. Returns findings from all 4 detectors.
 */
export function runStatisticalLayer(
  transactions: readonly Transaction[],
  options: StatisticalLayerOptions = {}
): readonly TmFinding[] {
  const out: TmFinding[] = [];
  const benford = detectBenfordDrift(transactions);
  if (benford) out.push(benford);
  out.push(...detectZscoreOutliers(transactions, options.zscoreThreshold));
  out.push(...detectVelocityBurst(transactions, options.velocityThreshold));
  const dormancy = detectDormancyBreak(transactions, options.dormancyDays);
  if (dormancy) out.push(dormancy);
  return out;
}
