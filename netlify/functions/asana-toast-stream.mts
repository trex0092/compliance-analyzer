/**
 * Asana Toast Stream — polling endpoint the SPA hits every 30
 * seconds to drain server-side toast events produced by the
 * webhook receiver.
 *
 * The webhook receiver parses inbound Asana events and writes
 * any that map to SPA toasts into the `asana-toast-stream` blob
 * store. This endpoint returns the pending events (and deletes
 * them) so the SPA can push them into its local toast buffer.
 *
 * GET /.netlify/functions/asana-toast-stream
 *   → { events: [...], drainedAtIso: "..." }
 *
 * Polling cadence is the SPA's choice — 30s is a reasonable
 * default because Asana webhooks are already near-real-time and
 * the toast surface is not a critical channel.
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (real-time operational telemetry)
 *   - FDL No.10/2025 Art.29 (toast events from the webhook router
 *     already strip entity legal names — this endpoint is a
 *     pure pass-through)
 */

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

const TOAST_STREAM_STORE = 'asana-toast-stream';

interface PendingToast {
  id: string;
  kind: string;
  severity: string;
  title: string;
  body: string;
  taskGid?: string;
  caseId?: string;
  atIso: string;
}

export default async (request: Request): Promise<Response> => {
  // Basic auth check — require the HAWKEYE_BRAIN_TOKEN bearer
  // so random internet traffic can't drain the stream. The SPA
  // injects this token via the Netlify rewrite + environment.
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const expected = process.env.HAWKEYE_BRAIN_TOKEN ?? '';
  if (!expected || !token || token !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const store = getStore(TOAST_STREAM_STORE);
    const listing = await store.list({ prefix: 'pending/' });
    const events: PendingToast[] = [];
    const drainKeys: string[] = [];
    for (const blob of listing.blobs ?? []) {
      try {
        const data = await store.get(blob.key, { type: 'json' });
        if (data) {
          events.push(data as PendingToast);
          drainKeys.push(blob.key);
        }
      } catch {
        /* skip unreadable blob */
      }
    }
    // Drain: delete the keys we just returned so the SPA doesn't
    // see them again. Non-atomic with the read, but Asana
    // webhooks are idempotent and the SPA dedupes by id.
    for (const key of drainKeys) {
      try {
        await store.delete(key);
      } catch {
        /* best effort */
      }
    }
    return Response.json({
      events,
      drainedAtIso: new Date().toISOString(),
      count: events.length,
    });
  } catch (err) {
    return Response.json(
      {
        events: [],
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
};

export const config: Config = {
  path: '/api/asana-toast-stream',
};
