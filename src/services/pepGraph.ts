/**
 * PEP Graph — Politically Exposed Person graph with family + Known
 * Close Associate (KCA) edges and UBO linkage. Closes the biggest
 * coverage gap vs Refinitiv WorldCheck.
 *
 * Data model:
 *   - Nodes: PEP, family member, KCA, or entity (for UBO chains).
 *   - Edges: typed and weighted (spouse > sibling > business associate).
 *   - Match: traverses up to N hops from a seed node to surface
 *     indirect exposure ("sanctions by association", FATF Rec 12).
 *
 * Data sources are pluggable via `PepGraphLoader`. Open-data options:
 *   - OpenSanctions PEP dataset (Creative Commons)
 *   - LittleSis (Creative Commons Attribution-ShareAlike)
 *   - Wikidata (CC0)
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.14 (PEP EDD + board approval)
 *   - FATF Rec 12 (PEP requirements)
 *   - FDL No.10/2025 Art.13 (EDD for high-risk)
 */

export type PepRole =
  | 'pep_domestic'
  | 'pep_foreign'
  | 'pep_international'
  | 'family'
  | 'kca'
  | 'entity';

export type PepEdgeType =
  | 'spouse'
  | 'parent'
  | 'child'
  | 'sibling'
  | 'business_associate'
  | 'board_member'
  | 'ubo_of'
  | 'controls'
  | 'employer';

export interface PepNode {
  id: string;
  name: string;
  aliases?: string[];
  role: PepRole;
  jurisdiction?: string;
  position?: string;
  since?: string;
  until?: string;
  /** Source identifier — e.g. 'OpenSanctions:peps:2026-04-15'. */
  source: string;
  /** Confidence in the PEP classification itself, 0..1. */
  confidence: number;
}

export interface PepEdge {
  from: string;
  to: string;
  type: PepEdgeType;
  /**
   * Weight: how much PEP status "transfers" across this edge.
   * 1.0 = direct, 0.8 = spouse/parent/child, 0.5 = sibling,
   * 0.3 = business associate, 0.2 = board member.
   */
  weight: number;
  /** Ownership % for UBO edges (Cabinet Decision 109/2023 >25% rule). */
  ownershipPct?: number;
}

export interface PepGraph {
  nodes: Map<string, PepNode>;
  edges: PepEdge[];
  fetchedAt: number;
}

export interface PepMatchSubject {
  name: string;
  aliases?: string[];
  jurisdiction?: string;
}

export interface PepMatchPath {
  /** Ordered node ids from the subject's direct match to the source PEP. */
  nodeIds: string[];
  edgeTypes: PepEdgeType[];
  /** Cumulative weight = product of edge weights along the path. */
  accumulatedWeight: number;
}

export interface PepMatch {
  /** The node the subject directly matched on. */
  seed: PepNode;
  /** Subject's match score on the seed, 0..1 (Jaro-Winkler style). */
  nameScore: number;
  /** Paths from the seed to any role=PEP node within `maxHops`. */
  pepPaths: PepMatchPath[];
  /** Highest PEP exposure after propagating through the graph. */
  pepExposure: number;
  /** Role attributed to the subject given the best path. */
  attributedRole: PepRole;
  /** UBO chains (if the subject is an entity and controls PEPs). */
  uboChains: PepMatchPath[];
}

export interface PepMatchConfig {
  /** Minimum subject-to-seed name similarity to trigger a match. Default 0.85. */
  nameThreshold?: number;
  /** Max hops from the seed. Default 3 — covers spouse, parent, UBO-of-UBO. */
  maxHops?: number;
  /** Normalize the final exposure to 0..1. Default true. */
  normalize?: boolean;
}

export type PepGraphLoader = () => Promise<PepGraph> | PepGraph;

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Match a subject against a PEP graph. Returns a match per seed node
 * that exceeds the name threshold, each enriched with paths to the
 * strongest PEP in the neighborhood.
 *
 * Pure — no I/O. Feed it a PepGraph from your loader of choice.
 */
export function matchAgainstPepGraph(
  subject: PepMatchSubject,
  graph: PepGraph,
  config: PepMatchConfig = {}
): PepMatch[] {
  const threshold = config.nameThreshold ?? 0.85;
  const maxHops = config.maxHops ?? 3;
  const out: PepMatch[] = [];

  const subjectName = normalize(subject.name);
  const subjectAliases = (subject.aliases ?? []).map(normalize);

  for (const node of graph.nodes.values()) {
    const candidates = [normalize(node.name), ...(node.aliases ?? []).map(normalize)];
    let best = 0;
    for (const cand of candidates) {
      const s1 = similarity(subjectName, cand);
      if (s1 > best) best = s1;
      for (const alias of subjectAliases) {
        const s2 = similarity(alias, cand);
        if (s2 > best) best = s2;
      }
    }
    if (best < threshold) continue;

    const pepPaths = findPepPaths(graph, node.id, maxHops);
    const uboChains =
      node.role === 'entity' ? findUboChains(graph, node.id, maxHops) : [];
    const exposure = computeExposure(node, pepPaths);
    const attributedRole = deriveRole(node, pepPaths);

    out.push({
      seed: node,
      nameScore: best,
      pepPaths,
      pepExposure: config.normalize === false ? exposure : clamp01(exposure),
      attributedRole,
      uboChains,
    });
  }

  out.sort((a, b) => b.pepExposure - a.pepExposure);
  return out;
}

