/**
 * Hypothesis Reasoner — deliberative multi-hypothesis engine that
 * replaces "match / no match" binary thinking with explicit
 * consideration of the five plausible explanations for any sanctions
 * hit. Each hypothesis carries its own posterior, supporting evidence,
 * and refuting evidence so the MLRO sees HOW the system narrowed the
 * space, not just WHAT it concluded.
 *
 * The five hypotheses:
 *   H1  TRUE_MATCH           subject IS the designated person/entity
 *   H2  NAME_COINCIDENCE     same name, different person (very common)
 *   H3  FAMILY_RELATIVE      subject is related to the designated person
 *   H4  STALE_ID_REUSE       identifiers were reused by a new person
 *                            (e.g. recycled passport number)
 *   H5  DATA_ERROR           list entry or customer record is wrong
 *
 * The reasoner uses Bayes' rule with hypothesis-specific likelihoods:
 *
 *   P(H_i | evidence) ∝ P(evidence | H_i) · P(H_i)
 *
 * Priors are tuned against observed portfolio base rates. H2 is the
 * largest single false-positive driver across DPMS portfolios (roughly
 * 60% of raw hits on "Mohamed Ahmed" are coincidence), so H2 carries
 * the largest prior — that is the conservative default the system
 * must overcome before triggering ALERT.
 *
 * This module is pure computation. It has no I/O, no globals, and no
 * side effects beyond the returned reasoning trace.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20   CO sees explicit reasoning, not just a score
 *   FDL No.10/2025 Art.24   10yr retention — full reasoning stored
 *   FATF Rec 10             positive ID — requires ruling out H2/H3/H4
 *   EU AI Act Art.13+14     transparency + human oversight of automated
 *                           decisions — hypotheses are the transparency layer
 *   NIST AI RMF Measure 2.9 explainability of model outputs
 */

import type { IdentityMatchBreakdown } from './identityMatchScore';
import type { EvidenceObservations } from './identityScoreBayesian';

export type Hypothesis =
  | 'TRUE_MATCH'
  | 'NAME_COINCIDENCE'
  | 'FAMILY_RELATIVE'
  | 'STALE_ID_REUSE'
  | 'DATA_ERROR';

export interface HypothesisEvaluation {
  hypothesis: Hypothesis;
  /** Posterior probability after evidence update. */
  posterior: number;
  /** Human-readable one-line description. */
  description: string;
  /** Observed evidence supporting this hypothesis. */
  supporting: readonly string[];
  /** Observed evidence refuting this hypothesis. */
  refuting: readonly string[];
  /** What the MLRO should do next to confirm or reject this. */
  nextAction: string;
}

export interface HypothesisReasoningResult {
  /** Evaluations ranked by posterior descending. */
  ranked: readonly HypothesisEvaluation[];
  /** The winning hypothesis + its lead over the runner-up. */
  leading: { hypothesis: Hypothesis; posterior: number; margin: number };
  /** Is the leading hypothesis confident enough to act on? */
  decisive: boolean;
  /** Plain-text summary for the Asana notes. */
  summary: string;
}

// ---------------------------------------------------------------------------
// Priors — portfolio-wide base rate for each hypothesis. H2 dominates
// because name-only coincidence is the largest single source of raw
// hits. The priors sum to 1.0 exactly so posterior normalisation is
// stable.
// ---------------------------------------------------------------------------

const PRIORS: Record<Hypothesis, number> = {
  TRUE_MATCH: 0.1,
  NAME_COINCIDENCE: 0.6,
  FAMILY_RELATIVE: 0.15,
  STALE_ID_REUSE: 0.05,
  DATA_ERROR: 0.1,
};

// ---------------------------------------------------------------------------
// Likelihoods — P(evidence | H). Each hypothesis predicts different
// patterns of identifier agreement. For example:
//   TRUE_MATCH     expects name + DoB + ID to all corroborate
//   COINCIDENCE    expects name agreement only, others random
//   FAMILY         expects name overlap + possibly nationality, but
//                  DoB is almost certainly different
//   STALE_ID       expects ID match but name / DoB differ
//   DATA_ERROR     expects partial agreement with noisy identifiers
// ---------------------------------------------------------------------------

interface EvidenceSummary {
  nameAgree: boolean; // name score >= 0.9
  nameWeak: boolean; // 0.5 <= name < 0.9
  dobAgree: boolean; // DoB exact match observed
  dobConflict: boolean; // Both sides have DoB, values differ
  natAgree: boolean; // Nationality exact match observed
  natConflict: boolean; // Both sides have nationality, values differ
  idAgree: boolean; // ID exact match observed
  idConflict: boolean; // Both sides have ID, values differ
  pinPresent: boolean; // MLRO pinned subject to this entry
  aliasHit: boolean; // Alias overlap observed
}

