/**
 * Brain Permanent Memory Digest — compressed, severity-ranked
 * per-tenant memory that outlives function cold starts and deploys.
 *
 * Rationale:
 *   The Blob-backed memory store (commit 14) persists every case
 *   snapshot per tenant but is too heavy to read on every brain
 *   decision — the correlator already does that and caps at 500
 *   cases. What the brain needs ADDITIONALLY is a compact,
 *   always-loaded "digest" of the ~20 most important cases so
 *   every new decision can cite historical precedents without
 *   paying the full blob read cost.
 *
 * Three-level progressive disclosure (inspired by vendor/claude-mem):
 *
 *   Level 1: DIGEST — top 20 cases per tenant, each ~150 bytes,
 *            total <3 KB. Always injected into the brain.
 *   Level 2: TIMELINE — last 500 CaseSnapshot objects, loaded by
 *            recentForTenant() in the existing memory store.
 *   Level 3: FULL — the complete per-case blob payload, only read
 *            when the MLRO drills into a specific case.
 *
 * This module builds and maintains Level 1. Levels 2 and 3 are
 * already implemented in brainMemoryStore + brainMemoryBlobStore.
 *
 * Similarity retrieval:
 *   Given a new case's StrFeatures vector, return the top-K most
 *   similar past digest entries using cosine similarity on a 10-
 *   dimensional normalized projection. Lets the brain's reasoning
 *   chain surface "this case looks 0.87 similar to case X which
 *   was a freeze" — exactly what an MLRO wants to see.
 *
 * Storage:
 *   The digest is a plain object; the caller is responsible for
 *   persisting it (Blob, localStorage, etc.). This module is a
 *   pure reducer plus a pure retriever.
 *
 * Dedup invariants:
 *   - A digest never holds two entries with the same caseId; a
 *     replay of the same decision REPLACES the existing entry.
 *   - The digest is tenant-scoped; cross-tenant entries are
 *     silently dropped by updateDigest.
 *   - The top-K retriever never returns the query case itself
 *     (matched by caseId) so the brain never cites a case as its
 *     own precedent.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO reasoned decision — precedents
 *                             are part of the reasoning chain)
 *   FDL No.10/2025 Art.24    (10-year retention — digest is a
 *                             compact mirror of the durable log)
 *   FDL No.10/2025 Art.29    (no tipping off — digest holds only
 *                             opaque caseIds and feature vectors)
 *   Cabinet Res 134/2025 Art.19 (internal review — precedent
 *                                 citations strengthen MLRO review)
 *   FATF Rec 1, 18 (risk-based, internal controls — precedent
 *                   retrieval is a continuous-monitoring input)
 *   NIST AI RMF 1.0 MANAGE-2 (AI decision provenance — digest
 *                             entries are a reproducible trace)
 */

import type { StrFeatures } from './predictiveStr';
import type { ComplianceDecision } from './complianceDecisionEngine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrainMemoryDigestEntry {
  caseId: string;
  at: string;
  verdict: ComplianceDecision['verdict'];
  confidence: number;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  /** Opaque entity ref — NEVER the entity legal name. */
  entityRef: string;
  /** Top FATF typology id when present, otherwise null. */
  topTypologyId: string | null;
  /** Brain Power Score 0..100 when present. */
  powerScore: number | null;
  /** Was human review required? */
  requiresHumanReview: boolean;
  /** 10-dim normalized feature vector for similarity retrieval. */
  features: StrFeatures;
  /** Digest priority score — severity weight + recency decay. */
  priorityScore: number;
}

export interface BrainMemoryDigest {
  tenantId: string;
  /** Sorted descending by priorityScore. */
  entries: readonly BrainMemoryDigestEntry[];
  /** Total case updates the digest has seen across all time. */
  totalUpdates: number;
  /** ISO timestamp of the last update. */
  lastUpdatedAtIso: string;
}

export interface DigestConfig {
  /** Cap on digest size per tenant. Default 20. */
  maxEntries?: number;
  /** Recency half-life in days. Default 30. */
  recencyHalfLifeDays?: number;
  /** Current time (for recency calculations). Default new Date(). */
  now?: Date;
}

