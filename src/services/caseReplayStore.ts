/**
 * Case Replay Store — per-case regulatory snapshot persistence
 * so historical brain decisions can be re-validated against the
 * CURRENT regulatory baseline.
 *
 * Why this exists:
 *   src/services/regulatoryDriftWatchdog.ts detects when the
 *   constants the brain is CURRENTLY USING diverge from a baseline.
 *   It does NOT, however, answer the more useful audit question:
 *
 *     "Did the constants drift for THIS specific case that was
 *      decided six months ago, and if so, would the decision
 *      change today?"
 *
 *   Regulators (MoE, LBMA, internal audit) routinely ask that
 *   question during inspection — they pick a random historical
 *   case and ask the MLRO to demonstrate the decision still holds
 *   against today's constants. Without a stored-baseline per case,
 *   the best the MLRO can offer is a hand-wave.
 *
 * This store solves it by persisting, for every brain decision:
 *   1. The CaseSnapshot already used by the cross-case correlator
 *      (so no duplicated storage of entity features)
 *   2. A frozen RegulatoryBaseline captured at decision time
 *   3. The verdict + confidence + power score at decision time
 *
 *   Replay then loads the tuple, runs checkRegulatoryDrift() using
 *   the stored baseline, and additionally re-classifies threshold-
 *   dependent features against today's constants. The result is a
 *   ReplayReport suitable for attaching to an audit response.
 *
 * Storage layout (Netlify Blob store `brain-memory`, same backend
 * as BlobBrainMemoryStore):
 *
 *   replay/<tenantId>/<caseId>.json
 *     → a single serialised ReplayCase
 *
 *   Why a separate path: we deliberately do NOT reuse the
 *   `snapshots/` path from BlobBrainMemoryStore because that store
 *   is eviction-managed (FIFO to maxSnapshotsPerTenant) and we want
 *   the replay data to survive eviction for the full 10-year
 *   retention window (FDL Art.24).
 *
 * Safety invariants:
 *   - Tenant-scoped key. Cross-tenant reads are impossible by
 *     construction (safeSegment on the tenantId path segment).
 *   - No entity legal names are persisted — the CaseSnapshot
 *     already uses opaque refs. FDL Art.29 tipping-off safe.
 *   - Writes are fire-and-forget with per-key serialisation, so
 *     concurrent decisions from the super-runner cannot race each
 *     other into overwriting a case's baseline.
 *   - Read + replay failures return an empty report; callers
 *     must NEVER block the live decision path on replay data.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO visibility + audit trail)
 *   FDL No.10/2025 Art.24    (10-year retention — replay is part
 *                             of the durable audit artifact)
 *   FDL No.10/2025 Art.29    (no tipping off — opaque refs only)
 *   Cabinet Res 134/2025 Art.19 (internal review over time)
 *   NIST AI RMF 1.0 MANAGE-2/4 (AI decision provenance + recourse)
 */

import type { BlobHandle } from './brainMemoryBlobStore';
import type { CaseSnapshot } from './crossCasePatternCorrelator';
import {
  captureRegulatoryBaseline,
  checkRegulatoryDrift,
  type DriftReport,
  type RegulatoryBaseline,
} from './regulatoryDriftWatchdog';
import { DPMS_CASH_THRESHOLD_AED, CROSS_BORDER_CASH_THRESHOLD_AED } from '../domain/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Verdict = 'pass' | 'flag' | 'escalate' | 'freeze';

/** The full tuple stored per case so it can be replayed later. */
export interface ReplayCase {
  /** Schema version — bump when the shape changes. */
  schemaVersion: 1;
  /** Tenant scope. */
  tenantId: string;
  /** Opaque case id. */
  caseId: string;
  /** Entity features at decision time — opaque refs only. */
  snapshot: CaseSnapshot;
  /** Frozen regulatory baseline at decision time. */
  baselineAtTime: RegulatoryBaseline;
  /** Verdict at decision time. */
  verdictAtTime: Verdict;
  /** Confidence in [0, 1] at decision time. */
  confidenceAtTime: number;
  /** Brain Power Score at decision time, null if not computed. */
  powerScoreAtTime: number | null;
  /** ISO 8601 timestamp the case was decided. */
  decidedAtIso: string;
}

/** A single threshold re-classification delta. */
export interface ThresholdImpact {
  /** Stable key — e.g. `DPMS_CASH_THRESHOLD_AED`. */
  key: string;
  /** Current threshold value. */
  currentThreshold: number;
  /** The feature value from the stored snapshot. */
  featureValue: number;
  /** True when the case tripped this threshold at decision time. */
  trippedAtDecision: boolean;
  /** True when the case would trip this threshold under current constants. */
  tripsToday: boolean;
  /** Plain-English description of the delta. */
  description: string;
  /** Regulatory citation. */
  regulatory: string;
}

