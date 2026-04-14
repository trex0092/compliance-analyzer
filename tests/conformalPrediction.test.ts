/**
 * Conformal prediction wrapper tests.
 */
import { describe, it, expect } from 'vitest';
import { conformalIntervalForConfidence, __test__ } from '../src/services/conformalPrediction';
import type { BrainTelemetryEntry } from '../src/services/brainTelemetryStore';

const { clamp01, impliedLabel, nonConformityScore, bandForWidth, MIN_CALIBRATION, DEFAULT_ALPHA } =
  __test__;

function entry(overrides: Partial<BrainTelemetryEntry> = {}): BrainTelemetryEntry {
  return {
    tsIso: '2026-04-14T12:00:00.000Z',
    tenantId: 'tA',
    entityRef: 'opaque',
    verdict: 'flag',
    confidence: 0.7,
    powerScore: 50,
    brainVerdict: 'flag',
    ensembleUnstable: false,
    typologyIds: [],
    crossCaseFindingCount: 0,
    velocitySeverity: null,
    driftSeverity: 'none',
    requiresHumanReview: false,
    ...overrides,
  };
}

describe('clamp01 + impliedLabel + nonConformityScore', () => {
  it('clamp01 bounds', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.42)).toBe(0.42);
  });
  it('impliedLabel maps verdicts', () => {
    expect(impliedLabel(entry({ verdict: 'pass' }))).toBe(0);
    expect(impliedLabel(entry({ verdict: 'flag' }))).toBe(1);
    expect(impliedLabel(entry({ verdict: 'escalate' }))).toBe(1);
    expect(impliedLabel(entry({ verdict: 'freeze' }))).toBe(1);
  });
  it('nonConformityScore is |label - confidence|', () => {
    expect(nonConformityScore(entry({ verdict: 'pass', confidence: 0.2 }))).toBeCloseTo(0.2, 5);
    expect(nonConformityScore(entry({ verdict: 'flag', confidence: 0.8 }))).toBeCloseTo(0.2, 5);
  });
});

describe('bandForWidth', () => {
  it('exact / narrow / moderate / wide / critical bands', () => {
    expect(bandForWidth(0.01)).toBe('exact');
    expect(bandForWidth(0.05)).toBe('narrow');
    expect(bandForWidth(0.15)).toBe('moderate');
    expect(bandForWidth(0.3)).toBe('wide');
    expect(bandForWidth(0.7)).toBe('critical');
  });
});

describe('conformalIntervalForConfidence', () => {
  it('returns degenerate point interval when calibration < MIN_CALIBRATION', () => {
    const r = conformalIntervalForConfidence(0.7, []);
    expect(r.calibrationSize).toBe(0);
    expect(r.lower).toBe(0.7);
    expect(r.upper).toBe(0.7);
    expect(r.summary).toMatch(/Insufficient calibration/);
  });

  it('produces a non-degenerate interval at MIN_CALIBRATION+', () => {
    const cal: BrainTelemetryEntry[] = [];
    for (let i = 0; i < MIN_CALIBRATION; i++) {
      // Half flag with conf 0.6, half pass with conf 0.4 — non-conformity
      // scores are 0.4 each, so q_hat should land at 0.4.
      cal.push(
        entry({ verdict: i % 2 === 0 ? 'flag' : 'pass', confidence: i % 2 === 0 ? 0.6 : 0.4 })
      );
    }
    const r = conformalIntervalForConfidence(0.7, cal);
    expect(r.calibrationSize).toBe(MIN_CALIBRATION);
    expect(r.qHat).toBeCloseTo(0.4, 3);
    expect(r.lower).toBeCloseTo(0.3, 3);
    expect(r.upper).toBeCloseTo(1, 3);
  });

  it('clamps interval to [0, 1] under extreme q_hat', () => {
    const cal: BrainTelemetryEntry[] = [];
    for (let i = 0; i < 50; i++) {
      cal.push(entry({ verdict: 'flag', confidence: 0 })); // score = 1
    }
    const r = conformalIntervalForConfidence(0.5, cal);
    expect(r.lower).toBeGreaterThanOrEqual(0);
    expect(r.upper).toBeLessThanOrEqual(1);
  });

  it('respects an injected alpha', () => {
    const cal: BrainTelemetryEntry[] = [];
    for (let i = 0; i < 100; i++) {
      cal.push(entry({ verdict: i % 2 === 0 ? 'flag' : 'pass', confidence: 0.5 }));
    }
    const a = conformalIntervalForConfidence(0.5, cal, { alpha: 0.1 });
    const b = conformalIntervalForConfidence(0.5, cal, { alpha: 0.5 });
    // Lower alpha = wider interval (90% coverage > 50% coverage).
    expect(a.qHat).toBeGreaterThanOrEqual(b.qHat);
  });

  it('default alpha is 0.1 (90% coverage)', () => {
    expect(DEFAULT_ALPHA).toBe(0.1);
  });

  it('regulatory anchor cites EU AI Act Art.15 + NIST AI RMF', () => {
    const cal = Array.from({ length: 30 }, () => entry());
    const r = conformalIntervalForConfidence(0.5, cal);
    expect(r.regulatory).toMatch(/EU AI Act Art\.15/);
    expect(r.regulatory).toMatch(/NIST AI RMF/);
  });

  it('deterministic — same input produces same interval', () => {
    const cal = Array.from({ length: 30 }, (_, i) =>
      entry({ verdict: i % 3 === 0 ? 'pass' : 'flag', confidence: 0.5 + (i % 5) * 0.05 })
    );
    const a = conformalIntervalForConfidence(0.6, cal);
    const b = conformalIntervalForConfidence(0.6, cal);
    expect(a).toEqual(b);
  });

  it('summary labels the interval as conformal_split with coverage target', () => {
    const cal = Array.from({ length: 30 }, () => entry());
    const r = conformalIntervalForConfidence(0.5, cal);
    expect(r.kind).toBe('conformal_split');
    expect(r.summary).toMatch(/exchangeability/i);
  });
});
