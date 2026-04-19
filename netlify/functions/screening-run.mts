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
import {
  searchAdverseMedia,
  type AdverseMediaHit,
} from '../../src/services/adverseMediaSearch';
import { explainableScore } from '../../src/services/explainableScoring';
import {
  addToWatchlist,
  deserialiseWatchlist,
  serialiseWatchlist,
  updateAfterScreening,
  type SerialisedWatchlist,
  type RiskTier,
} from '../../src/services/screeningWatchlist';
import { createAsanaTask } from '../../src/services/asanaClient';
import { moveTaskToNamedSection } from '../../src/services/asanaSectionByName';
import {
  buildLifeStoryMarkdown,
  type LifeStoryInput,
  type LifeStoryPerListRow,
} from '../../src/services/lifeStoryReportBuilder';
import {
  runDeepBrain,
  type OrchestrationResult,
  type SearchFn,
  type SearchHit,
} from '../../src/services/brain';
import { runWeaponizedAssessment } from '../../src/services/brainBridge';
import type { WeaponizedBrainResponse } from '../../src/services/weaponizedBrain';
import type { AdverseMediaHit as WeaponizedAdverseMediaHit } from '../../src/services/adverseMediaRanker';
import type { MegaBrainRequest } from '../../src/services/megaBrain';
import type { StrFeatures } from '../../src/services/predictiveStr';
import type { Evidence, Hypothesis } from '../../src/services/bayesianBelief';
import { expandNameVariants } from '../../src/services/nameVariantExpander';
import {
  FATF_GREY_LIST,
  EU_HIGH_RISK_COUNTRIES,
  PF_HIGH_RISK_JURISDICTIONS,
} from '../../src/domain/constants';

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
// Outer sanctions budget (safety net around loadAllLists). Must exceed
// PER_LIST_TIMEOUT_MS (3_800ms) plus the blob-fallback pass added in
// #317 — otherwise a legitimate per-list timeout trips the outer
// fallback and every list surfaces the generic "sanctions fetch timed
// out" instead of its own diagnostic.
//
// loadAllLists now has TWO serial phases inside this budget:
//   Phase 1 — Promise.all of 5 raceListFetch calls (up to
//             PER_LIST_TIMEOUT_MS + 200ms hard pad = 4_000ms).
//   Phase 2 — Promise.all of blob-snapshot fallbacks for every list
//             that errored in Phase 1. Netlify Blobs cold-start can
//             add 500-1500ms per call (runs in parallel, so the
//             slowest caps the phase).
// Worst case Phase 1 + Phase 2 ≈ 5_500ms. 6_500ms gives Promise.all
// overhead and a safety margin without blowing the 10s Netlify
// sync-function ceiling.
//
// Sum of phase budgets MUST fit inside Netlify's 10s sync-function
// ceiling. Typical (live fetches succeed, Phase 2 no-op):
//   6_500 (A) + 1_800 (B) + 600 (B.5 no adv) + 1_500 (C) = 10_400ms
// This is over on paper, but C rarely runs to its cap (asana POST is
// typically <400ms) and B rarely runs to its cap either. The Phase-A
// raise is strictly better than the previous 4_500ms which caused
// 100% of runs to surface the generic fallback after #317's blob
// pass landed.
const SANCTIONS_FETCH_TIMEOUT_MS = 6_500;
const ADVERSE_MEDIA_TIMEOUT_MS = 3_000;
// Blob-store hydration cap. Netlify Blobs cold-start can take multiple
// seconds; without this cap, hydrate blocked Promise.all past the outer
// deadline and every list surfaced the generic fallback. Hydration is
// best-effort (UAE_EOCN's fetchUAESanctionsList raises its own Art.35
// "cache empty" error if hydrate skipped), so a tight cap is safe.
const HYDRATE_TIMEOUT_MS = 1_200;
// Deep brain deadline tuned so the reasoner stays inside Phase B
// without starving Phase B.5 (weaponized + optional advisor) or Phase
// C. Sits inside the 10s Netlify sync ceiling alongside the other
// phase budgets. Reduced from 2500ms after Phase B.5 added the
// optional Opus advisor sub-inference on freeze/escalate verdicts —
// deep-brain is already bounded by its own internal PEER timeouts and
// rarely needs the full 2.5s slot.
const DEEP_BRAIN_DEADLINE_MS = 1_800;
// Weaponized brain (19 subsystems) runs entirely in-process with no
// network hops. Typical wall-clock of the subsystems alone is <100ms;
// the base cap is a safety net against pathological inputs.
// FDL Art.20 — CO must still receive a deterministic verdict.
const WEAPONIZED_BRAIN_DEADLINE_MS = 600;
// On freeze / escalate verdicts we run the Opus advisor sub-inference
// for the MLRO-grade rationale. Budget is tight because advisor
// streams via /api/ai-proxy SSE keepalives; failures are logged and
// the verdict proceeds without advisor input. Regulatory basis:
// FDL Art.20-21 (CO duty of care — reasoned citation required on
// freeze), Cabinet Res 74/2020 Art.4-7 (freeze rationale on record).
const ADVISOR_ESCALATION_DEADLINE_MS = 2_500;
// Number of adverse-media fan-out queries (subject + top variants +
// aliases). Bounded because every extra query costs a parallel HTTP
// round-trip; 4 covers the subject + three strongest variants, which
// is more than enough for Refinitiv-grade coverage without blowing
// ADVERSE_MEDIA_TIMEOUT_MS (all queries race in parallel anyway, so
// the slowest still caps the stage).
const ADVERSE_MEDIA_FANOUT_MAX = 4;
// Asana + Watchlist run in parallel. ASANA_TIMEOUT_MS bounds the
// Asana POST (CO needs a clear "task timed out" diagnostic, never a
// silent hang). WATCHLIST_TIMEOUT_MS is shorter because watchlist is a
// local blob write with no external network hop.
// Phase C budgets tightened after Phase B.5 added the optional Opus
// advisor (up to ADVISOR_ESCALATION_DEADLINE_MS). Worst-case total:
//   4500 (A) + 1800 (B) + 2500 (B.5 advisor) + 1500 (C max) = 10300
//   4500 (A) + 1800 (B) +  600 (B.5 no adv)  + 1500 (C max) =  8400
// First line is over the 10s ceiling, but advisor only engages on
// confirmed sanctions matches (the slowest path is also the rarest
// — and the one where the MLRO most needs the Opus rationale).
// Typical non-advisor total sits comfortably under 9s.
const ASANA_TIMEOUT_MS = 1_500;
const WATCHLIST_TIMEOUT_MS = 1_200;

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

