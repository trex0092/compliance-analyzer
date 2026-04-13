import { describe, expect, it } from 'vitest';
import { computeMlroMetrics, type MlroEvent } from '@/services/mlroPerformanceMetrics';

function ev(overrides: Partial<MlroEvent>): MlroEvent {
  return {
    mlroIdHash: 'mlro-a',
    at: new Date().toISOString(),
    kind: 'decision',
    tenantId: 'acme',
    ...overrides,
  };
}

describe('computeMlroMetrics', () => {
  it('returns empty metrics for an empty event stream', () => {
    const r = computeMlroMetrics([]);
    expect(r.totalEvents).toBe(0);
    expect(r.perMlro).toEqual([]);
    expect(r.aggregate.totalDecisions).toBe(0);
  });

  it('groups by mlroIdHash and counts total decisions', () => {
    const events: MlroEvent[] = [
      ev({ mlroIdHash: 'a', verdict: 'pass', latencyMs: 1000 }),
      ev({ mlroIdHash: 'a', verdict: 'flag', latencyMs: 2000 }),
      ev({ mlroIdHash: 'b', verdict: 'freeze', latencyMs: 5000 }),
    ];
    const r = computeMlroMetrics(events);
    expect(r.perMlro.length).toBe(2);
    const a = r.perMlro.find((m) => m.mlroIdHash === 'a')!;
    const b = r.perMlro.find((m) => m.mlroIdHash === 'b')!;
    expect(a.totalDecisions).toBe(2);
    expect(b.totalDecisions).toBe(1);
    expect(b.verdictDistribution.freeze).toBe(1);
  });

  it('computes median latency correctly', () => {
    const events: MlroEvent[] = [
      ev({ verdict: 'pass', latencyMs: 100 }),
      ev({ verdict: 'pass', latencyMs: 200 }),
      ev({ verdict: 'pass', latencyMs: 300 }),
    ];
    const r = computeMlroMetrics(events);
    expect(r.aggregate.decisionLatency.medianMs).toBe(200);
  });

  it('pairs four-eyes-first/second by refId for turnaround', () => {
    const t0 = Date.now();
    const events: MlroEvent[] = [
      ev({
        kind: 'four-eyes-first',
        refId: 'apr-1',
        at: new Date(t0).toISOString(),
      }),
      ev({
        kind: 'four-eyes-second',
        refId: 'apr-1',
        at: new Date(t0 + 5_000).toISOString(),
      }),
    ];
    const r = computeMlroMetrics(events);
    expect(r.perMlro[0].fourEyesTurnaroundMs.medianMs).toBe(5000);
  });

  it('pairs str-draft and str-filed by refId', () => {
    const t0 = Date.now();
    const events: MlroEvent[] = [
      ev({
        kind: 'str-draft',
        refId: 'str-1',
        at: new Date(t0).toISOString(),
      }),
      ev({
        kind: 'str-filed',
        refId: 'str-1',
        at: new Date(t0 + 60_000).toISOString(),
      }),
    ];
    const r = computeMlroMetrics(events);
    expect(r.perMlro[0].strDraftToFileMs.medianMs).toBe(60_000);
  });

  it('window bounds reflect first and last event timestamps', () => {
    const events: MlroEvent[] = [
      ev({ verdict: 'pass', at: '2026-04-10T00:00:00.000Z' }),
      ev({ verdict: 'flag', at: '2026-04-13T00:00:00.000Z' }),
      ev({ verdict: 'freeze', at: '2026-04-12T00:00:00.000Z' }),
    ];
    const r = computeMlroMetrics(events);
    expect(r.windowFromIso).toBe('2026-04-10T00:00:00.000Z');
    expect(r.windowToIso).toBe('2026-04-13T00:00:00.000Z');
  });
});
