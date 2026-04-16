/**
 * Unit tests for UAE Dominance Edge weapons.
 */
import { describe, it, expect } from 'vitest';
import {
  runEocnCountdown,
  diffSanctionsLists,
  checkAedThresholdLocked,
  compileDpmsrQuarterly,
  type EocnCountdownState,
  type SanctionsListEntry,
  type CustomerForRescreen,
  type DpmsrQuarterlyInput,
} from '@/services/weaponizedUaeDominance';

// ---------------------------------------------------------------------------
// 1. runEocnCountdown
// ---------------------------------------------------------------------------

describe('runEocnCountdown', () => {
  const base: EocnCountdownState = {
    subjectId: 'SUBJ-1',
    matchConfidence: 0.95,
    freezeStartIso: '2026-04-16T00:00:00Z',
    lastExecutedStage: 'idle',
  };

  it('is idle at T+0h and cites the regulation', () => {
    const out = runEocnCountdown({ state: base, asOf: new Date('2026-04-16T00:00:00Z') });
    expect(out.stage).toBe('idle');
    expect(out.blocking).toBe(false);
    expect(out.citation).toMatch(/Cabinet Res 74\/2020 Art\.4-7/);
    expect(out.citation).toMatch(/Art\.29/); // no-tipping-off
  });

  it('enters mlro-ping stage at T+12h (12h remaining)', () => {
    const out = runEocnCountdown({ state: base, asOf: new Date('2026-04-16T12:00:00Z') });
    expect(out.stage).toBe('mlro-ping');
    expect(out.hoursRemaining).toBe(12);
    expect(out.actions.some((a) => /MLRO/.test(a))).toBe(true);
    expect(out.actions.some((a) => /Art\.29/.test(a))).toBe(true);
  });

  it('enters co-escalation stage at T+20h (4h remaining) and becomes blocking', () => {
    const out = runEocnCountdown({ state: base, asOf: new Date('2026-04-16T20:00:00Z') });
    expect(out.stage).toBe('co-escalation');
    expect(out.hoursRemaining).toBe(4);
    expect(out.blocking).toBe(true);
    expect(out.actions.some((a) => /CNMR/.test(a))).toBe(true);
  });

  it('triggers outbound-lockout at T+23h (1h remaining)', () => {
    const out = runEocnCountdown({ state: base, asOf: new Date('2026-04-16T23:00:00Z') });
    expect(out.stage).toBe('outbound-lockout');
    expect(out.blocking).toBe(true);
    expect(out.actions.some((a) => /autoFreezeExecutor/.test(a))).toBe(true);
  });

  it('marks overdue when the 24h window has elapsed', () => {
    const out = runEocnCountdown({ state: base, asOf: new Date('2026-04-17T01:00:00Z') });
    expect(out.stage).toBe('overdue');
    expect(out.hoursRemaining).toBeLessThanOrEqual(0);
    expect(out.actions.some((a) => /EOCN/.test(a))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. diffSanctionsLists
// ---------------------------------------------------------------------------

describe('diffSanctionsLists', () => {
  it('detects additions and flags customers that match', () => {
    const previous: SanctionsListEntry[] = [{ id: '1', name: 'Alice Old', list: 'UN' }];
    const next: SanctionsListEntry[] = [
      { id: '1', name: 'Alice Old', list: 'UN' },
      { id: '2', name: 'Bob Newhire', list: 'OFAC', aliases: ['B. Newhire'] },
    ];
    const customers: CustomerForRescreen[] = [
      { customerId: 'c1', name: 'Bob Newhire' },
      { customerId: 'c2', name: 'Charlie Quiet' },
    ];
    const out = diffSanctionsLists({ previous, next, customers });
    expect(out.added).toHaveLength(1);
    expect(out.added[0].id).toBe('2');
    expect(out.removed).toHaveLength(0);
    expect(out.rescreenRequired).toHaveLength(1);
    expect(out.rescreenRequired[0].customerId).toBe('c1');
    expect(out.rescreenRequired[0].matchedEntryId).toBe('OFAC:2');
  });

  it('detects removals without producing a rescreen entry', () => {
    const previous: SanctionsListEntry[] = [
      { id: '1', name: 'Alice Old', list: 'UN' },
      { id: '2', name: 'Bob Gone', list: 'OFAC' },
    ];
    const next: SanctionsListEntry[] = [{ id: '1', name: 'Alice Old', list: 'UN' }];
    const out = diffSanctionsLists({ previous, next, customers: [] });
    expect(out.removed).toHaveLength(1);
    expect(out.removed[0].id).toBe('2');
    expect(out.rescreenRequired).toHaveLength(0);
  });

  it('matches customers by alias against newly-added entries', () => {
    const previous: SanctionsListEntry[] = [];
    const next: SanctionsListEntry[] = [{ id: '99', name: 'Shell Corp XYZ', list: 'EU' }];
    const customers: CustomerForRescreen[] = [
      { customerId: 'cust-500', name: 'Different Name', aliases: ['Shell Corp XYZ'] },
    ];
    const out = diffSanctionsLists({ previous, next, customers });
    expect(out.rescreenRequired).toHaveLength(1);
    expect(out.rescreenRequired[0].customerId).toBe('cust-500');
  });

  it('cites FDL Art.35 + Cabinet Res 74/2020 in the narrative', () => {
    const out = diffSanctionsLists({ previous: [], next: [], customers: [] });
    expect(out.narrative).toMatch(/FDL Art\.35/);
    expect(out.narrative).toMatch(/Cabinet Res 74\/2020/);
  });
});

// ---------------------------------------------------------------------------
// 3. checkAedThresholdLocked
// ---------------------------------------------------------------------------

describe('checkAedThresholdLocked', () => {
  it('uses the locked CBUAE rate for USD→AED conversion', () => {
    // 15,000 USD * 3.67 AED/USD = 55,050 AED → meets AED 55K DPMS threshold
    const out = checkAedThresholdLocked({
      kind: 'DPMS-CTR',
      currency: 'USD',
      amount: 15_000,
      transactionDate: '2026-02-15',
      cbuaeRateOnTransactionDate: 3.67,
    });
    expect(out.amountAed).toBeCloseTo(55_050, 0);
    expect(out.thresholdAed).toBe(55_000);
    expect(out.meetsThreshold).toBe(true);
    expect(out.citation).toBe('MoE Circular 08/AML/2021');
    expect(out.narrative).toMatch(/locked to 2026-02-15/);
  });

  it('marks below-threshold transactions correctly', () => {
    const out = checkAedThresholdLocked({
      kind: 'DPMS-CTR',
      currency: 'USD',
      amount: 10_000,
      transactionDate: '2026-02-15',
      cbuaeRateOnTransactionDate: 3.67,
    });
    expect(out.meetsThreshold).toBe(false);
  });

  it('handles AED input directly (rate=1)', () => {
    const out = checkAedThresholdLocked({
      kind: 'cross-border-cash',
      currency: 'AED',
      amount: 60_000,
      transactionDate: '2026-03-01',
      cbuaeRateOnTransactionDate: 1,
    });
    expect(out.amountAed).toBe(60_000);
    expect(out.thresholdAed).toBe(60_000);
    expect(out.meetsThreshold).toBe(true);
    expect(out.citation).toBe('Cabinet Res 134/2025 Art.16');
  });

  it('rejects a non-positive CBUAE rate for FX-involved checks', () => {
    expect(() =>
      checkAedThresholdLocked({
        kind: 'DPMS-CTR',
        currency: 'USD',
        amount: 15_000,
        transactionDate: '2026-02-15',
        cbuaeRateOnTransactionDate: 0,
      })
    ).toThrow(/CBUAE rate/);
  });

  it('treats UBO ownership percentage without FX math', () => {
    const out = checkAedThresholdLocked({
      kind: 'UBO-ownership-pct',
      currency: 'AED',
      amount: 30, // 30%
      transactionDate: '2026-04-01',
      cbuaeRateOnTransactionDate: 1,
    });
    expect(out.meetsThreshold).toBe(true);
    expect(out.thresholdAed).toBe(25);
    expect(out.citation).toBe('Cabinet Decision 109/2023');
  });

  it('honours a custom threshold override when kind is custom', () => {
    const out = checkAedThresholdLocked({
      kind: 'custom',
      currency: 'AED',
      amount: 100_000,
      transactionDate: '2026-03-01',
      cbuaeRateOnTransactionDate: 1,
      customThresholdAed: 75_000,
    });
    expect(out.thresholdAed).toBe(75_000);
    expect(out.meetsThreshold).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. compileDpmsrQuarterly
// ---------------------------------------------------------------------------

describe('compileDpmsrQuarterly', () => {
  const baseInput: DpmsrQuarterlyInput = {
    entityId: 'MADISON-LLC',
    entityName: 'MADISON LLC',
    quarter: 'Q1 2026',
    periodStartIso: '2026-01-01',
    periodEndIso: '2026-03-31',
    counts: {
      screeningsTotal: 500,
      screeningsCleared: 480,
      confirmedMatches: 2,
      potentialMatchesEscalated: 18,
      strFiled: 3,
      ctrFiled: 12,
      dpmsrFiled: 1,
      freezesExecuted: 2,
      freezeReleasesRequested: 0,
      cddOnboarded: 45,
      eddCases: 8,
    },
    complianceOfficerName: 'Luisa Fernanda',
    trainingRefreshCompleted: true,
  };

  it('produces six sections and marks ready-to-file when clean', () => {
    const out = compileDpmsrQuarterly(baseInput);
    expect(out.sections).toHaveLength(6);
    expect(out.readyToFile).toBe(true);
    expect(out.blockers).toEqual([]);
    expect(out.citation).toBe('MoE Circular 08/AML/2021');
  });

  it('blocks filing when freezes do not reconcile with confirmed matches', () => {
    const out = compileDpmsrQuarterly({
      ...baseInput,
      counts: { ...baseInput.counts, confirmedMatches: 5, freezesExecuted: 2 },
    });
    expect(out.readyToFile).toBe(false);
    expect(out.blockers.some((b) => /Freeze execution gap/.test(b))).toBe(true);
  });

  it('blocks filing when training refresh is missing', () => {
    const out = compileDpmsrQuarterly({ ...baseInput, trainingRefreshCompleted: false });
    expect(out.readyToFile).toBe(false);
    expect(out.blockers.some((b) => /Training refresh/.test(b))).toBe(true);
  });

  it('flags implausible zero-screenings quarter', () => {
    const out = compileDpmsrQuarterly({
      ...baseInput,
      counts: {
        ...baseInput.counts,
        screeningsTotal: 0,
        screeningsCleared: 0,
        confirmedMatches: 0,
        freezesExecuted: 0,
      },
    });
    expect(out.readyToFile).toBe(false);
    expect(out.blockers.some((b) => /ingestion pipeline/.test(b))).toBe(true);
  });

  it('includes MoE Circular citation in the citations section', () => {
    const out = compileDpmsrQuarterly(baseInput);
    const citationsSection = out.sections.find((s) => /Citations/.test(s.title));
    expect(citationsSection?.content).toMatch(/MoE Circular 08\/AML\/2021/);
    expect(citationsSection?.content).toMatch(/FDL No\.10\/2025/);
  });
});
