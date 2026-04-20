/**
 * Asana Config — read-only endpoint that returns the configured Asana
 * project GIDs for the 16-project module catalog, so browser pages
 * can render "View in Asana" links without hardcoding GIDs in client
 * JS.
 *
 * GET /api/asana/config
 *   → {
 *       ok: true,
 *       workspaceGid,
 *       projects: { <moduleKey>: <gid|null>, … }   // 16 keys
 *     }
 *
 * The legacy per-page keys (workbench / logistics / routines /
 * compliance-ops / screenings) that pointed at the pre-catalog layout
 * have been retired — they were wired to env vars that were never
 * populated on production and produced null every time. The new shape
 * reads from src/services/asanaModuleProjects.ts so browsers and
 * server-side callers see the same 16-project layout with no drift.
 *
 * Auth: Bearer HAWKEYE_BRAIN_TOKEN.
 * Rate limit: 60 req / 15 min per IP.
 *
 * Returns only GIDs + workspace GID. No tokens, no customer data.
 * Regulatory basis: FDL No.(10)/2025 Art.20-21, Art.24.
 */

import type { Context } from '@netlify/functions';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { MODULE_PROJECTS } from '../../src/services/asanaModuleProjects';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':
    process.env.HAWKEYE_ALLOWED_ORIGIN ?? 'https://hawkeye-sterling-v2.netlify.app',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'GET') {
    return jsonResponse({ ok: false, error: 'method not allowed' }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    max: 60,
    clientIp: context.ip,
    namespace: 'asana-config',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  const workspaceGid = process.env.ASANA_WORKSPACE_GID ?? null;
  const projects: Record<string, string | null> = {};
  for (const spec of MODULE_PROJECTS) {
    projects[spec.key] = process.env[spec.envVar] ?? null;
  }

  return jsonResponse({ ok: true, workspaceGid, projects });
};
