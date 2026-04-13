/**
 * Tests for the Asana Kanban grouping logic. Pure classifier over
 * in-memory task fixtures — no fetch mocking.
 */
import { describe, it, expect } from 'vitest';
import {
  sectionNameToColumn,
  namePrefixToColumn,
  classifyTaskToColumn,
  buildKanbanBoard,
  KANBAN_COLUMNS,
  type AsanaKanbanTask,
} from '@/services/asanaKanbanView';

describe('sectionNameToColumn', () => {
  it('maps common "To Do" synonyms', () => {
    expect(sectionNameToColumn('To Do')).toBe('todo');
    expect(sectionNameToColumn('Backlog')).toBe('todo');
    expect(sectionNameToColumn('Queue')).toBe('todo');
  });

  it('maps in-progress synonyms', () => {
    expect(sectionNameToColumn('In Progress')).toBe('doing');
    expect(sectionNameToColumn('Doing')).toBe('doing');
    expect(sectionNameToColumn('WIP')).toBe('doing');
  });

  it('maps review synonyms', () => {
    expect(sectionNameToColumn('Review')).toBe('review');
    expect(sectionNameToColumn('QA')).toBe('review');
    expect(sectionNameToColumn('Four-Eyes Approval')).toBe('review');
  });

  it('maps done synonyms', () => {
    expect(sectionNameToColumn('Done ✓')).toBe('done');
    expect(sectionNameToColumn('Completed')).toBe('done');
    expect(sectionNameToColumn('Closed')).toBe('done');
  });

  it('maps blocked', () => {
    expect(sectionNameToColumn('Blocked')).toBe('blocked');
  });

  it('returns undefined for unknown', () => {
    expect(sectionNameToColumn('Random')).toBeUndefined();
    expect(sectionNameToColumn(undefined)).toBeUndefined();
  });
});

describe('namePrefixToColumn', () => {
  it('extracts the column from a [TAG] prefix', () => {
    expect(namePrefixToColumn('[TODO] something')).toBe('todo');
    expect(namePrefixToColumn('[DOING] something')).toBe('doing');
    expect(namePrefixToColumn('[REVIEW] something')).toBe('review');
    expect(namePrefixToColumn('[DONE] something')).toBe('done');
    expect(namePrefixToColumn('[BLOCKED] something')).toBe('blocked');
    expect(namePrefixToColumn('[FOUR-EYES] something')).toBe('review');
  });

  it('returns undefined when there is no prefix', () => {
    expect(namePrefixToColumn('no prefix here')).toBeUndefined();
  });
});

describe('classifyTaskToColumn', () => {
  const projectGid = 'proj-1';

  function task(overrides: Partial<AsanaKanbanTask> = {}): AsanaKanbanTask {
    return {
      gid: 'g1',
      name: 'task',
      completed: false,
      ...overrides,
    };
  }

  it('prefers this-project section over name prefix', () => {
    const t = task({
      name: '[DONE] something',
      memberships: [
        { project: { gid: projectGid }, section: { gid: 's1', name: 'Doing' } },
      ],
    });
    expect(classifyTaskToColumn(t, projectGid).column).toBe('doing');
  });

  it('ignores sections from other projects', () => {
    const t = task({
      name: '[BLOCKED] something',
      memberships: [
        { project: { gid: 'other' }, section: { gid: 's1', name: 'Doing' } },
      ],
    });
    // Should fall through to name prefix since the section belongs to
    // a different project.
    expect(classifyTaskToColumn(t, projectGid).column).toBe('blocked');
  });

  it('falls back to name prefix when no sections', () => {
    const t = task({ name: '[REVIEW] approve' });
    expect(classifyTaskToColumn(t, projectGid).column).toBe('review');
  });

  it('falls back to done when completed and no section/prefix', () => {
    const t = task({ name: 'unassigned', completed: true });
    expect(classifyTaskToColumn(t, projectGid).column).toBe('done');
  });

  it('defaults to todo otherwise', () => {
    const t = task({ name: 'unassigned' });
    expect(classifyTaskToColumn(t, projectGid).column).toBe('todo');
  });
});

describe('buildKanbanBoard', () => {
  const projectGid = 'proj-1';

  it('groups tasks into the 5 canonical columns', () => {
    const tasks: AsanaKanbanTask[] = [
      { gid: '1', name: '[TODO] a', completed: false },
      { gid: '2', name: '[DOING] b', completed: false },
      { gid: '3', name: '[REVIEW] c', completed: false },
      { gid: '4', name: 'd', completed: true },
      { gid: '5', name: '[BLOCKED] e', completed: false },
    ];
    const board = buildKanbanBoard(tasks, { projectGid });
    expect(board.columns.todo).toHaveLength(1);
    expect(board.columns.doing).toHaveLength(1);
    expect(board.columns.review).toHaveLength(1);
    expect(board.columns.done).toHaveLength(1);
    expect(board.columns.blocked).toHaveLength(1);
    expect(board.totalCards).toBe(5);
  });

  it('flags overdue tasks as breaches', () => {
    const tasks: AsanaKanbanTask[] = [
      {
        gid: '1',
        name: '[DOING] overdue',
        completed: false,
        due_on: '2025-01-01',
      },
      {
        gid: '2',
        name: '[DOING] ontime',
        completed: false,
        due_on: '2099-01-01',
      },
    ];
    const board = buildKanbanBoard(tasks, {
      projectGid,
      nowIso: '2026-04-13T00:00:00.000Z',
    });
    expect(board.breachCount).toBe(1);
    const doing = board.columns.doing;
    expect(doing[0].breachWarning).toBe(true);
    expect(doing[0].gid).toBe('1');
  });

  it('completed tasks do not count as breaches even when past due', () => {
    const tasks: AsanaKanbanTask[] = [
      {
        gid: '1',
        name: 'completed overdue',
        completed: true,
        due_on: '2025-01-01',
      },
    ];
    const board = buildKanbanBoard(tasks, {
      projectGid,
      nowIso: '2026-04-13T00:00:00.000Z',
    });
    expect(board.breachCount).toBe(0);
  });

  it('sorts breach-first, then by due date', () => {
    const tasks: AsanaKanbanTask[] = [
      { gid: '1', name: '[TODO] b', completed: false, due_on: '2099-06-01' },
      { gid: '2', name: '[TODO] a', completed: false, due_on: '2025-01-01' }, // breach
    ];
    const board = buildKanbanBoard(tasks, {
      projectGid,
      nowIso: '2026-04-13T00:00:00.000Z',
    });
    expect(board.columns.todo[0].gid).toBe('2'); // breach first
  });

  it('always returns all 5 column keys even when empty', () => {
    const board = buildKanbanBoard([], { projectGid });
    for (const col of KANBAN_COLUMNS) {
      expect(Array.isArray(board.columns[col])).toBe(true);
    }
  });
});
