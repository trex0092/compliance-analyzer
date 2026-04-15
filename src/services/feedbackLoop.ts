/**
 * Feedback Loop — closed-loop persistence + clamped weight delta
 * generator that turns MLRO overrides into Tier C clamp suggestions.
 *
 * Why this exists:
 *   src/services/feedbackLearner.ts already knows how to compute a
 *   weight delta from a single override using `applyOverride()`. But
 *   that runs in-memory on every call — it never persists, never
 *   aggregates across overrides, and never produces a Tier C
 *   clamp-suggestion record that the MLRO can review and accept.
 *
 *   Without a persistence + aggregation layer, the brain is static:
 *   each MLRO learns the same lessons over and over because nothing
 *   carries between cases. With it, the brain compounds.
 *
 *   This module is the persistence + aggregation + Tier C bridge.
 *   It exposes:
 *
 *     - recordOverride()     — append a single MLRO override to the
 *                              feedback blob store
 *     - readOverrides()      — load every override for a tenant (or
 *                              for a date range)
 *     - rollupWeightDelta()  — pure-function aggregator that walks
 *                              a batch of overrides and produces the
 *                              proposed weight delta clamped to
 *                              ±MAX_WEIGHT_DELTA_PCT of the current
 *                              baseline. NEVER mutates constants.ts.
 *     - asClampSuggestion()  — wraps the rolled-up delta in a Tier C
 *                              clamp-suggestion record so the existing
 *                              ClampSuggestionBlobStore + Brain
 *                              Console UI can review + accept it
 *
 * Safety invariants (load-bearing — read CLAUDE.md §1 + Tier C):
 *   1. The brain NEVER auto-applies a weight delta. Every delta is
 *      a Tier C *suggestion* — MLRO accepts, then a human opens a
 *      PR and edits constants.ts by hand with a citation.
 *   2. The aggregated delta is clamped to ±MAX_WEIGHT_DELTA_PCT
 *      (15% by default) of the current weight, regardless of how
 *      many overrides voted in the same direction. This is the
 *      regulatory envelope — a runaway aggregator cannot move the
 *      weight outside the legal range.
 *   3. The aggregator NEVER suggests softening a verdict. Overrides
 *      that reduced severity (brain said freeze, MLRO said pass)
 *      are still recorded for audit but they DO NOT contribute to
 *      a weight delta. We only learn from escalations.
 *   4. The aggregator requires a minimum sample size
 *      (MIN_OVERRIDES_PER_FEATURE) before it will produce a delta.
 *      One MLRO disagreeing with one verdict is not signal.
 *   5. Every persisted override carries a regulatory citation. If
 *      the citation field is empty the record is rejected at write
 *      time.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.19-21 (CO judgment authority + reasoned override)
 *   FDL No.10/2025 Art.20-22 (continuous monitoring)
 *   FDL No.10/2025 Art.24    (10-year retention of override audit trail)
 *   Cabinet Res 134/2025 Art.19 (internal review feedback loop)
 *   FATF Rec 1               (risk-based approach must be continually updated)
 *   NIST AI RMF 1.0 GOVERN-4 (human override + accountability)
 *   NIST AI RMF 1.0 MEASURE-4 (continuous validation + recourse)
 *   EU AI Act Art.14         (human oversight)
 *   EU AI Act Art.15         (accuracy + robustness — feedback closes the loop)
 */

import type { BlobHandle } from './brainMemoryBlobStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FeedbackVerdict = 'pass' | 'flag' | 'escalate' | 'freeze';

export interface MlroOverrideRecord {
  /** Unique override id — sha3(tenant + case + ts) typically. */
  id: string;
  /** ISO timestamp the override was issued. */
  tsIso: string;
  /** Tenant scope. */
  tenantId: string;
  /** Opaque case id — never an entity legal name. */
  caseId: string;
  /** MLRO user id (NOT email — opaque user gid). */
  mlroUserId: string;
  /** Brain-computed verdict before the override. */
  brainVerdict: FeedbackVerdict;
  /** MLRO-final verdict. */
  humanVerdict: FeedbackVerdict;
  /**
   * StrFeatures vector seen at decision time. Numeric features only —
   * booleans are encoded 0/1 by the caller.
   */
  features: Record<string, number>;
  /**
   * Free-text rationale — required, non-empty, ≤ 2000 chars.
   * The deferred-outbound-queue lint pattern applies: no language
   * that could later tip off the subject if a record leaks.
   */
  rationale: string;
  /**
   * Regulatory citation — required, non-empty. Article / Resolution /
   * Circular reference that justifies the override.
   */
  regulatoryCitation: string;
}

