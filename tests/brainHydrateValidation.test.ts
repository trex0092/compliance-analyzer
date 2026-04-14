/**
 * brain-hydrate validation tests.
 */
import { describe, it, expect } from "vitest";
import { __test__ } from "../netlify/functions/brain-hydrate.mts";

const { validate } = __test__;

describe("brain-hydrate validate", () => {
  it("accepts a valid tenantId", () => {
    expect(validate({ tenantId: "tenant-42" }).ok).toBe(true);
  });

  it("rejects non-object body", () => {
    expect(validate(null).ok).toBe(false);
    expect(validate("abc").ok).toBe(false);
    expect(validate(42).ok).toBe(false);
  });

  it("rejects missing tenantId", () => {
    const r = validate({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/tenantId/);
  });

  it("rejects empty tenantId", () => {
    expect(validate({ tenantId: "" }).ok).toBe(false);
  });

  it("rejects tenantId longer than 64 chars", () => {
    expect(validate({ tenantId: "x".repeat(65) }).ok).toBe(false);
  });

  it("accepts tenantId at exactly 64 chars", () => {
    expect(validate({ tenantId: "x".repeat(64) }).ok).toBe(true);
  });

  it("rejects non-string tenantId", () => {
    expect(validate({ tenantId: 42 }).ok).toBe(false);
    expect(validate({ tenantId: {} }).ok).toBe(false);
  });
});
