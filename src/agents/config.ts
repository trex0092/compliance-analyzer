/**
 * Agent SDK Configuration
 *
 * All agent settings live here. Secrets come from environment variables —
 * never hardcoded (CLAUDE.md § Seguridad §2).
 */

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = typeof process !== 'undefined' ? process.env[name] : undefined;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  if (typeof process !== 'undefined' && process.env[name]) {
    return process.env[name]!;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Agent models
// ---------------------------------------------------------------------------

export const AGENT_MODELS = {
  primary: 'claude-opus-4-6',
  fast: 'claude-sonnet-4-6',
  light: 'claude-haiku-4-5-20251001',
} as const;

// ---------------------------------------------------------------------------
// Tool configuration
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: string; // module path to handler function
}

// ---------------------------------------------------------------------------
// Session settings
// ---------------------------------------------------------------------------

export const SESSION_CONFIG = {
  /** Maximum idle time before session expires (ms) */
  idleTimeoutMs: 1_800_000, // 30 min
  /** Maximum total session duration (ms) */
  maxDurationMs: 7_200_000, // 2 hours
  /** Hash algorithm for audit chain */
  hashAlgorithm: 'SHA-256',
  /** Genesis hash for new audit chains */
  genesisHash: '0'.repeat(64),
} as const;

// ---------------------------------------------------------------------------
// Sandbox settings
// ---------------------------------------------------------------------------

export const SANDBOX_CONFIG = {
  /** Maximum execution time for sandboxed operations (ms) */
  executionTimeoutMs: 60_000,
  /** Maximum memory for sandbox (bytes) — 256 MB */
  maxMemoryBytes: 256 * 1024 * 1024,
  /** Operations that always require sandbox */
  sandboxedOperations: [
    'sanctions-screening',
    'goaml-validation',
    'risk-score-simulation',
    'batch-screening',
  ] as const,
} as const;

// ---------------------------------------------------------------------------
// Orchestration settings
// ---------------------------------------------------------------------------

export const ORCHESTRATION_CONFIG = {
  /** Maximum concurrent agents in a workflow */
  maxConcurrentAgents: 5,
  /** Timeout for individual workflow steps (ms) */
  stepTimeoutMs: 120_000,
  /** Maximum workflow retries per step */
  maxRetries: 2,
  /** Delay between retries (ms) */
  retryDelayMs: 2_000,
} as const;

// ---------------------------------------------------------------------------
// Regulatory constants re-exported for agent use
// ---------------------------------------------------------------------------

export {
  DPMS_CASH_THRESHOLD_AED,
  CROSS_BORDER_CASH_THRESHOLD_AED,
  UBO_OWNERSHIP_THRESHOLD_PCT,
  CNMR_FILING_DEADLINE_BUSINESS_DAYS,
  STR_FILING_DEADLINE_BUSINESS_DAYS,
  CTR_FILING_DEADLINE_BUSINESS_DAYS,
  CDD_REVIEW_HIGH_RISK_MONTHS,
  CDD_REVIEW_MEDIUM_RISK_MONTHS,
  CDD_REVIEW_LOW_RISK_MONTHS,
  RISK_THRESHOLDS,
  PF_HIGH_RISK_JURISDICTIONS,
  RECORD_RETENTION_YEARS,
} from '../domain/constants';

// ---------------------------------------------------------------------------
// API configuration (from env)
// ---------------------------------------------------------------------------

export function getApiConfig() {
  return {
    anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),
    proxyUrl: optionalEnv('SANCTIONS_PROXY_URL', ''),
    goamlEndpoint: optionalEnv('GOAML_SUBMISSION_URL', ''),
    asanaToken: optionalEnv('ASANA_PAT', ''),
  };
}
