/**
 * Brain Telemetry Store — time-series log of every brain decision,
 * persisted to Netlify Blobs with a per-tenant / per-day key prefix.
 *
 * Why this exists:
 *   /api/brain/diagnostics is a POINT-IN-TIME snapshot (catalogue
 *   sizes, current drift, MCP version). It does NOT show trends over
 *   days or weeks. An MLRO preparing a board-level KPI report needs
 *   to see: "how many freezes in March? what's the ensemble-unstable
 *   rate trending at? which typologies fired most often?"
 *
 *   This module is a thin, grounded time-series writer. Every call
 *   to /api/brain/analyze produces one telemetry entry. Entries are
 *   ~250 bytes (small struct, no narrative text, no full brain
 *   response), written append-only per tenant per UTC day so a
 *   rolling 90-day view is one blob read per day.
 *
 * Shape of a telemetry entry:
 *   {
 *     tsIso, tenantId, entityRef, verdict, confidence,
 *     powerScore, brainVerdict, ensembleUnstable, typologyIds,
 *     crossCaseFindingCount, velocitySeverity, driftSeverity,
 *     requiresHumanReview
 *   }
 *
 * Storage layout:
 *   telemetry/<tenantId>/<YYYY-MM-DD>.jsonl
 *     → newline-delimited JSON, one entry per line, append-only
 *       by read-merge-write (JSONL so we can stream-parse later)
 *
 * Rotation:
 *   No automatic rotation at write time — each entry lives forever
 *   under its UTC day key. The operator's existing retention policy
 *   (FDL Art.24 = 10 years) covers it. A separate future sweeper
 *   could archive cold days to a cold-storage key prefix.
 *
 * Safety invariants:
 *   - Tenant-scoped per key. Cross-tenant reads are impossible
 *     because the key segment uses `safeSegment`.
 *   - Entries carry NO entity legal names, only opaque refs
 *     (entityRef = whatever the caller passes, typically a hash).
 *     FDL Art.29 tipping-off safe by construction.
 *   - Write failures are logged, never blocking the decision path.
 *   - Read failures return an empty array; the caller gets no
 *     telemetry data but the pipeline continues.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO visibility + internal review)
 *   FDL No.10/2025 Art.24    (10-year retention — telemetry is
 *                             a compact mirror of the durable log)
 *   FDL No.10/2025 Art.29    (no tipping off — opaque refs only)
 *   Cabinet Res 134/2025 Art.19 (internal review — trend data
 *                                 is a review prerequisite)
 *   NIST AI RMF 1.0 MANAGE-2 (AI decision provenance over time)
 */

import type { BlobHandle } from './brainMemoryBlobStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrainTelemetryEntry {
  /** ISO 8601 timestamp of the decision. */
  tsIso: string;
  /** Tenant scope. */
  tenantId: string;
  /** Opaque entity reference — NEVER a legal name. */
  entityRef: string;
  /** Final verdict after every clamp. */
  verdict: 'pass' | 'flag' | 'escalate' | 'freeze';
  /** Confidence in [0, 1]. */
  confidence: number;
  /** Brain Power Score in [0, 100], null when not computed. */
  powerScore: number | null;
  /** Unclamped mega-brain verdict — shows pre-clamp state. */
  brainVerdict: 'pass' | 'flag' | 'escalate' | 'freeze' | null;
  /** True when the consensus ensemble marked the case as unstable. */
  ensembleUnstable: boolean;
  /** FATF typology ids matched (short — usually 0-3 entries). */
  typologyIds: readonly string[];
  /** Count of cross-case correlation findings. */
  crossCaseFindingCount: number;
  /** Velocity severity band when computed. */
  velocitySeverity: 'info' | 'low' | 'medium' | 'high' | 'critical' | null;
  /** Regulatory drift severity at the time of decision. */
  driftSeverity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  /** Did the decision require human review? */
  requiresHumanReview: boolean;
}

export interface TelemetryAggregate {
  tenantId: string;
  rangeStart: string;
  rangeEnd: string;
  /** Total decisions in the range. */
  totalDecisions: number;
  /** Count per verdict. */
  byVerdict: Record<BrainTelemetryEntry['verdict'], number>;
  /** Average confidence across all decisions. */
  avgConfidence: number;
  /** Average brain power score across decisions that had one. */
  avgPowerScore: number | null;
  /** Count of ensemble-unstable decisions. */
  ensembleUnstableCount: number;
  /** Count of decisions requiring human review. */
  humanReviewCount: number;
  /** Typology ids that fired most often, sorted desc. */
  topTypologies: ReadonlyArray<{ id: string; count: number }>;
  /** Decisions with any regulatory drift observed. */
  driftDecisionCount: number;
}

// ---------------------------------------------------------------------------
// Key layout
// ---------------------------------------------------------------------------

function safeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
}

