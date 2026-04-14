/**
 * Cache integration tests for runSuperDecision.
 *
 * Verifies the fingerprint cache short-circuit + cache-miss
 * fallthrough + tenant isolation inside the real super runner
 * pipeline (with the weaponized brain mocked so tests run fast).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockBrainReturn = vi.hoisted(() => ({
  current: null as unknown,
  callCount: 0,
}));

vi.mock("../src/services/weaponizedBrain", () => ({
  runWeaponizedBrain: vi.fn(async () => {
    mockBrainReturn.callCount += 1;
    if (mockBrainReturn.current instanceof Error) throw mockBrainReturn.current;
    return mockBrainReturn.current;
  }),
}));

import { runSuperDecision } from "../src/services/brainSuperRunner";
import { DecisionFingerprintCache } from "../src/services/decisionFingerprintCache";
import { AsanaOrchestrator } from "../src/services/asana/orchestrator";
import type { ComplianceCaseInput } from "../src/services/complianceDecisionEngine";
import type { WeaponizedBrainResponse } from "../src/services/weaponizedBrain";
import type { StrFeatures } from "../src/services/predictiveStr";
import type { SuperDecision } from "../src/services/brainSuperRunner";

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

function makeInput(overrides: Partial<ComplianceCaseInput> = {}): ComplianceCaseInput {
  return {
    tenantId: "t-cache",
    topic: "cache test",
    entity: {
      id: "ent-cache",
      name: "Cache Entity",
      features: f(),
      actorUserId: "u",
    },
    ...overrides,
  };
}

function makeBrainResponse(
  overrides: Partial<WeaponizedBrainResponse> = {}
): WeaponizedBrainResponse {
  return {
    mega: {
      topic: "cache test",
      entityId: "ent-cache",
      verdict: "flag",
      recommendedAction: "monitor",
      confidence: 0.8,
      requiresHumanReview: false,
      subsystems: {
        strPrediction: { probability: 0.2, band: "low", recommendation: "monitor" },
        reflection: { confidence: 0.8, shouldEscalateToHuman: false },
      },
      warRoomEvent: {
        id: "w1",
        at: "2026-04-14T12:00:00.000Z",
        kind: "screening",
        severity: "medium",
        title: "T",
        entityId: "ent-cache",
      },
      chain: {},
      notes: [],
    } as unknown as WeaponizedBrainResponse["mega"],
    extensions: {} as unknown as WeaponizedBrainResponse["extensions"],
    finalVerdict: "flag",
    clampReasons: [],
    requiresHumanReview: false,
    confidence: 0.8,
    auditNarrative: "cached run",
    subsystemFailures: [],
    advisorResult: null,
    managedAgentPlan: [],
    orchestratorSession: {} as unknown as WeaponizedBrainResponse["orchestratorSession"],
    ...overrides,
  };
}

beforeEach(() => {
  mockBrainReturn.current = makeBrainResponse();
  mockBrainReturn.callCount = 0;
});

describe("runSuperDecision — fingerprint cache hit", () => {
  it("does not call the weaponized brain on a cache hit", async () => {
    const cache = new DecisionFingerprintCache<SuperDecision>();
    const asana = new AsanaOrchestrator();
    const first = await runSuperDecision(makeInput(), {
      cache,
      asana,
      skipMemory: true,
    });
    expect(mockBrainReturn.callCount).toBe(1);
    const second = await runSuperDecision(makeInput(), {
      cache,
      asana,
      skipMemory: true,
    });
    expect(mockBrainReturn.callCount).toBe(1); // CRITICAL: still 1, not 2
    // Same result object returned on replay.
    expect(second.decision.id).toBe(first.decision.id);
    expect(second.decision.at).toBe(first.decision.at);
  });

  it("calls the brain twice when different features are passed", async () => {
    const cache = new DecisionFingerprintCache<SuperDecision>();
    const asana = new AsanaOrchestrator();
    await runSuperDecision(
      makeInput({
        entity: { id: "e", name: "n", features: f(), actorUserId: "u" },
      }),
      { cache, asana, skipMemory: true }
    );
    await runSuperDecision(
      makeInput({
        entity: {
          id: "e",
          name: "n",
          features: f({ sanctionsMatchScore: 0.9 }),
          actorUserId: "u",
        },
      }),
      { cache, asana, skipMemory: true }
    );
    expect(mockBrainReturn.callCount).toBe(2);
  });

  it("enforces tenant isolation on cache hits", async () => {
    const cache = new DecisionFingerprintCache<SuperDecision>();
    const asana = new AsanaOrchestrator();
    await runSuperDecision(makeInput({ tenantId: "t1" }), {
      cache,
      asana,
      skipMemory: true,
    });
    await runSuperDecision(makeInput({ tenantId: "t2" }), {
      cache,
      asana,
      skipMemory: true,
    });
    // Different tenantIds → different fingerprints → two brain calls.
    expect(mockBrainReturn.callCount).toBe(2);
  });

  it("forceFresh bypasses the cache and re-runs the brain", async () => {
    const cache = new DecisionFingerprintCache<SuperDecision>();
    const asana = new AsanaOrchestrator();
    await runSuperDecision(makeInput(), { cache, asana, skipMemory: true });
    await runSuperDecision(makeInput(), {
      cache,
      asana,
      skipMemory: true,
      forceFresh: true,
    });
    expect(mockBrainReturn.callCount).toBe(2);
  });

  it("cache stats show at least one hit after a replay", async () => {
    const cache = new DecisionFingerprintCache<SuperDecision>();
    const asana = new AsanaOrchestrator();
    await runSuperDecision(makeInput(), { cache, asana, skipMemory: true });
    await runSuperDecision(makeInput(), { cache, asana, skipMemory: true });
    const stats = cache.stats();
    expect(stats.hits).toBeGreaterThanOrEqual(1);
    expect(stats.misses).toBeGreaterThanOrEqual(1);
  });
});

describe("runSuperDecision — default behaviour without a cache", () => {
  it("runs the brain every time when no cache is provided", async () => {
    const asana = new AsanaOrchestrator();
    await runSuperDecision(makeInput(), { asana, skipMemory: true });
    await runSuperDecision(makeInput(), { asana, skipMemory: true });
    expect(mockBrainReturn.callCount).toBe(2);
  });
});
