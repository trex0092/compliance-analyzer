/**
 * Graph Risk Scorer — structural anomaly detector that runs ON TOP of
 * the existing transactionGraphEmbedding output to flag fraud patterns
 * invisible to per-customer scoring.
 *
 * Why this exists:
 *   src/services/transactionGraphEmbedding.ts already produces a
 *   per-node 8-dim feature vector (in/out degree, weighted flow,
 *   reciprocity, clustering proxy, bridge score, self-loop flag) and
 *   a list of cosine-similar pairs. Useful, but it stops short of the
 *   actual *risk verdict*. The MLRO still has to look at the vectors
 *   and decide which structural patterns matter.
 *
 *   This module turns that into an explicit scoring pass that flags:
 *
 *     - MULE       : high in-degree, low out-degree, low reciprocity
 *                    (collects from many, sends to few)
 *     - FAN_OUT_HUB: high out-degree, low in-degree, low clustering
 *                    (smurfing coordinator)
 *     - RING       : high reciprocity + non-trivial clustering
 *                    (round-tripping cycle)
 *     - BRIDGE     : high bridge score + low clustering
 *                    (layering link between sub-networks)
 *     - SELF_LOOP  : self-edges present
 *                    (round-tripping by self)
 *
 *   Each anomaly carries a numeric severity in [0, 1] and a
 *   regulatory anchor. The full report aggregates per-node
 *   findings into a per-tenant graph risk score.
 *
 *   Pure function — no I/O, no state, deterministic. Wired into
 *   the brain super runner as an optional 14th MegaBrain subsystem
 *   and exposed via /api/brain/graph-risk for inspector queries.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO reasoned detection)
 *   FATF Rec 11             (record keeping + analysis)
 *   FATF Rec 20             (suspicious patterns + ongoing monitoring)
 *   MoE Circular 08/AML/2021 (DPMS structural pattern analysis)
 *   FATF DPMS Typology Guidance (round-tripping, smurfing,
 *                                layering signatures)
 *   NIST AI RMF 1.0 MEASURE-2 (quantitative risk measurement)
 */

import {
  embedTransactionGraph,
  type TransactionEdge,
  type NodeEmbedding,
  type GraphEmbeddingReport,
} from './transactionGraphEmbedding';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GraphAnomalyKind = 'mule' | 'fan_out_hub' | 'ring' | 'bridge' | 'self_loop';

export interface GraphAnomaly {
  kind: GraphAnomalyKind;
  node: string;
  /** Severity in [0, 1]. */
  severity: number;
  /** Coarse band: low / medium / high / critical. */
  band: 'low' | 'medium' | 'high' | 'critical';
  /** Plain-English why. */
  reason: string;
  /** Regulatory anchor for this specific finding. */
  regulatory: string;
  /**
   * Recommended downstream action for the SLA enforcer / orchestrator.
   * MLROs override freely — this is a starting point not a verdict.
   */
  recommendedAction: 'monitor' | 'enrich_cdd' | 'co_review' | 'freeze_review';
}

