/**
 * UX Polish batch tests — keyboard shortcuts + notification center +
 * email digest builder + chart data transformer.
 */
import { describe, it, expect } from 'vitest';

import {
  DEFAULT_SHORTCUTS,
  detectConflicts,
  matchShortcut,
  emptyChordState,
  groupShortcuts,
} from '../src/services/keyboardShortcuts';

import {
  NotificationCenter,
  InMemoryNotificationStore,
  alertToNotification,
  type Notification,
} from '../src/services/notificationCenter';

import { buildDigest, type DigestInput } from '../src/services/emailDigestBuilder';

import {
  verdictDistributionChart,
  typologyBarChart,
  driftHeatMap,
  renderLineChartSvg,
} from '../src/services/chartDataTransformer';

// ===========================================================================
// keyboardShortcuts
// ===========================================================================

describe('keyboardShortcuts', () => {
  it('default registry has no conflicts', () => {
    expect(detectConflicts()).toEqual([]);
  });

  it('matches a single keystroke', () => {
    const r = matchShortcut({ key: '?' }, emptyChordState(), 1000);
    expect(r.action).toBe('help.open');
  });

  it('matches a chord sequence', () => {
    let s = emptyChordState();
    let r = matchShortcut({ key: 'g' }, s, 1000);
    expect(r.isPending).toBe(true);
    s = r.nextState;
    r = matchShortcut({ key: 's' }, s, 1100);
    expect(r.action).toBe('nav.screening');
  });

  it('expires a chord after CHORD_TIMEOUT_MS', () => {
    let s = emptyChordState();
    s = matchShortcut({ key: 'g' }, s, 1000).nextState;
    const r = matchShortcut({ key: 's' }, s, 10_000); // way past timeout
    expect(r.action).toBeNull();
  });

  it('matches a modifier combo', () => {
    const r = matchShortcut({ key: 'k', modifiers: { ctrl: true } }, emptyChordState(), 1000);
    expect(r.action).toBe('nav.commandPalette');
  });

  it('detectConflicts finds a deliberate collision', () => {
    const conflicts = detectConflicts([
      ...DEFAULT_SHORTCUTS,
      {
        action: 'dup',
        label: 'duplicate',
        sequence: [{ key: '?' }],
        category: 'help',
      },
    ]);
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('groupShortcuts produces every category', () => {
    const g = groupShortcuts();
    expect(g.navigation.length).toBeGreaterThan(0);
    expect(g.brain.length).toBeGreaterThan(0);
    expect(g['tier-c'].length).toBeGreaterThan(0);
    expect(g.help.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// notificationCenter
// ===========================================================================

describe('NotificationCenter', () => {
  function makeNotif(id: string, overrides: Partial<Notification> = {}): Notification {
    return {
      id,
      tsIso: '2026-04-15T10:00:00Z',
      category: 'alert',
      severity: 'warning',
      title: `Alert ${id}`,
      body: 'body',
      tenantId: 'tenant-a',
      ...overrides,
    };
  }

  it('add + list produces unread notifications', async () => {
    const nc = new NotificationCenter(new InMemoryNotificationStore());
    await nc.add(makeNotif('n1'));
    const list = await nc.list({ userId: 'user-1' });
    expect(list.length).toBe(1);
  });

  it('add is idempotent on id', async () => {
    const nc = new NotificationCenter(new InMemoryNotificationStore());
    await nc.add(makeNotif('n1'));
    await nc.add(makeNotif('n1'));
    const list = await nc.list();
    expect(list.length).toBe(1);
  });

  it('markRead removes from unread list', async () => {
    const nc = new NotificationCenter(new InMemoryNotificationStore());
    await nc.add(makeNotif('n1'));
    expect(await nc.unreadCount('user-1')).toBe(1);
    await nc.markRead('n1', 'user-1');
    expect(await nc.unreadCount('user-1')).toBe(0);
  });

  it('dismiss hides from both read and unread', async () => {
    const nc = new NotificationCenter(new InMemoryNotificationStore());
    await nc.add(makeNotif('n1'));
    await nc.dismiss('n1', 'user-1');
    const list = await nc.list({ userId: 'user-1' });
    expect(list.length).toBe(0);
  });

  it('markAllRead zeros the unread count', async () => {
    const nc = new NotificationCenter(new InMemoryNotificationStore());
    await nc.add(makeNotif('n1'));
    await nc.add(makeNotif('n2'));
    await nc.markAllRead('user-1');
    expect(await nc.unreadCount('user-1')).toBe(0);
  });

  it('filter by category / severity / tenant', async () => {
    const nc = new NotificationCenter(new InMemoryNotificationStore());
    await nc.add(makeNotif('n1', { category: 'alert', severity: 'warning' }));
    await nc.add(makeNotif('n2', { category: 'tier-c', severity: 'critical' }));
    await nc.add(makeNotif('n3', { tenantId: 'tenant-b' }));
    const alerts = await nc.list({ category: 'alert' });
    // n1 (default alert) + n3 (inherits default alert category) = 2
    expect(alerts.length).toBe(2);
    const critical = await nc.list({ severity: 'critical' });
    expect(critical.length).toBe(1);
    const tenantA = await nc.list({ tenantId: 'tenant-a' });
    expect(tenantA.length).toBe(2);
  });

  it('alertToNotification converts AlertEventLike', () => {
    const n = alertToNotification(
      {
        id: 'a1',
        severity: 'critical',
        title: 'drift',
        body: 'body',
        ruleId: 'drift.critical',
        regulatory: 'FDL Art.20',
        meta: {},
      },
      'tenant-a',
      '2026-04-15T10:00:00Z'
    );
    expect(n.category).toBe('alert');
    expect(n.severity).toBe('critical');
    expect(n.linkAction).toBe('alert.open');
  });
});

// ===========================================================================
// emailDigestBuilder
// ===========================================================================

describe('buildDigest', () => {
  function makeInput(overrides: Partial<DigestInput> = {}): DigestInput {
    return {
      tenantId: 'tenant-a',
      tenantLegalName: 'Acme Trading LLC',
      cadence: 'daily',
      windowStartIso: '2026-04-14T00:00:00Z',
      windowEndIso: '2026-04-15T00:00:00Z',
      totalDecisions: 240,
      verdictCounts: { pass: 200, flag: 30, escalate: 8, freeze: 2 },
      strDraftsCreated: 3,
      slaBreaches: 0,
      pendingClampSuggestions: 2,
      pendingBreakGlass: 0,
      topTypologies: [{ id: 'T-DPMS-01', label: 'High-cash gold', count: 12 }],
      avgPowerScore: 72.5,
      driftDetected: false,
      robustnessScore: 88,
      recipientName: 'Alice (MLRO)',
      ...overrides,
    };
  }

  it('produces subject + text + html', () => {
    const d = buildDigest(makeInput());
    expect(d.subject).toContain('HAWKEYE');
    expect(d.text).toContain('240');
    expect(d.html).toContain('Acme');
  });

  it('highlights SLA breaches when > 0', () => {
    const d = buildDigest(makeInput({ slaBreaches: 3 }));
    expect(d.text).toContain('SLA breaches:       3 ⚠');
  });

  it('shows drift warning when detected', () => {
    const d = buildDigest(makeInput({ driftDetected: true }));
    expect(d.text).toContain('YES ⚠');
  });

  it('never names a customer', () => {
    const d = buildDigest(makeInput());
    expect(d.text).not.toContain('customer-');
    expect(d.text).toContain('NEVER names individual customers');
  });

  it('weekly cadence label', () => {
    const d = buildDigest(makeInput({ cadence: 'weekly' }));
    expect(d.subject).toContain('Weekly');
  });
});

// ===========================================================================
// chartDataTransformer
// ===========================================================================

describe('chartDataTransformer', () => {
  it('verdictDistributionChart buckets by day', () => {
    const spec = verdictDistributionChart({
      entries: [
        { tsIso: '2026-04-14T10:00:00Z', verdict: 'pass' },
        { tsIso: '2026-04-14T14:00:00Z', verdict: 'pass' },
        { tsIso: '2026-04-15T10:00:00Z', verdict: 'flag' },
      ],
    });
    expect(spec.kind).toBe('line');
    expect(spec.series.length).toBe(4);
    const passSeries = spec.series.find((s) => s.label === 'pass')!;
    expect(passSeries.points.find((p) => p.x === '2026-04-14')?.y).toBe(2);
  });

  it('typologyBarChart sorts descending + caps at topN', () => {
    const spec = typologyBarChart({
      typologies: [
        { id: 'T-1', label: 'x', count: 5 },
        { id: 'T-2', label: 'y', count: 20 },
        { id: 'T-3', label: 'z', count: 10 },
      ],
      topN: 2,
    });
    expect(spec.bars.length).toBe(2);
    expect(spec.bars[0]!.value).toBe(20);
    expect(spec.bars[1]!.value).toBe(10);
  });

  it('driftHeatMap clamps intensity to [0, 1]', () => {
    const spec = driftHeatMap({
      records: [
        { day: '2026-04-15', constantKey: 'dpms_cash', severity: 2.5 },
        { day: '2026-04-15', constantKey: 'ubo_pct', severity: -0.5 },
      ],
    });
    expect(spec.cells[0]!.intensity).toBe(1);
    expect(spec.cells[1]!.intensity).toBe(0);
  });

  it('renderLineChartSvg produces a valid SVG string', () => {
    const spec = verdictDistributionChart({
      entries: [
        { tsIso: '2026-04-14T10:00:00Z', verdict: 'pass' },
        { tsIso: '2026-04-15T10:00:00Z', verdict: 'flag' },
      ],
    });
    const svg = renderLineChartSvg(spec);
    expect(svg).toContain('<svg');
    expect(svg).toContain('polyline');
    expect(svg).toContain('Verdict distribution over time');
  });
});
