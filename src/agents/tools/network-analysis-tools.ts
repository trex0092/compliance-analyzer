/**
 * Network Analysis Engine
 *
 * Graph-based entity relationship detection for identifying:
 * - Shell company networks & circular ownership structures
 * - Hidden beneficial ownership chains (>25% threshold — Cabinet Decision 109/2023)
 * - Layering networks used for money laundering
 * - Hub entities connecting multiple high-risk nodes
 * - Counter-party clustering and community detection
 *
 * Uses adjacency list graph representation with BFS/DFS traversal,
 * cycle detection, centrality scoring, and community partitioning.
 *
 * Regulatory basis: FDL No.10/2025 Art.12-14, Cabinet Decision 109/2023,
 * FATF Rec 24/25 (Beneficial Ownership), LBMA RGG v9 Step 3
 */

import type { ToolResult } from '../mcp-server';
import { UBO_OWNERSHIP_THRESHOLD_PCT } from '../../domain/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntityNodeType = 'company' | 'individual' | 'trust' | 'foundation' | 'nominee' | 'unknown';
export type EdgeType = 'ownership' | 'directorship' | 'transaction' | 'family' | 'agent' | 'counterparty' | 'shared-address' | 'shared-phone';

export interface EntityNode {
  id: string;
  name: string;
  type: EntityNodeType;
  jurisdiction?: string;
  riskRating?: 'low' | 'medium' | 'high' | 'critical';
  pepStatus?: boolean;
  sanctionsMatch?: boolean;
  registrationDate?: string;
  metadata?: Record<string, unknown>;
}

export interface EntityEdge {
  source: string;
  target: string;
  type: EdgeType;
  weight: number; // ownership %, transaction volume, etc.
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface NetworkGraph {
  nodes: EntityNode[];
  edges: EntityEdge[];
}

export interface CycleDetection {
  hasCycles: boolean;
  cycles: string[][]; // arrays of node IDs forming cycles
  longestCycle: number;
  circularOwnership: Array<{
    path: string[];
    totalOwnership: number;
    riskImplication: string;
  }>;
}

export interface CentralityScore {
  nodeId: string;
  nodeName: string;
  degreeCentrality: number;     // how many connections
  betweennessCentrality: number; // how often on shortest paths
  closenessCentrality: number;   // average distance to all others
  hubScore: number;              // composite hub score
  isHub: boolean;
}

export interface CommunityCluster {
  id: number;
  members: string[];
  memberNames: string[];
  internalEdges: number;
  externalEdges: number;
  density: number;
  avgRisk: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface ShellCompanyIndicator {
  entityId: string;
  entityName: string;
  indicators: string[];
  confidence: number;
  riskScore: number;
}

export interface LayeringPath {
  path: string[];
  pathNames: string[];
  depth: number;
  totalValue: number;
  jurisdictions: string[];
  crossBorder: boolean;
  riskScore: number;
}

export interface NetworkAnalysisReport {
  analyzedAt: string;
  nodeCount: number;
  edgeCount: number;
  cycles: CycleDetection;
  centralityScores: CentralityScore[];
  topHubs: CentralityScore[];
  communities: CommunityCluster[];
  shellCompanyIndicators: ShellCompanyIndicator[];
  layeringPaths: LayeringPath[];
  hiddenOwnership: Array<{
    ultimateOwner: string;
    controlledEntity: string;
    indirectOwnership: number;
    path: string[];
    exceedsThreshold: boolean;
  }>;
  overallRiskScore: number;
  overallRiskLevel: 'low' | 'medium' | 'high' | 'critical';
  alerts: string[];
  regulatoryFindings: string[];
}

// ---------------------------------------------------------------------------
// Graph Construction
// ---------------------------------------------------------------------------

class AdjacencyGraph {
  private adjacency = new Map<string, Map<string, EntityEdge[]>>();
  private nodeMap = new Map<string, EntityNode>();

