/**
 * Cost-tier router — picks the cheapest model that can handle a
 * compliance decision given its complexity, urgency, and the
 * tenant's remaining monthly AI budget.
 *
 * Tiers (cheapest → most expensive):
 *   - HAIKU_FAST  — routine status checks, non-ambiguous screening
 *   - SONNET_MID  — CDD/EDD, standard STR narrative drafting
 *   - OPUS_HIGH   — sanctions confirmations, freeze protocol, drift
 *                   investigations, advisor-required paths
 *
 * Design rules (from CLAUDE.md §1 "Model Routing"):
 *   - ~80% of runs stay on Sonnet.
 *   - Opus fires for the tough calls only.
 *   - A tenant hitting the monthly cap auto-downshifts Sonnet→Haiku
 *     until the next cycle, and emits a warning event.
 *
 * The router does NOT call the model — it returns a recommendation
 * which the caller (brain function, decision engine, orchestrator)
 * uses to pick the executor / advisor pair.
 */

import { EXECUTOR_HAIKU, EXECUTOR_SONNET, EXECUTOR_OPUS, ADVISOR_OPUS } from './advisorStrategy';

export type CostTier = 'HAIKU_FAST' | 'SONNET_MID' | 'OPUS_HIGH';

export interface CostTierInputs {
  /** Complexity in [0, 1]. 0 = trivial, 1 = regulator-grade. */
  complexity: number;
  /** Urgency in [0, 1]. 0 = batch background, 1 = real-time MLRO. */
  urgency: number;
  /** Tenant's monthly budget usage in [0, 1]. 1 = exhausted. */
  budgetUsed: number;
  /** When set to true, forces OPUS regardless of other inputs. */
  forceOpus?: boolean;
  /** When set to true, never returns OPUS even if triggers fire. */
  capAtSonnet?: boolean;
}

export interface CostTierRecommendation {
  tier: CostTier;
  executor: string;
  advisor: string;
  /** Short, human-readable reason so the audit log can record it. */
  reason: string;
  /** True if the caller should emit a budget warning event. */
  budgetAlert: boolean;
}

const BUDGET_ALERT_THRESHOLD = 0.85;
const BUDGET_HARD_LIMIT = 0.97;

/**
 * Pick the cheapest tier that still clears all the triggers.
 */
export function pickCostTier(inputs: CostTierInputs): CostTierRecommendation {
  const { complexity, urgency, budgetUsed, forceOpus, capAtSonnet } = inputs;

  const reasons: string[] = [];
  let tier: CostTier = 'SONNET_MID'; // default

  // Budget overrides everything else. Hard-limit downshifts to Haiku.
  if (budgetUsed >= BUDGET_HARD_LIMIT) {
    reasons.push('budget hard-limit → HAIKU');
    return {
      tier: 'HAIKU_FAST',
      executor: EXECUTOR_HAIKU,
      advisor: ADVISOR_OPUS, // advisor tool valid pairs include haiku→opus
      reason: reasons.join('; '),
      budgetAlert: true,
    };
  }

  // Honour the hard forceOpus flag, even at budget alert level.
  if (forceOpus) {
    reasons.push('forceOpus=true');
    tier = 'OPUS_HIGH';
  } else {
    // Promote to OPUS if complexity and urgency both high.
    if (complexity >= 0.8 || (complexity >= 0.6 && urgency >= 0.8)) {
      reasons.push(`complexity=${complexity.toFixed(2)} urgency=${urgency.toFixed(2)} → OPUS`);
      tier = 'OPUS_HIGH';
    } else if (complexity < 0.3 && urgency < 0.5) {
      reasons.push(`complexity=${complexity.toFixed(2)} urgency=${urgency.toFixed(2)} → HAIKU`);
      tier = 'HAIKU_FAST';
    }
  }

  if (capAtSonnet && tier === 'OPUS_HIGH') {
    reasons.push('capAtSonnet=true');
    tier = 'SONNET_MID';
  }

  // Budget alert — downshift one tier if close to the limit.
  const budgetAlert = budgetUsed >= BUDGET_ALERT_THRESHOLD;
  if (budgetAlert) {
    reasons.push(`budgetUsed=${budgetUsed.toFixed(2)} — downshift one tier`);
    if (tier === 'OPUS_HIGH') tier = 'SONNET_MID';
    else if (tier === 'SONNET_MID') tier = 'HAIKU_FAST';
  }

  const executor =
    tier === 'OPUS_HIGH' ? EXECUTOR_OPUS : tier === 'HAIKU_FAST' ? EXECUTOR_HAIKU : EXECUTOR_SONNET;

  return {
    tier,
    executor,
    advisor: ADVISOR_OPUS,
    reason: reasons.join('; ') || 'defaults',
    budgetAlert,
  };
}

/**
 * Estimate complexity from a compliance case. Heuristic — purely
 * defensive, not a cost model. Values grouped into:
 *   0.2 baseline
 *   +0.15 per "risky" signal
 *   +0.10 per pending approval
 */
export function estimateComplexity(signals: {
  hasSanctionsMatch: boolean;
  hasAdverseMedia: boolean;
  isPep: boolean;
  isCrossBorder: boolean;
  isHighRiskJurisdiction: boolean;
  hasFourEyesPending: boolean;
  hasDriftAlert: boolean;
}): number {
  let score = 0.2;
  if (signals.hasSanctionsMatch) score += 0.25;
  if (signals.hasAdverseMedia) score += 0.15;
  if (signals.isPep) score += 0.15;
  if (signals.isCrossBorder) score += 0.1;
  if (signals.isHighRiskJurisdiction) score += 0.1;
  if (signals.hasFourEyesPending) score += 0.1;
  if (signals.hasDriftAlert) score += 0.1;
  return Math.min(1, score);
}
