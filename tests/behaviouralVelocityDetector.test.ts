/**
 * Behavioural velocity detector tests.
 */
import { describe, it, expect } from "vitest";
import {
  analyseBehaviouralVelocity,
  __test__,
} from "../src/services/behaviouralVelocityDetector";
import type { CaseSnapshot } from "../src/services/crossCasePatternCorrelator";

const { asiaDubaiHour, asiaDubaiDayOfWeek, clamp01, severityOf } = __test__;

function snap(overrides: Partial<CaseSnapshot> = {}): CaseSnapshot {
  return {
    caseId: Math.random().toString(36).slice(2, 10),
    tenantId: "t1",
    openedAt: "2026-04-14T12:00:00.000Z",
    entityRef: "e1",
    ...overrides,
  };
}

describe("asiaDubaiHour", () => {
  it("converts UTC noon to 16:00 Asia/Dubai", () => {
    expect(asiaDubaiHour("2026-04-14T12:00:00.000Z")).toBe(16);
  });
  it("converts UTC 20:00 to 00:00 Asia/Dubai next day", () => {
    expect(asiaDubaiHour("2026-04-14T20:00:00.000Z")).toBe(0);
  });
  it("returns null for invalid input", () => {
    expect(asiaDubaiHour("not a date")).toBeNull();
  });
});

describe("asiaDubaiDayOfWeek", () => {
  it("returns 0-6 for valid dates", () => {
    const d = asiaDubaiDayOfWeek("2026-04-14T12:00:00.000Z");
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(6);
  });
  it("returns null for invalid input", () => {
    expect(asiaDubaiDayOfWeek("bad")).toBeNull();
  });
});

describe("clamp01 / severityOf", () => {
  it("clamps to [0,1]", () => {
    expect(clamp01(-5)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(42)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });
  it("maps score → severity band", () => {
    expect(severityOf(0.1)).toBe("info");
    expect(severityOf(0.3)).toBe("low");
    expect(severityOf(0.55)).toBe("medium");
    expect(severityOf(0.75)).toBe("high");
    expect(severityOf(0.9)).toBe("critical");
  });
});

describe("analyseBehaviouralVelocity — guard", () => {
  it("returns info severity when below minCases", () => {
    const r = analyseBehaviouralVelocity("t1", [snap(), snap()]);
    expect(r.severity).toBe("info");
    expect(r.compositeScore).toBe(0);
    expect(r.summary).toMatch(/insufficient history/);
  });

  it("isolates tenants", () => {
    const cases: CaseSnapshot[] = [
      snap({ tenantId: "t1" }),
      snap({ tenantId: "t2" }),
      snap({ tenantId: "t2" }),
      snap({ tenantId: "t2" }),
    ];
    const r = analyseBehaviouralVelocity("t1", cases);
    expect(r.caseCount).toBe(1); // only the one t1 case in scope
  });
});

describe("analyseBehaviouralVelocity — burst detection", () => {
  it("fires burst when mean interval is below threshold", () => {
    // 4 cases spaced 30 minutes apart: mean interval = 0.5h << 4h threshold.
    const start = Date.parse("2026-04-14T12:00:00.000Z");
    const cases: CaseSnapshot[] = Array.from({ length: 4 }, (_, i) =>
      snap({
        caseId: `c${i}`,
        openedAt: new Date(start + i * 30 * 60_000).toISOString(),
      })
    );
    const r = analyseBehaviouralVelocity("t1", cases);
    expect(r.burst.score).toBeGreaterThan(0.5);
    expect(r.compositeScore).toBeGreaterThan(0.5);
    expect(r.severity).not.toBe("info");
    expect(r.burst.data.meanIntervalHours).toBeCloseTo(0.5, 1);
  });

  it("does not fire burst when intervals are wide", () => {
    // 3 cases 24h apart.
    const start = Date.parse("2026-04-01T12:00:00.000Z");
    const cases: CaseSnapshot[] = Array.from({ length: 3 }, (_, i) =>
      snap({
        caseId: `c${i}`,
        openedAt: new Date(start + i * 24 * 3_600_000).toISOString(),
      })
    );
    const r = analyseBehaviouralVelocity("t1", cases);
    expect(r.burst.score).toBe(0);
  });
});

describe("analyseBehaviouralVelocity — off-hours", () => {
  it("fires off-hours when all cases open at 03:00 Asia/Dubai", () => {
    // UTC 23:00 = 03:00 Asia/Dubai next day.
    const cases: CaseSnapshot[] = Array.from({ length: 5 }, (_, i) =>
      snap({
        caseId: `c${i}`,
        openedAt: `2026-04-${String(10 + i).padStart(2, "0")}T23:00:00.000Z`,
      })
    );
    const r = analyseBehaviouralVelocity("t1", cases);
    expect(r.offHours.score).toBeGreaterThan(0.9);
    expect(r.offHours.data.fraction).toBe(1);
  });

  it("does not fire off-hours when all cases open at 11:00 Asia/Dubai", () => {
    // UTC 07:00 = 11:00 Asia/Dubai.
    const cases: CaseSnapshot[] = Array.from({ length: 5 }, (_, i) =>
      snap({
        caseId: `c${i}`,
        openedAt: `2026-04-${String(10 + i).padStart(2, "0")}T07:00:00.000Z`,
      })
    );
    const r = analyseBehaviouralVelocity("t1", cases);
    expect(r.offHours.score).toBe(0);
  });
});

describe("analyseBehaviouralVelocity — weekend", () => {
  it("detects high weekend concentration", () => {
    // 2026-04-17 is a Friday; 2026-04-18 is a Saturday.
    const cases: CaseSnapshot[] = [
      snap({ caseId: "f1", openedAt: "2026-04-17T12:00:00.000Z" }),
      snap({ caseId: "f2", openedAt: "2026-04-17T14:00:00.000Z" }),
      snap({ caseId: "f3", openedAt: "2026-04-18T10:00:00.000Z" }),
      snap({ caseId: "f4", openedAt: "2026-04-18T11:00:00.000Z" }),
    ];
    const r = analyseBehaviouralVelocity("t1", cases, {
      burstThresholdHours: 0.5, // disable burst so weekend dominates
    });
    expect(r.weekend.score).toBeGreaterThan(0.5);
    expect(r.weekend.data.weekend).toBe(4);
  });
});

describe("analyseBehaviouralVelocity — composite + regulatory", () => {
  it("carries a regulatory citation and deterministic summary", () => {
    const cases: CaseSnapshot[] = Array.from({ length: 4 }, (_, i) =>
      snap({
        caseId: `c${i}`,
        openedAt: `2026-04-${String(10 + i).padStart(2, "0")}T11:00:00.000Z`,
      })
    );
    const r = analyseBehaviouralVelocity("t1", cases);
    expect(r.regulatory).toMatch(/FATF Rec 20/);
    expect(r.regulatory).toMatch(/MoE Circular 08\/AML\/2021/);
    expect(r.summary).toBeDefined();
  });
});
