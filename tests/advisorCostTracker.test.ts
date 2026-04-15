/**
 * Advisor cost tracker tests.
 *
 * Covers:
 *   - costForEvent uses the static price table
 *   - aggregateAdvisorCost rolls up by model / verdict / trigger / tenant
 *   - InMemoryCostEventStore round-trips events
 *   - AdvisorCostTracker.report computes the same total as the
 *     standalone aggregator
 *   - reportForTenant + reportForRange filter correctly
 *   - Unknown model returns 0 cost (no crash)
 */
import { describe, it, expect } from 'vitest';

import {
  AdvisorCostTracker,
  InMemoryCostEventStore,
  aggregateAdvisorCost,
  costForEvent,
  ANTHROPIC_PRICES,
  type CostEvent,
} from '../src/services/advisorCostTracker';

function makeEvent(overrides: Partial<CostEvent> = {}): CostEvent {
  return {
    tsIso: '2026-04-15T04:30:00.000Z',
    tenantId: 'tenant-a',
    caller: 'brain-analyze',
    model: 'claude-opus-4-6',
    inputTokens: 1000,
    outputTokens: 500,
    verdict: 'flag',
    triggerReason: 'sanctions-match-score-ge-0.5',
    ...overrides,
  };
}

describe('costForEvent', () => {
  it('uses the static price table for opus 4.6', () => {
    const cost = costForEvent(makeEvent());
    // 1000 in tokens at $15/M = $0.015, 500 out at $75/M = $0.0375
    // Total: $0.0525
    expect(cost).toBeCloseTo(0.0525, 6);
  });

  it('returns 0 for an unknown model id', () => {
    // @ts-expect-error testing unknown model
    const cost = costForEvent(makeEvent({ model: 'gpt-mystery' }));
    expect(cost).toBe(0);
  });

  it('returns 0 for the deterministic fallback', () => {
    const cost = costForEvent(
      makeEvent({ model: 'deterministic-fallback', inputTokens: 1e6, outputTokens: 1e6 })
    );
    expect(cost).toBe(0);
  });

  it('opus is more expensive than sonnet for the same token mix', () => {
    const opus = costForEvent(makeEvent({ model: 'claude-opus-4-6' }));
    const sonnet = costForEvent(makeEvent({ model: 'claude-sonnet-4-6' }));
    expect(opus).toBeGreaterThan(sonnet);
  });
});

describe('aggregateAdvisorCost', () => {
  it('returns an empty report for an empty event list', () => {
    const r = aggregateAdvisorCost([]);
    expect(r.totalEvents).toBe(0);
    expect(r.totalUsdCost).toBe(0);
    expect(r.summary).toMatch(/No advisor calls/);
  });

  it('rolls up totals across heterogeneous events', () => {
    const events: CostEvent[] = [
      makeEvent({ model: 'claude-opus-4-6', inputTokens: 1000, outputTokens: 500 }),
      makeEvent({
        model: 'claude-sonnet-4-6',
        inputTokens: 5000,
        outputTokens: 2000,
        verdict: 'pass',
      }),
      makeEvent({ model: 'deterministic-fallback', verdict: 'escalate' }),
    ];
    const r = aggregateAdvisorCost(events);
    expect(r.totalEvents).toBe(3);
    expect(r.totalInputTokens).toBe(1000 + 5000 + 1000);
    expect(r.totalOutputTokens).toBe(500 + 2000 + 500);
    expect(r.byModel['claude-opus-4-6']!.events).toBe(1);
    expect(r.byModel['claude-sonnet-4-6']!.events).toBe(1);
    expect(r.byModel['deterministic-fallback']!.events).toBe(1);
    expect(r.byVerdict.flag!.events).toBe(1);
    expect(r.byVerdict.pass!.events).toBe(1);
    expect(r.byVerdict.escalate!.events).toBe(1);
  });

  it('byTenant separates two tenants', () => {
    const r = aggregateAdvisorCost([
      makeEvent({ tenantId: 'tenant-a' }),
      makeEvent({ tenantId: 'tenant-b' }),
      makeEvent({ tenantId: 'tenant-a' }),
    ]);
    expect(r.byTenant['tenant-a']!.events).toBe(2);
    expect(r.byTenant['tenant-b']!.events).toBe(1);
  });

  it('groups missing verdict / trigger under "unknown"', () => {
    const r = aggregateAdvisorCost([
      makeEvent({ verdict: undefined, triggerReason: undefined }),
    ]);
    expect(r.byVerdict.unknown!.events).toBe(1);
    expect(r.byTrigger.unknown!.events).toBe(1);
  });

  it('carries the regulatory citations', () => {
    const r = aggregateAdvisorCost([]);
    expect(r.regulatory).toContain('NIST AI RMF 1.0 GOVERN-3');
    expect(r.regulatory).toContain('NIST AI RMF 1.0 MEASURE-4');
    expect(r.regulatory).toContain('EU AI Act Art.15');
  });
});

