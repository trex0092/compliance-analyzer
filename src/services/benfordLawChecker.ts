/**
 * Benford's Law Checker — subsystem #41.
 *
 * Natural-origin transaction data follows Benford's law: the leading
 * digit is 1 in ~30.1% of cases, 2 in ~17.6%, etc. Fabricated or
 * manually-constructed transaction records (cash-books, shell-company
 * ledgers, invented invoices) usually deviate significantly. A chi-square
 * test against the expected distribution gives a fast, cheap,
 * explainable fraud indicator.
 *
 * Pure-function, no deps. Needs at least 50 data points to be
 * statistically meaningful — below that, returns insufficient_data.
 *
 * Regulatory basis:
 *   - FATF Rec 11 (record-keeping integrity)
 *   - MoE Circular 08/AML/2021 (transaction monitoring)
 *   - FDL No.10/2025 Art.26-27 (STR on suspicious patterns)
 */

// ---------------------------------------------------------------------------
// Benford expected distribution
// ---------------------------------------------------------------------------

const EXPECTED: readonly number[] = [
  0, // index 0 unused
  0.30103, // 1
  0.17609, // 2
  0.12494, // 3
  0.09691, // 4
  0.07918, // 5
  0.06695, // 6
  0.05799, // 7
  0.05115, // 8
  0.04576, // 9
];

// Critical chi-square value for 8 degrees of freedom at p=0.05 = 15.507
const CHI_SQUARE_CRITICAL = 15.507;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenfordReport {
  status: 'ok' | 'suspicious' | 'insufficient_data';
  sampleSize: number;
  observed: readonly number[];
  expected: readonly number[];
  chiSquare: number;
  criticalValue: number;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

export function checkBenfordLaw(amounts: readonly number[]): BenfordReport {
  // Valid values: non-zero, positive, extract first significant digit.
  const firstDigits: number[] = [];
  for (const a of amounts) {
    if (!Number.isFinite(a)) continue;
    const abs = Math.abs(a);
    if (abs <= 0) continue;
    // Skip leading zeros until we hit the first non-zero digit.
    let n = abs;
    while (n >= 10) n = n / 10;
    while (n > 0 && n < 1) n = n * 10;
    const digit = Math.floor(n);
    if (digit >= 1 && digit <= 9) firstDigits.push(digit);
  }

  const sampleSize = firstDigits.length;
  if (sampleSize < 50) {
    return {
      status: 'insufficient_data',
      sampleSize,
      observed: new Array(10).fill(0),
      expected: EXPECTED,
      chiSquare: 0,
      criticalValue: CHI_SQUARE_CRITICAL,
      narrative: `Benford's law: ${sampleSize} data points — need at least 50 for a meaningful result.`,
    };
  }

  // Count observed frequencies
  const counts = new Array(10).fill(0);
  for (const d of firstDigits) counts[d] += 1;
  const observed = counts.map((c) => c / sampleSize);

  // Chi-square statistic
  let chi = 0;
  for (let d = 1; d <= 9; d++) {
    const expectedCount = EXPECTED[d] * sampleSize;
    if (expectedCount <= 0) continue;
    const observedCount = counts[d];
    const diff = observedCount - expectedCount;
    chi += (diff * diff) / expectedCount;
  }

  const suspicious = chi > CHI_SQUARE_CRITICAL;
  const narrative = suspicious
    ? `Benford's law: CHI^2=${chi.toFixed(2)} > critical ${CHI_SQUARE_CRITICAL} at p=0.05. ` +
      `Distribution deviates from Benford's law — possible fabricated / manipulated data. ` +
      `Sample size ${sampleSize}.`
    : `Benford's law: CHI^2=${chi.toFixed(2)} <= critical ${CHI_SQUARE_CRITICAL}. ` +
      `Distribution within expected Benford range. Sample size ${sampleSize}.`;

  return {
    status: suspicious ? 'suspicious' : 'ok',
    sampleSize,
    observed,
    expected: EXPECTED,
    chiSquare: Math.round(chi * 100) / 100,
    criticalValue: CHI_SQUARE_CRITICAL,
    narrative,
  };
}
