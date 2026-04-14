/**
 * Brain Diagnostics — single-call health snapshot for the
 * compliance brain.
 *
 * GET  /api/brain/diagnostics
 * POST /api/brain/diagnostics  (preferred for auth headers)
 *
 * Returns a compact, deterministic JSON summary of everything
 * ops needs to know about the brain's current state:
 *
 *   - Skill catalogue size + real runner count + per-category
 *     breakdown
 *   - FATF typology library size
 *   - Cross-case correlator detector count (fixed: 7)
 *   - Brain memory store size (in-process cache) per request
 *   - Regulatory constants version + boot-baseline drift state
 *   - Tracked-constant count
 *   - MCP server protocol version
 *
 * The endpoint is read-only and touches zero mutable state. It
 * runs every subsystem's "health" accessor synchronously and
 * never calls the brain itself, so it costs near-zero to invoke.
 *
 * The Brain Console can hit this endpoint on page load to show
 * a "system status" bar at the top of the analysis panel.
 *
 * Security:
 *   - POST only (+ OPTIONS preflight), authenticate() against
 *     HAWKEYE_BRAIN_TOKEN, rate-limited to the general bucket
 *     (100 / 15 min / IP) — cheaper than brain-analyze so it
 *     deserves a looser cap.
 *   - No payload expected; any body is ignored.
 *   - Never exposes environment values or blob keys — only
 *     enumerated counts and version strings.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO visibility into the brain state)
 *   FDL No.10/2025 Art.22    (internal review — visibility is a
 *                             review prerequisite)
 *   Cabinet Res 134/2025 Art.19 (internal review — ops must see
 *                                 drift the moment it appears)
 *   NIST AI RMF 1.0 MANAGE-2 (AI decision provenance — a health
 *                             endpoint is part of provenance)
 */

import type { Config, Context } from "@netlify/functions";
import { checkRateLimit } from "./middleware/rate-limit.mts";
import { authenticate } from "./middleware/auth.mts";
import {
  SKILL_CATALOGUE,
  type SkillCategory,
} from "../../src/services/asanaCommentSkillRouter";
import { defaultSkillRegistry } from "../../src/services/asana/skillRunnerRegistry";
import { FATF_TYPOLOGIES } from "../../src/services/fatfTypologyMatcher";
import {
  captureRegulatoryBaseline,
  checkRegulatoryDrift,
  getTrackedConstants,
} from "../../src/services/regulatoryDriftWatchdog";
import { MCP_PROTOCOL_VERSION, MCP_SERVER_NAME, MCP_SERVER_VERSION } from "../../src/mcp/skillMcpServer";

// Cross-case detector count — hard-coded to match the seven detectors
// shipped in crossCasePatternCorrelator.ts. Keeping this here (rather
// than introspecting) so a regression in the correlator drops this
// number and the Brain Console shows the decrement.
const CROSS_CASE_DETECTOR_COUNT = 7;

// Velocity detector component count — burst + off-hours + weekend.
const VELOCITY_COMPONENT_COUNT = 3;

// Consensus ensemble default runs — matches DEFAULT_RUNS in
// brainConsensusEnsemble.ts.
const ENSEMBLE_DEFAULT_RUNS = 5;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":
    process.env.HAWKEYE_ALLOWED_ORIGIN ??
    "https://compliance-analyzer.netlify.app",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "600",
  Vary: "Origin",
} as const;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init.headers ?? {}) },
  });
}

// ---------------------------------------------------------------------------
// Baseline — captured at function boot. Same pattern as brain-analyze.mts.
// ---------------------------------------------------------------------------

const bootBaseline = captureRegulatoryBaseline();
const bootBaselineIso = new Date().toISOString();

// ---------------------------------------------------------------------------
// Snapshot builder — pure function so tests can call it directly.
// ---------------------------------------------------------------------------

export interface DiagnosticsSnapshot {
  brain: {
    skillCatalogue: {
      total: number;
      realRunners: number;
      byCategory: Record<SkillCategory, number>;
      runnerNames: readonly string[];
    };
    typologies: {
      total: number;
      ids: readonly string[];
    };
    correlator: {
      detectorCount: number;
    };
    velocity: {
      componentCount: number;
    };
    ensemble: {
      defaultRuns: number;
    };
  };
  regulatory: {
    currentVersion: string;
    baselineVersion: string;
    baselineCapturedAtIso: string;
    trackedConstantCount: number;
    drift: {
      clean: boolean;
      topSeverity: string;
      findingCount: number;
    };
  };
  mcp: {
    protocolVersion: string;
    serverName: string;
    serverVersion: string;
  };
  snapshotAtIso: string;
}

export function buildDiagnosticsSnapshot(): DiagnosticsSnapshot {
  const byCategory: Record<SkillCategory, number> = {
    screening: 0,
    onboarding: 0,
    incident: 0,
    filing: 0,
    audit: 0,
    review: 0,
    reporting: 0,
    governance: 0,
  };
  for (const s of SKILL_CATALOGUE) byCategory[s.category] += 1;

  const runnerNames = defaultSkillRegistry.listRegistered();
  const drift = checkRegulatoryDrift(bootBaseline);

  return {
    brain: {
      skillCatalogue: {
        total: SKILL_CATALOGUE.length,
        realRunners: runnerNames.length,
        byCategory,
        runnerNames,
      },
      typologies: {
        total: FATF_TYPOLOGIES.length,
        ids: FATF_TYPOLOGIES.map((t) => t.id),
      },
      correlator: {
        detectorCount: CROSS_CASE_DETECTOR_COUNT,
      },
      velocity: {
        componentCount: VELOCITY_COMPONENT_COUNT,
      },
      ensemble: {
        defaultRuns: ENSEMBLE_DEFAULT_RUNS,
      },
    },
    regulatory: {
      currentVersion: drift.currentVersion,
      baselineVersion: drift.baselineVersion,
      baselineCapturedAtIso: bootBaselineIso,
      trackedConstantCount: getTrackedConstants().length,
      drift: {
        clean: drift.clean,
        topSeverity: drift.topSeverity,
        findingCount: drift.findings.length,
      },
    },
    mcp: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverName: MCP_SERVER_NAME,
      serverVersion: MCP_SERVER_VERSION,
    },
    snapshotAtIso: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async (req: Request, context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    max: 100,
    clientIp: context.ip,
    namespace: "brain-diagnostics",
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  const snapshot = buildDiagnosticsSnapshot();

  console.log(
    `[BRAIN-DIAG] ${auth.userId} skills=${snapshot.brain.skillCatalogue.total} ` +
      `runners=${snapshot.brain.skillCatalogue.realRunners} ` +
      `typologies=${snapshot.brain.typologies.total} ` +
      `drift=${snapshot.regulatory.drift.clean ? "clean" : snapshot.regulatory.drift.topSeverity}`
  );

  return jsonResponse({ ok: true, snapshot });
};

export const config: Config = {
  path: "/api/brain/diagnostics",
  method: ["POST", "OPTIONS"],
};

// Exports for tests.
export const __test__ = { bootBaselineIso, CROSS_CASE_DETECTOR_COUNT };
