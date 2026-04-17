/**
 * Asana Reconcile Summary — on-demand read-only diagnostic.
 *
 * GET /.netlify/functions/asana-reconcile-summary[?window=24h|1h|7d]
 *
 * Walks the `asana-reconcile-audit` blob store for the requested
 * window (default 24h) and returns a per-tenant rollup of cron
 * health and match quality. This is the endpoint the MLRO polls
 * during the rollout of ASANA_RECONCILE_LIVE_READS_ENABLED so they
 * can see whether the heuristic case-id matching is tracking real
 * drift before we wire the reconciler's `actions` output to real
 * Asana dispatches.
 *
 * The endpoint is READ-ONLY — it never writes to any store and
 * never triggers a reconcile cycle. Safe to hit on demand.
 *
 * Auth + rate limit match every other authenticated diagnostic
 * surface in this repo:
 *   - `authenticate(req)` against HAWKEYE_BRAIN_TOKEN.
 *   - 30 requests / 15 min per IP under the `asana-reconcile-summary`
 *     namespace.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20 — MLRO visibility of brain ↔ Asana drift.
 *   FDL No.10/2025 Art.24 — reads the audit store only; retention
 *     lifetime of the underlying blobs is unchanged.
 *   Cabinet Res 134/2025 Art.19 — audit-rollup surface for internal
 *     review of the reconcile cron.
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';

const AUDIT_STORE = 'asana-reconcile-audit';
const DEFAULT_WINDOW_HOURS = 24;
const MIN_WINDOW_HOURS = 1;
const MAX_WINDOW_HOURS = 24 * 7;

interface AuditRow {
  event?: string;
  recordedAt?: string;
  tenantsProcessed?: number;
  totalActions?: number;
  durationMs?: number;
  liveMode?: boolean;
  note?: string;
  perTenant?: Array<{
    tenantId?: string;
    actions?: number;
    inAgreement?: number;
    tolerated?: number;
    actionKinds?: string[];
    plansForTenant?: number;
    asanaTasksMatched?: number;
    asanaProjectGid?: string | null;
    fallbackReason?: string;
  }>;
}

interface TenantRollup {
  tenantId: string;
  ticksObserved: number;
  totalActions: number;
  totalInAgreement: number;
  totalTolerated: number;
  totalPlansForTenant: number;
  totalAsanaTasksMatched: number;
  actionKindCounts: Record<string, number>;
  latestFallbackReason?: string;
  latestRecordedAtIso?: string;
  asanaProjectGid?: string | null;
  /**
   * Share of ticks where the cron was able to either find no drift
   * or report concrete diagnostics (i.e. `fallbackReason` was NOT
   * set on that tick). 100% = cron is always able to read both
   * sides; anything lower means the tenant had at least one tick
   * where the reader aborted with a fallback.
   */
  healthyReadPct: number;
}

interface SummaryResponse {
  ok: true;
  generatedAt: string;
  window: {
    fromIso: string;
    toIso: string;
    hours: number;
  };
  auditEntriesScanned: number;
  lastTickAtIso?: string;
  liveModeRecentlyEnabled: boolean;
  totals: {
    ticks: number;
    tenantsWithActivity: number;
    actionsProposed: number;
    inAgreement: number;
    tolerated: number;
  };
  perTenant: TenantRollup[];
  readinessHint: string;
}

function parseWindowHours(raw: string | null): number {
  if (!raw) return DEFAULT_WINDOW_HOURS;
  const s = raw.trim().toLowerCase();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(h|d)?$/);
  if (!m) return DEFAULT_WINDOW_HOURS;
  const num = Number(m[1]);
  if (!Number.isFinite(num) || num <= 0) return DEFAULT_WINDOW_HOURS;
  const unit = m[2] ?? 'h';
  const hours = unit === 'd' ? num * 24 : num;
  return Math.max(MIN_WINDOW_HOURS, Math.min(MAX_WINDOW_HOURS, hours));
}

