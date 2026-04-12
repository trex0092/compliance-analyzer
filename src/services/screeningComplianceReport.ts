/**
 * Screening Compliance Report Generator
 *
 * Generates a comprehensive compliance report for an entity's AML/CFT/CPF
 * screening activities, aligned to MoE, FIU (UAE goAML), EOCN, FATF and
 * OECD DDG requirements.  Suitable for submission to regulators, internal
 * audit, and Asana task tracking.
 *
 * Regulatory: FDL No.10/2025, Cabinet Res 134/2025, Cabinet Res 74/2020,
 *             MoE Circular 08/AML/2021, UAE FIU goAML Guidelines 2024,
 *             FATF Rec 1-40, OECD DDG 2016, LBMA RGG v9.
 */

import type { EsgScore } from './esgScorer';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReportSection =
  | 'entity_profile'
  | 'sanctions_screening'
  | 'cdd_edd_status'
  | 'transaction_monitoring'
  | 'str_ctr_filing_status'
  | 'esg_compliance'
  | 'pep_exposure'
  | 'ubo_registry'
  | 'regulatory_calendar'
  | 'risk_score_breakdown'
  | 'audit_trail'
  | 'recommendations';

export type RegulatoryFramework =
  | 'MoE'
  | 'FIU'
  | 'EOCN'
  | 'FATF'
  | 'OECD_DDG'
  | 'LBMA'
  | 'OECD_BEPS';

export type OverallComplianceStatus =
  | 'compliant'
  | 'partially_compliant'
  | 'non_compliant'
  | 'critical_breach';

export interface EntityProfile {
  entityId: string;
  entityName: string;
  entityType: 'individual' | 'corporate' | 'financial_institution' | 'dpms_dealer' | 'refinery';
  jurisdiction: string;
  licenceNumber?: string;
  goamlRegistration?: string;
  onboardingDate: string;
  lastReviewDate: string;
  cddLevel: 'SDD' | 'CDD' | 'EDD';
  riskRating: 'low' | 'medium' | 'high' | 'critical';
}

export interface SanctionsScreeningResult {
  screenedAt: string;
  listsChecked: string[]; // UN, OFAC, EU, UK, UAE, EOCN
  matchFound: boolean;
  matchConfidence?: number;
  matchDetails?: string;
  frozen: boolean;
  nextScreeningDue: string;
}

export interface FilingRecord {
  filingType: 'STR' | 'SAR' | 'CTR' | 'DPMSR' | 'CNMR' | 'EOCN_FREEZE';
  filingDate: string;
  referenceNumber: string;
  status: 'submitted' | 'pending' | 'overdue' | 'acknowledged';
  deadlineMet: boolean;
  remarks?: string;
}

export interface TransactionMonitoringSummary {
  periodStart: string;
  periodEnd: string;
  totalTransactionCount: number;
  totalValueAED: number;
  flaggedCount: number;
  flaggedValueAED: number;
  typologiesDetected: string[];
  tbmlAlertsCount: number;
  hawalaAlertsCount: number;
  crossBorderAlertsCount: number;
  anomalyEnsembleScore: number;
}

export interface PepExposureSummary {
  pepLinksCount: number;
  highestDegree: number; // 0 = entity IS PEP
  requiresBoardApproval: boolean;
  boardApprovalObtained: boolean;
  lastPepReviewDate?: string;
}

export interface UboRegistrySummary {
  ubosIdentified: number;
  ubosAbove25Pct: number;
  lastVerificationDate: string;
  reverificationDue: string;
  outstandingChanges: boolean;
}

export interface ComplianceReportInput {
  entity: EntityProfile;
  sanctionsResults: SanctionsScreeningResult[];
  filingRecords: FilingRecord[];
  transactionMonitoring: TransactionMonitoringSummary;
  pepExposure: PepExposureSummary;
  uboRegistry: UboRegistrySummary;
  esgScore?: EsgScore;
  auditTrailEntries?: AuditEntry[];
  regulatoryCalendarSummary?: string;
  reportingPeriod: { start: string; end: string };
  preparedBy: string;
  reviewedBy?: string;
}

