import { describe, it, expect } from "vitest";
import { hasPermission, canApprove } from "../src/utils/rbacGuard";

describe("hasPermission", () => {
  it("admin has all permissions", () => {
    expect(hasPermission("admin", "view-cases")).toBe(true);
    expect(hasPermission("admin", "approve-freeze")).toBe(true);
    expect(hasPermission("admin", "manage-audit-checklist")).toBe(true);
  });

  it("viewer can only view cases and dashboard", () => {
    expect(hasPermission("viewer", "view-cases")).toBe(true);
    expect(hasPermission("viewer", "view-kpi-dashboard")).toBe(true);
    expect(hasPermission("viewer", "edit-cases")).toBe(false);
    expect(hasPermission("viewer", "approve-str")).toBe(false);
  });

  it("analyst cannot approve STR", () => {
    expect(hasPermission("analyst", "approve-str")).toBe(false);
  });

  it("compliance-officer can approve STR", () => {
    expect(hasPermission("compliance-officer", "approve-str")).toBe(true);
  });

  it("external-auditor can view but not edit", () => {
    expect(hasPermission("external-auditor", "view-cases")).toBe(true);
    expect(hasPermission("external-auditor", "view-audit-log")).toBe(true);
    expect(hasPermission("external-auditor", "edit-cases")).toBe(false);
    expect(hasPermission("external-auditor", "create-reports")).toBe(false);
  });

  it("undefined role has no permissions", () => {
    expect(hasPermission(undefined, "view-cases")).toBe(false);
  });
});

describe("canApprove — Four-Eyes Principle", () => {
  it("CO can approve STR", () => {
    const result = canApprove("compliance-officer", "str-approval");
    expect(result.allowed).toBe(true);
  });

  it("analyst cannot approve STR", () => {
    const result = canApprove("analyst" as any, "str-approval");
    expect(result.allowed).toBe(false);
  });

  it("same person cannot approve their own request", () => {
    const result = canApprove("mlro", "str-approval", "john", "john");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Four-eyes");
  });

  it("different person can approve", () => {
    const result = canApprove("mlro", "str-approval", "john", "jane");
    expect(result.allowed).toBe(true);
  });

  it("only senior management can approve PEP onboarding", () => {
    expect(canApprove("compliance-officer", "pep-onboarding").allowed).toBe(false);
    expect(canApprove("senior-management", "pep-onboarding").allowed).toBe(true);
  });

  it("asset freeze requires mlro or senior management", () => {
    expect(canApprove("analyst" as any, "asset-freeze").allowed).toBe(false);
    expect(canApprove("mlro", "asset-freeze").allowed).toBe(true);
    expect(canApprove("senior-management", "asset-freeze").allowed).toBe(true);
  });
});
