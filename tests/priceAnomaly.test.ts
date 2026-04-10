import { describe, it, expect } from 'vitest';
import {
  assessPriceAnomaly,
  batchAssess,
  type BenchmarkPrice,
  type PricedTransaction,
} from '@/services/priceAnomaly';

const lbmaGold: BenchmarkPrice = {
  metal: 'gold',
  amPerTroyOzUsd: 2000,
  pmPerTroyOzUsd: 2010,
  date: '2026-04-10',
  source: 'LBMA',
};

function tx(overrides: Partial<PricedTransaction> = {}): PricedTransaction {
  return {
    id: 'TX-1',
    at: '2026-04-10T12:00:00Z',
    metal: 'gold',
    segment: 'investment_bar',
    quantityTroyOz: 400,
    pricePerTroyOzUsd: 2010,
    totalValueUsd: 804_000,
    ...overrides,
  };
}

describe('assessPriceAnomaly — investment bar (tight band)', () => {
  it('at benchmark → acceptable', () => {
    expect(assessPriceAnomaly(tx({ pricePerTroyOzUsd: 2010 }), lbmaGold).severity).toBe('acceptable');
  });

  it('+0.2% → acceptable', () => {
    expect(assessPriceAnomaly(tx({ pricePerTroyOzUsd: 2014 }), lbmaGold).severity).toBe('acceptable');
  });

  it('+0.5% → warning (outside 0.3% band)', () => {
    expect(assessPriceAnomaly(tx({ pricePerTroyOzUsd: 2020 }), lbmaGold).severity).toBe('warning');
  });

  it('+3% → critical', () => {
    expect(assessPriceAnomaly(tx({ pricePerTroyOzUsd: 2070 }), lbmaGold).severity).toBe('critical');
  });
});

describe('assessPriceAnomaly — retail jewellery', () => {
  it('+30% retail premium → acceptable', () => {
    expect(
      assessPriceAnomaly(tx({ segment: 'retail_jewellery', pricePerTroyOzUsd: 2613 }), lbmaGold).severity,
    ).toBe('acceptable');
  });

  it('+10% retail premium → warning (below 20% min)', () => {
    expect(
      assessPriceAnomaly(tx({ segment: 'retail_jewellery', pricePerTroyOzUsd: 2211 }), lbmaGold).severity,
    ).toBe('warning');
  });

  it('+200% retail markup → critical', () => {
    expect(
      assessPriceAnomaly(tx({ segment: 'retail_jewellery', pricePerTroyOzUsd: 6030 }), lbmaGold).severity,
    ).toBe('critical');
  });
});

describe('assessPriceAnomaly — scrap buy-back', () => {
  it('-10% buy-back discount → acceptable', () => {
    expect(
      assessPriceAnomaly(tx({ segment: 'scrap_buyback', pricePerTroyOzUsd: 1809 }), lbmaGold).severity,
    ).toBe('acceptable');
  });

  it('+5% scrap (dealer paying more than spot) → warning', () => {
    expect(
      assessPriceAnomaly(tx({ segment: 'scrap_buyback', pricePerTroyOzUsd: 2110 }), lbmaGold).severity,
    ).toBe('warning');
  });

  it('-30% scrap → critical', () => {
    expect(
      assessPriceAnomaly(tx({ segment: 'scrap_buyback', pricePerTroyOzUsd: 1407 }), lbmaGold).severity,
    ).toBe('critical');
  });
});

describe('assessPriceAnomaly — wholesale bullion', () => {
  it('-0.3% → acceptable (within ±0.5%)', () => {
    expect(
      assessPriceAnomaly(tx({ segment: 'wholesale_bullion', pricePerTroyOzUsd: 2004 }), lbmaGold).severity,
    ).toBe('acceptable');
  });

  it('+1% → warning', () => {
    expect(
      assessPriceAnomaly(tx({ segment: 'wholesale_bullion', pricePerTroyOzUsd: 2030 }), lbmaGold).severity,
    ).toBe('warning');
  });
});

describe('assessPriceAnomaly — metal mismatch', () => {
  it('throws when benchmark metal ≠ transaction metal', () => {
    expect(() =>
      assessPriceAnomaly(tx({ metal: 'silver' }), lbmaGold),
    ).toThrow(/mismatch/);
  });
});

describe('batchAssess', () => {
  it('matches transactions to benchmarks by date + metal', () => {
    const txs: PricedTransaction[] = [
      tx({ id: 'A', at: '2026-04-10T10:00:00Z', pricePerTroyOzUsd: 2010 }),
      tx({ id: 'B', at: '2026-04-10T11:00:00Z', pricePerTroyOzUsd: 2070, segment: 'investment_bar' }),
      tx({ id: 'C', at: '2026-04-09T10:00:00Z' }), // different date, no benchmark
    ];
    const results = batchAssess(txs, [lbmaGold]);
    expect(results.length).toBe(2);
    expect(results.find((r) => r.transactionId === 'A')?.severity).toBe('acceptable');
    expect(results.find((r) => r.transactionId === 'B')?.severity).toBe('critical');
  });

  it('returns empty when no benchmarks provided', () => {
    expect(batchAssess([tx()], [])).toHaveLength(0);
  });
});
