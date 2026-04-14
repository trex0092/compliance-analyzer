/**
 * Brain Memory Store — persistent case registry that turns every
 * single-case decision into a cross-case-aware decision.
 *
 * Every time runSuperDecision finishes, it writes a CaseSnapshot into
 * this store. Subsequent decisions read the store and run the cross-
 * case correlator automatically, surfacing rings / clusters / reuse
 * the single-case brain cannot see.
 *
 * Storage strategy:
 *   - In-memory Map<tenantId, CaseSnapshot[]> by default.
 *   - Opt-in Netlify Blob backend when running inside a function:
 *     call `attachBlobBackend(store, scope)` to wire persistence.
 *   - Test reset helper for determinism.
 *   - Per-tenant bounded to MAX_SNAPSHOTS_PER_TENANT (default 1000)
 *     with FIFO eviction so memory stays bounded under load. Eviction
 *     is LOGGED to console.warn so MLROs can see when cold archive
 *     is needed — FDL Art.24 mandates 10-year retention, which the
 *     in-memory store cannot provide on its own.
 *
 * Safety invariants:
 *   - Tenant isolation: snapshots NEVER cross tenants.
 *   - No entity legal names: the store only holds opaque refs,
 *     wallet addresses, and hashes. It is FDL Art.29 safe by
 *     construction.
 *   - Writes are synchronous; reads are O(n) over the tenant bag.
 *   - The store is NOT a replacement for persistent audit storage —
 *     it is a hot index for cross-case pattern detection.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO duty — cross-case reasoning)
 *   FDL No.10/2025 Art.24    (audit trail — eviction warning)
 *   FDL No.10/2025 Art.29    (no tipping off — opaque refs only)
 *   Cabinet Res 134/2025 Art.19 (internal review — correlation visibility)
 *   FATF Rec 20-23           (risk-based + DPMS + monitoring)
 */

import {
  correlateCrossCases,
  type CaseSnapshot,
  type CorrelationReport,
} from './crossCasePatternCorrelator';
import type { ComplianceDecision } from './complianceDecisionEngine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryStoreConfig {
  /** Upper bound per tenant before FIFO eviction. Default 1000. */
  maxSnapshotsPerTenant?: number;
}

export interface MemoryStore {
  record(snapshot: CaseSnapshot): void;
  recentForTenant(tenantId: string, limit?: number): readonly CaseSnapshot[];
  sizeForTenant(tenantId: string): number;
  totalSize(): number;
  clear(): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const DEFAULT_MAX_PER_TENANT = 1000;

export class InMemoryBrainMemoryStore implements MemoryStore {
  private readonly buckets = new Map<string, CaseSnapshot[]>();
  private readonly maxPerTenant: number;

  constructor(cfg: MemoryStoreConfig = {}) {
    this.maxPerTenant = cfg.maxSnapshotsPerTenant ?? DEFAULT_MAX_PER_TENANT;
  }

  record(snapshot: CaseSnapshot): void {
    const tenantId = snapshot.tenantId;
    if (!tenantId || typeof tenantId !== 'string') return;
    let bucket = this.buckets.get(tenantId);
    if (!bucket) {
      bucket = [];
      this.buckets.set(tenantId, bucket);
    }
    bucket.push(snapshot);
    if (bucket.length > this.maxPerTenant) {
      const evicted = bucket.splice(0, bucket.length - this.maxPerTenant);
      console.warn(
        `[brainMemoryStore] Evicted ${evicted.length} snapshot(s) for tenant ${tenantId}. ` +
          `FDL Art.24 requires 10-year retention — move cold archive to durable storage.`
      );
    }
  }

  recentForTenant(tenantId: string, limit?: number): readonly CaseSnapshot[] {
    const bucket = this.buckets.get(tenantId);
    if (!bucket || bucket.length === 0) return [];
    if (typeof limit === 'number' && limit > 0 && limit < bucket.length) {
      return bucket.slice(-limit);
    }
    return bucket.slice();
  }

  sizeForTenant(tenantId: string): number {
    return this.buckets.get(tenantId)?.length ?? 0;
  }

  totalSize(): number {
    let total = 0;
    for (const bucket of this.buckets.values()) total += bucket.length;
    return total;
  }

  clear(): void {
    this.buckets.clear();
  }
}

/**
 * Default shared instance — tests can create their own with
 * `new InMemoryBrainMemoryStore()` to avoid cross-test pollution.
 */
export const brainMemory: MemoryStore = new InMemoryBrainMemoryStore();

// ---------------------------------------------------------------------------
// Snapshot derivation — build a CaseSnapshot from a ComplianceDecision.
// ---------------------------------------------------------------------------

/**
 * Build a safe, opaque-ref CaseSnapshot from a finalized compliance
 * decision plus any optional context fields the caller wants to
 * include for future correlation (wallets, UBOs, address hash).
 *
 * This function NEVER copies entity legal names — only hashed refs.
 */
export function snapshotFromDecision(
  decision: ComplianceDecision,
  extras: {
    entityRef?: string;
    uboRefs?: readonly string[];
    wallets?: readonly string[];
    addressHash?: string;
    corridorCountry?: string;
    maxTxAED?: number;
    narrativeHash?: string;
    sanctionsMatchKeys?: readonly string[];
  } = {}
): CaseSnapshot {
  return {
    caseId: decision.id,
    tenantId: decision.tenantId,
    openedAt: decision.at,
    entityRef: extras.entityRef ?? decision.warRoomEvent.entityId ?? decision.id,
    ...(extras.uboRefs ? { uboRefs: extras.uboRefs } : {}),
    ...(extras.wallets ? { wallets: extras.wallets } : {}),
    ...(extras.addressHash ? { addressHash: extras.addressHash } : {}),
    ...(extras.corridorCountry ? { corridorCountry: extras.corridorCountry } : {}),
    ...(extras.maxTxAED !== undefined ? { maxTxAED: extras.maxTxAED } : {}),
    ...(extras.narrativeHash ? { narrativeHash: extras.narrativeHash } : {}),
    ...(extras.sanctionsMatchKeys
      ? { sanctionsMatchKeys: extras.sanctionsMatchKeys }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Cross-case correlation using the memory store.
// ---------------------------------------------------------------------------

/**
 * Pull the tenant's recent history from the store and run the
 * correlator. Returns a report with all detected patterns.
 *
 * This is the single function the super-runner calls after every
 * decision to give the current case cross-case visibility.
 */
export function correlateWithMemory(
  tenantId: string,
  store: MemoryStore = brainMemory,
  limit: number = 500
): CorrelationReport {
  const recent = store.recentForTenant(tenantId, limit);
  return correlateCrossCases(recent, { tenantId });
}

/**
 * Record a decision into the memory store AND return the correlation
 * report computed against history that now includes this decision.
 *
 * Order matters: we record first, then correlate, so the new case is
 * visible to its own correlation check. This catches the pathological
 * case where a new case forms a ring with prior cases that was
 * previously invisible because one of the ring members was missing.
 */
export function recordAndCorrelate(
  decision: ComplianceDecision,
  extras: Parameters<typeof snapshotFromDecision>[1] = {},
  store: MemoryStore = brainMemory
): {
  snapshot: CaseSnapshot;
  correlation: CorrelationReport;
} {
  const snapshot = snapshotFromDecision(decision, extras);
  store.record(snapshot);
  const correlation = correlateWithMemory(decision.tenantId, store);
  return { snapshot, correlation };
}

// Exports for tests.
export const __test__ = { DEFAULT_MAX_PER_TENANT };
