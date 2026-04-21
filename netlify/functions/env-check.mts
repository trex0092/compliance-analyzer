/**
 * Env Check — read-only diagnostic endpoint reporting which required
 * env vars are actually visible to the deployed Netlify function
 * bundle.
 *
 * GET /api/env-check
 *   → {
 *       ok: true,
 *       timestamp: "2026-04-21T...",
 *       context: "production" | "deploy-preview" | "branch-deploy" | "dev",
 *       configured: { <VAR_NAME>: true|false, ... },
 *       missing: ["VAR_NAME", ...],
 *       summary: { total, configured: N, missing: M }
 *     }
 *
 * Why this exists: when an operator pastes keys into the Netlify
 * dashboard and triggers a redeploy, there is no fast way to verify
 * which vars actually took effect. The symptom — a cron returning
 * `{"ok":true, "skipped":"ASANA_API_TOKEN missing"}` buried in
 * function logs — is easy to miss. This endpoint surfaces the same
 * signal at the top of the stack in under 100ms.
 *
 * Security design:
 *   - Returns BOOLEAN presence only. Never the value, never a length,
 *     never a prefix. The name of an env var is not a secret; the
 *     value is. CLAUDE.md §2 "Variables de Entorno y Secretos".
 *   - Rate limited to 10 requests / IP / minute. Prevents using this
 *     as an enumeration tool to scan for env-var name patterns.
 *   - No auth required. This is a public diagnostic — same threat
 *     model as Netlify's own build-status badges. Keeping it open
 *     means the operator can debug auth-related outages (when the
 *     auth middleware itself is the suspect).
 *
 * What we check: the 7 vars the MLRO operator is expected to set for
 * the tool to work "out of the box" plus the most commonly-needed
 * Asana sub-module project GIDs. Extend this list when new required
 * vars are introduced — use it as the authoritative "what must be
 * configured" manifest.
 *
 * Regulatory basis: FDL No.(10)/2025 Art.20-21 (CO visibility into
 * operational readiness), Art.24 (every missed configuration event
 * is itself an audit event — this endpoint makes the "configured:no"
 * state legible).
 */

import type { Config, Context } from '@netlify/functions';
import { checkRateLimit } from './middleware/rate-limit.mts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':
    process.env.HAWKEYE_ALLOWED_ORIGIN ?? 'https://hawkeye-sterling-v2.netlify.app',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
  Vary: 'Origin',
} as const;

/**
 * Vars the operator must set for the tool to function end-to-end.
 *
 * Groups follow the user-facing dependency chain so the diagnostic
 * output points the operator at the right feature when something is
 * red:
 *
 *   CRITICAL  — tool won't boot without this
 *   ASANA     — Asana sync, task creation, routines registry UI
 *   OPTIONAL  — nice-to-have, gracefully degraded if missing
 */
const REQUIRED_VARS = {
  CRITICAL: [
    'ANTHROPIC_API_KEY', //  brain-reason, agent-*, advisor-tool
  ],
  ASANA: [
    'ASANA_API_TOKEN',
    'ASANA_WORKBENCH_PROJECT_GID',
    'ASANA_SHIPMENTS_PROJECT_GID', // formerly LOGISTICS — retired
    'ASANA_CENTRAL_MLRO_PROJECT_GID',
    'ASANA_ROUTINES_PROJECT_GID',
    'ASANA_SCREENINGS_PROJECT_GID',
    'ASANA_TM_PROJECT_GID',
    'ASANA_STR_PROJECT_GID',
    'ASANA_CDD_PROJECT_GID',
    'ASANA_ESG_LBMA_PROJECT_GID',
    'ASANA_EXPORT_CONTROL_PROJECT_GID',
    'ASANA_GOVERNANCE_PROJECT_GID',
    'ASANA_AUDIT_INSPECTION_PROJECT_GID',
    'ASANA_EMPLOYEES_TRAINING_PROJECT_GID',
    'ASANA_EMPLOYEES_PROJECT_GID',
    'ASANA_TRAINING_PROJECT_GID',
    'ASANA_ONBOARDING_PROJECT_GID',
    'ASANA_COMPLIANCE_TASKS_PROJECT_GID',
    'ASANA_FOUR_EYES_PROJECT_GID',
    'ASANA_COUNTERPARTIES_PROJECT_GID',
    'ASANA_INCIDENTS_PROJECT_GID',
    'ASANA_GRIEVANCES_PROJECT_GID',
    'ASANA_WORKSPACE_GID',
  ],
  OPTIONAL: [
    'HAWKEYE_ALLOWED_ORIGIN', // CORS — has a prod default
    'HAWKEYE_BRAIN_TOKEN', // bearer auth for MLRO-skill endpoints
    'HAWKEYE_SOLO_MLRO_MODE', // disables four-eyes when 'true'
    'SANCTIONS_UPLOAD_TOKEN', // sanctions-feed-debug ingest
  ],
} as const;

type VarGroup = keyof typeof REQUIRED_VARS;

function checkGroup(group: VarGroup): {
  configured: Record<string, boolean>;
  missing: string[];
} {
  const configured: Record<string, boolean> = {};
  const missing: string[] = [];
  for (const name of REQUIRED_VARS[group]) {
    const value = process.env[name];
    const present = typeof value === 'string' && value.length > 0;
    configured[name] = present;
    if (!present) missing.push(name);
  }
  return { configured, missing };
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'GET') {
    return Response.json(
      { ok: false, error: 'Method not allowed.' },
      { status: 405, headers: CORS_HEADERS },
    );
  }

  const rl = await checkRateLimit(req, {
    max: 10,
    windowMs: 60_000,
    clientIp: context.ip,
    namespace: 'env-check',
  });
  if (rl) return rl;

  const critical = checkGroup('CRITICAL');
  const asana = checkGroup('ASANA');
  const optional = checkGroup('OPTIONAL');

  const allConfigured = { ...critical.configured, ...asana.configured, ...optional.configured };
  const allMissing = [...critical.missing, ...asana.missing, ...optional.missing];
  const totalVars = Object.keys(allConfigured).length;
  const configuredCount = totalVars - allMissing.length;

  // Netlify context (production / deploy-preview / branch-deploy / dev)
  // is surfaced via the CONTEXT env var set by the platform. Useful when
  // debugging "I set it but only in production scope" drift.
  const netlifyContext = process.env.CONTEXT || 'unknown';

  return Response.json(
    {
      ok: allMissing.length === 0,
      timestamp: new Date().toISOString(),
      context: netlifyContext,
      configured: allConfigured,
      missing: allMissing,
      summary: {
        total: totalVars,
        configured: configuredCount,
        missing: allMissing.length,
        critical_missing: critical.missing,
        asana_missing: asana.missing.length,
        optional_missing: optional.missing.length,
      },
      groups: {
        critical: critical.configured,
        asana: asana.configured,
        optional: optional.configured,
      },
    },
    { headers: CORS_HEADERS },
  );
};

export const config: Config = {
  method: ['GET', 'OPTIONS'],
};
