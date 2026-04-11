/**
 * Precedent Retriever — similarity search over past sealed decisions.
 *
 * Phase 2 weaponization subsystem #21.
 *
 * When a new case comes in, the retriever finds the N most similar past
 * cases by comparing their explainable-scoring factor vectors. The MLRO
 * sees: "We've handled 4 similar cases — 3 were STRs, 1 was a false
 * positive. Most recent STR: case-1234, filed 2026-01-15."
 *
 * This closes the "why did we do it this way last time?" gap that's the
 * most common cause of inconsistent MLRO decisions across analysts.
 *
 * The index is in-memory and populated by the caller (brainBridge or a
 * batch indexer). No network calls, no vector database — cosine
 * similarity over small feature vectors is enough for the ~10k-case
 * precedent library a DPMS compliance team would have.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (documented reasoning for CO decisions)
 *   - Cabinet Res 134/2025 Art.5 (risk methodology based on precedent)
 */

import type { Verdict } from './teacherStudent';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrecedentRecord {
  caseId: string;
  /** ISO timestamp when the case was decided. */
  decidedAt: string;
  /** Final verdict on the case. */
  verdict: Verdict;
  /** Outcome after MLRO review: filed STR, dismissed as false positive, etc. */
  outcome: 'str_filed' | 'sar_filed' | 'ctr_filed' | 'dismissed' | 'pending' | 'escalated';
  /** Factor vector — ordered, unit-interval values. */
  factors: number[];
  /** Short label for the UI. */
  label: string;
}

export interface PrecedentQuery {
  /** Factor vector for the current case. Must be the same dimension as index. */
  factors: number[];
  /** How many precedents to return. */
  topK?: number;
}

export interface PrecedentMatch {
  record: PrecedentRecord;
  /** Cosine similarity in [0,1] — higher is more similar. */
  similarity: number;
}

export interface PrecedentReport {
  matches: PrecedentMatch[];
  /** Count of outcomes among top-K matches, useful for "3 of 4 became STRs". */
  outcomeCounts: Record<PrecedentRecord['outcome'], number>;
  /** The dominant outcome in the top-K matches. null if no matches. */
  dominantOutcome: PrecedentRecord['outcome'] | null;
  /** Human-readable summary. */
  summary: string;
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

/**
 * Build an in-memory precedent index from an iterable of records. Returns
 * the array (no hidden structure) so the caller can persist / hydrate it.
 */
export function buildPrecedentIndex(records: Iterable<PrecedentRecord>): PrecedentRecord[] {
  return Array.from(records);
}

/**
 * Query the index for the top-K most similar past decisions.
 */
export function queryPrecedents(
  index: readonly PrecedentRecord[],
  query: PrecedentQuery
): PrecedentReport {
  const topK = query.topK ?? 5;

  const scored: PrecedentMatch[] = index
    .filter((r) => r.factors.length === query.factors.length)
    .map((record) => ({
      record,
      similarity: cosineSimilarity(record.factors, query.factors),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  const outcomeCounts: Record<PrecedentRecord['outcome'], number> = {
    str_filed: 0,
    sar_filed: 0,
    ctr_filed: 0,
    dismissed: 0,
    pending: 0,
    escalated: 0,
  };
  for (const match of scored) {
    outcomeCounts[match.record.outcome] += 1;
  }

  let dominantOutcome: PrecedentRecord['outcome'] | null = null;
  let dominantCount = 0;
  for (const [outcome, count] of Object.entries(outcomeCounts)) {
    if (count > dominantCount) {
      dominantOutcome = outcome as PrecedentRecord['outcome'];
      dominantCount = count;
    }
  }

  const summary =
    scored.length === 0
      ? 'No similar past cases found in the precedent index.'
      : `Found ${scored.length} similar past case(s). ` +
        (dominantOutcome ? `${dominantCount} of ${scored.length} → ${dominantOutcome}.` : '') +
        ` Most similar: ${scored[0].record.label} (similarity ${(scored[0].similarity * 100).toFixed(0)}%).`;

  return { matches: scored, outcomeCounts, dominantOutcome, summary };
}

// ---------------------------------------------------------------------------
// Math — cosine similarity, no external dependencies.
// ---------------------------------------------------------------------------

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return Math.max(0, Math.min(1, dot / (Math.sqrt(normA) * Math.sqrt(normB))));
}
