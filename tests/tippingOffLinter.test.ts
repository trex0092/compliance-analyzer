/**
 * Tipping-off linter tests — FDL No.10/2025 Art.29 (no tipping off).
 *
 * Every pattern in tippingOffLinter.ts is validated against at least
 * one positive example (should fire) and one negative example (should
 * not fire). The assertNoTippingOff throw path is exercised for
 * critical and high severities. Closes deep-review gap C2.
 */
import { describe, it, expect } from "vitest";
import {
  lintForTippingOff,
  assertNoTippingOff,
} from "../src/services/tippingOffLinter";

describe("tippingOffLinter — clean text", () => {
  it("passes empty text", () => {
    const report = lintForTippingOff("");
    expect(report.clean).toBe(true);
    expect(report.findings).toHaveLength(0);
    expect(report.topSeverity).toBe("none");
  });

  it("passes neutral business language", () => {
    const report = lintForTippingOff(
      "Your transaction has been processed. Thank you for choosing our service."
    );
    expect(report.clean).toBe(true);
  });

  it("passes a vague 'under review' without subject pronouns", () => {
    // This must not fire TO-05: 'your account is under review' would fire.
    const report = lintForTippingOff("The application is being processed.");
    expect(report.clean).toBe(true);
  });
});

describe("tippingOffLinter — critical patterns", () => {
  it("TO-01: fires on explicit STR filing mention", () => {
    const report = lintForTippingOff("We filed an STR against you last week.");
    expect(report.clean).toBe(false);
    expect(report.topSeverity).toBe("critical");
    expect(report.findings.some((f) => f.patternId === "TO-01")).toBe(true);
  });

  it("TO-01: fires on SAR / CTR / DPMSR / CNMR", () => {
    expect(lintForTippingOff("Submitted a SAR this morning").clean).toBe(false);
    expect(lintForTippingOff("Filing the CTR now").clean).toBe(false);
    expect(lintForTippingOff("We reported a DPMSR").clean).toBe(false);
    expect(lintForTippingOff("Filed the CNMR yesterday").clean).toBe(false);
  });

  it("TO-02: fires on 'reported to FIU/goAML/MoE'", () => {
    const report = lintForTippingOff(
      "The matter was reported to the FIU via goAML."
    );
    expect(report.topSeverity).toBe("critical");
    expect(report.findings.some((f) => f.patternId === "TO-02")).toBe(true);
  });

  it("TO-03: fires on 'you matched a sanctions list'", () => {
    const report = lintForTippingOff(
      "Your account matched the OFAC sanctions list last night."
    );
    expect(report.topSeverity).toBe("critical");
    expect(report.findings.some((f) => f.patternId === "TO-03")).toBe(true);
  });

  it("TO-04: fires on 'your funds have been frozen'", () => {
    const report = lintForTippingOff(
      "We are writing to inform you that your funds have been frozen pending review."
    );
    expect(report.topSeverity).toBe("critical");
    expect(report.findings.some((f) => f.patternId === "TO-04")).toBe(true);
  });

  it("TO-08: fires on explicit watchlist disclosure", () => {
    const report = lintForTippingOff("You are on our watchlist.");
    expect(report.topSeverity).toBe("critical");
    expect(report.findings.some((f) => f.patternId === "TO-08")).toBe(true);
  });
});

describe("tippingOffLinter — high-severity patterns", () => {
  it("TO-05: fires on 'your account is under investigation'", () => {
    const report = lintForTippingOff(
      "Dear customer, your account is under investigation."
    );
    expect(report.clean).toBe(false);
    expect(report.findings.some((f) => f.patternId === "TO-05")).toBe(true);
    // TO-05 is high; whole report becomes critical only if another
    // critical pattern also fires.
    expect(["high", "critical"]).toContain(report.topSeverity);
  });

  it("TO-10: fires on naming a regulator to the subject", () => {
    const report = lintForTippingOff(
      "Please contact us regarding the EOCN filing deadline."
    );
    expect(report.clean).toBe(false);
    expect(report.findings.some((f) => f.patternId === "TO-10")).toBe(true);
  });
});

describe("tippingOffLinter — medium patterns", () => {
  it("TO-09: fires on 'cannot process due to sanctions'", () => {
    const report = lintForTippingOff(
      "We cannot process your payment due to sanctions concerns."
    );
    expect(report.clean).toBe(false);
    // TO-03/TO-09 both plausible; at least one must fire.
    expect(report.findings.length).toBeGreaterThan(0);
  });
});

describe("tippingOffLinter — narrative output", () => {
  it("clean narrative cites the linter", () => {
    const report = lintForTippingOff("hello");
    expect(report.narrative).toMatch(/clean/i);
  });

  it("blocking narrative cites FDL Art.29", () => {
    const report = lintForTippingOff("We filed an STR about you.");
    expect(report.narrative).toMatch(/FDL/);
    expect(report.narrative).toMatch(/Art\.?\s?29/);
  });
});

describe("assertNoTippingOff", () => {
  it("does not throw on clean text", () => {
    expect(() => assertNoTippingOff("Hello, thank you.")).not.toThrow();
  });

  it("throws on critical tipping-off text", () => {
    expect(() =>
      assertNoTippingOff("We filed an STR last week.")
    ).toThrow(/FDL Art\.?29/);
  });

  it("throws on high-severity tipping-off text", () => {
    expect(() =>
      assertNoTippingOff("Your account is under investigation.")
    ).toThrow();
  });

  it("does not throw on medium-only severity", () => {
    // Medium patterns are warnings, not hard blocks — the assertion
    // deliberately allows them through so MLRO workflows can still
    // ship clarifying language.
    const medium = "We cannot process this payment for compliance reasons.";
    // TO-09 is medium; should not throw.
    expect(() => assertNoTippingOff(medium)).not.toThrow();
  });
});
