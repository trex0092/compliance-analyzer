/**
 * Compliance Decision Orchestrator endpoint.
 *
 * POST /api/orchestrate
 *
 * Same body shape as /api/decision but routes through the full PEER
 * pipeline (Planner → Executor → Evaluator → Reviewer) instead of
 * just the bare decision engine. The Reviewer phase calls the Opus
 * advisor when any of the six compliance triggers fire, and the
 * Evaluator can monotonically escalate the verdict.
 *
 * The orchestrator is the production entry point for any caller that
 * wants the full multi-agent treatment (CDD/EDD review, STR drafting,
 * sanctions confirmation, freeze protocol). Use /api/decision when
 * you only want the raw weaponized-brain verdict and don't need the
 * advisor escalation layer.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO duty of care)
 *   Cabinet Res 134/2025 Art.19 (internal review)
 *   FATF Rec 18 (proportionate internal controls)
 */

import type { Config, Context } from '@netlify/functions';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { runOrchestration } from '../../src/services/mlroOrchestrator';
import type { ComplianceCaseInput } from '../../src/services/complianceDecisionEngine';

const MAX_BODY_BYTES = 512 * 1024;

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

function coerceInput(raw: unknown): ComplianceCaseInput | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Body must be a JSON object.' };
  const body = raw as Record<string, unknown>;
  if (typeof body.tenantId !== 'string' || body.tenantId.length === 0)
    return { error: 'tenantId is required.' };
  if (typeof body.topic !== 'string' || body.topic.length === 0)
    return { error: 'topic is required.' };
  const entity = body.entity as Record<string, unknown> | undefined;
  if (!entity) return { error: 'entity is required.' };
  if (typeof entity.id !== 'string') return { error: 'entity.id is required.' };
  if (typeof entity.name !== 'string') return { error: 'entity.name is required.' };
  if (!entity.features || typeof entity.features !== 'object')
    return { error: 'entity.features is required.' };
  // Same Emirates ID guard as /api/decision.
  if (/\b784-\d{4}-\d{7}-\d\b/.test(JSON.stringify(body))) {
    return { error: 'Raw Emirates ID detected — pseudonymize before sending.' };
  }
  return body as unknown as ComplianceCaseInput;
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  // The orchestrator is the most expensive endpoint in the system —
  // tighten the rate limit to half of /api/decision's 30/15min.
  const rl = await checkRateLimit(req, {
    clientIp: context.ip,
    max: 15,
    namespace: 'orchestrate',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response ?? Response.json({ error: 'Unauthorized' }, { status: 401 });

  // Preflight Content-Length — refuse before buffering if already
  // declared too large.
  const contentLengthHeader = req.headers.get('content-length');
  if (contentLengthHeader) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return Response.json({ error: 'Request body exceeds 512 KB limit.' }, { status: 413 });
    }
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: 'Request body exceeds 512 KB limit.' }, { status: 413 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return badRequest('Invalid JSON body.');
  }
  const input = coerceInput(parsed);
  if ('error' in input) return badRequest(input.error);

  try {
    // The orchestrator never mints its own advisor deps — callers that
    // want the advisor consultation must POST here from a server-side
    // context that already holds an HAWKEYE_AI_PROXY_TOKEN. We do not
    // forward the caller's auth token to the advisor on purpose; that
    // would mix tenant credentials across model calls.
    const result = await runOrchestration(input);
    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[orchestrate] failure:', message);
    return Response.json(
      { ok: false, error: 'Orchestrator failure', detail: message },
      { status: 500 }
    );
  }
};

export const config: Config = {
  path: '/api/orchestrate',
  method: ['POST', 'OPTIONS'],
};
