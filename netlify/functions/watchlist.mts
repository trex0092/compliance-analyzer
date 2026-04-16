/**
 * Screening Watchlist API — CRUD endpoint for the ongoing monitoring system.
 *
 * Provides three operations:
 *
 *   GET  /api/watchlist              → returns the current watchlist
 *   POST /api/watchlist   body={action: "add", id, subjectName, ...}
 *                                     → add a subject (one-time entry)
 *   POST /api/watchlist   body={action: "remove", id}
 *                                     → remove a subject
 *   POST /api/watchlist   body={action: "replace", watchlist: {...}}
 *                                     → full replace (used by the scheduled
 *                                       monitoring script to save state back)
 *
 * Storage: Netlify Blobs store `screening-watchlist` — same persistence
 * backend pattern the rest of the Netlify Functions use. Single key
 * "current" holds the entire watchlist JSON. This is fine for up to a
 * few thousand subjects; if you grow beyond that, partition by customer.
 *
 * Auth: Bearer HAWKEYE_BRAIN_TOKEN (same scheme as /api/brain and other
 * compliance endpoints). Both the browser UI and the GitHub Actions
 * scheduled script present this token.
 *
 * Rate limit: 100 req / 15min per IP. Add/remove actions are typically
 * a few per day from the UI; the scheduled script's replace runs twice
 * per day. 100 is plenty of headroom.
 *
 * Regulatory basis:
 *   - FATF Rec 10 (ongoing customer due diligence)
 *   - Cabinet Res 134/2025 Art.19 (periodic internal review)
 *   - FDL No.10/2025 Art.24 (audit trail retention — the watchlist
 *     state itself is a record under the retention obligation)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';
import {
  createWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  serialiseWatchlist,
  deserialiseWatchlist,
  watchlistSize,
  type RiskTier,
  type SerialisedWatchlist,
  type WatchlistEntry,
} from '../../src/services/screeningWatchlist';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BLOB_STORE_NAME = 'screening-watchlist';
const BLOB_KEY = 'current';
const MAX_BODY_SIZE = 256 * 1024; // 256 KB — generous for ~5000 subjects

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':
    process.env.HAWKEYE_ALLOWED_ORIGIN ?? 'https://hawkeye-sterling-v2.netlify.app',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
// Storage adapter — Netlify Blobs with in-memory fallback for dev
// ---------------------------------------------------------------------------

let memoryStore: SerialisedWatchlist | null = null;

async function loadFromStore(): Promise<SerialisedWatchlist> {
  try {
    const store = getStore(BLOB_STORE_NAME);
    const raw = (await store.get(BLOB_KEY, { type: 'json' })) as SerialisedWatchlist | null;
    if (raw && typeof raw === 'object' && 'version' in raw && Array.isArray(raw.entries)) {
      return raw;
    }
  } catch {
    // Netlify Blobs unavailable — fall through to memory fallback
  }
  return memoryStore ?? { version: 1, entries: [] };
}

async function saveToStore(data: SerialisedWatchlist): Promise<void> {
  try {
    const store = getStore(BLOB_STORE_NAME);
    await store.setJSON(BLOB_KEY, data);
  } catch {
    // Dev / local / Blobs unavailable — persist to process memory
    memoryStore = data;
  }
}

// ---------------------------------------------------------------------------
// Request body validation
// ---------------------------------------------------------------------------

type PostAction =
  | {
      action: 'add';
      id: string;
      subjectName: string;
      riskTier?: RiskTier;
      metadata?: Record<string, string | number | boolean>;
    }
  | { action: 'remove'; id: string }
  | { action: 'replace'; watchlist: SerialisedWatchlist };

function validatePostBody(
  input: unknown
): { ok: true; body: PostAction } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const raw = input as Record<string, unknown>;
  const action = raw.action;

  if (action === 'add') {
    if (typeof raw.id !== 'string' || raw.id.trim().length === 0) {
      return { ok: false, error: 'add: id must be a non-empty string' };
    }
    if (raw.id.length > 128) {
      return { ok: false, error: 'add: id too long (max 128 chars)' };
    }
    if (typeof raw.subjectName !== 'string' || raw.subjectName.trim().length === 0) {
      return { ok: false, error: 'add: subjectName must be a non-empty string' };
    }
    if (raw.subjectName.length > 200) {
      return { ok: false, error: 'add: subjectName too long (max 200 chars)' };
    }
    if (raw.riskTier !== undefined && !['high', 'medium', 'low'].includes(raw.riskTier as string)) {
      return { ok: false, error: 'add: riskTier must be "high" | "medium" | "low"' };
    }
    if (
      raw.metadata !== undefined &&
      (typeof raw.metadata !== 'object' || raw.metadata === null || Array.isArray(raw.metadata))
    ) {
      return { ok: false, error: 'add: metadata must be an object' };
    }
    return {
      ok: true,
      body: {
        action: 'add',
        id: raw.id.trim(),
        subjectName: raw.subjectName.trim(),
        riskTier: raw.riskTier as RiskTier | undefined,
        metadata: raw.metadata as Record<string, string | number | boolean> | undefined,
      },
    };
  }

  if (action === 'remove') {
    if (typeof raw.id !== 'string' || raw.id.trim().length === 0) {
      return { ok: false, error: 'remove: id must be a non-empty string' };
    }
    return { ok: true, body: { action: 'remove', id: raw.id.trim() } };
  }

  if (action === 'replace') {
    if (!raw.watchlist || typeof raw.watchlist !== 'object') {
      return { ok: false, error: 'replace: watchlist must be an object' };
    }
    const wl = raw.watchlist as Record<string, unknown>;
    if (wl.version !== 1) {
      return { ok: false, error: 'replace: watchlist version must be 1' };
    }
    if (!Array.isArray(wl.entries)) {
      return { ok: false, error: 'replace: watchlist.entries must be an array' };
    }
    return {
      ok: true,
      body: {
        action: 'replace',
        watchlist: { version: 1, entries: wl.entries as WatchlistEntry[] },
      },
    };
  }

  return {
    ok: false,
    error: `unknown action "${String(action)}" — expected "add", "remove", or "replace"`,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async (req: Request, context: Context): Promise<Response> => {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Rate limit — 100 req / 15 min per IP
  const rateLimited = await checkRateLimit(req, {
    max: 100,
    clientIp: context.ip,
  });
  if (rateLimited) return rateLimited;

  // Auth
  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  // ─── GET /api/watchlist ────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const data = await loadFromStore();
      return jsonResponse({
        ok: true,
        count: data.entries.length,
        watchlist: data,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      return jsonResponse({ ok: false, error: `load failed: ${message}` }, { status: 500 });
    }
  }

  // ─── POST /api/watchlist ───────────────────────────────────────────────
  if (req.method === 'POST') {
    // Preflight Content-Length — refuse before buffering if already
    // declared too large.
    const contentLengthHeader = req.headers.get('content-length');
    if (contentLengthHeader) {
      const declared = Number(contentLengthHeader);
      if (Number.isFinite(declared) && declared > MAX_BODY_SIZE) {
        return jsonResponse({ ok: false, error: 'request body too large' }, { status: 413 });
      }
    }
    // Parse body with size cap
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

    const validation = validatePostBody(parsed);
    if (!validation.ok) {
      return jsonResponse({ ok: false, error: validation.error }, { status: 400 });
    }
    const body = validation.body;

    // Load current state
    const current = await loadFromStore();
    const wl = deserialiseWatchlist(current);

    // Dispatch on action
    try {
      if (body.action === 'add') {
        // Reject duplicates with 409 Conflict
        if (wl.entries.has(body.id)) {
          return jsonResponse(
            { ok: false, error: `subject "${body.id}" already exists in watchlist` },
            { status: 409 }
          );
        }
        const entry = addToWatchlist(wl, {
          id: body.id,
          subjectName: body.subjectName,
          riskTier: body.riskTier,
          metadata: body.metadata,
        });
        await saveToStore(serialiseWatchlist(wl));
        return jsonResponse({ ok: true, action: 'add', entry, size: watchlistSize(wl) });
      }

      if (body.action === 'remove') {
        const removed = removeFromWatchlist(wl, body.id);
        if (!removed) {
          return jsonResponse(
            { ok: false, error: `subject "${body.id}" not found in watchlist` },
            { status: 404 }
          );
        }
        await saveToStore(serialiseWatchlist(wl));
        return jsonResponse({ ok: true, action: 'remove', id: body.id, size: watchlistSize(wl) });
      }

      if (body.action === 'replace') {
        await saveToStore(body.watchlist);
        return jsonResponse({
          ok: true,
          action: 'replace',
          size: body.watchlist.entries.length,
        });
      }

      // Unreachable due to validation, but TS needs the exhaustiveness guard.
      return jsonResponse({ ok: false, error: 'unknown action' }, { status: 400 });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      return jsonResponse({ ok: false, error: `write failed: ${message}` }, { status: 500 });
    }
  }

  return jsonResponse({ ok: false, error: 'method not allowed' }, { status: 405 });
};

// ---------------------------------------------------------------------------
// Pure dispatch helper — exposed via __test__ for unit tests
// ---------------------------------------------------------------------------

/**
 * Apply an action to a current watchlist state without touching any
 * I/O (no Blobs, no HTTP, no auth). Returns the updated state + the
 * response shape that the HTTP handler will serialise. Used by tests
 * to exercise the business logic without needing Netlify runtime mocks.
 */
