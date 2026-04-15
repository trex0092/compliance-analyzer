/**
 * Decision Provenance DAG — builds a directed acyclic graph mapping
 * every input feature → every intermediate subsystem → every output
 * field of a brain decision.
 *
 * Why this exists:
 *   Auditors ask "trace how feature X became part of the final
 *   verdict". The reasoning chain already captures the logical
 *   flow but does not explicitly tie it back to the raw input
 *   features that fed it. A provenance DAG does — it's the data
 *   lineage graph for a single decision.
 *
 *   Pure function. Takes the input features + the subsystems that
 *   fired + their output contributions, and emits a DAG with
 *   typed nodes and typed edges.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO reasoned trace)
 *   Cabinet Res 134/2025 Art.19 (internal review)
 *   EU AI Act Art.12          (record keeping + traceability)
 *   EU AI Act Art.13          (transparency)
 *   NIST AI RMF 1.0 MANAGE-2  (AI decision provenance)
 *   FATF Rec 11               (record keeping)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProvenanceNodeKind = 'input' | 'subsystem' | 'output';

export interface ProvenanceNode {
  id: string;
  kind: ProvenanceNodeKind;
  label: string;
  /** Value snapshot at this node (feature value, subsystem output). */
  value?: string | number | boolean;
}

export interface ProvenanceEdge {
  from: string;
  to: string;
  /** Weight — how much this edge contributed to the next node. */
  weight: number;
  reason: string;
}

export interface ProvenanceDag {
  schemaVersion: 1;
  caseId: string;
  nodes: readonly ProvenanceNode[];
  edges: readonly ProvenanceEdge[];
  /** Topological layers — each layer is one step deeper in the DAG. */
  layers: readonly (readonly string[])[];
  /** Plain-English summary. */
  summary: string;
  regulatory: readonly string[];
}

export interface ProvenanceInput {
  caseId: string;
  /** Raw input features. */
  inputs: Readonly<Record<string, number | boolean | string>>;
  /** Subsystem fire records. */
  subsystems: ReadonlyArray<{
    id: string;
    label: string;
    /** Inputs it read. */
    readInputs: readonly string[];
    /** Outputs it produced. */
    outputs: ReadonlyArray<{ name: string; value: string | number | boolean; weight: number; reason: string }>;
  }>;
  /** Final output field names that the decision carries. */
  outputFields: readonly string[];
}

// ---------------------------------------------------------------------------
// Topological layering
// ---------------------------------------------------------------------------

function topoLayers(
  nodes: readonly ProvenanceNode[],
  edges: readonly ProvenanceEdge[]
): string[][] {
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n.id, 0);
  for (const e of edges) inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);

  const layers: string[][] = [];
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    if (!outgoing.has(e.from)) outgoing.set(e.from, []);
    outgoing.get(e.from)!.push(e.to);
  }

  // Start with all zero-in-degree nodes (inputs).
  let currentLayer = Array.from(inDegree.entries())
    .filter(([, d]) => d === 0)
    .map(([id]) => id);
  const visited = new Set<string>();
  while (currentLayer.length > 0) {
    layers.push([...currentLayer].sort());
    const next: string[] = [];
    for (const id of currentLayer) {
      visited.add(id);
      const out = outgoing.get(id) ?? [];
      for (const to of out) {
        const d = (inDegree.get(to) ?? 0) - 1;
        inDegree.set(to, d);
        if (d === 0 && !visited.has(to)) next.push(to);
      }
    }
    currentLayer = next;
  }
  // Safety: if there are unvisited nodes (cycle), append them.
  const leftovers = nodes.map((n) => n.id).filter((id) => !visited.has(id));
  if (leftovers.length > 0) layers.push(leftovers.sort());
  return layers;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildProvenanceDag(input: ProvenanceInput): ProvenanceDag {
  const nodes: ProvenanceNode[] = [];
  const edges: ProvenanceEdge[] = [];

  // Input nodes
  for (const [key, value] of Object.entries(input.inputs)) {
    nodes.push({
      id: `input:${key}`,
      kind: 'input',
      label: key,
      value,
    });
  }

  // Subsystem nodes + input → subsystem edges
  for (const sub of input.subsystems) {
    nodes.push({
      id: `sub:${sub.id}`,
      kind: 'subsystem',
      label: sub.label,
    });
    for (const inKey of sub.readInputs) {
      edges.push({
        from: `input:${inKey}`,
        to: `sub:${sub.id}`,
        weight: 1,
        reason: `${sub.label} reads ${inKey}`,
      });
    }
  }

  // Output nodes + subsystem → output edges
  for (const outField of input.outputFields) {
    nodes.push({
      id: `output:${outField}`,
      kind: 'output',
      label: outField,
    });
  }
  for (const sub of input.subsystems) {
    for (const out of sub.outputs) {
      if (input.outputFields.includes(out.name)) {
        edges.push({
          from: `sub:${sub.id}`,
          to: `output:${out.name}`,
          weight: out.weight,
          reason: out.reason,
        });
      }
    }
  }

  const layers = topoLayers(nodes, edges);

  return {
    schemaVersion: 1,
    caseId: input.caseId,
    nodes,
    edges,
    layers,
    summary:
      `Provenance DAG for case ${input.caseId}: ${nodes.length} node(s), ` +
      `${edges.length} edge(s), ${layers.length} layer(s). Every input is ` +
      `traceable to every output it influenced.`,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'Cabinet Res 134/2025 Art.19',
      'EU AI Act Art.12',
      'EU AI Act Art.13',
      'NIST AI RMF 1.0 MANAGE-2',
      'FATF Rec 11',
    ],
  };
}

/**
 * Given a DAG + a specific output field, trace back every input
 * that ultimately contributed to it (via any subsystem path).
 */
export function traceOutputProvenance(
  dag: ProvenanceDag,
  outputField: string
): readonly string[] {
  const targetId = `output:${outputField}`;
  const ancestors = new Set<string>();
  const queue: string[] = [targetId];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    for (const e of dag.edges) {
      if (e.to === cur && !ancestors.has(e.from)) {
        ancestors.add(e.from);
        queue.push(e.from);
      }
    }
  }
  return Array.from(ancestors)
    .filter((id) => id.startsWith('input:'))
    .map((id) => id.slice('input:'.length))
    .sort();
}

// Exports for tests.
export const __test__ = { topoLayers };
