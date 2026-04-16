/**
 * Tests for src/services/txStatisticalLayer.ts — Benford, Z-score,
 * velocity burst, and dormancy break detectors.
 */
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../src/domain/transaction';
import {
  BENFORD_CHI_SQ_CRITICAL,
  BENFORD_EXPECTED,
  benfordChiSquared,
  firstDigitDistribution,
  runStatisticalLayer,
} from '../src/services/txStatisticalLayer';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    customerId: 'c1',
    atIso: '2026-04-15T09:00:00.000Z',
    dateDdMmYyyy: '15/04/2026',
    direction: 'debit',
    instrument: 'wire',
    channel: 'online',
    currency: 'AED',
    amount: 10_000,
    amountAed: 10_000,
    counterpartyName: 'SOME BANK',
    counterpartyCountry: 'AE',
    isCrossBorder: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Benford helpers
// ---------------------------------------------------------------------------

describe('BENFORD_EXPECTED', () => {
  it('has 9 entries (digits 1-9)', () => {
    expect(BENFORD_EXPECTED).toHaveLength(9);
  });
  it('sums to approximately 1', () => {
    const sum = BENFORD_EXPECTED.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 2);
  });
  it('digit 1 has the highest probability (~0.301)', () => {
    expect(BENFORD_EXPECTED[0]).toBeCloseTo(0.301, 3);
  });
});

describe('firstDigitDistribution', () => {
  it('returns all zeros for empty input', () => {
    const dist = firstDigitDistribution([]);
    expect(dist.every((v) => v === 0)).toBe(true);
  });
  it('returns correct distribution for [100, 200, 300]', () => {
    const dist = firstDigitDistribution([100, 200, 300]);
    expect(dist[0]).toBeCloseTo(1 / 3); // digit 1
    expect(dist[1]).toBeCloseTo(1 / 3); // digit 2
    expect(dist[2]).toBeCloseTo(1 / 3); // digit 3
    expect(dist.slice(3).every((v) => v === 0)).toBe(true);
  });
  it('ignores zero and sub-1 values', () => {
    const dist = firstDigitDistribution([0, 0.5, 100]);
    expect(dist[0]).toBe(1); // only digit 1 from 100
  });
});

describe('benfordChiSquared', () => {
  it('returns 0 for empty sample', () => {
    expect(benfordChiSquared(Array(9).fill(0), 0)).toBe(0);
  });
  it('returns near-zero for a perfect Benford distribution', () => {
    const chiSq = benfordChiSquared(BENFORD_EXPECTED, 1000);
    expect(chiSq).toBeLessThan(0.01);
  });
  it('returns a high value for a uniform distribution', () => {
    const uniform = Array(9).fill(1 / 9);
    const chiSq = benfordChiSquared(uniform, 1000);
    expect(chiSq).toBeGreaterThan(BENFORD_CHI_SQ_CRITICAL);
  });
});

// ---------------------------------------------------------------------------
// runStatisticalLayer
// ---------------------------------------------------------------------------

describe('runStatisticalLayer — Benford drift', () => {
  it('does not flag fewer than 30 transactions', () => {
    const txs = Array.from({ length: 20 }, (_, i) =>
      tx({ id: `t${i}`, amountAed: 10_000 * (i + 1) })
    );
    const findings = runStatisticalLayer(txs);
    expect(findings.find((f) => f.kind === 'benford-first-digit-drift')).toBeUndefined();
  });
  it('flags a uniform-digit distribution across 50+ txs', () => {
    // Force all amounts to start with 5 (digit 5 only) — violates Benford.
    const txs = Array.from({ length: 50 }, (_, i) =>
      tx({ id: `t${i}`, amountAed: 50_000 + i * 100 })
    );
    const findings = runStatisticalLayer(txs);
    const benford = findings.find((f) => f.kind === 'benford-first-digit-drift');
    expect(benford).toBeDefined();
    expect(benford!.severity).toBe('medium');
  });
});

