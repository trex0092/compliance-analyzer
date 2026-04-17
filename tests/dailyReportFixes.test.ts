/**
 * Targeted regression tests for bug fixes in the new daily compliance
 * report modules (automated-daily-report-generator.js,
 * asana-brain-daily-report-executor.js, daily-compliance-report-system.js).
 *
 * The original production code shipped with three systemic bugs:
 *   1. NaN percentages when a project had zero tasks
 *      (division-by-zero in risk-matrix percentage calculations).
 *   2. Risk-matrix "low" bucket silently included completed and
 *      not-yet-due tasks, so the four buckets did not sum to the
 *      overdue total reported elsewhere.
 *   3. HTML reports concatenated Asana-controlled strings (project
 *      name, task title, assignee) directly into the template with
 *      no escaping — an HTML-injection vector when the report was
 *      emailed or served.
 *
 * These tests lock in the fixed behaviour without asserting on
 * internal implementation details beyond the public surface used by
 * callers.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import Module from 'module';

const require = createRequire(import.meta.url);

// The report modules pull in node-cron / nodemailer / axios at
// `require` time. Those packages are production deps that are not
// installed in the test environment, so we short-circuit the Node
// module resolver with safe stubs before requiring the modules under
// test. This keeps the suite hermetic and lets the tests focus on
// the pure computation surface (metrics, risk matrix, HTML escaping).
const nodemailerStub = {
  createTransport: () => ({
    verify: async () => true,
    sendMail: async () => ({ accepted: [] }),
  }),
};
const cronStub = { schedule: () => ({ stop: () => {} }) };
const axiosStub = { post: async () => ({ data: {} }) };

const stubs: Record<string, unknown> = {
  'node-cron': cronStub,
  nodemailer: nodemailerStub,
  axios: axiosStub,
};

const originalResolve = (Module as unknown as { _resolveFilename: (...args: unknown[]) => string })._resolveFilename;
(Module as unknown as { _resolveFilename: (...args: unknown[]) => string })._resolveFilename = function patched(request: string, ...rest: unknown[]): string {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return request;
  return originalResolve.call(this, request, ...rest);
};
const originalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })._load;
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load = function patched(request: string, ...rest: unknown[]): unknown {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return originalLoad.call(this, request, ...rest);
};

const AutomatedDailyReportGenerator = require('../automated-daily-report-generator.js');
const AsanaBrainDailyReportExecutor = require('../asana-brain-daily-report-executor.js');
const DailyComplianceReportSystem = require('../daily-compliance-report-system.js');

function silentDeps() {
  const span = { finish: () => {}, setTag: () => {} };
  return {
    logger: {
      info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
    },
    tracer: { startSpan: () => span },
    metrics: { increment: () => {}, histogram: () => {} },
    asanaClient: {
      getProject: async () => ({ id: 'p1', name: 'Proj' }),
      getProjectTasks: async () => [],
      getTasks: async () => [],
      createTask: async () => ({ id: 't1' }),
    },
    dashboardService: {
      generateComplianceMetrics: async () => ({
        totalTasks: 0, completedTasks: 0, inProgressTasks: 0,
        overdueTasks: 0, atRiskTasks: 0, criticalTasks: 0,
        complianceRate: 0, riskScore: 0, healthScore: 100,
        velocity: 0, forecast: 0,
      }),
      updateWidget: async () => ({}),
    },
  };
}

describe('AutomatedDailyReportGenerator.calculateMetrics', () => {
  const gen = new AutomatedDailyReportGenerator(silentDeps());

  it('returns zero metrics and no NaN when there are no tasks', () => {
    const m = gen.calculateMetrics([]);
    expect(m.totalTasks).toBe(0);
    expect(m.complianceRate).toBe(0);
    expect(m.riskScore).toBe(0);
    expect(Number.isNaN(m.healthScore)).toBe(false);
  });

  it('does not push non-overdue open tasks into the low bucket', () => {
    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const tasks = [
      { completed: false, due_on: future }, // future due date
      { completed: false }, // no due date
      { completed: true }, // completed
    ];
    const m = gen.calculateMetrics(tasks);
    expect(m.overdueTasks).toBe(0);
    expect(m.lowTasks).toBe(0);
    expect(m.criticalTasks).toBe(0);
    expect(m.highTasks).toBe(0);
    expect(m.mediumTasks).toBe(0);
    // Four buckets must sum to overdueTasks exactly.
    expect(m.criticalTasks + m.highTasks + m.mediumTasks + m.lowTasks)
      .toBe(m.overdueTasks);
  });

  it('buckets overdue tasks correctly by days-overdue', () => {
    const now = Date.now();
    const daysAgo = (n: number) => new Date(now - n * 24 * 3600 * 1000).toISOString();
    const tasks = [
      { completed: false, due_on: daysAgo(40) }, // critical
      { completed: false, due_on: daysAgo(20) }, // high
      { completed: false, due_on: daysAgo(10) }, // medium
      { completed: false, due_on: daysAgo(3) },  // low
      { completed: true, due_on: daysAgo(50) },  // ignored
    ];
    const m = gen.calculateMetrics(tasks);
    expect(m.overdueTasks).toBe(4);
    expect(m.criticalTasks).toBe(1);
    expect(m.highTasks).toBe(1);
    expect(m.mediumTasks).toBe(1);
    expect(m.lowTasks).toBe(1);
  });
});

describe('AutomatedDailyReportGenerator.generateHTMLReport', () => {
  const gen = new AutomatedDailyReportGenerator(silentDeps());
  // Minimal template to exercise the placeholder replacement path.
  gen.templates = {
    base: [
      'Project: [PROJECT_NAME]',
      'Critical%: [CRITICAL_PERCENT]',
      'High%: [HIGH_PERCENT]',
      'Medium%: [MEDIUM_PERCENT]',
      'Low%: [LOW_PERCENT]',
    ].join('\n'),
    financial: '',
    dataProtection: '',
  };

  it('never emits NaN percentages when totalTasks is zero', () => {
    const html = gen.generateHTMLReport(
      { name: 'Empty Project' },
      [],
      gen.calculateMetrics([]),
      {},
    );
    expect(html).not.toContain('NaN');
    expect(html).toContain('Critical%: 0.0');
    expect(html).toContain('Low%: 0.0');
  });

  it('escapes HTML in project name to prevent injection', () => {
    const html = gen.generateHTMLReport(
      { name: '<script>alert(1)</script>' },
      [],
      gen.calculateMetrics([]),
      {},
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('AsanaBrainDailyReportExecutor risk matrix', () => {
  it('computes percentages without NaN on an empty project', async () => {
    const exec = new AsanaBrainDailyReportExecutor(silentDeps());
    const report = await exec.generateComplianceReport(
      { id: 'p', name: 'P' },
      [],
      {
        totalTasks: 0, completedTasks: 0, inProgressTasks: 0,
        overdueTasks: 0, atRiskTasks: 0, criticalTasks: 0,
        complianceRate: 0, riskScore: 0, healthScore: 100, velocity: 0,
      },
    );
    for (const k of ['critical', 'high', 'medium', 'low'] as const) {
      expect(report.riskMatrix[k].percentage).toBe('0.0');
    }
  });

  it('low bucket excludes completed and not-yet-due tasks', async () => {
    const exec = new AsanaBrainDailyReportExecutor(silentDeps());
    const now = Date.now();
    const daysAgo = (n: number) =>
      new Date(now - n * 24 * 3600 * 1000).toISOString();
    const future = new Date(now + 10 * 24 * 3600 * 1000).toISOString();
    const tasks = [
      { id: 1, due_date: daysAgo(3), status: 'open', title: 't1' },    // low
      { id: 2, due_date: daysAgo(40), status: 'open', title: 't2' },   // critical
      { id: 3, due_date: future, status: 'open', title: 't3' },         // not due
      { id: 4, due_date: daysAgo(100), status: 'completed', title: 't4' }, // completed
    ];
    const report = await exec.generateComplianceReport(
      { id: 'p', name: 'P' },
      tasks,
      {
        totalTasks: tasks.length, completedTasks: 1, inProgressTasks: 0,
        overdueTasks: 2, atRiskTasks: 0, criticalTasks: 1,
        complianceRate: 25, riskScore: 50, healthScore: 50, velocity: 0,
      },
    );
    expect(report.riskMatrix.critical.count).toBe(1);
    expect(report.riskMatrix.low.count).toBe(1);
    // Must not count the completed or the not-yet-due task
    expect(report.riskMatrix.low.count + report.riskMatrix.medium.count
      + report.riskMatrix.high.count + report.riskMatrix.critical.count)
      .toBe(2);
  });
});

describe('AsanaBrainDailyReportExecutor.generateHTMLReport', () => {
  const exec = new AsanaBrainDailyReportExecutor(silentDeps());

  it('HTML-escapes externally-sourced values', () => {
    const html = exec.generateHTMLReport({
      projectName: 'Proj',
      executiveSummary: {
        title: '<img src=x onerror=alert(1)>',
        date: '2026-01-01',
        overallStatus: 'GOOD',
      },
      metrics: { complianceRate: '90.0', healthScore: '95.0', riskScore: '5.0', completedTasks: 9, totalTasks: 10 },
      riskMatrix: {
        critical: { count: 0, percentage: '0.0' },
        high: { count: 0, percentage: '0.0' },
        medium: { count: 0, percentage: '0.0' },
        low: { count: 0, percentage: '0.0' },
      },
    });
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('DailyComplianceReportSystem risk matrix', () => {
  const sys = new DailyComplianceReportSystem(silentDeps());

  it('low bucket excludes completed and not-yet-due tasks', async () => {
    const now = Date.now();
    const daysAgo = (n: number) =>
      new Date(now - n * 24 * 3600 * 1000).toISOString();
    const future = new Date(now + 10 * 24 * 3600 * 1000).toISOString();
    const tasks = [
      { id: 1, due_date: daysAgo(2), status: 'open', title: 't1' },
      { id: 2, due_date: future, status: 'open', title: 't2' },
      { id: 3, due_date: daysAgo(100), status: 'completed', title: 't3' },
    ];
    const report = await sys.generateComplianceReport(
      { id: 'p', name: 'P' },
      tasks,
      {
        totalTasks: tasks.length, completedTasks: 1, inProgressTasks: 0,
        overdueTasks: 1, atRiskTasks: 0, criticalTasks: 0,
        complianceRate: 33, riskScore: 33, healthScore: 66, velocity: 0,
        forecast: 50,
      },
    );
    expect(report.riskMatrix.low.count).toBe(1);
    expect(report.riskMatrix.critical.count).toBe(0);
  });

  it('produces non-NaN percentages on empty projects', async () => {
    const report = await sys.generateComplianceReport(
      { id: 'p', name: 'P' },
      [],
      {
        totalTasks: 0, completedTasks: 0, inProgressTasks: 0,
        overdueTasks: 0, atRiskTasks: 0, criticalTasks: 0,
        complianceRate: 0, riskScore: 0, healthScore: 100, velocity: 0,
        forecast: 0,
      },
    );
    for (const k of ['critical', 'high', 'medium', 'low'] as const) {
      expect(report.riskMatrix[k].percentage).toBe('0.0');
    }
  });
});

describe('DailyComplianceReportSystem.generateHTMLReport', () => {
  const sys = new DailyComplianceReportSystem(silentDeps());

  it('HTML-escapes project name, status and nested values', () => {
    const html = sys.generateHTMLReport({
      projectName: '<b>X</b>',
      executiveSummary: {
        title: 'T',
        date: 'd',
        overallStatus: 'GOOD"onclick=alert(1)',
      },
      metrics: { complianceRate: '90.0', healthScore: '95.0', riskScore: '5.0', completedTasks: 9, totalTasks: 10 },
      riskMatrix: {
        critical: { count: 0, percentage: '0.0' },
        high: { count: 0, percentage: '0.0' },
        medium: { count: 0, percentage: '0.0' },
        low: { count: 0, percentage: '0.0' },
      },
      trend: { direction: 'STABLE', changePercentage: '0.0', previousRate: '0.0', currentRate: '0.0', forecast30Days: '0.0', analysis: 'ok' },
      recommendations: [{ priority: 'HIGH', category: '<script>x</script>', recommendation: 'r', action: 'a' }],
      topIssues: [{ issue: '<i>x</i>', priority: 'HIGH', daysOverdue: 1 }],
      nextSteps: [{ timeframe: 't', actions: ['<u>a</u>'] }],
    });
    // raw tags must NOT appear
    expect(html).not.toContain('<b>X</b>');
    expect(html).not.toContain('<script>x</script>');
    expect(html).not.toContain('<i>x</i>');
    expect(html).not.toContain('<u>a</u>');
    // escaped forms must appear
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
  });
});
