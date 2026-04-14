/**
 * Brain memory digest blob store tests.
 *
 * Uses a FakeBlobHandle that mirrors the Netlify Blobs getJSON /
 * setJSON / delete surface. Tests never touch the real
 * @netlify/blobs module.
 */
import { describe, it, expect } from "vitest";
import {
  BrainMemoryDigestBlobStore,
  __test__,
} from "../src/services/brainMemoryDigestBlobStore";
import {
  emptyDigest,
  updateDigest,
} from "../src/services/brainMemoryDigest";
import type { BlobHandle } from "../src/services/brainMemoryBlobStore";
import type { ComplianceDecision } from "../src/services/complianceDecisionEngine";
import type { StrFeatures } from "../src/services/predictiveStr";

const { safeSegment, digestKey } = __test__;

class FakeBlobHandle implements BlobHandle {
  readonly data = new Map<string, unknown>();
  readonly getCalls: string[] = [];
  readonly setCalls: string[] = [];
  readonly deleteCalls: string[] = [];
  throwOnNextGet = false;
  throwOnNextSet = false;

  async getJSON<T = unknown>(key: string): Promise<T | null> {
    this.getCalls.push(key);
    if (this.throwOnNextGet) {
      this.throwOnNextGet = false;
      throw new Error("blob read error");
    }
    const v = this.data.get(key);
    return v === undefined ? null : (v as T);
  }
  async setJSON(key: string, value: unknown): Promise<void> {
    this.setCalls.push(key);
    if (this.throwOnNextSet) {
      this.throwOnNextSet = false;
      throw new Error("blob write error");
    }
    this.data.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.deleteCalls.push(key);
    this.data.delete(key);
  }
}

function f(overrides: Partial<StrFeatures> = {}): StrFeatures {
  return {
    priorAlerts90d: 0,
    txValue30dAED: 50_000,
    nearThresholdCount30d: 0,
    crossBorderRatio30d: 0,
    isPep: false,
    highRiskJurisdiction: false,
    hasAdverseMedia: false,
    daysSinceOnboarding: 365,
    sanctionsMatchScore: 0,
    cashRatio30d: 0,
    ...overrides,
  };
}