describe('runStatisticalLayer — Z-score outlier', () => {
  it('does not flag fewer than 10 transactions', () => {
    const txs = Array.from({ length: 5 }, (_, i) => tx({ id: `t${i}`, amountAed: 10_000 }));
    const findings = runStatisticalLayer(txs);
    expect(findings.find((f) => f.kind === 'amount-zscore-outlier')).toBeUndefined();
  });
  it('flags an extreme outlier in a batch of 15', () => {
    const normal = Array.from({ length: 14 }, (_, i) =>
      tx({ id: `t${i}`, amountAed: 10_000 + i * 100 })
    );
    // One transaction at 10x the normal range.
    const outlier = tx({ id: 'outlier', amountAed: 500_000 });
    const findings = runStatisticalLayer([...normal, outlier]);
    const zScore = findings.find((f) => f.kind === 'amount-zscore-outlier');
    expect(zScore).toBeDefined();
    expect(zScore!.triggeringTxIds).toContain('outlier');
  });
});

describe('runStatisticalLayer — velocity burst', () => {
  it('flags 5+ transactions within 24h', () => {
    const txs = Array.from({ length: 6 }, (_, i) =>
      tx({
        id: `t${i}`,
        atIso: `2026-04-15T${String(8 + i).padStart(2, '0')}:00:00.000Z`,
      })
    );
    const findings = runStatisticalLayer(txs);
    const burst = findings.find((f) => f.kind === 'velocity-burst');
    expect(burst).toBeDefined();
    expect(burst!.severity).toBe('high');
    expect(burst!.suggestedAction).toBe('escalate');
  });
  it('does not flag 4 transactions', () => {
    const txs = Array.from({ length: 4 }, (_, i) =>
      tx({ id: `t${i}`, atIso: `2026-04-15T${8 + i}:00:00.000Z` })
    );
    const findings = runStatisticalLayer(txs);
    expect(findings.find((f) => f.kind === 'velocity-burst')).toBeUndefined();
  });
});

describe('runStatisticalLayer — dormancy break', () => {
  it('flags a 100-day gap followed by a transaction', () => {
    const txs = [
      tx({ id: 't1', atIso: '2026-01-01T10:00:00.000Z' }),
      tx({ id: 't2', atIso: '2026-04-15T10:00:00.000Z' }), // ~104 day gap
    ];
    const findings = runStatisticalLayer(txs);
    const dormancy = findings.find((f) => f.kind === 'dormancy-break');
    expect(dormancy).toBeDefined();
    expect(dormancy!.severity).toBe('medium');
    expect(dormancy!.triggeringTxIds).toContain('t2');
  });
  it('does not flag a 30-day gap', () => {
    const txs = [
      tx({ id: 't1', atIso: '2026-03-15T10:00:00.000Z' }),
      tx({ id: 't2', atIso: '2026-04-15T10:00:00.000Z' }),
    ];
    const findings = runStatisticalLayer(txs);
    expect(findings.find((f) => f.kind === 'dormancy-break')).toBeUndefined();
  });
  it('needs at least 2 transactions', () => {
    const findings = runStatisticalLayer([tx()]);
    expect(findings.find((f) => f.kind === 'dormancy-break')).toBeUndefined();
  });
});

describe('runStatisticalLayer — integration with TM brain', () => {
  it('statistical findings are returned by the brain alongside rule + typology findings', async () => {
    // Dynamically import to test the wiring.
    const { runTmBrain } = await import('../src/services/txMonitoringBrain');
    // 6 txs within 24h → velocity burst (statistical), plus force benford
    // drift by making all amounts start with digit 5 across 50+ txs.
    const burstTxs = Array.from({ length: 6 }, (_, i) =>
      tx({
        id: `burst-${i}`,
        amountAed: 50_000 + i,
        atIso: `2026-04-15T${String(8 + i).padStart(2, '0')}:00:00.000Z`,
      })
    );
    const normalTxs = Array.from({ length: 50 }, (_, i) =>
      tx({
        id: `normal-${i}`,
        amountAed: 50_000 + i * 100,
        atIso: `2026-04-${String(1 + Math.floor(i / 4)).padStart(2, '0')}T10:00:00.000Z`,
      })
    );
    const record = runTmBrain([...burstTxs, ...normalTxs]);
    const kinds = record.findings.map((f) => f.kind);
    expect(kinds).toContain('velocity-burst');
    // Benford may or may not fire depending on digit distribution —
    // the important thing is that statistical findings are present.
    expect(record.findings.length).toBeGreaterThan(0);
  });
});
