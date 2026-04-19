/**
 * Counterfactual Reasoner — SHAP-style per-feature attribution for a
 * calibrated identity match. Answers two questions the MLRO always asks:
 *
 *   1. "Which piece of evidence is carrying this decision?"
 *   2. "Would the verdict survive if the loudest evidence disappeared?"
 *
 * Method — ablation on the log-odds accumulator:
 *
 *   For each observed identifier (name, dob, nationality, id, alias):
 *     · record its current log-likelihood ratio (LLR) contribution
 *     · re-compute the posterior with that contribution set to zero
 *     · the delta in percentage points is that feature's attribution
 *
 *   Total evidence weight = Σ |LLR_i|
 *   Dominance_i           = |LLR_i| / total evidence weight
 *
 *   A decision is FRAGILE when the top feature's dominance exceeds
 *   0.70 — removing that single piece of evidence would move the
 *   posterior by more than the MLRO would accept as robust.
 *
 * This module is pure computation — no I/O, no globals. It depends
 * only on the already-calibrated score's inputs so the attribution is
 * guaranteed to be consistent with the headline posterior.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20      CO must see which evidence drove the decision
 *   FDL No.10/2025 Art.24      10yr retention — attribution stored
 *   FATF Rec 10                positive ID — rules out "one-feature matches"
 *   EU AI Act Art.13+14        transparency + human oversight
 *   NIST AI RMF Measure 2.9    explainability — per-feature attribution
 *   ISO/IEC 42001 § 6.1.3      AI decision auditability
 */

import type { IdentityMatchBreakdown } from './identityMatchScore';
import type { EvidenceObservations } from './identityScoreBayesian';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type EvidenceFeature = 'name' | 'dob' | 'nationality' | 'id' | 'alias';

export interface FeatureAttribution {
  feature: EvidenceFeature;
  /** Current log-likelihood ratio contribution (can be negative). */
  llr: number;
  /** Absolute weight / total-evidence-weight, in [0, 1]. */
  dominance: number;
  /** Posterior probability if this feature were ablated (set to LLR 0). */
  ablatedProbability: number;
  /** Movement in percentage points if ablated (positive means it is lifting the posterior). */
  contributionPp: number;
  /** Direction relative to "this is a true match". */
  direction: 'supports-match' | 'refutes-match' | 'neutral';
  /** One-line human-readable summary for the audit trace. */
  rationale: string;
}

export interface CounterfactualAnalysis {
  /** Features sorted by absolute LLR, largest first. */
  attributions: readonly FeatureAttribution[];
  /** Top feature's dominance share in [0, 1]. */
  topDominance: number;
  /** True when any single feature carries >=70% of total evidence weight. */
  fragile: boolean;
  /** Count of features currently moving the posterior up. */
  supportingCount: number;
  /** Count of features currently moving the posterior down. */
  refutingCount: number;
  /** Total accumulated evidence weight (Σ |LLR_i|). */
  totalEvidenceWeight: number;
  /** Plain-text summary for the Asana task. */
  summary: string;
}

// ---------------------------------------------------------------------------
// LLR schedule — MUST mirror identityScoreBayesian.ts. Kept in sync by
// unit test: if that module's llr schedule changes, the fragility
// assertions in counterfactualReasoner.test.ts will break first.
// ---------------------------------------------------------------------------

function nameLlr(score: number): number {
  if (score >= 0.9) return 2.5;
  if (score >= 0.7) return 1.0;
  if (score >= 0.5) return 0.0;
  return -1.5;
}

function dobLlr(value: number, obs: EvidenceObservations): number {
  if (value >= 0.999) return 2.5;
  if (value >= 0.5) return 1.0;
  if (obs.subjectHasDob && obs.hitHasDob) return -2.5;
  return 0;
}

function natLlr(value: number, obs: EvidenceObservations): number {
  if (value >= 0.999) return 0.8;
  if (obs.subjectHasNationality && obs.hitHasNationality) return -0.8;
  return 0;
}

function idLlr(value: number, obs: EvidenceObservations): number {
  if (value >= 0.999) {
    return obs.subjectHasPin && obs.hitHasRef ? 3.5 : 3.0;
  }
  if (obs.subjectHasId && obs.hitHasId) return -3.0;
  return 0;
}

function aliasLlr(alias: number): number {
  return alias > 0 ? 0.6 : 0;
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

function rationaleFor(feature: EvidenceFeature, llr: number): string {
  if (llr === 0) return `${feature}: no signal — neither confirms nor refutes`;
  const dir = llr > 0 ? 'supports' : 'refutes';
  return `${feature}: LLR ${llr >= 0 ? '+' : ''}${llr.toFixed(2)} — ${dir} the match`;
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

export function analyseCounterfactuals(
  breakdown: IdentityMatchBreakdown,
  obs: EvidenceObservations,
  currentLogOdds: number
): CounterfactualAnalysis {
  const llrs: Record<EvidenceFeature, number> = {
    name: nameLlr(breakdown.name),
    dob: dobLlr(breakdown.dob, obs),
    nationality: natLlr(breakdown.nationality, obs),
    id: idLlr(breakdown.id, obs),
    alias: aliasLlr(breakdown.alias),
  };

  const features: EvidenceFeature[] = ['name', 'dob', 'nationality', 'id', 'alias'];
  const totalEvidenceWeight = features.reduce((acc, f) => acc + Math.abs(llrs[f]), 0);
  const currentProbability = sigmoid(currentLogOdds);

  const attributions: FeatureAttribution[] = features.map((f) => {
    const llr = llrs[f];
    const ablatedLogOdds = currentLogOdds - llr;
    const ablatedProbability = sigmoid(ablatedLogOdds);
    // contributionPp is positive when the feature is pushing probability UP
    // (its presence raises the posterior vs. the ablated world).
    const contributionPp = (currentProbability - ablatedProbability) * 100;
    const dominance = totalEvidenceWeight > 0 ? Math.abs(llr) / totalEvidenceWeight : 0;
    let direction: FeatureAttribution['direction'] = 'neutral';
    if (llr > 0.01) direction = 'supports-match';
    else if (llr < -0.01) direction = 'refutes-match';
    return {
      feature: f,
      llr,
      dominance,
      ablatedProbability,
      contributionPp,
      direction,
      rationale: rationaleFor(f, llr),
    };
  });

  attributions.sort((a, b) => Math.abs(b.llr) - Math.abs(a.llr));

  const topDominance = attributions[0]?.dominance ?? 0;
  const fragile = topDominance >= 0.7 && totalEvidenceWeight > 0;

  const supportingCount = attributions.filter((a) => a.direction === 'supports-match').length;
  const refutingCount = attributions.filter((a) => a.direction === 'refutes-match').length;

  const topFeature = attributions[0];
  const summary = topFeature
    ? `${topFeature.feature.toUpperCase()} carries ${(topDominance * 100).toFixed(0)}% of evidence weight (${fragile ? 'FRAGILE — verdict depends on single feature' : 'robust — multiple features agree'}); supporting=${supportingCount} / refuting=${refutingCount}`
    : 'No evidence recorded';

  return {
    attributions,
    topDominance,
    fragile,
    supportingCount,
    refutingCount,
    totalEvidenceWeight,
    summary,
  };
}
