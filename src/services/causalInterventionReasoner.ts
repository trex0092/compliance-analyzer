/**
 * Causal Intervention Reasoner — do-calculus on the identity-match
 * posterior. Answers the question the MLRO asks before approving
 * investigative spend: "If we spend effort verifying X, what is the
 * expected posterior we get?"
 *
 * Method — for each unobserved / weakly-observed identifier, simulate
 * two intervention outcomes under the same evidence model:
 *
 *   a) positiveOutcome — the probe confirms the identifier (LLR jumps to
 *                        its maximum positive contribution).
 *   b) negativeOutcome — the probe refutes the identifier (LLR jumps to
 *                        its maximum negative contribution, where the
 *                        model defines one; neutral otherwise).
 *
 * Expected posterior uplift = |P(match | do(X=positive)) - current| and
 * expected posterior drop    = |current - P(match | do(X=negative))|.
 * The "intervention value" is the MAX of the two — i.e. the probe that
 * moves the needle the most regardless of outcome direction. That is
 * exactly the probe worth prioritising for finite MLRO bandwidth.
 *
 * This is Judea Pearl's do-operator applied to a naive-Bayes log-odds
 * model. It is not a full SCM but it captures the practical question:
 * which piece of missing evidence, if resolved, most changes the
 * verdict?
 *
 * Pure function — no I/O, deterministic. Depends only on the existing
 * LLR schedule in identityScoreBayesian.ts.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.12      CDD — proportional to risk
 *   FDL No.10/2025 Art.20      CO sees which probes will move the needle
 *   FATF Rec 1                 risk-based approach — spend effort where it matters
 *   FATF Rec 10                positive identification
 *   EU AI Act Art.13+14        transparency + human oversight
 *   NIST AI RMF Measure 2.7    counterfactual / intervention analysis
 *   ISO/IEC 42001 § 6.1.3      AI decision auditability
 */

import type { IdentityMatchBreakdown } from './identityMatchScore';
import type { EvidenceObservations } from './identityScoreBayesian';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type InterventionTarget = 'dob' | 'nationality' | 'id' | 'alias';

export interface InterventionProjection {
  target: InterventionTarget;
  /** Human-readable action the MLRO would take. */
  action: string;
  /** Posterior probability if the probe CONFIRMS the identifier. */
  positiveOutcome: number;
  /** Posterior probability if the probe REFUTES the identifier. */
  negativeOutcome: number;
  /** |positive - current| in percentage points. */
  uplift: number;
  /** |current - negative| in percentage points. */
  drop: number;
  /** max(uplift, drop) — the "intervention value" of this probe. */
  interventionValue: number;
  /** Regulatory anchor for the probe. */
  regulatoryAnchor: string;
}

export interface CausalInterventionResult {
  /** Current posterior that the chain started from. */
  current: number;
  /** Projections sorted by interventionValue descending. */
  projections: readonly InterventionProjection[];
  /** Plain-text summary for the Asana trace. */
  summary: string;
}

// ---------------------------------------------------------------------------
// LLR boundaries — MUST mirror identityScoreBayesian.ts. The positive
// side is the maximum LLR each identifier can contribute; the negative
// side is the minimum (0 when the model has no "refute" value).
// ---------------------------------------------------------------------------

function dobBounds(): { positive: number; negative: number } {
  return { positive: 2.5, negative: -2.5 };
}

function natBounds(): { positive: number; negative: number } {
  return { positive: 0.8, negative: -0.8 };
}

function idBounds(obs: EvidenceObservations): { positive: number; negative: number } {
  const positive = obs.subjectHasPin && obs.hitHasRef ? 3.5 : 3.0;
  return { positive, negative: -3.0 };
}

function aliasBounds(): { positive: number; negative: number } {
  return { positive: 0.6, negative: 0 };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sigmoid(x: number): number {
  if (x > 40) return 1;
  if (x < -40) return 0;
  const e = Math.exp(x);
  return e / (1 + e);
}

function currentLlr(target: InterventionTarget, b: IdentityMatchBreakdown): number {
  switch (target) {
    case 'dob':
      if (b.dob >= 0.999) return 2.5;
      if (b.dob >= 0.5) return 1.0;
      return 0;
    case 'nationality':
      if (b.nationality >= 0.999) return 0.8;
      return 0;
    case 'id':
      if (b.id >= 0.999) return 3.0;
      return 0;
    case 'alias':
      return b.alias > 0 ? 0.6 : 0;
  }
}

function actionFor(target: InterventionTarget): string {
  switch (target) {
    case 'dob':
      return 'Collect the subject DoB during the next CDD refresh and compare against the list entry';
    case 'nationality':
      return 'Verify the subject nationality against the passport and the list entry';
    case 'id':
      return 'Capture the subject ID / passport number and compare against the list entry';
    case 'alias':
      return 'Compare recorded subject aliases against the list entry aliases';
  }
}

function regulatoryAnchorFor(target: InterventionTarget): string {
  switch (target) {
    case 'dob':
    case 'nationality':
    case 'id':
      return 'FDL No.10/2025 Art.12 (CDD); FATF Rec 10';
    case 'alias':
      return 'FATF Rec 10 (positive ID via aliases)';
  }
}

function boundsFor(
  target: InterventionTarget,
  obs: EvidenceObservations
): { positive: number; negative: number } {
  switch (target) {
    case 'dob':
      return dobBounds();
    case 'nationality':
      return natBounds();
    case 'id':
      return idBounds(obs);
    case 'alias':
      return aliasBounds();
  }
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

export function projectCausalInterventions(
  breakdown: IdentityMatchBreakdown,
  obs: EvidenceObservations,
  currentLogOdds: number
): CausalInterventionResult {
  const current = sigmoid(currentLogOdds);

  const targets: InterventionTarget[] = ['dob', 'nationality', 'id', 'alias'];
  const projections: InterventionProjection[] = [];

  for (const t of targets) {
    const cur = currentLlr(t, breakdown);
    const { positive, negative } = boundsFor(t, obs);

    // Only project if the probe can actually move things — i.e. either
    // direction differs from the current contribution.
    const positiveOutcomeLogOdds = currentLogOdds - cur + positive;
    const negativeOutcomeLogOdds = currentLogOdds - cur + negative;
    const positiveOutcome = sigmoid(positiveOutcomeLogOdds);
    const negativeOutcome = sigmoid(negativeOutcomeLogOdds);
    const uplift = (positiveOutcome - current) * 100;
    const drop = (current - negativeOutcome) * 100;
    const interventionValue = Math.max(Math.abs(uplift), Math.abs(drop));

    // Skip interventions with no informational value (e.g. identifier
    // is already fully corroborated and cannot move up).
    if (interventionValue < 0.5) continue;

    projections.push({
      target: t,
      action: actionFor(t),
      positiveOutcome,
      negativeOutcome,
      uplift,
      drop,
      interventionValue,
      regulatoryAnchor: regulatoryAnchorFor(t),
    });
  }

  projections.sort((a, b) => b.interventionValue - a.interventionValue);

  const top = projections[0];
  const summary = top
    ? `Top probe: ${top.target} (value ${top.interventionValue.toFixed(1)}pp — positive ${(top.positiveOutcome * 100).toFixed(1)}%, negative ${(top.negativeOutcome * 100).toFixed(1)}%)`
    : 'All identifiers fully corroborated — no informational probe available';

  return { current, projections, summary };
}
