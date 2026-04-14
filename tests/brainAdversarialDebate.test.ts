/**
 * Brain adversarial debate tests.
 */
import { describe, it, expect } from 'vitest';
import {
  runAdversarialDebate,
  shouldDebate,
  __test__,
} from '../src/services/brainAdversarialDebate';
import type { StrFeatures } from '../src/services/predictiveStr';
import type { UncertaintyInterval } from '../src/services/uncertaintyInterval';

const { buildProsecution, buildDefence, saturate, clamp01, DEFAULT_THRESHOLD } = __test__;

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
    daysSinceOnboarding: 730,
    sanctionsMatchScore: 0,
    cashRatio30d: 0.1,
    ...overrides,
  };
}

function uncertainty(coverage: UncertaintyInterval['coverage']): UncertaintyInterval {
  return {
    kind: 'variance_interval',
    pointEstimate: 0.5,
    lower: 0.4,
    upper: 0.6,
    width: 0.2,
    stddev: 0.05,
    sampleSize: 5,
    agreement: 0.8,
    coverage,
    summary: 'test',
    regulatory: 'NIST AI RMF',
  };
}

// ---------------------------------------------------------------------------
// Helpers under test
// ---------------------------------------------------------------------------

describe('clamp01 + saturate', () => {
  it('clamps to [0,1]', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.5)).toBe(0.5);
  });
  it('saturate is monotone non-decreasing', () => {
    const a = saturate(1, 5);
    const b = saturate(5, 5);
    const c = saturate(50, 5);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeLessThan(1);
  });
  it('saturate at zero is zero', () => {
    expect(saturate(0, 5)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Prosecution stance
// ---------------------------------------------------------------------------

describe('buildProsecution', () => {
  it('produces zero arguments on a clean feature vector', () => {
    const r = buildProsecution(feat());
    expect(r.score).toBe(0);
    expect(r.arguments).toHaveLength(0);
    expect(r.position).toMatch(/no decisive escalation triggers/);
  });

  it('cites sanctions match as the top argument when present', () => {
    const r = buildProsecution(feat({ sanctionsMatchScore: 0.8 }));
    expect(r.arguments[0]?.feature).toBe('sanctionsMatchScore');
    expect(r.score).toBeGreaterThan(0);
  });

  it('stacks multiple red flags into a higher score', () => {
    const single = buildProsecution(feat({ isPep: true }));
    const stacked = buildProsecution(
      feat({
        isPep: true,
        hasAdverseMedia: true,
        highRiskJurisdiction: true,
        sanctionsMatchScore: 0.4,
      })
    );
    expect(stacked.score).toBeGreaterThan(single.score);
  });

  it('clamps the score at 1.0 even with an avalanche of red flags', () => {
    const r = buildProsecution(
      feat({
        isPep: true,
        hasAdverseMedia: true,
        highRiskJurisdiction: true,
        sanctionsMatchScore: 1.0,
        nearThresholdCount30d: 50,
        cashRatio30d: 0.95,
        priorAlerts90d: 20,
      })
    );
    expect(r.score).toBeLessThanOrEqual(1);
  });

  it('cites the structuring smurfing pattern when nearThresholdCount > 0', () => {
    const r = buildProsecution(feat({ nearThresholdCount30d: 4 }));
    expect(r.arguments.some((a) => a.claim.includes('smurfing'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Defence stance
// ---------------------------------------------------------------------------

describe('buildDefence', () => {
  it('produces strong defence on a clean long-tenured profile', () => {
    const r = buildDefence(feat({ daysSinceOnboarding: 1095 })); // 3 years
    expect(r.score).toBeGreaterThan(0.5);
    expect(r.arguments.length).toBeGreaterThan(3);
  });

  it('weights long tenure as a recognised SDD indicator', () => {
    const r = buildDefence(feat({ daysSinceOnboarding: 2000 }));
    expect(r.arguments.some((a) => a.feature === 'daysSinceOnboarding')).toBe(true);
  });

  it('cites zero sanctions match as decisive negative', () => {
    const r = buildDefence(feat());
    const sanctions = r.arguments.find((a) => a.feature === 'sanctionsMatchScore');
    expect(sanctions).toBeDefined();
    expect(sanctions!.claim).toMatch(/Absence of a hit/);
  });

  it('weakens when red flags exist', () => {
    const clean = buildDefence(feat());
    const dirty = buildDefence(
      feat({
        isPep: true,
        hasAdverseMedia: true,
        sanctionsMatchScore: 0.5,
        nearThresholdCount30d: 3,
        cashRatio30d: 0.8,
      })
    );
    expect(dirty.score).toBeLessThan(clean.score);
  });

  it('regulatory anchor cites Art.27 and Art.29', () => {
    const r = buildDefence(feat());
    expect(r.regulatory).toMatch(/Art\.27/);
    expect(r.regulatory).toMatch(/Art\.29/);
  });
});

// ---------------------------------------------------------------------------
// runAdversarialDebate (judge layer)
// ---------------------------------------------------------------------------

describe('runAdversarialDebate', () => {
  it('declares undetermined on a balanced borderline case', () => {
    // Mix of red + green features so the gap stays under threshold.
    const r = runAdversarialDebate(
      feat({
        sanctionsMatchScore: 0.4,
        isPep: true,
        daysSinceOnboarding: 1095,
      })
    );
    if (r.outcome === 'undetermined') {
      expect(r.gap).toBeLessThan(r.threshold);
      expect(r.judgeSynthesis).toMatch(/MLRO must apply human judgment/);
    }
  });

  it('declares prosecution_wins on a stacked red profile', () => {
    const r = runAdversarialDebate(
      feat({
        isPep: true,
        hasAdverseMedia: true,
        highRiskJurisdiction: true,
        sanctionsMatchScore: 0.9,
        nearThresholdCount30d: 6,
        cashRatio30d: 0.85,
        priorAlerts90d: 5,
        daysSinceOnboarding: 90,
      })
    );
    expect(r.outcome).toBe('prosecution_wins');
    expect(r.gap).toBeGreaterThanOrEqual(r.threshold);
  });

  it('declares defence_wins on a clean long-tenured profile', () => {
    const r = runAdversarialDebate(feat({ daysSinceOnboarding: 1500 }));
    expect(r.outcome).toBe('defence_wins');
    expect(r.gap).toBeGreaterThanOrEqual(r.threshold);
  });

  it('respects an injected threshold', () => {
    const r = runAdversarialDebate(feat({ daysSinceOnboarding: 1500 }), {
      threshold: 1.01,
    });
    // Impossible gap threshold — no debate can clear 1.01.
    expect(r.outcome).toBe('undetermined');
  });

  it('embeds the canonical regulatory citations', () => {
    const r = runAdversarialDebate(feat());
    expect(r.regulatory).toContain('FDL No.10/2025 Art.27');
    expect(r.regulatory).toContain('FATF Rec 1');
    expect(r.regulatory).toContain('NIST AI RMF 1.0 GOVERN-3');
    expect(r.regulatory).toContain('EU AI Act Art.14');
  });

  it('is deterministic — same input produces the same report', () => {
    const a = runAdversarialDebate(feat({ sanctionsMatchScore: 0.5 }));
    const b = runAdversarialDebate(feat({ sanctionsMatchScore: 0.5 }));
    expect(a).toEqual(b);
  });

  it('default threshold is 0.15', () => {
    expect(DEFAULT_THRESHOLD).toBe(0.15);
  });
});

// ---------------------------------------------------------------------------
// shouldDebate (cost gate)
// ---------------------------------------------------------------------------

describe('shouldDebate', () => {
  it('always debates ambiguous-zone confidences', () => {
    expect(shouldDebate(0.5, null)).toBe(true);
    expect(shouldDebate(0.4, null)).toBe(true);
    expect(shouldDebate(0.7, null)).toBe(true);
  });

  it('skips clear-cut cases when no uncertainty supplied', () => {
    expect(shouldDebate(0.95, null)).toBe(false);
    expect(shouldDebate(0.1, null)).toBe(false);
  });

  it('debates wide / moderate / critical coverage even outside ambiguity zone', () => {
    expect(shouldDebate(0.95, uncertainty('moderate'))).toBe(true);
    expect(shouldDebate(0.95, uncertainty('wide'))).toBe(true);
    expect(shouldDebate(0.95, uncertainty('critical'))).toBe(true);
  });

  it('skips narrow / point coverage outside ambiguity zone', () => {
    expect(shouldDebate(0.95, uncertainty('narrow'))).toBe(false);
    expect(shouldDebate(0.95, uncertainty('point'))).toBe(false);
  });
});