export interface WeightDelta {
  feature: string;
  /** Direction in which the aggregated overrides voted. */
  direction: 'increase' | 'decrease';
  /** Number of overrides that fed into this delta. */
  sampleSize: number;
  /** Mean magnitude of the feature value in escalation overrides. */
  meanMagnitude: number;
  /** Suggested multiplicative factor on the current weight. */
  proposedFactor: number;
  /**
   * Plain-English reason carried into the Tier C suggestion record.
   */
  reason: string;
}

export interface RollupReport {
  tenantId: string;
  windowStartIso: string;
  windowEndIso: string;
  totalOverrides: number;
  /**
   * Overrides that were retained for audit but did NOT contribute
   * to a delta (downgrades + below-sample-threshold features).
   */
  ignoredForDeltaCount: number;
  /** Per-feature proposed weight delta. Empty when no signal. */
  deltas: readonly WeightDelta[];
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VERDICT_RANK: Record<FeedbackVerdict, number> = {
  pass: 0,
  flag: 1,
  escalate: 2,
  freeze: 3,
};

/**
 * Hard cap on the aggregator's proposed weight factor — the brain
 * can never propose a weight change of more than ±15% in a single
 * rollup, no matter how many overrides voted in the same direction.
 * This is the regulatory envelope — without it a coordinated bias
 * could push the brain outside the legal threshold range.
 */
export const MAX_WEIGHT_DELTA_PCT = 0.15;

/**
 * Minimum number of escalation overrides on the same feature before
 * the aggregator will produce a delta for it. Below this we have no
 * statistical signal and we should not propose a tuning.
 */
export const MIN_OVERRIDES_PER_FEATURE = 5;

const MAX_RATIONALE_LEN = 2000;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateOverrideRecord(
  record: unknown
): { ok: true; record: MlroOverrideRecord } | { ok: false; error: string } {
  if (!record || typeof record !== 'object') {
    return { ok: false, error: 'record must be an object' };
  }
  const r = record as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 256) {
    return { ok: false, error: 'id required (<=256)' };
  }
  if (typeof r.tsIso !== 'string' || isNaN(Date.parse(r.tsIso))) {
    return { ok: false, error: 'tsIso must be ISO date' };
  }
  if (typeof r.tenantId !== 'string' || r.tenantId.length === 0 || r.tenantId.length > 64) {
    return { ok: false, error: 'tenantId required (<=64)' };
  }
  if (typeof r.caseId !== 'string' || r.caseId.length === 0 || r.caseId.length > 256) {
    return { ok: false, error: 'caseId required (<=256)' };
  }
  if (typeof r.mlroUserId !== 'string' || r.mlroUserId.length === 0) {
    return { ok: false, error: 'mlroUserId required' };
  }
  if (typeof r.brainVerdict !== 'string' || !(r.brainVerdict in VERDICT_RANK)) {
    return { ok: false, error: 'brainVerdict must be pass|flag|escalate|freeze' };
  }
  if (typeof r.humanVerdict !== 'string' || !(r.humanVerdict in VERDICT_RANK)) {
    return { ok: false, error: 'humanVerdict must be pass|flag|escalate|freeze' };
  }
  if (!r.features || typeof r.features !== 'object') {
    return { ok: false, error: 'features must be an object' };
  }
  for (const [k, v] of Object.entries(r.features as Record<string, unknown>)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { ok: false, error: `features.${k} must be finite number` };
    }
  }
  if (typeof r.rationale !== 'string' || r.rationale.length === 0) {
    return { ok: false, error: 'rationale required' };
  }
  if (r.rationale.length > MAX_RATIONALE_LEN) {
    return { ok: false, error: `rationale must be <= ${MAX_RATIONALE_LEN} chars` };
  }
  if (typeof r.regulatoryCitation !== 'string' || r.regulatoryCitation.length === 0) {
    return { ok: false, error: 'regulatoryCitation required (non-empty)' };
  }
  return {
    ok: true,
    record: {
      id: r.id,
      tsIso: r.tsIso,
      tenantId: r.tenantId,
      caseId: r.caseId,
      mlroUserId: r.mlroUserId,
      brainVerdict: r.brainVerdict as FeedbackVerdict,
      humanVerdict: r.humanVerdict as FeedbackVerdict,
      features: r.features as Record<string, number>,
      rationale: r.rationale,
      regulatoryCitation: r.regulatoryCitation,
    },
  };
}

// ---------------------------------------------------------------------------
// Pure aggregator
// ---------------------------------------------------------------------------

