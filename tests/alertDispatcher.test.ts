/**
 * Alert Dispatcher tests.
 */
import { describe, it, expect } from 'vitest';

import {
  evaluateAlerts,
  dedupeAlerts,
  dispatchAlerts,
  DEFAULT_RULES,
  RecordingAdapter,
  __test__,
  type AlertSignals,
} from '../src/services/alertDispatcher';

const { hourBucket, ruleAlertId } = __test__;

const evaluatedAtIso = '2026-04-15T12:30:00Z';

function makeSignals(overrides: Partial<AlertSignals> = {}): AlertSignals {
  return { evaluatedAtIso, ...overrides };
}

describe('evaluateAlerts — drift rules', () => {
  it('fires drift.critical on critical drift', () => {
    const alerts = evaluateAlerts(
      makeSignals({
        drift: {
          status: 'drift_detected',
          severity: 'critical',
          ksStatistic: 0.5,
          tenantId: 'tenant-a',
        },
      })
    );
    const critical = alerts.find((a) => a.ruleId === 'drift.critical');
    expect(critical).toBeDefined();
    expect(critical!.severity).toBe('page');
    expect(critical!.channels).toContain('pager');
  });

  it('fires drift.high on high drift', () => {
    const alerts = evaluateAlerts(
      makeSignals({
        drift: {
          status: 'drift_detected',
          severity: 'high',
          ksStatistic: 0.32,
          tenantId: 'tenant-a',
        },
      })
    );
    expect(alerts.some((a) => a.ruleId === 'drift.high')).toBe(true);
  });

  it('does not fire drift rules on stable / low', () => {
    const alerts = evaluateAlerts(
      makeSignals({
        drift: {
          status: 'stable',
          severity: 'low',
          ksStatistic: 0.1,
          tenantId: 'tenant-a',
        },
      })
    );
    expect(alerts.filter((a) => a.ruleId.startsWith('drift.'))).toEqual([]);
  });
});

describe('evaluateAlerts — SLA rules', () => {
  it('fires sla.already_breached on any breach', () => {
    const alerts = evaluateAlerts(
      makeSignals({
        slaBreach: { tenantId: 'tenant-a', willBreachCount: 0, alreadyBreachedCount: 2 },
      })
    );
    const alert = alerts.find((a) => a.ruleId === 'sla.already_breached');
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe('page');
    expect(alert!.regulatory).toMatch(/Cabinet Res 74\/2020/);
  });

  it('fires sla.will_breach on upcoming breach', () => {
    const alerts = evaluateAlerts(
      makeSignals({
        slaBreach: { tenantId: 'tenant-a', willBreachCount: 3, alreadyBreachedCount: 0 },
      })
    );
    expect(alerts.some((a) => a.ruleId === 'sla.will_breach')).toBe(true);
  });

  it('does not fire when counts are zero', () => {
    const alerts = evaluateAlerts(
      makeSignals({
        slaBreach: { tenantId: 'tenant-a', willBreachCount: 0, alreadyBreachedCount: 0 },
      })
    );
    expect(alerts.filter((a) => a.ruleId.startsWith('sla.'))).toEqual([]);
  });
});

