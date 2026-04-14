/**
 * Asana Orchestrator façade tests.
 *
 * Verifies the unified API over the 45+ asana*.ts modules:
 *   - Idempotency: duplicate dispatches never create duplicate tasks
 *   - Dispatch adapter is pluggable (tests inject a fake)
 *   - Comment routing passes through to asanaCommentSkillRouter
 *   - Skill catalogue exposes all 45 skills (17 original + 28 new)
 *   - Health snapshot reports the full catalogue + categories
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  AsanaOrchestrator,
  makeIdempotencyKey,
  type BrainVerdictLike,
  type DispatchAdapter,
} from "../src/services/asana/orchestrator";
import {
  SKILL_CATALOGUE,
  routeAsanaComment,
} from "../src/services/asanaCommentSkillRouter";

function makeVerdict(overrides: Partial<BrainVerdictLike> = {}): BrainVerdictLike {
  return {
    id: "tenant-1:entity-1:1712000000000",
    tenantId: "tenant-1",
    verdict: "flag",
    confidence: 0.8,
    recommendedAction: "Review case",
    requiresHumanReview: false,
    at: "2026-04-14T12:00:00.000Z",
    entityId: "entity-1",
    entityName: "Test Entity LLC",
    citations: ["FDL Art.20"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe("makeIdempotencyKey", () => {
  it("produces a stable key shape", () => {
    const key = makeIdempotencyKey(makeVerdict());
    expect(key).toBe("tenant-1:tenant-1:entity-1:1712000000000");
  });

  it("distinct verdicts produce distinct keys", () => {
    const a = makeIdempotencyKey(makeVerdict({ id: "a" }));
    const b = makeIdempotencyKey(makeVerdict({ id: "b" }));
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

describe("AsanaOrchestrator.dispatchBrainVerdict", () => {
  let orchestrator: AsanaOrchestrator;
  let dispatchCallCount: number;
  let adapter: DispatchAdapter;

  beforeEach(() => {
    dispatchCallCount = 0;
    adapter = async () => {
      dispatchCallCount += 1;
      return { taskGid: `task-${dispatchCallCount}` };
    };
    orchestrator = new AsanaOrchestrator({ dispatchAdapter: adapter });
  });

  it("creates a new task on first dispatch", async () => {
    const result = await orchestrator.dispatchBrainVerdict(makeVerdict());
    expect(result.created).toBe(true);
    expect(result.taskGid).toBe("task-1");
    expect(dispatchCallCount).toBe(1);
  });

  it("re-dispatching the same verdict returns the same task without calling adapter", async () => {
    const first = await orchestrator.dispatchBrainVerdict(makeVerdict());
    const second = await orchestrator.dispatchBrainVerdict(makeVerdict());
    expect(first.taskGid).toBe("task-1");
    expect(second.taskGid).toBe("task-1");
    expect(second.created).toBe(false);
    expect(dispatchCallCount).toBe(1); // adapter not called twice
  });

  it("distinct verdicts create distinct tasks", async () => {
    const a = await orchestrator.dispatchBrainVerdict(makeVerdict({ id: "a" }));
    const b = await orchestrator.dispatchBrainVerdict(makeVerdict({ id: "b" }));
    expect(a.taskGid).toBe("task-1");
    expect(b.taskGid).toBe("task-2");
    expect(dispatchCallCount).toBe(2);
  });

  it("returns skippedReason when the adapter skips", async () => {
    const skipping: DispatchAdapter = async () => ({ skipped: "no_token" });
    const local = new AsanaOrchestrator({ dispatchAdapter: skipping });
    const result = await local.dispatchBrainVerdict(makeVerdict());
    expect(result.created).toBe(false);
    expect(result.skippedReason).toBe("no_token");
    expect(result.taskGid).toBeUndefined();
  });

  it("skipped dispatches are NOT cached — retry can still go through", async () => {
    let nthCall = 0;
    const flaky: DispatchAdapter = async () => {
      nthCall += 1;
      if (nthCall === 1) return { skipped: "transient_unavailable" };
      return { taskGid: `task-${nthCall}` };
    };
    const local = new AsanaOrchestrator({ dispatchAdapter: flaky });
    const first = await local.dispatchBrainVerdict(makeVerdict());
    expect(first.skippedReason).toBe("transient_unavailable");
    const second = await local.dispatchBrainVerdict(makeVerdict());
    expect(second.created).toBe(true);
    expect(second.taskGid).toBe("task-2");
  });

  it("setDispatchAdapter swaps behaviour at runtime", async () => {
    const local = new AsanaOrchestrator(); // default no-op adapter
    const first = await local.dispatchBrainVerdict(makeVerdict({ id: "x" }));
    expect(first.skippedReason).toBe("no_adapter_configured");

    let called = false;
    local.setDispatchAdapter(async () => {
      called = true;
      return { taskGid: "runtime-task" };
    });
    const second = await local.dispatchBrainVerdict(makeVerdict({ id: "y" }));
    expect(called).toBe(true);
    expect(second.taskGid).toBe("runtime-task");
  });
});

// ---------------------------------------------------------------------------
// Comment routing passthrough
// ---------------------------------------------------------------------------

describe("AsanaOrchestrator.executeSkill", () => {
  it("runs a real runner when one is registered", async () => {
    const orchestrator = new AsanaOrchestrator();
    const route = orchestrator.routeComment("/brain-status");
    expect(route.ok).toBe(true);
    const result = await orchestrator.executeSkill(route.invocation!, {
      tenantId: "t1",
      userId: "u1",
    });
    expect(result.real).toBe(true);
    expect(result.skillName).toBe("brain-status");
    expect(result.data?.skillCatalogueSize).toBe(46);
  });

  it("falls back to the stub for an unregistered skill", async () => {
    const orchestrator = new AsanaOrchestrator();
    const route = orchestrator.routeComment("/audit");
    expect(route.ok).toBe(true);
    const result = await orchestrator.executeSkill(route.invocation!, {
      tenantId: "t1",
      userId: "u1",
    });
    expect(result.real).toBe(false);
  });

  it("exposes the skill registry so callers can add runners at boot", () => {
    const orchestrator = new AsanaOrchestrator();
    const registry = orchestrator.getSkillRegistry();
    expect(registry).toBeDefined();
    expect(registry.has("brain-status")).toBe(true);
  });
});

describe("AsanaOrchestrator.routeComment", () => {
  const orchestrator = new AsanaOrchestrator();

  it("passes through to asanaCommentSkillRouter", () => {
    const a = orchestrator.routeComment("/screen ACME LLC");
    const b = routeAsanaComment("/screen ACME LLC");
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    expect(a.invocation?.skill.name).toBe("screen");
  });

  it("returns notSlash for plain text", () => {
    const result = orchestrator.routeComment("hello team");
    expect(result.notSlash).toBe(true);
  });

  it("rejects unknown skills", () => {
    const result = orchestrator.routeComment("/notarealskill foo");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown skill/);
  });

  it("executes the stub for a parsed invocation", () => {
    const route = orchestrator.routeComment("/screen ACME LLC");
    expect(route.ok).toBe(true);
    const stub = orchestrator.executeSkillStub(route.invocation!);
    expect(stub.reply).toMatch(/screen/);
    expect(stub.citation).toMatch(/FDL/);
  });
});

// ---------------------------------------------------------------------------
// Skill catalogue coverage
// ---------------------------------------------------------------------------

describe("AsanaOrchestrator — skill catalogue", () => {
  const orchestrator = new AsanaOrchestrator();

  it("exposes the full skill catalogue via listSkills()", () => {
    const skills = orchestrator.listSkills();
    expect(skills).toBe(SKILL_CATALOGUE);
    expect(skills.length).toBeGreaterThanOrEqual(45);
  });

  it("each skill has a non-empty regulatory citation", () => {
    for (const s of orchestrator.listSkills()) {
      expect(s.citation.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
    }
  });

  it("findSkill returns the entry for a known slash name", () => {
    expect(orchestrator.findSkill("screen")?.name).toBe("screen");
    expect(orchestrator.findSkill("brain-analyze")?.name).toBe("brain-analyze");
    expect(orchestrator.findSkill("ubo-trace")?.name).toBe("ubo-trace");
    expect(orchestrator.findSkill("zk-attest")?.name).toBe("zk-attest");
  });

  it("findSkill is case-insensitive", () => {
    expect(orchestrator.findSkill("SCREEN")?.name).toBe("screen");
    expect(orchestrator.findSkill("Brain-Analyze")?.name).toBe("brain-analyze");
  });

  it("findSkill returns null for unknown names", () => {
    expect(orchestrator.findSkill("notaskill")).toBeNull();
  });

  it("catalogue includes every new skill introduced in commit 5", () => {
    const required = [
      "brain-analyze",
      "ubo-trace",
      "pep-check",
      "adverse-media",
      "tfs-check",
      "freeze",
      "unfreeze",
      "edd",
      "sdd",
      "cdd-review",
      "str",
      "sar",
      "ctr",
      "dpmsr",
      "cnmr",
      "bni",
      "four-eyes-status",
      "four-eyes-approve",
      "drift-check",
      "cross-case",
      "risk-score",
      "supply-chain",
      "penalty-forecast",
      "board-report",
      "brain-status",
      "training-plan",
      "raci",
      "gap-register",
      "zk-attest",
    ];
    for (const name of required) {
      expect(orchestrator.findSkill(name), `missing skill /${name}`).not.toBeNull();
    }
  });

  it("catalogue has no duplicate slash names", () => {
    const names = orchestrator.listSkills().map((s) => s.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// Health snapshot
// ---------------------------------------------------------------------------

describe("AsanaOrchestrator.health", () => {
  it("reports full catalogue size + per-category counts", async () => {
    const orchestrator = new AsanaOrchestrator();
    const health = await orchestrator.health();
    expect(health.skillCount).toBe(SKILL_CATALOGUE.length);
    expect(health.skillCount).toBeGreaterThanOrEqual(45);
    expect(health.skillsByCategory.screening).toBeGreaterThan(0);
    expect(health.skillsByCategory.filing).toBeGreaterThan(0);
    expect(health.skillsByCategory.governance).toBeGreaterThan(0);
    expect(health.idempotencyKeyCount).toBe(0);
    expect(health.lastDispatchAt).toBeNull();
  });

  it("reports idempotency store growth after a dispatch", async () => {
    const orchestrator = new AsanaOrchestrator({
      dispatchAdapter: async () => ({ taskGid: "T" }),
    });
    await orchestrator.dispatchBrainVerdict(makeVerdict());
    const health = await orchestrator.health();
    expect(health.idempotencyKeyCount).toBe(1);
    expect(health.lastDispatchAt).not.toBeNull();
    expect(health.lastDispatchResult?.created).toBe(true);
  });

  it("clearIdempotencyForTests resets state", async () => {
    const orchestrator = new AsanaOrchestrator({
      dispatchAdapter: async () => ({ taskGid: "T" }),
    });
    await orchestrator.dispatchBrainVerdict(makeVerdict());
    await orchestrator.clearIdempotencyForTests();
    const health = await orchestrator.health();
    expect(health.idempotencyKeyCount).toBe(0);
    expect(health.lastDispatchAt).toBeNull();
  });
});
