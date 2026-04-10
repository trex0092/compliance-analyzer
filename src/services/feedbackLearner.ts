/**
 * Feedback Learner — closed-loop case memory from MLRO overrides.
 *
 * When an MLRO overrides an automated verdict (e.g. the brain said
 * "pass" but the MLRO escalated and filed an STR), that override is
 * the most valuable piece of training signal the tool will ever see.
 * This module captures such overrides as high-confidence PastCases
 * that feed back into the CaseMemory for future episodic retrieval.
 *
 * Design goals:
 *   1. Deterministic — same override sequence → same feedback state.
 *   2. Safe — never downgrades a freeze; override that reduces
 *      severity is captured but flagged for human review.
 *   3. Cheap — no gradient descent, no training loop. Pure case
 *      retention with a decay/reinforcement policy over the weights
 *      used by cosineSimilarity.
 *   4. Auditable — every weight change is logged with a reason.
 *
 * Weight learning policy:
 *   For each override we compute the "disagreement contribution" of
 *   each feature = |feature_value_in_case|. The features that most
 *   strongly distinguished the case from the brain's prediction get
 *   a small weight bump. The weight update is clamped to prevent
 *   runaway reinforcement.
 *
 * Regulatory basis:
 *   - FDL Art.19-20 (CO judgment overrides automated decisions)
 *   - Cabinet Res 134/2025 Art.19 (internal review feedback loop)
 *   - FATF Rec 1 (risk-based approach must be continually updated)
 */

import { CaseMemory, type CaseOutcome, type PastCase } from './caseBasedReasoning';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Verdict = 'pass' | 'flag' | 'escalate' | 'freeze';

export interface Override {
  caseId: string;
  mlroName: string;
  decidedAtIso: string;
  features: Record<string, number>;
  brainVerdict: Verdict;
  humanVerdict: Verdict;
  humanOutcome: CaseOutcome;
  rationale: string;
  regulatoryRefs?: readonly string[];
}

export interface WeightChange {
  feature: string;
  before: number;
  after: number;
  delta: number;
  reason: string;
}

export interface FeedbackState {
  weights: Record<string, number>;
  changes: WeightChange[];
  overridesApplied: number;
}

// ---------------------------------------------------------------------------
// Learning policy
// ---------------------------------------------------------------------------

const VERDICT_RANK: Record<Verdict, number> = {
  pass: 0,
  flag: 1,
  escalate: 2,
  freeze: 3,
};

const MAX_WEIGHT = 10;
const MIN_WEIGHT = 0.1;
const LEARNING_RATE = 0.15;

// ---------------------------------------------------------------------------
// Feedback application
// ---------------------------------------------------------------------------

export function applyOverride(
  memory: CaseMemory,
  state: FeedbackState,
  override: Override
): FeedbackState {
  const direction = VERDICT_RANK[override.humanVerdict] - VERDICT_RANK[override.brainVerdict];
  // Retain the override as a past case with confidence proportional to
  // the magnitude of the disagreement.
  const disagreementMagnitude = Math.abs(direction);
  const confidence = Math.min(1, 0.5 + disagreementMagnitude * 0.2);
  const pastCase: PastCase = {
    id: `fb-${override.caseId}`,
    features: override.features,
    outcome: override.humanOutcome,
    confidence,
    summary: `Override by ${override.mlroName}: ${override.brainVerdict} → ${override.humanVerdict}. ${override.rationale}`,
    regulatoryRefs: override.regulatoryRefs ?? ['FDL Art.19-20'],
    decidedAtIso: override.decidedAtIso,
  };
  memory.retain(pastCase);

  // Update weights only for the brain-under-called case (human escalated).
  // We DO still retain downgrades but we do NOT weight-reinforce them,
  // because we don't want the system learning to soften its judgments
  // without human review first.
  const newState: FeedbackState = {
    weights: { ...state.weights },
    changes: [...state.changes],
    overridesApplied: state.overridesApplied + 1,
  };
  if (direction > 0) {
    const topFeatures = rankFeaturesByMagnitude(override.features).slice(0, 3);
    for (const feature of topFeatures) {
      const before = newState.weights[feature] ?? 1;
      const bumped = clamp(before * (1 + LEARNING_RATE * direction), MIN_WEIGHT, MAX_WEIGHT);
      if (bumped !== before) {
        newState.weights[feature] = bumped;
        newState.changes.push({
          feature,
          before,
          after: bumped,
          delta: bumped - before,
          reason: `escalation override (${override.brainVerdict} → ${override.humanVerdict}) on case ${override.caseId}`,
        });
      }
    }
  }
  return newState;
}

export function applyOverrideBatch(
  memory: CaseMemory,
  initial: FeedbackState,
  overrides: readonly Override[]
): FeedbackState {
  let state = initial;
  for (const o of overrides) {
    state = applyOverride(memory, state, o);
  }
  return state;
}

function rankFeaturesByMagnitude(features: Record<string, number>): string[] {
  return Object.entries(features)
    .map(([k, v]) => [k, Math.abs(v)] as const)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

export function initialFeedbackState(seedWeights: Record<string, number> = {}): FeedbackState {
  return {
    weights: { ...seedWeights },
    changes: [],
    overridesApplied: 0,
  };
}
