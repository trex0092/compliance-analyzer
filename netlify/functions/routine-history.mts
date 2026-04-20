/**
 * Routine History — per-routine, per-day run-count timeline.
 *
 * GET /api/routine-history?id=<routineId>&days=<N>
 *
 * Lists the audit-blob prefixes `YYYY-MM-DD/` for one registered
 * routine over the last N days (default 30, max 90) and returns a
 * per-day run count. Powers the sparkline/heatmap surfaced in the
 * routines.html drawer so MLROs can see SLA misses and flappy
 * routines at a glance without scraping the audit store by hand.
 *
 * Response shape:
 *   {
 *     fetchedAtIso: string,
 *     id: string,
 *     storeName: string,
 *     freshnessDays: number,
 *     expectedPerDay: number | null,
 *     days: Array<{ dateIso: 'YYYY-MM-DD', count: number }>,
 *     totalRuns: number,
 *     activeDays: number,
 *     lastRunDateIso: string | null,
 *     firstSeenDateIso: string | null
 *   }
 *
 * Day grid ordering: oldest first, today last. Clients render
 * left-to-right.
 *
 * Auth & rate-limit:
 *   Authenticated via the shared `authenticate` middleware.
 *   Rate-limited to 60 req / 15 min per IP.
 *   Enumeration protection: `id` must match the server-side
 *   allow-list; unknown ids get a generic 404 so attackers cannot
 *   probe arbitrary blob stores.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.24       (10-year audit retention; a 30-day
 *                                timeline is the MLRO-facing
 *                                manifestation that supports MoE
 *                                inspection evidence)
 *   Cabinet Res 134/2025 Art.19 (internal reporting)
 *   NIST AI RMF MEASURE-4       (continuous validation)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':
    process.env.HAWKEYE_ALLOWED_ORIGIN ?? 'https://hawkeye-sterling-v2.netlify.app',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

interface RoutineHistoryEntry {
  id: string;
  storeName: string;
  /** How many days back a single run is still considered fresh. */
  freshnessDays: number;
  /**
   * Cron-derived expected runs per calendar day. `null` for
   * non-uniform schedules (weekdays-only, weekly) where SLA
   * highlighting is out of scope here — the client still gets the
   * raw counts and can decide what to draw.
   */
  expectedPerDay: number | null;
}

/**
 * Mirror of the registry in `routines-status.mts`, extended with the
 * cron-derived expected runs per day. Keep in sync with that file and
 * with the client-side ROUTINES array in `routines.html`.
 */
const REGISTRY: RoutineHistoryEntry[] = [
  { id: 'sanctions-ingest', storeName: 'sanctions-ingest-audit', freshnessDays: 1, expectedPerDay: 96 },
  { id: 'sanctions-delta-screen', storeName: 'sanctions-delta-screen-audit', freshnessDays: 1, expectedPerDay: 6 },
  { id: 'sanctions-watch', storeName: 'sanctions-watch-audit', freshnessDays: 1, expectedPerDay: 1 },
  { id: 'asana-reconcile', storeName: 'asana-reconcile-audit', freshnessDays: 1, expectedPerDay: 288 },
  { id: 'asana-retry-queue', storeName: 'asana-retry-audit', freshnessDays: 1, expectedPerDay: 1440 },
  { id: 'asana-super-brain-autopilot', storeName: 'autopilot-audit', freshnessDays: 1, expectedPerDay: 96 },
  { id: 'asana-sync', storeName: 'asana-sync-audit', freshnessDays: 1, expectedPerDay: 288 },
  { id: 'brain-clamp', storeName: 'brain-clamp-audit', freshnessDays: 1, expectedPerDay: 24 },
  { id: 'chain-anchor', storeName: 'chain-anchor-audit', freshnessDays: 1, expectedPerDay: 24 },
  { id: 'ai-governance-self-audit', storeName: 'ai-governance-audit', freshnessDays: 1, expectedPerDay: 1 },
  { id: 'cbuae-fx', storeName: 'cbuae-fx-audit', freshnessDays: 1, expectedPerDay: 1 },
  { id: 'expiry-scan', storeName: 'expiry-scan-audit', freshnessDays: 1, expectedPerDay: 1 },
  { id: 'red-team', storeName: 'red-team-audit', freshnessDays: 1, expectedPerDay: 1 },
  { id: 'regulatory-drift', storeName: 'regulatory-drift-audit', freshnessDays: 1, expectedPerDay: 1 },
  { id: 'regulatory-horizon', storeName: 'regulatory-horizon-audit', freshnessDays: 1, expectedPerDay: 1 },
  { id: 'tm-scan', storeName: 'tm-scan-audit', freshnessDays: 1, expectedPerDay: 1 },
  { id: 'morning-briefing', storeName: 'briefing-audit', freshnessDays: 1, expectedPerDay: null },
  { id: 'asana-weekly-customer-status', storeName: 'weekly-cust-audit', freshnessDays: 7, expectedPerDay: null },
  { id: 'asana-weekly-digest', storeName: 'weekly-digest-audit', freshnessDays: 7, expectedPerDay: null },
  { id: 'cdd-weekly-status', storeName: 'cdd-status-audit', freshnessDays: 7, expectedPerDay: null },
];

const MAX_DAYS = 90;
const DEFAULT_DAYS = 30;

function dayPrefix(offsetDays: number): string {
  const d = new Date(Date.now() - offsetDays * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function parseDaysParam(raw: string | null): number {
  if (!raw) return DEFAULT_DAYS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAYS;
  return Math.min(n, MAX_DAYS);
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    max: 60,
    clientIp: context.ip,
    namespace: 'routine-history',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  const url = new URL(req.url);
  const id = (url.searchParams.get('id') ?? '').trim();
  if (!/^[a-z0-9-]{1,64}$/.test(id)) {
    return jsonResponse({ error: 'Invalid routine id' }, { status: 400 });
  }

  const entry = REGISTRY.find((r) => r.id === id);
  if (!entry) {
    return jsonResponse({ error: 'Unknown routine' }, { status: 404 });
  }

  const days = parseDaysParam(url.searchParams.get('days'));
  const store = getStore(entry.storeName);

  // Build an empty day grid from (days-1) days ago up to today, then
  // fill counts in parallel. A single failing prefix cannot stall the
  // others — each list call is wrapped in its own try/catch.
  const grid: Array<{ dateIso: string; count: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    grid.push({ dateIso: dayPrefix(i), count: 0 });
  }

  await Promise.all(
    grid.map(async (slot) => {
      try {
        const listing = await store.list({ prefix: slot.dateIso + '/' });
        const blobs = (listing?.blobs ?? []) as Array<{ key: string }>;
        slot.count = blobs.length;
      } catch {
        slot.count = 0;
      }
    })
  );

  let totalRuns = 0;
  let activeDays = 0;
  let lastRunDateIso: string | null = null;
  let firstSeenDateIso: string | null = null;
  for (const slot of grid) {
    if (slot.count > 0) {
      totalRuns += slot.count;
      activeDays += 1;
      if (!firstSeenDateIso) firstSeenDateIso = slot.dateIso;
      lastRunDateIso = slot.dateIso;
    }
  }

  return jsonResponse({
    fetchedAtIso: new Date().toISOString(),
    id: entry.id,
    storeName: entry.storeName,
    freshnessDays: entry.freshnessDays,
    expectedPerDay: entry.expectedPerDay,
    days: grid,
    totalRuns,
    activeDays,
    lastRunDateIso,
    firstSeenDateIso,
  });
};

export const config: Config = {
  path: '/api/routine-history',
};
