/**
 * Four-Eyes subtask creator tests.
 */
import { describe, it, expect, vi } from "vitest";
import {
  createFourEyesSubtaskCreator,
  buildFourEyesSubtaskBody,
  buildFourEyesSubtaskTitle,
  type FourEyesSubtaskInput,
} from "../src/services/asana/fourEyesSubtaskCreator";

function input(
  overrides: Partial<FourEyesSubtaskInput> = {}
): FourEyesSubtaskInput {
  return {
    parentTaskGid: "parent-1234",
    decisionType: "str_filing",
    approvalCount: 0,
    requiredCount: 2,
    missingRoles: ["compliance_officer", "mlro"],
    hoursRemaining: 240,
    regulatoryRef: "FDL No.10/2025 Art.26-27",
    ...overrides,
  };
}

describe("buildFourEyesSubtaskBody", () => {
  it("includes approval count, regulatory basis, and role checklist", () => {
    const body = buildFourEyesSubtaskBody(input());
    expect(body).toMatch(/Four-Eyes Approval Gate/);
    expect(body).toMatch(/Decision type:\*\* str_filing/);
    expect(body).toMatch(/Approvals:\*\* 0\/2/);
    expect(body).toMatch(/FDL No\.10\/2025 Art\.?26-27/);
    expect(body).toMatch(/- \[ \] compliance_officer/);
    expect(body).toMatch(/- \[ \] mlro/);
  });

  it("shows 'all signed off' when no roles are missing", () => {
    const body = buildFourEyesSubtaskBody(input({ missingRoles: [] }));
    expect(body).toMatch(/all required roles have signed off/);
  });

  it("always carries FDL Art.29 tipping-off footer", () => {
    const body = buildFourEyesSubtaskBody(input());
    expect(body).toMatch(/Art\.?29/);
  });
});

describe("buildFourEyesSubtaskTitle", () => {
  it("uses 🚨 for sanctions_freeze", () => {
    expect(
      buildFourEyesSubtaskTitle(input({ decisionType: "sanctions_freeze" }))
    ).toMatch(/🚨/);
  });
  it("uses ⚠ for other decision types", () => {
    expect(buildFourEyesSubtaskTitle(input({ decisionType: "str_filing" }))).toMatch(
      /⚠/
    );
  });
  it("reports missing approval count", () => {
    expect(
      buildFourEyesSubtaskTitle(input({ approvalCount: 1, requiredCount: 2 }))
    ).toMatch(/1 approval/);
  });
});

// ---------------------------------------------------------------------------
// createFourEyesSubtaskCreator
// ---------------------------------------------------------------------------

describe("createFourEyesSubtaskCreator", () => {
  it("creates the subtask and returns the gid", async () => {
    const createTask = vi.fn(async () => ({ gid: "subtask-abc" }));
    const creator = createFourEyesSubtaskCreator({ createTask });
    const result = await creator(input());
    expect(result.subtaskGid).toBe("subtask-abc");
    expect(result.skipped).toBeUndefined();
    expect(createTask).toHaveBeenCalledTimes(1);
    const call = createTask.mock.calls[0][0];
    expect(call.name).toMatch(/Four-Eyes Gate/);
    expect(call.notes).toMatch(/str_filing/);
    // Subtasks MUST NOT be created in a separate project — Asana
    // inherits the parent's project via the parent gid.
    expect(call.projects).toEqual([]);
    expect(call.tags).toContain("brain/four-eyes");
    expect(call.tags).toContain("brain/decision/str_filing");
  });

  it("returns missing_parent_gid when parent gid is empty", async () => {
    const createTask = vi.fn();
    const creator = createFourEyesSubtaskCreator({
      createTask: createTask as unknown as typeof createTask,
    });
    const result = await creator(input({ parentTaskGid: "" }));
    expect(result.skipped).toBe("missing_parent_gid");
    expect(createTask).not.toHaveBeenCalled();
  });

  it("honours the idempotency set — replay returns already_created", async () => {
    const createTask = vi.fn(async () => ({ gid: "subtask-one" }));
    const seen = new Map<string, string>();
    const creator = createFourEyesSubtaskCreator({
      createTask,
      idempotency: {
        has: (k) => seen.has(k),
        set: (k, v) => {
          seen.set(k, v);
        },
      },
    });
    const first = await creator(input());
    const second = await creator(input());
    expect(first.subtaskGid).toBe("subtask-one");
    expect(second.skipped).toBe("already_created");
    expect(createTask).toHaveBeenCalledTimes(1);
  });

  it("different parent gids create different subtasks", async () => {
    let counter = 0;
    const createTask = vi.fn(async () => ({ gid: `s-${++counter}` }));
    const seen = new Map<string, string>();
    const creator = createFourEyesSubtaskCreator({
      createTask,
      idempotency: {
        has: (k) => seen.has(k),
        set: (k, v) => {
          seen.set(k, v);
        },
      },
    });
    const a = await creator(input({ parentTaskGid: "parent-a" }));
    const b = await creator(input({ parentTaskGid: "parent-b" }));
    expect(a.subtaskGid).toBe("s-1");
    expect(b.subtaskGid).toBe("s-2");
    expect(createTask).toHaveBeenCalledTimes(2);
  });

  it("returns createTask_error and never throws on failure", async () => {
    const creator = createFourEyesSubtaskCreator({
      createTask: async () => {
        throw new Error("asana 500");
      },
    });
    const result = await creator(input());
    expect(result.skipped).toMatch(/createTask_error:asana 500/);
  });

  it("fires the onCreate hook on success and failure", async () => {
    const onCreate = vi.fn();
    const creator = createFourEyesSubtaskCreator({
      createTask: async () => ({ gid: "subtask-ok" }),
      onCreate,
    });
    await creator(input());
    expect(onCreate).toHaveBeenCalledTimes(1);
    const log = onCreate.mock.calls[0][0];
    expect(log.parentTaskGid).toBe("parent-1234");
    expect(log.subtaskGid).toBe("subtask-ok");
    expect(log.skipped).toBeNull();
  });
});
