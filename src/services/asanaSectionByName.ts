/**
 * Asana Section By Name — tolerant name-based section lookup.
 *
 * The existing asanaSectionWriteBack.ts resolves a Kanban COLUMN to a
 * section GID through the KANBAN_COLUMNS enum. That's the right layer
 * for drag-drop. But the screening write-back needs to land a task in
 * a named section ("The Screenings", "Transaction Monitor") on a
 * specific MLRO project without introducing a new Kanban column. This
 * module is the thin name-based lookup the screening path needs.
 *
 *   1. resolveSectionByName(projectGid, name) — case-insensitive
 *      substring match against the project's section list
 *   2. moveTaskToNamedSection(projectGid, taskGid, name) — one-shot
 *      API for screening-run / continuous-monitor
 *
 * Fails soft: if the named section doesn't exist, the task stays at
 * the top of the project (default Asana behaviour) and the caller
 * gets a structured error it can surface on the verdict page.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (retention — section moves are logged in
 *     Asana's native activity feed)
 *   - Cabinet Res 134/2025 Art.19 (auditable workflow state)
 */

import {
  fetchProjectSections,
  moveTaskToSection,
  type AsanaSection,
} from './asanaSectionWriteBack';
import { isAsanaConfigured } from './asanaClient';

export interface NamedSectionResult {
  ok: boolean;
  projectGid: string;
  sectionGid?: string;
  sectionName?: string;
  matchedAgainst?: string;
  error?: string;
}

function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Match a section name tolerantly: exact (case-insensitive) first,
 * then startsWith, then substring. This mirrors the matcher used by
 * asanaKanbanView's sectionNameToColumn so MLROs can rename sections
 * slightly ("The Screenings (EDD)" still matches "the screenings")
 * without code changes.
 */
function findSectionByName(
  sections: readonly AsanaSection[],
  needle: string
): AsanaSection | undefined {
  const n = normalise(needle);
  if (!n) return undefined;
  let bestExact: AsanaSection | undefined;
  let bestPrefix: AsanaSection | undefined;
  let bestContains: AsanaSection | undefined;
  for (const s of sections) {
    const hay = normalise(s.name);
    if (hay === n) {
      if (!bestExact) bestExact = s;
    } else if (hay.startsWith(n) || n.startsWith(hay)) {
      if (!bestPrefix) bestPrefix = s;
    } else if (hay.includes(n) || n.includes(hay)) {
      if (!bestContains) bestContains = s;
    }
  }
  return bestExact ?? bestPrefix ?? bestContains;
}

export async function resolveSectionByName(
  projectGid: string,
  name: string
): Promise<NamedSectionResult> {
  if (!isAsanaConfigured()) {
    return { ok: false, projectGid, error: 'Asana not configured' };
  }
  const fetched = await fetchProjectSections(projectGid);
  if (!fetched.ok || !fetched.sections) {
    return { ok: false, projectGid, error: fetched.error ?? 'failed to fetch sections' };
  }
  const hit = findSectionByName(fetched.sections, name);
  if (!hit) {
    const known = fetched.sections.map((s) => s.name).join(', ');
    return {
      ok: false,
      projectGid,
      matchedAgainst: name,
      error: `no section named "${name}" on project ${projectGid}. Known sections: ${known || '(none)'}.`,
    };
  }
  return {
    ok: true,
    projectGid,
    sectionGid: hit.gid,
    sectionName: hit.name,
    matchedAgainst: name,
  };
}

export async function moveTaskToNamedSection(
  projectGid: string,
  taskGid: string,
  name: string
): Promise<NamedSectionResult> {
  const resolved = await resolveSectionByName(projectGid, name);
  if (!resolved.ok || !resolved.sectionGid) return resolved;
  const moved = await moveTaskToSection(taskGid, resolved.sectionGid);
  if (!moved.ok) {
    return {
      ok: false,
      projectGid,
      sectionGid: resolved.sectionGid,
      sectionName: resolved.sectionName,
      matchedAgainst: name,
      error: moved.error ?? 'failed to move task to section',
    };
  }
  return resolved;
}