export interface GraphRiskReport {
  schemaVersion: 1;
  /**
   * Aggregate score in [0, 100]. Composite of the worst per-node
   * severity, the count of high+critical findings, and a structural
   * coverage term (more nodes flagged = higher tenant-level risk).
   */
  score: number;
  /** Same banding scheme used by the rest of the brain. */
  band: 'minimal' | 'low' | 'moderate' | 'high' | 'critical';
  /** Per-node anomalies, sorted by severity desc. */
  anomalies: readonly GraphAnomaly[];
  /** Underlying embedding report (carried through for the audit). */
  embedding: GraphEmbeddingReport;
  /** Plain-English summary safe for the STR narrative + audit log. */
  summary: string;
  /** Regulatory anchors for the aggregate report. */
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function bandForSeverity(s: number): GraphAnomaly['band'] {
  if (s >= 0.85) return 'critical';
  if (s >= 0.65) return 'high';
  if (s >= 0.4) return 'medium';
  return 'low';
}

function actionForSeverity(s: number): GraphAnomaly['recommendedAction'] {
  if (s >= 0.85) return 'freeze_review';
  if (s >= 0.65) return 'co_review';
  if (s >= 0.4) return 'enrich_cdd';
  return 'monitor';
}

// ---------------------------------------------------------------------------
// Per-anomaly detectors
// ---------------------------------------------------------------------------
// Each detector reads the 8-dim vector layout documented in
// transactionGraphEmbedding.ts:
//   [0] inDegree
//   [1] outDegree
//   [2] weightedInFlow  (log-scaled, 0..1)
//   [3] weightedOutFlow (log-scaled, 0..1)
//   [4] reciprocity
//   [5] clusteringProxy
//   [6] bridgeScore
//   [7] selfLoopFlag

function detectMule(e: NodeEmbedding): GraphAnomaly | null {
  const [inDeg, outDeg, , , reciprocity] = e.vector as readonly number[];
  if (inDeg < 5) return null;
  // High in-degree, low out-degree, low reciprocity.
  const inOutRatio = inDeg / Math.max(1, outDeg);
  if (inOutRatio < 3) return null;
  if (reciprocity > 0.3) return null;
  // Severity from how concentrated the imbalance is.
  const severity = clamp01(0.4 + Math.min(0.5, (inOutRatio - 3) * 0.05));
  return {
    kind: 'mule',
    node: e.node,
    severity,
    band: bandForSeverity(severity),
    reason:
      `Node receives from ${inDeg} parties and sends to only ${outDeg} ` +
      `(ratio ${inOutRatio.toFixed(1)}, reciprocity ${reciprocity.toFixed(2)}). ` +
      `Mule signature.`,
    regulatory: 'FATF Rec 20; FATF DPMS Typology Guidance',
    recommendedAction: actionForSeverity(severity),
  };
}

function detectFanOutHub(e: NodeEmbedding): GraphAnomaly | null {
  const [inDeg, outDeg, , , , clustering] = e.vector as readonly number[];
  if (outDeg < 5) return null;
  const outInRatio = outDeg / Math.max(1, inDeg);
  if (outInRatio < 3) return null;
  if (clustering > 0.2) return null;
  // High out-degree, low in-degree, low clustering = smurfing coordinator.
  const severity = clamp01(0.45 + Math.min(0.5, (outInRatio - 3) * 0.05));
  return {
    kind: 'fan_out_hub',
    node: e.node,
    severity,
    band: bandForSeverity(severity),
    reason:
      `Node sends to ${outDeg} parties and receives from only ${inDeg} ` +
      `(ratio ${outInRatio.toFixed(1)}, clustering ${clustering.toFixed(2)}). ` +
      `Smurfing coordinator signature.`,
    regulatory: 'FATF Rec 20; MoE Circular 08/AML/2021',
    recommendedAction: actionForSeverity(severity),
  };
}

function detectRing(e: NodeEmbedding): GraphAnomaly | null {
  const [inDeg, outDeg, , , reciprocity, clustering] = e.vector as readonly number[];
  if (inDeg + outDeg < 4) return null;
  if (reciprocity < 0.6 || clustering < 0.3) return null;
  // High reciprocity + non-trivial clustering = round-tripping ring.
  const severity = clamp01(0.5 + reciprocity * 0.25 + clustering * 0.25);
  return {
    kind: 'ring',
    node: e.node,
    severity,
    band: bandForSeverity(severity),
    reason:
      `Node has reciprocity ${reciprocity.toFixed(2)} and clustering ` +
      `${clustering.toFixed(2)} — round-tripping ring signature.`,
    regulatory: 'FATF Rec 20; UAE NRA 2024 — round-tripping typology',
    recommendedAction: actionForSeverity(severity),
  };
}

function detectBridge(e: NodeEmbedding): GraphAnomaly | null {
  const [, , , , , clustering, bridgeScore] = e.vector as readonly number[];
  if (bridgeScore < 0.6) return null;
  if (clustering > 0.2) return null;
  // High bridge score + low clustering = layering link.
  const severity = clamp01(0.4 + Math.min(0.5, (bridgeScore - 0.6) * 0.6));
  return {
    kind: 'bridge',
    node: e.node,
    severity,
    band: bandForSeverity(severity),
    reason:
      `Node has bridge score ${bridgeScore.toFixed(2)} and clustering ` +
      `${clustering.toFixed(2)} — layering link between sub-networks.`,
    regulatory: 'FATF Rec 20; FATF DPMS Typology Guidance — layering',
    recommendedAction: actionForSeverity(severity),
  };
}

function detectSelfLoop(e: NodeEmbedding): GraphAnomaly | null {
  const selfLoopFlag = e.vector[7] ?? 0;
  if (selfLoopFlag !== 1) return null;
  return {
    kind: 'self_loop',
    node: e.node,
    severity: 0.7,
    band: bandForSeverity(0.7),
    reason: 'Node has self-edge — possible round-tripping by self.',
    regulatory: 'FATF Rec 20; FATF DPMS Typology Guidance',
    recommendedAction: actionForSeverity(0.7),
  };
}

const DETECTORS: ReadonlyArray<(e: NodeEmbedding) => GraphAnomaly | null> = [
  detectMule,
  detectFanOutHub,
  detectRing,
  detectBridge,
  detectSelfLoop,
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GraphRiskOptions {
  /** Min severity to include. Default 0.4. */
  minSeverity?: number;
}

/**
 * Score a transaction graph for structural anomalies. Pure function.
 * Cost dominated by the embedding pass (O(N^2 D) for similarity) +
 * O(N * detectors) per-node scoring — safe for graphs ≤2000 nodes.
 */
export function scoreGraphRisk(
  edges: readonly TransactionEdge[],
  opts: GraphRiskOptions = {}
): GraphRiskReport {
  const minSev = opts.minSeverity ?? 0.4;
  const embedding = embedTransactionGraph(edges);

  const anomalies: GraphAnomaly[] = [];
  for (const node of embedding.embeddings) {
    for (const detector of DETECTORS) {
      const result = detector(node);
      if (result && result.severity >= minSev) {
        anomalies.push(result);
      }
    }
  }
  anomalies.sort((a, b) => b.severity - a.severity);

  // Aggregate score in [0, 100]:
  //   - 50 pts: max single-node severity
  //   - 30 pts: count of high+critical findings (saturates at 10)
  //   - 20 pts: structural coverage (fraction of nodes flagged)
  const maxSev = anomalies.length > 0 ? anomalies[0]!.severity : 0;
  const highOrCritical = anomalies.filter((a) => a.band === 'high' || a.band === 'critical').length;
  const coverage =
    embedding.nodeCount > 0 ? new Set(anomalies.map((a) => a.node)).size / embedding.nodeCount : 0;
  const score = Math.round(
    Math.min(100, maxSev * 50 + Math.min(10, highOrCritical) * 3 + coverage * 20)
  );

  let band: GraphRiskReport['band'];
  if (score >= 80) band = 'critical';
  else if (score >= 60) band = 'high';
  else if (score >= 40) band = 'moderate';
  else if (score >= 20) band = 'low';
  else band = 'minimal';

  const summary =
    embedding.nodeCount === 0
      ? 'No nodes in transaction graph — graph risk = 0.'
      : anomalies.length === 0
        ? `No structural anomalies across ${embedding.nodeCount} node(s) and ` +
          `${embedding.edgeCount} edge(s). Graph risk score ${score}/100 (${band}).`
        : `${anomalies.length} structural anomaly finding(s) across ` +
          `${embedding.nodeCount} node(s). Top: ${anomalies[0]!.kind} on ` +
          `node "${anomalies[0]!.node}" (severity ${anomalies[0]!.severity.toFixed(2)}). ` +
          `Graph risk score ${score}/100 (${band}).`;

  return {
    schemaVersion: 1,
    score,
    band,
    anomalies,
    embedding,
    summary,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'FATF Rec 11',
      'FATF Rec 20',
      'MoE Circular 08/AML/2021',
      'FATF DPMS Typology Guidance',
      'NIST AI RMF 1.0 MEASURE-2',
    ],
  };
}

// Exports for tests.
export const __test__ = {
  detectMule,
  detectFanOutHub,
  detectRing,
  detectBridge,
  detectSelfLoop,
  bandForSeverity,
  actionForSeverity,
};
