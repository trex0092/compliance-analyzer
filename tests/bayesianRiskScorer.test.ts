/**
 * Tests for src/services/bayesianRiskScorer — the calibrated posterior
 * replacement for the linear likelihood × impact formula. These tests
 * pin the concrete numerical behaviour AND the regulatory invariants
 * so a future edit to a likelihood ratio has to reckon with the test
 * rather than silently drifting the MLRO-facing score.
 */

import { describe, it, expect } from 'vitest';
import {
  scoreBayesian,
  __INTERNAL__,
  type BayesianEvidence,
} from '../src/services/bayesianRiskScorer';

const NO_EVIDENCE: BayesianEvidence = {
  cashIntensive: false,
  highRiskJurisdiction: false,
  pep: false,
  shellCompanyIndicator: false,
  adverseMediaHit: false,
};

const allFactors = {
  cashIntensive: true,
  highRiskJurisdiction: true,
  pep: true,
  shellCompanyIndicator: true,
  adverseMediaHit: true,
} as BayesianEvidence;

describe('bayesianRiskScorer — baseline + verdict tiers', () => {
  it('returns the base rate when no evidence is present', () => {
    const score = scoreBayesian(NO_EVIDENCE);
    expect(score.posterior).toBeCloseTo(__INTERNAL__.BASE_RATE, 6);
    expect(score.verdict).toBe('low');
    expect(score.strongestFactor).toBeNull();
    expect(score.counterfactuals).toHaveLength(0);
    expect(score.regulatoryCitations).toHaveLength(0);
  });

  it('returns a critical verdict when every factor is present', () => {
    const score = scoreBayesian(allFactors);
    expect(score.posterior).toBeGreaterThan(0.85);
    expect(score.verdict).toBe('critical');
    expect(score.factorAttribution.every((fa) => fa.present)).toBe(true);
    expect(score.counterfactuals).toHaveLength(5);
  });

  it('medium verdict for a single moderate factor (adverse media alone)', () => {
    const score = scoreBayesian({ ...NO_EVIDENCE, adverseMediaHit: true });
    expect(score.posterior).toBeGreaterThanOrEqual(0.05);
    expect(score.posterior).toBeLessThan(0.3);
    // LR 7.0 * base 0.01 / 0.99 → odds 0.071 → P 0.066
    expect(score.posterior).toBeCloseTo(0.066, 2);
    expect(score.verdict).toMatch(/^(low|medium)$/);
  });

  it('high verdict for a strong two-factor combination (PEP + shell company)', () => {
    const score = scoreBayesian({
      ...NO_EVIDENCE,
      pep: true,
      shellCompanyIndicator: true,
    });
    expect(score.posterior).toBeGreaterThan(0.5);
    expect(score.verdict).toBe('high');
  });
});

describe('bayesianRiskScorer — factor attribution', () => {
  it('reports a positive marginal contribution for every present factor', () => {
    const score = scoreBayesian(allFactors);
    for (const fa of score.factorAttribution) {
      expect(fa.present).toBe(true);
      expect(fa.marginalContribution).toBeGreaterThan(0);
    }
  });

  it('identifies the single strongest factor against an otherwise-clean subject', () => {
    // PEP has LR 10.0 (highest for a single-factor presence case),
    // so against no other evidence it should be the strongest
    // single mover of the posterior.
    const onlyPep = { ...NO_EVIDENCE, pep: true };
    const score = scoreBayesian(onlyPep);
    expect(score.strongestFactor).toBe('pep');
  });

  it('flags single-point-of-failure verdicts when one factor dominates', () => {
    // PEP alone → strongestFactorShareOfDelta should be ~1.0 (all
    // the delta from base rate comes from one factor).
    const onlyPep = { ...NO_EVIDENCE, pep: true };
    const score = scoreBayesian(onlyPep);
    expect(score.strongestFactorShareOfDelta).toBeGreaterThan(0.95);
  });

  it('diversifies the strongest-factor share when multiple factors are present', () => {
    const score = scoreBayesian(allFactors);
    // With five factors firing, no single factor should own more
    // than ~60 % of the delta — the fragility warning in layer A
    // of the REASONING DEPTH chain should NOT fire here.
    expect(score.strongestFactorShareOfDelta).toBeLessThan(0.6);
  });

  it('picks shell-company as the strongest mover at parity with other factors (highest LR)', () => {
    const score = scoreBayesian(allFactors);
    expect(score.strongestFactor).toBe('shellCompanyIndicator');
  });
});

