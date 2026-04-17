/**
 * Tests for the asana-reconcile-summary read-only diagnostic
 * endpoint. The endpoint aggregates the last N hours of
 * `asana-reconcile-cron` audit rows so MLROs can watch the
 * rollout of ASANA_RECONCILE_LIVE_READS_ENABLED without reading
 * individual blobs.
 *
 * The bulk of the logic is in the per-tenant rollup and the
 * `readinessHint` string — this test drives the handler through
 * a fake Netlify Blobs store that scripts a few representative
 * audit rows.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

interface FakeBlob { value: unknown }
let store: Map<string, FakeBlob>;

vi.mock('@netlify/blobs', () => ({
  getStore: () => ({
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    list({ prefix }: { prefix: string; paginate?: boolean }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix));
      // Return an async iterable of one page (matches the SDK shape
      // the endpoint expects).
      return {
        async *[Symbol.asyncIterator]() {
          yield { blobs: keys.map((key) => ({ key })) };
        },
      };
    },
  }),
}));

// Bypass auth + rate limit — we are testing the summary aggregation.
vi.mock('../netlify/functions/middleware/auth.mts', () => ({
  authenticate: () => ({ ok: true, userId: 'test' }),
}));
vi.mock('../netlify/functions/middleware/rate-limit.mts', () => ({
  checkRateLimit: async () => null,
}));

beforeEach(() => {
  store = new Map();
});

afterEach(() => {
  vi.resetModules();
});

async function freshModule() {
  return await import('../netlify/functions/asana-reconcile-summary.mts?t=' + Date.now());
}

function seedTick(params: {
  iso: string;
  liveMode: boolean;
  perTenant: Array<{
    tenantId: string;
    fallbackReason?: string;
    actions?: number;
    inAgreement?: number;
    plansForTenant?: number;
    asanaTasksMatched?: number;
    actionKinds?: string[];
  }>;
}) {
  const key = `${params.iso.slice(0, 10)}/${Date.parse(params.iso)}.json`;
  store.set(key, {
    value: {
      event: 'asana_reconcile_cron_tick',
      recordedAt: params.iso,
      tenantsProcessed: params.perTenant.length,
      totalActions: params.perTenant.reduce((a, b) => a + (b.actions ?? 0), 0),
      liveMode: params.liveMode,
      perTenant: params.perTenant,
    },
  });
}

async function runSummary(window = '24h') {
  const mod = await freshModule();
  const req = new Request(
    `https://example.test/api/asana/reconcile-summary?window=${window}`,
    {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + 'a'.repeat(40) },
    },
  );
  return (mod.default as any)(req, { ip: '1.2.3.4' });
}

describe('asana-reconcile-summary', () => {
  it('reports readinessHint "observational mode" when liveMode is false', async () => {
    seedTick({
      iso: new Date().toISOString(),
      liveMode: false,
      perTenant: [
        { tenantId: 'madison', fallbackReason: 'live_reads_disabled_by_env' },
      ],
    });
    const res = await runSummary();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.liveModeRecentlyEnabled).toBe(false);
    expect(body.readinessHint).toMatch(/OBSERVATIONAL/);
    expect(body.totals.ticks).toBe(1);
  });

  it('flags unhealthy tenants in readinessHint when live reads are on', async () => {
    const iso = new Date().toISOString();
    seedTick({
      iso,
      liveMode: true,
      perTenant: [
        { tenantId: 'madison', plansForTenant: 3, asanaTasksMatched: 2, actionKinds: ['no_drift'] },
        { tenantId: 'naples', fallbackReason: 'listProjectTasks_failed: 401' },
      ],
    });
    const res = await runSummary();
    const body = await res.json();
    expect(body.readinessHint).toMatch(/1\/2 tenants.*unhealthy/);
    const naples = body.perTenant.find((t: { tenantId: string }) => t.tenantId === 'naples');
    expect(naples.healthyReadPct).toBe(0);
    expect(naples.latestFallbackReason).toBe('listProjectTasks_failed: 401');
    const madison = body.perTenant.find((t: { tenantId: string }) => t.tenantId === 'madison');
    expect(madison.healthyReadPct).toBe(100);
    expect(madison.actionKindCounts).toEqual({ no_drift: 1 });
  });

  it('returns "No audit rows" hint when the window is empty', async () => {
    const res = await runSummary('1h');
    const body = await res.json();
    expect(body.totals.ticks).toBe(0);
    expect(body.readinessHint).toMatch(/No reconcile audit rows/);
  });

  it('ignores audit rows older than the requested window', async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    seedTick({ iso: old, liveMode: true, perTenant: [{ tenantId: 'madison' }] });
    seedTick({
      iso: new Date().toISOString(),
      liveMode: true,
      perTenant: [{ tenantId: 'naples', actionKinds: ['no_drift'] }],
    });
    const res = await runSummary('24h');
    const body = await res.json();
    expect(body.totals.ticks).toBe(1);
    expect(body.perTenant.map((t: { tenantId: string }) => t.tenantId)).toEqual(['naples']);
  });

  it('aggregates action kind counts across multiple ticks', async () => {
    const now = Date.now();
    const tickA = new Date(now - 30 * 60 * 1000).toISOString();
    const tickB = new Date(now - 10 * 60 * 1000).toISOString();
    seedTick({
      iso: tickA,
      liveMode: true,
      perTenant: [{ tenantId: 'madison', actionKinds: ['no_drift'] }],
    });
    seedTick({
      iso: tickB,
      liveMode: true,
      perTenant: [{ tenantId: 'madison', actionKinds: ['asana_ahead_of_brain'] }],
    });
    const res = await runSummary('24h');
    const body = await res.json();
    const madison = body.perTenant[0];
    expect(madison.ticksObserved).toBe(2);
    expect(madison.actionKindCounts).toEqual({
      no_drift: 1,
      asana_ahead_of_brain: 1,
    });
  });

  it('parses the window query param (h / d suffixes, bounds)', async () => {
    const mod = await freshModule();
    const { __test__ } = mod as any;
    expect(__test__.parseWindowHours(null)).toBe(24);
    expect(__test__.parseWindowHours('12h')).toBe(12);
    expect(__test__.parseWindowHours('2d')).toBe(48);
    // Below the minimum rounds up to 1h.
    expect(__test__.parseWindowHours('0.1h')).toBe(1);
    // Above the max clamps to 7d.
    expect(__test__.parseWindowHours('30d')).toBe(168);
    // Garbage falls back to default.
    expect(__test__.parseWindowHours('banana')).toBe(24);
  });
});

describe('asana-reconcile-summary — method + auth', () => {
  it('returns 405 on POST', async () => {
    const mod = await freshModule();
    const res = await (mod.default as any)(
      new Request('https://example.test/api/asana/reconcile-summary', { method: 'POST' }),
      { ip: '1.2.3.4' },
    );
    expect(res.status).toBe(405);
  });

  it('returns 204 on OPTIONS preflight', async () => {
    const mod = await freshModule();
    const res = await (mod.default as any)(
      new Request('https://example.test/api/asana/reconcile-summary', { method: 'OPTIONS' }),
      { ip: '1.2.3.4' },
    );
    expect(res.status).toBe(204);
  });
});
