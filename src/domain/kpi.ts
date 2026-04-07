import type { ComplianceCase } from './cases';
import type { SuspicionReport } from './reports';
import type { ScreeningRun } from './screening';
import type { EvidenceItem } from './evidence';
import type { Alert } from './alerts';
import type { ApprovalRequest } from './approvals';

export interface KPIDashboard {
  // Case metrics
  openCases: number;
  criticalCases: number;
  escalatedCases: number;
  avgCaseAgeDays: number;

  // Review metrics
  overdueReviews: number;
  cddReviewOnTimePct: number;

  // Reporting metrics
  strCount: number;
  strPending: number;
  sarCount: number;
  ctrCount: number;
  strFilingTimelinessPct: number;

  // Screening metrics
  screeningRuns: number;
  screeningMatches: number;
  screeningFalsePositiveRate: number;

  // Evidence metrics
  evidenceComplete: number;
  evidenceMissing: number;
  evidenceCompletionPct: number;

  // Alert metrics
  activeAlerts: number;
  criticalAlerts: number;

  // Approval metrics
  pendingApprovals: number;
  avgApprovalTurnaroundHours: number;

  // DPMS specific
  blockedShipments: number;
  pfAlertsGenerated: number;

  // MoE Audit Readiness
  auditReadinessPct: number;
}

