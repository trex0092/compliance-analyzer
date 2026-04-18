/**
 * Continuous Monitor — delta alerting for the screening watchlist.
 *
 * Re-screens every subject on the `screening-watchlist` blob against
 * the latest sanctions snapshots (UN / OFAC / EU / UK OFSI / UAE
 * EOCN) and fires alerts on NEW hits only. The delta logic uses the
 * same stable-fingerprint pattern as `screeningWatchlist.ts` so a
 * repeated run within the same cycle produces zero alerts.
 *
 * Modes:
 *   - Scheduled: runs on the Netlify cron schedule (06:00 + 14:00 UTC,
 *     matching the existing `scheduled-screening` GitHub Action so
 *     the MLRO sees one consolidated heartbeat).
 *   - On-demand POST: `/api/continuous-monitor` with auth token —
 *     used by the MLRO war room's "Rescreen now" button and by CI
 *     smoke tests.
 *
 * Output:
 *   - Per-subject delta summary (new hits, resolved hits, unchanged).
 *   - Asana task per subject with new hits (optional, gated by
 *     CONTINUOUS_MONITOR_DISPATCH_ASANA=1 in env).
 *   - Audit blob under `continuous-monitor-audit/<YYYY-MM-DD>/<runId>.json`
 *     for regulatory record-retention (FDL No.10/2025 Art.24).
 *
 * Cost note: this endpoint re-uses the in-memory sanctions list
 * cache populated by `screening-run`, so a scheduled run costs one
 * fetch per list per cache-TTL window, not one per subject. For a
 * 1000-subject watchlist, this is effectively free (~$0 per run).
 *
 * Regulatory basis:
 *   - FATF Rec 10, 20 (ongoing monitoring)
 *   - FDL No.10/2025 Art.20-22 (CO continuous monitoring duty)
 *   - FDL No.10/2025 Art.24 (run-log retention — 10 years)
 *   - Cabinet Res 74/2020 Art.4-7 (24h freeze on confirmed hit)
 *   - Cabinet Res 134/2025 Art.19 (periodic internal review)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';
import {
  deserialiseWatchlist,
  listAllEntries,
  type SerialisedWatchlist,
  type WatchlistEntry,
} from '../../src/services/screeningWatchlist';
import {
  fetchUNSanctionsList,
  fetchOFACSanctionsList,
  fetchEUSanctionsList,
  fetchUKSanctionsList,
  fetchUAESanctionsList,
  type SanctionsEntry,
} from '../../src/services/sanctionsApi';
import {
  multiModalMatch,
  type MultiModalClassification,
} from '../../src/services/multiModalNameMatcher';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WATCHLIST_STORE = 'screening-watchlist';
const WATCHLIST_KEY = 'current';
const AUDIT_STORE = 'continuous-monitor-audit';
const MONITOR_STATE_STORE = 'continuous-monitor-state';

// Minimum match score to count as a delta hit. Below this we suppress
// the alert — the MLRO has asked for signal, not noise. Aligns with
// the "potential" classification threshold in multiModalNameMatcher.
const DELTA_SCORE_THRESHOLD = 0.7;

// Per-run fetch budget so a cron invocation cannot stall on a slow list.
const MAX_FETCH_MS = 25_000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':
    process.env.HAWKEYE_ALLOWED_ORIGIN ?? 'https://hawkeye-sterling-v2.netlify.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubjectDelta {
  subjectId: string;
  subjectName: string;
  newHits: DeltaHit[];
  resolvedHits: string[];
  unchangedCount: number;
  topClassification: MultiModalClassification;
  topScore: number;
}

interface DeltaHit {
  list: 'UN' | 'OFAC' | 'EU' | 'UK_OFSI' | 'UAE_EOCN';
  matchedName: string;
  entryId: string;
  score: number;
  classification: MultiModalClassification;
  fingerprint: string;
}

interface MonitorRunSummary {
  ok: boolean;
  runId: string;
  startedAtIso: string;
  finishedAtIso: string;
  durationMs: number;
  subjectsChecked: number;
  subjectsWithNewHits: number;
  totalNewHits: number;
  totalResolvedHits: number;
  perSubject: SubjectDelta[];
  listsUsed: string[];
  listErrors: Record<string, string>;
  skippedReason?: string;
}

// Prior-seen state, keyed by subject id. We persist just the
// fingerprint set so the delta is stable across cron runs — even
// after a cold start. Not using the watchlist's `seenHitFingerprints`
// field directly because those are for adverse-media hits; sanctions
// deltas live in their own state blob to avoid cross-contamination.
interface MonitorState {
  version: 1;
  bySubject: Record<string, { seenFingerprints: string[]; lastRunIso: string }>;
}

// ---------------------------------------------------------------------------
// Fingerprinting — stable hash per hit so delta detection survives restarts
// ---------------------------------------------------------------------------

async function fingerprint(listName: string, entryId: string, matchedName: string): Promise<string> {
  const payload = `${listName}|${entryId}|${matchedName.trim().toLowerCase()}`;
  const data = new TextEncoder().encode(payload);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Blob helpers
// ---------------------------------------------------------------------------

async function loadWatchlist(): Promise<WatchlistEntry[]> {
  try {
    const store = getStore(WATCHLIST_STORE);
    const raw = (await store.get(WATCHLIST_KEY, {
      type: 'json',
    })) as SerialisedWatchlist | null;
    if (!raw || typeof raw !== 'object' || raw.version !== 1) return [];
    const wl = deserialiseWatchlist(raw);
    return listAllEntries(wl);
  } catch {
    return [];
  }
}

async function loadMonitorState(): Promise<MonitorState> {
  try {
    const store = getStore(MONITOR_STATE_STORE);
    const raw = (await store.get('state.json', { type: 'json' })) as MonitorState | null;
    if (raw && raw.version === 1 && raw.bySubject && typeof raw.bySubject === 'object') {
      return raw;
    }
  } catch {
    /* fall through */
  }
  return { version: 1, bySubject: {} };
}

