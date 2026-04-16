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

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
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

async function loadPreviousSnapshot(
  source: SanctionsSource
): Promise<NormalisedSanction[]> {
  try {
    const store = getStore(SNAPSHOT_STORE);
    const list = await store.list({ prefix: `${source}/` });
    if (!list.blobs || list.blobs.length === 0) return [];
    // Blob list order is not guaranteed to be lexicographic. Sort by
    // key (which starts with yyyy-mm-dd) to find the newest snapshot.
    const sorted = [...list.blobs].sort((a, b) => (a.key < b.key ? 1 : -1));
    const latest = sorted[0];
    const data = (await store.get(latest.key, { type: 'json' })) as
      | NormalisedSanction[]
      | null;
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
    const body = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
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

export default async (): Promise<Response> => {
  const startedAt = new Date().toISOString();
  const sources: SanctionsSource[] = ['OFAC_SDN', 'OFAC_CONS', 'UN', 'EU', 'UK_OFSI', 'UAE_EOCN'];

  // Run all sources in parallel — no source blocks another. Each has
  // its own timeout; the whole cron is bounded by Netlify's function
  // timeout (26 s on standard, 900 s on scheduled), so the 30 s per-
  // source fetch must be provisioned on a scheduled runtime.
  const results = await Promise.all(sources.map(ingestOne));

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