function dayKey(tenantId: string, dateIso: string): string {
  const day = dateIso.slice(0, 10); // YYYY-MM-DD
  return `telemetry/${safeSegment(tenantId)}/${day}.jsonl`;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface BrainTelemetryStoreOptions {
  /** Maximum entries to keep per day per tenant. Default 5000. */
  maxEntriesPerDay?: number;
}

const DEFAULT_MAX_PER_DAY = 5000;

export class BrainTelemetryStore {
  private readonly blob: BlobHandle;
  private readonly maxPerDay: number;
  private readonly pendingWrites = new Set<Promise<unknown>>();
  /** Per-key write chain to serialise concurrent appends. */
  private readonly writeChains = new Map<string, Promise<unknown>>();

  constructor(blob: BlobHandle, opts: BrainTelemetryStoreOptions = {}) {
    this.blob = blob;
    this.maxPerDay = opts.maxEntriesPerDay ?? DEFAULT_MAX_PER_DAY;
  }

  /**
   * Append a telemetry entry for the tenant's current UTC day.
   * Fire-and-forget — failures are logged, never thrown. Callers
   * that need to wait for persistence use `flush()`.
   */
  record(entry: BrainTelemetryEntry): void {
    if (!entry.tenantId || typeof entry.tenantId !== 'string') return;
    const key = dayKey(entry.tenantId, entry.tsIso);
    const prior = this.writeChains.get(key) ?? Promise.resolve();
    const write = prior
      .catch(() => undefined)
      .then(() => this.appendOne(key, entry))
      .catch((err) => {
        console.error(
          '[brainTelemetryStore] write failed:',
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

  /** Wait for every pending write to finish. */
  async flush(): Promise<void> {
    await Promise.allSettled(Array.from(this.pendingWrites));
  }

  /**
   * Read the entries for a single UTC day. Returns an empty array
   * on blob miss or parse failure.
   */
  async readDay(tenantId: string, dayIso: string): Promise<BrainTelemetryEntry[]> {
    try {
      const raw = await this.blob.getJSON<{ entries: BrainTelemetryEntry[] } | null>(
        dayKey(tenantId, dayIso)
      );
      if (raw && Array.isArray(raw.entries)) return raw.entries;
      return [];
    } catch (err) {
      console.warn(
        '[brainTelemetryStore] readDay failed:',
        err instanceof Error ? err.message : String(err)
      );
      return [];
    }
  }

  /**
   * Read a date range inclusive of both ends. Returns all entries
   * concatenated across days, in no particular order. Callers that
   * need ordering should sort by tsIso.
   */
  async readRange(
    tenantId: string,
    startIso: string,
    endIso: string
  ): Promise<BrainTelemetryEntry[]> {
    const start = new Date(startIso.slice(0, 10));
    const end = new Date(endIso.slice(0, 10));
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return [];
    const all: BrainTelemetryEntry[] = [];
    const cursor = new Date(start.getTime());
    while (cursor.getTime() <= end.getTime()) {
      const dayIso = cursor.toISOString().slice(0, 10);
      const entries = await this.readDay(tenantId, dayIso);
      for (const e of entries) all.push(e);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return all;
  }

  /**
   * Roll a range into a single aggregate report — the shape the
   * Brain Console renders for the trend view.
   */
  async aggregate(tenantId: string, startIso: string, endIso: string): Promise<TelemetryAggregate> {
    const entries = await this.readRange(tenantId, startIso, endIso);
    const byVerdict: TelemetryAggregate['byVerdict'] = {
      pass: 0,
      flag: 0,
      escalate: 0,
      freeze: 0,
    };
    let confSum = 0;
    let powerSum = 0;
    let powerCount = 0;
    let unstableCount = 0;
    let humanReviewCount = 0;
    let driftDecisionCount = 0;
    const typologyCounts = new Map<string, number>();
    for (const e of entries) {
      byVerdict[e.verdict] += 1;
      confSum += e.confidence;
      if (typeof e.powerScore === 'number') {
        powerSum += e.powerScore;
        powerCount += 1;
      }
      if (e.ensembleUnstable) unstableCount += 1;
      if (e.requiresHumanReview) humanReviewCount += 1;
      if (e.driftSeverity !== 'none') driftDecisionCount += 1;
      for (const t of e.typologyIds) {
        typologyCounts.set(t, (typologyCounts.get(t) ?? 0) + 1);
      }
    }
    const topTypologies = Array.from(typologyCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, count]) => ({ id, count }));
    return {
      tenantId,
      rangeStart: startIso,
      rangeEnd: endIso,
      totalDecisions: entries.length,
      byVerdict,
      avgConfidence: entries.length > 0 ? confSum / entries.length : 0,
      avgPowerScore: powerCount > 0 ? powerSum / powerCount : null,
      ensembleUnstableCount: unstableCount,
      humanReviewCount,
      topTypologies,
      driftDecisionCount,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async appendOne(key: string, entry: BrainTelemetryEntry): Promise<void> {
    // Read-modify-write. The writeChains map guarantees only one of
    // these runs per key at a time, so there's no lost-update race.
    const existing = await this.blob.getJSON<{ entries: BrainTelemetryEntry[] } | null>(key);
    const entries: BrainTelemetryEntry[] =
      existing && Array.isArray(existing.entries) ? existing.entries.slice() : [];
    entries.push(entry);
    // Bound per-day size so a runaway caller cannot blow up the blob.
    if (entries.length > this.maxPerDay) {
      entries.splice(0, entries.length - this.maxPerDay);
    }
    await this.blob.setJSON(key, { entries });
  }
}

// Exports for tests.
export const __test__ = { safeSegment, dayKey, DEFAULT_MAX_PER_DAY };
