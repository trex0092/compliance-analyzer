/**
 * Bayesian Identity Calibration — lifts the linear composite score
 * into an interpretable posterior P(true match | evidence) with an
 * uncertainty interval and counterfactual projections.
 *
 * The linear weighted sum in `identityMatchScore.ts` is correct for
 * thresholding but it is not a probability. Auditors, MLROs, and the
 * EOCN need a calibrated probability + "what would change the
 * verdict" reasoning in plain language. That is what distinguishes an
 * audit-defensible screening decision from an opaque opinion.
 *
 * Model — naive Bayes log-odds accumulator:
 *   logit(P) = log(prior / (1-prior)) + Σ observed_log_likelihood_ratio
 *   P = sigmoid(logit(P))
 *
 * Each identifier contributes a log-likelihood ratio based on its
 * observed strength. Unobserved identifiers (subject has no DoB on
 * file, list entry has no passport number) contribute ZERO — they
 * neither confirm nor refute, but they DO widen the uncertainty
 * interval because missing evidence is a real source of risk (FATF
 * Rec 10 "positive identification").
 *
 * Counterfactual engine — enumerates every component that didn't max
 * out and computes "if this identifier had been fully corroborated,
 * classification would be X, severity Y" so the MLRO sees the single
 * action most likely to promote a POSSIBLE to ALERT.
 *
 * Regulatory basis:
 *   FATF Rec 10            positive identification
 *   FDL No.10/2025 Art.20  CO must see rationale, not just a score
 *   FDL No.10/2025 Art.24  10yr audit retention — rationale stored
 *   EU AI Act Art.13       transparency of automated decision systems
 *   NIST AI RMF Measure 2.9  explainability of model outputs
 */

import type { IdentityMatchBreakdown, IdentityMatchResult } from './identityMatchScore';
import { IDENTITY_MATCH_THRESHOLDS, IDENTITY_MATCH_WEIGHTS } from './identityMatchScore';
import type { ResolvedIdentity } from './screeningWatchlist';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Distinguishes "identifier was not on file" (unobserved, neutral) from
 * "identifier was on file but the values did not agree" (observed
 * negative evidence). A matrix of both sides forms the audit trail.
 */
export interface EvidenceObservations {
  /** Subject has a recorded DoB. */
  subjectHasDob: boolean;
  /** List entry carries a DoB. */
  hitHasDob: boolean;
  subjectHasNationality: boolean;
  hitHasNationality: boolean;
  subjectHasId: boolean;
  hitHasId: boolean;
  /** MLRO pinned the subject to a specific designation. */
  subjectHasPin: boolean;
  /** Hit carries a list-entry reference. */
  hitHasRef: boolean;
  /** Subject profile carries at least one alias. */
  subjectHasAliases: boolean;
}

export interface CalibratedIdentityScore {
  /** Calibrated posterior probability that this hit is the subject, in [0,1]. */
  probability: number;
  /** Log-odds summation used to produce the probability (for audit). */
  logOdds: number;
  /**
   * [lower, upper] — the probability interval you would reach under
   * the least-favourable vs. most-favourable resolution of every
   * currently unobserved identifier. Wide intervals signal "we do
   * not have enough evidence to commit".
   */
  interval: [number, number];
  /** Components that flipped to their max would most promote this score. */
  counterfactuals: readonly IdentityCounterfactual[];
  /** Identifiers that currently carry no signal — prioritised for MLRO collection. */
  unobserved: readonly ('dob' | 'nationality' | 'id' | 'pin' | 'alias')[];
  /** Identifiers where both sides had values but they disagreed. */
  contradictions: readonly ('dob' | 'nationality' | 'id')[];
}

export interface IdentityCounterfactual {
  /** Which identifier would be strengthened. */
  component: 'name' | 'dob' | 'nationality' | 'id' | 'pin' | 'alias';
  /** Human-readable action the MLRO would take to achieve this. */
  action: string;
  /** Projected composite if the counterfactual resolves positively. */
  projectedComposite: number;
  /** Projected classification under the existing thresholds. */
  projectedClassification: 'alert' | 'possible' | 'suppress';
  /** Log-odds delta vs. the current probability. */
  logOddsDelta: number;
}

// ---------------------------------------------------------------------------
// Model constants — tuned against the existing scorer's calibration
// intent (>=0.80 → 'alert' is high-confidence) and the observed base
// rate of true matches across the DPMS portfolio (~10%).
// ---------------------------------------------------------------------------

const PRIOR_TRUE_MATCH = 0.1;

/** log(p / (1-p)). */
function logit(p: number): number {
  const clamped = Math.min(0.9999, Math.max(0.0001, p));
  return Math.log(clamped / (1 - clamped));
}

