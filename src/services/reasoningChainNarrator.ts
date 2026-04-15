/**
 * Reasoning Chain Narrator — produces a natural-language narrative
 * summary of the brain's reasoning chain for a specific decision.
 *
 * Why this exists:
 *   `reasoningChain.ts` produces a DAG of nodes + edges — correct,
 *   complete, machine-auditable, but unreadable at a glance. MLROs
 *   and regulators want PROSE: "the brain reached this verdict
 *   because X, supported by Y, mitigated by Z, and the strongest
 *   counter-argument was W".
 *
 *   This module is the pure narrator. It walks the reasoning chain,
 *   identifies the load-bearing nodes, and emits a structured
 *   narrative with per-step citations. It does NOT use the LLM
 *   directly — the LLM-assisted version would go through the
 *   existing advisor strategy on the six mandatory triggers. The
 *   deterministic narrator produces a safe baseline every time.
 *
 *   Pure function. Same chain → same narrative. No I/O.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO reasoned decision)
 *   Cabinet Res 134/2025 Art.19 (internal review — narrative form)
 *   EU AI Act Art.13          (transparency)
 *   NIST AI RMF 1.0 MANAGE-2  (AI decision provenance)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChainNode {
  id: string;
  label: string;
  /**
   * Node kind — drives how the narrator references it.
   */
  kind: 'evidence' | 'rule' | 'computation' | 'verdict' | 'clamp' | 'precedent';
  /** Strength / weight — higher = more load-bearing. */
  weight: number;
  /** Regulatory citation anchoring this node. */
  regulatory?: string;
  /** Short human description. */
  description: string;
}

export interface ChainEdge {
  from: string;
  to: string;
  /** Relationship type. */
  relation: 'supports' | 'contradicts' | 'depends_on' | 'clamps';
}

export interface ReasoningChain {
  nodes: readonly ChainNode[];
  edges: readonly ChainEdge[];
  finalVerdict: 'pass' | 'flag' | 'escalate' | 'freeze';
  finalConfidence: number;
}

export interface NarrativeReport {
  schemaVersion: 1;
  /** One-paragraph headline. */
  headline: string;
  /** Step-by-step walk through the chain. */
  steps: readonly string[];
  /** The three most load-bearing pieces of evidence. */
  topEvidence: readonly ChainNode[];
  /** The strongest counter-argument (if any). */
  strongestContradiction: ChainNode | null;
  /** Any clamps that fired. */
  clampsFired: readonly ChainNode[];
  /** Full narrative as plain text for audit / STR drafts. */
  plainText: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nodesByKind(
  chain: ReasoningChain,
  kind: ChainNode['kind']
): ChainNode[] {
  return chain.nodes.filter((n) => n.kind === kind);
}

function weightDescending(a: ChainNode, b: ChainNode): number {
  return b.weight - a.weight;
}

function describeEdge(edge: ChainEdge, chain: ReasoningChain): string {
  const from = chain.nodes.find((n) => n.id === edge.from);
  const to = chain.nodes.find((n) => n.id === edge.to);
  if (!from || !to) return `(incomplete edge ${edge.from} → ${edge.to})`;
  const relation =
    edge.relation === 'supports'
      ? 'supports'
      : edge.relation === 'contradicts'
        ? 'contradicts'
        : edge.relation === 'depends_on'
          ? 'depends on'
          : 'clamps';
  return `${from.label} ${relation} ${to.label}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function narrateReasoningChain(chain: ReasoningChain): NarrativeReport {
  const evidence = nodesByKind(chain, 'evidence').sort(weightDescending);
  const rules = nodesByKind(chain, 'rule').sort(weightDescending);
  const clamps = nodesByKind(chain, 'clamp');
  const topEvidence = evidence.slice(0, 3);

  // Strongest contradiction: find the heaviest edge of type 'contradicts'
  // and pick the FROM node as the argument.
  const contradictEdges = chain.edges.filter((e) => e.relation === 'contradicts');
  let strongestContradiction: ChainNode | null = null;
  let contradictionWeight = -Infinity;
  for (const e of contradictEdges) {
    const from = chain.nodes.find((n) => n.id === e.from);
    if (from && from.weight > contradictionWeight) {
      strongestContradiction = from;
      contradictionWeight = from.weight;
    }
  }

  const steps: string[] = [];
  steps.push(
    `The brain reached a "${chain.finalVerdict}" verdict with ` +
      `${(chain.finalConfidence * 100).toFixed(1)}% confidence.`
  );

  if (topEvidence.length > 0) {
    steps.push(
      `Primary evidence: ` +
        topEvidence
          .map((n, i) => `(${i + 1}) ${n.label} [weight ${n.weight.toFixed(2)}]`)
          .join('; ') +
        '.'
    );
  }

  if (rules.length > 0) {
    steps.push(
      `Applied rules: ` +
        rules
          .slice(0, 3)
          .map((n) => `${n.label} (${n.regulatory ?? 'no citation'})`)
          .join(', ') +
        '.'
    );
  }

  if (clamps.length > 0) {
    steps.push(
      `Safety clamps fired: ${clamps.map((n) => n.label).join(', ')}. ` +
        `Clamps always move the verdict TOWARD safety, never against it.`
    );
  }

  if (strongestContradiction) {
    steps.push(
      `Strongest counter-argument: ${strongestContradiction.label}. ` +
        `The brain weighed this against the primary evidence and determined ` +
        `it was insufficient to flip the verdict.`
    );
  } else {
    steps.push('No material counter-arguments were detected in the chain.');
  }

  // Edge summary — describe up to 5 of the most relevant edges.
  const interestingEdges = chain.edges
    .filter((e) => e.relation !== 'depends_on')
    .slice(0, 5);
  if (interestingEdges.length > 0) {
    steps.push(
      `Key relationships: ` +
        interestingEdges.map((e) => describeEdge(e, chain)).join('; ') +
        '.'
    );
  }

  const headline =
    `${chain.finalVerdict.toUpperCase()} verdict (${(chain.finalConfidence * 100).toFixed(0)}% ` +
    `confidence) driven by ${topEvidence.length} primary evidence item(s), ` +
    `${rules.length} rule(s), and ${clamps.length} clamp(s). ` +
    (strongestContradiction
      ? `One material counter-argument present.`
      : `No material counter-arguments.`);

  const plainText = [headline, '', ...steps.map((s, i) => `${i + 1}. ${s}`)].join('\n');

  return {
    schemaVersion: 1,
    headline,
    steps,
    topEvidence,
    strongestContradiction,
    clampsFired: clamps,
    plainText,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'Cabinet Res 134/2025 Art.19',
      'EU AI Act Art.13',
      'NIST AI RMF 1.0 MANAGE-2',
    ],
  };
}

// Exports for tests.
export const __test__ = { nodesByKind, describeEdge };
