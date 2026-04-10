/**
 * Beneficial Ownership Graph — UBO traversal for Cabinet Decision 109/2023.
 *
 * The regulatory question: "who effectively owns ≥25% of this
 * customer?" A flat customer table cannot answer this when the
 * chain is layered — Customer A owned 60% by Corp B owned 40% by
 * Corp C owned 100% by a sanctioned individual.
 *
 * Model:
 *   Nodes:
 *     - natural_person — a human being (the ultimate category)
 *     - legal_entity   — LLC / FZE / trust / foundation / fund
 *     - nominee        — a declared nominee shareholder
 *   Edges (directed, "parent → child" where parent owns child):
 *     - owns(percentage: 0..100)       direct shareholding
 *     - controls                       de-facto control (board seat, etc.)
 *     - directs                        named director (not ownership)
 *
 * Effective ownership is computed by path product: if A owns 60% of B
 * and B owns 40% of C, then A effectively owns 60% × 40% = 24% of C.
 * Multiple paths sum (if A also owns 30% of C directly, total = 54%).
 *
 * The UBO list for an entity is every `natural_person` whose
 * effective ownership ≥ 25%. Per Cabinet Decision 109/2023, this
 * MUST be re-verified within 15 working days of any ownership change.
 *
 * Sanctions proximity is computed by BFS: "nearest flagged node on
 * the ownership chain". A hit at 2 hops is still a material finding.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NodeType = 'natural_person' | 'legal_entity' | 'nominee';

export interface UboNode {
  id: string;
  type: NodeType;
  name: string;
  /** ISO alpha-2 nationality (persons) or country of incorporation (entities). */
  country?: string;
  /** Sanctions hit flag — set during ingestion from a sanctions screening pass. */
  sanctionsFlag?: boolean;
  /** PEP flag. */
  pepFlag?: boolean;
  /** Free-form metadata. */
  meta?: Record<string, unknown>;
}

export type EdgeKind = 'owns' | 'controls' | 'directs';

export interface UboEdge {
  from: string; // node id (the parent / shareholder)
  to: string;   // node id (the subsidiary / owned entity)
  kind: EdgeKind;
  /** Percentage for `owns` edges; 0 for `controls` and `directs`. */
  percentage: number;
  /** Date the relationship was established / last verified (ISO). */
  asOf?: string;
}

export interface UboGraph {
  nodes: Map<string, UboNode>;
  edges: UboEdge[];
}

export interface EffectiveOwner {
  nodeId: string;
  name: string;
  type: NodeType;
  effectivePercentage: number;
  /** The set of paths contributing to the effective percentage. */
  paths: Array<{ path: string[]; percentage: number }>;
  isUBO: boolean;
  sanctionsFlag: boolean;
  pepFlag: boolean;
}

export interface SanctionsProximity {
  hops: number | null;
  flaggedNode: UboNode | null;
  path: string[];
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

export function createGraph(): UboGraph {
  return { nodes: new Map(), edges: [] };
}

export function addNode(graph: UboGraph, node: UboNode): void {
  graph.nodes.set(node.id, node);
}

export function addEdge(graph: UboGraph, edge: UboEdge): void {
  if (!graph.nodes.has(edge.from)) {
    throw new Error(`addEdge: unknown from-node ${edge.from}`);
  }
  if (!graph.nodes.has(edge.to)) {
    throw new Error(`addEdge: unknown to-node ${edge.to}`);
  }
  if (edge.kind === 'owns' && (edge.percentage < 0 || edge.percentage > 100)) {
    throw new Error(`addEdge: owns percentage must be 0..100, got ${edge.percentage}`);
  }
  graph.edges.push(edge);
}

// ---------------------------------------------------------------------------
// Effective ownership — DFS path product, summed across paths
// ---------------------------------------------------------------------------

/**
 * Compute the effective ownership of every natural_person who owns
 * (directly or indirectly) ≥ `threshold`% of the target entity.
 *
 * Cycle detection: we track the current path and skip any edge that
 * would revisit a node already in the path.
 *
 * Default threshold matches Cabinet Decision 109/2023 (25%).
 */
export function effectiveOwnersOf(
  graph: UboGraph,
  targetId: string,
  threshold = 25,
): EffectiveOwner[] {
  if (!graph.nodes.has(targetId)) {
    throw new Error(`effectiveOwnersOf: unknown target ${targetId}`);
  }

  // Aggregate: nodeId → sum of path percentages, plus each path
  const agg = new Map<
    string,
    { sum: number; paths: Array<{ path: string[]; percentage: number }> }
  >();

  // Build a "parents of X" index so we can walk up from the target.
  const parentsOf = new Map<string, UboEdge[]>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'owns') continue;
    const list = parentsOf.get(edge.to) ?? [];
    list.push(edge);
    parentsOf.set(edge.to, list);
  }

  // DFS upward. At each step, accumulate the product of percentages.
  const walk = (current: string, productPct: number, path: string[]): void => {
    const parents = parentsOf.get(current) ?? [];
    for (const edge of parents) {
      if (path.includes(edge.from)) continue; // cycle guard
      const nextPct = (productPct * edge.percentage) / 100;
      const nextPath = [edge.from, ...path];
      const parentNode = graph.nodes.get(edge.from);
      if (!parentNode) continue;
      // Every node we encounter on the way up is an owner — record the
      // contribution at this level, then recurse higher.
      const existing = agg.get(edge.from) ?? { sum: 0, paths: [] };
      existing.sum += nextPct;
      existing.paths.push({ path: nextPath, percentage: nextPct });
      agg.set(edge.from, existing);
      walk(edge.from, nextPct, nextPath);
    }
  };

  walk(targetId, 100, [targetId]);

  const out: EffectiveOwner[] = [];
  for (const [nodeId, { sum, paths }] of agg) {
    const node = graph.nodes.get(nodeId);
    if (!node) continue;
    // Round to 2 decimal places to avoid fp noise
    const rounded = Math.round(sum * 100) / 100;
    out.push({
      nodeId,
      name: node.name,
      type: node.type,
      effectivePercentage: rounded,
      paths,
      isUBO: rounded >= threshold && node.type === 'natural_person',
      sanctionsFlag: node.sanctionsFlag === true,
      pepFlag: node.pepFlag === true,
    });
  }
  // Sort by effective percentage descending
  out.sort((a, b) => b.effectivePercentage - a.effectivePercentage);
  return out;
}

