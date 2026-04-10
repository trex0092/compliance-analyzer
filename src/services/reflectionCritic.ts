/**
 * Self-Reflection Critic for Reasoning Chains.
 *
 * After the ReAct brain produces a reasoning chain and a decision, the
 * reflection critic reviews the chain and returns:
 *
 *   1. A set of STRUCTURAL ISSUES (no regulatory citation, orphan nodes,
 *      contradictions, ungrounded conclusions).
 *   2. A set of COVERAGE GAPS (missing required steps — e.g. no
 *      sanctions screening, no evidence of CDD, no four-eyes approval).
 *   3. A confidence score in [0, 1] — how trustworthy is this chain?
 *   4. A list of recommended follow-up actions.
 *
 * This module is the brain's own quality gate. It catches its own
 * hallucinations and pushes borderline decisions back to human review.
 * It is NOT an LLM — it is a set of deterministic checks over the
 * reasoningChain DAG.
 *
 * Regulatory basis:
 *   - FDL Art.19-20 (internal review + CO documentation)
 *   - Cabinet Res 134/2025 Art.19 (adversarial internal review)
 *   - FATF Rec 18 (internal controls)
 */

import {
  type ReasoningChain,
  type ReasoningNode,
  type NodeType,
  rootCauses,
  leafConclusions,
  descendants,
} from './reasoningChain';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IssueSeverity = 'info' | 'warning' | 'error';

export interface ReflectionIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  nodeId?: string;
}

export interface ReflectionReport {
  chainId: string;
  topic: string;
  issues: ReflectionIssue[];
  confidence: number; // [0, 1]
  coverage: {
    hasRegulatoryCitation: boolean;
    hasEvidence: boolean;
    hasAction: boolean;
    hasDecision: boolean;
  };
  recommendations: string[];
  shouldEscalateToHuman: boolean;
}

// ---------------------------------------------------------------------------
// Critic
// ---------------------------------------------------------------------------

export interface CriticConfig {
  /** Node types that MUST appear somewhere in the chain. */
  requiredNodeTypes?: readonly NodeType[];
  /** If confidence drops below this, escalation is required. */
  escalationThreshold?: number;
  /** Whether to require at least one regulatory citation. */
  requireRegulatoryCitation?: boolean;
}

const DEFAULT_REQUIRED_TYPES: NodeType[] = ['event', 'evidence', 'action', 'decision'];

export function reviewReasoningChain(
  chain: ReasoningChain,
  config: CriticConfig = {}
): ReflectionReport {
  const required = config.requiredNodeTypes ?? DEFAULT_REQUIRED_TYPES;
  const issues: ReflectionIssue[] = [];

  // Coverage: are the required node types present?
  const typesPresent = new Set(chain.nodes.map((n) => n.type));
  for (const t of required) {
    if (!typesPresent.has(t)) {
      issues.push({
        severity: 'error',
        code: 'MISSING_NODE_TYPE',
        message: `Chain is missing a node of type "${t}"`,
      });
    }
  }

  // Regulatory citation.
  const hasCitation = chain.nodes.some((n) => !!n.regulatory);
  if (!hasCitation && (config.requireRegulatoryCitation ?? true)) {
    issues.push({
      severity: 'error',
      code: 'NO_REGULATORY_CITATION',
      message: 'No node carries a regulatory citation (FDL Art.20 requires documented reasoning)',
    });
  }

  // Contradictions: nodes linked by "contradicts" / "refutes" edges.
  const contradictoryEdges = chain.edges.filter(
    (e) => e.relation === 'contradicts' || e.relation === 'refutes'
  );
  if (contradictoryEdges.length > 0) {
    for (const e of contradictoryEdges) {
      issues.push({
        severity: 'warning',
        code: 'CONTRADICTION',
        message: `Contradictory edge ${e.fromId} → ${e.toId}`,
        nodeId: e.toId,
      });
    }
  }

  // Orphan nodes: nodes not reachable from any root cause.
  const reachable = new Set<string>();
  for (const root of rootCauses(chain)) {
    reachable.add(root.id);
    for (const d of descendants(chain, root.id)) reachable.add(d.id);
  }
  for (const node of chain.nodes) {
    if (!reachable.has(node.id)) {
      issues.push({
        severity: 'warning',
        code: 'ORPHAN_NODE',
        message: `Node ${node.id} is not connected to any root cause`,
        nodeId: node.id,
      });
    }
  }

  // Unsupported decision: a decision node with no supporting evidence path.
  const leaves = leafConclusions(chain).filter((n) => n.type === 'decision');
  for (const leaf of leaves) {
    const ancestorTypes = collectAncestorTypes(chain, leaf.id);
    if (!ancestorTypes.has('evidence') && !ancestorTypes.has('observation')) {
      issues.push({
        severity: 'error',
        code: 'UNSUPPORTED_DECISION',
        message: `Decision "${leaf.label}" has no supporting evidence node in its ancestry`,
        nodeId: leaf.id,
      });
    }
  }

  // Sealing.
  if (!chain.sealed) {
    issues.push({
      severity: 'warning',
      code: 'CHAIN_NOT_SEALED',
      message: 'Chain is not sealed — decision is not tamper-evident yet',
    });
  }

  // Confidence score.
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const base = 1;
  const confidence = Math.max(0, base - errorCount * 0.3 - warningCount * 0.1);

  const escalationThreshold = config.escalationThreshold ?? 0.7;
  const shouldEscalateToHuman = confidence < escalationThreshold;

  // Recommendations.
  const recommendations: string[] = [];
  if (!hasCitation)
    recommendations.push('Add at least one regulatory citation to the decision path.');
  if (errorCount > 0) recommendations.push('Resolve error-level issues before sealing the chain.');
  if (shouldEscalateToHuman)
    recommendations.push('Escalate to human review — confidence below threshold.');
  if (!chain.sealed) recommendations.push('Seal the chain once the decision is final.');

  return {
    chainId: chain.id,
    topic: chain.topic,
    issues,
    confidence: round4(confidence),
    coverage: {
      hasRegulatoryCitation: hasCitation,
      hasEvidence: typesPresent.has('evidence') || typesPresent.has('observation'),
      hasAction: typesPresent.has('action'),
      hasDecision: typesPresent.has('decision'),
    },
    recommendations,
    shouldEscalateToHuman,
  };
}

function collectAncestorTypes(chain: ReasoningChain, nodeId: string): Set<NodeType> {
  const types = new Set<NodeType>();
  const seen = new Set<string>([nodeId]);
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of chain.edges.filter((e) => e.toId === current)) {
      if (seen.has(edge.fromId)) continue;
      seen.add(edge.fromId);
      const parent = chain.nodes.find((n) => n.id === edge.fromId);
      if (parent) {
        types.add(parent.type);
        queue.push(parent.id);
      }
    }
  }
  return types;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Helper: surface issues formatted for UI / audit trail
// ---------------------------------------------------------------------------

export function formatIssues(report: ReflectionReport): string[] {
  return report.issues.map((i) => `[${i.severity.toUpperCase()}] ${i.code}: ${i.message}`);
}

// Re-export node type marker so consumers can cheaply type-check without importing.
export type { ReasoningNode };
