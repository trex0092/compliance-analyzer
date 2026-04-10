import { describe, it, expect } from 'vitest';
import { explainableScore, formatExplanation } from '@/services/explainableScoring';

describe('explainableScore — additive invariant', () => {
  it('the score ALWAYS equals the sum of contributions (± rounding)', () => {
    const exp = explainableScore({
      isPep: true,
      nationality: 'IR',
      cashIntensity: 0.9,
      sanctionsMatchScore: 0.95,
    });
    const sum = exp.factors.reduce((s, f) => s + f.contribution, 0);
    // The published score is rounded; compare with tolerance
    expect(Math.abs(exp.score - Math.min(100, sum))).toBeLessThan(0.1);
  });

  it('every factor has a regulatory citation', () => {
    const exp = explainableScore({});
    for (const f of exp.factors) {
      expect(f.regulatory).toBeTruthy();
    }
  });

  it('empty input produces a low score', () => {
    const exp = explainableScore({});
    expect(exp.score).toBeLessThan(15);
    expect(exp.rating).toBe('Low');
    expect(exp.cddLevel).toBe('SDD');
  });
});

describe('explainableScore — factor behaviour', () => {
  it('confirmed sanctions match dominates the score', () => {
    const exp = explainableScore({ sanctionsMatchScore: 0.95 });
    expect(exp.score).toBeGreaterThanOrEqual(50);
    expect(exp.rating).toBe('Very High');
    expect(exp.cddLevel).toBe('EDD');
    const sanctions = exp.factors.find((f) => f.name === 'Sanctions Match');
    expect(sanctions?.contribution).toBe(50);
  });

  it('potential sanctions match triggers 25-point contribution', () => {
    const exp = explainableScore({ sanctionsMatchScore: 0.7 });
    const sanctions = exp.factors.find((f) => f.name === 'Sanctions Match');
    expect(sanctions?.contribution).toBe(25);
  });

  it('direct sanctions hit via UBO proximity (hops=0)', () => {
    const exp = explainableScore({ sanctionsProximityHops: 0 });
    const prox = exp.factors.find((f) => f.name === 'Sanctions Proximity (UBO)');
    expect(prox?.contribution).toBe(50);
  });

  it('sanctioned shareholder at 2 hops scores 20', () => {
    const exp = explainableScore({ sanctionsProximityHops: 2 });
    const prox = exp.factors.find((f) => f.name === 'Sanctions Proximity (UBO)');
    expect(prox?.contribution).toBe(20);
  });

  it('PEP status adds 20 points', () => {
    const exp = explainableScore({ isPep: true });
    const pep = exp.factors.find((f) => f.name === 'PEP Status');
    expect(pep?.contribution).toBe(20);
  });

  it('Iran nationality is flagged as high-risk jurisdiction', () => {
    const exp = explainableScore({ nationality: 'IR' });
    const j = exp.factors.find((f) => f.name === 'Jurisdiction Risk');
    expect(j?.contribution).toBe(25);
  });

  it('FATF grey list is flagged with lower weight', () => {
    const exp = explainableScore({ nationality: 'TR' });
    const j = exp.factors.find((f) => f.name === 'Jurisdiction Risk');
    expect(j?.contribution).toBe(12);
  });

  it('clean UK nationality scores zero on jurisdiction', () => {
    const exp = explainableScore({ nationality: 'GB' });
    const j = exp.factors.find((f) => f.name === 'Jurisdiction Risk');
    expect(j?.contribution).toBe(0);
  });

  it('high cash intensity scores 15', () => {
    const exp = explainableScore({ cashIntensity: 0.9 });
    const cash = exp.factors.find((f) => f.name === 'Cash Intensity');
    expect(cash?.contribution).toBe(15);
  });

  it('undisclosed UBO triggers 18-point penalty', () => {
    const exp = explainableScore({ hasUndisclosedUbo: true });
    const ubo = exp.factors.find((f) => f.name === 'UBO Transparency');
    expect(ubo?.contribution).toBe(18);
  });

  it('adverse media hits contribute proportionally', () => {
    const low = explainableScore({ adverseMediaHits: 1 });
    const high = explainableScore({ adverseMediaHits: 10 });
    const lowF = low.factors.find((f) => f.name === 'Adverse Media');
    const highF = high.factors.find((f) => f.name === 'Adverse Media');
    expect(highF!.contribution).toBeGreaterThan(lowF!.contribution);
  });

  it('high-severity transaction anomaly scores 20', () => {
    const exp = explainableScore({ hasHighSeverityAnomaly: true });
    const an = exp.factors.find((f) => f.name === 'Transaction Anomalies');
    expect(an?.contribution).toBe(20);
  });
});

