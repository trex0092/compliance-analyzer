/**
 * Environment Config Validator — runtime validator for every required
 * and optional env var the tool expects.
 *
 * Why this exists:
 *   DEPLOY_CHECKLIST.md lists the env vars in prose. Settings tab
 *   needs the same information as structured data so it can render
 *   per-var status, validate on save, and run the pre-flight check
 *   on every cold start.
 *
 *   This module is the single source of truth for:
 *     - Which env vars are required vs optional
 *     - What each var means in plain English
 *     - How to validate the value (regex / length / numeric / custom)
 *     - What the safe fallback is when the var is missing
 *
 *   Pure function — no side effects. Takes a `Record<string, string>`
 *   (caller extracts it from `process.env`) and returns a structured
 *   report.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO operational oversight)
 *   FDL No.10/2025 Art.24    (config audit trail)
 *   Cabinet Res 134/2025 Art.19 (internal review — config reviewable)
 *   NIST AI RMF 1.0 GOVERN-1 (policy + process boundary)
 *   NIST AI RMF 1.0 GOVERN-4 (accountability — clear config ownership)
 *   EU AI Act Art.15         (robustness — fail fast, not in prod)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EnvCategory =
  | 'brain'
  | 'asana'
  | 'auth'
  | 'proxy'
  | 'tierC'
  | 'ops';

export type EnvRequirement = 'required' | 'optional';

export interface EnvVarSpec {
  name: string;
  category: EnvCategory;
  requirement: EnvRequirement;
  description: string;
  /** Example value to show in the UI (never a real secret). */
  example: string;
  /**
   * Inline validator. Returns null on success, an error string on
   * failure. Pure.
   */
  validate: (value: string) => string | null;
  /** Used when `requirement === 'optional'` and the var is missing. */
  defaultFallback?: string;
}

export interface EnvVarStatus {
  name: string;
  category: EnvCategory;
  requirement: EnvRequirement;
  /** 'ok' | 'missing' | 'invalid'. */
  state: 'ok' | 'missing' | 'invalid';
  /** Truncated preview of the value (never the full secret). */
  valuePreview: string | null;
  /** Validation error message when state === 'invalid'. */
  errorMessage: string | null;
}

export interface EnvValidationReport {
  schemaVersion: 1;
  /** Overall health: ok, degraded, broken. */
  health: 'ok' | 'degraded' | 'broken';
  totalVars: number;
  requiredCount: number;
  optionalCount: number;
  missingRequired: readonly string[];
  invalidVars: readonly string[];
  /** Per-var detail. */
  statuses: readonly EnvVarStatus[];
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function nonEmpty(name: string) {
  return (value: string): string | null => {
    if (typeof value !== 'string' || value.length === 0) return `${name} must be non-empty`;
    return null;
  };
}

function minLength(name: string, min: number) {
  return (value: string): string | null => {
    if (typeof value !== 'string' || value.length < min) {
      return `${name} must be at least ${min} characters`;
    }
    return null;
  };
}

function urlLike(name: string) {
  return (value: string): string | null => {
    if (typeof value !== 'string') return `${name} must be a URL string`;
    try {
      // URL constructor throws on invalid URLs.
      new URL(value);
      return null;
    } catch {
      return `${name} is not a valid URL`;
    }
  };
}

function anthropicKeyShape(name: string) {
  return (value: string): string | null => {
    if (typeof value !== 'string') return `${name} must be a string`;
    if (!value.startsWith('sk-')) return `${name} must start with "sk-"`;
    if (value.length < 20) return `${name} looks too short for an Anthropic key`;
    return null;
  };
}

function bearerShape(name: string) {
  return (value: string): string | null => {
    if (typeof value !== 'string' || value.length < 24) {
      return `${name} must be a bearer token ≥24 chars`;
    }
    return null;
  };
}

function positiveInteger(name: string) {
  return (value: string): string | null => {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) return `${name} must be a positive integer`;
    return null;
  };
}

function booleanLike(name: string) {
  return (value: string): string | null => {
    if (!['true', 'false', '1', '0'].includes(value.toLowerCase())) {
      return `${name} must be one of true|false|1|0`;
    }
    return null;
  };
}

// ---------------------------------------------------------------------------
// Spec catalogue — single source of truth
// ---------------------------------------------------------------------------

