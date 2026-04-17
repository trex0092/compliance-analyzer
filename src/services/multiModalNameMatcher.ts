/**
 * Multi-Modal Name Matcher — Phase 16 Screening Intelligence (#115).
 *
 * Refinitiv World-Check and Dow Jones Risk & Compliance combine three to
 * five string-similarity algorithms per candidate and present the MLRO
 * with a per-algorithm breakdown so the reviewer can see WHICH signal
 * fired. This module brings that capability in-house:
 *
 *   1. Jaro-Winkler          — typo tolerance with prefix bonus
 *   2. Levenshtein (norm.)   — raw edit distance, robust to transposed
 *                              characters that Jaro-Winkler under-weights
 *   3. Soundex (American)    — classic 1-letter + 3-digit phonetic code
 *   4. Double Metaphone      — more accurate phonetic hash for Latin +
 *                              transliterated Arabic
 *   5. Token-set similarity  — order-insensitive token alignment
 *
 * The five algorithms disagree deliberately. An MLRO should believe a
 * hit more when five-out-of-five agree than when two-out-of-five agree,
 * even if the naive composite score is identical. So we emit an
 * `agreement` metric alongside the weighted `score`. Downstream callers
 * (runScreeningMegaBrain, the adverse-media relevance classifier, the
 * Dempster-Shafer aggregator) weight evidence by algorithm agreement,
 * not by composite score alone.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.12-14   Adequate CDD / sanctions screening
 *   - Cabinet Res 134/2025 Art.7-10 CDD tiers, screening obligation
 *   - FATF Rec 22/23             DPMS screening duties
 *   - EU AI Act Art.10           Bias mitigation in high-risk AI
 *   - NIST AI RMF Measure 2.11   Fairness of AI decisions
 *
 * Scope (v1):
 *   - Pure functions; no I/O; deterministic; browser-safe.
 *   - Reuses `nameMatching.ts` for Jaro-Winkler, Metaphone,
 *     transliteration, normalisation, legal-suffix stripping, and
 *     token-set breakdown. Adds Levenshtein and Soundex.
 *   - Exposes per-algorithm breakdown + ensemble score + algorithm
 *     agreement so sanctions-screening callers can tune thresholds per
 *     algorithm and weight by agreement.
 */

import {
  containsArabic,
  jaroWinkler,
  metaphone,
  normalise,
  stripLegalSuffix,
  tokenSetBreakdown,
  transliterateArabic,
} from './nameMatching';

// ---------------------------------------------------------------------------
// 1. Levenshtein edit distance
// ---------------------------------------------------------------------------

/**
 * Levenshtein edit distance — classic Wagner-Fischer DP.
 *
 * Returns the minimum number of single-character insertions, deletions,
 * or substitutions required to transform `a` into `b`. O(la * lb) time,
 * O(min(la, lb)) space via the two-row optimisation.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  // Ensure `a` is the shorter string to minimise the DP row width.
  if (la > lb) return levenshteinDistance(b, a);

  let prev = new Array<number>(la + 1);
  let curr = new Array<number>(la + 1);
  for (let i = 0; i <= la; i++) prev[i] = i;

  for (let j = 1; j <= lb; j++) {
    curr[0] = j;
    for (let i = 1; i <= la; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        curr[i - 1] + 1,       // insertion
        prev[i] + 1,           // deletion
        prev[i - 1] + cost,    // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[la];
}

/**
 * Normalised Levenshtein similarity in [0, 1].
 * 1.0 means identical, 0.0 means maximum-distance.
 */
export function levenshteinSimilarity(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0 && lb === 0) return 1;
  const maxLen = Math.max(la, lb);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(a, b);
  return 1 - dist / maxLen;
}

// ---------------------------------------------------------------------------
// 2. American Soundex
// ---------------------------------------------------------------------------

const SOUNDEX_CODE: Record<string, string> = {
  b: '1', f: '1', p: '1', v: '1',
  c: '2', g: '2', j: '2', k: '2', q: '2', s: '2', x: '2', z: '2',
  d: '3', t: '3',
  l: '4',
  m: '5', n: '5',
  r: '6',
};

/**
 * American Soundex — 1 letter + 3 digits.
 *
 * Rules (per the U.S. National Archives reference implementation):
 *   1. Keep the first letter.
 *   2. Map subsequent letters per the SOUNDEX_CODE table above.
 *   3. Drop vowels (AEIOU), H, W, Y.
 *   4. Drop consecutive duplicate codes (after applying rule 3,
 *      treating H/W as transparent so e.g. "Ashcraft" → A-2-1-6-3).
 *   5. Pad with '0' or truncate to produce exactly 4 characters.
 *
 * Returns an empty string for inputs that contain no ASCII letters
 * (e.g. Chinese / Cyrillic without transliteration).
 */
