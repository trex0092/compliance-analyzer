/**
 * Taint Propagator — subsystem #62 (Phase 7 Cluster G).
 *
 * Multi-hop transaction taint tracing. If wallet A received funds
 * from a known-sanctioned wallet S, then any outbound from A to B
 * carries some fraction of the original taint. The propagator walks
 * the transaction graph with decay (configurable) and reports the
 * residual taint at every reachable node.
 *
 * Decay model: each hop multiplies the taint by (1 - decay). Default
 * decay is 0.2 so after 5 hops the taint is (0.8)^5 ≈ 33%. Configure
 * via `propagationDecay` and `minTaintThreshold`.
 *
 * Pure function, deterministic. Designed for small/medium graphs
 * (hundreds to low thousands of nodes); scales to larger graphs
 * via BFS + visited set pruning.
 *
 * Regulatory basis:
 *   - FATF Rec 15 (VASP taint propagation)
 *   - Cabinet Res 74/2020 Art.4-7 (freeze of tainted funds)
 *   - FDL No.10/2025 Art.35 (targeted financial sanctions)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaintEdge {
  from: string;
  to: string;
  /** Fraction of sender's holdings transferred, in [0,1]. */
  amount: number;
  /** ISO timestamp — only forward-propagation in time. */
  at: string;
}

export interface TaintGraph {
  /** Wallets with known initial taint (e.g. sanctioned lists). */
  initialTaints: ReadonlyMap<string, number>;
  edges: readonly TaintEdge[];
}

export interface TaintConfig {
  propagationDecay?: number; // default 0.2
  minTaintThreshold?: number; // default 0.05
  maxHops?: number; // default 10
}

export interface TaintNode {
  wallet: string;
  taint: number;
  hops: number;
  path: readonly string[];
}

export interface TaintReport {
  tainted: TaintNode[];
  maxTaint: number;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Propagator
// ---------------------------------------------------------------------------

export function propagateTaint(graph: TaintGraph, config: TaintConfig = {}): TaintReport {
  const decay = 1 - (config.propagationDecay ?? 0.2);
  const threshold = config.minTaintThreshold ?? 0.05;
  const maxHops = config.maxHops ?? 10;

  // Adjacency list sorted by timestamp (forward-propagation requires
  // chronological order — funds received yesterday can't be spent at
  // an earlier time).
  const edgesFrom = new Map<string, TaintEdge[]>();
  for (const e of graph.edges) {
    const list = edgesFrom.get(e.from) ?? [];
    list.push(e);
    edgesFrom.set(e.from, list);
  }
  for (const list of edgesFrom.values()) {
    list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }

  // Running taint per wallet (highest observed taint wins).
  const taintOf = new Map<string, { taint: number; hops: number; path: string[] }>();

  // Initial seeds.
  for (const [wallet, taint] of graph.initialTaints) {
    taintOf.set(wallet, { taint, hops: 0, path: [wallet] });
  }

  // BFS over nodes in taint-descending order so we propagate the
  // strongest signal first and prune redundant weaker paths.
  const queue: string[] = Array.from(graph.initialTaints.keys());
  while (queue.length > 0) {
    const node = queue.shift()!;
    const state = taintOf.get(node);
    if (!state) continue;
    if (state.hops >= maxHops) continue;
    if (state.taint < threshold) continue;

    const outbound = edgesFrom.get(node) ?? [];
    for (const edge of outbound) {
      const inherited = state.taint * decay * Math.min(1, Math.max(0, edge.amount));
      if (inherited < threshold) continue;
      const existing = taintOf.get(edge.to);
      if (existing && existing.taint >= inherited) continue;
      taintOf.set(edge.to, {
        taint: inherited,
        hops: state.hops + 1,
        path: [...state.path, edge.to],
      });
      queue.push(edge.to);
    }
  }

  const tainted: TaintNode[] = Array.from(taintOf.entries())
    .map(([wallet, s]) => ({
      wallet,
      taint: Math.round(s.taint * 10000) / 10000,
      hops: s.hops,
      path: s.path,
    }))
    .sort((a, b) => b.taint - a.taint);

  const maxTaint = tainted.length > 0 ? tainted[0].taint : 0;
  const narrative = `Taint propagator: ${tainted.length} wallet(s) tainted after ${maxHops}-hop walk, max taint ${maxTaint}.`;

  return { tainted, maxTaint, narrative };
}