export type ApplyActionResult =
  | { ok: true; status: number; updated: SerialisedWatchlist; response: unknown }
  | { ok: false; status: number; error: string };

export function applyAction(current: SerialisedWatchlist, action: PostAction): ApplyActionResult {
  const wl = deserialiseWatchlist(current);

  if (action.action === 'add') {
    if (wl.entries.has(action.id)) {
      return {
        ok: false,
        status: 409,
        error: `subject "${action.id}" already exists in watchlist`,
      };
    }
    const entry = addToWatchlist(wl, {
      id: action.id,
      subjectName: action.subjectName,
      riskTier: action.riskTier,
      metadata: action.metadata,
    });
    return {
      ok: true,
      status: 200,
      updated: serialiseWatchlist(wl),
      response: { ok: true, action: 'add', entry, size: watchlistSize(wl) },
    };
  }

  if (action.action === 'remove') {
    const removed = removeFromWatchlist(wl, action.id);
    if (!removed) {
      return {
        ok: false,
        status: 404,
        error: `subject "${action.id}" not found in watchlist`,
      };
    }
    return {
      ok: true,
      status: 200,
      updated: serialiseWatchlist(wl),
      response: { ok: true, action: 'remove', id: action.id, size: watchlistSize(wl) },
    };
  }

  if (action.action === 'replace') {
    return {
      ok: true,
      status: 200,
      updated: action.watchlist,
      response: { ok: true, action: 'replace', size: action.watchlist.entries.length },
    };
  }

  // Exhaustiveness guard
  const exhaustive: never = action;
  return { ok: false, status: 400, error: `unknown action: ${JSON.stringify(exhaustive)}` };
}

/** Internal exports for tests only — not part of the public surface. */
export const __test__ = {
  validatePostBody,
  applyAction,
};

// ---------------------------------------------------------------------------
// Netlify Function config
// ---------------------------------------------------------------------------

export const config: Config = {
  path: '/api/watchlist',
  method: ['GET', 'POST', 'OPTIONS'],
};
