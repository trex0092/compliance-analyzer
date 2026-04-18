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
 * Non-streaming calls are capped at 22s — comfortably below Netlify's
 * 26s synchronous function kill so we abort the upstream ourselves and
 * return a diagnosable 504 instead of letting Netlify tear the socket.
 * A torn socket is exactly the failure mode that surfaces as
 * "Stream idle timeout - partial response received" on the browser.
 * Callers that legitimately need >22s generations must use streaming,
 * which has its own (much longer) ceiling and per-byte keepalives.
 *
 * Streaming calls get a much longer ceiling (5 minutes) because the
 * signal is attached to the entire `fetch()` — including the time the
 * body is actively streaming chunks to the client. A short timeout
 * here aborts the upstream mid-flight and surfaces as
 * "Stream idle timeout - partial response received" on the browser
 * even though bytes are still flowing. The stream's real lifetime is
 * bounded by (a) Anthropic's own stream cap, (b) the client
 * disconnect signal (propagated below), (c) Netlify's function
 * wall-clock (enforced explicitly via STREAM_WALL_CLOCK_MS below), and
 * (d) the server-side stale-byte watchdog (STREAM_STALE_BYTE_MS).
 */
const NONSTREAM_UPSTREAM_TIMEOUT_MS = 22_000;
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
 * Server-side stale-byte watchdog.
 *
 * The keepalive interval emits a frame every 10s *when the upstream is
 * silent*. But controller.enqueue is fire-and-forget: the bytes land in
 * the ReadableStream's internal queue, and the runtime drains them onto
 * the TCP socket on its own schedule. If the runtime is backpressured
 * (slow client, congested link, upstream flooding us) the keepalives
 * pile up in the queue while real TCP idle continues. This watchdog
 * detects "we haven't emitted anything in 15s" — twice the keepalive
 * cadence — and forces an additional frame. Two missed cadence windows
 * is the earliest point at which most CDN idle timers start triggering.
 */
const STREAM_STALE_BYTE_MS = 15_000;

/**
 * Graceful wall-clock close for streaming responses.
 *
 * Netlify standard functions are killed at 26s (Pro tier). When
 * Netlify kills the function, the socket is torn down abruptly —
 * the client sees a truncated TCP stream and surfaces the exact
 * "Stream idle timeout - partial response received" error we are
 * defending against. Rather than letting Netlify sever the socket,
 * we close our own stream 2s before the platform would, emitting a
 * terminal SSE `event: proxy_wall_clock` frame so the client can
 * diagnose and retry instead of guessing at a truncation.
 *
 * 24s leaves enough headroom for the frame to flush before the
 * hard kill. Non-streaming calls still use the shorter
 * NONSTREAM_UPSTREAM_TIMEOUT_MS above, which is already safely
 * below the 26s ceiling once you account for the proxy's own
 * response construction time.
 */
