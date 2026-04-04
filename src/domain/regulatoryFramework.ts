/**
 * UAE Regulatory Framework Reference Module
 *
 * Consolidates all regulatory requirements, deadlines, and obligations
 * for DPMS sector compliance per MoE, FIU, EOCN, and FATF standards.
 *
 * This module is the single source of truth for regulatory references
 * used across the Hawkeye Sterling V2.
 */

// ─── Regulatory Bodies ───────────────────────────────────────────────────────

export interface RegulatoryBody {
  code: string;
  name: string;
  fullName: string;
  jurisdiction: string;
  reportingUrl?: string;
}

export const REGULATORY_BODIES: RegulatoryBody[] = [
  { code: "MOE", name: "Ministry of Economy", fullName: "UAE Ministry of Economy — DPMS Supervision Division", jurisdiction: "UAE", reportingUrl: "https://www.moec.gov.ae" },
  { code: "FIU", name: "Financial Intelligence Unit", fullName: "UAE Financial Intelligence Unit (goAML)", jurisdiction: "UAE", reportingUrl: "https://www.uaefiu.gov.ae" },
  { code: "EOCN", name: "EOCN", fullName: "Executive Office of Control & Non-Proliferation", jurisdiction: "UAE" },
  { code: "CBUAE", name: "Central Bank of UAE", fullName: "Central Bank of the United Arab Emirates", jurisdiction: "UAE" },
  { code: "FATF", name: "FATF", fullName: "Financial Action Task Force", jurisdiction: "International" },
  { code: "UNSC", name: "UN Security Council", fullName: "United Nations Security Council — Sanctions Committee", jurisdiction: "International" },
  { code: "LBMA", name: "LBMA", fullName: "London Bullion Market Association", jurisdiction: "International" },
  { code: "OFAC", name: "OFAC", fullName: "Office of Foreign Assets Control (US Treasury)", jurisdiction: "USA" },
  { code: "EU", name: "EU Council", fullName: "Council of the European Union — Sanctions Regime", jurisdiction: "EU" },
];

// ─── Key Legislation ─────────────────────────────────────────────────────────

export interface Legislation {
  code: string;
  title: string;
  shortTitle: string;
  issuedBy: string;
  year: number;
  keyArticles: string[];
  applicableTo: string;
}

export const KEY_LEGISLATION: Legislation[] = [
  {
    code: "FDL-10-2025",
    title: "Federal Decree-Law No. 10 of 2025 on Anti-Money Laundering and Combating the Financing of Terrorism and Financing of Illegal Organisations",
    shortTitle: "FDL No.10/2025",
    issuedBy: "UAE Federal Government",
    year: 2025,
    keyArticles: [
      "Art.12-13: CDD obligations",
      "Art.14-15: Enhanced Due Diligence",
      "Art.16: Cash transaction reporting (AED 55,000 threshold for DPMS)",
      "Art.17: High-risk jurisdiction measures",
      "Art.18: PEP identification and management",
      "Art.22-23: Targeted Financial Sanctions and asset freeze",
      "Art.26: Suspicious transaction/activity reporting to FIU",
      "Art.27: Tipping-off prohibition",
      "Art.28: Record keeping (minimum 10 years after end of business relationship)",
    ],
    applicableTo: "All DNFBPs including DPMS",
  },
  {
    code: "CR-134-2025",
    title: "Cabinet Resolution No. 134 of 2025 — Implementing Regulations of FDL No.10/2025",
    shortTitle: "Cabinet Res 134/2025",
    issuedBy: "UAE Cabinet",
    year: 2025,
    keyArticles: [
      "Art.4-6: CDD requirements and timing",
      "Art.6(3): Third-party payment verification",
      "Art.7: Beneficial ownership identification",
      "Art.8: PEP enhanced measures",
      "Art.12-14: 4-Eyes Principle for approvals",
      "Art.16: Transaction monitoring requirements",
    ],
    applicableTo: "All DNFBPs including DPMS",
  },
  {
    code: "CR-156-2025",
    title: "Cabinet Resolution No. 156 of 2025 — Proliferation Financing & Strategic Goods Controls",
    shortTitle: "Cabinet Res 156/2025",
    issuedBy: "UAE Cabinet",
    year: 2025,
    keyArticles: [
      "Art.3-5: Strategic goods and dual-use control lists",
      "Art.7: Industrial precious metals monitoring",
      "Art.9: End-use declaration requirements",
      "Art.11: EOCN reporting obligations (24 hours)",
    ],
    applicableTo: "DPMS and strategic goods dealers",
  },
  {
    code: "MOE-08-2021",
    title: "MoE Circular 08/AML/2021 — AML/CFT Obligations for Dealers in Precious Metals and Stones",
    shortTitle: "MoE Circular 08/AML/2021",
    issuedBy: "Ministry of Economy",
    year: 2021,
    keyArticles: [
      "DPMS cash transaction threshold: AED 55,000",
      "CDD requirements for DPMS sector",
      "Record retention requirements (10 years per FDL No.10/2025 Art.28)",
      "STR filing obligations via goAML",
      "Internal compliance program requirements",
      "Training and awareness obligations",
    ],
    applicableTo: "DPMS sector specifically",
  },
];

