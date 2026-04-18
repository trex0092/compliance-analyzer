/**
 * Tests for netlify/functions/transaction-monitor.mts — exercises the
 * pure validation layer exposed via __test__. No Netlify runtime, no
 * HTTP, no Blobs. The actual rule/velocity/behavioral pipeline is
 * tested in tests/transactionMonitoringEngine.test.ts; these tests
 * only guard the HTTP envelope.
 */
import { describe, it, expect } from 'vitest';

// @ts-expect-error — .mts file has no type declarations at test time
import { __test__ } from '../netlify/functions/transaction-monitor.mts';

const { validateInput, validateTransaction, validateProfile } = __test__ as {
  validateInput: (
    input: unknown
  ) => { ok: true; input: Record<string, unknown> } | { ok: false; error: string };
  validateTransaction: (
    raw: unknown,
    index: number
  ) => { ok: true; tx: Record<string, unknown> } | { ok: false; error: string };
  validateProfile: (
    raw: unknown
  ) => { ok: true; profile: Record<string, unknown> } | { ok: false; error: string };
};

const validTx = () => ({
  amount: 10000,
  currency: 'AED',
  customerName: 'Gold Trader LLC',
  customerRiskRating: 'medium' as const,
  payerMatchesCustomer: true,
});

// ---------------------------------------------------------------------------
// validateTransaction
// ---------------------------------------------------------------------------

describe('transaction-monitor — validateTransaction', () => {
  it('accepts a minimal valid transaction', () => {
    const r = validateTransaction(validTx(), 0);
    expect(r.ok).toBe(true);
  });

  it('rejects non-object', () => {
    expect(validateTransaction(null, 0).ok).toBe(false);
    expect(validateTransaction('x', 0).ok).toBe(false);
  });

  it('rejects non-numeric amount', () => {
    const r = validateTransaction({ ...validTx(), amount: 'big' }, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('amount');
  });

  it('rejects negative amount', () => {
    const r = validateTransaction({ ...validTx(), amount: -1 }, 0);
    expect(r.ok).toBe(false);
  });

  it('rejects non-finite amount', () => {
    const r = validateTransaction({ ...validTx(), amount: Number.POSITIVE_INFINITY }, 0);
    expect(r.ok).toBe(false);
  });

  it('rejects empty currency', () => {
    const r = validateTransaction({ ...validTx(), currency: '' }, 0);
    expect(r.ok).toBe(false);
  });

  it('rejects oversized currency', () => {
    const r = validateTransaction({ ...validTx(), currency: 'AEDUSDGBPJPY' }, 0);
    expect(r.ok).toBe(false);
  });

  it('rejects invalid risk rating', () => {
    const r = validateTransaction({ ...validTx(), customerRiskRating: 'crazy' }, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('customerRiskRating');
  });

  it('rejects non-boolean payerMatchesCustomer', () => {
    const r = validateTransaction({ ...validTx(), payerMatchesCustomer: 'yes' }, 0);
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateProfile
// ---------------------------------------------------------------------------

const validProfile = () => ({
  customerId: 'CUS-1',
  customerName: 'Gold Trader LLC',
  riskRating: 'medium' as const,
  avgTransactionAmount: 5000,
  avgTransactionsPerMonth: 10,
  typicalPaymentMethods: ['wire'],
  typicalCountries: ['AE'],
  lastTransactionDate: null,
  profileUpdatedAt: '2026-04-18T00:00:00.000Z',
});

describe('transaction-monitor — validateProfile', () => {
  it('accepts a minimal valid profile', () => {
    const r = validateProfile(validProfile());
    expect(r.ok).toBe(true);
  });

  it('rejects missing customerId', () => {
    const { customerId, ...rest } = validProfile();
    void customerId;
    const r = validateProfile(rest);
    expect(r.ok).toBe(false);
  });

  it('rejects invalid risk rating', () => {
    const r = validateProfile({ ...validProfile(), riskRating: 'elevated' });
    expect(r.ok).toBe(false);
  });

  it('rejects negative avgTransactionAmount', () => {
    const r = validateProfile({ ...validProfile(), avgTransactionAmount: -1 });
    expect(r.ok).toBe(false);
  });

  it('rejects non-array typicalPaymentMethods', () => {
    const r = validateProfile({ ...validProfile(), typicalPaymentMethods: 'wire' });
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateInput (the top-level envelope)
// ---------------------------------------------------------------------------

describe('transaction-monitor — validateInput', () => {
  it('rejects non-object body', () => {
    expect(validateInput(null).ok).toBe(false);
    expect(validateInput('x').ok).toBe(false);
  });

  it('rejects missing customerId', () => {
    const r = validateInput({ customerName: 'x', transactions: [validTx()] });
    expect(r.ok).toBe(false);
  });

  it('rejects missing customerName', () => {
    const r = validateInput({ customerId: 'c1', transactions: [validTx()] });
    expect(r.ok).toBe(false);
  });

  it('rejects empty transactions array', () => {
    const r = validateInput({ customerId: 'c1', customerName: 'n', transactions: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('non-empty array');
  });

  it('rejects transactions array beyond max (50)', () => {
    const r = validateInput({
      customerId: 'c1',
      customerName: 'n',
      transactions: new Array(51).fill(validTx()),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('maximum of 50');
  });

  it('accepts a minimal valid input with defaults', () => {
    const r = validateInput({
      customerId: 'c1',
      customerName: 'n',
      transactions: [validTx()],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.createAsanaOnCritical).toBe(true);
      expect(r.input.customerId).toBe('c1');
    }
  });

  it('propagates transaction validation errors with index', () => {
    const r = validateInput({
      customerId: 'c1',
      customerName: 'n',
      transactions: [validTx(), { ...validTx(), amount: -1 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('transactions[1]');
  });

  it('propagates profile validation errors when profile is present', () => {
    const r = validateInput({
      customerId: 'c1',
      customerName: 'n',
      transactions: [validTx()],
      profile: { customerId: '' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('profile');
  });

  it('accepts input with a valid profile', () => {
    const r = validateInput({
      customerId: 'c1',
      customerName: 'n',
      transactions: [validTx()],
      profile: validProfile(),
    });
    expect(r.ok).toBe(true);
  });

  it('honors createAsanaOnCritical=false', () => {
    const r = validateInput({
      customerId: 'c1',
      customerName: 'n',
      transactions: [validTx()],
      createAsanaOnCritical: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.createAsanaOnCritical).toBe(false);
  });
});
