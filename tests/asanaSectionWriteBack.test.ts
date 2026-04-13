/**
 * Tests for the pure helpers in asanaSectionWriteBack.
 * Dispatcher paths (fetchProjectSections / moveTaskToSection /
 * moveTaskToKanbanColumn) depend on asanaClient + fetch and are
 * covered by the existing asanaClient suite.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSectionMap,
  missingColumns,
  type AsanaSection,
} from '@/services/asanaSectionWriteBack';

describe('buildSectionMap', () => {
  it('maps a full 5-column project cleanly', () => {
    const sections: AsanaSection[] = [
      { gid: 's1', name: 'To Do' },
      { gid: 's2', name: 'In Progress' },
      { gid: 's3', name: 'Four-Eyes Review' },
      { gid: 's4', name: 'Done' },
      { gid: 's5', name: 'Blocked' },
    ];
    const map = buildSectionMap(sections);
    expect(map.todo).toBe('s1');
    expect(map.doing).toBe('s2');
    expect(map.review).toBe('s3');
    expect(map.done).toBe('s4');
    expect(map.blocked).toBe('s5');
  });

  it('preserves the first matching section on duplicates', () => {
    const sections: AsanaSection[] = [
      { gid: 's1', name: 'Backlog' },
      { gid: 's2', name: 'To Do' },
    ];
    const map = buildSectionMap(sections);
    // Backlog comes first and matches 'todo'; the second "To Do"
    // should NOT overwrite.
    expect(map.todo).toBe('s1');
  });

  it('tolerates unknown section names', () => {
    const sections: AsanaSection[] = [
      { gid: 's1', name: 'Random other section' },
      { gid: 's2', name: 'Done' },
    ];
    const map = buildSectionMap(sections);
    expect(map.done).toBe('s2');
    expect(Object.keys(map)).toHaveLength(1);
  });
});

describe('missingColumns', () => {
  it('reports every canonical column missing from a partial map', () => {
    const missing = missingColumns({ todo: 'a', done: 'b' });
    expect(missing.sort()).toEqual(['blocked', 'doing', 'review'].sort());
  });

  it('returns empty when the map covers every column', () => {
    const full = missingColumns({
      todo: 'a',
      doing: 'b',
      review: 'c',
      done: 'd',
      blocked: 'e',
    });
    expect(full).toEqual([]);
  });
});
