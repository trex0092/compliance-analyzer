/**
 * Asana Kanban View — fetch tasks and group them into columns.
 *
 * The dashboard SPA needs to render compliance tasks as a Kanban
 * (To Do / Doing / Review / Done / Blocked) instead of linking out to
 * Asana. Asana natively exposes "sections" per project, which is the
 * canonical column source. This module fetches tasks with section
 * membership and groups them into the five canonical columns.
 *
 * If a task is not a member of a section (or the section name doesn't
 * match any known column), we fall back to:
 *   1. Name prefix: `[TODO]`, `[DOING]`, `[REVIEW]`, `[BLOCKED]`
 *   2. `completed` flag → Done
 *   3. Else → To Do
 *
 * Pure grouping logic + a thin fetch wrapper. Tests exercise the
 * reducer; the fetch wrapper is too thin to warrant mocking.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (10yr retention — Kanban is just a view)
 *   - Cabinet Res 134/2025 Art.19 (internal review — visible work queue)
 */

import { asanaRequestWithRetry } from './asanaClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const KANBAN_COLUMNS = ['todo', 'doing', 'review', 'done', 'blocked'] as const;

export type KanbanColumn = (typeof KANBAN_COLUMNS)[number];

export const KANBAN_COLUMN_LABEL: Record<KanbanColumn, string> = {
  todo: 'To Do',
  doing: 'Doing',
  review: 'Review',
  done: 'Done',
  blocked: 'Blocked',
};

/** Shape we get back from Asana when we request sections. */
export interface AsanaKanbanTask {
  gid: string;
  name: string;
  completed: boolean;
  due_on?: string;
  notes?: string;
  assignee?: { gid: string; name?: string } | null;
  memberships?: Array<{
    project?: { gid: string; name?: string };
    section?: { gid: string; name?: string };
  }>;
  tags?: Array<{ gid: string; name?: string }>;
}

export interface KanbanCard {
  gid: string;
  name: string;
  column: KanbanColumn;
  dueOn?: string;
  assigneeName?: string;
  tagLabels: string[];
  breachWarning: boolean;
  sourceSection?: string;
}

export interface KanbanBoard {
  columns: Record<KanbanColumn, KanbanCard[]>;
  totalCards: number;
  breachCount: number;
  projectGid: string;
  fetchedAtIso: string;
}

// ---------------------------------------------------------------------------
// Section → column mapping
// ---------------------------------------------------------------------------

/**
 * Maps an Asana section name to a Kanban column. Case-insensitive
 * substring match — MLROs name sections differently ("To-Do", "In
 * progress", "QA", "Done ✓") and we want the mapper to be tolerant.
 */
export function sectionNameToColumn(name?: string): KanbanColumn | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  if (lower.includes('block')) return 'blocked';
  if (lower.includes('done') || lower.includes('complete') || lower.includes('closed')) {
    return 'done';
  }
  if (
    lower.includes('review') ||
    lower.includes('qa') ||
    lower.includes('approv') ||
    lower.includes('four-eye') ||
    lower.includes('four eye')
  ) {
    return 'review';
  }
  if (
    lower.includes('progress') ||
    lower.includes('doing') ||
    lower.includes('in-progress') ||
    lower.includes('wip') ||
    lower.includes('working')
  ) {
    return 'doing';
  }
  if (
    lower.includes('todo') ||
    lower.includes('to do') ||
    lower.includes('backlog') ||
    lower.includes('queue')
  ) {
    return 'todo';
  }
  return undefined;
}

/**
 * Parse a Kanban column out of a task name prefix. Used when the task
 * is not a member of any section.
 */
export function namePrefixToColumn(name: string): KanbanColumn | undefined {
  const m = /^\[([A-Z0-9_-]+)\]/.exec(name);
  if (!m) return undefined;
  const tag = m[1].toLowerCase();
  if (tag === 'blocked') return 'blocked';
  if (tag === 'done') return 'done';
  if (tag === 'review' || tag === 'four-eyes' || tag === 'mlro-review') return 'review';
  if (tag === 'doing' || tag === 'wip' || tag === 'in-progress') return 'doing';
  if (tag === 'todo' || tag === 'to-do') return 'todo';
  return undefined;
}

// ---------------------------------------------------------------------------
// Pure classifier
// ---------------------------------------------------------------------------

export interface ClassifierOptions {
  /** Optional "now" ISO for deterministic breach detection in tests. */
  nowIso?: string;
  /** Target project gid we're building the board for. */
  projectGid: string;
}

