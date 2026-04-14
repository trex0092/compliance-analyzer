/**
 * Case replay store tests.
 */
import { describe, it, expect } from 'vitest';
import { CaseReplayStore, __test__, type ReplayCase } from '../src/services/caseReplayStore';
import type { BlobHandle } from '../src/services/brainMemoryBlobStore';
import type { CaseSnapshot } from '../src/services/crossCasePatternCorrelator';
import { DPMS_CASH_THRESHOLD_AED, CROSS_BORDER_CASH_THRESHOLD_AED } from '../src/domain/constants';

const { safeSegment, replayKey, clamp01, computeThresholdImpacts } = __test__;

// ---------------------------------------------------------------------------
// Fake blob
// ---------------------------------------------------------------------------

class FakeBlobHandle implements BlobHandle {
  readonly data = new Map<string, unknown>();
  readonly getCalls: string[] = [];
  readonly setCalls: string[] = [];
  readonly deleteCalls: string[] = [];
  throwOnGet = false;
  throwOnSet = false;

  async getJSON<T = unknown>(key: string): Promise<T | null> {
    this.getCalls.push(key);
    if (this.throwOnGet) {
      this.throwOnGet = false;
      throw new Error('boom-get');
    }
    const v = this.data.get(key);
    return v === undefined ? null : (v as T);
  }
  async setJSON(key: string, value: unknown): Promise<void> {
    this.setCalls.push(key);
    if (this.throwOnSet) {
      this.throwOnSet = false;
      throw new Error('boom-set');
    }
    this.data.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.deleteCalls.push(key);
    this.data.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snapshot(overrides: Partial<CaseSnapshot> = {}): CaseSnapshot {
  return {
    caseId: 'case-1',
    tenantId: 'tenant-a',
    openedAt: '2026-04-14T12:00:00.000Z',
    entityRef: 'entity-opaque-hash',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// safeSegment / replayKey
// ---------------------------------------------------------------------------

describe('safeSegment', () => {
  it('strips slashes + control characters', () => {
    expect(safeSegment('tenant/bad')).toBe('tenant_bad');
    expect(safeSegment('a b c')).toBe('a_b_c');
  });
  it('caps length at 128', () => {
    expect(safeSegment('x'.repeat(200)).length).toBe(128);
  });
});

describe('replayKey', () => {
  it('uses replay/<tenant>/<case>.json layout', () => {
    expect(replayKey('tA', 'c1')).toBe('replay/tA/c1.json');
  });
  it('escapes both tenant and case segments', () => {
    expect(replayKey('bad/tenant', 'bad/case')).toBe('replay/bad_tenant/bad_case.json');
  });
});

// ---------------------------------------------------------------------------
// clamp01
// ---------------------------------------------------------------------------

describe('clamp01', () => {
  it('clamps negatives to 0', () => {
    expect(clamp01(-0.3)).toBe(0);
  });
  it('clamps >1 to 1', () => {
    expect(clamp01(1.8)).toBe(1);
  });
  it('returns mid values unchanged', () => {
    expect(clamp01(0.42)).toBe(0.42);
  });
  it('handles NaN + Infinity', () => {
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeThresholdImpacts
// ---------------------------------------------------------------------------

describe('computeThresholdImpacts', () => {
  function storedCase(overrides: {
    maxTxAED?: number;
    dpmsAtTime?: number;
    borderAtTime?: number;
  }): ReplayCase {
    return {
      schemaVersion: 1,
      tenantId: 'tA',
      caseId: 'c1',
      snapshot: snapshot({ maxTxAED: overrides.maxTxAED }),
      baselineAtTime: {
        version: 'test',
        capturedAtIso: '2026-04-14T12:00:00.000Z',
        values: {
          DPMS_CASH_THRESHOLD_AED: overrides.dpmsAtTime ?? DPMS_CASH_THRESHOLD_AED,
          CROSS_BORDER_CASH_THRESHOLD_AED:
            overrides.borderAtTime ?? CROSS_BORDER_CASH_THRESHOLD_AED,
        },
      },
      verdictAtTime: 'flag',
      confidenceAtTime: 0.8,
      powerScoreAtTime: 60,
      decidedAtIso: '2026-04-14T12:00:00.000Z',
    };
  }

  it('returns empty when snapshot has no maxTxAED', () => {
    const impacts = computeThresholdImpacts(storedCase({}));
    expect(impacts).toHaveLength(0);
  });

  it("reports stable when feature + thresholds match today's constants", () => {
    const impacts = computeThresholdImpacts(storedCase({ maxTxAED: 30_000 }));
    expect(impacts).toHaveLength(2);
    for (const i of impacts) {
      expect(i.trippedAtDecision).toBe(i.tripsToday);
    }
  });

  it('detects threshold flip when historical threshold differs', () => {
    // Case decided under an old DPMS threshold of 70K, feature is 60K
    // (did NOT trip at decision). Today's threshold is 55K → 60K trips.
    const impacts = computeThresholdImpacts(storedCase({ maxTxAED: 60_000, dpmsAtTime: 70_000 }));
    const dpms = impacts.find((i) => i.key === 'DPMS_CASH_THRESHOLD_AED');
    expect(dpms?.trippedAtDecision).toBe(false);
    expect(dpms?.tripsToday).toBe(true);
  });

  it('detects reverse flip — used to trip, no longer does', () => {
    // 40K with an old DPMS threshold of 30K (tripped) vs today's 55K
    // (no trip).
    const impacts = computeThresholdImpacts(storedCase({ maxTxAED: 40_000, dpmsAtTime: 30_000 }));
    const dpms = impacts.find((i) => i.key === 'DPMS_CASH_THRESHOLD_AED');
    expect(dpms?.trippedAtDecision).toBe(true);
    expect(dpms?.tripsToday).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CaseReplayStore.record + loadReplayCase
// ---------------------------------------------------------------------------

describe('CaseReplayStore.record + loadReplayCase', () => {
  it('persists a replay case under replay/<tenant>/<case>.json', async () => {
    const blob = new FakeBlobHandle();
    const store = new CaseReplayStore(blob, {
      now: () => new Date('2026-04-14T12:00:00.000Z'),
    });
    store.record({
      tenantId: 'tA',
      caseId: 'c1',
      snapshot: snapshot({ maxTxAED: 90_000 }),
      verdictAtTime: 'flag',
      confidenceAtTime: 0.72,
      powerScoreAtTime: 65,
    });
    await store.flush();
    expect(blob.setCalls).toContain('replay/tA/c1.json');
    const loaded = await store.loadReplayCase('tA', 'c1');
    expect(loaded).not.toBeNull();
    expect(loaded?.verdictAtTime).toBe('flag');
    expect(loaded?.confidenceAtTime).toBe(0.72);
    expect(loaded?.powerScoreAtTime).toBe(65);
    expect(loaded?.baselineAtTime.values.DPMS_CASH_THRESHOLD_AED).toBe(DPMS_CASH_THRESHOLD_AED);
  });

  it('clamps out-of-range confidence into [0, 1]', async () => {
    const blob = new FakeBlobHandle();
    const store = new CaseReplayStore(blob);
    store.record({
      tenantId: 'tA',
      caseId: 'c1',
      snapshot: snapshot(),
      verdictAtTime: 'pass',
      confidenceAtTime: 1.9,
      powerScoreAtTime: null,
    });
    await store.flush();
    const loaded = await store.loadReplayCase('tA', 'c1');
    expect(loaded?.confidenceAtTime).toBe(1);
  });

  it('ignores record calls with missing tenantId or caseId', async () => {
    const blob = new FakeBlobHandle();
    const store = new CaseReplayStore(blob);
    store.record({
      tenantId: '',
      caseId: 'c1',
      snapshot: snapshot(),
      verdictAtTime: 'flag',
      confidenceAtTime: 0.5,
      powerScoreAtTime: null,
    });
    store.record({
      tenantId: 'tA',
      caseId: '',
      snapshot: snapshot(),
      verdictAtTime: 'flag',
      confidenceAtTime: 0.5,
      powerScoreAtTime: null,
    });
    await store.flush();
    expect(blob.setCalls).toHaveLength(0);
  });

  it('serialises concurrent writes per key', async () => {
    const blob = new FakeBlobHandle();
    const store = new CaseReplayStore(blob);
    for (let i = 0; i < 5; i++) {
      store.record({
        tenantId: 'tA',
        caseId: 'c1',
        snapshot: snapshot({ maxTxAED: i }),
        verdictAtTime: 'flag',
        confidenceAtTime: 0.5,
        powerScoreAtTime: null,
      });
    }
    await store.flush();
    const loaded = await store.loadReplayCase('tA', 'c1');
    // Last write wins because they all target the same key.
    expect(loaded?.snapshot.maxTxAED).toBe(4);
  });

  it('returns null on loadReplayCase for unknown case', async () => {
    const blob = new FakeBlobHandle();
    const store = new CaseReplayStore(blob);
    const loaded = await store.loadReplayCase('tA', 'missing');
    expect(loaded).toBeNull();
  });

  it('returns null on schemaVersion mismatch', async () => {
    const blob = new FakeBlobHandle();
    blob.data.set('replay/tA/c1.json', { schemaVersion: 99, tenantId: 'tA' });
    const store = new CaseReplayStore(blob);
    const loaded = await store.loadReplayCase('tA', 'c1');
    expect(loaded).toBeNull();
  });

  it('returns null and logs on getJSON failure', async () => {
    const blob = new FakeBlobHandle();
    blob.throwOnGet = true;
    const store = new CaseReplayStore(blob);
    const loaded = await store.loadReplayCase('tA', 'c1');
    expect(loaded).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CaseReplayStore.replayCase
// ---------------------------------------------------------------------------

describe('CaseReplayStore.replayCase', () => {
  it('returns not_found for an unknown case', async () => {
    const blob = new FakeBlobHandle();
    const store = new CaseReplayStore(blob);
    const report = await store.replayCase('tA', 'missing');
    expect(report.found).toBe(false);
    expect(report.conclusion).toBe('not_found');
    expect(report.drift).toBeNull();
  });

  it('reports stable when nothing drifted and no threshold flipped', async () => {
    const blob = new FakeBlobHandle();
    const store = new CaseReplayStore(blob);
    store.record({
      tenantId: 'tA',
      caseId: 'c1',
      snapshot: snapshot({ maxTxAED: 10_000 }),
      verdictAtTime: 'pass',
      confidenceAtTime: 0.9,
      powerScoreAtTime: 20,
    });
    await store.flush();
    const report = await store.replayCase('tA', 'c1');
    expect(report.found).toBe(true);
    expect(report.conclusion).toBe('stable');
    expect(report.drift?.clean).toBe(true);
    expect(report.thresholdImpacts).toHaveLength(2);
    for (const i of report.thresholdImpacts) {
      expect(i.trippedAtDecision).toBe(i.tripsToday);
    }
  });

  it('reports verdict_may_change when a threshold flipped', async () => {
    const blob = new FakeBlobHandle();
    const store = new CaseReplayStore(blob);

    // Construct a stored case with an artificially-high historical
    // DPMS threshold so today's 55K catches a 60K feature that the
    // stored baseline let through.
    const stored: ReplayCase = {
      schemaVersion: 1,
      tenantId: 'tA',
      caseId: 'c1',
      snapshot: snapshot({ maxTxAED: 60_000 }),
      baselineAtTime: {
        version: 'old',
        capturedAtIso: '2025-01-01T00:00:00.000Z',
        values: {
          DPMS_CASH_THRESHOLD_AED: 70_000,
          CROSS_BORDER_CASH_THRESHOLD_AED: CROSS_BORDER_CASH_THRESHOLD_AED,
        },
      },
      verdictAtTime: 'pass',
      confidenceAtTime: 0.9,
      powerScoreAtTime: 10,
      decidedAtIso: '2025-01-01T00:00:00.000Z',
    };
    blob.data.set('replay/tA/c1.json', stored);

    const report = await store.replayCase('tA', 'c1');
    expect(report.found).toBe(true);
    expect(report.conclusion).toBe('verdict_may_change');
    const dpms = report.thresholdImpacts.find((i) => i.key === 'DPMS_CASH_THRESHOLD_AED');
    expect(dpms?.trippedAtDecision).toBe(false);
    expect(dpms?.tripsToday).toBe(true);
    expect(report.summary).toMatch(/would decide differently today/);
  });

  it('tenant isolation: cannot read a case under a different tenant', async () => {
    const blob = new FakeBlobHandle();
    const store = new CaseReplayStore(blob);
    store.record({
      tenantId: 'tA',
      caseId: 'c1',
      snapshot: snapshot(),
      verdictAtTime: 'flag',
      confidenceAtTime: 0.8,
      powerScoreAtTime: null,
    });
    await store.flush();
    const leaked = await store.loadReplayCase('tB', 'c1');
    expect(leaked).toBeNull();
  });
});
