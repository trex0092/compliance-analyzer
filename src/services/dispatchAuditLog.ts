/**
 * Dispatch Audit Log — ring buffer for every super-brain dispatch.
 *
 * FDL No.10/2025 Art.24 mandates 10-year retention of every
 * compliance action. The super-brain dispatcher fires a chain of
 * Asana side effects — parent task, lifecycle, four-eyes, Kanban
 * move, annotation — and each of those has its own audit record
 * in Asana. This module adds a local, append-only audit log that
 * proves the dispatcher itself was invoked, what verdict it
 * produced, and which side effects succeeded.
 *
 * Pure append + query + purge semantics over a bounded
 * localStorage ring buffer (last 500 entries). Older entries roll
 * off; ops should export the log to cold storage before that
 * happens. An explicit `exportAuditLog()` is provided for the
 * /audit-pack skill.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (10-year retention)
 *   - Cabinet Res 134/2025 Art.19 (auditable internal review)
 *   - NIST AI RMF 1.0 MEASURE-2 (AI decision provenance)
 */

import type { Verdict } from './asanaCustomFields';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DispatchAuditEntry {
  id: string;
  dispatchedAtIso: string;
  caseId: string;
  verdict: Verdict;
  confidence: number;
  suggestedColumn: string;
  parentGid?: string;
  strSubtaskCount: number;
  fourEyesCount: number;
  kanbanMoveOk?: boolean;
  annotatedCount: number;
  errors: readonly string[];
  warnings: readonly string[];
  /** Who triggered the dispatch — manual / cron / webhook / listener. */
  trigger: 'manual' | 'cron' | 'webhook' | 'listener' | 'batch' | 'unknown';
  /** Which dispatcher version produced this entry. */
  dispatcherVersion: string;
}

const STORAGE_KEY = 'fgl_dispatch_audit_log';
const MAX_ENTRIES = 500;
const DISPATCHER_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function readBuffer(): DispatchAuditEntry[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DispatchAuditEntry[]) : [];
  } catch {
    return [];
  }
}

function writeBuffer(entries: readonly DispatchAuditEntry[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* storage quota — degrade silently */
  }
}

function mkEntryId(caseId: string, atIso: string): string {
  return `audit_${caseId}_${atIso}`;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export interface RecordDispatchInput {
  caseId: string;
  verdict: Verdict;
  confidence: number;
  suggestedColumn: string;
  parentGid?: string;
  strSubtaskCount?: number;
  fourEyesCount?: number;
  kanbanMoveOk?: boolean;
  annotatedCount?: number;
  errors?: readonly string[];
  warnings?: readonly string[];
  trigger?: DispatchAuditEntry['trigger'];
  /** Optional override for deterministic tests. */
  atIso?: string;
}

export function recordDispatch(input: RecordDispatchInput): DispatchAuditEntry {
  const atIso = input.atIso ?? new Date().toISOString();
  const entry: DispatchAuditEntry = {
    id: mkEntryId(input.caseId, atIso),
    dispatchedAtIso: atIso,
    caseId: input.caseId,
    verdict: input.verdict,
    confidence: input.confidence,
    suggestedColumn: input.suggestedColumn,
    parentGid: input.parentGid,
    strSubtaskCount: input.strSubtaskCount ?? 0,
    fourEyesCount: input.fourEyesCount ?? 0,
    kanbanMoveOk: input.kanbanMoveOk,
    annotatedCount: input.annotatedCount ?? 0,
    errors: input.errors ?? [],
    warnings: input.warnings ?? [],
    trigger: input.trigger ?? 'unknown',
    dispatcherVersion: DISPATCHER_VERSION,
  };

  const buffer = readBuffer();
  // Dedupe by id — replays of the same dispatchedAtIso + caseId
  // don't spam the log.
  const existing = buffer.findIndex((e) => e.id === entry.id);
  if (existing >= 0) {
    buffer[existing] = entry;
  } else {
    buffer.unshift(entry);
  }
  writeBuffer(buffer);
  return entry;
}

export function readAuditLog(filter?: {
  caseId?: string;
  verdict?: Verdict;
  since?: string;
  limit?: number;
}): DispatchAuditEntry[] {
  let entries = readBuffer();
  if (filter?.caseId) entries = entries.filter((e) => e.caseId === filter.caseId);
  if (filter?.verdict) entries = entries.filter((e) => e.verdict === filter.verdict);
  if (filter?.since) {
    const sinceMs = Date.parse(filter.since);
    if (Number.isFinite(sinceMs)) {
      entries = entries.filter((e) => Date.parse(e.dispatchedAtIso) >= sinceMs);
    }
  }
  if (filter?.limit && filter.limit > 0) {
    entries = entries.slice(0, filter.limit);
  }
  return entries;
}

export function clearAuditLog(): void {
  writeBuffer([]);
}

/** For the /audit-pack skill — returns a JSON blob of the whole log. */
export function exportAuditLog(): { exportedAtIso: string; entries: DispatchAuditEntry[] } {
  return {
    exportedAtIso: new Date().toISOString(),
    entries: readBuffer(),
  };
}

// ---------------------------------------------------------------------------
// Summary — for the Brain Console health tile
// ---------------------------------------------------------------------------

export interface DispatchLogSummary {
  total: number;
  byVerdict: Record<Verdict, number>;
  last24h: number;
  last7d: number;
  errorsLast24h: number;
}

export function summarizeAuditLog(nowIso?: string): DispatchLogSummary {
  const entries = readBuffer();
  const nowMs = new Date(nowIso ?? new Date().toISOString()).getTime();
  const dayMs = 86_400_000;
  const byVerdict: Record<Verdict, number> = { pass: 0, flag: 0, escalate: 0, freeze: 0 };
  let last24h = 0;
  let last7d = 0;
  let errorsLast24h = 0;
  for (const entry of entries) {
    byVerdict[entry.verdict] = (byVerdict[entry.verdict] ?? 0) + 1;
    const ageMs = nowMs - new Date(entry.dispatchedAtIso).getTime();
    if (ageMs <= dayMs) {
      last24h++;
      if (entry.errors.length > 0) errorsLast24h++;
    }
    if (ageMs <= 7 * dayMs) last7d++;
  }
  return {
    total: entries.length,
    byVerdict,
    last24h,
    last7d,
    errorsLast24h,
  };
}
