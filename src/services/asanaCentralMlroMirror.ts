/**
 * Asana Central MLRO Mirror — fan blocked/freeze/escalate cases
 * across every customer project into a single MLRO triage queue.
 *
 * Background: customer compliance projects in Asana are scoped to
 * one entity at a time. When the brain dispatcher flags a case as
 * blocked / freeze / escalate, the task lives inside the customer's
 * own project — easy to miss when you're a solo MLRO juggling
 * 6+ customers. The MLRO needs ONE place to see "everything I owe
 * action on, across all customers, right now".
 *
 * This module mirrors any dispatch that lands in the blocked column
 * (or carries a freeze/escalate verdict) into a dedicated central
 * project pointed to by ASANA_CENTRAL_MLRO_PROJECT_GID. Each
 * mirrored task carries a deep link back to the source customer
 * project so the MLRO can jump from triage view → customer context
 * in one click.
 *
 * Failure mode contract (matches asanaAuditLogMirror.ts):
 *   - Every function degrades to a no-op when
 *     ASANA_CENTRAL_MLRO_PROJECT_GID is unset OR Asana isn't
 *     configured. Never throws. Best-effort mirror, not a blocking
 *     dependency for dispatch.
 *   - Idempotent via a parallel localStorage key — re-runs never
 *     double-post.
 *   - Only mirrors entries that actually need MLRO triage (filter
 *     applied at the entry point, never the dispatcher).
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO duty of care — single visible
 *     queue across all customers)
 *   - Cabinet Res 134/2025 Art.5 (risk appetite — blocked cases
 *     must surface for senior management review)
 *   - Cabinet Res 134/2025 Art.19 (internal review — work in
 *     progress must be inspectable in one place)
 *   - Cabinet Res 74/2020 Art.4-7 (asset freeze — 24h MLRO action
 *     window starts from triage queue arrival)
 */

import { isAsanaConfigured, createAsanaTask, type AsanaTaskPayload } from './asanaClient';
import { buildComplianceCustomFields } from './asanaCustomFields';
import type { DispatchAuditEntry } from './dispatchAuditLog';

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

/** The Asana project GID that aggregates blocked tasks across all customers. */
export function getCentralMlroProjectGid(): string | undefined {
  return env('ASANA_CENTRAL_MLRO_PROJECT_GID');
}

/** True when the central mirror is fully configured and safe to invoke. */
export function isCentralMlroMirrorConfigured(): boolean {
  return isAsanaConfigured() && Boolean(getCentralMlroProjectGid());
}

// ---------------------------------------------------------------------------
// Filter — which dispatches deserve a triage entry?
// ---------------------------------------------------------------------------

/**
 * Returns true when the dispatch entry needs MLRO triage attention.
 * Three triggers, any of which qualifies:
 *
 *   1. Verdict is `freeze` — Cabinet Res 74/2020 Art.4-7 24h action.
 *   2. Verdict is `escalate` — FDL Art.20-21 CO escalation duty.
 *   3. Suggested Kanban column is `blocked` — operational stop.
 *
 * Pure function — no side effects, fully testable.
 */
export function needsMlroTriage(entry: DispatchAuditEntry): boolean {
  if (entry.verdict === 'freeze' || entry.verdict === 'escalate') return true;
  if (entry.suggestedColumn === 'blocked') return true;
  return false;
}

// ---------------------------------------------------------------------------
// Pure builder — testable in isolation
// ---------------------------------------------------------------------------

const ASANA_TASK_BASE_URL = 'https://app.asana.com/0';

function buildSourceProjectLink(parentGid?: string): string {
  if (!parentGid) return '(no parent task gid recorded)';
  return `${ASANA_TASK_BASE_URL}/0/${parentGid}/f`;
}

function buildTriageTaskName(entry: DispatchAuditEntry): string {
  const safeCase = entry.caseId.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64);
  // Verdict prefix lets the MLRO sort the triage queue by urgency
  // at a glance: [FREEZE] > [ESCALATE] > [BLOCKED].
  const prefix =
    entry.verdict === 'freeze'
      ? '[FREEZE]'
      : entry.verdict === 'escalate'
        ? '[ESCALATE]'
        : '[BLOCKED]';
  return `${prefix} ${safeCase} — ${entry.suggestedColumn}`;
}

