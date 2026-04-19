import { describe, it, expect } from 'vitest';
import { selectDynamicPrior, classifyListPriority } from '../src/services/dynamicPrior';

describe('selectDynamicPrior — tier + list priority', () => {
  it('low + primary → 0.05 * 1.0 = 0.05', () => {
    const r = selectDynamicPrior({ riskTier: 'low', listPriority: 'primary' });
    expect(r.prior).toBeCloseTo(0.05, 5);
    expect(r.reasoning.length).toBeGreaterThanOrEqual(2);
  });

  it('medium + primary → 0.10', () => {
    const r = selectDynamicPrior({ riskTier: 'medium', listPriority: 'primary' });
    expect(r.prior).toBeCloseTo(0.1, 5);
  });

  it('high + primary → 0.25', () => {
    const r = selectDynamicPrior({ riskTier: 'high', listPriority: 'primary' });
    expect(r.prior).toBeCloseTo(0.25, 5);
  });

  it('secondary list multiplier (0.7) shrinks the prior', () => {
    const p = selectDynamicPrior({ riskTier: 'high', listPriority: 'primary' }).prior;
    const s = selectDynamicPrior({ riskTier: 'high', listPriority: 'secondary' }).prior;
    expect(s).toBeLessThan(p);
    expect(s).toBeCloseTo(0.25 * 0.7, 5);
  });

  it('watchlist list multiplier (0.5) shrinks the prior further', () => {
    const w = selectDynamicPrior({ riskTier: 'high', listPriority: 'watchlist' }).prior;
    expect(w).toBeCloseTo(0.25 * 0.5, 5);
  });
});

describe('selectDynamicPrior — boost signals', () => {
  it('recent alerts bump the prior by up to 0.15', () => {
    const base = selectDynamicPrior({ riskTier: 'medium', listPriority: 'primary' }).prior;
    const boosted = selectDynamicPrior({
      riskTier: 'medium',
      listPriority: 'primary',
      recentAlertCount: 3,
    }).prior;
    expect(boosted).toBeGreaterThan(base);
    expect(boosted - base).toBeLessThanOrEqual(0.15 + 1e-9);
  });

  it('PEP flag adds +0.10', () => {
    const base = selectDynamicPrior({ riskTier: 'medium', listPriority: 'primary' }).prior;
    const pep = selectDynamicPrior({
      riskTier: 'medium',
      listPriority: 'primary',
      isPep: true,
    }).prior;
    expect(pep - base).toBeCloseTo(0.1, 5);
  });

  it('adverse-media flag adds +0.05', () => {
    const base = selectDynamicPrior({ riskTier: 'medium', listPriority: 'primary' }).prior;
    const am = selectDynamicPrior({
      riskTier: 'medium',
      listPriority: 'primary',
      hasRecentAdverseMedia: true,
    }).prior;
    expect(am - base).toBeCloseTo(0.05, 5);
  });

  it('clamps at 0.45 even when every booster fires', () => {
    const r = selectDynamicPrior({
      riskTier: 'high',
      listPriority: 'primary',
      recentAlertCount: 10,
      isPep: true,
      hasRecentAdverseMedia: true,
    });
    expect(r.prior).toBeCloseTo(0.45, 5);
    expect(r.reasoning.some((l) => l.includes('Clamped'))).toBe(true);
  });

  it('never drops below 0.02', () => {
    const r = selectDynamicPrior({ riskTier: 'low', listPriority: 'watchlist' });
    expect(r.prior).toBeGreaterThanOrEqual(0.02);
  });
});

describe('classifyListPriority', () => {
  it('recognises the primary publishers', () => {
    expect(classifyListPriority('UN')).toBe('primary');
    expect(classifyListPriority('OFAC_SDN')).toBe('primary');
    expect(classifyListPriority('EU')).toBe('primary');
    expect(classifyListPriority('UK')).toBe('primary');
    expect(classifyListPriority('UAE_EOCN')).toBe('primary');
  });

  it('recognises secondary lists', () => {
    expect(classifyListPriority('OFAC_CONSOLIDATED')).toBe('secondary');
    expect(classifyListPriority('UAE_LOCAL')).toBe('secondary');
  });

  it('falls back to watchlist', () => {
    expect(classifyListPriority('INTERNAL')).toBe('watchlist');
    expect(classifyListPriority('pep-feed')).toBe('watchlist');
  });

  it('handles whitespace + case', () => {
    expect(classifyListPriority('  un  ')).toBe('primary');
  });
});
