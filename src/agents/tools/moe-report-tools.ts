/**
 * MoE Quarterly Report Generator MCP Tools
 *
 * Generates Ministry of Economy quarterly compliance reports with:
 * - 25-item inspection checklist
 * - RAG (Red/Amber/Green) scoring per item
 * - Overall compliance score and grade
 * - Gap analysis and remediation timeline
 *
 * Regulatory basis: MoE Circular 08/AML/2021, FDL No.10/2025,
 * Cabinet Res 134/2025, Cabinet Res 71/2024 (administrative penalties)
 */

import type { ToolResult } from '../mcp-server';
import {
  PENALTY_RANGE as _PENALTY_RANGE,
  RECORD_RETENTION_YEARS as _RECORD_RETENTION_YEARS,
  DPMS_CASH_THRESHOLD_AED as _DPMS_CASH_THRESHOLD_AED,
} from '../../domain/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RAGStatus = 'green' | 'amber' | 'red';
export type ComplianceGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface ChecklistEvidence {
  description: string;
  documentRef?: string;
  lastVerified?: string; // dd/mm/yyyy
}

export interface ChecklistItemInput {
  itemNumber: number;
  implemented: boolean;
  partiallyImplemented?: boolean;
  evidence?: ChecklistEvidence[];
  notes?: string;
  lastReviewDate?: string; // dd/mm/yyyy
}

export interface ChecklistItemResult {
  itemNumber: number;
  title: string;
  category: string;
  regulatoryRef: string;
  ragStatus: RAGStatus;
  score: number; // 0 to maxScore
  maxScore: number;
  finding: string;
  evidence: ChecklistEvidence[];
  remediationRequired: boolean;
  remediationDeadlineDays: number | null;
  penaltyRiskAED: { min: number; max: number } | null;
}

export interface MoEQuarterlyReport {
  reportId: string;
  generatedAt: string;
  reportingPeriod: { from: string; to: string };
  entityName: string;
  licenseNumber: string;
  overallScore: number;
  maxPossibleScore: number;
  compliancePercentage: number;
  grade: ComplianceGrade;
  ragSummary: { green: number; amber: number; red: number };
  checklist: ChecklistItemResult[];
  criticalGaps: string[];
  remediationPlan: Array<{
    itemNumber: number;
    gap: string;
    action: string;
    deadlineDays: number;
    priority: 'critical' | 'high' | 'medium' | 'low';
  }>;
  penaltyExposure: { minAED: number; maxAED: number };
  recommendations: string[];
  auditTrail: Array<{ timestamp: string; action: string; detail: string }>;
}

// ---------------------------------------------------------------------------
// 25-Item MoE Checklist Definition
// ---------------------------------------------------------------------------

interface ChecklistDefinition {
  itemNumber: number;
  title: string;
  category: string;
  regulatoryRef: string;
  weight: number; // max score (1-4)
  criticalItem: boolean;
  remediationDays: number;
  penaltyMin: number;
  penaltyMax: number;
}

