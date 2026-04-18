/**
 * War-room snapshot stream (SSE).
 *
 * GET /api/warroom/stream?tenantId=<id>
 *
 * Server-sent events stream that pushes a fresh `DashboardSnapshot`
 * every 5 seconds. The browser dashboard subscribes once on tab load
 * and renders incrementally — no polling, no redundant payloads.
 *
 * Implementation note: this function reads the in-memory feed from
 * `complianceDecisionEngine.getWarRoomFeed()`. In a multi-instance
 * deployment each Netlify Function instance has its own in-memory
 * feed; subscribers will receive events ingested by THIS instance.
 * For cross-instance ordering use the brain-events blob store
 * directly via /api/regulator/events instead.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO situational awareness)
 *   Cabinet Res 134/2025 Art.19 (continuous monitoring)
 */

import type { Config, Context } from '@netlify/functions';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { getWarRoomFeed } from '../../src/services/complianceDecisionEngine';
import { buildDashboardSnapshot } from '../../src/services/warRoomDashboard';

const HEARTBEAT_MS = 5_000;
// Hard cap on stream duration. Netlify functions run for up to 26s
// on the standard tier; cap to 24s so the server closes cleanly
// before the platform aborts, matching the same safety margin used
// by ai-proxy and decision-stream. Clients should auto-reconnect.
// (Previously 25s, which left only 1s for the reconnect frame to
// flush — too tight if buildDashboardSnapshot runs long.)
const MAX_STREAM_MS = 24_000;
// Stale-emit watchdog: if more than this many ms pass without any
// byte landing in the ReadableStream queue, force a comment frame.
// Picked at 1.5× the heartbeat cadence so it fires on exactly one
// missed heartbeat rather than two.
const STALE_EMIT_MS = 7_500;

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sseHeartbeat(): string {
  return `: heartbeat ${Date.now()}\n\n`;
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    clientIp: context.ip,
    max: 20,
    namespace: 'warroom-stream',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response ?? Response.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const tenantId = (url.searchParams.get('tenantId') || 'default').replace(
    /[^a-zA-Z0-9_-]/g,
    '_'
  );

  const feed = getWarRoomFeed();

  const signal = (req as unknown as { signal?: AbortSignal }).signal;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      let lastEmitAt = Date.now();
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let staleEmitTimer: ReturnType<typeof setInterval> | null = null;
      let deadline: ReturnType<typeof setTimeout> | null = null;

      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
          lastEmitAt = Date.now();
        } catch {
          // Controller closed (client disconnect). Stop further writes.
          closed = true;
        }
      };
      const emit = (event: string, data: unknown) => {
        safeEnqueue(enc.encode(sseFrame(event, data)));
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (staleEmitTimer) clearInterval(staleEmitTimer);
        if (deadline) clearTimeout(deadline);
        if (signal) signal.removeEventListener('abort', onAbort);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      function onAbort() {
        cleanup();
      }
      if (signal) signal.addEventListener('abort', onAbort);

      // Flush response headers immediately with a zero-cost comment so
      // intermediaries release the 200 OK before buildDashboardSnapshot
      // runs. If the snapshot build hangs or throws, the client still
      // has an open socket and can recover rather than seeing the
      // "Stream idle timeout - partial response received" failure.
      safeEnqueue(enc.encode(`: keepalive ${Date.now()}\n\n`));
      emit('stream:ready', {
        maxStreamMs: MAX_STREAM_MS,
        heartbeatMs: HEARTBEAT_MS,
        serverTime: new Date().toISOString(),
      });

      // Send initial snapshot immediately so the client has something
      // to render before the first heartbeat.
      try {
        const snapshot = buildDashboardSnapshot(feed, tenantId);
        emit('snapshot', snapshot);
      } catch (err) {
        emit('error', { message: (err as Error).message, recoverable: true });
      }

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          const snapshot = buildDashboardSnapshot(feed, tenantId);
          emit('snapshot', snapshot);
        } catch (err) {
          // Never let a single snapshot failure tear down the stream —
          // the client's auto-reconnect is strictly worse than letting
          // the next heartbeat try again with fresh state.
          emit('error', { message: (err as Error).message, recoverable: true });
        }
      }, HEARTBEAT_MS);

      // Stale-emit watchdog — forces a keepalive if the heartbeat
      // interval enqueued bytes but backpressure kept them in the queue.
      staleEmitTimer = setInterval(() => {
        if (closed) return;
        if (Date.now() - lastEmitAt >= STALE_EMIT_MS) {
          safeEnqueue(enc.encode(`: keepalive-stale ${Date.now()}\n\n`));
        }
      }, Math.max(1_000, Math.floor(STALE_EMIT_MS / 3)));

      // Hard deadline, independent of the heartbeat interval. Previously
      // the max-duration check piggy-backed on the heartbeat, which
      // could miss by up to HEARTBEAT_MS if a snapshot build ran long.
      // A dedicated timer guarantees we close within MAX_STREAM_MS even
      // if the heartbeat is blocked.
      deadline = setTimeout(() => {
        emit('reconnect', {
          reason: 'max-duration',
          maxStreamMs: MAX_STREAM_MS,
          retryable: true,
        });
        cleanup();
      }, MAX_STREAM_MS);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
      // Disable proxy buffering (Nginx, Netlify Edge, some CDNs).
      // Without this, intermediaries can hold SSE frames in a buffer
      // and defeat the heartbeat above — surfacing as "Stream idle
      // timeout - partial response received" on the client even while
      // the server is emitting heartbeats on schedule.
      'X-Accel-Buffering': 'no',
    },
  });
};

export const config: Config = {
  path: '/api/warroom/stream',
  method: ['GET', 'OPTIONS'],
};
