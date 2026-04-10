/**
 * UBO Layering + Shell Company Detection.
 *
 * Extends the existing UboGraph primitive with three derived analyses
 * that catch the single biggest evasion pattern in DPMS:
 *
 *   1. LAYERING DEPTH  — the maximum chain length from a natural
 *      person down to the target entity. Chains longer than 4 layers
 *      are a FATF red flag (Typologies 2022).
 *
 *   2. SHELL COMPANY SCORE — legal entities with
 *        - 3+ layers to their controller
 *        - no declared economic activity
 *        - zero natural-person directors at the top
 *      get a shell-company score ∈ [0, 1]. ≥ 0.7 triggers EDD.
 *
 *   3. CONTROL PYRAMID — detects pyramids where a single natural
 *      person sits at the top of many separate entity chains that
 *      eventually all flow into the same target. Classic shell
 *      orchestration.
 *
 * The module is a pure analyser over the existing UboGraph. It does
 * not mutate the graph — it returns a report that can be added as
 * evidence to a reasoning chain or fed into the MegaBrain.
 *
 * Regulatory basis:
 *   - Cabinet Decision 109/2023 (UBO register with ≥25% threshold)
 *   - FATF DPMS Typologies 2022 Annex B (shell company patterns)
 *   - FATF Rec 24-25 (transparency of legal persons)
 *   - FDL Art.12-14 (CDD including UBO verification)
 */

import type { UboGraph, UboNode } from './uboGraph';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LayeringReport {
  targetId: string;
  maxDepth: number;
  longestPath: UboNode[];
  pathCount: number;
  exceedsFatfThreshold: boolean; // depth > 4
}

export interface ShellCompanyReport {
  entityId: string;
  layersToController: number;
  hasDeclaredActivity: boolean;
  topLevelNaturalPersonCount: number;
  shellScore: number; // [0, 1]
  verdict: 'likely-operating' | 'ambiguous' | 'probable-shell';
  explanation: string;
}

export interface ControlPyramidReport {
  targetId: string;
  apexes: Array<{
    personId: string;
    name: string;
    distinctChains: number;
  }>;
  isPyramid: boolean;
}

// ---------------------------------------------------------------------------
// Graph helpers — operate on the existing UboGraph structure
// ---------------------------------------------------------------------------

function childrenOf(graph: UboGraph, nodeId: string): string[] {
  return graph.edges
    .filter((e) => e.from === nodeId && (e.kind === 'owns' || e.kind === 'controls'))
    .map((e) => e.to);
}

function parentsOf(graph: UboGraph, nodeId: string): string[] {
  return graph.edges
    .filter((e) => e.to === nodeId && (e.kind === 'owns' || e.kind === 'controls'))
    .map((e) => e.from);
}

function nodeById(graph: UboGraph, id: string): UboNode | undefined {
  return graph.nodes.get(id);
}

// ---------------------------------------------------------------------------
// 1. Layering depth
// ---------------------------------------------------------------------------

export function analyseLayering(graph: UboGraph, targetId: string): LayeringReport {
  const target = nodeById(graph, targetId);
  if (!target) {
    return {
      targetId,
      maxDepth: 0,
      longestPath: [],
      pathCount: 0,
      exceedsFatfThreshold: false,
    };
  }

  // Find all paths from ANY root ancestor (node with no parents) DOWN
  // to target. We prefer natural-person roots but also count pure-entity
  // chains, because a shell pyramid with no natural person at the top
  // IS the signal we want to catch.
  let maxDepth = 0;
  let longest: UboNode[] = [];
  let pathCount = 0;

  const stack: Array<{ node: string; path: UboNode[]; visited: Set<string> }> = [];

  // Find roots that reach target (reverse BFS from target).
  const reachableUp = new Set<string>([targetId]);
  const queue = [targetId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const p of parentsOf(graph, id)) {
      if (!reachableUp.has(p)) {
        reachableUp.add(p);
        queue.push(p);
      }
    }
  }
  // Start DFS from every reachable ancestor with no parents of its own.
  for (const node of graph.nodes.values()) {
    if (!reachableUp.has(node.id)) continue;
    if (parentsOf(graph, node.id).length > 0) continue;
    stack.push({ node: node.id, path: [node], visited: new Set([node.id]) });
  }

  while (stack.length > 0) {
    const frame = stack.pop()!;
    const { node, path, visited } = frame;
    if (node === targetId) {
      pathCount++;
      if (path.length > maxDepth) {
        maxDepth = path.length;
        longest = [...path];
      }
      continue;
    }
    for (const child of childrenOf(graph, node)) {
      if (visited.has(child)) continue;
      const childNode = nodeById(graph, child);
      if (!childNode) continue;
      const nextVisited = new Set(visited);
      nextVisited.add(child);
      stack.push({ node: child, path: [...path, childNode], visited: nextVisited });
    }
  }

  return {
    targetId,
    maxDepth,
    longestPath: longest,
    pathCount,
    exceedsFatfThreshold: maxDepth > 4,
  };
}

