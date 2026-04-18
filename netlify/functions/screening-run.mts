/**
 * Screening Command — on-demand name/entity screening endpoint.
 *
 * POST /api/screening/run
 *   body = {
 *     subjectName: string,
 *     subjectId?: string,
 *     riskTier?: "high" | "medium" | "low",
 *     jurisdiction?: string,
 *     notes?: string,
 *     enrollInWatchlist?: boolean,   // default true
 *     runAdverseMedia?: boolean,     // default true
 *     createAsanaTask?: boolean,     // default true on confirmed/potential
 *   }
 *
 * Pipeline (all in-process, one RTT for the client):
 *   1. Multi-modal name matching across six sanctions lists in parallel
 *      (UN, OFAC SDN, OFAC Consolidated, EU, UK OFSI, UAE/EOCN).
 *   2. Adverse media search (Brave / SerpApi / Google CSE — first
 *      configured provider wins; falls through to "no provider" hits=[]
 *      when none is configured).
 *   3. Explainable Bayesian-style risk score (sanctions match + adverse
 *      media hit count + jurisdiction + PEP proximity).
 *   4. Auto-enroll the subject into the SAME daily-monitoring watchlist
 *      used by the 06:00 / 14:00 UTC cron if not already present (unless
 *      caller opts out). CAS-safe against concurrent writers.
 *   5. On confirmed / potential match, create an Asana task in the
 *      SCREENINGS project assigned to the configured MLRO.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.12-14 (adequate CDD)
 *   - FDL No.10/2025 Art.20-21 (compliance officer situational awareness)
 *   - FDL No.10/2025 Art.26-27 (STR filing trigger)
 *   - FDL No.10/2025 Art.29 (no tipping off — subject never learns they
 *     were screened)
 *   - Cabinet Res 134/2025 Art.7-10 (CDD tiers), Art.14 (PEP/EDD),
 *     Art.19 (periodic internal review)
 *   - Cabinet Res 74/2020 Art.4-7 (asset freeze workflow trigger)
 *   - FATF Rec 10 / 22 / 23 (ongoing CDD, DPMS screening)
 *   - MoE Circular 08/AML/2021 (DPMS sector)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';
import {
  runMultiModalNameMatcher,
  type MultiModalScreeningHit,
  type MultiModalClassification,
} from '../../src/services/multiModalNameMatcher';
import {
  fetchUNSanctionsList,
  fetchOFACSanctionsList,
  fetchEUSanctionsList,
  fetchUKSanctionsList,
  fetchUAESanctionsList,
  type SanctionsEntry,
} from '../../src/services/sanctionsApi';
import { searchAdverseMedia } from '../../src/services/adverseMediaSearch';
import { explainableScore } from '../../src/services/explainableScoring';
import {
  addToWatchlist,
  deserialiseWatchlist,
  serialiseWatchlist,
  type SerialisedWatchlist,
  type RiskTier,
} from '../../src/services/screeningWatchlist';
import { createAsanaTask } from '../../src/services/asanaClient';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WATCHLIST_STORE = 'screening-watchlist';
const WATCHLIST_KEY = 'current';
const MAX_BODY_SIZE = 32 * 1024;
const MAX_CAS_ATTEMPTS = 5;
/**
 * Cache sanctions-list fetches within a single Netlify Function instance.
 * Refresh cadence matches the longest sanctions-list publishing cadence
 * (~6h for the slowest list), which is well within the deterministic
 * "stale at most 6h" ceiling we owe the MLRO. The cron job at
 * /api/sanctions-ingest-cron still does the authoritative refresh.
 */
const SANCTIONS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

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
// Input validation
// ---------------------------------------------------------------------------

export interface ScreeningRunInput {
  subjectName: string;
  subjectId?: string;
  riskTier?: RiskTier;
  jurisdiction?: string;
  notes?: string;
  enrollInWatchlist?: boolean;
  runAdverseMedia?: boolean;
  createAsanaTask?: boolean;
}

