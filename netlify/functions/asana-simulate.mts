/**
 * Asana Simulation Harness — POST /api/asana/simulate
 *
 * Generates a batch of synthetic compliance cases via
 * `buildSimulationBatch` and persists them as an Asana plan for the
 * executor to spawn. MLROs use this endpoint to practice the
 * workflow end-to-end without touching real customer data.
 *
 * Body shape:
 *   {
 *     count?: number,  // default 10, hard cap 50
 *     seed?: number    // default 42 (deterministic)
 *   }
 *
 * Regulatory basis:
 *   FATF Rec 18 (training)
 *   NIST AI RMF MAP 2.4 (operator competence)
 *   EU AI Act Art.15 (continuous testing)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { buildSimulationBatch } from '../../src/services/asanaSimulationHarness';

const PLAN_STORE = 'asana-simulation-plans';
const AUDIT_STORE = 'asana-simulation-audit';
const MAX_COUNT = 50;

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    clientIp: context.ip,
    max: 5,
    namespace: 'asana-simulate',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response ?? Response.json({ error: 'Unauthorized' }, { status: 401 });

  // Small-body endpoint — simulate only accepts { count?, seed? }.
  // Cap the body at 4 KB to match the input shape.
  const SIMULATE_MAX_BODY_BYTES = 4 * 1024;
  const contentLengthHeader = req.headers.get('content-length');
  if (contentLengthHeader) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > SIMULATE_MAX_BODY_BYTES) {
      return Response.json({ error: 'Body exceeds 4 KB cap for this endpoint.' }, { status: 413 });
    }
  }

  let body: { count?: number; seed?: number } = {};
  try {
    const raw = await req.text();
    if (raw.length > SIMULATE_MAX_BODY_BYTES) {
      return Response.json({ error: 'Body exceeds 4 KB cap for this endpoint.' }, { status: 413 });
    }
    if (raw.length > 0) body = JSON.parse(raw) as typeof body;
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const count = Math.min(
    Math.max(Number.isFinite(body.count) ? (body.count as number) : 10, 1),
    MAX_COUNT
  );
  const seed = Number.isFinite(body.seed) ? (body.seed as number) : 42;

  let tasks;
  try {
    tasks = buildSimulationBatch({ count, seed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }

  const iso = new Date().toISOString();
  const planStore = getStore(PLAN_STORE);
  await planStore.setJSON(`${iso.slice(0, 10)}/${Date.now()}.json`, {
    at: iso,
    count,
    seed,
    tasks,
  });
  const auditStore = getStore(AUDIT_STORE);
  await auditStore.setJSON(`${iso.slice(0, 10)}/${Date.now()}.json`, {
    event: 'asana_simulate_batch',
    count,
    seed,
    recordedAt: iso,
  });

  return new Response(JSON.stringify({ ok: true, count, seed, tasks }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
};

export const config: Config = {
  path: '/api/asana/simulate',
  method: ['POST', 'OPTIONS'],
};
