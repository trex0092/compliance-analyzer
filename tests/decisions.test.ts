import { describe, it, expect } from "vitest";
import { decideCase, DecisionInput } from "../src/risk/decisions";

function makeInput(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    sanctionMatch: false,
    pepMatch: false,
    redFlagScores: [],
    highFlagCount: 0,
    criticalFlagCount: 0,
    missingCDD: false,
    thirdPartyPayment: false,
    sourceOfFundsUnverified: false,
    ...overrides,
  };
}

describe("decideCase", () => {
  it("returns low risk for clean input", () => {
    const result = decideCase(makeInput());
    expect(result.riskLevel).toBe("low");
    expect(result.recommendedOutcome).toBe("continue");
    expect(result.mandatoryActions).toContain("log-only");
  });

  it("returns freeze for sanctions match", () => {
    const result = decideCase(makeInput({ sanctionMatch: true }));
    expect(result.riskLevel).toBe("critical");
    expect(result.recommendedOutcome).toBe("freeze");
    expect(result.mandatoryActions).toContain("freeze");
    expect(result.mandatoryActions).toContain("str-review");
    expect(result.totalScore).toBeGreaterThanOrEqual(25);
  });

  it("returns str-review for critical flags", () => {
    const result = decideCase(makeInput({ criticalFlagCount: 1, redFlagScores: [12] }));
    expect(result.riskLevel).toBe("critical");
    expect(result.recommendedOutcome).toBe("str-review");
  });

  it("returns str-review for unverified source of funds", () => {
    const result = decideCase(makeInput({ sourceOfFundsUnverified: true }));
    expect(result.recommendedOutcome).toBe("str-review");
  });

  it("returns edd for PEP match", () => {
    const result = decideCase(makeInput({ pepMatch: true }));
    expect(result.recommendedOutcome).toBe("edd");
    expect(result.mandatoryActions).toContain("edd");
    expect(result.mandatoryActions).toContain("management-approval");
  });

  it("returns edd for missing CDD", () => {
    const result = decideCase(makeInput({ missingCDD: true }));
    expect(result.recommendedOutcome).toBe("edd");
  });

  it("returns edd for 2+ high flag counts", () => {
    const result = decideCase(
      makeInput({ highFlagCount: 2, redFlagScores: [8, 9] })
    );
    expect(result.recommendedOutcome).toBe("edd");
  });

  it("continues with analyst review for moderate scores", () => {
    const result = decideCase(makeInput({ redFlagScores: [3, 4] }));
    expect(result.recommendedOutcome).toBe("continue");
    expect(result.mandatoryActions).toContain("analyst-review");
  });

  it("continues with analyst review for third-party payment", () => {
    const result = decideCase(makeInput({ thirdPartyPayment: true }));
    expect(result.recommendedOutcome).toBe("continue");
    expect(result.mandatoryActions).toContain("analyst-review");
  });

  it("calculates totalScore as sum of redFlagScores", () => {
    const result = decideCase(makeInput({ redFlagScores: [5, 3, 2] }));
    expect(result.totalScore).toBe(10);
  });
});
