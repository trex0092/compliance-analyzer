/**
 * Sanctions Ingest Status — on-demand diagnostic endpoint.
 *
 * Walks the `sanctions-ingest-audit` blob store for the past 24 hours
 * and returns a per-source rollup of runs, success counts, and the
 * most recent error message for any source that failed. Useful for
 * diagnosing why a source shows `missing` in the Morning Briefing
 * when the ingest cron itself reports `ok` at the top level.
 *
 * Per-source rollup shape (in the response):
 *   {
 *     source: 'OFAC_SDN' | ...,
 *     totalRuns: number,
 *     successRuns: number,
 *     failedRuns: number,
 *     lastSuccessIso?: string,
 *     lastError?: string,
 *     lastErrorAtIso?: string,
 *     lastFetchedCount?: number,
 *   }
 *
 * This endpoint is INTENDED FOR MLRO / OPERATOR diagnostics only. It
 * reads already-recorded audit data; it never triggers an ingest. It
 * is safe to hit on-demand without side effects.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (10-year audit retention — this endpoint
 *     reads the audit store only)
 *   - FDL No.10/2025 Art.35 (TFS completeness — diagnostic for the
 *     coverage gap a MLRO sees)
 */

import { getStore } from '@netlify/blobs';

/** Walk every page of a blob-store listing — the SDK paginates by default. */
async function listAllBlobs(
  store: ReturnType<typeof getStore>,
  prefix: string
): Promise<Array<{ key: string }>> {
  const all: Array<{ key: string }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const iter = (store as any).list({ prefix, paginate: true }) as AsyncIterable<{
    blobs?: Array<{ key: string }>;
  }>;
  for await (const page of iter) {
    if (page.blobs) for (const b of page.blobs) all.push(b);
  }
  return all;
}

const INGEST_AUDIT_STORE = 'sanctions-ingest-audit';

type SanctionsSource = 'OFAC_SDN' | 'OFAC_CONS' | 'UN' | 'EU' | 'UK_OFSI' | 'UAE_EOCN';

interface SourceRollup {
  source: SanctionsSource;
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  lastSuccessIso?: string;
  lastError?: string;
  lastErrorAtIso?: string;
  lastFetchedCount?: number;
}

interface AuditEntry {
  event?: string;
  startedAt?: string;
  finishedAt?: string;
  results?: Array<{
    source: SanctionsSource;
    ok: boolean;
    fetched?: number;
    error?: string;
    durationMs?: number;
  }>;
}

export default async (): Promise<Response> => {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const sources: SanctionsSource[] = ['OFAC_SDN', 'OFAC_CONS', 'UN', 'EU', 'UK_OFSI', 'UAE_EOCN'];
  const rollup: Record<SanctionsSource, SourceRollup> = Object.fromEntries(
    sources.map((s) => [s, { source: s, totalRuns: 0, successRuns: 0, failedRuns: 0 }])
  ) as Record<SanctionsSource, SourceRollup>;

  let totalAuditEntries = 0;
  try {
    const store = getStore(INGEST_AUDIT_STORE);
    for (const prefix of [today, yesterday]) {
      const blobs = await listAllBlobs(store, `${prefix}/`);
      for (const blob of blobs) {
        const body = (await store.get(blob.key, { type: 'json' })) as AuditEntry | null;
        if (!body || !Array.isArray(body.results)) continue;
        totalAuditEntries += 1;
        const at = body.finishedAt ?? body.startedAt;
        for (const r of body.results) {
          const row = rollup[r.source];
          if (!row) continue;
          row.totalRuns += 1;
          if (r.ok) {
            row.successRuns += 1;
            row.lastSuccessIso = at;
            if (typeof r.fetched === 'number') row.lastFetchedCount = r.fetched;
          } else {
            row.failedRuns += 1;
            if (r.error) {
              row.lastError = r.error;
              row.lastErrorAtIso = at;
            }
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
      { status: 500 }
    );
  }

  return Response.json({
    ok: true,
    generatedAt: now.toISOString(),
    window: { from: yesterday, to: today },
    totalAuditEntries,
    perSource: sources.map((s) => rollup[s]),
  });
};
