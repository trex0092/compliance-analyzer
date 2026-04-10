/**
 * Sanctions List Differential Updater.
 *
 * Pulling full sanctions lists on every refresh is wasteful and slow.
 * This module computes the minimal diff between a previous snapshot
 * and a new snapshot, categorising every change as:
 *
 *   - added       (new listing)
 *   - removed     (delisted)
 *   - modified    (same id/name, changed alias/dob/program/etc.)
 *   - unchanged   (stable — not included in the delta payload)
 *
 * The delta is also stamped with a content hash so that downstream
 * consumers (the screening engine, autopilot, brain audit trail) can
 * prove WHICH snapshot they screened against.
 *
 * The module is transport-agnostic. Feed it whatever snapshots you
 * have — it doesn't care whether they came from OFAC XML, UN JSON,
 * EU CSV or EOCN feed. It just wants a normalised SanctionsEntry[].
 *
 * Regulatory basis:
 *   - FDL Art.22 (sanctions screening)
 *   - Cabinet Res 74/2020 Art.4-7 (freeze within 24h of listing)
 *   - FATF Rec 6 (targeted financial sanctions — TFS)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SanctionsEntry {
  id: string;
  name: string;
  aliases?: readonly string[];
  dateOfBirth?: string;
  nationality?: string;
  program?: string;
  source: 'UN' | 'OFAC' | 'EU' | 'UK' | 'UAE' | 'EOCN';
  listedAtIso?: string;
}

export interface EntryDiff {
  id: string;
  before: SanctionsEntry;
  after: SanctionsEntry;
  changedFields: string[];
}

export interface SanctionsDelta {
  fromSnapshotHash: string;
  toSnapshotHash: string;
  computedAtIso: string;
  added: SanctionsEntry[];
  removed: SanctionsEntry[];
  modified: EntryDiff[];
  unchangedCount: number;
  summary: {
    totalBefore: number;
    totalAfter: number;
    totalChanged: number;
    byProgram: Record<string, { added: number; removed: number; modified: number }>;
  };
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalJson((obj as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashSnapshot(entries: readonly SanctionsEntry[]): Promise<string> {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  return sha256Hex(canonicalJson(sorted));
}

// ---------------------------------------------------------------------------
// Diff engine
// ---------------------------------------------------------------------------

function normalisedAliases(e: SanctionsEntry): string[] {
  return [...(e.aliases ?? [])].map((a) => a.toLowerCase().trim()).sort();
}

function diffEntry(before: SanctionsEntry, after: SanctionsEntry): string[] {
  const changed: string[] = [];
  if (before.name !== after.name) changed.push('name');
  if (before.dateOfBirth !== after.dateOfBirth) changed.push('dateOfBirth');
  if (before.nationality !== after.nationality) changed.push('nationality');
  if (before.program !== after.program) changed.push('program');
  if (before.source !== after.source) changed.push('source');
  if (before.listedAtIso !== after.listedAtIso) changed.push('listedAtIso');
  const ba = normalisedAliases(before);
  const aa = normalisedAliases(after);
  if (ba.length !== aa.length || ba.some((v, i) => v !== aa[i])) changed.push('aliases');
  return changed;
}

export async function computeDelta(
  before: readonly SanctionsEntry[],
  after: readonly SanctionsEntry[]
): Promise<SanctionsDelta> {
  const beforeMap = new Map<string, SanctionsEntry>();
  const afterMap = new Map<string, SanctionsEntry>();
  for (const e of before) beforeMap.set(e.id, e);
  for (const e of after) afterMap.set(e.id, e);

  const added: SanctionsEntry[] = [];
  const removed: SanctionsEntry[] = [];
  const modified: EntryDiff[] = [];
  let unchanged = 0;

  const byProgram: Record<string, { added: number; removed: number; modified: number }> = {};
  const bump = (program: string | undefined, field: 'added' | 'removed' | 'modified') => {
    const key = program ?? 'unspecified';
    byProgram[key] ??= { added: 0, removed: 0, modified: 0 };
    byProgram[key][field] += 1;
  };

  for (const [id, entry] of afterMap.entries()) {
    const prior = beforeMap.get(id);
    if (!prior) {
      added.push(entry);
      bump(entry.program, 'added');
      continue;
    }
    const changedFields = diffEntry(prior, entry);
    if (changedFields.length === 0) {
      unchanged++;
    } else {
      modified.push({ id, before: prior, after: entry, changedFields });
      bump(entry.program, 'modified');
    }
  }
  for (const [id, entry] of beforeMap.entries()) {
    if (!afterMap.has(id)) {
      removed.push(entry);
      bump(entry.program, 'removed');
    }
  }

  const [fromHash, toHash] = await Promise.all([hashSnapshot(before), hashSnapshot(after)]);

  return {
    fromSnapshotHash: fromHash,
    toSnapshotHash: toHash,
    computedAtIso: new Date().toISOString(),
    added,
    removed,
    modified,
    unchangedCount: unchanged,
    summary: {
      totalBefore: before.length,
      totalAfter: after.length,
      totalChanged: added.length + removed.length + modified.length,
      byProgram,
    },
  };
}

// ---------------------------------------------------------------------------
// Apply a delta back onto a baseline
// ---------------------------------------------------------------------------

export function applyDelta(
  baseline: readonly SanctionsEntry[],
  delta: SanctionsDelta
): SanctionsEntry[] {
  const map = new Map<string, SanctionsEntry>();
  for (const e of baseline) map.set(e.id, e);
  for (const e of delta.removed) map.delete(e.id);
  for (const diff of delta.modified) map.set(diff.id, diff.after);
  for (const e of delta.added) map.set(e.id, e);
  return [...map.values()];
}
