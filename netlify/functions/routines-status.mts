/**
 * Routines Status — live read-only manifest of all scheduled
 * compliance workflows (crons) and their last-run status.
 *
 * GET /api/routines-status
 *
 * Surfaces the routines enumerated in `routines.html` with live
 * metadata pulled from each routine's audit blob store. For each
 * registered routine, attempts to locate the most recent audit
 * entry by listing blobs prefixed with today's date, falling back
 * to yesterday and the day before. If no entry is found within
 * three days, the routine is reported as `no-data`.
 *
 * Response shape:
 *   {
 *     fetchedAtIso: string,
 *     routines: Array<{
 *       id: string,
 *       storeName: string,
 *       lastRunKey: string | null,
 *       lastRunAtIso: string | null,
 *       status: 'ok' | 'stale' | 'no-data' | 'error',
 *       daysAgo: number | null,
 *       note?: string,
 *     }>
 *   }
 *
 * Status rules:
 *   ok        → latest entry found for today (UTC)
 *   stale     → latest entry is 1-2 days old
 *   no-data   → no entry within 3 days (or store empty)
 *   error     → blob store unreachable / list call threw
 *
 * Auth & rate-limit:
 *   Authenticated via the shared `authenticate` middleware.
 *   Rate-limited to 60 req / 15 min per IP.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO continuous oversight)
 *   FDL No.10/2025 Art.24    (10-year audit retention)
 *   Cabinet Res 134/2025 Art.19 (internal reporting)
 *   NIST AI RMF MEASURE-4     (continuous validation)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':
    process.env.HAWKEYE_ALLOWED_ORIGIN ?? 'https://hawkeye-sterling-v2.netlify.app',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '600',
  Vary: 'Origin',
} as const;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init.headers ?? {}) },
  });
}

interface RoutineRegistryEntry {
  id: string;
  storeName: string;
  /** How many days back to still consider fresh. Most routines: 1. Weekly: 7. */
  freshnessDays: number;
}

/**
 * Canonical registry of scheduled routines. Store names mirror the
 * constants declared inside each `netlify/functions/*-cron.mts`.
 * Keep this list in sync with `routines.html` ROUTINES.
 */
const REGISTRY: RoutineRegistryEntry[] = [
  { id: 'sanctions-ingest', storeName: 'sanctions-ingest-audit', freshnessDays: 1 },
  { id: 'sanctions-delta-screen', storeName: 'sanctions-delta-screen-audit', freshnessDays: 1 },
  { id: 'sanctions-watch', storeName: 'sanctions-watch-audit', freshnessDays: 1 },
  { id: 'asana-reconcile', storeName: 'asana-reconcile-audit', freshnessDays: 1 },
  { id: 'asana-retry-queue', storeName: 'asana-retry-audit', freshnessDays: 1 },
  { id: 'asana-super-brain-autopilot', storeName: 'autopilot-audit', freshnessDays: 1 },
  { id: 'asana-sync', storeName: 'asana-sync-audit', freshnessDays: 1 },
  { id: 'brain-clamp', storeName: 'brain-clamp-audit', freshnessDays: 1 },
  { id: 'chain-anchor', storeName: 'chain-anchor-audit', freshnessDays: 1 },
  { id: 'ai-governance-self-audit', storeName: 'ai-governance-audit', freshnessDays: 1 },
  { id: 'cbuae-fx', storeName: 'cbuae-fx-audit', freshnessDays: 1 },
  { id: 'expiry-scan', storeName: 'expiry-scan-audit', freshnessDays: 1 },
  { id: 'red-team', storeName: 'red-team-audit', freshnessDays: 1 },
  { id: 'regulatory-drift', storeName: 'regulatory-drift-audit', freshnessDays: 1 },
  { id: 'regulatory-horizon', storeName: 'regulatory-horizon-audit', freshnessDays: 1 },
  { id: 'tm-scan', storeName: 'tm-scan-audit', freshnessDays: 1 },
  { id: 'morning-briefing', storeName: 'briefing-audit', freshnessDays: 1 },
  { id: 'asana-weekly-customer-status', storeName: 'weekly-cust-audit', freshnessDays: 7 },
  { id: 'asana-weekly-digest', storeName: 'weekly-digest-audit', freshnessDays: 7 },
  { id: 'cdd-weekly-status', storeName: 'cdd-status-audit', freshnessDays: 7 },
];

interface RoutineStatus {
  id: string;
  storeName: string;
  lastRunKey: string | null;
  lastRunAtIso: string | null;
  status: 'ok' | 'stale' | 'no-data' | 'error';
  daysAgo: number | null;
  note?: string;
}

function dayPrefix(offsetDays: number): string {
  const d = new Date(Date.now() - offsetDays * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * Resolves the latest audit-blob metadata for a single routine by
 * listing today's prefix first, then walking back up to `maxLookbackDays`.
 * Returns `null` if no entry is found inside the lookback window.
 */
async function resolveLatest(
  entry: RoutineRegistryEntry,
  maxLookbackDays: number
): Promise<{ key: string; daysAgo: number } | null> {
  const store = getStore(entry.storeName);
  for (let i = 0; i <= maxLookbackDays; i++) {
    const prefix = dayPrefix(i) + '/';
    let listing;
    try {
      listing = await store.list({ prefix });
    } catch {
      // Store doesn't exist yet, or the listing call failed; treat as empty.
      listing = { blobs: [] as Array<{ key: string }> };
    }
    const blobs = (listing?.blobs ?? []) as Array<{ key: string }>;
    if (blobs.length === 0) continue;
    // Keys share the `YYYY-MM-DD/` prefix, so lex sort = chronological sort.
    blobs.sort((a, b) => (b.key > a.key ? 1 : -1));
    return { key: blobs[0].key, daysAgo: i };
  }
  return null;
}

async function resolveStatus(entry: RoutineRegistryEntry): Promise<RoutineStatus> {
  try {
    const latest = await resolveLatest(entry, Math.max(entry.freshnessDays + 2, 3));
    if (!latest) {
      return {
        id: entry.id,
        storeName: entry.storeName,
        lastRunKey: null,
        lastRunAtIso: null,
        status: 'no-data',
        daysAgo: null,
        note: 'no audit entry within lookback window',
      };
    }
    // Extract the date portion of the key for a best-effort lastRunAtIso.
    const datePart = latest.key.slice(0, 10);
    const lastRunAtIso = /^\d{4}-\d{2}-\d{2}$/.test(datePart)
      ? `${datePart}T00:00:00Z`
      : null;
    const status: RoutineStatus['status'] =
      latest.daysAgo <= entry.freshnessDays ? 'ok' : 'stale';
    return {
      id: entry.id,
      storeName: entry.storeName,
      lastRunKey: latest.key,
      lastRunAtIso,
      status,
      daysAgo: latest.daysAgo,
    };
  } catch (err) {
    return {
      id: entry.id,
      storeName: entry.storeName,
      lastRunKey: null,
      lastRunAtIso: null,
      status: 'error',
      daysAgo: null,
      note: (err as Error)?.message ?? 'blob store error',
    };
  }
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    max: 60,
    clientIp: context.ip,
    namespace: 'routines-status',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  // Resolve all routines in parallel. A single slow blob store cannot
  // block the rest because each `resolveStatus` is wrapped in try/catch.
  const results = await Promise.all(REGISTRY.map((r) => resolveStatus(r)));

  const summary = results.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<RoutineStatus['status'], number>
  );

  return jsonResponse({
    fetchedAtIso: new Date().toISOString(),
    total: results.length,
    summary,
    routines: results,
  });
};

export const config: Config = {
  path: '/api/routines-status',
};
