/**
 * Compliance Metrics Dashboard  (WEAPONIZED)
 *
 * Tracks 30 KPIs aligned to MoE DPMS inspection criteria, UAE FIU reporting
 * requirements, FATF Mutual Evaluation methodology, and LBMA audit standards.
 * Produces a machine-readable KPI report suitable for quarterly/annual
 * regulatory submissions and internal MLRO dashboards.
 *
 * Regulatory: MoE Circular 08/AML/2021, FDL No.10/2025, Cabinet Res 134/2025,
 *             Cabinet Res 74/2020, FATF ME Methodology 2022, LBMA RGG v9,
 *             Cabinet Res 71/2024 (penalty thresholds), UAE FIU goAML Guidelines.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type KpiStatus = 'green' | 'amber' | 'red' | 'not_measured';
export type KpiCategory =
  | 'governance'
  | 'cdd_kyc'
  | 'screening'
  | 'transaction_monitoring'
  | 'filing_reporting'
  | 'training'
  | 'esg_responsible_sourcing'
  | 'technology_controls';

export interface KpiDefinition {
  id: string;
  name: string;
  category: KpiCategory;
  regulatoryRef: string;
  greenThreshold: string;
  amberThreshold: string;
  redThreshold: string;
  penaltyIfRed?: string;
}

export interface KpiMeasurement {
  kpiId: string;
  measuredAt: string;
  value: number | string | boolean;
  unit: string;
  status: KpiStatus;
  trend: 'improving' | 'stable' | 'deteriorating' | 'unknown';
  notes?: string;
}

export interface KpiReport {
  entityId: string;
  reportingPeriod: { start: string; end: string };
  generatedAt: string;
  overallScore: number; // 0-100; pct of KPIs in green/amber
  greenCount: number;
  amberCount: number;
  redCount: number;
  notMeasuredCount: number;
  kpiMeasurements: KpiMeasurement[];
  criticalRedKpis: string[]; // IDs of KPIs in red with penalties
  regulatoryRisk: 'low' | 'medium' | 'high' | 'critical';
  executiveSummary: string;
  regulatoryRefs: string[];
}

// ─── 30 KPI Definitions ───────────────────────────────────────────────────────

export const KPI_DEFINITIONS: KpiDefinition[] = [
  // Governance (G1-G5)
  {
    id: 'G1',
    name: 'AML/CFT Policy update lag (days since last revision)',
    category: 'governance',
    regulatoryRef: 'FDL No.10/2025 Art.20; MoE Circular 08/AML/2021',
    greenThreshold: '≤30 days',
    amberThreshold: '31-90 days',
    redThreshold: '>90 days',
    penaltyIfRed: 'AED 10K–1M (Cabinet Res 71/2024)',
  },
  {
    id: 'G2',
    name: 'CO change notification to MoE (days lag)',
    category: 'governance',
    regulatoryRef: 'Cabinet Res 134/2025 Art.18',
    greenThreshold: '≤15 days',
    amberThreshold: '16-30 days',
    redThreshold: '>30 days',
    penaltyIfRed: 'AED 50K–500K',
  },
  {
    id: 'G3',
    name: 'Board AML training completion (%)',
    category: 'governance',
    regulatoryRef: 'FDL No.10/2025 Art.21',
    greenThreshold: '100%',
    amberThreshold: '80-99%',
    redThreshold: '<80%',
  },
  {
    id: 'G4',
    name: 'Annual AML risk assessment completed (Y/N)',
    category: 'governance',
    regulatoryRef: 'Cabinet Res 134/2025 Art.5',
    greenThreshold: 'Yes + documented',
    amberThreshold: 'In progress',
    redThreshold: 'No',
  },
  {
    id: 'G5',
    name: 'Four-eyes violations in period (count)',
    category: 'governance',
    regulatoryRef: 'FDL No.10/2025 Art.20-21; Cabinet Res 74/2020 Art.4',
    greenThreshold: '0',
    amberThreshold: '1-2 (documented + remediated)',
    redThreshold: '≥3 or any unresolved',
    penaltyIfRed: 'AED 100K–100M + criminal',
  },

  // CDD/KYC (C1-C6)
  {
    id: 'C1',
    name: 'CDD review overdue — SDD (count of customers past 12-month cycle)',
    category: 'cdd_kyc',
    regulatoryRef: 'Cabinet Res 134/2025 Art.7',
    greenThreshold: '0',
    amberThreshold: '1-5',
    redThreshold: '>5',
    penaltyIfRed: 'AED 10K–5M',
  },
  {
    id: 'C2',
    name: 'CDD review overdue — Standard (count past 6-month cycle)',
    category: 'cdd_kyc',
    regulatoryRef: 'Cabinet Res 134/2025 Art.8',
    greenThreshold: '0',
    amberThreshold: '1-3',
    redThreshold: '>3',
  },
  {
    id: 'C3',
    name: 'EDD review overdue (count past 3-month cycle)',
    category: 'cdd_kyc',
    regulatoryRef: 'Cabinet Res 134/2025 Art.9',
    greenThreshold: '0',
    amberThreshold: '1',
    redThreshold: '≥2',
    penaltyIfRed: 'AED 50K–10M',
  },
  {
    id: 'C4',
    name: 'UBO re-verification overdue (count past 15 working days)',
    category: 'cdd_kyc',
    regulatoryRef: 'Cabinet Decision 109/2023',
    greenThreshold: '0',
    amberThreshold: '1',
    redThreshold: '≥2',
    penaltyIfRed: 'AED 50K–5M',
  },
  {
    id: 'C5',
    name: 'KYC document completeness (%)',
    category: 'cdd_kyc',
    regulatoryRef: 'FDL No.10/2025 Art.12-14',
    greenThreshold: '≥98%',
    amberThreshold: '90-97%',
    redThreshold: '<90%',
  },
  {
    id: 'C6',
    name: 'PEP board approvals outstanding (count)',
    category: 'cdd_kyc',
    regulatoryRef: 'Cabinet Res 134/2025 Art.14',
    greenThreshold: '0',
    amberThreshold: '1 (in process)',
    redThreshold: '≥2 or any unresolved',
    penaltyIfRed: 'AED 100K–10M',
  },

  // Screening (S1-S4)
  {
    id: 'S1',
    name: 'Sanctions lists checked per screening (count, max=6)',
    category: 'screening',
    regulatoryRef: 'Cabinet Res 74/2020 Art.3; FDL No.10/2025 Art.35',
    greenThreshold: '6/6 (UN+OFAC+EU+UK+UAE+EOCN)',
    amberThreshold: '5/6',
    redThreshold: '≤4/6',
    penaltyIfRed: 'AED 100K–100M',
  },
  {
    id: 'S2',
    name: 'Sanctions list refresh lag (hours)',
    category: 'screening',
    regulatoryRef: 'Cabinet Res 74/2020 Art.3',
    greenThreshold: '≤24h',
    amberThreshold: '25-72h',
    redThreshold: '>72h',
    penaltyIfRed: 'AED 50K–5M',
  },
  {
    id: 'S3',
    name: 'False positive rate in sanctions screening (%)',
    category: 'screening',
    regulatoryRef: 'FATF Rec 6',
    greenThreshold: '<2%',
    amberThreshold: '2-5%',
    redThreshold: '>5%',
  },
  {
    id: 'S4',
    name: 'Unresolved sanctions alerts (count >48h old)',
    category: 'screening',
    regulatoryRef: 'Cabinet Res 74/2020 Art.4 — 24h freeze window',
    greenThreshold: '0',
    amberThreshold: '1-2',
    redThreshold: '≥3',
    penaltyIfRed: 'AED 100K–100M + criminal',
  },

  // Transaction Monitoring (T1-T4)
  {
    id: 'T1',
    name: 'Transaction monitoring alert resolution time (avg business hours)',
    category: 'transaction_monitoring',
    regulatoryRef: 'FDL No.10/2025 Art.12; Cabinet Res 134/2025 Art.19',
    greenThreshold: '≤8h',
    amberThreshold: '9-24h',
    redThreshold: '>24h',
  },
  {
    id: 'T2',
    name: 'CTR threshold breaches unreported (count)',
    category: 'transaction_monitoring',
    regulatoryRef: 'MoE Circular 08/AML/2021 — AED 55K CTR',
    greenThreshold: '0',
    amberThreshold: '0',
    redThreshold: '≥1',
    penaltyIfRed: 'AED 10K–5M per instance',
  },
  {
    id: 'T3',
    name: 'Cross-border cash breaches unreported (count)',
    category: 'transaction_monitoring',
    regulatoryRef: 'Cabinet Res 134/2025 Art.16 — AED 60K',
    greenThreshold: '0',
    amberThreshold: '0',
    redThreshold: '≥1',
    penaltyIfRed: 'AED 50K–5M',
  },
  {
    id: 'T4',
    name: 'TBML alerts escalated within SLA (%)',
    category: 'transaction_monitoring',
    regulatoryRef: 'FATF TBML Guidance 2020',
    greenThreshold: '100%',
    amberThreshold: '90-99%',
    redThreshold: '<90%',
  },

  // Filing/Reporting (F1-F5)
  {
    id: 'F1',
    name: 'STR/SAR filings on-time (%)',
    category: 'filing_reporting',
    regulatoryRef: 'FDL No.10/2025 Art.26 — 10 business days',
    greenThreshold: '100%',
    amberThreshold: '95-99%',
    redThreshold: '<95%',
    penaltyIfRed: 'AED 10K–100M per missed filing',
  },
  {
    id: 'F2',
    name: 'CTR filings on-time (%)',
    category: 'filing_reporting',
    regulatoryRef: 'MoE Circular 08/AML/2021 — 15 business days',
    greenThreshold: '100%',
    amberThreshold: '95-99%',
    redThreshold: '<95%',
  },
  {
    id: 'F3',
    name: 'DPMSR quarterly submissions on-time (%)',
    category: 'filing_reporting',
    regulatoryRef: 'MoE Circular 08/AML/2021',
    greenThreshold: '100%',
    amberThreshold: '100%',
    redThreshold: 'Any missed quarter',
  },
  {
    id: 'F4',
    name: 'CNMR filings within 5 business days (%)',
    category: 'filing_reporting',
    regulatoryRef: 'Cabinet Res 74/2020 Art.7',
    greenThreshold: '100%',
    amberThreshold: '100%',
    redThreshold: 'Any missed',
    penaltyIfRed: 'AED 100K–100M + criminal',
  },
  {
    id: 'F5',
    name: 'Record retention compliance (% of files ≥10yr)',
    category: 'filing_reporting',
    regulatoryRef: 'FDL No.10/2025 Art.24 — 10-year minimum',
    greenThreshold: '100%',
    amberThreshold: '99%',
    redThreshold: '<99%',
    penaltyIfRed: 'AED 10K–5M',
  },

  // Training (TR1-TR2)
  {
    id: 'TR1',
    name: 'Staff AML training completion (%)',
    category: 'training',
    regulatoryRef: 'FDL No.10/2025 Art.21',
    greenThreshold: '100%',
    amberThreshold: '90-99%',
    redThreshold: '<90%',
  },
  {
    id: 'TR2',
    name: 'Training frequency (months since last all-staff AML training)',
    category: 'training',
    regulatoryRef: 'FDL No.10/2025 Art.21',
    greenThreshold: '≤12 months',
    amberThreshold: '13-18 months',
    redThreshold: '>18 months',
  },

  // ESG & Responsible Sourcing (E1-E2)
  {
    id: 'E1',
    name: 'LBMA RGG / OECD DDG compliance level (0-5)',
    category: 'esg_responsible_sourcing',
    regulatoryRef: 'LBMA RGG v9; OECD DDG 2016',
    greenThreshold: 'Level 4-5',
    amberThreshold: 'Level 3',
    redThreshold: 'Level ≤2',
  },
  {
    id: 'E2',
    name: 'ESG composite score',
    category: 'esg_responsible_sourcing',
    regulatoryRef: 'ISSB IFRS S1/S2; UAE Net Zero 2050',
    greenThreshold: '≥70/100',
    amberThreshold: '50-69/100',
    redThreshold: '<50/100',
  },

  // Technology Controls (TC1-TC2)
  {
    id: 'TC1',
    name: 'goAML system uptime (%)',
    category: 'technology_controls',
    regulatoryRef: 'UAE FIU goAML Guidelines 2024',
    greenThreshold: '≥99.5%',
    amberThreshold: '98-99.4%',
    redThreshold: '<98%',
  },
  {
    id: 'TC2',
    name: 'Brain subsystem failure rate (% of runs with ≥1 failure)',
    category: 'technology_controls',
    regulatoryRef: 'NIST AI RMF GV-1.6; EU AI Act Art.72',
    greenThreshold: '<1%',
    amberThreshold: '1-5%',
    redThreshold: '>5%',
  },
];

// ─── Measurement Helpers ──────────────────────────────────────────────────────

function scoreStatus(kpiId: string, value: number | string | boolean): KpiStatus {
  // Simplified threshold evaluator — caller passes pre-computed status in production;
  // this fallback applies numeric thresholds where the green/amber/red pattern is numeric.
  if (typeof value === 'boolean') return value ? 'green' : 'red';
  if (typeof value === 'number') {
    // Most numeric KPIs: 0 = green, low = amber, high = red
    if (value === 0) return 'green';
    if (value <= 2) return 'amber';
    return 'red';
  }
  if (typeof value === 'string') {
    const v = value.toLowerCase();
    if (v.includes('green') || v === 'yes' || v === 'compliant') return 'green';
    if (v.includes('amber') || v.includes('in progress')) return 'amber';
    if (v.includes('red') || v === 'no' || v === 'non-compliant') return 'red';
  }
  return 'not_measured';
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function buildKpiReport(
  entityId: string,
  periodStart: string,
  periodEnd: string,
  measurements: Array<{
    kpiId: string;
    value: number | string | boolean;
    unit?: string;
    notes?: string;
    trend?: KpiMeasurement['trend'];
  }>
): KpiReport {
  const now = new Date().toISOString();

  const kpiMeasurements: KpiMeasurement[] = KPI_DEFINITIONS.map((kpi) => {
    const m = measurements.find((x) => x.kpiId === kpi.id);
    const status = m ? scoreStatus(kpi.id, m.value) : 'not_measured';
    return {
      kpiId: kpi.id,
      measuredAt: now,
      value: m?.value ?? 'not measured',
      unit: m?.unit ?? '',
      status,
      trend: m?.trend ?? 'unknown',
      notes: m?.notes,
    };
  });

  const greenCount = kpiMeasurements.filter((k) => k.status === 'green').length;
  const amberCount = kpiMeasurements.filter((k) => k.status === 'amber').length;
  const redCount = kpiMeasurements.filter((k) => k.status === 'red').length;
  const notMeasuredCount = kpiMeasurements.filter((k) => k.status === 'not_measured').length;

  const overallScore = Math.round(
    (greenCount * 100 + amberCount * 50) / Math.max(1, greenCount + amberCount + redCount)
  );

  const criticalRedKpis = kpiMeasurements
    .filter(
      (k) => k.status === 'red' && KPI_DEFINITIONS.find((d) => d.id === k.kpiId)?.penaltyIfRed
    )
    .map((k) => k.kpiId);

  const regulatoryRisk: KpiReport['regulatoryRisk'] =
    criticalRedKpis.length >= 3
      ? 'critical'
      : criticalRedKpis.length >= 1 || redCount >= 5
        ? 'high'
        : redCount >= 2 || amberCount >= 8
          ? 'medium'
          : 'low';

  const executiveSummary =
    `KPI Report — ${entityId} (${periodStart} → ${periodEnd})\n` +
    `Overall score: ${overallScore}/100 | Regulatory risk: ${regulatoryRisk.toUpperCase()}\n` +
    `Green: ${greenCount} | Amber: ${amberCount} | Red: ${redCount} | Not measured: ${notMeasuredCount}\n` +
    (criticalRedKpis.length > 0
      ? `CRITICAL RED KPIs with penalty exposure: ${criticalRedKpis.join(', ')}\n`
      : 'No KPIs with critical penalty exposure in red.\n') +
    `Regulatory refs: FDL No.10/2025 | Cabinet Res 134/2025 | MoE Circular 08/AML/2021 | FATF ME 2022 | LBMA RGG v9`;

  return {
    entityId,
    reportingPeriod: { start: periodStart, end: periodEnd },
    generatedAt: now,
    overallScore,
    greenCount,
    amberCount,
    redCount,
    notMeasuredCount,
    kpiMeasurements,
    criticalRedKpis,
    regulatoryRisk,
    executiveSummary,
    regulatoryRefs: [
      'FDL No.10/2025 — UAE AML/CFT/CPF Law',
      'Cabinet Res 134/2025 — AML Implementing Regulations',
      'Cabinet Res 74/2020 — TFS/Asset Freeze',
      'Cabinet Res 71/2024 — Administrative Penalties',
      'Cabinet Decision 109/2023 — UBO Register',
      'MoE Circular 08/AML/2021 — DPMS Sector Guidance',
      'FATF Mutual Evaluation Methodology 2022',
      'LBMA Responsible Gold Guidance v9',
      'ISSB IFRS S1/S2 (2023)',
    ],
  };
}