describe('evaluateAlerts — dead letter / cron / config / fuzz', () => {
  it('fires deadLetter.depth when > 10', () => {
    const alerts = evaluateAlerts(
      makeSignals({ deadLetter: { tenantId: 'tenant-a', depth: 12 } })
    );
    expect(alerts.some((a) => a.ruleId === 'deadLetter.depth')).toBe(true);
  });

  it('escalates deadLetter to critical when depth > 50', () => {
    const alerts = evaluateAlerts(
      makeSignals({ deadLetter: { tenantId: 'tenant-a', depth: 55 } })
    );
    const a = alerts.find((x) => x.ruleId === 'deadLetter.depth')!;
    expect(a.severity).toBe('critical');
  });

  it('fires cron.repeated_failure on ≥3 consecutive failures', () => {
    const alerts = evaluateAlerts(
      makeSignals({
        crons: [
          { id: 'cron-a', lastResult: 'error', consecutiveFailures: 3 },
          { id: 'cron-b', lastResult: 'ok', consecutiveFailures: 0 },
        ],
      })
    );
    expect(alerts.some((a) => a.ruleId === 'cron.repeated_failure')).toBe(true);
  });

  it('fires config.broken when env is broken', () => {
    const alerts = evaluateAlerts(
      makeSignals({ config: { health: 'broken', missingRequired: ['HAWKEYE_BRAIN_TOKEN'] } })
    );
    const alert = alerts.find((a) => a.ruleId === 'config.broken');
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe('page');
    expect(alert!.channels).toContain('pager');
  });

  it('does not fire config.broken when health is degraded or ok', () => {
    expect(
      evaluateAlerts(makeSignals({ config: { health: 'degraded', missingRequired: [] } }))
        .filter((a) => a.ruleId === 'config.broken')
    ).toEqual([]);
    expect(
      evaluateAlerts(makeSignals({ config: { health: 'ok', missingRequired: [] } }))
        .filter((a) => a.ruleId === 'config.broken')
    ).toEqual([]);
  });

  it('fires fuzz.robustness_low when score < 70', () => {
    const alerts = evaluateAlerts(
      makeSignals({ fuzz: { robustnessScore: 58, criticalFindings: 3 } })
    );
    expect(alerts.some((a) => a.ruleId === 'fuzz.robustness_low')).toBe(true);
  });
});

describe('dedupeAlerts', () => {
  it('drops duplicates by id', () => {
    const a1 = evaluateAlerts(
      makeSignals({
        drift: {
          status: 'drift_detected',
          severity: 'high',
          ksStatistic: 0.32,
          tenantId: 'tenant-a',
        },
      })
    );
    const a2 = evaluateAlerts(
      makeSignals({
        drift: {
          status: 'drift_detected',
          severity: 'high',
          ksStatistic: 0.32,
          tenantId: 'tenant-a',
        },
      })
    );
    const merged = dedupeAlerts([...a1, ...a2]);
    expect(merged.length).toBe(a1.length);
  });
});

describe('dispatchAlerts', () => {
  it('routes alerts through the injected adapter', async () => {
    const adapter = new RecordingAdapter();
    const report = await dispatchAlerts(
      makeSignals({
        drift: {
          status: 'drift_detected',
          severity: 'critical',
          ksStatistic: 0.5,
          tenantId: 'tenant-a',
        },
        slaBreach: { tenantId: 'tenant-a', willBreachCount: 0, alreadyBreachedCount: 1 },
      }),
      adapter
    );
    expect(report.alerts.length).toBeGreaterThan(0);
    expect(adapter.recorded().length).toBe(report.alerts.length);
    expect(report.summary).toMatch(/alert/);
  });

  it('returns clean summary when no rules fire', async () => {
    const adapter = new RecordingAdapter();
    const report = await dispatchAlerts(makeSignals(), adapter);
    expect(report.alerts.length).toBe(0);
    expect(report.summary).toMatch(/clean/);
  });

  it('swallows adapter failures without throwing', async () => {
    const adapter = {
      async dispatch() {
        throw new Error('smtp down');
      },
    };
    const report = await dispatchAlerts(
      makeSignals({
        drift: {
          status: 'drift_detected',
          severity: 'critical',
          ksStatistic: 0.5,
          tenantId: 'tenant-a',
        },
      }),
      adapter
    );
    expect(report.alerts.length).toBe(1);
  });
});

describe('helpers', () => {
  it('hourBucket truncates to the hour', () => {
    expect(hourBucket('2026-04-15T12:30:00Z')).toBe('2026-04-15T12');
  });

  it('ruleAlertId composes rule + subject + hour', () => {
    const id = ruleAlertId('drift.critical', 'tenant-a', '2026-04-15T12:30:00Z');
    expect(id).toBe('drift.critical:tenant-a:2026-04-15T12');
  });
});

describe('DEFAULT_RULES', () => {
  it('contains every category', () => {
    const ids = DEFAULT_RULES.map((r) => r.id);
    expect(ids).toContain('drift.critical');
    expect(ids).toContain('drift.high');
    expect(ids).toContain('deadLetter.depth');
    expect(ids).toContain('sla.already_breached');
    expect(ids).toContain('sla.will_breach');
    expect(ids).toContain('cron.repeated_failure');
    expect(ids).toContain('config.broken');
    expect(ids).toContain('fuzz.robustness_low');
  });
});
