/**
 * Shapley Value Explainer — subsystem #90 (Phase 8).
 *
 * Computes each signal's Shapley value contribution to the
 * Weaponized Brain verdict. Gold-standard XAI: given a coalition
 * of signals {s1, s2, ..., sN} and a verdict function v(coalition)
 * the Shapley value φ_i for signal i is the average marginal
 * contribution of i across all possible coalitions it joins.
 *
 *   φ_i = (1/N!) Σ_{S ⊆ N \ {i}} |S|! * (N-|S|-1)! * (v(S ∪ {i}) - v(S))
 *
 * For compliance, the verdict function maps {pass, flag, escalate,
 * freeze} to {0, 1, 2, 3} and Shapley values tell the MLRO exactly
 * which signals moved the verdict and by how much. Unlike feature
 * importance heuristics, Shapley is THE mathematically fair
 * attribution — every axiom (efficiency, symmetry, linearity,
 * null-player) is satisfied.
 *
 * Cost: O(2^N * N) — fine for N <= 16 signals (we have 10-15 per
 * case). For larger N, use Monte-Carlo Shapley approximation via
 * sampling.
 *
 * Regulatory basis:
 *   - EU AI Act Art.13 (transparency + interpretability)
 *   - NIST AI RMF MS-2.2 (explainability of ML decisions)
 *   - FDL No.10/2025 Art.20-21 (CO documents reasoning)
 *   - Cabinet Res 134/2025 Art.19 (documented attribution)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VerdictFn = (coalition: ReadonlySet<string>) => number;

export interface ShapleyInput {
  /** All signal IDs present in the full coalition. */
  signals: readonly string[];
  /** Verdict function mapping coalition subset → scalar score. */
  verdict: VerdictFn;
  /** Sample size for Monte-Carlo approximation when N > 12. Default 200. */
  monteCarloSamples?: number;
}

export interface ShapleyAttribution {
  signal: string;
  value: number;
  normalised: number; // [0,1] share of total
}

export interface ShapleyReport {
  mode: 'exact' | 'monte_carlo';
  totalSamples: number;
  baseline: number; // v(∅)
  full: number; // v(N)
  attributions: ShapleyAttribution[];
  narrative: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function combinationsOfSize<T>(arr: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];
  const [head, ...tail] = arr;
  const withHead = combinationsOfSize(tail, k - 1).map((c) => [head, ...c]);
  const withoutHead = combinationsOfSize(tail, k);
  return [...withHead, ...withoutHead];
}

// ---------------------------------------------------------------------------
// Exact Shapley
// ---------------------------------------------------------------------------

function exactShapley(input: ShapleyInput): ShapleyReport {
  const n = input.signals.length;
  const allSet = new Set(input.signals);
  const baseline = input.verdict(new Set());
  const full = input.verdict(allSet);

  const attributions: ShapleyAttribution[] = [];
  const nFact = factorial(n);

  for (const i of input.signals) {
    const others = input.signals.filter((s) => s !== i);
    let phi = 0;
    for (let k = 0; k <= others.length; k++) {
      const coalitions = combinationsOfSize(others, k);
      const weight = (factorial(k) * factorial(n - k - 1)) / nFact;
      for (const S of coalitions) {
        const withoutI = new Set(S);
        const withI = new Set([...S, i]);
        phi += weight * (input.verdict(withI) - input.verdict(withoutI));
      }
    }
    attributions.push({ signal: i, value: phi, normalised: 0 });
  }

  const totalAbs = attributions.reduce((acc, a) => acc + Math.abs(a.value), 0);
  if (totalAbs > 0) {
    for (const a of attributions) a.normalised = Math.abs(a.value) / totalAbs;
  }
  attributions.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  return {
    mode: 'exact',
    totalSamples: Math.pow(2, n),
    baseline,
    full,
    attributions,
    narrative: buildShapleyNarrative(baseline, full, attributions, 'exact'),
  };
}

// ---------------------------------------------------------------------------
// Monte-Carlo Shapley (for large N)
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

function shuffled<T>(arr: readonly T[], rand: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function monteCarloShapley(input: ShapleyInput): ShapleyReport {
  const samples = input.monteCarloSamples ?? 200;
  const rand = mulberry32(42);
  const phi = new Map<string, number>();
  for (const s of input.signals) phi.set(s, 0);

  for (let iter = 0; iter < samples; iter++) {
    const perm = shuffled(input.signals, rand);
    const coalition = new Set<string>();
    let prev = input.verdict(coalition);
    for (const signal of perm) {
      coalition.add(signal);
      const curr = input.verdict(coalition);
      phi.set(signal, (phi.get(signal) ?? 0) + (curr - prev));
      prev = curr;
    }
  }

  const attributions: ShapleyAttribution[] = Array.from(phi.entries()).map(
    ([signal, value]) => ({
      signal,
      value: value / samples,
      normalised: 0,
    })
  );
  const totalAbs = attributions.reduce((acc, a) => acc + Math.abs(a.value), 0);
  if (totalAbs > 0) {
    for (const a of attributions) a.normalised = Math.abs(a.value) / totalAbs;
  }
  attributions.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  const baseline = input.verdict(new Set());
  const full = input.verdict(new Set(input.signals));

  return {
    mode: 'monte_carlo',
    totalSamples: samples,
    baseline,
    full,
    attributions,
    narrative: buildShapleyNarrative(baseline, full, attributions, 'monte_carlo'),
  };
}

// ---------------------------------------------------------------------------
// Narrative
// ---------------------------------------------------------------------------

function buildShapleyNarrative(
  baseline: number,
  full: number,
  attributions: readonly ShapleyAttribution[],
  mode: 'exact' | 'monte_carlo'
): string {
  const top = attributions
    .slice(0, 3)
    .map((a) => `${a.signal}=${a.value.toFixed(2)}`)
    .join(', ');
  return (
    `Shapley (${mode}): baseline ${baseline.toFixed(2)}, full ${full.toFixed(2)}, ` +
    `delta ${(full - baseline).toFixed(2)}. Top contributors: ${top || 'none'}.`
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function computeShapleyAttribution(input: ShapleyInput): ShapleyReport {
  if (input.signals.length === 0) {
    return {
      mode: 'exact',
      totalSamples: 0,
      baseline: 0,
      full: 0,
      attributions: [],
      narrative: 'Shapley: no signals to attribute.',
    };
  }
  // Exact for N <= 12 (4096 subsets), Monte-Carlo otherwise.
  if (input.signals.length <= 12) return exactShapley(input);
  return monteCarloShapley(input);
}
