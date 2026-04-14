/**
 * Tier C Asana Dispatch — route break-glass approvals and clamp
 * suggestions through the existing AsanaOrchestrator.
 *
 * Why this exists:
 *   The orchestrator in src/services/asana/orchestrator.ts already
 *   knows how to dispatch a BrainVerdictLike to Asana with
 *   idempotency + retry + four-eyes custom fields. Break-glass
 *   requests and clamp suggestions are naturally expressible as
 *   BrainVerdictLike payloads — they have a tenant, an id, a
 *   verdict-like status, a recommended action, and citations.
 *
 *   This module provides pure adapter functions that shape each
 *   Tier C artifact into a BrainVerdictLike so the orchestrator
 *   can dispatch it without knowing anything about Tier C. Zero
 *   state, zero I/O — the dispatch itself is delegated back to
 *   the injected orchestrator.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO visibility in Asana)
 *   Cabinet Res 134/2025 Art.12-14 (four-eyes — break-glass)
 *   Cabinet Res 134/2025 Art.19 (internal review — clamp suggestions)
 *   NIST AI RMF 1.0 MANAGE-3 + GOVERN-4
 *   EU AI Act Art.14
 */

import type {
  BrainVerdictLike,
  AsanaOrchestrator,
  AsanaOrchestratorDispatchResult,
} from './orchestrator';
import type { BreakGlassRequest } from '../breakGlassOverride';
import type { ClampSuggestion } from '../clampSuggestionLog';

// ---------------------------------------------------------------------------
// Break-glass -> Asana verdict
// ---------------------------------------------------------------------------

/**
 * Map an APPROVED break-glass request to a BrainVerdictLike so the
 * orchestrator dispatches it. Only approved requests are mapped —
 * pending / rejected / cancelled states return null so callers
 * skip dispatch for them.
 */
export function breakGlassToVerdict(req: BreakGlassRequest): BrainVerdictLike | null {
  if (req.status !== 'approved' && req.status !== 'executed') return null;
  return {
    id: req.id,
    tenantId: req.tenantId,
    verdict: req.toVerdict,
    confidence: 1, // MLRO-approved — not a probabilistic verdict
    recommendedAction:
      `Break-glass override ${req.fromVerdict} -> ${req.toVerdict} approved by ${req.approvedBy ?? 'unknown'}. ` +
      `Execute per regulatory citation ${req.regulatoryCitation}.`,
    requiresHumanReview: true,
    at: req.approvedAtIso ?? req.requestedAtIso,
    entityId: req.caseId,
    entityName: `break-glass:${req.caseId}`,
    citations: [
      'FDL No.10/2025 Art.20-22',
      'FDL No.10/2025 Art.24',
      'Cabinet Res 134/2025 Art.12-14',
      req.regulatoryCitation,
    ],
  };
}

// ---------------------------------------------------------------------------
// Clamp suggestion -> Asana verdict
// ---------------------------------------------------------------------------

/**
 * Map a clamp suggestion to a BrainVerdictLike so the orchestrator
 * creates a pending_mlro_review Asana task on the CO queue. Every
 * suggestion dispatches, regardless of status, because the MLRO
 * must see it.
 */
export function clampSuggestionToVerdict(
  suggestion: ClampSuggestion,
  tenantId: string
): BrainVerdictLike {
  return {
    id: suggestion.id,
    tenantId,
    verdict: 'flag',
    confidence: 0.5,
    recommendedAction:
      `Clamp tuning suggestion: ${suggestion.clampKey} ` +
      `${suggestion.currentValue} -> ${suggestion.proposedValue} ` +
      `(delta ${suggestion.delta.toFixed(4)}). ${suggestion.rationale}`,
    requiresHumanReview: true,
    at: suggestion.createdAtIso,
    entityId: suggestion.clampKey,
    entityName: `clamp:${suggestion.clampKey}`,
    citations: [
      'FDL No.10/2025 Art.20-22',
      'Cabinet Res 134/2025 Art.19',
      'NIST AI RMF 1.0 GOVERN-4',
      suggestion.regulatory,
    ],
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export interface TierCAsanaDispatcher {
  dispatchBreakGlass(req: BreakGlassRequest): Promise<AsanaOrchestratorDispatchResult | null>;
  dispatchClampSuggestion(
    suggestion: ClampSuggestion,
    tenantId: string
  ): Promise<AsanaOrchestratorDispatchResult>;
}

/**
 * Build a dispatcher bound to an orchestrator instance. Tests
 * inject a fake orchestrator; production wires the default
 * singleton from orchestrator.ts.
 */
export function createTierCAsanaDispatcher(
  orchestrator: Pick<AsanaOrchestrator, 'dispatchBrainVerdict'>
): TierCAsanaDispatcher {
  return {
    async dispatchBreakGlass(req) {
      const verdict = breakGlassToVerdict(req);
      if (!verdict) return null;
      return orchestrator.dispatchBrainVerdict(verdict);
    },
    async dispatchClampSuggestion(suggestion, tenantId) {
      const verdict = clampSuggestionToVerdict(suggestion, tenantId);
      return orchestrator.dispatchBrainVerdict(verdict);
    },
  };
}

// Exports for tests.
export const __test__ = { breakGlassToVerdict, clampSuggestionToVerdict };