/** Convenience: only natural persons with ≥ threshold% effective ownership. */
export function ubosOf(
  graph: UboGraph,
  targetId: string,
  threshold = 25,
): EffectiveOwner[] {
  return effectiveOwnersOf(graph, targetId, threshold).filter((o) => o.isUBO);
}

// ---------------------------------------------------------------------------
// Sanctions proximity — BFS to nearest flagged node
// ---------------------------------------------------------------------------

/**
 * Find the nearest sanctioned node reachable from `targetId` by walking
 * upward along `owns` edges. Returns hops=0 if the target itself is
 * flagged. Returns hops=null if no flagged node is found.
 *
 * Used to answer: "is there a sanctioned entity anywhere in the
 * ownership chain of this customer?"
 */
export function sanctionsProximity(
  graph: UboGraph,
  targetId: string,
  maxHops = 5,
): SanctionsProximity {
  const target = graph.nodes.get(targetId);
  if (!target) {
    return { hops: null, flaggedNode: null, path: [] };
  }
  if (target.sanctionsFlag) {
    return { hops: 0, flaggedNode: target, path: [targetId] };
  }

  const parentsOf = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'owns') continue;
    const list = parentsOf.get(edge.to) ?? [];
    list.push(edge.from);
    parentsOf.set(edge.to, list);
  }

  // BFS upward
  interface Frame {
    nodeId: string;
    hops: number;
    path: string[];
  }
  const queue: Frame[] = [{ nodeId: targetId, hops: 0, path: [targetId] }];
  const visited = new Set<string>([targetId]);

  while (queue.length > 0) {
    const frame = queue.shift()!;
    if (frame.hops >= maxHops) continue;
    const parents = parentsOf.get(frame.nodeId) ?? [];
    for (const parentId of parents) {
      if (visited.has(parentId)) continue;
      visited.add(parentId);
      const parentNode = graph.nodes.get(parentId);
      if (!parentNode) continue;
      const nextPath = [parentId, ...frame.path];
      if (parentNode.sanctionsFlag) {
        return {
          hops: frame.hops + 1,
          flaggedNode: parentNode,
          path: nextPath,
        };
      }
      queue.push({ nodeId: parentId, hops: frame.hops + 1, path: nextPath });
    }
  }

  return { hops: null, flaggedNode: null, path: [] };
}

// ---------------------------------------------------------------------------
// Risk aggregation — one shot summary for a customer
// ---------------------------------------------------------------------------

export interface UboRiskSummary {
  targetId: string;
  targetName: string;
  ubos: EffectiveOwner[];
  effectiveOwners: EffectiveOwner[];
  sanctionsProximity: SanctionsProximity;
  /** True if any UBO has a PEP flag. */
  hasPepUbo: boolean;
  /** True if any UBO has a sanctions flag. */
  hasSanctionedUbo: boolean;
  /** Highest effective percentage held by any single owner. */
  maxConcentration: number;
  /** True if the sum of UBO percentages is < 100 — i.e. some
   *  percentage is unaccounted for, which is a red flag under
   *  Cabinet Decision 109/2023 (implies undisclosed ownership). */
  hasUndisclosedPortion: boolean;
  /** The undisclosed percentage (100 - sum of direct declared owners). */
  undisclosedPercentage: number;
}

export function summariseUboRisk(
  graph: UboGraph,
  targetId: string,
  threshold = 25,
): UboRiskSummary {
  const target = graph.nodes.get(targetId);
  if (!target) {
    throw new Error(`summariseUboRisk: unknown target ${targetId}`);
  }
  const owners = effectiveOwnersOf(graph, targetId, threshold);
  const ubos = owners.filter((o) => o.isUBO);
  const prox = sanctionsProximity(graph, targetId);

  // Direct ownership check: sum of `owns` edges pointing AT target
  const directSum = graph.edges
    .filter((e) => e.to === targetId && e.kind === 'owns')
    .reduce((acc, e) => acc + e.percentage, 0);
  const undisclosedPercentage = Math.max(0, Math.round((100 - directSum) * 100) / 100);

  return {
    targetId,
    targetName: target.name,
    ubos,
    effectiveOwners: owners,
    sanctionsProximity: prox,
    hasPepUbo: ubos.some((u) => u.pepFlag),
    hasSanctionedUbo: ubos.some((u) => u.sanctionsFlag),
    maxConcentration: owners[0]?.effectivePercentage ?? 0,
    hasUndisclosedPortion: undisclosedPercentage > 0,
    undisclosedPercentage,
  };
}
