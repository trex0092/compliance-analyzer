/**
 * Disposition Audit — server-side persistence of every MLRO disposition
 *
 * POST /api/disposition-audit    (see netlify.toml)
 * GET  /api/disposition-audit-read?from=&to=&subject=&disposition=
 *
 * Companion to /api/four-eyes-audit but broader — every close on a
 * screening row (Confirm / Partial / False-positive / Escalate)
 * writes an audit record with 10-year retention per FDL Art.24.
 *
 * The client-side state (localStorage) remains the authoritative
 * source for the MLRO UI; this endpoint is the audit-grade mirror
 * that an MoE inspector can query.
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';

const RL_MAX = 60;
const RL_WINDOW_MS = 60 * 1000;
const STORE_NAME = 'disposition-audit';

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status });
}
function str(v: unknown, max = 256): string | null {
  if (typeof v !== 'string') return null;
  if (v.length === 0 || v.length > max) return null;
  return v;
}
function optStr(v: unknown, max = 256): string | undefined {
  if (typeof v !== 'string' || v.length > max) return undefined;
  return v;
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  const rl = await checkRateLimit(req, {
    clientIp: context.ip,
    namespace: 'disposition-audit',
    max: RL_MAX,
    windowMs: RL_WINDOW_MS,
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  const store = getStore({ name: STORE_NAME, consistency: 'strong' });

  if (req.method === 'POST') {
    let body: unknown;
    try { body = await req.json(); } catch { return fail(400, 'Invalid JSON body.'); }
    if (typeof body !== 'object' || body === null) return fail(400, 'Invalid body shape.');
    const b = body as Record<string, unknown>;
    const rowId       = str(b.rowId, 128);
    const subjectName = str(b.subjectName, 512);
    const disposition = str(b.disposition, 32);
    const mlroId      = str(b.mlroId, 128);
    const disposedAt  = str(b.disposedAt, 64);
    if (!rowId || !subjectName || !disposition || !mlroId || !disposedAt) {
      return fail(400, 'Missing required fields.');
    }
    if (!['positive', 'partial', 'false_positive', 'escalated', 'pending_approval'].includes(disposition)) {
      return fail(400, 'Invalid disposition value.');
    }
    const record = {
      rowId, subjectName, disposition, mlroId, disposedAt,
      country:            optStr(b.country, 128) ?? '',
      cddTier:            optStr(b.cddTier, 16),
      riskLevel:          optStr(b.riskLevel, 32),
      sanctionsHitCount:  typeof b.sanctionsHitCount === 'number' ? b.sanctionsHitCount : 0,
      adverseMediaClass:  optStr(b.adverseMediaClass, 32),
      confidencePct:      typeof b.confidencePct === 'number' ? b.confidencePct : null,
      posteriorMeanPct:   typeof b.posteriorMeanPct === 'number' ? b.posteriorMeanPct : null,
      entityType:         optStr(b.entityType, 32),
      typologyIds:        Array.isArray(b.typologyIds) ? (b.typologyIds as unknown[]).filter((t) => typeof t === 'string').slice(0, 10) : [],
      categories:         Array.isArray(b.categories) ? (b.categories as unknown[]).filter((t) => typeof t === 'string').slice(0, 10) : [],
      recordedByUserId:   auth.userId,
      recordedByJti:      auth.jwt?.jti ?? null,
      recordedAtIso:      new Date().toISOString(),
    };
    const dayKey = record.recordedAtIso.slice(0, 10);
    const key = `${dayKey}/${rowId}-${Date.now()}.json`;
    try {
      await store.setJSON(key, record);
      return Response.json({ ok: true, key, recordedAtIso: record.recordedAtIso });
    } catch (err) {
      console.error('[disposition-audit] write failed:', err);
      return fail(502, 'Audit store write failed.');
    }
  }

  return fail(405, 'Method not allowed.');
};

export const config: Config = {
  method: ['POST', 'OPTIONS'],
};