export function calculateKPI(
  cases: ComplianceCase[],
  reports: SuspicionReport[],
  screenings: ScreeningRun[],
  evidence: EvidenceItem[],
  alerts: Alert[],
  approvals?: ApprovalRequest[]
): KPIDashboard {
  const now = Date.now();

  // ─── Cases ─────────────────────────────────────────────────────────────
  const openCasesList = cases.filter((c) => c.status !== 'closed' && c.status !== 'rejected');
  const openCases = openCasesList.length;

  const criticalCases = cases.filter(
    (c) => c.riskLevel === 'critical' && c.status !== 'closed'
  ).length;

  const escalatedCases = cases.filter((c) => c.status === 'escalated').length;

  const caseAges = openCasesList.map((c) => (now - new Date(c.createdAt).getTime()) / 86400000);
  const avgCaseAgeDays =
    caseAges.length > 0 ? Math.round(caseAges.reduce((a, b) => a + b, 0) / caseAges.length) : 0;

  // ─── Reviews ───────────────────────────────────────────────────────────
  const overdueReviews = alerts.filter((a) => a.type === 'review-overdue' && !a.dismissedAt).length;

  const reviewAlerts = alerts.filter((a) => a.type === 'review-overdue');
  const reviewDismissed = reviewAlerts.filter((a) => a.dismissedAt);
  const cddReviewOnTimePct =
    reviewAlerts.length > 0
      ? Math.round((reviewDismissed.length / reviewAlerts.length) * 100)
      : 100;

  // ─── Reporting ─────────────────────────────────────────────────────────
  const strReports = reports.filter((r) => r.reportType === 'STR');
  const strCount = strReports.length;
  const strPending = strReports.filter((r) => r.status === 'draft').length;
  const sarCount = reports.filter((r) => r.reportType === 'SAR').length;
  const ctrCount = 0; // CTR tracked separately when implemented

  // STR filing timeliness: filed within 10 business days
  const strFiled = strReports.filter((r) => r.status === 'exported' && r.submittedAt);
  const strOnTime = strFiled.filter((r) => {
    const generated = new Date(r.generatedAt).getTime();
    const submitted = new Date(r.submittedAt!).getTime();
    const daysDiff = (submitted - generated) / 86400000;
    return daysDiff <= 14; // 10 business days ≈ 14 calendar days
  });
  const strFilingTimelinessPct =
    strFiled.length > 0 ? Math.round((strOnTime.length / strFiled.length) * 100) : 100;

  // ─── Screening ─────────────────────────────────────────────────────────
  const screeningMatches = screenings.filter(
    (s) => s.result === 'confirmed-match' || s.result === 'potential-match'
  ).length;

  const resolvedFalsePositives = screenings.filter(
    (s) => s.result === 'potential-match' && s.falsePositiveResolution
  ).length;
  const totalPotentialMatches = screenings.filter((s) => s.result === 'potential-match').length;
  const screeningFalsePositiveRate =
    totalPotentialMatches > 0
      ? Math.round((resolvedFalsePositives / totalPotentialMatches) * 100)
      : 0;

  // ─── Evidence ──────────────────────────────────────────────────────────
  const evidenceLinked = evidence.filter((e) => e.status === 'linked').length;
  const evidenceMissing = evidence.filter((e) => e.status === 'missing').length;
  const totalEvidence = evidence.length;
  const evidenceCompletionPct =
    totalEvidence > 0 ? Math.round((evidenceLinked / totalEvidence) * 100) : 100;

  // ─── Alerts ────────────────────────────────────────────────────────────
  const activeAlerts = alerts.filter((a) => !a.dismissedAt).length;
  const criticalAlerts = alerts.filter((a) => a.severity === 'critical' && !a.dismissedAt).length;

  // ─── Approvals ─────────────────────────────────────────────────────────
  const approvalList = approvals ?? [];
  const pendingApprovals = approvalList.filter((a) => a.status === 'pending').length;
  const decidedApprovals = approvalList.filter((a) => a.decidedAt && a.requestedAt);
  const approvalTurnarounds = decidedApprovals.map(
    (a) => (new Date(a.decidedAt!).getTime() - new Date(a.requestedAt).getTime()) / 3600000
  );
  const avgApprovalTurnaroundHours =
    approvalTurnarounds.length > 0
      ? Math.round(approvalTurnarounds.reduce((a, b) => a + b, 0) / approvalTurnarounds.length)
      : 0;

  // ─── DPMS Specific ────────────────────────────────────────────────────
  const blockedShipments = cases.filter(
    (c) =>
      (c.caseType === 'screening-hit' || c.caseType === 'sanctions-hit') &&
      c.redFlags.some((f) => f === 'RF011' || f === 'RF012' || f === 'RF041' || f === 'RF070') &&
      c.status !== 'closed'
  ).length;

  const pfAlertsGenerated = cases.filter(
    (c) => c.caseType === 'pf-screening' && c.status !== 'closed'
  ).length;

  // ─── Audit Readiness (simplified — based on available data) ───────────
  let auditScore = 0;
  const auditTotal = 10;
  if (strCount > 0 || strPending === 0) auditScore++; // STR program active
  if (screenings.length > 0) auditScore++; // Screening active
  if (evidenceCompletionPct >= 80) auditScore++; // Evidence mostly complete
  if (overdueReviews === 0) auditScore++; // No overdue reviews
  if (criticalAlerts === 0) auditScore++; // No critical alerts
  if (pendingApprovals <= 3) auditScore++; // Approvals not backlogged
  if (escalatedCases <= 2) auditScore++; // Escalations manageable
  if (cddReviewOnTimePct >= 90) auditScore++; // CDD reviews on time
  if (strFilingTimelinessPct >= 90) auditScore++; // STR filings on time
  if (blockedShipments === 0) auditScore++; // No blocked shipments
  const auditReadinessPct = Math.round((auditScore / auditTotal) * 100);

  return {
    openCases,
    criticalCases,
    escalatedCases,
    avgCaseAgeDays,
    overdueReviews,
    cddReviewOnTimePct,
    strCount,
    strPending,
    sarCount,
    ctrCount,
    strFilingTimelinessPct,
    screeningRuns: screenings.length,
    screeningMatches,
    screeningFalsePositiveRate,
    evidenceComplete: evidenceLinked,
    evidenceMissing,
    evidenceCompletionPct,
    activeAlerts,
    criticalAlerts,
    pendingApprovals,
    avgApprovalTurnaroundHours,
    blockedShipments,
    pfAlertsGenerated,
    auditReadinessPct,
  };
}
