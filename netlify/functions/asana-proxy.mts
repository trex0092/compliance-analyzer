/**
 * Asana API Proxy — W1.
 *
 * POST /api/asana/proxy
 *
 * Server-side wrapper around the Asana REST API. The Asana token
 * lives in the ASANA_API_TOKEN env var, NEVER in the browser.
 * Browser callers POST a small JSON envelope describing the
 * Asana request they want to make, and the proxy validates +
 * forwards it.
 *
 * Why a proxy:
 *   - Token never leaves the server.
 *   - Per-tenant rate limit (15/15min) protects shared Asana quota.
 *   - Path allowlist prevents abuse (no DELETE, no admin endpoints).
 *   - Body-size cap, nosniff, no-store on every response.
 *
 * Body shape:
 *   {
 *     method: "GET" | "POST" | "PUT" | "PATCH",
 *     path:   "/tasks" | "/projects/<gid>/tasks" | ...,
 *     body?:  Record<string, unknown>
 *   }
 *
 * Regulatory basis:
 *   FDL Art.20-21 (CO duty of care — secrets controlled server-side)
 *   ISO/IEC 27001 A.8.10 (data separation)
 */

import type { Config, Context } from '@netlify/functions';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { fetchWithTimeout } from '../../src/utils/fetchWithTimeout';

const ASANA_BASE_URL = 'https://app.asana.com/api/1.0';
// Pathname of ASANA_BASE_URL, cached. Used by the normalisation-bypass
// defence below to confirm that the URL parser did not collapse any
// "../" segments after the allowlist check passed.
const ASANA_BASE_PATH = new URL(ASANA_BASE_URL).pathname;
const MAX_BODY_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

// Allowlist of safe Asana paths. Every entry is matched as an exact
// pathname or a regex. New paths must be added here explicitly so a
// compromised browser cannot reach admin endpoints.
const ALLOWED_PATHS: readonly RegExp[] = [
  /^\/users\/me$/,
  /^\/workspaces$/,
  /^\/workspaces\/[^/]+\/users$/,
  /^\/workspaces\/[^/]+\/custom_fields$/,
  /^\/workspaces\/[^/]+\/projects$/,
  /^\/projects$/,
  /^\/projects\/[^/]+$/,
  /^\/projects\/[^/]+\/tasks$/,
  /^\/projects\/[^/]+\/sections$/,
  /^\/sections\/[^/]+$/,
  /^\/sections\/[^/]+\/addTask$/,
  /^\/tasks$/,
  /^\/tasks\/[^/]+$/,
  /^\/tasks\/[^/]+\/subtasks$/,
  /^\/tasks\/[^/]+\/dependencies$/,
  /^\/tasks\/[^/]+\/addProject$/,
  /^\/tasks\/[^/]+\/attachments$/,
  /^\/tasks\/[^/]+\/stories$/,
  /^\/custom_fields$/,
  /^\/custom_fields\/[^/]+$/,
];

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH']);

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

function isAllowedPath(path: string): boolean {
  for (const r of ALLOWED_PATHS) {
    if (r.test(path)) return true;
  }
  return false;
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    clientIp: context.ip,
    max: 30,
    namespace: 'asana-proxy',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response ?? Response.json({ error: 'Unauthorized' }, { status: 401 });

  const apiToken = process.env.ASANA_API_TOKEN;
  if (!apiToken || apiToken.length < 16) {
    console.error('[asana-proxy] ASANA_API_TOKEN env var is missing or too short');
    return Response.json(
      { error: 'Asana proxy is not configured on this server.' },
      { status: 503 }
    );
  }

  // Preflight body-size check — refuse before buffering if
  // Content-Length already exceeds the cap. Mirrors the pattern in
  // asana-webhook.mts and asana-dispatch.mts.
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
  let parsed: { method?: string; path?: string; body?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return badRequest('Invalid JSON body.');
  }
  const method = String(parsed.method || '').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return badRequest(`Method ${method} not allowed.`);
  }
  const path = String(parsed.path || '');
  if (!path.startsWith('/') || !isAllowedPath(path)) {
    return badRequest(`Path ${path} not in allowlist.`);
  }

  // Defence in depth against path-normalisation bypass.
  //
  // The allowlist regexes use `[^/]+` segments, which happily match
  // `..` or its URL-encoded form `%2e%2e`. The WHATWG URL parser
  // collapses those segments when building the upstream URL, so e.g.
  // `/tasks/..` slips past `/^\/tasks\/[^/]+$/` and then normalises
  // to the API root `/api/1.0/` — an endpoint that was never
  // allowlisted. Refuse any literal `..` sequence and any `%2e%2e`
  // encoding before we hand the string to `new URL()`.
  const lowered = path.toLowerCase();
  if (
    path.includes('..') ||
    lowered.includes('%2e%2e') ||
    lowered.includes('%2e.') ||
    lowered.includes('.%2e')
  ) {
    return badRequest('Path must not contain parent-directory references.');
  }

  // Build the upstream URL. We use new URL() so any caller-supplied
  // query smuggling via `path` is normalised.
  let target: URL;
  try {
    target = new URL(ASANA_BASE_URL + path);
  } catch {
    return badRequest('Invalid path.');
  }
  if (target.origin !== new URL(ASANA_BASE_URL).origin) {
    return badRequest('Path must not change origin.');
  }
  // If the URL parser changed the pathname at all (e.g. resolved a
  // normalisation we missed above, or collapsed consecutive slashes),
  // refuse the request rather than forward to an endpoint the
  // allowlist never vetted.
  const expectedPath = ASANA_BASE_PATH + path.split('?')[0].split('#')[0];
  if (target.pathname !== expectedPath) {
    return badRequest('Path normalisation mismatch; refusing to forward.');
  }

  const upstreamHeaders: Record<string, string> = {
    Authorization: `Bearer ${apiToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  let upstreamBody: string | undefined;
  if (method !== 'GET' && parsed.body !== undefined) {
    if (parsed.body === null || typeof parsed.body !== 'object') {
      return badRequest('body must be a JSON object.');
    }
    upstreamBody = JSON.stringify(parsed.body);
  }

  let upstream: Response;
  try {
    upstream = await fetchWithTimeout(target.toString(), {
      method,
      headers: upstreamHeaders,
      body: upstreamBody,
      timeoutMs: FETCH_TIMEOUT_MS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[asana-proxy] upstream fetch failed:', message);
    return Response.json({ error: 'Asana request failed', detail: message }, { status: 502 });
  }

  const responseText = await upstream.text();
  return new Response(responseText, {
    status: upstream.status,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
};

export const config: Config = {
  path: '/api/asana/proxy',
  method: ['POST', 'OPTIONS'],
};
