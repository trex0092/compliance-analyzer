/**
 * UAE DPMS Compliance KPI Framework
 *
 * Complete KPI definitions for Dealers in Precious Metals & Stones
 * per MoE, EOCN, FIU, FATF, and LBMA requirements.
 *
 * Each KPI has:
 *   - Regulatory basis
 *   - Target/threshold
 *   - Measurement frequency
 *   - Data source
 *   - RAG (Red/Amber/Green) status logic
 */

import {
  DPMS_CASH_THRESHOLD_AED,
  STR_FILING_DEADLINE_BUSINESS_DAYS,
  CTR_FILING_DEADLINE_BUSINESS_DAYS,
  CNMR_FILING_DEADLINE_BUSINESS_DAYS,
  CDD_REVIEW_HIGH_RISK_MONTHS,
  CDD_REVIEW_MEDIUM_RISK_MONTHS,
  CDD_REVIEW_LOW_RISK_MONTHS,
  RECORD_RETENTION_YEARS,
  UBO_OWNERSHIP_THRESHOLD_PCT,
  UBO_REVERIFICATION_WORKING_DAYS,
} from '../domain/constants';

// ─── Types ──────────────────────────────────────────────────────────────────

export type RAGStatus = 'green' | 'amber' | 'red';
export type KPIFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
export type KPICategory =
  | 'cdd-kyc'
  | 'screening-tfs'
  | 'reporting-fiu'
  | 'risk-assessment'
  | 'training'
  | 'supply-chain'
  | 'governance'
  | 'record-keeping';

export interface KPIDefinition {
  id: string;
  name: string;
  category: KPICategory;
  description: string;
  regulatoryBasis: string;
  reportingBody: string;
  frequency: KPIFrequency;
  targetValue: number;
  targetUnit: string;
  ragThresholds: { green: number; amber: number };
  inverse?: boolean; // true = lower is better
}

export interface KPIMeasurement {
  kpiId: string;
  value: number;
  ragStatus: RAGStatus;
  period: string;
  measuredAt: string;
  details?: string;
}

export interface KPIReport {
  reportTitle: string;
  entity: string;
  period: string;
  generatedAt: string;
  generatedBy: string;
  overallScore: number;
  overallRAG: RAGStatus;
  categories: KPICategoryReport[];
  summary: KPISummary;
}

export interface KPICategoryReport {
  category: KPICategory;
  categoryName: string;
  score: number;
  rag: RAGStatus;
  kpis: KPIMeasurement[];
}

export interface KPISummary {
  totalKPIs: number;
  greenCount: number;
  amberCount: number;
  redCount: number;
  criticalFindings: string[];
  recommendations: string[];
}

// ─── KPI Definitions (UAE DPMS) ─────────────────────────────────────────────

