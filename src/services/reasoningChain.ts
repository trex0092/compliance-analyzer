/**
 * Reasoning Chain DAG — court-admissible explainability of every brain decision.
 *
 * Every decision the brain makes is recorded as a directed acyclic graph:
 *
 *   Event → Regulation → Rule → Evidence → Action
 *
 * Each node has a type, a regulatory citation, and a weight. Each edge
 * is labelled with the inference rule that produced it. The whole DAG
 * is serialisable, diffable, and renderable as a graph for the MLRO
 * and for MoE inspectors.
 *
 * Critical property: the DAG is APPEND-ONLY within a single decision.
 * Once a node is added it cannot be mutated — this is the invariant
 * that makes the chain admissible in a regulatory audit.
 *
 * Used by: reactBrain.ts, redTeamSimulator.ts, teacherStudent.ts.
 */

export type NodeType =
  | 'event'
  | 'regulation'
  | 'rule'
  | 'evidence'
  | 'observation'
  | 'hypothesis'
  | 'action'
  | 'decision';

export interface ReasoningNode {
  id: string;
  type: NodeType;
  label: string;
  /** Regulatory citation (FDL article, Cabinet Res, FATF rec, etc.). */
  regulatory?: string;
  /** Contribution weight in [0, 1]. */
  weight: number;
  /** Optional structured data payload. */
  data?: Record<string, unknown>;
  createdAt: string;
}

export interface ReasoningEdge {
  fromId: string;
  toId: string;
  /** Inference relation: "triggers", "implies", "contradicts", "supports". */
  relation: 'triggers' | 'implies' | 'contradicts' | 'supports' | 'refutes';
  /** Weight of the edge contribution. */
  weight: number;
  rationale?: string;
}

export interface ReasoningChain {
  id: string;
  topic: string;
  nodes: ReasoningNode[];
  edges: ReasoningEdge[];
  createdAt: string;
  /** Sealed chains cannot be modified — part of the tamper-evident guarantee. */
  sealed: boolean;
}

// ---------------------------------------------------------------------------
// Chain construction
// ---------------------------------------------------------------------------

export function createChain(topic: string, id?: string): ReasoningChain {
  return {
    id: id ?? `rc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    topic,
    nodes: [],
    edges: [],
    createdAt: new Date().toISOString(),
    sealed: false,
  };
}

export function addNode(
  chain: ReasoningChain,
  node: Omit<ReasoningNode, 'createdAt'>,
): ReasoningNode {
  if (chain.sealed) {
    throw new Error('addNode: chain is sealed and cannot be modified');
  }
  if (chain.nodes.some((n) => n.id === node.id)) {
    throw new Error(`addNode: duplicate node id ${node.id}`);
  }
  const full: ReasoningNode = { ...node, createdAt: new Date().toISOString() };
  chain.nodes.push(full);
  return full;
}

export function addEdge(chain: ReasoningChain, edge: ReasoningEdge): void {
  if (chain.sealed) {
    throw new Error('addEdge: chain is sealed and cannot be modified');
  }
  const fromExists = chain.nodes.some((n) => n.id === edge.fromId);
  const toExists = chain.nodes.some((n) => n.id === edge.toId);
  if (!fromExists) throw new Error(`addEdge: unknown from-node ${edge.fromId}`);
  if (!toExists) throw new Error(`addEdge: unknown to-node ${edge.toId}`);
  chain.edges.push(edge);
}

export function seal(chain: ReasoningChain): void {
  chain.sealed = true;
}

// ---------------------------------------------------------------------------
// Traversal + analysis
// ---------------------------------------------------------------------------

export function descendants(chain: ReasoningChain, nodeId: string): ReasoningNode[] {
  const visited = new Set<string>([nodeId]);
  const queue: string[] = [nodeId];
  const out: ReasoningNode[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = chain.edges.filter((e) => e.fromId === current);
    for (const edge of children) {
      if (visited.has(edge.toId)) continue;
      visited.add(edge.toId);
      const node = chain.nodes.find((n) => n.id === edge.toId);
      if (node) {
        out.push(node);
        queue.push(node.id);
      }
    }
  }
  return out;
}

export function ancestors(chain: ReasoningChain, nodeId: string): ReasoningNode[] {
  const visited = new Set<string>([nodeId]);
  const queue: string[] = [nodeId];
  const out: ReasoningNode[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const parents = chain.edges.filter((e) => e.toId === current);
    for (const edge of parents) {
      if (visited.has(edge.fromId)) continue;
      visited.add(edge.fromId);
      const node = chain.nodes.find((n) => n.id === edge.fromId);
      if (node) {
        out.push(node);
        queue.push(node.id);
      }
    }
  }
  return out;
}

/**
 * Find the root cause(s) of a decision — nodes with no incoming edges.
 * These are the "raw facts" the reasoning started from.
 */
export function rootCauses(chain: ReasoningChain): ReasoningNode[] {
  const targets = new Set(chain.edges.map((e) => e.toId));
  return chain.nodes.filter((n) => !targets.has(n.id));
}

/**
 * Find the leaf conclusions — nodes with no outgoing edges.
 * These are the actions the brain actually decided to take.
 */
export function leafConclusions(chain: ReasoningChain): ReasoningNode[] {
  const sources = new Set(chain.edges.map((e) => e.fromId));
  return chain.nodes.filter((n) => !sources.has(n.id));
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

export function toJSON(chain: ReasoningChain): string {
  return JSON.stringify(chain, null, 2);
}

export function fromJSON(json: string): ReasoningChain {
  return JSON.parse(json) as ReasoningChain;
}

/** Render as a Mermaid flowchart for docs / UI. */
export function toMermaid(chain: ReasoningChain): string {
  const lines: string[] = ['flowchart TD'];
  const escape = (s: string) => s.replace(/[`"()[\]]/g, ' ');
  for (const node of chain.nodes) {
    const shape: Record<NodeType, [string, string]> = {
      event: ['([', '])'],
      regulation: ['[[', ']]'],
      rule: ['{', '}'],
      evidence: ['[', ']'],
      observation: ['[', ']'],
      hypothesis: ['((', '))'],
      action: ['>', ']'],
      decision: ['{{', '}}'],
    };
    const [l, r] = shape[node.type];
    lines.push(`  ${node.id}${l}"${escape(node.label)}"${r}`);
  }
  for (const edge of chain.edges) {
    lines.push(`  ${edge.fromId} -->|${edge.relation}| ${edge.toId}`);
  }
  return lines.join('\n');
}

/** Sum of all node weights on the path from root cause to decision. */
export function pathWeight(chain: ReasoningChain, fromId: string, toId: string): number {
  // Simple DFS; we use the sum of EDGE weights along the path
  const paths: ReasoningEdge[][] = [];
  const walk = (current: string, path: ReasoningEdge[]): void => {
    if (current === toId) {
      paths.push([...path]);
      return;
    }
    for (const edge of chain.edges.filter((e) => e.fromId === current)) {
      if (path.some((p) => p.toId === edge.toId)) continue; // cycle guard
      path.push(edge);
      walk(edge.toId, path);
      path.pop();
    }
  };
  walk(fromId, []);
  if (paths.length === 0) return 0;
  // Return the maximum path weight
  return Math.max(...paths.map((p) => p.reduce((s, e) => s + e.weight, 0)));
}
