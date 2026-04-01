export interface ApprovalRequest {
  id: string;
  caseId: string;
  requiredFor:
    | "pep-onboarding"
    | "high-risk-onboarding"
    | "edd-continuation"
    | "str-approval"
    | "policy-exception";
  status: "pending" | "approved" | "rejected";
  requestedBy: string;
  requestedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
}
