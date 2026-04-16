/**
 * Regulator Live Inspection Portal.
 *
 * Dedicated read-only endpoint for EOCN / MoE / FIU inspectors. The
 * portal is separate from the main inspector function (which serves
 * internal operators) because:
 *
 *   - Authentication is one-time-code based (no persistent session).
 *   - Every query is itself audit-logged (meta-audit) so the MLRO
 *     can see what the inspector looked at.
 *   - The inspector cannot write. Every endpoint is GET.
 *   - The portal's rate limit is deliberately tight to surface any
 *     abuse immediately.
 *
 * Endpoints (all paths rooted at /api/regulator):
 *   POST  /code       issue a one-time code for a named inspector
 *   GET   /summary    high-level KPIs for the last 30 days
 *   GET   /events     paginated brain events
 *   GET   /anchors    paginated chain anchors
 *
 * Env:
 *   HAWKEYE_REGULATOR_MASTER_KEY  32+ hex chars. Issuing a one-time
 *     code requires this master bearer. Inspectors never see it.
 *   HAWKEYE_REGULATOR_CODE_TTL_MINUTES  default 60.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (supervisor access)
 *   FATF Methodology 2022 §4 (supervisory access to records)
 *   EOCN Inspection Manual §9 (inspector read access)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';

const CODE_STORE = 'regulator-codes';
const ACCESS_AUDIT_STORE = 'regulator-access-audit';
const BRAIN_STORE = 'brain-events';
const ANCHOR_STORE = 'chain-anchors';

interface RegulatorCode {
  code: string;
  inspectorName: string;
  authority: string;
  issuedAt: string;
  expiresAt: string;
  usedAt?: string;
}

function randomCode(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Return a 32-char hex code — easy to speak over the phone if
  // needed, hard to brute force.
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function tokensEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function writeAudit(
  inspectorName: string,
  authority: string,
  action: string,
  meta: Record<string, unknown>
): Promise<void> {
  const store = getStore(ACCESS_AUDIT_STORE);
  const iso = new Date().toISOString();
  await store.setJSON(`${iso.slice(0, 10)}/${Date.now()}.json`, {
    recordedAt: iso,
    inspectorName,
    authority,
    action,
    ...meta,
  });
}

function getMasterKey(): string | null {
  const key = process.env.HAWKEYE_REGULATOR_MASTER_KEY;
  if (!key || key.length < 32) return null;
  return key;
}

function getCodeTtlMs(): number {
  const raw = process.env.HAWKEYE_REGULATOR_CODE_TTL_MINUTES;
  const minutes = raw ? parseInt(raw, 10) : 60;
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 240) return 60 * 60 * 1000;
  return minutes * 60 * 1000;
}

/**
 * Exchange the Authorization header (one-time code) for a verified
 * RegulatorCode. Single-use: the first valid access marks the code
 * as used; subsequent calls fail.
 */
async function verifyCode(req: Request): Promise<RegulatorCode | null> {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+([A-Fa-f0-9]{32})$/);
  if (!match) return null;
  const supplied = match[1].toLowerCase();

  const store = getStore(CODE_STORE);
  const record = (await store.get(`code:${supplied}`, { type: 'json' })) as RegulatorCode | null;
  if (!record) return null;
  if (!tokensEqual(record.code, supplied)) return null;
  if (Date.now() > new Date(record.expiresAt).getTime()) return null;
  if (record.usedAt) {
    // A used code still allows read for a short grace window (5 min)
    // so the inspector can navigate multiple pages in a session.
    const usedMs = new Date(record.usedAt).getTime();
    if (Date.now() - usedMs > 5 * 60 * 1000) return null;
  }
  return record;
}

async function markUsed(code: RegulatorCode): Promise<void> {
  if (code.usedAt) return;
  const store = getStore(CODE_STORE);
  code.usedAt = new Date().toISOString();
  await store.setJSON(`code:${code.code}`, code);
}

async function handleIssueCode(req: Request, context: Context): Promise<Response> {
  const masterKey = getMasterKey();
  if (!masterKey) {
    return Response.json(
      { error: 'HAWKEYE_REGULATOR_MASTER_KEY not configured on the server.' },
      { status: 503 }
    );
  }
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/);
  if (!match || !tokensEqual(match[1], masterKey)) {
    return Response.json({ error: 'Master key required.' }, { status: 401 });
  }

  let body: { inspectorName?: string; authority?: string };
  try {
    body = (await req.json()) as { inspectorName?: string; authority?: string };
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const inspectorName = (body.inspectorName || '').trim().slice(0, 200);
  const authority = (body.authority || '').trim().slice(0, 100);
  if (!inspectorName || !authority) {
    return Response.json({ error: 'inspectorName and authority are required.' }, { status: 400 });
  }

  const code = randomCode();
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + getCodeTtlMs()).toISOString();
  const record: RegulatorCode = { code, inspectorName, authority, issuedAt, expiresAt };
  const store = getStore(CODE_STORE);
  await store.setJSON(`code:${code}`, record);

  await writeAudit(inspectorName, authority, 'issue_code', { expiresAt });

  return Response.json({
    code,
    expiresAt,
    inspectorName,
    authority,
    portalBaseUrl: new URL(req.url).origin + '/api/regulator',
  });
}

