/**
 * Production Asana dispatch adapter tests.
 *
 * Covers:
 *   - Happy path: resolves project env key → calls createTask → returns gid
 *   - Missing env var → skipped with project_env_unset:<key>
 *   - Tipping-off linter blocks notes → skipped with tipping_off_blocked
 *   - createTask throws → skipped with createTask_error:<msg>
 *   - onDispatch hook fires for every outcome
 *   - defaultEnvResolver reads process.env and trims whitespace
 *   - Integrates with AsanaOrchestrator.dispatchWithTemplate
 *   - Idempotency: replays never call createTask twice
 */
import { describe, it, expect, vi } from "vitest";
import {
  createProductionAsanaDispatchAdapter,
  __test__,
  type CreateTaskFn,
} from "../src/services/asana/productionDispatchAdapter";
import type { AsanaBrainTaskTemplate } from "../src/services/asana/asanaBrainTaskTemplate";
import {
  AsanaOrchestrator,
  type BrainVerdictLike,
} from "../src/services/asana/orchestrator";

const { defaultEnvResolver } = __test__;

function verdict(overrides: Partial<BrainVerdictLike> = {}): BrainVerdictLike {
  return {
    id: "t1:e1:1",
    tenantId: "t1",
    verdict: "freeze",
    confidence: 0.95,
    recommendedAction: "Freeze",
    requiresHumanReview: true,
    at: "2026-04-14T12:00:00.000Z",
    entityId: "e1",
    entityName: "Opaque",
    ...overrides,
  };
}

