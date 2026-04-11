/**
 * Self-audit — evidence map for the compliance-analyzer itself.
 *
 * This module answers the question "what AI governance evidence does
 * the compliance-analyzer repo already have?". The answer is encoded
 * as a static GovernanceEvidence map that mirrors the actual state of
 * the repo as of the current commit. When a new Phase 1/2/3/4/5
 * component lands that adds governance evidence, this file is
 * updated to reflect it.
 *
 * Keeping the self-audit as static code (not filesystem-scanning) has
 * three benefits:
 *   1. The audit is reproducible — same commit, same evidence.
 *   2. It forces a human to update the map when compliance state
 *      actually changes, which is the whole point of a compliance
 *      audit.
 *   3. It runs in tests without filesystem side effects.
 *
 * When the compliance-analyzer is deployed against a customer's AI
 * system, the customer provides the evidence map directly — this
 * file's values are ONLY the self-audit (the analyzer's own state).
 *
 * Regulatory basis:
 *   - EU Reg 2024/1689 Art.11 (technical documentation)
 *   - NIST AI RMF GV-1.1 (documented policies)
 *   - ISO/IEC 42001:2023 A.4.2 (resources for AI)
 *   - UAE AI Charter Principle 4 (accountability)
 */

import type { GovernanceEvidence } from './types';

/**
 * Evidence map for the compliance-analyzer itself, as of the Phase 5
 * commit. Each true value has a code reference in the comment so the
 * audit trail can point back to the actual implementation.
 */
export const SELF_AUDIT_EVIDENCE: Readonly<GovernanceEvidence> = Object.freeze({
  // Model inventory
  hasModelInventory: true, //   CLAUDE.md "Integrated Agent Frameworks" table (28+ vendored models)
  modelCount: 30, //            13 MegaBrain + 6 Weaponized (Phase 1) + 11 Phase 2 subsystems
  hasModelCards: false, //      TODO: per-subsystem cards in src/services/*.ts need formal extraction
  hasModelVersioning: true, //  git history + subsystemScoring.ts maturity states

  // Data governance
  hasDataGovernancePolicy: true, // CLAUDE.md "Seguridad" section
  hasTrainingDataLineage: false, // no centralised training data (no ML training happens in-app)
  hasBiasAssessment: false, //     TODO: needs explicit bias testing for name-matching / jurisdictions
  hasDataQualityChecks: true, //   src/domain/constants.ts + zod schemas

  // Transparency / XAI
  hasExplainability: true, //    src/services/explainableScoring.ts + counterfactualFlipper.ts
  hasDecisionLogging: true, //   auditChain.ts + weaponizedBrain.ts auditNarrative
  hasUserDisclosure: true, //    NORAD war room renders full reasoningChain to the MLRO

  // Continuous monitoring
  hasMonitoring: true, //        warRoomFeed.ts + KPI framework
  hasDriftDetection: true, //    narrativeDriftDetector.ts + temporalPatternDetector.ts
  hasIncidentReporting: true, // brain.mts publishes Cachet incidents + /incident skill
  hasPostMarketMonitoring: true, // Phase 3 brain-learn hook + subsystemScoring.ts

  // Human oversight
  hasHumanOversight: true, //    requiresHumanReview + four-eyes approvals + MLRO overrides
  hasKillSwitch: true, //        netlify.toml feature flags + brainBridge toggles
  hasFourEyesApproval: true, //  src/domain/approvals.ts + Asana 4-eyes integration

  // Risk management
  hasRiskAssessment: true, //    src/risk/ modules + explainableScoring cddLevel
  hasImpactAssessment: true, //  src/agents/definitions/audit-agent.ts
  hasRiskRegister: true, //      Phase 2 clampPolicy.ts + brain-lessons/

  // Security
  hasSecurityTesting: true, //   hooks/pre-commit-security.sh + authMiddleware tests
  hasAccessControl: true, //     auth-rbac.js + netlify/functions/middleware/auth.mts
  hasAuditTrail: true, //        auditChain.ts + zkComplianceProof.ts Merkle seal

  // Agentic AI governance
  hasAgentIdentity: true, //     src/agents/index.ts ComplianceHarness + session manager
  hasAgentPermissions: true, //  src/agents/sandbox/runner.ts isolates tool calls
  hasAgentAuditTrail: true, //   session/manager.ts getAuditChain()

  // Shadow AI detection
  hasShadowAiScan: false, //     TODO: no SaaS discovery scanner yet (Phase 6?)
  hasApprovedToolList: true, //  CLAUDE.md §6 Skill Dispatch Table + vendor allowlist

  // UAE-specific
  hasUaeAlignment: true, //      Entire compliance domain is UAE AML/CFT/CPF — built for it
  hasArabicSupport: false, //    TODO: UI currently English-only
  hasLocalDataResidency: true, // Netlify UAE region + cbuaeRates.ts (central bank rates)
});

/**
 * Build an evidence map from a partial override + the self-audit
 * baseline. Used by tests and by customer audits that want to start
 * from the self-audit and patch specific fields.
 */
export function extendSelfAudit(overrides: Partial<GovernanceEvidence>): GovernanceEvidence {
  return { ...SELF_AUDIT_EVIDENCE, ...overrides };
}