function sigmoid(x: number): number {
  if (x > 40) return 1;
  if (x < -40) return 0;
  const e = Math.exp(x);
  return e / (1 + e);
}

/** Log-likelihood ratio contribution of the observed name score. */
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
  // Pin-ref match (treated as id=1 upstream) counts as a strong ID signal.
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
// Core API
// ---------------------------------------------------------------------------

/**
 * Given the raw breakdown from `scoreHitAgainstProfile` plus the
 * observation matrix, produce a calibrated posterior + uncertainty
 * interval + counterfactual set. Pure function — no I/O, no globals.
 */
export function calibrateIdentityScore(
  breakdown: IdentityMatchBreakdown,
  obs: EvidenceObservations
): CalibratedIdentityScore {
  const prior = logit(PRIOR_TRUE_MATCH);
  const nameContribution = nameLlr(breakdown.name);
  const dobContribution = dobLlr(breakdown.dob, obs);
  const natContribution = natLlr(breakdown.nationality, obs);
  const idContribution = idLlr(breakdown.id, obs);
  const aliasContribution = aliasLlr(breakdown.alias);

  const logOdds =
    prior +
    nameContribution +
    dobContribution +
    natContribution +
    idContribution +
    aliasContribution;
  const probability = sigmoid(logOdds);

  // Uncertainty interval — fold in the range of outcomes for each
  // unobserved identifier. An identifier is "unobserved" when one or
  // both sides didn't have a value (so it got llr=0 in the sum).
  const unobserved: ('dob' | 'nationality' | 'id' | 'pin' | 'alias')[] = [];
  let minDelta = 0;
  let maxDelta = 0;
  if (!(obs.subjectHasDob && obs.hitHasDob)) {
    unobserved.push('dob');
    maxDelta += 2.5;
    minDelta += -2.5;
  }
  if (!(obs.subjectHasNationality && obs.hitHasNationality)) {
    unobserved.push('nationality');
    maxDelta += 0.8;
    minDelta += -0.8;
  }
  if (!(obs.subjectHasId && obs.hitHasId)) {
    // If the subject is pinned and the hit carries a ref, a pin-mismatch
    // is still zero signal (not a negative) — we can only win here.
    if (obs.subjectHasPin && obs.hitHasRef) {
      unobserved.push('pin');
      maxDelta += 3.5;
    } else {
      unobserved.push('id');
      maxDelta += 3.0;
      minDelta += -3.0;
    }
  }
  if (breakdown.alias === 0 && obs.subjectHasAliases) {
    unobserved.push('alias');
    maxDelta += 0.6;
  }

  const interval: [number, number] = [sigmoid(logOdds + minDelta), sigmoid(logOdds + maxDelta)];

  const contradictions: ('dob' | 'nationality' | 'id')[] = [];
  if (obs.subjectHasDob && obs.hitHasDob && breakdown.dob < 0.5) contradictions.push('dob');
  if (obs.subjectHasNationality && obs.hitHasNationality && breakdown.nationality === 0)
    contradictions.push('nationality');
  if (obs.subjectHasId && obs.hitHasId && breakdown.id < 0.999) contradictions.push('id');

  const counterfactuals = buildCounterfactuals(breakdown, obs, logOdds);

  return {
    probability,
    logOdds,
    interval,
    counterfactuals,
    unobserved,
    contradictions,
  };
}