function template(
  overrides: Partial<AsanaBrainTaskTemplate> = {}
): AsanaBrainTaskTemplate {
  return {
    name: "🚨 FREEZE · e1 · Freeze",
    notes: "# Brain Decision\n\n- Verdict: freeze\n- Clean regulatory body.\n",
    projectEnvKey: "ASANA_PROJECT_MLRO_CENTRAL",
    tags: ["brain/verdict/freeze"],
    routingReason: "verdict=freeze → MLRO Central",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// defaultEnvResolver
// ---------------------------------------------------------------------------

describe("defaultEnvResolver", () => {
  it("returns undefined for unset env var", () => {
    delete process.env.ASANA_PROJECT_MLRO_CENTRAL;
    expect(defaultEnvResolver("ASANA_PROJECT_MLRO_CENTRAL")).toBeUndefined();
  });

  it("returns the trimmed value for a set env var", () => {
    process.env.ASANA_PROJECT_MLRO_CENTRAL = "  1234567890  ";
    expect(defaultEnvResolver("ASANA_PROJECT_MLRO_CENTRAL")).toBe("1234567890");
    delete process.env.ASANA_PROJECT_MLRO_CENTRAL;
  });

  it("returns undefined for empty-string env var", () => {
    process.env.ASANA_PROJECT_MLRO_CENTRAL = "   ";
    expect(defaultEnvResolver("ASANA_PROJECT_MLRO_CENTRAL")).toBeUndefined();
    delete process.env.ASANA_PROJECT_MLRO_CENTRAL;
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("createProductionAsanaDispatchAdapter — happy path", () => {
  it("creates a task and returns the gid", async () => {
    const createTask = vi.fn(async () => ({ gid: "task-abc123" }));
    const adapter = createProductionAsanaDispatchAdapter({
      createTask,
      projectEnvResolver: () => "proj-mlro-central-gid",
    });
    const result = await adapter({ verdict: verdict(), template: template() });
    expect(result.taskGid).toBe("task-abc123");
    expect(result.skipped).toBeUndefined();
    expect(createTask).toHaveBeenCalledTimes(1);
    const call = createTask.mock.calls[0][0];
    expect(call.name).toMatch(/FREEZE/);
    expect(call.notes).toMatch(/Brain Decision/);
    expect(call.projects).toEqual(["proj-mlro-central-gid"]);
    expect(call.tags).toEqual(["brain/verdict/freeze"]);
  });

  it("fires onDispatch with the full outcome", async () => {
    const onDispatch = vi.fn();
    const adapter = createProductionAsanaDispatchAdapter({
      createTask: async () => ({ gid: "task-xyz" }),
      projectEnvResolver: () => "proj-gid",
      onDispatch,
    });
    await adapter({ verdict: verdict(), template: template() });
    expect(onDispatch).toHaveBeenCalledTimes(1);
    const log = onDispatch.mock.calls[0][0];
    expect(log.verdictId).toBe("t1:e1:1");
    expect(log.tenantId).toBe("t1");
    expect(log.projectEnvKey).toBe("ASANA_PROJECT_MLRO_CENTRAL");
    expect(log.projectGid).toBe("proj-gid");
    expect(log.taskGid).toBe("task-xyz");
    expect(log.skipped).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Skip paths
// ---------------------------------------------------------------------------

describe("createProductionAsanaDispatchAdapter — skip paths", () => {
  it("skips with project_env_unset when resolver returns undefined", async () => {
    const createTask = vi.fn();
    const adapter = createProductionAsanaDispatchAdapter({
      createTask: createTask as unknown as CreateTaskFn,
      projectEnvResolver: () => undefined,
    });
    const result = await adapter({ verdict: verdict(), template: template() });
    expect(result.skipped).toBe("project_env_unset:ASANA_PROJECT_MLRO_CENTRAL");
    expect(result.taskGid).toBeUndefined();
    // Critical invariant: createTask was NEVER called on a missing env var.
    expect(createTask).not.toHaveBeenCalled();
  });

  it("skips with tipping_off_blocked when notes trip the linter", async () => {
    const createTask = vi.fn();
    const adapter = createProductionAsanaDispatchAdapter({
      createTask: createTask as unknown as CreateTaskFn,
      projectEnvResolver: () => "proj-gid",
    });
    const badTemplate = template({
      notes: "We filed an STR about you last week.",
    });
    const result = await adapter({ verdict: verdict(), template: badTemplate });
    expect(result.skipped).toMatch(/tipping_off_blocked/);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("skips with createTask_error when createTask throws", async () => {
    const createTask = vi.fn(async () => {
      throw new Error("asana 429");
    });
    const adapter = createProductionAsanaDispatchAdapter({
      createTask,
      projectEnvResolver: () => "proj-gid",
    });
    const result = await adapter({ verdict: verdict(), template: template() });
    expect(result.skipped).toMatch(/createTask_error:asana 429/);
    expect(result.taskGid).toBeUndefined();
    expect(createTask).toHaveBeenCalledTimes(1);
  });

  it("never throws — all errors become skipped results", async () => {
    const adapter = createProductionAsanaDispatchAdapter({
      createTask: async () => {
        throw { boom: true } as unknown as Error;
      },
      projectEnvResolver: () => "proj-gid",
    });
    await expect(
      adapter({ verdict: verdict(), template: template() })
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Integration with AsanaOrchestrator.dispatchWithTemplate
// ---------------------------------------------------------------------------

describe("AsanaOrchestrator.dispatchWithTemplate + production adapter", () => {
  it("creates exactly one task, idempotent on replay", async () => {
    const createTask = vi.fn(async () => ({ gid: "task-one" }));
    const adapter = createProductionAsanaDispatchAdapter({
      createTask,
      projectEnvResolver: () => "proj-gid",
    });
    const orchestrator = new AsanaOrchestrator({
      templateDispatchAdapter: adapter,
    });

    const first = await orchestrator.dispatchWithTemplate(verdict(), template());
    expect(first.created).toBe(true);
    expect(first.taskGid).toBe("task-one");
    expect(createTask).toHaveBeenCalledTimes(1);

    const second = await orchestrator.dispatchWithTemplate(verdict(), template());
    expect(second.created).toBe(false);
    expect(second.taskGid).toBe("task-one");
    // Critical: createTask was NOT called a second time.
    expect(createTask).toHaveBeenCalledTimes(1);
  });

  it("different verdicts create different tasks", async () => {
    let counter = 0;
    const createTask = vi.fn(async () => ({ gid: `task-${++counter}` }));
    const adapter = createProductionAsanaDispatchAdapter({
      createTask,
      projectEnvResolver: () => "proj-gid",
    });
    const orchestrator = new AsanaOrchestrator({
      templateDispatchAdapter: adapter,
    });

    const a = await orchestrator.dispatchWithTemplate(
      verdict({ id: "t1:e1:1" }),
      template()
    );
    const b = await orchestrator.dispatchWithTemplate(
      verdict({ id: "t1:e2:2" }),
      template()
    );
    expect(a.taskGid).toBe("task-1");
    expect(b.taskGid).toBe("task-2");
    expect(createTask).toHaveBeenCalledTimes(2);
  });

  it("orchestrator caches skip-free results but NOT skip results", async () => {
    let call = 0;
    const createTask = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new Error("transient");
      return { gid: "task-recovered" };
    });
    const adapter = createProductionAsanaDispatchAdapter({
      createTask,
      projectEnvResolver: () => "proj-gid",
    });
    const orchestrator = new AsanaOrchestrator({
      templateDispatchAdapter: adapter,
    });

    const first = await orchestrator.dispatchWithTemplate(verdict(), template());
    expect(first.skippedReason).toMatch(/createTask_error/);
    expect(first.taskGid).toBeUndefined();

    // Second call can still succeed because skip results are NOT cached.
    const second = await orchestrator.dispatchWithTemplate(verdict(), template());
    expect(second.created).toBe(true);
    expect(second.taskGid).toBe("task-recovered");
  });

  it("setTemplateDispatchAdapter swaps behaviour at runtime", async () => {
    const orchestrator = new AsanaOrchestrator();
    // Default adapter should skip with no_template_adapter_configured.
    const first = await orchestrator.dispatchWithTemplate(
      verdict(),
      template()
    );
    expect(first.skippedReason).toBe("no_template_adapter_configured");

    let called = false;
    orchestrator.setTemplateDispatchAdapter(async () => {
      called = true;
      return { taskGid: "runtime-gid" };
    });
    const second = await orchestrator.dispatchWithTemplate(
      verdict({ id: "t1:e1:2" }),
      template()
    );
    expect(called).toBe(true);
    expect(second.taskGid).toBe("runtime-gid");
  });
});
