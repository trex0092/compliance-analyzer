/**
 * Enhanced Brain Dispatcher — Tier A2.
 *
 * Wraps the super-brain dispatcher with a real megaBrain path:
 * when the caller supplies enough local data (prior cases, peer
 * features, customer profile), the enhanced dispatcher runs
 * `runMegaBrainForCase` from megaBrainAdapter.ts and feeds the
 * resulting EnrichableBrain into the super-brain dispatcher,
 * replacing the deterministic caseToEnrichableBrain derivation.
 *
 * Falls back gracefully to the original derivation when megaBrain
 * is unavailable (e.g. in Netlify cold-start where dynamic imports
 * are slow). The upgrade path is the whole point: existing callers
 * keep working, opt-in callers get the full 13-subsystem pipeline.
 *
 * Pure plan builder + async executor.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO/MLRO duty of care)
 *   - NIST AI RMF 1.0 MANAGE-2 + MEASURE-3 (AI decision provenance)
 *   - FDL No.10/2025 Art.29 (no tipping off — entity.name uses case id)
 */

import type { ComplianceCase } from '../domain/cases';
import type { CustomerProfile } from '../domain/customers';
import type { EnrichableBrain } from './asanaBrainEnricher';
import {
  dispatchSuperBrainPlan,
  type SuperBrainDispatchResult,
  type SuperBrainInput,
} from './asanaSuperBrainDispatcher';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnhancedDispatchInput extends Omit<SuperBrainInput, 'brain'> {
  /** Optional pre-computed brain. If omitted, the enhanced path runs. */
  brain?: EnrichableBrain;
  /** Customer profile for megaBrain features. */
  customer?: CustomerProfile;
  /** Prior cases for episodic memory. */
  priorCases?: readonly ComplianceCase[];
  /** Peer feature vectors for anomaly detection. */
  peerFeatures?: readonly Record<string, number>[];
  /** Whether sanctions have been confirmed for this entity. */
  sanctionsConfirmed?: boolean;
  /** Whether to run the full megaBrain (default: true if data is present). */
  useMegaBrain?: boolean;
}

export interface EnhancedDispatchResult extends SuperBrainDispatchResult {
  /** Which brain derivation produced the verdict. */
  brainSource: 'caller-supplied' | 'megaBrain' | 'derivation';
  /** True when megaBrain was requested but fell back. */
  megaBrainFallback?: boolean;
  /** Error message when megaBrain failed. */
  megaBrainError?: string;
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Run the enhanced dispatcher. Tries megaBrain when data is
 * available, falls back to caseToEnrichableBrain (via the
 * super-brain dispatcher's default) otherwise.
 */
export async function dispatchEnhancedBrain(
  input: EnhancedDispatchInput
): Promise<EnhancedDispatchResult> {
  // Caller supplied a pre-computed brain — use it directly.
  if (input.brain) {
    const result = await dispatchSuperBrainPlan(toSuperBrainInput(input, input.brain));
    return { ...result, brainSource: 'caller-supplied' };
  }

  // Try the real megaBrain pipeline.
  const wantsMegaBrain = input.useMegaBrain !== false && hasMegaBrainData(input);
  if (wantsMegaBrain) {
    try {
      const megaBrainModule = await import('./megaBrainAdapter');
      const mega = await megaBrainModule.runMegaBrainForCase({
        case: input.case,
        customer: input.customer,
        priorCases: input.priorCases,
        peerFeatures: input.peerFeatures,
        sanctionsConfirmed: input.sanctionsConfirmed,
      });
      // Shape the MegaBrainResponse into an EnrichableBrain — the
      // enricher only needs verdict / confidence / subsystems /
      // notes / entityId / recommendedAction / requiresHumanReview.
      const brain: EnrichableBrain = {
        verdict: mega.verdict,
        confidence: mega.confidence,
        recommendedAction: mega.recommendedAction,
        requiresHumanReview: mega.requiresHumanReview,
        entityId: mega.entityId,
        notes: mega.notes,
        subsystems: mega.subsystems,
      };
      const result = await dispatchSuperBrainPlan(toSuperBrainInput(input, brain));
      return { ...result, brainSource: 'megaBrain' };
    } catch (err) {
      // Fall through to the derivation path.
      const result = await dispatchSuperBrainPlan(toSuperBrainInput(input));
      return {
        ...result,
        brainSource: 'derivation',
        megaBrainFallback: true,
        megaBrainError: (err as Error).message,
      };
    }
  }

  // No megaBrain data — super-brain dispatcher runs the derivation.
  const result = await dispatchSuperBrainPlan(toSuperBrainInput(input));
  return { ...result, brainSource: 'derivation' };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * True when the caller supplied enough data for megaBrain to
 * produce meaningful output (at minimum: a customer profile OR
 * prior cases). An empty-case dispatch falls through to the
 * derivation path.
 */
export function hasMegaBrainData(input: EnhancedDispatchInput): boolean {
  return !!input.customer || (input.priorCases?.length ?? 0) > 0;
}

function toSuperBrainInput(input: EnhancedDispatchInput, brain?: EnrichableBrain): SuperBrainInput {
  return {
    case: input.case,
    brain,
    customer: input.customer,
    projectGid: input.projectGid,
    fourEyesApprovers: input.fourEyesApprovers,
    dispatchedAtIso: input.dispatchedAtIso,
    tenantId: input.tenantId,
    tenantRegistry: input.tenantRegistry,
  };
}
