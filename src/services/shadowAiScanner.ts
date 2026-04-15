/**
 * Shadow AI Scanner — SaaS + import-level discovery scanner that
 * detects unauthorised AI tooling brought into the repo or the
 * running environment.
 *
 * Why this exists:
 *   EU AI Act Art.17 (operator obligations) + NIST AI RMF GOVERN-1.4
 *   expect organisations to maintain a complete inventory of AI
 *   systems in use and to detect "shadow AI" — tools that staff
 *   adopt without governance approval. The self-audit flag
 *   `hasShadowAiScan` was FALSE until this module landed.
 *
 *   This module is the pure scanner. It takes a snapshot of:
 *     - Imports across the TypeScript source tree
 *     - `package.json` dependencies
 *     - Vendored submodules under `vendor/`
 *     - Runtime-detected AI SDK calls (from a log feed — optional)
 *
 *   And returns a ShadowAiReport with:
 *     - Every AI SDK detected
 *     - Whether it's on the approved tool list (`CLAUDE.md` §6)
 *     - Severity (approved / tolerated / unknown / prohibited)
 *     - Plain-English findings
 *
 *   Pure function — no filesystem / network calls. Callers inject
 *   the snapshots. Tests inject static fixtures.
 *
 * Regulatory basis:
 *   EU AI Act Art.17          (operator obligations — inventory)
 *   NIST AI RMF 1.0 GOVERN-1.4 (AI system inventory)
 *   ISO/IEC 42001 A.5.4       (approved tool list)
 *   FDL No.10/2025 Art.20-22  (CO operational visibility)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShadowSeverity = 'approved' | 'tolerated' | 'unknown' | 'prohibited';

export interface DetectedAiTool {
  /** Package or vendor name (e.g. '@anthropic-ai/sdk', 'vendor/claude-mem'). */
  name: string;
  /** How the tool surfaced (import / package.json / vendor / runtime log). */
  source: 'import' | 'package_json' | 'vendor_submodule' | 'runtime';
  /** Where the first hit came from (file path / log line). */
  location: string;
  /** Version if known. */
  version?: string;
}

export interface ShadowAiFinding {
  tool: DetectedAiTool;
  severity: ShadowSeverity;
  onApprovedList: boolean;
  reason: string;
  regulatory: string;
}

export interface ShadowAiReport {
  schemaVersion: 1;
  scannedAtIso: string;
  totalDetected: number;
  approved: number;
  tolerated: number;
  unknown: number;
  prohibited: number;
  findings: readonly ShadowAiFinding[];
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Approved tool list — mirrors CLAUDE.md §6 "Skill Dispatch Table"
// + the vendored agent frameworks + the Anthropic SDK.
// ---------------------------------------------------------------------------

export const APPROVED_AI_TOOLS: readonly string[] = [
  '@anthropic-ai/sdk',
  'anthropic',
  'tsx',
  'vitest',
  // vendored frameworks (from CLAUDE.md Integrated Agent Frameworks)
  'vendor/openai-agents-python',
  'vendor/microsoft-agent-framework',
  'vendor/open-multi-agent',
  'vendor/agentUniverse',
  'vendor/ChatDev',
  'vendor/OpenMAIC',
  'vendor/oh-my-claudecode',
  'vendor/multi-agent-shogun',
  'vendor/everything-claude-code',
  'vendor/wshobson-agents',
  'vendor/claude-code-system-prompts',
  'vendor/claude-seo',
  'vendor/quant-trading',
  'vendor/google-automl',
  'vendor/friday-tony-stark-demo',
  'vendor/fastapi',
  'vendor/airflow',
  'vendor/tooljet',
  'vendor/xyflow',
  'vendor/supersonic',
  'vendor/bolt',
  'vendor/dr-claw',
  'vendor/skill-vault',
  'vendor/ruflo',
  'vendor/claudesidian',
  'vendor/claude-mem',
  'vendor/MiroFish',
  'vendor/multi-agent-ai-system',
  'vendor/oca-reporting-engine',
];

/**
 * Prohibited SDKs — LLM providers that would route PII outside the
 * EU/UAE data residency zone without prior approval. Hard-blocked
 * unless explicitly overridden with MLRO sign-off.
 */
export const PROHIBITED_AI_TOOLS: readonly string[] = [
  // Intentionally empty: default posture is that NO SDK is pre-
  // prohibited. A real deployment configures this per tenant.
];

/** Tolerated SDKs — allowed but flagged for quarterly review. */
export const TOLERATED_AI_TOOLS: readonly string[] = ['genaiscript', 'claude-mem'];

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

function classify(tool: DetectedAiTool): {
  severity: ShadowSeverity;
  onApprovedList: boolean;
  reason: string;
} {
  const name = tool.name.toLowerCase();
  if (PROHIBITED_AI_TOOLS.map((x) => x.toLowerCase()).includes(name)) {
    return {
      severity: 'prohibited',
      onApprovedList: false,
      reason: `"${tool.name}" is on the prohibited list. Remove or request MLRO override.`,
    };
  }
  if (APPROVED_AI_TOOLS.map((x) => x.toLowerCase()).includes(name)) {
    return {
      severity: 'approved',
      onApprovedList: true,
      reason: `"${tool.name}" is on the approved list (CLAUDE.md §6).`,
    };
  }
  if (TOLERATED_AI_TOOLS.map((x) => x.toLowerCase()).includes(name)) {
    return {
      severity: 'tolerated',
      onApprovedList: false,
      reason: `"${tool.name}" is tolerated but flagged for quarterly review.`,
    };
  }
  return {
    severity: 'unknown',
    onApprovedList: false,
    reason:
      `"${tool.name}" is not on the approved or tolerated list. MLRO must classify ` +
      `before the next deploy.`,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function scanShadowAi(
  detected: readonly DetectedAiTool[],
  now: () => Date = () => new Date()
): ShadowAiReport {
  const findings: ShadowAiFinding[] = detected.map((t) => {
    const c = classify(t);
    return {
      tool: t,
      severity: c.severity,
      onApprovedList: c.onApprovedList,
      reason: c.reason,
      regulatory: 'EU AI Act Art.17; NIST AI RMF GOVERN-1.4',
    };
  });

  const count = (sev: ShadowSeverity) => findings.filter((f) => f.severity === sev).length;

  const prohibited = count('prohibited');
  const unknown = count('unknown');
  const tolerated = count('tolerated');
  const approved = count('approved');

  let summary: string;
  if (prohibited > 0) {
    summary = `PROHIBITED AI DETECTED — ${prohibited} tool(s) must be removed immediately.`;
  } else if (unknown > 0) {
    summary = `Shadow AI DETECTED — ${unknown} unclassified tool(s) need MLRO triage.`;
  } else if (tolerated > 0) {
    summary = `All AI tools approved or tolerated. ${tolerated} tolerated tool(s) in next quarterly review.`;
  } else {
    summary = `Shadow AI scan clean — ${approved} approved tool(s), zero unknown / prohibited.`;
  }

  return {
    schemaVersion: 1,
    scannedAtIso: now().toISOString(),
    totalDetected: detected.length,
    approved,
    tolerated,
    unknown,
    prohibited,
    findings,
    summary,
    regulatory: [
      'EU AI Act Art.17',
      'NIST AI RMF 1.0 GOVERN-1.4',
      'ISO/IEC 42001 A.5.4',
      'FDL No.10/2025 Art.20-22',
    ],
  };
}

// Exports for tests.
export const __test__ = { classify };
