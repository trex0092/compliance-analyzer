/**
 * Brain diagnostics snapshot tests.
 *
 * Focuses on buildDiagnosticsSnapshot — the pure synchronous
 * function. The HTTP handler is integration-tested through
 * Netlify at runtime and is not re-run here.
 */
import { describe, it, expect } from "vitest";
import {
  buildDiagnosticsSnapshot,
} from "../netlify/functions/brain-diagnostics.mts";
import { SKILL_CATALOGUE } from "../src/services/asanaCommentSkillRouter";
import { FATF_TYPOLOGIES } from "../src/services/fatfTypologyMatcher";
import { getTrackedConstants } from "../src/services/regulatoryDriftWatchdog";
import { defaultSkillRegistry } from "../src/services/asana/skillRunnerRegistry";

describe("buildDiagnosticsSnapshot", () => {
  const snap = buildDiagnosticsSnapshot();

  it("reports the full skill catalogue size", () => {
    expect(snap.brain.skillCatalogue.total).toBe(SKILL_CATALOGUE.length);
  });

  it("real runner count matches defaultSkillRegistry", () => {
    expect(snap.brain.skillCatalogue.realRunners).toBe(
      defaultSkillRegistry.listRegistered().length
    );
  });

  it("real runner count is at least 9 (the runners shipped so far)", () => {
    expect(snap.brain.skillCatalogue.realRunners).toBeGreaterThanOrEqual(9);
  });

  it("runner names include every real runner from the 9 ships", () => {
    const names = snap.brain.skillCatalogue.runnerNames;
    for (const expected of [
      "risk-score",
      "pep-check",
      "tfs-check",
      "brain-status",
      "cross-case",
      "brain-analyze",
      "ubo-trace",
      "four-eyes-status",
      "caveman",
    ]) {
      expect(names, `missing runner ${expected}`).toContain(expected);
    }
  });

  it("skills are counted across every category", () => {
    const totalByCategory = Object.values(snap.brain.skillCatalogue.byCategory).reduce(
      (a, b) => a + b,
      0
    );
    expect(totalByCategory).toBe(SKILL_CATALOGUE.length);
  });

  it("reports FATF typology library size matching the library", () => {
    expect(snap.brain.typologies.total).toBe(FATF_TYPOLOGIES.length);
    expect(snap.brain.typologies.ids.length).toBe(FATF_TYPOLOGIES.length);
  });

  it("correlator detector count is 7 (fixed)", () => {
    expect(snap.brain.correlator.detectorCount).toBe(7);
  });

  it("velocity component count is 3 (burst + off-hours + weekend)", () => {
    expect(snap.brain.velocity.componentCount).toBe(3);
  });

  it("ensemble default runs is 5", () => {
    expect(snap.brain.ensemble.defaultRuns).toBe(5);
  });

  it("regulatory block carries version + baseline + tracked-constant count", () => {
    expect(snap.regulatory.currentVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(snap.regulatory.baselineVersion).toBe(snap.regulatory.currentVersion);
    expect(snap.regulatory.baselineCapturedAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snap.regulatory.trackedConstantCount).toBe(
      getTrackedConstants().length
    );
  });

  it("drift is clean against the boot baseline (same instance)", () => {
    expect(snap.regulatory.drift.clean).toBe(true);
    expect(snap.regulatory.drift.topSeverity).toBe("none");
    expect(snap.regulatory.drift.findingCount).toBe(0);
  });

  it("MCP block reports the protocol version + server name/version", () => {
    expect(snap.mcp.protocolVersion).toBe("2024-11-05");
    expect(snap.mcp.serverName).toBe("hawkeye-compliance-brain");
    expect(snap.mcp.serverVersion).toBe("1.0.0");
  });

  it("snapshot ISO timestamp is present and parseable", () => {
    expect(Number.isFinite(Date.parse(snap.snapshotAtIso))).toBe(true);
  });

  it("re-invocation produces stable structural values", () => {
    const a = buildDiagnosticsSnapshot();
    const b = buildDiagnosticsSnapshot();
    expect(a.brain.skillCatalogue.total).toBe(b.brain.skillCatalogue.total);
    expect(a.brain.typologies.total).toBe(b.brain.typologies.total);
    expect(a.regulatory.currentVersion).toBe(b.regulatory.currentVersion);
    // snapshotAtIso differs (different Date.now), which is expected.
  });
});
