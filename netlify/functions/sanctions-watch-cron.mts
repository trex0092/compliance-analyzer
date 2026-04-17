/**
 * Sanctions Watch Daily — cron.
 *
 * Schedule: daily 05:00 UTC = 09:00 Asia/Dubai. Feeds the Claude Code
 * "Sanctions Watch" routine that runs at the same time slot. The routine
 * reads the latest blob produced here to brief the MLRO without having
 * to re-aggregate the raw hits itself.
 *
 * This cron re-runs the pure cohort screener against the latest
 * sanctions delta so the MLRO view contains real per-customer hit
 * detail rather than counts-only. The existing
 * netlify/functions/sanctions-delta-screen-cron.mts handles dispatch
 * every 4 hours and persists audit counts; the MLRO view is
 * reconstructed here so we never risk divergence between the dispatch
 * audit and the briefing the MLRO reads.
 *
 * Frozen-subject and false-positive data are still empty in this
 * revision because no persistence layer exists for either. Wiring
 * those is a tracked follow-up that does not block the routine.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-22, Art.24, Art.29, Art.35
 *   - Cabinet Res 74/2020 Art.4-7
 *   - FATF Rec 6, Rec 20
 *   - MoE Circular 08/AML/2021
 */

import type { Config } from '@netlify/functions';
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

const REPORT_STORE = 'sanctions-watch-reports';
const AUDIT_STORE = 'sanctions-watch-audit';
const SNAPSHOT_STORE = 'sanctions-snapshots';
const COHORT_STORE = 'sanctions-cohort';
const DELTA_STORE = 'sanctions-deltas';

interface CronResult {
  ok: boolean;
  startedAt: string;
  reportKey?: string;
  anyListMissing?: boolean;
  hitCount?: number;
  /**
   * Rendered markdown report. Returned inline so Claude Code routines
   * can fetch the cron URL and present the briefing directly.
   */
  markdown?: string;
  mlroDispatch?: {
    ok: boolean;
    skipped?: string;
    statusUpdateGid?: string;
    error?: string;
  };
  error?: string;
}

async function writeAudit(payload: Record<string, unknown>): Promise<void> {
  try {
    const store = getStore(AUDIT_STORE);
    const iso = new Date().toISOString();
    await store.setJSON(`${iso.slice(0, 10)}/${Date.now()}.json`, {
      ...payload,
      recordedAt: iso,
    });
  } catch {
    /* audit write best-effort */
  }
}

/**
 * Best-effort health probe per required source. Reads the most recent
 * snapshot key under `sanctions-snapshots/<SOURCE>/` and reports 'ok'
 * if a snapshot exists within the past 24h, 'stale' if older, and
 * 'missing' if nothing is there. Never throws.
 */
type ProbeStatus = 'ok' | 'stale' | 'missing' | 'manual-pending';
type ProbeEntry = { status: ProbeStatus; lastCheckedAt?: string; note?: string };

// Sources that only exist as manual uploads (no public stable URL).
// If no snapshot exists they surface as `manual-pending`, not `missing`.
const MANUAL_ONLY_SOURCES = new Set<'UAE' | 'EOCN'>(['UAE', 'EOCN']);

/**
 * Map the six REQUIRED_SOURCES (short names used in the MLRO briefing)
 * onto the ingest cron's key prefixes (long names used in the
 * `sanctions-snapshots` blob store). OFAC covers both SDN and
 * Consolidated feeds; UAE and EOCN both read from the single
 * `UAE_EOCN` manual-upload slot.
 */
const INGEST_KEY_PREFIXES: Record<
  'UN' | 'OFAC' | 'EU' | 'UK' | 'UAE' | 'EOCN',
  ReadonlyArray<string>
> = {
  UN: ['UN/'],
  OFAC: ['OFAC_SDN/', 'OFAC_CONS/'],
  EU: ['EU/'],
  UK: ['UK_OFSI/'],
  UAE: ['UAE_EOCN/'],
  EOCN: ['UAE_EOCN/'],
};

async function probeCoverage(
  now: Date
): Promise<Record<'UN' | 'OFAC' | 'EU' | 'UK' | 'UAE' | 'EOCN', ProbeEntry>> {
  const sources = ['UN', 'OFAC', 'EU', 'UK', 'UAE', 'EOCN'] as const;
  const store = getStore(SNAPSHOT_STORE);
  const cutoffMs = now.getTime() - 24 * 60 * 60 * 1000;

  const results: Record<string, ProbeEntry> = {};
  for (const source of sources) {
    const manualOnly = MANUAL_ONLY_SOURCES.has(source as 'UAE' | 'EOCN');
    try {
      // Walk every ingest prefix for this source and keep the newest
      // snapshot across them (OFAC has two underlying feeds).
      let latestKey: string | undefined;
      for (const prefix of INGEST_KEY_PREFIXES[source]) {
        const blobs = await listAllBlobs(store, prefix);
        for (const blob of blobs) {
          if (!latestKey || blob.key > latestKey) latestKey = blob.key;
        }
      }
      if (!latestKey) {
        results[source] = manualOnly
          ? { status: 'manual-pending', note: 'awaiting manual upload' }
          : { status: 'missing', note: 'no snapshot in store' };
        continue;
      }
      // Keys look like "<SOURCE>/<YYYY-MM-DD>/<filename>.json" — the
      // date segment is enough to detect staleness without loading the
      // blob body.
      const dateSegment = latestKey.split('/')[1] ?? '';
      const dateMs = Date.parse(dateSegment);
      if (!Number.isFinite(dateMs)) {
        results[source] = { status: 'stale', note: 'key format unrecognised' };
        continue;
      }
      results[source] = {
        status: dateMs >= cutoffMs ? 'ok' : 'stale',
        lastCheckedAt: new Date(dateMs).toISOString(),
      };
    } catch (err) {
      const note = err instanceof Error ? err.message : String(err);
      results[source] = manualOnly
        ? { status: 'manual-pending', note }
        : { status: 'missing', note };
    }
  }
  return results as Record<'UN' | 'OFAC' | 'EU' | 'UK' | 'UAE' | 'EOCN', ProbeEntry>;
}