export interface AuditEntry {
  timestamp: string;
  userId: string;
  action: string;
  entityId: string;
  details?: string;
}

export interface ComplianceFinding {
  section: ReportSection;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  framework: RegulatoryFramework;
  finding: string;
  regulatoryRef: string;
  remediation: string;
  deadline?: string;
  penaltyExposure?: string;
}

export interface ScreeningComplianceReport {
  reportId: string;
  entityId: string;
  entityName: string;
  reportingPeriod: { start: string; end: string };
  generatedAt: string;
  preparedBy: string;
  reviewedBy?: string;
  overallStatus: OverallComplianceStatus;
  overallRiskScore: number; // 0–100
  executiveSummary: string;
  sections: ReportSectionContent[];
  findings: ComplianceFinding[];
  criticalFindingsCount: number;
  highFindingsCount: number;
  overdueFilings: FilingRecord[];
  sanctionsExposure: boolean;
  pepExposure: boolean;
  esgRiskLevel?: string;
  recommendedActions: string[];
  nextReviewDate: string;
  regulatoryRefs: string[];
  disclaimer: string;
}

export interface ReportSectionContent {
  section: ReportSection;
  title: string;
  status: 'compliant' | 'partial' | 'non_compliant' | 'n_a';
  summary: string;
  details: Record<string, unknown>;
}

// ─── Report Builder ───────────────────────────────────────────────────────────

function buildEntityProfileSection(entity: EntityProfile): ReportSectionContent {
  return {
    section: 'entity_profile',
    title: 'Entity Profile',
    status: 'compliant',
    summary: `${entity.entityName} (${entity.entityType}) — ${entity.jurisdiction}. CDD level: ${entity.cddLevel}. Risk: ${entity.riskRating.toUpperCase()}.`,
    details: { ...entity },
  };
}

function buildSanctionsSection(results: SanctionsScreeningResult[]): {
  section: ReportSectionContent;
  findings: ComplianceFinding[];
} {
  const findings: ComplianceFinding[] = [];
  const latestResult = results[results.length - 1];
  const allListsCovered = latestResult?.listsChecked.length >= 6; // UN, OFAC, EU, UK, UAE, EOCN

  if (!allListsCovered) {
    findings.push({
      section: 'sanctions_screening',
      severity: 'critical',
      framework: 'FIU',
      finding: `Only ${latestResult?.listsChecked.length ?? 0} of 6 mandatory sanctions lists checked`,
      regulatoryRef: 'Cabinet Res 74/2020 Art.3; FDL No.10/2025 Art.35',
      remediation: 'Screen against ALL lists: UN, OFAC, EU, UK, UAE, EOCN. Never skip a list.',
      penaltyExposure: 'AED 100K–100M',
    });
  }

  if (
    latestResult?.matchFound &&
    !latestResult.frozen &&
    (latestResult.matchConfidence ?? 0) >= 0.9
  ) {
    findings.push({
      section: 'sanctions_screening',
      severity: 'critical',
      framework: 'EOCN',
      finding: 'Confirmed sanctions match — asset freeze not yet executed',
      regulatoryRef: 'Cabinet Res 74/2020 Art.4 — freeze within 24 clock hours',
      remediation: 'FREEZE IMMEDIATELY. Notify EOCN within 24h. File CNMR within 5 business days.',
      penaltyExposure: 'AED 100K–100M + criminal liability',
    });
  }

  const status = findings.some((f) => f.severity === 'critical')
    ? 'non_compliant'
    : !allListsCovered
      ? 'partial'
      : 'compliant';

  return {
    section: {
      section: 'sanctions_screening',
      title: 'Sanctions Screening',
      status,
      summary: `${results.length} screening run(s). Latest: ${latestResult?.screenedAt ?? 'never'}. Lists: ${latestResult?.listsChecked.join(', ') ?? 'none'}. Match: ${latestResult?.matchFound ? 'YES' : 'none'}. Frozen: ${latestResult?.frozen ?? false}.`,
      details: { screenings: results, allListsCovered },
    },
    findings,
  };
}

