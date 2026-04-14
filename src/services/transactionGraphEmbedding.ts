/**
 * Transaction Graph Embedding — structural feature embedding for
 * entities in a transaction graph.
 *
 * Why this exists:
 *   Cross-case pattern correlator already detects wallet reuse,
 *   shared UBO rings, and address reuse through exact-match
 *   grouping. That catches the easy cases but misses the
 *   STRUCTURAL layering patterns — where two entities have the
 *   same "shape" of counterparty network without sharing a
 *   single direct link. FATF Rec 11/20 and the UAE DPMS
 *   typology guidance both flag structural similarity as a
 *   high-value AML signal.
 *
 *   This module builds a per-node structural feature embedding
 *   from a transaction edge list. Each node gets a fixed-length
 *   vector of graph-theoretic features (in/out degree, weighted
 *   flow, reciprocity, clustering coefficient proxy, bridge
 *   score). Cosine similarity between embeddings reveals
 *   entities with similar transaction behaviour even when they
 *   have no direct link.
 *
 *   Pure function, no network, no state. No heavy math deps —
 *   everything is a few passes over the edge list. Deterministic
 *   — same input → same embedding.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO — reasoned detection)
 *   FATF Rec 11             (record keeping + analysis)
 *   FATF Rec 20             (ongoing monitoring)
 *   MoE Circular 08/AML/2021 (DPMS pattern analysis)
 *   NIST AI RMF 1.0 MEASURE-2 (quantitative AI risk measurement)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransactionEdge {
  /** Opaque source node id. */
  from: string;
  /** Opaque target node id. */
  to: string;
  /** Edge weight (transaction value in AED). */
  weightAED: number;
}

export interface NodeEmbedding {
  /** Node id. */
  node: string;
  /**
   * 8-dimensional structural feature vector:
   *   [0] inDegree          — count of unique incoming edges
   *   [1] outDegree         — count of unique outgoing edges
   *   [2] weightedInFlow    — sum of incoming AED (log-scaled)
   *   [3] weightedOutFlow   — sum of outgoing AED (log-scaled)
   *   [4] reciprocity       — fraction of bi-directional edges
   *   [5] clusteringProxy   — normalised triangle density
   *   [6] bridgeScore       — shortest-path centrality proxy
   *   [7] selfLoopFlag      — binary indicator for self-edges
   */
  vector: readonly number[];
}

