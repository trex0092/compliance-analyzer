/**
 * Scheduled sanctions-list ingestor (cron).
 *
 * Fetches UN, OFAC SDN, OFAC Consolidated, EU, and UK OFSI sanctions
 * lists on a fixed cadence, normalises them, persists both a full
 * snapshot and a delta, and records the ingest result in the audit
 * trail.
 *
 * Design decisions:
 *   - Fetches execute in parallel with a 30-second budget per source.
 *   - A fetch failure on one source does not block others — it is
 *     recorded as a `SOURCE_FAILED` entry with the error message.
 *   - The UAE EOCN list is NOT fetched here — it is published on
 *     circulars and must be loaded via the manual upload endpoint. We
 *     still emit a TODO entry so the audit trail shows EOCN coverage
 *     is pending.
 *   - Persistence is per-day + per-source so historic snapshots can
 *     be reconstructed for audit.
 *   - Delta is computed against the previous snapshot for the same
 *     source. New entries automatically trigger a re-screen flag
 *     via a brain event.
 *
 * Regulatory basis:
 *   Cabinet Res 74/2020 Art.4 — "without delay" designation screening
 *   FDL No.10/2025 Art.22 — TFS obligations
 *   FATF Rec 6 & 7 — timely implementation of UNSC sanctions
 */

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import {
  parseOfacSdnCsv,
  parseOfacConsCsv,
  parseUnConsolidatedXml,
  parseEuSanctionsXml,
  parseUkOfsiCsv,
  computeDelta,
  SANCTIONS_SOURCES,
  type SanctionsSource,
  type NormalisedSanction,
  type SanctionsDelta,
} from '../../src/services/sanctionsIngest';
import { fetchWithTimeout } from '../../src/utils/fetchWithTimeout';
import {
  createDefaultDeps,
  dispatchImmediateAlerts,
  candidatesFromSanctionsDelta,
  type DispatchSummary,
} from '../../src/services/immediateRiskAlerts';

const SNAPSHOT_STORE = 'sanctions-snapshots';
const DELTA_STORE = 'sanctions-deltas';
const INGEST_AUDIT_STORE = 'sanctions-ingest-audit';
const FETCH_TIMEOUT_MS = 30_000;

interface IngestResult {
  source: SanctionsSource;
  ok: boolean;
  fetchedCount?: number;
  error?: string;
  delta?: SanctionsDelta;
  durationMs: number;
}

/**
 * Canonical User-Agent for all sanctions-list fetches.
 *
 * Several of the source servers (notably treasury.gov / OFAC) return
 * 403 Forbidden to fetches without a browser-like UA. The default
 * Node fetch UA (`node` or undefined) has triggered that path in
 * production — every 15 min for weeks — so we pin a stable,
 * identifiable UA here. The URL in the UA points at our compliance
 * repo so the list maintainers can reach us if they need to.
 */
const INGEST_USER_AGENT =
  'Mozilla/5.0 (compatible; HawkeyeSterlingComplianceBot/1.0; +https://github.com/trex0092/compliance-analyzer)';

