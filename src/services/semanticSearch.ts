/**
 * Semantic Search — TF-IDF + cosine similarity over a corpus.
 *
 * A deterministic, no-ML retrieval engine. The corpus is a set of
 * documents (regulations, past STRs, CDD narratives, typology entries).
 * A query returns the top-K most similar documents ranked by cosine
 * similarity over a TF-IDF weighted term vector.
 *
 * Why no embeddings?
 *   - Deterministic and reproducible (critical for audit).
 *   - Zero cost, zero latency, zero network.
 *   - Zero PII ever leaves the process.
 *   - Good enough for 80% of compliance retrieval tasks — we are not
 *     doing translation or analogy, we are finding "has this pattern
 *     been seen before" in a modest-sized corpus.
 *
 * Used by: megaBrain (as a regulatory-context evidence enricher),
 * nlComplianceQuery (to rank results by relevance).
 *
 * Regulatory basis:
 *   - FATF Rec 18 (internal policies informed by prior findings)
 *   - FDL Art.19 (risk-based approach + internal review)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Document {
  id: string;
  title: string;
  body: string;
  /** Optional metadata surfaced in search results. */
  tags?: readonly string[];
  regulatoryRef?: string;
}

export interface TokenisedDocument extends Document {
  tokens: string[];
  termFreq: Map<string, number>;
  length: number;
}

export interface SearchIndex {
  docs: TokenisedDocument[];
  idf: Map<string, number>;
  vocabularySize: number;
}

export interface SearchResult {
  doc: Document;
  score: number;
  matchedTerms: string[];
  snippet: string;
}

// ---------------------------------------------------------------------------
// Tokenisation
// ---------------------------------------------------------------------------

// English stop-words + regulatory boilerplate noise.
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'have',
  'he',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'will',
  'with',
  'which',
  'who',
  'any',
  'all',
  'shall',
  'may',
  'such',
  'must',
  'other',
  'than',
  'not',
]);

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

function termFrequency(tokens: readonly string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

// ---------------------------------------------------------------------------
// Index construction
// ---------------------------------------------------------------------------

export function buildIndex(docs: readonly Document[]): SearchIndex {
  const tokenised: TokenisedDocument[] = docs.map((d) => {
    const tokens = tokenise(`${d.title}\n${d.body}`);
    return {
      ...d,
      tokens,
      termFreq: termFrequency(tokens),
      length: tokens.length,
    };
  });

  // Document frequency per term.
  const docFreq = new Map<string, number>();
  for (const doc of tokenised) {
    const seen = new Set<string>();
    for (const token of doc.tokens) {
      if (seen.has(token)) continue;
      seen.add(token);
      docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
    }
  }

  const N = tokenised.length;
  const idf = new Map<string, number>();
  for (const [term, df] of docFreq.entries()) {
    // Smoothed IDF: log((N + 1) / (df + 1)) + 1
    idf.set(term, Math.log((N + 1) / (df + 1)) + 1);
  }

  return { docs: tokenised, idf, vocabularySize: idf.size };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function tfidfVector(tf: Map<string, number>, idf: Map<string, number>): Map<string, number> {
  const vec = new Map<string, number>();
  const maxTf = Math.max(1, ...tf.values());
  for (const [term, freq] of tf.entries()) {
    const weight = (0.5 + 0.5 * (freq / maxTf)) * (idf.get(term) ?? 0);
    if (weight > 0) vec.set(term, weight);
  }
  return vec;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [term, av] of a.entries()) {
    na += av * av;
    const bv = b.get(term);
    if (bv !== undefined) dot += av * bv;
  }
  for (const bv of b.values()) nb += bv * bv;
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchOptions {
  topK?: number;
  minScore?: number;
  snippetLength?: number;
}

export function search(
  index: SearchIndex,
  query: string,
  options: SearchOptions = {}
): SearchResult[] {
  const topK = options.topK ?? 5;
  const minScore = options.minScore ?? 0.05;
  const snippetLength = options.snippetLength ?? 160;

  const queryTokens = tokenise(query);
  if (queryTokens.length === 0) return [];

  const queryTf = termFrequency(queryTokens);
  const queryVec = tfidfVector(queryTf, index.idf);
  const queryTerms = new Set(queryTokens);

  const results = index.docs.map((doc) => {
    const docVec = tfidfVector(doc.termFreq, index.idf);
    const score = cosine(queryVec, docVec);
    const matchedTerms = [...queryTerms].filter((t) => doc.termFreq.has(t));
    return {
      doc: {
        id: doc.id,
        title: doc.title,
        body: doc.body,
        tags: doc.tags,
        regulatoryRef: doc.regulatoryRef,
      },
      score: round4(score),
      matchedTerms,
      snippet: buildSnippet(doc.body, matchedTerms, snippetLength),
    };
  });

  return results
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function buildSnippet(body: string, matchedTerms: readonly string[], maxLength: number): string {
  if (matchedTerms.length === 0) return body.slice(0, maxLength);
  const lower = body.toLowerCase();
  // Find the earliest matching term position.
  let minPos = Infinity;
  for (const term of matchedTerms) {
    const idx = lower.indexOf(term);
    if (idx >= 0 && idx < minPos) minPos = idx;
  }
  if (minPos === Infinity) return body.slice(0, maxLength);
  const start = Math.max(0, minPos - 40);
  const end = Math.min(body.length, start + maxLength);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < body.length ? '…' : '';
  return `${prefix}${body.slice(start, end).trim()}${suffix}`;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
