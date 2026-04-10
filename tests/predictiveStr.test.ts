import { describe, it, expect } from 'vitest';
import {
  predictStr,
  rankEntitiesByStrRisk,
  explainStrPrediction,
  type StrFeatures,
} from '@/services/predictiveStr';

const baseline: StrFeatures = {
  priorAlerts90d: 0,
  txValue30dAED: 0,
  nearThresholdCount30d: 0,
  crossBorderRatio30d: 0,
  isPep: false,
  highRiskJurisdiction: false,
  hasAdverseMedia: false,
  daysSinceOnboarding: 365,
  sanctionsMatchScore: 0,
  cashRatio30d: 0,
};

describe('predictiveStr — baseline', () => {
  it('clean entity with long tenure is low risk', () => {
    const p = predictStr(baseline);
    expect(p.band).toBe('low');
    expect(p.probability).toBeLessThan(0.1);
    expect(p.recommendation).toBe('monitor');
  });

  it('sanctions match dominates and pushes to critical', () => {
    const p = predictStr({ ...baseline, sanctionsMatchScore: 0.95 });
    expect(p.band).toBe('critical');
    expect(p.probability).toBeGreaterThan(0.8);
    expect(p.recommendation).toBe('file-str');
  });

  it('PEP + high-risk jurisdiction elevates to high/critical', () => {
    const p = predictStr({
      ...baseline,
      isPep: true,
      highRiskJurisdiction: true,
      cashRatio30d: 0.6,
    });
    expect(['high', 'critical']).toContain(p.band);
  });
});

describe('predictiveStr — explainability', () => {
  it('every feature is accounted for in factors', () => {
    const p = predictStr(baseline);
    const names = p.factors.map((f) => f.feature).sort();
    expect(names).toContain('sanctionsMatchScore');
    expect(names).toContain('priorAlerts90d');
    expect(names).toHaveLength(10);
  });

  it('factors are sorted by absolute contribution', () => {
    const p = predictStr({
      ...baseline,
      sanctionsMatchScore: 0.9,
      isPep: true,
    });
    for (let i = 1; i < p.factors.length; i++) {
      expect(Math.abs(p.factors[i - 1].contribution)).toBeGreaterThanOrEqual(
        Math.abs(p.factors[i].contribution),
      );
    }
  });

  it('explainStrPrediction mentions top drivers', () => {
    const p = predictStr({
      ...baseline,
      isPep: true,
      hasAdverseMedia: true,
      highRiskJurisdiction: true,
    });
    const text = explainStrPrediction(p);
    expect(text).toContain('%');
    expect(text).toMatch(/isPep|hasAdverseMedia|highRiskJurisdiction/);
  });
});

describe('predictiveStr — ranking', () => {
  it('ranks entities by descending risk', () => {
    const entities = [
      { entity: 'low', features: baseline },
      {
        entity: 'high',
        features: {
          ...baseline,
          sanctionsMatchScore: 0.95,
          isPep: true,
        },
      },
      {
        entity: 'medium',
        features: {
          ...baseline,
          priorAlerts90d: 5,
          cashRatio30d: 0.5,
        },
      },
    ];
    const ranked = rankEntitiesByStrRisk(entities);
    expect(ranked[0].entity).toBe('high');
    expect(ranked[ranked.length - 1].entity).toBe('low');
  });
});
