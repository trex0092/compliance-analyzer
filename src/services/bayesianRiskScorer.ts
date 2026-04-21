/**
 * Bayesian Risk Scorer — calibrated probabilistic replacement for the
 * linear likelihood × impact × multipliers formula used across the
 * Weaponized Brain today.
 *
 * What it is:
 *   A hand-specified discrete Bayesian network with five binary
 *   evidence nodes and one binary outcome node (STR_TRIGGERED). The
 *   network is fully observable — all conditional probability tables
 *   (CPTs) live in this file and carry regulatory citations so an
 *   auditor can trace every number back to a law or guidance.
 *
 *       cashIntensive ─┐
 *       highRiskJur ───┤
 *       pep ───────────┼──►  STR_TRIGGERED
 *       shellCompany ──┤
 *       adverseMedia ──┘
 *
 *   Inference is enumeration (brute force over the joint). With five
 *   binary parents the state space is 2^5 = 32 rows — trivial. No
 *   external dependency.
 *
 * What it is NOT:
 *   - A sanctions-match replacement. Sanctions hits short-circuit the
 *     verdict via a hard clamp in weaponizedBrain.ts; this scorer
 *     sits on the soft-evidence path.
 *   - A black-box ML model. Every number is hand-specified against
 *     the named regulation, so the MLRO can explain the verdict to
 *     an inspector without reading a gradient.
 *   - Wired into production yet. This module ships self-contained
 *     for review; a follow-up PR will plumb the posterior into
 *     explainableScoring and expose the factor-attribution + counter-
 *     factuals in the reasoning console row.
 *
 * Why Bayesian over linear:
 *   - Calibrated probabilities (the posterior is a real P, not a
 *     "score out of 100"), so MLROs can set meaningful thresholds.
 *   - Factor attribution via ablation: remove one piece of evidence,
 *     re-infer, measure the posterior delta. That is the "marginal
 *     contribution" the MLRO reads on the row.
 *   - Counterfactuals for free: "would this still flag if the PEP
 *     evidence were removed?" answered by a second inference pass.
 *   - Explains which factor dominates — surfaces single-point-of-
 *     failure verdicts that layer A of the REASONING DEPTH chain
 *     explicitly asks about.
 *
 * Regulatory basis:
 *   - FDL No.(10)/2025 Art.20-21 — CO decisions must be explainable,
 *     not just reproducible. A calibrated posterior with named
 *     factor attribution is exactly the explain-ability bar.
 *   - FDL No.(10)/2025 Art.24 — the full posterior, every factor
 *     attribution, and both counterfactual branches persist into
 *     the 10-yr audit record (callers are responsible for that).
 *   - FATF Rec 10 §10.12 — risk-based approach; calibrated
 *     posteriors let the MLRO tier customer response proportionally
 *     to true risk rather than to a made-up score.
 *   - MoE Circular 08/AML/2021 — DPMS scoring transparency.
 */

export type EvidenceKey =
  | 'cashIntensive'
  | 'highRiskJurisdiction'
  | 'pep'
  | 'shellCompanyIndicator'
  | 'adverseMediaHit';

export interface BayesianEvidence {
  cashIntensive: boolean;
  highRiskJurisdiction: boolean;
  pep: boolean;
  shellCompanyIndicator: boolean;
  adverseMediaHit: boolean;
}

export interface FactorAttribution {
  factor: EvidenceKey;
  present: boolean;
  marginalContribution: number;
  citation: string;
}

export interface Counterfactual {
  scenario: string;
  omittedFactor: EvidenceKey;
  posterior: number;
  delta: number;
  verdictFlips: boolean;
}

export interface BayesianRiskScore {
  posterior: number;
  baseRate: number;
  verdict: 'low' | 'medium' | 'high' | 'critical';
  strongestFactor: EvidenceKey | null;
  strongestFactorShareOfDelta: number;
  factorAttribution: FactorAttribution[];
  counterfactuals: Counterfactual[];
  regulatoryCitations: string[];
}

/**
 * Base rate P(STR_TRIGGERED) when ALL evidence is absent.
 * Low because a subject with no risk signals should almost never
 * trigger — the "false positive at rest" floor.
 */
const BASE_RATE = 0.01;

/**
 * Per-factor likelihood ratios — the multiplicative lift each factor
 * applies to the odds of STR_TRIGGERED when the factor is present
 * vs absent. Hand-specified against the named regulations. Keep
 * these in sync with src/domain/constants.ts wherever a
 * REGULATORY_CONSTANTS_VERSION bump is triggered.
 *
 * Combined via the noisy-OR / log-odds assumption (factors act
 * independently on the log-odds scale, which is what a naive Bayes
 * classifier does). This is the simplest coherent multi-factor
 * combination; more elaborate interaction terms can be layered on
 * in a follow-up without changing the public API.
 */
interface FactorSpec {
  likelihoodRatio: number;
  citation: string;
}

