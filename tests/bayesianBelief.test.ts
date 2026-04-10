import { describe, it, expect } from 'vitest';
import {
  uniformPrior,
  normalise,
  updateBelief,
  runBeliefUpdate,
  shannonEntropy,
  informationGain,
  type Hypothesis,
  type Evidence,
} from '@/services/bayesianBelief';

const hypotheses: Hypothesis[] = [
  { id: 'clean', label: 'Clean' },
  { id: 'suspicious', label: 'Suspicious' },
  { id: 'confirmed', label: 'Confirmed launderer' },
];

describe('bayesianBelief — primitives', () => {
  it('uniformPrior sums to 1', () => {
    const p = uniformPrior(hypotheses);
    const sum = Object.values(p).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1);
    expect(p.clean).toBeCloseTo(1 / 3);
  });

  it('normalise re-scales to probability distribution', () => {
    const p = normalise({ a: 2, b: 8 });
    expect(p.a).toBeCloseTo(0.2);
    expect(p.b).toBeCloseTo(0.8);
  });

  it('normalise handles zero total by returning uniform', () => {
    const p = normalise({ a: 0, b: 0 });
    expect(p.a).toBeCloseTo(0.5);
    expect(p.b).toBeCloseTo(0.5);
  });

  it('shannon entropy of uniform is log2(n)', () => {
    const h = shannonEntropy({ a: 0.25, b: 0.25, c: 0.25, d: 0.25 });
    expect(h).toBeCloseTo(2);
  });

  it('shannon entropy of certainty is 0', () => {
    const h = shannonEntropy({ a: 1, b: 0, c: 0 });
    expect(h).toBe(0);
  });
});

describe('bayesianBelief — single update', () => {
  it('sanctions match likelihood shifts toward confirmed', () => {
    const prior = uniformPrior(hypotheses);
    const sanctionsHit: Evidence = {
      id: 'E1',
      label: 'OFAC match at 0.95',
      likelihood: { clean: 0.01, suspicious: 0.3, confirmed: 0.95 },
    };
    const step = updateBelief(prior, sanctionsHit);
    expect(step.posterior.confirmed).toBeGreaterThan(step.posterior.suspicious);
    expect(step.posterior.confirmed).toBeGreaterThan(step.posterior.clean);
  });

  it('exonerating evidence decreases suspicion', () => {
    const prior = { clean: 0.3, suspicious: 0.6, confirmed: 0.1 };
    const cddClean: Evidence = {
      id: 'E2',
      label: 'Clean CDD review',
      likelihood: { clean: 0.9, suspicious: 0.2, confirmed: 0.05 },
    };
    const step = updateBelief(prior, cddClean);
    expect(step.posterior.clean).toBeGreaterThan(prior.clean);
    expect(step.posterior.suspicious).toBeLessThan(prior.suspicious);
  });
});

describe('bayesianBelief — sequential updates', () => {
  it('runBeliefUpdate is order-independent for independent evidence', () => {
    const prior = uniformPrior(hypotheses);
    const e1: Evidence = {
      id: 'E1',
      label: 'sanctions',
      likelihood: { clean: 0.01, suspicious: 0.3, confirmed: 0.95 },
    };
    const e2: Evidence = {
      id: 'E2',
      label: 'cash-intensive',
      likelihood: { clean: 0.1, suspicious: 0.6, confirmed: 0.7 },
    };
    const a = runBeliefUpdate(hypotheses, prior, [e1, e2]);
    const b = runBeliefUpdate(hypotheses, prior, [e2, e1]);
    for (const id of ['clean', 'suspicious', 'confirmed']) {
      expect(a.finalPosterior[id]).toBeCloseTo(b.finalPosterior[id]);
    }
  });

  it('reports most likely hypothesis and entropy', () => {
    const prior = uniformPrior(hypotheses);
    const e1: Evidence = {
      id: 'E1',
      label: 'overwhelming evidence',
      likelihood: { clean: 0.01, suspicious: 0.1, confirmed: 0.99 },
    };
    const report = runBeliefUpdate(hypotheses, prior, [e1]);
    expect(report.mostLikely.id).toBe('confirmed');
    expect(report.mostLikely.probability).toBeGreaterThan(0.8);
    expect(report.entropyBits).toBeLessThan(1);
  });

  it('informationGain positive when evidence is informative', () => {
    const prior = uniformPrior(hypotheses);
    const e: Evidence = {
      id: 'E1',
      label: 'strong',
      likelihood: { clean: 0.01, suspicious: 0.2, confirmed: 0.95 },
    };
    const step = updateBelief(prior, e);
    const gain = informationGain(step);
    expect(gain).toBeGreaterThan(0);
  });

  it('informationGain ~0 when likelihoods are flat', () => {
    const prior = uniformPrior(hypotheses);
    const e: Evidence = {
      id: 'E1',
      label: 'flat',
      likelihood: { clean: 0.5, suspicious: 0.5, confirmed: 0.5 },
    };
    const step = updateBelief(prior, e);
    expect(informationGain(step)).toBeCloseTo(0, 5);
  });
});
