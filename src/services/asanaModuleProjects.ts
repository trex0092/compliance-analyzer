/**
 * Asana Module Project Catalog — 16 per-domain boards approved by the
 * MLRO. One project per compliance domain so no artefact is orphaned
 * and the MLRO has a dedicated kanban + sections + custom fields per
 * flow.
 *
 * The catalog started at 23 (one project per sub-module). The MLRO
 * merged related domains into 5 consolidated boards so the active
 * count is 16:
 *
 *   Subject Screening + Watchlist           -> 1 board
 *   CDD/EDD/SDD + UBO + PEP                  -> 1 board
 *   ESG + Supply Chain + LBMA RGG            -> 1 board
 *   Regulatory Updates + AI Governance +
 *     Records Retention                     -> 1 board
 *   Employees & Access + Training            -> 1 board
 *
 * Each project entry carries:
 *   - `key`            — module identifier used in code and env vars
 *   - `envVar`         — env var name for the Asana project GID
 *   - `name`           — exact Asana project name as provisioned
 *   - `description`    — first line rendered on the Asana project page
 *   - `sections`       — canonical section names created on bootstrap
 *   - `regulatoryBasis` — citation block the MLRO can quote to audit
 *   - `owner`          — MLRO role expected to triage
 *
 * Usage:
 *   import { MODULE_PROJECTS, getModuleProjectGid } from
 *     './asanaModuleProjects';
 *   const gid = getModuleProjectGid('transaction_monitoring');
 *
 * Regulatory anchor:
 *   FDL No.10/2025 Art.20-21 (CO visibility — dedicated board per
 *     domain so nothing hides under a generic queue)
 *   FDL No.10/2025 Art.24 (10-yr retention — each board is an
 *     authoritative audit trail for its domain)
 *   Cabinet Res 134/2025 Art.19 (internal review cadence — per-domain
 *     boards drive the weekly compliance digest)
 */

export interface ModuleProjectSpec {
  key: ModuleKey;
  envVar: string;
  name: string;
  description: string;
  sections: readonly string[];
  regulatoryBasis: string;
  owner: 'MLRO' | 'Deputy MLRO' | 'Compliance Officer' | 'Senior Management';
}

export type ModuleKey =
  | 'screening_and_watchlist'
  | 'transaction_monitoring'
  | 'str_cases'
  | 'cdd_ubo_pep'
  | 'esg_supply_lbma'
  | 'dual_use_export_control'
  | 'governance_and_retention'
  | 'audit_inspection'
  | 'mlro_digest'
  | 'employees_and_training'
  | 'onboarding_workbench'
  | 'compliance_tasks'
  | 'four_eyes_queue'
  | 'shipments_logistics'
  | 'counterparties_accounts'
  | 'incidents_whistleblower';

