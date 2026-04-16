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
 * Upstream request timeouts.
 *
 * Non-streaming calls are capped at 60s — if an AI provider hasn't
 * produced the full response by then, the caller has almost certainly
 * already given up.
 *
 * Streaming calls get a much longer ceiling (5 minutes) because the
 * signal is attached to the entire `fetch()` — including the time the
 * body is actively streaming chunks to the client. A short timeout
 * here aborts the upstream mid-flight and surfaces as
 * "Stream idle timeout - partial response received" on the browser
 * even though bytes are still flowing. The stream's real lifetime is
 * bounded by (a) Anthropic's own stream cap, (b) the client
 * disconnect signal (propagated below), and (c) Netlify's function
 * wall-clock — all of which are the right stopping conditions.
 */
const NONSTREAM_UPSTREAM_TIMEOUT_MS = 60_000;
const STREAM_UPSTREAM_TIMEOUT_MS = 300_000;

/**
 * SSE keep-alive cadence for streamed upstream responses.
 *
 * Anthropic's streaming API can sit silent for tens of seconds during
 * extended thinking, tool-use planning, or between content blocks. That
 * silence is real — bytes are not flowing — and any intermediate proxy
 * (Netlify Edge, a CDN, corporate TLS terminator, the browser) that
 * enforces an idle read timeout will close the socket. The browser
 * then surfaces the truncated body as:
 *     "Stream idle timeout - partial response received"
 * even though the upstream never actually failed.
 *
 * Fix: wrap the upstream body in a ReadableStream that watches the
 * inter-chunk gap and emits a `: keepalive\n\n` SSE comment whenever
 * the gap exceeds this threshold. Comments are ignored by EventSource
 * and by the Anthropic SDK's SSE parser, but they are real TCP bytes
 * so every intermediary resets its idle counter.
 *
 * Why 10s? Most CDN idle timers are 30-60s; picking 10s gives us
 * three keepalives before the strictest layer fires. Smaller cadence
 * adds a few hundred bytes per minute — negligible.
 */