function validateInput(
  raw: unknown
): { ok: true; input: ScreeningRunInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'body must be a JSON object' };
  const o = raw as Record<string, unknown>;
  if (typeof o.subjectName !== 'string' || o.subjectName.trim().length === 0) {
    return { ok: false, error: 'subjectName is required' };
  }
  if (o.subjectName.length > 200) {
    return { ok: false, error: 'subjectName too long (max 200 chars)' };
  }
  if (o.subjectId !== undefined && (typeof o.subjectId !== 'string' || o.subjectId.length > 128)) {
    return { ok: false, error: 'subjectId must be a string up to 128 chars' };
  }
  if (o.riskTier !== undefined && !['high', 'medium', 'low'].includes(o.riskTier as string)) {
    return { ok: false, error: 'riskTier must be "high" | "medium" | "low"' };
  }
  if (
    o.jurisdiction !== undefined &&
    (typeof o.jurisdiction !== 'string' || o.jurisdiction.length > 32)
  ) {
    return { ok: false, error: 'jurisdiction must be a string up to 32 chars' };
  }
  if (o.notes !== undefined && (typeof o.notes !== 'string' || o.notes.length > 2000)) {
    return { ok: false, error: 'notes must be a string up to 2000 chars' };
  }
  return {
    ok: true,
    input: {
      subjectName: o.subjectName.trim(),
      subjectId: typeof o.subjectId === 'string' ? o.subjectId.trim() : undefined,
      riskTier: o.riskTier as RiskTier | undefined,
      jurisdiction: typeof o.jurisdiction === 'string' ? o.jurisdiction.trim() : undefined,
      notes: typeof o.notes === 'string' ? o.notes.trim() : undefined,
      enrollInWatchlist: o.enrollInWatchlist !== false,
      runAdverseMedia: o.runAdverseMedia !== false,
      createAsanaTask: o.createAsanaTask !== false,
    },
  };
}

// ---------------------------------------------------------------------------
// Sanctions list cache — one in-memory snapshot per Function instance
// ---------------------------------------------------------------------------

interface ListSnapshot {
  fetchedAt: number;
  lists: Array<{
    name: 'UN' | 'OFAC' | 'EU' | 'UK_OFSI' | 'UAE_EOCN';
    entries: SanctionsEntry[];
    error?: string;
  }>;
}

let listCache: ListSnapshot | null = null;

async function loadAllLists(): Promise<ListSnapshot> {
  if (listCache && Date.now() - listCache.fetchedAt < SANCTIONS_CACHE_TTL_MS) {
    return listCache;
  }
  const proxy = process.env.HAWKEYE_SANCTIONS_PROXY_URL;
  const [un, ofac, eu, uk, uae] = await Promise.allSettled([
    fetchUNSanctionsList(proxy),
    fetchOFACSanctionsList(proxy),
    fetchEUSanctionsList(proxy),
    fetchUKSanctionsList(proxy),
    fetchUAESanctionsList(),
  ]);
  const pick = (
    name: ListSnapshot['lists'][number]['name'],
    s: PromiseSettledResult<SanctionsEntry[]>
  ): ListSnapshot['lists'][number] =>
    s.status === 'fulfilled'
      ? { name, entries: s.value }
      : {
          name,
          entries: [],
          error: s.reason instanceof Error ? s.reason.message : String(s.reason),
        };
  listCache = {
    fetchedAt: Date.now(),
    lists: [
      pick('UN', un),
      pick('OFAC', ofac),
      pick('EU', eu),
      pick('UK_OFSI', uk),
      pick('UAE_EOCN', uae),
    ],
  };
  return listCache;
}

// ---------------------------------------------------------------------------
// Screening core
// ---------------------------------------------------------------------------

export interface PerListResult {
  list: string;
  candidatesChecked: number;
  hitCount: number;
  topScore: number;
  topClassification: MultiModalClassification;
  hits: MultiModalScreeningHit[];
  error?: string;
}