export const MODULE_PROJECTS: readonly ModuleProjectSpec[] = Object.freeze([
  {
    key: 'screening_and_watchlist',
    envVar: 'ASANA_SCREENINGS_PROJECT_GID',
    name: 'Subject Screening & Watchlist',
    description:
      'Sanctions + adverse-media + PEP screening AND ongoing-monitoring deltas. Run tasks, disposition tasks, life-story reports, watchlist enrolment, daily re-screens.',
    sections: [
      'Inbox',
      'The Screenings',
      'Partial Match — Investigate',
      'Confirmed Match — FREEZE',
      'False Positive — Dismissed',
      'Negative — No Match',
      'Re-screen Required',
      'Enrolled — Monitoring',
      'Delta — New Hit',
      'Delta — Score Changed',
      'Periodic Review Due',
      'De-enrolled',
    ],
    regulatoryBasis:
      'FDL No.10/2025 Art.20-22 · Cabinet Res 74/2020 Art.4-7 · Cabinet Res 134/2025 Art.14, 19 · FATF Rec 6-7, 10',
    owner: 'MLRO',
  },
  {
    key: 'transaction_monitoring',
    envVar: 'ASANA_TM_PROJECT_GID',
    name: 'Transaction Monitoring',
    description:
      'Rule + behavioural TM alerts. Structuring near AED 55K, velocity spikes, third-party payers, offshore routing, TBML, VASP wallet anomalies.',
    sections: [
      'Inbox',
      'Critical — Auto-STR Trigger',
      'High — Investigate',
      'Medium — Document',
      'Structuring Cluster',
      'Velocity Anomaly',
      'TBML Indicator',
      'VASP Wallet Flow',
      'Dismissed',
    ],
    regulatoryBasis:
      'FDL No.10/2025 Art.26-27 · MoE Circular 08/AML/2021 · FATF Rec 10, 15 · Cabinet Res 134/2025 Art.16',
    owner: 'MLRO',
  },
  {
    key: 'str_cases',
    envVar: 'ASANA_STR_PROJECT_GID',
    name: 'STR / SAR / CTR / DPMSR / CNMR Cases',
    description:
      'goAML case files, filing countdowns, four-eyes approvals, filed confirmations, FIU responses.',
    sections: [
      'Drafting',
      'Ready for Four-Eyes',
      'Ready to File',
      'Filed — Awaiting FIU Response',
      'FIU Response Received',
      'Overdue',
      'Closed',
    ],
    regulatoryBasis:
      'FDL No.10/2025 Art.26-27 · Cabinet Res 74/2020 Art.5-7 · FATF Rec 20 · goAML Schema',
    owner: 'MLRO',
  },
  {
    key: 'cdd_ubo_pep',
    envVar: 'ASANA_CDD_PROJECT_GID',
    name: 'Customer Due Diligence — UBO & PEP',
    description:
      'CDD / EDD / SDD lifecycle, UBO register + ownership chain + shell-company indicators, PEP program (self / family / associate / former / SOE).',
    sections: [
      'Onboarding — New',
      'Standard CDD',
      'Enhanced Due Diligence (EDD)',
      'Simplified Due Diligence (SDD)',
      'Periodic Review — Due',
      'Senior Management Approval',
      'PEP Identified',
      'Former PEP — Risk-based Continuation',
      'UBO Verified',
      'UBO Re-verify — T-15 Working Days',
      'Ownership Change Detected',
      'Shell / Front Company Flag',
      'Inconsistency Escalation',
      'Offboarded',
    ],
    regulatoryBasis:
      'Cabinet Res 134/2025 Art.7-10, 14 · Cabinet Decision 109/2023 · FDL No.10/2025 Art.12-14 · FATF Rec 10, 12, 24-25 · Wolfsberg PEP FAQs',
    owner: 'Compliance Officer',
  },
  {
    key: 'esg_supply_lbma',
    envVar: 'ASANA_ESG_LBMA_PROJECT_GID',
    name: 'ESG, Supply Chain & LBMA RGG',
    description:
      'CAHRA supplier reviews, modern slavery, ASM compliance, mercury / Minamata, child labour, water stewardship, grievance mechanism. Plus LBMA RGG Step 3-5 chain-of-custody, assay drift, refiner accreditation, recycled-vs-mined origin, annual audit countdown.',
    sections: [
      'Step 3 — Chain of Custody',
      'Step 4 — Risk Management',
      'Step 5 — Annual Audit',
      'Refiner Accreditation',
      'Assay Drift Alert',
      'Origin Classification Audit',
      'DGD Reaccreditation',
      'CAHRA Review',
      'Modern Slavery Risk',
      'ASM Supplier Audit',
      'Mercury / Minamata',
      'Child Labour (ILO C-182)',
      'Carbon / Water / Environment',
      'Grievance Mechanism',
      'Remediated',
    ],
    regulatoryBasis:
      'LBMA RGG v9 Step 2-5 · DGD Standard · UAE MoE RSG Framework · OECD DD Annex II · UNGPs · ILO C-182 · Minamata Convention · OFAC Russia gold sanctions',
    owner: 'Compliance Officer',
  },
  {
    key: 'dual_use_export_control',
    envVar: 'ASANA_EXPORT_CONTROL_PROJECT_GID',
    name: 'Dual-Use & Export Control',
    description:
      'Cabinet Res 156/2025 + Wassenaar + UAE Strategic Trade Control. Dual-use tariff flags, sensitive end-use signals, proliferation-financing review.',
    sections: [
      'Dual-Use Flag — Investigate',
      'Strategic Goods — HS Match',
      'End-Use / End-User Gap',
      'PF / DPRK / Iran Pattern',
      'Cleared',
      'Transaction Halted',
    ],
    regulatoryBasis:
      'Cabinet Res 156/2025 · UAE Strategic Trade Control · Wassenaar · UNSCR 1540 / 2231 · FATF Rec 7',
    owner: 'Compliance Officer',
  },
  {
    key: 'governance_and_retention',
    envVar: 'ASANA_GOVERNANCE_PROJECT_GID',
    name: 'Governance, Regulatory Updates & Records Retention',
    description:
      'MoE / CBUAE / EOCN / VARA / FATF / LBMA circular tracking, policy gap detection, constants bumps. AI governance self-audit (EU AI Act + NIST AI RMF + ISO/IEC 42001), red-team, drift, explainability, consistency failures, advisor-budget tracking. 10-yr records retention integrity + evidence bundles.',
    sections: [
      'New Circular — To Review',
      'Policy Gap Detected',
      'Constants Bump Pending',
      'MLRO Memo Drafted',
      'Board Memo Pending',
      'Horizon — Not Yet Effective',
      'AI Self-Audit',
      'AI Red-Team Finding',
      'AI Drift Detected',
      'Explainability Issue',
      'Consistency Failure',
      'Advisor Budget Breach',
      'Records Expiring — T-90 Days',
      'Records Expiring — T-30 Days',
      'Evidence Bundle Requested',
      'Records Archived — Retention Met',
      'Integrity Anomaly',
      'Actioned / Resolved',
    ],
    regulatoryBasis:
      'FDL No.10/2025 Art.20, 24 · Cabinet Res 71/2024 · Cabinet Res 134/2025 Art.18-19 · FATF Rec 34 · EU AI Act Art.9, 13, 15 · NIST AI RMF · ISO/IEC 42001 · LBMA RGG v9 Step 5',
    owner: 'MLRO',
  },
  {
    key: 'audit_inspection',
    envVar: 'ASANA_AUDIT_INSPECTION_PROJECT_GID',
    name: 'Audit & Inspection Readiness',
    description:
      'MoE inspection prep, LBMA annual audit, CBUAE thematic review, internal audit, external counsel evidence requests.',
    sections: [
      'Inspection Scheduled',
      'Evidence Being Assembled',
      'Evidence Ready',
      'Inspection Active',
      'Finding — Open',
      'Finding — Remediated',
      'Closed',
    ],
    regulatoryBasis: 'Cabinet Res 71/2024 · FDL No.10/2025 Art.21, 24 · LBMA RGG v9 Step 5',
    owner: 'MLRO',
  },
  {
    key: 'mlro_digest',
    envVar: 'ASANA_CENTRAL_MLRO_PROJECT_GID',
    name: 'MLRO Central Digest',
    description:
      'Weekly compliance digest, morning briefings, weekly customer status, KPI rollups — the MLRO single-pane-of-glass.',
    sections: [
      'Today',
      'This Week',
      'Weekly Digest — Drafted',
      'Board Report — Pending',
      'KPI Report',
      'Archived',
    ],
    regulatoryBasis: 'Cabinet Res 134/2025 Art.19 · FDL No.10/2025 Art.20-21',
    owner: 'MLRO',
  },
  {
    key: 'employees_and_training',
    envVar: 'ASANA_EMPLOYEES_TRAINING_PROJECT_GID',
    name: 'Employees, Access & Training',
    description:
      'MLRO + Deputy appointment audit, role changes, RACI updates, access-rights matrix, DOJ / board notifications. Annual AML/CFT/CPF training per employee, role-specific training, quiz completion, refresher cycle, external regulatory webinar attendance.',
    sections: [
      'MLRO + Deputy Appointments',
      'Role Changes',
      'RACI Updates',
      'Access Rights Matrix',
      'DOJ / Board Notifications',
      'Annual AML/CFT/CPF Training',
      'Role-specific Training',
      'Quiz Completion',
      'Refresher Cycle',
      'External Webinar Attendance',
    ],
    regulatoryBasis: 'Cabinet Res 134/2025 Art.11, 18 · FDL No.10/2025 Art.20-22 · FATF Rec 18',
    owner: 'MLRO',
  },
  {
    key: 'onboarding_workbench',
    envVar: 'ASANA_ONBOARDING_PROJECT_GID',
    name: 'Onboarding Workbench',
    description:
      'New customer wizard state, document collection status, KYC pack assembly, first-screening life-story handoff.',
    sections: [
      'Wizard — In Progress',
      'Documents — Pending',
      'KYC Pack — Assembling',
      'First-Screening Handoff',
      'Awaiting Senior Management Approval',
      'Approved — Live',
      'Rejected',
    ],
    regulatoryBasis: 'Cabinet Res 134/2025 Art.7-10 · FDL No.10/2025 Art.12-14 · FATF Rec 10',
    owner: 'Compliance Officer',
  },
  {
    key: 'compliance_tasks',
    envVar: 'ASANA_COMPLIANCE_TASKS_PROJECT_GID',
    name: 'Compliance Tasks — Master Queue',
    description:
      'The canonical MLRO single to-do list — every open task across every module, sorted by priority + deadline.',
    sections: ['Today', 'This Week', 'Next 30 Days', 'Blocked', 'In Review', 'Done'],
    regulatoryBasis: 'FDL No.10/2025 Art.20-21 · Cabinet Res 134/2025 Art.19',
    owner: 'MLRO',
  },
  {
    key: 'four_eyes_queue',
    envVar: 'ASANA_FOUR_EYES_PROJECT_GID',
    name: 'Four-Eyes Approvals Queue',
    description:
      'Every partial / confirmed screening match, every STR disposition, every high-risk CDD decision waiting on the second approver.',
    sections: [
      'Awaiting Second Approver',
      'In Review',
      'Approved',
      'Rejected',
      'Escalated to Senior Management',
      'Consistency Waiver Signed',
    ],
    regulatoryBasis:
      'FDL No.10/2025 Art.20-21 · Cabinet Res 134/2025 Art.19 · EU AI Act Art.14 (human oversight)',
    owner: 'Compliance Officer',
  },
  {
    key: 'shipments_logistics',
    envVar: 'ASANA_SHIPMENTS_PROJECT_GID',
    name: 'Shipments & Trade Logistics',
    description:
      'Bullion inbound / outbound, carrier + route + insurance, customs declarations, DGD / LBMA good-delivery tracking, Inbound Advice workflow, local UAE vault-to-vault movements.',
    sections: [
      'Inbound Advice',
      'Inbound — In Transit',
      'Inbound — Received',
      'Outbound — Scheduled',
      'Outbound — In Transit',
      'Outbound — Delivered',
      'Local Shipments',
      'Customs Held',
      'Assay / Quality Flag',
      'Closed',
    ],
    regulatoryBasis:
      'UAE Customs Law · LBMA Good Delivery · DGD Standard · Cabinet Res 134/2025 Art.16',
    owner: 'Compliance Officer',
  },
  {
    key: 'counterparties_accounts',
    envVar: 'ASANA_COUNTERPARTIES_PROJECT_GID',
    name: 'Counterparties & Approved Accounts',
    description:
      'Master counterparty register, bank correspondents, suppliers, authorised signatories. Adverse-media deltas on approved accounts. Sanctions / PEP re-screen events on counterparties.',
    sections: [
      'Approved — Active',
      'Pending Approval',
      'Correspondent Banks',
      'Suppliers',
      'Authorised Signatories',
      'Adverse-Media Delta',
      'Sanctions / PEP Delta',
      'Suspended',
      'De-listed',
    ],
    regulatoryBasis:
      'FATF Rec 10, 13 · CBUAE Correspondent Banking Standard · Cabinet Res 134/2025 Art.14',
    owner: 'Compliance Officer',
  },
  {
    key: 'incidents_whistleblower',
    envVar: 'ASANA_INCIDENTS_PROJECT_GID',
    name: 'Incidents & Whistleblower',
    description:
      'AML breaches, cybersecurity events, physical-security incidents, PDPL data breaches, anonymous + named whistleblower channel, root-cause + remediation tracking.',
    sections: [
      'New Incident — Triage',
      'Active Investigation',
      'Whistleblower — Anonymous',
      'Whistleblower — Named',
      'Root-Cause Analysis',
      'Remediation In Progress',
      'Regulator Notification Filed',
      'Closed — With Lessons',
    ],
    regulatoryBasis:
      'FDL No.10/2025 Art.21, 29 · Cabinet Res 71/2024 · UAE PDPL Art.25 · ISO/IEC 27001 Annex A.16 · UAE Whistleblower Protection frameworks',
    owner: 'MLRO',
  },
]);