// ---------------------------------------------------------------------------
// 2. Shell company detection
// ---------------------------------------------------------------------------

export function analyseShellCompany(
  graph: UboGraph,
  entityId: string,
  metadata: { hasDeclaredActivity?: boolean } = {}
): ShellCompanyReport {
  const entity = nodeById(graph, entityId);
  if (!entity || entity.type !== 'legal_entity') {
    return {
      entityId,
      layersToController: 0,
      hasDeclaredActivity: true,
      topLevelNaturalPersonCount: 0,
      shellScore: 0,
      verdict: 'likely-operating',
      explanation: 'Not a legal entity.',
    };
  }

  const layering = analyseLayering(graph, entityId);
  const layersToController = layering.maxDepth > 0 ? layering.maxDepth - 1 : 0;

  // Top-level = natural person ancestors with no further parents.
  const visited = new Set<string>();
  const topLevel = new Set<string>();
  const queue = [entityId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodeById(graph, id);
    if (!node) continue;
    const parents = parentsOf(graph, id);
    if (parents.length === 0 && node.type === 'natural_person') {
      topLevel.add(id);
      continue;
    }
    for (const p of parents) queue.push(p);
  }
  const topLevelNaturalPersonCount = topLevel.size;
  const hasDeclaredActivity = metadata.hasDeclaredActivity ?? false;

  let score = 0;
  if (layersToController >= 3) score += 0.35;
  if (layersToController >= 5) score += 0.15;
  if (!hasDeclaredActivity) score += 0.3;
  if (topLevelNaturalPersonCount === 0) score += 0.2;
  score = Math.min(1, score);

  let verdict: ShellCompanyReport['verdict'];
  if (score >= 0.7) verdict = 'probable-shell';
  else if (score >= 0.4) verdict = 'ambiguous';
  else verdict = 'likely-operating';

  const explanation = `Layers=${layersToController}, natural-person tops=${topLevelNaturalPersonCount}, declared activity=${hasDeclaredActivity}. Shell score ${score.toFixed(2)} → ${verdict}.`;

  return {
    entityId,
    layersToController,
    hasDeclaredActivity,
    topLevelNaturalPersonCount,
    shellScore: round4(score),
    verdict,
    explanation,
  };
}

// ---------------------------------------------------------------------------
// 3. Control pyramid detector
// ---------------------------------------------------------------------------

export function analyseControlPyramid(graph: UboGraph, targetId: string): ControlPyramidReport {
  const apexes: ControlPyramidReport['apexes'] = [];

  for (const node of graph.nodes.values()) {
    if (node.type !== 'natural_person') continue;
    const chains = countDistinctChains(graph, node.id, targetId);
    if (chains >= 2) {
      apexes.push({
        personId: node.id,
        name: node.name,
        distinctChains: chains,
      });
    }
  }

  apexes.sort((a, b) => b.distinctChains - a.distinctChains);
  return {
    targetId,
    apexes,
    isPyramid: apexes.length > 0 && apexes[0].distinctChains >= 3,
  };
}

function countDistinctChains(graph: UboGraph, fromId: string, toId: string): number {
  // DFS counting simple paths (no cycle) from fromId to toId.
  let count = 0;
  const walk = (current: string, visited: Set<string>): void => {
    if (current === toId) {
      count++;
      return;
    }
    for (const child of childrenOf(graph, current)) {
      if (visited.has(child)) continue;
      const next = new Set(visited);
      next.add(child);
      walk(child, next);
    }
  };
  walk(fromId, new Set([fromId]));
  return count;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
