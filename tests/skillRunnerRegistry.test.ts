/**
 * Skill runner registry tests.
 *
 * Covers:
 *   - Every default runner produces a real result (not a stub)
 *   - Unknown skills fall back to the stub
 *   - Runners that need features degrade gracefully with a
 *     "missing context" reply rather than crashing
 *   - FDL Art.29 tipping-off linter suppresses critical/high replies
 *   - Exceptions inside a runner are caught and reported
 *   - Custom runners can be registered / unregistered
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  SkillRunnerRegistry,
  makeDefaultSkillRegistry,
  type SkillRunnerContext,
} from "../src/services/asana/skillRunnerRegistry";
import { routeAsanaComment } from "../src/services/asanaCommentSkillRouter";
import { InMemoryBrainMemoryStore } from "../src/services/brainMemoryStore";
import type { StrFeatures } from "../src/services/predictiveStr";

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

function ctx(overrides: Partial<SkillRunnerContext> = {}): SkillRunnerContext {
  return {
    tenantId: "t1",
    userId: "u1",
    features: f(),
    entityRef: "entity-42",
    ...overrides,
  };
}

function parse(text: string) {
  const r = routeAsanaComment(text);
  expect(r.ok).toBe(true);
  return r.invocation!;
}

// ---------------------------------------------------------------------------
// Registry primitives
// ---------------------------------------------------------------------------

describe("SkillRunnerRegistry primitives", () => {
  let registry: SkillRunnerRegistry;

  beforeEach(() => {
    registry = new SkillRunnerRegistry();
  });

  it("register + has + listRegistered", () => {
    registry.register("risk-score", () => ({
      skillName: "risk-score",
      reply: "ok",
      citation: "c",
      real: true,
    }));
    expect(registry.has("risk-score")).toBe(true);
    expect(registry.has("RISK-SCORE")).toBe(true); // case-insensitive
    expect(registry.listRegistered()).toContain("risk-score");
  });

  it("unregister removes a runner", () => {
    registry.register("x", () => ({
      skillName: "x",
      reply: "",
      citation: "",
      real: true,
    }));
    registry.unregister("x");
    expect(registry.has("x")).toBe(false);
  });

  it("execute falls back to stub for unknown skill", async () => {
    // There is no runner for /audit in an empty registry.
    const result = await registry.execute(parse("/audit"), ctx());
    expect(result.real).toBe(false);
    expect(result.reply).toMatch(/stub acknowledgement/i);
  });

  it("execute reports runner exceptions", async () => {
    registry.register("risk-score", () => {
      throw new Error("boom");
    });
    const result = await registry.execute(parse("/risk-score ACME"), ctx());
    expect(result.real).toBe(true);
    expect(result.reply).toMatch(/execution error/);
    expect(result.reply).toMatch(/boom/);
    expect(result.data?.error).toBe(true);
  });

  it("execute FDL Art.29 linter suppresses tipping-off replies", async () => {
    registry.register("x", () => ({
      skillName: "x",
      reply: "We filed an STR about you.",
      citation: "FDL Art.29",
      real: true,
    }));
    // Parser needs a real skill name — pretend x is registered AND in
    // the catalogue by routing a known name but overriding the runner.
    registry.register("brain-status", () => ({
      skillName: "brain-status",
      reply: "We filed an STR about this subject.",
      citation: "FDL Art.29",
      real: true,
    }));
    const result = await registry.execute(parse("/brain-status"), ctx());
    expect(result.real).toBe(true);
    expect(result.reply).toMatch(/tipping-off guard blocked/);
    expect(result.data?.tippingOffBlocked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Default registry runners
// ---------------------------------------------------------------------------

describe("makeDefaultSkillRegistry — real runners", () => {
  let registry: SkillRunnerRegistry;

  beforeEach(() => {
    registry = makeDefaultSkillRegistry();
  });

  it("registers 8 default runners", () => {
    const names = registry.listRegistered();
    expect(names).toContain("risk-score");
    expect(names).toContain("pep-check");
    expect(names).toContain("tfs-check");
    expect(names).toContain("brain-status");
    expect(names).toContain("cross-case");
    expect(names).toContain("brain-analyze");
    expect(names).toContain("ubo-trace");
    expect(names).toContain("four-eyes-status");
  });

  it("/risk-score produces a real probability + band", async () => {
    const result = await registry.execute(parse("/risk-score ACME"), ctx());
    expect(result.real).toBe(true);
    expect(result.reply).toMatch(/probability:/);
    expect(result.reply).toMatch(/band:/);
    expect(typeof result.data?.probability).toBe("number");
    expect(["low", "medium", "high", "critical"]).toContain(
      result.data?.band as string
    );
  });

  it("/risk-score degrades when features context is missing", async () => {
    const result = await registry.execute(
      parse("/risk-score ACME"),
      { tenantId: "t1", userId: "u1" }
    );
    expect(result.real).toBe(true);
    expect(result.reply).toMatch(/needs an StrFeatures vector/);
    expect(result.data?.missingContext).toBe("features");
  });

  it("/pep-check detects a PEP", async () => {
    const result = await registry.execute(
      parse("/pep-check target"),
      ctx({ features: f({ isPep: true }) })
    );
    expect(result.real).toBe(true);
    expect(result.data?.isPep).toBe(true);
    expect(result.data?.eddRequired).toBe(true);
    expect(result.reply).toMatch(/Cabinet Res 134\/2025 Art\.?14/);
  });

  it("/pep-check returns clean result when not a PEP", async () => {
    const result = await registry.execute(
      parse("/pep-check target"),
      ctx()
    );
    expect(result.data?.isPep).toBe(false);
    expect(result.reply).toMatch(/No PEP signal/);
  });

  it("/tfs-check classifies clear vs potential vs confirmed", async () => {
    const clear = await registry.execute(
      parse("/tfs-check target"),
      ctx({ features: f({ sanctionsMatchScore: 0.1 }) })
    );
    expect(clear.data?.status).toBe("clear");

    const potential = await registry.execute(
      parse("/tfs-check target"),
      ctx({ features: f({ sanctionsMatchScore: 0.6 }) })
    );
    expect(potential.data?.status).toBe("potential");

    const confirmed = await registry.execute(
      parse("/tfs-check target"),
      ctx({ features: f({ sanctionsMatchScore: 0.95 }) })
    );
    expect(confirmed.data?.status).toBe("confirmed");
    // The reply mentions the 24-hour window and cites Cabinet Res 74/2020
    // but stays tipping-off-linter-safe (no direct regulator names).
    expect(confirmed.reply).toMatch(/24[- ]?hour/);
    expect(confirmed.reply).toMatch(/Cabinet Res 74\/2020/);
  });

  it("/brain-status returns catalogue + typology + detector counts", async () => {
    const result = await registry.execute(parse("/brain-status"), ctx());
    expect(result.data?.skillCatalogueSize).toBe(46);
    expect(result.data?.typologyCount).toBe(25);
    expect(result.data?.detectorCount).toBe(7);
  });

  it("/cross-case reports zero findings when memory is empty", async () => {
    const memory = new InMemoryBrainMemoryStore();
    const result = await registry.execute(
      parse("/cross-case"),
      ctx({ memory })
    );
    expect(result.data?.caseCount).toBe(0);
    expect(result.data?.findings).toBe(0);
  });

  it("/cross-case reports findings when cases share a wallet", async () => {
    const memory = new InMemoryBrainMemoryStore();
    memory.record({
      caseId: "c1",
      tenantId: "t1",
      openedAt: "2026-04-14T12:00:00.000Z",
      entityRef: "e1",
      wallets: ["0xabc"],
    });
    memory.record({
      caseId: "c2",
      tenantId: "t1",
      openedAt: "2026-04-14T12:05:00.000Z",
      entityRef: "e2",
      wallets: ["0xabc"],
    });
    const result = await registry.execute(
      parse("/cross-case"),
      ctx({ memory })
    );
    expect(result.data?.caseCount).toBe(2);
    expect(result.data?.findings as number).toBeGreaterThanOrEqual(1);
    expect(result.reply).toMatch(/wallet-reuse/);
  });

  it("/brain-analyze reports typology matches", async () => {
    const result = await registry.execute(
      parse("/brain-analyze target"),
      ctx({ features: f({ sanctionsMatchScore: 0.95 }) })
    );
    expect(result.real).toBe(true);
    expect(result.data?.matched as number).toBeGreaterThanOrEqual(1);
    expect(result.data?.topSeverity).toBe("critical");
  });

  it("/brain-analyze reports zero matches for a clean profile", async () => {
    const result = await registry.execute(
      parse("/brain-analyze target"),
      ctx()
    );
    expect(result.data?.matched).toBe(0);
  });

  it("/ubo-trace reports zero rings for an empty memory", async () => {
    const memory = new InMemoryBrainMemoryStore();
    const result = await registry.execute(
      parse("/ubo-trace target"),
      ctx({ memory })
    );
    expect(result.data?.rings).toBe(0);
  });

  it("/four-eyes-status returns a live summary without needing context", async () => {
    const result = await registry.execute(
      parse("/four-eyes-status"),
      ctx()
    );
    expect(result.real).toBe(true);
    expect(result.reply).toMatch(/Cabinet Res 134\/2025 Art\.?12-14/);
    expect(result.reply).toMatch(/sanctions_freeze/);
  });

  it("/caveman full intensity returns terse single-line output under 600 chars", async () => {
    const result = await registry.execute(
      parse("/caveman ent1"),
      ctx({ features: f({ sanctionsMatchScore: 0.8, isPep: true }) })
    );
    expect(result.real).toBe(true);
    expect(result.reply.length).toBeLessThanOrEqual(600);
    expect(result.reply).toMatch(/ent1/);
    expect(result.reply).toMatch(/conf=/);
    expect(result.reply).toMatch(/factors=\[/);
    expect(result.data?.intensity).toBe("full");
    expect(result.data?.maxLength).toBe(600);
  });

  it("/caveman ultra intensity hard-caps at 120 chars", async () => {
    const result = await registry.execute(
      parse("/caveman ent1 ultra"),
      ctx({ features: f({ sanctionsMatchScore: 0.9 }) })
    );
    expect(result.real).toBe(true);
    expect(result.reply.length).toBeLessThanOrEqual(120);
    expect(result.data?.intensity).toBe("ultra");
    // Ultra uses the 3-letter verdict code.
    expect(result.reply).toMatch(/^(FRZ|ESC|FLG|PAS)/);
  });

  it("/caveman lite intensity hard-caps at 280 chars", async () => {
    const result = await registry.execute(
      parse("/caveman ent1 lite"),
      ctx({ features: f({ sanctionsMatchScore: 0.9 }) })
    );
    expect(result.real).toBe(true);
    expect(result.reply.length).toBeLessThanOrEqual(280);
    expect(result.data?.intensity).toBe("lite");
    expect(result.reply).toMatch(/FDL/);
  });

  it("/caveman defaults to full when intensity is omitted", async () => {
    const result = await registry.execute(
      parse("/caveman ent1"),
      ctx()
    );
    expect(result.data?.intensity).toBe("full");
  });

  it("/caveman defaults to full when intensity is unrecognized", async () => {
    const result = await registry.execute(
      parse("/caveman ent1 banana"),
      ctx()
    );
    expect(result.data?.intensity).toBe("full");
  });

  it("/caveman verdict code is one of FRZ/ESC/FLG/PAS", async () => {
    const result = await registry.execute(
      parse("/caveman ent1"),
      ctx({ features: f({ sanctionsMatchScore: 0.95, isPep: true }) })
    );
    expect(["FRZ", "ESC", "FLG", "PAS"]).toContain(result.data?.code);
  });

  it("/caveman degrades with a clear message when features context is missing", async () => {
    const result = await registry.execute(
      parse("/caveman ent1"),
      { tenantId: "t1", userId: "u1" }
    );
    expect(result.real).toBe(true);
    expect(result.reply).toMatch(/needs an StrFeatures vector/);
  });

  it("/caveman reply is a single-line string (no newlines)", async () => {
    const result = await registry.execute(
      parse("/caveman ent1 full"),
      ctx({ features: f({ sanctionsMatchScore: 0.9 }) })
    );
    expect(result.reply.includes("\n")).toBe(false);
  });

  it("/caveman is deterministic — same input returns same output", async () => {
    const a = await registry.execute(
      parse("/caveman ent1"),
      ctx({ features: f({ sanctionsMatchScore: 0.7 }) })
    );
    const b = await registry.execute(
      parse("/caveman ent1"),
      ctx({ features: f({ sanctionsMatchScore: 0.7 }) })
    );
    expect(a.reply).toBe(b.reply);
    expect(a.data?.confidence).toBe(b.data?.confidence);
  });
});
