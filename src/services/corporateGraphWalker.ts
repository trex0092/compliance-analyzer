/**
 * Corporate Graph Walker — subsystem #33.
 *
 * The #1 sanctions evasion pattern is "sanctioned parent, clean
 * subsidiary". A single-entity screen doesn't see it. This subsystem
 * walks the parent → subsidiary → sister-company graph up to N hops
 * and re-runs a cheap screen predicate at each node. Any node that
 * the predicate flags is reported, with the path back to the query
 * entity.
 *
 * The graph + predicate are injected so the walker stays pure and
 * testable — in production, the predicate is the Phase 1 sanctions
 * matcher; in tests, it's a simple set lookup.
 *
 * Regulatory basis:
 *   - Cabinet Decision 109/2023 (UBO chain transparency)
 *   - FATF Rec 10 (CDD on the full ownership chain)
 *   - Cabinet Res 74/2020 Art.4-7 (freeze on ANY sanctioned node)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CorporateNode {
  id: string;
  name: string;
  /** Direct parents of this entity. */
  parents?: readonly string[];
  /** Direct subsidiaries of this entity. */
  subsidiaries?: readonly string[];
  /** Sister companies sharing a parent with this entity. */
  siblings?: readonly string[];
}

export type CorporateGraph = ReadonlyMap<string, CorporateNode>;

export type NodePredicate = (node: CorporateNode) => { flagged: boolean; reason?: string };

export interface GraphWalkHit {
  nodeId: string;
  nodeName: string;
  /** Hop distance from the query entity. */
  hops: number;
  /** Path from query entity → this node. */
  path: readonly string[];
  reason: string;
}

export interface GraphWalkReport {
  queryId: string;
  hops: number;
  visited: number;
  hits: GraphWalkHit[];
  narrative: string;
}

// ---------------------------------------------------------------------------
// Walk
// ---------------------------------------------------------------------------

export function walkCorporateGraph(
  graph: CorporateGraph,
  queryId: string,
  predicate: NodePredicate,
  maxHops = 3
): GraphWalkReport {
  const visited = new Set<string>();
  const hits: GraphWalkHit[] = [];
  const queue: Array<{ id: string; hops: number; path: string[] }> = [
    { id: queryId, hops: 0, path: [queryId] },
  ];

  while (queue.length > 0) {
    const { id, hops, path } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const node = graph.get(id);
    if (!node) continue;

    const { flagged, reason } = predicate(node);
    if (flagged && id !== queryId) {
      hits.push({
        nodeId: id,
        nodeName: node.name,
        hops,
        path: [...path],
        reason: reason ?? 'flagged',
      });
    }

    if (hops < maxHops) {
      const neighbours = [
        ...(node.parents ?? []),
        ...(node.subsidiaries ?? []),
        ...(node.siblings ?? []),
      ];
      for (const n of neighbours) {
        if (!visited.has(n)) {
          queue.push({ id: n, hops: hops + 1, path: [...path, n] });
        }
      }
    }
  }

  const narrative =
    hits.length === 0
      ? `Corporate graph walker: ${visited.size} node(s) visited, no flags within ${maxHops} hops of ${queryId}.`
      : `Corporate graph walker: ${visited.size} node(s) visited, ${hits.length} flagged ` +
        `(${hits.slice(0, 3).map((h) => `${h.nodeName}@${h.hops}hops`).join(', ')}${
          hits.length > 3 ? ', ...' : ''
        }).`;

  return { queryId, hops: maxHops, visited: visited.size, hits, narrative };
}