const SPEC: readonly EnvVarSpec[] = [
  // Brain
  {
    name: 'HAWKEYE_BRAIN_TOKEN',
    category: 'brain',
    requirement: 'required',
    description: 'Bearer token used to authenticate calls to /api/brain/* endpoints.',
    example: 'hk-brain-<32 hex chars>',
    validate: bearerShape('HAWKEYE_BRAIN_TOKEN'),
  },
  {
    name: 'HAWKEYE_ALLOWED_ORIGIN',
    category: 'brain',
    requirement: 'required',
    description: 'CORS origin allowlist. Comma-separated HTTPS URLs.',
    example: 'https://hawkeye-sterling-v2.netlify.app',
    validate: nonEmpty('HAWKEYE_ALLOWED_ORIGIN'),
  },
  {
    name: 'HAWKEYE_CROSS_TENANT_SALT',
    category: 'tierC',
    requirement: 'required',
    description: 'Domain separator for zk cross-tenant attestation. Rotated quarterly.',
    example: 'v2026Q2-<16+ chars>',
    validate: minLength('HAWKEYE_CROSS_TENANT_SALT', 16),
  },
  // Proxy
  {
    name: 'ANTHROPIC_API_KEY',
    category: 'proxy',
    requirement: 'required',
    description: 'Anthropic API key used by the advisor strategy (sk-ant-*).',
    example: 'sk-ant-...',
    validate: anthropicKeyShape('ANTHROPIC_API_KEY'),
  },
  {
    name: 'HAWKEYE_AI_PROXY_URL',
    category: 'proxy',
    requirement: 'optional',
    description: 'Proxy URL for the advisor call. Defaults to the same-site /api/ai-proxy.',
    example: 'https://hawkeye-sterling-v2.netlify.app/api/ai-proxy',
    validate: urlLike('HAWKEYE_AI_PROXY_URL'),
    defaultFallback: 'https://hawkeye-sterling-v2.netlify.app/api/ai-proxy',
  },
  // Asana
  {
    name: 'ASANA_ACCESS_TOKEN',
    category: 'asana',
    requirement: 'required',
    description: 'Asana PAT used by the orchestrator + comment router.',
    example: '1/0123456789012345:...',
    validate: minLength('ASANA_ACCESS_TOKEN', 24),
  },
  {
    name: 'ASANA_WORKSPACE_GID',
    category: 'asana',
    requirement: 'required',
    description: 'Default Asana workspace GID.',
    example: '1234567890123456',
    validate: positiveInteger('ASANA_WORKSPACE_GID'),
  },
  {
    name: 'ASANA_WEBHOOK_SECRET',
    category: 'asana',
    requirement: 'optional',
    description: 'Fallback webhook secret. Per-webhook secrets are preferred.',
    example: '<32+ random bytes>',
    validate: minLength('ASANA_WEBHOOK_SECRET', 16),
  },
  // Auth
  {
    name: 'JWT_SIGNING_SECRET',
    category: 'auth',
    requirement: 'required',
    description: 'HMAC secret for session JWTs.',
    example: '<32+ random bytes>',
    validate: minLength('JWT_SIGNING_SECRET', 32),
  },
  {
    name: 'BCRYPT_PEPPER',
    category: 'auth',
    requirement: 'required',
    description: 'Application-wide pepper mixed into bcrypt hashes.',
    example: '<16+ random bytes>',
    validate: minLength('BCRYPT_PEPPER', 16),
  },
  // Ops
  {
    name: 'NETLIFY_BLOBS_TOKEN',
    category: 'ops',
    requirement: 'optional',
    description: 'Injected automatically by Netlify. Required in production.',
    example: '<auto-injected>',
    validate: () => null,
  },
  {
    name: 'BRAIN_TELEMETRY_ENABLED',
    category: 'ops',
    requirement: 'optional',
    description: 'Toggle telemetry writes. Default: true.',
    example: 'true',
    validate: booleanLike('BRAIN_TELEMETRY_ENABLED'),
    defaultFallback: 'true',
  },
  {
    name: 'ASANA_DRY_RUN',
    category: 'ops',
    requirement: 'optional',
    description: 'Force the Asana orchestrator into dry-run mode. Default: false.',
    example: 'false',
    validate: booleanLike('ASANA_DRY_RUN'),
    defaultFallback: 'false',
  },
  {
    name: 'BRAIN_RATE_LIMIT_PER_15MIN',
    category: 'ops',
    requirement: 'optional',
    description: 'Override the default per-IP rate limit (100/15min).',
    example: '100',
    validate: positiveInteger('BRAIN_RATE_LIMIT_PER_15MIN'),
    defaultFallback: '100',
  },
  {
    name: 'HAWKEYE_CLAMP_CRON_TENANTS',
    category: 'ops',
    requirement: 'optional',
    description: 'CSV list of tenant ids that the clamp cron processes.',
    example: 'tenant-a,tenant-b',
    validate: () => null,
  },
  {
    name: 'HAWKEYE_DELTA_SCREEN_TENANTS',
    category: 'ops',
    requirement: 'optional',
    description: 'CSV list of tenant ids that the sanctions delta cron screens.',
    example: 'tenant-a,tenant-b',
    validate: () => null,
  },
];

