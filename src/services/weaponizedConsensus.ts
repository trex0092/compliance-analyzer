/**
 * Weaponized Consensus Engine
 *
 * Mixture-of-agents pattern (inspired by NousResearch/hermes-agent
 * mixture_of_agents_tool.py) hardened for UAE AML/CFT compliance:
 *
 * - Weighted quorum voting with configurable thresholds per screening type
 * - Mandatory dissent recording — every minority opinion is preserved
 * - Auto-escalation when consensus fails or confidence is borderline
 * - Bayesian confidence aggregation across agent/model opinions
 * - Safety-first override: any confirmed match with high confidence = immediate freeze
 * - Regulatory citation attached to every verdict
 * - Full trajectory integration for audit replay
 *
 * Regulatory refs:
 * - FDL No.10/2025 Art.12-14 (CDD), Art.20-21 (CO duties), Art.26-27 (STR)
 * - Cabinet Res 74/2020 Art.4-7 (freeze within 24h)
 * - Cabinet Res 134/2025 Art.7-10 (CDD tiers), Art.14 (PEP/EDD)
 * - FATF Rec 22/23 (DPMS sector)
 *
 * Patterns adopted:
 * - hermes-agent: mixture_of_agents_tool.py (ensemble consensus)
 * - hermes-agent: trajectory.py (decision-path recording)
 * - multica: multi-runtime dispatch (model diversity)
 * - raftSubsystemVoter.ts (existing Raft consensus, extended)
 */

import type { ModelOpinion, ScreeningType } from './multiModelScreening';
import type { DecisionType } from './fourEyesEnforcer';

// ─── Configuration ──────────────────────────────────────────────────────────

/** Quorum requirements by screening type — higher stakes = stricter quorum */
export const QUORUM_REQUIREMENTS: Record<ScreeningType, QuorumConfig> = {
  sanctions: {
    minVoters: 3,
    minAgreementRatio: 0.6,
    safetyOverrideThreshold: 0.8,   // single confirmed-match at 0.8+ triggers freeze
    escalateOnDissent: true,
    maxDissentersBeforeEscalation: 1,
    regulatoryRef: 'FDL No.10/2025 Art.12-14; Cabinet Res 74/2020 Art.4-7',
  },
  pep: {
    minVoters: 3,
    minAgreementRatio: 0.6,
    safetyOverrideThreshold: 0.85,
    escalateOnDissent: true,
    maxDissentersBeforeEscalation: 1,
    regulatoryRef: 'Cabinet Res 134/2025 Art.14 (PEP/EDD)',
  },
  'risk-assessment': {
    minVoters: 2,
    minAgreementRatio: 0.5,
    safetyOverrideThreshold: 0.9,
    escalateOnDissent: false,
    maxDissentersBeforeEscalation: 2,
    regulatoryRef: 'Cabinet Res 134/2025 Art.7-10 (CDD tiers)',
  },
  'adverse-media': {
    minVoters: 2,
    minAgreementRatio: 0.5,
    safetyOverrideThreshold: 0.9,
    escalateOnDissent: false,
    maxDissentersBeforeEscalation: 2,
    regulatoryRef: 'FDL No.10/2025 Art.26-27; FATF Rec 22/23',
  },
};

/** Escalation chain when consensus fails or safety clamp fires */
export const ESCALATION_CHAIN: EscalationLevel[] = [
  { level: 1, target: 'compliance_officer', deadlineHours: 4, action: 'review_dissent' },
  { level: 2, target: 'mlro', deadlineHours: 8, action: 'override_or_confirm' },
  { level: 3, target: 'senior_management', deadlineHours: 24, action: 'final_determination' },
  { level: 4, target: 'board', deadlineHours: 48, action: 'board_resolution' },
];

/** Weight multipliers for model reliability — calibrated from historical accuracy */
export const MODEL_RELIABILITY_WEIGHTS: Record<string, number> = {
  'anthropic/claude-sonnet-4-20250514': 1.2,
  'openai/gpt-4o': 1.1,
  'google/gemini-2.5-pro-preview': 1.0,
  'mistralai/mistral-large-2411': 0.9,
  'deepseek/deepseek-chat': 0.85,
};

