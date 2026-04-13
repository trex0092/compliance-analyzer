/**
 * Tests for the DAG layout helpers in DependencyDag.tsx.
 *
 * Only the pure functions (computeRanks / layoutDag) are exercised
 * — React rendering is out of scope for vitest unit tests per the
 * project's coverage config (tsx is excluded from coverage).
 */
import { describe, it, expect } from 'vitest';
import {
  computeRanks,
  layoutDag,
  type DagNode,
} from '@/ui/reasoning/DependencyDag';
import { STR_LIFECYCLE_DEPENDENCIES } from '@/services/asanaWorkflowAutomation';
import { STR_SUBTASK_STAGES } from '@/services/strSubtaskLifecycle';

function nodesFromStages(): DagNode[] {
  return STR_SUBTASK_STAGES.map((stage, i) => ({
    id: stage,
    label: stage.toUpperCase(),
    sublabel: `Stage ${i + 1}/7`,
  }));
}

describe('computeRanks', () => {
  it('ranks a linear chain 0..n-1', () => {
    const nodes: DagNode[] = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ];
    const edges = [
      { parent: 'b', blockedBy: 'a' },
      { parent: 'c', blockedBy: 'b' },
    ];
    const ranks = computeRanks(nodes, edges);
    expect(ranks.get('a')).toBe(0);
    expect(ranks.get('b')).toBe(1);
    expect(ranks.get('c')).toBe(2);
  });

  it('mlro-review is rank 0 for STR lifecycle', () => {
    const ranks = computeRanks(nodesFromStages(), STR_LIFECYCLE_DEPENDENCIES);
    expect(ranks.get('mlro-review')).toBe(0);
  });

  it('close is the highest rank in the STR lifecycle', () => {
    const ranks = computeRanks(nodesFromStages(), STR_LIFECYCLE_DEPENDENCIES);
    const closeRank = ranks.get('close') ?? -1;
    for (const stage of STR_SUBTASK_STAGES) {
      expect(closeRank).toBeGreaterThanOrEqual(ranks.get(stage) ?? 0);
    }
  });

  it('four-eyes is downstream of mlro-review', () => {
    const ranks = computeRanks(nodesFromStages(), STR_LIFECYCLE_DEPENDENCIES);
    expect((ranks.get('four-eyes') ?? 0)).toBeGreaterThan(ranks.get('mlro-review') ?? 0);
  });
});

describe('layoutDag', () => {
  it('produces width/height large enough to contain every node', () => {
    const layout = layoutDag(nodesFromStages(), STR_LIFECYCLE_DEPENDENCIES);
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThan(layout.width);
      expect(node.y).toBeLessThan(layout.height);
    }
  });

  it('returns one laid-out node per input node', () => {
    const nodes = nodesFromStages();
    const layout = layoutDag(nodes, STR_LIFECYCLE_DEPENDENCIES);
    expect(layout.nodes).toHaveLength(nodes.length);
  });

  it('handles empty input gracefully', () => {
    const layout = layoutDag([], []);
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.width).toBeGreaterThan(0);
  });
});
