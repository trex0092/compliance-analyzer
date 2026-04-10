import { describe, it, expect } from 'vitest';
import {
  reconcile,
  reportToBrainEvent,
  type BookInventory,
  type PhysicalCount,
} from '@/services/inventoryReconciliation';

const cleanBook: BookInventory = {
  asOf: '2026-04-10T00:00:00Z',
  lines: [
    {
      sku: 'BAR-999-1KG',
      description: '1kg gold bar 999.9',
      metal: 'gold',
      fineness: 999.9,
      quantity: 10,
      weightGramsEach: 1000,
      location: 'Vault-A',
    },
    {
      sku: 'COIN-GOLD-1OZ',
      description: 'Gold coin 1oz',
      metal: 'gold',
      fineness: 999.9,
      quantity: 50,
      weightGramsEach: 31.1035,
      location: 'Vault-B',
    },
  ],
};

describe('reconcile — perfect match', () => {
  it('no variances when count exactly matches book', () => {
    const count: PhysicalCount = {
      countedAt: '2026-04-10T23:00:00Z',
      countedBy: 'co',
      lines: [
        { sku: 'BAR-999-1KG', location: 'Vault-A', actualQuantity: 10 },
        { sku: 'COIN-GOLD-1OZ', location: 'Vault-B', actualQuantity: 50 },
      ],
    };
    const report = reconcile(cleanBook, count);
    expect(report.criticalCount).toBe(0);
    expect(report.warningCount).toBe(0);
    expect(report.acceptableCount).toBe(2);
    expect(report.totalMissingGrams).toBe(0);
    expect(report.totalSurplusGrams).toBe(0);
    expect(report.requiresBrainEvent).toBe(false);
  });
});

describe('reconcile — quantity mismatches', () => {
  it('missing one bar → critical variance', () => {
    const count: PhysicalCount = {
      countedAt: '2026-04-10T23:00:00Z',
      countedBy: 'co',
      lines: [
        { sku: 'BAR-999-1KG', location: 'Vault-A', actualQuantity: 9 }, // -1 bar = -1kg
        { sku: 'COIN-GOLD-1OZ', location: 'Vault-B', actualQuantity: 50 },
      ],
    };
    const report = reconcile(cleanBook, count);
    expect(report.criticalCount).toBe(1);
    expect(report.totalMissingGrams).toBe(1000);
    expect(report.requiresBrainEvent).toBe(true);
  });

  it('surplus is flagged but reported separately', () => {
    const count: PhysicalCount = {
      countedAt: '2026-04-10T23:00:00Z',
      countedBy: 'co',
      lines: [
        { sku: 'BAR-999-1KG', location: 'Vault-A', actualQuantity: 11 }, // +1
        { sku: 'COIN-GOLD-1OZ', location: 'Vault-B', actualQuantity: 50 },
      ],
    };
    const report = reconcile(cleanBook, count);
    expect(report.totalSurplusGrams).toBe(1000);
    expect(report.criticalCount).toBe(1);
  });
});

describe('reconcile — weight tolerance', () => {
  it('0.05% weight variance → acceptable', () => {
    const count: PhysicalCount = {
      countedAt: '2026-04-10T23:00:00Z',
      countedBy: 'co',
      lines: [
        {
          sku: 'BAR-999-1KG',
          location: 'Vault-A',
          actualQuantity: 10,
          actualWeightGrams: 10005, // 0.05% above
        },
        { sku: 'COIN-GOLD-1OZ', location: 'Vault-B', actualQuantity: 50 },
      ],
    };
    const report = reconcile(cleanBook, count);
    expect(report.variances[0].severity).toBe('acceptable');
  });

  it('0.3% weight variance with no quantity change → warning', () => {
    const count: PhysicalCount = {
      countedAt: '2026-04-10T23:00:00Z',
      countedBy: 'co',
      lines: [
        {
          sku: 'BAR-999-1KG',
          location: 'Vault-A',
          actualQuantity: 10,
          actualWeightGrams: 9970, // -0.3%
        },
        { sku: 'COIN-GOLD-1OZ', location: 'Vault-B', actualQuantity: 50 },
      ],
    };
    const report = reconcile(cleanBook, count);
    expect(report.variances[0].severity).toBe('warning');
  });

  it('1% weight variance → critical', () => {
    const count: PhysicalCount = {
      countedAt: '2026-04-10T23:00:00Z',
      countedBy: 'co',
      lines: [
        {
          sku: 'BAR-999-1KG',
          location: 'Vault-A',
          actualQuantity: 10,
          actualWeightGrams: 9900, // -1%
        },
        { sku: 'COIN-GOLD-1OZ', location: 'Vault-B', actualQuantity: 50 },
      ],
    };
    const report = reconcile(cleanBook, count);
    expect(report.variances[0].severity).toBe('critical');
  });
});

