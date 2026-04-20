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

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';

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

export default async (request: Request, context: Context): Promise<Response> => {
  // General-tier rate limit: the SPA polls every ~30s, so 100 req / 15 min
  // per IP leaves ample headroom for real usage while blocking drain floods
  // from an attacker that obtained (or guessed) the bearer token.
  const rateLimited = await checkRateLimit(request, {
    clientIp: context.ip,
    namespace: 'asana-toast-stream',
    max: 100,
  });
  if (rateLimited) return rateLimited;

  // Auth — accept either the MLRO browser JWT (issued by
  // /api/hawkeye-login) or the shared HAWKEYE_BRAIN_TOKEN hex
  // bearer. The previous hand-rolled check compared the header
  // against HAWKEYE_BRAIN_TOKEN only (non-constant-time, no JWT
  // support), which silently broke the browser polling loop
  // after the MLRO login migration landed in PR #391 — the SPA
  // started sending its JWT and got 401 on every poll. The
  // middleware does a constant-time compare and routes JWT vs
  // hex on shape, so both callers (SPA + backend) work.
  // FDL No.(10)/2025 Art.20-21 (operator access) & Art.24 (audit
  // trail of every authenticated endpoint hit).
  const auth = authenticate(request);
  if (!auth.ok) return auth.response!;

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
