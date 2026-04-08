/**
 * Shared fuzzy matching utilities — single implementation used by
 * sanctionsApi.ts, crossEntityScreening.ts, and multiModelScreening.ts.
 *
 * Eliminates duplicate normalize() and similarity() functions.
 */

/** Minimum bigram similarity score to consider a name match */
export const FUZZY_MATCH_THRESHOLD = 0.75;

/** High-confidence match threshold for automated decisions */
export const HIGH_CONFIDENCE_THRESHOLD = 0.9;

/**
 * Normalize a name for comparison — lowercase, remove diacritics,
 * strip punctuation, collapse whitespace.
 */
export function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize an entity name with additional business suffix removal.
 * Use for company/entity matching where legal suffixes create noise.
 */
export function normalizeEntity(name: string): string {
  return normalize(name)
    .replace(
      /\b(llc|ltd|fze|fzc|fzco|inc|corp|plc|pvt|pty|gmbh|sarl|srl|ag|sa|bv|nv|anonim|sirketi|trading|jewellery|jewelry|precious|metals|gold)\b/g,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Bigram similarity (Dice coefficient) — fast fuzzy matching.
 * Returns 0–1 where 1 is identical.
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    if (bigramsA.has(b.slice(i, i + 2))) intersection++;
  }

  return (2 * intersection) / (a.length - 1 + b.length - 1);
}

/**
 * Safe JSON parse with fallback — avoids silent crashes from malformed data.
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
