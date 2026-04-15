/**
 * Counterfactual Explainer — feature-walk explainer for StrFeatures.
 *
 * Why this exists:
 *   src/services/counterfactualFlipper.ts already produces narrow
 *   counterfactuals for sanctions / UBO / adverse-media / wallet
 *   signals against a fixed clamp policy. That's perfect for those
 *   signals but it does not help the MLRO understand the *general*
 *   case where the brain leaned heavily on a numeric StrFeatures
 *   field (txValue30dAED, crossBorderRatio30d, etc.).
 *
 *   This module is the complementary explainer for the StrFeatures
 *   space. Given a baseline feature vector + a verdict-producing
 *   function (the same shape used by adversarialFuzzer.ts), it
 *   walks each numeric feature with a binary search to find the
 *   *minimum* monotonic change that flips the verdict. That's a
 *   real counterfactual — "this case would have been a `pass` if
 *   txValue30dAED ≤ AED 38,400 OR cashRatio30d ≤ 0.31".
 *
 *   Counterfactuals are far more useful to MLROs than SHAP-style
 *   feature contributions because they tell the operator what to
 *   look at and what would actually change the outcome — not just
 *   what mattered post-hoc.
 *
 *   Pure with respect to the verdict function. No I/O, no global
 *   state. Bounded by `maxFeatures` + `maxIterations` so a fat
 *   feature space cannot blow up the inspector budget.
 *
 * Algorithm:
 *   1. Compute baseline verdict.
 *   2. For each numeric feature:
 *        a. Try setting feature to 0 and to 10×baseline. If neither
 *           direction flips the verdict, this feature is irrelevant
 *           — skip.
 *        b. Otherwise binary-search between baseline and the value
 *           that flipped, returning the boundary value (within ε).
 *   3. Sort the resulting counterfactuals by smallest |relative
 *      change|. Smallest change = most actionable.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21  (CO reasoned + auditable explanation)
 *   FDL No.10/2025 Art.24     (audit trail)
 *   Cabinet Res 134/2025 Art.19 (internal review — dissenting view)
 *   NIST AI RMF 1.0 MEASURE-2 (quantitative risk measurement)
 *   NIST AI RMF 1.0 MANAGE-2  (AI decision provenance + recourse)
 *   EU AI Act Art.13          (transparency)
 *   EU AI Act Art.14          (human oversight via explainability)
 */

import type { FuzzVerdict, FuzzVerdictFn } from './adversarialFuzzer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeatureCounterfactual {
  /** Feature being changed. */
  feature: string;
  /** Original value in the baseline vector. */
  baselineValue: number;
  /** Value at the boundary that flips the verdict (within epsilon). */
  flipValue: number;
  /** Direction of the change. */
  direction: 'increase' | 'decrease';
  /** |flipValue - baselineValue| / max(|baselineValue|, 1). */
  relativeChange: number;
  /** Verdict at baseline. */
  baselineVerdict: FuzzVerdict;
  /** Verdict at flipValue. */
  flippedVerdict: FuzzVerdict;
  /** Plain-English finding. */
  finding: string;
}

