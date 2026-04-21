/**
 * Four-Eyes Audit Reader — admin read-path for inspection + audit pack
 *
 * GET /api/four-eyes-audit-read?from=YYYY-MM-DD&to=YYYY-MM-DD&rowId=X&mlro=Y
 *
 * Reads the Netlify Blob store written by /api/four-eyes-audit and
 * returns a filtered list of approval events. Intended for:
 *   - MoE inspections (FDL Art.24 10-year retention audit)
 *   - Quarterly MLRO reviews (confirm rate, false-positive trends)
 *   - Drift reconciliation against client-side state
 *
 * Security:
 *   - Authenticated (JWT / hex bearer)
 *   - Rate-limited 60/min per IP (read-heavy for audit pack generation)
 *   - Caps: 500 records per response, 90-day max window per call
 *
 * The read endpoint is scoped to audit-trail fields only — no PII
 * beyond what was written by the writer. Blobs are listed by prefix
 * (YYYY-MM-DD/) to keep scans bounded.
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';

const RL_MAX = 60;
const RL_WINDOW_MS = 60 * 1000;
const STORE_NAME = 'four-eyes-audit';
const MAX_RECORDS = 500;
const MAX_WINDOW_DAYS = 90;

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status });
}
function parseDate(s: string | null): Date | null {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return isNaN(d.getTime()) ? null : d;
}
function dayKey(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'GET') return fail(405, 'Method not allowed.');

  const rl = await checkRateLimit(req, {
    clientIp: context.ip,
    namespace: 'four-eyes-audit-read',
    max: RL_MAX,
    windowMs: RL_WINDOW_MS,
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  const u = new URL(req.url);
  const fromParam = parseDate(u.searchParams.get('from'));
  const toParam = parseDate(u.searchParams.get('to'));
  const rowId = u.searchParams.get('rowId');
  const mlro = u.searchParams.get('mlro');
  const event = u.searchParams.get('event');

  // Default window: last 30 days ending today
  const to = toParam || new Date();
  const from = fromParam || new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const windowMs = to.getTime() - from.getTime();
  if (windowMs < 0) return fail(400, 'from must be ≤ to.');
  if (windowMs > MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
    return fail(400, `Query window exceeds ${MAX_WINDOW_DAYS} days. Narrow the range.`);
  }

  const store = getStore({ name: STORE_NAME, consistency: 'strong' });
  const results: Array<Record<string, unknown>> = [];

  // Iterate daily prefixes so we never scan the full store.
  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime() && results.length < MAX_RECORDS) {
    const prefix = dayKey(cursor) + '/';
    try {
      const list = await store.list({ prefix });
      for (const b of list.blobs) {
        if (results.length >= MAX_RECORDS) break;
        const rec = await store.get(b.key, { type: 'json' });
        if (!rec || typeof rec !== 'object') continue;
        const r = rec as Record<string, unknown>;
        if (rowId && r.rowId !== rowId) continue;
        if (mlro && r.approverId !== mlro && r.requesterId !== mlro) continue;
        if (event && r.event !== event) continue;
        results.push({ ...r, _key: b.key });
      }
    } catch (err) {
      console.warn('[four-eyes-audit-read] list failed for prefix', prefix, err);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  // Stats summary for the audit pack cover page
  const stats = {
    total: results.length,
    approves: results.filter((r) => r.event === 'approve').length,
    rejects: results.filter((r) => r.event === 'reject').length,
    uniqueRequesters: new Set(results.map((r) => r.requesterId).filter(Boolean)).size,
    uniqueApprovers: new Set(results.map((r) => r.approverId).filter(Boolean)).size,
    uniqueRows: new Set(results.map((r) => r.rowId).filter(Boolean)).size,
  };

  console.info(
    `[four-eyes-audit-read] userId=${auth.userId} from=${dayKey(from)} to=${dayKey(to)}` +
      ` rowId=${rowId ?? '*'} mlro=${mlro ?? '*'} returned=${results.length}`
  );

  return Response.json({
    window: { from: dayKey(from), to: dayKey(to) },
    filters: { rowId: rowId || null, mlro: mlro || null, event: event || null },
    stats,
    records: results,
    truncated: results.length >= MAX_RECORDS,
  });
};

export const config: Config = {
  method: ['GET', 'OPTIONS'],
};
