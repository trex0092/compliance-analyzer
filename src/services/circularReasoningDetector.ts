/**
 * Circular Reasoning Detector — subsystem #67 (Phase 7 Cluster H).
 *
 * Catches feedback loops between subsystems where subsystem A's output
 * becomes B's input, which becomes C's input, which circles back to A.
 * Over iterations, circular dependencies amplify noise. The detector
 * walks the dependency graph, finds cycles via DFS with a visited
 * stack, and breaks them by removing the weakest edge in the cycle.
 *
 * Pure function, deterministic. No side effects — the caller decides
 * what to do with the detected cycles.
 *
 * Regulatory basis:
 *   - NIST AI RMF MS-1.1 (testing for stability)
 *   - EU AI Act Art.15 (robustness)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DependencyEdge {
  from: string;
  to: string;
  weight: number;
}

export interface Cycle {
  nodes: readonly string[];
  edges: readonly DependencyEdge[];
  weakestEdge: DependencyEdge;
}

export interface CircularReport {
  cycles: Cycle[];
  suggestedEdgeRemovals: DependencyEdge[];
  narrative: string;
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export function detectCircularReasoning(
  edges: readonly DependencyEdge[]
): CircularReport {
  // Build adjacency
  const adj = new Map<string, DependencyEdge[]>();
  for (const e of edges) {
    const list = adj.get(e.from) ?? [];
    list.push(e);
    adj.set(e.from, list);
  }

  const cycles: Cycle[] = [];
  const visited = new Set<string>();
  const stack: string[] = [];
  const stackSet = new Set<string>();

  function dfs(node: string): void {
    if (stackSet.has(node)) {
      // Cycle detected — extract from the stack back to this node.
      const idx = stack.indexOf(node);
      const cycleNodes = stack.slice(idx);
      cycleNodes.push(node);
      const cycleEdges: DependencyEdge[] = [];
      for (let i = 0; i < cycleNodes.length - 1; i++) {
        const found = edges.find((e) => e.from === cycleNodes[i] && e.to === cycleNodes[i + 1]);
        if (found) cycleEdges.push(found);
      }
      if (cycleEdges.length > 0) {
        const weakest = cycleEdges.reduce((acc, e) => (e.weight < acc.weight ? e : acc), cycleEdges[0]);
        // De-dupe by canonical cycle string
        const canonical = [...cycleNodes].sort().join('|');
        if (!cycles.some((c) => [...c.nodes].sort().join('|') === canonical)) {
          cycles.push({
            nodes: cycleNodes,
            edges: cycleEdges,
            weakestEdge: weakest,
          });
        }
      }
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.push(node);
    stackSet.add(node);
    const outgoing = adj.get(node) ?? [];
    for (const edge of outgoing) {
      dfs(edge.to);
    }
    stack.pop();
    stackSet.delete(node);
  }

  const nodes = new Set<string>();
  for (const e of edges) {
    nodes.add(e.from);
    nodes.add(e.to);
  }
  for (const n of nodes) {
    if (!visited.has(n)) dfs(n);
  }

  const suggestedEdgeRemovals = cycles.map((c) => c.weakestEdge);
  const narrative =
    cycles.length === 0
      ? 'Circular reasoning detector: no cycles found in the dependency graph.'
      : `Circular reasoning detector: ${cycles.length} cycle(s) found. Break by removing ` +
        `${suggestedEdgeRemovals.length} weakest edge(s).`;

  return { cycles, suggestedEdgeRemovals, narrative };
}
