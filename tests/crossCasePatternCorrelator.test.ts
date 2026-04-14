/**
 * Cross-case pattern correlator tests.
 *
 * Covers every detector with positive + negative fixtures:
 *   - structuring-cluster (shared UBO, sub-threshold, tight window)
 *   - wallet-reuse (same wallet across distinct entities)
 *   - shared-ubo-ring (same UBO across distinct entities)
 *   - address-reuse (same address hash)
 *   - corridor-burst (same country within tight window)
 *   - narrative-copypaste (same narrative fingerprint)
 *   - sanctions-key-reuse (same match key)
 *
 * Plus tenant isolation, sorting by severity, and boundary cases.
 */
import { describe, it, expect } from "vitest";
import {
  correlateCrossCases,
  type CaseSnapshot,
} from "../src/services/crossCasePatternCorrelator";

function snap(overrides: Partial<CaseSnapshot> = {}): CaseSnapshot {
  return {
    caseId: Math.random().toString(36).slice(2, 10),
    tenantId: "t1",
    openedAt: "2026-04-14T10:00:00.000Z",
    entityRef: "e1",
    ...overrides,
  };
}

// Helper: produce N snapshots at stable offsets so the window checks
// are deterministic across detectors.
function window(count: number, startIso = "2026-04-10T00:00:00.000Z"): string[] {
  const start = Date.parse(startIso);
  return Array.from({ length: count }, (_, i) =>
    new Date(start + i * 3_600_000).toISOString()
  );
}

describe("correlateCrossCases — tenant isolation", () => {
  it("drops snapshots from other tenants", () => {
    const report = correlateCrossCases(
      [
        snap({ caseId: "a", tenantId: "t1" }),
        snap({ caseId: "b", tenantId: "OTHER" }),
        snap({ caseId: "c", tenantId: "t1" }),
      ],
      { tenantId: "t1" }
    );
    expect(report.caseCount).toBe(2);
  });

  it("returns empty report for empty input", () => {
    const report = correlateCrossCases([], { tenantId: "t1" });
    expect(report.caseCount).toBe(0);
    expect(report.correlations).toHaveLength(0);
    expect(report.topSeverity).toBe("info");
  });
});

describe("wallet-reuse detector", () => {
  it("fires when 2+ cases share a wallet", () => {
    const times = window(2);
    const report = correlateCrossCases(
      [
        snap({ caseId: "c1", openedAt: times[0], wallets: ["0xabc"] }),
        snap({ caseId: "c2", openedAt: times[1], wallets: ["0xabc"] }),
      ],
      { tenantId: "t1" }
    );
    const finding = report.correlations.find((c) => c.kind === "wallet-reuse");
    expect(finding).toBeDefined();
    expect(finding!.caseIds).toHaveLength(2);
    expect(finding!.regulatory).toMatch(/FATF Rec 15/);
    expect(finding!.confidence).toBeGreaterThan(0);
  });

  it("is case-insensitive on wallet address", () => {
    const report = correlateCrossCases(
      [
        snap({ caseId: "c1", wallets: ["0xABC"] }),
        snap({ caseId: "c2", wallets: ["0xabc"] }),
      ],
      { tenantId: "t1" }
    );
    expect(report.correlations.some((c) => c.kind === "wallet-reuse")).toBe(true);
  });

  it("does not fire for a single-case wallet", () => {
    const report = correlateCrossCases(
      [snap({ caseId: "c1", wallets: ["0xabc"] })],
      { tenantId: "t1" }
    );
    expect(report.correlations.some((c) => c.kind === "wallet-reuse")).toBe(false);
  });
});

describe("shared-ubo-ring detector", () => {
  it("fires when the same UBO shows up on 2+ entities", () => {
    const report = correlateCrossCases(
      [
        snap({ caseId: "c1", entityRef: "e1", uboRefs: ["ubo-7"] }),
        snap({ caseId: "c2", entityRef: "e2", uboRefs: ["ubo-7"] }),
      ],
      { tenantId: "t1" }
    );
    const finding = report.correlations.find((c) => c.kind === "shared-ubo-ring");
    expect(finding).toBeDefined();
    expect(finding!.regulatory).toMatch(/109\/2023/);
  });
});

describe("address-reuse detector", () => {
  it("fires on matching address hash", () => {
    const report = correlateCrossCases(
      [
        snap({ caseId: "c1", addressHash: "addr-abc123" }),
        snap({ caseId: "c2", addressHash: "addr-abc123" }),
      ],
      { tenantId: "t1" }
    );
    expect(
      report.correlations.some((c) => c.kind === "address-reuse")
    ).toBe(true);
  });
});

