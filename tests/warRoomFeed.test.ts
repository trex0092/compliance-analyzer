import { describe, it, expect } from 'vitest';
import { WarRoomFeed, type WarRoomEvent } from '@/services/warRoomFeed';

const at = (isoOffsetMinutes: number, base = '2026-04-10T12:00:00Z'): string => {
  const d = new Date(base);
  d.setMinutes(d.getMinutes() + isoOffsetMinutes);
  return d.toISOString();
};

const event = (partial: Partial<WarRoomEvent>): WarRoomEvent => ({
  id: `e-${Math.random().toString(36).slice(2, 8)}`,
  at: at(0),
  kind: 'screening',
  severity: 'info',
  title: 'screen',
  ...partial,
});

describe('warRoomFeed — basic ingest', () => {
  it('counts total events ingested', () => {
    const feed = new WarRoomFeed();
    feed.ingest(event({}));
    feed.ingest(event({}));
    expect(feed.snapshot().totalEventsIngested).toBe(2);
  });

  it('opens an incident for sanctions match', () => {
    const feed = new WarRoomFeed();
    feed.ingest(
      event({ kind: 'sanctions_match', severity: 'high', title: 'Acme hit', entityId: 'E1' }),
    );
    const snap = feed.snapshot();
    expect(snap.activeIncidents).toHaveLength(1);
    expect(snap.incidentsBySeverity.high).toBe(1);
  });

  it('tracks active freezes', () => {
    const feed = new WarRoomFeed();
    feed.ingest(event({ kind: 'freeze_initiated', severity: 'critical', entityId: 'E1' }));
    feed.ingest(event({ kind: 'freeze_initiated', severity: 'critical', entityId: 'E2' }));
    expect(feed.snapshot().kpis.freezesActive).toBe(2);
    feed.ingest(event({ kind: 'freeze_released', severity: 'info', entityId: 'E1' }));
    expect(feed.snapshot().kpis.freezesActive).toBe(1);
  });

  it('sorts active incidents by severity', () => {
    const feed = new WarRoomFeed();
    feed.ingest(event({ id: 'a', kind: 'sanctions_match', severity: 'medium' }));
    feed.ingest(event({ id: 'b', kind: 'sanctions_match', severity: 'critical' }));
    feed.ingest(event({ id: 'c', kind: 'sanctions_match', severity: 'high' }));
    const sev = feed.snapshot().activeIncidents.map((i) => i.severity);
    expect(sev).toEqual(['critical', 'high', 'medium']);
  });
});

describe('warRoomFeed — deadlines + KPIs', () => {
  it('computes minutesRemaining for deadlines', () => {
    const feed = new WarRoomFeed();
    const now = new Date('2026-04-10T12:00:00Z');
    const deadline = new Date('2026-04-10T14:00:00Z');
    feed.ingest(
      event({
        kind: 'deadline_alert',
        severity: 'high',
        deadlineIso: deadline.toISOString(),
      }),
    );
    const snap = feed.snapshot(now);
    expect(snap.upcomingDeadlines).toHaveLength(1);
    expect(snap.upcomingDeadlines[0].minutesRemaining).toBe(120);
  });

  it('computes match rate over last hour', () => {
    const feed = new WarRoomFeed();
    const now = new Date('2026-04-10T12:00:00Z');
    // 10 screens, 3 matches in the last hour
    for (let i = 0; i < 7; i++) feed.ingest(event({ kind: 'screening', severity: 'info' }));
    for (let i = 0; i < 3; i++)
      feed.ingest(event({ kind: 'sanctions_match', severity: 'high' }));
    const snap = feed.snapshot(now);
    expect(snap.kpis.screeningsLast1h).toBe(10);
    expect(snap.kpis.sanctionsMatchesLast1h).toBe(3);
    expect(snap.kpis.matchRateLast1h).toBeCloseTo(0.3);
  });

  it('closes incidents when case closes', () => {
    const feed = new WarRoomFeed();
    feed.ingest(
      event({
        id: 'inc1',
        kind: 'sanctions_match',
        severity: 'high',
        caseId: 'CASE-1',
      }),
    );
    expect(feed.snapshot().activeIncidents).toHaveLength(1);
    feed.ingest(event({ kind: 'case_closed', severity: 'info', caseId: 'CASE-1' }));
    expect(feed.snapshot().activeIncidents).toHaveLength(0);
  });

  it('clear wipes state', () => {
    const feed = new WarRoomFeed();
    feed.ingest(event({ kind: 'sanctions_match', severity: 'critical' }));
    feed.clear();
    const snap = feed.snapshot();
    expect(snap.totalEventsIngested).toBe(0);
    expect(snap.activeIncidents).toHaveLength(0);
  });
});
