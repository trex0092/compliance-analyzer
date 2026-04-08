/**
 * Regulatory Constants Guardrails
 *
 * These tests exist to PREVENT accidental changes to legally mandated values.
 * If a test fails, it means someone changed a regulatory constant.
 * Only update these tests when the underlying regulation actually changes.
 */
import { describe, it, expect } from "vitest";
import {
  DPMS_CASH_THRESHOLD_AED,
  CROSS_BORDER_CASH_THRESHOLD_AED,
  USD_TO_AED,
  UBO_OWNERSHIP_THRESHOLD_PCT,
  UBO_REVERIFICATION_WORKING_DAYS,
  STR_FILING_DEADLINE_BUSINESS_DAYS,
  CTR_FILING_DEADLINE_BUSINESS_DAYS,
  EOCN_FREEZE_IMMEDIATELY,
  CNMR_FILING_DEADLINE_BUSINESS_DAYS,
  RECORD_RETENTION_YEARS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  PENALTY_RANGE,
  RISK_THRESHOLDS,
  PF_HIGH_RISK_JURISDICTIONS,
  FATF_GREY_LIST,
  VALUATION_ANOMALY_PCT,
  WEIGHT_DISCREPANCY_PCT,
  CDD_REVIEW_HIGH_RISK_MONTHS,
  CDD_REVIEW_MEDIUM_RISK_MONTHS,
  CDD_REVIEW_LOW_RISK_MONTHS,
  DORMANCY_DAYS,
} from "../src/domain/constants";

describe("Transaction Thresholds (FDL No.10/2025)", () => {
  it("DPMS cash threshold is AED 55,000 (Art.16)", () => {
    expect(DPMS_CASH_THRESHOLD_AED).toBe(55_000);
  });

  it("Cross-border cash threshold is AED 60,000 (Art.17)", () => {
    expect(CROSS_BORDER_CASH_THRESHOLD_AED).toBe(60_000);
  });

  it("USD/AED peg is 3.6725 (CBUAE)", () => {
    expect(USD_TO_AED).toBe(3.6725);
  });

  it("Valuation anomaly is 25% (UAE NRA 2024)", () => {
    expect(VALUATION_ANOMALY_PCT).toBe(0.25);
  });

  it("Weight discrepancy is 5%", () => {
    expect(WEIGHT_DISCREPANCY_PCT).toBe(0.05);
  });
});

describe("Beneficial Ownership (Cabinet Decision 109/2023)", () => {
  it("UBO threshold is 25%", () => {
    expect(UBO_OWNERSHIP_THRESHOLD_PCT).toBe(0.25);
  });

  it("Re-verification deadline is 15 working days", () => {
    expect(UBO_REVERIFICATION_WORKING_DAYS).toBe(15);
  });
});

describe("Filing Deadlines (FDL No.10/2025, EOCN TFS Guidance 2025)", () => {
  it("STR filing is without delay — 0 business days (FDL Art.26-27, FIU Guidance)", () => {
    expect(STR_FILING_DEADLINE_BUSINESS_DAYS).toBe(0);
  });

  it("CTR filing is 15 business days (FDL Art.16)", () => {
    expect(CTR_FILING_DEADLINE_BUSINESS_DAYS).toBe(15);
  });

  it("EOCN asset freeze must be immediate (Cabinet Res 74/2020, EOCN TFS Guidance July 2025)", () => {
    expect(EOCN_FREEZE_IMMEDIATELY).toBe(true);
  });

  it("CNMR filing is 5 business days (Cabinet Res 74/2020 Art.6)", () => {
    expect(CNMR_FILING_DEADLINE_BUSINESS_DAYS).toBe(5);
  });
});

describe("Record Retention (FDL No.10/2025, MoE DPMS Guidance)", () => {
  it("Minimum retention is 10 years", () => {
    expect(RECORD_RETENTION_YEARS).toBe(10);
  });
});

describe("CDD Review Frequencies (Cabinet Res 134/2025)", () => {
  it("High-risk review every 3 months", () => {
    expect(CDD_REVIEW_HIGH_RISK_MONTHS).toBe(3);
  });

  it("Medium-risk review every 6 months", () => {
    expect(CDD_REVIEW_MEDIUM_RISK_MONTHS).toBe(6);
  });

  it("Low-risk review every 12 months", () => {
    expect(CDD_REVIEW_LOW_RISK_MONTHS).toBe(12);
  });
});

describe("Security Controls", () => {
  it("Account locks after 5 failed attempts", () => {
    expect(MAX_FAILED_LOGIN_ATTEMPTS).toBe(5);
  });
});

describe("Penalty Range (Cabinet Res 71/2024)", () => {
  it("Minimum penalty is AED 10,000", () => {
    expect(PENALTY_RANGE.minAED).toBe(10_000);
  });

  it("Maximum penalty is AED 100,000,000", () => {
    expect(PENALTY_RANGE.maxAED).toBe(100_000_000);
  });
});

describe("Risk Scoring Thresholds", () => {
  it("Critical threshold is 16", () => {
    expect(RISK_THRESHOLDS.critical).toBe(16);
  });

  it("High threshold is 11", () => {
    expect(RISK_THRESHOLDS.high).toBe(11);
  });

  it("Medium threshold is 6", () => {
    expect(RISK_THRESHOLDS.medium).toBe(6);
  });
});

describe("PF High-Risk Jurisdictions (Cabinet Res 156/2025)", () => {
  it("includes North Korea, Iran, Syria, Myanmar, Yemen", () => {
    expect(PF_HIGH_RISK_JURISDICTIONS).toContain("KP");
    expect(PF_HIGH_RISK_JURISDICTIONS).toContain("IR");
    expect(PF_HIGH_RISK_JURISDICTIONS).toContain("SY");
    expect(PF_HIGH_RISK_JURISDICTIONS).toContain("MM");
    expect(PF_HIGH_RISK_JURISDICTIONS).toContain("YE");
  });

  it("has exactly 5 jurisdictions", () => {
    expect(PF_HIGH_RISK_JURISDICTIONS.length).toBe(5);
  });
});

describe("FATF Grey List", () => {
  it("has 23 countries (Feb 2026 update)", () => {
    expect(FATF_GREY_LIST.length).toBe(23);
  });

  it("includes key jurisdictions", () => {
    expect(FATF_GREY_LIST).toContain("SY");
    expect(FATF_GREY_LIST).toContain("YE");
    expect(FATF_GREY_LIST).toContain("NG");
    expect(FATF_GREY_LIST).toContain("ZA");
  });
});

describe("Dormancy Detection", () => {
  it("Dormancy window is 90 days", () => {
    expect(DORMANCY_DAYS).toBe(90);
  });
});
