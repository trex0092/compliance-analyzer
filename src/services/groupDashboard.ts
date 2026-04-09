/**
 * Group Consolidated Dashboard
 *
 * Aggregates KPI data across all 6 companies into a single
 * group-level view. The MLRO sees one dashboard, not six.
 *
 * Uses existing KPIDashboard data type — does NOT duplicate the
 * KPI calculation logic in kpi.ts. Instead, it AGGREGATES outputs.
 */

import type { KPIDashboard } from '../domain/kpi';
import { COMPANY_REGISTRY } from '../domain/customers';

export interface GroupKPISummary {
  groupName: string;
  generatedAt: string;
  companiesIncluded: number;
  entities: EntityKPISummary[];
  consolidated: ConsolidatedMetrics;
  worstPerformers: WorstPerformer[];
  groupRiskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface EntityKPISummary {
  companyId: string;
  companyName: string;
  entityType: string;
  auditReadinessPct: number;
  openCases: number;
  criticalAlerts: number;
  overdueReviews: number;
  strPending: number;
  evidenceCompletionPct: number;
  riskStatus: 'green' | 'amber' | 'red';
}

export interface ConsolidatedMetrics {
  totalOpenCases: number;
  totalCriticalCases: number;
  totalCriticalAlerts: number;
  totalOverdueReviews: number;
  totalStrPending: number;
  totalPfAlerts: number;
  avgAuditReadiness: number;
  avgEvidenceCompletion: number;
  avgCddOnTime: number;
  avgStrTimeliness: number;
  totalScreeningRuns: number;
  totalPendingApprovals: number;
}

export interface WorstPerformer {
  companyId: string;
  companyName: string;
  metric: string;
  value: number;
  threshold: number;
  severity: 'warning' | 'critical';
}

/**
 * Aggregate KPI data from multiple entities into a group view.
 */
export function consolidateGroupKPIs(entityKPIs: Map<string, KPIDashboard>): GroupKPISummary {
  const entities: EntityKPISummary[] = [];
  const worstPerformers: WorstPerformer[] = [];

  let totalOpen = 0;
  let totalCritical = 0;
  let totalCritAlerts = 0;
  let totalOverdue = 0;
  let totalStrPend = 0;
  let totalPf = 0;
  let totalScreenings = 0;
  let totalApprovals = 0;
  let auditSum = 0;
  let evidenceSum = 0;
  let cddSum = 0;
  let strSum = 0;
  let count = 0;

  for (const [companyId, kpi] of entityKPIs) {
    const company = COMPANY_REGISTRY.find((c) => c.id === companyId);
    const companyName = company?.legalName || companyId;
    const entityType = company?.entityType || 'standalone';

    // Determine entity RAG status
    let riskStatus: 'green' | 'amber' | 'red' = 'green';
    if (kpi.criticalCases > 0 || kpi.criticalAlerts > 0 || kpi.auditReadinessPct < 50) {
      riskStatus = 'red';
    } else if (kpi.overdueReviews > 0 || kpi.strPending > 0 || kpi.auditReadinessPct < 80) {
      riskStatus = 'amber';
    }

    entities.push({
      companyId,
      companyName,
      entityType,
      auditReadinessPct: kpi.auditReadinessPct,
      openCases: kpi.openCases,
      criticalAlerts: kpi.criticalAlerts,
      overdueReviews: kpi.overdueReviews,
      strPending: kpi.strPending,
      evidenceCompletionPct: kpi.evidenceCompletionPct,
      riskStatus,
    });

    // Accumulate totals
    totalOpen += kpi.openCases;
    totalCritical += kpi.criticalCases;
    totalCritAlerts += kpi.criticalAlerts;
    totalOverdue += kpi.overdueReviews;
    totalStrPend += kpi.strPending;
    totalPf += kpi.pfAlertsGenerated;
    totalScreenings += kpi.screeningRuns;
    totalApprovals += kpi.pendingApprovals;
    auditSum += kpi.auditReadinessPct;
    evidenceSum += kpi.evidenceCompletionPct;
    cddSum += kpi.cddReviewOnTimePct;
    strSum += kpi.strFilingTimelinessPct;
    count++;

    // Track worst performers
    if (kpi.auditReadinessPct < 70) {
      worstPerformers.push({
        companyId,
        companyName,
        metric: 'Audit Readiness',
        value: kpi.auditReadinessPct,
        threshold: 70,
        severity: kpi.auditReadinessPct < 50 ? 'critical' : 'warning',
      });
    }
    if (kpi.overdueReviews > 0) {
      worstPerformers.push({
        companyId,
        companyName,
        metric: 'Overdue CDD Reviews',
        value: kpi.overdueReviews,
        threshold: 0,
        severity: kpi.overdueReviews > 3 ? 'critical' : 'warning',
      });
    }
    if (kpi.criticalAlerts > 0) {
      worstPerformers.push({
        companyId,
        companyName,
        metric: 'Critical Alerts',
        value: kpi.criticalAlerts,
        threshold: 0,
        severity: 'critical',
      });
    }
  }

  const avg = (sum: number) => (count > 0 ? Math.round(sum / count) : 0);

  const avgAudit = avg(auditSum);
  const groupRiskLevel: 'low' | 'medium' | 'high' | 'critical' =
    totalCritical > 0 || totalCritAlerts > 2
      ? 'critical'
      : totalOverdue > 3 || avgAudit < 60
        ? 'high'
        : avgAudit < 80
          ? 'medium'
          : 'low';

  return {
    groupName: 'Hawkeye Sterling Group',
    generatedAt: new Date().toISOString(),
    companiesIncluded: count,
    entities,
    consolidated: {
      totalOpenCases: totalOpen,
      totalCriticalCases: totalCritical,
      totalCriticalAlerts: totalCritAlerts,
      totalOverdueReviews: totalOverdue,
      totalStrPending: totalStrPend,
      totalPfAlerts: totalPf,
      avgAuditReadiness: avgAudit,
      avgEvidenceCompletion: avg(evidenceSum),
      avgCddOnTime: avg(cddSum),
      avgStrTimeliness: avg(strSum),
      totalScreeningRuns: totalScreenings,
      totalPendingApprovals: totalApprovals,
    },
    worstPerformers: worstPerformers.sort((a, b) => {
      if (a.severity === 'critical' && b.severity !== 'critical') return -1;
      if (b.severity === 'critical' && a.severity !== 'critical') return 1;
      return 0;
    }),
    groupRiskLevel,
  };
}
