/**
 * Supporting Agents Catalog — twelve specialist agents that sit
 * beside the 19-subsystem weaponized brain. Each agent carries a
 * single responsibility, a defined I/O contract, and the regulatory
 * basis that constrains what it can and cannot produce.
 *
 * These are MVP shells — the full orchestration lives in
 * src/agents/orchestration/, and each agent's actual execution path
 * is wired in a follow-on commit. The purpose of this file is the
 * SINGLE source of truth for what every agent is, what it inputs,
 * what it outputs, and which Asana module project it writes to.
 *
 * Regulatory anchor:
 *   FDL No.10/2025 Art.20-21 (CO accountability — every agent is
 *     attributable to the principal that invoked it)
 *   FDL No.10/2025 Art.24 (10-yr audit trail per agent invocation)
 *   FDL No.10/2025 Art.29 (no tipping off — research + translation
 *     agents carry hard guards)
 *   EU AI Act Art.13 + 15 (transparency + robustness for every agent)
 *   NIST AI RMF MANAGE-2 (defined purpose, inputs, outputs, metrics)
 *   ISO/IEC 42001 §8.2 (operational planning and control)
 */

import type { ModuleKey } from '../../services/asanaModuleProjects';

export interface SupportingAgentSpec {
  id: string;
  skillSlash: string;
  name: string;
  purpose: string;
  owner: 'MLRO' | 'Compliance Officer' | 'Deputy MLRO';
  inputs: readonly string[];
  outputs: readonly string[];
  regulatoryBasis: string;
  asanaProject: ModuleKey;
  guards: readonly string[];
}

