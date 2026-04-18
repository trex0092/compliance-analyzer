/**
 * Tests for src/services/tradeBasedML.ts — FATF TBML typology signals.
 */
import { describe, it, expect } from 'vitest';
import { analyzeTbml, type Shipment, type PriceReference } from '@/services/tradeBasedML';

const BASE: Shipment = {
  id: 'ship-1',
  goodsCode: 'GOLD-BAR-100G',
  goodsDescription: 'Investment-grade gold bar 100g',
  quantity: 10,
  unit: 'pcs',
  invoicedAmount: 60_000,
  invoicedCurrency: 'USD',
  originCountry: 'CH',
  destinationCountry: 'AE',
  consignor: 'Zurich Refiners AG',
  consignee: 'Dubai Gold Trader LLC',
  shipmentDate: '2026-04-01',
};

const PRICE: PriceReference = {
  goodsCode: 'GOLD-BAR-100G',
  unit: 'pcs',
  price: 6_000,
  currency: 'USD',
  source: 'LBMA_PM',
  fetchedAt: '2026-04-01',
};

describe('tradeBasedML.analyzeTbml', () => {
  it('raises over-invoicing when invoiced > 1.5x reference', () => {
    const res = analyzeTbml(
      { ...BASE, invoicedAmount: 150_000 },
      () => PRICE,
      []
    );
    expect(res.signals.some((s) => s.id === 'over_invoicing')).toBe(true);
    expect(res.riskScore).toBeGreaterThan(0);
  });

  it('raises under-invoicing when invoiced < 0.66x reference', () => {
    const res = analyzeTbml(
      { ...BASE, invoicedAmount: 20_000 },
      () => PRICE,
      []
    );
    expect(res.signals.some((s) => s.id === 'under_invoicing')).toBe(true);
  });

  it('raises multi-invoicing when duplicate peer shipment exists', () => {
    const peer: Shipment = { ...BASE, id: 'ship-2', invoicedAmount: 55_000 };
    const res = analyzeTbml(BASE, () => PRICE, [peer]);
    expect(res.signals.some((s) => s.id === 'multi_invoicing')).toBe(true);
  });

  it('raises high-risk routing when routing includes a sanctioned jurisdiction', () => {
    const res = analyzeTbml(
      { ...BASE, routingCountries: ['IR'] },
      () => PRICE,
      []
    );
    expect(res.signals.some((s) => s.id === 'high_risk_routing')).toBe(true);
  });

  it('raises dual_use signal when dualUseFlag is set', () => {
    const res = analyzeTbml(
      { ...BASE, dualUseFlag: true },
      () => PRICE,
      []
    );
    expect(res.signals.some((s) => s.id === 'dual_use')).toBe(true);
  });

  it('raises high_risk_endpoint when origin or destination is high-risk', () => {
    const res = analyzeTbml(
      { ...BASE, originCountry: 'KP' },
      () => PRICE,
      []
    );
    expect(res.signals.some((s) => s.id === 'high_risk_endpoint')).toBe(true);
  });

  it('returns zero signals for a clean domestic shipment priced at reference', () => {
    const res = analyzeTbml(BASE, () => PRICE, []);
    expect(res.signals).toEqual([]);
    expect(res.riskScore).toBe(0);
  });

  it('bounds riskScore to [0, 1]', () => {
    const res = analyzeTbml(
      {
        ...BASE,
        invoicedAmount: 150_000,
        dualUseFlag: true,
        routingCountries: ['IR'],
        originCountry: 'KP',
      },
      () => PRICE,
      [{ ...BASE, id: 'peer' }]
    );
    expect(res.riskScore).toBeGreaterThan(0);
    expect(res.riskScore).toBeLessThanOrEqual(1);
  });
});