describe('explainableScore — rating + CDD level', () => {
  it('50+ → Very High → EDD', () => {
    const exp = explainableScore({ sanctionsMatchScore: 0.95 });
    expect(exp.rating).toBe('Very High');
    expect(exp.cddLevel).toBe('EDD');
  });

  it('30-49 → High → EDD', () => {
    const exp = explainableScore({ nationality: 'IR', isPep: true });
    expect(exp.rating).toBe('High');
    expect(exp.cddLevel).toBe('EDD');
  });

  it('15-29 → Medium → CDD', () => {
    // nationality=IR (+25) alone → score 25 → Medium rating, CDD level
    const exp = explainableScore({ nationality: 'IR' });
    expect(exp.rating).toBe('Medium');
    expect(exp.cddLevel).toBe('CDD');
  });

  it('<15 → Low → SDD', () => {
    const exp = explainableScore({ cashIntensity: 0.6 });
    expect(exp.rating).toBe('Low');
    expect(exp.cddLevel).toBe('SDD');
  });
});

describe('explainableScore — topFactors', () => {
  it('returns the highest contributors in order', () => {
    const exp = explainableScore({
      sanctionsMatchScore: 0.95,
      nationality: 'IR',
      isPep: true,
    });
    expect(exp.topFactors[0].name).toBe('Sanctions Match');
    expect(exp.topFactors[0].contribution).toBe(50);
    // In sorted order
    for (let i = 1; i < exp.topFactors.length; i++) {
      expect(exp.topFactors[i - 1].contribution).toBeGreaterThanOrEqual(
        exp.topFactors[i].contribution,
      );
    }
  });

  it('excludes zero contributors', () => {
    const exp = explainableScore({ cashIntensity: 0.9 });
    for (const f of exp.topFactors) {
      expect(f.contribution).not.toBe(0);
    }
  });

  it('caps at 5', () => {
    const exp = explainableScore({
      sanctionsMatchScore: 0.95,
      isPep: true,
      nationality: 'IR',
      cashIntensity: 0.9,
      hasUndisclosedUbo: true,
      adverseMediaHits: 10,
      hasHighSeverityAnomaly: true,
      customerType: 'trust',
    });
    expect(exp.topFactors.length).toBeLessThanOrEqual(5);
  });
});

describe('formatExplanation — markdown output', () => {
  it('produces a markdown document with all factors', () => {
    const exp = explainableScore({ sanctionsMatchScore: 0.95, isPep: true });
    const md = formatExplanation(exp, 'ACME Trading LLC');
    expect(md).toContain('# Risk Assessment — ACME Trading LLC');
    expect(md).toContain('**Score:** ');
    expect(md).toContain('**Rating:** Very High');
    expect(md).toContain('**CDD Level:** EDD');
    expect(md).toContain('Sanctions Match');
    expect(md).toContain('PEP Status');
  });

  it('cites regulatory basis for every factor', () => {
    const exp = explainableScore({ sanctionsMatchScore: 0.95 });
    const md = formatExplanation(exp, 'X');
    expect(md).toContain('Cabinet Res 74/2020');
  });
});
