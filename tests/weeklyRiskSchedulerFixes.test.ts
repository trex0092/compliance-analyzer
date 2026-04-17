/**
 * Targeted regression tests for the round-3 fixes to
 * weekly-risk-analysis-scheduler.js. Same bug classes as the earlier
 * report modules:
 *
 *   1. HTML injection / stored XSS in generateWeeklyHTML — any
 *      operator-controlled value (team member name, recommendation
 *      action, recommendation owner) could carry markup into the
 *      emailed report body.
 *   2. Non-Date `rec.dueDate` crashed the whole render because the
 *      old template called `.toISOString()` directly.
 *   3. `getNextMonday` did not handle "today is Monday but it is
 *      already past 08:00 UTC" — it returned today, so the caller
 *      scheduled a negative delay and fired the report immediately
 *      instead of a week later.
 *   4. Fixed 7-day `setInterval` drifts across DST transitions and
 *      leaks an unhandled rejection when the async work fails.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const WeeklyRiskAnalysisScheduler = require('../weekly-risk-analysis-scheduler.js');

function silentDeps() {
  const span = { finish: () => {}, setTag: () => {} };
  return {
    logger: {
      info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
    },
    tracer: { startSpan: () => span },
    metrics: { increment: () => {}, histogram: () => {}, gauge: () => {} },
  };
}

describe('WeeklyRiskAnalysisScheduler.generateWeeklyHTML', () => {
  const sched = new WeeklyRiskAnalysisScheduler(silentDeps());

  const sample = (overrides: Record<string, unknown> = {}) => ({
    projectId: 'p1',
    config: {},
    weeklyData: {
      week: 16, startDate: '2026-04-13', endDate: '2026-04-19',
      tasksCompleted: 18, tasksCreated: 12, tasksOverdue: 4,
      averageCompletionTime: 2.3,
    },
    trends: { complianceRateTrend: '+5.3%', healthScoreTrend: '+4', riskScoreTrend: '-2.8%' },
    riskHeatmap: {},
    teamAnalysis: [],
    recommendations: [],
    ...overrides,
  });

  it('escapes team-member names', async () => {
    const html = await sched.generateWeeklyHTML('rep-1', sample({
      teamAnalysis: [
        { name: '<img src=x onerror=alert(1)>', tasksCompleted: 1, completionRate: 100, avgTime: 1 },
      ],
    }));
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes recommendation action text', async () => {
    const html = await sched.generateWeeklyHTML('rep-1', sample({
      recommendations: [
        {
          priority: 'HIGH',
          action: '<script>alert(1)</script>',
          owner: 'Lead',
          dueDate: new Date('2026-04-20'),
        },
      ],
    }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('tolerates a non-Date recommendation dueDate without throwing', async () => {
    const html = await sched.generateWeeklyHTML('rep-1', sample({
      recommendations: [
        { priority: 'MEDIUM', action: 'x', owner: 'y', dueDate: 'not-a-date' },
        { priority: 'LOW', action: 'x', owner: 'y', dueDate: null },
        { priority: 'HIGH', action: 'x', owner: 'y', dueDate: undefined },
      ],
    }));
    // Render must succeed and produce a "Due: " line for each item.
    const dueMatches = html.match(/Due:\s*</g) || [];
    expect(dueMatches.length).toBe(3);
  });

  it('escapes weekly start/end date strings', async () => {
    const html = await sched.generateWeeklyHTML('rep-1', sample({
      weeklyData: {
        week: 1,
        startDate: '"><script>alert(1)</script>',
        endDate: '2026-04-19',
        tasksCompleted: 0, tasksCreated: 0, tasksOverdue: 0, averageCompletionTime: 0,
      },
    }));
    expect(html).not.toContain('"><script>alert(1)</script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('WeeklyRiskAnalysisScheduler.getNextMondayAt8Utc', () => {
  const sched = new WeeklyRiskAnalysisScheduler(silentDeps());

  it('returns 8:00 UTC on a Monday when called before 8:00 on that Monday', () => {
    const mondayMorning = new Date(Date.UTC(2026, 3, 13, 5, 0, 0)); // 2026-04-13 is a Monday
    const next = sched.getNextMondayAt8Utc(mondayMorning);
    expect(next.getUTCDay()).toBe(1);
    expect(next.toISOString()).toBe('2026-04-13T08:00:00.000Z');
  });

  it('skips forward to the FOLLOWING Monday when called on a Monday past 8:00 UTC', () => {
    // 2026-04-13 is a Monday. 09:00 UTC is past 08:00 UTC on that
    // Monday — the old getNextMonday returned today and produced a
    // negative delay, so the report fired immediately instead of a
    // week later.
    const mondayLate = new Date(Date.UTC(2026, 3, 13, 9, 0, 0));
    const next = sched.getNextMondayAt8Utc(mondayLate);
    expect(next.getUTCDay()).toBe(1);
    expect(next.toISOString()).toBe('2026-04-20T08:00:00.000Z');
  });

  it('returns the NEXT Monday when called on a Sunday', () => {
    // 2026-04-12 is a Sunday.
    const sunday = new Date(Date.UTC(2026, 3, 12, 23, 0, 0));
    const next = sched.getNextMondayAt8Utc(sunday);
    expect(next.getUTCDay()).toBe(1);
    expect(next.toISOString()).toBe('2026-04-13T08:00:00.000Z');
  });

  it('returns the next Monday when called mid-week', () => {
    // 2026-04-15 is a Wednesday.
    const wednesday = new Date(Date.UTC(2026, 3, 15, 12, 0, 0));
    const next = sched.getNextMondayAt8Utc(wednesday);
    expect(next.getUTCDay()).toBe(1);
    expect(next.toISOString()).toBe('2026-04-20T08:00:00.000Z');
  });
});

describe('WeeklyRiskAnalysisScheduler.startScheduler', () => {
  it('uses a setTimeout delay that lands on the next Monday 08:00 UTC', () => {
    const sched = new WeeklyRiskAnalysisScheduler(silentDeps());
    let capturedDelay: number | null = null;
    const original = globalThis.setTimeout;
    (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((_fn: () => void, delay: number) => {
      capturedDelay = delay;
      return { unref() {} } as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    try {
      void sched.startScheduler();
    } finally {
      (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = original;
    }
    expect(capturedDelay).not.toBeNull();
    // It must be strictly positive (we are always scheduling strictly
    // ahead of `now`), and it must land on the next Monday 08:00 UTC
    // as computed independently.
    expect(capturedDelay as number).toBeGreaterThan(0);
    const expected = sched.getNextMondayAt8Utc(new Date()).getTime() - Date.now();
    expect(Math.abs((capturedDelay as number) - expected)).toBeLessThan(2000);
  });
});
