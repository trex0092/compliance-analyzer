/**
 * brain-analyze endpoint validation tests.
 *
 * Covers the pure `validate()` function exported via __test__ from
 * netlify/functions/brain-analyze.mts. The handler itself is not
 * unit-tested here — it's integration-tested through Netlify.
 *
 * These tests exist to make the input schema a hard contract: a
 * regression in field validation could silently accept malformed
 * payloads and produce wrong compliance decisions.
 */
import { describe, it, expect } from "vitest";
import { __test__ } from "../netlify/functions/brain-analyze.mts";

const { validate } = __test__;

function baseValid() {
  return {
    tenantId: "tenant-42",
    topic: "Unit test",
    entity: {
      id: "entity-001",
      name: "Test Entity LLC",
      features: {
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
      },
    },
  };
}

describe("brain-analyze validate — happy paths", () => {
  it("accepts a minimal valid payload", () => {
    const result = validate(baseValid());
    expect(result.ok).toBe(true);
  });

  it("accepts isSanctionsConfirmed = true", () => {
    const input = baseValid();
    (input.entity as Record<string, unknown>).isSanctionsConfirmed = true;
    const result = validate(input);
    expect(result.ok).toBe(true);
  });

  it("accepts sealAttestation = false", () => {
    const input = baseValid() as Record<string, unknown>;
    input.sealAttestation = false;
    const result = validate(input);
    expect(result.ok).toBe(true);
  });
});

describe("brain-analyze validate — top-level rejections", () => {
  it("rejects non-object body", () => {
    expect(validate(null).ok).toBe(false);
    expect(validate("hello").ok).toBe(false);
    expect(validate(42).ok).toBe(false);
  });

  it("rejects missing tenantId", () => {
    const input = baseValid() as Record<string, unknown>;
    delete input.tenantId;
    const result = validate(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/tenantId/);
  });

  it("rejects tenantId > 64 chars", () => {
    const input = baseValid();
    input.tenantId = "x".repeat(65);
    const result = validate(input);
    expect(result.ok).toBe(false);
  });

  it("rejects empty topic", () => {
    const input = baseValid();
    input.topic = "";
    const result = validate(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/topic/);
  });

  it("rejects missing entity", () => {
    const input = baseValid() as Record<string, unknown>;
    delete input.entity;
    const result = validate(input);
    expect(result.ok).toBe(false);
  });
});

describe("brain-analyze validate — feature rejections", () => {
  it("rejects numeric field with non-finite value", () => {
    const input = baseValid();
    input.entity.features.priorAlerts90d = Number.NaN;
    const result = validate(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/priorAlerts90d/);
  });

  it("rejects numeric field with negative value", () => {
    const input = baseValid();
    input.entity.features.txValue30dAED = -1;
    const result = validate(input);
    expect(result.ok).toBe(false);
  });

  it("rejects ratio field > 1", () => {
    const input = baseValid();
    input.entity.features.cashRatio30d = 1.5;
    const result = validate(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/cashRatio30d/);
  });

  it("rejects sanctionsMatchScore > 1", () => {
    const input = baseValid();
    input.entity.features.sanctionsMatchScore = 2;
    const result = validate(input);
    expect(result.ok).toBe(false);
  });

  it("rejects boolean field given a string", () => {
    const input = baseValid();
    (input.entity.features as Record<string, unknown>).isPep = "yes";
    const result = validate(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/isPep/);
  });

  it("accepts the full documented feature set at its upper bounds", () => {
    const input = baseValid();
    input.entity.features.priorAlerts90d = 50;
    input.entity.features.txValue30dAED = 1_000_000_000;
    input.entity.features.nearThresholdCount30d = 99;
    input.entity.features.crossBorderRatio30d = 1;
    input.entity.features.isPep = true;
    input.entity.features.highRiskJurisdiction = true;
    input.entity.features.hasAdverseMedia = true;
    input.entity.features.daysSinceOnboarding = 10_000;
    input.entity.features.sanctionsMatchScore = 1;
    input.entity.features.cashRatio30d = 1;
    const result = validate(input);
    expect(result.ok).toBe(true);
  });
});
