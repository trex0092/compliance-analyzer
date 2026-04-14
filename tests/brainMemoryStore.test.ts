/**
 * Brain memory store tests.
 *
 * Covers:
 *   - InMemoryBrainMemoryStore record / recentForTenant / size / clear
 *   - Tenant isolation
 *   - FIFO eviction at maxSnapshotsPerTenant with console.warn
 *   - snapshotFromDecision extras + opaque-ref safety
 *   - correlateWithMemory returns a typed CorrelationReport
 *   - recordAndCorrelate records then correlates in the right order
 *     so the NEW case can form a ring with prior cases
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  InMemoryBrainMemoryStore,
  snapshotFromDecision,
  correlateWithMemory,
  recordAndCorrelate,
} from "../src/services/brainMemoryStore";
import type { CaseSnapshot } from "../src/services/crossCasePatternCorrelator";
import type { ComplianceDecision } from "../src/services/complianceDecisionEngine";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function snap(overrides: Partial<CaseSnapshot> = {}): CaseSnapshot {
  return {
    caseId: Math.random().toString(36).slice(2, 10),
    tenantId: "tenantA",
    openedAt: "2026-04-14T12:00:00.000Z",
    entityRef: "entity-X",
    ...overrides,
  };
}

function fakeDecision(overrides: Partial<ComplianceDecision> = {}): ComplianceDecision {
  return {
    id: "tenantA:entity-X:1",
    tenantId: "tenantA",
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
      id: "wre-1",
      at: "2026-04-14T12:00:00.000Z",
      kind: "screening",
      severity: "medium",
      title: "Test",
      entityId: "entity-X",
    },
    at: "2026-04-14T12:00:00.000Z",
    auditNarrative: "test narrative",
    raw: {} as unknown as ComplianceDecision["raw"],
    ...overrides,
  } as ComplianceDecision;
}

// ---------------------------------------------------------------------------
// InMemoryBrainMemoryStore
// ---------------------------------------------------------------------------

describe("InMemoryBrainMemoryStore", () => {
  let store: InMemoryBrainMemoryStore;

  beforeEach(() => {
    store = new InMemoryBrainMemoryStore({ maxSnapshotsPerTenant: 5 });
  });

  it("records snapshots per tenant", () => {
    store.record(snap({ caseId: "c1" }));
    store.record(snap({ caseId: "c2" }));
    expect(store.sizeForTenant("tenantA")).toBe(2);
    expect(store.totalSize()).toBe(2);
  });

  it("isolates tenants", () => {
    store.record(snap({ tenantId: "tenantA", caseId: "a" }));
    store.record(snap({ tenantId: "tenantB", caseId: "b" }));
    store.record(snap({ tenantId: "tenantB", caseId: "c" }));
    expect(store.sizeForTenant("tenantA")).toBe(1);
    expect(store.sizeForTenant("tenantB")).toBe(2);
    expect(store.recentForTenant("tenantA")).toHaveLength(1);
    expect(store.recentForTenant("tenantB")).toHaveLength(2);
  });

  it("FIFO evicts beyond maxSnapshotsPerTenant with warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (let i = 0; i < 7; i++) store.record(snap({ caseId: `c${i}` }));
    expect(store.sizeForTenant("tenantA")).toBe(5);
    // Oldest 2 should be evicted: the remaining caseIds should be c2..c6.
    const recent = store.recentForTenant("tenantA");
    const ids = recent.map((s) => s.caseId);
    expect(ids).toEqual(["c2", "c3", "c4", "c5", "c6"]);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toMatch(/FDL Art\.?24/);
    warn.mockRestore();
  });

  it("recentForTenant honours a limit", () => {
    for (let i = 0; i < 5; i++) store.record(snap({ caseId: `c${i}` }));
    const lastTwo = store.recentForTenant("tenantA", 2);
    expect(lastTwo).toHaveLength(2);
    expect(lastTwo.map((s) => s.caseId)).toEqual(["c3", "c4"]);
  });

  it("clear resets all buckets", () => {
    store.record(snap());
    store.record(snap({ tenantId: "other" }));
    store.clear();
    expect(store.totalSize()).toBe(0);
  });

  it("silently drops snapshots without a tenantId", () => {
    store.record({ ...snap(), tenantId: "" });
    expect(store.totalSize()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// snapshotFromDecision
// ---------------------------------------------------------------------------

describe("snapshotFromDecision", () => {
  it("produces a minimal snapshot from a plain decision", () => {
    const s = snapshotFromDecision(fakeDecision());
    expect(s.caseId).toBe("tenantA:entity-X:1");
    expect(s.tenantId).toBe("tenantA");
    expect(s.openedAt).toBe("2026-04-14T12:00:00.000Z");
    expect(s.entityRef).toBe("entity-X");
    expect(s.wallets).toBeUndefined();
  });

  it("carries optional extras through", () => {
    const s = snapshotFromDecision(fakeDecision(), {
      wallets: ["0xabc"],
      uboRefs: ["ubo-42"],
      addressHash: "addr-hash",
      corridorCountry: "KP",
      maxTxAED: 50_000,
      narrativeHash: "nh",
      sanctionsMatchKeys: ["k"],
    });
    expect(s.wallets).toEqual(["0xabc"]);
    expect(s.uboRefs).toEqual(["ubo-42"]);
    expect(s.addressHash).toBe("addr-hash");
    expect(s.corridorCountry).toBe("KP");
    expect(s.maxTxAED).toBe(50_000);
    expect(s.narrativeHash).toBe("nh");
    expect(s.sanctionsMatchKeys).toEqual(["k"]);
  });

  it("never copies an entity legal name field into the snapshot", () => {
    // There is no entity-name field on CaseSnapshot by design — the
    // keys available are entityRef, uboRefs, wallets, addressHash,
    // corridorCountry, maxTxAED, narrativeHash, sanctionsMatchKeys.
    // Assert the shape is opaque-ref-only.
    const s = snapshotFromDecision(fakeDecision());
    expect(s).not.toHaveProperty("entityName");
    expect(s).not.toHaveProperty("name");
  });
});

// ---------------------------------------------------------------------------
// correlateWithMemory + recordAndCorrelate
// ---------------------------------------------------------------------------

describe("correlateWithMemory + recordAndCorrelate", () => {
  let store: InMemoryBrainMemoryStore;

  beforeEach(() => {
    store = new InMemoryBrainMemoryStore();
  });

  it("returns an empty correlation report when memory is empty", () => {
    const report = correlateWithMemory("tenantA", store);
    expect(report.caseCount).toBe(0);
    expect(report.correlations).toHaveLength(0);
  });

  it("recordAndCorrelate records AND includes the new case in the report", () => {
    // Pre-seed one wallet-sharing case.
    store.record(
      snap({
        caseId: "prior-1",
        tenantId: "tenantA",
        wallets: ["0xdead"],
      })
    );

    // Now decide a new case that SHARES the wallet. The decision
    // itself doesn't carry wallet data (the production caller would
    // pass it via memoryExtras), so we pass wallets via extras.
    const { snapshot, correlation } = recordAndCorrelate(
      fakeDecision(),
      { wallets: ["0xdead"] },
      store
    );
    expect(snapshot.wallets).toEqual(["0xdead"]);
    expect(correlation.caseCount).toBe(2);
    const walletReuse = correlation.correlations.find(
      (c) => c.kind === "wallet-reuse"
    );
    expect(walletReuse).toBeDefined();
    expect(walletReuse!.caseIds).toContain(snapshot.caseId);
    expect(walletReuse!.caseIds).toContain("prior-1");
  });

  it("preserves tenant isolation across decisions", () => {
    store.record(snap({ tenantId: "other", wallets: ["0xsame"] }));
    const { correlation } = recordAndCorrelate(
      fakeDecision(),
      { wallets: ["0xsame"] },
      store
    );
    // tenantA cannot see tenant 'other' — wallet collision must not
    // produce a cross-tenant finding.
    expect(correlation.correlations.some((c) => c.kind === "wallet-reuse")).toBe(
      false
    );
  });
});
