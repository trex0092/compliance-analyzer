import { describe, it, expect } from 'vitest';
import {
  assessSaleVat,
  detectCircularTrades,
  type GoldSale,
} from '@/services/investmentGoldVat';

describe('assessSaleVat — classification', () => {
  it('999.9 fineness bar declared at 0% → consistent', () => {
    const sale: GoldSale = {
      transactionId: 'T-1',
      at: '2026-04-10T10:00:00Z',
      sellerId: 'A',
      buyerId: 'B',
      lines: [
        {
          lineId: 'L1',
          form: 'bar',
          fineness: 999.9,
          quantityUnits: 1,
          unitPriceAED: 300_000,
          declaredVatRate: 0,
        },
      ],
    };
    const report = assessSaleVat(sale);
    expect(report.misclassifiedLines).toBe(0);
    expect(report.totalDiscrepancy).toBe(0);
    expect(report.hasCarouselSignals).toBe(false);
  });

  it('jewellery at 5% VAT → consistent', () => {
    const sale: GoldSale = {
      transactionId: 'T-2',
      at: '2026-04-10T10:00:00Z',
      sellerId: 'A',
      buyerId: 'B',
      lines: [
        {
          lineId: 'L1',
          form: 'jewellery',
          fineness: 750,
          quantityUnits: 1,
          unitPriceAED: 10_000,
          declaredVatRate: 0.05,
        },
      ],
    };
    const report = assessSaleVat(sale);
    expect(report.misclassifiedLines).toBe(0);
  });

  it('investment-grade bullion declared at 5% → CAROUSEL SIGNAL', () => {
    const sale: GoldSale = {
      transactionId: 'T-3',
      at: '2026-04-10T10:00:00Z',
      sellerId: 'A',
      buyerId: 'B',
      lines: [
        {
          lineId: 'L1',
          form: 'bar',
          fineness: 999.9,
          quantityUnits: 10,
          unitPriceAED: 300_000,
          declaredVatRate: 0.05, // WRONG — should be 0
        },
      ],
    };
    const report = assessSaleVat(sale);
    expect(report.misclassifiedLines).toBe(1);
    expect(report.hasCarouselSignals).toBe(true);
    expect(report.carouselSignals[0]).toContain('investment-grade');
  });

  it('jewellery declared at 0% → misclassified (the reverse mistake)', () => {
    const sale: GoldSale = {
      transactionId: 'T-4',
      at: '2026-04-10T10:00:00Z',
      sellerId: 'A',
      buyerId: 'B',
      lines: [
        {
          lineId: 'L1',
          form: 'jewellery',
          fineness: 750,
          quantityUnits: 1,
          unitPriceAED: 10_000,
          declaredVatRate: 0,
        },
      ],
    };
    const report = assessSaleVat(sale);
    expect(report.misclassifiedLines).toBe(1);
    expect(report.totalDiscrepancy).toBe(500); // 10K × 5%
  });
});

describe('assessSaleVat — carousel signals', () => {
  it('new seller + high value → carousel signal', () => {
    const sale: GoldSale = {
      transactionId: 'T-5',
      at: '2026-04-10T10:00:00Z',
      sellerEstablishedDate: '2026-03-01T00:00:00Z', // 40 days old
      sellerId: 'NEW',
      buyerId: 'B',
      lines: [
        {
          lineId: 'L1',
          form: 'bar',
          fineness: 999.9,
          quantityUnits: 5,
          unitPriceAED: 300_000,
          declaredVatRate: 0,
        },
      ],
    };
    const report = assessSaleVat(sale);
    expect(report.hasCarouselSignals).toBe(true);
    expect(report.carouselSignals.some((s) => /new-entity/.test(s))).toBe(true);
  });

  it('round-number VAT across multiple lines → carousel signal', () => {
    const sale: GoldSale = {
      transactionId: 'T-6',
      at: '2026-04-10T10:00:00Z',
      sellerId: 'A',
      buyerId: 'B',
      lines: [
        { lineId: 'L1', form: 'jewellery', fineness: 750, quantityUnits: 1, unitPriceAED: 200_000, declaredVatRate: 0.05 },
        { lineId: 'L2', form: 'jewellery', fineness: 750, quantityUnits: 1, unitPriceAED: 100_000, declaredVatRate: 0.05 },
        { lineId: 'L3', form: 'jewellery', fineness: 750, quantityUnits: 1, unitPriceAED: 60_000, declaredVatRate: 0.05 },
      ],
    };
    const report = assessSaleVat(sale);
    expect(report.hasCarouselSignals).toBe(true);
    expect(report.carouselSignals.some((s) => /round-number/.test(s))).toBe(true);
  });
});

