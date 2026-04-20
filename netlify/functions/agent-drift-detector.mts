/**
 * Drift Detector Agent endpoint — thin stub that accepts input, resolves the
 * Asana module board, writes an audit row, and returns the agent
 * spec + input + placeholder output.
 *
 * POST /api/agents/drift-detector
 * Required inputs: modelId
 * Output shape: drift-metrics
 * Asana target: governance_and_retention
 *
 * Security: Bearer HAWKEYE_BRAIN_TOKEN + rate-limit 20/15min.
 * Regulatory: EU AI Act Art.15 · NIST AI RMF MEASURE-2.4 · ISO/IEC 42001 §8.2
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
    'modelId', 
];

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST')
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405, headers: CORS_HEADERS });

  const rl = await checkRateLimit(req, { max: 20, clientIp: context.ip, namespace: 'agent-drift-detector' });
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
    agentId: 'drift-detector',
    name: 'Drift Detector Agent',
    ranAt,
    input: body,
    output: {
      status: 'scaffolded',
      note: 'Drift Detector Agent execution endpoint live — agent logic implementation queued in follow-on commit. Today this endpoint is gated, audited, and routes to the correct Asana board.',
    },
    asanaBoard,
    regulatoryBasis: 'EU AI Act Art.15 · NIST AI RMF MEASURE-2.4 · ISO/IEC 42001 §8.2',
    ranBy: auth.username ?? auth.userId ?? null,
  };

  try {
    const store = getStore({ name: 'drift-detector-audit', consistency: 'strong' });
    await store.setJSON(`${ranAt.slice(0, 10)}/${Date.now()}.json`, result);
  } catch { /* audit non-fatal */ }

  return Response.json(result, { headers: CORS_HEADERS });
};

export const config: Config = {
  path: '/api/agents/drift-detector',
  method: ['POST', 'OPTIONS'],
};
