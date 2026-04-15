/**
 * Brain Outbound Queue — tipping-off-safe deferred customer
 * message dispatch endpoint.
 *
 * POST /api/brain/outbound-queue
 *
 * Actions:
 *   enqueue — submit a proposed customer message; gets linted
 *              for tipping-off and either pending_mlro_release
 *              or rejected_tipping_off.
 *   release — explicit MLRO flip of a pending message to released.
 *   cancel  — cancel a pending message without releasing it.
 *   pending — list pending messages for a tenant.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.29 (no tipping off)
 *   Cabinet Res 134/2025 Art.14
 *   EU AI Act Art.14
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';
import {
  DeferredOutboundQueue,
  type OutboundChannel,
} from '../../src/services/deferredOutboundQueue';
import { DeferredOutboundBlobStore } from '../../src/services/tierCBlobStores';
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

const store: DeferredOutboundBlobStore | null = (() => {
  try {
    const blob = getStore('brain-memory');
    const handle = createNetlifyBlobHandle({
      get: (key, opts) => blob.get(key, opts),
      setJSON: (key, value) => blob.setJSON(key, value),
      delete: (key) => blob.delete(key),
    });
    return new DeferredOutboundBlobStore(handle);
  } catch {
    return null;
  }
})();

// In-function queue for lint-only operation; writes the resulting
// entry into the blob store. We reuse the in-memory queue because
// it owns the linter call.
const inMemoryQueue = new DeferredOutboundQueue();

const CHANNELS: readonly OutboundChannel[] = ['email', 'sms', 'letter', 'in_app'];

function validate(raw: unknown):
  | {
      ok: true;
      action: 'enqueue';
      input: {
        tenantId: string;
        recipientRef: string;
        channel: OutboundChannel;
        subject: string;
        body: string;
      };
    }
  | { ok: true; action: 'release'; tenantId: string; id: string }
  | { ok: true; action: 'cancel'; tenantId: string; id: string }
  | { ok: true; action: 'pending'; tenantId: string }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'body must be an object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.tenantId !== 'string' || r.tenantId.length === 0 || r.tenantId.length > 64) {
    return { ok: false, error: 'tenantId must be non-empty string (<=64)' };
  }
  const action = r.action;

  if (action === 'pending') {
    return { ok: true, action: 'pending', tenantId: r.tenantId };
  }

  if (action === 'release' || action === 'cancel') {
    if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 256) {
      return { ok: false, error: 'id must be non-empty string' };
    }
    return { ok: true, action, tenantId: r.tenantId, id: r.id };
  }

  if (action === 'enqueue') {
    if (typeof r.recipientRef !== 'string' || r.recipientRef.length === 0) {
      return { ok: false, error: 'recipientRef required' };
    }
    if (typeof r.channel !== 'string' || !CHANNELS.includes(r.channel as OutboundChannel)) {
      return { ok: false, error: `channel must be one of ${CHANNELS.join(', ')}` };
    }
    if (typeof r.subject !== 'string' || r.subject.length === 0 || r.subject.length > 500) {
      return { ok: false, error: 'subject must be non-empty string (<=500)' };
    }
    if (typeof r.body !== 'string' || r.body.length === 0 || r.body.length > 10_000) {
      return { ok: false, error: 'body must be non-empty string (<=10000)' };
    }
    return {
      ok: true,
      action: 'enqueue',
      input: {
        tenantId: r.tenantId,
        recipientRef: r.recipientRef,
        channel: r.channel as OutboundChannel,
        subject: r.subject,
        body: r.body,
      },
    };
  }

  return { ok: false, error: 'action must be enqueue | release | cancel | pending' };
}

export default async (req: Request, context: Context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 });

  const rl = await checkRateLimit(req, {
    max: 100,
    clientIp: context.ip,
    namespace: 'brain-outbound-queue',
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
    console.warn(`[BRAIN-OUTBOUND-QUEUE] Rejected from ${auth.userId}: ${v.error}`);
    return jsonResponse({ error: v.error }, { status: 400 });
  }

  if (!store) return jsonResponse({ error: 'outbound_store_unavailable' }, { status: 503 });

  if (v.action === 'enqueue') {
    const entry = inMemoryQueue.enqueue(v.input);
    store.persist(entry);
    await store.flush();
    return jsonResponse({
      ok: true,
      entry,
      rejected: entry.status === 'rejected_tipping_off',
    });
  }

  if (v.action === 'release') {
    const ok = await store.transition(v.tenantId, v.id, 'released');
    return jsonResponse({ ok }, { status: ok ? 200 : 404 });
  }

  if (v.action === 'cancel') {
    const ok = await store.transition(v.tenantId, v.id, 'cancelled');
    return jsonResponse({ ok }, { status: ok ? 200 : 404 });
  }

  const pending = await store.pending(v.tenantId);
  return jsonResponse({ ok: true, pending });
};

export const config: Config = {
  path: '/api/brain/outbound-queue',
  method: ['POST', 'OPTIONS'],
};

export const __test__ = { validate };