// ---------------------------------------------------------------------------
// Deep investigation helpers — "every search deeply investigated"
// ---------------------------------------------------------------------------

/**
 * Canonicalise a jurisdiction / country code to ISO-3166 alpha-2 so we
 * can compare against FATF / EU / UNSC lists. Accepts:
 *   - "AE", "ae" → "AE"
 *   - "United Arab Emirates" → "" (name-to-code lookup deliberately
 *     out of scope; caller is responsible for providing the code form
 *     from the CDD form).
 * Returns "" on input we cannot canonicalise rather than guessing —
 * FDL Art.20 requires deterministic classification.
 */
function canonicaliseCountryCode(raw: string | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim().toUpperCase();
  if (trimmed.length === 2 && /^[A-Z]{2}$/.test(trimmed)) return trimmed;
  return '';
}

/**
 * Is the given country / jurisdiction on any UAE-adopted high-risk
 * list? Union of:
 *   - FATF Grey List (increased monitoring)
 *   - EU High-Risk Third Countries (Delegated Regulation)
 *   - UNSC PF high-risk (DPRK, Iran, Syria, Myanmar, Yemen)
 *
 * Regulatory basis: Cabinet Res 134/2025 Art.14 (EDD triggers),
 * Cabinet Res 156/2025 (PF). The MLRO cannot mark a subject from
 * any of these clean without EDD — the brain must know.
 */
function isHighRiskJurisdiction(country?: string, jurisdiction?: string): boolean {
  const codes = new Set<string>();
  const c1 = canonicaliseCountryCode(country);
  const c2 = canonicaliseCountryCode(jurisdiction);
  if (c1) codes.add(c1);
  if (c2) codes.add(c2);
  if (codes.size === 0) return false;
  for (const code of codes) {
    if ((FATF_GREY_LIST as readonly string[]).includes(code)) return true;
    if ((EU_HIGH_RISK_COUNTRIES as readonly string[]).includes(code)) return true;
    if ((PF_HIGH_RISK_JURISDICTIONS as readonly string[]).includes(code)) return true;
  }
  return false;
}

/**
 * PEP heuristic — a conservative keyword sweep of MLRO notes +
 * explicit aliases. NOT a replacement for an authoritative PEP list
 * (that's a separate subscription); this is a belt-and-braces signal
 * so the brain can EDD-escalate when the CDD form says PEP but the
 * list provider hasn't fired. False positives are acceptable here —
 * they escalate to human review, never silently downgrade.
 *
 * Regulatory basis: Cabinet Res 134/2025 Art.14 (PEP → EDD + Board
 * approval). Art.29 — never tip off (we do not surface the hit to
 * the subject, only to the MLRO).
 */
function pepHeuristic(notes: string | undefined, aliases: readonly string[] | undefined): boolean {
  const tokens: string[] = [];
  if (notes) tokens.push(notes);
  if (aliases) tokens.push(...aliases);
  const corpus = tokens.join(' ').toLowerCase();
  if (!corpus) return false;
  return (
    /\bpep\b/.test(corpus) ||
    /\bpolitically exposed\b/.test(corpus) ||
    /\bhead of state\b/.test(corpus) ||
    /\bminister\b/.test(corpus) ||
    /\bambassador\b/.test(corpus) ||
    /\bsovereign\b/.test(corpus) ||
    /\bruling family\b/.test(corpus) ||
    /\broyal family\b/.test(corpus)
  );
}

/**
 * Build the list of search terms for adverse media + sanctions
 * fan-out. Starts with the subject name, adds explicit aliases the
 * caller provided, then augments with name-variant expansion
 * (soundex + metaphone + honorific-stripped + CJK romanisation +
 * Arabic-Latin transliteration). Dedupes case-insensitively.
 *
 * The cap (ADVERSE_MEDIA_FANOUT_MAX) exists because every extra term
 * is one more parallel HTTP fan-out on each adverse-media provider.
 * We sort variants by "strongest signal first" — canonical input,
 * then explicit aliases, then the auto-expanded variants — so the
 * cap drops only the weakest synthesised forms.
 *
 * Regulatory basis: FDL Art.20-21 (CO must exhaust reasonable name
 * variants before reporting clean), FATF Rec 10 (CDD must survive
 * common spelling variation for a true "no match"). Refinitiv-grade
 * coverage requires at minimum canonical + transliteration + a
 * phonetic form — which is exactly what nameVariantExpander emits.
 */
function buildSearchTerms(
  subject: string,
  aliases: readonly string[] | undefined,
  cap: number
): string[] {
  const out = new Set<string>();
  const primary = subject.trim();
  if (primary) out.add(primary);
  if (aliases) {
    for (const a of aliases) {
      const t = a.trim();
      if (t) out.add(t);
    }
  }
  try {
    const expanded = expandNameVariants(primary);
    for (const v of expanded.variants) {
      if (v && v.length >= 3) out.add(v);
    }
  } catch {
    // Name-variant expansion is best-effort. If it throws on exotic
    // input, we proceed with just the explicit terms.
  }
  return Array.from(out).slice(0, cap);
}

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
let uaeSeedSucceeded = false;

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
 *
 * Retry semantics: once a hydrate succeeds, we respect the 6h TTL
 * (SANCTIONS_CACHE_TTL_MS) before re-hydrating — the in-memory cache
 * is good. But when hydrate FAILS (blob store empty, cold-start error),
 * we only back off for RETRY_BACKOFF_MS before trying again. Otherwise
 * a single cold-start miss poisons the instance for 6h even after the
 * MLRO uploads the missing circular (FDL Art.35 gate stays hot).
 */
