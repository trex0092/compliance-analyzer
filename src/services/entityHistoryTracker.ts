/**
 * Entity History Tracker — subsystem #64 (Phase 7 Cluster G).
 *
 * Full timeline of every change to an entity's attributes (UBO,
 * address, phone, sanctions status, risk tier) with computed diffs.
 * Audit trail meets time-travel. Enables "what did this entity look
 * like on 15/03/2026?" queries for regulatory inspection and
 * precedent research.
 *
 * Pure in-memory, no storage — the caller persists history events
 * wherever they want. The tracker produces diffs and rewinds.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (5-year retention)
 *   - Cabinet Decision 109/2023 (UBO re-verification timeline)
 *   - FATF Rec 11 (record-keeping integrity)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EntitySnapshot {
  entityId: string;
  at: string;
  /** Arbitrary attributes. Common keys: name, address, phone, risk, tier, sanctionsFlag. */
  attributes: Readonly<Record<string, unknown>>;
  /** Who made the change. */
  updatedBy: string;
}

export interface AttributeDiff {
  attribute: string;
  from: unknown;
  to: unknown;
}

export interface HistoryEntry {
  at: string;
  updatedBy: string;
  diffs: AttributeDiff[];
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

function diffAttributes(
  prev: Record<string, unknown>,
  next: Record<string, unknown>
): AttributeDiff[] {
  const diffs: AttributeDiff[] = [];
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    const a = prev[key];
    const b = next[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      diffs.push({ attribute: key, from: a, to: b });
    }
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the history timeline from a list of snapshots. Each entry
 * describes the diff from the previous snapshot.
 */
export function buildHistory(
  snapshots: readonly EntitySnapshot[]
): HistoryEntry[] {
  if (snapshots.length === 0) return [];
  const sorted = [...snapshots].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const entries: HistoryEntry[] = [];

  // First entry: full state as "from nothing to initial"
  entries.push({
    at: sorted[0].at,
    updatedBy: sorted[0].updatedBy,
    diffs: Object.entries(sorted[0].attributes).map(([attribute, to]) => ({
      attribute,
      from: undefined,
      to,
    })),
  });

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const diffs = diffAttributes(
      prev.attributes as Record<string, unknown>,
      curr.attributes as Record<string, unknown>
    );
    if (diffs.length > 0) {
      entries.push({ at: curr.at, updatedBy: curr.updatedBy, diffs });
    }
  }

  return entries;
}

/**
 * Rewind the entity to the state it had at a specific point in time.
 * Returns the attributes as-of that timestamp. Snapshots AFTER the
 * query time are ignored.
 */
export function rewindToInstant(
  snapshots: readonly EntitySnapshot[],
  atIso: string
): Readonly<Record<string, unknown>> | null {
  const target = Date.parse(atIso);
  if (!Number.isFinite(target)) return null;
  const applicable = snapshots
    .filter((s) => Date.parse(s.at) <= target)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (applicable.length === 0) return null;
  return applicable[applicable.length - 1].attributes;
}

/**
 * Find all snapshots where a specific attribute changed.
 */
export function findAttributeChanges(
  snapshots: readonly EntitySnapshot[],
  attribute: string
): HistoryEntry[] {
  return buildHistory(snapshots).filter((e) =>
    e.diffs.some((d) => d.attribute === attribute)
  );
}
