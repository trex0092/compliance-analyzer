/**
 * Semantic Narrative Search — subsystem #77 (Phase 7 Cluster J).
 *
 * Embeds prior STR/SAR/CTR/DPMSR narratives into a token-bag vector
 * space and serves "find cases like this one" queries. Analysts stop
 * re-discovering the same typology.
 *
 * Uses the same token-bag cosine approach as the Phase 2
 * narrativeDriftDetector (unigrams + bigrams + stopword filter) but
 * inverts the use case: instead of flagging similarity as
 * boilerplate drift, this module surfaces similarity as precedent
 * lookup.
 *
 * Pure, deterministic, in-memory. For typical STR libraries
 * (thousands of narratives) this runs in tens of milliseconds.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20 (CO documents reasoning)
 *   - Cabinet Res 134/2025 Art.5 (risk methodology incl. precedent)
 *   - FATF Rec 20 (meaningful STRs — precedent-aware)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NarrativeDocument {
  id: string;
  typology: string;
  narrative: string;
  filedAt: string;
  outcome: 'str_filed' | 'dismissed' | 'escalated' | 'pending';
}

export interface NarrativeIndex {
  docs: ReadonlyArray<{
    doc: NarrativeDocument;
    vec: ReadonlyMap<string, number>;
  }>;
}

export interface NarrativeMatch {
  doc: NarrativeDocument;
  similarity: number;
}

export interface NarrativeSearchReport {
  query: string;
  matches: NarrativeMatch[];
  narrative: string;
}

// ---------------------------------------------------------------------------
// Tokenisation (same as narrativeDriftDetector)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'of',
  'to',
  'in',
  'on',
  'at',
  'for',
  'with',
  'is',
  'was',
  'were',
  'are',
  'by',
  'this',
  'that',
  'these',
  'those',
  'has',
  'have',
  'had',
  'be',
  'been',
  'being',
  'from',
  'as',
  'it',
  'its',
]);

function toTokenVector(text: string): Map<string, number> {
  const normalised = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const tokens = normalised.split(/\s+/).filter((t) => t.length > 2 && !STOPWORDS.has(t));
  const vec = new Map<string, number>();
  for (const t of tokens) vec.set(t, (vec.get(t) ?? 0) + 1);
  for (let i = 0; i < tokens.length - 1; i++) {
    const bg = `${tokens[i]}_${tokens[i + 1]}`;
    vec.set(bg, (vec.get(bg) ?? 0) + 1);
  }
  return vec;
}

function cosine(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [k, va] of a) {
    normA += va * va;
    const vb = b.get(k);
    if (vb) dot += va * vb;
  }
  for (const [, vb] of b) normB += vb * vb;
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildNarrativeIndex(docs: readonly NarrativeDocument[]): NarrativeIndex {
  return {
    docs: docs.map((doc) => ({ doc, vec: toTokenVector(doc.narrative) })),
  };
}

export function searchNarratives(
  index: NarrativeIndex,
  query: string,
  opts: { topK?: number; typologyFilter?: string } = {}
): NarrativeSearchReport {
  const topK = opts.topK ?? 5;
  const queryVec = toTokenVector(query);

  const scored: NarrativeMatch[] = index.docs
    .filter((d) => (opts.typologyFilter ? d.doc.typology === opts.typologyFilter : true))
    .map((d) => ({ doc: d.doc, similarity: cosine(queryVec, d.vec) }))
    .filter((m) => m.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  const narrative =
    scored.length === 0
      ? 'Semantic narrative search: no similar past filings found.'
      : `Semantic narrative search: ${scored.length} similar filing(s). ` +
        `Top: ${scored[0].doc.id} (${(scored[0].similarity * 100).toFixed(0)}% similarity, ` +
        `outcome=${scored[0].doc.outcome}).`;

  return { query, matches: scored, narrative };
}
