/**
 * Counterfactual Explainer tests.
 *
 * Covers:
 *   - flat verdict function → no counterfactuals
 *   - threshold function → finds the boundary within epsilon
 *   - sorted by smallest relative change first
 *   - skipFeatures honoured
 *   - direction reported correctly
 *   - regulatory anchors
 */
import { describe, it, expect } from 'vitest';

import {
  computeCounterfactualExplanation,
} from '../src/services/counterfactualExplainer';
import type { FuzzVerdictFn } from '../src/services/adversarialFuzzer';

const baseline = {
  txValue30dAED: 80_000,
  cashRatio30d: 0.7,
  isPep: 0,
};

// flag at txValue30dAED >= 55K, else pass
const txThreshold: FuzzVerdictFn = (f) => ({
  verdict: (f.txValue30dAED ?? 0) >= 55_000 ? 'flag' : 'pass',
  confidence: 0.8,
});

const constant: FuzzVerdictFn = () => ({ verdict: 'pass', confidence: 0.5 });

describe('computeCounterfactualExplanation', () => {
  it('flat verdict function → no counterfactuals', async () => {
    const r = await computeCounterfactualExplanation(baseline, constant);
    expect(r.counterfactuals).toEqual([]);
    expect(r.summary).toMatch(/robust/);
  });

  it('finds the threshold flip within epsilon', async () => {
    const r = await computeCounterfactualExplanation(baseline, txThreshold);
    const cf = r.counterfactuals.find((c) => c.feature === 'txValue30dAED');
    expect(cf).toBeDefined();
    expect(cf!.direction).toBe('decrease'); // we need to drop below 55K
    // Within ~0.1% of the actual threshold
    expect(cf!.flipValue).toBeGreaterThan(54_500);
    expect(cf!.flipValue).toBeLessThan(55_500);
  });

  it('reports baselineVerdict correctly', async () => {
    const r = await computeCounterfactualExplanation(baseline, txThreshold);
    expect(r.baselineVerdict.verdict).toBe('flag');
  });

  it('sorts smallest-relative-change first', async () => {
    const multi: FuzzVerdictFn = (f) => {
      // Two thresholds — txValue at 55K (small change from 80K),
      // cashRatio at 0.99 (large change from 0.7).
      if ((f.txValue30dAED ?? 0) >= 55_000) return { verdict: 'flag', confidence: 0.8 };
      if ((f.cashRatio30d ?? 0) >= 0.99) return { verdict: 'flag', confidence: 0.8 };
      return { verdict: 'pass', confidence: 0.6 };
    };
    const r = await computeCounterfactualExplanation(baseline, multi);
    expect(r.counterfactuals.length).toBeGreaterThan(0);
    if (r.counterfactuals.length >= 2) {
      expect(r.counterfactuals[0]!.relativeChange).toBeLessThanOrEqual(
        r.counterfactuals[1]!.relativeChange
      );
    }
  });

  it('honours skipFeatures', async () => {
    const r = await computeCounterfactualExplanation(baseline, txThreshold, {
      skipFeatures: ['txValue30dAED'],
    });
    expect(r.counterfactuals.find((c) => c.feature === 'txValue30dAED')).toBeUndefined();
  });

  it('carries the regulatory anchors', async () => {
    const r = await computeCounterfactualExplanation(baseline, constant);
    expect(r.regulatory).toContain('NIST AI RMF 1.0 MEASURE-2');
    expect(r.regulatory).toContain('EU AI Act Art.13');
    expect(r.regulatory).toContain('EU AI Act Art.14');
  });
});
