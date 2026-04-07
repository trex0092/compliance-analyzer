import { describe, it, expect } from "vitest";
import { validateSTR, validateCTR } from "../src/utils/goamlValidator";

const VALID_STR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<goAMLReport>
  <reportHeader>
    <reportId>RPT-1712500000-abc123</reportId>
    <reportType>STR</reportType>
    <reportDate>2026-04-07</reportDate>
  </reportHeader>
  <reportingEntity>
    <entityName>FINE GOLD LLC</entityName>
  </reportingEntity>
  <suspiciousSubject>
    <subjectName>Test Entity</subjectName>
  </suspiciousSubject>
  <groundsForSuspicion>Unusual transaction pattern with no business rationale</groundsForSuspicion>
  <transactionDetails>
    <transactionAmount>75000.00</transactionAmount>
    <transactionDate>2026-04-01</transactionDate>
  </transactionDetails>
  <reportFooter>
    <filingOfficer>CO</filingOfficer>
  </reportFooter>
</goAMLReport>`;

describe("validateSTR", () => {
  it("validates a correct STR XML", () => {
    const result = validateSTR(VALID_STR_XML);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("catches missing required elements", () => {
    const result = validateSTR("<goAMLReport><reportHeader></reportHeader></goAMLReport>");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "reportingEntity")).toBe(true);
    expect(result.errors.some((e) => e.field === "suspiciousSubject")).toBe(true);
  });

  it("catches missing report ID format", () => {
    const xml = VALID_STR_XML.replace("RPT-1712500000-abc123", "INVALID-ID");
    const result = validateSTR(xml);
    expect(result.errors.some((e) => e.field === "reportId")).toBe(true);
  });

  it("catches empty grounds for suspicion", () => {
    const xml = VALID_STR_XML.replace(
      "Unusual transaction pattern with no business rationale",
      ""
    );
    const result = validateSTR(xml);
    expect(result.errors.some((e) => e.field === "groundsForSuspicion")).toBe(true);
  });

  it("catches tipping-off language", () => {
    const xml = VALID_STR_XML.replace(
      "Unusual transaction pattern",
      "We have reported this to authorities"
    );
    const result = validateSTR(xml);
    expect(result.errors.some((e) => e.regulatory.includes("Tipping Off"))).toBe(true);
  });
});

describe("validateCTR", () => {
  const VALID_CTR = `<goAMLReport>
    <reportHeader><reportId>RPT-123-abc</reportId></reportHeader>
    <reportingEntity><name>TEST</name></reportingEntity>
    <cashTransaction><cashAmount>55000</cashAmount></cashTransaction>
  </goAMLReport>`;

  it("validates correct CTR", () => {
    const result = validateCTR(VALID_CTR);
    expect(result.valid).toBe(true);
  });

  it("warns if amount below threshold", () => {
    const xml = VALID_CTR.replace("55000", "40000");
    const result = validateCTR(xml);
    expect(result.warnings.some((w) => w.message.includes("below"))).toBe(true);
  });

  it("catches missing cashTransaction element", () => {
    const result = validateCTR("<goAMLReport><reportHeader></reportHeader></goAMLReport>");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "cashTransaction")).toBe(true);
  });
});