  constructor(graph: NetworkGraph) {
    for (const node of graph.nodes) {
      this.nodeMap.set(node.id, node);
      this.adjacency.set(node.id, new Map());
    }
    for (const edge of graph.edges) {
      if (!this.adjacency.has(edge.source)) this.adjacency.set(edge.source, new Map());
      const neighbors = this.adjacency.get(edge.source)!;
      if (!neighbors.has(edge.target)) neighbors.set(edge.target, []);
      neighbors.get(edge.target)!.push(edge);
    }
  }

  getNode(id: string): EntityNode | undefined { return this.nodeMap.get(id); }
  getNodes(): EntityNode[] { return Array.from(this.nodeMap.values()); }
  getNeighbors(id: string): string[] {
    return Array.from(this.adjacency.get(id)?.keys() ?? []);
  }
  getEdges(source: string, target: string): EntityEdge[] {
    return this.adjacency.get(source)?.get(target) ?? [];
  }
  getAllEdges(): EntityEdge[] {
    const edges: EntityEdge[] = [];
    for (const [, neighbors] of this.adjacency) {
      for (const [, edgeList] of neighbors) {
        edges.push(...edgeList);
      }
    }
    return edges;
  }
  nodeCount(): number { return this.nodeMap.size; }

  /** Get all neighbors (both directions for undirected analysis) */
  getUndirectedNeighbors(id: string): string[] {
    const neighbors = new Set(this.getNeighbors(id));
    for (const [nodeId, adj] of this.adjacency) {
      if (adj.has(id)) neighbors.add(nodeId);
    }
    neighbors.delete(id);
    return Array.from(neighbors);
  }
}

// ---------------------------------------------------------------------------
// Cycle Detection (DFS-based)
// ---------------------------------------------------------------------------

export function detectCycles(graph: NetworkGraph): CycleDetection {
  const adj = new AdjacencyGraph(graph);
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(node: string, path: string[]): void {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    for (const neighbor of adj.getNeighbors(node)) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path]);
      } else if (recStack.has(neighbor)) {
        // Found cycle — extract it
        const cycleStart = path.indexOf(neighbor);
        if (cycleStart >= 0) {
          cycles.push(path.slice(cycleStart));
        }
      }
    }

    recStack.delete(node);
  }

  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id, []);
    }
  }

  // Analyze circular ownership specifically
  const circularOwnership = cycles
    .filter((cycle) => {
      const edges = [];
      for (let i = 0; i < cycle.length; i++) {
        const next = cycle[(i + 1) % cycle.length];
        edges.push(...adj.getEdges(cycle[i], next));
      }
      return edges.some((e) => e.type === 'ownership');
    })
    .map((cycle) => {
      let totalOwnership = 1;
      for (let i = 0; i < cycle.length; i++) {
        const next = cycle[(i + 1) % cycle.length];
        const ownershipEdges = adj.getEdges(cycle[i], next).filter((e) => e.type === 'ownership');
        if (ownershipEdges.length > 0) {
          totalOwnership *= ownershipEdges[0].weight;
        }
      }
      return {
        path: cycle,
        totalOwnership,
        riskImplication: totalOwnership > 0.1
          ? 'Significant circular ownership — potential shell company structure'
          : 'Minor circular ownership — monitor',
      };
    });

  return {
    hasCycles: cycles.length > 0,
    cycles,
    longestCycle: cycles.reduce((max, c) => Math.max(max, c.length), 0),
    circularOwnership,
  };
}

// ---------------------------------------------------------------------------
// Centrality Analysis
// ---------------------------------------------------------------------------

