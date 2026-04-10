/**
 * Causal Graph + Counterfactual Engine.
 *
 * Compliance decisions need CAUSAL reasoning, not just correlations.
 * "Did enhanced due diligence CAUSE the drop in STRs, or was it the
 * economic slowdown?" matters for policy defence.
 *
 * This module implements a simplified Structural Causal Model (SCM):
 *
 *   1. Variables are binary (0 / 1) for tractability — this covers
 *      the vast majority of compliance variables (PEP yes/no, match
 *      yes/no, EDD applied yes/no, STR filed yes/no).
 *   2. Each node has a structural equation: a deterministic function
 *      of its parents (AND, OR, NOT, MAJORITY, THRESHOLD).
 *   3. An intervention do(X = x) replaces the equation for X with the
 *      constant value x — Pearl's do-operator.
 *   4. Counterfactual queries are answered by:
 *        a. Observing the factual world
 *        b. Intervening on the counterfactual variable
 *        c. Propagating through the downstream graph
 *
 * This is NOT a full Pearl causal inference system. It does NOT
 * compute identifiability, or handle continuous variables, or do
 * causal discovery. It DOES give regulators a defensible answer
 * to "what would have happened if we had done X differently".
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (internal review must consider
 *     counterfactual reasoning for policy effectiveness)
 *   - FATF Methodology 2022 §3 (policy effectiveness assessment)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CausalFn =
  | { kind: 'constant'; value: 0 | 1 }
  | { kind: 'copy'; parent: string }
  | { kind: 'and'; parents: string[] }
  | { kind: 'or'; parents: string[] }
  | { kind: 'not'; parent: string }
  | { kind: 'majority'; parents: string[] }
  | { kind: 'threshold'; parents: string[]; min: number }
  | { kind: 'xor'; parents: [string, string] };

export interface CausalNode {
  id: string;
  description?: string;
  equation: CausalFn;
}

export interface CausalGraph {
  nodes: Map<string, CausalNode>;
  order: string[]; // topological order
}

export type Assignment = Record<string, 0 | 1>;

// ---------------------------------------------------------------------------
// Graph construction + topological sort
// ---------------------------------------------------------------------------

function parentsOf(fn: CausalFn): string[] {
  switch (fn.kind) {
    case 'constant':
      return [];
    case 'copy':
      return [fn.parent];
    case 'and':
    case 'or':
    case 'majority':
    case 'threshold':
      return [...fn.parents];
    case 'not':
      return [fn.parent];
    case 'xor':
      return [...fn.parents];
  }
}

export function createCausalGraph(nodes: readonly CausalNode[]): CausalGraph {
  const map = new Map<string, CausalNode>();
  for (const n of nodes) map.set(n.id, n);

  // Kahn's topological sort
  const incoming = new Map<string, Set<string>>();
  for (const n of nodes) incoming.set(n.id, new Set(parentsOf(n.equation)));

  const noIncoming: string[] = [];
  for (const [id, deps] of incoming.entries()) {
    if (deps.size === 0) noIncoming.push(id);
  }

  const order: string[] = [];
  while (noIncoming.length > 0) {
    const id = noIncoming.shift()!;
    order.push(id);
    for (const [other, deps] of incoming.entries()) {
      if (deps.has(id)) {
        deps.delete(id);
        if (deps.size === 0 && !order.includes(other)) noIncoming.push(other);
      }
    }
  }
  if (order.length !== nodes.length) {
    throw new Error('causal graph has a cycle — structural equations must be acyclic');
  }

  return { nodes: map, order };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function evalFn(fn: CausalFn, assignment: Assignment): 0 | 1 {
  switch (fn.kind) {
    case 'constant':
      return fn.value;
    case 'copy':
      return assignment[fn.parent] ?? 0;
    case 'and':
      return fn.parents.every((p) => assignment[p] === 1) ? 1 : 0;
    case 'or':
      return fn.parents.some((p) => assignment[p] === 1) ? 1 : 0;
    case 'not':
      return assignment[fn.parent] === 1 ? 0 : 1;
    case 'majority': {
      const on = fn.parents.filter((p) => assignment[p] === 1).length;
      return on * 2 > fn.parents.length ? 1 : 0;
    }
    case 'threshold': {
      const on = fn.parents.filter((p) => assignment[p] === 1).length;
      return on >= fn.min ? 1 : 0;
    }
    case 'xor':
      return (assignment[fn.parents[0]] ?? 0) !== (assignment[fn.parents[1]] ?? 0) ? 1 : 0;
  }
}

export function simulate(
  graph: CausalGraph,
  inputs: Assignment,
  interventions: Assignment = {},
): Assignment {
  const out: Assignment = { ...inputs };
  for (const id of graph.order) {
    if (id in interventions) {
      out[id] = interventions[id];
      continue;
    }
    if (id in inputs) {
      continue;
    }
    const node = graph.nodes.get(id)!;
    out[id] = evalFn(node.equation, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Counterfactual query
// ---------------------------------------------------------------------------

export interface CounterfactualQuery {
  /** Observed assignment (from real data). */
  observation: Assignment;
  /** The counterfactual intervention — "what if X had been …". */
  intervention: Assignment;
  /** Which downstream nodes to read after intervention. */
  target: string;
}

export interface CounterfactualResult {
  factual: 0 | 1;
  counterfactual: 0 | 1;
  change: boolean;
  affectedNodes: string[];
}

export function runCounterfactual(
  graph: CausalGraph,
  query: CounterfactualQuery,
): CounterfactualResult {
  const factual = simulate(graph, query.observation);
  const cf = simulate(graph, query.observation, query.intervention);
  const affected: string[] = [];
  for (const id of graph.order) {
    if (factual[id] !== cf[id]) affected.push(id);
  }
  return {
    factual: (factual[query.target] ?? 0) as 0 | 1,
    counterfactual: (cf[query.target] ?? 0) as 0 | 1,
    change: factual[query.target] !== cf[query.target],
    affectedNodes: affected,
  };
}

// ---------------------------------------------------------------------------
// Convenience: average treatment effect over a dataset
// ---------------------------------------------------------------------------

export function averageTreatmentEffect(
  graph: CausalGraph,
  dataset: readonly Assignment[],
  treatmentVar: string,
  target: string,
): number {
  if (dataset.length === 0) return 0;
  let treatedTarget = 0;
  let untreatedTarget = 0;
  for (const obs of dataset) {
    const treated = simulate(graph, obs, { [treatmentVar]: 1 });
    const untreated = simulate(graph, obs, { [treatmentVar]: 0 });
    treatedTarget += treated[target] ?? 0;
    untreatedTarget += untreated[target] ?? 0;
  }
  return (treatedTarget - untreatedTarget) / dataset.length;
}