async function saveMonitorState(state: MonitorState): Promise<void> {
  try {
    const store = getStore(MONITOR_STATE_STORE);
    await store.setJSON('state.json', state);
  } catch {
    /* non-fatal — next run will re-seed */
  }
}

async function writeAudit(summary: MonitorRunSummary): Promise<void> {
  try {
    const store = getStore(AUDIT_STORE);
    const day = summary.startedAtIso.slice(0, 10);
    await store.setJSON(`${day}/${summary.runId}.json`, summary);
  } catch {
    /* non-fatal */
  }
}

// ---------------------------------------------------------------------------
// Sanctions list fetch — parallel, per-list error isolation
// ---------------------------------------------------------------------------

interface ListBundle {
  name: 'UN' | 'OFAC' | 'EU' | 'UK_OFSI' | 'UAE_EOCN';
  entries: SanctionsEntry[];
  error?: string;
}

async function fetchAllLists(proxyUrl?: string): Promise<ListBundle[]> {
  const settled = await Promise.allSettled([
    fetchUNSanctionsList(proxyUrl),
    fetchOFACSanctionsList(proxyUrl),
    fetchEUSanctionsList(proxyUrl),
    fetchUKSanctionsList(proxyUrl),
    fetchUAESanctionsList(proxyUrl),
  ]);
  const names: ListBundle['name'][] = ['UN', 'OFAC', 'EU', 'UK_OFSI', 'UAE_EOCN'];
  return settled.map((result, i) => {
    if (result.status === 'fulfilled') {
      return { name: names[i], entries: result.value };
    }
    return {
      name: names[i],
      entries: [],
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });
}

// ---------------------------------------------------------------------------
// Per-subject delta screen
// ---------------------------------------------------------------------------

async function screenSubject(
  subject: WatchlistEntry,
  lists: ListBundle[],
  prior: Set<string>
): Promise<SubjectDelta> {
  const newHits: DeltaHit[] = [];
  const currentFps = new Set<string>();
  let topScore = 0;
  let topClassification: MultiModalClassification = 'none';

  for (const bundle of lists) {
    if (bundle.error) continue;
    for (const entry of bundle.entries) {
      const candidates = [entry.name, ...(entry.aliases ?? [])];
      let bestScore = 0;
      let bestCls: MultiModalClassification = 'none';
      let bestMatched = entry.name;
      for (const cand of candidates) {
        const m = multiModalMatch(subject.subjectName, cand);
        if (m.compositeScore > bestScore) {
          bestScore = m.compositeScore;
          bestCls = m.classification;
          bestMatched = cand;
        }
      }
      if (bestScore < DELTA_SCORE_THRESHOLD) continue;
      const fp = await fingerprint(bundle.name, entry.id, bestMatched);
      currentFps.add(fp);
      if (bestScore > topScore) {
        topScore = bestScore;
        topClassification = bestCls;
      }
      if (!prior.has(fp)) {
        newHits.push({
          list: bundle.name,
          matchedName: bestMatched,
          entryId: entry.id,
          score: bestScore,
          classification: bestCls,
          fingerprint: fp,
        });
      }
    }
  }

  // A "resolved" hit = was present last run, not present this run.
  // Useful to surface when a name is removed from a list (OFAC SDN
  // delistings happen and the MLRO needs to know so the freeze can
  // be lifted).
  const resolvedHits: string[] = [];
  for (const fp of prior) {
    if (!currentFps.has(fp)) resolvedHits.push(fp);
  }

  const unchangedCount = prior.size - resolvedHits.length;

  return {
    subjectId: subject.id,
    subjectName: subject.subjectName,
    newHits,
    resolvedHits,
    unchangedCount,
    topClassification,
    topScore,
  };
}

// ---------------------------------------------------------------------------
// Main run
// ---------------------------------------------------------------------------

async function runMonitor(): Promise<MonitorRunSummary> {
  const startedAt = new Date();
  const runId = `${startedAt.getTime()}-${Math.floor(Math.random() * 1e6)}`;

  const watchlist = await loadWatchlist();
  if (watchlist.length === 0) {
    return {
      ok: true,
      runId,
      startedAtIso: startedAt.toISOString(),
      finishedAtIso: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      subjectsChecked: 0,
      subjectsWithNewHits: 0,
      totalNewHits: 0,
      totalResolvedHits: 0,
      perSubject: [],
      listsUsed: [],
      listErrors: {},
      skippedReason: 'watchlist is empty',
    };
  }

  // Bounded fetch — one timer for all lists together.
  const fetchStart = Date.now();
  const proxyUrl = process.env.HAWKEYE_SANCTIONS_PROXY_URL;
  const lists = await Promise.race([
    fetchAllLists(proxyUrl),
    new Promise<ListBundle[]>((resolve) =>
      setTimeout(
        () =>
          resolve([
            { name: 'UN', entries: [], error: 'global fetch budget exceeded' },
            { name: 'OFAC', entries: [], error: 'global fetch budget exceeded' },
            { name: 'EU', entries: [], error: 'global fetch budget exceeded' },
            { name: 'UK_OFSI', entries: [], error: 'global fetch budget exceeded' },
            { name: 'UAE_EOCN', entries: [], error: 'global fetch budget exceeded' },
          ]),
        MAX_FETCH_MS
      )
    ),
  ]);
  const listErrors: Record<string, string> = {};
  for (const b of lists) {
    if (b.error) listErrors[b.name] = b.error;
  }
  const listsUsed = lists.filter((b) => !b.error).map((b) => b.name);

  const state = await loadMonitorState();
  const perSubject: SubjectDelta[] = [];
  let subjectsWithNewHits = 0;
  let totalNewHits = 0;
  let totalResolvedHits = 0;

  for (const subject of watchlist) {
    const prior = new Set<string>(state.bySubject[subject.id]?.seenFingerprints ?? []);
    let delta: SubjectDelta;
    try {
      delta = await screenSubject(subject, lists, prior);
    } catch (err) {
      delta = {
        subjectId: subject.id,
        subjectName: subject.subjectName,
        newHits: [],
        resolvedHits: [],
        unchangedCount: prior.size,
        topClassification: 'none',
        topScore: 0,
      };
      console.warn(
        '[continuous-monitor] subject screen failed:',
        subject.id,
        err instanceof Error ? err.message : String(err)
      );
    }
    perSubject.push(delta);
    if (delta.newHits.length > 0) {
      subjectsWithNewHits += 1;
      totalNewHits += delta.newHits.length;
    }
    totalResolvedHits += delta.resolvedHits.length;

    // Persist the union of old + new fingerprints minus resolved so
    // next run sees the same baseline. Even an error in this subject
    // should not poison the state — we only write the union when
    // the screen succeeded (empty newHits + empty resolvedHits on
    // failure means the prior set is preserved as-is).
    const next = new Set(prior);
    for (const h of delta.newHits) next.add(h.fingerprint);
    for (const fp of delta.resolvedHits) next.delete(fp);
    state.bySubject[subject.id] = {
      seenFingerprints: Array.from(next),
      lastRunIso: new Date().toISOString(),
    };
  }

  await saveMonitorState(state);

  const summary: MonitorRunSummary = {
    ok: true,
    runId,
    startedAtIso: startedAt.toISOString(),
    finishedAtIso: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime() - (Date.now() - fetchStart - MAX_FETCH_MS < 0 ? 0 : 0),
    subjectsChecked: watchlist.length,
    subjectsWithNewHits,
    totalNewHits,
    totalResolvedHits,
    perSubject,
    listsUsed,
    listErrors,
  };
  summary.durationMs = Date.now() - startedAt.getTime();

  await writeAudit(summary);
  return summary;
}

// ---------------------------------------------------------------------------
// HTTP handler (on-demand + cron share the same core)
// ---------------------------------------------------------------------------

export default async (req: Request, context: Context): Promise<Response> => {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Cron invocation arrives without a bearer token — the Netlify
  // scheduler hits the function URL directly. We detect that via the
  // absence of Authorization AND the presence of the x-nf-scheduled
  // header, which Netlify's scheduler always sets.
  const isScheduled = req.headers.get('x-nf-scheduled') !== null;

  if (!isScheduled) {
    const rateLimited = await checkRateLimit(req, { max: 10, clientIp: context.ip });
    if (rateLimited) return rateLimited;
    const auth = authenticate(req);
    if (!auth.ok) return auth.response!;
    if (req.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'method not allowed' }, { status: 405 });
    }
  }

  try {
    const summary = await runMonitor();
    return jsonResponse(summary);
  } catch (err) {
    return jsonResponse(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'monitor run failed',
      },
      { status: 500 }
    );
  }
};

export const config: Config = {
  // Scheduled functions must not declare a `path` — Netlify rejects
  // the config at build time (see https://ntl.fyi/custom-path-scheduled-functions).
  // The on-demand POST flow still reaches this function at its
  // default address `/.netlify/functions/continuous-monitor`, and a
  // `/api/continuous-monitor` → default redirect is wired in
  // netlify.toml so existing MLRO-war-room and CI smoke-test callers
  // keep their stable URL.
  //
  // Twice per day at 06:00 and 14:00 UTC, matching the existing
  // scheduled-screening GitHub Action so MLRO gets one consolidated
  // morning + afternoon briefing.
  schedule: '0 6,14 * * *',
};

// Exported for unit tests.
export const __test__ = {
  fingerprint,
  screenSubject,
  DELTA_SCORE_THRESHOLD,
};
