import { describe, it, expect } from 'vitest';
import { assessBuyBackRisk, type BuyBackTransaction } from '@/services/buyBackRisk';

function baseTx(overrides: Partial<BuyBackTransaction> = {}): BuyBackTransaction {
  return {
    id: 'BB-001',
    at: '2026-04-10T10:00:00Z',
    sellerId: 'CUST-100',
    sellerNationality: 'AE',
    sellerIsNewCustomer: false,
    cashPayoutAED: 10_000,
    hasInvoice: true,
    sourceOfGoldDeclared: true,
    items: [
      {
        description: 'Gold necklace',
        declaredPurity: 750,
        measuredPurity: 750,
        weightGrams: 20,
        condition: 'good',
        likelyReligiousOrFamily: false,
      },
    ],
    ...overrides,
  };
}

describe('assessBuyBackRisk — clean transactions', () => {
  it('a clean, well-documented sale scores low', () => {
    const result = assessBuyBackRisk(baseTx());
    expect(result.level).toBe('low');
    expect(result.recommendation).toBe('accept');
    expect(result.score).toBeLessThan(25);
  });

  it('flags are empty for a pristine transaction', () => {
    const result = assessBuyBackRisk(baseTx());
    expect(result.flags).toHaveLength(0);
  });
});

describe('assessBuyBackRisk — individual red flags', () => {
  it('NO_INVOICE adds 25 points', () => {
    const result = assessBuyBackRisk(baseTx({ hasInvoice: false }));
    expect(result.flags.some((f) => f.code === 'NO_INVOICE')).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(25);
  });

  it('NO_SOURCE_DECLARATION adds 15 points', () => {
    const result = assessBuyBackRisk(baseTx({ sourceOfGoldDeclared: false }));
    expect(result.flags.some((f) => f.code === 'NO_SOURCE_DECLARATION')).toBe(true);
  });

  it('CASH_ABOVE_THRESHOLD fires at AED 55K+', () => {
    const result = assessBuyBackRisk(baseTx({ cashPayoutAED: 60_000 }));
    expect(result.flags.some((f) => f.code === 'CASH_ABOVE_THRESHOLD')).toBe(true);
  });

  it('NEAR_THRESHOLD fires between AED 49,500 and 55,000', () => {
    const result = assessBuyBackRisk(baseTx({ cashPayoutAED: 54_000 }));
    expect(result.flags.some((f) => f.code === 'NEAR_THRESHOLD')).toBe(true);
  });

  it('PURITY_MISMATCH fires on >5 ppt declared-vs-measured diff', () => {
    const result = assessBuyBackRisk(
      baseTx({
        items: [
          {
            description: 'Gold bar',
            declaredPurity: 916,
            measuredPurity: 850, // 66 ppt off
            weightGrams: 100,
            condition: 'good',
            likelyReligiousOrFamily: false,
          },
        ],
      }),
    );
    expect(result.flags.some((f) => f.code === 'PURITY_MISMATCH')).toBe(true);
  });

  it('HIGH_RISK_JURISDICTION fires on Congolese nationality', () => {
    const result = assessBuyBackRisk(baseTx({ sellerNationality: 'CD' }));
    expect(result.flags.some((f) => f.code === 'HIGH_RISK_JURISDICTION')).toBe(true);
  });

  it('UNMARKED_OR_DAMAGED fires on melted items', () => {
    const result = assessBuyBackRisk(
      baseTx({
        items: [
          {
            description: 'Melted chunk',
            weightGrams: 150,
            condition: 'melted',
            likelyReligiousOrFamily: false,
          },
        ],
      }),
    );
    expect(result.flags.some((f) => f.code === 'UNMARKED_OR_DAMAGED')).toBe(true);
  });

  it('RELIGIOUS_FAMILY_ITEMS fires on heirloom flag', () => {
    const result = assessBuyBackRisk(
      baseTx({
        items: [
          {
            description: 'Family wedding ring',
            weightGrams: 10,
            condition: 'good',
            likelyReligiousOrFamily: true,
          },
        ],
      }),
    );
    expect(result.flags.some((f) => f.code === 'RELIGIOUS_FAMILY_ITEMS')).toBe(true);
  });

  it('NEW_CUSTOMER adds a small boost', () => {
    const result = assessBuyBackRisk(baseTx({ sellerIsNewCustomer: true }));
    expect(result.flags.some((f) => f.code === 'NEW_CUSTOMER')).toBe(true);
  });
});

