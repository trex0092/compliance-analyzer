/**
 * Asana Dispatch Endpoint — W2.
 *
 * POST /api/asana/dispatch
 *
 * Takes an OrchestrationEvent and returns the OrchestratedAsanaPlan
 * the executor should apply. The actual `createAsanaTask` / project
 * / subtask API calls are made by the proxy endpoint below, but the
 * dispatcher is the routing layer that decides which template to
 * spawn, which custom fields to populate, which SLA to attach, and
 * whether to also page on-call via the breakglass channel.
 *
 * The dispatcher is stateless — it uses pure compute via
 * `orchestrateAsanaForEvent`. Persistence + Asana API calls live in
 * the executor (which a follow-up cron will run).
 *
 * Why decouple dispatch from execution: a long-running brain decision
 * can compute its plan synchronously here, persist it to a queue, and
 * return immediately. The executor then drains the queue with
 * retries via `asanaQueue.processRetryQueue`. This is the same
 * pattern as the brain notify hook + brain Netlify function.
 *
 * Body shape: `OrchestrationEvent` from asanaComplianceOrchestrator.
 *
 * Regulatory basis:
 *   FDL Art.20-21 (CO duty of care)
 *   Cabinet Res 134/2025 Art.19 (auditable workflow)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';
import {
  orchestrateAsanaForEvent,
  type OrchestrationEvent,
} from '../../src/services/asanaComplianceOrchestrator';

const PLAN_STORE = 'asana-plans';
const DISPATCH_AUDIT_STORE = 'asana-dispatch-audit';
const MAX_BODY_BYTES = 512 * 1024;

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

function coerceEvent(raw: unknown): OrchestrationEvent | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Body must be a JSON object.' };
  const r = raw as Record<string, unknown>;
  if (typeof r.kind !== 'string') return { error: 'kind is required.' };
  if (typeof r.tenantId !== 'string' || r.tenantId.length === 0)
    return { error: 'tenantId is required.' };
  if (typeof r.occurredAtIso !== 'string') return { error: 'occurredAtIso is required.' };
  if (typeof r.refId !== 'string' || r.refId.length === 0) return { error: 'refId is required.' };
  // Block raw Emirates IDs from the dispatch surface.
  if (/\b784-\d{4}-\d{7}-\d\b/.test(JSON.stringify(raw))) {
    return { error: 'Raw Emirates ID detected — pseudonymize before dispatching.' };
  }
  return r as unknown as OrchestrationEvent;
}

async function persistPlan(plan: unknown, refId: string): Promise<void> {
  const store = getStore(PLAN_STORE);
  const iso = new Date().toISOString();
  await store.setJSON(`${iso.slice(0, 10)}/${refId}-${Date.now()}.json`, {
    at: iso,
    refId,
    plan,
  });
}

async function writeAudit(payload: Record<string, unknown>): Promise<void> {
  const store = getStore(DISPATCH_AUDIT_STORE);
  const iso = new Date().toISOString();
  await store.setJSON(`${iso.slice(0, 10)}/${Date.now()}.json`, {
    ...payload,
    recordedAt: iso,
  });
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    clientIp: context.ip,
    max: 30,
    namespace: 'asana-dispatch',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response ?? Response.json({ error: 'Unauthorized' }, { status: 401 });

  // Preflight body-size check. If Content-Length already exceeds the
  // cap, refuse before buffering — a multi-megabyte payload would
  // otherwise force the runtime to allocate the full buffer before
  // we learn it was over limit.
  const contentLengthHeader = req.headers.get('content-length');
  if (contentLengthHeader) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      await writeAudit({
        event: 'asana_dispatch_body_too_large',
        ip: context.ip,
        declaredBytes: declared,
        cap: MAX_BODY_BYTES,
      });
      return Response.json({ error: 'Body exceeds 512 KB cap.' }, { status: 413 });
    }
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    await writeAudit({
      event: 'asana_dispatch_body_too_large_post_read',
      ip: context.ip,
      actualBytes: raw.length,
      cap: MAX_BODY_BYTES,
    });
    return Response.json({ error: 'Body exceeds 512 KB cap.' }, { status: 413 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return badRequest('Invalid JSON body.');
  }
  const event = coerceEvent(parsed);
  if ('error' in event) return badRequest(event.error);

  try {
    const plan = orchestrateAsanaForEvent(event);
    await persistPlan(plan, event.refId);
    await writeAudit({
      event: 'asana_dispatch_planned',
      refId: event.refId,
      kind: event.kind,
      tenantId: event.tenantId,
      taskCount: plan.tasks.length,
      hasFourEyes: !!plan.fourEyes,
      hasBreakglass: !!plan.breakglass,
    });
    return new Response(JSON.stringify({ ok: true, plan }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[asana-dispatch] orchestrator failure:', message);
    await writeAudit({ event: 'asana_dispatch_failed', refId: event.refId, error: message });
    return Response.json(
      { ok: false, error: 'Orchestrator failure', detail: message },
      { status: 500 }
    );
  }
};

export const config: Config = {
  path: '/api/asana/dispatch',
  method: ['POST', 'OPTIONS'],
};