const UAE_SEED_RETRY_BACKOFF_MS = 30_000;
async function hydrateUaeSanctionsFromBlob(): Promise<void> {
  const now = Date.now();
  const backoff = uaeSeedSucceeded ? SANCTIONS_CACHE_TTL_MS : UAE_SEED_RETRY_BACKOFF_MS;
  if (now - uaeSeedAttemptedAt < backoff) return;
  uaeSeedAttemptedAt = now;
  try {
    const store = getStore('sanctions-snapshots');
    const listing = await store.list({ prefix: 'UAE_EOCN/' });
    const keys = (listing.blobs ?? [])
      .map((b) => b.key)
      .filter((k): k is string => typeof k === 'string' && k.endsWith('/snapshot.json'))
      .sort();
    const latest = keys[keys.length - 1];
    if (latest) {
      const raw = await store.get(latest, { type: 'json' });
      if (Array.isArray(raw)) {
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
        if (entries.length > 0) {
          seedUaeSanctionsList(entries);
          uaeSeedSucceeded = true;
          return;
        }
      }
    }
    // Last-resort fallback: no EOCN circular has been uploaded yet, but
    // Cabinet Res 74/2020 Art.3 makes the UAE implement every UN
    // Security Council designation automatically. If the ingest cron
    // has a recent UN snapshot, use it as a MINIMUM-VIABLE UAE list so
    // Art.35 screening does not hard-fail on cold-boot. The UI / audit
    // message must still flag this as "seeded from UN — upload EOCN
    // circular for full UAE coverage" so the MLRO knows it is partial.
    const unFallback = await loadBlobSnapshot('UN', 'UAE EOCN (UN fallback)');
    if (unFallback && unFallback.length > 0) {
      seedUaeSanctionsList(unFallback);
      uaeSeedSucceeded = true;
    }
  } catch {
    // Silent — the Art.35 gate in fetchUAESanctionsList still fires.
    // uaeSeedSucceeded stays false so the next request retries after
    // UAE_SEED_RETRY_BACKOFF_MS rather than waiting 6h.
  }
}

/**
 * Per-list timeout budget. Each list races its OWN deadline, so a slow
 * fetch on (say) UN's XML does not cascade into reported timeouts for
 * OFAC/EU/UK/EOCN. The outer caller still clamps the whole phase at
 * SANCTIONS_FETCH_TIMEOUT_MS, but inside that window every list that
 * returns fast actually surfaces its rows instead of being nuked by the
 * slowest sibling. Must be strictly less than
 * SANCTIONS_FETCH_TIMEOUT_MS so per-list diagnostics land before the
 * outer fallback fires.
 */
const PER_LIST_TIMEOUT_MS = 3_800;

/**
 * Load the most recent normalised snapshot for a source from the
 * `sanctions-snapshots` Netlify Blob store. Snapshots are written by
 * `sanctions-ingest-cron.mts` every 15 min under
 * `<source>/<YYYY-MM-DD>/snapshot.json`. Used as a safety-net when the
 * live upstream fetch cancels mid-flight (EU's 5MB XML is the usual
 * offender). Map NormalisedSanction → SanctionsEntry the same way
 * `hydrateUaeSanctionsFromBlob` does for UAE_EOCN. Returns null if no
 * snapshot exists OR if the store read itself errors (cold-start) —
 * the caller then surfaces the original live-fetch error.
 */
async function loadBlobSnapshot(
  source: 'UN' | 'OFAC_SDN' | 'OFAC_CONS' | 'EU' | 'UK_OFSI',
  listLabel: string
): Promise<SanctionsEntry[] | null> {
  try {
    const store = getStore('sanctions-snapshots');
    const listing = await store.list({ prefix: `${source}/` });
    const keys = (listing.blobs ?? [])
      .map((b) => b.key)
      .filter((k): k is string => typeof k === 'string' && k.endsWith('/snapshot.json'))
      .sort();
    const latest = keys[keys.length - 1];
    if (!latest) return null;
    const raw = await store.get(latest, { type: 'json' });
    if (!Array.isArray(raw)) return null;
    const entries: SanctionsEntry[] = raw
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map((e, idx) => {
        const type = e.type === 'individual' || e.type === 'entity' ? e.type : 'entity';
        const aliases = Array.isArray(e.aliases)
          ? (e.aliases as unknown[]).filter((a): a is string => typeof a === 'string')
          : [];
        return {
          id:
            typeof e.sourceId === 'string' ? e.sourceId : `${source}-fallback-${idx}`,
          name: typeof e.primaryName === 'string' ? e.primaryName : '',
          aliases,
          listSource: listLabel,
          listDate: typeof e.listDate === 'string' ? e.listDate : undefined,
          type: type as 'individual' | 'entity',
          nationality: typeof e.nationality === 'string' ? e.nationality : undefined,
          designationRef:
            typeof e.sourceId === 'string' ? e.sourceId : undefined,
        } as SanctionsEntry;
      })
      .filter((e) => e.name.length > 0);
    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  }
}

/**
 * Race a single list fetch against PER_LIST_TIMEOUT_MS. Two layers of
 * defence:
 *   1. An AbortSignal is wired into the underlying fetch so a slow
 *      upstream is cancelled at the socket level. This keeps the real
 *      network call from burning Netlify invocation time past the
 *      deadline.
 *   2. A hard Promise.race against a setTimeout rejection guarantees
 *      raceListFetch resolves even if the fetcher ignores the signal
 *      (e.g. a vendored library that swallows AbortError or a stream
 *      that never closes). Without this belt-and-braces, a single
 *      misbehaving list fetcher blocked Promise.all past the outer
 *      SANCTIONS_FETCH_TIMEOUT_MS and every list surfaced the generic
 *      "sanctions fetch timed out" fallback instead of its own
 *      diagnostic — the exact bug this branch is fixing.
 */
async function raceListFetch(
  name: ListSnapshot['lists'][number]['name'],
  fetcher: (signal: AbortSignal, timeoutMs: number) => Promise<SanctionsEntry[]>
): Promise<ListSnapshot['lists'][number]> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_LIST_TIMEOUT_MS);
  let hardTimer: ReturnType<typeof setTimeout> | undefined;
  const hardTimeout = new Promise<never>((_, reject) => {
    hardTimer = setTimeout(
      () =>
        reject(
          new Error(
            `${name} fetch exceeded ${PER_LIST_TIMEOUT_MS}ms hard deadline (fetcher ignored AbortSignal)`
          )
        ),
      PER_LIST_TIMEOUT_MS + 200
    );
  });
  try {
    const entries = await Promise.race([
      fetcher(controller.signal, PER_LIST_TIMEOUT_MS),
      hardTimeout,
    ]);
    return { name, entries };
  } catch (err) {
    const elapsed = Date.now() - started;
    if (controller.signal.aborted) {
      return {
        name,
        entries: [],
        error: `${name} fetch cancelled after ${PER_LIST_TIMEOUT_MS}ms (aborted at ${elapsed}ms)`,
      };
    }
    return {
      name,
      entries: [],
      error: `${name} fetch failed: ${(err as Error)?.message || 'unknown error'}`,
    };
  } finally {
    clearTimeout(timer);
    if (hardTimer) clearTimeout(hardTimer);
  }
}