export const SUPPORTING_AGENTS: readonly SupportingAgentSpec[] = Object.freeze([
  {
    id: 'research-agent',
    skillSlash: '/research-agent',
    name: 'Research Agent',
    purpose:
      'Iterative adverse-media deep-dive. Search → reason → extract → cite → loop. Produces a curated evidence dossier with full source preservation.',
    owner: 'MLRO',
    inputs: ['subjectName', 'customerCode', 'aliases', 'context'],
    outputs: [
      'dossier (markdown)',
      'citations (RFC7231 URLs + timestamps)',
      'confidence per claim',
    ],
    regulatoryBasis:
      'FATF Rec 10 (ongoing CDD) · FDL Art.29 (no tipping off on the queries themselves) · Cabinet Res 134/2025 Art.14',
    asanaProject: 'screening_and_watchlist',
    guards: [
      'No subject data in cleartext to third-party search APIs without allow-list check',
      'Every external query logged to research-agent-audit (FDL Art.24)',
      'Rate-limited to the adverse-media-hot-sweep cadence when called in batch',
    ],
  },
  {
    id: 'document-agent',
    skillSlash: '/document-agent',
    name: 'Document Agent',
    purpose:
      'OCR + structured extraction on passports, Emirates IDs, trade licences, bank statements, bullion assay certs, and customs declarations.',
    owner: 'Compliance Officer',
    inputs: ['documentBlobKey', 'expectedDocType', 'subjectCode'],
    outputs: ['structuredFields', 'confidencePerField', 'flaggedAnomalies'],
    regulatoryBasis:
      'Cabinet Res 134/2025 Art.7-10 (CDD documentary evidence) · FDL Art.24 · UAE PDPL Art.6(1)(c)',
    asanaProject: 'onboarding_workbench',
    guards: [
      'On-prem / sovereign model for UAE-resident subject data (MiniCPM-V gate)',
      'No OCR output leaves the tenant perimeter unencrypted',
      'Every document processed under a signed data-processing addendum',
    ],
  },
  {
    id: 'ubo-graph-agent',
    skillSlash: '/ubo-graph-agent',
    name: 'UBO Graph Agent',
    purpose:
      'Traces ownership chains beyond the 25% threshold, surfaces shell-company indicators, detects layering patterns, and emits a multi-hop ownership graph for review.',
    owner: 'Compliance Officer',
    inputs: ['legalEntityId', 'depth (default 5)', 'jurisdictionBlacklist'],
    outputs: ['ownershipGraph (nodes + edges)', 'shellCompanyFlags', 'layeringIndicators'],
    regulatoryBasis: 'Cabinet Decision 109/2023 (UBO register) · FATF Rec 24-25 · FDL Art.14',
    asanaProject: 'cdd_ubo_pep',
    guards: [
      'Cross-jurisdiction queries require MLRO explicit approval if any hop sits in a secrecy jurisdiction',
      '15 working-day re-verification trigger on any detected ownership change',
      'Graph rendered via xyflow in the war-room view',
    ],
  },
  {
    id: 'four-eyes-arbitrator',
    skillSlash: '/four-eyes-arbitrator',
    name: 'Four-Eyes Arbitrator',
    purpose:
      'Mediates partial / confirmed matches and high-risk CDD decisions that need a second approver. Summarises the first-reviewer rationale, surfaces the decision rule that applies, and prompts the second approver with a crisp yes/no.',
    owner: 'Compliance Officer',
    inputs: ['eventId', 'firstReviewerName', 'firstReviewerRationale'],
    outputs: ['secondApproverBrief', 'regulatoryRule', 'recommendedDecision'],
    regulatoryBasis:
      'FDL Art.20-21 · Cabinet Res 134/2025 Art.19 · EU AI Act Art.14 (human oversight)',
    asanaProject: 'four_eyes_queue',
    guards: [
      'Second approver must be a different principal than the first reviewer',
      'Agent cannot pre-approve — it drafts, human signs',
      'Consistency waiver requires MLRO written rationale',
    ],
  },
  {
    id: 'str-drafter',
    skillSlash: '/str-drafter',
    name: 'STR Drafter Agent',
    purpose:
      'Generates a FIU-schema-valid goAML XML STR / SAR / CTR / DPMSR / CNMR draft from the disposition payload and the full evidence bundle.',
    owner: 'MLRO',
    inputs: ['eventId', 'dispositionPayload', 'evidenceBundleRef'],
    outputs: ['goamlXml', 'validationReport', 'filingDeadlineCountdown'],
    regulatoryBasis:
      'FDL Art.26-27 (file without delay) · Cabinet Res 74/2020 Art.6 (CNMR 5 business days) · goAML Schema',
    asanaProject: 'str_cases',
    guards: [
      'XML is VALIDATED against the UAE FIU schema before the MLRO signs',
      'MLRO + second approver both required before submission',
      'Subject is NEVER notified (FDL Art.29)',
    ],
  },
  {
    id: 'citation-agent',
    skillSlash: '/citation-agent',
    name: 'Regulatory Citation Agent',
    purpose:
      'Resolves every claim in an Asana task body, rationale, or STR narrative to the exact FDL Article / Cabinet Res / FATF Recommendation / LBMA Step that authorises it. Flags uncited claims and proposes the missing citation.',
    owner: 'MLRO',
    inputs: ['textBlock', 'jurisdiction'],
    outputs: ['annotatedText', 'citationGraph', 'uncitedClaims'],
    regulatoryBasis:
      'FDL Art.20-21 (CO must cite) · Cabinet Res 71/2024 (penalties for uncited compliance action)',
    asanaProject: 'governance_and_retention',
    guards: [
      'Citations must resolve to the local regulatory text version pinned in src/domain/constants.ts',
      'Any claim citing a deprecated version raises a regulatory-drift Asana task',
    ],
  },
  {
    id: 'life-story-agent',
    skillSlash: '/life-story-agent',
    name: 'Life-Story Synthesiser',
    purpose:
      'Assembles the 8-section Life-Story markdown report for first-time customer screenings (onboarding / periodic review). Merges sanctions + PEP + adverse-media + UBO + transaction-risk into one dense briefing.',
    owner: 'MLRO',
    inputs: ['subjectCode', 'runId', 'depth (surface|deep)'],
    outputs: ['lifeStoryMarkdown', 'regulatoryChecklist'],
    regulatoryBasis: 'Cabinet Res 134/2025 Art.7-10 (CDD depth) · FATF Rec 10 · FDL Art.24',
    asanaProject: 'screening_and_watchlist',
    guards: [
      'Report flagged as CONFIDENTIAL (FDL Art.29)',
      'All external queries go through the Research Agent guards',
      'Retention 10 years from the run_at timestamp',
    ],
  },
  {
    id: 'timeline-agent',
    skillSlash: '/timeline-agent',
    name: 'Timeline Reconstructor',
    purpose:
      'Builds the chronological compliance trail for a single customer across every module (screening, TM, STR, CDD, supply chain, incidents, approvals).',
    owner: 'MLRO',
    inputs: ['subjectCode', 'windowDays (default 365)'],
    outputs: ['timelineEvents', 'gapReport', 'anomalyMarkers'],
    regulatoryBasis: 'FDL Art.24 (audit record must be contiguous) · Cabinet Res 134/2025 Art.19',
    asanaProject: 'audit_inspection',
    guards: [
      'Cross-tenant data access forbidden',
      'Gaps >30 days surface as Asana task (retention-integrity warn)',
      'Timestamps normalised to UTC',
    ],
  },
  {
    id: 'evidence-assembler',
    skillSlash: '/evidence-assembler',
    name: 'Evidence Assembler',
    purpose:
      'Composes the single-customer audit-pack zip produced by /evidence-bundle. Collects screening runs, dispositions, Asana threads, reports, brain payloads, correctness logs, regulatory map, and chain-of-custody.',
    owner: 'MLRO',
    inputs: ['subjectCode', 'forInspection (moe|lbma|cbuae|internal|legal)'],
    outputs: ['bundleZipBlobKey', 'manifestJson', 'bundleFingerprint'],
    regulatoryBasis:
      'FDL Art.24 · LBMA RGG v9 Step 5 · Cabinet Res 71/2024 · UAE PDPL Art.6(1)(c) · ISO/IEC 27001 A.12.4',
    asanaProject: 'audit_inspection',
    guards: [
      'Manifest SHA-256 fingerprint stamped on every bundle',
      'Bundle blob retained 10 years',
      'MLRO signature required before release to external auditor',
    ],
  },
  {
    id: 'translation-agent',
    skillSlash: '/translation-agent',
    name: 'Translation Agent',
    purpose:
      'Translates adverse-media hits + foreign-language documents across 24 languages with source preservation. Adds a "machine translation" marker so the MLRO sees what was auto-translated vs human-verified.',
    owner: 'Compliance Officer',
    inputs: ['sourceText', 'sourceLang?', 'targetLang (default en)'],
    outputs: ['translatedText', 'confidence', 'sourcePreservation'],
    regulatoryBasis:
      'FATF Rec 10 (ongoing CDD across language barriers) · FDL Art.29 (no tipping off even in translation target language)',
    asanaProject: 'screening_and_watchlist',
    guards: [
      'Subject data in cleartext only to translation providers under UAE-resident infrastructure',
      'Every translation marked with model provenance',
      'Original text preserved verbatim in the evidence bundle',
    ],
  },
  {
    id: 'redteam-agent',
    skillSlash: '/redteam-agent',
    name: 'Red-Team Agent',
    purpose:
      'Runs reproducible adversarial scenarios against the weaponized brain. Probes edge cases (ambiguous names, near-threshold amounts, PEP-by-association). Emits pass/fail with the exact payload that broke the pipeline.',
    owner: 'MLRO',
    inputs: ['scenarioSet (default all)', 'seed'],
    outputs: ['scenarioResults', 'failurePayloads', 'regressionCandidates'],
    regulatoryBasis:
      'EU AI Act Art.15 (accuracy + robustness) · NIST AI RMF MEASURE-2.3 (red-teaming)',
    asanaProject: 'governance_and_retention',
    guards: [
      'Only run against staging; any production run requires MLRO + InfoSec approval',
      'Failure payloads scrubbed of any real subject data before archiving',
      'Every run appends to the red-team cron audit trail',
    ],
  },
  {
    id: 'drift-detector',
    skillSlash: '/drift-detector',
    name: 'Drift Detector Agent',
    purpose:
      'Statistical drift on risk-model outputs. KS / PSI / JS-divergence against a 30-day baseline. Alerts when the verdict distribution shifts > 2-sigma without a code deploy that would explain it.',
    owner: 'MLRO',
    inputs: ['modelId', 'baselineWindowDays', 'currentWindowDays'],
    outputs: ['driftMetric', 'topShiftedFactors', 'recommendation'],
    regulatoryBasis: 'EU AI Act Art.15 · NIST AI RMF MEASURE-2.4 · ISO/IEC 42001 §8.2',
    asanaProject: 'governance_and_retention',
    guards: [
      'Drift alerts paginated to avoid alert storms',
      'Auto-opens a Governance Asana task when PSI > 0.2',
      'Drift that correlates with a code deploy flags as "expected"',
    ],
  },
]);

export function findAgentById(id: string): SupportingAgentSpec | undefined {
  return SUPPORTING_AGENTS.find((a) => a.id === id);
}

export function agentsByModule(key: ModuleKey): readonly SupportingAgentSpec[] {
  return SUPPORTING_AGENTS.filter((a) => a.asanaProject === key);
}

export const SUPPORTING_AGENT_IDS: readonly string[] = SUPPORTING_AGENTS.map((a) => a.id);
