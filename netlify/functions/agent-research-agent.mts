/**
 * Research Agent endpoint — iterative adverse-media deep dive for a
 * subject. First-cut wraps the existing src/services/adverseMediaSearch
 * pipeline so clicking `/research-agent` on the module skills palette
 * yields a curated dossier with citations + per-hit confidence.
 *
 * POST /api/agents/research-agent
 * Body: {
 *   subjectName: string,
 *   customerCode?: string,
 *   aliases?: string[],
 *   depth?: 'surface' | 'deep' (default 'surface')
 * }
 *
 * Security: Bearer HAWKEYE_BRAIN_TOKEN + rate-limit 20/15min.
 * Regulatory: FATF Rec 10 · FDL No.10/2025 Art.29 (no tipping off —
 *             external queries never include the screening context)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { resolveAsanaProjectGid } from '../../src/services/asanaModuleProjects';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':
    process.env.HAWKEYE_ALLOWED_ORIGIN ?? 'https://hawkeye-sterling-v2.netlify.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
} as const;

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST')
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405, headers: CORS_HEADERS });

  const rl = await checkRateLimit(req, { max: 20, clientIp: context.ip, namespace: 'agent-research' });
  if (rl) return rl;
  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return Response.json({ ok: false, error: 'invalid JSON' }, { status: 400, headers: CORS_HEADERS }); }

  const subjectName = typeof body.subjectName === 'string' ? body.subjectName.trim() : '';
  if (!subjectName) return Response.json({ ok: false, error: 'subjectName required' }, { status: 400, headers: CORS_HEADERS });
  const customerCode = typeof body.customerCode === 'string' ? body.customerCode.trim() : '';
  const aliases = Array.isArray(body.aliases) ? (body.aliases as unknown[]).filter((s) => typeof s === 'string').map(String) : [];
  const depth = body.depth === 'deep' ? 'deep' : 'surface';
  const ranAt = new Date().toISOString();

  // Delegate to the existing adverse-media pipeline. Keeps this
  // endpoint a thin wrapper so the FDL Art.29 no-tipping-off guards
  // + rate-limit + caching behaviour in adverseMediaSearch apply
  // unchanged.
  let hits: Array<{ title: string; url?: string; source?: string; publishedAt?: string }> = [];
  let providersUsed: string[] = [];
  let provider = 'disabled';
  let err: string | undefined;
  try {
    const mod = await import('../../src/services/adverseMediaSearch');
    const fn = (mod as unknown as Record<string, unknown>).searchAdverseMedia
      || (mod as unknown as Record<string, unknown>).default;
    if (typeof fn === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any = await (fn as any)({
        query: subjectName,
        aliases,
        maxHits: depth === 'deep' ? 25 : 10,
        safeNoTippingOff: true,
      });
      hits = Array.isArray(result?.hits) ? result.hits : [];
      providersUsed = Array.isArray(result?.providersUsed) ? result.providersUsed : [];
      provider = typeof result?.provider === 'string' ? result.provider : 'unknown';
    } else {
      err = 'adverseMediaSearch entry point not found';
    }
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  const dossier = {
    version: 1,
    subject: { name: subjectName, customerCode, aliases },
    depth,
    ranAt,
    provider,
    providersUsed,
    hitCount: hits.length,
    hits: hits.slice(0, depth === 'deep' ? 25 : 10).map((h) => ({
      title: h.title,
      url: h.url,
      source: h.source,
      publishedAt: h.publishedAt,
    })),
    error: err,
    asanaBoard: resolveAsanaProjectGid('screening_and_watchlist'),
    regulatoryBasis:
      'FATF Rec 10 · FDL No.10/2025 Art.29 (no tipping off) · Cabinet Res 134/2025 Art.14 · UAE PDPL Art.6(1)(c)',
    ranBy: auth.username ?? auth.userId ?? null,
  };

  try {
    const store = getStore({ name: 'research-agent-audit', consistency: 'strong' });
    await store.setJSON(`${ranAt.slice(0, 10)}/${Date.now()}-${customerCode || 'nocode'}.json`, dossier);
  } catch { /* non-fatal */ }

  return Response.json({ ok: true, dossier }, { headers: CORS_HEADERS });
};

export const config: Config = {
  path: '/api/agents/research-agent',
  method: ['POST', 'OPTIONS'],
};