// ─── Types ──────────────────────────────────────────────────────────────────

export interface QuorumConfig {
  minVoters: number;
  minAgreementRatio: number;
  safetyOverrideThreshold: number;
  escalateOnDissent: boolean;
  maxDissentersBeforeEscalation: number;
  regulatoryRef: string;
}

export interface EscalationLevel {
  level: number;
  target: string;
  deadlineHours: number;
  action: 'review_dissent' | 'override_or_confirm' | 'final_determination' | 'board_resolution';
}

export interface DissentRecord {
  agentOrModel: string;
  verdict: string;
  confidence: number;
  reasoning: string;
  riskIndicators: string[];
  timestamp: string;
  /** Whether this dissent was reviewed by a human (required for audit) */
  reviewedBy?: string;
  reviewedAt?: string;
  reviewOutcome?: 'accepted' | 'overridden' | 'noted';
}

export interface SafetyOverride {
  triggered: boolean;
  triggerSource: string;
  triggerConfidence: number;
  action: 'freeze' | 'escalate' | 'none';
  regulatoryRef: string;
  timestamp: string;
}

export interface ConsensusTrajectoryNode {
  nodeId: string;
  timestamp: string;
  phase: 'voting' | 'aggregation' | 'safety-check' | 'quorum-check' | 'escalation' | 'verdict';
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  decision?: string;
  confidence?: number;
  regulatoryRef?: string;
}

export interface WeaponizedConsensusResult {
  /** Unique ID for this consensus run */
  consensusId: string;
  entityName: string;
  screeningType: ScreeningType;

  /** Final verdict */
  verdict: 'clear' | 'potential-match' | 'confirmed-match';
  verdictConfidence: number;
  agreementRatio: number;

  /** Quorum status */
  quorumMet: boolean;
  quorumConfig: QuorumConfig;
  voterCount: number;

  /** Weighted Bayesian confidence (accounts for model reliability) */
  bayesianConfidence: number;

  /** Safety override — did any single opinion trigger an immediate action? */
  safetyOverride: SafetyOverride;

  /** All dissenting opinions preserved for audit */
  dissents: DissentRecord[];
  dissentCount: number;

  /** Escalation status */
  escalated: boolean;
  escalationLevel: number;
  escalationTarget?: string;
  escalationReason?: string;

  /** Recommended downstream action */
  recommendedAction: 'clear' | 'monitor' | 'escalate-to-co' | 'escalate-to-mlro' | 'freeze' | 'file-str';
  linkedDecisionType?: DecisionType;

  /** Full trajectory for audit replay */
  trajectory: ConsensusTrajectoryNode[];

  /** Regulatory citations for the verdict */
  regulatoryRefs: string[];