const STREAM_KEEPALIVE_MS = 10_000;

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
const ALLOWED_ANTHROPIC_BETAS = new Set<string>(['advisor-tool-2026-03-01']);

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

  // Preflight Content-Length — refuse before buffering if already
  // declared too large. Mirrors the pattern used by the Asana
  // Netlify functions.
  const contentLengthHeader = req.headers.get('content-length');
  if (contentLengthHeader) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > MAX_BODY_SIZE) {
      return Response.json({ error: 'Request body too large (max 1 MB).' }, { status: 413 });
    }
  }
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_SIZE) {
      return Response.json({ error: 'Request body too large (max 1 MB).' }, { status: 413 });
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
      {
        error: `Unknown provider: ${providerName}. Available: ${Object.keys(PROVIDERS).join(', ')}`,
      },
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
      {
        error: `Path "${parsedTarget.pathname}" not allowed for ${providerName}. Allowed: ${config.allowedPaths.join(', ')}`,
      },
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
      const allowed = betas.filter(
        (b): b is string => typeof b === 'string' && ALLOWED_ANTHROPIC_BETAS.has(b)
      );
      if (allowed.length > 0) {
        headers['anthropic-beta'] = allowed.join(',');
      }
    }

    // Upstream abort controller. We combine two termination signals:
    //   1. A wall-clock timeout (longer for streams — see constants above).
    //   2. The incoming client disconnect signal, so if the browser
    //      hangs up we stop paying for upstream tokens we'll never
    //      deliver.
    // Both use the same AbortController; whichever fires first wins.
    const upstreamAbort = new AbortController();
    const timeoutMs = stream ? STREAM_UPSTREAM_TIMEOUT_MS : NONSTREAM_UPSTREAM_TIMEOUT_MS;
    const upstreamTimeout = setTimeout(() => {
      upstreamAbort.abort(new DOMException('Upstream timeout', 'TimeoutError'));
    }, timeoutMs);
    const clientSignal = (req as unknown as { signal?: AbortSignal }).signal;
    const onClientAbort = () =>
      upstreamAbort.abort(new DOMException('Client disconnected', 'AbortError'));
    if (clientSignal) {
      if (clientSignal.aborted) onClientAbort();
      else clientSignal.addEventListener('abort', onClientAbort, { once: true });
    }

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: upstreamAbort.signal,
      });
    } catch (e) {
      clearTimeout(upstreamTimeout);
      if (clientSignal) clientSignal.removeEventListener('abort', onClientAbort);
      throw e;
    }

    // Never reflect the upstream Content-Type verbatim — the proxy
    // accepts only JSON payloads and SSE streams. Force a known value
    // plus nosniff so a compromised upstream can't return text/html.
    const upstreamCT = (upstreamRes.headers.get('Content-Type') || '').toLowerCase();
    const isSse = upstreamCT.startsWith('text/event-stream');

    if (stream && upstreamRes.body) {
      // Headers received — we no longer need the short-circuit timer.
      // The stream's lifetime is bounded by Anthropic's own cap, the
      // client disconnect listener above, and Netlify's wall-clock.
      clearTimeout(upstreamTimeout);
      // Note: we intentionally leave `onClientAbort` wired up until
      // the Response stream is consumed — it still needs to forward
      // a browser hang-up to the upstream fetch.

      // Forward the upstream body through a pass-through stream that
      // injects SSE keepalive comments during idle gaps. Without this
      // the client sees "Stream idle timeout - partial response
      // received" whenever Anthropic pauses mid-stream (tool planning,
      // extended thinking, between content blocks). The constant
      // STREAM_KEEPALIVE_MS has the full rationale.
      const upstreamBody = upstreamRes.body;
      const encoder = new TextEncoder();
      const keepaliveBytes = encoder.encode(': keepalive\n\n');

      const passthrough = new ReadableStream<Uint8Array>({
        start(controller) {
          const reader = upstreamBody.getReader();
          let lastByteAt = Date.now();
          let closed = false;

          const safeEnqueue = (chunk: Uint8Array) => {
            if (closed) return;
            try {
              controller.enqueue(chunk);
            } catch {
              closed = true;
            }
          };

          const keepaliveTimer = setInterval(() => {
            if (closed) return;
            if (Date.now() - lastByteAt >= STREAM_KEEPALIVE_MS) {
              safeEnqueue(keepaliveBytes);
              lastByteAt = Date.now();
            }
          }, STREAM_KEEPALIVE_MS);

          const finish = () => {
            if (closed) return;
            closed = true;
            clearInterval(keepaliveTimer);
            if (clientSignal) clientSignal.removeEventListener('abort', onClientAbort);
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          };

          // Pump upstream → controller in the background. We deliberately
          // do not await this inside start() — start() must return
          // promptly so the Response headers flush to the client and
          // open the TCP write window that keepalives rely on.
          (async () => {
            try {
              while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                lastByteAt = Date.now();
                safeEnqueue(value);
              }
            } catch (err) {
              // Surface the upstream error as a terminal SSE event so
              // the client gets a diagnosable message instead of a
              // silent truncation.
              const message = err instanceof Error ? err.message : String(err);
              safeEnqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`));
            } finally {
              finish();
            }
          })();
        },
        cancel(reason) {
          // Client hung up on us (e.g. browser closed the tab). Propagate
          // the cancellation upstream so we stop paying for tokens the
          // browser will never render.
          try {
            upstreamAbort.abort(
              reason instanceof Error
                ? reason
                : new DOMException('Downstream cancelled', 'AbortError')
            );
          } catch {
            /* already aborted */
          }
        },
      });

      return new Response(passthrough, {
        status: upstreamRes.status,
        headers: {
          'Content-Type': isSse ? 'text/event-stream' : 'application/json',
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
          // Disable proxy buffering (Nginx, Netlify Edge, some CDNs).
          // Without this, intermediaries can hold our SSE frames in a
          // buffer and defeat the keepalives above.
          'X-Accel-Buffering': 'no',
        },
      });
    }

    // Non-streaming path: response is buffered below, timer can fire.
    clearTimeout(upstreamTimeout);
    if (clientSignal) clientSignal.removeEventListener('abort', onClientAbort);

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
    return Response.json({ error: `AI provider request failed: ${message}` }, { status: 502 });
  }
};

export const config: Config = {
  path: '/api/ai-proxy',
  method: ['POST', 'OPTIONS'],
};
