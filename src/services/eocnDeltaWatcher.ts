/**
 * EOCN Delta Watcher — Tier D1.
 *
 * Pulls the UAE EOCN sanctions feed, diffs against the
 * last-seen snapshot, and emits a list of new / removed
 * designations. The cron that calls this module then fans
 * out a /screen run across every customer via the batch
 * dispatcher so new sanctions are caught within the hour.
 *
 * Pure diff logic + async fetch helper. The fetcher is
 * injected so tests can feed in canned feeds.
 *
 * Regulatory basis:
 *   - Cabinet Res 74/2020 Art.4-7 (24h freeze after confirmation)
 *   - Cabinet Res 156/2025 (PF + dual-use controls)
 *   - FDL No.10/2025 Art.35 (TFS compliance)
 */

import { fetchWithTimeout } from '../utils/fetchWithTimeout';

/**
 * 30s is the same budget the rest of the sanctions-ingest
 * fetchers use (`netlify/functions/sanctions-ingest-cron.mts`
 * and `src/services/sanctionsApi.ts`). EOCN feeds are CSV/JSON
 * blobs; if the feed host cannot answer in 30s the delta run is
 * better off failing loudly so the platform retries on the next
 * scheduled pass than silently exhausting the Netlify invocation.
 */
const EOCN_FETCH_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EocnDesignation {
  id: string;
  name: string;
  type: 'individual' | 'entity' | 'vessel' | 'unknown';
  listedAtIso?: string;
  citation?: string;
}

export interface EocnDelta {
  added: EocnDesignation[];
  removed: EocnDesignation[];
  unchanged: number;
  fetchedAtIso: string;
}

const SNAPSHOT_STORAGE_KEY = 'fgl_eocn_snapshot';

// ---------------------------------------------------------------------------
// Pure diff
// ---------------------------------------------------------------------------

/**
 * Compare a new list against a previous snapshot. Pure —
 * tests pass the snapshot in directly.
 */
export function diffEocnLists(
  previous: readonly EocnDesignation[],
  current: readonly EocnDesignation[]
): Omit<EocnDelta, 'fetchedAtIso'> {
  const prevIds = new Set(previous.map((d) => d.id));
  const currIds = new Set(current.map((d) => d.id));

  const added = current.filter((d) => !prevIds.has(d.id));
  const removed = previous.filter((d) => !currIds.has(d.id));
  const unchanged = current.length - added.length;

  return { added, removed, unchanged };
}

// ---------------------------------------------------------------------------
// Snapshot storage
// ---------------------------------------------------------------------------

export function loadSnapshot(): EocnDesignation[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EocnDesignation[]) : [];
  } catch {
    return [];
  }
}

export function saveSnapshot(current: readonly EocnDesignation[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* storage quota */
  }
}

// ---------------------------------------------------------------------------
// Fetcher (injected for tests)
// ---------------------------------------------------------------------------

export interface EocnFetchOptions {
  /** Injected fetcher — returns the current EOCN list. */
  fetcher?: () => Promise<EocnDesignation[]>;
  /** Injected "previous snapshot" source. */
  snapshotSource?: () => EocnDesignation[];
  /** Persist the new snapshot after a successful fetch. Default true. */
  persist?: boolean;
  /** ISO "now" for deterministic tests. */
  nowIso?: string;
}

async function defaultFetcher(): Promise<EocnDesignation[]> {
  // The real EOCN feed endpoint is configured per deployment.
  // This default uses the env var EOCN_FEED_URL and falls back
  // to an empty list when unconfigured — callers get zero
  // deltas instead of an error.
  const url =
    typeof process !== 'undefined' && process.env?.EOCN_FEED_URL
      ? process.env.EOCN_FEED_URL
      : undefined;
  if (!url) return [];
  const res = await fetchWithTimeout(url, { timeoutMs: EOCN_FETCH_TIMEOUT_MS });
  if (!res.ok) return [];
  const json = (await res.json()) as { designations?: EocnDesignation[] };
  return Array.isArray(json.designations) ? json.designations : [];
}

export async function watchEocnDelta(options: EocnFetchOptions = {}): Promise<EocnDelta> {
  const fetcher = options.fetcher ?? defaultFetcher;
  const snapshotSource = options.snapshotSource ?? loadSnapshot;
  const persist = options.persist ?? true;

  const current = await fetcher();
  const previous = snapshotSource();
  const diff = diffEocnLists(previous, current);

  if (persist && current.length > 0) saveSnapshot(current);

  return {
    ...diff,
    fetchedAtIso: options.nowIso ?? new Date().toISOString(),
  };
}