// ─── Reporting Deadlines ─────────────────────────────────────────────────────

export interface ReportingDeadline {
  reportType: string;
  description: string;
  deadline: string;
  reportTo: string;
  regulatoryRef: string;
  penaltyForBreach: string;
}

export const REPORTING_DEADLINES: ReportingDeadline[] = [
  {
    reportType: "STR",
    description: "Suspicious Transaction Report — file when suspicion of ML/TF identified",
    deadline: "Without delay; maximum 10 business days from date of suspicion",
    reportTo: "FIU via goAML portal",
    regulatoryRef: "FDL No.10/2025 Art.26, MoE Circular 08/AML/2021",
    penaltyForBreach: "Administrative fine AED 50,000–5,000,000 and/or criminal penalty",
  },
  {
    reportType: "SAR",
    description: "Suspicious Activity Report — file when suspicious behavior (non-transaction) identified",
    deadline: "Without delay; maximum 10 business days",
    reportTo: "FIU via goAML portal",
    regulatoryRef: "FDL No.10/2025 Art.26",
    penaltyForBreach: "Administrative fine AED 50,000–5,000,000 and/or criminal penalty",
  },
  {
    reportType: "CTR",
    description: "Cash Transaction Report — single cash transaction >= AED 55,000 by DPMS",
    deadline: "Within 15 business days of transaction",
    reportTo: "FIU via goAML portal",
    regulatoryRef: "FDL No.10/2025 Art.16, MoE Circular 08/AML/2021, FATF Rec 22",
    penaltyForBreach: "Administrative fine AED 50,000–1,000,000",
  },
  {
    reportType: "TFS-FREEZE",
    description: "Asset freeze / Targeted Financial Sanctions — immediate freeze on match",
    deadline: "Immediately upon identification; report to EOCN within 24 hours",
    reportTo: "EOCN (Executive Office of Control & Non-Proliferation)",
    regulatoryRef: "FDL No.10/2025 Art.22-23, Cabinet Res 156/2025 Art.11, EOCN Protocol",
    penaltyForBreach: "Criminal penalty; up to AED 10,000,000 fine and/or imprisonment",
  },
  {
    reportType: "PF-REPORT",
    description: "Proliferation Financing report — strategic goods or dual-use detection",
    deadline: "Within 24 hours of detection",
    reportTo: "EOCN + FIU",
    regulatoryRef: "Cabinet Res 156/2025, FATF Rec 7, UNSC Resolutions",
    penaltyForBreach: "Criminal penalty per FDL No.10/2025",
  },
  {
    reportType: "ANNUAL-COMPLIANCE",
    description: "Annual compliance report and EWRA to MoE",
    deadline: "Within 3 months of financial year end",
    reportTo: "Ministry of Economy",
    regulatoryRef: "MoE DPMS Supervisory Requirements",
    penaltyForBreach: "Administrative penalty; possible license suspension",
  },
  {
    reportType: "DPMSR",
    description: "DPMS-specific transaction report for trades >= AED 55,000",
    deadline: "Within 15 business days",
    reportTo: "FIU via goAML portal",
    regulatoryRef: "MoE Circular 08/AML/2021, FDL No.10/2025 Art.16",
    penaltyForBreach: "Administrative fine AED 50,000–1,000,000",
  },
];

