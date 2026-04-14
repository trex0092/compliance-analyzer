/**
 * Brain Memory Store — Netlify Blob backend.
 *
 * Production-grade persistence for the cross-case memory. The
 * in-memory store (InMemoryBrainMemoryStore) loses all state on
 * Netlify function cold starts, which means every first-request-
 * after-sleep produces an empty cross-case report — a regression
 * the MLRO would notice within minutes in a live deployment.
 *
 * This module provides a Blob-backed implementation of the
 * MemoryStore contract so cross-case detection survives function
 * cold starts, cross-instance warm pools, and tenant handoffs.
 *
 * Storage layout inside the Netlify Blob store (default name
 * `brain-memory`):
 *
 *   snapshots/<tenantId>/<caseId>.json
 *       → full CaseSnapshot serialised with no extra fields
 *
 *   index/<tenantId>.json
 *       → ordered list of caseIds for quick iteration without
 *         the cost of a blob list() call
 *
 * Eviction:
 *   Same per-tenant bound as the in-memory store (default 1000).
 *   When the index exceeds the bound, oldest case blobs are
 *   deleted and a console.warn is emitted citing FDL Art.24 so
 *   MLROs know to migrate cold archive to durable storage.
 *
 * Cross-tenant isolation:
 *   Every read + write is scoped to a single tenantId path
 *   segment. Callers cannot read or write across tenants without
 *   explicitly passing a different tenantId, which is a visible
 *   caller-side change the review process catches.
 *
 * Durability vs consistency:
 *   Netlify Blobs are strongly consistent per-key, so the read-
 *   your-write pattern used by recordAndCorrelate produces
 *   deterministic cross-case results as long as callers serialise
 *   their writes (which the super-runner already does).
 *
 * Test strategy:
 *   The Netlify Blobs module is hard to run in unit tests without
 *   a real project context. This file therefore exposes an
 *   abstract BlobHandle interface so tests can inject an in-
 *   memory fake. The default constructor binds to the real
 *   @netlify/blobs getStore API.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO duty — memory is an audit artifact)
 *   FDL No.10/2025 Art.24    (10-year retention — Blob durability)
 *   FDL No.10/2025 Art.29    (no tipping off — only opaque refs persisted)
 *   Cabinet Res 134/2025 Art.19 (internal review visibility)
 */

import type {
  CaseSnapshot,
} from './crossCasePatternCorrelator';
import type { MemoryStore } from './brainMemoryStore';

// ---------------------------------------------------------------------------
// Minimal Blob handle interface — mirror of the Netlify Blobs store
// we actually use. Keeping this narrow lets tests inject a fake.
// ---------------------------------------------------------------------------