describe('assessBuyBackRisk — repeat seller detection', () => {
  it('REPEAT_24H fires on a second transaction within 24h', () => {
    const historical: BuyBackTransaction[] = [
      baseTx({ id: 'BB-000', at: '2026-04-10T05:00:00Z' }),
    ];
    const result = assessBuyBackRisk(baseTx(), historical);
    expect(result.flags.some((f) => f.code === 'REPEAT_24H')).toBe(true);
  });

  it('REPEAT_WEEK_DIVERSE fires on 2+ diverse-amount txs within 7 days', () => {
    const historical: BuyBackTransaction[] = [
      baseTx({ id: 'BB-000', at: '2026-04-05T10:00:00Z', cashPayoutAED: 8_000 }),
      baseTx({ id: 'BB-00x', at: '2026-04-06T10:00:00Z', cashPayoutAED: 15_000 }),
    ];
    const result = assessBuyBackRisk(baseTx({ cashPayoutAED: 12_000 }), historical);
    expect(result.flags.some((f) => f.code === 'REPEAT_WEEK_DIVERSE')).toBe(true);
  });

  it('does NOT fire REPEAT_WEEK if only one other tx', () => {
    const historical: BuyBackTransaction[] = [
      baseTx({ id: 'BB-000', at: '2026-04-05T10:00:00Z', cashPayoutAED: 8_000 }),
    ];
    const result = assessBuyBackRisk(baseTx(), historical);
    expect(result.flags.some((f) => f.code === 'REPEAT_WEEK_DIVERSE')).toBe(false);
  });
});

describe('assessBuyBackRisk — classification', () => {
  it('80+ score → critical / reject', () => {
    const result = assessBuyBackRisk(
      baseTx({
        hasInvoice: false,
        sourceOfGoldDeclared: false,
        cashPayoutAED: 60_000,
        sellerNationality: 'CD',
        sellerIsNewCustomer: true,
        items: [
          {
            description: 'Melted chunk',
            declaredPurity: 999,
            measuredPurity: 900,
            weightGrams: 200,
            condition: 'melted',
            likelyReligiousOrFamily: false,
          },
        ],
      }),
    );
    expect(result.level).toBe('critical');
    expect(result.recommendation).toBe('reject');
  });

  it('50-79 score → high / escalate', () => {
    const result = assessBuyBackRisk(
      baseTx({ hasInvoice: false, cashPayoutAED: 60_000, sellerIsNewCustomer: true }),
    );
    expect(['high', 'critical']).toContain(result.level);
  });

  it('25-49 score → medium / hold_for_review', () => {
    const result = assessBuyBackRisk(baseTx({ hasInvoice: false }));
    expect(['medium', 'high']).toContain(result.level);
  });

  it('score is capped at 200', () => {
    const result = assessBuyBackRisk(
      baseTx({
        hasInvoice: false,
        sourceOfGoldDeclared: false,
        cashPayoutAED: 60_000,
        sellerNationality: 'CD',
        sellerIsNewCustomer: true,
        items: Array.from({ length: 10 }, () => ({
          description: 'Melted chunk',
          declaredPurity: 999,
          measuredPurity: 500,
          weightGrams: 200,
          condition: 'melted' as const,
          likelyReligiousOrFamily: true,
        })),
      }),
    );
    expect(result.score).toBeLessThanOrEqual(200);
  });
});

describe('assessBuyBackRisk — brain event payload', () => {
  it('produces a valid brain event payload', () => {
    const result = assessBuyBackRisk(baseTx({ hasInvoice: false, cashPayoutAED: 60_000 }));
    const ev = result.brainEventPayload;
    expect(ev.kind).toBe('manual');
    expect(ev.refId).toBe('BB-001');
    expect(ev.meta.source).toBe('buyback-risk-engine');
    expect(Array.isArray(ev.meta.flagCodes)).toBe(true);
  });

  it('severity mirrors level', () => {
    const result = assessBuyBackRisk(
      baseTx({
        hasInvoice: false,
        sourceOfGoldDeclared: false,
        cashPayoutAED: 60_000,
        sellerNationality: 'CD',
        sellerIsNewCustomer: true,
      }),
    );
    expect(['high', 'critical']).toContain(result.brainEventPayload.severity);
  });
});