const STREAM_WALL_CLOCK_MS = 24_000;

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
  // Capture function start-time so the stream wall-clock deadline is
  // computed relative to when Netlify invoked us, not relative to when
  // the ReadableStream's start() runs. Upstream fetches can take 1-5s
  // to return headers; if the wall-clock timer only starts after the
  // fetch resolves, we can overshoot Netlify's 26s hard kill and lose
  // the chance to emit a clean terminal frame.
  const functionStartedAt = Date.now();

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

      const reader = upstreamBody.getReader();

      const passthrough = new ReadableStream<Uint8Array>({
        start(controller) {
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

          // Flush response headers immediately with a zero-cost
          // keepalive comment. Some intermediaries (CDNs, corporate
          // TLS terminators) hold the response headers until the
          // first body byte arrives. Anthropic's extended thinking
          // can delay the first real byte by 10-30s, during which
          // the client sees no "200 OK" at all — which surfaces as
          // the same "Stream idle timeout - partial response
          // received" error as a mid-stream stall.
          safeEnqueue(keepaliveBytes);
          // Follow the header flush with an advisory "ready" frame
          // carrying the server wall-clock so the client can compute
          // its own deadline and detect clock skew. Plain SSE comment
          // frames don't reach EventSource handlers; this structured
          // frame does, and a stricter intermediary that strips
          // comment frames will still forward this one.
          safeEnqueue(
            encoder.encode(
              `event: proxy_ready\ndata: ${JSON.stringify({
                serverTime: new Date(functionStartedAt).toISOString(),
                wallClockMs: STREAM_WALL_CLOCK_MS,
                keepaliveMs: STREAM_KEEPALIVE_MS,
              })}\n\n`
            )
          );

          // Track the last byte we actually *emitted downstream* so
          // the stale-byte watchdog can distinguish between upstream
          // silence (keepalive handles it) and downstream backpressure
          // (keepalive frames queued but not flushed).
          let lastEmitAt = Date.now();
          const trackingEnqueue = (chunk: Uint8Array) => {
            safeEnqueue(chunk);
            lastEmitAt = Date.now();
          };
          // Retroactively credit the initial header-flush keepalive.
          lastEmitAt = Date.now();

          // Forward-declare timer handles so `finish()` can close them
          // cleanly regardless of which one fires first.
          let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
          let staleByteTimer: ReturnType<typeof setInterval> | null = null;
          let wallClockTimer: ReturnType<typeof setTimeout> | null = null;

          const finish = () => {
            if (closed) return;
            closed = true;
            if (keepaliveTimer !== null) clearInterval(keepaliveTimer);
            if (staleByteTimer !== null) clearInterval(staleByteTimer);
            if (wallClockTimer !== null) clearTimeout(wallClockTimer);
            if (clientSignal) clientSignal.removeEventListener('abort', onClientAbort);
            // Release the upstream reader so its socket is reclaimed
            // promptly instead of drifting until GC. A leaked reader
            // can hold the upstream TCP connection in CLOSE_WAIT and
            // consume file descriptors on long-running deploys.
            try {
              reader.cancel(new DOMException('proxy stream finished', 'AbortError'));
            } catch {
              /* reader already detached */
            }
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          };

          keepaliveTimer = setInterval(() => {
            if (closed) return;
            if (Date.now() - lastByteAt >= STREAM_KEEPALIVE_MS) {
              trackingEnqueue(keepaliveBytes);
              lastByteAt = Date.now();
            }
          }, STREAM_KEEPALIVE_MS);

          // Stale-byte watchdog — catches the case where the keepalive
          // timer has emitted but the bytes are stuck in the
          // ReadableStream queue due to downstream backpressure. Forcing
          // an extra frame can't unblock a truly backpressured consumer,
          // but it DOES guarantee that any intermediary that relies on
          // observing bytes (rather than on controller activity) gets
          // one within STREAM_STALE_BYTE_MS of the last flushed byte.
          staleByteTimer = setInterval(
            () => {
              if (closed) return;
              if (Date.now() - lastEmitAt >= STREAM_STALE_BYTE_MS) {
                trackingEnqueue(keepaliveBytes);
              }
            },
            Math.max(1_000, Math.floor(STREAM_STALE_BYTE_MS / 3))
          );

          // Graceful wall-clock close — see STREAM_WALL_CLOCK_MS. We
          // beat Netlify's hard kill so the client gets a terminal
          // SSE event instead of a torn socket, which is exactly the
          // signal that surfaces as "Stream idle timeout - partial
          // response received" on the browser. Deadline is computed
          // from `functionStartedAt`, not from now, so upstream header
          // latency doesn't push us past Netlify's 26s ceiling.
          const wallClockRemaining = Math.max(
            1_000,
            STREAM_WALL_CLOCK_MS - (Date.now() - functionStartedAt)
          );
          wallClockTimer = setTimeout(() => {
            if (closed) return;
            trackingEnqueue(
              encoder.encode(
                `event: proxy_wall_clock\ndata: ${JSON.stringify({
                  message: 'proxy stream closed gracefully before function wall-clock',
                  wallClockMs: STREAM_WALL_CLOCK_MS,
                  elapsedMs: Date.now() - functionStartedAt,
                  retryable: true,
                })}\n\n`
              )
            );
            try {
              upstreamAbort.abort(new DOMException('proxy wall-clock', 'TimeoutError'));
            } catch {
              /* already aborted */
            }
            finish();
          }, wallClockRemaining);

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
                trackingEnqueue(value);
              }
            } catch (err) {
              // Surface the upstream error as a terminal SSE event so
              // the client gets a diagnosable message instead of a
              // silent truncation. Distinct event name (upstream_error
              // vs plain error) lets the client distinguish a proxy
              // pump failure from an Anthropic stream-level error.
              const message = err instanceof Error ? err.message : String(err);
              const name = err instanceof Error ? err.name : 'Error';
              trackingEnqueue(
                encoder.encode(
                  `event: upstream_error\ndata: ${JSON.stringify({
                    message,
                    name,
                    retryable: name === 'TimeoutError' || name === 'AbortError',
                  })}\n\n`
                )
              );
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

    // Non-streaming path: the timeout must stay armed through the
    // body read. fetch() resolves on response headers, but the body
    // can dribble in for an arbitrarily long tail — and that tail
    // runs inside the same 26s Netlify wall-clock. If we cleared the
    // timeout here, a slow-bodied upstream would silently push us
    // over the Netlify kill and produce the exact truncated socket
    // we're defending against. We keep the AbortController alive
    // until the whole body has been buffered, then clear.
    let responseBody: string;
    try {
      responseBody = await upstreamRes.text();
    } catch (err) {
      clearTimeout(upstreamTimeout);
      if (clientSignal) clientSignal.removeEventListener('abort', onClientAbort);
      const name = err instanceof Error ? err.name : 'Error';
      if (name === 'TimeoutError') {
        return Response.json(
          {
            error: 'AI provider timed out while streaming response body.',
            retryable: true,
            reason: 'nonstream_body_timeout',
            upstreamTimeoutMs: NONSTREAM_UPSTREAM_TIMEOUT_MS,
          },
          { status: 504 }
        );
      }
      throw err;
    }
    clearTimeout(upstreamTimeout);
    if (clientSignal) clientSignal.removeEventListener('abort', onClientAbort);

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
    const name = err instanceof Error ? err.name : 'Error';
    console.error(`[ai-proxy] ${providerName} request failed:`, name, message);
    // Translate AbortController-driven timeouts into a proper 504
    // with a retryable flag so the browser/client falls back instead
    // of guessing at a 502. This is the fingerprint the downstream
    // SDK uses to surface a clean retry instead of the truncated
    // socket that reads as "Stream idle timeout - partial response
    // received".
    if (name === 'TimeoutError') {
      return Response.json(
        {
          error: `AI provider request timed out: ${message}`,
          retryable: true,
          reason: 'upstream_timeout',
          upstreamTimeoutMs: stream ? STREAM_UPSTREAM_TIMEOUT_MS : NONSTREAM_UPSTREAM_TIMEOUT_MS,
        },
        { status: 504 }
      );
    }
    if (name === 'AbortError') {
      return Response.json(
        {
          error: `AI provider request aborted: ${message}`,
          retryable: false,
          reason: 'client_disconnected',
        },
        { status: 499 }
      );
    }
    return Response.json({ error: `AI provider request failed: ${message}` }, { status: 502 });
  }
};

export const config: Config = {
  path: '/api/ai-proxy',
  method: ['POST', 'OPTIONS'],
};