export interface GraphEmbeddingReport {
  schemaVersion: 1;
  nodeCount: number;
  edgeCount: number;
  embeddings: readonly NodeEmbedding[];
  /** Top-K cosine-similar node pairs, excluding self-pairs. */
  similarPairs: ReadonlyArray<{
    a: string;
    b: string;
    cosine: number;
  }>;
  /** Plain-English summary for the MLRO. */
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMBED_DIM = 8;

function logScale(x: number): number {
  if (x <= 0) return 0;
  return Math.log10(1 + x);
}

function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EmbedOptions {
  /** Top-K similar pairs to emit. Default 10. */
  topK?: number;
  /** Minimum cosine similarity to include in the pair list. Default 0.9. */
  minSimilarity?: number;
}

/**
 * Build per-node structural embeddings from a transaction edge list.
 * Pure function. Runs in O(E) for feature counts and O(N^2 * D) for
 * the similarity pass — safe for graphs up to ~2000 nodes per call.
 */
export function embedTransactionGraph(
  edges: readonly TransactionEdge[],
  opts: EmbedOptions = {}
): GraphEmbeddingReport {
  const topK = opts.topK ?? 10;
  const minSim = opts.minSimilarity ?? 0.9;

  // Edge hygiene — drop invalid rows but never throw.
  const clean: TransactionEdge[] = [];
  for (const e of edges) {
    if (!e || typeof e.from !== 'string' || typeof e.to !== 'string') continue;
    if (e.from.length === 0 || e.to.length === 0) continue;
    const w = typeof e.weightAED === 'number' && Number.isFinite(e.weightAED) ? e.weightAED : 0;
    clean.push({ from: e.from, to: e.to, weightAED: Math.max(0, w) });
  }

  // Per-node accumulators.
  const inSet = new Map<string, Set<string>>();
  const outSet = new Map<string, Set<string>>();
  const inFlow = new Map<string, number>();
  const outFlow = new Map<string, number>();
  const selfLoops = new Set<string>();
  // Undirected adjacency for clustering + bridge.
  const neigh = new Map<string, Set<string>>();

  function ensure<K, V>(m: Map<K, V>, k: K, def: () => V): V {
    let v = m.get(k);
    if (v === undefined) {
      v = def();
      m.set(k, v);
    }
    return v;
  }

  for (const e of clean) {
    if (e.from === e.to) selfLoops.add(e.from);
    ensure(inSet, e.to, () => new Set<string>()).add(e.from);
    ensure(outSet, e.from, () => new Set<string>()).add(e.to);
    inFlow.set(e.to, (inFlow.get(e.to) ?? 0) + e.weightAED);
    outFlow.set(e.from, (outFlow.get(e.from) ?? 0) + e.weightAED);
    ensure(neigh, e.from, () => new Set<string>()).add(e.to);
    ensure(neigh, e.to, () => new Set<string>()).add(e.from);
  }

  const nodes = Array.from(
    new Set<string>([...inSet.keys(), ...outSet.keys(), ...neigh.keys()])
  ).sort();

  const embeddings: NodeEmbedding[] = [];

  // Max flow for normalisation of the bridge score.
  let maxFlow = 0;
  for (const f of inFlow.values()) if (f > maxFlow) maxFlow = f;
  for (const f of outFlow.values()) if (f > maxFlow) maxFlow = f;
  const flowNorm = maxFlow > 0 ? logScale(maxFlow) : 1;

  for (const node of nodes) {
    const inN = inSet.get(node) ?? new Set<string>();
    const outN = outSet.get(node) ?? new Set<string>();
    const inDeg = inN.size;
    const outDeg = outN.size;
    const inW = inFlow.get(node) ?? 0;
    const outW = outFlow.get(node) ?? 0;

    // Reciprocity — fraction of neighbours that are both in and out.
    const recipCount = (() => {
      let c = 0;
      for (const n of inN) if (outN.has(n)) c += 1;
      return c;
    })();
    const totalEdges = inDeg + outDeg;
    const reciprocity = totalEdges > 0 ? (2 * recipCount) / totalEdges : 0;

    // Clustering coefficient proxy — fraction of neighbour pairs
    // that are themselves connected. Uses the undirected adjacency
    // map so it works on asymmetric transaction graphs too.
    const undirected = neigh.get(node) ?? new Set<string>();
    const k = undirected.size;
    let triangles = 0;
    if (k >= 2) {
      const arr = Array.from(undirected);
      for (let i = 0; i < arr.length; i++) {
        const ni = neigh.get(arr[i]!);
        if (!ni) continue;
        for (let j = i + 1; j < arr.length; j++) {
          if (ni.has(arr[j]!)) triangles += 1;
        }
      }
    }
    const possible = k >= 2 ? (k * (k - 1)) / 2 : 0;
    const clusteringProxy = possible > 0 ? triangles / possible : 0;

    // Bridge score — log(degree) * (1 - clustering). High degree +
    // low clustering = bridge-like (layering suspect).
    const bridgeScore = (k > 0 ? Math.log10(1 + k) : 0) * (1 - clusteringProxy);

    const selfLoopFlag = selfLoops.has(node) ? 1 : 0;

    embeddings.push({
      node,
      vector: [
        inDeg,
        outDeg,
        logScale(inW) / (flowNorm || 1),
        logScale(outW) / (flowNorm || 1),
        reciprocity,
        clusteringProxy,
        bridgeScore,
        selfLoopFlag,
      ],
    });
  }

  // Cosine similarity — top-K pairs above minSim.
  const pairs: Array<{ a: string; b: string; cosine: number }> = [];
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      const sim = cosine(embeddings[i]!.vector, embeddings[j]!.vector);
      if (sim >= minSim) {
        pairs.push({ a: embeddings[i]!.node, b: embeddings[j]!.node, cosine: sim });
      }
    }
  }
  pairs.sort((x, y) => y.cosine - x.cosine);
  const similarPairs = pairs.slice(0, topK);

  const summary =
    embeddings.length === 0
      ? 'Empty transaction graph — no embeddings produced.'
      : `Embedded ${embeddings.length} node(s), ${clean.length} edge(s). ` +
        `${similarPairs.length} high-similarity pair(s) at cosine ≥ ${minSim.toFixed(2)}.`;

  return {
    schemaVersion: 1,
    nodeCount: embeddings.length,
    edgeCount: clean.length,
    embeddings,
    similarPairs,
    summary,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'FATF Rec 11',
      'FATF Rec 20',
      'MoE Circular 08/AML/2021',
      'NIST AI RMF 1.0 MEASURE-2',
    ],
  };
}

// Exports for tests.
export const __test__ = { cosine, logScale, EMBED_DIM };
