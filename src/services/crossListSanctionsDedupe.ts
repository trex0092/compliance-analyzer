/**
 * Cross-List Sanctions Dedupe — subsystem #32.
 *
 * When a subject is screened against all six lists (UN, OFAC, EU, UK,
 * UAE, EOCN), the same underlying person can appear on 3-6 of them.
 * Today the screen produces one alert per list hit, which creates
 * analyst fatigue and makes the four-eyes queue noisy. This module
 * merges related hits into a single "strongest source" hit and keeps
 * the full source list as evidence.
 *
 * Dedupe key: normalised-name + birth-year (if known) + nationality.
 * When those all match, the hits are considered the same subject.
 *
 * Merging rule: the hit with the **stricter** list wins. Strictness
 * order (highest → lowest): UN > OFAC > EU > UK > UAE > EOCN local.
 * The other lists are preserved under `sources[]`.
 *
 * Regulatory basis:
 *   - FATF Rec 6 (UN sanctions primacy)
 *   - Cabinet Res 74/2020 Art.4-7 (freeze on any confirmed list)
 *   - FDL No.10/2025 Art.35 (TFS across all lists)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RawListHit {
  /** Sanctions list that produced this hit. */
  list: 'UN' | 'OFAC' | 'EU' | 'UK' | 'UAE' | 'EOCN';
  /** Name as it appears on the list. */
  matchedName: string;
  /** Confidence from the matcher (0..1). */
  matchScore: number;
  /** Optional birth year for natural persons. */
  birthYear?: number;
  /** Optional ISO country code for nationality-based dedupe. */
  nationality?: string;
  /** Whatever evidence the matcher kept (alias, listing date, reason). */
  rawEvidence?: string;
}

export interface DedupedHit {
  /** The strongest list that matched this subject. */
  primaryList: RawListHit['list'];
  /** The matched name from the primary list (canonical). */
  matchedName: string;
  /** Max match score across all sources. */
  maxScore: number;
  /** All lists that matched, sorted by strictness. */
  sources: readonly RawListHit[];
  /** Dedupe key used. */
  dedupeKey: string;
}

export interface DedupeReport {
  input: number;
  output: number;
  suppressed: number;
  hits: DedupedHit[];
  narrative: string;
}

// ---------------------------------------------------------------------------
// Dedupe
// ---------------------------------------------------------------------------

const LIST_STRICTNESS: Record<RawListHit['list'], number> = {
  UN: 6,
  OFAC: 5,
  EU: 4,
  UK: 3,
  UAE: 2,
  EOCN: 1,
};

export function dedupeCrossListHits(hits: readonly RawListHit[]): DedupeReport {
  const groups = new Map<string, RawListHit[]>();

  for (const hit of hits) {
    const key = buildDedupeKey(hit);
    const list = groups.get(key) ?? [];
    list.push(hit);
    groups.set(key, list);
  }

  const merged: DedupedHit[] = [];
  for (const [key, sourceHits] of groups) {
    // Sort by strictness desc; primary is the strictest source.
    const sorted = [...sourceHits].sort(
      (a, b) => LIST_STRICTNESS[b.list] - LIST_STRICTNESS[a.list]
    );
    const primary = sorted[0];
    const maxScore = Math.max(...sorted.map((s) => s.matchScore));
    merged.push({
      primaryList: primary.list,
      matchedName: primary.matchedName,
      maxScore,
      sources: sorted,
      dedupeKey: key,
    });
  }

  const suppressed = hits.length - merged.length;
  const narrative =
    `Cross-list sanctions dedupe: ${hits.length} raw hit(s) → ${merged.length} unique subject(s) ` +
    `(${suppressed} duplicate(s) suppressed). Strictness order UN > OFAC > EU > UK > UAE > EOCN.`;

  return {
    input: hits.length,
    output: merged.length,
    suppressed,
    hits: merged,
    narrative,
  };
}

function buildDedupeKey(hit: RawListHit): string {
  const name = hit.matchedName
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
  const yr = hit.birthYear ?? 'NA';
  const nat = hit.nationality ?? 'NA';
  return `${name}|${yr}|${nat}`;
}
