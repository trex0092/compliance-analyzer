/**
 * Tests for netlify/functions/ongoing-screening-status.mts — exercises
 * the pure computeNextRunAt helper via __test__. No Netlify runtime, no
 * HTTP, no Blobs. The full handler is integration-tested in the UI
 * smoke test once deployed.
 *
 * Regulatory: FDL No.10/2025 Art.20-21 (CO situational awareness),
 * Art.24 (audit retention of routine runs), FATF Rec 10 (ongoing CDD).
 */
import { describe, it, expect } from 'vitest';

// @ts-expect-error — .mts file has no type declarations at test time
import { __test__ } from '../netlify/functions/ongoing-screening-status.mts';

const { computeNextRunAt, countSubjectsInEnvelope } = __test__ as {
  computeNextRunAt: (now: Date) => string;
  countSubjectsInEnvelope: (raw: unknown) => number | null;
};

describe('ongoing-screening-status — computeNextRunAt', () => {
  it('returns today at 08:00 UTC when called before today’s 08:00 UTC', () => {
    const now = new Date('2026-04-21T05:30:00.000Z');
    expect(computeNextRunAt(now)).toBe('2026-04-21T08:00:00.000Z');
  });

  it('returns tomorrow at 08:00 UTC when called at today’s 08:00 UTC exactly', () => {
    // The cron fires at 08:00:00 so the *next* run must be tomorrow.
    const now = new Date('2026-04-21T08:00:00.000Z');
    expect(computeNextRunAt(now)).toBe('2026-04-22T08:00:00.000Z');
  });

  it('returns tomorrow at 08:00 UTC when called after today’s 08:00 UTC', () => {
    const now = new Date('2026-04-21T14:00:00.000Z');
    expect(computeNextRunAt(now)).toBe('2026-04-22T08:00:00.000Z');
  });

  it('rolls into the next month correctly', () => {
    // 2026-04-30 23:59 UTC → next run is 2026-05-01 08:00 UTC
    const now = new Date('2026-04-30T23:59:00.000Z');
    expect(computeNextRunAt(now)).toBe('2026-05-01T08:00:00.000Z');
  });

  it('rolls into the next year correctly', () => {
    const now = new Date('2026-12-31T23:59:00.000Z');
    expect(computeNextRunAt(now)).toBe('2027-01-01T08:00:00.000Z');
  });

  it('handles leap-day → next-day transition', () => {
    // 2028 is a leap year; 2028-02-29 09:00 UTC → next run is 2028-03-01 08:00 UTC.
    const now = new Date('2028-02-29T09:00:00.000Z');
    expect(computeNextRunAt(now)).toBe('2028-03-01T08:00:00.000Z');
  });

  it('returns a valid ISO 8601 timestamp', () => {
    const now = new Date('2026-04-21T10:00:00.000Z');
    const result = computeNextRunAt(now);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // And it must parse back to a valid Date.
    expect(Number.isNaN(new Date(result).getTime())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// countSubjectsInEnvelope — covers the opt-in store defensive decoder.
// ---------------------------------------------------------------------------

describe('ongoing-screening-status — countSubjectsInEnvelope', () => {
  it('returns null on null / undefined / primitive / array payloads', () => {
    expect(countSubjectsInEnvelope(null)).toBeNull();
    expect(countSubjectsInEnvelope(undefined)).toBeNull();
    expect(countSubjectsInEnvelope('')).toBeNull();
    expect(countSubjectsInEnvelope(42)).toBeNull();
    expect(countSubjectsInEnvelope([])).toBeNull();
    expect(countSubjectsInEnvelope([{ subjects: {} }])).toBeNull();
  });

  it('returns 0 when subjects is absent or not a plain object', () => {
    expect(countSubjectsInEnvelope({})).toBe(0);
    expect(countSubjectsInEnvelope({ version: 1 })).toBe(0);
    expect(countSubjectsInEnvelope({ subjects: null })).toBe(0);
    expect(countSubjectsInEnvelope({ subjects: 'nope' })).toBe(0);
    expect(countSubjectsInEnvelope({ subjects: [] })).toBe(0);
  });

  it('counts the keys of the subjects map', () => {
    expect(countSubjectsInEnvelope({ subjects: {} })).toBe(0);
    expect(countSubjectsInEnvelope({ subjects: { a: {}, b: {} } })).toBe(2);
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) big['k' + i] = {};
    expect(countSubjectsInEnvelope({ subjects: big })).toBe(50);
  });
});