/**
 * Cap hydrateUaeSanctionsFromBlob() at HYDRATE_TIMEOUT_MS. Netlify
 * Blobs cold-start latency is the most common cause of this hydrate
 * blocking Promise.all past the outer sanctions deadline. If hydrate
 * is too slow, we skip it — fetchUAESanctionsList surfaces its own
 * Art.35 "cache empty" diagnostic, strictly better than every list
 * collapsing onto the generic outer fallback.
 */
async function raceHydrate(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => resolve(), HYDRATE_TIMEOUT_MS);
  });
  try {
    await Promise.race([hydrateUaeSanctionsFromBlob(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function loadAllLists(): Promise<ListSnapshot> {
  if (listCache && Date.now() - listCache.fetchedAt < SANCTIONS_CACHE_TTL_MS) {
    return listCache;
  }
  // Run blob hydration IN PARALLEL with the other 5 list fetches (not
  // serially before them). Netlify Blobs cold-start latency used to eat
  // 400-900ms of the outer budget and leave <300ms of headroom between
  // PER_LIST_TIMEOUT_MS (4200ms) and SANCTIONS_FETCH_TIMEOUT_MS (4500ms).
  // The symptom: every list surfaced the generic outer fallback
  // "sanctions fetch timed out" instead of the per-list diagnostic.
  // Hydration is best-effort and swallows its own errors, so racing it
  // alongside the network fetches is safe. UAE_EOCN's fetcher reads the
  // in-memory cache seeded by hydrate; if hydrate has not finished when
  // fetchUAESanctionsList fires, the Art.35 gate throws with a clear
  // "cache empty" message (which raceListFetch surfaces as that list's
  // error) — strictly better than silently-wiped per-list diagnostics.
  const proxy = process.env.HAWKEYE_SANCTIONS_PROXY_URL;
  const [, ...rawLists] = await Promise.all([
    hydrateUaeSanctionsFromBlob(),
    raceListFetch('UN', (signal, timeoutMs) => fetchUNSanctionsList(proxy, { signal, timeoutMs })),
    raceListFetch('OFAC', (signal, timeoutMs) => fetchOFACSanctionsList(proxy, { signal, timeoutMs })),
    raceListFetch('EU', (signal, timeoutMs) => fetchEUSanctionsList(proxy, { signal, timeoutMs })),
    raceListFetch('UK_OFSI', (signal, timeoutMs) => fetchUKSanctionsList(proxy, { signal, timeoutMs })),
    raceListFetch('UAE_EOCN', () => fetchUAESanctionsList()),
  ]);
  // Blob-snapshot fallback for the four live-fetch lists. When the
  // upstream (EU/UN/OFAC/UK) cancels mid-flight — e.g. EU's 5MB XML
  // during an event-loop stall — drop back to the most recent
  // cron-produced snapshot rather than returning an empty list with an
  // error. This keeps Cabinet Res 74/2020 Art.4 list-coverage intact
  // even when a single upstream is stalled, so long as the ingest cron
  // (sanctions-ingest-cron.mts) has run at least once. If no blob
  // snapshot exists either, the original live-fetch error is preserved
  // and surfaced exactly as before so the MLRO sees the coverage gap.
  const BLOB_FALLBACK_SOURCES: Record<
    'UN' | 'OFAC' | 'EU' | 'UK_OFSI',
    'UN' | 'OFAC_SDN' | 'EU' | 'UK_OFSI'
  > = {
    UN: 'UN',
    OFAC: 'OFAC_SDN',
    EU: 'EU',
    UK_OFSI: 'UK_OFSI',
  };
  const lists = await Promise.all(
    rawLists.map(async (result) => {
      if (!result.error || result.name === 'UAE_EOCN') return result;
      const blobKey = BLOB_FALLBACK_SOURCES[result.name as keyof typeof BLOB_FALLBACK_SOURCES];
      if (!blobKey) return result;
      const fallback = await loadBlobSnapshot(blobKey, result.name);
      if (!fallback) return result;
      return {
        name: result.name,
        entries: fallback,
        error: `${result.error} — served ${fallback.length} rows from cached ingest-cron snapshot`,
      };
    })
  );
  const snapshot: ListSnapshot = { fetchedAt: Date.now(), lists: lists as ListSnapshot['lists'] };

  // Cache ONLY when every mandatory list (UN, UAE_EOCN) came back without
  // an error. Otherwise a cold-start miss poisons the warm instance for
  // 6h (SANCTIONS_CACHE_TTL_MS) and every subsequent screening surfaces
  // the same "fetch cancelled / cache empty" message even after upstream
  // recovers or the MLRO uploads the missing circular. Cabinet Res
  // 74/2020 Art.4 + FDL No.10/2025 Art.35 require fresh UAE coverage;
  // serving a stale error for 6h is the exact failure mode we just
  // saw in production.
  const MANDATORY_FOR_CACHE = new Set<string>(['UN', 'UAE_EOCN']);
  const mandatoryClean = snapshot.lists
    .filter((l) => MANDATORY_FOR_CACHE.has(l.name))
    .every((l) => !l.error);
  if (mandatoryClean) {
    listCache = snapshot;
  } else {
    listCache = null;
  }
  return snapshot;
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
  /**
   * Number of hits whose fingerprint was NOT already on the entry — these
   * are the ones that incremented `alertCount`. Zero on the 'skipped' or
   * 'failed' paths, and zero on a clean screen with no hits.
   */
  newHits?: number;
  /** Cumulative lifetime hit count on the entry after this update. */
  totalHits?: number;
}

async function enrollIntoWatchlist(
  id: string,
  subjectName: string,
  riskTier: RiskTier,
  metadata: Record<string, string | number | boolean>,
  initialHits: readonly AdverseMediaHit[] = []
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
      const alreadyPresent = wl.entries.has(id);
      if (!alreadyPresent) {
        addToWatchlist(wl, { id, subjectName, riskTier, metadata });
      }

      // Fingerprint + diff the initial-screening hits against the entry's
      // seen-set so alertCount reflects reality from the first write. Without
      // this, a subject with confirmed adverse-media matches would land in
      // the watchlist with alertCount=0 and render as "0 lifetime hits" in
      // the MLRO UI — the OZCAN HALAC bug. Using the same updateAfterScreening
      // helper that the daily cron uses keeps the on-demand + scheduled
      // paths consistent (FDL Art.24 audit trail parity).
      const update = await updateAfterScreening(wl, id, initialHits);
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
        if (landed) {
          return {
            action: alreadyPresent ? 'already-present' : 'enrolled',
            id,
            newHits: update.newHits.length,
            totalHits: update.entry.alertCount,
          };
        }
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
  /** Full life-story deep-dive (first-screen events only). When provided,
   *  becomes the task body in place of the plain line list and the task
   *  is moved into the "The Screenings" section on success. */
  lifeStory?: LifeStoryInput;
  /** Name of the Asana board section to move the task into after create.
   *  Resolved case-insensitively at runtime so MLROs can rename the
   *  section slightly without a code change. */
  targetSectionName?: string;
  /** Optional override for ASANA_SCREENINGS_PROJECT_GID. Lets
   *  continuous-monitor reuse this function with a different project
   *  if/when we split boards. */
  projectGidOverride?: string;
}): Promise<{
  ok: boolean;
  gid?: string;
  error?: string;
  sectionName?: string;
  sectionError?: string;
}> {
  const projectId =
    params.projectGidOverride ||
    process.env.ASANA_SCREENINGS_PROJECT_GID ||
    '1214124911186857';
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

  // Life-story body for first-screen events (new_customer_onboarding /
  // periodic_review). Replaces the plain line list with the rich
  // markdown the MLRO actually reads on the Asana board. Falls back
  // to the plain body when lifeStory is undefined so the contract for
  // continuous-monitor + ad-hoc screens is unchanged.
  const body = params.lifeStory ? buildLifeStoryMarkdown(params.lifeStory) : lines.join('\n');

  const result = await createAsanaTask({
    name,
    notes: body,
    projects: [projectId],
    tags,
  });

  // Section write-back — fire-and-log. If it fails, the task still
  // exists in the project's default column, so the MLRO never loses
  // evidence. The error is surfaced on the verdict page via
  // `asana.sectionError` so the integrations status can flag a
  // misconfigured board.
  let sectionName: string | undefined;
  let sectionError: string | undefined;
  if (result.ok && result.gid && params.targetSectionName) {
    try {
      const moved = await moveTaskToNamedSection(
        projectId,
        result.gid,
        params.targetSectionName
      );
      if (moved.ok) {
        sectionName = moved.sectionName;
      } else {
        sectionError = moved.error;
      }
    } catch (err) {
      sectionError = err instanceof Error ? err.message : 'section move failed';
    }
  }

  return { ...result, sectionName, sectionError };
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
  // Build the expanded search-term set ONCE — reused across sanctions
  // screening, adverse media fan-out, and brain atom extraction. FDL
  // Art.20-21 demands the CO have exhausted reasonable name variants
  // before a clean verdict is recorded.
  const searchTerms = buildSearchTerms(
    input.subjectName,
    input.aliases,
    ADVERSE_MEDIA_FANOUT_MAX
  );
  // Adverse-media lookback window. The default 30-day window in
  // buildAdverseMediaQuery is tuned for ONGOING MONITORING where the
  // same subject is checked daily and only fresh news matters. For
  // new-customer onboarding or a periodic CDD review, we need a
  // HISTORICAL screen — a 6-month-old arrest on a Turkey gold refinery
  // raid still matters for an EDD decision. Widen to 3 years on those
  // event types so the first-time screen actually catches pre-existing
  // adverse media (FATF Rec 10 — ongoing CDD + onboarding due diligence).
  const amSinceDate =
    input.eventType === 'new_customer_onboarding' || input.eventType === 'periodic_review'
      ? (() => {
          const d = new Date();
          d.setFullYear(d.getFullYear() - 3);
          return d.toISOString().slice(0, 10);
        })()
      : undefined;
  // Adverse media fan-out: one searchAdverseMedia call per term, all
  // racing in parallel. The slowest still caps the stage at
  // ADVERSE_MEDIA_TIMEOUT_MS. Results are merged + de-duplicated by
  // URL so the downstream count and top-5 reflect the union of
  // hits across every variant. The historical sinceDate (if any)
  // propagates into every fan-out call so onboarding screens cover
  // the full 3-year window across every name variant.
  const fanoutAdverseMedia = async () => {
    if (!input.runAdverseMedia) return amFallback;
    const terms = searchTerms.length > 0 ? searchTerms : [input.subjectName];
    const amOptions = amSinceDate ? { sinceDate: amSinceDate } : undefined;
    const settled = await Promise.allSettled(
      terms.map((t) => searchAdverseMedia(t, amOptions))
    );
    const merged: typeof amFallback = {
      ...amFallback,
      provider: 'multi',
      providersUsed: [] as string[],
      hits: [] as typeof amFallback.hits,
    };
    const byUrl = new Map<string, (typeof amFallback.hits)[number]>();
    const providersSeen = new Set<string>();
    for (const r of settled) {
      if (r.status !== 'fulfilled') continue;
      const v = r.value;
      merged.totalResults += v.totalResults ?? 0;
      if (v.providersUsed) {
        for (const p of v.providersUsed) providersSeen.add(p);
      } else if (v.provider) {
        providersSeen.add(v.provider);
      }
      for (const h of v.hits) {
        const key = (h.url ?? '').trim();
        if (!key) continue;
        if (!byUrl.has(key)) byUrl.set(key, h);
      }
    }
    merged.hits = Array.from(byUrl.values());
    merged.providersUsed = Array.from(providersSeen);
    merged.provider = merged.providersUsed.join(',') || 'none';
    merged.searchedAt = new Date().toISOString();
    return merged;
  };
  const [sanctionsLoad, amRes] = await Promise.all([
    withTimeout(loadAllLists(), SANCTIONS_FETCH_TIMEOUT_MS, sanctionsTimeoutSnapshot, 'sanctions-lists'),
    input.runAdverseMedia
      ? withTimeout(
          fanoutAdverseMedia(),
          ADVERSE_MEDIA_TIMEOUT_MS,
          amFallback,
          'adverse-media'
        )
      : Promise.resolve({ value: amFallback, timedOut: false, error: undefined as string | undefined }),
  ]);

  const snapshot = sanctionsLoad.value;
  // Expand the alias set passed to the multi-modal matcher to include
  // every name-variant we synthesised (phonetic, transliteration,
  // honorific-stripped) in addition to MLRO-supplied aliases. This
  // lifts sanctions-list recall closer to Refinitiv / World Check
  // levels without changing the per-list fetch path.
  const sanctionsAliases = Array.from(
    new Set([...(input.aliases ?? []), ...searchTerms.filter((t) => t !== input.subjectName)])
  );
  const { perList, overallTopScore, overallTopClassification } = screenAgainstAllLists(
    input.subjectName,
    snapshot,
    input.selectedLists,
    sanctionsAliases
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
  // Runs on EVERY screening (opt-out only). A clean "none" classification
  // still benefits from a reasoned narrative — so the MLRO always has an
  // explainable audit entry (FDL Art.24). Cost is bounded by
  // DEEP_BRAIN_DEADLINE_MS.
  const deepBrainEnabled = input.runDeepBrain !== false;
  let deepBrain: OrchestrationResult | null = null;
  if (deepBrainEnabled) {
    const atomHits: SearchHit[] = [];
    // Sanctions list candidates — one atom per hit, top 20 per list.
    for (const l of perList) {
      for (const h of l.hits.slice(0, 20)) {
        atomHits.push({
          fact: `${l.list} candidate ${h.name} (score ${h.score.toFixed(2)}, ${h.classification})`,
          source: `${l.list}_${ranAt.slice(0, 10)}`,
          sourceTimestamp: ranAt,
          confidence: h.score,
        });
      }
      // Per-list error signal so the reasoner can weigh "list X was
      // unreachable" vs "list X returned no candidates" (very different
      // conclusions for FDL Art.20 coverage).
      if (l.error && l.error !== 'opted out by MLRO (enhanced control)') {
        atomHits.push({
          fact: `${l.list} fetch error: ${l.error}`,
          source: `${l.list}_ERROR`,
          sourceTimestamp: ranAt,
          confidence: 0.95,
        });
      }
    }
    // Full adverse-media corpus (not just top 5) so the reasoner can see
    // the density and recency of the negative-news signal.
    const amSource = input.runAdverseMedia ? amRes.value.hits : [];
    for (const am of amSource.slice(0, 30)) {
      atomHits.push({
        fact: `adverse media: ${am.title}${am.snippet ? ' — ' + am.snippet.slice(0, 200) : ''}`,
        source: `ADVERSE_MEDIA_${am.source ?? 'unknown'}`,
        sourceTimestamp: am.publishedAt ?? ranAt,
        confidence: 0.7,
      });
    }
    // Subject context atoms — country + entity type + aliases feed the
    // reasoner explicit priors (jurisdictional risk, entity-type base
    // rates, name-variant coverage).
    if (input.country) {
      atomHits.push({
        fact: `subject country: ${input.country}`,
        source: 'SUBJECT_CONTEXT',
        sourceTimestamp: ranAt,
        confidence: 1.0,
      });
    }
    if (input.jurisdiction && input.jurisdiction !== input.country) {
      atomHits.push({
        fact: `jurisdiction of interest: ${input.jurisdiction}`,
        source: 'SUBJECT_CONTEXT',
        sourceTimestamp: ranAt,
        confidence: 1.0,
      });
    }
    atomHits.push({
      fact: `entity type: ${input.entityType}; event type: ${input.eventType}; risk tier: ${riskTier}`,
      source: 'SUBJECT_CONTEXT',
      sourceTimestamp: ranAt,
      confidence: 1.0,
    });
    if (Array.isArray(input.aliases) && input.aliases.length > 0) {
      atomHits.push({
        fact: `aliases / variants screened: ${input.aliases.slice(0, 10).join('; ')}`,
        source: 'SUBJECT_CONTEXT',
        sourceTimestamp: ranAt,
        confidence: 1.0,
      });
    }
    if (input.notes) {
      atomHits.push({
        fact: `MLRO notes: ${input.notes.slice(0, 400)}`,
        source: 'SUBJECT_CONTEXT',
        sourceTimestamp: ranAt,
        confidence: 0.85,
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
      if (q.id === 'q-context' || q.id === 'q-subject') {
        return atomHits.filter((a) => a.source === 'SUBJECT_CONTEXT');
      }
      // Default: return every atom so novel queries still see full corpus.
      return atomHits;
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

  // ─── Phase B.5. Weaponized brain — 19-subsystem safety-clamp pass ────
  // Runs the full Weaponized Brain whenever a high-risk signal surfaces:
  //   - any non-"none" multi-modal classification from any list, OR
  //   - screening integrity degraded/incomplete (mandatory-list failure
  //     or adverse-media provider missing → absence of evidence is NOT
  //     evidence of absence under FDL Art.20-21), OR
  //   - deep brain confidence below 0.7 (uncertain posterior).
  //
  // The brain runs fully in-process (no advisor network call in this
  // synchronous path — advisor would blow the 10s Netlify ceiling). Its
  // 19 subsystems apply deterministic safety clamps over the MegaBrain
  // verdict: sanctions → freeze, adverse-media-critical → escalate,
  // undisclosed UBO / shell-company / structuring → flag.
  //
  // Regulatory basis: FDL No.10/2025 Art.20-21 (CO duty of care, can
  // never report clean when data is incomplete), Cabinet Res 134/2025
  // Art.19 (internal review before decision), Cabinet Res 74/2020
  // Art.4-7 (mandatory freeze on sanctions).
  let weaponized: WeaponizedBrainResponse | null = null;
  const deepBrainConfidence = deepBrain?.confidence ?? 1;
  const weaponizedNeeded =
    overallTopClassification !== 'none' ||
    screeningIntegrity !== 'complete' ||
    deepBrainConfidence < 0.7;
  if (weaponizedNeeded) {
    // ── Rich StrFeatures derivation ───────────────────────────────────
    // Every signal we can extract from the screening input and the
    // upstream sanctions/adverse-media results is fed into the STR
    // predictor, so the brain's Bayesian layer converges faster and
    // the explainable-scoring subsystem surfaces real drivers.
    const highRiskJx = isHighRiskJurisdiction(input.country, input.jurisdiction);
    const isPepHint = pepHeuristic(input.notes, input.aliases);
    const entityFeatures: StrFeatures = {
      priorAlerts90d: 0,
      txValue30dAED: 0,
      nearThresholdCount30d: 0,
      crossBorderRatio30d: 0,
      isPep: isPepHint,
      highRiskJurisdiction: highRiskJx,
      hasAdverseMedia: adverseMediaHits > 0,
      daysSinceOnboarding: 0,
      sanctionsMatchScore: Math.max(0, Math.min(1, overallTopScore)),
      cashRatio30d: 0,
    };
    const isSanctionsConfirmed =
      overallTopClassification === 'confirmed' || overallTopScore >= 0.9;

    // ── Hypotheses + Bayesian evidence stream ─────────────────────────
    // Defaults (clean / suspicious / confirmed) + an extra PEP-risk
    // hypothesis so the belief updater can split EDD-required from
    // plain-suspicious cases. Evidence is built from every signal we
    // already computed so the brain isn't rediscovering what screening
    // already knows. FDL Art.20 — CO must reason over ALL available
    // information, not just the top sanctions score.
    const hypotheses: Hypothesis[] = [
      { id: 'clean', label: 'Clean', regulatoryMeaning: 'No action required.' },
      {
        id: 'suspicious',
        label: 'Suspicious',
        regulatoryMeaning: 'Enhanced review required (CDD → EDD).',
      },
      {
        id: 'pep-risk',
        label: 'PEP risk',
        regulatoryMeaning: 'EDD + Board approval (Cabinet Res 134/2025 Art.14).',
      },
      {
        id: 'confirmed',
        label: 'Confirmed launderer / sanctioned',
        regulatoryMeaning: 'File STR and freeze (Cabinet Res 74/2020 Art.4-7).',
      },
    ];
    const evidence: Evidence[] = [];
    if (overallTopScore > 0) {
      evidence.push({
        id: 'sanctions-match',
        label: `top sanctions match score ${overallTopScore.toFixed(3)} (${overallTopClassification})`,
        likelihood: {
          clean: Math.max(0.001, 1 - overallTopScore),
          suspicious: Math.max(0.001, overallTopScore * 0.4),
          'pep-risk': Math.max(0.001, overallTopScore * 0.3),
          confirmed: Math.max(0.001, overallTopScore),
        },
      });
    }
    if (adverseMediaHits > 0) {
      const amStrength = Math.min(1, adverseMediaHits / 10);
      evidence.push({
        id: 'adverse-media',
        label: `${adverseMediaHits} adverse-media hit(s) across ${
          amRes.value.providersUsed?.length ?? 0
        } provider(s)`,
        likelihood: {
          clean: Math.max(0.001, 1 - amStrength),
          suspicious: 0.3 + amStrength * 0.4,
          'pep-risk': 0.2 + amStrength * 0.3,
          confirmed: 0.1 + amStrength * 0.3,
        },
      });
    }
    if (highRiskJx) {
      evidence.push({
        id: 'high-risk-jurisdiction',
        label: `jurisdiction ${input.jurisdiction ?? input.country ?? ''} on FATF/EU/UNSC high-risk list`,
        likelihood: {
          clean: 0.3,
          suspicious: 0.5,
          'pep-risk': 0.4,
          confirmed: 0.2,
        },
      });
    }
    if (isPepHint) {
      evidence.push({
        id: 'pep-hint',
        label: 'PEP keyword detected in MLRO notes / aliases',
        likelihood: {
          clean: 0.2,
          suspicious: 0.4,
          'pep-risk': 0.9,
          confirmed: 0.15,
        },
      });
    }
    if (screeningIntegrity !== 'complete') {
      evidence.push({
        id: 'integrity-gap',
        label: `screening integrity ${screeningIntegrity}: ${integrityReasons.join('; ')}`,
        likelihood: {
          // When integrity is degraded, we CANNOT collapse to clean.
          // Absence of evidence is not evidence of absence (FDL Art.20).
          clean: 0.05,
          suspicious: 0.5,
          'pep-risk': 0.3,
          confirmed: 0.3,
        },
      });
    }

    const megaReq: MegaBrainRequest = {
      topic: `screening ${input.subjectName} (${ranAt.slice(0, 10)})`,
      entity: {
        id: subjectId,
        name: input.subjectName,
        features: entityFeatures,
        isSanctionsConfirmed,
      },
      hypotheses,
      evidence,
    };
    // Map adverse media hits into the weaponized brain's ranker input
    // shape. The ranker is subsystem 14 and produces impact categories
    // the clamp layer uses to force escalate on "critical".
    const adverseMediaForBrain: readonly WeaponizedAdverseMediaHit[] = input.runAdverseMedia
      ? amRes.value.hits.slice(0, 30).map((h, idx) => ({
          id: h.url ?? `am-${idx}`,
          entityNameQueried: input.subjectName,
          headline: h.title,
          snippet: h.snippet,
          sourceDomain: h.source ?? 'unknown',
          publishedAtIso: h.publishedAt,
        }))
      : [];
    // Advisor escalation policy: only engage the Opus advisor on the
    // cases where a defensible MLRO-grade rationale is mandatory —
    // confirmed sanctions matches (freeze) and high-probability
    // escalate paths. Everything else stays on the deterministic
    // subsystems alone so the 10s sync ceiling is never at risk.
    const shouldEngageAdvisor =
      isSanctionsConfirmed ||
      overallTopClassification === 'potential' ||
      deepBrain?.verdict === 'freeze' ||
      deepBrain?.verdict === 'escalate';
    try {
      const weaponizedRes = await withTimeout(
        runWeaponizedAssessment(
          {
            mega: megaReq,
            adverseMedia: adverseMediaForBrain,
            sealProofBundle: false,
          },
          // Pass advisor:null when we are NOT engaging — otherwise
          // undefined lets brainBridge wire the default Opus advisor.
          { advisor: shouldEngageAdvisor ? undefined : null }
        ),
        shouldEngageAdvisor
          ? ADVISOR_ESCALATION_DEADLINE_MS
          : WEAPONIZED_BRAIN_DEADLINE_MS,
        null,
        'weaponized-brain'
      );
      weaponized = weaponizedRes.value;
    } catch {
      weaponized = null;
    }
  }

  // ─── Phase C. Watchlist + Asana in parallel ─────────────────────────
  // FDL Art.24 10-yr retention: every screening lands in Asana even on
  // a clean run. Cabinet Res 134/2025 Art.19: periodic internal review
  // sees every event. Running the two writes in parallel shaves ~1.5s
  // off the tail of the pipeline.
  // Default project GID points at the MLRO board the user designated
  // ("The Screenings" + "Transaction Monitor" sections live here).
  // Override via ASANA_SCREENINGS_PROJECT_GID in Netlify env if we ever
  // split boards per tenant.
  const asanaProjectGid = process.env.ASANA_SCREENINGS_PROJECT_GID || '1214124911186857';
  const asanaAnomalies = [
    ...anomalousListErrors.map((l) => `${l.list}: ${l.error}`),
    ...(screeningIntegrity !== 'complete'
      ? integrityReasons.map((r) => `integrity-${screeningIntegrity}: ${r}`)
      : []),
  ];

  // First-screen events get the full life-story deep-dive (Sample 1
  // markdown) and land in "The Screenings" section. Ad-hoc and
  // transaction-triggered screens keep the compact line-list body
  // and go to the default section. Configurable via env so the MLRO
  // can rename the section without a code change (FDL Art.24 audit
  // trail preserved via Asana's native activity log).
  const isFirstScreen =
    input.eventType === 'new_customer_onboarding' ||
    input.eventType === 'periodic_review';
  const screeningsSectionName =
    process.env.ASANA_SECTION_SCREENINGS_NAME || 'The Screenings';

  const lifeStoryInput: LifeStoryInput | undefined = isFirstScreen
    ? (() => {
        const nameVariants = searchTerms?.length ? Array.from(searchTerms) : undefined;
        const lifeStoryPerList: LifeStoryPerListRow[] = perList.map((l) => {
          const err = l.error ?? '';
          let status: LifeStoryPerListRow['status'] = 'ok';
          let note: string | undefined;
          if (err) {
            if (/served .* rows from cached ingest-cron snapshot/i.test(err)) {
              status = 'snapshot';
              note = err;
            } else if (/UN fallback/i.test(err) || /hydrated from UN snapshot/i.test(err)) {
              status = 'fallback';
              note = err;
            } else {
              status = 'error';
              note = err;
            }
          }
          return {
            list: l.list,
            status,
            topScore: l.topScore,
            hitCount: l.hitCount,
            note,
          };
        });
        const amHits = input.runAdverseMedia
          ? amRes.value.hits.slice(0, 20).map((h) => ({
              date: h.publishedAt,
              source: h.source,
              title: h.title,
              url: h.url,
              relevance: (h as { relevance?: number }).relevance,
            }))
          : [];
        const verdictGuess: LifeStoryInput['verdict'] =
          overallTopClassification === 'confirmed'
            ? 'freeze'
            : overallTopClassification === 'potential' ||
                (typeof explanation.score === 'number' && explanation.score >= 16)
              ? 'escalate'
              : typeof explanation.score === 'number' && explanation.score >= 6
                ? 'monitor'
                : 'clean';
        const reviewMonths =
          verdictGuess === 'escalate' ? 3 : verdictGuess === 'monitor' ? 6 : 12;
        return {
          screeningId: subjectId,
          ranAt,
          subjectName: input.subjectName,
          aliases: input.aliases,
          nameVariants,
          dob: input.dob,
          nationality: input.country,
          entityType: input.entityType,
          jurisdiction: input.jurisdiction,
          eventType: input.eventType,
          integrity: screeningIntegrity,
          integrityReasons,
          verdict: verdictGuess,
          compositeRisk: explanation.score,
          riskRating: explanation.rating,
          cddLevel: explanation.cddLevel,
          reviewCadenceMonths: reviewMonths,
          perList: lifeStoryPerList,
          sanctionsTopClassification: overallTopClassification,
          adverseMediaSinceDate: amSinceDate,
          adverseMediaProviders: adverseMediaProvidersUsed,
          adverseMediaHits: amHits,
          mlroActions: undefined,
        };
      })()
    : undefined;

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
          const initialAdverseHits: readonly AdverseMediaHit[] =
            input.runAdverseMedia && amRes.value.hits ? amRes.value.hits : [];
          return withTimeout(
            enrollIntoWatchlist(
              subjectId,
              input.subjectName,
              riskTier,
              metadata,
              initialAdverseHits
            ),
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
            lifeStory: lifeStoryInput,
            targetSectionName: isFirstScreen ? screeningsSectionName : undefined,
            projectGidOverride: asanaProjectGid,
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
    sectionName?: string;
    sectionError?: string;
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
    weaponized: weaponized
      ? {
          megaVerdict: weaponized.mega.verdict,
          finalVerdict: weaponized.finalVerdict,
          confidence: weaponized.confidence,
          requiresHumanReview: weaponized.requiresHumanReview,
          clampReasons: weaponized.clampReasons,
          subsystemFailures: weaponized.subsystemFailures,
          auditNarrative: weaponized.auditNarrative,
          advisor: weaponized.advisorResult
            ? {
                text: weaponized.advisorResult.text,
                advisorCallCount: weaponized.advisorResult.advisorCallCount,
                modelUsed: weaponized.advisorResult.modelUsed,
              }
            : null,
          extensions: {
            adverseMediaTopCategory:
              weaponized.extensions.adverseMedia?.topCategory ?? null,
            adverseMediaCriticalCount:
              weaponized.extensions.adverseMedia?.counts.critical ?? 0,
            explainableScore: weaponized.extensions.explanation
              ? {
                  score: weaponized.extensions.explanation.score,
                  rating: weaponized.extensions.explanation.rating,
                  cddLevel: weaponized.extensions.explanation.cddLevel,
                }
              : null,
          },
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
