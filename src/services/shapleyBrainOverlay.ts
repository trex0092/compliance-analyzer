/**
 * Shapley Brain Overlay — Tier B4.
 *
 * Computes per-feature Shapley contribution values for a
 * super-brain verdict so the MLRO sees WHY the brain chose a
 * particular verdict.
 *
 * The formal Shapley math for a full 12-subsystem coalition is
 * O(2^n) — too expensive for live UI. This overlay uses a
 * Monte Carlo approximation: it samples coalitions, runs the
 * passed-in verdict function against each, and averages the
 * marginal contributions.
 *
 * Pure — the verdict function is injected. Tests pass a
 * deterministic function that maps feature sets to 0/1 verdicts
 * so the approximation is stable.
 *
 * Regulatory basis:
 *   - NIST AI RMF 1.0 MEASURE-2 (AI decision provenance +
 *     explainability)
 *   - ISO/IEC 42001:2023 Clause 9.1 (monitoring + measurement)
 *   - EU Reg 2024/1689 Art.13 (transparency to deployers)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VerdictFn = (coalition: ReadonlySet<string>) => number;

export interface ShapleyContribution {
  feature: string;
  contribution: number;
  /** Rank by absolute contribution (1 = highest). */
  rank: number;
  /** % of total absolute contribution. */
  percent: number;
}

export interface ShapleyOverlay {
  features: string[];
  contributions: ShapleyContribution[];
  /** Baseline verdict (empty coalition). */
  baseline: number;
  /** Full-coalition verdict. */
  fullVerdict: number;
  /** Number of Monte Carlo samples used. */
  samples: number;
}

export interface ShapleyOptions {
  /** Number of Monte Carlo samples per feature. Default 50. */
  samples?: number;
  /** Deterministic seed for tests. */
  seed?: number;
}

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Shuffle via injected RNG
// ---------------------------------------------------------------------------

function shuffle<T>(xs: readonly T[], rng: () => number): T[] {
  const arr = xs.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Pure Shapley approximator
// ---------------------------------------------------------------------------

/**
 * Compute a Monte Carlo Shapley overlay over a fixed feature set.
 * The verdict function must be pure — sampling calls it many
 * times with different coalitions.
 */
export function computeShapleyOverlay(
  features: readonly string[],
  verdict: VerdictFn,
  options: ShapleyOptions = {}
): ShapleyOverlay {
  const samples = options.samples ?? 50;
  const rng = mulberry32(options.seed ?? 42);

  const contribSum = new Map<string, number>();
  features.forEach((f) => contribSum.set(f, 0));

  for (let s = 0; s < samples; s++) {
    const order = shuffle(features, rng);
    const coalition = new Set<string>();
    let prev = verdict(coalition);
    for (const feature of order) {
      coalition.add(feature);
      const next = verdict(coalition);
      const marginal = next - prev;
      contribSum.set(feature, (contribSum.get(feature) ?? 0) + marginal);
      prev = next;
    }
  }

  const baseline = verdict(new Set());
  const fullSet = new Set(features);
  const fullVerdict = verdict(fullSet);

  const rawContribs = features.map((f) => ({
    feature: f,
    contribution: (contribSum.get(f) ?? 0) / samples,
  }));

  const totalAbs = rawContribs.reduce((sum, c) => sum + Math.abs(c.contribution), 0);

  const ranked = [...rawContribs]
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .map((c, i) => ({
      feature: c.feature,
      contribution: c.contribution,
      rank: i + 1,
      percent: totalAbs > 0 ? (Math.abs(c.contribution) / totalAbs) * 100 : 0,
    }));

  return {
    features: [...features],
    contributions: ranked,
    baseline,
    fullVerdict,
    samples,
  };
}