  /** Timing */
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

// ─── Core Engine ────────────────────────────────────────────────────────────

/**
 * Run weaponized consensus on a set of model opinions.
 *
 * This is the post-racing aggregation layer — call AFTER multiModelScreening's
 * raceModels() returns opinions. It replaces the simple aggregateConsensus()
 * with a full mixture-of-agents pipeline.
 */
export function runWeaponizedConsensus(
  entityName: string,
  screeningType: ScreeningType,
  opinions: ModelOpinion[],
): WeaponizedConsensusResult {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const consensusId = `wc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const quorumConfig = QUORUM_REQUIREMENTS[screeningType];
  const trajectory: ConsensusTrajectoryNode[] = [];

  // ── Phase 1: Record all votes ──────────────────────────────────────────
  trajectory.push({
    nodeId: `${consensusId}-vote`,
    timestamp: new Date().toISOString(),
    phase: 'voting',
    input: { opinions: opinions.map(o => ({ model: o.model, verdict: o.verdict, confidence: o.confidence })) },
    output: { voterCount: opinions.length },
  });

  // ── Phase 2: Bayesian weighted aggregation ─────────────────────────────
  const weightedScores: Record<string, number> = {
    clear: 0,
    'potential-match': 0,
    'confirmed-match': 0,
  };
  let totalWeight = 0;

  for (const op of opinions) {
    const weight = MODEL_RELIABILITY_WEIGHTS[op.model] ?? 1.0;
    weightedScores[op.verdict] += op.confidence * weight;
    totalWeight += weight;
  }

  // Normalize to [0, 1]
  const normalizedScores: Record<string, number> = {};
  for (const [verdict, score] of Object.entries(weightedScores)) {
    normalizedScores[verdict] = totalWeight > 0 ? score / totalWeight : 0;
  }

  // Bayesian confidence = weighted score of winning verdict
  const sortedVerdicts = Object.entries(normalizedScores).sort((a, b) => b[1] - a[1]);
  const topVerdict = sortedVerdicts[0][0] as 'clear' | 'potential-match' | 'confirmed-match';
  const bayesianConfidence = Math.round(sortedVerdicts[0][1] * 1000) / 1000;

  trajectory.push({
    nodeId: `${consensusId}-bayes`,
    timestamp: new Date().toISOString(),
    phase: 'aggregation',
    input: { weightedScores, totalWeight },
    output: { normalizedScores, topVerdict, bayesianConfidence },
  });

  // ── Phase 3: Safety-first override check ───────────────────────────────
  // If ANY model reports confirmed-match above the safety threshold, FREEZE
  const safetyTriggers = opinions.filter(
    o => o.verdict === 'confirmed-match' && o.confidence >= quorumConfig.safetyOverrideThreshold
  );

  const safetyOverride: SafetyOverride = safetyTriggers.length > 0
    ? {
        triggered: true,
        triggerSource: safetyTriggers[0].model,
        triggerConfidence: safetyTriggers[0].confidence,
        action: screeningType === 'sanctions' ? 'freeze' : 'escalate',
        regulatoryRef: 'Cabinet Res 74/2020 Art.4-7 — freeze within 24h',
        timestamp: new Date().toISOString(),
      }
    : {
        triggered: false,
        triggerSource: '',
        triggerConfidence: 0,
        action: 'none',
        regulatoryRef: '',
        timestamp: new Date().toISOString(),
      };

  trajectory.push({
    nodeId: `${consensusId}-safety`,
    timestamp: new Date().toISOString(),
    phase: 'safety-check',
    input: { safetyThreshold: quorumConfig.safetyOverrideThreshold, triggerCount: safetyTriggers.length },
    output: { triggered: safetyOverride.triggered, action: safetyOverride.action },
    regulatoryRef: safetyOverride.triggered ? safetyOverride.regulatoryRef : undefined,
  });

  // ── Phase 4: Quorum check ──────────────────────────────────────────────
  const quorumMet = opinions.length >= quorumConfig.minVoters;

  // Agreement ratio: what fraction of voters agree with top verdict?
  const agreeingVoters = opinions.filter(o => o.verdict === topVerdict).length;
  const agreementRatio = opinions.length > 0
    ? Math.round((agreeingVoters / opinions.length) * 100) / 100
    : 0;

  const agreementMet = agreementRatio >= quorumConfig.minAgreementRatio;

  trajectory.push({
    nodeId: `${consensusId}-quorum`,
    timestamp: new Date().toISOString(),
    phase: 'quorum-check',
    input: { voterCount: opinions.length, required: quorumConfig.minVoters, agreementRatio, requiredRatio: quorumConfig.minAgreementRatio },
    output: { quorumMet, agreementMet },
  });

  // ── Phase 5: Dissent tracking ──────────────────────────────────────────
  const dissents: DissentRecord[] = opinions
    .filter(o => o.verdict !== topVerdict)
    .map(o => ({
      agentOrModel: o.model,
      verdict: o.verdict,
      confidence: o.confidence,
      reasoning: o.reasoning,
      riskIndicators: o.riskIndicators,
      timestamp: new Date().toISOString(),
    }));

  // ── Phase 6: Escalation decision ───────────────────────────────────────
  let escalated = false;
  let escalationLevel = 0;
  let escalationTarget: string | undefined;
  let escalationReason: string | undefined;

  // Escalate if: safety override, quorum not met, agreement too low, or too many dissenters
  if (safetyOverride.triggered) {
    escalated = true;
    escalationLevel = 2; // MLRO for safety override
    escalationTarget = ESCALATION_CHAIN[1].target;
    escalationReason = `Safety override: ${safetyOverride.triggerSource} reported confirmed-match at ${safetyOverride.triggerConfidence} confidence`;
  } else if (!quorumMet) {
    escalated = true;
    escalationLevel = 1;
    escalationTarget = ESCALATION_CHAIN[0].target;
    escalationReason = `Quorum not met: ${opinions.length}/${quorumConfig.minVoters} voters responded`;
  } else if (!agreementMet) {
    escalated = true;
    escalationLevel = 1;
    escalationTarget = ESCALATION_CHAIN[0].target;
    escalationReason = `Agreement ratio ${agreementRatio} below threshold ${quorumConfig.minAgreementRatio}`;
  } else if (quorumConfig.escalateOnDissent && dissents.length > quorumConfig.maxDissentersBeforeEscalation) {
    escalated = true;
    escalationLevel = 1;
    escalationTarget = ESCALATION_CHAIN[0].target;
    escalationReason = `${dissents.length} dissenters exceed max ${quorumConfig.maxDissentersBeforeEscalation} for ${screeningType}`;
  }

  trajectory.push({
    nodeId: `${consensusId}-escalation`,
    timestamp: new Date().toISOString(),
    phase: 'escalation',
    input: { quorumMet, agreementMet, dissentCount: dissents.length, safetyTriggered: safetyOverride.triggered },
    output: { escalated, escalationLevel, escalationTarget, escalationReason },
  });

  // ── Phase 7: Final verdict ─────────────────────────────────────────────
  // Safety override takes precedence
  const finalVerdict = safetyOverride.triggered ? 'confirmed-match' : topVerdict;
  const finalConfidence = safetyOverride.triggered
    ? safetyOverride.triggerConfidence
    : bayesianConfidence;

  // Map verdict to recommended action
  const recommendedAction = deriveRecommendedAction(finalVerdict, finalConfidence, screeningType, escalated);
  const linkedDecisionType = deriveLinkedDecisionType(finalVerdict, screeningType);

  // Collect regulatory refs
  const regulatoryRefs = [quorumConfig.regulatoryRef];
  if (safetyOverride.triggered) regulatoryRefs.push(safetyOverride.regulatoryRef);
  if (finalVerdict === 'confirmed-match' && screeningType === 'sanctions') {
    regulatoryRefs.push('Cabinet Res 74/2020 Art.4-7 — freeze within 24h, CNMR within 5 business days');
  }
  if (linkedDecisionType === 'str_filing') {
    regulatoryRefs.push('FDL No.10/2025 Art.26-27 — STR without delay');
  }

  const completedAt = new Date().toISOString();

  trajectory.push({
    nodeId: `${consensusId}-verdict`,
    timestamp: completedAt,
    phase: 'verdict',
    input: { topVerdict, safetyOverrideTriggered: safetyOverride.triggered },
    output: { finalVerdict, finalConfidence, recommendedAction },
    decision: finalVerdict,
    confidence: finalConfidence,
    regulatoryRef: regulatoryRefs.join('; '),
  });

  return {
    consensusId,
    entityName,
    screeningType,
    verdict: finalVerdict,
    verdictConfidence: finalConfidence,
    agreementRatio,
    quorumMet,
    quorumConfig,
    voterCount: opinions.length,
    bayesianConfidence,
    safetyOverride,
    dissents,
    dissentCount: dissents.length,
    escalated,
    escalationLevel,
    escalationTarget,
    escalationReason,
    recommendedAction,
    linkedDecisionType,
    trajectory,
    regulatoryRefs,
    startedAt,
    completedAt,
    durationMs: Date.now() - start,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function deriveRecommendedAction(
  verdict: string,
  confidence: number,
  screeningType: ScreeningType,
  escalated: boolean,
): WeaponizedConsensusResult['recommendedAction'] {
  if (verdict === 'confirmed-match' && screeningType === 'sanctions') return 'freeze';
  if (verdict === 'confirmed-match') return 'file-str';
  if (verdict === 'potential-match' && confidence >= 0.7) return 'escalate-to-mlro';
  if (verdict === 'potential-match' || escalated) return 'escalate-to-co';
  if (verdict === 'clear' && confidence >= 0.8) return 'clear';
  return 'monitor';
}

function deriveLinkedDecisionType(
  verdict: string,
  screeningType: ScreeningType,
): DecisionType | undefined {
  if (verdict === 'confirmed-match' && screeningType === 'sanctions') return 'sanctions_freeze';
  if (verdict === 'confirmed-match' && screeningType === 'pep') return 'pep_approval';
  if (verdict === 'confirmed-match') return 'str_filing';
  if (verdict === 'potential-match') return 'false_positive_dismiss';
  return undefined;
}

/**
 * Validate that a consensus result is complete and audit-ready.
 * Call before persisting or acting on the result.
 */
export function validateConsensusIntegrity(result: WeaponizedConsensusResult): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (result.trajectory.length < 5) {
    issues.push('Incomplete trajectory — expected at least 5 phases');
  }
  if (result.voterCount === 0) {
    issues.push('Zero voters — consensus cannot be established');
  }
  if (result.verdict === 'confirmed-match' && result.regulatoryRefs.length === 0) {
    issues.push('Confirmed match without regulatory citation — audit failure');
  }
  if (result.dissents.length > 0 && !result.escalated && result.quorumConfig.escalateOnDissent) {
    issues.push('Dissent present but not escalated despite escalateOnDissent=true');
  }
  if (result.safetyOverride.triggered && result.verdict !== 'confirmed-match') {
    issues.push('Safety override triggered but verdict is not confirmed-match — logic error');
  }

  // Every trajectory node must have a timestamp
  for (const node of result.trajectory) {
    if (!node.timestamp) issues.push(`Trajectory node ${node.nodeId} missing timestamp`);
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Generate a human-readable narrative for MLRO review.
 * Used in STR narratives and audit reports.
 */
export function generateConsensusNarrative(result: WeaponizedConsensusResult): string {
  const lines: string[] = [];

  lines.push(`## Consensus Screening Report: ${result.entityName}`);
  lines.push(`**Type:** ${result.screeningType} | **ID:** ${result.consensusId}`);
  lines.push(`**Date:** ${result.startedAt} | **Duration:** ${result.durationMs}ms`);
  lines.push('');

  lines.push(`### Verdict: ${result.verdict.toUpperCase()}`);
  lines.push(`- Confidence: ${(result.verdictConfidence * 100).toFixed(1)}%`);
  lines.push(`- Bayesian confidence: ${(result.bayesianConfidence * 100).toFixed(1)}%`);
  lines.push(`- Agreement: ${(result.agreementRatio * 100).toFixed(0)}% (${result.voterCount} voters)`);
  lines.push(`- Quorum: ${result.quorumMet ? 'MET' : 'NOT MET'}`);
  lines.push(`- Recommended action: **${result.recommendedAction}**`);
  lines.push('');

  if (result.safetyOverride.triggered) {
    lines.push('### SAFETY OVERRIDE TRIGGERED');
    lines.push(`- Source: ${result.safetyOverride.triggerSource}`);
    lines.push(`- Confidence: ${(result.safetyOverride.triggerConfidence * 100).toFixed(1)}%`);
    lines.push(`- Action: ${result.safetyOverride.action}`);
    lines.push(`- Ref: ${result.safetyOverride.regulatoryRef}`);
    lines.push('');
  }

  if (result.dissents.length > 0) {
    lines.push(`### Dissenting Opinions (${result.dissents.length})`);
    for (const d of result.dissents) {
      lines.push(`- **${d.agentOrModel}**: ${d.verdict} (${(d.confidence * 100).toFixed(0)}%) — ${d.reasoning}`);
      if (d.reviewedBy) {
        lines.push(`  - Reviewed by ${d.reviewedBy} at ${d.reviewedAt}: ${d.reviewOutcome}`);
      }
    }
    lines.push('');
  }

  if (result.escalated) {
    lines.push('### Escalation');
    lines.push(`- Level: ${result.escalationLevel} (${result.escalationTarget})`);
    lines.push(`- Reason: ${result.escalationReason}`);
    lines.push('');
  }

  lines.push('### Regulatory References');
  for (const ref of result.regulatoryRefs) {
    lines.push(`- ${ref}`);
  }

  return lines.join('\n');
}
