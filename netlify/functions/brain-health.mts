/**
 * Brain Health — minimal health check endpoint used by the setup
 * wizard's Verify button.
 *
 * POST /api/brain/health
 *
 * Intentionally lightweight. No imports from src/services so a
 * broken subsystem can never take this endpoint down. If this
 * endpoint is up, the operator knows:
 *   - The function runtime is alive
 *   - Env vars are readable
 *   - Auth middleware is wired
 *   - The required env var set is present
 *
 * For the deep aggregator (blob state, cron status, drift, Tier C
 * queue depths), see src/services/brainHealthCheck.ts — the Brain
 * Console calls that separately.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO visibility)
 *   NIST AI RMF 1.0 MEASURE-4 (continuous validation)
 */

import type { Config, Context } from '@netlify/functions';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':
    process.env.HAWKEYE_ALLOWED_ORIGIN ?? 'https://hawkeye-sterling-v2.netlify.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '600',
  Vary: 'Origin',
} as const;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init.headers ?? {}) },
  });
}

const REQUIRED_ENV_VARS = [
  'HAWKEYE_BRAIN_TOKEN',
  'HAWKEYE_ALLOWED_ORIGIN',
  'HAWKEYE_CROSS_TENANT_SALT',
  'ANTHROPIC_API_KEY',
  'ASANA_ACCESS_TOKEN',
  'ASANA_WORKSPACE_GID',
  'JWT_SIGNING_SECRET',
  'BCRYPT_PEPPER',
];

function checkEnv(): {
  health: 'ok' | 'degraded' | 'broken';
  missing: string[];
  present: string[];
} {
  const missing: string[] = [];
  const present: string[] = [];
  for (const name of REQUIRED_ENV_VARS) {
    const value = process.env[name];
    if (value && value.length > 0) {
      present.push(name);
    } else {
      missing.push(name);
    }
  }
  return {
    health: missing.length === 0 ? 'ok' : missing.length < 3 ? 'degraded' : 'broken',
    missing,
    present,
  };
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    max: 100,
    clientIp: context.ip,
    namespace: 'brain-health',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  const envReport = checkEnv();

  return jsonResponse({
    ok: envReport.health === 'ok',
    overall: envReport.health,
    checkedAtIso: new Date().toISOString(),
    env: {
      required: REQUIRED_ENV_VARS.length,
      present: envReport.present.length,
      missing: envReport.missing.length,
      missingList: envReport.missing,
    },
    summary:
      envReport.health === 'ok'
        ? `All ${REQUIRED_ENV_VARS.length} required env vars present. Brain functions are reachable.`
        : `${envReport.missing.length} required env var(s) missing: ${envReport.missing.join(', ')}`,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'NIST AI RMF 1.0 MEASURE-4',
    ],
  });
};

export const config: Config = {
  path: '/api/brain/health',
  method: ['POST', 'OPTIONS'],
};

export const __test__ = { checkEnv, REQUIRED_ENV_VARS };
