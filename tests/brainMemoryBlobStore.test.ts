/**
 * Blob-backed brain memory store tests.
 *
 * Uses a FakeBlobHandle that mirrors the Netlify Blobs `getJSON` /
 * `setJSON` / `delete` surface in-memory. We never touch the real
 * @netlify/blobs module from unit tests.
 *
 * Verifies:
 *   - Synchronous MemoryStore contract works identically to the
 *     in-memory store
 *   - Writes persist to the fake blob (post-flush)
 *   - hydrate() on a cold store reconstructs snapshots in
 *     chronological order
 *   - FIFO eviction deletes orphaned snapshot blobs
 *   - Tenant path segments are sanitized
 *   - Deduplication — replaying the same caseId never grows the
 *     index
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  BlobBrainMemoryStore,
  __test__,
  type BlobHandle,
} from "../src/services/brainMemoryBlobStore";
import type { CaseSnapshot } from "../src/services/crossCasePatternCorrelator";

const { safeSegment, DEFAULT_MAX_PER_TENANT } = __test__;

// ---------------------------------------------------------------------------
// Fake blob backend
// ---------------------------------------------------------------------------

class FakeBlobHandle implements BlobHandle {
  readonly data = new Map<string, unknown>();
  readonly getCalls: string[] = [];
  readonly setCalls: string[] = [];
  readonly deleteCalls: string[] = [];

  async getJSON<T = unknown>(key: string): Promise<T | null> {
    this.getCalls.push(key);
    const v = this.data.get(key);
    return v === undefined ? null : (v as T);
  }
  async setJSON(key: string, value: unknown): Promise<void> {
    this.setCalls.push(key);
    this.data.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.deleteCalls.push(key);
    this.data.delete(key);
  }
}

function snap(overrides: Partial<CaseSnapshot> = {}): CaseSnapshot {
  return {
    caseId: Math.random().toString(36).slice(2, 10),
    tenantId: "t1",
    openedAt: "2026-04-14T12:00:00.000Z",
    entityRef: "e1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// safeSegment
// ---------------------------------------------------------------------------

describe("safeSegment", () => {
  it("strips special characters", () => {
    expect(safeSegment("ten/ant")).toBe("ten_ant");
    expect(safeSegment("a b c")).toBe("a_b_c");
    expect(safeSegment("../etc/passwd")).toBe(".._etc_passwd");
  });

  it("preserves allowed chars", () => {
    expect(safeSegment("alpha-01_v2.1")).toBe("alpha-01_v2.1");
  });

  it("truncates to 128 chars", () => {
    expect(safeSegment("x".repeat(500)).length).toBe(128);
  });
});

// ---------------------------------------------------------------------------
// Synchronous contract
// ---------------------------------------------------------------------------

describe("BlobBrainMemoryStore — synchronous contract", () => {
  let blob: FakeBlobHandle;
  let store: BlobBrainMemoryStore;

  beforeEach(() => {
    blob = new FakeBlobHandle();
    store = new BlobBrainMemoryStore(blob, { maxSnapshotsPerTenant: 5 });
  });

  it("record + recentForTenant + sizeForTenant (sync via cache)", () => {
    store.record(snap({ caseId: "c1" }));
    store.record(snap({ caseId: "c2" }));
    expect(store.sizeForTenant("t1")).toBe(2);
    const recent = store.recentForTenant("t1");
    expect(recent).toHaveLength(2);
    expect(recent.map((s) => s.caseId)).toEqual(["c1", "c2"]);
  });

  it("isolates tenants in the cache", () => {
    store.record(snap({ tenantId: "t1", caseId: "a" }));
    store.record(snap({ tenantId: "t2", caseId: "b" }));
    expect(store.sizeForTenant("t1")).toBe(1);
    expect(store.sizeForTenant("t2")).toBe(1);
    expect(store.totalSize()).toBe(2);
  });

  it("recentForTenant honours a limit", () => {
    for (let i = 0; i < 5; i++) store.record(snap({ caseId: `c${i}` }));
    expect(store.recentForTenant("t1", 2).map((s) => s.caseId)).toEqual([
      "c3",
      "c4",
    ]);
  });

  it("clear wipes the cache (but leaves blob data intact)", async () => {
    store.record(snap());
    await store.flush();
    store.clear();
    expect(store.totalSize()).toBe(0);
    // Blob still has the data.
    expect(blob.data.size).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Async persistence
// ---------------------------------------------------------------------------

describe("BlobBrainMemoryStore — async persistence", () => {
  let blob: FakeBlobHandle;
  let store: BlobBrainMemoryStore;

  beforeEach(() => {
    blob = new FakeBlobHandle();
    store = new BlobBrainMemoryStore(blob, { maxSnapshotsPerTenant: 5 });
  });

  it("writes a snapshot blob + index entry per record (after flush)", async () => {
    store.record(snap({ caseId: "c1" }));
    await store.flush();
    const snapKey = "snapshots/t1/c1.json";
    const indexKey = "index/t1.json";
    expect(blob.data.has(snapKey)).toBe(true);
    expect(blob.data.has(indexKey)).toBe(true);
    const index = blob.data.get(indexKey) as { caseIds: string[] };
    expect(index.caseIds).toContain("c1");
  });

  it("dedupes the index on replay of the same caseId", async () => {
    store.record(snap({ caseId: "c1" }));
    await store.flush();
    store.record(snap({ caseId: "c1" }));
    await store.flush();
    const index = blob.data.get("index/t1.json") as { caseIds: string[] };
    expect(index.caseIds.filter((id) => id === "c1")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Eviction
// ---------------------------------------------------------------------------

describe("BlobBrainMemoryStore — FIFO eviction", () => {
  it("drops oldest cache entries AND deletes the orphaned blobs", async () => {
    const blob = new FakeBlobHandle();
    const store = new BlobBrainMemoryStore(blob, { maxSnapshotsPerTenant: 3 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    for (let i = 0; i < 5; i++) {
      store.record(snap({ caseId: `c${i}` }));
      await store.flush();
    }

    // Cache bounded to 3; should contain the 3 newest.
    expect(store.sizeForTenant("t1")).toBe(3);
    expect(store.recentForTenant("t1").map((s) => s.caseId)).toEqual([
      "c2",
      "c3",
      "c4",
    ]);

    // Evicted blobs have been deleted.
    expect(blob.data.has("snapshots/t1/c0.json")).toBe(false);
    expect(blob.data.has("snapshots/t1/c1.json")).toBe(false);
    expect(blob.data.has("snapshots/t1/c2.json")).toBe(true);

    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toMatch(/FDL Art\.?24/);
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Hydrate
// ---------------------------------------------------------------------------

describe("BlobBrainMemoryStore — hydrate from blob (cold start)", () => {
  it("rebuilds an empty cache from persisted blob data", async () => {
    // Step 1: warm store writes + flushes snapshots to the blob.
    const blob = new FakeBlobHandle();
    const warm = new BlobBrainMemoryStore(blob);
    warm.record(
      snap({ caseId: "a", openedAt: "2026-04-14T10:00:00.000Z" })
    );
    warm.record(
      snap({ caseId: "b", openedAt: "2026-04-14T11:00:00.000Z" })
    );
    warm.record(
      snap({ caseId: "c", openedAt: "2026-04-14T12:00:00.000Z" })
    );
    await warm.flush();

    // Step 2: simulate a cold start — fresh store, same blob.
    const cold = new BlobBrainMemoryStore(blob);
    expect(cold.sizeForTenant("t1")).toBe(0);

    const hydrated = await cold.hydrate("t1");
    expect(hydrated).toBe(3);
    expect(cold.sizeForTenant("t1")).toBe(3);

    // Order must be chronological by openedAt.
    const ids = cold.recentForTenant("t1").map((s) => s.caseId);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("returns 0 when the tenant has never been persisted", async () => {
    const blob = new FakeBlobHandle();
    const store = new BlobBrainMemoryStore(blob);
    const hydrated = await store.hydrate("never-seen");
    expect(hydrated).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_MAX_PER_TENANT sanity
// ---------------------------------------------------------------------------

describe("BlobBrainMemoryStore — defaults", () => {
  it("default cap is 1000", () => {
    expect(DEFAULT_MAX_PER_TENANT).toBe(1000);
  });
});