export interface CounterfactualExplanation {
  schemaVersion: 1;
  /** Verdict at the baseline. */
  baselineVerdict: FuzzVerdict;
  /** Counterfactuals sorted by smallest relative change first. */
  counterfactuals: readonly FeatureCounterfactual[];
  /** Plain-English summary safe for the audit log. */
  summary: string;
  /** Regulatory anchors. */
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withFeature(
  baseline: Readonly<Record<string, number>>,
  feature: string,
  value: number
): Record<string, number> {
  return { ...baseline, [feature]: value };
}

/**
 * Binary search for the boundary value of `feature` between `lo` and
 * `hi` such that `verdictFn` returns a verdict different from
 * `baselineVerdict.verdict`. Direction-aware:
 *
 *   - If only the LOW end flips → boundary is somewhere in (lo, hi)
 *     and search converges from the low side.
 *   - If only the HIGH end flips → boundary is somewhere in (lo, hi)
 *     and search converges from the high side.
 *   - If both ends flip → boundary cannot be found (the search range
 *     does not contain a single transition point) and we return null.
 *   - If neither end flips → no transition in this range, return null.
 *
 * Returns the value on the FLIPPED side of the boundary, closest to
 * the unflipped side (i.e. the smallest change from baseline).
 */
async function binarySearchFlip(
  baseline: Readonly<Record<string, number>>,
  feature: string,
  lo: number,
  hi: number,
  baselineVerdict: FuzzVerdict,
  verdictFn: FuzzVerdictFn,
  maxIterations: number,
  epsilon: number
): Promise<{ flipValue: number; flippedVerdict: FuzzVerdict } | null> {
  const lowVerdict = await Promise.resolve(verdictFn(withFeature(baseline, feature, lo)));
  const highVerdict = await Promise.resolve(verdictFn(withFeature(baseline, feature, hi)));

  const lowFlips = lowVerdict.verdict !== baselineVerdict.verdict;
  const highFlips = highVerdict.verdict !== baselineVerdict.verdict;

  // Neither end flips → no transition in this range.
  if (!lowFlips && !highFlips) return null;

  // Both ends flip → the entire range is on the flipped side; we
  // cannot pinpoint a single transition with confidence.
  if (lowFlips && highFlips) return null;

  // Single-side flip: invariant is that one side flips and the other
  // does not. We binary-search to converge on the boundary, keeping
  // track of the most-recent flipped value.
  let left = lo;
  let right = hi;
  let lastFlip: { flipValue: number; flippedVerdict: FuzzVerdict };
  if (lowFlips) {
    lastFlip = { flipValue: lo, flippedVerdict: lowVerdict };
  } else {
    lastFlip = { flipValue: hi, flippedVerdict: highVerdict };
  }

  for (let i = 0; i < maxIterations; i++) {
    if (Math.abs(right - left) < epsilon) break;
    const mid = (left + right) / 2;
    const midVerdict = await Promise.resolve(verdictFn(withFeature(baseline, feature, mid)));
    const midFlips = midVerdict.verdict !== baselineVerdict.verdict;

    if (midFlips) {
      // Move towards baseline (the unflipped side) to find the
      // smallest change that still flips.
      lastFlip = { flipValue: mid, flippedVerdict: midVerdict };
      if (lowFlips) {
        // baseline side is hi → push left up
        left = mid;
      } else {
        // baseline side is lo → push right down
        right = mid;
      }
    } else {
      // Move away from baseline.
      if (lowFlips) {
        right = mid;
      } else {
        left = mid;
      }
    }
  }
  return lastFlip;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CounterfactualOptions {
  /** Features to skip (e.g. boolean-encoded). */
  skipFeatures?: readonly string[];
  /** Cap on the number of features explored. Default 20. */
  maxFeatures?: number;
  /** Binary-search iterations per feature. Default 12 (~0.024% precision). */
  maxIterations?: number;
  /**
   * Multiplier for the upper-bound search. The upper bound is set to
   * `baseline * upperMultiplier` for "increase" probes, and 0 for
   * "decrease" probes. Default 10.
   */
  upperMultiplier?: number;
}

/**
 * Compute counterfactual flip points for each numeric feature in the
 * baseline. Pure with respect to the verdict function. Returns the
 * counterfactuals sorted smallest-relative-change first.
 */
export async function computeCounterfactualExplanation(
  baseline: Readonly<Record<string, number>>,
  verdictFn: FuzzVerdictFn,
  opts: CounterfactualOptions = {}
): Promise<CounterfactualExplanation> {
  const skip = new Set(opts.skipFeatures ?? []);
  const maxFeatures = opts.maxFeatures ?? 20;
  const maxIterations = opts.maxIterations ?? 12;
  const upperMul = opts.upperMultiplier ?? 10;

  const baselineVerdict = await Promise.resolve(verdictFn(baseline));

  const counterfactuals: FeatureCounterfactual[] = [];
  let count = 0;

  for (const [feature, value] of Object.entries(baseline)) {
    if (count >= maxFeatures) break;
    if (skip.has(feature)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    count += 1;

    // Try DECREASE direction (search downward from value to 0).
    const eps = Math.max(1e-6, Math.abs(value) * 1e-4);
    const downward = await binarySearchFlip(
      baseline,
      feature,
      0,
      value,
      baselineVerdict,
      verdictFn,
      maxIterations,
      eps
    );

    // Try INCREASE direction (search upward from value to value*upperMul or 1 if value=0).
    const upper = value > 0 ? value * upperMul : Math.max(1, upperMul);
    const upward = await binarySearchFlip(
      baseline,
      feature,
      value,
      upper,
      baselineVerdict,
      verdictFn,
      maxIterations,
      eps
    );

    // Pick whichever direction had the smallest relative change.
    let chosen: {
      direction: 'increase' | 'decrease';
      flipValue: number;
      flippedVerdict: FuzzVerdict;
      relativeChange: number;
    } | null = null;

    if (downward) {
      const rel = Math.abs(downward.flipValue - value) / Math.max(Math.abs(value), 1);
      chosen = {
        direction: 'decrease',
        flipValue: downward.flipValue,
        flippedVerdict: downward.flippedVerdict,
        relativeChange: rel,
      };
    }
    if (upward) {
      const rel = Math.abs(upward.flipValue - value) / Math.max(Math.abs(value), 1);
      if (!chosen || rel < chosen.relativeChange) {
        chosen = {
          direction: 'increase',
          flipValue: upward.flipValue,
          flippedVerdict: upward.flippedVerdict,
          relativeChange: rel,
        };
      }
    }

    if (!chosen) continue;

    counterfactuals.push({
      feature,
      baselineValue: value,
      flipValue: chosen.flipValue,
      direction: chosen.direction,
      relativeChange: chosen.relativeChange,
      baselineVerdict,
      flippedVerdict: chosen.flippedVerdict,
      finding:
        `Verdict would flip ${baselineVerdict.verdict} → ${chosen.flippedVerdict.verdict} ` +
        `if "${feature}" were ${chosen.direction === 'decrease' ? '≤' : '≥'} ${chosen.flipValue.toFixed(3)} ` +
        `(currently ${value.toFixed(3)}, ${(chosen.relativeChange * 100).toFixed(1)}% change).`,
    });
  }

  counterfactuals.sort((a, b) => a.relativeChange - b.relativeChange);

  const summary =
    counterfactuals.length === 0
      ? `No single-feature counterfactual found within ±${(upperMul * 100).toFixed(0)}% bounds. Verdict ${baselineVerdict.verdict} is robust to single-feature perturbation.`
      : `${counterfactuals.length} counterfactual(s) found. Smallest change: ` +
        `"${counterfactuals[0]!.feature}" at ${(counterfactuals[0]!.relativeChange * 100).toFixed(1)}% ` +
        `would flip ${baselineVerdict.verdict} → ${counterfactuals[0]!.flippedVerdict.verdict}.`;

  return {
    schemaVersion: 1,
    baselineVerdict,
    counterfactuals,
    summary,
    regulatory: [
      'FDL No.10/2025 Art.20-21',
      'FDL No.10/2025 Art.24',
      'Cabinet Res 134/2025 Art.19',
      'NIST AI RMF 1.0 MEASURE-2',
      'NIST AI RMF 1.0 MANAGE-2',
      'EU AI Act Art.13',
      'EU AI Act Art.14',
    ],
  };
}

// Exports for tests.
export const __test__ = { withFeature, binarySearchFlip };
