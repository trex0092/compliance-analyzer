/**
 * Unit tests for Weaponized Brain Phase 14 subsystems (#104-#109).
 */
import { describe, it, expect } from 'vitest';
import {
  detectCrossJurisdictionConflicts,
  runPeerGroupDeviation,
  runRegulatoryCalendar,
  scoreInterSubsystemAgreement,
  runCounterfactualCompletion,
  type PeerGroupDistribution,
  type RegulatoryDeadline,
} from '@/services/weaponizedPhase14';
import type { SubsystemSignal } from '@/services/contradictionDetector';

// ---------------------------------------------------------------------------
// #104 Cross-Jurisdiction Conflict
// ---------------------------------------------------------------------------

describe('detectCrossJurisdictionConflicts (#104)', () => {
  it('flags US-EU OFAC/Blocking conflict on freeze action', () => {
    const out = detectCrossJurisdictionConflicts({
      action: 'freeze',
      jurisdictions: ['US', 'EU'],
    });
    expect(out.conflicts).toHaveLength(1);
    expect(out.conflicts[0].severity).toBe('high');
    expect(out.hasHighSeverityConflict).toBe(true);
    expect(out.conflicts[0].citations.some((c) => /2271\/96/.test(c))).toBe(true);
    expect(out.narrative).toMatch(/HIGH severity/);
  });

  it('flags UAE-US tipping-off / SAR disclosure conflict on file-str', () => {
    const out = detectCrossJurisdictionConflicts({
      action: 'file-str',
      jurisdictions: ['UAE', 'US'],
    });
    expect(out.hasHighSeverityConflict).toBe(true);
    expect(out.conflicts[0].citations.some((c) => /Art\.29/i.test(c))).toBe(true);
  });

  it('returns an empty list when no rules match', () => {
    const out = detectCrossJurisdictionConflicts({
      action: 'freeze',
      jurisdictions: ['UAE', 'SG'],
    });
    expect(out.conflicts).toEqual([]);
    expect(out.hasHighSeverityConflict).toBe(false);
    expect(out.narrative).toMatch(/No cross-jurisdiction conflicts/);
  });

  it('only reports conflicts where both jurisdictions in a rule are present', () => {
    const out = detectCrossJurisdictionConflicts({
      action: 'freeze',
      jurisdictions: ['US'], // EU missing — rule shouldn't fire
    });
    expect(out.conflicts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// #105 Peer-Group Deviation
// ---------------------------------------------------------------------------

describe('runPeerGroupDeviation (#105)', () => {
  it('reports low deviation when verdict matches peer majority', () => {
    const peer: PeerGroupDistribution = {
      peerCount: 100,
      distribution: { pass: 0.9, flag: 0.08, escalate: 0.015, freeze: 0.005 },
    };
    const out = runPeerGroupDeviation({ currentVerdict: 'pass', peer });
    expect(out.significantDeviation).toBe(false);
    expect(out.peerMatchFraction).toBeCloseTo(0.9, 2);
    expect(out.narrative).toMatch(/Within peer norms/);
  });

  it('flags significant deviation when verdict is far above peer mean', () => {
    const peer: PeerGroupDistribution = {
      peerCount: 500,
      distribution: { pass: 0.98, flag: 0.015, escalate: 0.003, freeze: 0.002 },
    };
    const out = runPeerGroupDeviation({ currentVerdict: 'freeze', peer });
    expect(out.significantDeviation).toBe(true);
    expect(out.zScore).toBeGreaterThan(2);
    expect(out.narrative).toMatch(/Cabinet Res 134\/2025 Art\.19/);
  });

  it('handles a degenerate (all-pass) peer group without NaN', () => {
    const peer: PeerGroupDistribution = {
      peerCount: 10,
      distribution: { pass: 1, flag: 0, escalate: 0, freeze: 0 },
    };
    const out = runPeerGroupDeviation({ currentVerdict: 'pass', peer });
    expect(Number.isFinite(out.zScore)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #106 Regulatory Calendar
// ---------------------------------------------------------------------------

describe('runRegulatoryCalendar (#106)', () => {
  const now = new Date('2026-04-16T12:00:00Z');

  it('buckets deadlines by urgency and cites the right regulation', () => {
    const deadlines: RegulatoryDeadline[] = [
      { kind: 'EOCN-freeze', due: new Date('2026-04-17T00:00:00Z'), ref: 'case-1' }, // 12h → 24h
      { kind: 'CNMR', due: new Date('2026-04-19T12:00:00Z'), ref: 'case-2' }, // 3d → 5d
      { kind: 'CDD-review', due: new Date('2026-05-01T12:00:00Z'), ref: 'cust-42' }, // 15d → 30d
      { kind: 'STR', due: new Date('2026-04-15T00:00:00Z'), ref: 'str-99' }, // overdue
    ];
    const out = runRegulatoryCalendar({ deadlines, asOf: now });
    expect(out.entries).toHaveLength(4);
    expect(out.overdueCount).toBe(1);
    expect(out.within24hCount).toBe(1);
    // Entries sorted most-urgent first.
    expect(out.entries[0].urgency).toBe('overdue');
    expect(out.entries[0].citation).toBe('FDL No.10/2025 Art.26-27');
    // EOCN freeze citation.
    const eocn = out.entries.find((e) => e.deadline.kind === 'EOCN-freeze');
    expect(eocn?.citation).toBe('Cabinet Res 74/2020 Art.4-7');
  });

  it('reports no breaches when all deadlines are distant', () => {
    const deadlines: RegulatoryDeadline[] = [
      { kind: 'policy-update', due: new Date('2026-06-01T00:00:00Z') },
    ];
    const out = runRegulatoryCalendar({ deadlines, asOf: now });
    expect(out.overdueCount).toBe(0);
    expect(out.within24hCount).toBe(0);
    expect(out.narrative).toMatch(/No immediate breaches/);
  });

  it('accepts ISO-string dates and Date objects interchangeably', () => {
    const deadlines: RegulatoryDeadline[] = [{ kind: 'CTR', due: '2026-04-17T00:00:00Z' }];
    const out = runRegulatoryCalendar({ deadlines, asOf: now });
    expect(out.entries[0].urgency).toBe('24h');
  });
});

// ---------------------------------------------------------------------------
// #107 Inter-Subsystem Agreement
// ---------------------------------------------------------------------------

describe('scoreInterSubsystemAgreement (#107)', () => {
  it('reports unanimous agreement when every signal concurs', () => {
    const signals: SubsystemSignal[] = [
      { name: 'A', impliedVerdict: 'freeze', confidence: 0.9 },
      { name: 'B', impliedVerdict: 'freeze', confidence: 0.8 },
    ];
    const out = scoreInterSubsystemAgreement({ finalVerdict: 'freeze', signals });
    expect(out.considered).toBe(2);
    expect(out.concurring).toBe(2);
    expect(out.ratio).toBe(1);
    expect(out.weightedRatio).toBe(1);
    expect(out.dissenters).toEqual([]);
    expect(out.narrative).toMatch(/Unanimous/);
  });

  it('lists dissenters with lower confidence than majority', () => {
    const signals: SubsystemSignal[] = [
      { name: 'majA', impliedVerdict: 'escalate', confidence: 0.9 },
      { name: 'majB', impliedVerdict: 'escalate', confidence: 0.9 },
      { name: 'dissent', impliedVerdict: 'pass', confidence: 0.7 },
    ];
    const out = scoreInterSubsystemAgreement({ finalVerdict: 'escalate', signals });
    expect(out.concurring).toBe(2);
    expect(out.considered).toBe(3);
    expect(out.dissenters).toEqual(['dissent']);
    expect(out.ratio).toBeCloseTo(2 / 3, 2);
  });

  it('excludes low-confidence signals from the denominator', () => {
    const signals: SubsystemSignal[] = [
      { name: 'loud', impliedVerdict: 'freeze', confidence: 0.95 },
      { name: 'whisper', impliedVerdict: 'pass', confidence: 0.2 },
    ];
    const out = scoreInterSubsystemAgreement({ finalVerdict: 'freeze', signals });
    expect(out.considered).toBe(1);
    expect(out.concurring).toBe(1);
    expect(out.dissenters).toEqual([]);
  });

  it('treats empty signals as unanimous 100% (no disagreement to report)', () => {
    const out = scoreInterSubsystemAgreement({ finalVerdict: 'pass', signals: [] });
    expect(out.considered).toBe(0);
    expect(out.ratio).toBe(1);
    expect(out.weightedRatio).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// #109 Counterfactual Completion
// ---------------------------------------------------------------------------

describe('runCounterfactualCompletion (#109)', () => {
  it('lists evidence gaps above the current verdict rank', () => {
    const out = runCounterfactualCompletion({
      currentVerdict: 'pass',
      knownEvidenceTypes: [],
    });
    expect(out.exhaustive).toBe(false);
    // Every library entry is > pass → at least one gap.
    expect(out.gaps.length).toBeGreaterThan(0);
    // Each gap carries a regulatory citation.
    expect(out.gaps.every((g) => g.citation.length > 0)).toBe(true);
  });

  it('excludes evidence types already known', () => {
    const out = runCounterfactualCompletion({
      currentVerdict: 'pass',
      knownEvidenceTypes: ['confirmed-sanctions-match'],
    });
    expect(out.gaps.some((g) => g.evidenceType === 'confirmed-sanctions-match')).toBe(false);
  });

  it('reports exhaustive=true when verdict already at freeze', () => {
    const out = runCounterfactualCompletion({
      currentVerdict: 'freeze',
      knownEvidenceTypes: [],
    });
    expect(out.exhaustive).toBe(true);
    expect(out.gaps).toEqual([]);
    expect(out.narrative).toMatch(/ceiling|no actionable/);
  });

  it('only surfaces gaps whose target verdict is above the current rank', () => {
    const out = runCounterfactualCompletion({
      currentVerdict: 'escalate',
      knownEvidenceTypes: [],
    });
    // Only freeze-level evidence should remain actionable from escalate.
    expect(out.gaps.every((g) => g.wouldReach === 'freeze')).toBe(true);
  });
});