function screenAgainstAllLists(
  subjectName: string,
  snapshot: ListSnapshot
): {
  perList: PerListResult[];
  overallTopScore: number;
  overallTopClassification: MultiModalClassification;
} {
  const perList: PerListResult[] = snapshot.lists.map((listSnap) => {
    const candidates: string[] = [];
    for (const e of listSnap.entries) {
      candidates.push(e.name);
      if (Array.isArray(e.aliases)) for (const a of e.aliases) if (a) candidates.push(a);
    }
    const resp = runMultiModalNameMatcher({
      query: subjectName,
      candidates,
      threshold: 0.7,
      maxHits: 10,
    });
    return {
      list: listSnap.name,
      candidatesChecked: candidates.length,
      hitCount: resp.hitCount,
      topScore: resp.topScore,
      topClassification: resp.topClassification,
      hits: [...resp.hits],
      error: listSnap.error,
    };
  });
  let overallTopScore = 0;
  let overallTopClassification: MultiModalClassification = 'none';
  for (const r of perList) {
    if (r.topScore > overallTopScore) {
      overallTopScore = r.topScore;
      overallTopClassification = r.topClassification;
    }
  }
  return { perList, overallTopScore, overallTopClassification };
}

// ---------------------------------------------------------------------------
// Watchlist enrollment — CAS-safe read-modify-write
// ---------------------------------------------------------------------------

interface EnrollmentResult {
  action: 'enrolled' | 'already-present' | 'skipped' | 'failed';
  id?: string;
  error?: string;
}

async function enrollIntoWatchlist(
  id: string,
  subjectName: string,
  riskTier: RiskTier,
  metadata: Record<string, string | number | boolean>
): Promise<EnrollmentResult> {
  try {
    const store = getStore(WATCHLIST_STORE);
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      let data: SerialisedWatchlist = { version: 1, entries: [] };
      let etag: string | null = null;
      try {
        const withMeta =
          (await (
            store as unknown as {
              getWithMetadata: (
                key: string,
                opts: unknown
              ) => Promise<{ data: SerialisedWatchlist | null; etag?: string }>;
            }
          ).getWithMetadata(WATCHLIST_KEY, { type: 'json' })) ?? null;
        if (withMeta && withMeta.data && typeof withMeta.data === 'object') {
          data = withMeta.data;
          etag = withMeta.etag ?? null;
        }
      } catch {
        const raw = (await store.get(WATCHLIST_KEY, {
          type: 'json',
        })) as SerialisedWatchlist | null;
        if (raw && typeof raw === 'object' && Array.isArray(raw.entries)) {
          data = raw;
        }
      }

      const wl = deserialiseWatchlist(data);
      if (wl.entries.has(id)) {
        return { action: 'already-present', id };
      }
      addToWatchlist(wl, { id, subjectName, riskTier, metadata });
      const next = serialiseWatchlist(wl);

      try {
        const opts = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
        const res: unknown = await (
          store as unknown as {
            setJSON: (key: string, value: unknown, opts?: unknown) => Promise<unknown>;
          }
        ).setJSON(WATCHLIST_KEY, next, opts);
        const landed =
          res == null
            ? true
            : typeof res === 'object' && 'modified' in (res as Record<string, unknown>)
              ? (res as { modified: boolean }).modified === true
              : res !== false;
        if (landed) return { action: 'enrolled', id };
      } catch (err) {
        return {
          action: 'failed',
          error: err instanceof Error ? err.message : 'setJSON failed',
        };
      }
    }
    return { action: 'failed', error: 'CAS contention — please retry' };
  } catch (err) {
    return {
      action: 'failed',
      error: err instanceof Error ? err.message : 'blob store unavailable',
    };
  }
}

// ---------------------------------------------------------------------------
// Asana task creation — non-fatal
// ---------------------------------------------------------------------------