function findPepPaths(graph: PepGraph, seedId: string, maxHops: number): PepMatchPath[] {
  const start = graph.nodes.get(seedId);
  if (!start) return [];
  const paths: PepMatchPath[] = [];
  // BFS carrying the path.
  const queue: Array<{ id: string; trail: string[]; edges: PepEdgeType[]; weight: number }> = [
    { id: seedId, trail: [seedId], edges: [], weight: 1 },
  ];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const node = graph.nodes.get(cur.id);
    if (!node) continue;
    const isPep =
      node.role === 'pep_domestic' ||
      node.role === 'pep_foreign' ||
      node.role === 'pep_international';
    if (isPep && cur.trail.length > 1) {
      paths.push({
        nodeIds: cur.trail,
        edgeTypes: cur.edges,
        accumulatedWeight: cur.weight,
      });
    }
    if (cur.trail.length - 1 >= maxHops) continue;
    const key = cur.id + '|' + cur.trail.length;
    if (visited.has(key)) continue;
    visited.add(key);
    for (const edge of graph.edges) {
      if (edge.from !== cur.id) continue;
      if (cur.trail.includes(edge.to)) continue; // no cycles
      queue.push({
        id: edge.to,
        trail: [...cur.trail, edge.to],
        edges: [...cur.edges, edge.type],
        weight: cur.weight * edge.weight,
      });
    }
  }
  // Include the seed-itself case if the seed IS a PEP.
  if (
    start.role === 'pep_domestic' ||
    start.role === 'pep_foreign' ||
    start.role === 'pep_international'
  ) {
    paths.unshift({
      nodeIds: [seedId],
      edgeTypes: [],
      accumulatedWeight: 1,
    });
  }
  paths.sort((a, b) => b.accumulatedWeight - a.accumulatedWeight);
  return paths;
}

function findUboChains(graph: PepGraph, seedId: string, maxHops: number): PepMatchPath[] {
  const chains: PepMatchPath[] = [];
  const queue: Array<{ id: string; trail: string[]; edges: PepEdgeType[]; weight: number }> = [
    { id: seedId, trail: [seedId], edges: [], weight: 1 },
  ];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.trail.length > 1) chains.push({
      nodeIds: cur.trail,
      edgeTypes: cur.edges,
      accumulatedWeight: cur.weight,
    });
    if (cur.trail.length - 1 >= maxHops) continue;
    for (const edge of graph.edges) {
      if (edge.from !== cur.id) continue;
      if (edge.type !== 'ubo_of' && edge.type !== 'controls' && edge.type !== 'board_member')
        continue;
      if (cur.trail.includes(edge.to)) continue;
      // Only surface UBO edges that clear Cabinet Decision 109/2023 >25%.
      if (edge.type === 'ubo_of' && (edge.ownershipPct ?? 0) < 25) continue;
      queue.push({
        id: edge.to,
        trail: [...cur.trail, edge.to],
        edges: [...cur.edges, edge.type],
        weight: cur.weight * edge.weight,
      });
    }
  }
  return chains;
}

function computeExposure(seed: PepNode, paths: PepMatchPath[]): number {
  if (
    seed.role === 'pep_domestic' ||
    seed.role === 'pep_foreign' ||
    seed.role === 'pep_international'
  ) {
    return seed.confidence;
  }
  if (paths.length === 0) return 0;
  const top = paths[0];
  return top.accumulatedWeight * seed.confidence;
}

function deriveRole(seed: PepNode, paths: PepMatchPath[]): PepRole {
  if (
    seed.role === 'pep_domestic' ||
    seed.role === 'pep_foreign' ||
    seed.role === 'pep_international'
  )
    return seed.role;
  if (paths.length === 0) return seed.role;
  const top = paths[0];
  // If the first hop is spouse/parent/child/sibling → family.
  const firstEdge = top.edgeTypes[0];
  if (
    firstEdge === 'spouse' ||
    firstEdge === 'parent' ||
    firstEdge === 'child' ||
    firstEdge === 'sibling'
  )
    return 'family';
  return 'kca';
}

// ---------------------------------------------------------------------------
// Similarity (lightweight Jaro-Winkler)
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  // Jaro
  const matchDist = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches: boolean[] = new Array(a.length).fill(false);
  const bMatches: boolean[] = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, b.length);
    for (let j = start; j < end; j += 1) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }
  const jaro =
    (matches / a.length +
      matches / b.length +
      (matches - transpositions / 2) / matches) /
    3;
  // Winkler prefix bonus.
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i += 1) {
    if (a[i] === b[i]) prefix += 1;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

/** Build a PepGraph from a flat list of nodes + edges. */
export function buildPepGraph(nodes: PepNode[], edges: PepEdge[]): PepGraph {
  const map = new Map<string, PepNode>();
  for (const n of nodes) map.set(n.id, n);
  return { nodes: map, edges, fetchedAt: Date.now() };
}

/** Seed graph — small example for tests + demo. Callers SHOULD replace with a real loader. */
export const SEED_PEP_GRAPH: PepGraph = buildPepGraph(
  [
    {
      id: 'pep-001',
      name: 'Amina Al Mansouri',
      role: 'pep_domestic',
      jurisdiction: 'AE',
      position: 'Minister of Finance',
      since: '2022-01-01',
      source: 'seed',
      confidence: 0.95,
    },
    {
      id: 'pep-002',
      name: 'Omar Al Mansouri',
      role: 'family',
      jurisdiction: 'AE',
      source: 'seed',
      confidence: 0.85,
    },
    {
      id: 'pep-003',
      name: 'BlueGold Trading FZE',
      role: 'entity',
      jurisdiction: 'AE',
      source: 'seed',
      confidence: 0.9,
    },
  ],
  [
    { from: 'pep-002', to: 'pep-001', type: 'spouse', weight: 0.8 },
    { from: 'pep-003', to: 'pep-002', type: 'ubo_of', weight: 0.7, ownershipPct: 40 },
  ]
);
