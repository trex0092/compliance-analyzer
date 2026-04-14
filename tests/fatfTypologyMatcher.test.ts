/**
 * FATF DPMS Typology Matcher tests.
 *
 * Covers:
 *   - Clean input → no matches
 *   - Each high-value typology fires on its intended signature
 *   - Required signals gate the match (e.g. a PEP typology cannot
 *     fire without isPep, regardless of other signals)
 *   - Sorting by score desc
 *   - topSeverity reflects the most severe match
 *   - Library size (25+ typologies)
 *   - Each typology carries a non-empty regulatory citation
 */
import { describe, it, expect } from "vitest";
import {
  matchFatfTypologies,
  FATF_TYPOLOGIES,
} from "../src/services/fatfTypologyMatcher";
import type { StrFeatures } from "../src/services/predictiveStr";

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

// ---------------------------------------------------------------------------
// Library integrity
// ---------------------------------------------------------------------------

describe("FATF_TYPOLOGIES library", () => {
  it("contains at least 25 typologies", () => {
    expect(FATF_TYPOLOGIES.length).toBeGreaterThanOrEqual(25);
  });

  it("every typology has a non-empty regulatory citation", () => {
    for (const t of FATF_TYPOLOGIES) {
      expect(t.regulatory.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.id.length).toBeGreaterThan(0);
      expect(t.signals.length).toBeGreaterThan(0);
      expect(t.threshold).toBeGreaterThan(0);
      expect(t.threshold).toBeLessThanOrEqual(1);
    }
  });

  it("every typology has at least one required signal", () => {
    for (const t of FATF_TYPOLOGIES) {
      expect(t.signals.some((s) => s.required)).toBe(true);
    }
  });

  it("has no duplicate typology ids", () => {
    const ids = FATF_TYPOLOGIES.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// Clean case
// ---------------------------------------------------------------------------

describe("matchFatfTypologies — clean case", () => {
  it("produces no matches for a clean feature vector", () => {
    const report = matchFatfTypologies(f());
    expect(report.matches).toHaveLength(0);
    expect(report.topSeverity).toBe("none");
    expect(report.summary).toMatch(/No FATF typologies matched/);
  });
});

// ---------------------------------------------------------------------------
// Individual typology activation
// ---------------------------------------------------------------------------

describe("matchFatfTypologies — structuring / smurfing", () => {
  it("fires STRUCT-001 on 3+ near-threshold cash-heavy transactions", () => {
    const report = matchFatfTypologies(
      f({ nearThresholdCount30d: 4, cashRatio30d: 0.7 })
    );
    expect(report.matches.some((m) => m.typology.id === "STRUCT-001")).toBe(
      true
    );
  });

  it("does NOT fire STRUCT-001 without near-threshold count", () => {
    const report = matchFatfTypologies(f({ cashRatio30d: 0.9 }));
    expect(report.matches.some((m) => m.typology.id === "STRUCT-001")).toBe(
      false
    );
  });
});

describe("matchFatfTypologies — sanctions proximity", () => {
  it("fires SANCTIONS-001 at matchScore >= 0.5", () => {
    const report = matchFatfTypologies(f({ sanctionsMatchScore: 0.6 }));
    expect(report.matches.some((m) => m.typology.id === "SANCTIONS-001")).toBe(
      true
    );
  });

  it("also fires SANCTIONS-002 at matchScore >= 0.9", () => {
    const report = matchFatfTypologies(f({ sanctionsMatchScore: 0.95 }));
    const ids = report.matches.map((m) => m.typology.id);
    expect(ids).toContain("SANCTIONS-001");
    expect(ids).toContain("SANCTIONS-002");
  });

  it("the critical severity surfaces in topSeverity", () => {
    const report = matchFatfTypologies(f({ sanctionsMatchScore: 0.95 }));
    expect(report.topSeverity).toBe("critical");
  });
});

describe("matchFatfTypologies — PEP typologies", () => {
  it("fires PEP-001 on PEP onboarding within 90 days", () => {
    const report = matchFatfTypologies(
      f({ isPep: true, daysSinceOnboarding: 30 })
    );
    expect(report.matches.some((m) => m.typology.id === "PEP-001")).toBe(true);
  });

  it("fires PEP-002 on PEP + cash-heavy", () => {
    const report = matchFatfTypologies(
      f({ isPep: true, cashRatio30d: 0.7 })
    );
    expect(report.matches.some((m) => m.typology.id === "PEP-002")).toBe(true);
  });

  it("does NOT fire PEP-001 without isPep (required signal)", () => {
    const report = matchFatfTypologies(f({ daysSinceOnboarding: 10 }));
    expect(report.matches.some((m) => m.typology.id === "PEP-001")).toBe(
      false
    );
  });
});

describe("matchFatfTypologies — DPMS typologies", () => {
  it("fires DPMS-001 on high-value cash gold by new customer", () => {
    const report = matchFatfTypologies(
      f({ cashRatio30d: 0.8, txValue30dAED: 200_000, daysSinceOnboarding: 10 })
    );
    expect(report.matches.some((m) => m.typology.id === "DPMS-001")).toBe(
      true
    );
  });
});

describe("matchFatfTypologies — trade-based ML", () => {
  it("fires TBML-001 on cross-border + large tx + high-risk jurisdiction", () => {
    const report = matchFatfTypologies(
      f({
        crossBorderRatio30d: 0.8,
        txValue30dAED: 500_000,
        highRiskJurisdiction: true,
      })
    );
    expect(report.matches.some((m) => m.typology.id === "TBML-001")).toBe(
      true
    );
  });
});

describe("matchFatfTypologies — PF + dual-use", () => {
  it("fires PF-001 on high-risk jurisdiction + large tx + cross-border heavy", () => {
    const report = matchFatfTypologies(
      f({
        highRiskJurisdiction: true,
        txValue30dAED: 800_000,
        crossBorderRatio30d: 0.7,
      })
    );
    expect(report.matches.some((m) => m.typology.id === "PF-001")).toBe(true);
    // PF-001 severity is critical; topSeverity must lift to critical.
    expect(report.topSeverity).toBe("critical");
  });
});

describe("matchFatfTypologies — sorting", () => {
  it("returns matches sorted by score desc", () => {
    const report = matchFatfTypologies(
      f({
        sanctionsMatchScore: 0.95,
        nearThresholdCount30d: 4,
        cashRatio30d: 0.7,
        isPep: true,
      })
    );
    expect(report.matches.length).toBeGreaterThan(1);
    for (let i = 1; i < report.matches.length; i++) {
      expect(report.matches[i - 1].score).toBeGreaterThanOrEqual(
        report.matches[i].score
      );
    }
  });

  it("summary cites the leading match id", () => {
    const report = matchFatfTypologies(f({ sanctionsMatchScore: 0.95 }));
    expect(report.summary).toMatch(/SANCTIONS-00[12]/);
  });
});

describe("matchFatfTypologies — required-signal gating", () => {
  it("ignores typologies whose required signals don't all fire", () => {
    // DPMS-001 requires BOTH cashRatio >= 0.7 AND txValue >= 100_000.
    // Omit the cash signal — the typology must not fire even with
    // a large transaction and a brand-new relationship.
    const report = matchFatfTypologies(
      f({
        cashRatio30d: 0.1, // below the required 0.7
        txValue30dAED: 500_000,
        daysSinceOnboarding: 5,
      })
    );
    expect(report.matches.some((m) => m.typology.id === "DPMS-001")).toBe(
      false
    );
  });

  it("PF-001 does not fire without high-risk jurisdiction", () => {
    const report = matchFatfTypologies(
      f({
        highRiskJurisdiction: false,
        txValue30dAED: 800_000,
        crossBorderRatio30d: 0.9,
      })
    );
    expect(report.matches.some((m) => m.typology.id === "PF-001")).toBe(false);
  });
});
