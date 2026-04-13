/**
 * megaBrain Adapter — build a full MegaBrainRequest from local
 * IndexedDB state and run runMegaBrain().
 *
 * The super-brain dispatcher currently calls
 * caseToEnrichableBrain() as a deterministic derivation. That's
 * correct for cases where the SPA doesn't have the inputs the
 * full pipeline needs. This adapter is the upgrade path: when
 * the SPA DOES have screening history + peer features + a case
 * base, it assembles a real MegaBrainRequest and runs the 13-
 * subsystem pipeline end-to-end.
 *
 * Pure assembler. Caller supplies the raw data; this module
 * shapes it into MegaBrainRequest + StrFeatures + CaseMemory
 * and returns a MegaBrainResponse that the enricher can consume.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.19-21 (CO/MLRO duty of care)
 *   - FDL No.10/2025 Art.29 (no tipping off — entity.name uses
 *     case id, never legal name)
 *   - NIST AI RMF 1.0 MAP-3 + MEASURE-2 (provenance of AI
 *     decisions — the full 13-subsystem run is auditable)
 */

import type { ComplianceCase } from '../domain/cases';
import type { CustomerProfile } from '../domain/customers';
import type { MegaBrainRequest, MegaBrainResponse } from './megaBrain';
import type { StrFeatures } from './predictiveStr';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MegaBrainAdapterInput {
  case: ComplianceCase;
  customer?: CustomerProfile;
  /** Historical screening run count for this customer. */
  screeningRuns?: number;
  /** Previous cases for the same customer (episodic memory seed). */
  priorCases?: readonly ComplianceCase[];
  /** Peer feature vectors — one per peer customer. */
  peerFeatures?: readonly Record<string, number>[];
  /** Whether a sanctions match has been confirmed for this entity. */
  sanctionsConfirmed?: boolean;
}

// ---------------------------------------------------------------------------
// StrFeatures derivation
// ---------------------------------------------------------------------------

/**
 * Derive the StrFeatures shape megaBrain's predictiveStr subsystem
 * expects. Every field maps to a case / customer attribute.
 * Missing values fall back to neutral defaults (0 for counts,
 * false for booleans, 0.5 for risk ratios).
 *
 * The adapter doesn't have real transaction-level data (that
 * lives in the evidence store) so the tx-volume fields are
 * zero-initialized. Callers that DO have transaction data
 * should overlay their own features onto the result via a
 * spread merge.
 */
export function buildStrFeatures(input: MegaBrainAdapterInput): StrFeatures {
  const customer = input.customer;
  const isPep = customer?.pepStatus === 'match' || customer?.pepStatus === 'potential-match';
  const sanctionsScore =
    customer?.sanctionsStatus === 'match'
      ? 1
      : customer?.sanctionsStatus === 'potential-match'
        ? 0.5
        : 0;
  return {
    priorAlerts90d: input.priorCases?.length ?? 0,
    txValue30dAED: 0,
    nearThresholdCount30d: 0,
    crossBorderRatio30d: 0,
    isPep,
    highRiskJurisdiction: false,
    hasAdverseMedia: false,
    daysSinceOnboarding: 0,
    sanctionsMatchScore: sanctionsScore,
    cashRatio30d: 0,
  };
}

// ---------------------------------------------------------------------------
// Request builder
// ---------------------------------------------------------------------------

/**
 * Build a MegaBrainRequest from the adapter input. Pure — does
 * NOT call runMegaBrain. Tests can assert on the shape without
 * invoking the full pipeline.
 */
export function buildMegaBrainRequest(input: MegaBrainAdapterInput): MegaBrainRequest {
  const features = buildStrFeatures(input);
  return {
    topic: `Compliance assessment: ${input.case.id}`,
    entity: {
      id: input.case.id,
      // FDL Art.29 — entity.name uses case id, never the
      // customer legal name. The brain never needs the legal
      // name to produce a verdict.
      name: input.case.id,
      features,
      isSanctionsConfirmed: input.sanctionsConfirmed ?? false,
    },
    // Peer features pass through unchanged — megaBrain's
    // peerAnomaly subsystem handles the z-score math.
    peers: input.peerFeatures,
  };
}

// ---------------------------------------------------------------------------
// Dispatcher — optional, runs the real pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full megaBrain pipeline against the adapter input.
 * Returns the MegaBrainResponse so the caller can feed it into
 * the enricher.
 *
 * Dynamic import so test environments that don't want to pull
 * the megaBrain bundle can skip it by never calling this function.
 */
export async function runMegaBrainForCase(
  input: MegaBrainAdapterInput
): Promise<MegaBrainResponse> {
  const module = await import('./megaBrain');
  const request = buildMegaBrainRequest(input);
  return module.runMegaBrain(request);
}
