/**
 * AI Governance Agent — shared types.
 *
 * Phase 5 of the weaponization: a compliance agent that audits AI
 * systems (starting with the compliance-analyzer itself) against four
 * governance frameworks:
 *
 *   1. EU AI Act                       (full enforcement August 2026)
 *   2. NIST AI Risk Management Framework (Govern / Map / Measure / Manage)
 *   3. ISO/IEC 42001                   (AI Management System certification)
 *   4. UAE AI governance               (National AI Strategy 2031 + Charter)
 *
 * Each framework is a library of Controls — individual requirements the
 * AI system must satisfy. The agent runs each Control against target
 * evidence and produces an AssessmentResult. Results roll up to a
 * FrameworkReport and then to a GovernanceAudit covering all frameworks.
 *
 * Regulatory basis:
 *   - EU Regulation 2024/1689 (AI Act) Art.6-15 (high-risk classification)
 *   - NIST AI RMF 1.0 (Govern, Map, Measure, Manage functions)
 *   - ISO/IEC 42001:2023 (AIMS — AI Management System)
 *   - UAE National AI Strategy 2031
 *   - UAE AI Charter (transparency, accountability, fairness)
 */

// ---------------------------------------------------------------------------
// Framework identifiers
// ---------------------------------------------------------------------------

export type Framework = 'eu_ai_act' | 'nist_ai_rmf' | 'iso_42001' | 'uae_ai_gov';

// ---------------------------------------------------------------------------
// Risk classification
// ---------------------------------------------------------------------------

/**
 * EU AI Act risk tiers. Used by the EU AI Act Controls and mirrored
 * into the self-audit report so the compliance-analyzer can position
 * itself within the risk hierarchy.
 */
export type EuAiActRiskTier =
  | 'unacceptable' // Art.5 — prohibited (biometric ID, social scoring, etc.)
  | 'high'         // Art.6 — high-risk AI systems (Annex III + conformity assessment)
  | 'limited'      // Art.52 — transparency obligations only
  | 'minimal';     // Default — no additional obligations

/**
 * NIST AI RMF function categories.
 */
export type NistFunction = 'govern' | 'map' | 'measure' | 'manage';

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export interface Control {
  /** Unique ID within the framework (e.g. 'EU-AIA-09', 'NIST-GV-1.1'). */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Which framework this control belongs to. */
  framework: Framework;
  /** Citation into the underlying document (article, section, clause). */
  citation: string;
  /** Short description of what the control requires. */
  requirement: string;
  /** EU AI Act risk tier, if applicable. */
  tier?: EuAiActRiskTier;
  /** NIST function, if applicable. */
  nistFunction?: NistFunction;
  /**
   * Evidence selectors — which fields of the target evidence this
   * control inspects. The assessor calls `evidence[key]` for each and
   * checks whether the value is truthy.
   */
  evidenceKeys: readonly string[];
  /** Severity if the control fails. */
  severity: 'critical' | 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * Flat evidence map the auditor builds from the target AI system.
 * For the self-audit, this map is populated by selfAudit.ts scanning
 * the compliance-analyzer repo. For customer audits, the customer
 * provides the map directly.
 *
 * Every field is optional so missing evidence degrades the control to
 * "unknown" rather than failing the audit — absence of proof is not
 * proof of absence.
 */
export interface GovernanceEvidence {
  // Model inventory (all frameworks)
  hasModelInventory?: boolean;
  modelCount?: number;
  hasModelCards?: boolean;
  hasModelVersioning?: boolean;

  // Data governance (EU AI Act Art.10, NIST Map-1, ISO 42001 A.7)
  hasDataGovernancePolicy?: boolean;
  hasTrainingDataLineage?: boolean;
  hasBiasAssessment?: boolean;
  hasDataQualityChecks?: boolean;

  // Transparency / XAI (EU AI Act Art.13, NIST Measure-2, UAE Charter)
  hasExplainability?: boolean;
  hasDecisionLogging?: boolean;
  hasUserDisclosure?: boolean;

  // Continuous monitoring (EU AI Act Art.72, NIST Manage-1, ISO 42001 A.9)
  hasMonitoring?: boolean;
  hasDriftDetection?: boolean;
  hasIncidentReporting?: boolean;
  hasPostMarketMonitoring?: boolean;

  // Human oversight / kill switch (EU AI Act Art.14, NIST Govern-1, ISO 42001 A.6)
  hasHumanOversight?: boolean;
  hasKillSwitch?: boolean;
  hasFourEyesApproval?: boolean;

  // Risk management (NIST Manage, ISO 42001 A.6)
  hasRiskAssessment?: boolean;
  hasImpactAssessment?: boolean;
  hasRiskRegister?: boolean;

  // Security (EU AI Act Art.15, NIST Govern-1.6)
  hasSecurityTesting?: boolean;
  hasAccessControl?: boolean;
  hasAuditTrail?: boolean;

  // Agentic AI governance (NIST Govern-1.5, emerging 2026)
  hasAgentIdentity?: boolean;
  hasAgentPermissions?: boolean;
  hasAgentAuditTrail?: boolean;

  // Shadow AI detection (NIST Govern-2.1, 60+ apps per the infographic)
  hasShadowAiScan?: boolean;
  hasApprovedToolList?: boolean;

  // UAE-specific
  hasUaeAlignment?: boolean;
  hasArabicSupport?: boolean;
  hasLocalDataResidency?: boolean;
}

// ---------------------------------------------------------------------------
// Assessment results
// ---------------------------------------------------------------------------

export type ControlStatus = 'pass' | 'fail' | 'partial' | 'unknown' | 'not_applicable';

export interface ControlAssessment {
  controlId: string;
  title: string;
  framework: Framework;
  citation: string;
  status: ControlStatus;
  /** Which evidence keys were checked. */
  keysChecked: readonly string[];
  /** Which evidence keys were truthy (present). */
  keysPresent: readonly string[];
  /** Which evidence keys were missing / falsy. */
  keysMissing: readonly string[];
  /** Severity if this control fails. */
  severity: Control['severity'];
  /** Narrative for the audit file. */
  narrative: string;
}

export interface FrameworkReport {
  framework: Framework;
  /** Short display name. */
  frameworkName: string;
  assessments: ControlAssessment[];
  /** Count of controls by status. */
  summary: Record<ControlStatus, number>;
  /** Overall score in [0,100] — pass=1.0, partial=0.5, unknown=0, n/a=excluded. */
  score: number;
  /** True if any critical control failed. */
  hasCriticalFailure: boolean;
  narrative: string;
}

export interface GovernanceAudit {
  auditTarget: string;
  auditedAt: string;
  auditedBy: string;
  frameworks: FrameworkReport[];
  /** EU AI Act risk tier for the target. */
  euAiActTier: EuAiActRiskTier;
  /** Overall score across all frameworks in [0,100]. */
  overallScore: number;
  /** Top-priority remediation items. */
  remediation: Array<{
    framework: Framework;
    controlId: string;
    title: string;
    severity: Control['severity'];
    citation: string;
  }>;
  /** Narrative for the audit file — safe to paste into an auditor email. */
  narrative: string;
}
