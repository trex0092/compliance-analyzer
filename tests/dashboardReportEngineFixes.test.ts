/**
 * Targeted regression tests for the round-2 fixes to the newer report
 * modules (compliance-dashboard-report-engine.js and
 * asana-brain-master-system.js).
 *
 * Focus:
 *   1. HTML injection in generateHTMLReport — Asana-controlled
 *      strings (organization, recommendation text, team member name,
 *      regulatory framework/status, priority-derived CSS classes)
 *      must be escaped before landing in the emailed HTML body.
 *   2. Completion-rate is clamped and coerced before it is used in an
 *      inline `style="width:…"` attribute, so a caller cannot break
 *      out of the style context.
 *   3. AsanaBrainMasterSystem's uptime-reading methods do not crash
 *      when startTime is null (pre-init / post-shutdown).
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const ComplianceDashboardReportEngine = require('../compliance-dashboard-report-engine.js');
const AsanaBrainMasterSystem = require('../asana-brain-master-system.js');

function silentDeps() {
  const span = { finish: () => {}, setTag: () => {} };
  return {
    logger: {
      info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
    },
    tracer: { startSpan: () => span },
    metrics: {
      increment: () => {}, histogram: () => {}, gauge: () => {},
    },
  };
}

describe('ComplianceDashboardReportEngine.generateHTMLReport', () => {
  const engine = new ComplianceDashboardReportEngine(silentDeps());

  const sampleData = (overrides: Record<string, unknown> = {}) => ({
    projectId: 'p1',
    config: { organization: 'Acme Corp' },
    metrics: { complianceRate: 90, healthScore: 80, riskScore: 10, velocity: 5 },
    riskMatrix: {
      critical: { count: 0, percentage: 0 },
      high: { count: 0, percentage: 0 },
      medium: { count: 0, percentage: 0 },
      low: { count: 0, percentage: 0 },
    },
    recommendations: [],
    teamPerformance: [],
    regulatoryStatus: {},
    ...overrides,
  });

  it('escapes the organization name', async () => {
    const html = await engine.generateHTMLReport('rep-1', sampleData({
      config: { organization: '<img src=x onerror=alert(1)>' },
    }));
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes recommendation action text and sanitises the CSS class', async () => {
    const html = await engine.generateHTMLReport('rep-1', sampleData({
      recommendations: [
        {
          priority: 'HIGH"onload=alert(1)',
          action: '<script>alert(1)</script>',
          owner: 'A',
          dueDate: new Date('2026-01-01'),
        },
      ],
    }));
    // Raw script tag must NOT land in the HTML; escaped form must.
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // The priority-derived class only has [a-z] so it cannot break
    // out of the class attribute. We match the actual rendered
    // class pattern `rec-<letters>` with a closing quote right
    // after.
    expect(html).toMatch(/class="rec-priority rec-[a-z]+"/);
    // An unescaped double-quote from the priority must not reach the
    // class attribute (that would be the real breakout vector).
    expect(html).not.toMatch(/class="rec-priority rec-[^"]*"[^>]*onload/);
  });

  it('clamps team-member completionRate used in inline style attribute', async () => {
    const html = await engine.generateHTMLReport('rep-1', sampleData({
      teamPerformance: [
        { name: 'Alice', completionRate: '100%;background:red', tasksCompleted: 3 },
        { name: 'Bob', completionRate: 250, tasksCompleted: 9 },
        { name: 'Carol', completionRate: -50, tasksCompleted: 1 },
      ],
    }));
    // The real attack surface is the style attribute — asserting no
    // style="…" contains `background:` is the correct check (the
    // substring "background:red" as text content inside the div is
    // harmless and merely the echoed user input).
    expect(html).not.toMatch(/style="[^"]*background:/);
    // Alice: NaN-like → 0, Carol: -50 → clamped to 0, Bob: 250 → 100.
    expect(html).toContain('style="width: 0%"');
    expect(html).toContain('style="width: 100%"');
    const widthZeroCount = (html.match(/style="width: 0%"/g) || []).length;
    expect(widthZeroCount).toBeGreaterThanOrEqual(2);
  });

  it('escapes regulatory framework name and status', async () => {
    const html = await engine.generateHTMLReport('rep-1', sampleData({
      regulatoryStatus: {
        '<b>sox</b>': { status: 'COMPLIANT"onclick=alert(1)', violations: 0 },
      },
    }));
    // Raw <b> tag must not appear; escaped form must.
    expect(html).not.toContain('<b>sox</b>');
    expect(html).toContain('&lt;B&gt;SOX&lt;/B&gt;');
    // The status-derived CSS class must stay within [a-z-] so it
    // cannot break out of the class attribute.
    expect(html).toMatch(/class="status-item status-[a-z-]*"/);
    // And no element should actually carry an unescaped `onclick`
    // attribute — which would be the real XSS breakout.
    expect(html).not.toMatch(/<[a-z]+[^>]*\sonclick\s*=/i);
  });

  it('tolerates a non-Date recommendation dueDate without throwing', async () => {
    const html = await engine.generateHTMLReport('rep-1', sampleData({
      recommendations: [
        { priority: 'LOW', action: 'x', owner: 'y', dueDate: 'not-a-date' },
      ],
    }));
    expect(html).toContain('Due:'); // rendered, just with an empty day
  });
});

describe('ComplianceDashboardReportEngine.startScheduler', () => {
  it('computes the next fire time at 08:00 UTC without drift', () => {
    const engine = new ComplianceDashboardReportEngine(silentDeps());
    // Patch global setTimeout so we can capture the delay instead of
    // actually scheduling.
    let capturedDelay: number | null = null;
    const originalSetTimeout = globalThis.setTimeout;
    (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((_fn: () => void, delay: number) => {
      capturedDelay = delay;
      return { unref() {} } as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    try {
      engine.startScheduler();
    } finally {
      (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = originalSetTimeout;
    }
    expect(capturedDelay).not.toBeNull();
    // The captured delay must land exactly on the next 08:00 UTC mark
    // (give or take a tiny measurement window).
    const now = new Date();
    const next = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      8, 0, 0, 0,
    ));
    if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
    const expected = next.getTime() - now.getTime();
    // Allow a few hundred ms of slack for the test runner.
    expect(Math.abs((capturedDelay as number) - expected)).toBeLessThan(2000);
  });
});

describe('AsanaBrainMasterSystem uptime guards', () => {
  it('performHealthCheck tolerates a null startTime', () => {
    const sys = new AsanaBrainMasterSystem(silentDeps());
    // startTime is null until initialize() completes. The old code
    // called this.startTime.getTime() and crashed the whole monitor.
    expect(() => sys.performHealthCheck()).not.toThrow();
  });

  it('reportMetrics tolerates a null startTime', () => {
    const sys = new AsanaBrainMasterSystem(silentDeps());
    expect(() => sys.reportMetrics()).not.toThrow();
  });

  it('getSystemStatus tolerates a null startTime and reports uptime 0', () => {
    const sys = new AsanaBrainMasterSystem(silentDeps());
    const status = sys.getSystemStatus();
    expect(status.uptime).toBe(0);
    expect(status.status).toBe('stopped');
  });
});
