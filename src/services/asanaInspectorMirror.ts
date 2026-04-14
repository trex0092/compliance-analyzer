/**
 * Asana Inspector Mirror — regulator-facing read-only audit trail.
 *
 * Tier-4 #14 from the Asana setup gap audit. When MoE / LBMA /
 * internal audit inspectors request access to compliance evidence,
 * we cannot expose them to the live customer projects (they would
 * see operational queues, MLRO drafting notes, four-eyes routing,
 * potentially sensitive PII attachments). The right pattern is a
 * dedicated read-only Asana project that mirrors only the entries
 * an inspector legitimately needs to see, with the operator
 * sharing the project link with view-only access.
 *
 * This module is the mirror layer. It listens to dispatch audit
 * entries, applies a "needsInspectorEvidence" filter, and posts a
 * sanitised mirror task to the inspector project pointed to by
 * ASANA_INSPECTOR_PROJECT_GID. The mirrored task includes:
 *
 *   - A neutral title ([INSPECTOR] {caseId} — {verdict})
 *   - Notes containing ONLY the fields an inspector needs:
 *     verdict, confidence, regulatory citation, dispatched-at,
 *     trigger, the dispatcher version, and the audit-log entry id
 *     for cross-referencing. PII, source-task deep links, and
 *     internal MLRO drafting notes are intentionally omitted.
 *   - Tags scoped to inspection (inspector-evidence, verdict:*).
 *   - Custom fields populated from the audit entry (verdict,
 *     confidence, regulation citation) but NOT the manual-action
 *     chip — inspectors should not see operational state, only
 *     completed compliance actions.
 *
 * The companion bootstrap script
 * (scripts/asana-inspector-project-bootstrap.ts) creates the
 * inspector project itself in one shot.
 *
 * Failure mode contract (matches asanaAuditLogMirror.ts +
 * asanaCentralMlroMirror.ts):
 *   - Every function degrades to a no-op when
 *     ASANA_INSPECTOR_PROJECT_GID is unset OR Asana isn't
 *     configured. Never throws. Best-effort regulatory mirror.
 *   - Idempotent via a parallel localStorage key — re-runs never
 *     double-post.
 *   - Only mirrors entries that legitimately belong in an
 *     inspector evidence pack.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (10-year retention — inspector pack)
 *   - Cabinet Res 134/2025 Art.19 (auditable internal review)
 *   - LBMA RGG v9 (annual audit pack)
 *   - MoE Circular 08/AML/2021 (DPMS quarterly reporting evidence)
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

/** The Asana project GID that aggregates inspector-grade evidence. */
export function getInspectorProjectGid(): string | undefined {
  return env('ASANA_INSPECTOR_PROJECT_GID');
}

/** True when the inspector mirror is fully configured and safe to invoke. */
export function isInspectorMirrorConfigured(): boolean {
  return isAsanaConfigured() && Boolean(getInspectorProjectGid());
}

// ---------------------------------------------------------------------------
// Filter — which dispatches deserve an inspector evidence entry?
// ---------------------------------------------------------------------------

/**
 * Returns true when the dispatch entry should be mirrored to the
 * inspector evidence project. Inspectors need to see EVERY case
 * that resulted in a regulatory action — freeze, escalate, STR/SAR
 * filing, and any case with regulatory side effects (parent task
 * created with STR subtasks, four-eyes invocation). Pure passes
 * with no side effects are skipped to avoid drowning the inspector
 * pack in noise.
 *
 * Pure function — no side effects, fully testable.
 */
export function needsInspectorEvidence(entry: DispatchAuditEntry): boolean {
  // Any freeze or escalate is regulatory action — always mirror.
  if (entry.verdict === 'freeze' || entry.verdict === 'escalate') return true;
  // Anything that produced STR/SAR subtasks is a regulatory filing.
  if (entry.strSubtaskCount > 0) return true;
  // Anything that invoked four-eyes is a documented control.
  if (entry.fourEyesCount > 0) return true;
  // Anything with errors is an inspector concern.
  if (entry.errors.length > 0) return true;
  // Pure passes with no side effects → skip.
  return false;
}

// ---------------------------------------------------------------------------
// Pure builder — testable in isolation
// ---------------------------------------------------------------------------

function buildInspectorTaskName(entry: DispatchAuditEntry): string {
  const safeCase = entry.caseId.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64);
  return `[INSPECTOR] ${safeCase} — ${entry.verdict}`;
}

/**
 * Build the inspector-facing notes. Critically: omits the source
 * task deep link, the customer parent gid, dispatcher warnings, and
 * the full machine-readable JSON. Inspectors get a sanitised
 * compliance-action summary, not operational telemetry.
 */
