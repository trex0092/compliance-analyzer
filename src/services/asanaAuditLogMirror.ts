/**
 * Asana Audit Log Mirror — durable mirror of the dispatch audit log
 * into a dedicated Asana project for FDL Art.24 10-year retention.
 *
 * Background: dispatchAuditLog.ts is a 500-entry localStorage ring
 * buffer that rolls off the oldest entries silently. That's fine for
 * the Brain Console health tile, but it does NOT satisfy the 10-year
 * retention requirement on its own — once the ring fills up, history
 * is lost.
 *
 * This module mirrors every audit entry into the dedicated project
 * pointed to by ASANA_AUDIT_LOG_PROJECT_GID. Each entry becomes one
 * Asana task with:
 *   - Name:  audit-{caseId}-{verdict}-{shortDate}
 *   - Notes: full JSON of the entry (machine-readable for /audit-pack)
 *   - Custom fields: case_id + verdict + confidence + regulation
 *
 * Pure builder (`buildAuditMirrorTaskPayload`) plus async dispatcher
 * (`mirrorAuditEntry`) plus batch flusher (`flushAuditLogToAsana`)
 * that walks `readAuditLog`, mirrors entries not yet posted, and
 * tracks mirrored ids in a parallel localStorage key so retries are
 * idempotent.
 *
 * Failure mode contract: every function degrades to a no-op when
 * ASANA_AUDIT_LOG_PROJECT_GID is unset OR Asana isn't configured.
 * Never throws. The mirror is best-effort durable backup, not a
 * blocking dependency for dispatch.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (10-year retention of compliance actions)
 *   - FDL No.10/2025 Art.20-21 (CO duty of care — every action audited)
 *   - Cabinet Res 134/2025 Art.19 (auditable internal review)
 *   - NIST AI RMF 1.0 MEASURE-2 (AI decision provenance)
 */

import { isAsanaConfigured, createAsanaTask, type AsanaTaskPayload } from './asanaClient';
import { buildComplianceCustomFields } from './asanaCustomFields';
import { readAuditLog, type DispatchAuditEntry } from './dispatchAuditLog';

// ---------------------------------------------------------------------------
// Env lookup — safe on both server and browser
// ---------------------------------------------------------------------------

function env(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env?.[key]) return process.env[key];
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as Record<string, unknown>;
    const val = g[key];
    if (typeof val === 'string') return val;
  }
  return undefined;
}

/** The Asana project GID that receives mirrored audit entries. */
export function getAuditMirrorProjectGid(): string | undefined {
  return env('ASANA_AUDIT_LOG_PROJECT_GID');
}

/** True when the mirror is fully configured and safe to invoke. */
export function isAuditMirrorConfigured(): boolean {
  return isAsanaConfigured() && Boolean(getAuditMirrorProjectGid());
}

// ---------------------------------------------------------------------------
// Pure builder — testable in isolation
// ---------------------------------------------------------------------------

/**
 * Truncate a verdict + caseId combination into an Asana-safe task
 * name. Asana caps task names at 1024 chars; we cap much shorter to
 * keep the audit project legible.
 */
function buildMirrorTaskName(entry: DispatchAuditEntry): string {
  const shortDate = entry.dispatchedAtIso.slice(0, 10);
  const safeCase = entry.caseId.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64);
  return `audit-${safeCase}-${entry.verdict}-${shortDate}`;
}

/**
 * Format the audit entry as Markdown for the Asana task notes.
 * Designed to be human-skimmable AND machine-parseable: the JSON
 * blob at the end is the source of truth for /audit-pack exports.
 */
function buildMirrorTaskNotes(entry: DispatchAuditEntry): string {
  const errorBlock =
    entry.errors.length > 0
      ? `\nErrors:\n${entry.errors.map((e) => `  - ${e}`).join('\n')}`
      : '';
  const warningBlock =
    entry.warnings.length > 0
      ? `\nWarnings:\n${entry.warnings.map((w) => `  - ${w}`).join('\n')}`
      : '';
  return [
    `Dispatch audit entry — FDL No.10/2025 Art.24`,
    ``,
    `Case ID:           ${entry.caseId}`,
    `Verdict:           ${entry.verdict}`,
    `Confidence:        ${(entry.confidence * 100).toFixed(1)}%`,
    `Suggested column:  ${entry.suggestedColumn}`,
    `Trigger:           ${entry.trigger}`,
    `Dispatched at:     ${entry.dispatchedAtIso}`,
    `Dispatcher ver:    ${entry.dispatcherVersion}`,
    `Parent task:       ${entry.parentGid ?? '(none)'}`,
    `STR subtasks:      ${entry.strSubtaskCount}`,
    `Four-eyes count:   ${entry.fourEyesCount}`,
    `Annotated count:   ${entry.annotatedCount}`,
    `Kanban move ok:    ${entry.kanbanMoveOk ?? '(n/a)'}`,
    errorBlock,
    warningBlock,
    ``,
    `--- Machine-readable payload (JSON) ---`,
    JSON.stringify(entry, null, 2),
  ].join('\n');
}

export interface BuildAuditMirrorTaskInput {
  entry: DispatchAuditEntry;
  projectGid: string;
}

/**
 * Pure builder — converts a DispatchAuditEntry into an Asana task
 * payload. Reads custom-field GIDs from env via
 * `buildComplianceCustomFields`. Safe to call without Asana
 * configured — the returned payload is just data.
 */