export function classifyTaskToColumn(
  task: AsanaKanbanTask,
  projectGid: string
): { column: KanbanColumn; sourceSection?: string } {
  // 1. Try the project-scoped section first. Asana tasks can live in
  //    multiple projects, so we only trust the section from *this*
  //    project's membership entry.
  const membership = task.memberships?.find(
    (m) => m.project?.gid === projectGid && m.section?.name
  );
  const fromSection = membership?.section?.name
    ? sectionNameToColumn(membership.section.name)
    : undefined;
  if (fromSection) {
    return { column: fromSection, sourceSection: membership?.section?.name };
  }

  // 2. Try the name prefix.
  const fromPrefix = namePrefixToColumn(task.name);
  if (fromPrefix) return { column: fromPrefix };

  // 3. Completed → Done.
  if (task.completed) return { column: 'done' };

  // 4. Default: To Do.
  return { column: 'todo' };
}

function isBreach(task: AsanaKanbanTask, nowIso: string): boolean {
  if (task.completed) return false;
  if (!task.due_on) return false;
  // Asana returns `due_on` as YYYY-MM-DD; parse as UTC midnight.
  const due = Date.parse(task.due_on + 'T23:59:59Z');
  if (!Number.isFinite(due)) return false;
  return Date.parse(nowIso) > due;
}

export function buildKanbanBoard(
  tasks: readonly AsanaKanbanTask[],
  options: ClassifierOptions
): KanbanBoard {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const columns: Record<KanbanColumn, KanbanCard[]> = {
    todo: [],
    doing: [],
    review: [],
    done: [],
    blocked: [],
  };
  let breachCount = 0;

  for (const task of tasks) {
    const { column, sourceSection } = classifyTaskToColumn(task, options.projectGid);
    const breach = isBreach(task, nowIso);
    if (breach) breachCount++;
    const card: KanbanCard = {
      gid: task.gid,
      name: task.name,
      column,
      dueOn: task.due_on,
      assigneeName: task.assignee?.name,
      tagLabels: (task.tags ?? []).map((t) => t.name ?? '').filter(Boolean),
      breachWarning: breach,
      sourceSection,
    };
    columns[column].push(card);
  }

  // Sort every column: breach first, then by due date ascending, then
  // alphabetical. Breach-first gives the MLRO a single glance at what
  // needs attention.
  for (const col of KANBAN_COLUMNS) {
    columns[col].sort((a, b) => {
      if (a.breachWarning !== b.breachWarning) {
        return a.breachWarning ? -1 : 1;
      }
      const ad = a.dueOn ? Date.parse(a.dueOn) : Number.POSITIVE_INFINITY;
      const bd = b.dueOn ? Date.parse(b.dueOn) : Number.POSITIVE_INFINITY;
      if (ad !== bd) return ad - bd;
      return a.name.localeCompare(b.name);
    });
  }

  return {
    columns,
    totalCards: tasks.length,
    breachCount,
    projectGid: options.projectGid,
    fetchedAtIso: nowIso,
  };
}

// ---------------------------------------------------------------------------
// Fetch wrapper
// ---------------------------------------------------------------------------

/**
 * Fetch tasks for a project with the fields the Kanban view needs.
 * Asana rate-limited, retry-enabled via asanaRequestWithRetry.
 */
export async function fetchKanbanTasks(
  projectGid: string
): Promise<{ ok: boolean; tasks?: AsanaKanbanTask[]; error?: string }> {
  const fields =
    'name,gid,completed,due_on,notes,assignee.name,assignee.gid,memberships.section.name,memberships.section.gid,memberships.project.gid,memberships.project.name,tags.name,tags.gid';
  const result = await asanaRequestWithRetry<AsanaKanbanTask[]>(
    `/projects/${encodeURIComponent(projectGid)}/tasks?opt_fields=${fields}&limit=100`
  );
  if (result.ok) {
    return { ok: true, tasks: result.data ?? [] };
  }
  return { ok: false, error: result.error };
}

/**
 * One-shot: fetch + build board.
 */
export async function loadKanbanBoard(
  projectGid: string
): Promise<{ ok: boolean; board?: KanbanBoard; error?: string }> {
  const fetched = await fetchKanbanTasks(projectGid);
  if (!fetched.ok || !fetched.tasks) {
    return { ok: false, error: fetched.error };
  }
  return { ok: true, board: buildKanbanBoard(fetched.tasks, { projectGid }) };
}
