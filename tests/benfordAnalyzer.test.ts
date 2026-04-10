import { describe, it, expect } from 'vitest';
import {
  analyseBenford,
  BENFORD_EXPECTED,
  benfordToBrainEvent,
} from '@/services/benfordAnalyzer';

// Generate numbers that follow Benford's Law by construction.
// Classic trick: exponentiate a uniform random variable — the resulting
// mantissa first digits follow Benford's Law exactly in the limit.
function generateBenfordSample(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 6; // [0, 6) orders of magnitude
    out.push(10 ** u);
  }
  return out;
}

describe('benfordAnalyzer — expected distribution', () => {
  it('BENFORD_EXPECTED frequencies sum to 1', () => {
    const total = Object.values(BENFORD_EXPECTED).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('leading digit 1 is ~30.1%', () => {
    expect(BENFORD_EXPECTED[1]).toBeCloseTo(0.301, 2);
  });

  it('leading digit 9 is ~4.6%', () => {
    expect(BENFORD_EXPECTED[9]).toBeCloseTo(0.046, 2);
  });
});

describe('benfordAnalyzer — conformity detection', () => {
  it('a Benford-distributed sample conforms', () => {
    const sample = generateBenfordSample(5000);
    const report = analyseBenford(sample);
    expect(['close-conformity', 'acceptable']).toContain(report.verdict);
  });

  it('a uniform sample does NOT conform', () => {
    const sample = Array.from({ length: 2000 }, (_, i) => 1000 + i);
    const report = analyseBenford(sample);
    expect(['marginal', 'non-conformity']).toContain(report.verdict);
  });

  it('a single-digit-heavy sample is non-conforming', () => {
    const sample = Array.from({ length: 1000 }, () => 50_000 + Math.floor(Math.random() * 5000));
    const report = analyseBenford(sample);
    expect(report.verdict).toBe('non-conformity');
    expect(report.suspiciousDigits.length).toBeGreaterThan(0);
    expect(report.suspiciousDigits[0].digit).toBe(5);
    expect(report.suspiciousDigits[0].direction).toBe('over');
  });
});

describe('benfordAnalyzer — edge cases', () => {
  it('ignores zeros and negatives leading digit', () => {
    const report = analyseBenford([0, 0, -100, 0.0001, 1000]);
    expect(report.sampleSize).toBe(3);
  });

  it('empty input returns zero sample', () => {
    const report = analyseBenford([]);
    expect(report.sampleSize).toBe(0);
    expect(report.chiSquare).toBe(0);
  });
});

describe('benfordAnalyzer — brain event mapping', () => {
  it('close-conformity yields null (no incident)', () => {
    const sample = generateBenfordSample(5000);
    const report = analyseBenford(sample);
    if (report.verdict === 'close-conformity' || report.verdict === 'acceptable') {
      expect(benfordToBrainEvent(report, 'CASE-1')).toBeNull();
    }
  });

  it('non-conformity yields an evidence_break event', () => {
    const sample = Array.from({ length: 500 }, () => 50_000 + Math.floor(Math.random() * 5000));
    const report = analyseBenford(sample);
    const event = benfordToBrainEvent(report, 'CASE-2');
    expect(event).not.toBeNull();
    expect(event!.kind).toBe('evidence_break');
    expect(event!.refId).toBe('CASE-2');
  });
});
