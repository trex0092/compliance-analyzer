/**
 * Peer-Comparison Brain — reference-class reasoning.
 *
 * After the brain produces a posterior, the MLRO always wants to know:
 * "How did similar past cases resolve?" This module answers by projecting
 * the current case into a 7-dimensional evidence vector and returning the
 * k nearest peers from a fixture bank, plus their resolution distribution.
 *
 * Feature vector (all in [0, 1] unless noted):
 *   f0  name score
 *   f1  DoB component
 *   f2  Nationality component
 *   f3  ID component
 *   f4  Alias bonus (clamped to 1)
 *   f5  Risk-tier ordinal {low:0.33, medium:0.66, high:1.0}
 *   f6  List priority ordinal {watchlist:0.33, secondary:0.66, primary:1.0}
 *
 * Distance is plain Euclidean in the normalised space. k=5 by default.
 *
 * The fixture bank is injected by the caller — typically a curated set
 * of ~50 past cases with known verdicts. This keeps the module pure
 * and testable without a live datastore.
 *
 * Pure function; no I/O. Deterministic given the same fixture bank.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20      CO sees reference class, not just score
 *   FATF Rec 1                 risk-based approach informed by history
 *   FATF Rec 10                positive ID via comparable precedent
 *   EU AI Act Art.14           meaningful human oversight
 *   NIST AI RMF Measure 2.9    explainability via reference class
 *   ISO/IEC 42001 § 6.1.3      AI decision auditability
 */

import type { IdentityMatchBreakdown } from './identityMatchScore';
import type { DynamicPriorInput } from './dynamicPrior';
import type { TemporalVerdict } from './temporalPatternMemory';

export type ListPriority = DynamicPriorInput['listPriority'];

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type RiskTier = 'low' | 'medium' | 'high';

export interface PeerCase {
  /** Identifier — opaque to this module; used only for traceback. */
  caseId: string;
  breakdown: IdentityMatchBreakdown;
  riskTier: RiskTier;
  listPriority: ListPriority;
  /** Final realised verdict for this case. */
  verdict: TemporalVerdict;
  /** Optional short note rendered into the trace. */
  note?: string;
}

export interface PeerNeighbour {
  case: PeerCase;
  /** Euclidean distance in the normalised 7-D feature space, in [0, ~2.6]. */
  distance: number;
  /** Similarity = 1 / (1 + distance), in (0, 1]. */
  similarity: number;
}

export interface PeerComparisonReport {
  /** Nearest k peers. */
  neighbours: readonly PeerNeighbour[];
  /** verdict → count across the k neighbours. */
  verdictCounts: Readonly<Record<TemporalVerdict, number>>;
  /** Most common verdict across neighbours. */
  dominantVerdict: TemporalVerdict | null;
  /** Fraction of neighbours agreeing with the dominant verdict, in [0, 1]. */
  agreement: number;
  /** Human-readable summary. */
  summary: string;
}

// ---------------------------------------------------------------------------
// Feature extraction
// ---------------------------------------------------------------------------

function riskOrdinal(tier: RiskTier): number {
  switch (tier) {
    case 'low':
      return 1 / 3;
    case 'medium':
      return 2 / 3;
    case 'high':
      return 1;
  }
}

function listOrdinal(list: ListPriority): number {
  switch (list) {
    case 'watchlist':
      return 1 / 3;
    case 'secondary':
      return 2 / 3;
    case 'primary':
      return 1;
    default:
      return 1 / 3;
  }
}

function featureVector(
  breakdown: IdentityMatchBreakdown,
  riskTier: RiskTier,
  listPriority: ListPriority
): number[] {
  return [
    Math.max(0, Math.min(1, breakdown.name)),
    Math.max(0, Math.min(1, breakdown.dob)),
    Math.max(0, Math.min(1, breakdown.nationality)),
    Math.max(0, Math.min(1, breakdown.id)),
    Math.max(0, Math.min(1, breakdown.alias)),
    riskOrdinal(riskTier),
    listOrdinal(listPriority),
  ];
}

function euclidean(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

export interface PeerComparisonQuery {
  breakdown: IdentityMatchBreakdown;
  riskTier: RiskTier;
  listPriority: ListPriority;
  /** Candidate peers — typically a curated fixture of ~50 past cases. */
  bank: readonly PeerCase[];
  /** k nearest neighbours to retrieve. Default 5. */
  k?: number;
}

export function comparePeers(q: PeerComparisonQuery): PeerComparisonReport {
  const k = Math.max(1, q.k ?? 5);
  const queryVec = featureVector(q.breakdown, q.riskTier, q.listPriority);

  const scored: PeerNeighbour[] = q.bank.map((c) => {
    const vec = featureVector(c.breakdown, c.riskTier, c.listPriority);
    const d = euclidean(queryVec, vec);
    return {
      case: c,
      distance: d,
      similarity: 1 / (1 + d),
    };
  });

  scored.sort((a, b) => a.distance - b.distance);
  const neighbours = scored.slice(0, k);

  const verdictCounts: Record<TemporalVerdict, number> = {
    FREEZE: 0,
    ESCALATE: 0,
    REVIEW: 0,
    MONITOR: 0,
    DISMISS: 0,
  };
  for (const n of neighbours) verdictCounts[n.case.verdict] += 1;

  let dominantVerdict: TemporalVerdict | null = null;
  let maxCount = 0;
  for (const v of Object.keys(verdictCounts) as TemporalVerdict[]) {
    const c = verdictCounts[v];
    if (c > maxCount) {
      maxCount = c;
      dominantVerdict = v;
    }
  }
  const agreement = neighbours.length > 0 ? maxCount / neighbours.length : 0;

  const summary =
    neighbours.length === 0
      ? 'Peer bank is empty — no comparable cases available'
      : `${neighbours.length} nearest peers → ${dominantVerdict ?? 'n/a'} @ ${(agreement * 100).toFixed(0)}% agreement (top peer distance ${neighbours[0].distance.toFixed(2)})`;

  return {
    neighbours,
    verdictCounts,
    dominantVerdict,
    agreement,
    summary,
  };
}
