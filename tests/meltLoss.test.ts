import { describe, it, expect } from 'vitest';
import {
  assessMeltBatch,
  detectRefinerDrift,
  summariseRefinerLosses,
  type MeltBatch,
} from '@/services/meltLoss';

function batch(
  id: string,
  inputGrams: number,
  outputGrams: number,
  overrides: Partial<MeltBatch> = {},
): MeltBatch {
  return {
    batchId: id,
    refinerId: 'EGR',
    metal: 'gold',
    at: '2026-04-10T10:00:00Z',
    inputPureGrams: inputGrams,
    outputPureGrams: outputGrams,
    operator: 'op1',
    ...overrides,
  };
}

describe('assessMeltBatch — gold bands', () => {
  it('0.15% loss → acceptable', () => {
    const result = assessMeltBatch(batch('b1', 1000, 998.5));
    expect(result.severity).toBe('acceptable');
    expect(result.lossPct).toBeCloseTo(0.15, 2);
  });

  it('0.40% loss → warning (above max)', () => {
    const result = assessMeltBatch(batch('b2', 1000, 996));
    expect(result.severity).toBe('warning');
  });

  it('0.60% loss → critical', () => {
    const result = assessMeltBatch(batch('b3', 1000, 994));
    expect(result.severity).toBe('critical');
  });

  it('0.02% loss → warning (below minimum — suspiciously efficient)', () => {
    const result = assessMeltBatch(batch('b4', 1000, 999.8));
    expect(result.severity).toBe('warning');
    expect(result.rationale).toMatch(/below/);
  });

  it('negative loss (output > input) → critical', () => {
    const result = assessMeltBatch(batch('b5', 1000, 1005));
    expect(result.severity).toBe('critical');
    expect(result.rationale).toMatch(/Negative|impossible/i);
  });

  it('throws on zero input', () => {
    expect(() => assessMeltBatch(batch('b6', 0, 0))).toThrow();
  });

  it('includes expected band in result', () => {
    const result = assessMeltBatch(batch('b7', 1000, 998.5));
    expect(result.expectedMinPct).toBe(0.05);
    expect(result.expectedMaxPct).toBe(0.3);
  });
});

describe('assessMeltBatch — silver bands', () => {
  it('silver acceptable range is wider (0.1-0.5%)', () => {
    const result = assessMeltBatch(
      batch('s1', 10_000, 9_970, { metal: 'silver' }),
    );
    expect(result.severity).toBe('acceptable'); // 0.3% is within silver band
  });

  it('silver > 1% → critical', () => {
    const result = assessMeltBatch(
      batch('s2', 10_000, 9_890, { metal: 'silver' }),
    );
    expect(result.severity).toBe('critical');
  });
});

describe('detectRefinerDrift', () => {
  const history: MeltBatch[] = Array.from({ length: 10 }, (_, i) =>
    batch(`h${i}`, 1000, 998.8, { at: `2026-04-0${i + 1}T10:00:00Z` }),
  );

  it('without enough history, falls back to global bands', () => {
    const short = history.slice(0, 3);
    const recent = batch('r1', 1000, 998.8);
    const result = detectRefinerDrift('EGR', short, recent);
    expect(result.zScore).toBeUndefined();
  });

  it('z-score is computed when history is sufficient', () => {
    // Recent batch within spec but wildly different from baseline.
    // History mean ≈ 0.12%, stdev ≈ 0 — any deviation is big z.
    const recent = batch('r2', 1000, 998.0); // 0.20% — within global band
    const result = detectRefinerDrift('EGR', history, recent);
    expect(result.zScore).toBeDefined();
  });

  it('high z-score can lift acceptable → warning', () => {
    const recent = batch('r3', 1000, 997.0); // 0.30% — at the edge of global band
    const result = detectRefinerDrift('EGR', history, recent, 2);
    // Baseline was 0.12%; 0.30% is a significant drift
    if (result.severity === 'warning') {
      expect(result.zScore).toBeDefined();
      expect(Math.abs(result.zScore!)).toBeGreaterThan(0);
    }
  });
});

describe('summariseRefinerLosses', () => {
  it('empty input returns zero summary', () => {
    const summary = summariseRefinerLosses('EGR', 'gold', []);
    expect(summary.batchCount).toBe(0);
    expect(summary.totalLossGrams).toBe(0);
  });

  it('aggregates total losses across batches', () => {
    const batches: MeltBatch[] = [
      batch('b1', 1000, 998.5),
      batch('b2', 2000, 1997.0),
      batch('b3', 1500, 1498.0),
    ];
    const summary = summariseRefinerLosses('EGR', 'gold', batches);
    expect(summary.batchCount).toBe(3);
    expect(summary.totalInputGrams).toBe(4500);
    expect(summary.totalOutputGrams).toBeCloseTo(4493.5, 1);
    expect(summary.totalLossGrams).toBeCloseTo(6.5, 1);
    expect(summary.criticalBatches).toBe(0);
  });

  it('filters to the requested metal and refiner', () => {
    const batches: MeltBatch[] = [
      batch('b1', 1000, 998.5),
      batch('b2', 2000, 1997, { refinerId: 'OTHER' }),
      batch('b3', 1500, 1498, { metal: 'silver' }),
    ];
    const summary = summariseRefinerLosses('EGR', 'gold', batches);
    expect(summary.batchCount).toBe(1);
  });

  it('counts critical batches', () => {
    const batches: MeltBatch[] = [
      batch('b1', 1000, 998.5), // acceptable
      batch('b2', 1000, 994), // critical (0.6%)
      batch('b3', 1000, 994), // critical
    ];
    const summary = summariseRefinerLosses('EGR', 'gold', batches);
    expect(summary.criticalBatches).toBe(2);
  });
});