function fakeDecision(
  overrides: Partial<ComplianceDecision> = {}
): ComplianceDecision {
  return {
    id: "t1:ent1:100",
    tenantId: "t1",
    verdict: "flag",
    confidence: 0.8,
    recommendedAction: "monitor",
    requiresHumanReview: false,
    strPrediction: {
      probability: 0.2,
      band: "low",
      recommendation: "monitor",
      factors: [],
      logit: 0,
      intercept: 0,
    },
    warRoomEvent: {
      id: "w1",
      at: "2026-04-14T12:00:00.000Z",
      kind: "screening",
      severity: "medium",
      title: "T",
      entityId: "ent1",
    },
    at: "2026-04-14T12:00:00.000Z",
    auditNarrative: "",
    raw: {} as unknown as ComplianceDecision["raw"],
    ...overrides,
  } as ComplianceDecision;
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

describe("BrainMemoryDigestBlobStore — key helpers", () => {
  it("digestKey uses digest/ prefix", () => {
    expect(digestKey("t1")).toBe("digest/t1.json");
  });
  it("digestKey sanitizes the tenant segment", () => {
    expect(digestKey("../etc/passwd")).toBe("digest/.._etc_passwd.json");
  });
  it("safeSegment truncates at 128 chars", () => {
    expect(safeSegment("x".repeat(300)).length).toBe(128);
  });
});

// ---------------------------------------------------------------------------
// Cold load
// ---------------------------------------------------------------------------

describe("BrainMemoryDigestBlobStore — cold load", () => {
  it("returns an empty digest when the blob has no entry for the tenant", async () => {
    const blob = new FakeBlobHandle();
    const store = new BrainMemoryDigestBlobStore(blob);
    const d = await store.load("tnew");
    expect(d.tenantId).toBe("tnew");
    expect(d.entries).toHaveLength(0);
    expect(d.totalUpdates).toBe(0);
  });

  it("returns an empty digest for an empty tenant id", async () => {
    const store = new BrainMemoryDigestBlobStore(new FakeBlobHandle());
    const d = await store.load("");
    expect(d.entries).toHaveLength(0);
  });

  it("returns an empty digest and warns on a malformed blob", async () => {
    const blob = new FakeBlobHandle();
    blob.data.set("digest/t1.json", { not: "a digest" });
    const store = new BrainMemoryDigestBlobStore(blob);
    const d = await store.load("t1");
    expect(d.entries).toHaveLength(0);
  });

  it("returns an empty digest when getJSON throws", async () => {
    const blob = new FakeBlobHandle();
    blob.throwOnNextGet = true;
    const store = new BrainMemoryDigestBlobStore(blob);
    const d = await store.load("t1");
    expect(d.entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe("BrainMemoryDigestBlobStore — save + load round-trip", () => {
  it("persists the digest and loads it back exactly", async () => {
    const blob = new FakeBlobHandle();
    const store = new BrainMemoryDigestBlobStore(blob);

    const updated = updateDigest(emptyDigest("t1"), {
      tenantId: "t1",
      decision: fakeDecision({ verdict: "freeze" }),
      features: f({ sanctionsMatchScore: 0.95 }),
    });

    store.save(updated);
    await store.flush();

    // Clear cache so load() must go to the blob.
    store.clearCacheForTests();
    const loaded = await store.load("t1");

    expect(loaded.tenantId).toBe("t1");
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0].verdict).toBe("freeze");
    expect(loaded.entries[0].severity).toBe("critical");
  });

  it("isolates tenants by key prefix", async () => {
    const blob = new FakeBlobHandle();
    const store = new BrainMemoryDigestBlobStore(blob);

    const t1 = updateDigest(emptyDigest("t1"), {
      tenantId: "t1",
      decision: fakeDecision({ id: "t1:e:1", tenantId: "t1" }),
      features: f(),
    });
    const t2 = updateDigest(emptyDigest("t2"), {
      tenantId: "t2",
      decision: fakeDecision({ id: "t2:e:1", tenantId: "t2" }),
      features: f(),
    });

    store.save(t1);
    store.save(t2);
    await store.flush();
    store.clearCacheForTests();

    const loadedT1 = await store.load("t1");
    const loadedT2 = await store.load("t2");

    expect(loadedT1.tenantId).toBe("t1");
    expect(loadedT1.entries.length).toBeGreaterThan(0);
    expect(loadedT2.tenantId).toBe("t2");
    expect(loadedT2.entries.length).toBeGreaterThan(0);
    // Cross-tenant reads never leak — the blob keys are distinct.
    expect(blob.setCalls).toContain("digest/t1.json");
    expect(blob.setCalls).toContain("digest/t2.json");
  });

  it("in-process cache short-circuits repeated loads", async () => {
    const blob = new FakeBlobHandle();
    const store = new BrainMemoryDigestBlobStore(blob);

    const d = updateDigest(emptyDigest("t1"), {
      tenantId: "t1",
      decision: fakeDecision(),
      features: f(),
    });
    store.save(d);
    await store.flush();

    await store.load("t1");
    await store.load("t1");
    await store.load("t1");

    // Only one getJSON call — the rest hit the cache.
    // (The save() path also populates the cache synchronously, so
    // the very first load() could return from cache without hitting
    // the blob at all. Either way, the final count is bounded.)
    expect(blob.getCalls.length).toBeLessThanOrEqual(1);
  });

  it("cache can be disabled", async () => {
    const blob = new FakeBlobHandle();
    const store = new BrainMemoryDigestBlobStore(blob, { enableCache: false });
    blob.data.set(
      "digest/t1.json",
      updateDigest(emptyDigest("t1"), {
        tenantId: "t1",
        decision: fakeDecision(),
        features: f(),
      })
    );

    await store.load("t1");
    await store.load("t1");
    expect(blob.getCalls.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Save path failure tolerance
// ---------------------------------------------------------------------------

describe("BrainMemoryDigestBlobStore — write failure tolerance", () => {
  it("swallows setJSON errors without throwing from save()", async () => {
    const blob = new FakeBlobHandle();
    blob.throwOnNextSet = true;
    const store = new BrainMemoryDigestBlobStore(blob);

    const d = updateDigest(emptyDigest("t1"), {
      tenantId: "t1",
      decision: fakeDecision(),
      features: f(),
    });
    // save() is synchronous and must not throw even if the blob
    // write will fail asynchronously.
    expect(() => store.save(d)).not.toThrow();
    await expect(store.flush()).resolves.toBeUndefined();
  });

  it("silently drops a save with an empty tenantId", async () => {
    const blob = new FakeBlobHandle();
    const store = new BrainMemoryDigestBlobStore(blob);
    const d: ReturnType<typeof emptyDigest> = {
      ...emptyDigest(""),
      tenantId: "",
    };
    store.save(d);
    await store.flush();
    expect(blob.setCalls).toHaveLength(0);
  });
});