// ─── MoE Audit Checklist ─────────────────────────────────────────────────────

export interface AuditChecklistItem {
  id: string;
  category: string;
  requirement: string;
  regulatoryRef: string;
  evidenceRequired: string;
  criticalForAudit: boolean;
}

export const MOE_AUDIT_CHECKLIST: AuditChecklistItem[] = [
  // AML/CFT Program
  { id: "AC-01", category: "AML/CFT Program", requirement: "Documented AML/CFT compliance program approved by Senior Management", regulatoryRef: "FDL No.10/2025 Art.20, MoE Guidance", evidenceRequired: "Written policy document with board approval date", criticalForAudit: true },
  { id: "AC-02", category: "AML/CFT Program", requirement: "Designated Compliance Officer and MLRO appointed", regulatoryRef: "FDL No.10/2025 Art.20, Cabinet Res 134/2025", evidenceRequired: "Appointment letter, fit-and-proper checks", criticalForAudit: true },
  { id: "AC-03", category: "AML/CFT Program", requirement: "Enterprise-Wide Risk Assessment (EWRA) conducted and documented", regulatoryRef: "FDL No.10/2025 Art.4, FATF Rec 1, MoE Guidance", evidenceRequired: "EWRA report with risk matrix and methodology", criticalForAudit: true },
  { id: "AC-04", category: "AML/CFT Program", requirement: "Independent audit of AML/CFT program (annual or biennial)", regulatoryRef: "FDL No.10/2025 Art.21, MoE Supervision", evidenceRequired: "Audit report with findings and remediation plan", criticalForAudit: true },

  // CDD/KYC
  { id: "AC-05", category: "CDD/KYC", requirement: "CDD performed on all customers before establishing business relationship", regulatoryRef: "FDL No.10/2025 Art.12-13, Cabinet Res 134/2025 Art.4-6", evidenceRequired: "Customer files with complete KYC packages", criticalForAudit: true },
  { id: "AC-06", category: "CDD/KYC", requirement: "Beneficial ownership identified and verified (>25% ownership threshold)", regulatoryRef: "FDL No.10/2025 Art.14, Cabinet Res 134/2025 Art.7, FATF Rec 10/24", evidenceRequired: "UBO register with supporting documents", criticalForAudit: true },
  { id: "AC-07", category: "CDD/KYC", requirement: "Risk-based CDD review frequency (high: 3mo, medium: 6mo, low: 12mo)", regulatoryRef: "Cabinet Res 134/2025 Art.16, MoE Guidance", evidenceRequired: "Review schedules and completed review records", criticalForAudit: true },
  { id: "AC-08", category: "CDD/KYC", requirement: "EDD applied to high-risk customers, PEPs, and high-risk jurisdictions", regulatoryRef: "FDL No.10/2025 Art.14-15/18, FATF Rec 10/12/19", evidenceRequired: "EDD files with senior management approval", criticalForAudit: true },

  // Transaction Monitoring
  { id: "AC-09", category: "Transaction Monitoring", requirement: "Ongoing transaction monitoring system implemented", regulatoryRef: "FDL No.10/2025 Art.15-16, FATF Rec 20/22", evidenceRequired: "TM rules, alert logs, investigation records", criticalForAudit: true },
  { id: "AC-10", category: "Transaction Monitoring", requirement: "Cash transactions >= AED 55,000 identified and reported (CTR)", regulatoryRef: "FDL No.10/2025 Art.16, MoE Circular 08/AML/2021", evidenceRequired: "CTR filing records via goAML", criticalForAudit: true },
  { id: "AC-11", category: "Transaction Monitoring", requirement: "Structuring/smurfing detection rules in place", regulatoryRef: "FDL No.10/2025 Art.16, FATF Rec 22", evidenceRequired: "TM rule configuration and alert samples", criticalForAudit: true },

  // Screening & Sanctions
  { id: "AC-12", category: "Screening", requirement: "Sanctions screening against UN/OFAC/EU/UAE lists at onboarding and ongoing", regulatoryRef: "FDL No.10/2025 Art.22-23, Cabinet Res 156/2025", evidenceRequired: "Screening logs with dates, lists checked, results", criticalForAudit: true },
  { id: "AC-13", category: "Screening", requirement: "PEP screening at onboarding and periodically", regulatoryRef: "FDL No.10/2025 Art.18, FATF Rec 12", evidenceRequired: "PEP screening results per customer", criticalForAudit: true },
  { id: "AC-14", category: "Screening", requirement: "TFS compliance — ability to freeze assets immediately", regulatoryRef: "FDL No.10/2025 Art.22-23, EOCN Protocol", evidenceRequired: "TFS procedures, freeze/unfreeze logs", criticalForAudit: true },

  // Reporting
  { id: "AC-15", category: "Reporting", requirement: "STR/SAR filing procedures documented and followed", regulatoryRef: "FDL No.10/2025 Art.26, FIU goAML Guide", evidenceRequired: "STR/SAR filing log, goAML submissions", criticalForAudit: true },
  { id: "AC-16", category: "Reporting", requirement: "No tipping-off — procedures to prevent customer notification of STR", regulatoryRef: "FDL No.10/2025 Art.27", evidenceRequired: "Access controls, need-to-know policy", criticalForAudit: true },
  { id: "AC-17", category: "Reporting", requirement: "EOCN reporting within 24 hours for TFS/PF matches", regulatoryRef: "Cabinet Res 156/2025 Art.11, EOCN Protocol", evidenceRequired: "EOCN communication logs", criticalForAudit: true },

  // Record Keeping
  { id: "AC-18", category: "Record Keeping", requirement: "All CDD records retained for minimum 10 years after end of business relationship", regulatoryRef: "FDL No.10/2025 Art.28, Cabinet Res 134/2025", evidenceRequired: "Record retention policy, data storage evidence", criticalForAudit: true },
  { id: "AC-19", category: "Record Keeping", requirement: "Transaction records retained for minimum 10 years", regulatoryRef: "FDL No.10/2025 Art.28", evidenceRequired: "Transaction archives, audit trail", criticalForAudit: true },

  // Training
  { id: "AC-20", category: "Training", requirement: "AML/CFT training for all relevant staff — annual minimum", regulatoryRef: "FDL No.10/2025 Art.20, MoE Guidance", evidenceRequired: "Training records, attendance logs, certificates", criticalForAudit: true },
  { id: "AC-21", category: "Training", requirement: "Role-specific training for MLRO and Compliance team", regulatoryRef: "MoE DPMS Supervisory Expectations", evidenceRequired: "Specialized training certificates", criticalForAudit: true },

  // PF/TFS
  { id: "AC-22", category: "PF/TFS", requirement: "Proliferation financing risk assessment conducted", regulatoryRef: "Cabinet Res 156/2025, FATF Rec 1/7", evidenceRequired: "PF risk assessment document", criticalForAudit: true },
  { id: "AC-23", category: "PF/TFS", requirement: "Strategic goods and dual-use screening implemented", regulatoryRef: "Cabinet Res 156/2025 Art.3-5", evidenceRequired: "Screening system logs, rule configuration", criticalForAudit: true },

  // Supply Chain (DPMS-specific)
  { id: "AC-24", category: "Supply Chain", requirement: "Know Your Supplier (KYS) due diligence for precious metals sourcing", regulatoryRef: "LBMA RGG v9, MoE DPMS Guidance, OECD DDG", evidenceRequired: "Supplier DD files, origin certificates, chain-of-custody", criticalForAudit: true },
  { id: "AC-25", category: "Supply Chain", requirement: "CAHRA (Conflict-Affected High-Risk Area) assessment for gold sourcing", regulatoryRef: "LBMA RGG v9, OECD DDG Annex II", evidenceRequired: "CAHRA risk assessments per supplier", criticalForAudit: false },
];

