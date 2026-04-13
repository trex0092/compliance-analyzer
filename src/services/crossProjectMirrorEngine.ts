/**
 * Cross-Project Mirror Engine — when a task enters the "Blocked"
 * column of a customer project, mirror a high-priority task into
 * the central MLRO project so the MLRO sees blockages across the
 * entire customer portfolio in one place.
 *
 * The rule catalogue already declares this in
 * `asanaWorkflowAutomation.COMPLIANCE_WORKFLOW_RULES` (RL-04):
 * "Blocked section → notify". This engine executes it.
 *
 * Pure planner (buildMirrorPlan) + thin applier (applyMirrorPlan).
 * The planner takes a list of source events and a mirror target
 * project; the applier calls createAsanaTask for each mirrored
 * payload.
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (auditable internal review —
 *     blockages must surface to the MLRO)
 *   - FDL No.10/2025 Art.20-21 (CO/MLRO duty of care)
 *   - FDL No.10/2025 Art.29 (no tipping off — mirrored task name
 *     uses source task gid, never entity legal name)
 */

import { createAsanaTask, type AsanaTaskPayload, isAsanaConfigured } from './asanaClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlockageEvent {
  /** Task GID in the source project. */
  sourceTaskGid: string;
  /** Source project GID. */
  sourceProjectGid: string;
  /** Short summary for the mirrored title — NEVER an entity legal name. */
  summary: string;
  /** ISO timestamp the task entered the blocked section. */
  blockedAtIso: string;
  /** Optional case id for audit + dedup. */
  caseId?: string;
}

export interface MirrorPlan {
  targetProjectGid: string;
  payloads: AsanaTaskPayload[];
  /** Skipped events (already mirrored / deduped). */
  skipped: string[];
}

export interface MirrorApplyResult {
  plan: MirrorPlan;
  createdGids: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Dedup state — localStorage-backed so repeated webhooks don't
// mirror the same event twice
// ---------------------------------------------------------------------------

const DEDUP_STORAGE_KEY = 'fgl_cross_project_mirror_dedup';
const DEDUP_TTL_MS = 24 * 3_600_000;

function readDedupSet(): Map<string, number> {
  try {
    if (typeof localStorage === 'undefined') return new Map();
    const raw = localStorage.getItem(DEDUP_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, number>;
    const now = Date.now();
    const fresh = new Map<string, number>();
    for (const [k, v] of Object.entries(parsed)) {
      if (now - v < DEDUP_TTL_MS) fresh.set(k, v);
    }
    return fresh;
  } catch {
    return new Map();
  }
}

function writeDedupSet(map: Map<string, number>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const obj: Record<string, number> = {};
    for (const [k, v] of map.entries()) obj[k] = v;
    localStorage.setItem(DEDUP_STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* storage quota */
  }
}

function dedupKey(event: BlockageEvent): string {
  return `${event.sourceProjectGid}:${event.sourceTaskGid}:${event.blockedAtIso.slice(0, 10)}`;
}

// ---------------------------------------------------------------------------
// Pure planner
// ---------------------------------------------------------------------------

export interface BuildMirrorPlanOptions {
  /** Skip events already mirrored within the dedup TTL. Default true. */
  dedupe?: boolean;
  /** Pre-supplied dedup state for tests. */
  dedupState?: Map<string, number>;
}

export function buildMirrorPlan(
  events: readonly BlockageEvent[],
  targetProjectGid: string,
  options: BuildMirrorPlanOptions = {}
): MirrorPlan {
  const dedupe = options.dedupe ?? true;
  const dedup = options.dedupState ?? (dedupe ? readDedupSet() : new Map<string, number>());
  const payloads: AsanaTaskPayload[] = [];
  const skipped: string[] = [];

  for (const event of events) {
    const key = dedupKey(event);
    if (dedupe && dedup.has(key)) {
      skipped.push(event.sourceTaskGid);
      continue;
    }
    payloads.push(buildMirrorTaskPayload(event, targetProjectGid));
    dedup.set(key, Date.now());
  }

  if (dedupe) writeDedupSet(dedup);

  return {
    targetProjectGid,
    payloads,
    skipped,
  };
}

function buildMirrorTaskPayload(event: BlockageEvent, targetProjectGid: string): AsanaTaskPayload {
  const summary = truncate(event.summary, 120);
  const name = `[MIRROR-BLOCKED] ${summary} (source: ${event.sourceTaskGid})`;
  const notes = [
    'Cross-project mirror task — a customer project reported a blocked compliance task.',
    '',
    `Source project: ${event.sourceProjectGid}`,
    `Source task: ${event.sourceTaskGid}`,
    `Blocked at: ${event.blockedAtIso}`,
    event.caseId ? `Case: ${event.caseId}` : '',
    '',
    'Action required:',
    '  1. Investigate the blocker in the source task.',
    '  2. Assign an unblock owner within 24h.',
    '  3. Close this mirror task when the source task leaves the blocked column.',
    '',
    'Regulatory basis: Cabinet Res 134/2025 Art.19 (MLRO visibility),',
    'FDL No.10/2025 Art.20-21 (duty of care), FDL Art.29 (no tipping off — do not',
    'contact the subject even when asking for clarification).',
  ]
    .filter((l) => l !== '')
    .join('\n');

  return {
    name,
    notes,
    projects: [targetProjectGid],
    tags: ['cross-project-mirror', 'blocked', 'mlro-visibility'],
  };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

// ---------------------------------------------------------------------------
// Applier — runs the real creates
// ---------------------------------------------------------------------------

export async function applyMirrorPlan(plan: MirrorPlan): Promise<MirrorApplyResult> {
  if (!isAsanaConfigured()) {
    return {
      plan,
      createdGids: [],
      errors: ['Asana not configured — mirror plan not applied'],
    };
  }
  const createdGids: string[] = [];
  const errors: string[] = [];
  for (const payload of plan.payloads) {
    const result = await createAsanaTask(payload);
    if (result.ok && result.gid) {
      createdGids.push(result.gid);
    } else if (result.error) {
      errors.push(result.error);
    }
  }
  return { plan, createdGids, errors };
}
