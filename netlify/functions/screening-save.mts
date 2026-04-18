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
 *      [FREEZE-24H] and explicitly cites Cabinet Res 74/2020 Art.4-7
 *      (24-hour freeze deadline).
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

const EVENTS_STORE = 'screening-events';
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
  runId?: string;
  riskTier?: RiskTier;
  jurisdiction?: string;
  savedAt: string;
  asanaGid?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface ValidatedInput
  extends Omit<ScreeningEvent, 'eventId' | 'savedAt' | 'asanaGid'> {}

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

  if (
    o.subjectId !== undefined &&
    (typeof o.subjectId !== 'string' || o.subjectId.length > 128)
  ) {
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
    (o.listsScreened as unknown[]).some(
      (x) => typeof x !== 'string' || (x as string).length > 32
    )
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
      if (!a || typeof a !== 'object') return { ok: false, error: 'anomaly entries must be objects' };
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
        'outcome must be one of: ' +
        OUTCOMES.join(', ') +
        ' — MLRO must attest (FDL Art.20-21)',
    };
  }

  if (typeof o.rationale !== 'string' || o.rationale.trim().length < MIN_RATIONALE_LEN) {
    return {
      ok: false,
      error: `rationale is required and must be at least ${MIN_RATIONALE_LEN} characters — document the full basis for your decision (auditor requirement)`,
    };
  }
  if (o.rationale.length > 4000) return { ok: false, error: 'rationale too long (max 4000)' };

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
      runId: typeof o.runId === 'string' ? o.runId.trim() : undefined,
      riskTier: o.riskTier as RiskTier | undefined,
      jurisdiction: typeof o.jurisdiction === 'string' ? o.jurisdiction.trim() : undefined,
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

async function saveEvent(
  event: ScreeningEvent
): Promise<{ ok: boolean; error?: string }> {
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
          res == null
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
// Asana — every saved event creates a task (audit attestation)
// ---------------------------------------------------------------------------

function outcomeTag(outcome: Outcome): string {
  switch (outcome) {
    case 'confirmed_match':
      return '[CONFIRMED MATCH — FREEZE-24H]';
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
  lines.push(`Outcome: ${event.outcome.toUpperCase()}`);
  lines.push('Rationale:');
  lines.push(event.rationale);
  if (event.runId) {
    lines.push('');
    lines.push(`Linked run: ${event.runId}`);
  }
  lines.push('');
  lines.push(
    'Regulatory basis: FDL No.10/2025 Art.20-21 (CO duties), Art.24 (10yr retention), Art.26-27 (STR), Art.29 (no tipping off); Cabinet Res 134/2025 Art.14, Art.19; Cabinet Res 74/2020 Art.4-7; Cabinet Decision No.(74)/2020 (mandatory list screening).'
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

  const asana = await postDispositionAsana(event);
  if (asana.ok && asana.gid) event.asanaGid = asana.gid;

  return jsonResponse({
    ok: true,
    eventId: event.eventId,
    savedAt: event.savedAt,
    asana,
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