export function calculateCentrality(graph: NetworkGraph): CentralityScore[] {
  const adj = new AdjacencyGraph(graph);
  const nodes = graph.nodes;
  const n = nodes.length;
  if (n === 0) return [];

  const scores: CentralityScore[] = [];

  // Betweenness centrality (Brandes algorithm simplified)
  const betweenness = new Map<string, number>();
  for (const node of nodes) betweenness.set(node.id, 0);

  for (const source of nodes) {
    // BFS from source
    const dist = new Map<string, number>();
    const paths = new Map<string, number>();
    const pred = new Map<string, string[]>();
    const stack: string[] = [];
    const queue: string[] = [];

    dist.set(source.id, 0);
    paths.set(source.id, 1);

    queue.push(source.id);
    while (queue.length > 0) {
      const v = queue.shift()!;
      stack.push(v);

      for (const w of adj.getUndirectedNeighbors(v)) {
        if (!dist.has(w)) {
          dist.set(w, (dist.get(v) ?? 0) + 1);
          queue.push(w);
        }
        if (dist.get(w) === (dist.get(v) ?? 0) + 1) {
          paths.set(w, (paths.get(w) ?? 0) + (paths.get(v) ?? 0));
          if (!pred.has(w)) pred.set(w, []);
          pred.get(w)!.push(v);
        }
      }
    }

    const delta = new Map<string, number>();
    for (const node of nodes) delta.set(node.id, 0);

    while (stack.length > 0) {
      const w = stack.pop()!;
      for (const v of (pred.get(w) ?? [])) {
        const d = ((paths.get(v) ?? 1) / (paths.get(w) ?? 1)) * (1 + (delta.get(w) ?? 0));
        delta.set(v, (delta.get(v) ?? 0) + d);
      }
      if (w !== source.id) {
        betweenness.set(w, (betweenness.get(w) ?? 0) + (delta.get(w) ?? 0));
      }
    }
  }

  // Normalize betweenness
  const maxBetweenness = Math.max(...Array.from(betweenness.values()), 1);

  for (const node of nodes) {
    const neighbors = adj.getUndirectedNeighbors(node.id);
    const degree = neighbors.length;
    const degreeCentrality = n > 1 ? degree / (n - 1) : 0;
    const betweennessNorm = (betweenness.get(node.id) ?? 0) / maxBetweenness;

    // Closeness: 1 / average distance
    let totalDist = 0;
    let reachable = 0;
    const visited = new Set<string>();
    const bfsQueue: Array<{ id: string; dist: number }> = [{ id: node.id, dist: 0 }];
    visited.add(node.id);
    while (bfsQueue.length > 0) {
      const { id, dist } = bfsQueue.shift()!;
      if (id !== node.id) { totalDist += dist; reachable++; }
      for (const nb of adj.getUndirectedNeighbors(id)) {
        if (!visited.has(nb)) { visited.add(nb); bfsQueue.push({ id: nb, dist: dist + 1 }); }
      }
    }
    const closenessCentrality = reachable > 0 ? reachable / totalDist : 0;

    const hubScore = (degreeCentrality * 0.3 + betweennessNorm * 0.5 + closenessCentrality * 0.2);

    scores.push({
      nodeId: node.id,
      nodeName: node.name,
      degreeCentrality: Math.round(degreeCentrality * 1000) / 1000,
      betweennessCentrality: Math.round(betweennessNorm * 1000) / 1000,
      closenessCentrality: Math.round(closenessCentrality * 1000) / 1000,
      hubScore: Math.round(hubScore * 1000) / 1000,
      isHub: hubScore > 0.5 || degree >= Math.max(3, Math.sqrt(n)),
    });
  }

  return scores.sort((a, b) => b.hubScore - a.hubScore);
}

// ---------------------------------------------------------------------------
// Community Detection (Label Propagation)
// ---------------------------------------------------------------------------

