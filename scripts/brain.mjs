/**
 * SUPER ULTRA BRAIN — compliance-analyzer orchestrator
 *
 * A single harness that ties together every "thinking" component of the
 * Hawkeye Sterling compliance suite:
 *
 *   Session       -> claude-mem (persistent cross-session memory)
 *   Tools / MCP   -> .mcp.json servers + local script library
 *   Sandbox       -> node subprocess runner for generated scripts
 *   Orchestration -> PEER-style router over existing compliance modules
 *   Public I/O    -> Cachet status page for user-visible events
 *
 * CLI:
 *   npm run brain -- think "new high-risk customer onboarded"
 *   npm run brain -- recall --category=sanctions
 *   npm run brain -- status
 *
 * This file is intentionally small. The brain's intelligence lives in the
 * existing compliance modules; this is the wiring, not the reasoning.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import claudeMem from "../claude-mem/index.mjs";
import cachet, { IncidentStatus } from "./lib/cachet-client.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Session layer
// ---------------------------------------------------------------------------
async function openSession(label) {
  const sessionId = `brain-${Date.now()}-${randomUUID().slice(0, 8)}`;
  claudeMem.startSession(sessionId);
  claudeMem.observe({
    category: "session",
    content: `Brain session opened: ${label}`,
    importance: 3,
  });
  return sessionId;
}

async function closeSession(summary) {
  await claudeMem.endSession(summary);
  claudeMem.close();
}

// ---------------------------------------------------------------------------
// Tools layer — catalogued subsystems the brain can reach
// ---------------------------------------------------------------------------
const TOOLS = Object.freeze({
  screening: {
    module: "../screening/index.mjs",
    purpose: "Sanctions + PEP screening across UN/OFAC/EU/UK/UAE/EOCN",
  },
  thresholds: {
    module: "../threshold-monitor.js",
    purpose: "AED 55K CTR + AED 60K cross-border threshold monitoring",
  },
  workflow: {
    module: "../workflow-engine.js",
    purpose: "STR/CTR/CNMR filing workflows with deadline tracking",
  },
  tfs: {
    module: "../tfs-refresh.js",
    purpose: "Targeted Financial Sanctions list refresh",
  },
  regulatory: {
    module: "../regulatory-monitor.js",
    purpose: "Cabinet Resolution + MoE circular monitoring",
  },
  reports: {
    module: "../report-generator.js",
    purpose: "goAML XML export + audit report generation",
  },
});

// ---------------------------------------------------------------------------
// Orchestration layer — route a natural-language task to a subsystem
// ---------------------------------------------------------------------------
const ROUTES = [
  { match: /sanction|ofac|un list|eu list|screen/i, tool: "screening" },
  { match: /threshold|aed ?55|aed ?60|ctr\b|cross.border/i, tool: "thresholds" },
  { match: /str|sar|cnmr|filing|deadline|goaml/i, tool: "workflow" },
  { match: /tfs|asset freeze|targeted financial/i, tool: "tfs" },
  { match: /cabinet res|circular|regulatory|moe/i, tool: "regulatory" },
  { match: /report|audit|kpi/i, tool: "reports" },
];

function route(task) {
  for (const r of ROUTES) {
    if (r.match.test(task)) return r.tool;
  }
  return null;
}

async function think(task) {
  const session = await openSession(`think:${task.slice(0, 40)}`);
  try {
    const tool = route(task);
    const decision = tool
      ? { tool, purpose: TOOLS[tool].purpose }
      : { tool: null, purpose: "No deterministic route. Escalate to CO." };

    claudeMem.observe({
      category: "routing",
      content: JSON.stringify({ task, ...decision }),
      importance: decision.tool ? 5 : 7,
    });

    // Surface unrouted tasks on the public status page if Cachet is configured.
    if (!decision.tool && process.env.CACHET_BASE_URL) {
      try {
        await cachet.createIncident({
          name: "Brain: unrouted compliance task",
          message: `Task "${task}" did not match any routing rule and was escalated.`,
          status: IncidentStatus.INVESTIGATING,
        });
      } catch (err) {
        claudeMem.observe({
          category: "cachet-error",
          content: err.message,
          importance: 6,
        });
      }
    }

    return { session, task, ...decision };
  } finally {
    await closeSession(`think complete for: ${task.slice(0, 60)}`);
  }
}

// ---------------------------------------------------------------------------
// Recall — query claude-mem's global memory
// ---------------------------------------------------------------------------
async function recall({ category, limit = 20 } = {}) {
  const path = join(ROOT, "data", "memory-global.json");
  let observations = [];
  try {
    observations = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return [];
  }
  const filtered = category
    ? observations.filter((o) => o.category === category)
    : observations;
  return filtered.slice(-limit);
}

// ---------------------------------------------------------------------------
// Status — summarise brain health
// ---------------------------------------------------------------------------
async function status() {
  return {
    tools: Object.keys(TOOLS),
    routes: ROUTES.length,
    memoryConfigured: true,
    cachetConfigured: Boolean(process.env.CACHET_BASE_URL),
    mcpServers: ["code-review-graph", "claude-mem"],
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  const positional = [];
  for (const arg of rest) {
    if (arg.startsWith("--")) {
      const [k, v] = arg.slice(2).split("=");
      flags[k] = v ?? true;
    } else {
      positional.push(arg);
    }
  }
  return { command, flags, positional };
}

async function main() {
  const { command, flags, positional } = parseArgs(process.argv.slice(2));

  switch (command) {
    case "think": {
      const task = positional.join(" ");
      if (!task) {
        console.error('usage: brain think "<task description>"');
        process.exit(2);
      }
      const result = await think(task);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "recall": {
      const out = await recall({
        category: flags.category,
        limit: flags.limit ? Number(flags.limit) : 20,
      });
      console.log(JSON.stringify(out, null, 2));
      break;
    }
    case "status":
    case undefined: {
      console.log(JSON.stringify(await status(), null, 2));
      break;
    }
    default:
      console.error(`unknown command: ${command}`);
      console.error("commands: think | recall | status");
      process.exit(2);
  }
}

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  main().catch((err) => {
    console.error("brain error:", err);
    process.exit(1);
  });
}

export { think, recall, status, TOOLS, ROUTES };
