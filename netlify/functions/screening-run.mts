/**
 * Screening Command — on-demand name/entity screening endpoint.
 *
 * POST /api/screening/run
 *   body = {
 *     subjectName: string,
 *     subjectId?: string,
 *     entityType: "individual" | "legal_entity",
 *     dob?: string,                 // dd/mm/yyyy (date of birth or registration)
 *     country?: string,             // free text (e.g. "UAE", "Iran", "Russia")
 *     idNumber?: string,            // passport / Emirates ID / trade licence
 *     eventType: "new_customer_onboarding" | "periodic_review"
 *              | "transaction_trigger" | "name_change"
 *              | "adverse_media_hit" | "pep_change" | "ad_hoc",
 *     riskTier?: "high" | "medium" | "low",
 *     jurisdiction?: string,
 *     notes?: string,
 *     selectedLists?: string[],     // optional opt-in for enhanced lists
 *     enrollInWatchlist?: boolean,  // default true
 *     runAdverseMedia?: boolean,    // default true
 *     createAsanaTask?: boolean,    // default true on match / anomaly
 *   }
 *
 * List-selection rules (Cabinet Decision 74/2020 + EOCN guidance):
 *   - UAE_EOCN and UN are LEGALLY MANDATORY — always run, cannot be
 *     opted out.
 *   - OFAC, EU, UK_OFSI are "Enhanced Controls" — default on, caller
 *     may opt out by setting selectedLists.
 *   - INTERPOL Red Notices — placeholder entry (integration pending);
 *     selecting it surfaces a manual-verification notice in the
 *     per-list result.
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
  seedUaeSanctionsList,
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
import {
  runDeepBrain,
  type OrchestrationResult,
  type SearchFn,
  type SearchHit,
} from '../../src/services/brain';

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
/**
 * Per-stage timeout budgets. Netlify sync functions die at ~10s, so the
 * whole pipeline MUST finish inside that ceiling. Budgeting is coarse
 * but conservative: every slow external call gets its own cap and a
 * graceful fallback so a single hung list cannot 504 the whole run.
 * Sum of worst-case budgets ≈ 8s, leaving headroom for serialisation,
 * blob writes, and Asana. (FDL Art.20 — CO must still receive a
 * deterministic verdict even if an upstream list is slow.)
 */
/**
 * Per-stage timeout budgets. Tuned so that:
 *   Phase A (parallel):  max(sanctions, adverse media)  ≈ 5.5s
 *   Phase B (sync):      deep brain deadline            ≈ 2.5s
 *   Phase C (parallel):  max(watchlist, asana)          ≈ 1.5s
 *   TOTAL worst-case                                    ≈ 9.5s
 * Leaves ~0.5s headroom before Netlify's 10s sync-function ceiling.
 */
const SANCTIONS_FETCH_TIMEOUT_MS = 4_500;
const ADVERSE_MEDIA_TIMEOUT_MS = 3_500;
const DEEP_BRAIN_DEADLINE_MS = 2_500;
const ASANA_TIMEOUT_MS = 2_500;
const WATCHLIST_TIMEOUT_MS = 1_500;

/**
 * Race a promise against a timeout. On timeout, returns `fallback` and
 * lets the slow promise settle in the background — no unhandled
 * rejection, no client-visible error. Used to keep the screening
 * pipeline inside Netlify's 10s function budget.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
  label: string
): Promise<{ value: T; timedOut: boolean; error?: string }> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<{ __timeout: true }>((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ __timeout: true }), timeoutMs);
  });
  try {
    const raced = await Promise.race([
      promise.then((value) => ({ __timeout: false as const, value })),
      timeoutPromise,
    ]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if ('value' in raced) {
      return { value: raced.value, timedOut: false };
    }
    // Allow the slow promise to resolve/reject in the background; swallow
    // to prevent unhandled rejection warnings.
    promise.catch(() => {});
    return { value: fallback, timedOut: true, error: `${label} timed out after ${timeoutMs}ms` };
  } catch (err) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return {
      value: fallback,
      timedOut: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

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

export type EntityType = 'individual' | 'legal_entity';
export type ScreeningEventType =
  | 'new_customer_onboarding'
  | 'periodic_review'
  | 'transaction_trigger'
  | 'name_change'
  | 'adverse_media_hit'
  | 'pep_change'
  | 'ad_hoc';

const ENTITY_TYPES: readonly EntityType[] = ['individual', 'legal_entity'] as const;
const EVENT_TYPES: readonly ScreeningEventType[] = [
  'new_customer_onboarding',
  'periodic_review',
  'transaction_trigger',
  'name_change',
  'adverse_media_hit',
  'pep_change',
  'ad_hoc',
] as const;

/**
 * Lists the MLRO can opt into. UAE_EOCN and UN are legally mandatory
 * (Cabinet Decision 74/2020) and are always screened regardless of
 * this input. INTERPOL is a placeholder — integration pending.
 */
