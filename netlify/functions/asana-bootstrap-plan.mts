/**
 * Asana Tenant Bootstrap Plan — Phase 19 W-D read-only endpoint.
 *
 * POST /api/asana/bootstrap-plan
 *
 * Read-only. Takes { tenantId } and returns the current resumable
 * bootstrap plan for that tenant:
 *
 *   {
 *     ok: true,
 *     tenantId,
 *     nextSteps: [...],          // what would run next
 *     alreadyDone: [...],
 *     failed: [...],             // failed steps awaiting retry
 *     inProgressFresh: [...],    // blocked but not stale
 *     complete: boolean          // true when every step is done
 *   }
 *
 * Callers use this to answer "can I safely re-run bootstrap for
 * this tenant?" without mutating any state. The underlying pure
 * compute lives in
 * src/services/asanaTenantBootstrapStateMachine.ts (PR #187).
 *
 * The existing setup-asana-bootstrap.mts endpoint is untouched —
 * its full execution path still runs end-to-end today. This
 * endpoint only adds visibility so the MLRO can see where a
 * partial or failed bootstrap stopped before deciding whether to
 * re-run or investigate.
 *
 * Regulatory anchor:
 *   FDL No. 10 of 2025 Art.20 — MLRO visibility; a partially
 *     bootstrapped tenant should be visible in the MLRO's queue.
 *   Cabinet Resolution 134/2025 Art.18 — MLRO arrangement
 *     notification; tenant bootstrap is where that lands.
 *   Cabinet Resolution 134/2025 Art.19 — internal review.
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';
import {
  planBootstrap,
  type BootstrapState,
} from '../../src/services/asanaTenantBootstrapStateMachine';

const STATE_STORE = 'asana-tenant-bootstrap-state';
const MAX_BODY_BYTES = 4 * 1024;

interface RequestShape {
  tenantId: string;
  /** Optional staleness override for testing. */
  staleInProgressMs?: number;
}

function coerceRequest(raw: unknown): RequestShape | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Body must be a JSON object.' };
  const r = raw as Record<string, unknown>;
  if (typeof r.tenantId !== 'string' || r.tenantId.length === 0) {
    return { error: 'tenantId is required.' };
  }
  const stale =
    typeof r.staleInProgressMs === 'number' && Number.isFinite(r.staleInProgressMs)
      ? r.staleInProgressMs
      : undefined;
  return { tenantId: r.tenantId, staleInProgressMs: stale };
}

async function readState(tenantId: string): Promise<BootstrapState> {
  try {
    const store = getStore(STATE_STORE);
    const raw = (await store.get(`tenant:${tenantId}.json`, {
      type: 'json',
    })) as BootstrapState | null;
    if (!raw || typeof raw !== 'object') {
      return { tenantId, startedAtMs: Date.now(), steps: {} };
    }
    if (typeof raw.tenantId !== 'string' || raw.tenantId !== tenantId) {
      return { tenantId, startedAtMs: Date.now(), steps: {} };
    }
    if (!raw.steps || typeof raw.steps !== 'object') {
      return { tenantId, startedAtMs: raw.startedAtMs ?? Date.now(), steps: {} };
    }
    return raw;
  } catch {
    // Netlify Blobs unavailable — return the empty state so the
    // planner reports every step as pending. Callers can treat
    // that as "no bootstrap has been recorded yet for this
    // tenant".
    return { tenantId, startedAtMs: Date.now(), steps: {} };
  }
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    clientIp: context.ip,
    max: 60,
    namespace: 'asana-bootstrap-plan',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response ?? Response.json({ error: 'Unauthorized' }, { status: 401 });

  const contentLengthHeader = req.headers.get('content-length');
  if (contentLengthHeader) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return Response.json({ error: 'Body exceeds 4 KB cap.' }, { status: 413 });
    }
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: 'Body exceeds 4 KB cap.' }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const coerced = coerceRequest(parsed);
  if ('error' in coerced) {
    return Response.json({ error: coerced.error }, { status: 400 });
  }

  const state = await readState(coerced.tenantId);
  const plan = planBootstrap(state, {
    nowMs: Date.now(),
    staleInProgressMs: coerced.staleInProgressMs,
  });

  return new Response(JSON.stringify({ ok: true, ...plan }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
};

export const config: Config = {
  path: '/api/asana/bootstrap-plan',
  method: ['POST', 'OPTIONS'],
};
