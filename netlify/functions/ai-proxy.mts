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

// ─── Handler ────────────────────────────────────────────────────────────────

export default async (req: Request, context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  // Rate limit: 10 AI requests per 15 min
  const rl = checkRateLimit(req, { max: 10, clientIp: context.ip });
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

  const { provider: providerName, path, payload, stream } = body;

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

  // Validate path — prevent SSRF
  if (!path || !config.allowedPaths.some((p) => path.startsWith(p))) {
    return Response.json(
      { error: `Path "${path}" not allowed for ${providerName}. Allowed: ${config.allowedPaths.join(', ')}` },
      { status: 400 }
    );
  }

  // Build target URL
  let targetUrl = `${config.baseUrl}${path}`;

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

    const upstreamRes = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000), // 60s timeout for AI requests
    });

    // Stream response if requested and upstream supports it
    if (stream && upstreamRes.body) {
      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        headers: {
          'Content-Type': upstreamRes.headers.get('Content-Type') || 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // Non-streaming: forward the response
    const responseBody = await upstreamRes.text();
    return new Response(responseBody, {
      status: upstreamRes.status,
      headers: {
        'Content-Type': upstreamRes.headers.get('Content-Type') || 'application/json',
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