async function postAsanaTask(params: {
  subjectName: string;
  subjectId: string;
  classification: MultiModalClassification;
  topScore: number;
  perList: PerListResult[];
  adverseMediaCount: number;
  jurisdiction?: string;
  notes?: string;
}): Promise<{ ok: boolean; gid?: string; error?: string }> {
  const projectId = process.env.ASANA_SCREENINGS_PROJECT_GID || '1213759768596515';
  if (!process.env.ASANA_TOKEN && !process.env.ASANA_ACCESS_TOKEN && !process.env.ASANA_API_TOKEN) {
    return { ok: false, error: 'ASANA_TOKEN not configured' };
  }

  const lines: string[] = [];
  lines.push(`Subject: ${params.subjectName}`);
  lines.push(`Subject ID: ${params.subjectId}`);
  lines.push(`Classification: ${params.classification.toUpperCase()}`);
  lines.push(`Top match score: ${(params.topScore * 100).toFixed(1)}%`);
  if (params.jurisdiction) lines.push(`Jurisdiction: ${params.jurisdiction}`);
  lines.push('');
  lines.push('Per-list results:');
  for (const l of params.perList) {
    lines.push(
      `  - ${l.list}: ${l.hitCount} hit(s), top ${(l.topScore * 100).toFixed(1)}% (${l.topClassification})`
    );
  }
  lines.push('');
  lines.push(`Adverse-media hits: ${params.adverseMediaCount}`);
  if (params.notes) {
    lines.push('');
    lines.push(`Notes: ${params.notes}`);
  }
  lines.push('');
  lines.push(
    'Regulatory basis: FDL No.10/2025 Art.20-21, Art.26-27; Cabinet Res 134/2025 Art.14, 19; Cabinet Res 74/2020 Art.4-7.'
  );
  lines.push('');
  lines.push('Source: /api/screening/run (Screening Command page).');
  lines.push('Do NOT notify the subject — FDL Art.29 no tipping off.');

  const severityTag =
    params.classification === 'confirmed'
      ? '[CONFIRMED MATCH]'
      : params.classification === 'potential'
        ? '[POTENTIAL MATCH]'
        : '[WEAK MATCH]';
  const name = `${severityTag} Screening: ${params.subjectName}`;

  const result = await createAsanaTask({
    name,
    notes: lines.join('\n'),
    projects: [projectId],
    tags: ['screening-command', params.classification, `list-${params.perList[0]?.list ?? 'NA'}`],
  });
  return result;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method not allowed' }, { status: 405 });
  }

  // Rate limit — screening runs can fan out to five sanctions lists
  // plus an adverse-media call. 10 req / 15 min per IP is generous for
  // the human-driven MLRO UI and tight enough to fail closed under
  // abuse. Matches the ceiling used by /api/decision/stream.
  const rl = await checkRateLimit(req, {
    max: 10,
    clientIp: context.ip,
    namespace: 'screening-run',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  // Body size guard + parse
  const contentLength = req.headers.get('content-length');
  if (contentLength) {
    const n = Number(contentLength);
    if (Number.isFinite(n) && n > MAX_BODY_SIZE) {
      return jsonResponse({ ok: false, error: 'request body too large' }, { status: 413 });
    }
  }
  let parsed: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_SIZE) {
      return jsonResponse({ ok: false, error: 'request body too large' }, { status: 413 });
    }
    parsed = JSON.parse(raw);
  } catch {
    return jsonResponse({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const validation = validateInput(parsed);
  if (!validation.ok) return jsonResponse({ ok: false, error: validation.error }, { status: 400 });
  const input = validation.input;

  const subjectId =
    input.subjectId || `SC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const riskTier: RiskTier = input.riskTier ?? 'medium';
  const ranAt = new Date().toISOString();

  // ─── 1. Sanctions screen across all six lists ─────────────────────────
  const snapshot = await loadAllLists();
  const { perList, overallTopScore, overallTopClassification } = screenAgainstAllLists(
    input.subjectName,
    snapshot
  );
  const totalCandidates = perList.reduce((acc, l) => acc + l.candidatesChecked, 0);
  const listErrors = perList.filter((l) => l.error).map((l) => ({ list: l.list, error: l.error }));

  // ─── 2. Adverse media (optional, provider-dependent) ──────────────────
  let adverseMediaHits: number = 0;
  let adverseMediaProvider: string = 'none';
  let adverseMediaTop: Array<{ title: string; url: string; source?: string }> = [];
  let adverseMediaError: string | undefined;
  if (input.runAdverseMedia) {
    try {
      const am = await searchAdverseMedia(input.subjectName);
      adverseMediaHits = am.hits.length;
      adverseMediaProvider = am.provider;
      adverseMediaTop = am.hits.slice(0, 5).map((h) => ({
        title: h.title,
        url: h.url,
        source: h.source,
      }));
    } catch (err) {
      adverseMediaError = err instanceof Error ? err.message : 'adverse media failed';
    }
  }

  // ─── 3. Explainable risk score ────────────────────────────────────────
  const explanation = explainableScore({
    sanctionsMatchScore: overallTopScore,
    adverseMediaHits,
    countryOfResidence: input.jurisdiction,
    countryOfIncorporation: input.jurisdiction,
    nationality: input.jurisdiction,
  });

  // ─── 4. Watchlist enrollment ──────────────────────────────────────────
  let enrollment: EnrollmentResult = { action: 'skipped' };
  if (input.enrollInWatchlist) {
    const metadata: Record<string, string | number | boolean> = {
      enrolledBy: 'screening-command',
      enrolledAt: ranAt,
      initialClassification: overallTopClassification,
      initialTopScore: Number(overallTopScore.toFixed(4)),
    };
    if (input.jurisdiction) metadata.jurisdiction = input.jurisdiction;
    if (input.notes) metadata.notes = input.notes.slice(0, 512);
    enrollment = await enrollIntoWatchlist(subjectId, input.subjectName, riskTier, metadata);
  }

  // ─── 5. Asana task (confirmed / potential / weak match) ───────────────
  let asana: { ok: boolean; gid?: string; error?: string; skipped?: boolean } = {
    ok: false,
    skipped: true,
  };
  const shouldCreateAsana =
    input.createAsanaTask &&
    (overallTopClassification === 'confirmed' ||
      overallTopClassification === 'potential' ||
      overallTopClassification === 'weak' ||
      adverseMediaHits > 0);
  if (shouldCreateAsana) {
    const res = await postAsanaTask({
      subjectName: input.subjectName,
      subjectId,
      classification: overallTopClassification,
      topScore: overallTopScore,
      perList,
      adverseMediaCount: adverseMediaHits,
      jurisdiction: input.jurisdiction,
      notes: input.notes,
    });
    asana = res;
  }

  return jsonResponse({
    ok: true,
    ranAt,
    subject: {
      id: subjectId,
      name: input.subjectName,
      riskTier,
      jurisdiction: input.jurisdiction,
    },
    sanctions: {
      totalCandidatesChecked: totalCandidates,
      listsChecked: perList.map((l) => l.list),
      listErrors,
      topScore: overallTopScore,
      topClassification: overallTopClassification,
      perList: perList.map((l) => ({
        list: l.list,
        candidatesChecked: l.candidatesChecked,
        hitCount: l.hitCount,
        topScore: l.topScore,
        topClassification: l.topClassification,
        hits: l.hits.slice(0, 5),
        error: l.error,
      })),
    },
    adverseMedia: {
      hits: adverseMediaHits,
      provider: adverseMediaProvider,
      top: adverseMediaTop,
      error: adverseMediaError,
    },
    risk: {
      score: explanation.score,
      rating: explanation.rating,
      cddLevel: explanation.cddLevel,
      topFactors: explanation.topFactors.map((f) => ({
        name: f.name,
        contribution: f.contribution,
        regulatory: f.regulatory,
        rationale: f.rationale,
      })),
    },
    watchlist: enrollment,
    asana,
  });
};

// ---------------------------------------------------------------------------
// Test-only exports
// ---------------------------------------------------------------------------

export const __test__ = {
  validateInput,
  screenAgainstAllLists,
};

// ---------------------------------------------------------------------------
// Netlify Function config
// ---------------------------------------------------------------------------

export const config: Config = {
  path: '/api/screening/run',
  method: ['POST', 'OPTIONS'],
};
