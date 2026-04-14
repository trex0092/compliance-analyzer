/**
 * Brain permanent memory digest tests.
 */
import { describe, it, expect } from "vitest";
import {
  emptyDigest,
  updateDigest,
  retrievePrecedents,
  featuresToVector,
  cosineSimilarity,
  __test__,
  type BrainMemoryDigest,
  type DigestUpdateInput,
} from "../src/services/brainMemoryDigest";
import type { ComplianceDecision } from "../src/services/complianceDecisionEngine";
import type { StrFeatures } from "../src/services/predictiveStr";

const { severityFromVerdict, priorityScore, DEFAULT_MAX_ENTRIES } = __test__;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
    id: `t1:ent1:${Date.now()}`,
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

function input(
  overrides: Partial<DigestUpdateInput> = {}
): DigestUpdateInput {
  return {
    tenantId: "t1",
    decision: fakeDecision(),
    features: f(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe("severityFromVerdict", () => {
  it("maps every verdict", () => {
    expect(severityFromVerdict("freeze")).toBe("critical");
    expect(severityFromVerdict("escalate")).toBe("high");
    expect(severityFromVerdict("flag")).toBe("medium");
    expect(severityFromVerdict("pass")).toBe("info");
  });
});

describe("priorityScore", () => {
  it("higher severity gives higher score at the same age", () => {
    const now = new Date("2026-04-14T12:00:00.000Z");
    const critical = priorityScore("critical", now.toISOString(), now, 30);
    const high = priorityScore("high", now.toISOString(), now, 30);
    expect(critical).toBeGreaterThan(high);
  });

  it("older entries decay toward zero", () => {
    const now = new Date("2026-04-14T12:00:00.000Z");
    const fresh = priorityScore("critical", now.toISOString(), now, 30);
    const old = priorityScore(
      "critical",
      "2025-04-14T12:00:00.000Z",
      now,
      30
    );
    expect(old).toBeLessThan(fresh);
    expect(old).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// featuresToVector + cosineSimilarity
// ---------------------------------------------------------------------------

describe("featuresToVector", () => {
  it("produces a 10-dimensional vector in [0, 1]", () => {
    const vec = featuresToVector(f());
    expect(vec).toHaveLength(10);
    for (const v of vec) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("clamps extreme inputs", () => {
    const vec = featuresToVector(
      f({
        priorAlerts90d: 1000,
        txValue30dAED: 1e12,
        nearThresholdCount30d: 500,
        crossBorderRatio30d: 2,
        sanctionsMatchScore: -5,
        cashRatio30d: 10,
      })
    );
    for (const v of vec) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("boolean fields project to 0/1", () => {
    const vec = featuresToVector(
      f({ isPep: true, highRiskJurisdiction: true, hasAdverseMedia: true })
    );
    expect(vec[4]).toBe(1); // isPep
    expect(vec[5]).toBe(1); // highRiskJurisdiction
    expect(vec[6]).toBe(1); // hasAdverseMedia
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = [0.3, 0.7, 0.1, 0.5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
  });

  it("returns 0 when either vector is all zero", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("returns 0 for different-length vectors", () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// updateDigest
// ---------------------------------------------------------------------------

describe("updateDigest", () => {
  it("returns a new digest and never mutates the input", () => {
    const d = emptyDigest("t1");
    const next = updateDigest(d, input());
    expect(next).not.toBe(d);
    expect(d.entries).toHaveLength(0);
    expect(next.entries).toHaveLength(1);
  });

  it("silently drops cross-tenant updates", () => {
    const d = emptyDigest("t1");
    const next = updateDigest(d, input({ tenantId: "other" }));
    expect(next).toBe(d);
  });

  it("dedupes on caseId — replay replaces the entry", () => {
    let d = emptyDigest("t1");
    const id = "t1:ent1:100";
    d = updateDigest(
      d,
      input({
        decision: fakeDecision({ id, confidence: 0.5 }),
      })
    );
    d = updateDigest(
      d,
      input({
        decision: fakeDecision({ id, confidence: 0.95 }),
      })
    );
    expect(d.entries).toHaveLength(1);
    expect(d.entries[0].confidence).toBe(0.95);
    // totalUpdates tracks RAW update count (not unique), per spec.
    expect(d.totalUpdates).toBe(2);
  });

  it("caps the digest at maxEntries", () => {
    let d = emptyDigest("t1");
    for (let i = 0; i < 30; i++) {
      d = updateDigest(
        d,
        input({
          decision: fakeDecision({ id: `t1:ent:${i}` }),
        }),
        { maxEntries: 5 }
      );
    }
    expect(d.entries).toHaveLength(5);
  });

  it("sorts by priorityScore descending (severity weight wins)", () => {
    let d = emptyDigest("t1");
    d = updateDigest(
      d,
      input({
        decision: fakeDecision({ id: "t1:e:1", verdict: "flag" }),
      })
    );
    d = updateDigest(
      d,
      input({
        decision: fakeDecision({ id: "t1:e:2", verdict: "freeze" }),
      })
    );
    expect(d.entries[0].severity).toBe("critical");
    expect(d.entries[1].severity).toBe("medium");
  });

  it("freezes the returned entries (immutability)", () => {
    const d = updateDigest(emptyDigest("t1"), input());
    expect(Object.isFrozen(d.entries)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// retrievePrecedents
// ---------------------------------------------------------------------------

describe("retrievePrecedents", () => {
  function digestWith(
    cases: Array<{ id: string; verdict: ComplianceDecision["verdict"]; features: StrFeatures; at?: string }>
  ): BrainMemoryDigest {
    let d = emptyDigest("t1");
    for (const c of cases) {
      d = updateDigest(
        d,
        input({
          decision: fakeDecision({
            id: c.id,
            verdict: c.verdict,
            at: c.at ?? "2026-04-14T12:00:00.000Z",
          }),
          features: c.features,
        })
      );
    }
    return d;
  }

  it("returns zero matches for an empty digest", () => {
    const result = retrievePrecedents(emptyDigest("t1"), {
      caseId: "new",
      features: f(),
    });
    expect(result.matches).toHaveLength(0);
    expect(result.hasCriticalPrecedent).toBe(false);
    expect(result.summary).toMatch(/No historical precedents/);
  });

  it("returns the most similar prior case", () => {
    const d = digestWith([
      {
        id: "t1:similar:1",
        verdict: "freeze",
        features: f({ sanctionsMatchScore: 0.95, isPep: true }),
      },
      {
        id: "t1:different:2",
        verdict: "pass",
        features: f(),
      },
    ]);
    const result = retrievePrecedents(d, {
      caseId: "t1:new:1",
      features: f({ sanctionsMatchScore: 0.9, isPep: true }),
      minSimilarity: 0.1,
    });
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].entry.caseId).toBe("t1:similar:1");
    expect(result.hasCriticalPrecedent).toBe(true);
  });

  it("never returns the query case as its own precedent", () => {
    const d = digestWith([
      {
        id: "t1:dup:1",
        verdict: "flag",
        features: f({ isPep: true }),
      },
    ]);
    const result = retrievePrecedents(d, {
      caseId: "t1:dup:1",
      features: f({ isPep: true }),
      minSimilarity: 0.1,
    });
    expect(result.matches).toHaveLength(0);
  });

  it("honours topK", () => {
    const d = digestWith([
      { id: "t1:a", verdict: "freeze", features: f({ isPep: true }) },
      { id: "t1:b", verdict: "escalate", features: f({ isPep: true }) },
      { id: "t1:c", verdict: "flag", features: f({ isPep: true }) },
      { id: "t1:d", verdict: "flag", features: f({ isPep: true }) },
    ]);
    const result = retrievePrecedents(d, {
      caseId: "t1:new",
      features: f({ isPep: true }),
      topK: 2,
      minSimilarity: 0.1,
    });
    expect(result.matches).toHaveLength(2);
  });

  it("respects minSimilarity threshold", () => {
    const d = digestWith([
      {
        id: "t1:orthogonal",
        verdict: "flag",
        features: f({ crossBorderRatio30d: 1 }),
      },
    ]);
    const result = retrievePrecedents(d, {
      caseId: "t1:new",
      features: f({ isPep: true }), // different axis
      minSimilarity: 0.99,
    });
    expect(result.matches).toHaveLength(0);
  });

  it("sets hasCriticalPrecedent only when a matched entry was critical", () => {
    const d = digestWith([
      { id: "t1:c1", verdict: "flag", features: f({ isPep: true }) },
    ]);
    const result = retrievePrecedents(d, {
      caseId: "t1:new",
      features: f({ isPep: true }),
      minSimilarity: 0.1,
    });
    expect(result.hasCriticalPrecedent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation + defaults
// ---------------------------------------------------------------------------

describe("BrainMemoryDigest defaults", () => {
  it("DEFAULT_MAX_ENTRIES is 20", () => {
    expect(DEFAULT_MAX_ENTRIES).toBe(20);
  });
});
