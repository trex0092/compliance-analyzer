/**
 * Brain Break-Glass — two-person approval override endpoint.
 *
 * POST /api/brain/break-glass
 *
 * Actions:
 *   request — primary MLRO opens a break-glass request. Justification
 *              text is linted for tipping-off. Any subject-leaking
 *              language sets status cancelled_tipping_off and the
 *              request never enters the approval queue.
 *   approve — distinct MLRO signs off. Self-approval prohibited.
 *   reject  — distinct MLRO rejects.
 *   pending — list requests awaiting second signature.
 *   get     — fetch a single request by id.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21, Art.24, Art.29
 *   Cabinet Res 134/2025 Art.12-14
 *   NIST AI RMF 1.0 MANAGE-3
 *   EU AI Act Art.14
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';
import { BreakGlassStore, type OverrideVerdict } from '../../src/services/breakGlassOverride';
import { BreakGlassBlobStore } from '../../src/services/tierCBlobStores';
import { createNetlifyBlobHandle } from '../../src/services/brainMemoryBlobStore';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':
    process.env.HAWKEYE_ALLOWED_ORIGIN ?? 'https://compliance-analyzer.netlify.app',
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

const blobStore: BreakGlassBlobStore | null = (() => {
  try {
    const blob = getStore('brain-memory');
    const handle = createNetlifyBlobHandle({
      get: (key, opts) => blob.get(key, opts),
      setJSON: (key, value) => blob.setJSON(key, value),
      delete: (key) => blob.delete(key),
    });
    return new BreakGlassBlobStore(handle);
  } catch {
    return null;
  }
})();

// In-memory store used purely for its linting + construction logic —
// we persist the resulting BreakGlassRequest into the blob store.
const inMemoryStore = new BreakGlassStore();

const VERDICTS: readonly OverrideVerdict[] = ['pass', 'flag', 'escalate', 'freeze'];

function validate(raw: unknown):
  | {
      ok: true;
      action: 'request';
      input: {
        tenantId: string;
        caseId: string;
        fromVerdict: OverrideVerdict;
        toVerdict: OverrideVerdict;
        justification: string;
        regulatoryCitation: string;
        requestedBy: string;
      };
    }
  | { ok: true; action: 'approve' | 'reject'; tenantId: string; id: string; approverId: string }
  | { ok: true; action: 'pending'; tenantId: string }
  | { ok: true; action: 'get'; tenantId: string; id: string }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'body must be an object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.tenantId !== 'string' || r.tenantId.length === 0 || r.tenantId.length > 64) {
    return { ok: false, error: 'tenantId must be non-empty string (<=64)' };
  }
  const action = r.action;

  if (action === 'pending') return { ok: true, action, tenantId: r.tenantId };

  if (action === 'get') {
    if (typeof r.id !== 'string' || r.id.length === 0) {
      return { ok: false, error: 'id required' };
    }
    return { ok: true, action, tenantId: r.tenantId, id: r.id };
  }

  if (action === 'approve' || action === 'reject') {
    if (typeof r.id !== 'string' || r.id.length === 0) {
      return { ok: false, error: 'id required' };
    }
    if (typeof r.approverId !== 'string' || r.approverId.length === 0) {
      return { ok: false, error: 'approverId required' };
    }
    return {
      ok: true,
      action,
      tenantId: r.tenantId,
      id: r.id,
      approverId: r.approverId,
    };
  }

  if (action === 'request') {
    if (typeof r.caseId !== 'string' || r.caseId.length === 0 || r.caseId.length > 128) {
      return { ok: false, error: 'caseId must be non-empty string (<=128)' };
    }
    if (typeof r.fromVerdict !== 'string' || !VERDICTS.includes(r.fromVerdict as OverrideVerdict)) {
      return { ok: false, error: `fromVerdict must be one of ${VERDICTS.join(', ')}` };
    }
    if (typeof r.toVerdict !== 'string' || !VERDICTS.includes(r.toVerdict as OverrideVerdict)) {
      return { ok: false, error: `toVerdict must be one of ${VERDICTS.join(', ')}` };
    }
    if (
      typeof r.justification !== 'string' ||
      r.justification.length === 0 ||
      r.justification.length > 5000
    ) {
      return { ok: false, error: 'justification must be non-empty string (<=5000)' };
    }
    if (typeof r.regulatoryCitation !== 'string' || r.regulatoryCitation.length === 0) {
      return { ok: false, error: 'regulatoryCitation required' };
    }
    if (typeof r.requestedBy !== 'string' || r.requestedBy.length === 0) {
      return { ok: false, error: 'requestedBy required' };
    }
    return {
      ok: true,
      action: 'request',
      input: {
        tenantId: r.tenantId,
        caseId: r.caseId,
        fromVerdict: r.fromVerdict as OverrideVerdict,
        toVerdict: r.toVerdict as OverrideVerdict,
        justification: r.justification,
        regulatoryCitation: r.regulatoryCitation,
        requestedBy: r.requestedBy,
      },
    };
  }

  return { ok: false, error: 'action must be request | approve | reject | pending | get' };
}

export default async (req: Request, context: Context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 });

  const rl = await checkRateLimit(req, {
    max: 10, // sensitive endpoint — stricter bucket
    clientIp: context.ip,
    namespace: 'brain-break-glass',
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
    console.warn(`[BRAIN-BREAK-GLASS] Rejected from ${auth.userId}: ${v.error}`);
    return jsonResponse({ error: v.error }, { status: 400 });
  }

  if (!blobStore) return jsonResponse({ error: 'break_glass_store_unavailable' }, { status: 503 });

  if (v.action === 'request') {
    const entry = inMemoryStore.request(v.input);
    blobStore.persist(entry);
    await blobStore.flush();
    return jsonResponse({
      ok: true,
      request: entry,
      rejected: entry.status === 'cancelled_tipping_off',
    });
  }

  if (v.action === 'approve') {
    const res = await blobStore.approve(v.tenantId, v.id, v.approverId);
    return jsonResponse({ ok: res.ok, reason: res.reason }, { status: res.ok ? 200 : 400 });
  }

  if (v.action === 'reject') {
    const res = await blobStore.reject(v.tenantId, v.id, v.approverId);
    return jsonResponse({ ok: res.ok, reason: res.reason }, { status: res.ok ? 200 : 400 });
  }

  if (v.action === 'get') {
    const entry = await blobStore.get(v.tenantId, v.id);
    if (!entry) return jsonResponse({ ok: false, reason: 'unknown_id' }, { status: 404 });
    return jsonResponse({ ok: true, request: entry });
  }

  // pending
  const entries = await blobStore.all(v.tenantId);
  const pending = entries.filter((e) => e.status === 'pending_second_approval');
  return jsonResponse({ ok: true, pending });
};

export const config: Config = {
  path: '/api/brain/break-glass',
  method: ['POST', 'OPTIONS'],
};

export const __test__ = { validate };