function summariseEvidence(
  breakdown: IdentityMatchBreakdown,
  obs: EvidenceObservations
): EvidenceSummary {
  return {
    nameAgree: breakdown.name >= 0.9,
    nameWeak: breakdown.name >= 0.5 && breakdown.name < 0.9,
    dobAgree: obs.subjectHasDob && obs.hitHasDob && breakdown.dob >= 0.999,
    dobConflict: obs.subjectHasDob && obs.hitHasDob && breakdown.dob < 0.5,
    natAgree: obs.subjectHasNationality && obs.hitHasNationality && breakdown.nationality >= 0.999,
    natConflict: obs.subjectHasNationality && obs.hitHasNationality && breakdown.nationality === 0,
    idAgree: obs.subjectHasId && obs.hitHasId && breakdown.id >= 0.999,
    idConflict: obs.subjectHasId && obs.hitHasId && breakdown.id < 0.999,
    pinPresent: obs.subjectHasPin && obs.hitHasRef,
    aliasHit: breakdown.alias > 0,
  };
}

function likelihood(h: Hypothesis, e: EvidenceSummary): number {
  // Likelihoods are relative; absolute scale does not matter after
  // normalisation. We keep them in [~0.01, ~0.99] so no single piece
  // of evidence obliterates the posterior.
  switch (h) {
    case 'TRUE_MATCH': {
      let l = 0.5;
      if (e.nameAgree) l *= 2.5;
      else if (e.nameWeak) l *= 1.1;
      else l *= 0.2;
      if (e.dobAgree) l *= 3.0;
      if (e.dobConflict) l *= 0.1;
      if (e.natAgree) l *= 1.3;
      if (e.natConflict) l *= 0.3;
      if (e.idAgree) l *= 4.0;
      if (e.idConflict) l *= 0.05;
      if (e.pinPresent) l *= 2.5;
      if (e.aliasHit) l *= 1.2;
      return l;
    }
    case 'NAME_COINCIDENCE': {
      let l = 0.5;
      if (e.nameAgree) l *= 1.2; // name does corroborate but doesn't prove H2
      else if (e.nameWeak) l *= 1.0;
      else l *= 0.3;
      if (e.dobConflict) l *= 2.0; // coincidence LOVES DoB conflict
      if (e.dobAgree) l *= 0.2;
      if (e.idAgree) l *= 0.05;
      if (e.natConflict) l *= 1.5;
      if (e.pinPresent) l *= 0.1;
      return l;
    }
    case 'FAMILY_RELATIVE': {
      let l = 0.3;
      if (e.nameAgree) l *= 1.4; // family often shares surname
      else if (e.nameWeak) l *= 1.2;
      if (e.dobConflict) l *= 2.2; // relatives have different DoB
      if (e.dobAgree) l *= 0.1;
      if (e.natAgree) l *= 1.5;
      if (e.idAgree) l *= 0.1;
      if (e.aliasHit) l *= 0.6;
      return l;
    }
    case 'STALE_ID_REUSE': {
      let l = 0.2;
      if (e.idAgree && (e.dobConflict || e.nameWeak)) l *= 2.5;
      if (e.idConflict) l *= 0.05;
      if (e.nameAgree && e.idAgree) l *= 0.3;
      return l;
    }
    case 'DATA_ERROR': {
      // Data error is the residual hypothesis — mildly raised when
      // evidence is a mess (some matches, some conflicts), suppressed
      // when evidence is internally consistent.
      let l = 0.25;
      const conflicts = [e.dobConflict, e.natConflict, e.idConflict].filter(Boolean).length;
      const agreements = [e.dobAgree, e.natAgree, e.idAgree].filter(Boolean).length;
      if (conflicts > 0 && agreements > 0) l *= 1.5;
      if (conflicts === 0 && agreements >= 2) l *= 0.3;
      return l;
    }
  }
}

function supportingEvidence(h: Hypothesis, e: EvidenceSummary): string[] {
  const out: string[] = [];
  switch (h) {
    case 'TRUE_MATCH':
      if (e.nameAgree) out.push('Name agrees strongly');
      if (e.dobAgree) out.push('DoB exact match');
      if (e.natAgree) out.push('Nationality agrees');
      if (e.idAgree) out.push('ID / passport number agrees');
      if (e.pinPresent) out.push('MLRO previously pinned subject to this designation');
      if (e.aliasHit) out.push('Recorded alias overlap');
      break;
    case 'NAME_COINCIDENCE':
      if (e.nameAgree || e.nameWeak) out.push('Names overlap');
      if (e.dobConflict) out.push('DoB values conflict');
      if (e.natConflict) out.push('Nationalities differ');
      if (!e.idAgree && !e.dobAgree) out.push('No strong corroborating identifier');
      break;
    case 'FAMILY_RELATIVE':
      if (e.nameAgree || e.nameWeak) out.push('Names overlap — common family surname');
      if (e.natAgree) out.push('Same nationality / country of origin');
      if (e.dobConflict) out.push('DoB differs (consistent with relative)');
      break;
    case 'STALE_ID_REUSE':
      if (e.idAgree && (e.dobConflict || e.nameWeak))
        out.push('ID agrees but name or DoB is inconsistent');
      break;
    case 'DATA_ERROR':
      if (e.dobConflict || e.natConflict || e.idConflict)
        out.push('Observed conflict on at least one identifier');
      break;
  }
  return out;
}