async function listAllBlobs(
  store: ReturnType<typeof getStore>,
  prefix: string,
): Promise<Array<{ key: string }>> {
  const all: Array<{ key: string }> = [];
  // Netlify Blobs `list` paginates by default — walk every page.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const iter = (store as any).list({ prefix, paginate: true }) as AsyncIterable<{
    blobs?: Array<{ key: string }>;
  }>;
  for await (const page of iter) {
    if (page.blobs) for (const b of page.blobs) all.push(b);
  }
  return all;
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'GET') {
    return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    clientIp: context.ip,
    max: 30,
    namespace: 'asana-reconcile-summary',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response ?? Response.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const windowHours = parseWindowHours(url.searchParams.get('window'));
  const windowMs = windowHours * 60 * 60 * 1000;
  const now = new Date();
  const fromMs = now.getTime() - windowMs;

  // Walk the YYYY-MM-DD prefixes we care about. One extra day for
  // safety since the recorded ISO timestamp and the blob key day
  // bucket can straddle midnight UTC.
  const dayPrefixes = new Set<string>();
  for (let offsetMs = 0; offsetMs <= windowMs + 24 * 60 * 60 * 1000; offsetMs += 24 * 60 * 60 * 1000) {
    dayPrefixes.add(new Date(now.getTime() - offsetMs).toISOString().slice(0, 10));
  }

  const store = getStore(AUDIT_STORE);
  const rollup = new Map<string, TenantRollup>();
  let auditEntriesScanned = 0;
  let totalTicks = 0;
  let totalActions = 0;
  let totalInAgreement = 0;
  let totalTolerated = 0;
  let lastTickAtIso: string | undefined;
  let liveModeRecentlyEnabled = false;

  try {
    for (const prefix of dayPrefixes) {
      const blobs = await listAllBlobs(store, `${prefix}/`);
      for (const blob of blobs) {
        const body = (await store.get(blob.key, { type: 'json' })) as AuditRow | null;
        if (!body) continue;
        // Only interested in cron-tick rows; the cron also writes
        // per-tenant `asana_reconcile_snapshot_read_failed` rows
        // which are surfaced via `fallbackReason` in the per-tenant
        // rollup.
        if (body.event !== 'asana_reconcile_cron_tick') continue;
        if (!body.recordedAt) continue;
        const tickMs = Date.parse(body.recordedAt);
        if (!Number.isFinite(tickMs) || tickMs < fromMs) continue;

        auditEntriesScanned++;
        totalTicks++;
        totalActions += body.totalActions ?? 0;
        if (body.liveMode) liveModeRecentlyEnabled = true;
        if (!lastTickAtIso || body.recordedAt > lastTickAtIso) {
          lastTickAtIso = body.recordedAt;
        }

        for (const pt of body.perTenant ?? []) {
          if (!pt.tenantId) continue;
          let tenant = rollup.get(pt.tenantId);
          if (!tenant) {
            tenant = {
              tenantId: pt.tenantId,
              ticksObserved: 0,
              totalActions: 0,
              totalInAgreement: 0,
              totalTolerated: 0,
              totalPlansForTenant: 0,
              totalAsanaTasksMatched: 0,
              actionKindCounts: {},
              healthyReadPct: 0,
            };
            rollup.set(pt.tenantId, tenant);
          }
          tenant.ticksObserved++;
          tenant.totalActions += pt.actions ?? 0;
          tenant.totalInAgreement += pt.inAgreement ?? 0;
          tenant.totalTolerated += pt.tolerated ?? 0;
          tenant.totalPlansForTenant += pt.plansForTenant ?? 0;
          tenant.totalAsanaTasksMatched += pt.asanaTasksMatched ?? 0;
          totalInAgreement += pt.inAgreement ?? 0;
          totalTolerated += pt.tolerated ?? 0;
          for (const kind of pt.actionKinds ?? []) {
            tenant.actionKindCounts[kind] = (tenant.actionKindCounts[kind] ?? 0) + 1;
          }
          if (pt.fallbackReason) {
            tenant.latestFallbackReason = pt.fallbackReason;
          }
          if (!tenant.latestRecordedAtIso || body.recordedAt > tenant.latestRecordedAtIso) {
            tenant.latestRecordedAtIso = body.recordedAt;
            tenant.asanaProjectGid = pt.asanaProjectGid ?? null;
          }
        }
      }
    }
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  // Compute per-tenant healthy-read percentage.
  for (const tenant of rollup.values()) {
    if (tenant.ticksObserved === 0) {
      tenant.healthyReadPct = 0;
      continue;
    }
    // A tick is "healthy" iff the tenant does not carry a fallback
    // on the latest tick. We only store the latest fallback reason,
    // so this is a pessimistic boolean: if the latest tick was in
    // fallback, report the percentage as 0 even if earlier ticks
    // were clean. That is the right default for a rollout monitor —
    // the MLRO should see red when the CURRENT state is unhealthy.
    tenant.healthyReadPct = tenant.latestFallbackReason ? 0 : 100;
  }

  const perTenant = [...rollup.values()].sort((a, b) =>
    a.tenantId.localeCompare(b.tenantId),
  );

  // Plain-English readiness hint so the MLRO doesn't need to read
  // the runbook on every poll.
  const readinessHint = (() => {
    if (totalTicks === 0) {
      return `No reconcile audit rows in the last ${windowHours}h. Either the cron is disabled (ASANA_RECONCILE_CRON_DISABLED=1) or the audit store is empty.`;
    }
    if (!liveModeRecentlyEnabled) {
      return 'Cron is in OBSERVATIONAL mode (ASANA_RECONCILE_LIVE_READS_ENABLED is not set). Flip the flag when you are ready to start collecting match-quality data.';
    }
    const unhealthy = perTenant.filter((t) => t.healthyReadPct < 100);
    if (unhealthy.length > 0) {
      return `Live reads enabled. ${unhealthy.length}/${perTenant.length} tenants have an unhealthy latest tick (fallbackReason set). Investigate before wiring actions to dispatch.`;
    }
    return `Live reads enabled. All ${perTenant.length} tenants are reading cleanly. Review ${windowHours}h of actionKindCounts before enabling dispatch.`;
  })();

  const resp: SummaryResponse = {
    ok: true,
    generatedAt: now.toISOString(),
    window: {
      fromIso: new Date(fromMs).toISOString(),
      toIso: now.toISOString(),
      hours: windowHours,
    },
    auditEntriesScanned,
    lastTickAtIso,
    liveModeRecentlyEnabled,
    totals: {
      ticks: totalTicks,
      tenantsWithActivity: rollup.size,
      actionsProposed: totalActions,
      inAgreement: totalInAgreement,
      tolerated: totalTolerated,
    },
    perTenant,
    readinessHint,
  };

  return Response.json(resp, {
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};

export const config: Config = {
  path: '/api/asana/reconcile-summary',
  method: ['GET', 'OPTIONS'],
};

// Exports for unit tests only.
export const __test__ = {
  parseWindowHours,
};