// ─── FIU Report Lifecycle ────────────────────────────────────────────────────

export type FIUReportStatus =
  | "draft"
  | "internal-review"
  | "mlro-approved"
  | "filed-goaml"
  | "acknowledged-fiu"
  | "info-requested"
  | "supplementary-filed"
  | "closed-fiu"
  | "post-filing-monitoring";

export interface FIUReportLifecycle {
  reportId: string;
  reportType: "STR" | "SAR" | "CTR" | "DPMSR";
  status: FIUReportStatus;
  goamlRefNo?: string;
  filedAt?: string;
  filedBy?: string;
  acknowledgedAt?: string;
  infoRequestedAt?: string;
  infoRequestDetails?: string;
  supplementaryFiledAt?: string;
  closedAt?: string;
  postFilingMonitoringEndDate?: string;
  timeline: Array<{
    status: FIUReportStatus;
    at: string;
    by: string;
    note?: string;
  }>;
}

// ─── EOCN Asset Freeze Protocol ──────────────────────────────────────────────

export type FreezeStatus =
  | "identified"
  | "frozen"
  | "reported-eocn"
  | "eocn-acknowledged"
  | "unfrozen"
  | "permanently-frozen";

export interface AssetFreezeRecord {
  id: string;
  entityId: string;
  entityName: string;
  matchType: "sanctions" | "tfs" | "pf" | "unsc-designation";
  listMatched: string;
  designationRef: string;
  freezeStatus: FreezeStatus;
  frozenAt?: string;
  frozenBy?: string;
  eocnReportedAt?: string;
  eocnReferenceNo?: string;
  eocnAcknowledgedAt?: string;
  unfrozenAt?: string;
  unfrozenBy?: string;
  unfreezeAuthorization?: string;
  assetsDescription: string;
  estimatedValue?: number;
  currency?: string;
  timeline: Array<{
    status: FreezeStatus;
    at: string;
    by: string;
    note?: string;
  }>;
  regulatoryRef: string;
}