describe('InMemoryCostEventStore', () => {
  it('round-trips appended events', async () => {
    const store = new InMemoryCostEventStore();
    await store.append(makeEvent());
    await store.append(makeEvent({ tenantId: 'tenant-b' }));
    const loaded = await store.load();
    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.tenantId).toBe('tenant-a');
    expect(loaded[1]!.tenantId).toBe('tenant-b');
  });

  it('reset clears the buffer', async () => {
    const store = new InMemoryCostEventStore();
    await store.append(makeEvent());
    await store.reset();
    expect(await store.load()).toHaveLength(0);
  });
});

describe('AdvisorCostTracker', () => {
  it('report() matches a direct aggregateAdvisorCost call', async () => {
    const tracker = new AdvisorCostTracker();
    const events = [
      makeEvent({ model: 'claude-opus-4-6' }),
      makeEvent({ model: 'claude-sonnet-4-6' }),
    ];
    for (const e of events) await tracker.record(e);
    const r = await tracker.report();
    expect(r.totalEvents).toBe(events.length);
    expect(r.totalUsdCost).toBeCloseTo(aggregateAdvisorCost(events).totalUsdCost, 10);
  });

  it('reportForTenant filters to a single tenant', async () => {
    const tracker = new AdvisorCostTracker();
    await tracker.record(makeEvent({ tenantId: 'tenant-a' }));
    await tracker.record(makeEvent({ tenantId: 'tenant-b' }));
    const r = await tracker.reportForTenant('tenant-a');
    expect(r.totalEvents).toBe(1);
    expect(r.byTenant['tenant-a']!.events).toBe(1);
  });

  it('reportForRange filters to a date window', async () => {
    const tracker = new AdvisorCostTracker();
    await tracker.record(makeEvent({ tsIso: '2026-04-01T00:00:00Z' }));
    await tracker.record(makeEvent({ tsIso: '2026-04-15T00:00:00Z' }));
    await tracker.record(makeEvent({ tsIso: '2026-05-01T00:00:00Z' }));
    const r = await tracker.reportForRange('2026-04-10T00:00:00Z', '2026-04-20T00:00:00Z');
    expect(r.totalEvents).toBe(1);
  });

  it('reportForRange returns empty on invalid dates', async () => {
    const tracker = new AdvisorCostTracker();
    await tracker.record(makeEvent());
    const r = await tracker.reportForRange('not-a-date', 'also-not');
    expect(r.totalEvents).toBe(0);
  });
});

describe('ANTHROPIC_PRICES', () => {
  it('lists every advisor model in the strategy', () => {
    expect(ANTHROPIC_PRICES['claude-opus-4-6']).toBeDefined();
    expect(ANTHROPIC_PRICES['claude-sonnet-4-6']).toBeDefined();
    expect(ANTHROPIC_PRICES['claude-haiku-4-5']).toBeDefined();
    expect(ANTHROPIC_PRICES['deterministic-fallback']).toBeDefined();
  });

  it('opus output cost is greater than opus input cost', () => {
    const opus = ANTHROPIC_PRICES['claude-opus-4-6'];
    expect(opus.outputUsdPerMillion).toBeGreaterThan(opus.inputUsdPerMillion);
  });
});