const MOE_CHECKLIST: ChecklistDefinition[] = [
  {
    itemNumber: 1,
    title: 'AML/CFT Policy & Procedures',
    category: 'Governance',
    regulatoryRef: 'FDL Art.20, Cabinet Res 134/2025 Art.5',
    weight: 4,
    criticalItem: true,
    remediationDays: 30,
    penaltyMin: 50_000,
    penaltyMax: 1_000_000,
  },
  {
    itemNumber: 2,
    title: 'Compliance Officer Appointment',
    category: 'Governance',
    regulatoryRef: 'FDL Art.20-21, Cabinet Res 134/2025 Art.18',
    weight: 4,
    criticalItem: true,
    remediationDays: 15,
    penaltyMin: 50_000,
    penaltyMax: 500_000,
  },
  {
    itemNumber: 3,
    title: 'CO Notification to MoE',
    category: 'Governance',
    regulatoryRef: 'Cabinet Res 134/2025 Art.18',
    weight: 3,
    criticalItem: false,
    remediationDays: 5,
    penaltyMin: 10_000,
    penaltyMax: 100_000,
  },
  {
    itemNumber: 4,
    title: 'Risk Assessment (Enterprise-wide)',
    category: 'Risk',
    regulatoryRef: 'FDL Art.12, Cabinet Res 134/2025 Art.5',
    weight: 4,
    criticalItem: true,
    remediationDays: 30,
    penaltyMin: 50_000,
    penaltyMax: 1_000_000,
  },
  {
    itemNumber: 5,
    title: 'Customer Risk Rating Methodology',
    category: 'Risk',
    regulatoryRef: 'Cabinet Res 134/2025 Art.7-10',
    weight: 3,
    criticalItem: false,
    remediationDays: 30,
    penaltyMin: 50_000,
    penaltyMax: 500_000,
  },
  {
    itemNumber: 6,
    title: 'CDD / KYC Procedures',
    category: 'CDD',
    regulatoryRef: 'FDL Art.12-14, Cabinet Res 134/2025 Art.7-10',
    weight: 4,
    criticalItem: true,
    remediationDays: 30,
    penaltyMin: 100_000,
    penaltyMax: 5_000_000,
  },
  {
    itemNumber: 7,
    title: 'EDD for High-Risk Customers',
    category: 'CDD',
    regulatoryRef: 'FDL Art.14, Cabinet Res 134/2025 Art.14',
    weight: 4,
    criticalItem: true,
    remediationDays: 15,
    penaltyMin: 100_000,
    penaltyMax: 5_000_000,
  },
  {
    itemNumber: 8,
    title: 'PEP Identification & EDD',
    category: 'CDD',
    regulatoryRef: 'Cabinet Res 134/2025 Art.14',
    weight: 4,
    criticalItem: true,
    remediationDays: 15,
    penaltyMin: 100_000,
    penaltyMax: 5_000_000,
  },
  {
    itemNumber: 9,
    title: 'Beneficial Ownership (UBO)',
    category: 'CDD',
    regulatoryRef: 'Cabinet Decision 109/2023',
    weight: 3,
    criticalItem: true,
    remediationDays: 15,
    penaltyMin: 50_000,
    penaltyMax: 1_000_000,
  },
  {
    itemNumber: 10,
    title: 'Ongoing Monitoring',
    category: 'Monitoring',
    regulatoryRef: 'FDL Art.12, Cabinet Res 134/2025 Art.7',
    weight: 4,
    criticalItem: true,
    remediationDays: 30,
    penaltyMin: 100_000,
    penaltyMax: 5_000_000,
  },
  {
    itemNumber: 11,
    title: 'Transaction Monitoring System',
    category: 'Monitoring',
    regulatoryRef: 'FDL Art.15-16, MoE Circular 08/AML/2021',
    weight: 4,
    criticalItem: true,
    remediationDays: 30,
    penaltyMin: 100_000,
    penaltyMax: 10_000_000,
  },
  {
    itemNumber: 12,
    title: 'Sanctions Screening (all lists)',
    category: 'Screening',
    regulatoryRef: 'FDL Art.35, Cabinet Res 74/2020',
    weight: 4,
    criticalItem: true,
    remediationDays: 5,
    penaltyMin: 200_000,
    penaltyMax: 10_000_000,
  },
  {
    itemNumber: 13,
    title: 'TFS / Asset Freeze Capability',
    category: 'Screening',
    regulatoryRef: 'Cabinet Res 74/2020 Art.4-7',
    weight: 4,
    criticalItem: true,
    remediationDays: 5,
    penaltyMin: 500_000,
    penaltyMax: 50_000_000,
  },
  {
    itemNumber: 14,
    title: 'goAML Registration & Access',
    category: 'Filing',
    regulatoryRef: 'MoE Circular 08/AML/2021',
    weight: 3,
    criticalItem: true,
    remediationDays: 10,
    penaltyMin: 50_000,
    penaltyMax: 500_000,
  },
  {
    itemNumber: 15,
    title: 'STR/SAR Filing Procedures',
    category: 'Filing',
    regulatoryRef: 'FDL Art.26-27',
    weight: 4,
    criticalItem: true,
    remediationDays: 10,
    penaltyMin: 100_000,
    penaltyMax: 5_000_000,
  },
  {
    itemNumber: 16,
    title: 'CTR / DPMSR Filing (AED 55K)',
    category: 'Filing',
    regulatoryRef: 'FDL Art.15-16, MoE Circular 08/AML/2021',
    weight: 3,
    criticalItem: false,
    remediationDays: 15,
    penaltyMin: 50_000,
    penaltyMax: 1_000_000,
  },
  {
    itemNumber: 17,
    title: 'Record Retention (5 years min)',
    category: 'Records',
    regulatoryRef: 'FDL Art.24',
    weight: 3,
    criticalItem: false,
    remediationDays: 30,
    penaltyMin: 50_000,
    penaltyMax: 500_000,
  },
  {
    itemNumber: 18,
    title: 'Staff Training Programme',
    category: 'Training',
    regulatoryRef: 'FDL Art.21, Cabinet Res 134/2025',
    weight: 3,
    criticalItem: false,
    remediationDays: 30,
    penaltyMin: 50_000,
    penaltyMax: 500_000,
  },
  {
    itemNumber: 19,
    title: 'Training Records & Attendance',
    category: 'Training',
    regulatoryRef: 'Cabinet Res 134/2025 Art.19',
    weight: 2,
    criticalItem: false,
    remediationDays: 15,
    penaltyMin: 10_000,
    penaltyMax: 100_000,
  },
  {
    itemNumber: 20,
    title: 'Independent Audit / Internal Review',
    category: 'Audit',
    regulatoryRef: 'Cabinet Res 134/2025 Art.19',
    weight: 3,
    criticalItem: false,
    remediationDays: 60,
    penaltyMin: 50_000,
    penaltyMax: 1_000_000,
  },
  {
    itemNumber: 21,
    title: 'PF Risk Assessment',
    category: 'PF',
    regulatoryRef: 'Cabinet Res 156/2025',
    weight: 3,
    criticalItem: false,
    remediationDays: 30,
    penaltyMin: 50_000,
    penaltyMax: 1_000_000,
  },
  {
    itemNumber: 22,
    title: 'Dual-Use Goods Screening',
    category: 'PF',
    regulatoryRef: 'Cabinet Res 156/2025',
    weight: 3,
    criticalItem: false,
    remediationDays: 30,
    penaltyMin: 50_000,
    penaltyMax: 1_000_000,
  },
  {
    itemNumber: 23,
    title: 'DPMS Quarterly Reporting',
    category: 'Reporting',
    regulatoryRef: 'MoE Circular 08/AML/2021',
    weight: 3,
    criticalItem: false,
    remediationDays: 15,
    penaltyMin: 50_000,
    penaltyMax: 500_000,
  },
  {
    itemNumber: 24,
    title: 'Supply Chain Due Diligence',
    category: 'Supply Chain',
    regulatoryRef: 'LBMA RGG v9, UAE MoE RSG Framework',
    weight: 3,
    criticalItem: false,
    remediationDays: 60,
    penaltyMin: 50_000,
    penaltyMax: 1_000_000,
  },
  {
    itemNumber: 25,
    title: 'Tipping-Off Controls',
    category: 'Controls',
    regulatoryRef: 'FDL Art.29',
    weight: 4,
    criticalItem: true,
    remediationDays: 5,
    penaltyMin: 100_000,
    penaltyMax: 5_000_000,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateUAE(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function getQuarterDates(date: Date): { from: string; to: string } {
  const month = date.getMonth();
  const year = date.getFullYear();
  const quarterStart = new Date(year, Math.floor(month / 3) * 3, 1);
  const quarterEnd = new Date(year, Math.floor(month / 3) * 3 + 3, 0);
  return {
    from: formatDateUAE(quarterStart),
    to: formatDateUAE(quarterEnd),
  };
}

function scoreItem(
  def: ChecklistDefinition,
  input: ChecklistItemInput | undefined
): ChecklistItemResult {
  let ragStatus: RAGStatus;
  let score: number;
  let finding: string;
  let remediationRequired: boolean;

  if (!input) {
    ragStatus = 'red';
    score = 0;
    finding = `Item not assessed. ${def.title} status unknown — requires immediate review.`;
    remediationRequired = true;
  } else if (input.implemented) {
    const hasEvidence =
      input.evidence !== null && input.evidence !== undefined && input.evidence.length > 0;
    const hasRecentReview = input.lastReviewDate !== null && input.lastReviewDate !== undefined;

    if (hasEvidence && hasRecentReview) {
      ragStatus = 'green';
      score = def.weight;
      finding = `Fully implemented with ${input.evidence!.length} evidence item(s). Last reviewed: ${input.lastReviewDate}.`;
      remediationRequired = false;
    } else if (hasEvidence || hasRecentReview) {
      ragStatus = 'green';
      score = def.weight;
      finding = `Implemented. ${!hasEvidence ? 'Evidence documentation recommended.' : 'Periodic review date not recorded.'}`;
      remediationRequired = false;
    } else {
      ragStatus = 'amber';
      score = Math.max(def.weight - 1, 1);
      finding = 'Reported as implemented but no supporting evidence or review date provided.';
      remediationRequired = true;
    }
  } else if (input.partiallyImplemented) {
    ragStatus = 'amber';
    score = Math.ceil(def.weight / 2);
    finding = `Partially implemented. ${input.notes ?? 'Gaps identified — full implementation required.'}`;
    remediationRequired = true;
  } else {
    ragStatus = 'red';
    score = 0;
    finding = `NOT IMPLEMENTED. ${def.criticalItem ? 'CRITICAL GAP — immediate remediation required.' : 'Remediation required before next inspection.'}`;
    remediationRequired = true;
  }

  return {
    itemNumber: def.itemNumber,
    title: def.title,
    category: def.category,
    regulatoryRef: def.regulatoryRef,
    ragStatus,
    score,
    maxScore: def.weight,
    finding,
    evidence: input?.evidence ?? [],
    remediationRequired,
    remediationDeadlineDays: remediationRequired ? def.remediationDays : null,
    penaltyRiskAED: remediationRequired ? { min: def.penaltyMin, max: def.penaltyMax } : null,
  };
}

function calculateGrade(percentage: number): ComplianceGrade {
  if (percentage >= 90) return 'A';
  if (percentage >= 75) return 'B';
  if (percentage >= 60) return 'C';
  if (percentage >= 40) return 'D';
  return 'F';
}

// ---------------------------------------------------------------------------
// Main function: generateMoEReport
// ---------------------------------------------------------------------------

export function generateMoEReport(input: {
  entityName: string;
  licenseNumber: string;
  checklistResponses: ChecklistItemInput[];
  reportDate?: string; // dd/mm/yyyy, defaults to today
}): ToolResult<MoEQuarterlyReport> {
  if (!input.entityName || !input.licenseNumber) {
    return { ok: false, error: 'entityName and licenseNumber are required.' };
  }
  if (!input.checklistResponses || input.checklistResponses.length === 0) {
    return { ok: false, error: 'checklistResponses must contain at least one item.' };
  }

  const now = new Date();
  const reportId = crypto.randomUUID();
  const generatedAt = formatDateUAE(now);
  const reportingPeriod = getQuarterDates(now);

  // Map input responses by item number
  const responseMap = new Map<number, ChecklistItemInput>();
  for (const resp of input.checklistResponses) {
    responseMap.set(resp.itemNumber, resp);
  }

  // Score each of the 25 checklist items
  const checklist: ChecklistItemResult[] = MOE_CHECKLIST.map((def) =>
    scoreItem(def, responseMap.get(def.itemNumber))
  );

  // Aggregate scores
  const totalScore = checklist.reduce((sum, item) => sum + item.score, 0);
  const maxPossibleScore = checklist.reduce((sum, item) => sum + item.maxScore, 0);
  const compliancePercentage =
    maxPossibleScore > 0 ? Math.round((totalScore / maxPossibleScore) * 100) : 0;
  const grade = calculateGrade(compliancePercentage);

  // RAG summary
  const ragSummary = {
    green: checklist.filter((i) => i.ragStatus === 'green').length,
    amber: checklist.filter((i) => i.ragStatus === 'amber').length,
    red: checklist.filter((i) => i.ragStatus === 'red').length,
  };

  // Identify critical gaps (red + critical item)
  const criticalGaps: string[] = [];
  for (const item of checklist) {
    const def = MOE_CHECKLIST.find((d) => d.itemNumber === item.itemNumber)!;
    if (item.ragStatus === 'red' && def.criticalItem) {
      criticalGaps.push(`Item ${item.itemNumber}: ${item.title} — ${item.finding}`);
    }
  }

  // Build prioritized remediation plan
  const remediationPlan = checklist
    .filter((item) => item.remediationRequired)
    .map((item) => {
      const def = MOE_CHECKLIST.find((d) => d.itemNumber === item.itemNumber)!;
      const priority: 'critical' | 'high' | 'medium' | 'low' =
        item.ragStatus === 'red' && def.criticalItem
          ? 'critical'
          : item.ragStatus === 'red'
            ? 'high'
            : item.ragStatus === 'amber' && def.criticalItem
              ? 'high'
              : item.ragStatus === 'amber'
                ? 'medium'
                : 'low';

      return {
        itemNumber: item.itemNumber,
        gap: `${item.title}: ${item.finding}`,
        action:
          item.ragStatus === 'red'
            ? `Implement ${item.title} immediately. Obtain evidence and document in compliance file.`
            : `Complete implementation of ${item.title}. Provide supporting evidence.`,
        deadlineDays: item.remediationDeadlineDays ?? 30,
        priority,
      };
    })
    .sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return order[a.priority] - order[b.priority];
    });

  // Calculate total penalty exposure
  const penaltyExposure = {
    minAED: checklist
      .filter((i) => i.penaltyRiskAED !== null && i.penaltyRiskAED !== undefined)
      .reduce((sum, i) => sum + (i.penaltyRiskAED?.min ?? 0), 0),
    maxAED: checklist
      .filter((i) => i.penaltyRiskAED !== null && i.penaltyRiskAED !== undefined)
      .reduce((sum, i) => sum + (i.penaltyRiskAED?.max ?? 0), 0),
  };

  // Recommendations
  const recommendations: string[] = [];
  if (criticalGaps.length > 0) {
    recommendations.push(
      `URGENT: ${criticalGaps.length} critical gap(s) identified. Address within 5 business days to avoid penalties (Cabinet Res 71/2024: AED 10K-100M range).`
    );
  }
  if (ragSummary.red > 0) {
    recommendations.push(
      `${ragSummary.red} item(s) scored RED. Prioritize remediation per the plan above.`
    );
  }
  if (ragSummary.amber > 0) {
    recommendations.push(
      `${ragSummary.amber} item(s) scored AMBER. Strengthen evidence and documentation.`
    );
  }
  if (grade === 'D' || grade === 'F') {
    recommendations.push(
      'Overall grade is below acceptable. Engage external AML consultants for immediate gap remediation.'
    );
  }
  if (compliancePercentage >= 90) {
    recommendations.push(
      'Strong compliance posture. Maintain through regular reviews and staff training refreshers.'
    );
  }
  if (checklist.find((i) => i.itemNumber === 12)?.ragStatus !== 'green') {
    recommendations.push(
      'Sanctions screening deficiency detected. Ensure ALL lists (UN, OFAC, EU, UK, UAE, EOCN) are checked.'
    );
  }
  if (checklist.find((i) => i.itemNumber === 15)?.ragStatus !== 'green') {
    recommendations.push(
      'STR filing procedures need attention. Ensure compliance with FDL Art.26-27 "without delay" requirement.'
    );
  }

  const auditTrail = [
    {
      timestamp: now.toISOString(),
      action: 'moe_report_generated',
      detail: `Quarterly report generated for ${input.entityName} (${input.licenseNumber}). Period: ${reportingPeriod.from} - ${reportingPeriod.to}.`,
    },
    {
      timestamp: now.toISOString(),
      action: 'scoring_complete',
      detail: `Score: ${totalScore}/${maxPossibleScore} (${compliancePercentage}%). Grade: ${grade}. RAG: ${ragSummary.green}G/${ragSummary.amber}A/${ragSummary.red}R.`,
    },
    {
      timestamp: now.toISOString(),
      action: 'penalty_exposure_calculated',
      detail: `Penalty exposure: AED ${penaltyExposure.minAED.toLocaleString()} - AED ${penaltyExposure.maxAED.toLocaleString()}.`,
    },
  ];

  const report: MoEQuarterlyReport = {
    reportId,
    generatedAt,
    reportingPeriod,
    entityName: input.entityName,
    licenseNumber: input.licenseNumber,
    overallScore: totalScore,
    maxPossibleScore,
    compliancePercentage,
    grade,
    ragSummary,
    checklist,
    criticalGaps,
    remediationPlan,
    penaltyExposure,
    recommendations,
    auditTrail,
  };

  return { ok: true, data: report };
}

// ---------------------------------------------------------------------------
// Tool: runReadinessCheck (25-item quick assessment)
// ---------------------------------------------------------------------------

export interface ReadinessDataSources {
  /** Number of customers with completed CDD */
  cddCompletedCount: number;
  /** Total active customers */
  totalActiveCustomers: number;
  /** Number of CDD renewals overdue */
  cddOverdueRenewals: number;
  /** Whether goAML is registered and accessible */
  goAMLRegistered: boolean;
  /** Number of STRs filed in the period */
  strsFiledCount: number;
  /** Number of STRs filed on time (within deadline) */
  strsFiledOnTime: number;
  /** Number of CTRs filed in the period */
  ctrsFiledCount: number;
  /** Number of CTRs filed on time */
  ctrsFiledOnTime: number;
  /** Whether sanctions screening covers all lists */
  allSanctionsListsActive: boolean;
  /** Number of sanctions screenings performed in period */
  screeningsPerformed: number;
  /** Whether TFS/asset freeze capability is operational */
  tfsFreezeCapabilityActive: boolean;
  /** Whether a Compliance Officer is appointed */
  complianceOfficerAppointed: boolean;
  /** Whether CO notification was sent to MoE */
  coNotifiedToMoE: boolean;
  /** Whether enterprise risk assessment is current (within 12 months) */
  riskAssessmentCurrent: boolean;
  /** Whether PF risk assessment is current */
  pfRiskAssessmentCurrent: boolean;
  /** Number of staff who completed AML training in period */
  staffTrained: number;
  /** Total staff requiring training */
  totalStaffRequiringTraining: number;
  /** Whether training records are maintained */
  trainingRecordsMaintained: boolean;
  /** Whether independent audit was conducted in last 12 months */
  independentAuditConducted: boolean;
  /** Last audit date (dd/mm/yyyy) */
  lastAuditDate?: string;
  /** Whether record retention policy meets 5yr minimum */
  recordRetentionCompliant: boolean;
  /** Whether supply chain DD is documented (LBMA RGG v9) */
  supplyChainDDDocumented: boolean;
  /** Whether tipping-off controls are in place */
  tippingOffControlsActive: boolean;
  /** Whether dual-use goods screening is implemented */
  dualUseScreeningActive: boolean;
  /** Whether DPMS quarterly reports have been submitted */
  dpmsQuarterlyReportSubmitted: boolean;
  /** Whether UBO register is maintained and current */
  uboRegisterCurrent: boolean;
  /** Whether PEP screening is active */
  pepScreeningActive: boolean;
  /** Whether EDD is applied to high-risk customers */
  eddAppliedToHighRisk: boolean;
}

export interface ReadinessCheckResult {
  reportId: string;
  checkedAt: string;
  entityName: string;
  overallReady: boolean;
  readinessScore: number; // 0-100
  readinessGrade: ComplianceGrade;
  items: ReadinessItem[];
  criticalBlockers: string[];
  actionItemsBeforeInspection: string[];
  estimatedPrepTimeDays: number;
  penaltyExposureIfFailed: { minAED: number; maxAED: number };
}

export interface ReadinessItem {
  itemNumber: number;
  title: string;
  category: string;
  ragStatus: RAGStatus;
  ready: boolean;
  finding: string;
  actionRequired?: string;
}

/**
 * Run a 25-item MoE inspection readiness check using live data source
 * summaries. Unlike generateMoEReport (which takes manual checklist responses),
 * this function assesses readiness from system data: CDD stats, filing
 * status, screening coverage, training records, audit status, etc.
 *
 * @regulatory MoE Circular 08/AML/2021, Cabinet Res 71/2024 (penalties)
 */
export function runReadinessCheck(input: {
  entityName: string;
  dataSources: ReadinessDataSources;
}): ToolResult<ReadinessCheckResult> {
  if (!input.entityName) {
    return { ok: false, error: 'Entity name is required.' };
  }

  const ds = input.dataSources;
  const items: ReadinessItem[] = [];
  let totalWeight = 0;
  let earnedWeight = 0;
  const criticalBlockers: string[] = [];
  const actionItems: string[] = [];

  // Helper to add an item
  const addItem = (
    itemNumber: number,
    title: string,
    category: string,
    weight: number,
    critical: boolean,
    ready: boolean,
    partial: boolean,
    finding: string,
    action?: string
  ) => {
    let ragStatus: RAGStatus;
    let earned: number;
    if (ready) {
      ragStatus = 'green';
      earned = weight;
    } else if (partial) {
      ragStatus = 'amber';
      earned = Math.ceil(weight / 2);
      if (action) actionItems.push(`Item ${itemNumber}: ${action}`);
    } else {
      ragStatus = 'red';
      earned = 0;
      if (critical) criticalBlockers.push(`Item ${itemNumber}: ${title} — ${finding}`);
      if (action) actionItems.push(`URGENT Item ${itemNumber}: ${action}`);
    }
    totalWeight += weight;
    earnedWeight += earned;
    items.push({ itemNumber, title, category, ragStatus, ready, finding, actionRequired: action });
  };

  // 1. AML/CFT Policy
  addItem(
    1,
    'AML/CFT Policy & Procedures',
    'Governance',
    4,
    true,
    ds.riskAssessmentCurrent,
    false,
    ds.riskAssessmentCurrent
      ? 'AML/CFT policy and risk assessment are current.'
      : 'Risk assessment is outdated. Policy review required.',
    ds.riskAssessmentCurrent
      ? undefined
      : 'Update enterprise risk assessment and AML/CFT policies within 30 days.'
  );

  // 2. CO Appointment
  addItem(
    2,
    'Compliance Officer Appointment',
    'Governance',
    4,
    true,
    ds.complianceOfficerAppointed,
    false,
    ds.complianceOfficerAppointed
      ? 'Compliance Officer is appointed.'
      : 'No Compliance Officer appointed.',
    ds.complianceOfficerAppointed
      ? undefined
      : 'Appoint a CO immediately and notify MoE per Cabinet Res 134/2025 Art.18.'
  );

  // 3. CO Notification
  addItem(
    3,
    'CO Notification to MoE',
    'Governance',
    3,
    false,
    ds.coNotifiedToMoE,
    false,
    ds.coNotifiedToMoE
      ? 'CO notification to MoE confirmed.'
      : 'CO notification to MoE not recorded.',
    ds.coNotifiedToMoE ? undefined : 'Submit CO notification to MoE within 5 days.'
  );

  // 4. Risk Assessment
  addItem(
    4,
    'Risk Assessment (Enterprise-wide)',
    'Risk',
    4,
    true,
    ds.riskAssessmentCurrent,
    false,
    ds.riskAssessmentCurrent
      ? 'Enterprise risk assessment is current.'
      : 'Enterprise risk assessment is outdated or missing.',
    ds.riskAssessmentCurrent ? undefined : 'Conduct enterprise-wide risk assessment per FDL Art.12.'
  );

  // 5. Customer Risk Rating
  const cddRate = ds.totalActiveCustomers > 0 ? ds.cddCompletedCount / ds.totalActiveCustomers : 0;
  addItem(
    5,
    'Customer Risk Rating Methodology',
    'Risk',
    3,
    false,
    cddRate >= 0.95,
    cddRate >= 0.7,
    `CDD completion rate: ${(cddRate * 100).toFixed(1)}% (${ds.cddCompletedCount}/${ds.totalActiveCustomers}).`,
    cddRate >= 0.95
      ? undefined
      : `Complete CDD for remaining ${ds.totalActiveCustomers - ds.cddCompletedCount} customers.`
  );

  // 6. CDD/KYC Procedures
  addItem(
    6,
    'CDD / KYC Procedures',
    'CDD',
    4,
    true,
    cddRate >= 0.95 && ds.cddOverdueRenewals === 0,
    cddRate >= 0.7,
    `CDD rate: ${(cddRate * 100).toFixed(1)}%. Overdue renewals: ${ds.cddOverdueRenewals}.`,
    ds.cddOverdueRenewals > 0
      ? `Address ${ds.cddOverdueRenewals} overdue CDD renewals immediately.`
      : undefined
  );

  // 7. EDD for High-Risk
  addItem(
    7,
    'EDD for High-Risk Customers',
    'CDD',
    4,
    true,
    ds.eddAppliedToHighRisk,
    false,
    ds.eddAppliedToHighRisk
      ? 'EDD is applied to all high-risk customers.'
      : 'EDD not consistently applied to high-risk customers.',
    ds.eddAppliedToHighRisk
      ? undefined
      : 'Implement EDD for all high-risk customers per Cabinet Res 134/2025 Art.14.'
  );

  // 8. PEP Identification
  addItem(
    8,
    'PEP Identification & EDD',
    'CDD',
    4,
    true,
    ds.pepScreeningActive,
    false,
    ds.pepScreeningActive ? 'PEP screening is active.' : 'PEP screening is not active.',
    ds.pepScreeningActive ? undefined : 'Activate PEP screening across all customer relationships.'
  );

  // 9. UBO
  addItem(
    9,
    'Beneficial Ownership (UBO)',
    'CDD',
    3,
    true,
    ds.uboRegisterCurrent,
    false,
    ds.uboRegisterCurrent ? 'UBO register is current.' : 'UBO register is not current.',
    ds.uboRegisterCurrent
      ? undefined
      : 'Update UBO register per Cabinet Decision 109/2023. Re-verify within 15 working days.'
  );

  // 10. Ongoing Monitoring
  addItem(
    10,
    'Ongoing Monitoring',
    'Monitoring',
    4,
    true,
    ds.screeningsPerformed > 0 && cddRate >= 0.9,
    ds.screeningsPerformed > 0,
    `${ds.screeningsPerformed} screenings performed. CDD coverage: ${(cddRate * 100).toFixed(1)}%.`,
    ds.screeningsPerformed === 0 ? 'Initiate ongoing monitoring program immediately.' : undefined
  );

  // 11. Transaction Monitoring
  addItem(
    11,
    'Transaction Monitoring System',
    'Monitoring',
    4,
    true,
    ds.ctrsFiledCount > 0 || ds.strsFiledCount > 0,
    true,
    `STRs filed: ${ds.strsFiledCount}. CTRs filed: ${ds.ctrsFiledCount}. System operational.`,
    undefined
  );

  // 12. Sanctions Screening
  addItem(
    12,
    'Sanctions Screening (all lists)',
    'Screening',
    4,
    true,
    ds.allSanctionsListsActive,
    false,
    ds.allSanctionsListsActive
      ? 'All sanctions lists (UN, OFAC, EU, UK, UAE, EOCN) are active.'
      : 'Not all sanctions lists are active.',
    ds.allSanctionsListsActive
      ? undefined
      : 'CRITICAL: Activate ALL sanctions lists per FDL Art.35. Never skip a list.'
  );

  // 13. TFS/Freeze Capability
  addItem(
    13,
    'TFS / Asset Freeze Capability',
    'Screening',
    4,
    true,
    ds.tfsFreezeCapabilityActive,
    false,
    ds.tfsFreezeCapabilityActive
      ? 'TFS freeze capability is operational (24h execution ready).'
      : 'TFS freeze capability NOT operational.',
    ds.tfsFreezeCapabilityActive
      ? undefined
      : 'CRITICAL: Implement asset freeze capability per Cabinet Res 74/2020. Must execute within 24 hours.'
  );

  // 14. goAML Registration
  addItem(
    14,
    'goAML Registration & Access',
    'Filing',
    3,
    true,
    ds.goAMLRegistered,
    false,
    ds.goAMLRegistered ? 'goAML registration confirmed and accessible.' : 'goAML not registered.',
    ds.goAMLRegistered
      ? undefined
      : 'Register with goAML per MoE Circular 08/AML/2021 within 10 business days.'
  );

  // 15. STR Filing Procedures
  const strOnTimeRate = ds.strsFiledCount > 0 ? ds.strsFiledOnTime / ds.strsFiledCount : 1;
  addItem(
    15,
    'STR/SAR Filing Procedures',
    'Filing',
    4,
    true,
    strOnTimeRate >= 1 && ds.goAMLRegistered,
    strOnTimeRate >= 0.8,
    `STR on-time rate: ${(strOnTimeRate * 100).toFixed(0)}% (${ds.strsFiledOnTime}/${ds.strsFiledCount}).`,
    strOnTimeRate < 1 ? 'Ensure all STRs are filed "without delay" per FDL Art.26-27.' : undefined
  );

  // 16. CTR/DPMSR Filing
  const ctrOnTimeRate = ds.ctrsFiledCount > 0 ? ds.ctrsFiledOnTime / ds.ctrsFiledCount : 1;
  addItem(
    16,
    'CTR / DPMSR Filing (AED 55K)',
    'Filing',
    3,
    false,
    ctrOnTimeRate >= 1,
    ctrOnTimeRate >= 0.8,
    `CTR on-time rate: ${(ctrOnTimeRate * 100).toFixed(0)}% (${ds.ctrsFiledOnTime}/${ds.ctrsFiledCount}).`,
    ctrOnTimeRate < 1 ? 'Ensure all CTRs filed within 15 business days.' : undefined
  );

  // 17. Record Retention
  addItem(
    17,
    'Record Retention (5 years min)',
    'Records',
    3,
    false,
    ds.recordRetentionCompliant,
    false,
    ds.recordRetentionCompliant
      ? 'Record retention policy meets minimum requirements.'
      : 'Record retention policy deficient.',
    ds.recordRetentionCompliant
      ? undefined
      : 'Implement record retention meeting 5-year minimum per FDL Art.24.'
  );

  // 18. Staff Training
  const trainingRate =
    ds.totalStaffRequiringTraining > 0 ? ds.staffTrained / ds.totalStaffRequiringTraining : 0;
  addItem(
    18,
    'Staff Training Programme',
    'Training',
    3,
    false,
    trainingRate >= 0.95,
    trainingRate >= 0.7,
    `Training completion: ${(trainingRate * 100).toFixed(0)}% (${ds.staffTrained}/${ds.totalStaffRequiringTraining}).`,
    trainingRate < 0.95
      ? `Complete training for remaining ${ds.totalStaffRequiringTraining - ds.staffTrained} staff members.`
      : undefined
  );

  // 19. Training Records
  addItem(
    19,
    'Training Records & Attendance',
    'Training',
    2,
    false,
    ds.trainingRecordsMaintained,
    false,
    ds.trainingRecordsMaintained
      ? 'Training records are maintained.'
      : 'Training records not maintained.',
    ds.trainingRecordsMaintained
      ? undefined
      : 'Implement training record system with attendance tracking.'
  );

  // 20. Independent Audit
  addItem(
    20,
    'Independent Audit / Internal Review',
    'Audit',
    3,
    false,
    ds.independentAuditConducted,
    false,
    ds.independentAuditConducted
      ? `Independent audit conducted. Last audit: ${ds.lastAuditDate ?? 'date not recorded'}.`
      : 'No independent audit conducted in the last 12 months.',
    ds.independentAuditConducted
      ? undefined
      : 'Schedule independent AML audit per Cabinet Res 134/2025 Art.19.'
  );

  // 21. PF Risk Assessment
  addItem(
    21,
    'PF Risk Assessment',
    'PF',
    3,
    false,
    ds.pfRiskAssessmentCurrent,
    false,
    ds.pfRiskAssessmentCurrent
      ? 'PF risk assessment is current.'
      : 'PF risk assessment is outdated or missing.',
    ds.pfRiskAssessmentCurrent ? undefined : 'Conduct PF risk assessment per Cabinet Res 156/2025.'
  );

  // 22. Dual-Use Screening
  addItem(
    22,
    'Dual-Use Goods Screening',
    'PF',
    3,
    false,
    ds.dualUseScreeningActive,
    false,
    ds.dualUseScreeningActive
      ? 'Dual-use goods screening is active.'
      : 'Dual-use goods screening not implemented.',
    ds.dualUseScreeningActive
      ? undefined
      : 'Implement dual-use/strategic goods screening per Cabinet Res 156/2025.'
  );

  // 23. DPMS Quarterly Reporting
  addItem(
    23,
    'DPMS Quarterly Reporting',
    'Reporting',
    3,
    false,
    ds.dpmsQuarterlyReportSubmitted,
    false,
    ds.dpmsQuarterlyReportSubmitted
      ? 'DPMS quarterly report submitted.'
      : 'DPMS quarterly report NOT submitted.',
    ds.dpmsQuarterlyReportSubmitted
      ? undefined
      : 'Submit DPMS quarterly report per MoE Circular 08/AML/2021.'
  );

  // 24. Supply Chain DD
  addItem(
    24,
    'Supply Chain Due Diligence',
    'Supply Chain',
    3,
    false,
    ds.supplyChainDDDocumented,
    false,
    ds.supplyChainDDDocumented
      ? 'Supply chain DD is documented per LBMA RGG v9.'
      : 'Supply chain DD not documented.',
    ds.supplyChainDDDocumented
      ? undefined
      : 'Document supply chain DD per LBMA RGG v9 and UAE MoE RSG Framework.'
  );

  // 25. Tipping-Off Controls
  addItem(
    25,
    'Tipping-Off Controls',
    'Controls',
    4,
    true,
    ds.tippingOffControlsActive,
    false,
    ds.tippingOffControlsActive
      ? 'Tipping-off controls are active (FDL Art.29).'
      : 'Tipping-off controls NOT active.',
    ds.tippingOffControlsActive
      ? undefined
      : 'CRITICAL: Implement tipping-off controls per FDL Art.29. Staff training required.'
  );

  // Calculate readiness
  const readinessScore = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0;
  const readinessGrade = calculateGrade(readinessScore);
  const overallReady = criticalBlockers.length === 0 && readinessScore >= 75;

  // Estimate prep time
  let estimatedPrepTimeDays = 0;
  if (criticalBlockers.length > 0) estimatedPrepTimeDays += 15;
  const amberCount = items.filter((i) => i.ragStatus === 'amber').length;
  const redCount = items.filter((i) => i.ragStatus === 'red').length;
  estimatedPrepTimeDays += redCount * 5 + amberCount * 2;
  estimatedPrepTimeDays = Math.max(estimatedPrepTimeDays, criticalBlockers.length > 0 ? 15 : 0);

  // Penalty exposure for non-ready items
  const penaltyExposure = {
    minAED: items
      .filter((i) => !i.ready)
      .reduce((sum, i) => {
        const def = MOE_CHECKLIST.find((d) => d.itemNumber === i.itemNumber);
        return sum + (def?.penaltyMin ?? 0);
      }, 0),
    maxAED: items
      .filter((i) => !i.ready)
      .reduce((sum, i) => {
        const def = MOE_CHECKLIST.find((d) => d.itemNumber === i.itemNumber);
        return sum + (def?.penaltyMax ?? 0);
      }, 0),
  };

  return {
    ok: true,
    data: {
      reportId: crypto.randomUUID(),
      checkedAt: formatDateUAE(new Date()),
      entityName: input.entityName,
      overallReady,
      readinessScore,
      readinessGrade,
      items,
      criticalBlockers,
      actionItemsBeforeInspection: actionItems,
      estimatedPrepTimeDays,
      penaltyExposureIfFailed: penaltyExposure,
    },
  };
}

// ---------------------------------------------------------------------------
// Tool Schemas
// ---------------------------------------------------------------------------

export const MOE_REPORT_TOOL_SCHEMAS = [
  {
    name: 'generate_moe_report',
    description:
      'Generate a Ministry of Economy quarterly compliance report. Evaluates 25-item inspection checklist with RAG scoring, calculates overall compliance grade (A-F), identifies critical gaps, builds a prioritized remediation plan, and estimates penalty exposure under Cabinet Res 71/2024.',
    inputSchema: {
      type: 'object',
      properties: {
        entityName: { type: 'string', description: 'Registered name of the DPMS entity' },
        licenseNumber: { type: 'string', description: 'MoE trade license number' },
        checklistResponses: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              itemNumber: { type: 'number', description: 'Checklist item number (1-25)' },
              implemented: {
                type: 'boolean',
                description: 'Whether the item is fully implemented',
              },
              partiallyImplemented: {
                type: 'boolean',
                description: 'Whether the item is partially implemented',
              },
              evidence: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    description: { type: 'string' },
                    documentRef: { type: 'string' },
                    lastVerified: { type: 'string', description: 'dd/mm/yyyy format' },
                  },
                  required: ['description'],
                },
                description: 'Supporting evidence for the item',
              },
              notes: { type: 'string', description: 'Additional notes or comments' },
              lastReviewDate: {
                type: 'string',
                description: 'Last review date in dd/mm/yyyy format',
              },
            },
            required: ['itemNumber', 'implemented'],
          },
          description: 'Responses for each checklist item (items 1-25)',
        },
        reportDate: {
          type: 'string',
          description: 'Report date in dd/mm/yyyy format (defaults to today)',
        },
      },
      required: ['entityName', 'licenseNumber', 'checklistResponses'],
    },
  },
  {
    name: 'run_readiness_check',
    description:
      'Run a 25-item MoE inspection readiness assessment using live system data (CDD stats, filing status, screening coverage, training records, audit status). Unlike generate_moe_report which takes manual responses, this auto-assesses from data sources. Returns readiness score, critical blockers, action items, estimated prep time, and penalty exposure. Regulatory: MoE Circular 08/AML/2021, Cabinet Res 71/2024.',
    inputSchema: {
      type: 'object',
      properties: {
        entityName: { type: 'string', description: 'Entity name being assessed' },
        dataSources: {
          type: 'object',
          description: 'Live data source summaries for readiness assessment',
          properties: {
            cddCompletedCount: {
              type: 'number',
              description: 'Number of customers with completed CDD',
            },
            totalActiveCustomers: { type: 'number', description: 'Total active customers' },
            cddOverdueRenewals: { type: 'number', description: 'Number of overdue CDD renewals' },
            goAMLRegistered: { type: 'boolean' },
            strsFiledCount: { type: 'number' },
            strsFiledOnTime: { type: 'number' },
            ctrsFiledCount: { type: 'number' },
            ctrsFiledOnTime: { type: 'number' },
            allSanctionsListsActive: {
              type: 'boolean',
              description: 'All 6 lists (UN, OFAC, EU, UK, UAE, EOCN) active',
            },
            screeningsPerformed: { type: 'number' },
            tfsFreezeCapabilityActive: { type: 'boolean' },
            complianceOfficerAppointed: { type: 'boolean' },
            coNotifiedToMoE: { type: 'boolean' },
            riskAssessmentCurrent: { type: 'boolean' },
            pfRiskAssessmentCurrent: { type: 'boolean' },
            staffTrained: { type: 'number' },
            totalStaffRequiringTraining: { type: 'number' },
            trainingRecordsMaintained: { type: 'boolean' },
            independentAuditConducted: { type: 'boolean' },
            lastAuditDate: { type: 'string', description: 'dd/mm/yyyy' },
            recordRetentionCompliant: { type: 'boolean' },
            supplyChainDDDocumented: { type: 'boolean' },
            tippingOffControlsActive: { type: 'boolean' },
            dualUseScreeningActive: { type: 'boolean' },
            dpmsQuarterlyReportSubmitted: { type: 'boolean' },
            uboRegisterCurrent: { type: 'boolean' },
            pepScreeningActive: { type: 'boolean' },
            eddAppliedToHighRisk: { type: 'boolean' },
          },
          required: [
            'cddCompletedCount',
            'totalActiveCustomers',
            'cddOverdueRenewals',
            'goAMLRegistered',
            'strsFiledCount',
            'strsFiledOnTime',
            'ctrsFiledCount',
            'ctrsFiledOnTime',
            'allSanctionsListsActive',
            'screeningsPerformed',
            'tfsFreezeCapabilityActive',
            'complianceOfficerAppointed',
            'coNotifiedToMoE',
            'riskAssessmentCurrent',
            'pfRiskAssessmentCurrent',
            'staffTrained',
            'totalStaffRequiringTraining',
            'trainingRecordsMaintained',
            'independentAuditConducted',
            'recordRetentionCompliant',
            'supplyChainDDDocumented',
            'tippingOffControlsActive',
            'dualUseScreeningActive',
            'dpmsQuarterlyReportSubmitted',
            'uboRegisterCurrent',
            'pepScreeningActive',
            'eddAppliedToHighRisk',
          ],
        },
      },
      required: ['entityName', 'dataSources'],
    },
  },
];