function buildCounterfactuals(
  breakdown: IdentityMatchBreakdown,
  obs: EvidenceObservations,
  currentLogOdds: number
): IdentityCounterfactual[] {
  const cfs: IdentityCounterfactual[] = [];
  const nameW = IDENTITY_MATCH_WEIGHTS.name;
  const dobW = IDENTITY_MATCH_WEIGHTS.dob;
  const natW = IDENTITY_MATCH_WEIGHTS.nationality;
  const idW = IDENTITY_MATCH_WEIGHTS.id;
  const aliasW = IDENTITY_MATCH_WEIGHTS.aliasBonus;

  const currentComposite =
    breakdown.name * nameW +
    breakdown.dob * dobW +
    breakdown.nationality * natW +
    breakdown.id * idW +
    breakdown.alias;

  const push = (
    component: IdentityCounterfactual['component'],
    action: string,
    componentDelta: number,
    llrDelta: number
  ): void => {
    const projectedComposite = Math.min(1, currentComposite + componentDelta);
    cfs.push({
      component,
      action,
      projectedComposite,
      projectedClassification: classifyComposite(projectedComposite),
      logOddsDelta: llrDelta,
    });
  };

  if (breakdown.dob < 0.999 && (!obs.subjectHasDob || !obs.hitHasDob)) {
    // Current contribution is 0 (unobserved); projected is 2.5 (exact match llr).
    const newLlr = 2.5;
    const currentContrib = dobLlr(breakdown.dob, obs);
    push(
      'dob',
      obs.subjectHasDob
        ? 'Confirm the list entry DoB matches the subject DoB on file'
        : 'Capture the subject DoB during next CDD refresh',
      (1 - breakdown.dob) * dobW,
      newLlr - currentContrib
    );
  }

  if (breakdown.nationality < 0.999 && (!obs.subjectHasNationality || !obs.hitHasNationality)) {
    const newLlr = 0.8;
    const currentContrib = natLlr(breakdown.nationality, obs);
    push(
      'nationality',
      obs.subjectHasNationality
        ? 'Verify the list entry nationality against the subject passport'
        : 'Capture the subject nationality during next CDD refresh',
      (1 - breakdown.nationality) * natW,
      newLlr - currentContrib
    );
  }

  if (breakdown.id < 0.999) {
    if (obs.subjectHasPin && obs.hitHasRef) {
      const newLlr = 3.5;
      const currentContrib = idLlr(breakdown.id, obs);
      push(
        'pin',
        'Pin the subject to this designation in Screening Command',
        (1 - breakdown.id) * idW,
        newLlr - currentContrib
      );
    } else if (!obs.subjectHasId || !obs.hitHasId) {
      const newLlr = 3.0;
      const currentContrib = idLlr(breakdown.id, obs);
      push(
        'id',
        obs.subjectHasId
          ? 'Check whether the list entry publishes an ID number matching the subject'
          : 'Capture the subject ID / passport number during next CDD refresh',
        (1 - breakdown.id) * idW,
        newLlr - currentContrib
      );
    }
  }

  if (breakdown.name < 0.7) {
    const newLlr = 2.5;
    const currentContrib = nameLlr(breakdown.name);
    push(
      'name',
      'Run the subject through the Arabic-transliteration + phonetic matcher to confirm name equivalence',
      (0.95 - breakdown.name) * nameW,
      newLlr - currentContrib
    );
  }

  if (breakdown.alias === 0 && obs.subjectHasAliases) {
    const newLlr = 0.6;
    push(
      'alias',
      'Verify whether any recorded subject alias matches the list entry',
      aliasW,
      newLlr
    );
  }

  // Sort descending by log-odds delta so the MLRO sees the single
  // action most likely to promote the verdict first.
  cfs.sort((a, b) => b.logOddsDelta - a.logOddsDelta);

  // Recompute the probability-equivalent projectedComposite using the
  // log-odds delta so that unchanged composite (e.g. pin) still shows
  // a realistic promotion. We leave the composite projection to its
  // scalar meaning but resort by log-odds impact, which is the right
  // MLRO signal.
  return cfs;
}

function classifyComposite(c: number): 'alert' | 'possible' | 'suppress' {
  if (c >= IDENTITY_MATCH_THRESHOLDS.alert) return 'alert';
  if (c >= IDENTITY_MATCH_THRESHOLDS.possible) return 'possible';
  return 'suppress';
}

// ---------------------------------------------------------------------------
// Observation matrix helper — bridges the existing scorer's inputs into
// the calibration model without forcing every caller to construct it
// manually.
// ---------------------------------------------------------------------------

export function observeIdentityEvidence(
  identity: ResolvedIdentity | undefined,
  hit: {
    listEntryDob?: string;
    listEntryNationality?: string;
    listEntryIdNumber?: string;
    listEntryRef?: { list: string; reference: string };
  }
): EvidenceObservations {
  return {
    subjectHasDob: !!identity?.dob,
    hitHasDob: !!hit.listEntryDob,
    subjectHasNationality: !!identity?.nationality,
    hitHasNationality: !!hit.listEntryNationality,
    subjectHasId: !!identity?.idNumber,
    hitHasId: !!hit.listEntryIdNumber,
    subjectHasPin: !!identity?.listEntryRef,
    hitHasRef: !!hit.listEntryRef,
    subjectHasAliases: !!identity?.aliases && identity.aliases.length > 0,
  };
}

/**
 * Convenience wrapper — take an `IdentityMatchResult` + the inputs
 * that produced it and attach a calibrated score. The existing
 * classification and composite are untouched; this layer adds the
 * probability and reasoning without forcing downstream rewrites.
 */
export interface EnrichedIdentityResult extends IdentityMatchResult {
  calibrated: CalibratedIdentityScore;
}

export function enrichWithBayesianCalibration(
  result: IdentityMatchResult,
  obs: EvidenceObservations
): EnrichedIdentityResult {
  return {
    ...result,
    calibrated: calibrateIdentityScore(result.breakdown, obs),
  };
}
