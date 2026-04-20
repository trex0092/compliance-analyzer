/**
 * UBO Graph Agent endpoint — thin stub that accepts input, resolves the
 * Asana module board, writes an audit row, and returns the agent
 * spec + input + placeholder output.
 *
 * POST /api/agents/ubo-graph-agent
 * Required inputs: legalEntityId
 * Output shape: ownership-graph
 * Asana target: cdd_ubo_pep
 *
 * Security: Bearer HAWKEYE_BRAIN_TOKEN + rate-limit 20/15min.
 * Regulatory: Cabinet Decision 109/2023 · FATF Rec 24-25 · FDL No.10/2025 Art.14
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
    'legalEntityId', 
];

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST')
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405, headers: CORS_HEADERS });

  const rl = await checkRateLimit(req, { max: 20, clientIp: context.ip, namespace: 'agent-ubo-graph-agent' });
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
  const asanaBoard = resolveAsanaProjectGid('cdd_ubo_pep');
  const result = {
    ok: true,
    agentId: 'ubo-graph-agent',
    name: 'UBO Graph Agent',
    ranAt,
    input: body,
    output: {
      status: 'scaffolded',
      note: 'UBO Graph Agent execution endpoint live — agent logic implementation queued in follow-on commit. Today this endpoint is gated, audited, and routes to the correct Asana board.',
    },
    asanaBoard,
    regulatoryBasis: 'Cabinet Decision 109/2023 · FATF Rec 24-25 · FDL No.10/2025 Art.14',
    ranBy: auth.username ?? auth.userId ?? null,
  };

  try {
    const store = getStore({ name: 'ubo-graph-audit', consistency: 'strong' });
    await store.setJSON(`${ranAt.slice(0, 10)}/${Date.now()}.json`, result);
  } catch { /* audit non-fatal */ }

  return Response.json(result, { headers: CORS_HEADERS });
};

export const config: Config = {
  path: '/api/agents/ubo-graph-agent',
  method: ['POST', 'OPTIONS'],
};