/**
 * Check if EOCN 24-hour reporting deadline has been met.
 */
export function isEOCNDeadlineMet(freezeRecord: AssetFreezeRecord): {
  met: boolean;
  hoursElapsed: number;
  deadline: string;
} {
  if (!freezeRecord.frozenAt) {
    return { met: false, hoursElapsed: 0, deadline: "Immediate freeze required" };
  }

  const frozenTime = new Date(freezeRecord.frozenAt).getTime();
  const now = Date.now();
  const hoursElapsed = (now - frozenTime) / 3600000;
  const deadline = new Date(frozenTime + 24 * 3600000).toISOString();

  if (freezeRecord.eocnReportedAt) {
    const reportedTime = new Date(freezeRecord.eocnReportedAt).getTime();
    const reportHours = (reportedTime - frozenTime) / 3600000;
    return { met: reportHours <= 24, hoursElapsed: reportHours, deadline };
  }

  return { met: false, hoursElapsed, deadline };
}

/**
 * Validate compliance with all MoE audit checklist items.
 * Returns pass/fail per item for audit readiness assessment.
 */
export function assessAuditReadiness(
  completedItems: string[]
): {
  totalItems: number;
  completedCount: number;
  criticalTotal: number;
  criticalCompleted: number;
  readinessPct: number;
  criticalReadinessPct: number;
  missingCritical: AuditChecklistItem[];
} {
  const criticalItems = MOE_AUDIT_CHECKLIST.filter((i) => i.criticalForAudit);
  const criticalCompleted = criticalItems.filter((i) => completedItems.includes(i.id)).length;
  const completedCount = MOE_AUDIT_CHECKLIST.filter((i) => completedItems.includes(i.id)).length;

  return {
    totalItems: MOE_AUDIT_CHECKLIST.length,
    completedCount,
    criticalTotal: criticalItems.length,
    criticalCompleted,
    readinessPct: Math.round((completedCount / MOE_AUDIT_CHECKLIST.length) * 100),
    criticalReadinessPct: Math.round((criticalCompleted / criticalItems.length) * 100),
    missingCritical: criticalItems.filter((i) => !completedItems.includes(i.id)),
  };
}
