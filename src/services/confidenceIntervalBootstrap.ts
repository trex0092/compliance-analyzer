/**
 * Confidence Interval Bootstrap — subsystem #59.
 *
 * The Phase 1 brain reports confidence as a single scalar computed as
 * MIN across subsystem contributions. That's conservative but hides
 * uncertainty: a 0.7 confidence could mean "10 subsystems all at 0.7"
 * or "9 at 0.95 + one at 0.7". These are very different from the
 * MLRO's point of view.
 *
 * This subsystem replaces the point estimate with a bootstrap confidence
 * interval. Given the set of per-subsystem contributions, it resamples
 * with replacement, computes the aggregate for each resample, and
 * reports the 2.5 / 50 / 97.5 percentiles. The final confidence is
 * reported as e.g. `0.82 ± 0.09 (95% CI: 0.73-0.91)` — honest
 * uncertainty for the MLRO.
 *
 * Deterministic given a seed — the bootstrap uses a small seeded
 * PRNG so identical inputs always produce identical CIs, which is
 * required for reproducible audit trails.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20 (CO documents reasoning — including uncertainty)
 *   - EU AI Act Art.13 (transparency about confidence)
 *   - NIST AI RMF MS-2.2 (honest reporting of uncertainty)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BootstrapInput {
  /** Per-subsystem confidence contributions in [0,1]. */
  contributions: readonly number[];
  /** Number of bootstrap resamples. Default 500. */
  iterations?: number;
  /** Aggregator — mean or min. Default min (matches Phase 1 behaviour). */
  aggregator?: 'mean' | 'min' | 'median';
  /** Deterministic seed for the PRNG. Default 12345. */
  seed?: number;
}

export interface BootstrapReport {
  pointEstimate: number;
  lower95: number;
  median: number;
  upper95: number;
  halfWidth: number;
  iterations: number;
  sampleSize: number;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Seeded PRNG — Mulberry32. Deterministic and fast.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export function bootstrapConfidenceInterval(input: BootstrapInput): BootstrapReport {
  const iterations = input.iterations ?? 500;
  const aggregator = input.aggregator ?? 'min';
  const seed = input.seed ?? 12345;
  const n = input.contributions.length;

  if (n === 0) {
    return {
      pointEstimate: 0,
      lower95: 0,
      median: 0,
      upper95: 0,
      halfWidth: 0,
      iterations: 0,
      sampleSize: 0,
      narrative: 'Bootstrap CI: no contributions — cannot compute interval.',
    };
  }

  const aggregate = (values: readonly number[]): number => {
    if (aggregator === 'min') {
      let m = Infinity;
      for (const v of values) if (v < m) m = v;
      return m;
    }
    if (aggregator === 'median') {
      const s = [...values].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }
    // mean
    return values.reduce((acc, v) => acc + v, 0) / values.length;
  };

  const pointEstimate = aggregate(input.contributions);

  const rand = mulberry32(seed);
  const samples: number[] = [];
  for (let it = 0; it < iterations; it++) {
    const resample: number[] = [];
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(rand() * n);
      resample.push(input.contributions[idx]);
    }
    samples.push(aggregate(resample));
  }
  samples.sort((a, b) => a - b);

  const lowerIdx = Math.floor(samples.length * 0.025);
  const medianIdx = Math.floor(samples.length * 0.5);
  const upperIdx = Math.floor(samples.length * 0.975);

  const lower95 = samples[lowerIdx];
  const median = samples[medianIdx];
  const upper95 = samples[upperIdx];
  const halfWidth = (upper95 - lower95) / 2;

  const narrative =
    `Bootstrap CI (${aggregator}): point ${fmt(pointEstimate)}, ` +
    `median ${fmt(median)}, 95% CI [${fmt(lower95)}, ${fmt(upper95)}] ` +
    `(±${fmt(halfWidth)}, ${iterations} resamples, n=${n}).`;

  return {
    pointEstimate: round(pointEstimate),
    lower95: round(lower95),
    median: round(median),
    upper95: round(upper95),
    halfWidth: round(halfWidth),
    iterations,
    sampleSize: n,
    narrative,
  };
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function fmt(n: number): string {
  return (n * 100).toFixed(1) + '%';
}
