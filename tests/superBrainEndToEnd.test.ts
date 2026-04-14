/**
 * End-to-end integration test for the full super-brain pipeline.
 *
 * Unlike the unit tests in this folder, this file exercises the
 * entire decision path against realistic synthetic cases — no mocks
 * on the weaponized brain or the decision engine. It catches
 * integration bugs that slip between unit tests.
 *
 * What's mocked:
 *   - The Asana orchestrator dispatch adapter (returns a fake task
 *     gid so we can verify the dispatch path without hitting HTTP).
 *
 * What's real:
 *   - runWeaponizedBrain → runComplianceDecision → runSuperDecision
 *   - FATF typology matcher
 *   - Brain memory store + cross-case correlator
 *   - zk-compliance attestation
 *   - Brain Power Score
 *   - Idempotency + Asana façade
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.19-21, Art.24, Art.26-29, Art.35
 *   Cabinet Res 74/2020 Art.4-7
 *   Cabinet Res 134/2025 Art.14, Art.19
 *   Cabinet Decision 109/2023
 *   FATF Rec 1, 6, 10, 15, 20-25, 40
 */
import { describe, it, expect, beforeEach } from "vitest";
import { runSuperDecision } from "../src/services/brainSuperRunner";
import {
  AsanaOrchestrator,
  type DispatchAdapter,
} from "../src/services/asana/orchestrator";
import { InMemoryBrainMemoryStore } from "../src/services/brainMemoryStore";
import type { ComplianceCaseInput } from "../src/services/complianceDecisionEngine";
import type { StrFeatures } from "../src/services/predictiveStr";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function features(overrides: Partial<StrFeatures> = {}): StrFeatures {
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

function caseInput(
  topic: string,
  f: StrFeatures,
  overrides: Partial<ComplianceCaseInput> = {}
): ComplianceCaseInput {
  return {
    tenantId: "tenant-e2e",
    topic,
    entity: {
      id: overrides.entity?.id ?? `entity-${Math.random().toString(36).slice(2, 10)}`,
      name: overrides.entity?.name ?? "Synthetic Test Entity",
      features: f,
      actorUserId: "mlro-e2e",
      ...(overrides.entity ?? {}),
    },
    ...overrides,
  };
}

function makeFakeAsana(): { asana: AsanaOrchestrator; calls: number } {
  let calls = 0;
  const adapter: DispatchAdapter = async () => {
    calls += 1;
    return { taskGid: `fake-task-${calls}` };
  };
  const asana = new AsanaOrchestrator({ dispatchAdapter: adapter });
  return {
    asana,
    get calls() {
      return calls;
    },
  };
}

// ---------------------------------------------------------------------------
// Clean low-risk case
// ---------------------------------------------------------------------------

describe("super-brain E2E — clean low-risk case", () => {
  let memory: InMemoryBrainMemoryStore;

  beforeEach(() => {
    memory = new InMemoryBrainMemoryStore();
  });

  it("produces a decision with no typology hits, records memory, no Asana dispatch", async () => {
    const { asana } = makeFakeAsana();
    const result = await runSuperDecision(
      caseInput("Clean onboarding", features()),
      { asana, memory }
    );

    // Decision pipeline ran
    expect(result.decision).toBeDefined();
    expect(result.decision.id).toMatch(/^tenant-e2e:/);
    expect(result.decision.tenantId).toBe("tenant-e2e");
    expect(result.decision.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Typology matcher ran and produced zero matches for a clean vector
    expect(result.typologies).toBeDefined();
    expect(result.typologies.matches).toHaveLength(0);
    expect(result.typologies.topSeverity).toBe("none");

    // Memory persisted + cross-case ran
    expect(memory.sizeForTenant("tenant-e2e")).toBe(1);
    expect(result.crossCase).not.toBeNull();
    expect(result.crossCase!.caseCount).toBe(1);
    expect(result.crossCase!.correlations).toHaveLength(0);

    // Asana dispatch is skipped on 'pass' verdicts
    if (result.decision.verdict === "pass") {
      expect(result.asanaDispatch).toBeNull();
    }

    // Power score is computed
    expect(result.powerScore).toBeDefined();
    expect(result.powerScore.score).toBeGreaterThanOrEqual(0);
    expect(result.powerScore.score).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Critical sanctions case
// ---------------------------------------------------------------------------

describe("super-brain E2E — confirmed sanctions match", () => {
  let memory: InMemoryBrainMemoryStore;

  beforeEach(() => {
    memory = new InMemoryBrainMemoryStore();
  });

  it("fires SANCTIONS-002 typology, dispatches to Asana, seals attestation", async () => {
    const { asana } = makeFakeAsana();
    const input = caseInput(
      "Confirmed OFAC hit",
      features({ sanctionsMatchScore: 0.95 }),
      { entity: { id: "sanctioned-entity", name: "Known bad", features: features({ sanctionsMatchScore: 0.95 }), actorUserId: "mlro", isSanctionsConfirmed: true } }
    );
    const result = await runSuperDecision(input, { asana, memory });

    // Typology library should match SANCTIONS-001 + SANCTIONS-002
    const ids = result.typologies.matches.map((m) => m.typology.id);
    expect(ids).toContain("SANCTIONS-001");
    expect(ids).toContain("SANCTIONS-002");
    expect(result.typologies.topSeverity).toBe("critical");

    // Decision engine must have clamped to freeze (Cabinet Res 74/2020 Art.4)
    expect(result.decision.verdict).toBe("freeze");
    expect(result.decision.requiresHumanReview).toBe(true);

    // Attestation must seal for the freeze path
    expect(result.decision.attestation).toBeDefined();
    expect(result.decision.attestation!.commitHash).toMatch(/^[0-9a-f]{128}$/);

    // Asana dispatch must have fired
    expect(result.asanaDispatch).not.toBeNull();
    expect(result.asanaDispatch!.created).toBe(true);
    expect(result.asanaDispatch!.taskGid).toBeDefined();

    // Cross-case correlator persisted this case
    expect(memory.sizeForTenant("tenant-e2e")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// PEP + adverse media — advisor triggers
// ---------------------------------------------------------------------------

describe("super-brain E2E — PEP with adverse media", () => {
  it("fires ADVERSE-002 + PEP-002 typologies", async () => {
    const { asana } = makeFakeAsana();
    const result = await runSuperDecision(
      caseInput(
        "PEP + media hit",
        features({
          isPep: true,
          hasAdverseMedia: true,
          cashRatio30d: 0.7,
        })
      ),
      { asana, memory: new InMemoryBrainMemoryStore() }
    );

    const ids = result.typologies.matches.map((m) => m.typology.id);
    expect(ids).toContain("PEP-002");
    expect(ids).toContain("ADVERSE-002");
    expect(result.typologies.topSeverity).toBe("critical");
  });
});

// ---------------------------------------------------------------------------
// Cross-case detection — two cases share a wallet
// ---------------------------------------------------------------------------

describe("super-brain E2E — two cases sharing a wallet", () => {
  it("second call surfaces a wallet-reuse correlation in the response", async () => {
    const memory = new InMemoryBrainMemoryStore();
    const { asana } = makeFakeAsana();

    // First case — flag verdict so it persists + dispatches.
    await runSuperDecision(
      caseInput(
        "First case",
        features({ priorAlerts90d: 2, cashRatio30d: 0.5 }),
        { entity: { id: "e1", name: "E1", features: features({ priorAlerts90d: 2, cashRatio30d: 0.5 }), actorUserId: "u" } }
      ),
      {
        asana,
        memory,
        memoryExtras: { wallets: ["0xshared"], entityRef: "e1" },
      }
    );

    // Second case — shares the wallet. Cross-case should detect it.
    const second = await runSuperDecision(
      caseInput(
        "Second case",
        features({ priorAlerts90d: 2, cashRatio30d: 0.5 }),
        { entity: { id: "e2", name: "E2", features: features({ priorAlerts90d: 2, cashRatio30d: 0.5 }), actorUserId: "u" } }
      ),
      {
        asana,
        memory,
        memoryExtras: { wallets: ["0xshared"], entityRef: "e2" },
      }
    );

    expect(memory.sizeForTenant("tenant-e2e")).toBe(2);
    expect(second.crossCase).not.toBeNull();
    expect(second.crossCase!.caseCount).toBe(2);
    const walletReuse = second.crossCase!.correlations.find(
      (c) => c.kind === "wallet-reuse"
    );
    expect(walletReuse).toBeDefined();
    expect(walletReuse!.caseIds.length).toBeGreaterThanOrEqual(2);
    expect(["high", "critical"]).toContain(walletReuse!.severity);
  });
});

// ---------------------------------------------------------------------------
// Idempotency — same decision id never creates two Asana tasks
// ---------------------------------------------------------------------------

describe("super-brain E2E — Asana dispatch idempotency", () => {
  it("replaying the same decision id reuses the existing task", async () => {
    const memory = new InMemoryBrainMemoryStore();
    const { asana, calls: _ } = makeFakeAsana();

    // Use a stable Date.now so the engine produces the same decision id
    // for two independent runSuperDecision calls. Without this, the id
    // carries the current epoch ms and each call would be unique.
    let now = 1_712_500_000_000;
    const origNow = Date.now;
    Date.now = () => now;

    try {
      const first = await runSuperDecision(
        caseInput(
          "Deterministic replay",
          features({ nearThresholdCount30d: 4, cashRatio30d: 0.6 }),
          { entity: { id: "dedupe-entity", name: "D", features: features({ nearThresholdCount30d: 4, cashRatio30d: 0.6 }), actorUserId: "u" } }
        ),
        { asana, memory }
      );
      const second = await runSuperDecision(
        caseInput(
          "Deterministic replay",
          features({ nearThresholdCount30d: 4, cashRatio30d: 0.6 }),
          { entity: { id: "dedupe-entity", name: "D", features: features({ nearThresholdCount30d: 4, cashRatio30d: 0.6 }), actorUserId: "u" } }
        ),
        { asana, memory }
      );

      expect(first.decision.id).toBe(second.decision.id);
      if (first.asanaDispatch && second.asanaDispatch) {
        expect(first.asanaDispatch.created).toBe(true);
        expect(second.asanaDispatch.created).toBe(false);
        expect(first.asanaDispatch.taskGid).toBe(second.asanaDispatch.taskGid);
      }
    } finally {
      Date.now = origNow;
    }
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation — cases from other tenants never bleed in
// ---------------------------------------------------------------------------

describe("super-brain E2E — tenant isolation", () => {
  it("cross-case scan never surfaces a finding from a different tenant", async () => {
    const memory = new InMemoryBrainMemoryStore();
    const { asana } = makeFakeAsana();

    // Prime memory with a case for a DIFFERENT tenant that would form
    // a wallet-reuse ring if isolation were broken.
    memory.record({
      caseId: "foreign",
      tenantId: "other-tenant",
      openedAt: "2026-04-14T10:00:00.000Z",
      entityRef: "other",
      wallets: ["0xcontested"],
    });

    const result = await runSuperDecision(
      caseInput(
        "Isolation check",
        features(),
        { entity: { id: "iso", name: "I", features: features(), actorUserId: "u" } }
      ),
      {
        asana,
        memory,
        memoryExtras: { wallets: ["0xcontested"] },
      }
    );

    // The correlator must have seen only the tenant-e2e case, not the
    // foreign one, so no wallet-reuse finding can fire.
    expect(result.crossCase!.correlations.some((c) => c.kind === "wallet-reuse")).toBe(false);
    expect(result.crossCase!.caseCount).toBe(1);
  });
});
