/**
 * Regulator Inspector Portal — serverless read-only query endpoint.
 *
 *   GET  /api/inspector/status            → health check + scopes served
 *   POST /api/inspector/query             → execute a scoped query
 *
 * This is the front door for a MoE / EOCN / CBUAE inspector to query
 * the compliance state WITHOUT being able to modify anything. Every
 * response is watermarked with the inspector session id and written
 * to an append-only audit log in Netlify Blobs.
 *
 * Auth model:
 *   - Inspector sessions are minted OUT OF BAND by the CO using the
 *     HAWKEYE_INSPECTOR_KEYS env var (comma-separated list of
 *     `authority:scope:hex-token`).
 *   - A request presents its token via Authorization: Bearer <token>.
 *   - The token is matched in constant time. Unknown token → 401.
 *
 * Scope enforcement: each token is tied to a single scope
 * (str | ctr | sanctions | dpms | ubo | all). A request for any OTHER
 * scope is rejected with 403.
 *
 * Rate limiting is applied via the existing checkRateLimit middleware.
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (regulatory access to internal records)
 *   - EOCN Inspection Manual v4 §7 (audit trail for regulator access)
 *   - FDL Art.24 (record retention)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { checkRateLimit } from './middleware/rate-limit.mts';

const AUDIT_STORE = 'inspector-audit';
const EVENT_STORE = 'brain-events';
const VALID_SCOPES = ['str', 'ctr', 'sanctions', 'dpms', 'ubo', 'all'] as const;
type InspectorScope = (typeof VALID_SCOPES)[number];

const VALID_AUTHORITIES = ['MoE', 'EOCN', 'CBUAE', 'LBMA', 'other'] as const;
type InspectorAuthority = (typeof VALID_AUTHORITIES)[number];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':
    process.env.HAWKEYE_ALLOWED_ORIGIN ?? 'https://hawkeye-sterling-v2.netlify.app',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

interface InspectorIdentity {
  authority: InspectorAuthority;
  scope: InspectorScope;
  tokenHash: string;
}

function parseInspectorKeys(): InspectorIdentity[] {
  const raw = process.env.HAWKEYE_INSPECTOR_KEYS;
  if (!raw) return [];
  const out: InspectorIdentity[] = [];
  for (const entry of raw.split(',')) {
    const [authority, scope, token] = entry.trim().split(':');
    if (!authority || !scope || !token) continue;
    if (!VALID_AUTHORITIES.includes(authority as InspectorAuthority)) continue;
    if (!VALID_SCOPES.includes(scope as InspectorScope)) continue;
    if (token.length < 32) continue;
    out.push({
      authority: authority as InspectorAuthority,
      scope: scope as InspectorScope,
      tokenHash: token,
    });
  }
  return out;
}

function authenticate(req: Request): { ok: true; identity: InspectorIdentity } | { ok: false; response: Response } {
  const header = req.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return {
      ok: false,
      response: jsonResponse({ error: 'missing bearer token' }, { status: 401 }),
    };
  }
  const presented = header.slice('Bearer '.length).trim();
  const identities = parseInspectorKeys();
  if (identities.length === 0) {
    return {
      ok: false,
      response: jsonResponse({ error: 'inspector portal not configured' }, { status: 503 }),
    };
  }
  const presentedBuf = Buffer.from(presented, 'utf8');
  for (const identity of identities) {
    const expectedBuf = Buffer.from(identity.tokenHash, 'utf8');
    if (presentedBuf.length !== expectedBuf.length) continue;
    if (timingSafeEqual(presentedBuf, expectedBuf)) {
      return { ok: true, identity };
    }
  }
  return {
    ok: false,
    response: jsonResponse({ error: 'invalid bearer token' }, { status: 401 }),
  };
}

interface AuditEntry {
  sessionId: string;
  authority: InspectorAuthority;
  scope: InspectorScope;
  at: string;
  action: 'status' | 'query';
  resourceType?: string;
  allowed: boolean;
  reason?: string;
}

async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    const store = getStore(AUDIT_STORE);
    const day = entry.at.slice(0, 10);
    const key = `audit/${day}/${entry.at}-${randomUUID()}.json`;
    await store.setJSON(key, entry);
  } catch (err) {
    // Do not crash the request on audit failure; log it.
    console.error('inspector audit write failed:', err);
  }
}

function isScopeAllowed(identity: InspectorIdentity, required: InspectorScope): boolean {
  return identity.scope === 'all' || identity.scope === required;
}

// ---------------------------------------------------------------------------
// Query handler
// ---------------------------------------------------------------------------

interface QueryRequest {
  resourceType: 'events';
  scope: InspectorScope;
  filter?: {
    fromIso?: string;
    toIso?: string;
    kind?: string;
    severity?: string;
  };
  limit?: number;
}

function validateQuery(input: unknown): { ok: true; query: QueryRequest } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'body must be an object' };
  const r = input as Record<string, unknown>;
  if (r.resourceType !== 'events') return { ok: false, error: 'unsupported resourceType' };
  if (typeof r.scope !== 'string' || !VALID_SCOPES.includes(r.scope as InspectorScope)) {
    return { ok: false, error: 'invalid scope' };
  }
  if (r.limit !== undefined && (typeof r.limit !== 'number' || r.limit < 1 || r.limit > 500)) {
    return { ok: false, error: 'limit must be in [1, 500]' };
  }
  return {
    ok: true,
    query: {
      resourceType: 'events',
      scope: r.scope as InspectorScope,
      filter: (r.filter as QueryRequest['filter']) ?? {},
      limit: (r.limit as number) ?? 100,
    },
  };
}

interface StoredBrainEvent {
  at: string;
  event: {
    kind: string;
    severity: string;
    summary: string;
    refId?: string;
  };
}

// Derive a set of per-day prefixes covering the requested date range.
// The brain-events blob keys are written with a yyyy-mm-dd prefix (see
// brain.mts persistEvent). Scanning by prefix turns the previous
// O(total-blobs-in-10-years) scan into O(days-in-window × daily-volume),
// which is the difference between a Lambda timeout and a fast response.
function datePrefixes(fromIso?: string, toIso?: string): string[] {
  const start = fromIso ? new Date(fromIso) : new Date(Date.now() - 30 * 86_400_000);
  const end = toIso ? new Date(toIso) : new Date();
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return [];
  if (end < start) return [];
  const prefixes: string[] = [];
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  let safetyGuard = 0;
  while (cursor <= end && safetyGuard < 400) {
    prefixes.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    safetyGuard++;
  }
  return prefixes;
}

// Hard ceilings to prevent the inspector from ever scanning the whole
// store regardless of user input. Matches the regulator-facing SLA.
const MAX_KEYS_SCANNED = 2_000;

async function fetchBrainEvents(query: QueryRequest): Promise<StoredBrainEvent[]> {
  const store = getStore(EVENT_STORE);
  const limit = Math.min(query.limit ?? 100, 500);
  const out: StoredBrainEvent[] = [];
  const prefixes = datePrefixes(query.filter?.fromIso, query.filter?.toIso);
  const prefixList = prefixes.length ? prefixes : [''];
  let scanned = 0;
  for (const prefix of prefixList) {
    if (out.length >= limit || scanned >= MAX_KEYS_SCANNED) break;
    let listing;
    try {
      listing = await (store as any).list(prefix ? { prefix } : undefined);
    } catch (err) {
      console.warn('[inspector] list failed for prefix ' + prefix, err);
      continue;
    }
    for (const entry of listing.blobs || []) {
      if (out.length >= limit || scanned >= MAX_KEYS_SCANNED) break;
      scanned++;
      try {
        const blob = await store.get(entry.key, { type: 'json' });
        if (!blob || typeof blob !== 'object') continue;
        const stored = blob as StoredBrainEvent;
        if (!stored.at || !stored.event) continue;
        if (query.filter?.fromIso && stored.at < query.filter.fromIso) continue;
        if (query.filter?.toIso && stored.at > query.filter.toIso) continue;
        if (query.filter?.kind && stored.event.kind !== query.filter.kind) continue;
        if (query.filter?.severity && stored.event.severity !== query.filter.severity) continue;
        out.push(stored);
      } catch {
        /* skip malformed entries */
      }
    }
  }
  if (scanned >= MAX_KEYS_SCANNED) {
    console.warn('[inspector] fetchBrainEvents hit MAX_KEYS_SCANNED=' + MAX_KEYS_SCANNED + '; narrow the date range');
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: Request, ctx: Context): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Inspector portal — regulator-facing, sensitive. 20 req/min per IP.
  // checkRateLimit returns a Response on breach, or null otherwise.
  const rateLimited = await checkRateLimit(req, {
    windowMs: 60_000,
    max: 20,
    clientIp: ctx.ip,
  });
  if (rateLimited) return rateLimited;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response;
  const sessionId = randomUUID();

  const url = new URL(req.url);

  if (req.method === 'GET' && url.pathname.endsWith('/status')) {
    await writeAudit({
      sessionId,
      authority: auth.identity.authority,
      scope: auth.identity.scope,
      at: new Date().toISOString(),
      action: 'status',
      allowed: true,
    });
    return jsonResponse({
      ok: true,
      authority: auth.identity.authority,
      scope: auth.identity.scope,
      sessionId,
      ts: new Date().toISOString(),
    });
  }

  if (req.method === 'POST' && url.pathname.endsWith('/query')) {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'invalid json' }, { status: 400 });
    }
    const validation = validateQuery(body);
    if (!validation.ok) {
      return jsonResponse({ error: validation.error }, { status: 400 });
    }
    const query = validation.query;
    if (!isScopeAllowed(auth.identity, query.scope)) {
      await writeAudit({
        sessionId,
        authority: auth.identity.authority,
        scope: query.scope,
        at: new Date().toISOString(),
        action: 'query',
        resourceType: query.resourceType,
        allowed: false,
        reason: `scope ${query.scope} not granted to this session`,
      });
      return jsonResponse({ error: 'scope not granted' }, { status: 403 });
    }

    try {
      const items = await fetchBrainEvents(query);
      const nowIso = new Date().toISOString();
      await writeAudit({
        sessionId,
        authority: auth.identity.authority,
        scope: query.scope,
        at: nowIso,
        action: 'query',
        resourceType: query.resourceType,
        allowed: true,
      });
      return jsonResponse({
        ok: true,
        sessionId,
        watermark: `INSPECTOR:${sessionId}|${auth.identity.authority}|${nowIso}`,
        at: nowIso,
        count: items.length,
        items,
      });
    } catch (err) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  }

  return jsonResponse({ error: 'not found' }, { status: 404 });
}

export const config: Config = {
  path: ['/api/inspector/status', '/api/inspector/query'],
};
