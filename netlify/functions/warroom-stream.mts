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
// on the standard tier; cap to 25s so the server closes cleanly
// before the platform aborts. Clients should auto-reconnect.
const MAX_STREAM_MS = 25_000;

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      const startedAt = Date.now();
      // Send initial snapshot immediately so the client has something
      // to render before the first heartbeat.
      try {
        const snapshot = buildDashboardSnapshot(feed, tenantId);
        controller.enqueue(enc.encode(sseFrame('snapshot', snapshot)));
      } catch (err) {
        controller.enqueue(
          enc.encode(sseFrame('error', { message: (err as Error).message }))
        );
      }

      const heartbeat = setInterval(() => {
        if (Date.now() - startedAt > MAX_STREAM_MS) {
          clearInterval(heartbeat);
          controller.enqueue(enc.encode(sseFrame('reconnect', { reason: 'max-duration' })));
          controller.close();
          return;
        }
        try {
          const snapshot = buildDashboardSnapshot(feed, tenantId);
          controller.enqueue(enc.encode(sseFrame('snapshot', snapshot)));
        } catch (err) {
          controller.enqueue(
            enc.encode(sseFrame('error', { message: (err as Error).message }))
          );
        }
      }, HEARTBEAT_MS);

      // Abort cleanup if the client disconnects.
      const signal = (req as unknown as { signal?: AbortSignal }).signal;
      if (signal) {
        signal.addEventListener('abort', () => {
          clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};

export const config: Config = {
  path: '/api/warroom/stream',
  method: ['GET', 'OPTIONS'],
};