function buildInspectorTaskNotes(entry: DispatchAuditEntry): string {
  const errorBlock =
    entry.errors.length > 0
      ? `\nErrors at dispatch:\n${entry.errors.map((e) => `  - ${e}`).join('\n')}`
      : '';
  return [
    `Inspector evidence entry`,
    ``,
    `Case ID:           ${entry.caseId}`,
    `Verdict:           ${entry.verdict}`,
    `Confidence:        ${(entry.confidence * 100).toFixed(1)}%`,
    `Dispatched at:     ${entry.dispatchedAtIso}`,
    `Trigger:           ${entry.trigger}`,
    `Dispatcher ver:    ${entry.dispatcherVersion}`,
    ``,
    `Regulatory side effects:`,
    `  STR/SAR subtasks created: ${entry.strSubtaskCount}`,
    `  Four-eyes subtasks:       ${entry.fourEyesCount}`,
    errorBlock,
    ``,
    `Audit-log entry id (cross-reference): ${entry.id}`,
    ``,
    `--- Inspector access notes ---`,
    `This task is a sanitised mirror of a compliance-action audit`,
    `entry. PII, internal MLRO drafting notes, and operational state`,
    `are intentionally omitted from this view. Cross-reference the`,
    `audit-log entry id above against the 10-year retention store`,
    `for the full evidence chain (FDL No.10/2025 Art.24).`,
  ].join('\n');
}

export interface BuildInspectorTaskInput {
  entry: DispatchAuditEntry;
  projectGid: string;
}

/**
 * Pure builder — converts a DispatchAuditEntry into an Asana task
 * payload for the inspector evidence project. Sanitised view: no
 * deep links to operational projects, no manual-action chip, no
 * full JSON dump. Reads custom-field GIDs from env via
 * buildComplianceCustomFields. Safe to call without Asana
 * configured — the returned payload is just data.
 */
export function buildInspectorTaskPayload(
  input: BuildInspectorTaskInput
): AsanaTaskPayload {
  const { entry, projectGid } = input;
  return {
    name: buildInspectorTaskName(entry),
    notes: buildInspectorTaskNotes(entry),
    projects: [projectGid],
    custom_fields: buildComplianceCustomFields({
      verdict: entry.verdict,
      caseId: entry.caseId,
      confidence: entry.confidence,
      regulationCitation: 'FDL No.10/2025 Art.24',
      // NOTE: deliberately not setting manualActionRequired here —
      // inspectors should see what the analyzer DECIDED, not the
      // operational state of the MLRO's bank-portal workflow.
    }),
    tags: [
      'inspector-evidence',
      `verdict:${entry.verdict}`,
      `trigger:${entry.trigger}`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Mirrored-id tracking (idempotency)
// ---------------------------------------------------------------------------

const MIRRORED_KEY = 'fgl_inspector_mirrored_ids';
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
export function __resetInspectorMirrorState(): void {
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

export interface MirrorToInspectorResult {
  ok: boolean;
  /** True when the entry doesn't qualify for inspector evidence. */
  skipped?: boolean;
  /** True when the entry was already mirrored. */
  alreadyMirrored?: boolean;
  /** True when the inspector project / asana token is unset. */
  unconfigured?: boolean;
  taskGid?: string;
  error?: string;
}

/**
 * Mirror a single dispatch audit entry into the inspector evidence
 * project IF AND ONLY IF the entry qualifies for inclusion (freeze,
 * escalate, STR subtasks created, four-eyes invoked, or errors).
 * Idempotent — re-runs the same entry id are no-ops.
 *
 * Designed to be called from the post-dispatch hook in
 * autoDispatchListener as fire-and-forget. Errors are returned in
 * the result object, never thrown.
 */
export async function mirrorDispatchToInspector(
  entry: DispatchAuditEntry
): Promise<MirrorToInspectorResult> {
  if (!needsInspectorEvidence(entry)) {
    return { ok: true, skipped: true };
  }

  const projectGid = getInspectorProjectGid();
  if (!projectGid || !isAsanaConfigured()) {
    return { ok: true, unconfigured: true };
  }

  const mirrored = readMirroredIds();
  if (mirrored.has(entry.id)) {
    return { ok: true, alreadyMirrored: true };
  }

  const payload = buildInspectorTaskPayload({ entry, projectGid });
  const result = await createAsanaTask(payload);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  mirrored.add(entry.id);
  writeMirroredIds(mirrored);
  return { ok: true, taskGid: result.gid };
}