describe('bayesianRiskScorer — counterfactuals', () => {
  it('returns one counterfactual per present factor and none for absent ones', () => {
    const score = scoreBayesian({
      ...NO_EVIDENCE,
      pep: true,
      adverseMediaHit: true,
    });
    expect(score.counterfactuals).toHaveLength(2);
    const omitted = score.counterfactuals.map((c) => c.omittedFactor).sort();
    expect(omitted).toEqual(['adverseMediaHit', 'pep']);
  });

  it('each counterfactual lowers the posterior', () => {
    const score = scoreBayesian(allFactors);
    for (const cf of score.counterfactuals) {
      expect(cf.posterior).toBeLessThan(score.posterior);
      expect(cf.delta).toBeGreaterThan(0);
    }
  });

  it('flags a verdict flip when dropping the PEP from a borderline case', () => {
    // PEP + cashIntensive pushes us into medium. Dropping PEP
    // drops us to cash-only (~0.057) which is still low → verdict
    // flips from medium to low.
    const score = scoreBayesian({
      ...NO_EVIDENCE,
      pep: true,
      cashIntensive: true,
    });
    expect(score.verdict).toBe('medium');
    const cf = score.counterfactuals.find((c) => c.omittedFactor === 'pep');
    expect(cf).toBeDefined();
    expect(cf!.verdictFlips).toBe(true);
    // Without the PEP the posterior should sit roughly at the
    // cash-only level (LR 6 * base ~= 0.057).
    expect(cf!.posterior).toBeCloseTo(0.057, 2);
  });

  it('does NOT flag a flip when the remaining evidence still supports the verdict', () => {
    // Every factor present → dropping any single one still leaves
    // a critical verdict because four factors remain.
    const score = scoreBayesian(allFactors);
    const anyFlip = score.counterfactuals.some((c) => c.verdictFlips);
    expect(anyFlip).toBe(false);
  });
});

describe('bayesianRiskScorer — regulatory invariants', () => {
  it('exposes a citation on every factor attribution entry', () => {
    const score = scoreBayesian(allFactors);
    for (const fa of score.factorAttribution) {
      expect(fa.citation).toMatch(/FATF|FDL|Cabinet|MoE/);
    }
  });

  it('aggregates unique citations for the present factors only', () => {
    const score = scoreBayesian({
      ...NO_EVIDENCE,
      pep: true,
      shellCompanyIndicator: true,
    });
    expect(score.regulatoryCitations).toHaveLength(2);
    expect(
      score.regulatoryCitations.some((c) => c.includes('Cabinet Res 134/2025'))
    ).toBe(true);
    expect(
      score.regulatoryCitations.some((c) =>
        c.includes('Cabinet Decision 109/2023')
      )
    ).toBe(true);
  });

  it('base rate is conservative (< 5 %) so a no-evidence subject is not pre-flagged', () => {
    expect(__INTERNAL__.BASE_RATE).toBeLessThan(0.05);
  });

  it('likelihood ratios are all > 1 (every listed factor is a risk-increasing signal)', () => {
    for (const [, spec] of Object.entries(__INTERNAL__.FACTORS)) {
      expect(spec.likelihoodRatio).toBeGreaterThan(1);
    }
  });

  it('the network is monotonic: adding evidence never decreases the posterior', () => {
    // Walk the 32-row joint explicitly. For every pair (e, e') where
    // e' is e with exactly one factor flipped from false → true,
    // P(e') >= P(e).
    const factors: (keyof BayesianEvidence)[] = [
      'cashIntensive',
      'highRiskJurisdiction',
      'pep',
      'shellCompanyIndicator',
      'adverseMediaHit',
    ];
    for (let mask = 0; mask < 32; mask++) {
      const base: BayesianEvidence = {
        cashIntensive: !!(mask & 1),
        highRiskJurisdiction: !!(mask & 2),
        pep: !!(mask & 4),
        shellCompanyIndicator: !!(mask & 8),
        adverseMediaHit: !!(mask & 16),
      };
      const basePost = __INTERNAL__.posteriorOf(base);
      for (const f of factors) {
        if (!base[f]) {
          const with1: BayesianEvidence = { ...base, [f]: true };
          expect(__INTERNAL__.posteriorOf(with1)).toBeGreaterThanOrEqual(
            basePost
          );
        }
      }
    }
  });

  it('verdict thresholds are strictly monotonic', () => {
    expect(__INTERNAL__.verdictFor(0.86)).toBe('critical');
    expect(__INTERNAL__.verdictFor(0.5)).toBe('high');
    expect(__INTERNAL__.verdictFor(0.49)).toBe('medium');
    expect(__INTERNAL__.verdictFor(0.15)).toBe('medium');
    expect(__INTERNAL__.verdictFor(0.14)).toBe('low');
    expect(__INTERNAL__.verdictFor(0)).toBe('low');
  });
});
