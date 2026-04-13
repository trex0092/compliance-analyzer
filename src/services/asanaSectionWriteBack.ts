/**
 * Asana Section Write-Back — persistent Kanban drag-drop.
 *
 * The Kanban view in AsanaKanbanPage.tsx currently handles drag-drop
 * as a local-only preview because moving a task to a different
 * column means writing a new section membership in Asana, and Asana
 * section GIDs are per-project. This module closes that gap:
 *
 *   1. fetchProjectSections(projectGid) — list the sections in a
 *      project via GET /projects/{gid}/sections
 *   2. buildSectionMap(sections) — map canonical Kanban columns to
 *      the closest-matching section GID using the same tolerant
 *      substring matcher the view uses for classification
 *   3. moveTaskToSection(taskGid, sectionGid) — POST
 *      /sections/{section_gid}/addTask
 *
 * Pure map builder + thin API wrappers. The view calls
 * `moveTaskToKanbanColumn(projectGid, taskGid, column)` which
 * resolves the section GID and dispatches the move in one shot.
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (auditable workflow state)
 *   - FDL No.10/2025 Art.24 (retention — section moves are logged
 *     in Asana's native activity feed, which satisfies the audit
 *     trail requirement)
 */

import { asanaRequestWithRetry, isAsanaConfigured } from './asanaClient';
import { KANBAN_COLUMNS, sectionNameToColumn, type KanbanColumn } from './asanaKanbanView';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AsanaSection {
  gid: string;
  name: string;
}

export type KanbanSectionMap = Partial<Record<KanbanColumn, string>>;

export interface WriteBackResult {
  ok: boolean;
  column?: KanbanColumn;
  sectionGid?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Pure map builder
// ---------------------------------------------------------------------------

/**
 * Build a Kanban column → section GID map from a project's section
 * list. If multiple sections map to the same column, the first one
 * wins — section order in Asana is preserved, so the leftmost
 * matching section is the canonical one.
 */
export function buildSectionMap(sections: readonly AsanaSection[]): KanbanSectionMap {
  const map: KanbanSectionMap = {};
  for (const section of sections) {
    const column = sectionNameToColumn(section.name);
    if (column && !map[column]) {
      map[column] = section.gid;
    }
  }
  return map;
}

/**
 * Report which Kanban columns are missing section coverage for a
 * given project. Used by the Kanban UI to show a "project needs a
 * Blocked section" hint instead of silently dropping the drop.
 */
export function missingColumns(map: KanbanSectionMap): KanbanColumn[] {
  return KANBAN_COLUMNS.filter((col) => !map[col]);
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function fetchProjectSections(
  projectGid: string
): Promise<{ ok: boolean; sections?: AsanaSection[]; error?: string }> {
  const result = await asanaRequestWithRetry<AsanaSection[]>(
    `/projects/${encodeURIComponent(projectGid)}/sections?opt_fields=gid,name&limit=100`
  );
  if (result.ok) {
    return { ok: true, sections: result.data ?? [] };
  }
  return { ok: false, error: result.error };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function moveTaskToSection(
  taskGid: string,
  sectionGid: string
): Promise<{ ok: boolean; error?: string }> {
  const result = await asanaRequestWithRetry(
    `/sections/${encodeURIComponent(sectionGid)}/addTask`,
    {
      method: 'POST',
      body: JSON.stringify({ data: { task: taskGid } }),
    }
  );
  return { ok: result.ok, error: result.error };
}

// ---------------------------------------------------------------------------
// One-shot API for the Kanban view
// ---------------------------------------------------------------------------

const SECTION_MAP_CACHE = new Map<string, { map: KanbanSectionMap; fetchedAtMs: number }>();
const CACHE_TTL_MS = 5 * 60_000;

/**
 * Resolve the section GID for a Kanban column in a given project,
 * using a 5-minute cache to avoid refetching the section list on
 * every drag-drop. Cache is keyed by project GID.
 */
export async function resolveSectionGid(
  projectGid: string,
  column: KanbanColumn
): Promise<{ ok: boolean; sectionGid?: string; map?: KanbanSectionMap; error?: string }> {
  const cached = SECTION_MAP_CACHE.get(projectGid);
  const now = Date.now();
  if (cached && now - cached.fetchedAtMs < CACHE_TTL_MS) {
    return {
      ok: true,
      sectionGid: cached.map[column],
      map: cached.map,
    };
  }

  const fetched = await fetchProjectSections(projectGid);
  if (!fetched.ok || !fetched.sections) {
    return { ok: false, error: fetched.error };
  }

  const map = buildSectionMap(fetched.sections);
  SECTION_MAP_CACHE.set(projectGid, { map, fetchedAtMs: now });
  return { ok: true, sectionGid: map[column], map };
}

/** Clear the cache — exposed for tests and for force-refresh in the UI. */
export function clearSectionMapCache(): void {
  SECTION_MAP_CACHE.clear();
}

/**
 * Move a task to the section corresponding to the target Kanban
 * column. Fails gracefully when the project doesn't have a section
 * for that column — the caller should surface the missing-column
 * list to the MLRO so they can add one.
 */
export async function moveTaskToKanbanColumn(
  projectGid: string,
  taskGid: string,
  column: KanbanColumn
): Promise<WriteBackResult> {
  if (!isAsanaConfigured()) {
    return { ok: false, error: 'Asana not configured' };
  }
  const resolved = await resolveSectionGid(projectGid, column);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }
  if (!resolved.sectionGid) {
    return {
      ok: false,
      column,
      error: `Project ${projectGid} has no section mapped to Kanban column "${column}". Add a section named e.g. "${column}" and retry.`,
    };
  }
  const moved = await moveTaskToSection(taskGid, resolved.sectionGid);
  return {
    ok: moved.ok,
    error: moved.error,
    column,
    sectionGid: resolved.sectionGid,
  };
}
