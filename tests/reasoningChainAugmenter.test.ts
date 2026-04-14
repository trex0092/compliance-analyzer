/**
 * Reasoning chain augmenter tests.
 */
import { describe, it, expect } from "vitest";
import {
  augmentChainWithPrecedents,
  __test__,
} from "../src/services/reasoningChainAugmenter";
import {
  createChain,
  addNode,
  addEdge,
  seal,
  type ReasoningChain,
} from "../src/services/reasoningChain";
import type {
  PrecedentReport,
  BrainMemoryDigestEntry,
} from "../src/services/brainMemoryDigest";
import type { StrFeatures } from "../src/services/predictiveStr";

const { cloneUnsealed, chooseRootId, precedentNodeId } = __test__;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function f(): StrFeatures {
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
  };
}

function sealedMegaLikeChain(): ReasoningChain {
  const chain = createChain("unit-test");
  addNode(chain, {
    id: "root",
    type: "event",
    label: "root event",
    weight: 1,
    regulatory: "FDL Art.19-20",
  });
  addNode(chain, {
    id: "str-predict",
    type: "hypothesis",
    label: "STR prediction",
    weight: 0.4,
    regulatory: "FDL Art.26-27",
  });
  addEdge(chain, {
    fromId: "root",
    toId: "str-predict",
    relation: "implies",
    weight: 0.8,
  });
  seal(chain);
  return chain;
}

function precedentEntry(
  overrides: Partial<BrainMemoryDigestEntry> = {}
): BrainMemoryDigestEntry {
  return {
    caseId: "t1:ent:1",
    at: "2026-04-01T00:00:00.000Z",
    verdict: "freeze",
    confidence: 0.95,
    severity: "critical",
    entityRef: "ent",
    topTypologyId: "SANCTIONS-001",
    powerScore: 88,
    requiresHumanReview: true,
    features: f(),
    priorityScore: 40,
    ...overrides,
  };
}

