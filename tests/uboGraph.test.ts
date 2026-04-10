import { describe, it, expect } from 'vitest';
import {
  createGraph,
  addNode,
  addEdge,
  effectiveOwnersOf,
  ubosOf,
  sanctionsProximity,
  summariseUboRisk,
  type UboGraph,
} from '@/services/uboGraph';

function buildSimpleChain(): UboGraph {
  // Person A owns 60% of Corp B, which owns 40% of Corp C (the target)
  // → A's effective ownership of C = 60% × 40% = 24%  (just under UBO)
  const g = createGraph();
  addNode(g, { id: 'A', type: 'natural_person', name: 'Alice' });
  addNode(g, { id: 'B', type: 'legal_entity', name: 'Bravo Ltd' });
  addNode(g, { id: 'C', type: 'legal_entity', name: 'Charlie LLC' });
  addEdge(g, { from: 'A', to: 'B', kind: 'owns', percentage: 60 });
  addEdge(g, { from: 'B', to: 'C', kind: 'owns', percentage: 40 });
  return g;
}

function buildUboChain(): UboGraph {
  // Person A owns 100% of Corp B, which owns 100% of Corp C
  // → A is a clear UBO of C at 100%
  const g = createGraph();
  addNode(g, { id: 'A', type: 'natural_person', name: 'Alice' });
  addNode(g, { id: 'B', type: 'legal_entity', name: 'Bravo Ltd' });
  addNode(g, { id: 'C', type: 'legal_entity', name: 'Charlie LLC' });
  addEdge(g, { from: 'A', to: 'B', kind: 'owns', percentage: 100 });
  addEdge(g, { from: 'B', to: 'C', kind: 'owns', percentage: 100 });
  return g;
}

function buildMultiPath(): UboGraph {
  // Person A owns 50% of B and 50% of D.
  // B owns 40% of C, D owns 40% of C.
  // A's effective ownership of C = 50*40 + 50*40 = 40%
  const g = createGraph();
  addNode(g, { id: 'A', type: 'natural_person', name: 'Alice' });
  addNode(g, { id: 'B', type: 'legal_entity', name: 'Bravo' });
  addNode(g, { id: 'D', type: 'legal_entity', name: 'Delta' });
  addNode(g, { id: 'C', type: 'legal_entity', name: 'Charlie' });
  addEdge(g, { from: 'A', to: 'B', kind: 'owns', percentage: 50 });
  addEdge(g, { from: 'A', to: 'D', kind: 'owns', percentage: 50 });
  addEdge(g, { from: 'B', to: 'C', kind: 'owns', percentage: 40 });
  addEdge(g, { from: 'D', to: 'C', kind: 'owns', percentage: 40 });
  return g;
}

