/**
 * SUPER ULTRA BRAIN routing + status tests.
 *
 * The brain is a small wiring layer over claude-mem + compliance
 * subsystems. These tests lock in its routing decisions so that adding
 * new regulations never silently changes how tasks are dispatched.
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error — brain is a .mjs module with no type declarations
import { status, TOOLS, ROUTES } from "../scripts/brain.mjs";

describe("SUPER ULTRA BRAIN", () => {
  it("exposes a stable tool catalogue", async () => {
    const s = await status();
    expect(s.tools).toContain("screening");
    expect(s.tools).toContain("workflow");
    expect(s.tools).toContain("thresholds");
    expect(s.mcpServers).toContain("claude-mem");
    expect(s.mcpServers).toContain("code-review-graph");
  });

  it("has a purpose for every tool", () => {
    for (const [name, def] of Object.entries(TOOLS as Record<string, { purpose: string }>)) {
      expect(def.purpose, `tool ${name} missing purpose`).toBeTruthy();
    }
  });

  it("routes sanctions tasks to screening", () => {
    const r = (ROUTES as Array<{ match: RegExp; tool: string }>).find((r) =>
      r.match.test("OFAC sanctions match"),
    );
    expect(r?.tool).toBe("screening");
  });

  it("routes AED 55K cash tasks to threshold monitor", () => {
    const r = (ROUTES as Array<{ match: RegExp; tool: string }>).find((r) =>
      r.match.test("cash transaction AED 55000"),
    );
    expect(r?.tool).toBe("thresholds");
  });

  it("routes STR filing tasks to workflow", () => {
    const r = (ROUTES as Array<{ match: RegExp; tool: string }>).find((r) =>
      r.match.test("file STR with goAML"),
    );
    expect(r?.tool).toBe("workflow");
  });
});
