import { describe, it, expect } from 'vitest';
import {
  backtest,
  compareBacktests,
  type HistoricalCase,
  type PolicyFunction,
} from '@/services/complianceBacktest';

const cases: HistoricalCase[] = [
  {
    id: 'C1',
    decidedAtIso: '2026-01-01T00:00:00Z',
    features: { sanctions: 1, pep: 0, cash: 0 },
    historicalVerdict: 'freeze',
    groundTruthConfirmed: true,
  },
  {
    id: 'C2',
    decidedAtIso: '2026-01-02T00:00:00Z',
    features: { sanctions: 0, pep: 1, cash: 1 },
    historicalVerdict: 'escalate',
    groundTruthConfirmed: true,
  },
  {
    id: 'C3',
    decidedAtIso: '2026-01-03T00:00:00Z',
    features: { sanctions: 0, pep: 0, cash: 1 },
    historicalVerdict: 'flag',
  },
  {
    id: 'C4',
    decidedAtIso: '2026-01-04T00:00:00Z',
    features: { sanctions: 0, pep: 0, cash: 0 },
    historicalVerdict: 'pass',
  },
];

const oldPolicy: PolicyFunction = (f) => {
  if (f.sanctions === 1) return 'freeze';
  if (f.pep === 1) return 'escalate';
  if (f.cash === 1) return 'flag';
  return 'pass';
};

describe('complianceBacktest — identical policy', () => {
  it('100% agreement when replaying the original policy', () => {
    const report = backtest(cases, oldPolicy);
    expect(report.agreementRate).toBe(1);
    expect(report.disagreements).toHaveLength(0);
    expect(report.f1).toBe(1);
  });
});

describe('complianceBacktest — stricter policy (more flags)', () => {
  const strictPolicy: PolicyFunction = (f) => {
    if (f.sanctions === 1) return 'freeze';
    if (f.pep === 1 || f.cash === 1) return 'escalate';
    return 'flag'; // never pass
  };

  it('detects upgrades and disagreements', () => {
    const report = backtest(cases, strictPolicy);
    expect(report.falsePositives).toBeGreaterThan(0);
    expect(report.disagreements.length).toBeGreaterThan(0);
    expect(report.disagreements.some((d) => d.direction === 'upgrade')).toBe(true);
  });

  it('recall stays high or improves', () => {
    const report = backtest(cases, strictPolicy);
    expect(report.recall).toBeGreaterThanOrEqual(0.9);
  });
});

describe('complianceBacktest — weaker policy (confirmed FN)', () => {
  const weakPolicy: PolicyFunction = () => 'pass';

  it('confirmed false negatives are counted', () => {
    const report = backtest(cases, weakPolicy);
    expect(report.confirmedFalseNegatives).toBe(2);
    expect(report.falseNegatives).toBeGreaterThan(0);
    expect(report.recall).toBe(0);
  });
});

describe('complianceBacktest — comparison', () => {
  it('compares two backtest reports head to head', () => {
    const reportA = backtest(cases, oldPolicy);
    const weakPolicy: PolicyFunction = () => 'pass';
    const reportB = backtest(cases, weakPolicy);
    const cmp = compareBacktests(reportA, reportB);
    expect(cmp.recommendation).toBe('A');
    expect(cmp.recallDelta).toBeLessThan(0);
  });
});