export function buildAuditMirrorTaskPayload(
  input: BuildAuditMirrorTaskInput
): AsanaTaskPayload {
  const { entry, projectGid } = input;
  return {
    name: buildMirrorTaskName(entry),
    notes: buildMirrorTaskNotes(entry),
    projects: [projectGid],
    custom_fields: buildComplianceCustomFields({
      verdict: entry.verdict,
      caseId: entry.caseId,
      confidence: entry.confidence,
      regulationCitation: 'FDL No.10/2025 Art.24',
    }),
    tags: ['audit-log-mirror', `verdict:${entry.verdict}`, `trigger:${entry.trigger}`],
  };
}

// ---------------------------------------------------------------------------
// Mirrored-id tracking (idempotency)
// ---------------------------------------------------------------------------

const MIRRORED_KEY = 'fgl_dispatch_audit_mirrored_ids';
const MAX_MIRRORED_IDS = 1000;

function readMirroredIds(): Set<string> {
  try {
    if (typeof localStorage === 'undefined') return new Set();
    const raw = localStorage.getItem(MIRRORED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((s): s is string => typeof s === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function writeMirroredIds(ids: Set<string>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    // Cap at MAX_MIRRORED_IDS (most recent first) to bound storage.
    const trimmed = Array.from(ids).slice(-MAX_MIRRORED_IDS);
    localStorage.setItem(MIRRORED_KEY, JSON.stringify(trimmed));
  } catch {
    /* storage quota — degrade silently */
  }
}

/** Test seam: clear the mirrored-id tracker. */
export function __resetAuditMirrorState(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(MIRRORED_KEY);
    }
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Async dispatchers
// ---------------------------------------------------------------------------

export interface MirrorAuditEntryResult {
  ok: boolean;
  /** True when the mirror was a no-op because the entry is already mirrored. */
  alreadyMirrored?: boolean;
  /** True when the mirror is unconfigured (best-effort no-op). */
  unconfigured?: boolean;
  taskGid?: string;
  error?: string;
}

/**
 * Mirror a single audit entry to Asana. Idempotent — if the entry
 * id is already in the mirrored-id set, returns alreadyMirrored=true
 * without calling Asana.
 */
export async function mirrorAuditEntry(
  entry: DispatchAuditEntry
): Promise<MirrorAuditEntryResult> {
  const projectGid = getAuditMirrorProjectGid();
  if (!projectGid || !isAsanaConfigured()) {
    return { ok: true, unconfigured: true };
  }

  const mirrored = readMirroredIds();
  if (mirrored.has(entry.id)) {
    return { ok: true, alreadyMirrored: true };
  }

  const payload = buildAuditMirrorTaskPayload({ entry, projectGid });
  const result = await createAsanaTask(payload);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  mirrored.add(entry.id);
  writeMirroredIds(mirrored);
  return { ok: true, taskGid: result.gid };
}

export interface FlushAuditLogResult {
  ok: boolean;
  /** Total entries inspected from the local audit log. */
  inspected: number;
  /** Entries already mirrored before this flush. */
  alreadyMirrored: number;
  /** Entries successfully mirrored in this flush. */
  mirroredNow: number;
  /** Per-entry errors, capped to the first 10 to keep the result small. */
  errors: readonly string[];
  /** True when the mirror is unconfigured — flush was a no-op. */
  unconfigured?: boolean;
}

export interface FlushAuditLogOptions {
  /** Optional ISO timestamp — only mirror entries newer than this. */
  since?: string;
  /** Maximum number of entries to mirror in this flush call. Default 50. */
  limit?: number;
}

/**
 * Walk the local audit log and mirror any entries not yet posted to
 * Asana. Designed to run from the post-dispatch hook in
 * autoDispatchListener (after every successful dispatch) or on a
 * manual "flush audit" button. Bounded by `limit` so a single flush
 * can never blow Asana's rate limit when the local log has hundreds
 * of unmirrored entries (e.g. after a long offline period).
 */
export async function flushAuditLogToAsana(
  options: FlushAuditLogOptions = {}
): Promise<FlushAuditLogResult> {
  const limit = options.limit ?? 50;
  const projectGid = getAuditMirrorProjectGid();
  if (!projectGid || !isAsanaConfigured()) {
    return {
      ok: true,
      inspected: 0,
      alreadyMirrored: 0,
      mirroredNow: 0,
      errors: [],
      unconfigured: true,
    };
  }

  const entries = readAuditLog({ since: options.since });
  const mirrored = readMirroredIds();
  const errors: string[] = [];
  let mirroredNow = 0;
  let alreadyMirrored = 0;

  // Walk newest → oldest (readAuditLog already returns that order).
  // Mirror the freshest unmirrored entries first so the audit project
  // shows the most recent activity even when the flush is partial.
  for (const entry of entries) {
    if (mirrored.has(entry.id)) {
      alreadyMirrored++;
      continue;
    }
    if (mirroredNow >= limit) break;
    const payload = buildAuditMirrorTaskPayload({ entry, projectGid });
    const result = await createAsanaTask(payload);
    if (!result.ok) {
      if (errors.length < 10) {
        errors.push(`${entry.id}: ${result.error ?? 'unknown error'}`);
      }
      continue;
    }
    mirrored.add(entry.id);
    mirroredNow++;
  }

  if (mirroredNow > 0) {
    writeMirroredIds(mirrored);
  }

  return {
    ok: errors.length === 0,
    inspected: entries.length,
    alreadyMirrored,
    mirroredNow,
    errors,
  };
}
