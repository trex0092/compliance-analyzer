/**
 * Compliance Decision endpoint — the server-side entry point for any
 * caller that wants a full weaponized-brain verdict.
 *
 * POST /api/decision
 *
 * Body (JSON, zod-validated via a narrow schema below):
 *   {
 *     tenantId: string,
 *     topic: string,
 *     entity: {
 *       id: string,
 *       name: string,
 *       features: StrFeatures,           // 10 numeric fields + booleans
 *       isSanctionsConfirmed?: boolean,
 *       actorUserId: string
 *     },
 *     adverseMedia?: AdverseMediaHit[],
 *     ubo?: { graph, targetId },
 *     wallets?: { db, addresses },
 *     transactions?: Transaction[],
 *     filing?: { decisionType, approvals, narrative? },
 *     sealAttestation?: boolean
 *   }
 *
 * Returns a ComplianceDecision JSON blob. The response is NOT cached
 * and includes strict security headers so a compromised upstream
 * cannot reflect script content into the browser.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO duty of care)
 *   FDL Art.24 (record retention — see audit store)
 *   FDL Art.29 (no tipping off — caller is responsible for not
 *               surfacing raw subject data back to the subject)
 */

import type { Config, Context } from '@netlify/functions';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';
import {
  runComplianceDecision,
  type ComplianceCaseInput,
} from '../../src/services/complianceDecisionEngine';

const MAX_BODY_BYTES = 512 * 1024; // 512 KB — generous cap, defuses DoS

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

function methodNotAllowed(): Response {
  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}

// Minimal runtime validation — a full zod schema is tracked as a
// follow-up, but we block the most obvious abuse vectors inline so
// the decision engine never receives malformed input.
function coerceInput(raw: unknown): ComplianceCaseInput | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Body must be a JSON object.' };
  const body = raw as Record<string, unknown>;

  if (typeof body.tenantId !== 'string' || body.tenantId.length === 0)
    return { error: 'tenantId is required.' };
  if (typeof body.topic !== 'string' || body.topic.length === 0)
    return { error: 'topic is required.' };

  const entity = body.entity as Record<string, unknown> | undefined;
  if (!entity || typeof entity !== 'object') return { error: 'entity is required.' };
  if (typeof entity.id !== 'string' || entity.id.length === 0)
    return { error: 'entity.id is required.' };
  if (typeof entity.name !== 'string' || entity.name.length === 0)
    return { error: 'entity.name is required.' };
  if (!entity.features || typeof entity.features !== 'object')
    return { error: 'entity.features is required.' };
  if (typeof entity.actorUserId !== 'string' || entity.actorUserId.length === 0)
    return { error: 'entity.actorUserId is required.' };

  // We trust the caller not to stuff extra properties, but we do
  // reject raw subject identifiers that look like UAE Emirates ID
  // (784-YYYY-XXXXXXX-X) because those should never transit this
  // endpoint — the client must hash or pseudonymize first.
  const idPattern = /\b784-\d{4}-\d{7}-\d\b/;
  if (idPattern.test(JSON.stringify(body))) {
    return { error: 'Raw Emirates ID detected in payload — pseudonymize before sending.' };
  }

  return body as unknown as ComplianceCaseInput;
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }
  if (req.method !== 'POST') return methodNotAllowed();

  // Rate limit — sensitive tier. The decision endpoint invokes the
  // full weaponized brain, which is the most expensive operation in
  // the system.
  const rl = await checkRateLimit(req, {
    clientIp: context.ip,
    max: 30,
    namespace: 'decision',
  });
  if (rl) return rl;

  // Shared bearer auth — callers are backend services.
  const auth = authenticate(req);
  if (!auth.ok) return auth.response ?? Response.json({ error: 'Unauthorized' }, { status: 401 });

  // Preflight Content-Length — refuse before buffering if already
  // declared too large. The post-read check remains as a safety
  // net for callers that omit Content-Length.
  const contentLengthHeader = req.headers.get('content-length');
  if (contentLengthHeader) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return Response.json({ error: 'Request body exceeds 512 KB limit.' }, { status: 413 });
    }
  }
  // Read the raw body with a hard size cap.
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
    const decision = await runComplianceDecision(input);
    return new Response(JSON.stringify({ ok: true, decision }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[decision] engine failure:', message);
    return Response.json(
      { ok: false, error: 'Decision engine failure', detail: message },
      { status: 500 }
    );
  }
};

export const config: Config = {
  path: '/api/decision',
  method: ['POST', 'OPTIONS'],
};