function buildSanctionedChain(): UboGraph {
  // Clean person owns 100% of clean corp, which owns 100% of target.
  // But the clean person's employer (linked via `controls`) is sanctioned.
  // Test the `owns`-chain: target → clean corp → clean person (no hit)
  // Then add a sanctioned direct shareholder.
  const g = createGraph();
  addNode(g, { id: 'S', type: 'natural_person', name: 'Sanctioned Sam', sanctionsFlag: true });
  addNode(g, { id: 'P', type: 'legal_entity', name: 'Proxy Ltd' });
  addNode(g, { id: 'T', type: 'legal_entity', name: 'Target LLC' });
  addEdge(g, { from: 'S', to: 'P', kind: 'owns', percentage: 100 });
  addEdge(g, { from: 'P', to: 'T', kind: 'owns', percentage: 100 });
  return g;
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

describe('graph construction', () => {
  it('addNode stores the node', () => {
    const g = createGraph();
    addNode(g, { id: 'X', type: 'legal_entity', name: 'X Corp' });
    expect(g.nodes.has('X')).toBe(true);
    expect(g.nodes.get('X')?.name).toBe('X Corp');
  });

  it('addEdge rejects unknown from-node', () => {
    const g = createGraph();
    addNode(g, { id: 'B', type: 'legal_entity', name: 'B' });
    expect(() => addEdge(g, { from: 'A', to: 'B', kind: 'owns', percentage: 50 })).toThrow(/A/);
  });

  it('addEdge rejects percentage > 100', () => {
    const g = createGraph();
    addNode(g, { id: 'A', type: 'natural_person', name: 'A' });
    addNode(g, { id: 'B', type: 'legal_entity', name: 'B' });
    expect(() => addEdge(g, { from: 'A', to: 'B', kind: 'owns', percentage: 101 })).toThrow();
  });

  it('addEdge rejects negative percentage', () => {
    const g = createGraph();
    addNode(g, { id: 'A', type: 'natural_person', name: 'A' });
    addNode(g, { id: 'B', type: 'legal_entity', name: 'B' });
    expect(() => addEdge(g, { from: 'A', to: 'B', kind: 'owns', percentage: -1 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// effectiveOwnersOf
// ---------------------------------------------------------------------------

describe('effectiveOwnersOf', () => {
  it('computes path product correctly (60% × 40% = 24%)', () => {
    const g = buildSimpleChain();
    const owners = effectiveOwnersOf(g, 'C');
    const alice = owners.find((o) => o.nodeId === 'A');
    expect(alice).toBeDefined();
    expect(alice?.effectivePercentage).toBeCloseTo(24, 2);
  });

  it('24% is BELOW the 25% UBO threshold → not a UBO', () => {
    const g = buildSimpleChain();
    const owners = effectiveOwnersOf(g, 'C');
    expect(owners.find((o) => o.nodeId === 'A')?.isUBO).toBe(false);
  });

  it('100% × 100% = 100% → a clear UBO', () => {
    const g = buildUboChain();
    const owners = effectiveOwnersOf(g, 'C');
    const alice = owners.find((o) => o.nodeId === 'A');
    expect(alice?.effectivePercentage).toBe(100);
    expect(alice?.isUBO).toBe(true);
  });

  it('sums multiple paths for the same owner', () => {
    const g = buildMultiPath();
    const owners = effectiveOwnersOf(g, 'C');
    const alice = owners.find((o) => o.nodeId === 'A');
    // 50*40 + 50*40 = 20+20 = 40
    expect(alice?.effectivePercentage).toBeCloseTo(40, 2);
    expect(alice?.paths).toHaveLength(2);
  });

  it('returns owners sorted by percentage descending', () => {
    const g = buildUboChain();
    const owners = effectiveOwnersOf(g, 'C');
    for (let i = 1; i < owners.length; i++) {
      expect(owners[i - 1].effectivePercentage).toBeGreaterThanOrEqual(owners[i].effectivePercentage);
    }
  });

  it('handles cycle-free multi-layer chains', () => {
    const g = createGraph();
    addNode(g, { id: 'A', type: 'natural_person', name: 'A' });
    addNode(g, { id: 'B', type: 'legal_entity', name: 'B' });
    addNode(g, { id: 'C', type: 'legal_entity', name: 'C' });
    addNode(g, { id: 'D', type: 'legal_entity', name: 'D' });
    addNode(g, { id: 'E', type: 'legal_entity', name: 'E' });
    addEdge(g, { from: 'A', to: 'B', kind: 'owns', percentage: 100 });
    addEdge(g, { from: 'B', to: 'C', kind: 'owns', percentage: 50 });
    addEdge(g, { from: 'C', to: 'D', kind: 'owns', percentage: 80 });
    addEdge(g, { from: 'D', to: 'E', kind: 'owns', percentage: 100 });
    // A's effective ownership of E: 100 * 50 * 80 * 100 / 1000000 = 40
    const owners = effectiveOwnersOf(g, 'E');
    const alice = owners.find((o) => o.nodeId === 'A');
    expect(alice?.effectivePercentage).toBeCloseTo(40, 2);
  });

  it('terminates on cycles without infinite recursion', () => {
    const g = createGraph();
    addNode(g, { id: 'A', type: 'legal_entity', name: 'A' });
    addNode(g, { id: 'B', type: 'legal_entity', name: 'B' });
    // Cycle: A owns B, B owns A
    addEdge(g, { from: 'A', to: 'B', kind: 'owns', percentage: 50 });
    addEdge(g, { from: 'B', to: 'A', kind: 'owns', percentage: 50 });
    // Should not hang. We just assert it returns.
    expect(() => effectiveOwnersOf(g, 'B')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ubosOf — convenience filter
// ---------------------------------------------------------------------------

describe('ubosOf', () => {
  it('returns only natural persons ≥ 25% effective', () => {
    const g = buildUboChain();
    const ubos = ubosOf(g, 'C');
    expect(ubos).toHaveLength(1);
    expect(ubos[0].nodeId).toBe('A');
    expect(ubos[0].type).toBe('natural_person');
  });

  it('returns empty when no person crosses the threshold', () => {
    const g = buildSimpleChain(); // Alice at 24%
    expect(ubosOf(g, 'C')).toHaveLength(0);
  });

  it('threshold is tunable', () => {
    const g = buildSimpleChain(); // Alice at 24%
    expect(ubosOf(g, 'C', 20)).toHaveLength(1);
    expect(ubosOf(g, 'C', 25)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// sanctionsProximity
// ---------------------------------------------------------------------------

describe('sanctionsProximity', () => {
  it('returns hops=0 if the target itself is flagged', () => {
    const g = createGraph();
    addNode(g, { id: 'T', type: 'legal_entity', name: 'Target', sanctionsFlag: true });
    expect(sanctionsProximity(g, 'T').hops).toBe(0);
  });

  it('finds a sanctioned shareholder 2 hops up', () => {
    const g = buildSanctionedChain();
    const p = sanctionsProximity(g, 'T');
    expect(p.hops).toBe(2);
    expect(p.flaggedNode?.name).toBe('Sanctioned Sam');
    expect(p.path[0]).toBe('S');
    expect(p.path[p.path.length - 1]).toBe('T');
  });

  it('returns hops=null for a clean chain', () => {
    const g = buildUboChain();
    expect(sanctionsProximity(g, 'C').hops).toBeNull();
  });

  it('respects maxHops', () => {
    const g = buildSanctionedChain();
    // With maxHops=1, the sanctioned node at depth 2 is unreachable
    expect(sanctionsProximity(g, 'T', 1).hops).toBeNull();
  });

  it('returns hops=null for an unknown target', () => {
    const g = createGraph();
    expect(sanctionsProximity(g, 'nope').hops).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// summariseUboRisk
// ---------------------------------------------------------------------------

describe('summariseUboRisk', () => {
  it('aggregates UBOs, sanctions proximity, and undisclosed portion', () => {
    const g = buildUboChain();
    const summary = summariseUboRisk(g, 'C');
    expect(summary.ubos).toHaveLength(1);
    expect(summary.maxConcentration).toBe(100);
    expect(summary.hasUndisclosedPortion).toBe(false);
    expect(summary.undisclosedPercentage).toBe(0);
    expect(summary.sanctionsProximity.hops).toBeNull();
  });

  it('flags undisclosed ownership when direct owners sum < 100', () => {
    const g = createGraph();
    addNode(g, { id: 'A', type: 'natural_person', name: 'Alice' });
    addNode(g, { id: 'T', type: 'legal_entity', name: 'Target' });
    // Only 60% is declared; 40% unaccounted for
    addEdge(g, { from: 'A', to: 'T', kind: 'owns', percentage: 60 });
    const summary = summariseUboRisk(g, 'T');
    expect(summary.hasUndisclosedPortion).toBe(true);
    expect(summary.undisclosedPercentage).toBe(40);
  });

  it('flags sanctioned UBO when applicable', () => {
    const g = createGraph();
    addNode(g, {
      id: 'A',
      type: 'natural_person',
      name: 'Sanctioned Alice',
      sanctionsFlag: true,
    });
    addNode(g, { id: 'T', type: 'legal_entity', name: 'Target' });
    addEdge(g, { from: 'A', to: 'T', kind: 'owns', percentage: 100 });
    const summary = summariseUboRisk(g, 'T');
    expect(summary.hasSanctionedUbo).toBe(true);
  });

  it('flags PEP UBO when applicable', () => {
    const g = createGraph();
    addNode(g, { id: 'A', type: 'natural_person', name: 'PEP Alice', pepFlag: true });
    addNode(g, { id: 'T', type: 'legal_entity', name: 'Target' });
    addEdge(g, { from: 'A', to: 'T', kind: 'owns', percentage: 100 });
    const summary = summariseUboRisk(g, 'T');
    expect(summary.hasPepUbo).toBe(true);
  });
});
