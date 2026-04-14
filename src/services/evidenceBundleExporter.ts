/**
 * Evidence Bundle Exporter — single-call audit artifact assembler.
 *
 * Why this exists:
 *   When a regulator (MoE, LBMA, EOCN) opens an inspection on a
 *   specific historical case, the MLRO has to produce proof of:
 *     1. What the brain decided (verdict + confidence + power score)
 *     2. Which regulatory baseline was in force at decision time
 *     3. Whether the decision has drifted under today's constants
 *     4. A time-series footprint of when the decision happened
 *     5. An integrity guarantee that none of the above was edited
 *        after the fact
 *
 *   Today those artifacts live in five different places:
 *     - CaseReplayStore        (snapshot + baseline + verdict)
 *     - BrainTelemetryStore    (compact time-series entry)
 *     - regulatoryDriftWatchdog (drift against stored baseline)
 *     - brainMemoryBlobStore   (full CaseSnapshot)
 *     - constants.ts           (current values)
 *
 *   The MLRO hand-stitches them into an email. That process is slow,
 *   error-prone, and — worst — produces an email the regulator has
 *   no way to verify wasn't modified after export.
 *
 * This module solves it by composing the existing stores into a
 * single deterministic EvidenceBundle with an integrity hash
 * covering every field. Pure function at the bundle-building layer;
 * the I/O (blob reads) is pushed to a thin wrapper that takes
 * injected loaders so this file stays testable without Netlify.
 *
 * Integrity hash scheme:
 *   1. Serialise every field EXCEPT `integrity.hashHex` with
 *      canonical JSON (sorted keys, no pretty printing).
 *   2. Prefix with "evidence-bundle-v1|" (domain separator).
 *   3. SHA3-512 (same primitive the zk-compliance attestation uses,
 *      so the operator doesn't need a second hash library).
 *   4. Store the hex digest under `integrity.hashHex`.
 *
 *   Auditors re-compute the same way and compare. Any field
 *   mutation flips the hash.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-24  (CO audit trail + 10-year retention +
 *                               reconstructibility)
 *   FDL No.10/2025 Art.29      (no tipping off — bundle carries only
 *                               opaque entity refs)
 *   Cabinet Res 134/2025 Art.19 (internal review — bundle is the
 *                                 review artifact)
 *   NIST AI RMF 1.0 MANAGE-2/4  (AI decision provenance + recourse)
 *   FATF Rec 11                 (record keeping — 5 year minimum,
 *                                 UAE raises to 10)
 */

import { sha3_512Hex } from './quantumResistantSeal';
import {
  checkRegulatoryDrift,
  type DriftReport,
  type RegulatoryBaseline,
} from './regulatoryDriftWatchdog';
import type { ReplayCase } from './caseReplayStore';
import type { BrainTelemetryEntry } from './brainTelemetryStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Loader interface — callers inject one implementation for live
 * Netlify Blob traffic, and tests inject an in-memory fake.
 */
export interface EvidenceBundleLoaders {
  loadReplayCase: (tenantId: string, caseId: string) => Promise<ReplayCase | null>;
  /**
   * Load the telemetry entries for the UTC day the case was
   * decided. The exporter scans them for the entry whose
   * `entityRef` + `tsIso` match the stored ReplayCase.
   */
  loadTelemetryForDay: (tenantId: string, dayIso: string) => Promise<BrainTelemetryEntry[]>;
}

export interface EvidenceBundle {
  schemaVersion: 1;
  tenantId: string;
  caseId: string;
  exportedAtIso: string;
  /** The stored replay tuple — null when not found. */
  replay: ReplayCase | null;
  /** Matched telemetry entry, null when not found. */
  telemetry: BrainTelemetryEntry | null;
  /**
   * Drift report produced by running checkRegulatoryDrift() against
   * the stored baseline. Null when the replay tuple is missing.
   */
  drift: DriftReport | null;
  /** Regulatory citations the bundle claims coverage under. */
  citations: readonly string[];
  /**
   * Plain-English conclusion — the same four-bucket vocabulary the
   * replay endpoint uses, plus "incomplete" when we could not
   * assemble enough artifacts to make a statement.
   */
  conclusion: 'stable' | 'review_recommended' | 'verdict_may_change' | 'not_found' | 'incomplete';
  /** Plain-English summary for the audit letter. */
  summary: string;
  /**
   * SHA3-512 integrity hash over the canonical JSON of every other
   * field. Auditors verify by re-hashing with this field zeroed.
   */
  integrity: {
    algorithm: 'sha3-512';
    hashHex: string;
    preimagePrefix: 'evidence-bundle-v1';
  };
}

// ---------------------------------------------------------------------------
// Canonical JSON
//
// We roll our own sorted-key serialiser instead of pulling in
// `canonicaljson` to keep the dependency surface flat. This matches
// the approach used by the zk-compliance attestation path.
// ---------------------------------------------------------------------------

function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') {
    // Disallow NaN + Infinity so the preimage is stable across
    // JSON engines.
    if (!Number.isFinite(value)) return 'null';
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalStringify(v)).join(',') + ']';
  }
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    return (
      '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(rec[k])).join(',') + '}'
    );
  }
  return 'null';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Day-of-iso extractor. Accepts full ISO or already-truncated YYYY-MM-DD. */
function dayOf(iso: string): string {
  if (typeof iso !== 'string') return '';
  return iso.slice(0, 10);
}

