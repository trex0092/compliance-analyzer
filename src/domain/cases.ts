export type CaseType =
  | "onboarding"
  | "transaction-monitoring"
  | "screening-hit"
  | "periodic-review"
  | "sourcing-review"
  | "incident"
  | "regulatory-breach";

export type CaseStatus =
  | "open"
  | "under-review"
  | "pending-info"
  | "escalated"
  | "approved"
  | "reported"
  | "closed"
  | "rejected";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type Recommendation =
  | "continue"
  | "edd"
  | "reject"
  | "suspend"
  | "str-review"
  | "freeze";

export type AuditAction =
  | "created"
  | "updated"
  | "risk-recalculated"
  | "assigned"
  | "status-changed"
  | "decision-recorded"
  | "evidence-linked"
  | "goaml-exported";

export interface AuditEvent {
  id: string;
  at: string;
  by: string;
  action: AuditAction;
  note?: string;
  before?: unknown;
  after?: unknown;
}

export interface CaseDecision {
  outcome:
    | "continue"
    | "continue-with-edd"
    | "reject"
    | "suspend"
    | "freeze"
    | "file-str"
    | "file-sar";
  reason: string;
  decidedBy: string;
  decidedAt: string;
}

export interface ComplianceCase {
  id: string;
  entityId: string;
  caseType: CaseType;
  status: CaseStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  assignedTo?: string;
  sourceModule:
    | "analyze"
    | "iar"
    | "shipments"
    | "screening"
    | "onboarding"
    | "incidents"
    | "manual";
  riskScore: number;
  riskLevel: RiskLevel;
  redFlags: string[];
  findings: string[];
  narrative: string;
  recommendation: Recommendation;
  decision?: CaseDecision;
  linkedCustomerId?: string;
  linkedShipmentIds?: string[];
  linkedTaskIds?: string[];
  linkedEvidenceIds?: string[];
  linkedReportIds?: string[];
  auditLog: AuditEvent[];
}
