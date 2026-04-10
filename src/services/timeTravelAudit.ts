/**
 * Time-Travel Audit — reconstruct historical state from the evidence chain.
 *
 * "What did we know about this customer on 2026-01-15?" is one of the
 * most common regulator questions, and the only honest answer is to
 * replay the evidence chain up to that date.
 *
 * The evidence chain is already written by `scripts/evidence-chain.mjs`
 * as an append-only log with one entry per compliance action. This
 * module provides the READER side:
 *
 *   - replayUntil(entries, asOf) — fold all entries with at<=asOf into
 *     a state snapshot
 *   - diff(before, after) — show what changed between two snapshots
 *   - historyFor(entries, refId) — all entries touching a specific ref
 *   - criticalPath(entries, refId) — only the state-changing entries
 *
 * Pure reducers — no I/O. The caller supplies the entries (loaded from
 * wherever the chain lives).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One entry in the evidence chain. */
export interface EvidenceEntry {
  /** ISO timestamp. */
  at: string;
  /** The action taken (e.g. "cra_saved", "str_filed", "sanctions_confirmed"). */
  action: string;
  /** Who took the action (MLRO, CO, system). */
  actor: string;
  /** The subject/case the action concerns. */
  subject: string;
  /** Human-readable detail. */
  detail: string;
  /** Structured data payload. */
  data?: Record<string, unknown>;
  /** Optional prior-entry hash for tamper evidence. */
  prevHash?: string;
}

/** A point-in-time snapshot of a case. */
export interface CaseSnapshot {
  refId: string;
  /** The date this snapshot is valid as-of. */
  asOf: string;
  /** Current state fields (folded from all applicable entries). */
  state: Record<string, unknown>;
  /** Entry ids that contributed to this snapshot. */
  contributingEntries: number;
  /** Actions in chronological order. */
  actions: string[];
  /** The latest actor. */
  lastActor: string | null;
  /** The latest update. */
  lastUpdatedAt: string | null;
}

export interface SnapshotDiff {
  added: Record<string, unknown>;
  removed: Record<string, unknown>;
  changed: Array<{ field: string; before: unknown; after: unknown }>;
}

// ---------------------------------------------------------------------------
// Replay — fold entries into a snapshot
// ---------------------------------------------------------------------------

/**
 * Replay entries for a specific ref id up to `asOf` and produce a
 * snapshot. Entries with `at > asOf` are excluded.
 *
 * The fold rule: each entry's `data` object is merged into the state.
 * Later writes overwrite earlier ones. Entries without `data` still
 * contribute to the action log but don't change state.
 */
export function replayUntil(
  entries: readonly EvidenceEntry[],
  refId: string,
  asOf: string
): CaseSnapshot {
  const relevant = entries.filter((e) => e.subject === refId && e.at <= asOf);
  // Sort ascending by timestamp
  relevant.sort((a, b) => a.at.localeCompare(b.at));

  const state: Record<string, unknown> = {};
  const actions: string[] = [];
  let lastActor: string | null = null;
  let lastUpdatedAt: string | null = null;

  for (const entry of relevant) {
    actions.push(entry.action);
    lastActor = entry.actor;
    lastUpdatedAt = entry.at;
    if (entry.data) {
      for (const [key, value] of Object.entries(entry.data)) {
        state[key] = value;
      }
    }
  }

  return {
    refId,
    asOf,
    state,
    contributingEntries: relevant.length,
    actions,
    lastActor,
    lastUpdatedAt,
  };
}

/** Replay up to "now" — convenience for the current state. */
export function currentState(entries: readonly EvidenceEntry[], refId: string): CaseSnapshot {
  return replayUntil(entries, refId, new Date().toISOString());
}

// ---------------------------------------------------------------------------
// Diff — what changed between two snapshots
// ---------------------------------------------------------------------------

export function diffSnapshots(before: CaseSnapshot, after: CaseSnapshot): SnapshotDiff {
  const diff: SnapshotDiff = { added: {}, removed: {}, changed: [] };
  const allKeys = new Set([...Object.keys(before.state), ...Object.keys(after.state)]);
  for (const key of allKeys) {
    const inBefore = key in before.state;
    const inAfter = key in after.state;
    if (!inBefore && inAfter) {
      diff.added[key] = after.state[key];
    } else if (inBefore && !inAfter) {
      diff.removed[key] = before.state[key];
    } else if (inBefore && inAfter) {
      const b = before.state[key];
      const a = after.state[key];
      if (JSON.stringify(b) !== JSON.stringify(a)) {
        diff.changed.push({ field: key, before: b, after: a });
      }
    }
  }
  return diff;
}

// ---------------------------------------------------------------------------
// History — the full timeline
// ---------------------------------------------------------------------------

/**
 * Return every entry for a ref id in chronological order. Pure filter
 * — no folding. Used for the "audit log" view in the UI.
 */
export function historyFor(entries: readonly EvidenceEntry[], refId: string): EvidenceEntry[] {
  return entries.filter((e) => e.subject === refId).sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * The critical path — only entries that changed the state. Entries
 * without a `data` payload are filtered out.
 */
export function criticalPath(entries: readonly EvidenceEntry[], refId: string): EvidenceEntry[] {
  return historyFor(entries, refId).filter((e) => e.data && Object.keys(e.data).length > 0);
}

// ---------------------------------------------------------------------------
// Audit report — human-readable markdown
// ---------------------------------------------------------------------------

export function formatAuditReport(
  entries: readonly EvidenceEntry[],
  refId: string,
  asOf: string
): string {
  const snapshot = replayUntil(entries, refId, asOf);
  const history = historyFor(entries, refId).filter((e) => e.at <= asOf);

  const lines: string[] = [];
  lines.push(`# Time-Travel Audit Report — ${refId}`);
  lines.push('');
  lines.push(`**As of:** ${asOf}  `);
  lines.push(`**Actions:** ${history.length}  `);
  lines.push(`**Last updated:** ${snapshot.lastUpdatedAt ?? '—'}  `);
  lines.push(`**Last actor:** ${snapshot.lastActor ?? '—'}`);
  lines.push('');
  lines.push('## State at this point');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(snapshot.state, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Timeline');
  lines.push('');
  for (const entry of history) {
    lines.push(`- **${entry.at}** — \`${entry.action}\` by ${entry.actor}: ${entry.detail}`);
  }
  lines.push('');
  lines.push(
    '_This report is a deterministic reconstruction of the evidence chain for the requested date. Every state field maps to an entry in the timeline above._'
  );
  return lines.join('\n');
}