export type SelectableList = 'OFAC' | 'EU' | 'UK_OFSI' | 'INTERPOL';
const SELECTABLE_LISTS: readonly SelectableList[] = [
  'OFAC',
  'EU',
  'UK_OFSI',
  'INTERPOL',
] as const;

export interface ScreeningRunInput {
  subjectName: string;
  aliases?: string[];
  subjectId?: string;
  entityType: EntityType;
  dob?: string;
  country?: string;
  idNumber?: string;
  eventType: ScreeningEventType;
  riskTier?: RiskTier;
  jurisdiction?: string;
  notes?: string;
  selectedLists?: SelectableList[];
  enrollInWatchlist?: boolean;
  runAdverseMedia?: boolean;
  adverseMediaPredicates?: string[];
  createAsanaTask?: boolean;
  runDeepBrain?: boolean;
}

/**
 * Accepts dd/mm/yyyy (preferred, UAE convention) or ISO-ish
 * yyyy-mm-dd. Returns null if it cannot be parsed. We do not coerce
 * — bad formats are rejected so the MLRO sees the error immediately.
 */
function validateUaeDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const ddmmyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return trimmed;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    const [, yyyy, mm, dd] = iso;
    return `${dd}/${mm}/${yyyy}`;
  }
  return null;
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
  if (!ENTITY_TYPES.includes(o.entityType as EntityType)) {
    return { ok: false, error: 'entityType must be "individual" | "legal_entity"' };
  }
  if (!EVENT_TYPES.includes(o.eventType as ScreeningEventType)) {
    return {
      ok: false,
      error:
        'eventType must be one of: ' +
        EVENT_TYPES.join(', ') +
        ' (see Cabinet Res 134/2025 Art.19 periodic-review trigger taxonomy)',
    };
  }
  let dob: string | undefined;
  if (o.dob !== undefined) {
    if (typeof o.dob !== 'string' || o.dob.length > 20) {
      return { ok: false, error: 'dob must be a string up to 20 chars (dd/mm/yyyy preferred)' };
    }
    if (o.dob.trim().length > 0) {
      const parsed = validateUaeDate(o.dob);
      if (!parsed) return { ok: false, error: 'dob must be dd/mm/yyyy or yyyy-mm-dd' };
      dob = parsed;
    }
  }
  if (o.country !== undefined && (typeof o.country !== 'string' || o.country.length > 64)) {
    return { ok: false, error: 'country must be a string up to 64 chars' };
  }
  if (o.idNumber !== undefined && (typeof o.idNumber !== 'string' || o.idNumber.length > 64)) {
    return { ok: false, error: 'idNumber must be a string up to 64 chars' };
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
  let selectedLists: SelectableList[] | undefined;
  if (o.selectedLists !== undefined) {
    if (!Array.isArray(o.selectedLists)) {
      return { ok: false, error: 'selectedLists must be an array of list codes' };
    }
    const invalid = (o.selectedLists as unknown[]).filter(
      (x) => typeof x !== 'string' || !SELECTABLE_LISTS.includes(x as SelectableList)
    );
    if (invalid.length > 0) {
      return {
        ok: false,
        error: 'selectedLists contains invalid codes; allowed: ' + SELECTABLE_LISTS.join(', '),
      };
    }
    selectedLists = Array.from(new Set(o.selectedLists as SelectableList[]));
  }

  let aliases: string[] | undefined;
  if (o.aliases !== undefined) {
    if (!Array.isArray(o.aliases)) {
      return { ok: false, error: 'aliases must be an array of strings' };
    }
    if ((o.aliases as unknown[]).length > 20) {
      return { ok: false, error: 'aliases cannot exceed 20 entries' };
    }
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const a of o.aliases as unknown[]) {
      if (typeof a !== 'string') {
        return { ok: false, error: 'aliases entries must be strings' };
      }
      const t = a.trim();
      if (t.length === 0) continue;
      if (t.length > 200) {
        return { ok: false, error: 'alias too long (max 200 chars per entry)' };
      }
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push(t);
    }
    if (cleaned.length > 0) aliases = cleaned;
  }

  let adverseMediaPredicates: string[] | undefined;
  if (o.adverseMediaPredicates !== undefined) {
    if (!Array.isArray(o.adverseMediaPredicates)) {
      return { ok: false, error: 'adverseMediaPredicates must be an array of strings' };
    }
    if ((o.adverseMediaPredicates as unknown[]).length > 64) {
      return { ok: false, error: 'adverseMediaPredicates cannot exceed 64 entries' };
    }
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const p of o.adverseMediaPredicates as unknown[]) {
      if (typeof p !== 'string') {
        return { ok: false, error: 'adverseMediaPredicates entries must be strings' };
      }
      const t = p.trim();
      if (t.length === 0) continue;
      if (t.length > 64) {
        return { ok: false, error: 'adverseMediaPredicates entry too long (max 64 chars)' };
      }
      if (seen.has(t)) continue;
      seen.add(t);
      cleaned.push(t);
    }
    if (cleaned.length > 0) adverseMediaPredicates = cleaned;
  }

  return {
    ok: true,
    input: {
      subjectName: o.subjectName.trim(),
      aliases,
      subjectId: typeof o.subjectId === 'string' ? o.subjectId.trim() : undefined,
      entityType: o.entityType as EntityType,
      dob,
      country: typeof o.country === 'string' ? o.country.trim() : undefined,
      idNumber: typeof o.idNumber === 'string' ? o.idNumber.trim() : undefined,
      eventType: o.eventType as ScreeningEventType,
      riskTier: o.riskTier as RiskTier | undefined,
      jurisdiction: typeof o.jurisdiction === 'string' ? o.jurisdiction.trim() : undefined,
      notes: typeof o.notes === 'string' ? o.notes.trim() : undefined,
      selectedLists,
      enrollInWatchlist: o.enrollInWatchlist !== false,
      runAdverseMedia: o.runAdverseMedia !== false,
      adverseMediaPredicates,
      createAsanaTask: o.createAsanaTask !== false,
      runDeepBrain: o.runDeepBrain === true,
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
let uaeSeedAttemptedAt = 0;

/**
 * Hydrate the in-process UAE / EOCN sanctions cache from the
 * `sanctions-snapshots` Netlify Blob store. The store is populated by
 * `/api/sanctions/eocn-upload` (manual MoE circular ingest) under keys
 * of the form `UAE_EOCN/<YYYY-MM-DD>/snapshot.json`. Without this
 * hydration, `fetchUAESanctionsList()` throws and every screening
 * surfaces "UAE EOCN sanctions cache is empty", failing the Cabinet
 * Res 74/2020 Art.4 mandatory-coverage gate even when the MLRO has
 * already uploaded today's designations.
 *
 * Strategy: list keys under `UAE_EOCN/`, pick the lexicographically
 * greatest (= most recent ISO date), read it, map NormalisedSanctionLike
 * → SanctionsEntry, and call `seedUaeSanctionsList`. Silent on any
 * failure — the caller still throws with the existing diagnostic if no
 * snapshot is available, which is the correct Art.35 signal.
 */
async function hydrateUaeSanctionsFromBlob(): Promise<void> {
  const now = Date.now();
  if (now - uaeSeedAttemptedAt < SANCTIONS_CACHE_TTL_MS) return;
  uaeSeedAttemptedAt = now;
  try {
    const store = getStore('sanctions-snapshots');
    const listing = await store.list({ prefix: 'UAE_EOCN/' });
    const keys = (listing.blobs ?? [])
      .map((b) => b.key)
      .filter((k): k is string => typeof k === 'string' && k.endsWith('/snapshot.json'))
      .sort();
    const latest = keys[keys.length - 1];
    if (!latest) return;
    const raw = await store.get(latest, { type: 'json' });
    if (!Array.isArray(raw)) return;
    const entries = raw
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map((e) => {
        const type = e.type === 'individual' || e.type === 'entity' ? e.type : 'entity';
        const aliases = Array.isArray(e.aliases)
          ? (e.aliases as unknown[]).filter((a): a is string => typeof a === 'string')
          : [];
        return {
          id: typeof e.sourceId === 'string' ? e.sourceId : undefined,
          name: typeof e.primaryName === 'string' ? e.primaryName : '',
          aliases,
          type: type as 'individual' | 'entity',
          nationality: typeof e.nationality === 'string' ? e.nationality : undefined,
          listDate: typeof e.listDate === 'string' ? e.listDate : undefined,
          designationRef: typeof e.sourceId === 'string' ? e.sourceId : undefined,
        };
      })
      .filter((e) => e.name.length > 0);
    if (entries.length > 0) seedUaeSanctionsList(entries);
  } catch {
    // Silent — the Art.35 gate in fetchUAESanctionsList still fires.
  }
}

async function loadAllLists(): Promise<ListSnapshot> {
  if (listCache && Date.now() - listCache.fetchedAt < SANCTIONS_CACHE_TTL_MS) {
    return listCache;
  }
  await hydrateUaeSanctionsFromBlob();
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

/**
 * Names of the lists the caller is permitted to opt OUT of. UAE_EOCN
 * and UN never appear here because they are legally mandatory under
 * Cabinet Decision 74/2020.
 */
const MANDATORY_LISTS: ReadonlySet<string> = new Set(['UAE_EOCN', 'UN']);

function screenAgainstAllLists(
  subjectName: string,
  snapshot: ListSnapshot,
  selectedLists?: SelectableList[],
  aliases?: string[]
): {
  perList: PerListResult[];
  overallTopScore: number;
  overallTopClassification: MultiModalClassification;
} {
  // When selectedLists is omitted, enhanced lists default to on (back-compat
  // with the v1 behaviour). When present, only the named enhanced lists
  // run; mandatory lists ALWAYS run regardless.
  const runEnhanced = (name: string): boolean => {
    if (MANDATORY_LISTS.has(name)) return true;
    if (!selectedLists) return true;
    return (selectedLists as string[]).includes(name);
  };

  const perList: PerListResult[] = [];

  for (const listSnap of snapshot.lists) {
    if (!runEnhanced(listSnap.name)) {
      perList.push({
        list: listSnap.name,
        candidatesChecked: 0,
        hitCount: 0,
        topScore: 0,
        topClassification: 'none',
        hits: [],
        error: 'opted out by MLRO (enhanced control)',
      });
      continue;
    }

    const candidates: string[] = [];
    for (const e of listSnap.entries) {
      candidates.push(e.name);
      if (Array.isArray(e.aliases)) for (const a of e.aliases) if (a) candidates.push(a);
    }
    const queries = [subjectName, ...(aliases || [])];
    let best = runMultiModalNameMatcher({
      query: queries[0],
      candidates,
      threshold: 0.7,
      maxHits: 10,
    });
    for (let i = 1; i < queries.length; i++) {
      const r = runMultiModalNameMatcher({
        query: queries[i],
        candidates,
        threshold: 0.7,
        maxHits: 10,
      });
      if (r.topScore > best.topScore) best = r;
    }
    perList.push({
      list: listSnap.name,
      candidatesChecked: candidates.length,
      hitCount: best.hitCount,
      topScore: best.topScore,
      topClassification: best.topClassification,
      hits: [...best.hits],
      error: listSnap.error,
    });
  }

  // Interpol Red Notices — placeholder. We expose the list in the
  // per-list output with an actionable error so MLROs know they must
  // manually check interpol.int/wanted until we finish the integration.
  const interpolSelected = !selectedLists || (selectedLists as string[]).includes('INTERPOL');
  if (interpolSelected) {
    perList.push({
      list: 'INTERPOL',
      candidatesChecked: 0,
      hitCount: 0,
      topScore: 0,
      topClassification: 'none',
      hits: [],
      error:
        'Integration pending — manual verification required via www.interpol.int/wanted (EOCN guidance)',
    });
  }

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
          res === null || res === undefined
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
  adverseMediaProvidersUsed?: string[];
  adverseMediaProviderLabel?: string;
  adverseMediaTop?: Array<{ title: string; url: string; source?: string }>;
  jurisdiction?: string;
  notes?: string;
  anomalies?: string[];
  eventType?: ScreeningEventType;
  integrity?: 'complete' | 'degraded' | 'incomplete';
  integrityReasons?: string[];
}): Promise<{ ok: boolean; gid?: string; error?: string }> {
  const projectId = process.env.ASANA_SCREENINGS_PROJECT_GID || '1213759768596515';
  if (!process.env.ASANA_TOKEN && !process.env.ASANA_ACCESS_TOKEN && !process.env.ASANA_API_TOKEN) {
    return { ok: false, error: 'ASANA_TOKEN not configured' };
  }

  const lines: string[] = [];
  lines.push(`Subject: ${params.subjectName}`);
  lines.push(`Subject ID: ${params.subjectId}`);
  if (params.eventType) lines.push(`Event type: ${params.eventType}`);
  lines.push(`Classification: ${params.classification.toUpperCase()}`);
  lines.push(`Top match score: ${(params.topScore * 100).toFixed(1)}%`);
  lines.push(`Screening integrity: ${(params.integrity ?? 'complete').toUpperCase()}`);
  if (params.jurisdiction) lines.push(`Jurisdiction: ${params.jurisdiction}`);
  lines.push('');
  lines.push('Per-list results:');
  for (const l of params.perList) {
    lines.push(
      `  - ${l.list}: ${l.hitCount} hit(s), top ${(l.topScore * 100).toFixed(1)}% (${l.topClassification})${
        l.error ? ` — ${l.error}` : ''
      }`
    );
  }
  lines.push('');
  lines.push(`Adverse-media hits: ${params.adverseMediaCount}`);
  if (params.adverseMediaProviderLabel) {
    lines.push(`Adverse-media provider(s): ${params.adverseMediaProviderLabel}`);
  }
  if (params.adverseMediaTop && params.adverseMediaTop.length > 0) {
    lines.push('Top adverse-media hits:');
    for (const h of params.adverseMediaTop) {
      lines.push(`  - ${h.title}${h.source ? ` (${h.source})` : ''} — ${h.url}`);
    }
  }
  if (params.anomalies && params.anomalies.length > 0) {
    lines.push('');
    lines.push('ANOMALIES DETECTED — investigate immediately:');
    for (const a of params.anomalies) lines.push(`  - ${a}`);
  }
  if (
    params.integrity &&
    params.integrity !== 'complete' &&
    params.integrityReasons &&
    params.integrityReasons.length > 0
  ) {
    lines.push('');
    lines.push(
      params.integrity === 'incomplete'
        ? 'SCREENING INCOMPLETE — RE-SCREEN REQUIRED (mandatory data source unavailable):'
        : 'SCREENING DEGRADED — partial coverage only:'
    );
    for (const r of params.integrityReasons) lines.push(`  - ${r}`);
  }
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

  // Severity tag ordering: integrity-gated. When data is incomplete or
  // degraded, the outcome CANNOT be recorded as clean — it must force
  // a re-screen. Regulatory basis: FDL Art.20-21 (CO must actually have
  // screened before recording a no-freeze outcome), Cabinet Res 74/2020
  // Art.4-7 (sanctions screening must occur, not be inferred from a
  // failed fetch). Order: incomplete > anomaly > confirmed > potential
  // > weak > degraded > adverse media > clean.
  const hasAnomaly = params.anomalies && params.anomalies.length > 0;
  const integrity = params.integrity ?? 'complete';
  const severityTag =
    integrity === 'incomplete'
      ? '[INCOMPLETE — RE-SCREEN REQUIRED]'
      : hasAnomaly && params.classification === 'none'
        ? '[ANOMALY]'
        : params.classification === 'confirmed'
          ? '[CONFIRMED MATCH]'
          : params.classification === 'potential'
            ? '[POTENTIAL MATCH]'
            : params.classification === 'weak'
              ? '[WEAK MATCH]'
              : integrity === 'degraded' && params.classification === 'none'
                ? '[DEGRADED — PARTIAL DATA]'
                : params.adverseMediaCount > 0
                  ? '[ADVERSE MEDIA]'
                  : '[CLEAN]';
  const name = `${severityTag} Screening: ${params.subjectName}`;

  const tags = ['screening-command', params.classification];
  if (hasAnomaly) tags.push('anomaly');
  if (integrity === 'incomplete') tags.push('integrity-incomplete', 're-screen-required');
  else if (integrity === 'degraded') tags.push('integrity-degraded');
  if (
    integrity === 'complete' &&
    params.classification === 'none' &&
    !hasAnomaly &&
    params.adverseMediaCount === 0
  ) {
    tags.push('clean-screen');
  }
  if (params.eventType) tags.push(`event-${params.eventType}`);

  const result = await createAsanaTask({
    name,
    notes: lines.join('\n'),
    projects: [projectId],
    tags,
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

  // ─── Phase A. Sanctions + adverse-media in parallel ──────────────────
  // The legacy pipeline ran these serially — 4s sanctions + 3s adverse
  // media blew past Netlify's 10s function ceiling when stacked with
  // the brain, watchlist, and Asana stages. Running them as a racing
  // pair caps the phase at max(sanctions, adverse) instead of their sum.
  // FDL Art.20 still requires a deterministic verdict inside the budget.
  const sanctionsTimeoutSnapshot: ListSnapshot = {
    fetchedAt: Date.now(),
    lists: [
      { name: 'UN', entries: [], error: 'sanctions fetch timed out' },
      { name: 'OFAC', entries: [], error: 'sanctions fetch timed out' },
      { name: 'EU', entries: [], error: 'sanctions fetch timed out' },
      { name: 'UK_OFSI', entries: [], error: 'sanctions fetch timed out' },
      { name: 'UAE_EOCN', entries: [], error: 'sanctions fetch timed out' },
    ],
  };
  const amFallback = {
    subject: input.subjectName,
    query: '',
    provider: 'none',
    providersUsed: [] as string[],
    hits: [] as Array<{
      title: string;
      url: string;
      snippet: string;
      source: string;
      publishedAt?: string;
    }>,
    totalResults: 0,
    searchedAt: ranAt,
  };
  const [sanctionsLoad, amRes] = await Promise.all([
    withTimeout(loadAllLists(), SANCTIONS_FETCH_TIMEOUT_MS, sanctionsTimeoutSnapshot, 'sanctions-lists'),
    input.runAdverseMedia
      ? withTimeout(
          searchAdverseMedia(input.subjectName),
          ADVERSE_MEDIA_TIMEOUT_MS,
          amFallback,
          'adverse-media'
        )
      : Promise.resolve({ value: amFallback, timedOut: false, error: undefined as string | undefined }),
  ]);

  const snapshot = sanctionsLoad.value;
  const { perList, overallTopScore, overallTopClassification } = screenAgainstAllLists(
    input.subjectName,
    snapshot,
    input.selectedLists,
    input.aliases
  );
  const totalCandidates = perList.reduce((acc, l) => acc + l.candidatesChecked, 0);
  const listErrors = perList.filter((l) => l.error).map((l) => ({ list: l.list, error: l.error }));
  // Distinguish "integration / fetch failure on a mandatory list" —
  // a real anomaly that the MLRO needs paged on — from the benign
  // "opted out by MLRO" or the expected Interpol-manual-check notice.
  const anomalousListErrors = perList.filter(
    (l) =>
      l.error &&
      l.list !== 'INTERPOL' &&
      l.error !== 'opted out by MLRO (enhanced control)' &&
      !/^Integration pending/i.test(l.error)
  );

  const adverseMediaHits = input.runAdverseMedia ? amRes.value.hits.length : 0;
  const adverseMediaProvider = input.runAdverseMedia ? amRes.value.provider : 'disabled';
  const adverseMediaProvidersUsed = input.runAdverseMedia ? amRes.value.providersUsed ?? [] : [];
  const adverseMediaTop = input.runAdverseMedia
    ? amRes.value.hits.slice(0, 5).map((h) => ({
        title: h.title,
        url: h.url,
        source: h.source,
      }))
    : [];
  const adverseMediaError: string | undefined = input.runAdverseMedia
    ? amRes.timedOut
      ? 'adverse media timed out'
      : amRes.error
    : undefined;

  // ─── Integrity gate — NEVER report clean when the screening was
  // actually incomplete. Regulatory basis: FDL Art.20-21 (CO situational
  // awareness), FATF Rec 10 (ongoing CDD), Cabinet Res 74/2020 Art.4-7
  // (sanctions screening must actually occur before a "no freeze"
  // outcome is recorded). A silent "none/0.0%" on a timed-out fetch is
  // a false negative and is strictly forbidden.
  const MANDATORY_LIST_NAMES = new Set(['UN', 'UAE_EOCN']);
  const mandatoryFailures = perList.filter(
    (l) => MANDATORY_LIST_NAMES.has(l.list) && typeof l.error === 'string' && l.error.length > 0
  );
  const nonMandatoryFailures = perList.filter(
    (l) =>
      typeof l.error === 'string' &&
      l.error.length > 0 &&
      !MANDATORY_LIST_NAMES.has(l.list) &&
      l.list !== 'INTERPOL' &&
      l.error !== 'opted out by MLRO (enhanced control)' &&
      !/^Integration pending/i.test(l.error)
  );
  const amProviderMissing =
    input.runAdverseMedia &&
    (adverseMediaProvidersUsed.length === 0 ||
      (adverseMediaProvidersUsed.length === 1 &&
        (adverseMediaProvidersUsed[0] === 'dry_run' || adverseMediaProvider === 'dry_run')));
  const amFailed = Boolean(adverseMediaError);
  const screeningIntegrity: 'complete' | 'degraded' | 'incomplete' =
    mandatoryFailures.length > 0
      ? 'incomplete'
      : nonMandatoryFailures.length > 0 || amFailed || amProviderMissing
        ? 'degraded'
        : 'complete';
  const integrityReasons: string[] = [];
  if (mandatoryFailures.length > 0) {
    for (const f of mandatoryFailures) integrityReasons.push(`${f.list}: ${f.error}`);
  }
  if (nonMandatoryFailures.length > 0) {
    for (const f of nonMandatoryFailures) integrityReasons.push(`${f.list}: ${f.error}`);
  }
  if (amFailed) integrityReasons.push(`adverse media: ${adverseMediaError}`);
  if (amProviderMissing)
    integrityReasons.push(
      'adverse media: no search provider configured (set SERPAPI_KEY, BRAVE_SEARCH_API_KEY, BING_SEARCH_API_KEY, or GOOGLE_CSE_KEY+CX)'
    );

  // ─── 3. Explainable risk score ────────────────────────────────────────
  const explanation = explainableScore({
    sanctionsMatchScore: overallTopScore,
    adverseMediaHits,
    countryOfResidence: input.jurisdiction,
    countryOfIncorporation: input.jurisdiction,
    nationality: input.jurisdiction,
  });

  // ─── Phase B. Deep brain — three-layer PEER reasoning ────────────────
  // Runs whenever classical signal fires OR integrity is degraded/
  // incomplete (so the MLRO still gets a reasoned narrative even when
  // an upstream was missing). Extra cost is bounded by DEEP_BRAIN_DEADLINE_MS.
  const deepBrainEnabled =
    overallTopClassification !== 'none' ||
    adverseMediaHits > 0 ||
    screeningIntegrity !== 'complete' ||
    input.runDeepBrain === true;
  let deepBrain: OrchestrationResult | null = null;
  if (deepBrainEnabled) {
    const atomHits: SearchHit[] = [];
    for (const l of perList) {
      for (const h of l.hits) {
        atomHits.push({
          fact: `${l.list} candidate ${h.name} (score ${h.score.toFixed(2)}, ${h.classification})`,
          source: `${l.list}_${ranAt.slice(0, 10)}`,
          sourceTimestamp: ranAt,
          confidence: h.score,
        });
      }
    }
    for (const am of adverseMediaTop) {
      atomHits.push({
        fact: `adverse media: ${am.title}`,
        source: `ADVERSE_MEDIA_${am.source ?? 'unknown'}`,
        sourceTimestamp: ranAt,
        confidence: 0.7,
      });
    }
    // Surface integrity as an explicit brain fact so the reasoning chain
    // accounts for "absence of evidence vs evidence of absence". Without
    // this, a timed-out fetch would silently yield a clean posterior.
    if (screeningIntegrity !== 'complete') {
      for (const reason of integrityReasons) {
        atomHits.push({
          fact: `screening integrity ${screeningIntegrity}: ${reason}`,
          source: `INTEGRITY_${screeningIntegrity.toUpperCase()}`,
          sourceTimestamp: ranAt,
          confidence: 0.9,
        });
      }
    }
    const precomputedSearch: SearchFn = (q) => {
      if (q.id === 'q-sanctions') {
        return atomHits.filter((a) => /UN|OFAC|EU|UK_OFSI|UAE_EOCN|INTERPOL/i.test(a.source));
      }
      if (q.id === 'q-adverse') {
        return atomHits.filter((a) => a.source.startsWith('ADVERSE_MEDIA'));
      }
      if (q.id === 'q-integrity') {
        return atomHits.filter((a) => a.source.startsWith('INTEGRITY_'));
      }
      return [];
    };
    try {
      deepBrain = await runDeepBrain(
        {
          name: input.subjectName,
          aliases: input.aliases,
          jurisdiction: input.jurisdiction,
          entityType: input.entityType === 'legal_entity' ? 'entity' : 'individual',
          dob: input.dob,
          notes: input.notes,
        },
        { searchFn: precomputedSearch, deadlineMs: DEEP_BRAIN_DEADLINE_MS }
      );
    } catch {
      deepBrain = null;
    }
  }

  // ─── Phase C. Watchlist + Asana in parallel ─────────────────────────
  // FDL Art.24 10-yr retention: every screening lands in Asana even on
  // a clean run. Cabinet Res 134/2025 Art.19: periodic internal review
  // sees every event. Running the two writes in parallel shaves ~1.5s
  // off the tail of the pipeline.
  const asanaProjectGid = process.env.ASANA_SCREENINGS_PROJECT_GID || '1213759768596515';
  const asanaAnomalies = [
    ...anomalousListErrors.map((l) => `${l.list}: ${l.error}`),
    ...(screeningIntegrity !== 'complete'
      ? integrityReasons.map((r) => `integrity-${screeningIntegrity}: ${r}`)
      : []),
  ];

  const [watchlistRes, asanaRes] = await Promise.all([
    input.enrollInWatchlist
      ? (async () => {
          const metadata: Record<string, string | number | boolean> = {
            enrolledBy: 'screening-command',
            enrolledAt: ranAt,
            initialClassification: overallTopClassification,
            initialTopScore: Number(overallTopScore.toFixed(4)),
            screeningIntegrity,
          };
          if (input.jurisdiction) metadata.jurisdiction = input.jurisdiction;
          if (input.notes) metadata.notes = input.notes.slice(0, 512);
          return withTimeout(
            enrollIntoWatchlist(subjectId, input.subjectName, riskTier, metadata),
            WATCHLIST_TIMEOUT_MS,
            { action: 'skipped', error: 'watchlist enrollment timed out' } as EnrollmentResult,
            'watchlist-enroll'
          );
        })()
      : Promise.resolve({
          value: { action: 'skipped' } as EnrollmentResult,
          timedOut: false,
          error: undefined as string | undefined,
        }),
    input.createAsanaTask
      ? withTimeout(
          postAsanaTask({
            subjectName: input.subjectName,
            subjectId,
            classification: overallTopClassification,
            topScore: overallTopScore,
            perList,
            adverseMediaCount: adverseMediaHits,
            adverseMediaProvidersUsed,
            adverseMediaProviderLabel: adverseMediaProvider,
            adverseMediaTop,
            jurisdiction: input.jurisdiction,
            notes: input.notes,
            anomalies: asanaAnomalies,
            eventType: input.eventType,
            integrity: screeningIntegrity,
            integrityReasons,
          }),
          ASANA_TIMEOUT_MS,
          { ok: false, error: 'asana task timed out' },
          'asana-task'
        )
      : Promise.resolve({
          value: { ok: false, error: 'asana disabled' } as {
            ok: boolean;
            gid?: string;
            error?: string;
          },
          timedOut: false,
          error: undefined as string | undefined,
        }),
  ]);

  const enrollment = watchlistRes.value;
  const asana: {
    ok: boolean;
    gid?: string;
    error?: string;
    skipped?: boolean;
    projectGid: string;
    projectName: string;
  } = input.createAsanaTask
    ? {
        ...asanaRes.value,
        projectGid: asanaProjectGid,
        projectName: 'Hawkeye Screenings',
      }
    : {
        ok: false,
        skipped: true,
        projectGid: asanaProjectGid,
        projectName: 'Hawkeye Screenings',
      };

  return jsonResponse({
    ok: true,
    ranAt,
    subject: {
      id: subjectId,
      name: input.subjectName,
      entityType: input.entityType,
      dob: input.dob,
      country: input.country,
      idNumber: input.idNumber,
      eventType: input.eventType,
      riskTier,
      jurisdiction: input.jurisdiction,
    },
    screeningIntegrity,
    integrityReasons,
    anomalies: anomalousListErrors.map((l) => ({ list: l.list, error: l.error })),
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
      providersUsed: adverseMediaProvidersUsed,
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
    deepBrain: deepBrain
      ? {
          verdict: deepBrain.verdict,
          requiresFourEyes: deepBrain.requiresFourEyes,
          confidence: deepBrain.confidence,
          narrative: deepBrain.narrative,
          topHypothesis: deepBrain.reasoning.top.hypothesisId,
          posterior: deepBrain.reasoning.top.posterior,
          rationale: deepBrain.reasoning.top.rationale,
          coverage: deepBrain.investigation.coverage,
          lessons: deepBrain.lessons,
        }
      : null,
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
