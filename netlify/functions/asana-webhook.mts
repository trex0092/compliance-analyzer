/**
 * Asana Webhook Receiver — W5.
 *
 * POST /api/asana/webhook
 *
 * Receives Asana webhook events (task completed, comment added,
 * due-date passed, custom-field changed) and feeds them into the
 * compliance audit chain + war-room feed. This is how Asana → us
 * sync works: when an MLRO marks a four-eyes subtask complete in
 * Asana, the parent decision in the compliance brain learns about
 * it within seconds.
 *
 * Asana webhooks use a two-phase handshake:
 *   1. First request: Asana sends `X-Hook-Secret` header.
 *      We must echo it back verbatim AND store it for later
 *      signature verification.
 *   2. Subsequent requests: Asana sends `X-Hook-Signature` header
 *      computed as HMAC-SHA256(secret, body).
 *      We re-compute and compare with constant-time equality.
 *
 * Regulatory basis:
 *   FDL Art.24 (record reconstruction)
 *   FDL Art.20-21 (CO duty of care — every Asana action audited)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';

const SECRET_STORE = 'asana-webhook-secrets';
const EVENT_STORE = 'asana-webhook-events';
const AUDIT_STORE = 'asana-webhook-audit';
const MAX_BODY_BYTES = 256 * 1024;

function tokensEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function writeAudit(payload: Record<string, unknown>): Promise<void> {
  const store = getStore(AUDIT_STORE);
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
    max: 60,
    namespace: 'asana-webhook',
  });
  if (rl) return rl;

  const url = new URL(req.url);
  // Asana scopes secrets per webhook target. We use the workspaceGid
  // query param as the secret key — Asana itself sends this back on
  // every payload so we can look up the right secret.
  const workspaceGid = (url.searchParams.get('workspaceGid') || 'default').replace(
    /[^a-zA-Z0-9_-]/g,
    '_'
  );

  const secretStore = getStore(SECRET_STORE);

  // Phase 1: handshake. Asana sets X-Hook-Secret on the very first
  // request. We must echo it back AND store it for verification.
  const incomingSecret = req.headers.get('x-hook-secret');
  if (incomingSecret) {
    if (incomingSecret.length < 32 || incomingSecret.length > 200) {
      return Response.json({ error: 'Invalid X-Hook-Secret length.' }, { status: 400 });
    }
    await secretStore.setJSON(`secret:${workspaceGid}.json`, {
      secret: incomingSecret,
      registeredAt: new Date().toISOString(),
    });
    await writeAudit({
      event: 'asana_webhook_handshake',
      workspaceGid,
      ip: context.ip,
    });
    return new Response(null, {
      status: 200,
      headers: { 'X-Hook-Secret': incomingSecret },
    });
  }

  // Phase 2: signed payload. Look up the stored secret and verify.
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: 'Body exceeds 256 KB cap.' }, { status: 400 });
  }
  const stored = (await secretStore.get(`secret:${workspaceGid}.json`, { type: 'json' })) as
    | { secret?: string }
    | null;
  if (!stored?.secret) {
    await writeAudit({
      event: 'asana_webhook_unregistered',
      workspaceGid,
      ip: context.ip,
    });
    return Response.json({ error: 'Webhook not registered for this workspace.' }, { status: 401 });
  }

  const incomingSig = req.headers.get('x-hook-signature') || '';
  const expectedSig = await hmacSha256Hex(stored.secret, raw);
  if (!tokensEqual(incomingSig, expectedSig)) {
    await writeAudit({
      event: 'asana_webhook_bad_signature',
      workspaceGid,
      ip: context.ip,
    });
    return Response.json({ error: 'Bad signature.' }, { status: 401 });
  }

  // Persist the verified payload. Downstream consumers (the sync cron,
  // the brain feed publisher) read from the event store.
  let payload: { events?: unknown[] };
  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const events = Array.isArray(payload.events) ? payload.events : [];
  const eventStore = getStore(EVENT_STORE);
  const iso = new Date().toISOString();
  await eventStore.setJSON(`${iso.slice(0, 10)}/${workspaceGid}-${Date.now()}.json`, {
    workspaceGid,
    receivedAt: iso,
    events,
  });
  await writeAudit({
    event: 'asana_webhook_received',
    workspaceGid,
    eventCount: events.length,
  });

  return Response.json({ ok: true, eventCount: events.length });
};

export const config: Config = {
  path: '/api/asana/webhook',
  method: ['POST', 'OPTIONS'],
};
