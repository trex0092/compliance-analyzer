/**
 * Uncertainty interval tests.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveUncertaintyInterval,
  impliedConfidenceFromVote,
  __test__,
} from '../src/services/uncertaintyInterval';
import type { EnsembleReport, EnsembleVote } from '../src/services/brainConsensusEnsemble';
import type { StrFeatures } from '../src/services/predictiveStr';

const { clamp01, mean, stddev, bandForWidth, SEVERITY_ANCHOR } = __test__;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function feat(overrides: Partial<StrFeatures> = {}): StrFeatures {
  return {
    priorAlerts90d: 0,
    txValue30dAED: 10_000,
    nearThresholdCount30d: 0,
    crossBorderRatio30d: 0,
    isPep: false,
    highRiskJurisdiction: false,
    hasAdverseMedia: false,
    daysSinceOnboarding: 365,
    sanctionsMatchScore: 0,
    cashRatio30d: 0,
    ...overrides,
  };
}

function vote(
  severity: EnsembleVote['topSeverity'],
  matchCount: number,
  topTypologyId: string | null = 'tm-1',
  runIndex = 0
): EnsembleVote {
  return {
    runIndex,
    features: feat(),
    topTypologyId,
    topSeverity: severity,
    matchCount,
  };
}

function report(votes: EnsembleVote[], overrides: Partial<EnsembleReport> = {}): EnsembleReport {
  // Agreement defaults to 1 (all votes for the majority typology).
  return {
    runs: votes.length,
    meanMatchCount: votes.reduce((a, v) => a + v.matchCount, 0) / (votes.length || 1),
    majorityTypologyId: votes[0]?.topTypologyId ?? null,
    majorityVoteCount: votes.length,
    agreement: 1,
    unstable: false,
    majoritySeverity: votes[0]?.topSeverity ?? 'none',
    votes,
    summary: 'test',
    regulatory: 'FATF Rec 20',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// clamp01 / mean / stddev / bandForWidth
// ---------------------------------------------------------------------------

describe('clamp01', () => {
  it('clamps below zero to 0', () => expect(clamp01(-0.2)).toBe(0));
  it('clamps above one to 1', () => expect(clamp01(1.8)).toBe(1));
  it('passes through [0,1] unchanged', () => expect(clamp01(0.42)).toBe(0.42));
  it('handles NaN + Infinity', () => {
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(0);
  });
});

describe('mean', () => {
  it('returns 0 for empty', () => expect(mean([])).toBe(0));
  it('averages correctly', () => expect(mean([1, 2, 3])).toBe(2));
});

describe('stddev', () => {
  it('returns 0 for empty', () => expect(stddev([], 0)).toBe(0));
  it('returns 0 for constant array', () => expect(stddev([5, 5, 5], 5)).toBe(0));
  it('computes positive stddev for varied data', () => {
    const mu = mean([1, 2, 3]);
    expect(stddev([1, 2, 3], mu)).toBeGreaterThan(0);
  });
});

describe('bandForWidth', () => {
  it('tiny width is point', () => expect(bandForWidth(0.01)).toBe('point'));
  it('small is narrow', () => expect(bandForWidth(0.05)).toBe('narrow'));
  it('medium is moderate', () => expect(bandForWidth(0.15)).toBe('moderate'));
  it('large is wide', () => expect(bandForWidth(0.3)).toBe('wide'));
  it('huge is critical', () => expect(bandForWidth(0.8)).toBe('critical'));
});

// ---------------------------------------------------------------------------
// impliedConfidenceFromVote
// ---------------------------------------------------------------------------

describe('impliedConfidenceFromVote', () => {
  it('uses the severity anchor for zero matches', () => {
    expect(impliedConfidenceFromVote(vote('none', 0))).toBe(SEVERITY_ANCHOR.none);
    expect(impliedConfidenceFromVote(vote('high', 0))).toBe(SEVERITY_ANCHOR.high);
  });
  it('adds a small match-count bonus capped at 0.05', () => {
    const v = impliedConfidenceFromVote(vote('low', 3));
    // anchor + min(0.05, 0.01 * 3) = 0.35 + 0.03 = 0.38
    expect(v).toBeCloseTo(0.38, 5);
  });
  it('saturates the bonus at 0.05 regardless of match count', () => {
    const v = impliedConfidenceFromVote(vote('low', 99));
    // anchor + 0.05 = 0.40
    expect(v).toBeCloseTo(0.4, 5);
  });
  it('keeps the result clamped to [0, 1]', () => {
    const v = impliedConfidenceFromVote(vote('critical', 99));
    expect(v).toBeLessThanOrEqual(1);
  });
  it('severity ladder is monotone', () => {
    const ladder: Array<EnsembleVote['topSeverity']> = [
      'none',
      'low',
      'medium',
      'high',
      'critical',
    ];
    const vs = ladder.map((s) => impliedConfidenceFromVote(vote(s, 0)));
    for (let i = 1; i < vs.length; i++) {
      expect(vs[i]).toBeGreaterThanOrEqual(vs[i - 1]!);
    }
  });
});

// ---------------------------------------------------------------------------
// deriveUncertaintyInterval
// ---------------------------------------------------------------------------

describe('deriveUncertaintyInterval', () => {
  it('returns a point interval when no ensemble votes exist', () => {
    const r = report([]);
    const iv = deriveUncertaintyInterval(r, 0.7);
    expect(iv.kind).toBe('variance_interval');
    expect(iv.pointEstimate).toBe(0.7);
    expect(iv.lower).toBe(0.7);
    expect(iv.upper).toBe(0.7);
    expect(iv.width).toBe(0);
    expect(iv.sampleSize).toBe(0);
    expect(iv.coverage).toBe('point');
  });

  it('unanimous runs produce a narrow interval', () => {
    const votes = [
      vote('high', 2, 'tm-1', 0),
      vote('high', 2, 'tm-1', 1),
      vote('high', 2, 'tm-1', 2),
    ];
    const r = report(votes, { agreement: 1 });
    const iv = deriveUncertaintyInterval(r, 0.8);
    expect(iv.stddev).toBe(0);
    expect(iv.width).toBeLessThanOrEqual(0.02);
    expect(iv.coverage).toBe('point');
  });

  it('disagreement widens the interval proportionally', () => {
    const votesA = [
      vote('medium', 1, 'tm-1', 0),
      vote('medium', 1, 'tm-1', 1),
      vote('medium', 1, 'tm-1', 2),
    ];
    const agree = deriveUncertaintyInterval(report(votesA, { agreement: 1 }), 0.6);

    const votesB = [
      vote('medium', 1, 'tm-1', 0),
      vote('medium', 1, 'tm-2', 1),
      vote('medium', 1, 'tm-3', 2),
    ];
    const disagree = deriveUncertaintyInterval(report(votesB, { agreement: 1 / 3 }), 0.6);
    expect(disagree.width).toBeGreaterThan(agree.width);
  });

  it('varied severities produce a wider interval than identical ones', () => {
    const identical = [
      vote('medium', 1, 'tm-1', 0),
      vote('medium', 1, 'tm-1', 1),
      vote('medium', 1, 'tm-1', 2),
    ];
    const varied = [
      vote('low', 1, 'tm-1', 0),
      vote('medium', 1, 'tm-1', 1),
      vote('critical', 1, 'tm-1', 2),
    ];
    const a = deriveUncertaintyInterval(report(identical), 0.6);
    const b = deriveUncertaintyInterval(report(varied), 0.6);
    expect(b.stddev).toBeGreaterThan(a.stddev);
    expect(b.width).toBeGreaterThan(a.width);
  });

  it('interval is clamped to [0, 1] even with extreme disagreement', () => {
    const votes = [
      vote('none', 0, 'a', 0),
      vote('critical', 10, 'b', 1),
      vote('none', 0, 'c', 2),
      vote('critical', 10, 'd', 3),
    ];
    const iv = deriveUncertaintyInterval(report(votes, { agreement: 0.25 }), 0.99);
    expect(iv.lower).toBeGreaterThanOrEqual(0);
    expect(iv.upper).toBeLessThanOrEqual(1);
  });

  it('summary labels the interval as variance_interval and warns against overclaiming', () => {
    const r = report([vote('medium', 1)]);
    const iv = deriveUncertaintyInterval(r, 0.5);
    expect(iv.summary).toMatch(/variance/i);
    expect(iv.summary).toMatch(/not a bayesian/i);
  });

  it('carries the regulatory citation anchor', () => {
    const r = report([vote('low', 1)]);
    const iv = deriveUncertaintyInterval(r, 0.4);
    expect(iv.regulatory).toMatch(/NIST AI RMF/);
    expect(iv.regulatory).toMatch(/FATF Rec 20/);
  });

  it('deterministic — same input produces same interval', () => {
    const votes = [
      vote('medium', 1, 'tm-1', 0),
      vote('medium', 2, 'tm-2', 1),
      vote('high', 1, 'tm-1', 2),
    ];
    const r = report(votes, { agreement: 2 / 3 });
    const a = deriveUncertaintyInterval(r, 0.65);
    const b = deriveUncertaintyInterval(r, 0.65);
    expect(a).toEqual(b);
  });
});