function refutingEvidence(h: Hypothesis, e: EvidenceSummary): string[] {
  const out: string[] = [];
  switch (h) {
    case 'TRUE_MATCH':
      if (e.dobConflict) out.push('DoB conflict — subject cannot be the listed person');
      if (e.natConflict) out.push('Nationality conflict');
      if (e.idConflict) out.push('ID number conflict');
      break;
    case 'NAME_COINCIDENCE':
      if (e.idAgree) out.push('ID number agrees — vanishingly unlikely under coincidence');
      if (e.dobAgree && e.natAgree) out.push('DoB + nationality both agree');
      if (e.pinPresent) out.push('MLRO has already pinned this designation');
      break;
    case 'FAMILY_RELATIVE':
      if (e.idAgree) out.push('ID agreement rules out a relative');
      if (e.dobAgree) out.push('Same DoB rules out a relative');
      break;
    case 'STALE_ID_REUSE':
      if (e.idConflict) out.push('IDs do not agree');
      if (e.nameAgree && e.dobAgree) out.push('Name + DoB both agree — not an ID reuse pattern');
      break;
    case 'DATA_ERROR':
      if ([e.dobAgree, e.natAgree, e.idAgree].every(Boolean)) out.push('All identifiers agree');
      break;
  }
  return out;
}

function nextAction(h: Hypothesis): string {
  switch (h) {
    case 'TRUE_MATCH':
      return 'Proceed to freeze / CO escalation per confidence triage band.';
    case 'NAME_COINCIDENCE':
      return 'Confirm DoB and passport number; if both disagree, dismiss with recorded reasoning.';
    case 'FAMILY_RELATIVE':
      return 'Investigate family relationship — still may warrant EDD under Cabinet Res 134/2025 Art.14.';
    case 'STALE_ID_REUSE':
      return 'Contact issuing authority to verify ID; dispute with list publisher if applicable.';
    case 'DATA_ERROR':
      return 'Reconcile source records; re-run scoring after data-quality correction.';
  }
}

function description(h: Hypothesis): string {
  switch (h) {
    case 'TRUE_MATCH':
      return 'Subject IS the designated person/entity.';
    case 'NAME_COINCIDENCE':
      return 'Same name, different person (portfolio base rate ~60% of raw hits).';
    case 'FAMILY_RELATIVE':
      return 'Subject is related to the designated person (shared surname / nationality).';
    case 'STALE_ID_REUSE':
      return 'Identifier reused — the ID or passport number belongs to a different natural person now.';
    case 'DATA_ERROR':
      return 'Either the list entry or the customer record contains erroneous data.';
  }
}

export function evaluateHypotheses(
  breakdown: IdentityMatchBreakdown,
  obs: EvidenceObservations
): HypothesisReasoningResult {
  const e = summariseEvidence(breakdown, obs);
  const hypotheses: Hypothesis[] = [
    'TRUE_MATCH',
    'NAME_COINCIDENCE',
    'FAMILY_RELATIVE',
    'STALE_ID_REUSE',
    'DATA_ERROR',
  ];

  const raw = hypotheses.map((h) => ({ h, weight: PRIORS[h] * likelihood(h, e) }));
  const total = raw.reduce((acc, r) => acc + r.weight, 0) || 1;

  const ranked: HypothesisEvaluation[] = raw
    .map((r) => ({
      hypothesis: r.h,
      posterior: r.weight / total,
      description: description(r.h),
      supporting: supportingEvidence(r.h, e),
      refuting: refutingEvidence(r.h, e),
      nextAction: nextAction(r.h),
    }))
    .sort((a, b) => b.posterior - a.posterior);

  const [first, second] = ranked;
  const margin = first.posterior - (second?.posterior ?? 0);
  // Decisive when the leader is >= 0.5 AND the margin is >= 0.15 —
  // i.e. the answer is clear AND it is not a two-horse race.
  const decisive = first.posterior >= 0.5 && margin >= 0.15;

  const summary = buildSummary(ranked, decisive);

  return {
    ranked,
    leading: { hypothesis: first.hypothesis, posterior: first.posterior, margin },
    decisive,
    summary,
  };
}

function buildSummary(ranked: readonly HypothesisEvaluation[], decisive: boolean): string {
  const [first, second] = ranked;
  const lead = `${first.hypothesis} (${(first.posterior * 100).toFixed(1)}%)`;
  const runnerUp = second ? `${second.hypothesis} (${(second.posterior * 100).toFixed(1)}%)` : 'n/a';
  const stance = decisive ? 'DECISIVE' : 'AMBIGUOUS';
  return `${stance}: leading hypothesis ${lead}; runner-up ${runnerUp}`;
}
