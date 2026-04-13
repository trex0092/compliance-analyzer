import { describe, expect, it } from 'vitest';
import { pickCostTier, estimateComplexity } from '@/services/costTierRouter';
import { EXECUTOR_HAIKU, EXECUTOR_SONNET, EXECUTOR_OPUS } from '@/services/advisorStrategy';

describe('pickCostTier', () => {
  it('returns SONNET by default for moderate complexity and urgency', () => {
    const r = pickCostTier({ complexity: 0.5, urgency: 0.5, budgetUsed: 0 });
    expect(r.tier).toBe('SONNET_MID');
    expect(r.executor).toBe(EXECUTOR_SONNET);
    expect(r.budgetAlert).toBe(false);
  });

  it('downshifts to HAIKU for trivial routine checks', () => {
    const r = pickCostTier({ complexity: 0.1, urgency: 0.1, budgetUsed: 0 });
    expect(r.tier).toBe('HAIKU_FAST');
    expect(r.executor).toBe(EXECUTOR_HAIKU);
  });

  it('promotes to OPUS for regulator-grade complexity', () => {
    const r = pickCostTier({ complexity: 0.9, urgency: 0.5, budgetUsed: 0 });
    expect(r.tier).toBe('OPUS_HIGH');
    expect(r.executor).toBe(EXECUTOR_OPUS);
  });

  it('promotes to OPUS when complexity is moderate but urgency is extreme', () => {
    const r = pickCostTier({ complexity: 0.65, urgency: 0.85, budgetUsed: 0 });
    expect(r.tier).toBe('OPUS_HIGH');
  });

  it('forceOpus wins over everything', () => {
    const r = pickCostTier({
      complexity: 0.1,
      urgency: 0.1,
      budgetUsed: 0,
      forceOpus: true,
    });
    expect(r.tier).toBe('OPUS_HIGH');
  });

  it('capAtSonnet downgrades OPUS back to SONNET', () => {
    const r = pickCostTier({
      complexity: 0.9,
      urgency: 0.9,
      budgetUsed: 0,
      capAtSonnet: true,
    });
    expect(r.tier).toBe('SONNET_MID');
  });

  it('downshifts one tier when budget alert threshold is hit', () => {
    const r = pickCostTier({ complexity: 0.9, urgency: 0.9, budgetUsed: 0.9 });
    expect(r.tier).toBe('SONNET_MID');
    expect(r.budgetAlert).toBe(true);
  });

  it('forces HAIKU when budget hard-limit is hit even with forceOpus', () => {
    const r = pickCostTier({
      complexity: 1,
      urgency: 1,
      budgetUsed: 0.99,
      forceOpus: true,
    });
    expect(r.tier).toBe('HAIKU_FAST');
    expect(r.budgetAlert).toBe(true);
  });
});

describe('estimateComplexity', () => {
  it('returns 0.2 for a baseline customer with no risk signals', () => {
    expect(
      estimateComplexity({
        hasSanctionsMatch: false,
        hasAdverseMedia: false,
        isPep: false,
        isCrossBorder: false,
        isHighRiskJurisdiction: false,
        hasFourEyesPending: false,
        hasDriftAlert: false,
      })
    ).toBeCloseTo(0.2, 10);
  });

  it('promotes to max (1.0) when every signal is set', () => {
    expect(
      estimateComplexity({
        hasSanctionsMatch: true,
        hasAdverseMedia: true,
        isPep: true,
        isCrossBorder: true,
        isHighRiskJurisdiction: true,
        hasFourEyesPending: true,
        hasDriftAlert: true,
      })
    ).toBeCloseTo(1, 3);
  });

  it('is monotonic — adding a signal only increases the score', () => {
    const base = estimateComplexity({
      hasSanctionsMatch: false,
      hasAdverseMedia: false,
      isPep: false,
      isCrossBorder: false,
      isHighRiskJurisdiction: false,
      hasFourEyesPending: false,
      hasDriftAlert: false,
    });
    const withSanctions = estimateComplexity({
      hasSanctionsMatch: true,
      hasAdverseMedia: false,
      isPep: false,
      isCrossBorder: false,
      isHighRiskJurisdiction: false,
      hasFourEyesPending: false,
      hasDriftAlert: false,
    });
    expect(withSanctions).toBeGreaterThan(base);
  });
});
