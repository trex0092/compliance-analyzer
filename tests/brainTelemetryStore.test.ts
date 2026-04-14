/**
 * Brain telemetry store tests.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  BrainTelemetryStore,
  __test__,
  type BrainTelemetryEntry,
} from "../src/services/brainTelemetryStore";
import type { BlobHandle } from "../src/services/brainMemoryBlobStore";

const { safeSegment, dayKey, DEFAULT_MAX_PER_DAY } = __test__;

class FakeBlobHandle implements BlobHandle {
  readonly data = new Map<string, unknown>();
  readonly getCalls: string[] = [];
  readonly setCalls: string[] = [];
  readonly deleteCalls: string[] = [];
  throwNext = false;

  async getJSON<T = unknown>(key: string): Promise<T | null> {
    this.getCalls.push(key);
    if (this.throwNext) {
      this.throwNext = false;
      throw new Error("boom");
    }
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

function entry(overrides: Partial<BrainTelemetryEntry> = {}): BrainTelemetryEntry {
  return {
    tsIso: "2026-04-14T12:00:00.000Z",
    tenantId: "t1",
    entityRef: "ent-opaque",
    verdict: "flag",
    confidence: 0.8,
    powerScore: 60,
    brainVerdict: "flag",
    ensembleUnstable: false,
    typologyIds: [],
    crossCaseFindingCount: 0,
    velocitySeverity: null,
    driftSeverity: "none",
    requiresHumanReview: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

describe("brainTelemetryStore — key helpers", () => {
  it("safeSegment sanitises traversal + specials + length", () => {
    expect(safeSegment("../etc/passwd")).toBe(".._etc_passwd");
    expect(safeSegment("ten/ant")).toBe("ten_ant");
    expect(safeSegment("x".repeat(300)).length).toBe(128);
  });

  it("dayKey uses telemetry/<tenant>/<YYYY-MM-DD>.jsonl shape", () => {
    expect(dayKey("t1", "2026-04-14T12:34:56.000Z")).toBe(
      "telemetry/t1/2026-04-14.jsonl"
    );
  });

  it("dayKey sanitises the tenant segment", () => {
    expect(dayKey("t/1", "2026-04-14T00:00:00.000Z")).toBe(
      "telemetry/t_1/2026-04-14.jsonl"
    );
  });
});

// ---------------------------------------------------------------------------
// record + flush + readDay
// ---------------------------------------------------------------------------

describe("BrainTelemetryStore — record + read", () => {
  let blob: FakeBlobHandle;
  let store: BrainTelemetryStore;

  beforeEach(() => {
    blob = new FakeBlobHandle();
    store = new BrainTelemetryStore(blob);
  });

  it("appends a single entry and reads it back", async () => {
    store.record(entry());
    await store.flush();
    const entries = await store.readDay("t1", "2026-04-14");
    expect(entries).toHaveLength(1);
    expect(entries[0].verdict).toBe("flag");
  });

  it("appends multiple entries to the same day without overwriting", async () => {
    store.record(entry({ verdict: "flag" }));
    await store.flush();
    store.record(entry({ verdict: "freeze", confidence: 0.95 }));
    await store.flush();
    const entries = await store.readDay("t1", "2026-04-14");
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.verdict).sort()).toEqual(["flag", "freeze"]);
  });

  it("isolates tenants by key", async () => {
    store.record(entry({ tenantId: "t1" }));
    store.record(entry({ tenantId: "t2" }));
    await store.flush();
    expect((await store.readDay("t1", "2026-04-14")).length).toBe(1);
    expect((await store.readDay("t2", "2026-04-14")).length).toBe(1);
    expect(blob.setCalls.some((k) => k.includes("t1"))).toBe(true);
    expect(blob.setCalls.some((k) => k.includes("t2"))).toBe(true);
  });

  it("silently drops entries with an empty tenantId", async () => {
    store.record(entry({ tenantId: "" }));
    await store.flush();
    expect(blob.setCalls).toHaveLength(0);
  });

  it("bounds per-day size at maxEntriesPerDay", async () => {
    const boundedStore = new BrainTelemetryStore(blob, { maxEntriesPerDay: 3 });
    for (let i = 0; i < 7; i++) {
      boundedStore.record(entry({ entityRef: `e${i}` }));
      await boundedStore.flush();
    }
    const entries = await boundedStore.readDay("t1", "2026-04-14");
    expect(entries).toHaveLength(3);
    // Oldest 4 evicted; newest 3 remain.
    expect(entries.map((e) => e.entityRef)).toEqual(["e4", "e5", "e6"]);
  });

  it("readDay returns empty array when the day has no entries", async () => {
    expect(await store.readDay("t1", "2026-01-01")).toHaveLength(0);
  });

  it("readDay returns empty array on blob read error", async () => {
    blob.throwNext = true;
    expect(await store.readDay("t1", "2026-04-14")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// readRange
// ---------------------------------------------------------------------------

describe("BrainTelemetryStore — readRange", () => {
  it("returns entries across multiple days", async () => {
    const blob = new FakeBlobHandle();
    const store = new BrainTelemetryStore(blob);
    store.record(entry({ tsIso: "2026-04-12T10:00:00.000Z", verdict: "flag" }));
    store.record(entry({ tsIso: "2026-04-13T10:00:00.000Z", verdict: "escalate" }));
    store.record(entry({ tsIso: "2026-04-14T10:00:00.000Z", verdict: "freeze" }));
    await store.flush();
    const entries = await store.readRange(
      "t1",
      "2026-04-12",
      "2026-04-14"
    );
    expect(entries).toHaveLength(3);
  });

  it("returns empty array for invalid date range", async () => {
    const store = new BrainTelemetryStore(new FakeBlobHandle());
    expect(await store.readRange("t1", "not-a-date", "also-nope")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// aggregate
// ---------------------------------------------------------------------------

describe("BrainTelemetryStore — aggregate", () => {
  it("rolls up verdict counts + confidence + power score", async () => {
    const blob = new FakeBlobHandle();
    const store = new BrainTelemetryStore(blob);
    store.record(entry({ verdict: "pass", confidence: 0.9, powerScore: 50 }));
    store.record(entry({ verdict: "flag", confidence: 0.7, powerScore: 70 }));
    store.record(entry({ verdict: "freeze", confidence: 0.95, powerScore: 85 }));
    store.record(entry({ verdict: "freeze", confidence: 0.98, powerScore: null }));
    await store.flush();
    const agg = await store.aggregate("t1", "2026-04-14", "2026-04-14");
    expect(agg.totalDecisions).toBe(4);
    expect(agg.byVerdict.pass).toBe(1);
    expect(agg.byVerdict.flag).toBe(1);
    expect(agg.byVerdict.freeze).toBe(2);
    expect(agg.avgConfidence).toBeCloseTo((0.9 + 0.7 + 0.95 + 0.98) / 4, 4);
    expect(agg.avgPowerScore).toBeCloseTo((50 + 70 + 85) / 3, 4);
  });

  it("counts human review + ensemble unstable + drift decisions", async () => {
    const blob = new FakeBlobHandle();
    const store = new BrainTelemetryStore(blob);
    store.record(entry({ requiresHumanReview: true, ensembleUnstable: true }));
    store.record(entry({ driftSeverity: "critical" }));
    store.record(entry());
    await store.flush();
    const agg = await store.aggregate("t1", "2026-04-14", "2026-04-14");
    expect(agg.ensembleUnstableCount).toBe(1);
    expect(agg.humanReviewCount).toBe(1);
    expect(agg.driftDecisionCount).toBe(1);
  });

  it("ranks the top typologies by firing count", async () => {
    const blob = new FakeBlobHandle();
    const store = new BrainTelemetryStore(blob);
    store.record(entry({ typologyIds: ["STRUCT-001", "DPMS-001"] }));
    store.record(entry({ typologyIds: ["STRUCT-001"] }));
    store.record(entry({ typologyIds: ["SANCTIONS-001", "STRUCT-001"] }));
    await store.flush();
    const agg = await store.aggregate("t1", "2026-04-14", "2026-04-14");
    expect(agg.topTypologies[0]).toEqual({ id: "STRUCT-001", count: 3 });
    expect(agg.topTypologies.map((t) => t.id)).toContain("DPMS-001");
    expect(agg.topTypologies.map((t) => t.id)).toContain("SANCTIONS-001");
  });

  it("handles an empty range cleanly", async () => {
    const store = new BrainTelemetryStore(new FakeBlobHandle());
    const agg = await store.aggregate("t1", "2026-03-01", "2026-03-02");
    expect(agg.totalDecisions).toBe(0);
    expect(agg.avgConfidence).toBe(0);
    expect(agg.avgPowerScore).toBeNull();
    expect(agg.topTypologies).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Concurrent writes to the same key
// ---------------------------------------------------------------------------

describe("BrainTelemetryStore — concurrent append ordering", () => {
  it("serialises concurrent writes to the same day key (no lost updates)", async () => {
    const blob = new FakeBlobHandle();
    const store = new BrainTelemetryStore(blob);
    // Fire 5 writes with no await between them.
    for (let i = 0; i < 5; i++) {
      store.record(entry({ entityRef: `e${i}` }));
    }
    await store.flush();
    const entries = await store.readDay("t1", "2026-04-14");
    expect(entries).toHaveLength(5);
    // Every entity ref present — proves no lost updates.
    const refs = entries.map((e) => e.entityRef).sort();
    expect(refs).toEqual(["e0", "e1", "e2", "e3", "e4"]);
  });
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe("BrainTelemetryStore — defaults", () => {
  it("default maxEntriesPerDay is 5000", () => {
    expect(DEFAULT_MAX_PER_DAY).toBe(5000);
  });
});