// Browser-safe env reader. This module is imported from both
// Netlify functions (Node runtime, `process` defined) and from
// browser-side bundlers that may strip `process` entirely. The
// guard keeps both paths working without `@types/node` leaking
// into browser code.
function readEnv(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env?.[name]) {
    const v = process.env[name];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  }
  return undefined;
}

export function getModuleProjectGid(key: ModuleKey): string | undefined {
  const spec = MODULE_PROJECTS.find((p) => p.key === key);
  if (!spec) return undefined;
  return readEnv(spec.envVar);
}

/**
 * Resolve the Asana project GID for a given module with a safe
 * fallback to ASANA_SCREENINGS_PROJECT_GID. Every Netlify function
 * that writes to Asana should call this so the 16-project catalog
 * is the single source of truth and the screening board absorbs
 * anything that lands before the MLRO bootstraps the new boards.
 *
 * This avoids the "project GID not found" class of errors the old
 * layout produced when ASANA_WORKBENCH_PROJECT_GID / LOGISTICS /
 * ROUTINES were never populated.
 */
export function resolveAsanaProjectGid(key: ModuleKey): string {
  return getModuleProjectGid(key) || readEnv('ASANA_SCREENINGS_PROJECT_GID') || '1213759768596515';
}

export function getAllModuleEnvVars(): readonly string[] {
  return MODULE_PROJECTS.map((p) => p.envVar);
}

export function moduleProjectByKey(key: ModuleKey): ModuleProjectSpec | undefined {
  return MODULE_PROJECTS.find((p) => p.key === key);
}

export const MODULE_KEYS_IN_CATALOG: readonly ModuleKey[] = MODULE_PROJECTS.map((p) => p.key);