/** Match a telemetry entry by exact tsIso + entityRef if both present. */
function pickTelemetry(
  entries: readonly BrainTelemetryEntry[],
  replay: ReplayCase
): BrainTelemetryEntry | null {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  // Exact (tsIso, entityRef) match is ideal.
  const entityRef = replay.snapshot.entityRef;
  const exact = entries.find((e) => e.tsIso === replay.decidedAtIso && e.entityRef === entityRef);
  if (exact) return exact;
  // Fallback: same entityRef + closest tsIso in the same day.
  const sameEntity = entries.filter((e) => e.entityRef === entityRef);
  if (sameEntity.length === 0) return null;
  const target = Date.parse(replay.decidedAtIso);
  sameEntity.sort(
    (a, b) => Math.abs(Date.parse(a.tsIso) - target) - Math.abs(Date.parse(b.tsIso) - target)
  );
  return sameEntity[0] ?? null;
}

function conclusionFromDriftAndReplay(
  replay: ReplayCase,
  drift: DriftReport
): EvidenceBundle['conclusion'] {
  // Reuse the same logic as CaseReplayStore.replayCase but without
  // re-computing threshold impacts — replay already captured them.
  // A clean drift report with no critical findings is "stable".
  if (drift.clean) return 'stable';
  if (drift.topSeverity === 'critical' || drift.topSeverity === 'high') {
    return 'review_recommended';
  }
  // Low / medium drift but not clean → still stable-ish but surface
  // the drift by marking review_recommended conservatively.
  return 'review_recommended';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assemble an evidence bundle for a single case.
 * Pure with respect to injected loaders — no process globals touched.
 */
export async function exportEvidenceBundle(
  tenantId: string,
  caseId: string,
  loaders: EvidenceBundleLoaders,
  now: () => Date = () => new Date()
): Promise<EvidenceBundle> {
  const exportedAtIso = now().toISOString();

  let replay: ReplayCase | null = null;
  try {
    replay = await loaders.loadReplayCase(tenantId, caseId);
  } catch (err) {
    console.warn(
      '[evidenceBundleExporter] replay load failed:',
      err instanceof Error ? err.message : String(err)
    );
  }

  let telemetry: BrainTelemetryEntry | null = null;
  let drift: DriftReport | null = null;
  let conclusion: EvidenceBundle['conclusion'];
  let summary: string;

  if (!replay) {
    conclusion = 'not_found';
    summary = `No replay tuple found for tenant ${tenantId} case ${caseId}. Case was never recorded, or was evicted.`;
  } else {
    // Telemetry lookup — scoped to the UTC day of the decision.
    try {
      const day = dayOf(replay.decidedAtIso);
      const entries = await loaders.loadTelemetryForDay(tenantId, day);
      telemetry = pickTelemetry(entries, replay);
    } catch (err) {
      console.warn(
        '[evidenceBundleExporter] telemetry load failed:',
        err instanceof Error ? err.message : String(err)
      );
    }

    // Drift against the stored baseline (not boot baseline).
    drift = checkRegulatoryDrift(replay.baselineAtTime);

    if (!telemetry) {
      conclusion = 'incomplete';
      summary =
        `Replay tuple found but no matching telemetry entry for ` +
        `${replay.decidedAtIso}. Audit bundle incomplete — MLRO must ` +
        `reconcile manually before responding to the inspector.`;
    } else {
      conclusion = conclusionFromDriftAndReplay(replay, drift);
      const baseAtIso = (replay.baselineAtTime as RegulatoryBaseline).capturedAtIso;
      summary =
        conclusion === 'stable'
          ? `Case ${caseId} is stable against current constants. Verdict ` +
            `${replay.verdictAtTime} (confidence ${replay.confidenceAtTime.toFixed(2)}) ` +
            `still holds — no drift since baseline captured at ${baseAtIso}.`
          : `Case ${caseId} has regulatory drift: ${drift.findings.length} ` +
            `finding(s), top severity ${drift.topSeverity}. Stored verdict ` +
            `${replay.verdictAtTime} should be MLRO-reviewed before relying ` +
            `on it in the current audit cycle.`;
    }
  }

  const citations: readonly string[] = [
    'FDL No.10/2025 Art.20-22',
    'FDL No.10/2025 Art.24',
    'FDL No.10/2025 Art.29',
    'Cabinet Res 134/2025 Art.19',
    'NIST AI RMF 1.0 MANAGE-2',
    'NIST AI RMF 1.0 MANAGE-4',
    'FATF Rec 11',
  ];

  const unsealed: Omit<EvidenceBundle, 'integrity'> = {
    schemaVersion: 1,
    tenantId,
    caseId,
    exportedAtIso,
    replay,
    telemetry,
    drift,
    citations,
    conclusion,
    summary,
  };

  const preimage = 'evidence-bundle-v1|' + canonicalStringify(unsealed);
  const hashHex = sha3_512Hex(preimage);

  return {
    ...unsealed,
    integrity: {
      algorithm: 'sha3-512',
      hashHex,
      preimagePrefix: 'evidence-bundle-v1',
    },
  };
}

/**
 * Re-verify an evidence bundle's integrity hash. Returns true when
 * the stored hash matches a re-hash of the unsealed fields. Used by
 * the audit verifier tool and by the endpoint's round-trip check.
 */
export function verifyEvidenceBundleIntegrity(bundle: EvidenceBundle): boolean {
  if (!bundle || typeof bundle !== 'object') return false;
  if (bundle.integrity?.algorithm !== 'sha3-512') return false;
  if (bundle.integrity.preimagePrefix !== 'evidence-bundle-v1') return false;
  const {
    integrity: _integrity,
    ...unsealed
  }: { integrity: unknown } & Omit<EvidenceBundle, 'integrity'> = bundle;
  void _integrity;
  const preimage = 'evidence-bundle-v1|' + canonicalStringify(unsealed);
  const expected = sha3_512Hex(preimage);
  return expected === bundle.integrity.hashHex;
}

// Exports for tests.
export const __test__ = { canonicalStringify, pickTelemetry, dayOf };
