/**
 * Benford's Law Analyzer.
 *
 * Benford's Law states that in many real-world numerical datasets the
 * leading digit distribution follows:
 *
 *    P(d) = log10(1 + 1/d)   for d ∈ {1..9}
 *
 * i.e. 1 is the leading digit ~30.1% of the time, 2 is ~17.6%, …, 9 is ~4.6%.
 *
 * Real DPMS transaction streams obey Benford very closely over long
 * windows. Synthesised, cherry-picked, or rounded-to-threshold streams
 * do not. This module computes:
 *
 *   1. The observed leading-digit distribution.
 *   2. The chi-square goodness-of-fit against the Benford expectation.
 *   3. The Mean Absolute Deviation (MAD) per Nigrini 2012.
 *   4. A verdict: close-conformity / acceptable / marginal / non-conformity.
 *   5. Per-digit excess so the MLRO can point at the suspicious digit.
 *
 * Used by: megaBrain (as an evidence node for transaction integrity),
 * transactionAnomaly fusion.
 *
 * Regulatory basis:
 *   - FATF Rec 10 (CDD + ongoing monitoring)
 *   - FATF DPMS Typologies 2022 (annex A: ledger tampering)
 *   - Nigrini 2012 "Benford's Law: Applications for Forensic Accounting"
 */

// ---------------------------------------------------------------------------
// Expected Benford frequencies for leading digits 1..9.
// ---------------------------------------------------------------------------

export const BENFORD_EXPECTED: Record<number, number> = {
  1: Math.log10(2),
  2: Math.log10(3 / 2),
  3: Math.log10(4 / 3),
  4: Math.log10(5 / 4),
  5: Math.log10(6 / 5),
  6: Math.log10(7 / 6),
  7: Math.log10(8 / 7),
  8: Math.log10(9 / 8),
  9: Math.log10(10 / 9),
};

// Critical values for chi-square at 8 degrees of freedom.
// alpha = 0.10 → 13.362, 0.05 → 15.507, 0.01 → 20.090.
const CHI_SQ_CRITICAL_95 = 15.507;

// Nigrini (2012) MAD conformity thresholds.
const MAD_CLOSE = 0.006;
const MAD_ACCEPTABLE = 0.012;
const MAD_MARGINAL = 0.015;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenfordReport {
  sampleSize: number;
  observed: Record<number, number>; // counts
  observedFrequency: Record<number, number>; // proportions
  expectedFrequency: Record<number, number>; // Benford
  chiSquare: number;
  chiSquareCritical95: number;
  meanAbsoluteDeviation: number;
  verdict: 'close-conformity' | 'acceptable' | 'marginal' | 'non-conformity';
  suspiciousDigits: Array<{ digit: number; excessPct: number; direction: 'over' | 'under' }>;
  interpretation: string;
}

// ---------------------------------------------------------------------------
// Analyzer
// ---------------------------------------------------------------------------

function leadingDigit(x: number): number | null {
  if (!Number.isFinite(x) || x === 0) return null;
  const abs = Math.abs(x);
  // Scale to a number in [1, 10).
  const s = String(abs).replace(/^0+\./, '').replace('.', '').replace(/^0+/, '');
  const first = s.charAt(0);
  const n = Number(first);
  if (n >= 1 && n <= 9) return n;
  return null;
}

export function analyseBenford(values: readonly number[]): BenfordReport {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
  let total = 0;
  for (const v of values) {
    const d = leadingDigit(v);
    if (d === null) continue;
    counts[d]++;
    total++;
  }

  const observedFrequency: Record<number, number> = {};
  for (let d = 1; d <= 9; d++) {
    observedFrequency[d] = total === 0 ? 0 : counts[d] / total;
  }

  // Chi-square = Σ (O_i - E_i)^2 / E_i where O_i and E_i are EXPECTED counts.
  let chiSquare = 0;
  let madSum = 0;
  for (let d = 1; d <= 9; d++) {
    const expectedCount = total * BENFORD_EXPECTED[d];
    if (expectedCount > 0) {
      chiSquare += (counts[d] - expectedCount) ** 2 / expectedCount;
    }
    madSum += Math.abs(observedFrequency[d] - BENFORD_EXPECTED[d]);
  }
  const mad = madSum / 9;

  let verdict: BenfordReport['verdict'];
  if (mad < MAD_CLOSE) verdict = 'close-conformity';
  else if (mad < MAD_ACCEPTABLE) verdict = 'acceptable';
  else if (mad < MAD_MARGINAL) verdict = 'marginal';
  else verdict = 'non-conformity';

  // Suspicious digits: sorted by absolute excess in percentage points.
  const suspiciousDigits = Array.from({ length: 9 }, (_, i) => {
    const d = i + 1;
    const diff = observedFrequency[d] - BENFORD_EXPECTED[d];
    return {
      digit: d,
      excessPct: round4(diff * 100),
      direction: diff > 0 ? ('over' as const) : ('under' as const),
    };
  })
    .filter((r) => Math.abs(r.excessPct) > 0.5)
    .sort((a, b) => Math.abs(b.excessPct) - Math.abs(a.excessPct));

  const chiVerdict =
    chiSquare > CHI_SQ_CRITICAL_95 ? 'reject Benford at 95%' : 'consistent with Benford';
  const interpretation = `${total} values analysed. Chi-square ${chiSquare.toFixed(2)} (critical 95% = ${CHI_SQ_CRITICAL_95}) → ${chiVerdict}. MAD ${mad.toFixed(5)} → ${verdict}.`;

  return {
    sampleSize: total,
    observed: counts,
    observedFrequency,
    expectedFrequency: { ...BENFORD_EXPECTED },
    chiSquare: round4(chiSquare),
    chiSquareCritical95: CHI_SQ_CRITICAL_95,
    meanAbsoluteDeviation: round4(mad),
    verdict,
    suspiciousDigits,
    interpretation,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Convenience: brain event mapping
// ---------------------------------------------------------------------------

export function benfordToBrainEvent(
  report: BenfordReport,
  refId: string
): Record<string, unknown> | null {
  if (report.verdict === 'close-conformity' || report.verdict === 'acceptable') return null;
  const severity = report.verdict === 'non-conformity' ? 'high' : 'medium';
  return {
    kind: 'evidence_break',
    severity,
    summary: `Benford non-conformity: ${report.interpretation}`,
    refId,
    meta: {
      source: 'benford-analyzer',
      chiSquare: report.chiSquare,
      mad: report.meanAbsoluteDeviation,
      topSuspiciousDigit: report.suspiciousDigits[0],
    },
  };
}
