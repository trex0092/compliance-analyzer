/**
 * Asana Module Project Catalog — one project per subject/module so no
 * compliance artefact is missed and the MLRO has a dedicated board
 * for every flow.
 *
 * Today every screening / TM / STR / disposition task lands on a
 * single unified board (ASANA_SCREENINGS_PROJECT_GID). That works but
 * makes filtering noisy: a CAHRA supplier review sits next to an STR
 * deadline countdown sits next to a structuring alert. Splitting by
 * subject gives each MLRO workflow its own kanban with its own
 * sections + custom fields, AND keeps the evidence chain contiguous
 * (every module still writes through the same asanaClient, and every
 * delta cron still dispatches into the correct board).
 *
 * Each project entry carries:
 *   - `key`           — module identifier used in code and env vars
 *   - `envVar`        — env var name for the Asana project GID
 *   - `name`          — Asana project name (exact)
 *   - `description`   — first line rendered on the Asana project page
 *   - `sections`      — canonical section names created on bootstrap
 *   - `regulatoryBasis` — citation block the MLRO can quote to audit
 *   - `owner`         — MLRO role expected to triage
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
  | 'subject_screening'
  | 'transaction_monitoring'
  | 'str_cases'
  | 'watchlist'
  | 'cdd_lifecycle'
  | 'ubo_register'
  | 'pep_program'
  | 'records_retention'
  | 'esg_supply_chain'
  | 'lbma_rgg'
  | 'dual_use_export_control'
  | 'regulatory_updates'
  | 'ai_governance'
  | 'audit_inspection'
  | 'mlro_digest';

export const MODULE_PROJECTS: readonly ModuleProjectSpec[] = Object.freeze([
  {
    key: 'subject_screening',
    envVar: 'ASANA_SCREENINGS_PROJECT_GID',
    name: 'Subject Screening',
    description:
      'Sanctions + adverse-media + PEP screening — run tasks, disposition tasks, watchlist deltas, life-story reports.',
    sections: [
      'Inbox',
      'The Screenings',
      'Partial Match — Investigate',
      'Confirmed Match — FREEZE',
      'False Positive — Dismissed',
      'Negative — No Match',
      'Re-screen Required',
    ],
    regulatoryBasis:
      'FDL No.10/2025 Art.20-22 · Cabinet Res 74/2020 Art.4-7 · Cabinet Res 134/2025 Art.14 · FATF Rec 6-7, 10',
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
    key: 'watchlist',
    envVar: 'ASANA_WATCHLIST_PROJECT_GID',
    name: 'Active Watchlist & Ongoing Monitoring',
    description:
      'Every enrolled subject + delta alerts from the 06:00 / 14:00 UTC re-screens and every 4h sanctions-delta cron.',
    sections: [
      'Enrolled — Active',
      'Delta — New Hit',
      'Delta — Score Changed',
      'Periodic Review Due',
      'Pending Resolution',
      'De-enrolled',
    ],
    regulatoryBasis:
      'FATF Rec 10 · FDL No.10/2025 Art.20-21 · Cabinet Res 134/2025 Art.14, 19',
    owner: 'MLRO',
  },
  {
    key: 'cdd_lifecycle',
    envVar: 'ASANA_CDD_PROJECT_GID',
    name: 'CDD / EDD / SDD Lifecycle',
    description:
      'Onboarding pipeline, tier-based re-review, source-of-wealth refresh, dormant-account sweep.',
    sections: [
      'Onboarding — New',
      'Standard CDD',
      'Enhanced Due Diligence (EDD)',
      'Simplified Due Diligence (SDD)',
      'Periodic Review — Due',
      'Senior Management Approval',
      'Offboarded',
    ],
    regulatoryBasis:
      'Cabinet Res 134/2025 Art.7-10, Art.14 · FDL No.10/2025 Art.12-14 · FATF Rec 10, 12',
    owner: 'Compliance Officer',
  },
  {
    key: 'ubo_register',
    envVar: 'ASANA_UBO_PROJECT_GID',
    name: 'UBO Register & Ownership Chain',
    description:
      'Beneficial ownership >25%, re-verification on ownership change, layering chain + shell-company indicators.',
    sections: [
      'Verified — Active',
      'Re-verify — T-15 Working Days',
      'Ownership Change Detected',
      'Chain Under Investigation',
      'Shell / Front Company Flag',
      'Inconsistency Escalation',
    ],
    regulatoryBasis:
      'Cabinet Decision 109/2023 · FATF Rec 24-25 · FDL No.10/2025 Art.14',
    owner: 'Compliance Officer',
  },
  {
    key: 'pep_program',
    envVar: 'ASANA_PEP_PROJECT_GID',
    name: 'PEP Program',
    description:
      'PEP (self / family / associate / former / SOE), tier-based re-screen, senior-management approval gate.',
    sections: [
      'PEP Identified',
      'Senior Management Approval — Required',
      'Approved — Active EDD',
      'Periodic Re-screen Due',
      'Former PEP — Under Risk-based Continuation',
      'Dismissed',
    ],
    regulatoryBasis:
      'FATF Rec 12 · Cabinet Res 134/2025 Art.14 · Wolfsberg PEP FAQs',
    owner: 'Compliance Officer',
  },
  {
    key: 'records_retention',
    envVar: 'ASANA_RETENTION_PROJECT_GID',
    name: 'Records Retention & Evidence',
    description:
      '10-year retention integrity, expiring records, evidence-bundle exports, inspection readiness.',
    sections: [
      'Active — Retention Clock Running',
      'Expiring — T-90 Days',
      'Expiring — T-30 Days',
      'Evidence Bundle Requested',
      'Archived — Retention Met',
      'Integrity Anomaly',
    ],
    regulatoryBasis:
      'FDL No.10/2025 Art.24 · Cabinet Res 71/2024 · LBMA RGG v9 Step 5',
    owner: 'MLRO',
  },
  {
    key: 'esg_supply_chain',
    envVar: 'ASANA_ESG_PROJECT_GID',
    name: 'ESG & Supply Chain',
    description:
      'CAHRA reviews, modern-slavery indicators, ASM compliance, mercury/Minamata, child-labour, water, grievance mechanism.',
    sections: [
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
      'LBMA RGG v9 Step 2-4 · UAE MoE RSG · OECD DD Annex II · UNGPs · ILO C-182 · Minamata Convention',
    owner: 'Compliance Officer',
  },
  {
    key: 'lbma_rgg',
    envVar: 'ASANA_LBMA_PROJECT_GID',
    name: 'LBMA RGG & Gold Supply Chain',
    description:
      'LBMA RGG Step 3-5: chain-of-custody, assay drift, refiner accreditation, recycled-vs-mined classification, annual audit countdown.',
    sections: [
      'Step 3 — Chain of Custody',
      'Step 4 — Risk Management',
      'Step 5 — Annual Audit',
      'Refiner Accreditation',
      'Assay Drift Alert',
      'Origin Classification Audit',
      'DGD Reaccreditation',
    ],
    regulatoryBasis:
      'LBMA RGG v9 Step 3-5 · DGD Standard · UAE MoE RSG Framework · OFAC Russia gold sanctions',
    owner: 'Compliance Officer',
  },
  {
    key: 'dual_use_export_control',
    envVar: 'ASANA_EXPORT_CONTROL_PROJECT_GID',
    name: 'Dual-Use & Export Control',
    description:
      'Cabinet Res 156/2025 + Wassenaar + UAE Strategic Trade Control; dual-use tariff flags + sensitive end-use signals + proliferation-financing review.',
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
    key: 'regulatory_updates',
    envVar: 'ASANA_REGULATORY_PROJECT_GID',
    name: 'Regulatory Updates & Horizon',
    description:
      'MoE / CBUAE / EOCN / VARA / FATF / LBMA circular tracking, drift detection, policy-refresh tasks, constants bumps.',
    sections: [
      'New Circular — To Review',
      'Policy Gap Detected',
      'Constants Bump Pending',
      'MLRO Memo Drafted',
      'Board Memo Pending',
      'Actioned',
      'Horizon — Not Yet Effective',
    ],
    regulatoryBasis:
      'FDL No.10/2025 Art.20 · Cabinet Res 134/2025 Art.18-19 · FATF Rec 34',
    owner: 'MLRO',
  },
  {
    key: 'ai_governance',
    envVar: 'ASANA_AI_GOVERNANCE_PROJECT_GID',
    name: 'AI Governance & Assurance',
    description:
      'Self-audit (EU AI Act + NIST AI RMF + ISO/IEC 42001 + UAE AI), red-team probes, drift detection, explainability audits, advisor-budget tracking.',
    sections: [
      'Self-Audit — Periodic',
      'Red-Team Finding',
      'Drift Detected',
      'Explainability Issue',
      'Consistency Failure',
      'Advisor Budget Breach',
      'Resolved',
    ],
    regulatoryBasis:
      'EU AI Act Art.9, 13, 15 · NIST AI RMF · ISO/IEC 42001 · UAE AI ethical framework',
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
    regulatoryBasis:
      'Cabinet Res 71/2024 · FDL No.10/2025 Art.21, 24 · LBMA RGG v9 Step 5',
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
    regulatoryBasis:
      'Cabinet Res 134/2025 Art.19 · FDL No.10/2025 Art.20-21',
    owner: 'MLRO',
  },
]);

export function getModuleProjectGid(key: ModuleKey): string | undefined {
  const spec = MODULE_PROJECTS.find((p) => p.key === key);
  if (!spec) return undefined;
  return process.env[spec.envVar] || undefined;
}

export function getAllModuleEnvVars(): readonly string[] {
  return MODULE_PROJECTS.map((p) => p.envVar);
}

export function moduleProjectByKey(key: ModuleKey): ModuleProjectSpec | undefined {
  return MODULE_PROJECTS.find((p) => p.key === key);
}

export const MODULE_KEYS_IN_CATALOG: readonly ModuleKey[] = MODULE_PROJECTS.map(
  (p) => p.key,
);