export function detectCommunities(graph: NetworkGraph): CommunityCluster[] {
  const adj = new AdjacencyGraph(graph);
  const labels = new Map<string, number>();
  const nodes = graph.nodes;

  // Initialize each node with unique label
  nodes.forEach((node, i) => labels.set(node.id, i));

  // Iterate until convergence
  for (let iter = 0; iter < 50; iter++) {
    let changed = false;
    const shuffled = [...nodes].sort(() => Math.random() - 0.5);

    for (const node of shuffled) {
      const neighbors = adj.getUndirectedNeighbors(node.id);
      if (neighbors.length === 0) continue;

      // Find most common label among neighbors
      const labelCounts = new Map<number, number>();
      for (const nb of neighbors) {
        const label = labels.get(nb) ?? 0;
        labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
      }

      let maxCount = 0;
      let bestLabel = labels.get(node.id) ?? 0;
      for (const [label, count] of labelCounts) {
        if (count > maxCount) { maxCount = count; bestLabel = label; }
      }

      if (bestLabel !== labels.get(node.id)) {
        labels.set(node.id, bestLabel);
        changed = true;
      }
    }

    if (!changed) break;
  }

  // Group by label
  const communities = new Map<number, string[]>();
  for (const [nodeId, label] of labels) {
    if (!communities.has(label)) communities.set(label, []);
    communities.get(label)!.push(nodeId);
  }

  const allEdges = adj.getAllEdges();
  const clusters: CommunityCluster[] = [];
  let clusterId = 0;

  for (const [, members] of communities) {
    if (members.length < 2) continue; // skip singletons

    const memberSet = new Set(members);
    const internal = allEdges.filter((e) => memberSet.has(e.source) && memberSet.has(e.target)).length;
    const external = allEdges.filter((e) =>
      (memberSet.has(e.source) && !memberSet.has(e.target)) ||
      (!memberSet.has(e.source) && memberSet.has(e.target)),
    ).length;

    const maxEdges = members.length * (members.length - 1);
    const density = maxEdges > 0 ? internal / maxEdges : 0;

    // Average risk of members
    const risks = members
      .map((id) => adj.getNode(id))
      .filter((n): n is EntityNode => !!n)
      .map((n) => {
        const riskMap = { low: 1, medium: 2, high: 3, critical: 4 };
        return riskMap[n.riskRating ?? 'low'] ?? 1;
      });
    const avgRisk = risks.length > 0 ? risks.reduce((a, b) => a + b, 0) / risks.length : 1;

    let riskLevel: CommunityCluster['riskLevel'] = 'low';
    if (avgRisk >= 3.5) riskLevel = 'critical';
    else if (avgRisk >= 2.5) riskLevel = 'high';
    else if (avgRisk >= 1.5) riskLevel = 'medium';

    clusters.push({
      id: clusterId++,
      members,
      memberNames: members.map((id) => adj.getNode(id)?.name ?? id),
      internalEdges: internal,
      externalEdges: external,
      density: Math.round(density * 1000) / 1000,
      avgRisk: Math.round(avgRisk * 100) / 100,
      riskLevel,
    });
  }

  return clusters.sort((a, b) => b.avgRisk - a.avgRisk);
}

// ---------------------------------------------------------------------------
// Shell Company Detection
// ---------------------------------------------------------------------------

