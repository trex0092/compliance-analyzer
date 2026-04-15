/**
 * Feedback Loop tests.
 *
 * Covers:
 *   - validateOverrideRecord rejects missing required fields
 *   - rollupWeightDelta ignores downgrade overrides (safety invariant 3)
 *   - rollupWeightDelta requires MIN_OVERRIDES_PER_FEATURE samples
 *   - rollupWeightDelta caps the proposed factor at +15% (envelope)
 *   - asClampSuggestions wraps deltas correctly
 *   - FeedbackBlobStore round-trips records
 *   - FeedbackBlobStore enforces validation at write time
 *   - readRange spans multiple days
 */
import { describe, it, expect } from 'vitest';

import {
  validateOverrideRecord,
  rollupWeightDelta,
  asClampSuggestions,
  FeedbackBlobStore,
  MAX_WEIGHT_DELTA_PCT,
  MIN_OVERRIDES_PER_FEATURE,
  type MlroOverrideRecord,
} from '../src/services/feedbackLoop';
import type { BlobHandle } from '../src/services/brainMemoryBlobStore';

// ---------------------------------------------------------------------------
// In-memory blob handle
// ---------------------------------------------------------------------------

function makeBlob(): BlobHandle {
  const store = new Map<string, unknown>();
  return {
    async getJSON<T>(key: string): Promise<T | null> {
      return (store.get(key) ?? null) as T | null;
    },
    async setJSON(key: string, value: unknown): Promise<void> {
      store.set(key, value);
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
  } as BlobHandle;
}

function makeOverride(overrides: Partial<MlroOverrideRecord> = {}): MlroOverrideRecord {
  return {
    id: 'override-1',
    tsIso: '2026-04-15T04:00:00.000Z',
    tenantId: 'tenant-a',
    caseId: 'case-1',
    mlroUserId: 'user-mlro-1',
    brainVerdict: 'pass',
    humanVerdict: 'escalate',
    features: { txValue30dAED: 80000, sanctionsMatchScore: 0.6, isPep: 1 },
    rationale: 'Profile mismatch beyond stated income; escalation warranted.',
    regulatoryCitation: 'FDL Art.20-22',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateOverrideRecord
// ---------------------------------------------------------------------------

describe('validateOverrideRecord', () => {
  it('accepts a complete record', () => {
    const r = validateOverrideRecord(makeOverride());
    expect(r.ok).toBe(true);
  });

  it('rejects missing rationale', () => {
    const r = validateOverrideRecord(makeOverride({ rationale: '' }));
    expect(r.ok).toBe(false);
  });

  it('rejects missing regulatoryCitation', () => {
    const r = validateOverrideRecord(makeOverride({ regulatoryCitation: '' }));
    expect(r.ok).toBe(false);
  });

  it('rejects unknown verdict', () => {
    // @ts-expect-error testing unknown verdict
    const r = validateOverrideRecord(makeOverride({ humanVerdict: 'maybe' }));
    expect(r.ok).toBe(false);
  });

  it('rejects non-finite feature value', () => {
    const r = validateOverrideRecord(
      makeOverride({ features: { txValue30dAED: Number.NaN } })
    );
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rollupWeightDelta
// ---------------------------------------------------------------------------

describe('rollupWeightDelta', () => {
  it('returns no deltas for empty input', () => {
    const r = rollupWeightDelta('tenant-a', '2026-04-01', '2026-04-15', []);
    expect(r.deltas).toEqual([]);
    expect(r.summary).toMatch(/No actionable/);
  });

  it('ignores downgrade overrides (safety invariant 3)', () => {
    const overrides = Array.from({ length: 10 }, () =>
      makeOverride({ brainVerdict: 'freeze', humanVerdict: 'pass' })
    );
    const r = rollupWeightDelta('tenant-a', '2026-04-01', '2026-04-15', overrides);
    expect(r.deltas).toEqual([]);
    expect(r.ignoredForDeltaCount).toBe(10);
  });

  it('requires MIN_OVERRIDES_PER_FEATURE samples before producing a delta', () => {
    const overrides = Array.from({ length: MIN_OVERRIDES_PER_FEATURE - 1 }, () =>
      makeOverride()
    );
    const r = rollupWeightDelta('tenant-a', '2026-04-01', '2026-04-15', overrides);
    expect(r.deltas).toEqual([]);
  });

  it('produces a delta when sample threshold is met', () => {
    const overrides = Array.from({ length: MIN_OVERRIDES_PER_FEATURE }, (_, i) =>
      makeOverride({
        id: `override-${i}`,
        features: { txValue30dAED: 80000, sanctionsMatchScore: 0.6, isPep: 1 },
      })
    );
    const r = rollupWeightDelta('tenant-a', '2026-04-01', '2026-04-15', overrides);
    expect(r.deltas.length).toBeGreaterThan(0);
    expect(r.deltas.every((d) => d.direction === 'increase')).toBe(true);
    expect(r.deltas.every((d) => d.proposedFactor >= 1)).toBe(true);
  });

  it('caps proposed factor at +MAX_WEIGHT_DELTA_PCT regardless of sample size', () => {
    // 100 freeze-up overrides — disagreement = 3 each. Without the
    // cap the factor would grow unbounded.
    const overrides = Array.from({ length: 100 }, (_, i) =>
      makeOverride({
        id: `override-${i}`,
        brainVerdict: 'pass',
        humanVerdict: 'freeze',
        features: { txValue30dAED: 100000 },
      })
    );
    const r = rollupWeightDelta('tenant-a', '2026-04-01', '2026-04-15', overrides);
    for (const d of r.deltas) {
      expect(d.proposedFactor).toBeLessThanOrEqual(1 + MAX_WEIGHT_DELTA_PCT + 1e-9);
      expect(d.proposedFactor).toBeGreaterThanOrEqual(1);
    }
  });

  it('carries the regulatory anchors', () => {
    const r = rollupWeightDelta('tenant-a', '2026-04-01', '2026-04-15', []);
    expect(r.regulatory).toContain('FDL No.10/2025 Art.19-21');
    expect(r.regulatory).toContain('Cabinet Res 134/2025 Art.19');
    expect(r.regulatory).toContain('NIST AI RMF 1.0 GOVERN-4');
    expect(r.regulatory).toContain('EU AI Act Art.14');
  });
});

// ---------------------------------------------------------------------------
// asClampSuggestions
// ---------------------------------------------------------------------------

describe('asClampSuggestions', () => {
  it('wraps each delta as a Tier C clamp suggestion record', () => {
    const overrides = Array.from({ length: MIN_OVERRIDES_PER_FEATURE }, () =>
      makeOverride({ features: { txValue30dAED: 80000 } })
    );
    const report = rollupWeightDelta('tenant-a', '2026-04-01', '2026-04-15', overrides);
    const suggestions = asClampSuggestions(
      report,
      { txValue30dAED: 1.0 },
      () => new Date('2026-04-15T05:00:00Z')
    );
    expect(suggestions.length).toBe(report.deltas.length);
    for (const s of suggestions) {
      expect(s.status).toBe('pending_mlro_review');
      expect(s.source).toBe('feedback-loop');
      expect(s.regulatory).toContain('FDL Art.19-21');
      expect(s.proposedValue).toBeGreaterThanOrEqual(s.currentValue);
    }
  });
});

// ---------------------------------------------------------------------------
// FeedbackBlobStore
// ---------------------------------------------------------------------------

describe('FeedbackBlobStore', () => {
  it('round-trips a record', async () => {
    const store = new FeedbackBlobStore(makeBlob());
    await store.record(makeOverride());
    const day = await store.readDay('tenant-a', '2026-04-15');
    expect(day.length).toBe(1);
    expect(day[0]!.id).toBe('override-1');
  });

  it('rejects an invalid record at write time', async () => {
    const store = new FeedbackBlobStore(makeBlob());
    await expect(
      store.record(makeOverride({ regulatoryCitation: '' }))
    ).rejects.toThrow();
  });

  it('readRange spans multiple UTC days', async () => {
    const store = new FeedbackBlobStore(makeBlob());
    await store.record(
      makeOverride({ id: 'a', tsIso: '2026-04-13T10:00:00.000Z' })
    );
    await store.record(
      makeOverride({ id: 'b', tsIso: '2026-04-14T10:00:00.000Z' })
    );
    await store.record(
      makeOverride({ id: 'c', tsIso: '2026-04-15T10:00:00.000Z' })
    );
    const range = await store.readRange('tenant-a', '2026-04-13', '2026-04-15');
    expect(range.length).toBe(3);
  });
});