function buildFilingSection(records: FilingRecord[]): {
  section: ReportSectionContent;
  findings: ComplianceFinding[];
} {
  const findings: ComplianceFinding[] = [];
  const overdue = records.filter(
    (r) => r.status === 'overdue' || (!r.deadlineMet && r.status === 'submitted')
  );

  for (const r of overdue) {
    findings.push({
      section: 'str_ctr_filing_status',
      severity: 'high',
      framework: 'FIU',
      finding: `Overdue ${r.filingType}: ${r.referenceNumber} — deadline not met`,
      regulatoryRef: r.filingType === 'STR' ? 'FDL No.10/2025 Art.26' : 'MoE Circular 08/AML/2021',
      remediation: `Submit ${r.filingType} immediately via goAML and document reason for delay.`,
      penaltyExposure: 'AED 10K–100M (Cabinet Res 71/2024)',
    });
  }

  const status = findings.length > 0 ? 'partial' : 'compliant';
  return {
    section: {
      section: 'str_ctr_filing_status',
      title: 'STR / CTR Filing Status',
      status,
      summary: `${records.length} filing(s) on record. Overdue: ${overdue.length}. Types: ${[...new Set(records.map((r) => r.filingType))].join(', ')}.`,
      details: { filings: records },
    },
    findings,
  };
}

function buildEsgSection(esg?: EsgScore): ReportSectionContent {
  if (!esg) {
    return {
      section: 'esg_compliance',
      title: 'ESG Compliance',
      status: 'n_a',
      summary: 'ESG score not available for this reporting period.',
      details: {},
    };
  }
  return {
    section: 'esg_compliance',
    title: 'ESG Compliance (ISSB IFRS S1/S2, GRI 2021, LBMA RGG v9)',
    status:
      esg.riskLevel === 'low'
        ? 'compliant'
        : esg.riskLevel === 'medium'
          ? 'partial'
          : 'non_compliant',
    summary: `Overall ESG score: ${esg.totalScore.toFixed(1)}/100 (${esg.grade}). Environmental: ${esg.pillars.E.score.toFixed(1)}. Social: ${esg.pillars.S.score.toFixed(1)}. Governance: ${esg.pillars.G.score.toFixed(1)}. Risk level: ${esg.riskLevel.toUpperCase()}.`,
    details: { esgScore: esg },
  };
}

function buildAuditTrailSection(entries?: AuditEntry[]): ReportSectionContent {
  return {
    section: 'audit_trail',
    title: 'Audit Trail',
    status: (entries?.length ?? 0) > 0 ? 'compliant' : 'partial',
    summary: `${entries?.length ?? 0} audit entries recorded. FDL No.10/2025 Art.24 requires 10-year retention.`,
    details: { entries: entries?.slice(-20) ?? [] }, // last 20 entries
  };
}

function buildRecommendations(findings: ComplianceFinding[]): string[] {
  const recs: string[] = [];
  const criticals = findings.filter((f) => f.severity === 'critical');
  const highs = findings.filter((f) => f.severity === 'high');

  if (criticals.length > 0)
    recs.push(
      `IMMEDIATE: Resolve ${criticals.length} critical finding(s): ${criticals.map((f) => f.finding.slice(0, 60)).join('; ')}`
    );
  for (const h of highs.slice(0, 3)) recs.push(`HIGH PRIORITY: ${h.remediation}`);

  recs.push(
    'Ensure all 6 sanctions lists refreshed at minimum weekly (UN, OFAC, EU, UK, UAE, EOCN)'
  );
  recs.push('Run /deploy-check before any code changes to compliance logic');
  recs.push('Verify next DPMSR quarterly submission date and goAML registration status');

  return recs;
}