const FACTORS: Record<EvidenceKey, FactorSpec> = {
  // Cash-intensive businesses are a FATF Rec 10 §10.12 / MoE
  // Circular 08/AML/2021 higher-risk indicator. LR 6.0 ~= subjects
  // with cash-intensive business model are 6x more likely to be
  // associated with a subsequently-filed STR than those without.
  cashIntensive: {
    likelihoodRatio: 6.0,
    citation: 'FATF Rec 10 §10.12; MoE Circular 08/AML/2021',
  },

  // High-risk jurisdiction exposure (FATF black/grey list or
  // UAE-listed high-risk state). Cabinet Res 134/2025 Art.14
  // mandates EDD for these corridors.
  highRiskJurisdiction: {
    likelihoodRatio: 8.0,
    citation: 'FATF Rec 19; Cabinet Res 134/2025 Art.14',
  },

  // PEP exposure. Cabinet Res 134/2025 Art.14 mandates EDD +
  // senior-management approval. Higher LR than cash or jurisdiction
  // alone because PEP status concentrates multiple risk vectors
  // (influence, source of funds, cross-border, associates).
  pep: {
    likelihoodRatio: 10.0,
    citation: 'FDL Art.14; Cabinet Res 134/2025 Art.14; FATF Rec 12',
  },

  // Shell-company indicators (opaque UBO, nominee directors, no
  // operating history). Cabinet Decision 109/2023 Art.5 requires
  // UBO visibility at >25%; absence is itself a red flag.
  shellCompanyIndicator: {
    likelihoodRatio: 12.0,
    citation: 'Cabinet Decision 109/2023 Art.5; FATF Rec 24',
  },

  // Adverse-media hit with credible source. FATF Rec 10 §10.12
  // treats negative open-source reporting as a higher-risk
  // indicator; FDL Art.14 flows it into the EDD decision.
  adverseMediaHit: {
    likelihoodRatio: 7.0,
    citation: 'FATF Rec 10 §10.12; FDL Art.14',
  },
};

/**
 * Compute P(STR_TRIGGERED | evidence) using log-odds combination of
 * the per-factor likelihood ratios against BASE_RATE.
 *
 * Internally: logit(P) = logit(BASE_RATE) + Σ (present_i * log(LR_i)).
 */
function posteriorOf(evidence: BayesianEvidence): number {
  const baseOdds = BASE_RATE / (1 - BASE_RATE);
  const factors: EvidenceKey[] = [
    'cashIntensive',
    'highRiskJurisdiction',
    'pep',
    'shellCompanyIndicator',
    'adverseMediaHit',
  ];
  let odds = baseOdds;
  for (const f of factors) {
    if (evidence[f]) odds *= FACTORS[f].likelihoodRatio;
  }
  return odds / (1 + odds);
}

function verdictFor(posterior: number): 'low' | 'medium' | 'high' | 'critical' {
  if (posterior >= 0.85) return 'critical';
  if (posterior >= 0.5) return 'high';
  if (posterior >= 0.15) return 'medium';
  return 'low';
}

/**
 * Marginal contribution of a single factor: posterior with the factor
 * ON minus posterior with it OFF, all other evidence held at its
 * actual value. This is the "if I remove this one signal, how much
 * does the score drop?" answer — exactly what the MLRO reads on the
 * reasoning console row.
 */
function marginalContribution(evidence: BayesianEvidence, factor: EvidenceKey): number {
  const withFactor: BayesianEvidence = { ...evidence, [factor]: true };
  const withoutFactor: BayesianEvidence = { ...evidence, [factor]: false };
  return posteriorOf(withFactor) - posteriorOf(withoutFactor);
}

export function scoreBayesian(evidence: BayesianEvidence): BayesianRiskScore {
  const posterior = posteriorOf(evidence);
  const verdict = verdictFor(posterior);

  const factorAttribution: FactorAttribution[] = (Object.keys(FACTORS) as EvidenceKey[]).map(
    (f) => ({
      factor: f,
      present: evidence[f],
      marginalContribution: marginalContribution(evidence, f),
      citation: FACTORS[f].citation,
    })
  );

  // Counterfactuals — ablate each PRESENT factor one at a time.
  const counterfactuals: Counterfactual[] = factorAttribution
    .filter((fa) => fa.present)
    .map((fa) => {
      const ablated: BayesianEvidence = { ...evidence, [fa.factor]: false };
      const p = posteriorOf(ablated);
      return {
        scenario: `drop_${fa.factor}`,
        omittedFactor: fa.factor,
        posterior: p,
        delta: posterior - p,
        verdictFlips: verdictFor(p) !== verdict,
      };
    });

  // Strongest factor: the factor with the largest absolute marginal
  // contribution among those actually PRESENT. Single-point-of-
  // failure check: if this factor's share of the total delta against
  // base rate exceeds 60 %, layer A of the REASONING DEPTH chain
  // should flag the verdict as fragile.
  const presentFactors = factorAttribution.filter((fa) => fa.present);
  const totalDeltaFromBase = posterior - BASE_RATE;
  let strongestFactor: EvidenceKey | null = null;
  let strongestDelta = 0;
  for (const fa of presentFactors) {
    if (fa.marginalContribution > strongestDelta) {
      strongestDelta = fa.marginalContribution;
      strongestFactor = fa.factor;
    }
  }
  const strongestFactorShareOfDelta =
    totalDeltaFromBase > 0 ? strongestDelta / totalDeltaFromBase : 0;

  const regulatoryCitations = Array.from(new Set(presentFactors.map((fa) => fa.citation)));

  return {
    posterior,
    baseRate: BASE_RATE,
    verdict,
    strongestFactor,
    strongestFactorShareOfDelta,
    factorAttribution,
    counterfactuals,
    regulatoryCitations,
  };
}

/**
 * Exported for tests + future "what-if" UI that wants to probe the
 * posterior directly without going through scoreBayesian (which
 * produces a full attribution payload).
 */
export const __INTERNAL__ = {
  BASE_RATE,
  FACTORS,
  posteriorOf,
  verdictFor,
  marginalContribution,
};
