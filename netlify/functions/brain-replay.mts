/**
 * Brain Replay — historical-case re-validation endpoint.
 *
 * POST /api/brain/replay
 *
 * Re-evaluates a previously-decided case against the CURRENT
 * regulatory baseline. Answers the audit question: "if we ran this
 * case today, would the brain still reach the same verdict?"
 *
 * Request body:
 *   { tenantId: string, caseId: string }
 *
 * Response:
 *   {
 *     ok: true,
 *     report: ReplayReport {
 *       found, tenantId, caseId, stored, drift,
 *       thresholdImpacts, conclusion, summary
 *     },
 *     durationMs
 *   }
 *
 * Security:
 *   - POST only (+ OPTIONS preflight)
 *   - authenticate() against HAWKEYE_BRAIN_TOKEN
 *   - Rate limit: general bucket (100 / 15min / IP)
 *   - Strict validation: tenantId ≤ 64 chars, caseId ≤ 128 chars
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO visibility + audit trail)
 *   FDL No.10/2025 Art.24    (10-year retention — replay reconstructs
 *                              decisions from the durable record)
 *   FDL No.10/2025 Art.29    (no tipping off — response contains only
 *                              opaque entity refs)
 *   Cabinet Res 134/2025 Art.19 (internal review — replay IS review)
 *   NIST AI RMF 1.0 MANAGE-2/4 (AI decision provenance + recourse)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';
import { CaseReplayStore } from '../../src/services/caseReplayStore';
import { createNetlifyBlobHandle } from '../../src/services/brainMemoryBlobStore';

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

// Shared store — same Netlify Blob backend brain-analyze writes to.
const replayStore: CaseReplayStore | null = (() => {
  try {
    const store = getStore('brain-memory');
    const handle = createNetlifyBlobHandle({
      get: (key, opts) => store.get(key, opts),
      setJSON: (key, value) => store.setJSON(key, value),
      delete: (key) => store.delete(key),
    });
    return new CaseReplayStore(handle);
  } catch {
    return null;
  }
})();

interface ReplayRequest {
  tenantId: string;
  caseId: string;
}

function validate(
  raw: unknown
): { ok: true; request: ReplayRequest } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'body must be an object' };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.tenantId !== 'string' || r.tenantId.length === 0 || r.tenantId.length > 64) {
    return { ok: false, error: 'tenantId must be a non-empty string (<=64)' };
  }
  if (typeof r.caseId !== 'string' || r.caseId.length === 0 || r.caseId.length > 128) {
    return { ok: false, error: 'caseId must be a non-empty string (<=128)' };
  }
  return {
    ok: true,
    request: { tenantId: r.tenantId, caseId: r.caseId },
  };
}

export default async (req: Request, context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    max: 100,
    clientIp: context.ip,
    namespace: 'brain-replay',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const v = validate(body);
  if (!v.ok) {
    console.warn(`[BRAIN-REPLAY] Rejected input from ${auth.userId}: ${v.error}`);
    return jsonResponse({ error: v.error }, { status: 400 });
  }

  if (!replayStore) {
    return jsonResponse({ error: 'replay_store_unavailable' }, { status: 503 });
  }

  const started = Date.now();
  const report = await replayStore.replayCase(v.request.tenantId, v.request.caseId);
  const durationMs = Date.now() - started;

  console.log(
    `[BRAIN-REPLAY] ${auth.userId} tenant=${v.request.tenantId} case=${v.request.caseId} ` +
      `conclusion=${report.conclusion} found=${report.found} ms=${durationMs}`
  );

  return jsonResponse({ ok: true, report, durationMs });
};

export const config: Config = {
  path: '/api/brain/replay',
  method: ['POST', 'OPTIONS'],
};

export const __test__ = { validate };
