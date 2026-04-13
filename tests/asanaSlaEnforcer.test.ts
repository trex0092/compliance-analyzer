import { describe, expect, it } from 'vitest';
import { computeSla, evaluateSlaStatus } from '@/services/asanaSlaEnforcer';

describe('computeSla', () => {
  it('produces a 24-hour due date for an EOCN freeze', () => {
    const plan = computeSla({
      startedAtIso: '2026-04-13T00:00:00.000Z',
      kind: 'eocn_freeze_24h',
    });
    expect(plan.dueAtIso).toBe('2026-04-14T00:00:00.000Z');
    expect(plan.clockHours).toBe(true);
    expect(plan.breachSeverity).toBe('critical');
  });

  it('reminder fires before the due date for a 24h SLA', () => {
    const plan = computeSla({
      startedAtIso: '2026-04-13T00:00:00.000Z',
      kind: 'eocn_freeze_24h',
    });
    expect(new Date(plan.reminderAtIso).getTime()).toBeLessThan(
      new Date(plan.dueAtIso).getTime()
    );
  });

  it('honours overrideHours', () => {
    const plan = computeSla({
      startedAtIso: '2026-04-13T00:00:00.000Z',
      kind: 'cnmr_5_business_days',
      overrideHours: 48,
    });
    expect(plan.dueAtIso).toBe('2026-04-15T00:00:00.000Z');
  });

  it('rejects malformed timestamps', () => {
    expect(() =>
      computeSla({ startedAtIso: 'not-a-date', kind: 'eocn_freeze_24h' })
    ).toThrow();
  });

  it('rejects non-positive override hours', () => {
    expect(() =>
      computeSla({
        startedAtIso: '2026-04-13T00:00:00.000Z',
        kind: 'eocn_freeze_24h',
        overrideHours: 0,
      })
    ).toThrow();
  });
});

describe('evaluateSlaStatus', () => {
  const plan = computeSla({
    startedAtIso: '2026-04-13T00:00:00.000Z',
    kind: 'eocn_freeze_24h',
  });

  it('returns on-time before the reminder window', () => {
    const status = evaluateSlaStatus(plan, '2026-04-13T01:00:00.000Z');
    expect(status.status).toBe('on-time');
    expect(status.severity).toBe('low');
  });

  it('returns reminder-window inside the warning band', () => {
    const status = evaluateSlaStatus(plan, '2026-04-13T22:30:00.000Z');
    expect(status.status).toBe('reminder-window');
    expect(status.severity).toBe('critical');
  });

  it('returns breached after the due timestamp', () => {
    const status = evaluateSlaStatus(plan, '2026-04-14T01:00:00.000Z');
    expect(status.status).toBe('breached');
    expect(status.minutesUntilDue).toBeLessThan(0);
  });
});
