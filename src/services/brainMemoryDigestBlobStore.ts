/**
 * Brain Memory Digest Blob Store — durable persistence for the
 * compressed per-tenant digest introduced in commit 22.
 *
 * The `BrainMemoryDigest` itself is a pure, immutable value object:
 * `updateDigest()` returns a new digest, and `runSuperDecision()`
 * produces a `digestAfter` alongside the decision. But until this
 * commit the digest had no persistence wiring — a cold function
 * start would start from an empty digest and every new request
 * would see zero precedents for the first ~20 cases.
 *
 * This module adds a thin persistence layer using the SAME Netlify
 * Blob store the snapshot-level memory uses (`brain-memory`), with
 * a dedicated key prefix `digest/<tenantId>.json` so it cannot
 * collide with the snapshot blobs at `snapshots/<tenantId>/...`.
 *
 * Design:
 *   - Same BlobHandle abstraction used by `brainMemoryBlobStore.ts`
 *     so tests can inject a fake without touching @netlify/blobs.
 *   - Synchronous in-process cache for read hits so the decision
 *     path never pays the blob round-trip twice on a warm instance.
 *   - Write path is fire-and-forget with a pending-writes set the
 *     caller can await via `flush()` in tests.
 *   - Tenant isolation enforced at the key layer via safeSegment.
 *   - Cross-tenant read attempts return empty digests, never error.
 *   - A cold hydrate() returns an empty digest when the blob does
 *     not exist yet, so first-request-after-deploy behaviour is
 *     identical to "no digest provided" (the same code path the
 *     super runner already handles).
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO reasoned decision — precedents
 *                             must persist across function starts)
 *   FDL No.10/2025 Art.24    (10-year retention — digest is a
 *                             compact mirror of the durable log)
 *   FDL No.10/2025 Art.29    (no tipping off — digest only holds
 *                             opaque caseIds and feature vectors)
 *   Cabinet Res 134/2025 Art.19 (internal review visibility)
 */

import {
  emptyDigest,
  type BrainMemoryDigest,
} from './brainMemoryDigest';
import type { BlobHandle } from './brainMemoryBlobStore';

// ---------------------------------------------------------------------------
// Key layout
// ---------------------------------------------------------------------------

/**
 * Sanitize a tenantId into a safe blob-key segment. Mirrors the
 * implementation in brainMemoryBlobStore so both stores agree.
 */
function safeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
}

function digestKey(tenantId: string): string {
  return `digest/${safeSegment(tenantId)}.json`;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface BrainMemoryDigestStoreOptions {
  /**
   * When true (default), the store holds a per-tenant in-process
   * cache of the latest digest so a warm function instance never
   * pays the blob round-trip twice for the same tenant. Tests that
   * need to exercise the read path every call can pass false.
   */
  enableCache?: boolean;
}

export class BrainMemoryDigestBlobStore {
  private readonly blob: BlobHandle;
  private readonly enableCache: boolean;
  private readonly cache = new Map<string, BrainMemoryDigest>();
  private readonly pendingWrites = new Set<Promise<unknown>>();

  constructor(
    blob: BlobHandle,
    opts: BrainMemoryDigestStoreOptions = {}
  ) {
    this.blob = blob;
    this.enableCache = opts.enableCache ?? true;
  }

  /**
   * Load the digest for a tenant from the blob. Returns an empty
   * digest when the blob has not been written yet — that is the
   * same shape `runSuperDecision` already handles when no digest
   * is supplied, so a cold start is fully transparent.
   *
   * Reads the in-process cache first when enabled.
   */
  async load(tenantId: string): Promise<BrainMemoryDigest> {
    if (!tenantId || typeof tenantId !== 'string') {
      return emptyDigest('');
    }
    if (this.enableCache) {
      const cached = this.cache.get(tenantId);
      if (cached) return cached;
    }
    try {
      const stored = await this.blob.getJSON<BrainMemoryDigest>(
        digestKey(tenantId)
      );
      if (stored && typeof stored === 'object' && stored.tenantId === tenantId) {
        if (this.enableCache) this.cache.set(tenantId, stored);
        return stored;
      }
    } catch (err) {
      console.warn(
        `[digestBlob] load failed for ${tenantId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    // Fall through: empty digest for first contact or malformed blob.
    const fresh = emptyDigest(tenantId);
    if (this.enableCache) this.cache.set(tenantId, fresh);
    return fresh;
  }

  /**
   * Save a digest to the blob. Updates the in-process cache
   * synchronously. Fire-and-forget write; callers that need to
   * wait for persistence use `flush()`.
   *
   * Tenant isolation: a digest whose tenantId does not match the
   * key segment is silently dropped — the caller must not be
   * trusted with cross-tenant writes.
   */
  save(digest: BrainMemoryDigest): void {
    if (!digest.tenantId) return;
    if (this.enableCache) this.cache.set(digest.tenantId, digest);
    const write = (async () => {
      try {
        await this.blob.setJSON(digestKey(digest.tenantId), digest);
      } catch (err) {
        console.error(
          `[digestBlob] save failed for ${digest.tenantId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })();
    this.pendingWrites.add(write);
    void write.finally(() => this.pendingWrites.delete(write));
  }

  /** Wait for every pending write to finish. */
  async flush(): Promise<void> {
    await Promise.allSettled(Array.from(this.pendingWrites));
  }

  /** Test-only: clear the in-process cache without touching the blob. */
  clearCacheForTests(): void {
    this.cache.clear();
  }
}

// Exports for tests.
export const __test__ = { safeSegment, digestKey };