export function detectShellCompanies(graph: NetworkGraph): ShellCompanyIndicator[] {
  const adj = new AdjacencyGraph(graph);
  const results: ShellCompanyIndicator[] = [];

  for (const node of graph.nodes) {
    if (node.type !== 'company') continue;

    const indicators: string[] = [];
    const neighbors = adj.getUndirectedNeighbors(node.id);
    const outEdges = adj.getNeighbors(node.id);

    // Indicator 1: Nominee directors / no real directors
    const directorEdges = graph.edges.filter(
      (e) => e.target === node.id && e.type === 'directorship',
    );
    const nomineeDirectors = directorEdges.filter((e) => {
      const source = adj.getNode(e.source);
      return source?.type === 'nominee';
    });
    if (nomineeDirectors.length > 0) indicators.push('Nominee director(s) detected');
    if (directorEdges.length === 0) indicators.push('No identified directors');

    // Indicator 2: Complex multi-layer ownership
    const ownershipDepth = getOwnershipDepth(node.id, adj, graph);
    if (ownershipDepth >= 4) indicators.push(`Deep ownership chain (${ownershipDepth} layers)`);

    // Indicator 3: High-risk jurisdiction with minimal operations
    if (node.jurisdiction && isOffshoreJurisdiction(node.jurisdiction)) {
      indicators.push(`Registered in offshore jurisdiction (${node.jurisdiction})`);
    }

    // Indicator 4: Shared registered address with other entities
    const sharedAddressEdges = graph.edges.filter(
      (e) => (e.source === node.id || e.target === node.id) && e.type === 'shared-address',
    );
    if (sharedAddressEdges.length >= 2) {
      indicators.push(`Shares address with ${sharedAddressEdges.length} other entities`);
    }

    // Indicator 5: Recent registration with high transaction volume
    if (node.registrationDate) {
      const age = (Date.now() - new Date(node.registrationDate).getTime()) / (365.25 * 86400_000);
      const txEdges = graph.edges.filter(
        (e) => (e.source === node.id || e.target === node.id) && e.type === 'transaction',
      );
      if (age < 1 && txEdges.length > 5) {
        indicators.push(`Young entity (${Math.round(age * 12)}mo) with ${txEdges.length} transaction links`);
      }
    }

    // Indicator 6: Circular ownership
    const hasCircular = graph.edges.some(
      (e) => e.source === node.id && e.type === 'ownership' &&
        graph.edges.some((e2) => e2.source === e.target && e2.target === node.id && e2.type === 'ownership'),
    );
    if (hasCircular) indicators.push('Circular ownership structure detected');

    if (indicators.length > 0) {
      const confidence = Math.min(1, indicators.length * 0.2);
      results.push({
        entityId: node.id,
        entityName: node.name,
        indicators,
        confidence,
        riskScore: Math.min(20, indicators.length * 3),
      });
    }
  }

  return results.sort((a, b) => b.riskScore - a.riskScore);
}

// ---------------------------------------------------------------------------
// Hidden Ownership Detection
// ---------------------------------------------------------------------------

