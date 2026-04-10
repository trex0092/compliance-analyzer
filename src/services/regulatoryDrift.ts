/**
 * Regulatory Drift Detector.
 *
 * Monitors statistical drift in customer feature distributions relative
 * to a baseline. Early warning signal: "something changed in your
 * portfolio, the risk model calibration may no longer apply."
 *
 * Two standard metrics:
 *
 *  1. Population Stability Index (PSI) — per feature.
 *       PSI = Σ (P_new - P_base) * ln(P_new / P_base)
 *     Thresholds (industry standard):
 *       < 0.10  stable
 *       0.10–0.25 moderate shift
 *       ≥ 0.25  significant shift
 *
 *  2. Kolmogorov-Smirnov two-sample statistic — for continuous features.
 *     KS is the max |F_new(x) - F_base(x)| over the pooled domain.
 *     We return the raw statistic; a p-value approximation is also
 *     emitted via the Smirnov formula.
 *
 * Bucketing: for continuous features we use 10 equal-quantile buckets
 * from the baseline. For categorical features, each distinct value is
 * its own bucket.
 *
 * The output is a per-feature drift report plus an overall verdict.
 *
 * Regulatory basis:
 *   - FATF Rec 1 (risk-based approach — must be reviewed regularly)
 *   - Cabinet Res 134/2025 Art.5 (dynamic risk rating)
 *   - FDL Art.19 (internal review)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FeatureValue = number | string | boolean;

export interface FeatureDriftReport {
  feature: string;
  featureType: 'continuous' | 'categorical';
  psi: number;
  ksStatistic?: number; // only for continuous
  ksPValue?: number;
  band: 'stable' | 'moderate' | 'significant';
  topShifts: Array<{ bucket: string; baselinePct: number; currentPct: number; deltaPct: number }>;
}

export interface PortfolioDriftReport {
  features: FeatureDriftReport[];
  overallMaxPsi: number;
  driftedFeatureCount: number;
  overallBand: 'stable' | 'moderate' | 'significant';
  notes: string[];
}

// ---------------------------------------------------------------------------
// PSI calculator
// ---------------------------------------------------------------------------

const PSI_MODERATE = 0.1;
const PSI_SIGNIFICANT = 0.25;

function psiBand(psi: number): FeatureDriftReport['band'] {
  if (psi >= PSI_SIGNIFICANT) return 'significant';
  if (psi >= PSI_MODERATE) return 'moderate';
  return 'stable';
}

function computePsi(baselinePct: number[], currentPct: number[]): number {
  let psi = 0;
  for (let i = 0; i < baselinePct.length; i++) {
    // Smooth out zeros with a small epsilon to avoid log(0).
    const b = Math.max(baselinePct[i], 1e-6);
    const c = Math.max(currentPct[i], 1e-6);
    psi += (c - b) * Math.log(c / b);
  }
  return psi;
}

// ---------------------------------------------------------------------------
// Continuous features — quantile bucketing
// ---------------------------------------------------------------------------

function quantileBoundaries(values: readonly number[], buckets: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 1; i < buckets; i++) {
    const idx = Math.floor((sorted.length * i) / buckets);
    out.push(sorted[Math.min(idx, sorted.length - 1)]);
  }
  return out;
}

function bucketContinuous(value: number, boundaries: readonly number[]): number {
  for (let i = 0; i < boundaries.length; i++) {
    if (value <= boundaries[i]) return i;
  }
  return boundaries.length;
}

// ---------------------------------------------------------------------------
// KS two-sample test
// ---------------------------------------------------------------------------

function ksTwoSample(a: readonly number[], b: readonly number[]): { d: number; pValue: number } {
  if (a.length === 0 || b.length === 0) return { d: 0, pValue: 1 };
  const sorted = [...a, ...b].sort((x, y) => x - y);
  const ecdfA = makeEcdf(a);
  const ecdfB = makeEcdf(b);
  let d = 0;
  for (const x of sorted) {
    const diff = Math.abs(ecdfA(x) - ecdfB(x));
    if (diff > d) d = diff;
  }
  // Smirnov asymptotic p-value approximation.
  const n1 = a.length;
  const n2 = b.length;
  const en = Math.sqrt((n1 * n2) / (n1 + n2));
  const lambda = (en + 0.12 + 0.11 / en) * d;
  const pValue = ksProbability(lambda);
  return { d, pValue };
}

function makeEcdf(values: readonly number[]): (x: number) => number {
  const sorted = [...values].sort((a, b) => a - b);
  return (x: number) => {
    // count values <= x
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid] <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo / sorted.length;
  };
}

function ksProbability(lambda: number): number {
  if (lambda < 1e-6) return 1;
  let sum = 0;
  for (let j = 1; j <= 100; j++) {
    const term = 2 * (-1) ** (j - 1) * Math.exp(-2 * j * j * lambda * lambda);
    sum += term;
    if (Math.abs(term) < 1e-10) break;
  }
  return Math.max(0, Math.min(1, sum));
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export interface DriftSample {
  [feature: string]: FeatureValue;
}

export function analyseDrift(
  baseline: readonly DriftSample[],
  current: readonly DriftSample[],
  options: { continuousBuckets?: number } = {}
): PortfolioDriftReport {
  const buckets = options.continuousBuckets ?? 10;
  const featureNames = new Set<string>();
  for (const row of baseline) Object.keys(row).forEach((k) => featureNames.add(k));
  for (const row of current) Object.keys(row).forEach((k) => featureNames.add(k));

  const reports: FeatureDriftReport[] = [];
  for (const feature of featureNames) {
    const baseVals = baseline.map((r) => r[feature]).filter((v) => v !== undefined);
    const currVals = current.map((r) => r[feature]).filter((v) => v !== undefined);
    if (baseVals.length === 0 || currVals.length === 0) continue;

    const continuous =
      typeof baseVals[0] === 'number' && baseVals.every((v) => typeof v === 'number');
    if (continuous) {
      reports.push(
        computeContinuousDrift(feature, baseVals as number[], currVals as number[], buckets)
      );
    } else {
      reports.push(computeCategoricalDrift(feature, baseVals, currVals));
    }
  }

  const overallMaxPsi = reports.reduce((m, r) => Math.max(m, r.psi), 0);
  const driftedFeatureCount = reports.filter((r) => r.band !== 'stable').length;
  const overallBand = psiBand(overallMaxPsi);
  const notes: string[] = [];
  if (driftedFeatureCount > 0) {
    notes.push(`${driftedFeatureCount} feature(s) drifted beyond stable threshold.`);
  }
  if (overallBand === 'significant') {
    notes.push(
      'Overall portfolio exhibits significant drift — review risk model calibration (Cabinet Res 134/2025 Art.5).'
    );
  }

  return {
    features: reports.sort((a, b) => b.psi - a.psi),
    overallMaxPsi: round4(overallMaxPsi),
    driftedFeatureCount,
    overallBand,
    notes,
  };
}

function computeContinuousDrift(
  feature: string,
  baseline: readonly number[],
  current: readonly number[],
  buckets: number
): FeatureDriftReport {
  const boundaries = quantileBoundaries(baseline, buckets);
  const baseCounts = new Array<number>(buckets).fill(0);
  const currCounts = new Array<number>(buckets).fill(0);
  for (const v of baseline) baseCounts[bucketContinuous(v, boundaries)]++;
  for (const v of current) currCounts[bucketContinuous(v, boundaries)]++;

  const basePct = baseCounts.map((c) => c / baseline.length);
  const currPct = currCounts.map((c) => c / current.length);
  const psi = computePsi(basePct, currPct);

  const ks = ksTwoSample(baseline, current);

  const topShifts = basePct
    .map((p, i) => ({
      bucket: `Q${i + 1}`,
      baselinePct: round4(p * 100),
      currentPct: round4(currPct[i] * 100),
      deltaPct: round4((currPct[i] - p) * 100),
    }))
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
    .slice(0, 3);

  return {
    feature,
    featureType: 'continuous',
    psi: round4(psi),
    ksStatistic: round4(ks.d),
    ksPValue: round4(ks.pValue),
    band: psiBand(psi),
    topShifts,
  };
}

function computeCategoricalDrift(
  feature: string,
  baseline: readonly FeatureValue[],
  current: readonly FeatureValue[]
): FeatureDriftReport {
  const categories = new Set<string>();
  for (const v of baseline) categories.add(String(v));
  for (const v of current) categories.add(String(v));

  const baseCounts = new Map<string, number>();
  const currCounts = new Map<string, number>();
  for (const v of baseline) baseCounts.set(String(v), (baseCounts.get(String(v)) ?? 0) + 1);
  for (const v of current) currCounts.set(String(v), (currCounts.get(String(v)) ?? 0) + 1);

  const basePct: number[] = [];
  const currPct: number[] = [];
  const shiftRows: Array<{
    bucket: string;
    baselinePct: number;
    currentPct: number;
    deltaPct: number;
  }> = [];
  for (const c of categories) {
    const bp = (baseCounts.get(c) ?? 0) / baseline.length;
    const cp = (currCounts.get(c) ?? 0) / current.length;
    basePct.push(bp);
    currPct.push(cp);
    shiftRows.push({
      bucket: c,
      baselinePct: round4(bp * 100),
      currentPct: round4(cp * 100),
      deltaPct: round4((cp - bp) * 100),
    });
  }
  const psi = computePsi(basePct, currPct);
  shiftRows.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
  return {
    feature,
    featureType: 'categorical',
    psi: round4(psi),
    band: psiBand(psi),
    topShifts: shiftRows.slice(0, 3),
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
