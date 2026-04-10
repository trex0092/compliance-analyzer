/**
 * Case-Based Reasoning — Episodic Memory for the Compliance Brain.
 *
 * Classical 4R cycle from Aamodt & Plaza (1994):
 *
 *   RETRIEVE  — find the K most similar past cases
 *   REUSE     — adapt their solutions to the new problem
 *   REVISE    — validate the adapted solution
 *   RETAIN    — store the new case for future retrieval
 *
 * For compliance work this is enormously powerful: every MLRO wants to
 * know "has anything like this happened before?" before writing an STR.
 * This module makes that first-class:
 *
 *   1. Each past case is embedded as a feature vector (not an LLM
 *      embedding — a hand-designed feature vector that is stable,
 *      explainable and regulator-defensible).
 *   2. Cosine similarity (with per-feature weights) ranks the top-K.
 *   3. The reuse step extracts the most common decision from the
 *      neighbours, weighted by similarity and outcome confidence.
 *   4. Retain writes the new case back into the memory with its
 *      eventual outcome — closing the feedback loop.
 *
 * Every retrieval is deterministic, explainable, and auditable. No
 * network, no hallucination, no PII leaves the tool.
 *
 * Regulatory basis:
 *   - FDL Art.19 (internal review by CO)
 *   - Cabinet Res 134/2025 Art.5 (risk appetite — precedent-informed)
 *   - FATF Rec 18 (internal policies informed by prior findings)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CaseOutcome =
  | 'no-action'
  | 'monitor'
  | 'edd'
  | 'str-filed'
  | 'freeze'
  | 'exit-relationship';

export interface PastCase {
  id: string;
  /** Structured feature vector — NOT an LLM embedding. */
  features: Record<string, number>;
  outcome: CaseOutcome;
  /** Confidence in the outcome label (e.g. 1 = final, 0.5 = pending review). */
  confidence: number;
  /** Free-text summary for human reading. */
  summary: string;
  /** Regulatory citations the case touched. */
  regulatoryRefs: readonly string[];
  decidedAtIso: string;
}

export interface RetrievalResult {
  case: PastCase;
  similarity: number;
  contributingFeatures: Array<{ feature: string; queryValue: number; caseValue: number; weight: number }>;
}

export interface ReuseRecommendation {
  recommendedOutcome: CaseOutcome;
  confidence: number;
  supportingCases: RetrievalResult[];
  dissentingCases: RetrievalResult[];
  rationale: string;
}

// ---------------------------------------------------------------------------
// Weighted cosine similarity
// ---------------------------------------------------------------------------

export function cosineSimilarity(
  a: Record<string, number>,
  b: Record<string, number>,
  weights: Record<string, number> = {},
): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of keys) {
    const w = weights[k] ?? 1;
    const av = (a[k] ?? 0) * w;
    const bv = (b[k] ?? 0) * w;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------------------------------------------------------------------------
// Memory store
// ---------------------------------------------------------------------------

export class CaseMemory {
  private cases: PastCase[] = [];
  private readonly weights: Record<string, number>;

  constructor(weights: Record<string, number> = {}) {
    this.weights = weights;
  }

  retain(kase: PastCase): void {
    // Replace if the same id already exists.
    const existing = this.cases.findIndex((c) => c.id === kase.id);
    if (existing >= 0) this.cases[existing] = kase;
    else this.cases.push(kase);
  }

  retrieve(query: Record<string, number>, k: number = 5): RetrievalResult[] {
    const scored = this.cases.map((c) => {
      const sim = cosineSimilarity(query, c.features, this.weights);
      const contributingFeatures = Object.keys({ ...query, ...c.features })
        .map((feature) => ({
          feature,
          queryValue: query[feature] ?? 0,
          caseValue: c.features[feature] ?? 0,
          weight: this.weights[feature] ?? 1,
        }))
        .filter((f) => f.queryValue !== 0 || f.caseValue !== 0)
        .sort(
          (a, b) =>
            Math.abs(b.queryValue * b.caseValue * b.weight) -
            Math.abs(a.queryValue * a.caseValue * a.weight),
        )
        .slice(0, 5);
      return { case: c, similarity: sim, contributingFeatures };
    });
    return scored
      .filter((s) => s.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);
  }

  reuse(query: Record<string, number>, k: number = 5): ReuseRecommendation {
    const neighbours = this.retrieve(query, k);
    if (neighbours.length === 0) {
      return {
        recommendedOutcome: 'monitor',
        confidence: 0,
        supportingCases: [],
        dissentingCases: [],
        rationale: 'No precedents found — defaulting to monitoring tier.',
      };
    }
    // Weighted vote per outcome.
    const votes = new Map<CaseOutcome, number>();
    let totalWeight = 0;
    for (const n of neighbours) {
      const weight = n.similarity * n.case.confidence;
      totalWeight += weight;
      votes.set(n.case.outcome, (votes.get(n.case.outcome) ?? 0) + weight);
    }
    let best: CaseOutcome = 'monitor';
    let bestWeight = -Infinity;
    for (const [outcome, w] of votes.entries()) {
      if (w > bestWeight) {
        bestWeight = w;
        best = outcome;
      }
    }
    const confidence = totalWeight === 0 ? 0 : bestWeight / totalWeight;
    const supporting = neighbours.filter((n) => n.case.outcome === best);
    const dissenting = neighbours.filter((n) => n.case.outcome !== best);
    const rationale = `${supporting.length} of ${neighbours.length} precedents led to ${best}; weighted confidence ${(confidence * 100).toFixed(1)}%.`;

    return {
      recommendedOutcome: best,
      confidence: Math.round(confidence * 10000) / 10000,
      supportingCases: supporting,
      dissentingCases: dissenting,
      rationale,
    };
  }

  size(): number {
    return this.cases.length;
  }

  clear(): void {
    this.cases = [];
  }

  snapshot(): readonly PastCase[] {
    return this.cases;
  }
}