function computeOverallStatus(findings: ComplianceFinding[]): OverallComplianceStatus {
  if (findings.some((f) => f.severity === 'critical' && f.framework === 'EOCN'))
    return 'critical_breach';
  if (findings.some((f) => f.severity === 'critical')) return 'non_compliant';
  if (findings.some((f) => f.severity === 'high')) return 'partially_compliant';
  return 'compliant';
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function generateScreeningComplianceReport(
  input: ComplianceReportInput
): ScreeningComplianceReport {
  const reportId = `SCR-${input.entity.entityId}-${Date.now()}`;
  const generatedAt = new Date().toISOString();

  const sections: ReportSectionContent[] = [];
  const allFindings: ComplianceFinding[] = [];

  // Entity Profile
  sections.push(buildEntityProfileSection(input.entity));

  // Sanctions
  const sanctionsSec = buildSanctionsSection(input.sanctionsResults);
  sections.push(sanctionsSec.section);
  allFindings.push(...sanctionsSec.findings);

  // CDD/EDD
  sections.push({
    section: 'cdd_edd_status',
    title: 'CDD / EDD Status',
    status: 'compliant',
    summary: `CDD level: ${input.entity.cddLevel}. Last review: ${input.entity.lastReviewDate}. Risk rating: ${input.entity.riskRating.toUpperCase()}.`,
    details: { cddLevel: input.entity.cddLevel, riskRating: input.entity.riskRating },
  });

  // Transaction Monitoring
  sections.push({
    section: 'transaction_monitoring',
    title: 'Transaction Monitoring',
    status: input.transactionMonitoring.flaggedCount > 0 ? 'partial' : 'compliant',
    summary: `${input.transactionMonitoring.totalTransactionCount} transactions (AED ${input.transactionMonitoring.totalValueAED.toLocaleString()}) in period. Flagged: ${input.transactionMonitoring.flaggedCount}. TBML alerts: ${input.transactionMonitoring.tbmlAlertsCount}. Hawala alerts: ${input.transactionMonitoring.hawalaAlertsCount}. Anomaly ensemble score: ${input.transactionMonitoring.anomalyEnsembleScore}/100.`,
    details: { ...input.transactionMonitoring },
  });

  // Filings
  const filingSec = buildFilingSection(input.filingRecords);
  sections.push(filingSec.section);
  allFindings.push(...filingSec.findings);

  // ESG
  sections.push(buildEsgSection(input.esgScore));

  // PEP
  sections.push({
    section: 'pep_exposure',
    title: 'PEP Exposure',
    status:
      input.pepExposure.pepLinksCount === 0
        ? 'compliant'
        : !input.pepExposure.boardApprovalObtained
          ? 'non_compliant'
          : 'partial',
    summary: `PEP links: ${input.pepExposure.pepLinksCount}. Highest degree: ${input.pepExposure.highestDegree}. Board approval obtained: ${input.pepExposure.boardApprovalObtained}.`,
    details: { ...input.pepExposure },
  });

  if (input.pepExposure.requiresBoardApproval && !input.pepExposure.boardApprovalObtained) {
    allFindings.push({
      section: 'pep_exposure',
      severity: 'critical',
      framework: 'FIU',
      finding: 'PEP relationship without board approval',
      regulatoryRef: 'Cabinet Res 134/2025 Art.14',
      remediation: 'Obtain board approval before continuing PEP relationship. Document rationale.',
      penaltyExposure: 'AED 100K+',
    });
  }

  // UBO
  sections.push({
    section: 'ubo_registry',
    title: 'UBO Registry',
    status: input.uboRegistry.outstandingChanges ? 'partial' : 'compliant',
    summary: `${input.uboRegistry.ubosIdentified} UBO(s) identified; ${input.uboRegistry.ubosAbove25Pct} above 25% threshold. Last verified: ${input.uboRegistry.lastVerificationDate}. Next due: ${input.uboRegistry.reverificationDue}.`,
    details: { ...input.uboRegistry },
  });

  // Regulatory Calendar
  if (input.regulatoryCalendarSummary) {
    sections.push({
      section: 'regulatory_calendar',
      title: 'Regulatory Obligation Calendar',
      status: 'compliant',
      summary: input.regulatoryCalendarSummary,
      details: {},
    });
  }

  // Audit Trail
  sections.push(buildAuditTrailSection(input.auditTrailEntries));

  // Recommendations
  const recommendations = buildRecommendations(allFindings);
  sections.push({
    section: 'recommendations',
    title: 'Recommendations',
    status: 'compliant',
    summary: `${recommendations.length} action(s) recommended.`,
    details: { recommendations },
  });

  const overallStatus = computeOverallStatus(allFindings);

  // Overall risk score (weighted across sections)
  const criticals = allFindings.filter((f) => f.severity === 'critical').length;
  const highs = allFindings.filter((f) => f.severity === 'high').length;
  const overallRiskScore = Math.min(100, criticals * 25 + highs * 10);

  const executiveSummary =
    `SCREENING COMPLIANCE REPORT — ${input.entity.entityName} (${input.entity.entityId})\n` +
    `Reporting Period: ${input.reportingPeriod.start} to ${input.reportingPeriod.end}\n` +
    `Overall Status: ${overallStatus.toUpperCase().replace('_', ' ')}\n` +
    `Risk Score: ${overallRiskScore}/100\n` +
    `Critical Findings: ${criticals} | High Findings: ${highs}\n` +
    `Sanctions Match: ${input.sanctionsResults.some((r) => r.matchFound) ? 'YES' : 'None'} | ` +
    `PEP Links: ${input.pepExposure.pepLinksCount} | ` +
    `ESG Grade: ${input.esgScore?.grade ?? 'N/A'}\n` +
    `Overdue Filings: ${input.filingRecords.filter((r) => r.status === 'overdue').length}\n` +
    (overallStatus === 'critical_breach' || overallStatus === 'non_compliant'
      ? '⚠ IMMEDIATE REGULATORY ACTION REQUIRED ⚠\n'
      : '') +
    `Prepared by: ${input.preparedBy}${input.reviewedBy ? ` | Reviewed by: ${input.reviewedBy}` : ''}`;

  const nextReviewDate = new Date();
  nextReviewDate.setMonth(
    nextReviewDate.getMonth() +
      (input.entity.cddLevel === 'EDD' ? 3 : input.entity.cddLevel === 'CDD' ? 6 : 12)
  );

  return {
    reportId,
    entityId: input.entity.entityId,
    entityName: input.entity.entityName,
    reportingPeriod: input.reportingPeriod,
    generatedAt,
    preparedBy: input.preparedBy,
    reviewedBy: input.reviewedBy,
    overallStatus,
    overallRiskScore,
    executiveSummary,
    sections,
    findings: allFindings,
    criticalFindingsCount: criticals,
    highFindingsCount: highs,
    overdueFilings: input.filingRecords.filter((r) => r.status === 'overdue'),
    sanctionsExposure: input.sanctionsResults.some((r) => r.matchFound),
    pepExposure: input.pepExposure.pepLinksCount > 0,
    esgRiskLevel: input.esgScore?.riskLevel,
    recommendedActions: recommendations,
    nextReviewDate: nextReviewDate.toISOString().split('T')[0],
    regulatoryRefs: [
      'FDL No.10/2025 — UAE AML/CFT/CPF Law (all articles)',
      'Cabinet Res 134/2025 — AML Implementing Regulations',
      'Cabinet Res 74/2020 Art.4-7 — TFS / Asset Freeze (EOCN)',
      'Cabinet Res 71/2024 — Administrative Penalties (AED 10K–100M)',
      'Cabinet Decision 109/2023 — UBO Register',
      'MoE Circular 08/AML/2021 — DPMS Sector Guidance',
      'Cabinet Res 156/2025 — PF & Dual-Use Controls',
      'UAE FIU goAML Filing Guidelines 2024',
      'FATF Recommendations 1-40',
      'OECD DDG 2016 — Due Diligence for Responsible Gold Supply Chains',
      'LBMA Responsible Gold Guidance v9',
      'ISSB IFRS S1/S2 (2023)',
    ],
    disclaimer:
      'This report is generated by the Compliance Analyzer system for internal compliance monitoring purposes only. ' +
      'It does not constitute legal advice. All regulatory filings should be reviewed by a qualified Compliance Officer ' +
      'before submission. Confidential — not for external distribution without CO approval.',
  };
}
