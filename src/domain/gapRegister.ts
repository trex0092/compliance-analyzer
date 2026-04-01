import { createId } from "../utils/id";
import { nowIso } from "../utils/dates";

export type GapSeverity = "critical" | "high" | "medium" | "low";
export type GapStatus = "open" | "in-progress" | "remediated" | "verified" | "closed";

export interface GapEntry {
  id: string;
  gapCode: string;
  title: string;
  description: string;
  severity: GapSeverity;
  status: GapStatus;
  regulatoryRef: string;
  linkedCaseIds: string[];
  linkedEvidenceIds: string[];
  linkedTaskIds: string[];
  owner: string;
  createdAt: string;
  updatedAt: string;
  targetDate?: string;
  closedAt?: string;
  remediationNotes?: string;
}

export function createGap(
  gapCode: string,
  title: string,
  description: string,
  severity: GapSeverity,
  regulatoryRef: string,
  owner: string,
  targetDate?: string
): GapEntry {
  return {
    id: createId("gap"),
    gapCode,
    title,
    description,
    severity,
    status: "open",
    regulatoryRef,
    linkedCaseIds: [],
    linkedEvidenceIds: [],
    linkedTaskIds: [],
    owner,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    targetDate,
  };
}

export function canCloseGap(gap: GapEntry): { canClose: boolean; reason?: string } {
  if (gap.linkedEvidenceIds.length === 0) {
    return { canClose: false, reason: "No remediation evidence linked." };
  }
  if (!gap.remediationNotes) {
    return { canClose: false, reason: "Remediation notes required." };
  }
  if (gap.linkedCaseIds.length === 0) {
    return { canClose: false, reason: "No case linked to this gap." };
  }
  return { canClose: true };
}

export function closeGap(gap: GapEntry): GapEntry {
  const check = canCloseGap(gap);
  if (!check.canClose) throw new Error(check.reason);
  return {
    ...gap,
    status: "closed",
    closedAt: nowIso(),
    updatedAt: nowIso(),
  };
}
