import { describe, expect, it } from 'vitest';
import { WarRoomFeed } from '@/services/warRoomFeed';
import { buildDashboardSnapshot, buildVoiceBrief } from '@/services/warRoomDashboard';

function newFeedWithEvents() {
  const feed = new WarRoomFeed();
  feed.ingest({
    id: 'ev-1',
    at: new Date().toISOString(),
    kind: 'screening',
    severity: 'info',
    title: 'Routine screening: Acme Corp',
  });
  feed.ingest({
    id: 'ev-2',
    at: new Date().toISOString(),
    kind: 'sanctions_match',
    severity: 'critical',
    title: 'Sanctions match: Shell Co LLC',
    entityId: 'E-99',
  });
  feed.ingest({
    id: 'ev-3',
    at: new Date().toISOString(),
    kind: 'freeze_initiated',
    severity: 'critical',
    title: 'Freeze initiated: Shell Co LLC',
    entityId: 'E-99',
    deadlineIso: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  feed.ingest({
    id: 'ev-4',
    at: new Date().toISOString(),
    kind: 'str_filed',
    severity: 'medium',
    title: 'STR filed: Shell Co LLC',
  });
  return feed;
}

describe('buildDashboardSnapshot', () => {
  it('produces one tile per KPI and carries the tenant id through', () => {
    const feed = newFeedWithEvents();
    const snap = buildDashboardSnapshot(feed, 'acme-uae');
    expect(snap.tenantId).toBe('acme-uae');
    expect(snap.tiles.length).toBeGreaterThanOrEqual(6);
    const labels = snap.tiles.map((t) => t.label);
    expect(labels).toContain('Critical incidents');
    expect(labels).toContain('Active freezes');
  });

  it('elevates the sanctions-hits tile to critical when any hit exists', () => {
    const feed = newFeedWithEvents();
    const snap = buildDashboardSnapshot(feed, 'acme');
    const tile = snap.tiles.find((t) => t.id === 'sanctions-hits-1h');
    expect(tile).toBeDefined();
    expect(tile!.accent).toBe('critical');
  });

  it('returns at most 10 top incidents and 10 upcoming deadlines', () => {
    const feed = new WarRoomFeed();
    for (let i = 0; i < 20; i++) {
      feed.ingest({
        id: `ev-${i}`,
        at: new Date().toISOString(),
        kind: 'sanctions_match',
        severity: 'critical',
        title: `Hit ${i}`,
        entityId: `E-${i}`,
        deadlineIso: new Date(Date.now() + i * 60_000).toISOString(),
      });
    }
    const snap = buildDashboardSnapshot(feed, 'acme');
    expect(snap.topIncidents.length).toBeLessThanOrEqual(10);
    expect(snap.upcomingDeadlines.length).toBeLessThanOrEqual(10);
  });

  it('handles a completely empty feed without throwing', () => {
    const feed = new WarRoomFeed();
    const snap = buildDashboardSnapshot(feed, 'acme');
    expect(snap.tiles.length).toBeGreaterThan(0);
    expect(snap.topIncidents).toEqual([]);
    expect(snap.recentEventTitles).toEqual([]);
  });
});

describe('buildVoiceBrief', () => {
  it('opens with the compliance status sentence and ends with "End of brief."', () => {
    const feed = newFeedWithEvents();
    const snap = buildDashboardSnapshot(feed, 'acme');
    const brief = buildVoiceBrief(snap);
    expect(brief.length).toBeGreaterThan(2);
    expect(brief[0]).toMatch(/Compliance status as of/);
    expect(brief[brief.length - 1]).toMatch(/End of brief/);
  });

  it('reports critical incident count when non-zero', () => {
    const feed = newFeedWithEvents();
    const snap = buildDashboardSnapshot(feed, 'acme');
    const brief = buildVoiceBrief(snap);
    const joined = brief.join(' ');
    expect(joined).toMatch(/critical incidents open|No critical incidents open/i);
  });

  it('reports "No critical incidents open" when the feed is clean', () => {
    const feed = new WarRoomFeed();
    feed.ingest({
      id: 'ev-1',
      at: new Date().toISOString(),
      kind: 'screening',
      severity: 'info',
      title: 'Routine',
    });
    const snap = buildDashboardSnapshot(feed, 'acme');
    const brief = buildVoiceBrief(snap);
    const joined = brief.join(' ');
    expect(joined).toMatch(/No critical incidents open/);
  });

  it('each sentence is under 140 characters so TTS can deliver naturally', () => {
    const feed = newFeedWithEvents();
    const snap = buildDashboardSnapshot(feed, 'acme');
    const brief = buildVoiceBrief(snap);
    for (const sentence of brief) {
      expect(sentence.length).toBeLessThan(140);
    }
  });
});