export const DPMS_KPI_DEFINITIONS: KPIDefinition[] = [
  // ── CDD / KYC ──────────────────────────────────────────────────────────
  {
    id: 'KPI-CDD-001',
    name: 'CDD Completion Rate',
    category: 'cdd-kyc',
    description: 'Percentage of customers with completed CDD files',
    regulatoryBasis: 'FDL No.10/2025 Art.12-13, Cabinet Res 134/2025 Art.7-10',
    reportingBody: 'MoE',
    frequency: 'monthly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 95, amber: 80 },
  },
  {
    id: 'KPI-CDD-002',
    name: 'CDD Review Timeliness',
    category: 'cdd-kyc',
    description: `Periodic CDD reviews completed on time (High: ${CDD_REVIEW_HIGH_RISK_MONTHS}mo, Medium: ${CDD_REVIEW_MEDIUM_RISK_MONTHS}mo, Low: ${CDD_REVIEW_LOW_RISK_MONTHS}mo)`,
    regulatoryBasis: 'Cabinet Res 134/2025 Art.9, FDL Art.14',
    reportingBody: 'MoE',
    frequency: 'monthly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 90, amber: 75 },
  },
  {
    id: 'KPI-CDD-003',
    name: 'EDD Completion for High-Risk Customers',
    category: 'cdd-kyc',
    description: 'High-risk and PEP customers with completed EDD',
    regulatoryBasis: 'FDL Art.14, Cabinet Res 134/2025 Art.14',
    reportingBody: 'MoE',
    frequency: 'monthly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 90 },
  },
  {
    id: 'KPI-CDD-004',
    name: 'UBO Register Completeness',
    category: 'cdd-kyc',
    description: `All customers with identified UBOs (>${UBO_OWNERSHIP_THRESHOLD_PCT * 100}% threshold)`,
    regulatoryBasis: 'Cabinet Decision 109/2023',
    reportingBody: 'MoE',
    frequency: 'monthly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 90 },
  },
  {
    id: 'KPI-CDD-005',
    name: 'UBO Re-verification Timeliness',
    category: 'cdd-kyc',
    description: `UBO changes re-verified within ${UBO_REVERIFICATION_WORKING_DAYS} working days`,
    regulatoryBasis: 'Cabinet Decision 109/2023',
    reportingBody: 'MoE',
    frequency: 'quarterly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 85 },
  },
  {
    id: 'KPI-CDD-006',
    name: 'Evidence Completeness',
    category: 'cdd-kyc',
    description: 'KYC/CDD evidence files complete with all required documents',
    regulatoryBasis: 'FDL Art.12, MoE DPMS Guidance',
    reportingBody: 'MoE',
    frequency: 'monthly',
    targetValue: 95,
    targetUnit: '%',
    ragThresholds: { green: 90, amber: 75 },
  },

  // ── Screening & TFS ───────────────────────────────────────────────────
  {
    id: 'KPI-TFS-001',
    name: 'Sanctions Screening Coverage',
    category: 'screening-tfs',
    description: 'Customers screened at onboarding against all required lists',
    regulatoryBasis: 'Cabinet Res 74/2020, FDL Art.35',
    reportingBody: 'EOCN',
    frequency: 'monthly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 95 },
  },
  {
    id: 'KPI-TFS-002',
    name: 'Sanctions List Currency',
    category: 'screening-tfs',
    description: 'Days since last sanctions list refresh (UN, OFAC, EU, UK, UAE)',
    regulatoryBasis: 'Cabinet Res 74/2020 Art.4-7',
    reportingBody: 'EOCN',
    frequency: 'daily',
    targetValue: 1,
    targetUnit: 'days',
    ragThresholds: { green: 1, amber: 7 },
    inverse: true,
  },
  {
    id: 'KPI-TFS-003',
    name: 'Asset Freeze Response Time',
    category: 'screening-tfs',
    description:
      'Time to execute asset freeze after confirmed match (target: IMMEDIATE, EOCN TFS Guidance 2025)',
    regulatoryBasis: 'Cabinet Res 74/2020 Art.4, EOCN TFS Guidance July 2025, FDL Art.22-23',
    reportingBody: 'EOCN',
    frequency: 'quarterly',
    targetValue: 0,
    targetUnit: 'hours',
    ragThresholds: { green: 1, amber: 2 },
    inverse: true,
  },
  {
    id: 'KPI-TFS-004',
    name: 'CNMR Filing Timeliness',
    category: 'screening-tfs',
    description: `CNMR filed within ${CNMR_FILING_DEADLINE_BUSINESS_DAYS} business days of confirmed match`,
    regulatoryBasis: 'Cabinet Res 74/2020 Art.6',
    reportingBody: 'EOCN',
    frequency: 'quarterly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 90 },
  },
  {
    id: 'KPI-TFS-005',
    name: 'Re-screening After List Updates',
    category: 'screening-tfs',
    description: 'Full customer base re-screened within 24h of sanctions list update',
    regulatoryBasis: 'Cabinet Res 74/2020, EOCN TFS Guidance',
    reportingBody: 'EOCN',
    frequency: 'quarterly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 80 },
  },
  {
    id: 'KPI-TFS-006',
    name: 'PEP Screening Rate',
    category: 'screening-tfs',
    description: 'Customers screened for PEP status at onboarding and annually',
    regulatoryBasis: 'FDL Art.18, Cabinet Res 134/2025 Art.14, FATF Rec 12',
    reportingBody: 'MoE',
    frequency: 'quarterly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 90 },
  },

  // ── FIU Reporting ─────────────────────────────────────────────────────
  {
    id: 'KPI-FIU-001',
    name: 'STR Filing Timeliness',
    category: 'reporting-fiu',
    description: `STR/SAR filed within ${STR_FILING_DEADLINE_BUSINESS_DAYS} business days`,
    regulatoryBasis: 'FDL Art.26-27',
    reportingBody: 'FIU',
    frequency: 'quarterly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 90 },
  },
  {
    id: 'KPI-FIU-002',
    name: 'CTR/DPMSR Filing Timeliness',
    category: 'reporting-fiu',
    description: `CTR filed within ${CTR_FILING_DEADLINE_BUSINESS_DAYS} business days for cash >= AED ${DPMS_CASH_THRESHOLD_AED.toLocaleString()}`,
    regulatoryBasis: 'FDL Art.16, MoE Circular 08/AML/2021',
    reportingBody: 'FIU',
    frequency: 'quarterly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 90 },
  },
  {
    id: 'KPI-FIU-003',
    name: 'goAML Registration Active',
    category: 'reporting-fiu',
    description: 'Entity registered and active on goAML portal',
    regulatoryBasis: 'MoE Circular 08/AML/2021',
    reportingBody: 'FIU',
    frequency: 'annual',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 0 },
  },
  {
    id: 'KPI-FIU-004',
    name: 'Quarterly DPMS Report Submitted',
    category: 'reporting-fiu',
    description: 'Quarterly DPMS activity report submitted to MoE via goAML',
    regulatoryBasis: 'MoE Circular 08/AML/2021, FDL Art.25',
    reportingBody: 'FIU',
    frequency: 'quarterly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 0 },
  },
  {
    id: 'KPI-FIU-005',
    name: 'FIU Information Request Response',
    category: 'reporting-fiu',
    description: 'FIU information requests responded to within deadline',
    regulatoryBasis: 'FDL Art.14 & 42',
    reportingBody: 'FIU',
    frequency: 'quarterly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 80 },
  },
  {
    id: 'KPI-FIU-006',
    name: 'No Tipping-Off Compliance',
    category: 'reporting-fiu',
    description: 'Zero tipping-off incidents (STR/SAR subject not notified)',
    regulatoryBasis: 'FDL Art.29',
    reportingBody: 'FIU',
    frequency: 'quarterly',
    targetValue: 0,
    targetUnit: 'incidents',
    ragThresholds: { green: 0, amber: 0 },
    inverse: true,
  },

  // ── Risk Assessment ───────────────────────────────────────────────────
  {
    id: 'KPI-RA-001',
    name: 'EWRA Currency',
    category: 'risk-assessment',
    description: 'Enterprise-Wide Risk Assessment updated within last 12 months',
    regulatoryBasis: 'Cabinet Res 134/2025 Art.5, FDL Art.20',
    reportingBody: 'MoE',
    frequency: 'annual',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 0 },
  },
  {
    id: 'KPI-RA-002',
    name: 'Risk Appetite Adherence',
    category: 'risk-assessment',
    description: 'Business operations within approved risk appetite thresholds',
    regulatoryBasis: 'Cabinet Res 134/2025 Art.5',
    reportingBody: 'MoE',
    frequency: 'quarterly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 85 },
  },
  {
    id: 'KPI-RA-003',
    name: 'Transaction Monitoring Alert Resolution',
    category: 'risk-assessment',
    description: 'TM alerts resolved within 5 business days',
    regulatoryBasis: 'FDL Art.15, MoE DPMS Guidance',
    reportingBody: 'MoE',
    frequency: 'monthly',
    targetValue: 95,
    targetUnit: '%',
    ragThresholds: { green: 90, amber: 75 },
  },

  // ── Training ──────────────────────────────────────────────────────────
  {
    id: 'KPI-TR-001',
    name: 'Annual AML/CFT Training Completion',
    category: 'training',
    description: 'All staff completed annual AML/CFT/CPF training',
    regulatoryBasis: 'FDL Art.21, Cabinet Res 134/2025 Art.15',
    reportingBody: 'MoE',
    frequency: 'annual',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 85 },
  },
  {
    id: 'KPI-TR-002',
    name: 'CO/MLRO Specialist Training',
    category: 'training',
    description: 'CO and MLRO completed specialist compliance training',
    regulatoryBasis: 'FDL Art.20-21, MoE Supervisory Requirements',
    reportingBody: 'MoE',
    frequency: 'annual',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 0 },
  },

  // ── Supply Chain (LBMA/OECD) ──────────────────────────────────────────
  {
    id: 'KPI-SC-001',
    name: 'KYS (Know Your Supplier) Completion',
    category: 'supply-chain',
    description: 'All active suppliers with completed due diligence files',
    regulatoryBasis: 'LBMA RGG v9 Step 1-2, OECD DDG',
    reportingBody: 'LBMA',
    frequency: 'quarterly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 85 },
  },
  {
    id: 'KPI-SC-002',
    name: 'CAHRA Assessment Coverage',
    category: 'supply-chain',
    description: 'Suppliers from conflict-affected areas with completed CAHRA assessment',
    regulatoryBasis: 'LBMA RGG v9 Step 2, OECD DDG Annex II',
    reportingBody: 'LBMA',
    frequency: 'quarterly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 80 },
  },
  {
    id: 'KPI-SC-003',
    name: 'Annual Independent Audit',
    category: 'supply-chain',
    description: 'Independent third-party audit completed within last 12 months',
    regulatoryBasis: 'LBMA RGG v9 Step 5',
    reportingBody: 'LBMA',
    frequency: 'annual',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 0 },
  },

  // ── UAE MoE Responsible Sourcing of Gold (RSG) ─────────────────────
  {
    id: 'KPI-RSG-001',
    name: 'RSG Policy Implementation',
    category: 'supply-chain',
    description:
      'Written Responsible Sourcing of Gold policy approved by senior management, aligned with UAE MoE RSG Framework',
    regulatoryBasis: 'UAE MoE RSG Framework, LBMA RGG v9, OECD DDG Step 1',
    reportingBody: 'MoE',
    frequency: 'annual',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 0 },
  },
  {
    id: 'KPI-RSG-002',
    name: 'Gold Origin Traceability',
    category: 'supply-chain',
    description:
      'All gold shipments with verified country of origin, mine/refiner identification, and chain of custody documentation',
    regulatoryBasis: 'UAE MoE RSG Framework Step 2, OECD DDG Annex I, LBMA RGG v9',
    reportingBody: 'MoE',
    frequency: 'quarterly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 85 },
  },
  {
    id: 'KPI-RSG-003',
    name: 'Refiner Due Diligence',
    category: 'supply-chain',
    description:
      'All refiners verified as LBMA Good Delivery or equivalent, with valid assay certificates and hallmark compliance',
    regulatoryBasis: 'UAE MoE RSG Framework, LBMA GDR, Dubai Good Delivery (DGD)',
    reportingBody: 'MoE',
    frequency: 'quarterly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 80 },
  },
  {
    id: 'KPI-RSG-004',
    name: 'CAHRA Origin Risk Mitigation',
    category: 'supply-chain',
    description:
      'Gold from Conflict-Affected and High-Risk Areas with completed enhanced due diligence and risk mitigation plan per UAE MoE RSG',
    regulatoryBasis: 'UAE MoE RSG Framework Step 3, OECD DDG Annex II, LBMA RGG v9 Step 2',
    reportingBody: 'MoE',
    frequency: 'quarterly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 75 },
  },
  {
    id: 'KPI-RSG-005',
    name: 'ASM (Artisanal & Small-Scale Mining) Compliance',
    category: 'supply-chain',
    description:
      'ASM-sourced gold with verified legitimate origin, no child labor, no armed group financing, and environmental compliance',
    regulatoryBasis: 'UAE MoE RSG Framework, OECD DDG Supplement on Gold, LBMA RGG v9',
    reportingBody: 'MoE',
    frequency: 'quarterly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 80 },
  },
  {
    id: 'KPI-RSG-006',
    name: 'Recycled/Scrap Gold Verification',
    category: 'supply-chain',
    description:
      'Recycled and scrap gold purchases with verified source, identity of seller, and documented chain of custody',
    regulatoryBasis: 'UAE MoE RSG Framework, MoE DPMS Guidance, FDL Art.12',
    reportingBody: 'MoE',
    frequency: 'quarterly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 95, amber: 80 },
  },
  {
    id: 'KPI-RSG-007',
    name: 'RSG Incident Reporting',
    category: 'supply-chain',
    description:
      'Supply chain incidents (origin mismatch, conflict gold suspicion, refusal to provide info) reported and investigated within 5 business days',
    regulatoryBasis: 'UAE MoE RSG Framework Step 3-4, LBMA RGG v9 Step 3',
    reportingBody: 'MoE',
    frequency: 'quarterly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 80 },
  },
  {
    id: 'KPI-RSG-008',
    name: 'Annual RSG Public Disclosure',
    category: 'supply-chain',
    description:
      'Annual responsible sourcing report published or made available to MoE, covering supply chain DD activities, risk assessment, and remediation',
    regulatoryBasis: 'UAE MoE RSG Framework Step 5, LBMA RGG v9 Step 5, OECD DDG Step 5',
    reportingBody: 'MoE',
    frequency: 'annual',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 0 },
  },

  // ── Governance ────────────────────────────────────────────────────────
  {
    id: 'KPI-GOV-001',
    name: 'Compliance Manual Currency',
    category: 'governance',
    description:
      'Compliance manual reflects latest regulations (updated within 30 days of new circular)',
    regulatoryBasis: 'FDL Art.20, Cabinet Res 134/2025 Art.19',
    reportingBody: 'MoE',
    frequency: 'quarterly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 0 },
  },
  {
    id: 'KPI-GOV-002',
    name: 'Board/Senior Management Reporting',
    category: 'governance',
    description: 'Quarterly compliance report submitted to Board/Senior Management',
    regulatoryBasis: 'Cabinet Res 134/2025 Art.19, FDL Art.20-21',
    reportingBody: 'MoE',
    frequency: 'quarterly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 0 },
  },
  {
    id: 'KPI-GOV-003',
    name: 'Internal Audit Completion',
    category: 'governance',
    description: 'Independent internal audit/review of AML/CFT controls completed',
    regulatoryBasis: 'Cabinet Res 134/2025 Art.19, FATF Rec 18',
    reportingBody: 'MoE',
    frequency: 'annual',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 0 },
  },
  {
    id: 'KPI-GOV-004',
    name: 'Gap Remediation Rate',
    category: 'governance',
    description: 'Audit findings remediated within target deadlines',
    regulatoryBasis: 'MoE Supervisory Requirements',
    reportingBody: 'MoE',
    frequency: 'quarterly',
    targetValue: 90,
    targetUnit: '%',
    ragThresholds: { green: 85, amber: 60 },
  },

  // ── Record Keeping ────────────────────────────────────────────────────
  {
    id: 'KPI-RK-001',
    name: 'Record Retention Compliance',
    category: 'record-keeping',
    description: `All compliance records retained for minimum ${RECORD_RETENTION_YEARS} years`,
    regulatoryBasis: 'FDL Art.24',
    reportingBody: 'MoE',
    frequency: 'annual',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 90 },
  },
  {
    id: 'KPI-RK-002',
    name: 'Audit Trail Integrity',
    category: 'record-keeping',
    description: 'Audit trail hash-chain verification passes (tamper-proof)',
    regulatoryBasis: 'FDL Art.24, MoE Supervisory Requirements',
    reportingBody: 'MoE',
    frequency: 'monthly',
    targetValue: 100,
    targetUnit: '%',
    ragThresholds: { green: 100, amber: 0 },
  },
];

