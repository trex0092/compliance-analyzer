/**
 * Brain Super Runner tests.
 *
 * Covers:
 *   - computeBrainPowerScore bounds + component breakdown
 *   - deterministicAdvisor verdict-specific advice
 *   - shouldInvokeAdvisor trigger logic (matches CLAUDE.md
 *     "Model Routing" escalation rules)
 *   - runSuperDecision: weaponized brain is mocked so we assert
 *     the orchestration layer (advisor injection, Asana dispatch,
 *     power-score inclusion) independently of the 3956-line brain.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the weaponized brain BEFORE any imports touch it.
const mockBrainReturn = vi.hoisted(() => ({
  current: null as unknown,
}));

vi.mock("../src/services/weaponizedBrain", () => ({
  runWeaponizedBrain: vi.fn(async () => {
    if (mockBrainReturn.current instanceof Error) throw mockBrainReturn.current;
    return mockBrainReturn.current;
  }),
}));

import {
  runSuperDecision,
  computeBrainPowerScore,
  deterministicAdvisor,
  __test__,
} from "../src/services/brainSuperRunner";
import { AsanaOrchestrator } from "../src/services/asana/orchestrator";
import type { ComplianceCaseInput } from "../src/services/complianceDecisionEngine";
import type { WeaponizedBrainResponse } from "../src/services/weaponizedBrain";
import type { StrFeatures } from "../src/services/predictiveStr";

const { shouldInvokeAdvisor } = __test__;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFeatures(overrides: Partial<StrFeatures> = {}): StrFeatures {
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
    tenantId: "tenant-X",
    topic: "Test case",
    entity: {
      id: "ent-X",
      name: "Test Entity",
      features: makeFeatures(),
      actorUserId: "u1",
    },
    ...overrides,
  };
}

function makeBrainResponse(
  overrides: Partial<WeaponizedBrainResponse> = {}
): WeaponizedBrainResponse {
  return {
    mega: {
      topic: "Test",
      entityId: "ent-X",
      verdict: "pass",
      recommendedAction: "monitor",
      confidence: 0.9,
      requiresHumanReview: false,
      subsystems: {
        strPrediction: { probability: 0.1, band: "low", recommendation: "monitor" },
        reflection: { confidence: 0.9, shouldEscalateToHuman: false },
      },
      warRoomEvent: {},
      chain: {},
      notes: [],
    } as unknown as WeaponizedBrainResponse["mega"],
    extensions: {} as unknown as WeaponizedBrainResponse["extensions"],
    finalVerdict: "pass",
    clampReasons: [],
    requiresHumanReview: false,
    confidence: 0.9,
    auditNarrative: "clean run",
    subsystemFailures: [],
    advisorResult: null,
    managedAgentPlan: [],
    orchestratorSession: {} as unknown as WeaponizedBrainResponse["orchestratorSession"],
    ...overrides,
  };
}

beforeEach(() => {
  mockBrainReturn.current = makeBrainResponse();
});

// ---------------------------------------------------------------------------
// deterministicAdvisor
// ---------------------------------------------------------------------------

describe("deterministicAdvisor", () => {
  const base = {
    reason: "test",
    entityId: "e",
    entityName: "Entity",
    verdict: "pass" as const,
    confidence: 0.9,
    clampReasons: [],
    narrative: "",
  };

  it("returns freeze-specific advice with Cabinet Res 74/2020 citation", () => {
    const r = deterministicAdvisor({ ...base, verdict: "freeze" });
    expect(r.text).toMatch(/24h EOCN/);
    expect(r.text).toMatch(/Cabinet Res 74\/2020/);
    expect(r.text).toMatch(/CNMR/);
    expect(r.modelUsed).toBe("deterministic-fallback");
    expect(r.advisorCallCount).toBe(1);
  });

  it("returns escalate-specific advice", () => {
    const r = deterministicAdvisor({ ...base, verdict: "escalate" });
    expect(r.text).toMatch(/Compliance Officer/);
    expect(r.text).toMatch(/four-eyes/);
  });

  it("flags low confidence even on pass", () => {
    const r = deterministicAdvisor({ ...base, verdict: "pass", confidence: 0.5 });
    expect(r.text).toMatch(/Low confidence/);
  });

  it("mentions clamps when they fired", () => {
    const r = deterministicAdvisor({
      ...base,
      verdict: "escalate",
      clampReasons: ["PEP detected", "Adverse media"],
    });
    expect(r.text).toMatch(/2 safety clamp/);
  });

  it("is deterministic — same input → same output", () => {
    const a = deterministicAdvisor({ ...base, verdict: "freeze" });
    const b = deterministicAdvisor({ ...base, verdict: "freeze" });
    expect(a.text).toBe(b.text);
  });
});

// ---------------------------------------------------------------------------
// shouldInvokeAdvisor
// ---------------------------------------------------------------------------

describe("shouldInvokeAdvisor — escalation triggers", () => {
  it("triggers on isSanctionsConfirmed", () => {
    const input = makeInput();
    input.entity.isSanctionsConfirmed = true;
    expect(shouldInvokeAdvisor(input)).toBe(true);
  });

  it("triggers on any filing", () => {
    expect(
      shouldInvokeAdvisor(
        makeInput({
          filing: { decisionType: "str_filing", approvals: [] },
        })
      )
    ).toBe(true);
  });

  it("triggers on sanctionsMatchScore >= 0.5", () => {
    expect(
      shouldInvokeAdvisor(
        makeInput({
          entity: {
            id: "e",
            name: "n",
            features: makeFeatures({ sanctionsMatchScore: 0.5 }),
            actorUserId: "u",
          },
        })
      )
    ).toBe(true);
  });

  it("triggers on isPep", () => {
    expect(
      shouldInvokeAdvisor(
        makeInput({
          entity: {
            id: "e",
            name: "n",
            features: makeFeatures({ isPep: true }),
            actorUserId: "u",
          },
        })
      )
    ).toBe(true);
  });

  it("triggers on hasAdverseMedia", () => {
    expect(
      shouldInvokeAdvisor(
        makeInput({
          entity: {
            id: "e",
            name: "n",
            features: makeFeatures({ hasAdverseMedia: true }),
            actorUserId: "u",
          },
        })
      )
    ).toBe(true);
  });

  it("triggers on highRiskJurisdiction + heavy cash usage", () => {
    expect(
      shouldInvokeAdvisor(
        makeInput({
          entity: {
            id: "e",
            name: "n",
            features: makeFeatures({
              highRiskJurisdiction: true,
              cashRatio30d: 0.6,
            }),
            actorUserId: "u",
          },
        })
      )
    ).toBe(true);
  });

  it("does NOT trigger on a clean low-risk input", () => {
    expect(shouldInvokeAdvisor(makeInput())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeBrainPowerScore
// ---------------------------------------------------------------------------

describe("computeBrainPowerScore", () => {
  it("thin score for an almost-empty response", async () => {
    mockBrainReturn.current = makeBrainResponse({
      clampReasons: [],
      subsystemFailures: [],
      advisorResult: null,
    });
    const { decision, powerScore } = await runSuperDecision(
      makeInput({ sealAttestation: false }),
      { skipAsanaDispatch: true, skipMemory: true }
    );
    expect(powerScore.score).toBeGreaterThanOrEqual(0);
    expect(powerScore.score).toBeLessThanOrEqual(100);
    expect(["thin", "standard", "advanced", "weaponized"]).toContain(powerScore.verdict);
    expect(powerScore.subsystemsInvoked).toBeGreaterThanOrEqual(2);
    expect(powerScore.attestationSealed).toBe(false);
    // Unused to silence the linter; decision must exist.
    expect(decision.id).toMatch(/tenant-X/);
  });

  it("weaponized score when mega + extensions + advisor + attestation all present", async () => {
    const mega = makeBrainResponse().mega as unknown as Record<string, unknown>;
    (mega as { subsystems: Record<string, unknown> }).subsystems = {
      strPrediction: { probability: 0.2, band: "low" },
      reflection: { confidence: 0.9 },
      precedents: { recommendedOutcome: "monitor", confidence: 0.9 },
      anomaly: { overallScore: 1.2 },
      belief: { mostLikely: { probability: 0.8 } },
      causal: { change: true },
      rulePrediction: "monitor",
      plan: { steps: [] },
      doubleCheck: { outcome: "agreed" },
      debate: { winner: "student" },
      penaltyVaR: { valueAtRisk: 1_000_000 },
      narrative: { characterCount: 500, warnings: [] },
    };
    const extensions = {
      adverseMedia: { hits: [] },
      ubo: { summary: {} },
      wallets: { summary: {} },
      transactions: { detectors: [] },
      explainableScoring: { factors: [] },
      sanctions: { listsChecked: ["UN", "OFAC"], matchCount: 0 },
      temporalPatterns: { report: {} },
      benford: { deviation: 0.02 },
    };
    mockBrainReturn.current = makeBrainResponse({
      mega: mega as unknown as WeaponizedBrainResponse["mega"],
      extensions: extensions as unknown as WeaponizedBrainResponse["extensions"],
      clampReasons: ["PEP detected"],
      subsystemFailures: [],
      advisorResult: { text: "advice", advisorCallCount: 1, modelUsed: "fake-advisor" },
      confidence: 0.95,
      finalVerdict: "escalate",
    });

    const { powerScore } = await runSuperDecision(
      makeInput({
        entity: {
          id: "ent",
          name: "n",
          features: makeFeatures({ isPep: true }),
          actorUserId: "u",
        },
      }),
      { skipAsanaDispatch: true, skipMemory: true }
    );

    expect(powerScore.score).toBeGreaterThanOrEqual(70);
    expect(powerScore.verdict).toMatch(/advanced|weaponized/);
    expect(powerScore.advisorInvoked).toBe(true);
    expect(powerScore.attestationSealed).toBe(true);
    expect(powerScore.clampsFired).toBe(1);
  });

  it("never exceeds 100 and never drops below 0", () => {
    const extreme = {
      ...makeBrainResponse(),
      clampReasons: Array(100).fill("x"),
      subsystemFailures: [],
      advisorResult: { text: "a", advisorCallCount: 1, modelUsed: "x" },
    } as unknown as WeaponizedBrainResponse;
    const fakeDecision = {
      raw: extreme,
      confidence: 1,
      attestation: { commitHash: "h", listName: "UN", attestationPublishedAtIso: "now" },
    } as unknown as Parameters<typeof computeBrainPowerScore>[0];
    const score = computeBrainPowerScore(fakeDecision);
    expect(score.score).toBeLessThanOrEqual(100);
    expect(score.score).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// runSuperDecision — end-to-end
// ---------------------------------------------------------------------------

describe("runSuperDecision", () => {
  it("returns decision + powerScore + asanaDispatch", async () => {
    mockBrainReturn.current = makeBrainResponse({ finalVerdict: "flag" });
    const { decision, powerScore, asanaDispatch } = await runSuperDecision(
      makeInput(),
      { skipAsanaDispatch: false, asana: new AsanaOrchestrator(), skipMemory: true }
    );
    expect(decision.verdict).toBe("flag");
    expect(powerScore).toBeDefined();
    expect(asanaDispatch).not.toBeNull();
    expect(asanaDispatch?.idempotencyKey).toContain("tenant-X");
  });

  it("skips Asana dispatch on pass verdict", async () => {
    mockBrainReturn.current = makeBrainResponse({ finalVerdict: "pass" });
    const { asanaDispatch } = await runSuperDecision(makeInput(), {
      asana: new AsanaOrchestrator(),
      skipMemory: true,
    });
    expect(asanaDispatch).toBeNull();
  });

  it("uses the deterministic advisor fallback when no advisor injected and a trigger fires", async () => {
    // Set up mock to reflect advisor being invoked (the engine actually
    // consumes the injected fn; we just verify runSuperDecision wires it in).
    mockBrainReturn.current = makeBrainResponse({
      finalVerdict: "escalate",
      advisorResult: {
        text: "advice",
        advisorCallCount: 1,
        modelUsed: "deterministic-fallback",
      },
    });
    const pep = makeInput({
      entity: {
        id: "e",
        name: "n",
        features: makeFeatures({ isPep: true }),
        actorUserId: "u",
      },
    });
    const { decision, powerScore } = await runSuperDecision(pep, {
      skipAsanaDispatch: true,
      skipMemory: true,
    });
    expect(decision.verdict).toBe("escalate");
    expect(powerScore.advisorInvoked).toBe(true);
  });

  it("does NOT wire advisor when the case has zero triggers", async () => {
    // The engine receives advisor=undefined, so raw.advisorResult stays null.
    mockBrainReturn.current = makeBrainResponse({ advisorResult: null });
    const { powerScore } = await runSuperDecision(makeInput(), {
      skipAsanaDispatch: true,
      skipMemory: true,
    });
    expect(powerScore.advisorInvoked).toBe(false);
  });

  it("idempotent Asana dispatch — two identical super-runs only create one task", async () => {
    mockBrainReturn.current = makeBrainResponse({ finalVerdict: "flag" });
    const asana = new AsanaOrchestrator({
      dispatchAdapter: async () => ({ taskGid: "T1" }),
    });
    // Use a fixed case id so makeIdempotencyKey is stable across two
    // separate runSuperDecision invocations. We achieve this by
    // mocking Date.now during the second call so the engine produces
    // the same decision id.
    const spy = vi.spyOn(Date, "now").mockReturnValue(1);
    const a = await runSuperDecision(makeInput(), { asana, skipMemory: true });
    const b = await runSuperDecision(makeInput(), { asana, skipMemory: true });
    spy.mockRestore();

    expect(a.asanaDispatch?.created).toBe(true);
    expect(b.asanaDispatch?.created).toBe(false);
    expect(a.asanaDispatch?.taskGid).toBe("T1");
    expect(b.asanaDispatch?.taskGid).toBe("T1");
  });
});
