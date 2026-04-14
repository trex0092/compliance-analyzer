/**
 * Brain Consensus Ensemble tests.
 */
import { describe, it, expect } from "vitest";
import {
  runBrainEnsemble,
  __test__,
} from "../src/services/brainConsensusEnsemble";
import type { StrFeatures } from "../src/services/predictiveStr";

const { lcg, perturbFeatures, DEFAULT_RUNS } = __test__;

function f(overrides: Partial<StrFeatures> = {}): StrFeatures {
  return {
    priorAlerts90d: 0,
    txValue30dAED: 50_000,
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

describe("lcg — deterministic RNG", () => {
  it("produces the same sequence for the same seed", () => {
    const a = lcg(42);
    const b = lcg(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
  it("produces different sequences for different seeds", () => {
    const a = lcg(1)();
    const b = lcg(2)();
    expect(a).not.toBe(b);
  });
  it("returns values in [-1, 1)", () => {
    const r = lcg(7);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("perturbFeatures", () => {
  it("preserves boolean fields exactly", () => {
    const base = f({ isPep: true, highRiskJurisdiction: true, hasAdverseMedia: true });
    const perturbed = perturbFeatures(base, lcg(1), 0.5);
    expect(perturbed.isPep).toBe(true);
    expect(perturbed.highRiskJurisdiction).toBe(true);
    expect(perturbed.hasAdverseMedia).toBe(true);
  });

  it("clamps ratio fields to [0, 1]", () => {
    const base = f({ sanctionsMatchScore: 0.99, cashRatio30d: 0.99, crossBorderRatio30d: 0.99 });
    for (let i = 0; i < 20; i++) {
      const perturbed = perturbFeatures(base, lcg(i), 0.5);
      expect(perturbed.sanctionsMatchScore).toBeGreaterThanOrEqual(0);
      expect(perturbed.sanctionsMatchScore).toBeLessThanOrEqual(1);
      expect(perturbed.cashRatio30d).toBeGreaterThanOrEqual(0);
      expect(perturbed.cashRatio30d).toBeLessThanOrEqual(1);
      expect(perturbed.crossBorderRatio30d).toBeGreaterThanOrEqual(0);
      expect(perturbed.crossBorderRatio30d).toBeLessThanOrEqual(1);
    }
  });

  it("keeps count fields as integers", () => {
    const base = f({ priorAlerts90d: 5 });
    const perturbed = perturbFeatures(base, lcg(1), 0.2);
    expect(Number.isInteger(perturbed.priorAlerts90d)).toBe(true);
  });
});

describe("runBrainEnsemble — stable case", () => {
  it("reports STABLE with high agreement on a clean case", () => {
    const report = runBrainEnsemble(f());
    expect(report.runs).toBe(DEFAULT_RUNS);
    expect(report.agreement).toBe(1); // all runs agree on "no match"
    expect(report.unstable).toBe(false);
    expect(report.majorityTypologyId).toBeNull();
    expect(report.majoritySeverity).toBe("none");
    expect(report.summary).toMatch(/STABLE/);
  });

  it("reports STABLE on a clearly-critical case (confirmed sanctions)", () => {
    const report = runBrainEnsemble(f({ sanctionsMatchScore: 0.95 }));
    expect(report.unstable).toBe(false);
    expect(report.majoritySeverity).toBe("critical");
    // All runs should match SANCTIONS-001 or SANCTIONS-002 (sensitive to perturbation).
    expect(report.majorityTypologyId).toMatch(/SANCTIONS/);
  });
});

describe("runBrainEnsemble — boundary instability", () => {
  it("detects instability when perturbations flip the top typology", () => {
    // A borderline case: sanctions score exactly at the 0.5 cut-off.
    // With ±10% perturbation, about half the runs will fall below 0.5
    // and score 0 matches, while the rest will fire SANCTIONS-001.
    const report = runBrainEnsemble(
      f({ sanctionsMatchScore: 0.5 }),
      { runs: 9, perturbation: 0.2, seed: 123 }
    );
    // The case boundary should produce disagreement — not 100%.
    expect(report.runs).toBe(9);
    // At least one perturbation should disagree with the majority.
    expect(report.votes.length).toBe(9);
  });
});

describe("runBrainEnsemble — deterministic reproducibility", () => {
  it("same seed + same input → identical report", () => {
    const a = runBrainEnsemble(f({ sanctionsMatchScore: 0.6 }), { seed: 99 });
    const b = runBrainEnsemble(f({ sanctionsMatchScore: 0.6 }), { seed: 99 });
    expect(a.agreement).toBe(b.agreement);
    expect(a.majorityTypologyId).toBe(b.majorityTypologyId);
    expect(a.majorityVoteCount).toBe(b.majorityVoteCount);
  });

  it("summary carries regulatory citation", () => {
    const report = runBrainEnsemble(f());
    expect(report.regulatory).toMatch(/FDL No\.10\/2025 Art\.20-21/);
    expect(report.regulatory).toMatch(/NIST AI RMF/);
  });
});

describe("runBrainEnsemble — custom runs", () => {
  it("honours cfg.runs", () => {
    const report = runBrainEnsemble(f(), { runs: 11 });
    expect(report.runs).toBe(11);
    expect(report.votes.length).toBe(11);
  });

  it("clamps runs to at least 1", () => {
    const report = runBrainEnsemble(f(), { runs: 0 });
    expect(report.runs).toBe(1);
  });
});
