import { describe, it, expect } from 'vitest';
import { analyseDrift, type DriftSample } from '@/services/regulatoryDrift';

function uniform(n: number, lo: number, hi: number): number[] {
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / n);
}

describe('regulatoryDrift — stable portfolio', () => {
  it('same distribution → stable overall', () => {
    const baseline: DriftSample[] = uniform(1000, 0, 100).map((v) => ({ amount: v }));
    const current: DriftSample[] = uniform(1000, 0, 100).map((v) => ({ amount: v }));
    const report = analyseDrift(baseline, current);
    expect(report.overallBand).toBe('stable');
    expect(report.driftedFeatureCount).toBe(0);
  });
});

describe('regulatoryDrift — shifted continuous feature', () => {
  it('shifted mean triggers significant drift', () => {
    const baseline: DriftSample[] = uniform(1000, 0, 100).map((v) => ({ amount: v }));
    const current: DriftSample[] = uniform(1000, 50, 150).map((v) => ({ amount: v }));
    const report = analyseDrift(baseline, current);
    expect(report.overallBand).toBe('significant');
    expect(report.features[0].psi).toBeGreaterThan(0.25);
    expect(report.features[0].ksStatistic).toBeGreaterThan(0.2);
  });
});

describe('regulatoryDrift — categorical feature', () => {
  it('category rebalancing triggers drift', () => {
    const baseline: DriftSample[] = [
      ...Array.from({ length: 900 }, () => ({ country: 'UAE' })),
      ...Array.from({ length: 100 }, () => ({ country: 'IR' })),
    ];
    const current: DriftSample[] = [
      ...Array.from({ length: 500 }, () => ({ country: 'UAE' })),
      ...Array.from({ length: 500 }, () => ({ country: 'IR' })),
    ];
    const report = analyseDrift(baseline, current);
    expect(report.overallBand).toBe('significant');
    const country = report.features.find((f) => f.feature === 'country');
    expect(country).toBeDefined();
    expect(country!.band).toBe('significant');
  });
});

describe('regulatoryDrift — mixed features', () => {
  it('reports per-feature bands correctly', () => {
    const baseline: DriftSample[] = Array.from({ length: 500 }, (_, i) => ({
      amount: i,
      pep: i < 10 ? 'yes' : 'no',
    }));
    const current: DriftSample[] = Array.from({ length: 500 }, (_, i) => ({
      amount: i, // same distribution
      pep: i < 150 ? 'yes' : 'no', // big rebalance
    }));
    const report = analyseDrift(baseline, current);
    const amount = report.features.find((f) => f.feature === 'amount');
    const pep = report.features.find((f) => f.feature === 'pep');
    expect(amount!.band).toBe('stable');
    expect(pep!.band).toBe('significant');
  });
});

describe('regulatoryDrift — edge cases', () => {
  it('empty baseline yields empty report', () => {
    const report = analyseDrift([], [{ x: 1 }]);
    expect(report.features).toHaveLength(0);
  });
});