// ─── RAG Calculation ────────────────────────────────────────────────────────

export function calculateRAG(kpi: KPIDefinition, value: number): RAGStatus {
  if (kpi.inverse) {
    if (value <= kpi.ragThresholds.green) return 'green';
    if (value <= kpi.ragThresholds.amber) return 'amber';
    return 'red';
  }
  if (value >= kpi.ragThresholds.green) return 'green';
  if (value >= kpi.ragThresholds.amber) return 'amber';
  return 'red';
}

// ─── Category Names ─────────────────────────────────────────────────────────

export const CATEGORY_NAMES: Record<KPICategory, string> = {
  'cdd-kyc': 'Customer Due Diligence & KYC',
  'screening-tfs': 'Sanctions Screening & TFS',
  'reporting-fiu': 'FIU Reporting & goAML',
  'risk-assessment': 'Risk Assessment & Monitoring',
  training: 'Training & Awareness',
  'supply-chain': 'Supply Chain Due Diligence (LBMA/OECD)',
  governance: 'Governance & Internal Controls',
  'record-keeping': 'Record Keeping & Audit Trail',
};

// ─── Report Generator ───────────────────────────────────────────────────────

export function generateKPIReport(
  measurements: KPIMeasurement[],
  entity: string,
  period: string,
  generatedBy: string
): KPIReport {
  const categories: KPICategoryReport[] = [];
  const allCategories: KPICategory[] = Object.keys(CATEGORY_NAMES) as KPICategory[];

  for (const cat of allCategories) {
    const catKPIs = measurements.filter((m) => {
      const def = DPMS_KPI_DEFINITIONS.find((d) => d.id === m.kpiId);
      return def?.category === cat;
    });

    if (catKPIs.length === 0) continue;

    const greenCount = catKPIs.filter((k) => k.ragStatus === 'green').length;
    const score = Math.round((greenCount / catKPIs.length) * 100);
    const rag: RAGStatus = score >= 80 ? 'green' : score >= 50 ? 'amber' : 'red';

    categories.push({
      category: cat,
      categoryName: CATEGORY_NAMES[cat],
      score,
      rag,
      kpis: catKPIs,
    });
  }

  const totalGreen = measurements.filter((m) => m.ragStatus === 'green').length;
  const totalAmber = measurements.filter((m) => m.ragStatus === 'amber').length;
  const totalRed = measurements.filter((m) => m.ragStatus === 'red').length;
  const overallScore =
    measurements.length > 0 ? Math.round((totalGreen / measurements.length) * 100) : 0;

  const criticalFindings = measurements
    .filter((m) => m.ragStatus === 'red')
    .map((m) => {
      const def = DPMS_KPI_DEFINITIONS.find((d) => d.id === m.kpiId);
      return `${def?.name || m.kpiId}: ${m.value}${def?.targetUnit || ''} (target: ${def?.targetValue}${def?.targetUnit || ''}) — ${def?.regulatoryBasis || ''}`;
    });

  const recommendations = criticalFindings.map((f) => `Remediate: ${f}`);

  return {
    reportTitle: `UAE DPMS Compliance KPI Report — ${period}`,
    entity,
    period,
    generatedAt: new Date().toISOString(),
    generatedBy,
    overallScore,
    overallRAG: overallScore >= 80 ? 'green' : overallScore >= 50 ? 'amber' : 'red',
    categories,
    summary: {
      totalKPIs: measurements.length,
      greenCount: totalGreen,
      amberCount: totalAmber,
      redCount: totalRed,
      criticalFindings,
      recommendations,
    },
  };
}