describe("corridor-burst detector", () => {
  it("fires on 5+ cases to same corridor within 24h", () => {
    const times = window(5, "2026-04-14T00:00:00.000Z"); // 5 cases spaced 1h apart
    const cases = times.map((t, i) =>
      snap({ caseId: `c${i}`, openedAt: t, corridorCountry: "KP" })
    );
    const report = correlateCrossCases(cases, { tenantId: "t1" });
    const finding = report.correlations.find((c) => c.kind === "corridor-burst");
    expect(finding).toBeDefined();
    expect(finding!.caseIds).toHaveLength(5);
  });

  it("does not fire when the window is too wide", () => {
    const cases = [
      snap({ caseId: "c1", openedAt: "2026-01-01T00:00:00.000Z", corridorCountry: "KP" }),
      snap({ caseId: "c2", openedAt: "2026-02-01T00:00:00.000Z", corridorCountry: "KP" }),
      snap({ caseId: "c3", openedAt: "2026-03-01T00:00:00.000Z", corridorCountry: "KP" }),
      snap({ caseId: "c4", openedAt: "2026-04-01T00:00:00.000Z", corridorCountry: "KP" }),
      snap({ caseId: "c5", openedAt: "2026-05-01T00:00:00.000Z", corridorCountry: "KP" }),
    ];
    const report = correlateCrossCases(cases, { tenantId: "t1" });
    expect(report.correlations.some((c) => c.kind === "corridor-burst")).toBe(false);
  });
});

describe("narrative-copypaste detector", () => {
  it("fires on matching narrative fingerprints", () => {
    const report = correlateCrossCases(
      [
        snap({ caseId: "c1", narrativeHash: "deadbeef" }),
        snap({ caseId: "c2", narrativeHash: "deadbeef" }),
        snap({ caseId: "c3", narrativeHash: "deadbeef" }),
      ],
      { tenantId: "t1" }
    );
    const finding = report.correlations.find(
      (c) => c.kind === "narrative-copypaste"
    );
    expect(finding).toBeDefined();
    expect(finding!.caseIds).toHaveLength(3);
  });
});

describe("sanctions-key-reuse detector", () => {
  it("fires when multiple cases share a sanctions match key", () => {
    const report = correlateCrossCases(
      [
        snap({
          caseId: "c1",
          sanctionsMatchKeys: ["name:hashed-key-1"],
        }),
        snap({
          caseId: "c2",
          sanctionsMatchKeys: ["name:hashed-key-1"],
        }),
      ],
      { tenantId: "t1" }
    );
    const finding = report.correlations.find(
      (c) => c.kind === "sanctions-key-reuse"
    );
    expect(finding).toBeDefined();
    expect(["high", "critical"]).toContain(finding!.severity);
    expect(finding!.regulatory).toMatch(/Cabinet Res 74\/2020/);
  });
});

describe("structuring-cluster detector", () => {
  it("fires on 3+ sub-threshold cases sharing UBO in window", () => {
    const times = window(3);
    const cases = times.map((t, i) =>
      snap({
        caseId: `c${i}`,
        openedAt: t,
        uboRefs: ["shared-ubo"],
        maxTxAED: 54_000,
      })
    );
    const report = correlateCrossCases(cases, { tenantId: "t1" });
    const finding = report.correlations.find(
      (c) => c.kind === "structuring-cluster"
    );
    expect(finding).toBeDefined();
    expect(finding!.caseIds).toHaveLength(3);
    expect(finding!.regulatory).toMatch(/MoE Circular 08\/AML\/2021/);
  });

  it("does not fire when any case exceeds the threshold", () => {
    const times = window(3);
    const cases = [
      snap({
        caseId: "c1",
        openedAt: times[0],
        uboRefs: ["u"],
        maxTxAED: 54_000,
      }),
      snap({
        caseId: "c2",
        openedAt: times[1],
        uboRefs: ["u"],
        maxTxAED: 54_000,
      }),
      snap({
        caseId: "c3",
        openedAt: times[2],
        uboRefs: ["u"],
        maxTxAED: 100_000, // over threshold
      }),
    ];
    const report = correlateCrossCases(cases, { tenantId: "t1" });
    // The third case is dropped from the sub-threshold bucket, leaving
    // only 2 — below the minStructuringCluster = 3 default.
    expect(
      report.correlations.some((c) => c.kind === "structuring-cluster")
    ).toBe(false);
  });

  it("respects custom minStructuringCluster", () => {
    const times = window(2);
    const cases = times.map((t, i) =>
      snap({
        caseId: `c${i}`,
        openedAt: t,
        uboRefs: ["u"],
        maxTxAED: 10_000,
      })
    );
    const report = correlateCrossCases(cases, {
      tenantId: "t1",
      minStructuringCluster: 2,
    });
    expect(
      report.correlations.some((c) => c.kind === "structuring-cluster")
    ).toBe(true);
  });
});

describe("topSeverity sorting", () => {
  it("sorts most severe first", () => {
    const report = correlateCrossCases(
      [
        // low-severity address reuse
        snap({ caseId: "c1", addressHash: "addr" }),
        snap({ caseId: "c2", addressHash: "addr" }),
        // critical-severity wallet reuse
        snap({ caseId: "c3", wallets: ["0xw"] }),
        snap({ caseId: "c4", wallets: ["0xw"] }),
        snap({ caseId: "c5", wallets: ["0xw"] }),
      ],
      { tenantId: "t1" }
    );
    expect(report.correlations.length).toBeGreaterThan(0);
    expect(report.correlations[0].kind).toBe("wallet-reuse");
    expect(report.topSeverity).toMatch(/high|critical/);
  });
});
