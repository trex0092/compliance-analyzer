/**
 * Bayesian Belief Updater for Compliance Hypotheses.
 *
 * Compliance work is fundamentally probabilistic: "is this customer
 * laundering money?" is rarely a binary question. Evidence arrives
 * incrementally (CDD review, transaction alert, adverse media hit,
 * sanctions match) and each piece shifts belief in the hypothesis.
 *
 * This module implements a discrete-state Bayesian updater:
 *
 *   P(H | E)  =  P(E | H) * P(H) / P(E)
 *
 * The user defines a HYPOTHESIS SPACE (e.g. ['clean', 'suspicious',
 * 'confirmed-launderer']) and a PRIOR. Each piece of evidence has a
 * LIKELIHOOD vector giving P(E | H) for each H. The updater returns
 * the posterior distribution after all evidence is applied in order.
 *
 * Key properties:
 *   1. Order-independent (multiplication is commutative).
 *   2. Self-correcting — contradictory evidence is absorbed quantitatively.
 *   3. Explainable — we return the marginal contribution of each piece
 *      of evidence (delta in posterior) for the audit trail.
 *   4. Bounded — probabilities are re-normalised after each update so
 *      numerical drift is capped.
 *
 * The updater is NOT a full Bayesian network (no conditional independence
 * assumptions between evidence). For that, use the causalEngine module.
 * This is a Naive-Bayes-style aggregator that is good enough for the
 * vast majority of compliance belief updating tasks.
 *
 * Regulatory basis:
 *   - FDL Art.19 (risk-based approach with ongoing re-assessment)
 *   - FATF Rec 1 (risk-based approach)
 *   - Cabinet Res 134/2025 Art.5 (dynamic risk rating)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Hypothesis {
  id: string;
  label: string;
  /** Regulatory interpretation of this hypothesis. */
  regulatoryMeaning?: string;
}

export interface Evidence {
  id: string;
  label: string;
  /** P(E | H) for each hypothesis id. Values in (0, 1]. */
  likelihood: Record<string, number>;
  observedAtIso?: string;
}

export interface BeliefState {
  distribution: Record<string, number>; // hypothesis id → probability
  timestamp: string;
}

export interface UpdateStep {
  evidence: Evidence;
  prior: Record<string, number>;
  posterior: Record<string, number>;
  deltas: Record<string, number>; // posterior - prior per hypothesis
}

export interface BeliefReport {
  hypotheses: Hypothesis[];
  steps: UpdateStep[];
  finalPosterior: Record<string, number>;
  mostLikely: { id: string; label: string; probability: number };
  entropyBits: number; // Shannon entropy — measure of uncertainty
}

// ---------------------------------------------------------------------------
// Core updater
// ---------------------------------------------------------------------------

export function uniformPrior(hypotheses: readonly Hypothesis[]): Record<string, number> {
  if (hypotheses.length === 0) return {};
  const p = 1 / hypotheses.length;
  const out: Record<string, number> = {};
  for (const h of hypotheses) out[h.id] = p;
  return out;
}

export function normalise(dist: Record<string, number>): Record<string, number> {
  const total = Object.values(dist).reduce((s, v) => s + Math.max(0, v), 0);
  if (total === 0) {
    // Reset to uniform if we've collapsed.
    const n = Object.keys(dist).length;
    const p = n === 0 ? 0 : 1 / n;
    const out: Record<string, number> = {};
    for (const k of Object.keys(dist)) out[k] = p;
    return out;
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(dist)) out[k] = Math.max(0, v) / total;
  return out;
}

export function updateBelief(prior: Record<string, number>, evidence: Evidence): UpdateStep {
  const unnormalised: Record<string, number> = {};
  for (const [h, p] of Object.entries(prior)) {
    const like = evidence.likelihood[h] ?? 0;
    unnormalised[h] = p * like;
  }
  const posterior = normalise(unnormalised);
  const deltas: Record<string, number> = {};
  for (const h of Object.keys(prior)) {
    deltas[h] = round6((posterior[h] ?? 0) - (prior[h] ?? 0));
  }
  return { evidence, prior, posterior, deltas };
}

export function runBeliefUpdate(
  hypotheses: readonly Hypothesis[],
  prior: Record<string, number>,
  evidenceStream: readonly Evidence[]
): BeliefReport {
  let current = normalise({ ...prior });
  const steps: UpdateStep[] = [];
  for (const e of evidenceStream) {
    const step = updateBelief(current, e);
    steps.push(step);
    current = step.posterior;
  }

  const mostLikelyId = Object.entries(current).sort((a, b) => b[1] - a[1])[0]?.[0];
  const mostLikelyH = hypotheses.find((h) => h.id === mostLikelyId);

  return {
    hypotheses: [...hypotheses],
    steps,
    finalPosterior: current,
    mostLikely: {
      id: mostLikelyId ?? '',
      label: mostLikelyH?.label ?? '',
      probability: current[mostLikelyId ?? ''] ?? 0,
    },
    entropyBits: shannonEntropy(current),
  };
}

// ---------------------------------------------------------------------------
// Information-theoretic helpers
// ---------------------------------------------------------------------------

export function shannonEntropy(dist: Record<string, number>): number {
  let h = 0;
  for (const p of Object.values(dist)) {
    if (p > 0) h -= p * Math.log2(p);
  }
  return round6(h);
}

/**
 * Information gain from an evidence update in bits. High gain = the
 * evidence significantly resolved uncertainty.
 */
export function informationGain(step: UpdateStep): number {
  return round6(shannonEntropy(step.prior) - shannonEntropy(step.posterior));
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
