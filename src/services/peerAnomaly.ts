/**
 * Peer-Group Anomaly Explainer.
 *
 * Raw anomaly scores are useless to MLROs. "This customer is 3.2 sigma
 * out" means nothing without context. This module turns statistical
 * anomalies into human-readable explanations grounded in peer group
 * comparisons.
 *
 * Input: a target entity's features + a peer group (gold dealers of
 * similar size, customers of the same risk band, etc.).
 *
 * Output:
 *   1. Per-feature z-score against the peer distribution.
 *   2. Natural-language explanation of which features are anomalous.
 *   3. Anomaly RANK in the peer group.
 *   4. Mahalanobis-style overall score (diagonal approximation — we do
 *      not compute a full covariance matrix because (a) it requires
 *      more data than we typically have, and (b) it makes the result
 *      uninterpretable).
 *
 * The explanations mention only features the MLRO can act on, with
 * regulatory anchors where applicable ("cash ratio 3σ above peers,
 * review under MoE Circular 08/AML/2021").
 *
 * Regulatory basis:
 *   - FATF Rec 15 (unusual patterns)
 *   - Cabinet Res 134/2025 Art.19 (internal review)
 *   - MoE Circular 08/AML/2021 (cash transaction red flags)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PeerAnomalyInput {
  target: Record<string, number>;
  peers: ReadonlyArray<Record<string, number>>;
  /** Regulatory anchors per feature for explanation text. */
  anchors?: Record<string, string>;
  /** Minimum |z| threshold to flag a feature as anomalous. */
  anomalyThreshold?: number;
}

export interface FeatureAnomaly {
  feature: string;
  value: number;
  peerMean: number;
  peerStdDev: number;
  zScore: number;
  direction: 'higher' | 'lower';
  regulatoryAnchor?: string;
  explanation: string;
}

export interface PeerAnomalyReport {
  overallScore: number; // Mahalanobis-style (diag cov)
  anomalyRank: number; // 1-based rank within peers + target
  numPeers: number;
  anomalies: FeatureAnomaly[];
  explanation: string;
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stdDev(xs: readonly number[], mu: number): number {
  if (xs.length < 2) return 0;
  const sq = xs.reduce((s, x) => s + (x - mu) ** 2, 0);
  return Math.sqrt(sq / (xs.length - 1));
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export function analysePeerAnomaly(input: PeerAnomalyInput): PeerAnomalyReport {
  const threshold = input.anomalyThreshold ?? 2;
  const anchors = input.anchors ?? {};

  const features = Array.from(
    new Set([
      ...Object.keys(input.target),
      ...input.peers.flatMap((p) => Object.keys(p)),
    ]),
  );

  const anomalies: FeatureAnomaly[] = [];
  let sumSquaredZ = 0;

  for (const feature of features) {
    const peerValues = input.peers
      .map((p) => p[feature])
      .filter((v): v is number => typeof v === 'number');
    if (peerValues.length < 2) continue;
    const mu = mean(peerValues);
    const sd = stdDev(peerValues, mu);
    const value = input.target[feature] ?? 0;
    if (sd === 0) continue;
    const z = (value - mu) / sd;
    sumSquaredZ += z * z;

    if (Math.abs(z) >= threshold) {
      const direction: FeatureAnomaly['direction'] = z > 0 ? 'higher' : 'lower';
      anomalies.push({
        feature,
        value: round4(value),
        peerMean: round4(mu),
        peerStdDev: round4(sd),
        zScore: round4(z),
        direction,
        regulatoryAnchor: anchors[feature],
        explanation: formatExplanation(feature, z, direction, anchors[feature]),
      });
    }
  }

  anomalies.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));

  // Mahalanobis-diagonal overall score (L2 norm in z-space).
  const overall = Math.sqrt(sumSquaredZ);

  // Rank: count peers with a lower Mahalanobis score than the target.
  let rank = 1;
  for (const peer of input.peers) {
    let peerSum = 0;
    for (const feature of features) {
      const peerValues = input.peers
        .map((p) => p[feature])
        .filter((v): v is number => typeof v === 'number');
      if (peerValues.length < 2) continue;
      const mu = mean(peerValues);
      const sd = stdDev(peerValues, mu);
      if (sd === 0) continue;
      const z = ((peer[feature] ?? 0) - mu) / sd;
      peerSum += z * z;
    }
    if (Math.sqrt(peerSum) > overall) rank += 1;
  }

  const explanation = composeOverallExplanation(overall, anomalies);

  return {
    overallScore: round4(overall),
    anomalyRank: rank,
    numPeers: input.peers.length,
    anomalies,
    explanation,
  };
}

function formatExplanation(
  feature: string,
  z: number,
  direction: 'higher' | 'lower',
  anchor?: string,
): string {
  const base = `${feature} is ${Math.abs(z).toFixed(2)}σ ${direction} than peers`;
  return anchor ? `${base}. Regulatory anchor: ${anchor}.` : `${base}.`;
}

function composeOverallExplanation(
  overallScore: number,
  anomalies: readonly FeatureAnomaly[],
): string {
  if (anomalies.length === 0) {
    return `No features exceeded the anomaly threshold. Overall deviation ${overallScore.toFixed(2)}.`;
  }
  const top = anomalies.slice(0, 3).map((a) => a.feature).join(', ');
  return `Overall deviation ${overallScore.toFixed(2)}. Primary drivers: ${top}.`;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
