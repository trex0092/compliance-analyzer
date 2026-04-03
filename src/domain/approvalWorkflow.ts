import type { ApprovalRequest } from "./approvals";
import type { ComplianceCase } from "./cases";
import { createId } from "../utils/id";
import { nowIso } from "../utils/dates";

export type ApprovalGate =
  | "pep-onboarding"
  | "high-risk-onboarding"
  | "edd-continuation"
  | "str-approval"
  | "policy-exception"
  | "asset-freeze"
  | "customer-exit";

export function requiresApproval(caseObj: ComplianceCase): ApprovalGate[] {
  const gates: ApprovalGate[] = [];

  if (caseObj.redFlags.some((f) => f.includes("PEP"))) {
    gates.push("pep-onboarding");
  }

  if (caseObj.riskLevel === "high" || caseObj.riskLevel === "critical") {
    gates.push("high-risk-onboarding");
  }

  if (caseObj.recommendation === "edd") {
    gates.push("edd-continuation");
  }

  if (
    caseObj.recommendation === "str-review" ||
    caseObj.recommendation === "freeze"
  ) {
    gates.push("str-approval");
  }

  if (caseObj.recommendation === "freeze") {
    gates.push("asset-freeze");
  }

  return gates;
}

export function createApprovalRequest(
  caseId: string,
  gate: ApprovalGate,
  requestedBy: string
): ApprovalRequest {
  return {
    id: createId("appr"),
    caseId,
    requiredFor: gate === "asset-freeze" ? "str-approval" : gate,
    status: "pending",
    requestedBy,
    requestedAt: nowIso(),
  };
}

export function canProceedWithoutApproval(
  gates: ApprovalGate[],
  approvals: ApprovalRequest[]
): { canProceed: boolean; pendingGates: ApprovalGate[]; rejectedGates: ApprovalGate[] } {
  const approvedGates = approvals
    .filter((a) => a.status === "approved")
    .map((a) => a.requiredFor);

  const rejectedGates = gates.filter((g) =>
    approvals.some((a) => a.requiredFor === g && a.status === "rejected")
  );

  const pendingGates = gates.filter(
    (g) => !approvedGates.includes(g) && !rejectedGates.includes(g)
  );

  return {
    canProceed: pendingGates.length === 0 && rejectedGates.length === 0,
    pendingGates,
    rejectedGates,
  };
}