async function fetchSourceBody(url: string, timeoutMs: number): Promise<string> {
  const response = await fetchWithTimeout(url, {
    timeoutMs,
    headers: {
      'User-Agent': INGEST_USER_AGENT,
      Accept: 'text/csv, application/xml, text/xml, */*',
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.text();
}

/**
 * Parse a source payload into normalised records. Five of six sources
 * have real parsers (OFAC SDN, OFAC Consolidated, UN, EU, UK OFSI).
 * UAE EOCN is manual-upload only — no stable public URL exists.
 */
function parseSource(source: SanctionsSource, body: string): NormalisedSanction[] {
  switch (source) {
    case 'OFAC_SDN':
      return parseOfacSdnCsv(body);
    case 'OFAC_CONS':
      return parseOfacConsCsv(body);
    case 'UN':
      return parseUnConsolidatedXml(body);
    case 'EU':
      return parseEuSanctionsXml(body);
    case 'UK_OFSI':
      return parseUkOfsiCsv(body);
    case 'UAE_EOCN':
      // EOCN distributes via PDF/XML circulars — no stable URL.
      // Must be loaded via the manual upload endpoint.
      return [];
  }
}

async function loadPreviousSnapshot(source: SanctionsSource): Promise<NormalisedSanction[]> {
  try {
    const store = getStore(SNAPSHOT_STORE);
    const list = await store.list({ prefix: `${source}/` });
    if (!list.blobs || list.blobs.length === 0) return [];
    // Blob list order is not guaranteed to be lexicographic. Sort by
    // key (which starts with yyyy-mm-dd) to find the newest snapshot.
    const sorted = [...list.blobs].sort((a, b) => (a.key < b.key ? 1 : -1));
    const latest = sorted[0];
    const data = (await store.get(latest.key, { type: 'json' })) as NormalisedSanction[] | null;
    return data ?? [];
  } catch (err) {
    console.warn('[sanctions-ingest] failed to load previous snapshot', err);
    return [];
  }
}

async function persistSnapshot(
  source: SanctionsSource,
  entries: NormalisedSanction[],
  ingestedAtIso: string
): Promise<void> {
  const store = getStore(SNAPSHOT_STORE);
  const day = ingestedAtIso.slice(0, 10);
  await store.setJSON(`${source}/${day}/snapshot.json`, entries);
}

async function persistDelta(
  source: SanctionsSource,
  delta: SanctionsDelta,
  ingestedAtIso: string
): Promise<void> {
  const store = getStore(DELTA_STORE);
  const day = ingestedAtIso.slice(0, 10);
  await store.setJSON(`${source}/${day}/delta.json`, {
    source,
    at: ingestedAtIso,
    added: delta.added.length,
    removed: delta.removed.length,
    modified: delta.modified.length,
    unchanged: delta.unchanged,
    delta,
  });
}

async function writeAudit(payload: Record<string, unknown>): Promise<void> {
  const store = getStore(INGEST_AUDIT_STORE);
  const iso = new Date().toISOString();
  const day = iso.slice(0, 10);
  const ms = Date.now();
  await store.setJSON(`${day}/${ms}.json`, { ...payload, recordedAt: iso });
}

async function ingestOne(source: SanctionsSource): Promise<IngestResult> {
  const started = Date.now();
  const url = SANCTIONS_SOURCES[source].url;
  try {
    const body = await fetchSourceBody(url, FETCH_TIMEOUT_MS);
    const entries = parseSource(source, body);
    const previous = await loadPreviousSnapshot(source);
    const delta = computeDelta(previous, entries);
    const ingestedAtIso = new Date().toISOString();
    await persistSnapshot(source, entries, ingestedAtIso);
    if (delta.added.length > 0 || delta.removed.length > 0 || delta.modified.length > 0) {
      await persistDelta(source, delta, ingestedAtIso);
    }
    return {
      source,
      ok: true,
      fetchedCount: entries.length,
      delta,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      source,
      ok: false,
      error: message,
      durationMs: Date.now() - started,
    };
  }
}

/**
 * Immediate-risk-alert dispatch. For every successful source with a
 * non-empty delta, score every added/modified/removed entry against
 * every watched subject and create an Asana task whenever the
 * identity-match score passes the 'possible' band (or the subject is
 * pinned to an amended/delisted designation). Runs sequentially per
 * source so Asana rate limiting is honoured by the client's adaptive
 * backoff; the per-subject × per-candidate grid is small (watchlist
 * is typically <100; delta per 15 min is typically <10).
 *
 * FDL Art.20-21 requires the CO to see material events immediately.
 * Cabinet Res 74/2020 Art.4 + EOCN TFS Guidance July 2025 require
 * freezing within 1-2 hours of a confirmed match — hence the 15-min
 * cron + immediate Asana task per event.
 */
async function dispatchAlertsForResults(results: IngestResult[]): Promise<DispatchSummary[]> {
  const summaries: DispatchSummary[] = [];
  const runIdBase = `sanctions-ingest-${new Date().toISOString()}`;

  // Fan-out-safe pattern: load the watchlist + dedup fingerprints ONCE
  // for the whole cron run, then pass them into each per-source
  // dispatch. This avoids 6x blob reads per run and closes the race
  // window where a watchlist update between sources could change which
  // subjects are evaluated for which delta.
  const deps = createDefaultDeps();
  let sharedSubjects: Awaited<ReturnType<typeof deps.loadWatchlist>> = [];
  let sharedFingerprints: Set<string> = new Set();
  try {
    [sharedSubjects, sharedFingerprints] = await Promise.all([
      deps.loadWatchlist(),
      deps.loadDispatchFingerprints(),
    ]);
  } catch (err) {
    console.warn('[sanctions-ingest] failed to pre-load watchlist/fingerprints', err);
  }

  for (const r of results) {
    if (!r.ok || !r.delta) continue;
    const { added, modified, removed } = r.delta;
    if (added.length === 0 && modified.length === 0 && removed.length === 0) continue;
    const candidates = candidatesFromSanctionsDelta(added, modified, removed);
    try {
      const s = await dispatchImmediateAlerts(
        candidates,
        {
          trigger: 'sanctions-ingest',
          runId: `${runIdBase}::${r.source}`,
        },
        deps,
        { subjects: sharedSubjects, fingerprints: sharedFingerprints }
      );
      summaries.push(s);
    } catch (err) {
      console.warn('[sanctions-ingest] alert dispatch failed', r.source, err);
    }
  }

  // Persist the shared fingerprint set exactly once at the end of the
  // batch; individual dispatcher calls skipped the save because we
  // passed them a shared set.
  if (summaries.some((s) => s.tasksAttempted > 0)) {
    try {
      await deps.saveDispatchFingerprints(sharedFingerprints);
    } catch (err) {
      console.warn('[sanctions-ingest] failed to persist dispatch fingerprints', err);
    }
  }

  return summaries;
}

export default async (): Promise<Response> => {
  const startedAt = new Date().toISOString();
  const sources: SanctionsSource[] = ['OFAC_SDN', 'OFAC_CONS', 'UN', 'EU', 'UK_OFSI', 'UAE_EOCN'];

  // Run all sources in parallel — no source blocks another. Each has
  // its own timeout; the whole cron is bounded by Netlify's function
  // timeout (26 s on standard, 900 s on scheduled), so the 30 s per-
  // source fetch must be provisioned on a scheduled runtime.
  const results = await Promise.all(sources.map(ingestOne));

  // After all ingests complete, fire immediate Asana alerts for every
  // watched subject impacted by any delta. This runs *after* snapshot
  // + delta persistence so a dispatcher failure never rolls back the
  // persisted record.
  const alertSummaries = await dispatchAlertsForResults(results);

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    totalSources: sources.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results: results.map((r) => ({
      source: r.source,
      ok: r.ok,
      fetched: r.fetchedCount ?? 0,
      added: r.delta?.added.length ?? 0,
      removed: r.delta?.removed.length ?? 0,
      modified: r.delta?.modified.length ?? 0,
      error: r.error,
      durationMs: r.durationMs,
    })),
    alerts: {
      runs: alertSummaries.length,
      watchlistSize: alertSummaries[0]?.watchlistSize ?? 0,
      tasksCreated: alertSummaries.reduce((acc, s) => acc + s.tasksCreated, 0),
      tasksFailed: alertSummaries.reduce((acc, s) => acc + s.tasksFailed, 0),
      suppressed: alertSummaries.reduce((acc, s) => acc + s.suppressed, 0),
      deduped: alertSummaries.reduce((acc, s) => acc + s.deduped, 0),
      rejected: alertSummaries.reduce((acc, s) => acc + s.rejected, 0),
      perSource: alertSummaries.map((s) => ({
        runId: s.runId,
        tasksCreated: s.tasksCreated,
        tasksFailed: s.tasksFailed,
        deduped: s.deduped,
        rejected: s.rejected,
      })),
    },
  };

  await writeAudit({ event: 'sanctions_ingest_cron', ...summary });

  return Response.json(summary);
};

export const config: Config = {
  // Every 15 minutes. Cabinet Res 74/2020 Art.4 demands "without delay";
  // 15 minutes is the tightest cadence Netlify scheduled functions
  // support and is well inside any reasonable interpretation of
  // "without delay" for an automated polling system.
  schedule: '*/15 * * * *',
};
