/**
 * Melt-Loss Anomaly Detection — refining loss outlier detection.
 *
 * When scrap gold is refined into bullion, a small amount is lost to
 * oxidation, splatter, and slag. The expected loss is well-characterised:
 *
 *   Gold   : 0.05% - 0.30%
 *   Silver : 0.10% - 0.50%
 *   Platinum: 0.05% - 0.20%
 *
 * Loss outside these bands is either an operational issue (worn
 * crucible, inadequate temperature control) or evidence of theft
 * / diversion. Either way, the MLRO needs to know.
 *
 * Detection method:
 *   - Expected range per metal (static thresholds)
 *   - Per-refiner z-score if enough history exists (catches drift)
 *   - Severity = acceptable / warning / critical
 *
 * Regulatory: MoE 08/AML/2021 record keeping, LBMA RGG v9 Step 4
 * (auditable refining records), FATF DPMS Typologies 2022.
 */

import type { Metal } from './fineness';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MeltBatch {
  batchId: string;
  refinerId: string;
  metal: Metal;
  at: string; // ISO date
  inputPureGrams: number; // pure metal input (after fineness calc)
  outputPureGrams: number; // pure metal output
  operator: string;
}

export type MeltLossSeverity = 'acceptable' | 'warning' | 'critical';

export interface MeltLossAssessment {
  batchId: string;
  metal: Metal;
  lossGrams: number;
  lossPct: number;
  expectedMinPct: number;
  expectedMaxPct: number;
  severity: MeltLossSeverity;
  rationale: string;
  zScore?: number;
}

// ---------------------------------------------------------------------------
// Expected loss bands by metal
// ---------------------------------------------------------------------------

interface LossBand {
  min: number;
  max: number;
  criticalThreshold: number; // loss % that triggers critical alone
}

const EXPECTED_LOSS_BANDS: Record<Metal, LossBand> = {
  gold: { min: 0.05, max: 0.3, criticalThreshold: 0.5 },
  silver: { min: 0.1, max: 0.5, criticalThreshold: 1.0 },
  platinum: { min: 0.05, max: 0.2, criticalThreshold: 0.4 },
  palladium: { min: 0.05, max: 0.2, criticalThreshold: 0.4 },
};

// ---------------------------------------------------------------------------
// Single-batch assessment
// ---------------------------------------------------------------------------

export function assessMeltBatch(batch: MeltBatch): MeltLossAssessment {
  if (batch.inputPureGrams <= 0) {
    throw new RangeError('assessMeltBatch: inputPureGrams must be > 0');
  }
  if (batch.outputPureGrams < 0) {
    throw new RangeError('assessMeltBatch: outputPureGrams must be ≥ 0');
  }

  const lossGrams = batch.inputPureGrams - batch.outputPureGrams;
  const lossPct = (lossGrams / batch.inputPureGrams) * 100;
  const band = EXPECTED_LOSS_BANDS[batch.metal];

  let severity: MeltLossSeverity;
  let rationale: string;

  if (lossPct < 0) {
    severity = 'critical';
    rationale = `Negative loss (${lossPct.toFixed(3)}%) — output exceeds input, impossible without contamination or measurement error`;
  } else if (lossPct >= band.criticalThreshold) {
    severity = 'critical';
    rationale = `Loss ${lossPct.toFixed(3)}% ≥ critical threshold ${band.criticalThreshold}% — possible theft or furnace malfunction`;
  } else if (lossPct > band.max) {
    severity = 'warning';
    rationale = `Loss ${lossPct.toFixed(3)}% exceeds normal range ${band.min}-${band.max}%`;
  } else if (lossPct < band.min) {
    severity = 'warning';
    rationale = `Loss ${lossPct.toFixed(3)}% below expected minimum ${band.min}% — unusual efficiency, verify measurement`;
  } else {
    severity = 'acceptable';
    rationale = `Loss ${lossPct.toFixed(3)}% within expected ${band.min}-${band.max}%`;
  }

  return {
    batchId: batch.batchId,
    metal: batch.metal,
    lossGrams: Math.round(lossGrams * 1000) / 1000,
    lossPct: Math.round(lossPct * 10000) / 10000,
    expectedMinPct: band.min,
    expectedMaxPct: band.max,
    severity,
    rationale,
  };
}

