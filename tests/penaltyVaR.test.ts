import { describe, it, expect } from 'vitest';
import { runPenaltyVaR, UAE_DPMS_VIOLATIONS } from '@/services/penaltyVaR';

describe('penaltyVaR — deterministic simulation', () => {
  it('same seed produces identical reports', () => {
    const a = runPenaltyVaR(UAE_DPMS_VIOLATIONS, { trials: 500, confidence: 0.95, seed: 1 });
    const b = runPenaltyVaR(UAE_DPMS_VIOLATIONS, { trials: 500, confidence: 0.95, seed: 1 });
    expect(a.valueAtRisk).toBe(b.valueAtRisk);
    expect(a.expectedLoss).toBe(b.expectedLoss);
  });

  it('different seeds produce different reports', () => {
    const a = runPenaltyVaR(UAE_DPMS_VIOLATIONS, { trials: 1000, confidence: 0.95, seed: 1 });
    const b = runPenaltyVaR(UAE_DPMS_VIOLATIONS, { trials: 1000, confidence: 0.95, seed: 2 });
    expect(a.valueAtRisk).not.toBe(b.valueAtRisk);
  });

  it('VaR is greater than or equal to expected loss', () => {
    const r = runPenaltyVaR(UAE_DPMS_VIOLATIONS, { trials: 2000, confidence: 0.95, seed: 7 });
    expect(r.valueAtRisk).toBeGreaterThanOrEqual(r.expectedLoss);
  });

  it('expected shortfall >= VaR', () => {
    const r = runPenaltyVaR(UAE_DPMS_VIOLATIONS, { trials: 2000, confidence: 0.95, seed: 7 });
    expect(r.expectedShortfall).toBeGreaterThanOrEqual(r.valueAtRisk);
  });

  it('higher confidence → higher VaR', () => {
    const r95 = runPenaltyVaR(UAE_DPMS_VIOLATIONS, {
      trials: 2000,
      confidence: 0.95,
      seed: 11,
    });
    const r99 = runPenaltyVaR(UAE_DPMS_VIOLATIONS, {
      trials: 2000,
      confidence: 0.99,
      seed: 11,
    });
    expect(r99.valueAtRisk).toBeGreaterThanOrEqual(r95.valueAtRisk);
  });

  it('rejects invalid config', () => {
    expect(() =>
      runPenaltyVaR(UAE_DPMS_VIOLATIONS, { trials: 0, confidence: 0.95 }),
    ).toThrow();
    expect(() =>
      runPenaltyVaR(UAE_DPMS_VIOLATIONS, { trials: 100, confidence: 0 }),
    ).toThrow();
  });
});

describe('penaltyVaR — per-violation contribution', () => {
  it('each violation receives a contribution estimate', () => {
    const r = runPenaltyVaR(UAE_DPMS_VIOLATIONS, {
      trials: 2000,
      confidence: 0.95,
      seed: 3,
    });
    expect(r.byViolation).toHaveLength(UAE_DPMS_VIOLATIONS.length);
    for (const b of r.byViolation) {
      expect(b.probabilityOfLoss).toBeGreaterThanOrEqual(0);
      expect(b.probabilityOfLoss).toBeLessThanOrEqual(1);
      expect(b.expectedContribution).toBeGreaterThanOrEqual(0);
    }
  });

  it('tipping off is rare but high severity', () => {
    const r = runPenaltyVaR(UAE_DPMS_VIOLATIONS, {
      trials: 10_000,
      confidence: 0.99,
      seed: 17,
    });
    const tipping = r.byViolation.find((v) => v.id === 'tipping_off');
    expect(tipping).toBeDefined();
    expect(tipping!.probabilityOfLoss).toBeLessThan(0.02);
  });
});

describe('penaltyVaR — boundary conditions', () => {
  it('zero-probability violation never contributes', () => {
    const r = runPenaltyVaR(
      [
        {
          id: 'z',
          description: 'impossible',
          annualProbability: 0,
          minPenalty: 1,
          maxPenalty: 2,
          regulatoryRef: '—',
        },
      ],
      { trials: 500, confidence: 0.95, seed: 1 },
    );
    expect(r.expectedLoss).toBe(0);
    expect(r.valueAtRisk).toBe(0);
  });
});
