/**
 * Deliberative Brain Chain — five-step chain-of-thought orchestrator
 * that composes the enhanced-brain modules into a single auditable
 * reasoning trace per (subject, hit) pair.
 *
 * Composition order (each step feeds the next):
 *
 *   1. selectDynamicPrior          — risk-tier + list-priority → prior
 *   2. calibrateIdentityScore      — prior + evidence → posterior + interval
 *   3. evaluateHypotheses          — posterior context → 5-hypothesis ranking
 *   4. temporalDecayMultiplier     — age of evidence → recency weight
 *   5. triageCalibratedScore       — posterior → action band + deadline
 *
 * This is the MLRO-facing explainable-AI layer: every step records a
 * short reasoning line, and the final `trace` field is a flat array
 * the Asana task renderer can dump verbatim.
 *
 * Pure function — no I/O, no globals, fully deterministic given the
 * same inputs. Tests pin every intermediate output.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.12       risk-based approach (dynamic prior)
 *   FDL No.10/2025 Art.20-21    CO sees WHY, not just the score
 *   FDL No.10/2025 Art.24       10yr retention of the reasoning trace
 *   FATF Rec 1                  risk-based approach
 *   FATF Rec 10                 positive identification
 *   EU AI Act Art.13+14         transparency + human oversight
 *   NIST AI RMF Measure 2.9     explainability of model outputs
 *   ISO/IEC 42001 § 6.1.3       AI decision auditability
 */

import type { IdentityMatchBreakdown } from './identityMatchScore';
import type { WatchlistEntry } from './screeningWatchlist';
import {
  calibrateIdentityScore,
  type CalibratedIdentityScore,
  type EvidenceObservations,
} from './identityScoreBayesian';
import { classifyListPriority, selectDynamicPrior, type DynamicPriorResult } from './dynamicPrior';
import { evaluateHypotheses, type HypothesisReasoningResult } from './hypothesisReasoner';
import { describeFreshness, temporalDecayMultiplier } from './temporalDecay';
import { triageCalibratedScore, type ConfidenceTriageResult } from './confidenceTriage';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface DeliberativeBrainInput {
  /** Subject under screening. */
  subject: WatchlistEntry;
  /** Raw identity breakdown from identityMatchScore.scoreHitAgainstProfile. */
  breakdown: IdentityMatchBreakdown;
  /** Observation matrix (who had what identifier on file). */
  evidence: EvidenceObservations;
  /** Which list raised the hit (UN / OFAC_SDN / …). */
  list: string;
  /** ISO timestamp when the evidence was observed (list-ingest time). */
  evidenceObservedAtIso: string;
  /** ISO timestamp of the current scoring run. */
  nowIso: string;
  /** Optional — pre-counted prior alerts on this subject in the last 90d. */
  recentAlertCount?: number;
  /** Optional — MLRO classification of the subject. */
  isPep?: boolean;
  /** Optional — recent adverse-media hit on this subject. */
  hasRecentAdverseMedia?: boolean;
}

export interface DeliberativeBrainResult {
  /** Selected dynamic prior + its reasoning. */
  prior: DynamicPriorResult;
  /** Calibrated posterior produced using the dynamic prior. */
  calibrated: CalibratedIdentityScore;
  /** Five-hypothesis Bayesian ranking. */
  hypotheses: HypothesisReasoningResult;
  /** Exponential recency weight + human-readable age + label. */
  decay: {
    multiplier: number;
    ageDays: number;
    freshness: string;
  };
  /** Age-weighted posterior — posterior attenuated by recency. */
  decayedProbability: number;
  /** Confidence triage band + deadline + filings. */
  triage: ConfidenceTriageResult;
  /** Flat, chronological reasoning trace — renderable as-is. */
  trace: readonly string[];
}

// ---------------------------------------------------------------------------
// Age-weighted posterior
// ---------------------------------------------------------------------------

/**
 * Apply the temporal decay multiplier to the calibrated posterior's
 * *log-odds* (not the probability). Decaying probability directly would
 * attenuate a 99% hit to 50% after one half-life, which is nonsense —
 * the designation is still real, just older. Decaying log-odds is the
 * correct operation: evidence weight scales with recency, and the
 * resulting probability still sits between prior and posterior.
 */
