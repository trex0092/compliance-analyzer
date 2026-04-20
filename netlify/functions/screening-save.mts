/**
 * Screening Command — persistent disposition save endpoint.
 *
 * POST /api/screening/save
 *   body = {
 *     // Subject identity
 *     subjectName: string,
 *     subjectId?: string,            // echoed back from /api/screening/run
 *     entityType: "individual" | "legal_entity",
 *     dob?: string,                  // dd/mm/yyyy
 *     country?: string,
 *     idNumber?: string,
 *
 *     // Event classification
 *     eventType: "new_customer_onboarding" | "periodic_review"
 *              | "transaction_trigger" | "name_change"
 *              | "adverse_media_hit" | "pep_change" | "ad_hoc",
 *
 *     // Which lists were screened + their outcome (captured from /run)
 *     listsScreened: string[],
 *     overallTopScore: number,
 *     overallTopClassification: "confirmed" | "potential" | "weak" | "none",
 *     anomalies?: Array<{ list: string; error: string }>,
 *
 *     // MLRO disposition (MUST be filled)
 *     screeningDate: string,         // dd/mm/yyyy
 *     reviewedBy: string,            // compliance officer / MLRO name
 *     outcome: "negative_no_match" | "false_positive"
 *            | "partial_match" | "confirmed_match",
 *     rationale: string,             // >= 20 chars
 *
 *     // Optional linkage
 *     runId?: string,                // if the run created an Asana task
 *     riskTier?: "high" | "medium" | "low",
 *     jurisdiction?: string,
 *   }
 *
 * Behaviour:
 *   1. Validates every field. Disposition fields are MANDATORY — the
 *      MLRO cannot save a screening event without an outcome + rationale
 *      + named reviewer (auditor's golden rule).
 *   2. Persists the ScreeningEvent record into Netlify Blob store
 *      `screening-events`, key = eventId. CAS-safe (onlyIfNew).
 *   3. ALWAYS creates an Asana task in the SCREENINGS project with the
 *      full disposition attestation — regardless of outcome. Negative
 *      no-match events also create a task so MoE audit can confirm the
 *      reviewer actually looked.
 *   4. If outcome === "confirmed_match", the task is prefixed
 *      [CONFIRMED MATCH — FREEZE IMMEDIATELY + FILE STR] and cites
 *      FDL No.10/2025 Art.12 / Art.26-27 / Art.35 + Cabinet Res
 *      74/2020 Art.4 (immediate freeze, not a 24h window — EOCN
 *      July 2025 TFS Guidance tightened to 1-2 hours maximum).
 *   5. Returns { ok: true, eventId, asanaGid }.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (compliance officer role), Art.24
 *     (10-year record retention), Art.26-27 (STR filing), Art.29
 *     (no tipping off)
 *   - Cabinet Res 134/2025 Art.14 (PEP/EDD), Art.19 (periodic internal
 *     review)
 *   - Cabinet Res 74/2020 Art.4-7 (asset freeze workflow)
 *   - Cabinet Decision No.(74)/2020 (mandatory list screening —
 *     captured by listsScreened)
 *   - FATF Rec 10 / 22 / 23
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { createAsanaTask } from '../../src/services/asanaClient';
import {
  addToWatchlist,
  deserialiseWatchlist,
  serialiseWatchlist,
  type ResolvedIdentity,
  type SerialisedWatchlist,
} from '../../src/services/screeningWatchlist';

const EVENTS_STORE = 'screening-events';
const WATCHLIST_STORE = 'screening-watchlist';
const WATCHLIST_KEY = 'current';
const MAX_BODY_SIZE = 32 * 1024;
const MAX_CAS_ATTEMPTS = 5;
const MIN_RATIONALE_LEN = 20;

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

const ENTITY_TYPES = ['individual', 'legal_entity'] as const;
const EVENT_TYPES = [
  'new_customer_onboarding',
  'periodic_review',
  'transaction_trigger',
  'name_change',
  'adverse_media_hit',
  'pep_change',
  'ad_hoc',
] as const;
const CLASSIFICATIONS = ['confirmed', 'potential', 'weak', 'none'] as const;
const OUTCOMES = [
  'negative_no_match',
  'false_positive',
  'partial_match',
  'confirmed_match',
] as const;
const RISK_TIERS = ['high', 'medium', 'low'] as const;

type EntityType = (typeof ENTITY_TYPES)[number];
type EventType = (typeof EVENT_TYPES)[number];
type Classification = (typeof CLASSIFICATIONS)[number];
type Outcome = (typeof OUTCOMES)[number];
type RiskTier = (typeof RISK_TIERS)[number];

export interface ScreeningEvent {
  eventId: string;
  subjectName: string;
  subjectId: string;
  entityType: EntityType;
  dob?: string;
  country?: string;
  idNumber?: string;
  eventType: EventType;
  listsScreened: string[];
  overallTopScore: number;
  overallTopClassification: Classification;
  anomalies?: Array<{ list: string; error: string }>;
  screeningDate: string;
  reviewedBy: string;
  outcome: Outcome;
  rationale: string;
  keyFindings?: string;
  runId?: string;
  riskTier?: RiskTier;
  jurisdiction?: string;
  secondApprover?: string;
  secondApproverRole?: string;
  savedAt: string;
  asanaGid?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface ValidatedInput extends Omit<ScreeningEvent, 'eventId' | 'savedAt' | 'asanaGid'> {}

function validateDdMmYyyy(raw: string): string | null {
  const trimmed = raw.trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (!m) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (iso) {
      const [, y, mo, d] = iso;
      return `${d}/${mo}/${y}`;
    }
    return null;
  }
  return trimmed;
}

function validateInput(
  raw: unknown
): { ok: true; input: ValidatedInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'body must be a JSON object' };
  const o = raw as Record<string, unknown>;

  if (typeof o.subjectName !== 'string' || o.subjectName.trim().length === 0) {
    return { ok: false, error: 'subjectName is required' };
  }
  if (o.subjectName.length > 200) return { ok: false, error: 'subjectName too long (max 200)' };

  if (o.subjectId !== undefined && (typeof o.subjectId !== 'string' || o.subjectId.length > 128)) {
    return { ok: false, error: 'subjectId must be a string up to 128 chars' };
  }

  if (!ENTITY_TYPES.includes(o.entityType as EntityType)) {
    return { ok: false, error: 'entityType must be "individual" | "legal_entity"' };
  }

  let dob: string | undefined;
  if (o.dob !== undefined) {
    if (typeof o.dob !== 'string' || o.dob.length > 20) {
      return { ok: false, error: 'dob must be a string up to 20 chars' };
    }
    if (o.dob.trim().length > 0) {
      const parsed = validateDdMmYyyy(o.dob);
      if (!parsed) return { ok: false, error: 'dob must be dd/mm/yyyy' };
      dob = parsed;
    }
  }

  if (o.country !== undefined && (typeof o.country !== 'string' || o.country.length > 64)) {
    return { ok: false, error: 'country must be a string up to 64 chars' };
  }
  if (o.idNumber !== undefined && (typeof o.idNumber !== 'string' || o.idNumber.length > 64)) {
    return { ok: false, error: 'idNumber must be a string up to 64 chars' };
  }

  if (!EVENT_TYPES.includes(o.eventType as EventType)) {
    return { ok: false, error: 'eventType invalid; allowed: ' + EVENT_TYPES.join(', ') };
  }

  if (!Array.isArray(o.listsScreened) || o.listsScreened.length === 0) {
    return { ok: false, error: 'listsScreened must be a non-empty array' };
  }
  if (
    (o.listsScreened as unknown[]).some((x) => typeof x !== 'string' || (x as string).length > 32)
  ) {
    return { ok: false, error: 'listsScreened entries must be short strings' };
  }

  if (typeof o.overallTopScore !== 'number' || !Number.isFinite(o.overallTopScore)) {
    return { ok: false, error: 'overallTopScore must be a finite number' };
  }
  if (o.overallTopScore < 0 || o.overallTopScore > 1) {
    return { ok: false, error: 'overallTopScore must be between 0 and 1' };
  }

  if (!CLASSIFICATIONS.includes(o.overallTopClassification as Classification)) {
    return {
      ok: false,
      error: 'overallTopClassification must be one of: ' + CLASSIFICATIONS.join(', '),
    };
  }

  let anomalies: Array<{ list: string; error: string }> | undefined;
  if (o.anomalies !== undefined) {
    if (!Array.isArray(o.anomalies)) {
      return { ok: false, error: 'anomalies must be an array' };
    }
    const raw = o.anomalies as unknown[];
    const parsed: Array<{ list: string; error: string }> = [];
    for (const a of raw) {
      if (!a || typeof a !== 'object')
        return { ok: false, error: 'anomaly entries must be objects' };
      const entry = a as Record<string, unknown>;
      if (typeof entry.list !== 'string' || typeof entry.error !== 'string') {
        return { ok: false, error: 'anomaly entries must have string list + error' };
      }
      parsed.push({ list: entry.list.slice(0, 32), error: entry.error.slice(0, 256) });
    }
    anomalies = parsed;
  }

  if (typeof o.screeningDate !== 'string') {
    return { ok: false, error: 'screeningDate is required (dd/mm/yyyy)' };
  }
  const screeningDate = validateDdMmYyyy(o.screeningDate);
  if (!screeningDate) return { ok: false, error: 'screeningDate must be dd/mm/yyyy' };

  if (typeof o.reviewedBy !== 'string' || o.reviewedBy.trim().length === 0) {
    return {
      ok: false,
      error: 'reviewedBy is required — name the compliance officer / MLRO',
    };
  }
  if (o.reviewedBy.length > 128) return { ok: false, error: 'reviewedBy too long (max 128)' };

  if (!OUTCOMES.includes(o.outcome as Outcome)) {
    return {
      ok: false,
      error:
        'outcome must be one of: ' + OUTCOMES.join(', ') + ' — MLRO must attest (FDL Art.20-21)',
    };
  }

  if (typeof o.rationale !== 'string' || o.rationale.trim().length < MIN_RATIONALE_LEN) {
    return {
      ok: false,
      error: `rationale is required and must be at least ${MIN_RATIONALE_LEN} characters — document the full basis for your decision (auditor requirement)`,
    };
  }
  if (o.rationale.length > 4000) return { ok: false, error: 'rationale too long (max 4000)' };

  let keyFindings: string | undefined;
  if (o.keyFindings !== undefined) {
    if (typeof o.keyFindings !== 'string') {
      return { ok: false, error: 'keyFindings must be a string' };
    }
    if (o.keyFindings.length > 4000) {
      return { ok: false, error: 'keyFindings too long (max 4000)' };
    }
    const trimmed = o.keyFindings.trim();
    if (trimmed.length > 0) keyFindings = trimmed;
  }

  if (o.runId !== undefined && (typeof o.runId !== 'string' || o.runId.length > 64)) {
    return { ok: false, error: 'runId must be a string up to 64 chars' };
  }
  if (o.riskTier !== undefined && !RISK_TIERS.includes(o.riskTier as RiskTier)) {
    return { ok: false, error: 'riskTier must be "high" | "medium" | "low"' };
  }
  if (
    o.jurisdiction !== undefined &&
    (typeof o.jurisdiction !== 'string' || o.jurisdiction.length > 32)
  ) {
    return { ok: false, error: 'jurisdiction must be a string up to 32 chars' };
  }

  // Four-eyes gate — partial/confirmed matches require an independent
  // second approver (FDL Art.20-21; Cabinet Res 134/2025 Art.19).
  let secondApprover: string | undefined;
  let secondApproverRole: string | undefined;
  if (o.secondApprover !== undefined) {
    if (typeof o.secondApprover !== 'string' || o.secondApprover.length > 128) {
      return { ok: false, error: 'secondApprover must be a string up to 128 chars' };
    }
    const trimmed = o.secondApprover.trim();
    if (trimmed.length > 0) secondApprover = trimmed;
  }
  if (o.secondApproverRole !== undefined) {
    if (typeof o.secondApproverRole !== 'string' || o.secondApproverRole.length > 128) {
      return { ok: false, error: 'secondApproverRole must be a string up to 128 chars' };
    }
    const trimmed = o.secondApproverRole.trim();
    if (trimmed.length > 0) secondApproverRole = trimmed;
  }
  const outcome = o.outcome as Outcome;
  const requiresFourEyes = outcome === 'partial_match' || outcome === 'confirmed_match';
  if (requiresFourEyes) {
    if (!secondApprover) {
      return {
        ok: false,
        error:
          'secondApprover is required for partial / confirmed matches (four-eyes rule; FDL Art.20-21, Cabinet Res 134/2025 Art.19)',
      };
    }
    if (!secondApproverRole) {
      return {
        ok: false,
        error: 'secondApproverRole is required for partial / confirmed matches (four-eyes rule)',
      };
    }
    const reviewer = (o.reviewedBy as string).trim().toLowerCase();
    if (secondApprover.toLowerCase() === reviewer) {
      return {
        ok: false,
        error: 'secondApprover must be a different person from reviewedBy (four-eyes rule)',
      };
    }
  }

  return {
    ok: true,
    input: {
      subjectName: o.subjectName.trim(),
      subjectId: typeof o.subjectId === 'string' ? o.subjectId.trim() : '',
      entityType: o.entityType as EntityType,
      dob,
      country: typeof o.country === 'string' ? o.country.trim() : undefined,
      idNumber: typeof o.idNumber === 'string' ? o.idNumber.trim() : undefined,
      eventType: o.eventType as EventType,
      listsScreened: (o.listsScreened as string[]).map((l) => l.trim()),
      overallTopScore: o.overallTopScore,
      overallTopClassification: o.overallTopClassification as Classification,
      anomalies,
      screeningDate,
      reviewedBy: o.reviewedBy.trim(),
      outcome: o.outcome as Outcome,
      rationale: o.rationale.trim(),
      keyFindings,
      runId: typeof o.runId === 'string' ? o.runId.trim() : undefined,
      riskTier: o.riskTier as RiskTier | undefined,
      jurisdiction: typeof o.jurisdiction === 'string' ? o.jurisdiction.trim() : undefined,
      secondApprover,
      secondApproverRole,
    },
  };
}

// ---------------------------------------------------------------------------
// Persistence — one blob per event (eventId is the key). Append-only.
// ---------------------------------------------------------------------------

function newEventId(): string {
  return (
    'SE-' +
    Date.now().toString(36).toUpperCase() +
    '-' +
    Math.random().toString(36).slice(2, 10).toUpperCase()
  );
}

async function saveEvent(event: ScreeningEvent): Promise<{ ok: boolean; error?: string }> {
  try {
    const store = getStore(EVENTS_STORE);
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      try {
        const res: unknown = await (
          store as unknown as {
            setJSON: (key: string, value: unknown, opts?: unknown) => Promise<unknown>;
          }
        ).setJSON(event.eventId, event, { onlyIfNew: true });
        const landed =
          res === null || res === undefined
            ? true
            : typeof res === 'object' && 'modified' in (res as Record<string, unknown>)
              ? (res as { modified: boolean }).modified === true
              : res !== false;
        if (landed) return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'setJSON failed' };
      }
      // If onlyIfNew blocked, bump the id and retry
      event.eventId = newEventId();
    }
    return { ok: false, error: 'could not allocate unique eventId after retries' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'blob store unavailable' };
  }
}

// ---------------------------------------------------------------------------
// Auto-enrol — every screen enrols the subject in daily monitoring.
// Product requirement: "DAILY MONITORING FOR ALL THE SCREENED SUBJECTS
// (ENTITIES AND INDIVIDUALS) AND ALERTS ... IF SOMETHING HAPPEN RELATED
// TO THE RISKS AND SANCTIONS APPEAR." — there is no opt-out.
// FDL Art.20-21 + Cabinet Res 134/2025 Art.19 (ongoing monitoring).
// ---------------------------------------------------------------------------

function subjectRiskTier(event: ScreeningEvent): 'high' | 'medium' | 'low' {
  if (event.outcome === 'confirmed_match' || event.outcome === 'partial_match') return 'high';
  return event.riskTier ?? 'medium';
}

function buildResolvedIdentity(event: ScreeningEvent): ResolvedIdentity | undefined {
  const identity: ResolvedIdentity = {};
  if (event.dob) identity.dob = event.dob;
  if (event.country) identity.nationality = event.country.toUpperCase().slice(0, 4);
  if (event.idNumber) {
    identity.idNumber = event.idNumber;
    identity.idType = 'other';
  }
  identity.resolvedBy = event.reviewedBy;
  identity.resolvedAtIso = event.savedAt;
  identity.resolutionNote = `Enrolled from screening event ${event.eventId} (${event.outcome})`;
  const hasAnyIdField = identity.dob || identity.nationality || identity.idNumber;
  return hasAnyIdField ? identity : undefined;
}

async function autoEnrolInWatchlist(
  event: ScreeningEvent
): Promise<{ ok: boolean; enrolled: boolean; alreadyEnrolled?: boolean; error?: string }> {
  const subjectId = event.subjectId || event.eventId;
  try {
    const store = getStore(WATCHLIST_STORE);
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const bucket =
        (await (
          store as unknown as {
            getWithMetadata?: (
              key: string,
              opts: unknown
            ) => Promise<{ data: unknown; etag?: string } | null>;
          }
        ).getWithMetadata?.(WATCHLIST_KEY, { type: 'json' })) ?? null;
      const rawData = bucket?.data ?? null;
      const etag = bucket?.etag ?? null;
      const wl = deserialiseWatchlist(rawData);
      if (wl.entries.has(subjectId)) {
        return { ok: true, enrolled: false, alreadyEnrolled: true };
      }
      addToWatchlist(wl, {
        id: subjectId,
        subjectName: event.subjectName,
        riskTier: subjectRiskTier(event),
        metadata: {
          sourceEventId: event.eventId,
          enrolledVia: 'screening-save',
          enrolledAt: event.savedAt,
          ...(event.jurisdiction ? { jurisdiction: event.jurisdiction } : {}),
        },
        resolvedIdentity: buildResolvedIdentity(event),
      });

      const opts = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
      try {
        const res: unknown = await (
          store as unknown as {
            setJSON: (key: string, value: unknown, opts?: unknown) => Promise<unknown>;
          }
        ).setJSON(WATCHLIST_KEY, serialiseWatchlist(wl) as SerialisedWatchlist, opts);
        const landed =
          res === null || res === undefined
            ? true
            : typeof res === 'object' && 'modified' in (res as Record<string, unknown>)
              ? (res as { modified: boolean }).modified === true
              : res !== false;
        if (landed) return { ok: true, enrolled: true };
      } catch (err) {
        return {
          ok: false,
          enrolled: false,
          error: err instanceof Error ? err.message : 'setJSON failed',
        };
      }
      // CAS conflict — re-read and retry.
    }
    return { ok: false, enrolled: false, error: 'watchlist CAS contention' };
  } catch (err) {
    return {
      ok: false,
      enrolled: false,
      error: err instanceof Error ? err.message : 'blob store unavailable',
    };
  }
}

// ---------------------------------------------------------------------------
// Asana — every saved event creates a task (audit attestation)
// ---------------------------------------------------------------------------

function outcomeTag(outcome: Outcome): string {
  switch (outcome) {
    case 'confirmed_match':
      return '[CONFIRMED MATCH — FREEZE IMMEDIATELY + FILE STR]';
    case 'partial_match':
      return '[PARTIAL MATCH — ESCALATED]';
    case 'false_positive':
      return '[FALSE POSITIVE — DISMISSED]';
    case 'negative_no_match':
      return '[NEGATIVE — NO MATCH]';
  }
}

async function postDispositionAsana(
  event: ScreeningEvent
): Promise<{ ok: boolean; gid?: string; error?: string }> {
  const projectId = process.env.ASANA_SCREENINGS_PROJECT_GID || '1213759768596515';
  if (!process.env.ASANA_TOKEN && !process.env.ASANA_ACCESS_TOKEN && !process.env.ASANA_API_TOKEN) {
    return { ok: false, error: 'ASANA_TOKEN not configured' };
  }

  const lines: string[] = [];
  lines.push(`Event ID: ${event.eventId}`);
  lines.push(`Saved at: ${event.savedAt}`);
  lines.push('');
  lines.push('— Subject —');
  lines.push(`Name: ${event.subjectName}`);
  lines.push(`Subject ID: ${event.subjectId || '(auto)'}`);
  lines.push(`Entity type: ${event.entityType}`);
  if (event.dob) lines.push(`DoB / registration: ${event.dob}`);
  if (event.country) lines.push(`Country: ${event.country}`);
  if (event.idNumber) lines.push(`ID / register no.: ${event.idNumber}`);
  if (event.jurisdiction) lines.push(`Jurisdiction: ${event.jurisdiction}`);
  if (event.riskTier) lines.push(`Risk tier: ${event.riskTier}`);
  lines.push('');
  lines.push('— Screening —');
  lines.push(`Event type: ${event.eventType}`);
  lines.push(`Lists screened: ${event.listsScreened.join(', ')}`);
  lines.push(
    `Top score: ${(event.overallTopScore * 100).toFixed(1)}% (${event.overallTopClassification})`
  );
  if (event.anomalies && event.anomalies.length > 0) {
    lines.push('Anomalies during screening:');
    for (const a of event.anomalies) lines.push(`  - ${a.list}: ${a.error}`);
  }
  lines.push('');
  lines.push('— MLRO Disposition (attestation) —');
  lines.push(`Screening date: ${event.screeningDate}`);
  lines.push(`Reviewed by: ${event.reviewedBy}`);
  if (event.secondApprover) {
    lines.push(
      `Second approver (four-eyes): ${event.secondApprover}` +
        (event.secondApproverRole ? ` — ${event.secondApproverRole}` : '')
    );
  }
  lines.push(`Outcome: ${event.outcome.toUpperCase()}`);
  lines.push('Rationale:');
  lines.push(event.rationale);
  if (event.keyFindings) {
    lines.push('');
    lines.push('Key findings:');
    lines.push(event.keyFindings);
  }
  if (event.runId) {
    lines.push('');
    lines.push(`Linked run: ${event.runId}`);
  }
  lines.push('');
  lines.push('— Legal notice acknowledged by reviewer —');
  lines.push(
    'Confidential compliance record — do not disclose to the subject or any unauthorised party (FDL No.10/2025 Art.29 no tipping off; FDL Art.24 10-year retention).'
  );
  lines.push(
    'Data basis: processed under UAE AML/CFT/CPF regime (FDL No.10/2025; Cabinet Res 134/2025) and UAE PDPL Federal Decree-Law No.45/2021 Art.6(1)(c) — legal-obligation basis.'
  );
  lines.push(
    'AI / automation transparency: screening used classical deterministic algorithms only (Jaro-Winkler, Levenshtein, Soundex, Double Metaphone, token-set). No generative AI was used in the match decision. Human MLRO retains final responsibility.'
  );
  if (event.outcome === 'confirmed_match') {
    lines.push('');
    lines.push(
      'FREEZE FUNDS IMMEDIATELY and FILE STR WITHOUT DELAY — FDL No.10/2025 Art.12, Art.26-27, Art.35; Cabinet Res 74/2020 Art.4 + EOCN TFS Guidance July 2025 (freeze within 1-2 hours of confirmation). Notify EOCN without delay; file CNMR within 5 business days (Cabinet Res 74/2020 Art.6). Applies equally where the subject is convicted of — or reasonably suspected of — money laundering, terrorism financing, or proliferation financing (FDL Art.35; Cabinet Res 156/2025).'
    );
  }
  lines.push('');
  lines.push(
    'Regulatory basis: FDL No.10/2025 Art.20-21 (CO duties), Art.24 (10yr retention), Art.26-27 (STR), Art.29 (no tipping off), Art.35 (TFS); Cabinet Res 134/2025 Art.14, Art.19; Cabinet Res 74/2020 Art.4-7; Cabinet Decision No.(74)/2020 (mandatory list screening); Cabinet Res 71/2024 (penalties); FATF Rec 10/22/23.'
  );
  lines.push('');
  lines.push('Source: /api/screening/save (Screening Command page).');
  lines.push('Do NOT notify the subject — FDL Art.29 no tipping off.');

  const tag = outcomeTag(event.outcome);
  const name = `${tag} ${event.subjectName} — ${event.eventType}`;

  const tags = ['screening-disposition', event.outcome, `event-${event.eventType}`];
  if (event.overallTopClassification !== 'none') tags.push(event.overallTopClassification);
  if (event.anomalies && event.anomalies.length > 0) tags.push('anomaly');

  return createAsanaTask({
    name,
    notes: lines.join('\n'),
    projects: [projectId],
    tags,
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method not allowed' }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    max: 30,
    clientIp: context.ip,
    namespace: 'screening-save',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

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

  const v = validateInput(parsed);
  if (!v.ok) return jsonResponse({ ok: false, error: v.error }, { status: 400 });

  const event: ScreeningEvent = {
    eventId: newEventId(),
    savedAt: new Date().toISOString(),
    ...v.input,
  };

  const persist = await saveEvent(event);
  if (!persist.ok) {
    return jsonResponse(
      { ok: false, error: 'persist failed: ' + (persist.error || 'unknown') },
      { status: 500 }
    );
  }

  const asanaProjectGid = process.env.ASANA_SCREENINGS_PROJECT_GID || '1213759768596515';
  const asanaRes = await postDispositionAsana(event);
  if (asanaRes.ok && asanaRes.gid) event.asanaGid = asanaRes.gid;
  const asana = {
    ...asanaRes,
    projectGid: asanaProjectGid,
    projectName: 'Screening Command — Sanctions',
  };

  // Auto-enrol in daily monitoring. Product requirement is no opt-out —
  // every screened subject (individual or legal entity, any outcome,
  // including negative_no_match) is added to the watchlist so the
  // sanctions-ingest cron can alert immediately on any future risk
  // event. Enrolment failure is logged but never blocks the screening
  // save itself — the event record + Asana attestation is the primary
  // compliance artefact.
  const enrolRes = await autoEnrolInWatchlist(event);

  return jsonResponse({
    ok: true,
    eventId: event.eventId,
    savedAt: event.savedAt,
    asana,
    monitoring: {
      enrolled: enrolRes.enrolled,
      alreadyEnrolled: enrolRes.alreadyEnrolled === true,
      ok: enrolRes.ok,
      error: enrolRes.error,
    },
  });
};

export const __test__ = {
  validateInput,
  outcomeTag,
};

export const config: Config = {
  path: '/api/screening/save',
  method: ['POST', 'OPTIONS'],
};