export function soundex(raw: string): string {
  const s = normalise(raw).replace(/[^a-z]/g, '');
  if (s.length === 0) return '';

  const first = s[0].toUpperCase();
  let code = first;

  // The Soundex "drop H/W but let them split adjacent same-code letters"
  // rule: compute the code of every letter (vowels/Y → '?' placeholder;
  // H/W → '.' which is transparent), then drop consecutive duplicates
  // ignoring '.', then strip '?' and '.'.
  let mapped = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === 'h' || c === 'w') {
      mapped += '.';
    } else if ('aeiouy'.includes(c)) {
      mapped += '?';
    } else {
      mapped += SOUNDEX_CODE[c] ?? '?';
    }
  }

  // Drop consecutive duplicate codes, treating '.' as transparent.
  let dedup = '';
  for (let i = 0; i < mapped.length; i++) {
    const ch = mapped[i];
    if (ch === '.') continue;
    // Walk back in the ORIGINAL mapped stream — NOT in the dedup'd
    // output — to find the previous non-'.' code. This preserves the
    // classical "H/W are transparent" Soundex rule: two same-code
    // letters separated only by H or W still count as adjacent and
    // collapse into one code.
    let prevOriginal = '';
    for (let k = i - 1; k >= 0; k--) {
      if (mapped[k] === '.') continue;
      prevOriginal = mapped[k];
      break;
    }
    if (prevOriginal === ch) continue;
    dedup += ch;
  }

  // Strip vowel placeholders ('?'). The first letter was excluded
  // from mapping loop? Actually it was INCLUDED — so we need to
  // drop the first code/placeholder if it corresponds to the first
  // letter being kept as-is.
  // The loop above mapped s[0] as well. Peel it off now.
  dedup = dedup.replace(/\?/g, '');
  // Remove the code corresponding to the first letter.
  const firstCode =
    'aeiouy'.includes(s[0]) ? '?' :
    s[0] === 'h' || s[0] === 'w' ? '.' :
    SOUNDEX_CODE[s[0]] ?? '?';
  if (firstCode !== '?' && firstCode !== '.' && dedup[0] === firstCode) {
    dedup = dedup.slice(1);
  }

  code += dedup;
  code = code.slice(0, 4);
  while (code.length < 4) code += '0';
  return code;
}

// ---------------------------------------------------------------------------
// 3. Ensemble weights
// ---------------------------------------------------------------------------

export interface MultiModalWeights {
  jaroWinkler: number;
  levenshtein: number;
  soundex: number;
  metaphone: number;
  tokenSet: number;
}

/**
 * Empirically tuned defaults. Token-set dominates because it handles
 * surname-first ↔ surname-last and middle-name omission robustly.
 * Levenshtein and Jaro-Winkler jointly cover typo tolerance.
 * Metaphone and Soundex contribute the phonetic signal (homophones).
 *
 * Calibration check-points (see tests):
 *   - identical strings                  → 1.00
 *   - surname swap                       → ≥ 0.90
 *   - single-letter typo                 → ≥ 0.88
 *   - legal-suffix only difference       → 1.00
 *   - unrelated names (Wang Wei ≠ Lei)   → < 0.70
 *   - Arabic ↔ Latin after translit.     → ≥ 0.70 (flagged)
 */
export const DEFAULT_WEIGHTS: MultiModalWeights = Object.freeze({
  jaroWinkler: 0.20,
  levenshtein: 0.15,
  soundex: 0.10,
  metaphone: 0.15,
  tokenSet: 0.40,
});

function normaliseWeights(w: MultiModalWeights): MultiModalWeights {
  const sum =
    w.jaroWinkler + w.levenshtein + w.soundex + w.metaphone + w.tokenSet;
  if (sum === 0) return DEFAULT_WEIGHTS;
  return {
    jaroWinkler: w.jaroWinkler / sum,
    levenshtein: w.levenshtein / sum,
    soundex: w.soundex / sum,
    metaphone: w.metaphone / sum,
    tokenSet: w.tokenSet / sum,
  };
}

// ---------------------------------------------------------------------------
// 4. Multi-modal match breakdown
// ---------------------------------------------------------------------------

export type MultiModalClassification = 'confirmed' | 'potential' | 'weak' | 'none';

