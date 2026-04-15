/**
 * Adversarial Fuzzer tests.
 *
 * Covers:
 *   - runBoundaryProbes: detects flip vs stuck thresholds
 *   - runPerturbationProbes: detects flip vs stable features
 *   - runAdversarialFuzz: aggregate score 100 when robust
 *   - runAdversarialFuzz: degraded score when fragile
 *   - skipFeatures honoured
 *   - maxProbes honoured
 *   - regulatory anchors carried
 */
import { describe, it, expect } from 'vitest';

import {
  runBoundaryProbes,
  runPerturbationProbes,
  runAdversarialFuzz,
  type FuzzVerdictFn,
} from '../src/services/adversarialFuzzer';

const baseline = {
  txValue30dAED: 50_000,
  sanctionsMatchScore: 0.0,
  isPep: 0,
  cashRatio30d: 0.5,
};

// A toy verdict function: flag when txValue >= AED 55K, else pass.
const thresholdAware: FuzzVerdictFn = (f) => ({
  verdict: (f.txValue30dAED ?? 0) >= 55_000 ? 'flag' : 'pass',
  confidence: 0.8,
});

// Always returns the same verdict — used to test "stuck" detection.
const constant: FuzzVerdictFn = () => ({ verdict: 'pass', confidence: 0.5 });

// Fragile under perturbation: flips on any 5% bump to txValue30dAED.
const fragile: FuzzVerdictFn = (f) => ({
  verdict: (f.txValue30dAED ?? 0) > 50_000 ? 'flag' : 'pass',
  confidence: 0.7,
});

describe('runBoundaryProbes', () => {
  it('reports a flip when the verdict actually crosses the threshold', async () => {
    const probes = await runBoundaryProbes(
      baseline,
      [{ feature: 'txValue30dAED', threshold: 55_000 }],
      thresholdAware
    );
    expect(probes.length).toBe(1);
    expect(probes[0]!.flipped).toBe(true);
    expect(probes[0]!.belowVerdict.verdict).toBe('pass');
    expect(probes[0]!.aboveVerdict.verdict).toBe('flag');
  });

  it('reports stuck when the verdict does not move', async () => {
    const probes = await runBoundaryProbes(
      baseline,
      [{ feature: 'txValue30dAED', threshold: 55_000 }],
      constant
    );
    expect(probes.length).toBe(1);
    expect(probes[0]!.flipped).toBe(false);
    expect(probes[0]!.finding).toMatch(/did NOT flip/);
  });

  it('honours maxProbes', async () => {
    const probes = await runBoundaryProbes(
      baseline,
      [
        { feature: 'a', threshold: 1 },
        { feature: 'b', threshold: 2 },
        { feature: 'c', threshold: 3 },
      ],
      thresholdAware,
      { maxProbes: 2 }
    );
    expect(probes.length).toBe(2);
  });
});

describe('runPerturbationProbes', () => {
  it('detects fragile features', async () => {
    const probes = await runPerturbationProbes(baseline, fragile);
    const flipped = probes.filter((p) => p.flipped);
    expect(flipped.length).toBeGreaterThan(0);
    expect(flipped[0]!.feature).toBe('txValue30dAED');
  });

  it('reports stable when perturbation does not flip', async () => {
    const probes = await runPerturbationProbes(baseline, constant);
    expect(probes.every((p) => !p.flipped)).toBe(true);
  });

  it('skipFeatures honoured', async () => {
    const probes = await runPerturbationProbes(baseline, fragile, {
      skipFeatures: ['txValue30dAED'],
    });
    expect(probes.find((p) => p.feature === 'txValue30dAED')).toBeUndefined();
  });
});

describe('runAdversarialFuzz', () => {
  it('robustness 100 when boundaries flip cleanly and nothing is fragile', async () => {
    const r = await runAdversarialFuzz(
      baseline,
      [{ feature: 'txValue30dAED', threshold: 55_000 }],
      thresholdAware,
      { skipFeatures: ['txValue30dAED', 'sanctionsMatchScore', 'isPep', 'cashRatio30d'] }
    );
    expect(r.robustnessScore).toBe(100);
    expect(r.boundaryStuck).toEqual([]);
    expect(r.perturbationFragile).toEqual([]);
  });

  it('robustness drops when perturbation is fragile', async () => {
    const r = await runAdversarialFuzz(
      baseline,
      [{ feature: 'txValue30dAED', threshold: 55_000 }],
      fragile
    );
    expect(r.robustnessScore).toBeLessThan(100);
    expect(r.perturbationFragile.length).toBeGreaterThan(0);
  });

  it('carries the regulatory anchors', async () => {
    const r = await runAdversarialFuzz(baseline, [], constant);
    expect(r.regulatory).toContain('NIST AI RMF 1.0 MEASURE-4');
    expect(r.regulatory).toContain('EU AI Act Art.15');
  });
});