export function detectHiddenOwnership(
  graph: NetworkGraph,
  threshold: number = UBO_OWNERSHIP_THRESHOLD_PCT,
): NetworkAnalysisReport['hiddenOwnership'] {
  const adj = new AdjacencyGraph(graph);
  const results: NetworkAnalysisReport['hiddenOwnership'] = [];

  // For each individual, trace all indirect ownership paths
  const individuals = graph.nodes.filter((n) => n.type === 'individual');
  const companies = graph.nodes.filter((n) => n.type === 'company');

  for (const person of individuals) {
    for (const company of companies) {
      // BFS all paths from person to company via ownership edges
      const paths = findAllOwnershipPaths(person.id, company.id, adj, graph);

      for (const path of paths) {
        let indirectOwnership = 1;
        for (let i = 0; i < path.length - 1; i++) {
          const edges = adj.getEdges(path[i], path[i + 1]).filter((e) => e.type === 'ownership');
          if (edges.length > 0) {
            indirectOwnership *= edges[0].weight;
          }
        }

        if (indirectOwnership > 0.01 && path.length > 2) {
          results.push({
            ultimateOwner: person.name,
            controlledEntity: company.name,
            indirectOwnership: Math.round(indirectOwnership * 10000) / 100,
            path: path.map((id) => adj.getNode(id)?.name ?? id),
            exceedsThreshold: indirectOwnership >= threshold,
          });
        }
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Layering Path Detection
// ---------------------------------------------------------------------------

export function detectLayeringPaths(graph: NetworkGraph, minDepth: number = 3): LayeringPath[] {
  const adj = new AdjacencyGraph(graph);
  const paths: LayeringPath[] = [];

  // Find long transaction chains
  const txEdges = graph.edges.filter((e) => e.type === 'transaction');
  if (txEdges.length === 0) return [];

  // Build transaction-only adjacency
  const txAdj = new Map<string, string[]>();
  for (const edge of txEdges) {
    if (!txAdj.has(edge.source)) txAdj.set(edge.source, []);
    txAdj.get(edge.source)!.push(edge.target);
  }

  // DFS for long paths
  function findPaths(current: string, path: string[], visited: Set<string>): void {
    if (path.length >= minDepth) {
      const jurisdictions = path
        .map((id) => adj.getNode(id)?.jurisdiction)
        .filter((j): j is string => !!j);
      const uniqueJurisdictions = [...new Set(jurisdictions)];
      const totalValue = path.slice(0, -1).reduce((sum, id, i) => {
        const edges = adj.getEdges(id, path[i + 1]).filter((e) => e.type === 'transaction');
        return sum + (edges[0]?.weight ?? 0);
      }, 0);

      const crossBorder = uniqueJurisdictions.length > 1;
      let riskScore = path.length * 2;
      if (crossBorder) riskScore += uniqueJurisdictions.length * 2;
      if (path.some((id) => adj.getNode(id)?.sanctionsMatch)) riskScore += 5;

      paths.push({
        path,
        pathNames: path.map((id) => adj.getNode(id)?.name ?? id),
        depth: path.length,
        totalValue,
        jurisdictions: uniqueJurisdictions,
        crossBorder,
        riskScore: Math.min(20, riskScore),
      });
    }

    if (path.length >= 10) return; // cap depth

    for (const next of txAdj.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        findPaths(next, [...path, next], visited);
        visited.delete(next);
      }
    }
  }

  for (const node of graph.nodes) {
    const visited = new Set([node.id]);
    findPaths(node.id, [node.id], visited);
  }

  return paths.sort((a, b) => b.riskScore - a.riskScore).slice(0, 50);
}

// ---------------------------------------------------------------------------
// Full Network Analysis
// ---------------------------------------------------------------------------

export function runNetworkAnalysis(graph: NetworkGraph): ToolResult<NetworkAnalysisReport> {
  if (graph.nodes.length === 0) {
    return { ok: false, error: 'Empty network graph provided' };
  }

  const cycles = detectCycles(graph);
  const centralityScores = calculateCentrality(graph);
  const communities = detectCommunities(graph);
  const shellIndicators = detectShellCompanies(graph);
  const layeringPaths = detectLayeringPaths(graph);
  const hiddenOwnership = detectHiddenOwnership(graph);

  const alerts: string[] = [];
  const regulatoryFindings: string[] = [];

  // Generate alerts
  if (cycles.hasCycles) {
    alerts.push(`${cycles.cycles.length} cycle(s) detected in entity network`);
  }
  if (cycles.circularOwnership.length > 0) {
    alerts.push(`${cycles.circularOwnership.length} circular ownership structure(s) — potential shell company network`);
    regulatoryFindings.push('Circular ownership violates transparency requirements (Cabinet Decision 109/2023)');
  }

  const hubs = centralityScores.filter((s) => s.isHub);
  if (hubs.length > 0) {
    alerts.push(`${hubs.length} hub entity(ies) connecting multiple risk nodes: ${hubs.map((h) => h.nodeName).join(', ')}`);
  }

  if (shellIndicators.length > 0) {
    alerts.push(`${shellIndicators.length} potential shell company(ies) identified`);
    regulatoryFindings.push('Shell company indicators require enhanced due diligence (FDL Art.14)');
  }

  const crossBorderLayers = layeringPaths.filter((p) => p.crossBorder);
  if (crossBorderLayers.length > 0) {
    alerts.push(`${crossBorderLayers.length} cross-border layering path(s) detected — potential ML typology`);
    regulatoryFindings.push('Multi-jurisdictional layering requires STR consideration (FDL Art.26-27)');
  }

  const undisclosedUBO = hiddenOwnership.filter((h) => h.exceedsThreshold);
  if (undisclosedUBO.length > 0) {
    alerts.push(`${undisclosedUBO.length} hidden beneficial ownership chain(s) exceeding 25% threshold`);
    regulatoryFindings.push(`UBO re-verification required within 15 working days (Cabinet Decision 109/2023)`);
  }

  // Overall risk
  let overallRiskScore = 0;
  overallRiskScore += cycles.circularOwnership.length * 3;
  overallRiskScore += shellIndicators.reduce((s, i) => s + i.riskScore, 0) / Math.max(1, shellIndicators.length);
  overallRiskScore += hubs.length * 2;
  overallRiskScore += crossBorderLayers.length * 2;
  overallRiskScore += undisclosedUBO.length * 3;
  overallRiskScore = Math.min(20, overallRiskScore);

  let overallRiskLevel: NetworkAnalysisReport['overallRiskLevel'] = 'low';
  if (overallRiskScore >= 16) overallRiskLevel = 'critical';
  else if (overallRiskScore >= 11) overallRiskLevel = 'high';
  else if (overallRiskScore >= 6) overallRiskLevel = 'medium';

  return {
    ok: true,
    data: {
      analyzedAt: new Date().toISOString(),
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      cycles,
      centralityScores,
      topHubs: hubs.slice(0, 10),
      communities,
      shellCompanyIndicators: shellIndicators,
      layeringPaths: layeringPaths.slice(0, 20),
      hiddenOwnership,
      overallRiskScore,
      overallRiskLevel,
      alerts,
      regulatoryFindings,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getOwnershipDepth(nodeId: string, adj: AdjacencyGraph, graph: NetworkGraph): number {
  let maxDepth = 0;
  const visited = new Set<string>();

  function dfs(current: string, depth: number): void {
    visited.add(current);
    maxDepth = Math.max(maxDepth, depth);
    const ownerEdges = graph.edges.filter(
      (e) => e.target === current && e.type === 'ownership' && !visited.has(e.source),
    );
    for (const edge of ownerEdges) {
      dfs(edge.source, depth + 1);
    }
  }

  dfs(nodeId, 0);
  return maxDepth;
}

function findAllOwnershipPaths(
  from: string, to: string, adj: AdjacencyGraph, graph: NetworkGraph, maxDepth = 6,
): string[][] {
  const results: string[][] = [];

  function dfs(current: string, path: string[], visited: Set<string>): void {
    if (current === to) { results.push([...path]); return; }
    if (path.length >= maxDepth) return;

    const ownershipTargets = graph.edges
      .filter((e) => e.source === current && e.type === 'ownership' && !visited.has(e.target))
      .map((e) => e.target);

    for (const next of ownershipTargets) {
      visited.add(next);
      dfs(next, [...path, next], visited);
      visited.delete(next);
    }
  }

  dfs(from, [from], new Set([from]));
  return results;
}

function isOffshoreJurisdiction(jurisdiction: string): boolean {
  const offshore = new Set([
    'VG', 'KY', 'BM', 'JE', 'GG', 'IM', 'PA', 'BZ', 'SC', 'MU',
    'VU', 'WS', 'MH', 'TC', 'AI', 'GI', 'LI', 'MC', 'SM', 'AD',
  ]);
  return offshore.has(jurisdiction.toUpperCase());
}

// ---------------------------------------------------------------------------
// Schema exports
// ---------------------------------------------------------------------------

export const NETWORK_TOOL_SCHEMAS = [
  {
    name: 'analyze_entity_network',
    description:
      'Full network analysis: cycle detection, centrality scoring, community detection, shell company identification, layering path detection, hidden UBO chains. Returns comprehensive graph intelligence report.',
    inputSchema: {
      type: 'object',
      properties: {
        graph: {
          type: 'object',
          properties: {
            nodes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  type: { type: 'string', enum: ['company', 'individual', 'trust', 'foundation', 'nominee', 'unknown'] },
                  jurisdiction: { type: 'string' },
                  riskRating: { type: 'string' },
                  pepStatus: { type: 'boolean' },
                  sanctionsMatch: { type: 'boolean' },
                },
                required: ['id', 'name', 'type'],
              },
            },
            edges: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  source: { type: 'string' },
                  target: { type: 'string' },
                  type: { type: 'string', enum: ['ownership', 'directorship', 'transaction', 'family', 'agent', 'counterparty', 'shared-address', 'shared-phone'] },
                  weight: { type: 'number' },
                },
                required: ['source', 'target', 'type', 'weight'],
              },
            },
          },
          required: ['nodes', 'edges'],
        },
      },
      required: ['graph'],
    },
  },
] as const;