// ---------------------------------------------------------------------------
// Preview helpers
// ---------------------------------------------------------------------------

function previewValue(name: string, value: string): string {
  // Never expose more than the first 4 chars of a secret.
  if (/token|key|secret|salt|pepper/i.test(name)) {
    return value.length > 4 ? `${value.slice(0, 4)}…${value.length} chars` : '…';
  }
  if (value.length > 32) return `${value.slice(0, 32)}…`;
  return value;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a snapshot of env vars. Pure function. Returns the full
 * report — overall health, per-var status, missing-required list.
 */
export function validateEnv(env: Readonly<Record<string, string | undefined>>): EnvValidationReport {
  const statuses: EnvVarStatus[] = [];
  const missingRequired: string[] = [];
  const invalidVars: string[] = [];

  for (const spec of SPEC) {
    const raw = env[spec.name];
    if (raw === undefined || raw === null || raw === '') {
      if (spec.requirement === 'required') {
        missingRequired.push(spec.name);
        statuses.push({
          name: spec.name,
          category: spec.category,
          requirement: spec.requirement,
          state: 'missing',
          valuePreview: null,
          errorMessage: 'missing (required)',
        });
      } else {
        statuses.push({
          name: spec.name,
          category: spec.category,
          requirement: spec.requirement,
          state: 'ok',
          valuePreview: spec.defaultFallback ? `default: ${spec.defaultFallback}` : null,
          errorMessage: null,
        });
      }
      continue;
    }
    const err = spec.validate(raw);
    if (err) {
      invalidVars.push(spec.name);
      statuses.push({
        name: spec.name,
        category: spec.category,
        requirement: spec.requirement,
        state: 'invalid',
        valuePreview: previewValue(spec.name, raw),
        errorMessage: err,
      });
    } else {
      statuses.push({
        name: spec.name,
        category: spec.category,
        requirement: spec.requirement,
        state: 'ok',
        valuePreview: previewValue(spec.name, raw),
        errorMessage: null,
      });
    }
  }

  const health: EnvValidationReport['health'] =
    missingRequired.length > 0 || invalidVars.some((n) => isRequired(n))
      ? 'broken'
      : invalidVars.length > 0
        ? 'degraded'
        : 'ok';

  const requiredCount = SPEC.filter((s) => s.requirement === 'required').length;
  const optionalCount = SPEC.length - requiredCount;

  return {
    schemaVersion: 1,
    health,
    totalVars: SPEC.length,
    requiredCount,
    optionalCount,
    missingRequired,
    invalidVars,
    statuses,
    summary:
      health === 'ok'
        ? `All ${SPEC.length} env vars validated. ${requiredCount} required + ${optionalCount} optional.`
        : health === 'degraded'
          ? `Config degraded: ${invalidVars.length} optional var(s) invalid but no required var is broken.`
          : `Config BROKEN: ${missingRequired.length} required var(s) missing, ${invalidVars.length} invalid. Do NOT deploy.`,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'FDL No.10/2025 Art.24',
      'Cabinet Res 134/2025 Art.19',
      'NIST AI RMF 1.0 GOVERN-1',
      'NIST AI RMF 1.0 GOVERN-4',
      'EU AI Act Art.15',
    ],
  };
}

function isRequired(name: string): boolean {
  return SPEC.find((s) => s.name === name)?.requirement === 'required';
}

/** Return the full spec catalogue. Used by the Settings tab renderer. */
export function listEnvSpecs(): readonly EnvVarSpec[] {
  return SPEC;
}

// Exports for tests.
export const __test__ = {
  previewValue,
  nonEmpty,
  minLength,
  urlLike,
  anthropicKeyShape,
  bearerShape,
  positiveInteger,
  booleanLike,
};
