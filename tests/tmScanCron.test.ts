/**
 * Tests for the TM scan cron's pure functions: validateRequest and
 * buildScanSummary, plus integration with the TM brain.
 */
import { describe, expect, it } from 'vitest';
import type { Transaction, TmVerdictRecord } from '../src/domain/transaction';
import { runTmBrainAllCustomers } from '../src/services/txMonitoringBrain';
import { __test__ } from '../netlify/functions/tm-scan-cron.mts';

const { validateRequest, buildScanSummary } = __test__;

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
// validateRequest
// ---------------------------------------------------------------------------

describe('TM scan cron — validateRequest', () => {
  it('accepts empty body', () => {
    expect(validateRequest({}).ok).toBe(true);
  });

  it('accepts null/undefined body as empty', () => {
    expect(validateRequest(null).ok).toBe(true);
    expect(validateRequest(undefined).ok).toBe(true);
  });

  it('accepts valid dispatch + asOfIso + customerId', () => {
    const res = validateRequest({
      dispatch: true,
      asOfIso: '2026-04-15T10:00:00.000Z',
      customerId: 'cust-1',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.req.dispatch).toBe(true);
      expect(res.req.asOfIso).toBe('2026-04-15T10:00:00.000Z');
      expect(res.req.customerId).toBe('cust-1');
    }
  });

  it('rejects non-boolean dispatch', () => {
    const res = validateRequest({ dispatch: 'yes' });
    expect(res.ok).toBe(false);
  });

  it('rejects invalid asOfIso', () => {
    const res = validateRequest({ asOfIso: 'not-a-date' });
    expect(res.ok).toBe(false);
  });

  it('rejects empty customerId', () => {
    const res = validateRequest({ customerId: '' });
    expect(res.ok).toBe(false);
  });

  it('rejects non-string customerId', () => {
    const res = validateRequest({ customerId: 123 });
    expect(res.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildScanSummary
// ---------------------------------------------------------------------------

describe('TM scan cron — buildScanSummary', () => {
  it('returns clean summary when no records', () => {
    const asOf = new Date('2026-04-15T10:00:00.000Z');
    const summary = buildScanSummary([], 0, asOf);
    expect(summary.scannedCustomers).toBe(0);
    expect(summary.scannedTransactions).toBe(0);
    expect(summary.totalFindings).toBe(0);
    expect(summary.summary).toContain('CLEAN');
    expect(summary.regulatory).toContain('FDL No.10/2025 Art.15');
  });

  it('reports flagged customers correctly', () => {
    const asOf = new Date('2026-04-15T10:00:00.000Z');
    const records: TmVerdictRecord[] = [
      {
        schemaVersion: 1,
        customerId: 'c1',
        evaluatedAtIso: asOf.toISOString(),
        windowStartIso: asOf.toISOString(),
        windowEndIso: asOf.toISOString(),
        scannedTxCount: 5,
        verdict: 'flag',
        findings: [
          {
            id: 'f1',
            customerId: 'c1',
            kind: 'round-number-cash',
            severity: 'low',
            message: 'test',
            regulatory: 'test',
            triggeringTxIds: ['t1'],
            confidence: 0.5,
            suggestedAction: 'flag',
          },
        ],
        topSeverity: 'low',
        summary: 'test',
        regulatory: [],
      },
      {
        schemaVersion: 1,
        customerId: 'c2',
        evaluatedAtIso: asOf.toISOString(),
        windowStartIso: asOf.toISOString(),
        windowEndIso: asOf.toISOString(),
        scannedTxCount: 3,
        verdict: 'pass',
        findings: [],
        topSeverity: 'info',
        summary: 'test',
        regulatory: [],
      },
    ];
    const summary = buildScanSummary(records, 8, asOf);
    expect(summary.scannedCustomers).toBe(2);
    expect(summary.scannedTransactions).toBe(8);
    expect(summary.totalFindings).toBe(1);
    expect(summary.byVerdict).toEqual({ flag: 1, pass: 1 });
    expect(summary.summary).toContain('1 of 2');
  });
});

// ---------------------------------------------------------------------------
// Integration: TM brain produces records the cron can summarize
// ---------------------------------------------------------------------------

describe('TM scan cron — brain integration', () => {
  it('runs brain + summarizes a multi-customer batch', () => {
    const asOf = new Date('2026-04-15T10:00:00.000Z');
    const txs: Transaction[] = [
      // Customer 1: single normal transaction
      tx({ id: 't1', customerId: 'c1', amountAed: 5_000 }),
      // Customer 2: high-value cash transaction above CTR threshold
      tx({
        id: 't2',
        customerId: 'c2',
        instrument: 'cash',
        amountAed: 60_000,
      }),
    ];
    const records = runTmBrainAllCustomers(txs, { asOf });
    expect(records).toHaveLength(2);
    const summary = buildScanSummary(records, txs.length, asOf);
    expect(summary.scannedCustomers).toBe(2);
    expect(summary.scannedTransactions).toBe(2);
    // c2 should have at least one finding (CTR threshold hit)
    const c2Record = records.find((r) => r.customerId === 'c2');
    expect(c2Record).toBeDefined();
    expect(c2Record!.verdict).not.toBe('pass');
  });

  it('filters by customerId before running the brain', () => {
    const txs: Transaction[] = [
      tx({ id: 't1', customerId: 'c1' }),
      tx({ id: 't2', customerId: 'c2' }),
      tx({ id: 't3', customerId: 'c3' }),
    ];
    // Simulate the cron's customerId filter
    const filtered = txs.filter((t) => t.customerId === 'c2');
    const records = runTmBrainAllCustomers(filtered);
    expect(records).toHaveLength(1);
    expect(records[0]!.customerId).toBe('c2');
  });
});
