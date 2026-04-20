/**
 * Regulatory Citation Agent endpoint — thin stub that accepts input, resolves the
 * Asana module board, writes an audit row, and returns the agent
 * spec + input + placeholder output.
 *
 * POST /api/agents/citation-agent
 * Required inputs: textBlock
 * Output shape: citation-graph
 * Asana target: governance_and_retention
 *
 * Security: Bearer HAWKEYE_BRAIN_TOKEN + rate-limit 20/15min.
 * Regulatory: FDL No.10/2025 Art.20-21 · Cabinet Res 71/2024
 *
 * Thin by design — the actual agent logic lands in a follow-on
 * commit. Today this endpoint is gated, audited, and routes to the
 * correct Asana board so the wiring is in place end-to-end.
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { resolveAsanaProjectGid } from '../../src/services/asanaModuleProjects';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':
    (typeof process !== 'undefined' && process.env?.HAWKEYE_ALLOWED_ORIGIN) ?? 'https://hawkeye-sterling-v2.netlify.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
} as const;

const REQUIRED: readonly string[] = [
    'textBlock', 
];

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST')
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405, headers: CORS_HEADERS });

  const rl = await checkRateLimit(req, { max: 20, clientIp: context.ip, namespace: 'agent-citation-agent' });
  if (rl) return rl;
  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return Response.json({ ok: false, error: 'invalid JSON' }, { status: 400, headers: CORS_HEADERS }); }

  for (const f of REQUIRED) {
    if (!body[f] || (typeof body[f] !== 'string' && !Array.isArray(body[f]) && typeof body[f] !== 'object')) {
      return Response.json({ ok: false, error: `${f} required` }, { status: 400, headers: CORS_HEADERS });
    }
  }

  const ranAt = new Date().toISOString();
  const asanaBoard = resolveAsanaProjectGid('governance_and_retention');
  const result = {
    ok: true,
    agentId: 'citation-agent',
    name: 'Regulatory Citation Agent',
    ranAt,
    input: body,
    output: {
      status: 'scaffolded',
      note: 'Regulatory Citation Agent execution endpoint live — agent logic implementation queued in follow-on commit. Today this endpoint is gated, audited, and routes to the correct Asana board.',
    },
    asanaBoard,
    regulatoryBasis: 'FDL No.10/2025 Art.20-21 · Cabinet Res 71/2024',
    ranBy: auth.username ?? auth.userId ?? null,
  };

  try {
    const store = getStore({ name: 'citation-agent-audit', consistency: 'strong' });
    await store.setJSON(`${ranAt.slice(0, 10)}/${Date.now()}.json`, result);
  } catch { /* audit non-fatal */ }

  return Response.json(result, { headers: CORS_HEADERS });
};

export const config: Config = {
  path: '/api/agents/citation-agent',
  method: ['POST', 'OPTIONS'],
};