/** The report produced by replayCase. */
export interface ReplayReport {
  /** True when the stored case was loaded successfully. */
  found: boolean;
  /** Echoes the input tenantId + caseId for correlation. */
  tenantId: string;
  caseId: string;
  /** The original stored tuple, null on miss. */
  stored: ReplayCase | null;
  /** Drift report produced by checkRegulatoryDrift against the stored baseline. */
  drift: DriftReport | null;
  /** Per-threshold re-classification findings. */
  thresholdImpacts: readonly ThresholdImpact[];
  /** Top-level conclusion for the audit response. */
  conclusion: 'not_found' | 'stable' | 'review_recommended' | 'verdict_may_change';
  /** Plain-English summary for the audit response. */
  summary: string;
}

// ---------------------------------------------------------------------------
// Key layout
// ---------------------------------------------------------------------------

function safeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
}

function replayKey(tenantId: string, caseId: string): string {
  return `replay/${safeSegment(tenantId)}/${safeSegment(caseId)}.json`;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface CaseReplayStoreOptions {
  /** Clock injection for tests. */
  now?: () => Date;
}

export class CaseReplayStore {
  private readonly blob: BlobHandle;
  private readonly now: () => Date;
  private readonly pendingWrites = new Set<Promise<unknown>>();
  /** Per-key chain to serialise concurrent record calls. */
  private readonly writeChains = new Map<string, Promise<unknown>>();

  constructor(blob: BlobHandle, opts: CaseReplayStoreOptions = {}) {
    this.blob = blob;
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * Record a replay case — fire-and-forget. The regulatory
   * baseline is captured at the CURRENT constants at call time,
   * so callers should invoke this as close as possible to the
   * decision timestamp.
   *
   * Failures are logged, never thrown. Callers that need to wait
   * for persistence use `flush()`.
   */
  record(input: {
    tenantId: string;
    caseId: string;
    snapshot: CaseSnapshot;
    verdictAtTime: Verdict;
    confidenceAtTime: number;
    powerScoreAtTime: number | null;
  }): void {
    if (!input.tenantId || typeof input.tenantId !== 'string') return;
    if (!input.caseId || typeof input.caseId !== 'string') return;

    const key = replayKey(input.tenantId, input.caseId);
    const baseline = captureRegulatoryBaseline(this.now());
    const decidedAtIso = this.now().toISOString();

    const replayCase: ReplayCase = {
      schemaVersion: 1,
      tenantId: input.tenantId,
      caseId: input.caseId,
      snapshot: input.snapshot,
      baselineAtTime: baseline,
      verdictAtTime: input.verdictAtTime,
      confidenceAtTime: clamp01(input.confidenceAtTime),
      powerScoreAtTime: typeof input.powerScoreAtTime === 'number' ? input.powerScoreAtTime : null,
      decidedAtIso,
    };

    const prior = this.writeChains.get(key) ?? Promise.resolve();
    const write = prior
      .catch(() => undefined)
      .then(() => this.blob.setJSON(key, replayCase))
      .catch((err) => {
        console.error(
          '[caseReplayStore] write failed:',
          err instanceof Error ? err.message : String(err)
        );
      });
    this.writeChains.set(key, write);
    this.pendingWrites.add(write);
    void write.finally(() => {
      this.pendingWrites.delete(write);
      if (this.writeChains.get(key) === write) this.writeChains.delete(key);
    });
  }

  /** Wait for every pending write. */
  async flush(): Promise<void> {
    await Promise.allSettled(Array.from(this.pendingWrites));
  }

  /** Read a stored replay case. Returns null on miss. */
  async loadReplayCase(tenantId: string, caseId: string): Promise<ReplayCase | null> {
    try {
      const raw = await this.blob.getJSON<ReplayCase | null>(replayKey(tenantId, caseId));
      if (!raw || typeof raw !== 'object') return null;
      if (raw.schemaVersion !== 1) return null;
      return raw;
    } catch (err) {
      console.warn(
        '[caseReplayStore] loadReplayCase failed:',
        err instanceof Error ? err.message : String(err)
      );
      return null;
    }
  }

  /**
   * Replay the case — load the stored tuple, run
   * checkRegulatoryDrift against the stored baseline, and
   * additionally re-classify every threshold-dependent feature
   * against today's constants.
   */
  async replayCase(tenantId: string, caseId: string): Promise<ReplayReport> {
    const stored = await this.loadReplayCase(tenantId, caseId);
    if (!stored) {
      return emptyReport(tenantId, caseId, 'not_found', 'No stored replay case.');
    }

    const drift = checkRegulatoryDrift(stored.baselineAtTime);
    const impacts = computeThresholdImpacts(stored);

    const anyVerdictChange = impacts.some((i) => i.trippedAtDecision !== i.tripsToday);
    const anyCriticalDrift = drift.topSeverity === 'critical' || drift.topSeverity === 'high';

    let conclusion: ReplayReport['conclusion'];
    let summary: string;

    if (anyVerdictChange) {
      conclusion = 'verdict_may_change';
      summary =
        `Case ${caseId} would decide differently today: ` +
        `${impacts.filter((i) => i.trippedAtDecision !== i.tripsToday).length} ` +
        `threshold(s) flipped. MLRO review required before relying on the ` +
        `stored verdict (${stored.verdictAtTime}).`;
    } else if (anyCriticalDrift) {
      conclusion = 'review_recommended';
      summary =
        `Case ${caseId} verdict currently stable but regulatory drift detected ` +
        `(${drift.findings.length} finding(s), top severity ${drift.topSeverity}). ` +
        `MLRO review recommended — no threshold flipped but constants changed ` +
        `since ${stored.decidedAtIso}.`;
    } else {
      conclusion = 'stable';
      summary =
        `Case ${caseId} is stable against current constants. Verdict ` +
        `${stored.verdictAtTime} (confidence ${stored.confidenceAtTime.toFixed(2)}) ` +
        `still holds — no drift, no threshold flips.`;
    }

    return {
      found: true,
      tenantId,
      caseId,
      stored,
      drift,
      thresholdImpacts: impacts,
      conclusion,
      summary,
    };
  }
}

// ---------------------------------------------------------------------------
// Threshold re-classification
//
// We re-check the two hard AED thresholds the DPMS brain cares about
// most — the DPMS cash CTR (AED 55K) and the cross-border declaration
// (AED 60K). The CaseSnapshot already stores `maxTxAED`; we use it as
// the feature value for both thresholds.
// ---------------------------------------------------------------------------

function computeThresholdImpacts(stored: ReplayCase): ThresholdImpact[] {
  const impacts: ThresholdImpact[] = [];
  const featureValue =
    typeof stored.snapshot.maxTxAED === 'number' && stored.snapshot.maxTxAED >= 0
      ? stored.snapshot.maxTxAED
      : null;
  if (featureValue === null) return impacts;

  // DPMS cash CTR — MoE Circular 08/AML/2021 + FDL Art.16.
  const dpmsAtTime =
    typeof stored.baselineAtTime.values.DPMS_CASH_THRESHOLD_AED === 'number'
      ? (stored.baselineAtTime.values.DPMS_CASH_THRESHOLD_AED as number)
      : DPMS_CASH_THRESHOLD_AED;
  impacts.push({
    key: 'DPMS_CASH_THRESHOLD_AED',
    currentThreshold: DPMS_CASH_THRESHOLD_AED,
    featureValue,
    trippedAtDecision: featureValue >= dpmsAtTime,
    tripsToday: featureValue >= DPMS_CASH_THRESHOLD_AED,
    description:
      `maxTxAED=${featureValue} vs DPMS threshold ` +
      `${dpmsAtTime} (at decision) / ${DPMS_CASH_THRESHOLD_AED} (today).`,
    regulatory: 'MoE Circular 08/AML/2021; FDL No.10/2025 Art.16',
  });

  // Cross-border cash / BNI — FDL Art.17.
  const borderAtTime =
    typeof stored.baselineAtTime.values.CROSS_BORDER_CASH_THRESHOLD_AED === 'number'
      ? (stored.baselineAtTime.values.CROSS_BORDER_CASH_THRESHOLD_AED as number)
      : CROSS_BORDER_CASH_THRESHOLD_AED;
  impacts.push({
    key: 'CROSS_BORDER_CASH_THRESHOLD_AED',
    currentThreshold: CROSS_BORDER_CASH_THRESHOLD_AED,
    featureValue,
    trippedAtDecision: featureValue >= borderAtTime,
    tripsToday: featureValue >= CROSS_BORDER_CASH_THRESHOLD_AED,
    description:
      `maxTxAED=${featureValue} vs cross-border threshold ` +
      `${borderAtTime} (at decision) / ${CROSS_BORDER_CASH_THRESHOLD_AED} (today).`,
    regulatory: 'FDL No.10/2025 Art.17',
  });

  return impacts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function emptyReport(
  tenantId: string,
  caseId: string,
  conclusion: ReplayReport['conclusion'],
  summary: string
): ReplayReport {
  return {
    found: false,
    tenantId,
    caseId,
    stored: null,
    drift: null,
    thresholdImpacts: [],
    conclusion,
    summary,
  };
}

// Exports for tests.
export const __test__ = { safeSegment, replayKey, computeThresholdImpacts, clamp01 };
