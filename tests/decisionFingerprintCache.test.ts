/**
 * Decision fingerprint cache tests.
 */
import { describe, it, expect } from "vitest";
import {
  computeFingerprint,
  canonicalizeFingerprintInput,
  DecisionFingerprintCache,
  __test__,
  type FingerprintInput,
} from "../src/services/decisionFingerprintCache";
import type { StrFeatures } from "../src/services/predictiveStr";

const { canonicalizeFeatures, DEFAULT_TTL_MS, DEFAULT_MAX_PER_TENANT } = __test__;

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

function input(
  overrides: Partial<FingerprintInput> = {}
): FingerprintInput {
  return {
    tenantId: "t1",
    entityId: "ent1",
    features: f(),
    sanctionsConfirmedFlag: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------------

describe("canonicalizeFeatures", () => {
  it("emits fields in a fixed order with typed separators", () => {
    const s = canonicalizeFeatures(f({ sanctionsMatchScore: 0.5, isPep: true }));
    expect(s).toMatch(/priorAlerts90d=0/);
    expect(s).toMatch(/isPep=1/);
    expect(s).toMatch(/sanctionsMatchScore=0\.5/);
  });
  it("maps booleans to 0/1", () => {
    expect(
      canonicalizeFeatures(f({ isPep: true, highRiskJurisdiction: true }))
    ).toMatch(/isPep=1\|highRiskJurisdiction=1/);
    expect(
      canonicalizeFeatures(f({ isPep: false, highRiskJurisdiction: false }))
    ).toMatch(/isPep=0\|highRiskJurisdiction=0/);
  });
});

describe("canonicalizeFingerprintInput", () => {
  it("prefixes with a domain-separated tag", () => {
    expect(canonicalizeFingerprintInput(input())).toMatch(
      /^hawkeye-decision-fingerprint-v1/
    );
  });
  it("includes every key component", () => {
    const s = canonicalizeFingerprintInput(
      input({ tenantId: "T", entityId: "E", sanctionsConfirmedFlag: true })
    );
    expect(s).toMatch(/tenant=T/);
    expect(s).toMatch(/entity=E/);
    expect(s).toMatch(/sanctionsConfirmedFlag=1/);
  });
});

// ---------------------------------------------------------------------------
// computeFingerprint
// ---------------------------------------------------------------------------

describe("computeFingerprint", () => {
  it("produces a stable SHA-256 hex string", async () => {
    const fp = await computeFingerprint(input());
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("same input → same fingerprint", async () => {
    const a = await computeFingerprint(input());
    const b = await computeFingerprint(input());
    expect(a).toBe(b);
  });

  it("different tenant → different fingerprint", async () => {
    const a = await computeFingerprint(input({ tenantId: "t1" }));
    const b = await computeFingerprint(input({ tenantId: "t2" }));
    expect(a).not.toBe(b);
  });

  it("different entity → different fingerprint", async () => {
    const a = await computeFingerprint(input({ entityId: "e1" }));
    const b = await computeFingerprint(input({ entityId: "e2" }));
    expect(a).not.toBe(b);
  });

  it("different feature → different fingerprint", async () => {
    const a = await computeFingerprint(input());
    const b = await computeFingerprint(
      input({ features: f({ sanctionsMatchScore: 0.9 }) })
    );
    expect(a).not.toBe(b);
  });

  it("sanctionsConfirmedFlag flip → different fingerprint", async () => {
    const a = await computeFingerprint(
      input({ sanctionsConfirmedFlag: false })
    );
    const b = await computeFingerprint(
      input({ sanctionsConfirmedFlag: true })
    );
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// DecisionFingerprintCache
// ---------------------------------------------------------------------------

describe("DecisionFingerprintCache", () => {
  interface FakeDecision {
    verdict: string;
  }

  it("returns null on miss", () => {
    const cache = new DecisionFingerprintCache<FakeDecision>();
    expect(cache.get("t1", "aaa")).toBeNull();
  });

  it("set then get returns the stored value", () => {
    const cache = new DecisionFingerprintCache<FakeDecision>();
    cache.set("t1", "fp", { verdict: "freeze" });
    expect(cache.get("t1", "fp")).toEqual({ verdict: "freeze" });
  });

  it("tenant-scoped: t1 entries are invisible to t2", () => {
    const cache = new DecisionFingerprintCache<FakeDecision>();
    cache.set("t1", "fp", { verdict: "flag" });
    expect(cache.get("t2", "fp")).toBeNull();
  });

  it("expires entries after the TTL", () => {
    let now = 1_000_000;
    const cache = new DecisionFingerprintCache<FakeDecision>({
      ttlMs: 500,
      now: () => now,
    });
    cache.set("t1", "fp", { verdict: "flag" });
    expect(cache.get("t1", "fp")).toEqual({ verdict: "flag" });
    now += 501;
    expect(cache.get("t1", "fp")).toBeNull();
  });

  it("evicts oldest entry when per-tenant cap is exceeded", () => {
    const cache = new DecisionFingerprintCache<FakeDecision>({
      maxEntriesPerTenant: 3,
    });
    cache.set("t1", "fp1", { verdict: "a" });
    cache.set("t1", "fp2", { verdict: "b" });
    cache.set("t1", "fp3", { verdict: "c" });
    cache.set("t1", "fp4", { verdict: "d" });
    // fp1 was the oldest; should be evicted.
    expect(cache.get("t1", "fp1")).toBeNull();
    expect(cache.get("t1", "fp2")).toEqual({ verdict: "b" });
    expect(cache.get("t1", "fp3")).toEqual({ verdict: "c" });
    expect(cache.get("t1", "fp4")).toEqual({ verdict: "d" });
  });

  it("stats reflect hit + miss counts", () => {
    const cache = new DecisionFingerprintCache<FakeDecision>();
    cache.set("t1", "fp", { verdict: "a" });
    cache.get("t1", "fp"); // hit
    cache.get("t1", "fp"); // hit
    cache.get("t1", "missing"); // miss
    const stats = cache.stats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(2 / 3, 5);
    expect(stats.tenantCount).toBe(1);
    expect(stats.totalEntries).toBe(1);
  });

  it("clear wipes everything", () => {
    const cache = new DecisionFingerprintCache<FakeDecision>();
    cache.set("t1", "fp", { verdict: "x" });
    cache.clear();
    expect(cache.get("t1", "fp")).toBeNull();
    expect(cache.stats().hits).toBe(0);
    expect(cache.stats().misses).toBe(1); // the get above was a miss
  });

  it("default TTL is 60 seconds", () => {
    expect(DEFAULT_TTL_MS).toBe(60_000);
  });

  it("default per-tenant cap is 200", () => {
    expect(DEFAULT_MAX_PER_TENANT).toBe(200);
  });
});