export interface BlobHandle {
  getJSON<T = unknown>(key: string): Promise<T | null>;
  setJSON(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface BlobBrainMemoryStoreOptions {
  /** Upper bound per tenant before FIFO eviction. Default 1000. */
  maxSnapshotsPerTenant?: number;
  /** In-memory write cache for synchronous reads. Default true. */
  enableWriteCache?: boolean;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const DEFAULT_MAX_PER_TENANT = 1000;

interface TenantIndex {
  caseIds: string[];
  updatedAtIso: string;
}

/**
 * Async blob-backed store.
 *
 * The synchronous MemoryStore interface (`record`, `recentForTenant`,
 * `sizeForTenant`, `totalSize`, `clear`) is preserved by keeping an
 * in-process write cache that mirrors the last N writes per tenant.
 * Reads always prefer the cache; misses fall through to a pending
 * async hydrate that populates the cache for next time.
 *
 * In practice:
 *   - The super-runner writes a snapshot → cache updated
 *     synchronously → async blob write fires in the background
 *   - The correlator reads recentForTenant(tenantId) → returns the
 *     cache (which is guaranteed to include the just-written case)
 *   - On a cold start, the cache is empty but hydrate() can be
 *     awaited by any caller that needs the historical tail
 */
export class BlobBrainMemoryStore implements MemoryStore {
  private readonly blob: BlobHandle;
  private readonly maxPerTenant: number;
  private readonly writeCache = new Map<string, CaseSnapshot[]>();
  private readonly pendingWrites = new Set<Promise<unknown>>();
  /**
   * Per-tenant write chain. Ensures the read-modify-write on the
   * index blob is serialised so concurrent records() do not race
   * each other into overwriting the index with only one case.
   */
  private readonly tenantWriteChains = new Map<string, Promise<unknown>>();

  constructor(blob: BlobHandle, opts: BlobBrainMemoryStoreOptions = {}) {
    this.blob = blob;
    this.maxPerTenant = opts.maxSnapshotsPerTenant ?? DEFAULT_MAX_PER_TENANT;
  }

  // -------------------------------------------------------------------------
  // Synchronous MemoryStore contract
  // -------------------------------------------------------------------------

  record(snapshot: CaseSnapshot): void {
    const tenantId = snapshot.tenantId;
    if (!tenantId || typeof tenantId !== 'string') return;

    // 1. Mutate the in-memory cache synchronously so subsequent
    //    recentForTenant calls see the new snapshot immediately.
    let bucket = this.writeCache.get(tenantId);
    if (!bucket) {
      bucket = [];
      this.writeCache.set(tenantId, bucket);
    }
    bucket.push(snapshot);

    let evictedCaseIds: string[] = [];
    if (bucket.length > this.maxPerTenant) {
      const evicted = bucket.splice(0, bucket.length - this.maxPerTenant);
      evictedCaseIds = evicted.map((s) => s.caseId);
      console.warn(
        `[BlobBrainMemoryStore] Evicted ${evicted.length} snapshot(s) for tenant ${tenantId}. ` +
          `FDL Art.24 requires 10-year retention — move cold archive to durable storage.`
      );
    }

    // 2. Fire-and-forget blob write, chained per tenant so the
    //    read-modify-write on the index blob is serialised. Errors
    //    are swallowed with a console.error — they cannot block
    //    the decision path.
    const prior = this.tenantWriteChains.get(tenantId) ?? Promise.resolve();
    const write = prior
      .catch(() => undefined)
      .then(() => this.persistAsync(snapshot, evictedCaseIds))
      .catch((err) => {
        console.error(
          '[BlobBrainMemoryStore] persist failed:',
          err instanceof Error ? err.message : String(err)
        );
      });
    this.tenantWriteChains.set(tenantId, write);
    this.pendingWrites.add(write);
    void write.finally(() => {
      this.pendingWrites.delete(write);
      // Clear the chain slot if no further writes have queued on top.
      if (this.tenantWriteChains.get(tenantId) === write) {
        this.tenantWriteChains.delete(tenantId);
      }
    });
  }

  recentForTenant(tenantId: string, limit?: number): readonly CaseSnapshot[] {
    const bucket = this.writeCache.get(tenantId);
    if (!bucket || bucket.length === 0) return [];
    if (typeof limit === 'number' && limit > 0 && limit < bucket.length) {
      return bucket.slice(-limit);
    }
    return bucket.slice();
  }

  sizeForTenant(tenantId: string): number {
    return this.writeCache.get(tenantId)?.length ?? 0;
  }

  totalSize(): number {
    let total = 0;
    for (const bucket of this.writeCache.values()) total += bucket.length;
    return total;
  }

  clear(): void {
    this.writeCache.clear();
    // We intentionally do NOT issue bulk blob deletes from clear() —
    // it's a test-only helper and obliterating durable state by
    // accident would be a compliance nightmare.
  }

  // -------------------------------------------------------------------------
  // Async extensions
  // -------------------------------------------------------------------------

  /**
   * Wait for every pending write to finish. Used by tests + the
   * super-runner shutdown path.
   */
  async flush(): Promise<void> {
    await Promise.allSettled(Array.from(this.pendingWrites));
  }

  /**
   * Hydrate the write cache for a tenant from durable storage.
   * Callers with a cold-start concern should await this before
   * issuing their first cross-case correlation call.
   */
  async hydrate(tenantId: string): Promise<number> {
    const indexKey = this.indexKey(tenantId);
    const index = await this.blob.getJSON<TenantIndex>(indexKey);
    if (!index || !Array.isArray(index.caseIds)) return 0;

    const snapshots: CaseSnapshot[] = [];
    for (const caseId of index.caseIds) {
      const snap = await this.blob.getJSON<CaseSnapshot>(
        this.snapshotKey(tenantId, caseId)
      );
      if (snap) snapshots.push(snap);
    }
    // Sort by openedAt to preserve chronological order across cold starts.
    snapshots.sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt));

    this.writeCache.set(tenantId, snapshots);
    return snapshots.length;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private indexKey(tenantId: string): string {
    return `index/${safeSegment(tenantId)}.json`;
  }

  private snapshotKey(tenantId: string, caseId: string): string {
    return `snapshots/${safeSegment(tenantId)}/${safeSegment(caseId)}.json`;
  }

  private async persistAsync(
    snapshot: CaseSnapshot,
    evictedCaseIds: readonly string[]
  ): Promise<void> {
    const tenantId = snapshot.tenantId;
    const indexKey = this.indexKey(tenantId);

    // Write the snapshot blob first so a concurrent reader cannot
    // observe an index entry for a not-yet-written case.
    await this.blob.setJSON(
      this.snapshotKey(tenantId, snapshot.caseId),
      snapshot
    );

    // Update index. Read-modify-write is acceptable here because the
    // super-runner serialises per-tenant writes.
    const existing = (await this.blob.getJSON<TenantIndex>(indexKey)) ?? {
      caseIds: [],
      updatedAtIso: new Date().toISOString(),
    };
    const filtered = existing.caseIds.filter((id) => !evictedCaseIds.includes(id));
    // Deduplicate: replaying the same verdict should not add a second
    // index entry. Idempotency is owned by the Asana orchestrator but
    // we also want our own index clean.
    if (!filtered.includes(snapshot.caseId)) filtered.push(snapshot.caseId);
    const next: TenantIndex = {
      caseIds: filtered,
      updatedAtIso: new Date().toISOString(),
    };
    await this.blob.setJSON(indexKey, next);

    // Delete evicted snapshot blobs so long-running tenants never
    // accumulate orphaned keys past the bound.
    for (const caseId of evictedCaseIds) {
      try {
        await this.blob.delete(this.snapshotKey(tenantId, caseId));
      } catch {
        /* best-effort; eviction is cosmetic */
      }
    }
  }
}

/**
 * Sanitize a path segment before it goes into a blob key. Blob keys
 * are URL-like; we strip anything outside [A-Za-z0-9._-] to avoid
 * surprises with slashes or control characters in tenant ids.
 */
function safeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
}

/**
 * Attach a Netlify Blob backend to the shared `brainMemory` at boot.
 *
 * Usage (inside a Netlify function):
 *
 *     import { getStore } from '@netlify/blobs';
 *     import { createNetlifyBlobHandle, BlobBrainMemoryStore }
 *       from '../src/services/brainMemoryBlobStore';
 *
 *     const handle = createNetlifyBlobHandle(getStore('brain-memory'));
 *     const store = new BlobBrainMemoryStore(handle);
 *     await store.hydrate(tenantId);
 *     // pass `store` to runSuperDecision via `memory` option
 */
export function createNetlifyBlobHandle(netlifyStore: {
  get: (key: string, opts?: { type?: 'json' }) => Promise<unknown>;
  setJSON: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<void>;
}): BlobHandle {
  return {
    async getJSON<T = unknown>(key: string): Promise<T | null> {
      const v = await netlifyStore.get(key, { type: 'json' });
      return (v ?? null) as T | null;
    },
    async setJSON(key: string, value: unknown): Promise<void> {
      await netlifyStore.setJSON(key, value);
    },
    async delete(key: string): Promise<void> {
      await netlifyStore.delete(key);
    },
  };
}

// Exports for tests.
export const __test__ = { safeSegment, DEFAULT_MAX_PER_TENANT };
