/**
 * Dispatch Pattern Miner — Tier B1.
 *
 * Walks the dispatch audit log and clusters entries by
 * verdict + red-flag overlap so the MLRO can see which cases
 * cluster together across time. The output is a DispatchCluster[]
 * that downstream code can:
 *
 *   - Render in the Brain Console as a "Pattern Library" panel
 *   - Mirror into a dedicated Asana project (one task per cluster)
 *   - Feed into the batch dispatcher as a priority signal
 *
 * Pure reducer over the audit log. No network, no storage writes.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.19-21 (MLRO visibility into portfolio trends)
 *   - Cabinet Res 134/2025 Art.5 (risk appetite calibration)
 *   - NIST AI RMF 1.0 MEASURE-2 (AI decision provenance)
 */

import type { DispatchAuditEntry } from './dispatchAuditLog';
import type { Verdict } from './asanaCustomFields';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DispatchCluster {
  id: string;
  verdict: Verdict;
  /** Case ids in this cluster. */
  caseIds: string[];
  /** Representative signature — sorted red-flag set joined. */
  signature: string;
  /** Average confidence across the cluster. */
  averageConfidence: number;
  /** Cluster size — driven by ops dashboards. */
  size: number;
  /** Oldest and newest dispatch timestamps. */
  firstSeenIso: string;
  lastSeenIso: string;
  /** Error rate within the cluster (0..1). */
  errorRate: number;
}

export interface PatternMinerOptions {
  /** Minimum cluster size to report. Default 2. */
  minClusterSize?: number;
  /** Only return the top-N clusters by size. Default unlimited. */
  topN?: number;
  /** Filter to a time window. */
  since?: string;
}

// ---------------------------------------------------------------------------
// Signature derivation
// ---------------------------------------------------------------------------

/**
 * Signatures collapse the "red flag set" of a dispatch into a
 * stable key. Empty audit entries collapse to the verdict alone.
 *
 * NOTE: the current DispatchAuditEntry doesn't carry red flags
 * (only aggregate counts). Until it does, the signature is
 * driven by the verdict + suggestedColumn + 24h bucket. That
 * still produces useful clusters for ops dashboards (same-
 * verdict streaks during a given shift).
 */
export function buildSignature(entry: DispatchAuditEntry): string {
  const day = entry.dispatchedAtIso.slice(0, 10);
  return `${entry.verdict}:${entry.suggestedColumn}:${day}`;
}

// ---------------------------------------------------------------------------
// Miner
// ---------------------------------------------------------------------------

export function mineDispatchPatterns(
  entries: readonly DispatchAuditEntry[],
  options: PatternMinerOptions = {}
): DispatchCluster[] {
  const minSize = options.minClusterSize ?? 2;
  const sinceMs = options.since ? Date.parse(options.since) : undefined;

  const buckets = new Map<
    string,
    {
      caseIds: Set<string>;
      confidenceSum: number;
      confidenceCount: number;
      firstMs: number;
      lastMs: number;
      errorCount: number;
      verdict: Verdict;
    }
  >();

  for (const entry of entries) {
    const atMs = Date.parse(entry.dispatchedAtIso);
    if (!Number.isFinite(atMs)) continue;
    if (sinceMs && atMs < sinceMs) continue;

    const sig = buildSignature(entry);
    const bucket = buckets.get(sig) ?? {
      caseIds: new Set<string>(),
      confidenceSum: 0,
      confidenceCount: 0,
      firstMs: Number.POSITIVE_INFINITY,
      lastMs: 0,
      errorCount: 0,
      verdict: entry.verdict,
    };
    bucket.caseIds.add(entry.caseId);
    bucket.confidenceSum += entry.confidence;
    bucket.confidenceCount += 1;
    bucket.firstMs = Math.min(bucket.firstMs, atMs);
    bucket.lastMs = Math.max(bucket.lastMs, atMs);
    if (entry.errors.length > 0) bucket.errorCount += 1;
    buckets.set(sig, bucket);
  }

  const clusters: DispatchCluster[] = [];
  for (const [sig, bucket] of buckets) {
    if (bucket.caseIds.size < minSize) continue;
    clusters.push({
      id: `cluster_${sig}`,
      verdict: bucket.verdict,
      caseIds: Array.from(bucket.caseIds),
      signature: sig,
      averageConfidence:
        bucket.confidenceCount > 0 ? bucket.confidenceSum / bucket.confidenceCount : 0,
      size: bucket.caseIds.size,
      firstSeenIso: new Date(bucket.firstMs).toISOString(),
      lastSeenIso: new Date(bucket.lastMs).toISOString(),
      errorRate: bucket.confidenceCount > 0 ? bucket.errorCount / bucket.confidenceCount : 0,
    });
  }

  clusters.sort((a, b) => b.size - a.size);
  return options.topN && options.topN > 0 ? clusters.slice(0, options.topN) : clusters;
}
