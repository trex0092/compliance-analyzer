import type { ComplianceCase } from "./cases";
import type { SuspicionReport } from "./reports";
import type { ScreeningRun } from "./screening";
import type { EvidenceItem } from "./evidence";
import type { Alert } from "./alerts";

export interface KPIDashboard {
  openCases: number;
  criticalCases: number;
  escalatedCases: number;
  overdueReviews: number;
  strCount: number;
  strPending: number;
  screeningRuns: number;
  screeningMatches: number;
  evidenceComplete: number;
  evidenceMissing: number;
  evidenceCompletionPct: number;
  activeAlerts: number;
  criticalAlerts: number;
  blockedShipments: number;
}

export function calculateKPI(
  cases: ComplianceCase[],
  reports: SuspicionReport[],
  screenings: ScreeningRun[],
  evidence: EvidenceItem[],
  alerts: Alert[]
): KPIDashboard {
  const openCases = cases.filter(
    (c) => c.status !== "closed" && c.status !== "rejected"
  ).length;

  const criticalCases = cases.filter(
    (c) => c.riskLevel === "critical" && c.status !== "closed"
  ).length;

  const escalatedCases = cases.filter(
    (c) => c.status === "escalated"
  ).length;

  const overdueReviews = alerts.filter(
    (a) => a.type === "review-overdue" && !a.dismissedAt
  ).length;

  const strCount = reports.filter((r) => r.reportType === "STR").length;
  const strPending = reports.filter(
    (r) => r.reportType === "STR" && r.status === "draft"
  ).length;

  const screeningMatches = screenings.filter(
    (s) => s.result === "confirmed-match" || s.result === "potential-match"
  ).length;

  const evidenceLinked = evidence.filter((e) => e.status === "linked").length;
  const evidenceMissing = evidence.filter((e) => e.status === "missing").length;
  const totalEvidence = evidence.length;
  const evidenceCompletionPct =
    totalEvidence > 0 ? Math.round((evidenceLinked / totalEvidence) * 100) : 100;

  const activeAlerts = alerts.filter((a) => !a.dismissedAt).length;
  const criticalAlerts = alerts.filter(
    (a) => a.severity === "critical" && !a.dismissedAt
  ).length;

  const blockedShipments = cases.filter(
    (c) =>
      c.caseType === "screening-hit" &&
      c.redFlags.some(
        (f) => f.includes("RF011") || f.includes("RF041")
      ) &&
      c.status !== "closed"
  ).length;

  return {
    openCases,
    criticalCases,
    escalatedCases,
    overdueReviews,
    strCount,
    strPending,
    screeningRuns: screenings.length,
    screeningMatches,
    evidenceComplete: evidenceLinked,
    evidenceMissing,
    evidenceCompletionPct,
    activeAlerts,
    criticalAlerts,
    blockedShipments,
  };
}
