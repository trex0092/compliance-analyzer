import { createId } from "../utils/id";
import { nowIso } from "../utils/dates";

export type AuditType = "internal" | "external" | "regulatory" | "lbma";
export type FindingSeverity = "critical" | "high" | "medium" | "low" | "observation";
export type FindingStatus = "open" | "in-progress" | "remediated" | "closed";

export interface AuditFinding {
  id: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  status: FindingStatus;
  regulatoryRef: string;
  remediationOwner: string;
  remediationDueDate: string;
  remediationNotes?: string;
  closedAt?: string;
}

export interface AuditRecord {
  id: string;
  auditType: AuditType;
  title: string;
  scope: string;
  auditor: string;
  startDate: string;
  endDate?: string;
  status: "planned" | "in-progress" | "completed" | "report-issued";
  findings: AuditFinding[];
  overallResult?: "effective" | "partially-effective" | "ineffective";
  reportRef?: string;
  createdAt: string;
  updatedAt: string;
}

export function createAuditRecord(
  auditType: AuditType,
  title: string,
  scope: string,
  auditor: string,
  startDate: string
): AuditRecord {
  return {
    id: createId("audit"),
    auditType,
    title,
    scope,
    auditor,
    startDate,
    status: "planned",
    findings: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function addFinding(
  audit: AuditRecord,
  title: string,
  description: string,
  severity: FindingSeverity,
  regulatoryRef: string,
  owner: string,
  dueDate: string
): AuditRecord {
  const finding: AuditFinding = {
    id: createId("finding"),
    title,
    description,
    severity,
    status: "open",
    regulatoryRef,
    remediationOwner: owner,
    remediationDueDate: dueDate,
  };
  return {
    ...audit,
    findings: [...audit.findings, finding],
    updatedAt: nowIso(),
  };
}

export function getAuditStats(audit: AuditRecord) {
  const total = audit.findings.length;
  const open = audit.findings.filter((f) => f.status === "open").length;
  const closed = audit.findings.filter((f) => f.status === "closed").length;
  const overdue = audit.findings.filter(
    (f) =>
      f.status !== "closed" &&
      new Date(f.remediationDueDate) < new Date()
  ).length;
  return { total, open, closed, overdue, remediationPct: total > 0 ? Math.round((closed / total) * 100) : 100 };
}
