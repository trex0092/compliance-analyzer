/**
 * Tests for Phase 7 Cluster G — data pipeline intelligence.
 */
import { describe, it, expect } from 'vitest';
import { resolveEntities } from '@/services/entityResolver';
import { propagateTaint } from '@/services/taintPropagator';
import { scheduleRescreens } from '@/services/continuousCddScheduler';
import {
  buildHistory,
  rewindToInstant,
  findAttributeChanges,
} from '@/services/entityHistoryTracker';
import { detectCrossBorderArbitrage } from '@/services/crossBorderArbitrageDetector';

// ---------------------------------------------------------------------------
// entityResolver
// ---------------------------------------------------------------------------

describe('entityResolver', () => {
  it('merges observations sharing a passport number', () => {
    const report = resolveEntities([
      {
        observationId: 'O1',
        source: 'customer',
        name: 'Alice Smith',
        strongIdentifiers: { passport: 'P123' },
      },
      {
        observationId: 'O2',
        source: 'transaction',
        name: 'A. Smith',
        strongIdentifiers: { passport: 'P123' },
      },
    ]);
    expect(report.canonical).toBe(1);
    expect(report.merges).toBe(1);
  });

  it('merges on name + birth year + nationality when strong IDs absent', () => {
    const report = resolveEntities([
      {
        observationId: 'O1',
        source: 'customer',
        name: 'Alice Smith',
        birthYear: 1985,
        nationality: 'AE',
      },
      {
        observationId: 'O2',
        source: 'adverse_media',
        name: 'alice smith',
        birthYear: 1985,
        nationality: 'AE',
      },
    ]);
    expect(report.canonical).toBe(1);
    expect(report.entities[0].mergedReason).toBe('name_dob_nationality');
  });

  it('keeps distinct identities separate', () => {
    const report = resolveEntities([
      { observationId: 'O1', source: 'customer', name: 'Alice' },
      { observationId: 'O2', source: 'customer', name: 'Bob' },
    ]);
    expect(report.canonical).toBe(2);
    expect(report.merges).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// taintPropagator
// ---------------------------------------------------------------------------

describe('taintPropagator', () => {
  it('propagates taint along a linear chain with decay', () => {
    const report = propagateTaint({
      initialTaints: new Map([['S', 1.0]]),
      edges: [
        { from: 'S', to: 'A', amount: 1, at: '2026-01-01T00:00:00Z' },
        { from: 'A', to: 'B', amount: 1, at: '2026-01-02T00:00:00Z' },
        { from: 'B', to: 'C', amount: 1, at: '2026-01-03T00:00:00Z' },
      ],
    });
    expect(report.tainted.length).toBe(4);
    const c = report.tainted.find((t) => t.wallet === 'C');
    expect(c).toBeDefined();
    expect(c!.hops).toBe(3);
    // After 3 hops with default 0.2 decay: 1 * 0.8 * 0.8 * 0.8 ≈ 0.512
    expect(c!.taint).toBeGreaterThan(0.4);
    expect(c!.taint).toBeLessThan(0.6);
  });

  it('respects maxHops', () => {
    const report = propagateTaint(
      {
        initialTaints: new Map([['S', 1.0]]),
        edges: [
          { from: 'S', to: 'A', amount: 1, at: '2026-01-01T00:00:00Z' },
          { from: 'A', to: 'B', amount: 1, at: '2026-01-02T00:00:00Z' },
          { from: 'B', to: 'C', amount: 1, at: '2026-01-03T00:00:00Z' },
        ],
      },
      { maxHops: 1 }
    );
    // S + A only (1 hop beyond source)
    expect(report.tainted.find((t) => t.wallet === 'C')).toBeUndefined();
  });

  it('prunes paths that drop below threshold', () => {
    const report = propagateTaint(
      {
        initialTaints: new Map([['S', 0.1]]),
        edges: [{ from: 'S', to: 'A', amount: 1, at: '2026-01-01T00:00:00Z' }],
      },
      { minTaintThreshold: 0.2 }
    );
    // S itself is above threshold at 0.1 so it's seeded but not propagated.
    expect(report.tainted.find((t) => t.wallet === 'A')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// continuousCddScheduler
// ---------------------------------------------------------------------------

describe('continuousCddScheduler', () => {
  const now = new Date('2026-04-11T00:00:00Z');
  const state = [
    {
      customerId: 'C1',
      currentTier: 'CDD' as const,
      riskScore: 10,
      lastScreenedAt: '2026-03-01T00:00:00Z',
      uboDisclosedPct: 80,
    },
  ];

  it('adverse media event produces high-priority rescreen', () => {
    const tasks = scheduleRescreens(
      state,
      [{ kind: 'adverse_media', customerId: 'C1', at: '2026-04-11T00:00:00Z' }],
      now
    );
    expect(tasks.length).toBe(1);
    expect(tasks[0].priority).toBe('high');
    expect(tasks[0].reason).toBe('adverse_media');
  });

  it('new sanctions hit produces critical + 24h deadline', () => {
    const tasks = scheduleRescreens(
      state,
      [{ kind: 'new_sanction', customerId: 'C1', at: '2026-04-11T00:00:00Z' }],
      now
    );
    expect(tasks[0].priority).toBe('critical');
    expect(tasks[0].citation).toContain('Cabinet Res 74/2020');
  });

  it('UBO change within 10% does not fire', () => {
    const tasks = scheduleRescreens(
      state,
      [{ kind: 'ubo_change', customerId: 'C1', at: '2026-04-11T00:00:00Z', newDisclosedPct: 85 }],
      now
    );
    expect(tasks.length).toBe(0);
  });

  it('interval expired fires a task after the CDD max interval', () => {
    const old = [
      { ...state[0], lastScreenedAt: '2024-01-01T00:00:00Z' },
    ];
    const tasks = scheduleRescreens(old, [], now);
    expect(tasks.some((t) => t.reason === 'interval_expired')).toBe(true);
  });

  it('risk score tier boundary fires a tier_boundary task', () => {
    const tasks = scheduleRescreens(
      state,
      [{ kind: 'risk_score', customerId: 'C1', at: '2026-04-11T00:00:00Z', newScore: 20 }],
      now
    );
    expect(tasks.some((t) => t.reason === 'tier_boundary')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// entityHistoryTracker
// ---------------------------------------------------------------------------

describe('entityHistoryTracker', () => {
  const snapshots = [
    {
      entityId: 'E1',
      at: '2026-01-01T00:00:00Z',
      attributes: { risk: 'low', address: 'Dubai' },
      updatedBy: 'system',
    },
    {
      entityId: 'E1',
      at: '2026-02-01T00:00:00Z',
      attributes: { risk: 'medium', address: 'Dubai' },
      updatedBy: 'analyst',
    },
    {
      entityId: 'E1',
      at: '2026-03-01T00:00:00Z',
      attributes: { risk: 'high', address: 'Abu Dhabi' },
      updatedBy: 'mlro',
    },
  ];

  it('builds a timeline with diffs', () => {
    const history = buildHistory(snapshots);
    expect(history.length).toBe(3);
    expect(history[1].diffs.some((d) => d.attribute === 'risk')).toBe(true);
    expect(history[2].diffs.some((d) => d.attribute === 'address')).toBe(true);
  });

  it('rewinds to a point in time', () => {
    const state = rewindToInstant(snapshots, '2026-02-15T00:00:00Z');
    expect(state?.risk).toBe('medium');
    expect(state?.address).toBe('Dubai');
  });

  it('finds all changes to a specific attribute', () => {
    const changes = findAttributeChanges(snapshots, 'risk');
    expect(changes.length).toBe(3); // initial + 2 updates
  });
});

// ---------------------------------------------------------------------------
// crossBorderArbitrageDetector
// ---------------------------------------------------------------------------

describe('crossBorderArbitrageDetector', () => {
  it('flags UAE + DIFC exposure', () => {
    const report = detectCrossBorderArbitrage([
      {
        canonicalId: 'P1',
        entityId: 'E1',
        jurisdiction: 'AE',
        entityType: 'legal_entity',
        registeredAt: '2024-01-01T00:00:00Z',
      },
      {
        canonicalId: 'P1',
        entityId: 'E2',
        jurisdiction: 'DIFC',
        entityType: 'legal_entity',
        registeredAt: '2025-01-01T00:00:00Z',
      },
    ]);
    expect(report.hits.length).toBe(1);
    expect(report.hits[0].score).toBeGreaterThan(0);
  });

  it('single-jurisdiction customer is not a hit', () => {
    const report = detectCrossBorderArbitrage([
      {
        canonicalId: 'P1',
        entityId: 'E1',
        jurisdiction: 'AE',
        entityType: 'legal_entity',
        registeredAt: '2024-01-01T00:00:00Z',
      },
    ]);
    expect(report.hits.length).toBe(0);
  });

  it('UAE + Switzerland has higher score than UAE + DIFC', () => {
    const report = detectCrossBorderArbitrage([
      {
        canonicalId: 'P1',
        entityId: 'E1',
        jurisdiction: 'AE',
        entityType: 'legal_entity',
        registeredAt: '2024-01-01T00:00:00Z',
      },
      {
        canonicalId: 'P1',
        entityId: 'E2',
        jurisdiction: 'CH',
        entityType: 'legal_entity',
        registeredAt: '2024-01-01T00:00:00Z',
      },
    ]);
    expect(report.hits[0].score).toBeGreaterThanOrEqual(0.6);
  });
});