function precedentReport(
  matches: Array<{ entry: BrainMemoryDigestEntry; similarity: number }>
): PrecedentReport {
  return {
    tenantId: "t1",
    hasCriticalPrecedent: matches.some((m) => m.entry.severity === "critical"),
    summary: "",
    matches: matches.map((m) => ({
      entry: m.entry,
      similarity: m.similarity,
      narrative: `similar ${m.similarity}`,
    })),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

describe("cloneUnsealed", () => {
  it("produces a mutable copy with the same nodes + edges", () => {
    const original = sealedMegaLikeChain();
    const clone = cloneUnsealed(original);
    expect(clone.sealed).toBe(false);
    expect(clone.nodes.length).toBe(original.nodes.length);
    expect(clone.edges.length).toBe(original.edges.length);
    // Node ids match.
    expect(clone.nodes.map((n) => n.id).sort()).toEqual(
      original.nodes.map((n) => n.id).sort()
    );
  });
});

describe("chooseRootId", () => {
  it("prefers the canonical 'root' node", () => {
    const chain = sealedMegaLikeChain();
    expect(chooseRootId(chain)).toBe("root");
  });
  it("falls back to the first node when no canonical root exists", () => {
    const chain = createChain("t");
    addNode(chain, {
      id: "alpha",
      type: "event",
      label: "alpha",
      weight: 1,
    });
    expect(chooseRootId(chain)).toBe("alpha");
  });
  it("returns null for an empty chain", () => {
    const chain = createChain("t");
    expect(chooseRootId(chain)).toBeNull();
  });
});

describe("precedentNodeId", () => {
  it("prefixes with 'precedent-' and collapses unsafe characters", () => {
    expect(precedentNodeId("t1:ent:42")).toBe("precedent-t1_ent_42");
    // "../../etc" is 9 chars; 6 non-safe (. and /) become underscores.
    expect(precedentNodeId("../../etc")).toBe("precedent-______etc");
  });
});

// ---------------------------------------------------------------------------
// augmentChainWithPrecedents
// ---------------------------------------------------------------------------

describe("augmentChainWithPrecedents — no-op paths", () => {
  it("returns the original unchanged when the report has no matches", () => {
    const original = sealedMegaLikeChain();
    const result = augmentChainWithPrecedents(original, precedentReport([]));
    expect(result.augmentedChain).toBe(original);
    expect(result.precedentsAdded).toBe(0);
    expect(result.unchanged).toBe(true);
  });

  it("returns the original unchanged for an empty chain", () => {
    const empty = createChain("empty");
    const report = precedentReport([
      { entry: precedentEntry(), similarity: 0.9 },
    ]);
    const result = augmentChainWithPrecedents(empty, report);
    expect(result.augmentedChain).toBe(empty);
    expect(result.unchanged).toBe(true);
  });

  it("filters out matches below minSimilarity", () => {
    const original = sealedMegaLikeChain();
    const report = precedentReport([
      { entry: precedentEntry({ caseId: "a" }), similarity: 0.3 },
      { entry: precedentEntry({ caseId: "b" }), similarity: 0.4 },
    ]);
    const result = augmentChainWithPrecedents(original, report, {
      minSimilarity: 0.5,
    });
    expect(result.precedentsAdded).toBe(0);
    expect(result.unchanged).toBe(true);
  });
});

describe("augmentChainWithPrecedents — happy path", () => {
  it("adds one node + one edge per precedent above threshold", () => {
    const original = sealedMegaLikeChain();
    const report = precedentReport([
      { entry: precedentEntry({ caseId: "case-a" }), similarity: 0.9 },
      { entry: precedentEntry({ caseId: "case-b" }), similarity: 0.7 },
    ]);
    const result = augmentChainWithPrecedents(original, report);
    expect(result.precedentsAdded).toBe(2);
    expect(result.unchanged).toBe(false);
    expect(result.augmentedChain).not.toBe(original);
    expect(result.augmentedChain.sealed).toBe(true);
    expect(result.augmentedChain.nodes.length).toBe(
      original.nodes.length + 2
    );
    expect(result.augmentedChain.edges.length).toBe(
      original.edges.length + 2
    );
  });

  it("does NOT mutate the original chain", () => {
    const original = sealedMegaLikeChain();
    const originalNodeCount = original.nodes.length;
    const originalEdgeCount = original.edges.length;
    augmentChainWithPrecedents(
      original,
      precedentReport([
        { entry: precedentEntry({ caseId: "case-x" }), similarity: 0.9 },
      ])
    );
    expect(original.nodes.length).toBe(originalNodeCount);
    expect(original.edges.length).toBe(originalEdgeCount);
    expect(original.sealed).toBe(true);
  });

  it("caps precedents at maxPrecedents", () => {
    const original = sealedMegaLikeChain();
    const report = precedentReport(
      Array.from({ length: 10 }, (_, i) => ({
        entry: precedentEntry({ caseId: `c${i}` }),
        similarity: 0.9,
      }))
    );
    const result = augmentChainWithPrecedents(original, report, {
      maxPrecedents: 3,
    });
    expect(result.precedentsAdded).toBe(3);
  });

  it("new precedent nodes carry the similarity as weight", () => {
    const original = sealedMegaLikeChain();
    const report = precedentReport([
      { entry: precedentEntry({ caseId: "case-weight" }), similarity: 0.77 },
    ]);
    const result = augmentChainWithPrecedents(original, report);
    const node = result.augmentedChain.nodes.find(
      (n) => n.id === "precedent-case-weight"
    );
    expect(node).toBeDefined();
    expect(node!.weight).toBe(0.77);
    expect(node!.type).toBe("evidence");
    expect(node!.regulatory).toMatch(/FDL No\.10\/2025 Art\.?20-21/);
  });

  it("new edges attach to the canonical root with the similarity narrative", () => {
    const original = sealedMegaLikeChain();
    const report = precedentReport([
      { entry: precedentEntry({ caseId: "case-edge" }), similarity: 0.85 },
    ]);
    const result = augmentChainWithPrecedents(original, report);
    const edge = result.augmentedChain.edges.find(
      (e) => e.toId === "precedent-case-edge"
    );
    expect(edge).toBeDefined();
    expect(edge!.fromId).toBe("root");
    expect(edge!.relation).toBe("supports");
    expect(edge!.rationale).toMatch(/similar/);
  });

  it("never adds the same precedent twice on replay", () => {
    const original = sealedMegaLikeChain();
    const report = precedentReport([
      { entry: precedentEntry({ caseId: "dup" }), similarity: 0.9 },
    ]);
    const first = augmentChainWithPrecedents(original, report);
    // Feed the augmented chain back as the input — the precedent
    // node already exists under a stable id, so a second pass
    // should add zero new nodes.
    const second = augmentChainWithPrecedents(
      first.augmentedChain,
      report
    );
    expect(second.precedentsAdded).toBe(0);
  });
});

describe("augmentChainWithPrecedents — failure tolerance", () => {
  it("never throws even on a malformed report", () => {
    const original = sealedMegaLikeChain();
    // Coerce a bogus report through the type system.
    const malformed = {
      tenantId: "t1",
      hasCriticalPrecedent: false,
      summary: "",
      matches: [
        {
          entry: null,
          similarity: 0.9,
          narrative: "",
        },
      ],
    } as unknown as PrecedentReport;
    expect(() =>
      augmentChainWithPrecedents(original, malformed)
    ).not.toThrow();
  });
});
