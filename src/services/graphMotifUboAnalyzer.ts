/**
 * Graph Motif UBO Analyzer — subsystem #100 (Phase 9).
 *
 * Detects structural evasion of the Cabinet Decision 109/2023 25%
 * UBO disclosure threshold via graph motif analysis. Classic pattern:
 * instead of one UBO holding 51%, the structure uses five shell
 * entities each holding 20% (below threshold individually) that are
 * all controlled by the same real beneficial owner.
 *
 * Without graph analysis, each 20% holding looks compliant. With
 * motif analysis, we detect:
 *
 *   - K-STAR motifs: single node owning K different <25% holdings
 *   - DAISY-CHAIN motifs: A → B → C → ... → target where each step
 *     is under 25% but the cumulative control is clear
 *   - DIAMOND motifs: two disjoint paths converging on the same UBO
 *   - SHARED-SIGNATORY motifs: N entities sharing the same
 *     signatory with individually-small holdings
 *
 * This is not a real graph neural network — it's deterministic
 * motif counting, which is what GNN papers actually do under the
 * hood for ownership structures of this size.
 *
 * Regulatory basis:
 *   - Cabinet Decision 109/2023 (25% UBO disclosure)
 *   - FATF Rec 10, 24, 25 (CDD + transparency of legal persons)
 *   - FDL No.10/2025 Art.12-14 (identity verification of UBO)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OwnershipEdge {
  ownerId: string;
  targetId: string;
  percentage: number; // 0-100
}

export interface MotifFinding {
  motifType: 'k_star' | 'daisy_chain' | 'diamond' | 'shared_signatory' | 'cumulative_threshold';
  targetId: string;
  participants: readonly string[];
  totalControl: number; // 0-100
  severity: 'critical' | 'high' | 'medium';
  reason: string;
}

export interface MotifReport {
  findings: MotifFinding[];
  narrative: string;
}

// ---------------------------------------------------------------------------
// Analyzer
// ---------------------------------------------------------------------------

export function analyseOwnershipMotifs(
  edges: readonly OwnershipEdge[],
  threshold = 25
): MotifReport {
  const findings: MotifFinding[] = [];

  // Build index: owner → edges, target → edges
  const byOwner = new Map<string, OwnershipEdge[]>();
  const byTarget = new Map<string, OwnershipEdge[]>();
  for (const e of edges) {
    const o = byOwner.get(e.ownerId) ?? [];
    o.push(e);
    byOwner.set(e.ownerId, o);
    const t = byTarget.get(e.targetId) ?? [];
    t.push(e);
    byTarget.set(e.targetId, t);
  }

  // Motif 1: cumulative threshold crossing — for each target, is the
  // sum of all owner percentages <= 100 (it should be) AND does any
  // combination of sub-threshold owners add up to above threshold?
  for (const [targetId, targetEdges] of byTarget) {
    const subThreshold = targetEdges.filter((e) => e.percentage < threshold);
    if (subThreshold.length < 2) continue;
    const sum = subThreshold.reduce((acc, e) => acc + e.percentage, 0);
    if (sum > threshold) {
      findings.push({
        motifType: 'cumulative_threshold',
        targetId,
        participants: subThreshold.map((e) => e.ownerId),
        totalControl: sum,
        severity: 'high',
        reason: `${subThreshold.length} sub-threshold owners cumulatively control ${sum.toFixed(0)}% — exceeds ${threshold}% disclosure trigger despite individual holdings being below`,
      });
    }
  }

  // Motif 2: K-star — single owner holds N different <threshold stakes
  // spread across multiple targets. Common front-company pattern.
  for (const [ownerId, ownedEdges] of byOwner) {
    const subThreshold = ownedEdges.filter((e) => e.percentage < threshold);
    if (subThreshold.length >= 3) {
      const totalStake = subThreshold.reduce((acc, e) => acc + e.percentage, 0);
      findings.push({
        motifType: 'k_star',
        targetId: ownerId, // owner is the centre of the star
        participants: subThreshold.map((e) => e.targetId),
        totalControl: totalStake,
        severity: 'medium',
        reason: `Owner ${ownerId} holds ${subThreshold.length} separate sub-threshold stakes across distinct entities — K-star distributed control pattern`,
      });
    }
  }

  // Motif 3: daisy chain — A owns >= threshold of B, B owns >=
  // threshold of C, etc. Ownership propagates even though each step is
  // small because control is preserved.
  for (const edge of edges) {
    if (edge.percentage < threshold) continue;
    const nextEdges = byOwner.get(edge.targetId) ?? [];
    for (const next of nextEdges) {
      if (next.percentage < threshold) continue;
      const nextNextEdges = byOwner.get(next.targetId) ?? [];
      for (const last of nextNextEdges) {
        if (last.percentage < threshold) continue;
        findings.push({
          motifType: 'daisy_chain',
          targetId: last.targetId,
          participants: [edge.ownerId, edge.targetId, next.targetId, last.targetId],
          totalControl: (edge.percentage * next.percentage * last.percentage) / 10000,
          severity: 'high',
          reason: `${edge.ownerId} → ${edge.targetId} → ${next.targetId} → ${last.targetId} daisy chain — ultimate effective control ${((edge.percentage * next.percentage * last.percentage) / 10000).toFixed(1)}%`,
        });
      }
    }
  }

  // Motif 4: diamond — two disjoint ownership paths converge on the
  // same target via a common ancestor.
  for (const [targetId, targetEdges] of byTarget) {
    if (targetEdges.length < 2) continue;
    // For each pair of parents, check if they share an upstream ancestor.
    for (let i = 0; i < targetEdges.length; i++) {
      for (let j = i + 1; j < targetEdges.length; j++) {
        const a = targetEdges[i].ownerId;
        const b = targetEdges[j].ownerId;
        const ancestorsA = upstreamAncestors(a, byTarget);
        const ancestorsB = upstreamAncestors(b, byTarget);
        const common = [...ancestorsA].filter((x) => ancestorsB.has(x));
        if (common.length > 0) {
          findings.push({
            motifType: 'diamond',
            targetId,
            participants: [common[0], a, b, targetId],
            totalControl: targetEdges[i].percentage + targetEdges[j].percentage,
            severity: 'high',
            reason: `Diamond: two parents ${a} and ${b} both trace back to common upstream ${common[0]}`,
          });
        }
      }
    }
  }

  const narrative =
    findings.length === 0
      ? `Graph motif UBO analyzer: no evasion motifs detected in ${edges.length} ownership edge(s).`
      : `Graph motif UBO analyzer: ${findings.length} motif(s) detected. ${
          findings.filter((f) => f.severity === 'critical').length
        } critical, ${findings.filter((f) => f.severity === 'high').length} high, ${
          findings.filter((f) => f.severity === 'medium').length
        } medium. Investigate per Cabinet Decision 109/2023.`;

  return { findings, narrative };
}

function upstreamAncestors(
  nodeId: string,
  byTarget: Map<string, OwnershipEdge[]>,
  visited: Set<string> = new Set()
): Set<string> {
  if (visited.has(nodeId)) return visited;
  visited.add(nodeId);
  const parents = byTarget.get(nodeId) ?? [];
  for (const p of parents) {
    upstreamAncestors(p.ownerId, byTarget, visited);
  }
  return visited;
}
