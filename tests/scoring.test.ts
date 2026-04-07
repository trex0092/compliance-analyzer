import { describe, it, expect } from "vitest";
import { calcFlagScore, applyContextMultiplier, scoreToLevel } from "../src/risk/scoring";

describe("calcFlagScore", () => {
  it("multiplies likelihood by impact", () => {
    expect(calcFlagScore({ likelihood: 3, impact: 4 } as any)).toBe(12);
  });

  it("returns 1 for minimum values", () => {
    expect(calcFlagScore({ likelihood: 1, impact: 1 } as any)).toBe(1);
  });

  it("returns 25 for maximum values", () => {
    expect(calcFlagScore({ likelihood: 5, impact: 5 } as any)).toBe(25);
  });
});

describe("applyContextMultiplier", () => {
  it("returns base score with no context", () => {
    expect(applyContextMultiplier(10, {})).toBe(10);
  });

  it("applies high-risk jurisdiction multiplier", () => {
    expect(applyContextMultiplier(10, { highRiskJurisdiction: true })).toBe(15);
  });

  it("applies PEP multiplier", () => {
    expect(applyContextMultiplier(10, { pep: true })).toBe(15);
  });

  it("stacks multiple context factors", () => {
    expect(
      applyContextMultiplier(10, {
        highRiskJurisdiction: true,
        pep: true,
        cash: true,
        sanctionsProximity: true,
      })
    ).toBe(35); // 10 * (1 + 0.5 + 0.5 + 0.5 + 1.0)
  });

  it("rounds the result", () => {
    expect(applyContextMultiplier(7, { repeatAlert: true })).toBe(11); // 7 * 1.5 = 10.5 -> 11
  });
});

describe("scoreToLevel", () => {
  it("returns low for scores below 6", () => {
    expect(scoreToLevel(0)).toBe("low");
    expect(scoreToLevel(5)).toBe("low");
  });

  it("returns medium for scores 6-10", () => {
    expect(scoreToLevel(6)).toBe("medium");
    expect(scoreToLevel(10)).toBe("medium");
  });

  it("returns high for scores 11-15", () => {
    expect(scoreToLevel(11)).toBe("high");
    expect(scoreToLevel(15)).toBe("high");
  });

  it("returns critical for scores >= 16", () => {
    expect(scoreToLevel(16)).toBe("critical");
    expect(scoreToLevel(25)).toBe("critical");
  });
});