export interface PrecedentQueryInput {
  /** The new case the brain is deciding on. */
  caseId: string;
  features: StrFeatures;
  /** Max precedents to return. Default 3. */
  topK?: number;
  /** Minimum cosine similarity 0..1. Default 0.5. */
  minSimilarity?: number;
}

export interface PrecedentMatch {
  entry: BrainMemoryDigestEntry;
  /** Cosine similarity 0..1. */
  similarity: number;
  /** Plain-English explanation suitable for the reasoning chain. */
  narrative: string;
}

export interface PrecedentReport {
  tenantId: string;
  matches: readonly PrecedentMatch[];
  /** True when at least one critical precedent matched above threshold. */
  hasCriticalPrecedent: boolean;
  /** Plain-English summary for the Asana task + STR narrative. */
  summary: string;
}

// ---------------------------------------------------------------------------
// Severity mapping
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHTS: Record<BrainMemoryDigestEntry['severity'], number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function severityFromVerdict(
  verdict: ComplianceDecision['verdict']
): BrainMemoryDigestEntry['severity'] {
  switch (verdict) {
    case 'freeze':
      return 'critical';
    case 'escalate':
      return 'high';
    case 'flag':
      return 'medium';
    case 'pass':
      return 'info';
  }
}

// ---------------------------------------------------------------------------
// Feature vector normalization — maps StrFeatures to a 10-dim vector
// in [0, 1] for cosine similarity.
// ---------------------------------------------------------------------------

