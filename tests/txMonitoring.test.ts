/**
 * Tests for the Transaction Monitoring Brain: domain helpers,
 * rule engine, typology matcher, and orchestrator.
 */
import { describe, expect, it } from 'vitest';
import {
  CROSS_BORDER_CASH_DECLARATION_AED,
  DPMS_CASH_CTR_THRESHOLD_AED,
  STRUCTURING_BELOW_PERCENT,
  clusterByVelocity,
  maxSeverity,
  rollUpVerdict,
  topSeverityOf,
  type TmFinding,
  type Transaction,
} from '../src/domain/transaction';
import { runRuleEngine } from '../src/services/txMonitoringRuleEngine';
import { runTypologyMatcher, type TbmlCorridor } from '../src/services/txTypologyMatcher';
import {
  addBusinessDaysUae,
  runTmBrain,
  runTmBrainAllCustomers,
} from '../src/services/txMonitoringBrain';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    customerId: 'c-naples',
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

function finding(overrides: Partial<TmFinding> = {}): TmFinding {
  return {
    id: 'f1',
    customerId: 'c-naples',
    kind: 'ctr-threshold-hit',
    severity: 'medium',
    message: '',
    regulatory: '',
    triggeringTxIds: [],
    confidence: 0.5,
    suggestedAction: 'flag',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Regulatory constants
// ---------------------------------------------------------------------------

describe('TM regulatory constants', () => {
  it('DPMS CTR threshold matches MoE Circular 08/AML/2021', () => {
    expect(DPMS_CASH_CTR_THRESHOLD_AED).toBe(55_000);
  });
  it('cross-border cash threshold matches FDL Art.16', () => {
    expect(CROSS_BORDER_CASH_DECLARATION_AED).toBe(60_000);
  });
  it('structuring band is 5%', () => {
    expect(STRUCTURING_BELOW_PERCENT).toBeCloseTo(0.05);
  });
});

// ---------------------------------------------------------------------------
// Severity + verdict roll-up
// ---------------------------------------------------------------------------

describe('maxSeverity + topSeverityOf + rollUpVerdict', () => {
  it('maxSeverity returns the most severe', () => {
    expect(maxSeverity('info', 'medium')).toBe('medium');
    expect(maxSeverity('high', 'low')).toBe('high');
    expect(maxSeverity('critical', 'high')).toBe('critical');
  });
  it('topSeverityOf returns info for empty', () => {
    expect(topSeverityOf([])).toBe('info');
  });
  it('topSeverityOf reduces to the max', () => {
    expect(
      topSeverityOf([
        finding({ severity: 'low' }),
        finding({ id: 'f2', severity: 'high' }),
        finding({ id: 'f3', severity: 'medium' }),
      ])
    ).toBe('high');
  });
  it('rollUpVerdict prefers auto-str > freeze > escalate', () => {
    expect(
      rollUpVerdict([
        finding({ suggestedAction: 'flag', severity: 'medium' }),
        finding({ id: 'f2', suggestedAction: 'auto-str', severity: 'critical' }),
      ])
    ).toBe('auto-str');
    expect(rollUpVerdict([finding({ suggestedAction: 'freeze', severity: 'critical' })])).toBe(
      'freeze'
    );
    expect(rollUpVerdict([finding({ suggestedAction: 'escalate', severity: 'high' })])).toBe(
      'escalate'
    );
  });
  it('rollUpVerdict returns pass on empty', () => {
    expect(rollUpVerdict([])).toBe('pass');
  });
  it('rollUpVerdict degrades medium to flag', () => {
    expect(rollUpVerdict([finding({ severity: 'medium', suggestedAction: 'flag' })])).toBe('flag');
  });
});

// ---------------------------------------------------------------------------
// Velocity clustering
// ---------------------------------------------------------------------------

describe('clusterByVelocity', () => {
  it('empty input returns empty', () => {
    expect(clusterByVelocity([])).toEqual([]);
  });
  it('clusters transactions within 24h', () => {
    const txs = [
      tx({ id: 'a', atIso: '2026-04-15T10:00:00.000Z' }),
      tx({ id: 'b', atIso: '2026-04-15T20:00:00.000Z' }),
      tx({ id: 'c', atIso: '2026-04-17T10:00:00.000Z' }),
    ];
    const clusters = clusterByVelocity(txs);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toEqual(['a', 'b']);
    expect(clusters[1]).toEqual(['c']);
  });
});

// ---------------------------------------------------------------------------
// Rule engine
// ---------------------------------------------------------------------------

describe('runRuleEngine — CTR threshold', () => {
  it('flags exactly at AED 55,000 cash', () => {
    const findings = runRuleEngine([tx({ instrument: 'cash', amountAed: 55_000 })]);
    const ctr = findings.find((f) => f.kind === 'ctr-threshold-hit');
    expect(ctr).toBeDefined();
    expect(ctr!.severity).toBe('high');
    expect(ctr!.confidence).toBe(1);
  });
  it('does not flag AED 54,999 as a CTR hit', () => {
    const findings = runRuleEngine([tx({ instrument: 'cash', amountAed: 54_999 })]);
    expect(findings.find((f) => f.kind === 'ctr-threshold-hit')).toBeUndefined();
  });
  it('does not flag non-cash AED 100,000', () => {
    const findings = runRuleEngine([tx({ instrument: 'wire', amountAed: 100_000 })]);
    expect(findings.find((f) => f.kind === 'ctr-threshold-hit')).toBeUndefined();
  });
});

describe('runRuleEngine — just-below structuring', () => {
  it('flags AED 53,000 cash as just-below CTR', () => {
    const findings = runRuleEngine([tx({ instrument: 'cash', amountAed: 53_000 })]);
    const finding = findings.find((f) => f.kind === 'ctr-threshold-just-below');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('high');
    expect(finding!.suggestedAction).toBe('escalate');
  });
  it('does not flag AED 50,000 (below the 5% band)', () => {
    const findings = runRuleEngine([tx({ instrument: 'cash', amountAed: 50_000 })]);
    expect(findings.find((f) => f.kind === 'ctr-threshold-just-below')).toBeUndefined();
  });
});

describe('runRuleEngine — cross-border cash', () => {
  it('critical finding on cash AED 60,000 cross-border', () => {
    const findings = runRuleEngine([
      tx({ instrument: 'cash', amountAed: 60_000, isCrossBorder: true }),
    ]);
    const finding = findings.find((f) => f.kind === 'cross-border-cash-over-60k');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('critical');
  });
  it('does not flag non-cash AED 60,000 cross-border', () => {
    const findings = runRuleEngine([
      tx({ instrument: 'wire', amountAed: 60_000, isCrossBorder: true }),
    ]);
    expect(findings.find((f) => f.kind === 'cross-border-cash-over-60k')).toBeUndefined();
  });
  it('just-below flags AED 58,000 cash cross-border', () => {
    const findings = runRuleEngine([
      tx({ instrument: 'cash', amountAed: 58_000, isCrossBorder: true }),
    ]);
    const finding = findings.find((f) => f.kind === 'cross-border-cash-just-below');
    expect(finding).toBeDefined();
  });
});

describe('runRuleEngine — round-number cash', () => {
  it('flags AED 100,000 cash as round number', () => {
    const findings = runRuleEngine([tx({ instrument: 'cash', amountAed: 100_000 })]);
    expect(findings.find((f) => f.kind === 'round-number-cash')).toBeDefined();
  });
  it('does not flag AED 12,345 cash', () => {
    const findings = runRuleEngine([tx({ instrument: 'cash', amountAed: 12_345 })]);
    expect(findings.find((f) => f.kind === 'round-number-cash')).toBeUndefined();
  });
  it('does not flag AED 5,000 cash (below minimum)', () => {
    const findings = runRuleEngine([tx({ instrument: 'cash', amountAed: 5_000 })]);
    expect(findings.find((f) => f.kind === 'round-number-cash')).toBeUndefined();
  });
});

describe('runRuleEngine — high-risk jurisdiction', () => {
  it('flags counterparty in Iran', () => {
    const findings = runRuleEngine([tx({ counterpartyCountry: 'IR' })]);
    const finding = findings.find((f) => f.kind === 'high-risk-jurisdiction');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('medium');
  });
  it('does not flag AE counterparty', () => {
    const findings = runRuleEngine([tx({ counterpartyCountry: 'AE' })]);
    expect(findings.find((f) => f.kind === 'high-risk-jurisdiction')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Typology matcher
// ---------------------------------------------------------------------------

describe('runTypologyMatcher — smurfing', () => {
  it('detects 3 cash credits just-below CTR within 7 days', () => {
    const txs: Transaction[] = [
      tx({
        id: 't1',
        instrument: 'cash',
        direction: 'credit',
        amountAed: 53_000,
        atIso: '2026-04-10T10:00:00.000Z',
      }),
      tx({
        id: 't2',
        instrument: 'cash',
        direction: 'credit',
        amountAed: 52_500,
        atIso: '2026-04-12T10:00:00.000Z',
      }),
      tx({
        id: 't3',
        instrument: 'cash',
        direction: 'credit',
        amountAed: 54_000,
        atIso: '2026-04-14T10:00:00.000Z',
      }),
    ];
    const findings = runTypologyMatcher(txs);
    const smurfing = findings.find((f) => f.kind === 'smurfing');
    expect(smurfing).toBeDefined();
    expect(smurfing!.severity).toBe('high');
    expect(smurfing!.suggestedAction).toBe('auto-str');
    expect(smurfing!.triggeringTxIds.length).toBeGreaterThanOrEqual(3);
  });
  it('does not flag 2 transactions (below minCount)', () => {
    const txs: Transaction[] = [
      tx({
        id: 't1',
        instrument: 'cash',
        direction: 'credit',
        amountAed: 53_000,
        atIso: '2026-04-10T10:00:00.000Z',
      }),
      tx({
        id: 't2',
        instrument: 'cash',
        direction: 'credit',
        amountAed: 52_500,
        atIso: '2026-04-12T10:00:00.000Z',
      }),
    ];
    const findings = runTypologyMatcher(txs);
    expect(findings.find((f) => f.kind === 'smurfing')).toBeUndefined();
  });
});

describe('runTypologyMatcher — layering', () => {
  it('detects 4 counterparties within 48h with similar amounts', () => {
    const txs: Transaction[] = [
      tx({ id: 't1', counterpartyName: 'A', amountAed: 10_000, atIso: '2026-04-15T08:00:00.000Z' }),
      tx({ id: 't2', counterpartyName: 'B', amountAed: 10_500, atIso: '2026-04-15T12:00:00.000Z' }),
      tx({ id: 't3', counterpartyName: 'C', amountAed: 10_200, atIso: '2026-04-16T08:00:00.000Z' }),
      tx({ id: 't4', counterpartyName: 'D', amountAed: 9_800, atIso: '2026-04-16T16:00:00.000Z' }),
    ];
    const findings = runTypologyMatcher(txs);
    expect(findings.find((f) => f.kind === 'layering')).toBeDefined();
  });
});

describe('runTypologyMatcher — round-trip', () => {
  it('detects debit + matching credit from same counterparty within 72h', () => {
    const txs: Transaction[] = [
      tx({
        id: 't1',
        direction: 'debit',
        counterpartyName: 'Shell A',
        amountAed: 50_000,
        atIso: '2026-04-14T10:00:00.000Z',
      }),
      tx({
        id: 't2',
        direction: 'credit',
        counterpartyName: 'Shell A',
        amountAed: 49_500,
        atIso: '2026-04-15T15:00:00.000Z',
      }),
    ];
    const findings = runTypologyMatcher(txs);
    expect(findings.find((f) => f.kind === 'round-trip')).toBeDefined();
  });
});

describe('runTypologyMatcher — tbml price anomaly', () => {
  it('detects a purchase above the gold fair corridor', () => {
    const corridor: TbmlCorridor = {
      asset: 'GOLD_OZ',
      minAedPerUnit: 7_000,
      maxAedPerUnit: 9_000,
      unit: 'oz',
    };
    const txs: Transaction[] = [
      tx({
        id: 't1',
        direction: 'debit',
        amountAed: 150_000,
        reference: 'GOLD_OZ:10',
      }),
    ];
    const findings = runTypologyMatcher(txs, { tbmlCorridors: [corridor] });
    expect(findings.find((f) => f.kind === 'tbml-price-anomaly')).toBeDefined();
  });
});

describe('runTypologyMatcher — hawala', () => {
  it('detects paired cash in/out with different counterparties', () => {
    const txs: Transaction[] = [
      tx({
        id: 't1',
        instrument: 'cash',
        direction: 'credit',
        counterpartyName: 'Cash In Guy',
        amountAed: 40_000,
        atIso: '2026-04-10T10:00:00.000Z',
      }),
      tx({
        id: 't2',
        instrument: 'cash',
        direction: 'debit',
        counterpartyName: 'Cash Out Guy',
        amountAed: 40_500,
        atIso: '2026-04-12T10:00:00.000Z',
      }),
    ];
    const findings = runTypologyMatcher(txs);
    const hawala = findings.find((f) => f.kind === 'hawala-pattern');
    expect(hawala).toBeDefined();
    expect(hawala!.severity).toBe('critical');
    expect(hawala!.suggestedAction).toBe('auto-str');
  });
});

describe('runTypologyMatcher — shell passthrough', () => {
  it('detects credit followed by near-identical debit in 48h', () => {
    const txs: Transaction[] = [
      tx({
        id: 't1',
        direction: 'credit',
        counterpartyName: 'Src Corp',
        amountAed: 200_000,
        atIso: '2026-04-15T10:00:00.000Z',
      }),
      tx({
        id: 't2',
        direction: 'debit',
        counterpartyName: 'Dst Corp',
        amountAed: 200_000,
        atIso: '2026-04-16T11:00:00.000Z',
      }),
    ];
    const findings = runTypologyMatcher(txs);
    expect(findings.find((f) => f.kind === 'shell-passthrough')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// addBusinessDaysUae
// ---------------------------------------------------------------------------

describe('addBusinessDaysUae', () => {
  it('skips weekends (Sat+Sun)', () => {
    // Thursday 16 April 2026 + 1 business day = Friday 17 April
    const thu = new Date(Date.UTC(2026, 3, 16));
    const fri = addBusinessDaysUae(thu, 1);
    expect(fri.getUTCDay()).toBe(5); // Friday

    // Friday + 1 business day = Monday (skips Sat + Sun)
    const mon = addBusinessDaysUae(fri, 1);
    expect(mon.getUTCDay()).toBe(1); // Monday
  });
  it('10 business days from Wednesday = following Wednesday', () => {
    const wed = new Date(Date.UTC(2026, 3, 15));
    const result = addBusinessDaysUae(wed, 10);
    expect(result.getUTCDay()).toBe(3); // Wednesday
  });
});

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

describe('runTmBrain — empty batch', () => {
  it('returns pass with 0 scanned', () => {
    const record = runTmBrain([]);
    expect(record.verdict).toBe('pass');
    expect(record.scannedTxCount).toBe(0);
    expect(record.findings).toHaveLength(0);
    expect(record.summary).toMatch(/PASS/);
  });
});

describe('runTmBrain — happy path (all clean)', () => {
  it('returns pass on benign transactions', () => {
    const txs = [tx({ amountAed: 5_000 }), tx({ id: 't2', amountAed: 8_000 })];
    const record = runTmBrain(txs);
    expect(record.verdict).toBe('pass');
    expect(record.scannedTxCount).toBe(2);
    expect(record.findings).toHaveLength(0);
  });
});

describe('runTmBrain — CTR hit', () => {
  it('verdict=flag for a single AED 55K cash tx', () => {
    const record = runTmBrain([tx({ instrument: 'cash', amountAed: 55_000 })]);
    expect(['flag', 'escalate']).toContain(record.verdict);
    expect(record.findings.length).toBeGreaterThan(0);
  });
});

describe('runTmBrain — smurfing → auto-str', () => {
  it('verdict=auto-str and populates the STR filing deadline', () => {
    const asOf = new Date(Date.UTC(2026, 3, 15)); // Wednesday
    const txs: Transaction[] = [
      tx({
        id: 't1',
        instrument: 'cash',
        direction: 'credit',
        amountAed: 53_000,
        atIso: '2026-04-10T10:00:00.000Z',
      }),
      tx({
        id: 't2',
        instrument: 'cash',
        direction: 'credit',
        amountAed: 52_500,
        atIso: '2026-04-12T10:00:00.000Z',
      }),
      tx({
        id: 't3',
        instrument: 'cash',
        direction: 'credit',
        amountAed: 54_000,
        atIso: '2026-04-14T10:00:00.000Z',
      }),
    ];
    const record = runTmBrain(txs, { asOf });
    expect(record.verdict).toBe('auto-str');
    expect(record.strFilingDeadlineDdMmYyyy).toBeDefined();
    expect(record.strFilingDeadlineDdMmYyyy).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(record.summary).toMatch(/STR filing deadline/);
  });
});

describe('runTmBrain — window bounds', () => {
  it('derives window from min/max atIso', () => {
    const txs = [
      tx({ id: 't1', atIso: '2026-04-01T10:00:00.000Z' }),
      tx({ id: 't2', atIso: '2026-04-30T10:00:00.000Z' }),
      tx({ id: 't3', atIso: '2026-04-15T10:00:00.000Z' }),
    ];
    const record = runTmBrain(txs);
    expect(record.windowStartIso).toBe('2026-04-01T10:00:00.000Z');
    expect(record.windowEndIso).toBe('2026-04-30T10:00:00.000Z');
  });
});

describe('runTmBrainAllCustomers', () => {
  it('partitions by customerId', () => {
    const txs = [
      tx({ id: 't1', customerId: 'c-a', instrument: 'cash', amountAed: 55_000 }),
      tx({ id: 't2', customerId: 'c-b', instrument: 'wire', amountAed: 5_000 }),
    ];
    const records = runTmBrainAllCustomers(txs);
    expect(records).toHaveLength(2);
    const byId = new Map(records.map((r) => [r.customerId, r]));
    expect(byId.get('c-a')!.verdict).not.toBe('pass');
    expect(byId.get('c-b')!.verdict).toBe('pass');
  });
});
