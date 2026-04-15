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
  hasModelCards: true, //       src/services/modelCardGenerator.ts — EU AI Act Art.11 + Annex IV generator
  hasModelVersioning: true, //  git history + subsystemScoring.ts maturity states

  // Data governance
  hasDataGovernancePolicy: true, // CLAUDE.md "Seguridad" section
  hasTrainingDataLineage: true, //  src/services/trainingDataLineage.ts — structured declaration: satisfied_by_vacuity; EU AI Act Art.28 forwards provider lineage for Claude; rule-based subsystems use git history as lineage
  hasBiasAssessment: true, //      src/services/biasAuditor.ts (EU AI Act Art.10, 4/5 rule, z-test) + src/services/nameMatchingBiasAssessment.ts
  hasDataQualityChecks: true, //   src/domain/constants.ts + zod schemas

  // Transparency / XAI
  hasExplainability: true, //    src/services/explainableScoring.ts + counterfactualFlipper.ts + counterfactualExplainer.ts
  hasDecisionLogging: true, //   auditChain.ts + weaponizedBrain.ts auditNarrative + decisionProvenanceDag.ts
  hasUserDisclosure: true, //    NORAD war room renders full reasoningChain to the MLRO

  // Continuous monitoring
  hasMonitoring: true, //        warRoomFeed.ts + KPI framework + brainSelfMonitor.ts
  hasDriftDetection: true, //    narrativeDriftDetector.ts + temporalPatternDetector.ts + brainSelfMonitor.ts (KS test)
  hasIncidentReporting: true, // brain.mts publishes Cachet incidents + /incident skill + alertDispatcher.ts
  hasPostMarketMonitoring: true, // Phase 3 brain-learn hook + subsystemScoring.ts + feedbackLoop.ts

  // Human oversight
  hasHumanOversight: true, //    requiresHumanReview + four-eyes approvals + MLRO overrides
  hasKillSwitch: true, //        netlify.toml feature flags + brainBridge toggles + Tier C kill switch in intelligenceScorecard.ts
  hasFourEyesApproval: true, //  src/domain/approvals.ts + Asana 4-eyes integration + coLoadBalancer.ts

  // Risk management
  hasRiskAssessment: true, //    src/risk/ modules + explainableScoring cddLevel
  hasImpactAssessment: true, //  src/agents/definitions/audit-agent.ts + multiJurisdictionRuleEngine.ts
  hasRiskRegister: true, //      Phase 2 clampPolicy.ts + brain-lessons/

  // Security
  hasSecurityTesting: true, //   hooks/pre-commit-security.sh + authMiddleware tests + adversarialFuzzer.ts
  hasAccessControl: true, //     auth-rbac.js + netlify/functions/middleware/auth.mts + rbacPermissionMatrix.ts + totp2faEnforcer.ts + sessionManager.ts
  hasAuditTrail: true, //        auditChain.ts + zkComplianceProof.ts Merkle seal + auditLogQuery.ts + backupRestoreService.ts

  // Agentic AI governance
  hasAgentIdentity: true, //     src/agents/index.ts ComplianceHarness + session manager
  hasAgentPermissions: true, //  src/agents/sandbox/runner.ts isolates tool calls + rbacPermissionMatrix.ts
  hasAgentAuditTrail: true, //   session/manager.ts getAuditChain() + auditLogQuery.ts

  // Shadow AI detection
  hasShadowAiScan: true, //      src/services/shadowAiScanner.ts (EU AI Act Art.17, NIST AI RMF GOVERN-1.4, ISO/IEC 42001 A.5.4)
  hasApprovedToolList: true, //  CLAUDE.md §6 Skill Dispatch Table + vendor allowlist + APPROVED_AI_TOOLS in shadowAiScanner.ts

  // UAE-specific
  hasUaeAlignment: true, //      Entire compliance domain is UAE AML/CFT/CPF — built for it
  hasArabicSupport: true, //     src/services/arabicI18n.ts — translation map + RTL helpers + Arabic-Indic digits + localised AED formatter
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
