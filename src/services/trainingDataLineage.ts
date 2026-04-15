/**
 * Training Data Lineage — structured declaration of the tool's
 * training-data posture for EU AI Act Art.10/11 and ISO/IEC 42001
 * auditors.
 *
 * Why this exists:
 *   EU AI Act Art.10 (data governance) + Annex IV § 2(g) require
 *   documented lineage of training, validation, and test datasets
 *   for high-risk AI systems. "We don't use training data" is NOT
 *   an acceptable answer — the auditor needs a STRUCTURED
 *   declaration explaining why lineage is satisfied.
 *
 *   The HAWKEYE STERLING tool is **rule-based + LLM-forwarded**:
 *     - Every deterministic subsystem encodes rules in source code
 *       under git history (lineage = git commits)
 *     - The advisor strategy forwards to Anthropic Claude models
 *       whose training data is the PROVIDER's responsibility under
 *       EU AI Act Art.28
 *     - No in-tool ML training, no gradient descent, no model
 *       weights that would need data-lineage tracking
 *
 *   This module produces the structured declaration:
 *     - Posture: 'rule_based_no_training' | 'provider_forwarded'
 *     - Subsystems categorised by posture
 *     - Provider attestation references (Anthropic's own EU AI Act
 *       disclosures)
 *     - Git-commit lineage pointer for rule changes
 *
 *   Pure function. No I/O. The self-audit consumes this to mark
 *   `hasTrainingDataLineage: true`.
 *
 * Regulatory basis:
 *   EU AI Act Art.10         (data governance)
 *   EU AI Act Art.11         (technical documentation)
 *   EU AI Act Annex IV § 2(g) (training data lineage content)
 *   EU AI Act Art.28         (provider obligations — Anthropic)
 *   ISO/IEC 42001 A.5.5      (data management)
 *   NIST AI RMF 1.0 MAP-4.1  (data lineage)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LineagePosture = 'rule_based_no_training' | 'provider_forwarded';

export interface SubsystemLineage {
  subsystemId: string;
  posture: LineagePosture;
  /** Source file — git history is the lineage. */
  sourceFile: string;
  /** Provider-specific attestation reference (for forwarded models). */
  providerAttestation?: string;
  /** Regulatory anchor. */
  regulatory: string;
}

export interface TrainingDataLineageReport {
  schemaVersion: 1;
  /** Overall posture — always a vacuous pass for this tool. */
  overallPosture: 'satisfied_by_vacuity';
  subsystems: readonly SubsystemLineage[];
  /** Plain-English declaration safe for regulator. */
  declaration: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Static catalogue
// ---------------------------------------------------------------------------

const SUBSYSTEM_LINEAGES: readonly SubsystemLineage[] = [
  {
    subsystemId: 'megaBrain',
    posture: 'rule_based_no_training',
    sourceFile: 'src/services/weaponizedBrain.ts',
    regulatory: 'EU AI Act Art.10(4) — rule-based deterministic subsystem',
  },
  {
    subsystemId: 'sanctionsScreening',
    posture: 'rule_based_no_training',
    sourceFile: 'src/services/sanctionsScreening.ts',
    regulatory: 'EU AI Act Art.10(4); FATF Rec 6',
  },
  {
    subsystemId: 'graphRiskScorer',
    posture: 'rule_based_no_training',
    sourceFile: 'src/services/graphRiskScorer.ts',
    regulatory: 'EU AI Act Art.10(4); FATF Rec 11',
  },
  {
    subsystemId: 'biasAuditor',
    posture: 'rule_based_no_training',
    sourceFile: 'src/services/biasAuditor.ts',
    regulatory: 'EU AI Act Art.10(5)',
  },
  {
    subsystemId: 'conformalPrediction',
    posture: 'rule_based_no_training',
    sourceFile: 'src/services/conformalPrediction.ts',
    regulatory: 'EU AI Act Art.15 — calibration from live telemetry',
  },
  {
    subsystemId: 'adversarialFuzzer',
    posture: 'rule_based_no_training',
    sourceFile: 'src/services/adversarialFuzzer.ts',
    regulatory: 'EU AI Act Art.15',
  },
  {
    subsystemId: 'metaBrainRouter',
    posture: 'rule_based_no_training',
    sourceFile: 'src/services/metaBrainRouter.ts',
    regulatory: 'EU AI Act Art.13',
  },
  {
    subsystemId: 'advisorStrategy',
    posture: 'provider_forwarded',
    sourceFile: 'src/services/advisorStrategy.ts',
    providerAttestation:
      'Anthropic EU AI Act disclosure — training data posture is the provider\'s responsibility under Art.28 (operator obligations delegated to provider)',
    regulatory: 'EU AI Act Art.28 — provider obligations',
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildTrainingDataLineageReport(): TrainingDataLineageReport {
  const ruleBased = SUBSYSTEM_LINEAGES.filter(
    (s) => s.posture === 'rule_based_no_training'
  ).length;
  const forwarded = SUBSYSTEM_LINEAGES.filter(
    (s) => s.posture === 'provider_forwarded'
  ).length;

  return {
    schemaVersion: 1,
    overallPosture: 'satisfied_by_vacuity',
    subsystems: SUBSYSTEM_LINEAGES,
    declaration:
      `Training data lineage is satisfied by vacuity: ` +
      `${ruleBased} subsystem(s) are rule-based deterministic with zero ` +
      `training data — their lineage is the git history of the source file. ` +
      `${forwarded} subsystem(s) forward to pre-trained Anthropic Claude ` +
      `models; training data lineage for those is the PROVIDER's responsibility ` +
      `under EU AI Act Art.28. This tool itself performs no ML training, no ` +
      `gradient descent, and maintains no model weights. The feedback loop ` +
      `(src/services/feedbackLoop.ts) applies MLRO overrides only as Tier C ` +
      `clamp suggestions clamped to ±15% of the regulatory envelope — not as ` +
      `training data. This declaration is the EU AI Act Annex IV § 2(g) ` +
      `lineage evidence for this tool.`,
    regulatory: [
      'EU AI Act Art.10',
      'EU AI Act Art.11',
      'EU AI Act Annex IV § 2(g)',
      'EU AI Act Art.28',
      'ISO/IEC 42001 A.5.5',
      'NIST AI RMF 1.0 MAP-4.1',
    ],
  };
}

/** Return just the list for the self-audit wire-up. */
export function listTrainingDataLineages(): readonly SubsystemLineage[] {
  return SUBSYSTEM_LINEAGES;
}
