/**
 * Unit tests for Weaponized Phase 18 commercial-leverage weapons.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateTransactionRules,
  createCaseManager,
  buildRegulatoryChangeImpact,
  runDpmsSectorPack,
  createUsageMeter,
  type TransactionRule,
  type Transaction,
  type DpmsTransaction,
  type RegulatoryConstantChange,
} from '@/services/weaponizedPhase18';

// ---------------------------------------------------------------------------
// 1. evaluateTransactionRules
// ---------------------------------------------------------------------------

describe('evaluateTransactionRules', () => {
  const structuringRule: TransactionRule = {
    id: 'R1',
    name: 'Structuring — cash just below AED 55K',
    clauses: [
      { field: 'isCash', comparator: 'eq', value: true },
      { field: 'amountAed', comparator: 'gte', value: 45_000 },
      { field: 'amountAed', comparator: 'lt', value: 55_000 },
    ],
    severity: 'high',
    citation: 'MoE Circular 08/AML/2021 + FATF Rec 10',
  };

  it('hits a structuring pattern with AND semantics across clauses', () => {
    const txs: Transaction[] = [
      { id: 't1', isCash: true, amountAed: 50_000 }, // hit
      { id: 't2', isCash: true, amountAed: 30_000 }, // below floor
      { id: 't3', isCash: false, amountAed: 50_000 }, // wire, no hit
    ];
    const out = evaluateTransactionRules({ rules: [structuringRule], transactions: txs });
    expect(out.hits).toHaveLength(1);
    expect(out.hits[0].transactionId).toBe('t1');
    expect(out.bySeverity.high).toBe(1);
  });

  it('supports the `in` comparator for jurisdiction lists', () => {
    const rule: TransactionRule = {
      id: 'R2',
      name: 'High-risk jurisdiction counterparty',
      clauses: [{ field: 'counterpartyGeo', comparator: 'in', value: ['IR', 'KP'] }],
      severity: 'critical',
      citation: 'FATF Rec 19',
    };
    const txs: Transaction[] = [
      { id: 'a', counterpartyGeo: 'IR' },
      { id: 'b', counterpartyGeo: 'AE' },
    ];
    const out = evaluateTransactionRules({ rules: [rule], transactions: txs });
    expect(out.hits.map((h) => h.transactionId)).toEqual(['a']);
    expect(out.bySeverity.critical).toBe(1);
  });

  it('aggregates hit rates per rule for noise tuning', () => {
    const txs: Transaction[] = [
      { id: 'x1', isCash: true, amountAed: 50_000 },
      { id: 'x2', isCash: true, amountAed: 51_000 },
      { id: 'x3', isCash: true, amountAed: 10_000 },
    ];
    const out = evaluateTransactionRules({ rules: [structuringRule], transactions: txs });
    expect(out.ruleHitRates[0].hits).toBe(2);
  });

  it('handles empty inputs cleanly', () => {
    const out = evaluateTransactionRules({ rules: [], transactions: [] });
    expect(out.hits).toEqual([]);
    expect(out.inspected).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. createCaseManager
// ---------------------------------------------------------------------------

describe('createCaseManager', () => {
  it('creates a case in the open state', () => {
    const mgr = createCaseManager();
    const c = mgr.create({
      id: 'C1',
      kind: 'STR',
      openedAtIso: '2026-04-16T12:00:00Z',
      ownerId: 'mlro-1',
    });
    expect(c.state).toBe('open');
    expect(mgr.list({ state: 'open' })).toHaveLength(1);
  });

  it('rejects illegal state transitions', () => {
    const mgr = createCaseManager();
    mgr.create({
      id: 'C2',
      kind: 'STR',
      openedAtIso: '2026-04-16T12:00:00Z',
      ownerId: 'mlro-1',
    });
    // Direct jump from open to filed is illegal.
    const r = mgr.transition({
      caseId: 'C2',
      to: 'filed',
      actorId: 'mlro-1',
      reason: 'trying to skip',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/illegal transition/);
  });

  it('enforces four-eyes: owner cannot self-file', () => {
    const mgr = createCaseManager();
    mgr.create({
      id: 'C3',
      kind: 'STR',
      openedAtIso: '2026-04-16T12:00:00Z',
      ownerId: 'mlro-1',
    });
    mgr.transition({ caseId: 'C3', to: 'investigation', actorId: 'mlro-1', reason: 'start' });
    mgr.transition({
      caseId: 'C3',
      to: 'four-eyes-pending',
      actorId: 'mlro-1',
      reason: 'queue approval',
    });
    const r = mgr.transition({
      caseId: 'C3',
      to: 'filed',
      actorId: 'mlro-1', // same as owner — must be blocked
      reason: 'self-file attempt',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/four-eyes/);
  });

  it('allows filing when a different actor approves', () => {
    const mgr = createCaseManager();
    mgr.create({
      id: 'C4',
      kind: 'STR',
      openedAtIso: '2026-04-16T12:00:00Z',
      ownerId: 'mlro-1',
    });
    mgr.transition({ caseId: 'C4', to: 'investigation', actorId: 'mlro-1', reason: 'start' });
    mgr.transition({
      caseId: 'C4',
      to: 'four-eyes-pending',
      actorId: 'mlro-1',
      reason: 'queue',
    });
    const r = mgr.transition({
      caseId: 'C4',
      to: 'filed',
      actorId: 'co-1', // distinct approver
      reason: 'CO approval',
    });
    expect(r.ok).toBe(true);
    expect(mgr.get('C4')?.state).toBe('filed');
  });

  it('rejects duplicate case ids', () => {
    const mgr = createCaseManager();
    mgr.create({ id: 'dup', kind: 'CTR', openedAtIso: '2026-04-16T12:00:00Z' });
    expect(() =>
      mgr.create({ id: 'dup', kind: 'CTR', openedAtIso: '2026-04-16T12:00:00Z' })
    ).toThrow(/already exists/);
  });

  it('filters by kind and owner', () => {
    const mgr = createCaseManager();
    mgr.create({
      id: 'f1',
      kind: 'STR',
      ownerId: 'm1',
      openedAtIso: '2026-04-16T12:00:00Z',
    });
    mgr.create({
      id: 'f2',
      kind: 'CTR',
      ownerId: 'm2',
      openedAtIso: '2026-04-16T12:00:00Z',
    });
    expect(mgr.list({ kind: 'STR' }).map((c) => c.id)).toEqual(['f1']);
    expect(mgr.list({ ownerId: 'm2' }).map((c) => c.id)).toEqual(['f2']);
  });
});

// ---------------------------------------------------------------------------
// 3. buildRegulatoryChangeImpact
// ---------------------------------------------------------------------------

describe('buildRegulatoryChangeImpact', () => {
  const change: RegulatoryConstantChange = {
    constantName: 'DPMS_CTR_THRESHOLD_AED',
    previous: '55000',
    next: '50000',
    citation: 'MoE Circular 09/AML/2026',
    effectiveAtIso: '2026-05-01T00:00:00Z',
  };

  it('lists affected artefacts by constant name', () => {
    const catalogue = [
      {
        kind: 'rule' as const,
        id: 'rule.dpms-ctr',
        title: 'DPMS CTR cash threshold',
        references: ['DPMS_CTR_THRESHOLD_AED'],
      },
      {
        kind: 'test' as const,
        id: 'tests/constants.test.ts',
        title: 'Regulatory constants lock',
        references: ['DPMS_CTR_THRESHOLD_AED', 'OTHER_CONST'],
      },
      {
        kind: 'policy' as const,
        id: 'docs/policy.md',
        title: 'AML policy',
        references: ['UNRELATED'],
      },
    ];
    const out = buildRegulatoryChangeImpact({ change, catalogue });
    expect(out.affected).toHaveLength(2);
    expect(out.byKind.rule).toBe(1);
    expect(out.byKind.test).toBe(1);
    expect(out.byKind.policy).toBe(0);
  });

  it('marks training-deck artefacts as review (not update)', () => {
    const catalogue = [
      {
        kind: 'training-deck' as const,
        id: 'decks/q2.pptx',
        title: 'Q2 training',
        references: ['DPMS_CTR_THRESHOLD_AED'],
      },
    ];
    const out = buildRegulatoryChangeImpact({ change, catalogue });
    expect(out.affected[0].action).toBe('review');
  });

  it('computes a 30-day completion deadline from effective date', () => {
    const catalogue: Parameters<typeof buildRegulatoryChangeImpact>[0]['catalogue'] = [];
    const out = buildRegulatoryChangeImpact({ change, catalogue });
    // 2026-05-01 + 30d = 2026-05-31 (UTC)
    expect(out.completionDeadlineIso.slice(0, 10)).toBe('2026-05-31');
    expect(out.narrative).toMatch(/Cabinet Res 134\/2025 Art\.18/);
  });

  it('handles a no-reference catalogue with an empty affected list', () => {
    const out = buildRegulatoryChangeImpact({
      change,
      catalogue: [{ kind: 'rule', id: 'r1', title: 'x', references: ['OTHER'] }],
    });
    expect(out.affected).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. runDpmsSectorPack
// ---------------------------------------------------------------------------

describe('runDpmsSectorPack', () => {
  const cleanTx: DpmsTransaction = {
    id: 'ok',
    amountAed: 20_000,
    isCash: false,
    counterpartyGeo: 'AE',
    oldGold: false,
    refinerAccredited: true,
    hallmarkAssayOnFile: true,
  };

  it('raises no flags on a clean low-value transaction', () => {
    const out = runDpmsSectorPack({ transactions: [cleanTx] });
    expect(out.flags).toEqual([]);
    expect(out.flaggedTransactionCount).toBe(0);
  });

  it('flags cash AED ≥ 55K as DPMS-CTR', () => {
    const tx: DpmsTransaction = { ...cleanTx, isCash: true, amountAed: 55_000 };
    const out = runDpmsSectorPack({ transactions: [tx] });
    expect(out.flags.some((f) => f.ruleId === 'DPMS-CTR')).toBe(true);
  });

  it('flags LBMA-5STEP when refiner not accredited on high-value gold', () => {
    const tx: DpmsTransaction = { ...cleanTx, amountAed: 250_000, refinerAccredited: false };
    const out = runDpmsSectorPack({ transactions: [tx] });
    expect(out.flags.some((f) => f.ruleId === 'LBMA-5STEP')).toBe(true);
  });

  it('flags DGD-HALLMARK when hallmark/assay cert is missing', () => {
    const tx: DpmsTransaction = { ...cleanTx, hallmarkAssayOnFile: false };
    const out = runDpmsSectorPack({ transactions: [tx] });
    expect(out.flags.some((f) => f.ruleId === 'DGD-HALLMARK')).toBe(true);
  });

  it('flags CAHRA-JURISDICTION as critical for sanctioned geos', () => {
    const tx: DpmsTransaction = { ...cleanTx, counterpartyGeo: 'AF' };
    const out = runDpmsSectorPack({ transactions: [tx] });
    const cahra = out.flags.find((f) => f.ruleId === 'CAHRA-JURISDICTION');
    expect(cahra?.severity).toBe('critical');
  });

  it('flags OLD-GOLD-VERIFY when the item is old-gold', () => {
    const tx: DpmsTransaction = { ...cleanTx, oldGold: true };
    const out = runDpmsSectorPack({ transactions: [tx] });
    expect(out.flags.some((f) => f.ruleId === 'OLD-GOLD-VERIFY')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. createUsageMeter
// ---------------------------------------------------------------------------

describe('createUsageMeter', () => {
  it('records events and rolls them up per tenant within a period', () => {
    const meter = createUsageMeter();
    meter.record({
      tenantId: 't1',
      kind: 'screening-run',
      atIso: '2026-05-10T10:00:00Z',
    });
    meter.record({
      tenantId: 't1',
      kind: 'str-filed',
      atIso: '2026-05-12T10:00:00Z',
    });
    meter.record({
      tenantId: 't2',
      kind: 'screening-run',
      atIso: '2026-05-11T10:00:00Z',
    });
    const t1 = meter.rollup({
      tenantId: 't1',
      periodStartIso: '2026-05-01T00:00:00Z',
      periodEndIso: '2026-05-31T23:59:59Z',
    });
    expect(t1.counts['screening-run']).toBe(1);
    expect(t1.counts['str-filed']).toBe(1);
    expect(t1.totalUnits).toBe(2);
  });

  it('excludes events outside the rollup window', () => {
    const meter = createUsageMeter();
    meter.record({
      tenantId: 't1',
      kind: 'screening-run',
      atIso: '2026-04-30T23:00:00Z',
    });
    const may = meter.rollup({
      tenantId: 't1',
      periodStartIso: '2026-05-01T00:00:00Z',
      periodEndIso: '2026-05-31T23:59:59Z',
    });
    expect(may.totalUnits).toBe(0);
  });

  it('lists tenants that have emitted any event', () => {
    const meter = createUsageMeter();
    meter.record({ tenantId: 'a', kind: 'screening-run', atIso: '2026-05-10T10:00:00Z' });
    meter.record({ tenantId: 'b', kind: 'screening-run', atIso: '2026-05-10T10:00:00Z' });
    expect(meter.listTenants()).toEqual(['a', 'b']);
  });

  it('honours per-event quantity when > 1', () => {
    const meter = createUsageMeter();
    meter.record({
      tenantId: 't1',
      kind: 'screening-run',
      atIso: '2026-05-10T10:00:00Z',
      qty: 42,
    });
    const r = meter.rollup({
      tenantId: 't1',
      periodStartIso: '2026-05-01T00:00:00Z',
      periodEndIso: '2026-05-31T23:59:59Z',
    });
    expect(r.totalUnits).toBe(42);
    expect(r.counts['screening-run']).toBe(42);
  });

  it('rejects events missing tenantId', () => {
    const meter = createUsageMeter();
    expect(() =>
      meter.record({
        tenantId: '',
        kind: 'screening-run',
        atIso: '2026-05-10T10:00:00Z',
      })
    ).toThrow();
  });
});