describe('assessSaleVat — totals', () => {
  it('aggregates line values and VAT correctly', () => {
    const sale: GoldSale = {
      transactionId: 'T-7',
      at: '2026-04-10T10:00:00Z',
      sellerId: 'A',
      buyerId: 'B',
      lines: [
        { lineId: 'L1', form: 'bar', fineness: 999.9, quantityUnits: 1, unitPriceAED: 300_000, declaredVatRate: 0 },
        { lineId: 'L2', form: 'jewellery', fineness: 750, quantityUnits: 1, unitPriceAED: 100_000, declaredVatRate: 0.05 },
      ],
    };
    const report = assessSaleVat(sale);
    expect(report.totalValue).toBe(400_000);
    expect(report.totalExpectedVat).toBe(5_000); // Only jewellery line
    expect(report.totalDeclaredVat).toBe(5_000);
    expect(report.totalDiscrepancy).toBe(0);
  });
});

describe('detectCircularTrades', () => {
  it('detects an A → B → C → A cycle within the window', () => {
    const baseValue = 1_000_000;
    const sales: GoldSale[] = [
      {
        transactionId: 'S1',
        at: '2026-04-10T10:00:00Z',
        sellerId: 'A',
        buyerId: 'B',
        lines: [{ lineId: 'L1', form: 'bar', fineness: 999.9, quantityUnits: 1, unitPriceAED: baseValue, declaredVatRate: 0 }],
      },
      {
        transactionId: 'S2',
        at: '2026-04-10T14:00:00Z',
        sellerId: 'B',
        buyerId: 'C',
        lines: [{ lineId: 'L1', form: 'bar', fineness: 999.9, quantityUnits: 1, unitPriceAED: baseValue, declaredVatRate: 0 }],
      },
      {
        transactionId: 'S3',
        at: '2026-04-10T18:00:00Z',
        sellerId: 'C',
        buyerId: 'A',
        lines: [{ lineId: 'L1', form: 'bar', fineness: 999.9, quantityUnits: 1, unitPriceAED: baseValue, declaredVatRate: 0 }],
      },
    ];
    const cycles = detectCircularTrades(sales);
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0].path[0]).toBe('A');
    expect(cycles[0].path[cycles[0].path.length - 1]).toBe('A');
  });

  it('does not flag linear A → B → C', () => {
    const sales: GoldSale[] = [
      {
        transactionId: 'S1',
        at: '2026-04-10T10:00:00Z',
        sellerId: 'A',
        buyerId: 'B',
        lines: [{ lineId: 'L1', form: 'bar', fineness: 999.9, quantityUnits: 1, unitPriceAED: 1_000_000, declaredVatRate: 0 }],
      },
      {
        transactionId: 'S2',
        at: '2026-04-10T14:00:00Z',
        sellerId: 'B',
        buyerId: 'C',
        lines: [{ lineId: 'L1', form: 'bar', fineness: 999.9, quantityUnits: 1, unitPriceAED: 1_000_000, declaredVatRate: 0 }],
      },
    ];
    const cycles = detectCircularTrades(sales);
    expect(cycles).toHaveLength(0);
  });

  it('does not flag a cycle outside the window', () => {
    const sales: GoldSale[] = [
      {
        transactionId: 'S1',
        at: '2026-04-10T10:00:00Z',
        sellerId: 'A',
        buyerId: 'B',
        lines: [{ lineId: 'L1', form: 'bar', fineness: 999.9, quantityUnits: 1, unitPriceAED: 1_000_000, declaredVatRate: 0 }],
      },
      {
        transactionId: 'S2',
        at: '2026-04-15T10:00:00Z',
        sellerId: 'B',
        buyerId: 'C',
        lines: [{ lineId: 'L1', form: 'bar', fineness: 999.9, quantityUnits: 1, unitPriceAED: 1_000_000, declaredVatRate: 0 }],
      },
      {
        transactionId: 'S3',
        at: '2026-04-20T10:00:00Z',
        sellerId: 'C',
        buyerId: 'A',
        lines: [{ lineId: 'L1', form: 'bar', fineness: 999.9, quantityUnits: 1, unitPriceAED: 1_000_000, declaredVatRate: 0 }],
      },
    ];
    const cycles = detectCircularTrades(sales, 48);
    expect(cycles).toHaveLength(0);
  });
});