function decayPosterior(
  calibrated: CalibratedIdentityScore,
  multiplier: number,
  priorLogOdds: number
): number {
  // logit(p) = prior + evidence_llr; scale only the evidence term.
  const evidenceComponent = calibrated.logOdds - priorLogOdds;
  const decayedLogOdds = priorLogOdds + evidenceComponent * multiplier;
  if (decayedLogOdds > 40) return 1;
  if (decayedLogOdds < -40) return 0;
  const e = Math.exp(decayedLogOdds);
  return e / (1 + e);
}

function logit(p: number): number {
  const clamped = Math.min(0.9999, Math.max(0.0001, p));
  return Math.log(clamped / (1 - clamped));
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export function runDeliberativeBrain(input: DeliberativeBrainInput): DeliberativeBrainResult {
  const trace: string[] = [];

  // STEP 1 — dynamic prior
  const listPriority = classifyListPriority(input.list);
  const prior = selectDynamicPrior({
    riskTier: input.subject.riskTier,
    listPriority,
    recentAlertCount: input.recentAlertCount,
    isPep: input.isPep,
    hasRecentAdverseMedia: input.hasRecentAdverseMedia,
  });
  trace.push('STEP 1 — Dynamic prior');
  for (const line of prior.reasoning) trace.push(`  ${line}`);

  // STEP 2 — calibrated posterior (using the dynamic prior)
  const calibrated = calibrateIdentityScore(input.breakdown, input.evidence, prior);
  trace.push('STEP 2 — Bayesian calibration');
  trace.push(
    `  Prior P(match) = ${(prior.prior * 100).toFixed(1)}%; posterior = ${(calibrated.probability * 100).toFixed(1)}%`
  );
  trace.push(
    `  Uncertainty interval = [${(calibrated.interval[0] * 100).toFixed(1)}% .. ${(calibrated.interval[1] * 100).toFixed(1)}%]`
  );
  if (calibrated.contradictions.length > 0) {
    trace.push(`  Contradictions: ${calibrated.contradictions.join(', ')}`);
  }

  // STEP 3 — multi-hypothesis reasoning
  const hypotheses = evaluateHypotheses(input.breakdown, input.evidence);
  trace.push('STEP 3 — Hypothesis ranking');
  trace.push(`  ${hypotheses.summary}`);
  for (const h of hypotheses.ranked.slice(0, 3)) {
    trace.push(`  - ${h.hypothesis} ${(h.posterior * 100).toFixed(1)}%: ${h.description}`);
  }

  // STEP 4 — temporal decay
  const multiplier = temporalDecayMultiplier({
    observedAtIso: input.evidenceObservedAtIso,
    nowIso: input.nowIso,
  });
  const observed = Date.parse(input.evidenceObservedAtIso);
  const now = Date.parse(input.nowIso);
  const ageMs = Number.isFinite(observed) && Number.isFinite(now) ? Math.max(0, now - observed) : 0;
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  const freshness = describeFreshness(multiplier);
  trace.push('STEP 4 — Temporal decay');
  trace.push(
    `  Evidence age ${ageDays.toFixed(1)}d → multiplier ${multiplier.toFixed(2)} (${freshness})`
  );

  const priorLogOdds = logit(prior.prior);
  const decayedProbability = decayPosterior(calibrated, multiplier, priorLogOdds);
  trace.push(
    `  Age-weighted posterior = ${(decayedProbability * 100).toFixed(1)}% (log-odds scaled by multiplier)`
  );

  // STEP 5 — confidence triage (uses the RAW calibrated posterior, not
  // the decayed one — the decay is informational; we do not want a
  // freshly-observed freeze-band hit to be demoted just because the
  // last-seen timestamp is a day old. The trace still shows the decay
  // so the MLRO can override if needed.)
  const triage = triageCalibratedScore(calibrated);
  trace.push('STEP 5 — Confidence triage');
  trace.push(`  ${triage.verdict}`);
  if (triage.actions.length > 0) {
    trace.push(`  Top action: ${triage.actions[0]}`);
  }
  if (triage.deadlineBusinessHours !== undefined) {
    trace.push(`  Deadline: ${triage.deadlineBusinessHours} business hours`);
  }
  if (triage.filings.length > 0) {
    trace.push(`  Filings triggered: ${triage.filings.join(', ')}`);
  }

  return {
    prior,
    calibrated,
    hypotheses,
    decay: { multiplier, ageDays, freshness },
    decayedProbability,
    triage,
    trace,
  };
}
