/**
 * Compliance decision engine tests — closes deep-review C2 for the
 * highest-blast-radius module (419 lines, 0 prior tests).
 *
 * The weaponized brain is mocked at the module boundary to keep the
 * test fast and focused on the engine's orchestration logic:
 *   - verdict mapping (pass / flag / escalate / freeze)
 *   - war-room event severity + publishing
 *   - zk-compliance attestation sealing (toggle)
 *   - four-eyes enforcement when a filing is staged
 *   - catastrophic brain failure handling
 *   - STR prediction passthrough
 *
 * Every test asserts a contract that MLRO audit would ask for.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mock the weaponized brain BEFORE importing the engine ----
// The hoisted mock lets us control every subsystem output without
// importing the 3956-line weaponized brain and its 30+ dependencies.

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
  runComplianceDecision,
  getWarRoomFeed,
  type ComplianceCaseInput,
} from "../src/services/complianceDecisionEngine";
import type { WeaponizedBrainResponse } from "../src/services/weaponizedBrain";
import type { StrFeatures } from "../src/services/predictiveStr";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFeatures(overrides: Partial<StrFeatures> = {}): StrFeatures {
  return {
    priorAlerts90d: 0,
    txValue30dAED: 100_000,
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

function makeInput(
  overrides: Partial<ComplianceCaseInput> = {}
): ComplianceCaseInput {
  return {
    tenantId: "tenant-42",
    topic: "Unit-test compliance decision",
    entity: {
      id: "entity-001",
      name: "Test Entity LLC",
      features: makeFeatures(),
      actorUserId: "user-mlro",
    },
    ...overrides,
  };
}

function makeBrainResponse(
  overrides: Partial<WeaponizedBrainResponse> = {}
): WeaponizedBrainResponse {
  return {
    mega: {
      topic: "Unit-test compliance decision",
      entityId: "entity-001",
      verdict: "pass",
      recommendedAction: "Continue standard monitoring.",
      confidence: 0.9,
      requiresHumanReview: false,
      subsystems: {
        // These are required by the type but not read by the engine.
        strPrediction: {
          probability: 0.1,
          band: "low",
          recommendation: "none",
          contributions: [],
        },
        reflection: {
          confidence: 0.9,
          shouldEscalateToHuman: false,
          issues: [],
          strengths: [],
        },
      },
      // These are declared in MegaBrainResponse as non-null but the
      // engine only touches the ones we set explicitly. Casts below
      // keep the mock shape minimal.
      warRoomEvent: {} as unknown as WeaponizedBrainResponse["mega"]["warRoomEvent"],
      chain: {} as unknown as WeaponizedBrainResponse["mega"]["chain"],
      notes: [],
    } as unknown as WeaponizedBrainResponse["mega"],
    extensions: {} as unknown as WeaponizedBrainResponse["extensions"],
    finalVerdict: "pass",
    clampReasons: [],
    requiresHumanReview: false,
    confidence: 0.9,
    auditNarrative:
      "Weaponized brain: pass. No clamps fired. All subsystems ran cleanly.",
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
// Tests
// ---------------------------------------------------------------------------

describe("runComplianceDecision — verdict passthrough", () => {
  it("produces a decision with the brain's final verdict", async () => {
    mockBrainReturn.current = makeBrainResponse({ finalVerdict: "pass" });
    const decision = await runComplianceDecision(makeInput());
    expect(decision.verdict).toBe("pass");
    expect(decision.confidence).toBe(0.9);
    expect(decision.recommendedAction).toMatch(/monitor/i);
  });

  it("propagates 'flag' verdict", async () => {
    mockBrainReturn.current = makeBrainResponse({ finalVerdict: "flag" });
    const decision = await runComplianceDecision(makeInput());
    expect(decision.verdict).toBe("flag");
    expect(decision.warRoomEvent.severity).toBe("medium");
  });

  it("propagates 'escalate' verdict with high severity", async () => {
    mockBrainReturn.current = makeBrainResponse({
      finalVerdict: "escalate",
      requiresHumanReview: true,
    });
    const decision = await runComplianceDecision(makeInput());
    expect(decision.verdict).toBe("escalate");
    expect(decision.warRoomEvent.severity).toBe("high");
    expect(decision.requiresHumanReview).toBe(true);
  });

  it("propagates 'freeze' verdict with critical severity", async () => {
    mockBrainReturn.current = makeBrainResponse({
      finalVerdict: "freeze",
      clampReasons: ["Sanctions confirmed → freeze (Cabinet Res 74/2020 Art.4)"],
      requiresHumanReview: true,
    });
    const decision = await runComplianceDecision(makeInput());
    expect(decision.verdict).toBe("freeze");
    expect(decision.warRoomEvent.severity).toBe("critical");
    expect(decision.requiresHumanReview).toBe(true);
  });
});

describe("runComplianceDecision — identity and metadata", () => {
  it("generates a deterministic id with tenant:entity:epoch shape", async () => {
    const decision = await runComplianceDecision(
      makeInput({
        tenantId: "tenant-xyz",
        entity: {
          id: "ent-777",
          name: "X",
          features: makeFeatures(),
          actorUserId: "u",
        },
      })
    );
    expect(decision.id).toMatch(/^tenant-xyz:ent-777:\d+$/);
    expect(decision.tenantId).toBe("tenant-xyz");
  });

  it("stamps an ISO timestamp and passes through the brain's audit narrative", async () => {
    mockBrainReturn.current = makeBrainResponse({
      auditNarrative: "Test narrative — FDL Art.20",
    });
    const decision = await runComplianceDecision(makeInput());
    expect(decision.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(decision.auditNarrative).toBe("Test narrative — FDL Art.20");
  });
});

describe("runComplianceDecision — STR prediction", () => {
  it("computes the predictive STR score independently of the brain", async () => {
    const decision = await runComplianceDecision(
      makeInput({
        entity: {
          id: "e1",
          name: "E1",
          features: makeFeatures({
            priorAlerts90d: 3,
            highRiskJurisdiction: true,
            nearThresholdCount30d: 5,
            cashRatio30d: 0.8,
          }),
          actorUserId: "u",
        },
      })
    );
    expect(decision.strPrediction).toBeDefined();
    expect(decision.strPrediction.probability).toBeGreaterThanOrEqual(0);
    expect(decision.strPrediction.probability).toBeLessThanOrEqual(1);
    expect(["low", "medium", "high", "critical"]).toContain(
      decision.strPrediction.band
    );
    // A high-risk profile should produce a noticeably non-zero probability.
    expect(decision.strPrediction.probability).toBeGreaterThan(0.1);
  });
});

describe("runComplianceDecision — zk-compliance attestation", () => {
  it("seals an attestation by default (sealAttestation undefined)", async () => {
    const decision = await runComplianceDecision(makeInput());
    expect(decision.attestation).toBeDefined();
    expect(decision.attestation?.commitHash).toMatch(/^[0-9a-f]{128}$/);
    expect(decision.attestation?.listName).toBeDefined();
  });

  it("seals an attestation when sealAttestation === true", async () => {
    const decision = await runComplianceDecision(
      makeInput({ sealAttestation: true })
    );
    expect(decision.attestation).toBeDefined();
  });

  it("skips attestation when sealAttestation === false", async () => {
    const decision = await runComplianceDecision(
      makeInput({ sealAttestation: false })
    );
    expect(decision.attestation).toBeUndefined();
  });
});

describe("runComplianceDecision — four-eyes enforcement", () => {
  it("does NOT enforce four-eyes when no filing is supplied", async () => {
    const decision = await runComplianceDecision(makeInput());
    expect(decision.fourEyes).toBeUndefined();
  });

  it("enforces four-eyes when an STR filing is staged", async () => {
    const decision = await runComplianceDecision(
      makeInput({
        filing: {
          decisionType: "str_filing",
          approvals: [],
          narrative: "draft STR narrative",
        },
      })
    );
    // The engine evaluated four-eyes; result is attached regardless of approval count.
    expect(decision.fourEyes).toBeDefined();
  });
});

describe("runComplianceDecision — war-room publishing", () => {
  it("appends the event to the shared war-room feed", async () => {
    const feed = getWarRoomFeed();
    const before = feed.snapshot().totalEventsIngested;
    const decision = await runComplianceDecision(makeInput());
    const after = feed.snapshot();
    expect(after.totalEventsIngested).toBe(before + 1);
    expect(after.recentEvents[0]?.id).toBe(decision.warRoomEvent.id);
  });

  it("includes tenantId, confidence, and strProbability in the event meta", async () => {
    const decision = await runComplianceDecision(
      makeInput({ tenantId: "tenant-meta" })
    );
    expect(decision.warRoomEvent.meta).toMatchObject({
      tenantId: "tenant-meta",
      confidence: 0.9,
    });
    expect(
      decision.warRoomEvent.meta?.strProbability as number
    ).toBeGreaterThanOrEqual(0);
  });
});

describe("runComplianceDecision — catastrophic brain failure", () => {
  it("emits a critical war-room event and rethrows when the brain throws", async () => {
    mockBrainReturn.current = new Error(
      "Subsystem import error: adverseMediaRanker"
    );
    const feed = getWarRoomFeed();
    const before = feed.snapshot().totalEventsIngested;

    await expect(runComplianceDecision(makeInput())).rejects.toThrow(
      /adverseMediaRanker/
    );

    const after = feed.snapshot();
    expect(after.totalEventsIngested).toBe(before + 1);
    const last = after.recentEvents[0];
    expect(last?.severity).toBe("critical");
    expect(last?.kind).toBe("system_warning");
    expect(last?.title).toMatch(/brain failure/i);
  });
});
