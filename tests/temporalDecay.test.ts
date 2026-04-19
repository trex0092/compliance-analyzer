import { describe, it, expect } from 'vitest';
import {
  temporalDecayMultiplier,
  describeFreshness,
  freshnessForAgeDays,
} from '../src/services/temporalDecay';

function dayShift(now: string, days: number): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

describe('temporalDecayMultiplier', () => {
  const NOW = '2026-04-19T10:00:00.000Z';

  it('returns 1.0 for brand-new evidence', () => {
    expect(temporalDecayMultiplier({ observedAtIso: NOW, nowIso: NOW })).toBe(1);
  });

  it('halves at 90 days (default half-life)', () => {
    const m = temporalDecayMultiplier({
      observedAtIso: dayShift(NOW, 90),
      nowIso: NOW,
    });
    expect(m).toBeCloseTo(0.5, 2);
  });

  it('quarters at 180 days', () => {
    const m = temporalDecayMultiplier({
      observedAtIso: dayShift(NOW, 180),
      nowIso: NOW,
    });
    expect(m).toBeCloseTo(0.25, 2);
  });

  it('floors at 0.05 for very old evidence', () => {
    const m = temporalDecayMultiplier({
      observedAtIso: dayShift(NOW, 3650),
      nowIso: NOW,
    });
    expect(m).toBeCloseTo(0.05, 5);
  });

  it('honours a custom half-life', () => {
    const m = temporalDecayMultiplier({
      observedAtIso: dayShift(NOW, 30),
      nowIso: NOW,
      halfLifeDays: 30,
    });
    expect(m).toBeCloseTo(0.5, 2);
  });

  it('returns 1 for invalid timestamps', () => {
    expect(temporalDecayMultiplier({ observedAtIso: 'not-a-date', nowIso: NOW })).toBe(1);
  });

  it('returns 1 when halfLifeDays <= 0', () => {
    expect(
      temporalDecayMultiplier({
        observedAtIso: dayShift(NOW, 30),
        nowIso: NOW,
        halfLifeDays: 0,
      })
    ).toBe(1);
  });
});

describe('describeFreshness', () => {
  it('maps multipliers to labels', () => {
    expect(describeFreshness(1)).toBe('fresh');
    expect(describeFreshness(0.7)).toBe('recent');
    expect(describeFreshness(0.4)).toBe('ageing');
    expect(describeFreshness(0.15)).toBe('stale');
    expect(describeFreshness(0.05)).toBe('legacy');
  });
});

describe('freshnessForAgeDays', () => {
  it('90d → ageing (multiplier 0.5)', () => {
    expect(freshnessForAgeDays(90)).toBe('ageing');
  });

  it('0d → fresh', () => {
    expect(freshnessForAgeDays(0)).toBe('fresh');
  });
});
