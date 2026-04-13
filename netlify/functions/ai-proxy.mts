/**
 * AI API Proxy — Netlify Function
 *
 * Proxies requests to AI providers (Anthropic, OpenAI, Google Gemini)
 * so that API keys stay server-side in environment variables and are
 * never exposed to the browser.
 *
 * Security:
 *   - API keys read from Netlify env vars (not client-side)
 *   - Request validation and size limiting
 *   - Rate limiting (10 req / 15 min per IP)
 *   - Authenticated (requires valid session token)
 *   - Response streaming supported
 */

import type { Config, Context } from '@netlify/functions';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';

// ─── Provider Config ────────────────────────────────────────────────────────

interface ProviderConfig {
  baseUrl: string;
  envKey: string;
  authHeader: (key: string) => Record<string, string>;
  /** Allowed path prefixes (prevent SSRF) */
  allowedPaths: string[];
}

const PROVIDERS: Record<string, ProviderConfig> = {
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    envKey: 'ANTHROPIC_API_KEY',
    authHeader: (key) => ({
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }),
    allowedPaths: ['/v1/messages', '/v1/complete'],
  },
  openai: {
    baseUrl: 'https://api.openai.com',
    envKey: 'OPENAI_API_KEY',
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
    allowedPaths: ['/v1/chat/completions', '/v1/completions', '/v1/embeddings'],
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com',
    envKey: 'GOOGLE_AI_API_KEY',
    authHeader: () => ({}), // Gemini uses query param
    allowedPaths: ['/v1beta/models', '/v1/models'],
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api',
    envKey: 'OPENROUTER_API_KEY',
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
    allowedPaths: ['/v1/chat/completions'],
  },
};

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB max request body

/**
 * Allowlist of Anthropic beta features we forward from the caller into the
 * `anthropic-beta` header. Anything not in this list is silently dropped so
 * the proxy can't be tricked into enabling unintended betas.
 *
 * Advisor Strategy (claude.com/blog/the-advisor-strategy): the advisor tool
 * is in beta and requires `advisor-tool-2026-03-01` to be sent as a beta
 * header. Without this forwarding, compliance-critical calls that want a
 * Sonnet-executor + Opus-advisor pairing cannot invoke the tool through the
 * proxy.
 */
const ALLOWED_ANTHROPIC_BETAS = new Set<string>([
  'advisor-tool-2026-03-01',
]);

// ─── Handler ────────────────────────────────────────────────────────────────

export default async (req: Request, context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  // Rate limit: 10 AI requests per 15 min
  const rl = await checkRateLimit(req, { max: 10, clientIp: context.ip });
  if (rl) return rl;

  // Authentication required
  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  // Parse request
  let body: {
    provider: string;
    path: string;
    payload: Record<string, unknown>;
    stream?: boolean;
    /** Optional beta features to enable via `anthropic-beta` header.
     *  Values are validated against ALLOWED_ANTHROPIC_BETAS. */
    betas?: string[];
  };

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_SIZE) {
      return Response.json({ error: 'Request body too large (max 1 MB).' }, { status: 400 });
    }
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { provider: providerName, path, payload, stream, betas } = body;

  // Validate provider
  const config = PROVIDERS[providerName?.toLowerCase()];
  if (!config) {
    return Response.json(
      { error: `Unknown provider: ${providerName}. Available: ${Object.keys(PROVIDERS).join(', ')}` },
      { status: 400 }
    );
  }

  // Get API key from server-side env
  const apiKey = Netlify.env.get(config.envKey);
  if (!apiKey) {
    return Response.json(
      { error: `${config.envKey} not configured on the server.` },
      { status: 503 }
    );
  }

  // Validate path — prevent SSRF. Exact match on the pathname, and
  // reject any path that contains a query string, fragment, or
  // encoded segment that could smuggle a different host.
  if (!path || typeof path !== 'string') {
    return Response.json({ error: 'Path required.' }, { status: 400 });
  }
  let parsedTarget: URL;
  try {
    parsedTarget = new URL(path, config.baseUrl);
  } catch {
    return Response.json({ error: 'Invalid path.' }, { status: 400 });
  }
  if (parsedTarget.origin !== new URL(config.baseUrl).origin) {
    return Response.json({ error: 'Path must not change origin.' }, { status: 400 });
  }
  // Exact pathname match — no more prefix-based SSRF surface.
  if (!config.allowedPaths.includes(parsedTarget.pathname)) {
    return Response.json(
      { error: `Path "${parsedTarget.pathname}" not allowed for ${providerName}. Allowed: ${config.allowedPaths.join(', ')}` },
      { status: 400 }
    );
  }
  // Drop any query string the caller supplied — only our server-side
  // code adds query params (gemini key).
  parsedTarget.search = '';
  parsedTarget.hash = '';

  // Build target URL
  let targetUrl = parsedTarget.toString();

  // Gemini uses API key as query param
  if (providerName.toLowerCase() === 'gemini') {
    const separator = targetUrl.includes('?') ? '&' : '?';
    targetUrl += `${separator}key=${apiKey}`;
  }

  // Proxy the request
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.authHeader(apiKey),
    };

    // Forward allowlisted Anthropic beta flags as `anthropic-beta` header.
    // Only applies to the Anthropic provider; silently dropped for others.
    if (providerName.toLowerCase() === 'anthropic' && Array.isArray(betas) && betas.length > 0) {
      const allowed = betas.filter((b): b is string => typeof b === 'string' && ALLOWED_ANTHROPIC_BETAS.has(b));
      if (allowed.length > 0) {
        headers['anthropic-beta'] = allowed.join(',');
      }
    }

    const upstreamRes = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000), // 60s timeout for AI requests
    });

    // Never reflect the upstream Content-Type verbatim — the proxy
    // accepts only JSON payloads and SSE streams. Force a known value
    // plus nosniff so a compromised upstream can't return text/html.
    const upstreamCT = (upstreamRes.headers.get('Content-Type') || '').toLowerCase();
    const isSse = upstreamCT.startsWith('text/event-stream');

    if (stream && upstreamRes.body) {
      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        headers: {
          'Content-Type': isSse ? 'text/event-stream' : 'application/json',
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    const responseBody = await upstreamRes.text();
    return new Response(responseBody, {
      status: upstreamRes.status,
      headers: {
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[ai-proxy] ${providerName} request failed:`, message);
    return Response.json(
      { error: `AI provider request failed: ${message}` },
      { status: 502 }
    );
  }
};

export const config: Config = {
  path: '/api/ai-proxy',
  method: ['POST', 'OPTIONS'],
};