describe('reconcile — missing / unknown lines', () => {
  it('detects book lines that were not counted', () => {
    const count: PhysicalCount = {
      countedAt: '2026-04-10T23:00:00Z',
      countedBy: 'co',
      lines: [
        { sku: 'BAR-999-1KG', location: 'Vault-A', actualQuantity: 10 },
        // COIN-GOLD-1OZ not counted
      ],
    };
    const report = reconcile(cleanBook, count);
    expect(report.uncounted).toContain('COIN-GOLD-1OZ|Vault-B');
    expect(report.requiresBrainEvent).toBe(true);
  });

  it('detects count lines not in the book', () => {
    const count: PhysicalCount = {
      countedAt: '2026-04-10T23:00:00Z',
      countedBy: 'co',
      lines: [
        { sku: 'BAR-999-1KG', location: 'Vault-A', actualQuantity: 10 },
        { sku: 'COIN-GOLD-1OZ', location: 'Vault-B', actualQuantity: 50 },
        { sku: 'MYSTERY-BAR', location: 'Vault-A', actualQuantity: 1 },
      ],
    };
    const report = reconcile(cleanBook, count);
    expect(report.unknown).toContain('MYSTERY-BAR|Vault-A');
    expect(report.requiresBrainEvent).toBe(true);
  });
});

describe('reportToBrainEvent', () => {
  it('severity=critical when criticalCount > 0', () => {
    const report = reconcile(cleanBook, {
      countedAt: '2026-04-10T23:00:00Z',
      countedBy: 'co',
      lines: [
        { sku: 'BAR-999-1KG', location: 'Vault-A', actualQuantity: 9 },
        { sku: 'COIN-GOLD-1OZ', location: 'Vault-B', actualQuantity: 50 },
      ],
    });
    const ev = reportToBrainEvent(report);
    expect(ev.severity).toBe('critical');
    expect(ev.kind).toBe('manual');
  });

  it('severity=high when uncounted lines exist', () => {
    const report = reconcile(cleanBook, {
      countedAt: '2026-04-10T23:00:00Z',
      countedBy: 'co',
      lines: [{ sku: 'BAR-999-1KG', location: 'Vault-A', actualQuantity: 10 }],
    });
    const ev = reportToBrainEvent(report);
    expect(['high', 'critical']).toContain(ev.severity);
  });

  it('includes summary stats in meta', () => {
    const report = reconcile(cleanBook, {
      countedAt: '2026-04-10T23:00:00Z',
      countedBy: 'co',
      lines: [
        { sku: 'BAR-999-1KG', location: 'Vault-A', actualQuantity: 9 },
        { sku: 'COIN-GOLD-1OZ', location: 'Vault-B', actualQuantity: 50 },
      ],
    });
    const ev = reportToBrainEvent(report);
    expect(ev.meta).toBeDefined();
    const meta = ev.meta as { source: string; totalMissingGrams: number };
    expect(meta.source).toBe('inventory-reconciliation');
    expect(meta.totalMissingGrams).toBe(1000);
  });
});