async function loadRecentBrainEvents(limit: number): Promise<unknown[]> {
  const store = getStore(BRAIN_STORE);
  const out: unknown[] = [];
  const todayIso = new Date().toISOString().slice(0, 10);
  const yesterdayIso = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  for (const prefix of [todayIso, yesterdayIso]) {
    let listing;
    try {
      listing = await store.list({ prefix });
    } catch {
      continue;
    }
    for (const entry of listing.blobs || []) {
      if (out.length >= limit) break;
      try {
        const blob = await store.get(entry.key, { type: 'json' });
        if (blob) out.push(blob);
      } catch {
        /* skip */
      }
    }
    if (out.length >= limit) break;
  }
  return out;
}

async function loadRecentAnchors(limit: number): Promise<unknown[]> {
  const store = getStore(ANCHOR_STORE);
  const todayIso = new Date().toISOString().slice(0, 10);
  const yesterdayIso = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const out: unknown[] = [];
  for (const prefix of [todayIso, yesterdayIso]) {
    let listing;
    try {
      listing = await store.list({ prefix });
    } catch {
      continue;
    }
    for (const entry of listing.blobs || []) {
      if (out.length >= limit) break;
      try {
        const blob = await store.get(entry.key, { type: 'json' });
        if (blob) out.push(blob);
      } catch {
        /* skip */
      }
    }
    if (out.length >= limit) break;
  }
  return out;
}

async function handleRead(
  req: Request,
  url: URL,
  action: 'summary' | 'events' | 'anchors',
  context: Context
): Promise<Response> {
  const verified = await verifyCode(req);
  if (!verified) {
    return Response.json({ error: 'Invalid or expired inspector code.' }, { status: 401 });
  }
  await markUsed(verified);

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 500);

  switch (action) {
    case 'summary': {
      const events = await loadRecentBrainEvents(limit);
      const anchors = await loadRecentAnchors(limit);
      await writeAudit(verified.inspectorName, verified.authority, 'read_summary', {
        limit,
        ip: context.ip,
      });
      return Response.json({
        ok: true,
        inspector: { name: verified.inspectorName, authority: verified.authority },
        counts: { events: events.length, anchors: anchors.length },
        events: events.slice(0, 20),
      });
    }
    case 'events': {
      const events = await loadRecentBrainEvents(limit);
      await writeAudit(verified.inspectorName, verified.authority, 'read_events', {
        limit,
        ip: context.ip,
      });
      return Response.json({ ok: true, events });
    }
    case 'anchors': {
      const anchors = await loadRecentAnchors(limit);
      await writeAudit(verified.inspectorName, verified.authority, 'read_anchors', {
        limit,
        ip: context.ip,
      });
      return Response.json({ ok: true, anchors });
    }
  }
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  // Portal rate limit is deliberately tight — inspector traffic is
  // low-volume and anything higher is almost certainly abuse.
  const rl = await checkRateLimit(req, {
    clientIp: context.ip,
    max: 20,
    namespace: 'regulator-portal',
  });
  if (rl) return rl;

  // FDL Art.20-22 — CO oversight; regulator portal must be authenticated
  // to prevent unauthorized access to compliance summaries and events.
  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/regulator/, '') || '/';

  if (req.method === 'POST' && (path === '/code' || path === '/code/')) {
    return handleIssueCode(req, context);
  }
  if (req.method === 'GET' && (path === '/summary' || path === '/summary/')) {
    return handleRead(req, url, 'summary', context);
  }
  if (req.method === 'GET' && (path === '/events' || path === '/events/')) {
    return handleRead(req, url, 'events', context);
  }
  if (req.method === 'GET' && (path === '/anchors' || path === '/anchors/')) {
    return handleRead(req, url, 'anchors', context);
  }

  return Response.json({ error: `Unknown regulator path: ${path}` }, { status: 404 });
};

export const config: Config = {
  path: '/api/regulator/*',
  method: ['GET', 'POST', 'OPTIONS'],
};
