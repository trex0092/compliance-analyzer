/**
 * Asana ↔ Brain State Reconciler — Phase 19 W-C read-only endpoint.
 *
 * POST /api/asana/reconcile-plan
 *
 * Read-only. Takes two snapshots (brain-side case list + Asana-side
 * task list for one tenant) and returns the reconciliation actions
 * that would bring the brain into agreement:
 *
 *   {
 *     ok: true,
 *     tenantId,
 *     actions: [
 *       { kind: "advance_brain_to_completed" | ..., caseId, narrative, ... }
 *     ],
 *     inAgreement: [caseId, ...],
 *     tolerated: [caseId, ...]
 *   }
 *
 * Callers provide both snapshots explicitly. The endpoint does not
 * read from any state store and does not mutate anything. The
 * actual reconciliation execution (brain-state updates + audit
 * rows) is a separate follow-on that must decide the blob / API
 * read paths for both sides.
 *
 * Intended callers:
 *   - The 5-minute reconciler cron (follow-on PR).
 *   - The MLRO dashboard's "what would reconcile now" preview.
 *   - Integration tests where both inputs are explicit.
 *
 * Underlying pure compute: src/services/asanaBrainStateReconciler.ts
 * (PR #188). This endpoint wires only auth + input validation; the
 * reconciler itself is already tested in
 * tests/asanaBrainStateReconciler.test.ts (15 cases).
 *
 * Regulatory anchor:
 *   FDL No. 10 of 2025 Art.20 — MLRO visibility; brain and Asana
 *     must agree.
 *   FDL No. 10 of 2025 Art.24 — 10-year retention of reconciliation
 *     decisions (follow-on PR will write audit rows).
 *   Cabinet Resolution 134/2025 Art.12-14 — four-eyes integrity.
 */

import type { Config, Context } from '@netlify/functions';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';
import {
  reconcileTenant,
  type AsanaTaskSnapshot,
  type BrainCase,
} from '../../src/services/asanaBrainStateReconciler';

const MAX_BODY_BYTES = 256 * 1024;

interface RequestShape {
  tenantId: string;
  brainCases: BrainCase[];
  asanaTasks: AsanaTaskSnapshot[];
  toleranceMs?: number;
}

function coerceRequest(raw: unknown): RequestShape | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Body must be a JSON object.' };
  const r = raw as Record<string, unknown>;
  if (typeof r.tenantId !== 'string' || r.tenantId.length === 0) {
    return { error: 'tenantId is required.' };
  }
  if (!Array.isArray(r.brainCases)) {
    return { error: 'brainCases must be an array.' };
  }
  if (!Array.isArray(r.asanaTasks)) {
    return { error: 'asanaTasks must be an array.' };
  }
  if (r.brainCases.length > 2000) {
    return { error: 'brainCases must not exceed 2000 entries per request.' };
  }
  if (r.asanaTasks.length > 2000) {
    return { error: 'asanaTasks must not exceed 2000 entries per request.' };
  }
  if (
    r.toleranceMs !== undefined &&
    (typeof r.toleranceMs !== 'number' || !Number.isFinite(r.toleranceMs) || r.toleranceMs < 0)
  ) {
    return { error: 'toleranceMs must be a non-negative finite number if provided.' };
  }
  return {
    tenantId: r.tenantId,
    brainCases: r.brainCases as BrainCase[],
    asanaTasks: r.asanaTasks as AsanaTaskSnapshot[],
    toleranceMs: typeof r.toleranceMs === 'number' ? r.toleranceMs : undefined,
  };
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    clientIp: context.ip,
    max: 30,
    namespace: 'asana-reconcile-plan',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response ?? Response.json({ error: 'Unauthorized' }, { status: 401 });

  const contentLengthHeader = req.headers.get('content-length');
  if (contentLengthHeader) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return Response.json({ error: 'Body exceeds 256 KB cap.' }, { status: 413 });
    }
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: 'Body exceeds 256 KB cap.' }, { status: 413 });
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

  const result = reconcileTenant(coerced.tenantId, coerced.brainCases, coerced.asanaTasks, {
    nowMs: Date.now(),
    toleranceMs: coerced.toleranceMs,
  });

  return new Response(JSON.stringify({ ok: true, ...result }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
};

export const config: Config = {
  path: '/api/asana/reconcile-plan',
  method: ['POST', 'OPTIONS'],
};
