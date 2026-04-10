import { describe, it, expect } from 'vitest';
import {
  detectStructuring,
  detectFanIn,
  detectFanOut,
  detectCycling,
  detectVelocityAnomaly,
  detectAmountEntropy,
  runAllDetectors,
  type Transaction,
} from '@/services/transactionAnomaly';

function tx(
  id: string,
  amountAED: number,
  dayOffset: number,
  counterpartyId = 'cp-x',
  customerId = 'cust-1',
): Transaction {
  const d = new Date('2026-04-10T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return { id, at: d.toISOString(), amountAED, counterpartyId, customerId };
}

// ---------------------------------------------------------------------------
// Structuring
// ---------------------------------------------------------------------------

describe('detectStructuring', () => {
  it('flags 3 transactions just below AED 55K within 14 days', () => {
    const txs = [
      tx('1', 54000, 0),
      tx('2', 53000, 2),
      tx('3', 52500, 4),
    ];
    const findings = detectStructuring(txs);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('structuring');
    expect(findings[0].transactionIds).toHaveLength(3);
  });

  it('does NOT flag transactions well below the band', () => {
    const txs = [tx('1', 10000, 0), tx('2', 12000, 1), tx('3', 15000, 2)];
    expect(detectStructuring(txs)).toHaveLength(0);
  });

  it('does NOT flag 2 transactions in-band (below minCount)', () => {
    const txs = [tx('1', 54000, 0), tx('2', 53000, 2)];
    expect(detectStructuring(txs)).toHaveLength(0);
  });

  it('does NOT flag when transactions are outside the 14-day window', () => {
    const txs = [tx('1', 54000, 0), tx('2', 53000, 20), tx('3', 52500, 40)];
    expect(detectStructuring(txs)).toHaveLength(0);
  });

  it('marks severity medium or high on sustained structuring', () => {
    const txs = [
      tx('1', 54000, 0),
      tx('2', 53000, 1),
      tx('3', 52500, 2),
      tx('4', 54500, 3),
      tx('5', 53500, 4),
      tx('6', 54800, 5),
    ];
    const findings = detectStructuring(txs);
    expect(['medium', 'high']).toContain(findings[0].severity);
    expect(findings[0].confidence).toBeGreaterThanOrEqual(0.5);
  });
});

// ---------------------------------------------------------------------------
// Fan-in / Fan-out
// ---------------------------------------------------------------------------

describe('detectFanIn', () => {
  it('flags when 10+ distinct counterparties send inflows in 7 days', () => {
    const txs: Transaction[] = [];
    for (let i = 0; i < 12; i++) {
      txs.push(tx(`in-${i}`, 5000, 0, `cp-${i}`));
    }
    const findings = detectFanIn(txs);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('fan_in');
  });

  it('ignores outflows', () => {
    const txs: Transaction[] = [];
    for (let i = 0; i < 12; i++) {
      txs.push(tx(`out-${i}`, -5000, 0, `cp-${i}`));
    }
    expect(detectFanIn(txs)).toHaveLength(0);
  });

  it('does not flag fewer than minUniqueCounterparties', () => {
    const txs: Transaction[] = [];
    for (let i = 0; i < 5; i++) {
      txs.push(tx(`in-${i}`, 5000, 0, `cp-${i}`));
    }
    expect(detectFanIn(txs)).toHaveLength(0);
  });
});

describe('detectFanOut', () => {
  it('flags when one subject sends to 10+ distinct counterparties', () => {
    const txs: Transaction[] = [];
    for (let i = 0; i < 12; i++) {
      txs.push(tx(`out-${i}`, -5000, 0, `cp-${i}`));
    }
    const findings = detectFanOut(txs);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('fan_out');
  });

  it('ignores inflows', () => {
    const txs: Transaction[] = [];
    for (let i = 0; i < 12; i++) {
      txs.push(tx(`in-${i}`, 5000, 0, `cp-${i}`));
    }
    expect(detectFanOut(txs)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cycling
// ---------------------------------------------------------------------------

describe('detectCycling', () => {
  it('flags A → B (outflow) → A (return within 72h, similar amount)', () => {
    const d1 = new Date('2026-04-10T10:00:00Z').toISOString();
    const d2 = new Date('2026-04-11T14:00:00Z').toISOString();
    const txs: Transaction[] = [
      { id: 'out', at: d1, amountAED: -100000, counterpartyId: 'cp-B', customerId: 'A' },
      { id: 'in', at: d2, amountAED: 98000, counterpartyId: 'cp-B', customerId: 'A' },
    ];
    const findings = detectCycling(txs);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('cycling');
  });

  it('does NOT flag when amounts differ by more than tolerance', () => {
    const d1 = new Date('2026-04-10T10:00:00Z').toISOString();
    const d2 = new Date('2026-04-11T14:00:00Z').toISOString();
    const txs: Transaction[] = [
      { id: 'out', at: d1, amountAED: -100000, counterpartyId: 'cp-B', customerId: 'A' },
      { id: 'in', at: d2, amountAED: 50000, counterpartyId: 'cp-B', customerId: 'A' },
    ];
    expect(detectCycling(txs)).toHaveLength(0);
  });

  it('does NOT flag when return is beyond the window', () => {
    const d1 = new Date('2026-04-10T10:00:00Z').toISOString();
    const d2 = new Date('2026-04-20T14:00:00Z').toISOString();
    const txs: Transaction[] = [
      { id: 'out', at: d1, amountAED: -100000, counterpartyId: 'cp-B', customerId: 'A' },
      { id: 'in', at: d2, amountAED: 100000, counterpartyId: 'cp-B', customerId: 'A' },
    ];
    expect(detectCycling(txs)).toHaveLength(0);
  });

  it('does NOT flag when counterparty differs', () => {
    const d1 = new Date('2026-04-10T10:00:00Z').toISOString();
    const d2 = new Date('2026-04-11T14:00:00Z').toISOString();
    const txs: Transaction[] = [
      { id: 'out', at: d1, amountAED: -100000, counterpartyId: 'cp-B', customerId: 'A' },
      { id: 'in', at: d2, amountAED: 100000, counterpartyId: 'cp-C', customerId: 'A' },
    ];
    expect(detectCycling(txs)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Velocity
// ---------------------------------------------------------------------------

describe('detectVelocityAnomaly', () => {
  it('flags a day with ≥3σ more transactions than the baseline', () => {
    const txs: Transaction[] = [];
    // Baseline: 1 tx/day for 30 days
    for (let i = 30; i > 0; i--) {
      txs.push(tx(`base-${i}`, 1000, -i));
    }
    // Today: 10 txs — massive spike
    for (let i = 0; i < 10; i++) {
      txs.push(tx(`today-${i}`, 1000, 0));
    }
    const findings = detectVelocityAnomaly(txs, new Date('2026-04-10T23:00:00Z').toISOString());
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].kind).toBe('velocity');
  });

  it('does not flag when today is consistent with baseline', () => {
    const txs: Transaction[] = [];
    for (let i = 30; i > 0; i--) {
      txs.push(tx(`base-${i}`, 1000, -i));
    }
    txs.push(tx('today-1', 1000, 0));
    const findings = detectVelocityAnomaly(txs, new Date('2026-04-10T23:00:00Z').toISOString());
    expect(findings).toHaveLength(0);
  });

  it('skips customers with <5 baseline days', () => {
    const txs = [tx('1', 1000, -1), tx('2', 1000, -2), tx('t1', 1000, 0), tx('t2', 1000, 0)];
    expect(detectVelocityAnomaly(txs, new Date('2026-04-10T23:00:00Z').toISOString())).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Amount entropy
// ---------------------------------------------------------------------------

describe('detectAmountEntropy', () => {
  it('flags all-round-number transactions', () => {
    const txs: Transaction[] = [];
    for (let i = 0; i < 10; i++) {
      txs.push(tx(`r-${i}`, 50000, i));
    }
    const findings = detectAmountEntropy(txs);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].kind).toBe('amount_entropy');
  });

  it('flags mode-dominated transactions (>=60% same)', () => {
    const txs: Transaction[] = [];
    for (let i = 0; i < 7; i++) {
      txs.push(tx(`same-${i}`, 12345, i));
    }
    for (let i = 0; i < 3; i++) {
      txs.push(tx(`other-${i}`, 9876 + i, 7 + i));
    }
    const findings = detectAmountEntropy(txs);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does not flag natural-variance transactions', () => {
    const txs: Transaction[] = [
      tx('1', 12345, 0),
      tx('2', 67890, 1),
      tx('3', 11222, 2),
      tx('4', 43567, 3),
      tx('5', 98765, 4),
      tx('6', 23456, 5),
    ];
    expect(detectAmountEntropy(txs)).toHaveLength(0);
  });

  it('skips customers with <5 transactions', () => {
    const txs = [tx('1', 50000, 0), tx('2', 50000, 1), tx('3', 50000, 2)];
    expect(detectAmountEntropy(txs)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// runAllDetectors
// ---------------------------------------------------------------------------

describe('runAllDetectors', () => {
  it('aggregates findings from all detectors', () => {
    const txs: Transaction[] = [];
    // Structuring
    txs.push(tx('s1', 54000, 0));
    txs.push(tx('s2', 53000, 2));
    txs.push(tx('s3', 52500, 4));
    // Fan-in
    for (let i = 0; i < 12; i++) {
      txs.push(tx(`fi-${i}`, 5000, 1, `fi-cp-${i}`, 'cust-fanin'));
    }
    const { findings, detectorStats } = runAllDetectors(txs);
    expect(findings.length).toBeGreaterThan(0);
    expect(detectorStats.structuring).toBeGreaterThan(0);
    expect(detectorStats.fan_in).toBeGreaterThan(0);
  });

  it('returns empty findings for a quiet portfolio', () => {
    const txs = [tx('1', 1000, 0), tx('2', 2000, 1), tx('3', 500, 2)];
    const { findings } = runAllDetectors(txs);
    expect(findings).toHaveLength(0);
  });
});