// ---------------------------------------------------------------------------
// Per-refiner trend analysis (z-score on recent history)
// ---------------------------------------------------------------------------

export function detectRefinerDrift(
  refinerId: string,
  history: readonly MeltBatch[],
  recentBatch: MeltBatch,
  zThreshold = 2.5,
): MeltLossAssessment {
  const base = assessMeltBatch(recentBatch);

  const refinerHistory = history.filter(
    (b) =>
      b.refinerId === refinerId &&
      b.batchId !== recentBatch.batchId &&
      b.metal === recentBatch.metal,
  );

  if (refinerHistory.length < 5) return base;

  const losses = refinerHistory.map((b) => {
    const loss = b.inputPureGrams - b.outputPureGrams;
    return (loss / b.inputPureGrams) * 100;
  });
  const mean = losses.reduce((a, b) => a + b, 0) / losses.length;
  const variance =
    losses.reduce((a, b) => a + (b - mean) ** 2, 0) / losses.length;
  const stdev = Math.max(Math.sqrt(variance), 0.001);
  const z = (base.lossPct - mean) / stdev;

  const enhanced = { ...base, zScore: Math.round(z * 100) / 100 };

  if (Math.abs(z) >= zThreshold && base.severity === 'acceptable') {
    // Z-score alone can lift acceptable → warning
    enhanced.severity = 'warning';
    enhanced.rationale = `Loss ${base.lossPct.toFixed(3)}% is within the global band but z=${z.toFixed(2)} vs refiner baseline (${mean.toFixed(3)}% ± ${stdev.toFixed(3)}%)`;
  }

  return enhanced;
}

// ---------------------------------------------------------------------------
// Batch summary across a period
// ---------------------------------------------------------------------------

export interface MeltLossSummary {
  refinerId: string;
  metal: Metal;
  periodStart: string;
  periodEnd: string;
  batchCount: number;
  totalInputGrams: number;
  totalOutputGrams: number;
  totalLossGrams: number;
  averageLossPct: number;
  criticalBatches: number;
  warningBatches: number;
}

export function summariseRefinerLosses(
  refinerId: string,
  metal: Metal,
  batches: readonly MeltBatch[],
): MeltLossSummary {
  const filtered = batches.filter(
    (b) => b.refinerId === refinerId && b.metal === metal,
  );
  if (filtered.length === 0) {
    return {
      refinerId,
      metal,
      periodStart: '',
      periodEnd: '',
      batchCount: 0,
      totalInputGrams: 0,
      totalOutputGrams: 0,
      totalLossGrams: 0,
      averageLossPct: 0,
      criticalBatches: 0,
      warningBatches: 0,
    };
  }
  filtered.sort((a, b) => a.at.localeCompare(b.at));

  let input = 0;
  let output = 0;
  let critical = 0;
  let warning = 0;
  for (const b of filtered) {
    input += b.inputPureGrams;
    output += b.outputPureGrams;
    const assessment = assessMeltBatch(b);
    if (assessment.severity === 'critical') critical++;
    else if (assessment.severity === 'warning') warning++;
  }
  const totalLoss = input - output;
  const avgLoss = (totalLoss / input) * 100;

  return {
    refinerId,
    metal,
    periodStart: filtered[0].at,
    periodEnd: filtered[filtered.length - 1].at,
    batchCount: filtered.length,
    totalInputGrams: Math.round(input * 1000) / 1000,
    totalOutputGrams: Math.round(output * 1000) / 1000,
    totalLossGrams: Math.round(totalLoss * 1000) / 1000,
    averageLossPct: Math.round(avgLoss * 10000) / 10000,
    criticalBatches: critical,
    warningBatches: warning,
  };
}