/**
 * Load the latest sanctions delta + every tenant cohort and re-run the
 * pure cohort screener so the MLRO view contains live per-customer hit
 * detail. Best-effort: if either store is missing, returns an empty
 * array and the failure is captured in the audit store.
 */
async function loadLiveHits(): Promise<
  import('../../src/services/sanctionsDeltaCohortScreener').DeltaScreenHit[]
> {
  try {
    const { screenCohortAgainstDelta } =
      await import('../../src/services/sanctionsDeltaCohortScreener');
    const deltaStore = getStore(DELTA_STORE);
    const delta = (await deltaStore.get('latest.json', { type: 'json' })) as
      | import('../../src/services/sanctionsDelta').SanctionsDelta
      | null;
    if (!delta) return [];

    const cohortStore = getStore(COHORT_STORE);
    const cohortBlobs = await listAllBlobs(cohortStore, '');
    const tenantCohortKeys = cohortBlobs
      .map((b) => b.key)
      .filter((k) => k.endsWith('/cohort.json'));

    const hits: import('../../src/services/sanctionsDeltaCohortScreener').DeltaScreenHit[] = [];
    for (const key of tenantCohortKeys) {
      const cohort = (await cohortStore.get(key, { type: 'json' })) as
        | import('../../src/services/sanctionsDeltaCohortScreener').CohortCustomer[]
        | null;
      if (!Array.isArray(cohort)) continue;
      const report = screenCohortAgainstDelta(cohort, delta);
      for (const h of report.hits) hits.push(h);
    }
    return hits;
  } catch (err) {
    await writeAudit({
      event: 'sanctions_watch_load_hits_failed',
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export default async (): Promise<Response> => {
  const startedAt = new Date().toISOString();
  const now = new Date(startedAt);

  const { COMPANY_REGISTRY } = await import('../../src/domain/customers');
  const { buildSanctionsWatchReport, renderSanctionsWatchMarkdown } =
    await import('../../src/services/sanctionsWatchGenerator');
  const { postMlroStatusUpdate, deriveStatusColor } =
    await import('../../src/services/mlroAsanaDispatch');

  try {
    const [coverage, hits] = await Promise.all([probeCoverage(now), loadLiveHits()]);

    const report = buildSanctionsWatchReport({
      now,
      portfolioSize: COMPANY_REGISTRY.length,
      listCoverage: coverage,
      hits,
      // Frozen-subject and false-positive persistence does not yet
      // exist. Declare them as unwired so the generator emits a loud
      // "INCOMPLETE BRIEFING" banner instead of silently rendering
      // empty sections that look like "all clear".
      frozenSubjects: [],
      recentFalsePositives: [],
      unwiredDataSources: ['frozenSubjects', 'recentFalsePositives'],
    });

    const markdown = renderSanctionsWatchMarkdown(report);
    const key = `${startedAt.slice(0, 10)}/report.json`;
    const store = getStore(REPORT_STORE);
    await store.setJSON(key, {
      generatedAt: startedAt,
      report,
      markdown,
    });

    const mlroDispatch = await postMlroStatusUpdate({
      title: `Sanctions Watch — ${startedAt.slice(0, 10)}`,
      markdown,
      statusType: deriveStatusColor({
        anyListMissing: report.anyListMissing,
        confirmedHits: report.bandCounts.confirmed,
        imminentBreaches: report.freezeCountdowns.filter((f) => f.eocnBreached || f.cnmrBreached)
          .length,
      }),
    });

    await writeAudit({
      event: 'sanctions_watch_report_generated',
      reportKey: key,
      portfolioSize: report.portfolioSize,
      anyListMissing: report.anyListMissing,
      missingSources: report.missingSources,
      bandCounts: report.bandCounts,
      freezeCount: report.freezeCountdowns.length,
      hitsTotal: hits.length,
      mlroDispatch,
    });

    const result: CronResult = {
      ok: true,
      startedAt,
      reportKey: key,
      anyListMissing: report.anyListMissing,
      hitCount: hits.length,
      markdown,
      mlroDispatch,
    };
    return Response.json(result);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await writeAudit({ event: 'sanctions_watch_report_failed', error });
    return Response.json({ ok: false, startedAt, error }, { status: 500 });
  }
};

export const config: Config = {
  // Daily 05:00 UTC = 09:00 Asia/Dubai.
  schedule: '0 5 * * *',
};
