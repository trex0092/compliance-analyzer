import type { ComplianceCase } from "../domain/cases";
import type { CustomerProfile } from "../domain/customers";
import type { EvidenceItem } from "../domain/evidence";
import type { ScreeningRun } from "../domain/screening";
import type { Alert } from "../domain/alerts";
import { createId } from "../utils/id";
import { nowIso, isValidDate } from "../utils/dates";

function safeDaysBetween(dateStr: string, now: Date): number | null {
  if (!dateStr || !isValidDate(dateStr)) return null;
  return (new Date(dateStr).getTime() - now.getTime()) / 86400000;
}

export function generateAlerts(
  cases: ComplianceCase[],
  customers: CustomerProfile[],
  evidence: EvidenceItem[],
  screeningRuns: ScreeningRun[]
): Alert[] {
  const alerts: Alert[] = [];
  const now = new Date();
  const seen = new Set<string>();

  function addAlert(alert: Alert, dedupeKey: string) {
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    alerts.push(alert);
  }

  // Review overdue: customers past nextCDDReviewDate
  for (const c of customers) {
    if (!c.nextCDDReviewDate) continue;
    const days = safeDaysBetween(c.nextCDDReviewDate, now);
    if (days !== null && days < 0) {
      addAlert(
        {
          id: createId("alert"),
          type: "review-overdue",
          subjectId: c.id,
          subjectType: "customer",
          message: `CDD review overdue for ${c.legalName}. Next review was due ${c.nextCDDReviewDate}.`,
          severity: c.riskRating === "high" ? "critical" : "high",
          createdAt: nowIso(),
        },
        `review-overdue:${c.id}`
      );
    }
  }

  // Evidence expiring: within 30 days
  for (const e of evidence) {
    if (e.expiryDate) {
      const daysUntil = safeDaysBetween(e.expiryDate, now);
      if (daysUntil !== null && daysUntil > 0 && daysUntil <= 30) {
        addAlert(
          {
            id: createId("alert"),
            type: "evidence-expiring",
            subjectId: e.id,
            subjectType: "evidence",
            message: `${e.title} expires in ${Math.ceil(daysUntil)} days.`,
            severity: daysUntil <= 7 ? "high" : "medium",
            createdAt: nowIso(),
          },
          `evidence-expiring:${e.id}`
        );
      }
    }
    if (e.status === "missing") {
      addAlert(
        {
          id: createId("alert"),
          type: "evidence-expiring",
          subjectId: e.id,
          subjectType: "evidence",
          message: `Missing evidence: ${e.title} for entity ${e.entityId}.`,
          severity: "high",
          createdAt: nowIso(),
        },
        `evidence-missing:${e.id}`
      );
    }
  }

  // Screening expired: older than 6 months
  const sixMonthsAgo = new Date(now.getTime() - 180 * 86400000);
  for (const s of screeningRuns) {
    if (!isValidDate(s.executedAt)) continue;
    if (new Date(s.executedAt) < sixMonthsAgo) {
      addAlert(
        {
          id: createId("alert"),
          type: "screening-expired",
          subjectId: s.subjectId,
          subjectType: "customer",
          message: `Screening for ${s.subjectId} is ${Math.floor((now.getTime() - new Date(s.executedAt).getTime()) / 86400000)} days old. Re-screen required.`,
          severity: s.result !== "clear" ? "critical" : "high",
          createdAt: nowIso(),
        },
        `screening-expired:${s.id}`
      );
    }
  }

  // High-risk cases open too long (>30 days)
  for (const c of cases) {
    if (
      (c.riskLevel === "high" || c.riskLevel === "critical") &&
      c.status === "open"
    ) {
      const daysOpen = safeDaysBetween(c.createdAt, now);
      if (daysOpen !== null && Math.abs(daysOpen) > 30) {
        addAlert(
          {
            id: createId("alert"),
            type: "high-risk-case-open",
            subjectId: c.id,
            subjectType: "case",
            message: `${c.riskLevel} case ${c.id} open for ${Math.floor(Math.abs(daysOpen))} days. Escalation required.`,
            severity: c.riskLevel === "critical" ? "critical" : "high",
            createdAt: nowIso(),
          },
          `high-risk-case-open:${c.id}`
        );
      }
    }
  }

  // STR not filed: cases with str-review recommendation but no report linked
  for (const c of cases) {
    if (
      c.recommendation === "str-review" &&
      (!c.linkedReportIds || c.linkedReportIds.length === 0) &&
      c.status !== "closed"
    ) {
      addAlert(
        {
          id: createId("alert"),
          type: "task-overdue",
          subjectId: c.id,
          subjectType: "case",
          message: `Case ${c.id} requires STR review but no report filed. Deadline: 10 business days per FDL Art.26.`,
          severity: "critical",
          createdAt: nowIso(),
        },
        `task-overdue:${c.id}`
      );
    }
  }

  return alerts;
}
