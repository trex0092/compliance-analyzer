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
  { itemNumber: 1, title: 'AML/CFT Policy & Procedures', category: 'Governance', regulatoryRef: 'FDL Art.20, Cabinet Res 134/2025 Art.5', weight: 4, criticalItem: true, remediationDays: 30, penaltyMin: 50_000, penaltyMax: 1_000_000 },
  { itemNumber: 2, title: 'Compliance Officer Appointment', category: 'Governance', regulatoryRef: 'FDL Art.20-21, Cabinet Res 134/2025 Art.18', weight: 4, criticalItem: true, remediationDays: 15, penaltyMin: 50_000, penaltyMax: 500_000 },
  { itemNumber: 3, title: 'CO Notification to MoE', category: 'Governance', regulatoryRef: 'Cabinet Res 134/2025 Art.18', weight: 3, criticalItem: false, remediationDays: 5, penaltyMin: 10_000, penaltyMax: 100_000 },
  { itemNumber: 4, title: 'Risk Assessment (Enterprise-wide)', category: 'Risk', regulatoryRef: 'FDL Art.12, Cabinet Res 134/2025 Art.5', weight: 4, criticalItem: true, remediationDays: 30, penaltyMin: 50_000, penaltyMax: 1_000_000 },
  { itemNumber: 5, title: 'Customer Risk Rating Methodology', category: 'Risk', regulatoryRef: 'Cabinet Res 134/2025 Art.7-10', weight: 3, criticalItem: false, remediationDays: 30, penaltyMin: 50_000, penaltyMax: 500_000 },
  { itemNumber: 6, title: 'CDD / KYC Procedures', category: 'CDD', regulatoryRef: 'FDL Art.12-14, Cabinet Res 134/2025 Art.7-10', weight: 4, criticalItem: true, remediationDays: 30, penaltyMin: 100_000, penaltyMax: 5_000_000 },
  { itemNumber: 7, title: 'EDD for High-Risk Customers', category: 'CDD', regulatoryRef: 'FDL Art.14, Cabinet Res 134/2025 Art.14', weight: 4, criticalItem: true, remediationDays: 15, penaltyMin: 100_000, penaltyMax: 5_000_000 },
  { itemNumber: 8, title: 'PEP Identification & EDD', category: 'CDD', regulatoryRef: 'Cabinet Res 134/2025 Art.14', weight: 4, criticalItem: true, remediationDays: 15, penaltyMin: 100_000, penaltyMax: 5_000_000 },
  { itemNumber: 9, title: 'Beneficial Ownership (UBO)', category: 'CDD', regulatoryRef: 'Cabinet Decision 109/2023', weight: 3, criticalItem: true, remediationDays: 15, penaltyMin: 50_000, penaltyMax: 1_000_000 },
  { itemNumber: 10, title: 'Ongoing Monitoring', category: 'Monitoring', regulatoryRef: 'FDL Art.12, Cabinet Res 134/2025 Art.7', weight: 4, criticalItem: true, remediationDays: 30, penaltyMin: 100_000, penaltyMax: 5_000_000 },
  { itemNumber: 11, title: 'Transaction Monitoring System', category: 'Monitoring', regulatoryRef: 'FDL Art.15-16, MoE Circular 08/AML/2021', weight: 4, criticalItem: true, remediationDays: 30, penaltyMin: 100_000, penaltyMax: 10_000_000 },
  { itemNumber: 12, title: 'Sanctions Screening (all lists)', category: 'Screening', regulatoryRef: 'FDL Art.35, Cabinet Res 74/2020', weight: 4, criticalItem: true, remediationDays: 5, penaltyMin: 200_000, penaltyMax: 10_000_000 },
  { itemNumber: 13, title: 'TFS / Asset Freeze Capability', category: 'Screening', regulatoryRef: 'Cabinet Res 74/2020 Art.4-7', weight: 4, criticalItem: true, remediationDays: 5, penaltyMin: 500_000, penaltyMax: 50_000_000 },
  { itemNumber: 14, title: 'goAML Registration & Access', category: 'Filing', regulatoryRef: 'MoE Circular 08/AML/2021', weight: 3, criticalItem: true, remediationDays: 10, penaltyMin: 50_000, penaltyMax: 500_000 },
  { itemNumber: 15, title: 'STR/SAR Filing Procedures', category: 'Filing', regulatoryRef: 'FDL Art.26-27', weight: 4, criticalItem: true, remediationDays: 10, penaltyMin: 100_000, penaltyMax: 5_000_000 },
  { itemNumber: 16, title: 'CTR / DPMSR Filing (AED 55K)', category: 'Filing', regulatoryRef: 'FDL Art.15-16, MoE Circular 08/AML/2021', weight: 3, criticalItem: false, remediationDays: 15, penaltyMin: 50_000, penaltyMax: 1_000_000 },
  { itemNumber: 17, title: 'Record Retention (5 years min)', category: 'Records', regulatoryRef: 'FDL Art.24', weight: 3, criticalItem: false, remediationDays: 30, penaltyMin: 50_000, penaltyMax: 500_000 },
  { itemNumber: 18, title: 'Staff Training Programme', category: 'Training', regulatoryRef: 'FDL Art.21, Cabinet Res 134/2025', weight: 3, criticalItem: false, remediationDays: 30, penaltyMin: 50_000, penaltyMax: 500_000 },
  { itemNumber: 19, title: 'Training Records & Attendance', category: 'Training', regulatoryRef: 'Cabinet Res 134/2025 Art.19', weight: 2, criticalItem: false, remediationDays: 15, penaltyMin: 10_000, penaltyMax: 100_000 },
  { itemNumber: 20, title: 'Independent Audit / Internal Review', category: 'Audit', regulatoryRef: 'Cabinet Res 134/2025 Art.19', weight: 3, criticalItem: false, remediationDays: 60, penaltyMin: 50_000, penaltyMax: 1_000_000 },
  { itemNumber: 21, title: 'PF Risk Assessment', category: 'PF', regulatoryRef: 'Cabinet Res 156/2025', weight: 3, criticalItem: false, remediationDays: 30, penaltyMin: 50_000, penaltyMax: 1_000_000 },
  { itemNumber: 22, title: 'Dual-Use Goods Screening', category: 'PF', regulatoryRef: 'Cabinet Res 156/2025', weight: 3, criticalItem: false, remediationDays: 30, penaltyMin: 50_000, penaltyMax: 1_000_000 },
  { itemNumber: 23, title: 'DPMS Quarterly Reporting', category: 'Reporting', regulatoryRef: 'MoE Circular 08/AML/2021', weight: 3, criticalItem: false, remediationDays: 15, penaltyMin: 50_000, penaltyMax: 500_000 },
  { itemNumber: 24, title: 'Supply Chain Due Diligence', category: 'Supply Chain', regulatoryRef: 'LBMA RGG v9, UAE MoE RSG Framework', weight: 3, criticalItem: false, remediationDays: 60, penaltyMin: 50_000, penaltyMax: 1_000_000 },
  { itemNumber: 25, title: 'Tipping-Off Controls', category: 'Controls', regulatoryRef: 'FDL Art.29', weight: 4, criticalItem: true, remediationDays: 5, penaltyMin: 100_000, penaltyMax: 5_000_000 },
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
  input: ChecklistItemInput | undefined,
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
    const hasEvidence = input.evidence != null && input.evidence.length > 0;
    const hasRecentReview = input.lastReviewDate != null;

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
    scoreItem(def, responseMap.get(def.itemNumber)),
  );

  // Aggregate scores
  const totalScore = checklist.reduce((sum, item) => sum + item.score, 0);
  const maxPossibleScore = checklist.reduce((sum, item) => sum + item.maxScore, 0);
  const compliancePercentage = maxPossibleScore > 0 ? Math.round((totalScore / maxPossibleScore) * 100) : 0;
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
        item.ragStatus === 'red' && def.criticalItem ? 'critical' :
        item.ragStatus === 'red' ? 'high' :
        item.ragStatus === 'amber' && def.criticalItem ? 'high' :
        item.ragStatus === 'amber' ? 'medium' :
        'low';

      return {
        itemNumber: item.itemNumber,
        gap: `${item.title}: ${item.finding}`,
        action: item.ragStatus === 'red'
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
      .filter((i) => i.penaltyRiskAED != null)
      .reduce((sum, i) => sum + (i.penaltyRiskAED?.min ?? 0), 0),
    maxAED: checklist
      .filter((i) => i.penaltyRiskAED != null)
      .reduce((sum, i) => sum + (i.penaltyRiskAED?.max ?? 0), 0),
  };

  // Recommendations
  const recommendations: string[] = [];
  if (criticalGaps.length > 0) {
    recommendations.push(
      `URGENT: ${criticalGaps.length} critical gap(s) identified. Address within 5 business days to avoid penalties (Cabinet Res 71/2024: AED 10K-100M range).`,
    );
  }
  if (ragSummary.red > 0) {
    recommendations.push(`${ragSummary.red} item(s) scored RED. Prioritize remediation per the plan above.`);
  }
  if (ragSummary.amber > 0) {
    recommendations.push(`${ragSummary.amber} item(s) scored AMBER. Strengthen evidence and documentation.`);
  }
  if (grade === 'D' || grade === 'F') {
    recommendations.push('Overall grade is below acceptable. Engage external AML consultants for immediate gap remediation.');
  }
  if (compliancePercentage >= 90) {
    recommendations.push('Strong compliance posture. Maintain through regular reviews and staff training refreshers.');
  }
  if (checklist.find((i) => i.itemNumber === 12)?.ragStatus !== 'green') {
    recommendations.push('Sanctions screening deficiency detected. Ensure ALL lists (UN, OFAC, EU, UK, UAE, EOCN) are checked.');
  }
  if (checklist.find((i) => i.itemNumber === 15)?.ragStatus !== 'green') {
    recommendations.push('STR filing procedures need attention. Ensure compliance with FDL Art.26-27 "without delay" requirement.');
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
              implemented: { type: 'boolean', description: 'Whether the item is fully implemented' },
              partiallyImplemented: { type: 'boolean', description: 'Whether the item is partially implemented' },
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
              lastReviewDate: { type: 'string', description: 'Last review date in dd/mm/yyyy format' },
            },
            required: ['itemNumber', 'implemented'],
          },
          description: 'Responses for each checklist item (items 1-25)',
        },
        reportDate: { type: 'string', description: 'Report date in dd/mm/yyyy format (defaults to today)' },
      },
      required: ['entityName', 'licenseNumber', 'checklistResponses'],
    },
  },
];
