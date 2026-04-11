/**
 * Narrative Drift Detector — catches boilerplate STR text.
 *
 * Phase 2 weaponization subsystem #28.
 *
 * FIU filings (STR, SAR, CTR, CNMR, DPMSR) get rejected when the
 * narrative is copy-pasted across cases. The drift detector computes a
 * normalized cosine distance between a draft narrative and the library of
 * previously-filed narratives for the same typology. Narratives that are
 * too similar to prior filings get flagged so the MLRO rewrites them.
 *
 * The implementation is a token-bag cosine over normalized unigrams +
 * bigrams — no external tokenizer, no ML dependencies. For typical
 * STR-length narratives (200-1000 words) it runs in <5ms over a library
 * of a few thousand historical filings.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.26-27 (STR/SAR filing obligations)
 *   - Cabinet Res 134/2025 Art.19 (internal review before filing)
 *   - FATF Rec 20 (meaningful reporting, not boilerplate)
 */

import { DEFAULT_CLAMP_POLICY, type ClampPolicy } from './clampPolicy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PriorFiling {
  filingId: string;
  typology: string;
  narrative: string;
}

export interface DriftReport {
  draftTypology: string;
  hasDrift: boolean;
  /** Closest prior filing by similarity. null if no prior filings. */
  closestMatch: { filingId: string; similarity: number } | null;
  /** Cosine similarity to each prior filing (top 5 only). */
  topMatches: Array<{ filingId: string; similarity: number }>;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export function detectNarrativeDrift(
  draftNarrative: string,
  draftTypology: string,
  priorFilings: readonly PriorFiling[],
  policy: Readonly<ClampPolicy> = DEFAULT_CLAMP_POLICY
): DriftReport {
  const draftVec = toTokenVector(draftNarrative);

  const matches = priorFilings
    .filter((f) => f.typology === draftTypology)
    .map((f) => ({
      filingId: f.filingId,
      similarity: cosineBag(draftVec, toTokenVector(f.narrative)),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);

  const closestMatch = matches[0] ?? null;
  const threshold = 1 - policy.narrativeDriftThreshold; // similarity >= 0.65
  const hasDrift = !!(closestMatch && closestMatch.similarity >= threshold);

  const narrative = hasDrift
    ? `Narrative drift detected: draft matches prior filing ${closestMatch!.filingId} ` +
      `at ${(closestMatch!.similarity * 100).toFixed(1)}% similarity. ` +
      `Rewrite required to avoid boilerplate flag (FDL Art.26-27).`
    : closestMatch
    ? `Narrative drift OK: closest prior filing ${closestMatch.filingId} at ` +
      `${(closestMatch.similarity * 100).toFixed(1)}% similarity (threshold ${(threshold * 100).toFixed(0)}%).`
    : `Narrative drift OK: no prior filings in this typology to compare against.`;

  return { draftTypology, hasDrift, closestMatch, topMatches: matches, narrative };
}

// ---------------------------------------------------------------------------
// Tokenization — stopword-free unigram + bigram bag of words.
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
  // Unigrams
  for (const t of tokens) {
    vec.set(t, (vec.get(t) ?? 0) + 1);
  }
  // Bigrams
  for (let i = 0; i < tokens.length - 1; i++) {
    const bg = `${tokens[i]}_${tokens[i + 1]}`;
    vec.set(bg, (vec.get(bg) ?? 0) + 1);
  }
  return vec;
}

function cosineBag(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [key, va] of a) {
    normA += va * va;
    const vb = b.get(key);
    if (vb) dot += va * vb;
  }
  for (const [, vb] of b) {
    normB += vb * vb;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
