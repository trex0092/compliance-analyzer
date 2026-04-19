/**
 * Multi-List Cross-Corroboration — derives the set of sanctions lists
 * that have flagged a subject within the active dedup window.
 *
 * When the same subject lands on UN + OFAC + EU + UK OFSI simultaneously,
 * that is orders of magnitude stronger evidence than any single-list
 * hit. World-Check and similar commercial screening tools surface this
 * as "consolidated-list corroboration" — we do the same, read from our
 * own dedup fingerprint cache, so there is no extra I/O on the
 * dispatcher hot path.
 *
 * Fingerprint format (from immediateRiskAlerts.ts):
 *   subjectId | LIST | reference | changeType | YYYY-MM-DD
 *
 * We split on "|" and count distinct LIST values per subjectId.
 *
 * Regulatory basis:
 *   FATF Rec 6               TFS screening across all designations
 *   FDL No.10/2025 Art.35    freeze applies to THE subject — a
 *                            consolidated view of the subject's
 *                            designations is what enables the freeze
 *   EOCN TFS Guidance 2025   multi-list coverage obligation
 */

export interface SubjectCorroboration {
  /** Distinct sanctions lists observed for this subject today. */
  lists: readonly string[];
  /** Total Asana dispatches for this subject across all lists today. */
  dispatchCount: number;
  /**
   * Confidence booster in [0,1] — 0 for single-list, rising for
   * multiple-list corroboration. Used by riskAlertTemplate to surface
   * cross-corroboration in the reasoning block.
   */
  boost: number;
}

const LIST_PRIORITY = ['UN', 'OFAC_SDN', 'OFAC_CONSOLIDATED', 'EU', 'UK', 'UAE_EOCN'] as const;

/**
 * Parse the dedup fingerprint set and return a map from subjectId to
 * corroboration summary. Single-list subjects are included with
 * boost=0 so the caller can emit consistent reasoning lines.
 */
export function computeCorroboration(
  fingerprints: ReadonlySet<string>
): Map<string, SubjectCorroboration> {
  const bySubject = new Map<string, { lists: Set<string>; count: number }>();
  for (const fp of fingerprints) {
    const parts = fp.split('|');
    if (parts.length !== 5) continue;
    const [subjectId, list] = parts;
    if (!subjectId || !list) continue;
    const entry = bySubject.get(subjectId) ?? { lists: new Set<string>(), count: 0 };
    entry.lists.add(list);
    entry.count += 1;
    bySubject.set(subjectId, entry);
  }

  const out = new Map<string, SubjectCorroboration>();
  for (const [subjectId, { lists, count }] of bySubject) {
    const sorted = sortLists(Array.from(lists));
    out.set(subjectId, {
      lists: sorted,
      dispatchCount: count,
      boost: corroborationBoost(sorted.length),
    });
  }
  return out;
}

/**
 * Boost curve — a single list contributes 0, two lists contribute
 * 0.25, three 0.50, four 0.70, five+ 0.85. Diminishing returns
 * because the marginal evidence of the Nth overlapping designation
 * on the same person is smaller than the first overlap.
 */
function corroborationBoost(listCount: number): number {
  if (listCount <= 1) return 0;
  if (listCount === 2) return 0.25;
  if (listCount === 3) return 0.5;
  if (listCount === 4) return 0.7;
  return 0.85;
}

function sortLists(lists: readonly string[]): string[] {
  const priority = new Map<string, number>(LIST_PRIORITY.map((l, i) => [l as string, i]));
  return [...lists].sort((a, b) => {
    const ai = priority.get(a.toUpperCase()) ?? Number.MAX_SAFE_INTEGER;
    const bi = priority.get(b.toUpperCase()) ?? Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return a.localeCompare(b);
  });
}

/**
 * Lookup helper for the dispatcher — returns corroboration for a
 * single subject, or an empty record if not found. Cheap on every
 * call because the map was built once per dispatcher run.
 */
export function corroborationForSubject(
  map: ReadonlyMap<string, SubjectCorroboration>,
  subjectId: string
): SubjectCorroboration {
  return map.get(subjectId) ?? { lists: [], dispatchCount: 0, boost: 0 };
}