/**
 * Aggregate a batch of MLRO overrides into a per-feature weight delta
 * proposal. Pure function. Same input → same output.
 *
 * Algorithm:
 *   1. Filter out downgrade overrides (humanVerdict < brainVerdict).
 *      We never auto-soften verdicts — see safety invariant #3.
 *   2. For each remaining override, identify the top-3 features by
 *      absolute magnitude. Those are the features that "carried"
 *      the case.
 *   3. Bucket by feature. A feature only produces a delta if it has
 *      ≥ MIN_OVERRIDES_PER_FEATURE escalation samples.
 *   4. Compute the proposed factor = 1 + min(MAX_WEIGHT_DELTA_PCT,
 *      LEARNING_RATE * mean_disagreement). Clamped to ±15%.
 *   5. Direction is always "increase" (we are reinforcing the
 *      under-weighted feature). Decreases are reserved for a
 *      future quarterly recalibration that requires explicit MLRO
 *      sign-off, NOT this loop.
 */
export function rollupWeightDelta(
  tenantId: string,
  windowStartIso: string,
  windowEndIso: string,
  overrides: readonly MlroOverrideRecord[]
): RollupReport {
  let ignored = 0;
  const featureBuckets = new Map<string, { values: number[]; disagreements: number[] }>();

  for (const o of overrides) {
    const direction = VERDICT_RANK[o.humanVerdict] - VERDICT_RANK[o.brainVerdict];
    if (direction <= 0) {
      ignored += 1;
      continue;
    }
    const top3 = Object.entries(o.features)
      .map(([k, v]) => [k, Math.abs(v)] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    for (const [feature, magnitude] of top3) {
      let bucket = featureBuckets.get(feature);
      if (!bucket) {
        bucket = { values: [], disagreements: [] };
        featureBuckets.set(feature, bucket);
      }
      bucket.values.push(magnitude);
      bucket.disagreements.push(direction);
    }
  }

  const deltas: WeightDelta[] = [];
  for (const [feature, bucket] of featureBuckets) {
    if (bucket.values.length < MIN_OVERRIDES_PER_FEATURE) {
      ignored += bucket.values.length;
      continue;
    }
    const meanMagnitude = bucket.values.reduce((a, b) => a + b, 0) / bucket.values.length;
    const meanDisagreement =
      bucket.disagreements.reduce((a, b) => a + b, 0) / bucket.disagreements.length;
    // Learning rate baked in at 0.05 — combined with the ±15% cap
    // this means we propose a maximum of ±15% movement after
    // consistent signal across many overrides.
    const proposedFactorRaw = 1 + 0.05 * meanDisagreement;
    const proposedFactor = Math.min(
      1 + MAX_WEIGHT_DELTA_PCT,
      Math.max(1, proposedFactorRaw) // never below 1.0 — see invariant #3
    );
    deltas.push({
      feature,
      direction: 'increase',
      sampleSize: bucket.values.length,
      meanMagnitude,
      proposedFactor,
      reason:
        `${bucket.values.length} MLRO escalation override(s) on feature "${feature}" with ` +
        `mean disagreement ${meanDisagreement.toFixed(2)} and mean magnitude ` +
        `${meanMagnitude.toFixed(3)}. Proposed weight factor ${proposedFactor.toFixed(3)} ` +
        `(clamped to ±${(MAX_WEIGHT_DELTA_PCT * 100).toFixed(0)}% per regulatory envelope).`,
    });
  }

  deltas.sort((a, b) => b.sampleSize - a.sampleSize);

  const summary =
    deltas.length === 0
      ? `No actionable weight deltas in window ${windowStartIso}→${windowEndIso} ` +
        `(${overrides.length} overrides observed, ${ignored} ignored).`
      : `${deltas.length} feature delta(s) proposed from ${overrides.length} override(s) ` +
        `(${ignored} ignored). Strongest signal: ${deltas[0]!.feature} ` +
        `(n=${deltas[0]!.sampleSize}, factor ${deltas[0]!.proposedFactor.toFixed(3)}).`;

  return {
    tenantId,
    windowStartIso,
    windowEndIso,
    totalOverrides: overrides.length,
    ignoredForDeltaCount: ignored,
    deltas,
    summary,
    regulatory: [
      'FDL No.10/2025 Art.19-21',
      'FDL No.10/2025 Art.20-22',
      'FDL No.10/2025 Art.24',
      'Cabinet Res 134/2025 Art.19',
      'FATF Rec 1',
      'NIST AI RMF 1.0 GOVERN-4',
      'NIST AI RMF 1.0 MEASURE-4',
      'EU AI Act Art.14',
      'EU AI Act Art.15',
    ],
  };
}

// ---------------------------------------------------------------------------
// Tier C bridge — wrap the rollup as a clamp-suggestion record
// ---------------------------------------------------------------------------

/**
 * Shape of the Tier C clamp-suggestion record consumed by the
 * existing ClampSuggestionBlobStore + Brain Console UI. We keep this
 * inline rather than importing the live store type so this module
 * stays free of cross-package coupling for tests.
 */
export interface ClampSuggestionRecord {
  id: string;
  createdAtIso: string;
  tenantId: string;
  clampKey: string;
  currentValue: number;
  proposedValue: number;
  status: 'pending_mlro_review';
  evidence: {
    sampleSize: number;
    meanMagnitude: number;
    direction: 'increase' | 'decrease';
    rationale: string;
  };
  regulatory: string;
  source: 'feedback-loop';
}

/**
 * Convert a rollup delta into one Tier C clamp-suggestion record per
 * feature. The caller persists these via the existing
 * ClampSuggestionBlobStore. The MLRO reviews them through the Brain
 * Console "TIER C OPS" panel and accepts or rejects each.
 */
export function asClampSuggestions(
  report: RollupReport,
  currentWeights: Readonly<Record<string, number>>,
  now: () => Date = () => new Date()
): readonly ClampSuggestionRecord[] {
  const out: ClampSuggestionRecord[] = [];
  const ts = now().toISOString();
  for (const d of report.deltas) {
    const current = currentWeights[d.feature] ?? 1;
    const proposed = current * d.proposedFactor;
    out.push({
      id: `feedback:${report.tenantId}:${d.feature}:${ts}`,
      createdAtIso: ts,
      tenantId: report.tenantId,
      clampKey: `weight:${d.feature}`,
      currentValue: current,
      proposedValue: proposed,
      status: 'pending_mlro_review',
      evidence: {
        sampleSize: d.sampleSize,
        meanMagnitude: d.meanMagnitude,
        direction: d.direction,
        rationale: d.reason,
      },
      regulatory: 'FDL Art.19-21; Cabinet Res 134/2025 Art.19; NIST AI RMF GOVERN-4',
      source: 'feedback-loop',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Persistence layer (blob-backed)
// ---------------------------------------------------------------------------

/**
 * Append-only feedback store. Mirrors the BrainTelemetryStore pattern:
 * one blob per tenant per UTC day, JSON array of override records.
 */
export class FeedbackBlobStore {
  private readonly blob: BlobHandle;
  constructor(blob: BlobHandle) {
    this.blob = blob;
  }

  private dayKey(tenantId: string, dayIso: string): string {
    const safeTenant = tenantId.replace(/[^a-z0-9_-]/gi, '-').slice(0, 64);
    const safeDay = dayIso.slice(0, 10);
    return `feedback/${safeTenant}/${safeDay}.json`;
  }

  async record(record: MlroOverrideRecord): Promise<void> {
    const validated = validateOverrideRecord(record);
    if (!validated.ok) {
      throw new Error(`feedbackLoop.record: ${validated.error}`);
    }
    const key = this.dayKey(validated.record.tenantId, validated.record.tsIso);
    const existing = await this.blob.getJSON<{ records: MlroOverrideRecord[] } | null>(key);
    const records: MlroOverrideRecord[] =
      existing && Array.isArray(existing.records) ? existing.records.slice() : [];
    records.push(validated.record);
    await this.blob.setJSON(key, { records });
  }

  async readDay(tenantId: string, dayIso: string): Promise<MlroOverrideRecord[]> {
    try {
      const raw = await this.blob.getJSON<{ records: MlroOverrideRecord[] } | null>(
        this.dayKey(tenantId, dayIso)
      );
      if (raw && Array.isArray(raw.records)) return raw.records;
      return [];
    } catch {
      return [];
    }
  }

  async readRange(
    tenantId: string,
    startIso: string,
    endIso: string
  ): Promise<MlroOverrideRecord[]> {
    const start = new Date(startIso.slice(0, 10));
    const end = new Date(endIso.slice(0, 10));
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return [];
    const all: MlroOverrideRecord[] = [];
    const cursor = new Date(start.getTime());
    while (cursor.getTime() <= end.getTime()) {
      const dayIso = cursor.toISOString().slice(0, 10);
      const day = await this.readDay(tenantId, dayIso);
      for (const r of day) all.push(r);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return all;
  }
}

// Exports for tests.
export const __test__ = { VERDICT_RANK };