const LOG10 = (n: number): number => Math.log(n) / Math.LN10;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function featuresToVector(f: StrFeatures): number[] {
  return [
    clamp01(f.priorAlerts90d / 10), // 0..10+ → 0..1
    clamp01(LOG10(Math.max(0, f.txValue30dAED) + 1) / 9), // 0..1e9 AED log scale
    clamp01(f.nearThresholdCount30d / 10),
    clamp01(f.crossBorderRatio30d),
    f.isPep ? 1 : 0,
    f.highRiskJurisdiction ? 1 : 0,
    f.hasAdverseMedia ? 1 : 0,
    // Inverse: newer relationships score higher (riskier)
    clamp01(1 - LOG10(Math.max(0, f.daysSinceOnboarding) + 1) / 4),
    clamp01(f.sanctionsMatchScore),
    clamp01(f.cashRatio30d),
  ];
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ---------------------------------------------------------------------------
// Priority score — severity weight + recency decay
// ---------------------------------------------------------------------------

function daysBetween(aIso: string, nowMs: number): number {
  const t = Date.parse(aIso);
  if (!Number.isFinite(t)) return Infinity;
  return (nowMs - t) / 86_400_000;
}

function priorityScore(
  severity: BrainMemoryDigestEntry['severity'],
  atIso: string,
  now: Date,
  halfLifeDays: number
): number {
  const sev = SEVERITY_WEIGHTS[severity];
  const ageDays = daysBetween(atIso, now.getTime());
  // Exponential decay: score = 10*sev * 0.5^(age/halfLife)
  const decay = Math.pow(0.5, Math.max(0, ageDays) / halfLifeDays);
  return Math.round(10 * sev * decay * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Digest mutation
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ENTRIES = 20;
const DEFAULT_RECENCY_HALF_LIFE_DAYS = 30;

export function emptyDigest(tenantId: string): BrainMemoryDigest {
  return {
    tenantId,
    entries: [],
    totalUpdates: 0,
    lastUpdatedAtIso: new Date(0).toISOString(),
  };
}

export interface DigestUpdateInput {
  tenantId: string;
  decision: ComplianceDecision;
  features: StrFeatures;
  entityRef?: string;
  topTypologyId?: string | null;
  powerScore?: number | null;
}

/**
 * Update a digest with a new decision. Pure function: returns a new
 * digest and never mutates the input. Tenant-scoped; cross-tenant
 * updates are silently dropped.
 */
export function updateDigest(
  digest: BrainMemoryDigest,
  input: DigestUpdateInput,
  cfg: DigestConfig = {}
): BrainMemoryDigest {
  if (input.tenantId !== digest.tenantId) {
    return digest; // isolation invariant
  }
  const maxEntries = cfg.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const halfLife = cfg.recencyHalfLifeDays ?? DEFAULT_RECENCY_HALF_LIFE_DAYS;
  const now = cfg.now ?? new Date();

  const severity = severityFromVerdict(input.decision.verdict);
  const entry: BrainMemoryDigestEntry = {
    caseId: input.decision.id,
    at: input.decision.at,
    verdict: input.decision.verdict,
    confidence: input.decision.confidence,
    severity,
    entityRef: input.entityRef ?? input.decision.warRoomEvent.entityId ?? input.decision.id,
    topTypologyId: input.topTypologyId ?? null,
    powerScore: input.powerScore ?? null,
    requiresHumanReview: input.decision.requiresHumanReview,
    features: input.features,
    priorityScore: priorityScore(severity, input.decision.at, now, halfLife),
  };

  // Dedup: replace any existing entry with the same caseId.
  const filtered = digest.entries.filter((e) => e.caseId !== entry.caseId);
  const combined = [...filtered, entry];

  // Re-score priorities with the current `now` so older entries decay.
  const rescored = combined.map((e) => ({
    ...e,
    priorityScore: priorityScore(e.severity, e.at, now, halfLife),
  }));

  // Sort by priority desc, keep top N.
  rescored.sort((a, b) => b.priorityScore - a.priorityScore);
  const capped = rescored.slice(0, maxEntries);

  return {
    tenantId: digest.tenantId,
    entries: Object.freeze(capped),
    totalUpdates: digest.totalUpdates + 1,
    lastUpdatedAtIso: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Precedent retrieval
// ---------------------------------------------------------------------------

const DEFAULT_TOP_K = 3;
const DEFAULT_MIN_SIMILARITY = 0.5;

export function retrievePrecedents(
  digest: BrainMemoryDigest,
  query: PrecedentQueryInput
): PrecedentReport {
  const topK = query.topK ?? DEFAULT_TOP_K;
  const minSim = query.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const queryVec = featuresToVector(query.features);

  const scored: PrecedentMatch[] = [];
  for (const entry of digest.entries) {
    // Never cite the query case as its own precedent.
    if (entry.caseId === query.caseId) continue;
    const similarity = cosineSimilarity(queryVec, featuresToVector(entry.features));
    if (similarity < minSim) continue;
    scored.push({
      entry,
      similarity,
      narrative: `This case is ${(similarity * 100).toFixed(0)}% similar to ${entry.caseId} (verdict ${entry.verdict}, ${entry.severity}).`,
    });
  }

  // Sort by similarity desc, then severity weight desc, then priorityScore.
  scored.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    const sa = SEVERITY_WEIGHTS[a.entry.severity];
    const sb = SEVERITY_WEIGHTS[b.entry.severity];
    if (sb !== sa) return sb - sa;
    return b.entry.priorityScore - a.entry.priorityScore;
  });

  const matches = scored.slice(0, topK);
  const hasCriticalPrecedent = matches.some((m) => m.entry.severity === 'critical');

  const summary =
    matches.length === 0
      ? `No historical precedents in the digest for tenant ${digest.tenantId}.`
      : hasCriticalPrecedent
        ? `Found ${matches.length} precedent(s); top match is ${(matches[0].similarity * 100).toFixed(0)}% similar to a prior critical case. Weight this heavily in the MLRO review.`
        : `Found ${matches.length} precedent(s); top match is ${(matches[0].similarity * 100).toFixed(0)}% similar to a prior ${matches[0].entry.verdict} case.`;

  return {
    tenantId: digest.tenantId,
    matches,
    hasCriticalPrecedent,
    summary,
  };
}

// Exports for tests.
export const __test__ = {
  SEVERITY_WEIGHTS,
  severityFromVerdict,
  clamp01,
  daysBetween,
  priorityScore,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_RECENCY_HALF_LIFE_DAYS,
};