export interface MultiModalMatchBreakdown {
  /** Weighted composite score in [0, 1]. */
  score: number;
  /**
   * Algorithm agreement in [0, 1]. 1.0 means all five algorithms
   * produced the same score (within rounding); 0.0 means maximum
   * disagreement. Low agreement + high score is a yellow flag for the
   * MLRO — one strong signal pulling a weighted average up while the
   * rest disagree often indicates an idiosyncratic hit (e.g. a
   * surname that phonetically collides with an unrelated name).
   */
  agreement: number;
  jaroWinkler: number;
  levenshtein: number;
  /** 1 if Soundex codes match, else 0. Empty-code → 0. */
  soundex: number;
  /** 1 if Metaphone codes match, else 0. Empty-code → 0. */
  metaphone: number;
  tokenSet: number;
  /** True if one side was Arabic and got transliterated to match. */
  transliterated: boolean;
  /** Per-side normalised strings actually compared. */
  normalisedA: string;
  normalisedB: string;
  /** Classification per CLAUDE.md decision tree thresholds. */
  classification: MultiModalClassification;
  /** Weights used for the composite score. */
  weights: MultiModalWeights;
}

function classify(score: number): MultiModalClassification {
  if (score >= 0.9) return 'confirmed';
  if (score >= 0.7) return 'potential';
  if (score >= 0.5) return 'weak';
  return 'none';
}

function agreementOf(scores: readonly number[]): number {
  const n = scores.length;
  if (n === 0) return 0;
  const mean = scores.reduce((a, b) => a + b, 0) / n;
  let sumSq = 0;
  for (const s of scores) sumSq += (s - mean) * (s - mean);
  const stddev = Math.sqrt(sumSq / n);
  // stddev is in [0, 0.5] for values in [0, 1]. Map to [1, 0]
  // with a 2x slope so even modest disagreement shows on the metric.
  return Math.max(0, Math.min(1, 1 - stddev * 2));
}

/**
 * Compute a per-algorithm breakdown + composite score for two names.
 *
 * Caller can override weights via the second argument; unspecified
 * fields fall back to DEFAULT_WEIGHTS. Provided weights are normalised
 * to sum to 1 so callers can pass arbitrary positive magnitudes.
 */
export function multiModalMatch(
  rawA: string,
  rawB: string,
  weights?: Partial<MultiModalWeights>,
): MultiModalMatchBreakdown {
  // Pre-process: legal-suffix strip, transliterate if one side is Arabic.
  let a = stripLegalSuffix(rawA);
  let b = stripLegalSuffix(rawB);
  let transliterated = false;
  if (containsArabic(a) && !containsArabic(b)) {
    a = transliterateArabic(a);
    transliterated = true;
  } else if (containsArabic(b) && !containsArabic(a)) {
    b = transliterateArabic(b);
    transliterated = true;
  } else if (containsArabic(a) && containsArabic(b)) {
    a = transliterateArabic(a);
    b = transliterateArabic(b);
  }

  const normA = normalise(a);
  const normB = normalise(b);

  // Order-invariant whole-string view: sort tokens alphabetically so
  // "Smith John" and "John Smith" produce identical character-level
  // signals. Character-level algorithms (Jaro-Winkler, Levenshtein)
  // are positional — without this, surname-first ↔ surname-last
  // swaps tank their scores even though the names are identical.
  const sortedA = normA.split(/\s+/).filter((t) => t.length > 0).sort().join(' ');
  const sortedB = normB.split(/\s+/).filter((t) => t.length > 0).sort().join(' ');

  const jw = jaroWinkler(sortedA, sortedB);
  const lev = levenshteinSimilarity(sortedA, sortedB);

  // Phonetic codes are compared per-token as sets: if ANY token in A
  // has a matching phonetic code in B, the signal fires. This handles
  // the same surname-swap case and also "middle name dropped" cases
  // without the composite-score dilution of whole-string hashing.
  const tokensA = normA.split(/\s+/).filter((t) => t.length > 0);
  const tokensB = normB.split(/\s+/).filter((t) => t.length > 0);
  const soundexSetA = new Set(tokensA.map(soundex).filter((c) => c.length > 0));
  const soundexSetB = new Set(tokensB.map(soundex).filter((c) => c.length > 0));
  const soundexOverlap = [...soundexSetA].filter((c) => soundexSetB.has(c)).length;
  const soundexDenom = Math.min(soundexSetA.size, soundexSetB.size);
  const sx = soundexDenom > 0 ? soundexOverlap / soundexDenom : 0;

  const metaSetA = new Set(tokensA.map(metaphone).filter((c) => c.length > 0));
  const metaSetB = new Set(tokensB.map(metaphone).filter((c) => c.length > 0));
  const metaOverlap = [...metaSetA].filter((c) => metaSetB.has(c)).length;
  const metaDenom = Math.min(metaSetA.size, metaSetB.size);
  const meta = metaDenom > 0 ? metaOverlap / metaDenom : 0;

  const tsb = tokenSetBreakdown(normA, normB);
  // Apply the same distinct-token fairness clamp used in nameMatching.ts
  // so Chinese / South Asian / Arabic / Persian names are not penalised
  // by token-order false positives. See nameMatching.ts §matchScore.
  let token = tsb.mean;
  const heavilyDistinct = tsb.min < 0.6;
  const sharedSingleTokenWithDistinctOther =
    tsb.max >= 0.999 && tsb.min < 0.8;
  if (heavilyDistinct || sharedSingleTokenWithDistinctOther) {
    token = tsb.min * tsb.min;
  }

  const w = normaliseWeights({ ...DEFAULT_WEIGHTS, ...weights });
  const score = Math.min(
    1,
    jw * w.jaroWinkler +
      lev * w.levenshtein +
      sx * w.soundex +
      meta * w.metaphone +
      token * w.tokenSet,
  );

  const agreement = agreementOf([jw, lev, sx, meta, token]);

  return {
    score,
    agreement,
    jaroWinkler: jw,
    levenshtein: lev,
    soundex: sx,
    metaphone: meta,
    tokenSet: token,
    transliterated,
    normalisedA: normA,
    normalisedB: normB,
    classification: classify(score),
    weights: w,
  };
}

