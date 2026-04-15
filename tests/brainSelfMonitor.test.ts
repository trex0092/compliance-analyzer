/**
 * Brain Self-Monitor tests.
 */
import { describe, it, expect } from 'vitest';

import {
  detectVerdictDrift,
  ksDistance,
  DEFAULT_KS_THRESHOLD,
  MIN_SAMPLES,
  __test__,
} from '../src/services/brainSelfMonitor';

const { severityForKs } = __test__;

const baseline = { pass: 90, flag: 6, escalate: 3, freeze: 1 };

describe('ksDistance', () => {
  it('is 0 for identical distributions', () => {
    expect(ksDistance(baseline, baseline)).toBe(0);
  });

  it('is positive for shifted distributions', () => {
    const shifted = { pass: 70, flag: 20, escalate: 8, freeze: 2 };
    expect(ksDistance(baseline, shifted)).toBeGreaterThan(0);
  });
});

describe('detectVerdictDrift', () => {
  it('reports stable when distributions match', () => {
    const r = detectVerdictDrift(baseline, baseline);
    expect(r.status).toBe('stable');
    expect(r.ksStatistic).toBe(0);
    expect(r.severity).toBe('none');
  });

  it('reports drift_detected when KS exceeds threshold', () => {
    const shifted = { pass: 40, flag: 30, escalate: 20, freeze: 10 };
    const r = detectVerdictDrift(baseline, shifted);
    expect(r.status).toBe('drift_detected');
    expect(r.ksStatistic).toBeGreaterThan(DEFAULT_KS_THRESHOLD);
  });

  it('reports insufficient_data when sample size is below MIN_SAMPLES', () => {
    const small = { pass: 5, flag: 2, escalate: 1, freeze: 0 };
    const r = detectVerdictDrift(small, small);
    expect(r.status).toBe('insufficient_data');
    expect(r.baselineSampleSize).toBeLessThan(MIN_SAMPLES);
  });

  it('per-verdict delta sums to ~0', () => {
    const shifted = { pass: 60, flag: 20, escalate: 15, freeze: 5 };
    const r = detectVerdictDrift(baseline, shifted);
    const sum =
      r.perVerdictDelta.pass +
      r.perVerdictDelta.flag +
      r.perVerdictDelta.escalate +
      r.perVerdictDelta.freeze;
    expect(Math.abs(sum)).toBeLessThan(1e-9);
  });

  it('respects custom ksThreshold override', () => {
    const slightlyShifted = { pass: 80, flag: 12, escalate: 6, freeze: 2 };
    const r = detectVerdictDrift(baseline, slightlyShifted, { ksThreshold: 0.5 });
    expect(r.status).toBe('stable');
  });

  it('carries the regulatory anchors', () => {
    const r = detectVerdictDrift(baseline, baseline);
    expect(r.regulatory).toContain('NIST AI RMF 1.0 MEASURE-4');
    expect(r.regulatory).toContain('NIST AI RMF 1.0 MANAGE-3');
    expect(r.regulatory).toContain('EU AI Act Art.15');
  });
});

describe('severityForKs', () => {
  it('bands cleanly', () => {
    expect(severityForKs(0.45)).toBe('critical');
    expect(severityForKs(0.32)).toBe('high');
    expect(severityForKs(0.22)).toBe('medium');
    expect(severityForKs(0.12)).toBe('low');
    expect(severityForKs(0.05)).toBe('none');
  });
});
