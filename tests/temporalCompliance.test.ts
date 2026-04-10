import { describe, it, expect } from 'vitest';
import { TemporalComplianceLog, type ComplianceEvent } from '@/services/temporalCompliance';

const events: ComplianceEvent[] = [
  {
    id: 'e1',
    at: '2026-01-01T00:00:00Z',
    kind: 'onboarding',
    entityId: 'E1',
    data: { riskBand: 'low' },
  },
  { id: 'e2', at: '2026-02-01T00:00:00Z', kind: 'pep_flagged', entityId: 'E1' },
  {
    id: 'e3',
    at: '2026-02-15T00:00:00Z',
    kind: 'risk_rerated',
    entityId: 'E1',
    data: { riskBand: 'high' },
  },
  { id: 'e4', at: '2026-03-01T00:00:00Z', kind: 'sanctions_hit', entityId: 'E1' },
  { id: 'e5', at: '2026-03-01T01:00:00Z', kind: 'freeze_applied', entityId: 'E1' },
  { id: 'e6', at: '2026-03-05T00:00:00Z', kind: 'str_filed', entityId: 'E1' },
];

describe('temporalCompliance — state reconstruction', () => {
  it('state before any events is empty', () => {
    const log = new TemporalComplianceLog();
    log.appendMany(events);
    const s = log.stateAt('E1', '2025-12-31T00:00:00Z');
    expect(s.exists).toBe(false);
    expect(s.riskBand).toBe('unknown');
  });

  it('state after onboarding only', () => {
    const log = new TemporalComplianceLog();
    log.appendMany(events);
    const s = log.stateAt('E1', '2026-01-15T00:00:00Z');
    expect(s.exists).toBe(true);
    expect(s.riskBand).toBe('low');
    expect(s.isPep).toBe(false);
  });

  it('state mid-timeline captures PEP + risk rerate', () => {
    const log = new TemporalComplianceLog();
    log.appendMany(events);
    const s = log.stateAt('E1', '2026-02-20T00:00:00Z');
    expect(s.isPep).toBe(true);
    expect(s.riskBand).toBe('high');
    expect(s.hasSanctionsHit).toBe(false);
  });

  it('state after all events', () => {
    const log = new TemporalComplianceLog();
    log.appendMany(events);
    const s = log.stateAt('E1', '2026-04-01T00:00:00Z');
    expect(s.hasSanctionsHit).toBe(true);
    expect(s.isFrozen).toBe(true);
    expect(s.strsFiledCount).toBe(1);
  });

  it('events are applied in chronological order regardless of insert order', () => {
    const log = new TemporalComplianceLog();
    // Insert out of order.
    log.appendMany([events[3], events[0], events[2], events[1]]);
    const s = log.stateAt('E1', '2026-02-20T00:00:00Z');
    expect(s.riskBand).toBe('high');
    expect(s.isPep).toBe(true);
  });
});

describe('temporalCompliance — diffs + queries', () => {
  const log = new TemporalComplianceLog();
  log.appendMany(events);

  it('diff captures changed fields between two times', () => {
    const changes = log.diff('E1', '2026-02-01T00:00:00Z', '2026-03-05T00:00:00Z');
    const fields = changes.map((c) => c.field);
    expect(fields).toContain('riskBand');
    expect(fields).toContain('hasSanctionsHit');
    expect(fields).toContain('isFrozen');
    expect(fields).toContain('strsFiledCount');
  });

  it('eventsBetween returns events in range', () => {
    const range = log.eventsBetween(
      'E1',
      '2026-02-01T00:00:00Z',
      '2026-03-04T00:00:00Z',
    );
    expect(range.map((e) => e.id).sort()).toEqual(['e2', 'e3', 'e4', 'e5']);
  });
});