/** True if `multiModalMatch(a, b).score >= threshold`. */
export function isMultiModalMatch(
  a: string,
  b: string,
  threshold = 0.7,
): boolean {
  return multiModalMatch(a, b).score >= threshold;
}

/**
 * Search a candidate list and return the highest-scoring match above
 * the threshold. Used by the sanctions screening pipeline as a
 * drop-in replacement for `findBestMatch()` when the caller wants the
 * per-algorithm breakdown (e.g. to render "matched on Soundex +
 * Metaphone but not Levenshtein" in the MLRO UI).
 */
export function findBestMultiModalMatch(
  query: string,
  candidates: readonly string[],
  threshold = 0.7,
  weights?: Partial<MultiModalWeights>,
): { candidate: string; breakdown: MultiModalMatchBreakdown } | null {
  let best: { candidate: string; breakdown: MultiModalMatchBreakdown } | null =
    null;
  for (const c of candidates) {
    const breakdown = multiModalMatch(query, c, weights);
    if (breakdown.score < threshold) continue;
    if (best === null || breakdown.score > best.breakdown.score) {
      best = { candidate: c, breakdown };
    }
    if (best.breakdown.score >= 0.999) break;
  }
  return best;
}

// ---------------------------------------------------------------------------
// 5. Orchestrator-friendly entry point
// ---------------------------------------------------------------------------

export interface MultiModalScreeningRequest {
  /** Subject name being screened. */
  query: string;
  /** Candidate names from sanctions / PEP / watch lists. */
  candidates: readonly string[];
  /** Composite-score threshold for inclusion. Default 0.7 (potential). */
  threshold?: number;
  /** Optional weight override. */
  weights?: Partial<MultiModalWeights>;
  /** Maximum hits returned. Default 20. */
  maxHits?: number;
}

export interface MultiModalScreeningHit {
  candidate: string;
  breakdown: MultiModalMatchBreakdown;
}

export interface MultiModalScreeningResponse {
  query: string;
  threshold: number;
  totalCandidates: number;
  hitCount: number;
  hits: readonly MultiModalScreeningHit[];
  /** Highest single score across all candidates (including sub-threshold). */
  topScore: number;
  /** Classification of the top hit (if any). */
  topClassification: MultiModalClassification;
  /** ISO timestamp of the screening run. */
  ranAt: string;
}

/**
 * Run the multi-modal matcher against a candidate list and return a
 * structured result suitable for `runScreeningMegaBrain` composition.
 *
 * Hits are sorted by score descending. The response also exposes the
 * top score across ALL candidates (even those below threshold) so
 * downstream consumers (the Dempster-Shafer aggregator, #119) can see
 * how close a "no hit" actually was.
 */
export function runMultiModalNameMatcher(
  req: MultiModalScreeningRequest,
): MultiModalScreeningResponse {
  const threshold = req.threshold ?? 0.7;
  const maxHits = req.maxHits ?? 20;

  const allScored: MultiModalScreeningHit[] = [];
  let topScore = 0;
  for (const c of req.candidates) {
    const breakdown = multiModalMatch(req.query, c, req.weights);
    if (breakdown.score > topScore) topScore = breakdown.score;
    if (breakdown.score >= threshold) {
      allScored.push({ candidate: c, breakdown });
    }
  }
  allScored.sort((a, b) => b.breakdown.score - a.breakdown.score);
  const hits = allScored.slice(0, maxHits);

  return {
    query: req.query,
    threshold,
    totalCandidates: req.candidates.length,
    hitCount: hits.length,
    hits,
    topScore,
    topClassification: classify(topScore),
    ranAt: new Date().toISOString(),
  };
}