function buildTriageTaskNotes(entry: DispatchAuditEntry): string {
  const sourceLink = buildSourceProjectLink(entry.parentGid);
  const errorBlock =
    entry.errors.length > 0
      ? `\nDispatch errors:\n${entry.errors.map((e) => `  - ${e}`).join('\n')}`
      : '';
  const warningBlock =
    entry.warnings.length > 0
      ? `\nDispatch warnings:\n${entry.warnings.map((w) => `  - ${w}`).join('\n')}`
      : '';

  // The action header changes by verdict so the MLRO knows the
  // regulatory clock that just started.
  const actionHeader =
    entry.verdict === 'freeze'
      ? '⚠ FREEZE — 24h MLRO action window starts NOW (Cabinet Res 74/2020 Art.4-7)'
      : entry.verdict === 'escalate'
        ? '⚠ ESCALATE — CO duty of care (FDL No.10/2025 Art.20-21)'
        : '⚠ BLOCKED — operational stop, MLRO review required';

  return [
    actionHeader,
    ``,
    `Case ID:           ${entry.caseId}`,
    `Verdict:           ${entry.verdict}`,
    `Confidence:        ${(entry.confidence * 100).toFixed(1)}%`,
    `Suggested column:  ${entry.suggestedColumn}`,
    `Trigger:           ${entry.trigger}`,
    `Dispatched at:     ${entry.dispatchedAtIso}`,
    ``,
    `Source task in customer project:`,
    `  ${sourceLink}`,
    ``,
    `Side effects on the source task:`,
    `  STR subtasks created:    ${entry.strSubtaskCount}`,
    `  Four-eyes subtasks:      ${entry.fourEyesCount}`,
    `  Annotations applied:     ${entry.annotatedCount}`,
    `  Kanban move ok:          ${entry.kanbanMoveOk ?? '(n/a)'}`,
    errorBlock,
    warningBlock,
    ``,
    `Audit-log entry id: ${entry.id}`,
  ].join('\n');
}

export interface BuildCentralMlroTaskInput {
  entry: DispatchAuditEntry;
  projectGid: string;
}

/**
 * Pure builder — converts a DispatchAuditEntry into an Asana task
 * payload for the central MLRO triage project. Reads custom-field
 * GIDs from env via buildComplianceCustomFields. Safe to call
 * without Asana configured — the returned payload is just data.
 */
export function buildCentralMlroTaskPayload(input: BuildCentralMlroTaskInput): AsanaTaskPayload {
  const { entry, projectGid } = input;
  return {
    name: buildTriageTaskName(entry),
    notes: buildTriageTaskNotes(entry),
    projects: [projectGid],
    custom_fields: buildComplianceCustomFields({
      verdict: entry.verdict,
      caseId: entry.caseId,
      confidence: entry.confidence,
      // Freeze cases get the EOCN deadline tag so the existing
      // deadline-rollup view picks them up alongside other 24h
      // clocks.
      deadlineType: entry.verdict === 'freeze' ? 'EOCN' : undefined,
      // Tier-4 #13 — freeze cases need MLRO manual action in the
      // bank portal (no banking API). The red chip surfaces this
      // on the task card for visual triage.
      manualActionRequired: entry.verdict === 'freeze' ? 'pending' : undefined,
      regulationCitation:
        entry.verdict === 'freeze' ? 'Cabinet Res 74/2020 Art.4-7' : 'FDL No.10/2025 Art.20-21',
    }),
    tags: [
      'central-mlro-triage',
      `verdict:${entry.verdict}`,
      `column:${entry.suggestedColumn}`,
      `trigger:${entry.trigger}`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Mirrored-id tracking (idempotency)
// ---------------------------------------------------------------------------

const MIRRORED_KEY = 'fgl_central_mlro_mirrored_ids';
const MAX_MIRRORED_IDS = 1000;

function readMirroredIds(): Set<string> {
  try {
    if (typeof localStorage === 'undefined') return new Set();
    const raw = localStorage.getItem(MIRRORED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((s): s is string => typeof s === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

function writeMirroredIds(ids: Set<string>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const trimmed = Array.from(ids).slice(-MAX_MIRRORED_IDS);
    localStorage.setItem(MIRRORED_KEY, JSON.stringify(trimmed));
  } catch {
    /* storage quota — degrade silently */
  }
}

/** Test seam: clear the mirrored-id tracker. */
export function __resetCentralMlroMirrorState(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(MIRRORED_KEY);
    }
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Async dispatcher
// ---------------------------------------------------------------------------

export interface MirrorToCentralResult {
  ok: boolean;
  /** True when the entry doesn't qualify for triage — no side effects. */
  skipped?: boolean;
  /** True when the entry was already mirrored — no side effects. */
  alreadyMirrored?: boolean;
  /** True when the central project / asana token is unset — no-op. */
  unconfigured?: boolean;
  taskGid?: string;
  error?: string;
}

/**
 * Mirror a single dispatch audit entry into the central MLRO project
 * IF AND ONLY IF the entry qualifies for triage (freeze / escalate /
 * blocked column). Idempotent — re-runs the same entry id are no-ops.
 *
 * Designed to be called from the post-dispatch hook in
 * autoDispatchListener as fire-and-forget (`void mirrorDispatch...`).
 * Errors are returned in the result object, never thrown.
 */
export async function mirrorDispatchToCentralMlro(
  entry: DispatchAuditEntry
): Promise<MirrorToCentralResult> {
  if (!needsMlroTriage(entry)) {
    return { ok: true, skipped: true };
  }

  const projectGid = getCentralMlroProjectGid();
  if (!projectGid || !isAsanaConfigured()) {
    return { ok: true, unconfigured: true };
  }

  const mirrored = readMirroredIds();
  if (mirrored.has(entry.id)) {
    return { ok: true, alreadyMirrored: true };
  }

  const payload = buildCentralMlroTaskPayload({ entry, projectGid });
  const result = await createAsanaTask(payload);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  mirrored.add(entry.id);
  writeMirroredIds(mirrored);
  return { ok: true, taskGid: result.gid };
}
