/**
 * Ongoing Screening Opt-In endpoint (PR-3 / finding #1 + #3).
 *
 * POST /api/ongoing-screening-optin
 *   body = {
 *     subjectName: string,           // required, >=1 char, <=200 chars
 *     subjectId?: string,            // optional, client-stable id; falls
 *                                    // back to a canonicalised name hash
 *                                    // when absent
 *     entityType: "individual" | "organisation" | "unspecified",
 *     ongoingScreening: boolean,     // true = opt in, false = opt out
 *   }
 *   → { ok: true, count }
 *
 * Why this exists: the client-side TFS2 records live in localStorage and
 * are per-browser. Without a server-side opt-in store, the banner cannot
 * show a consistent "N subjects on daily re-screen" count across devices
 * for the same MLRO team. This endpoint maintains a single blob
 * (ongoing-screening-opt-ins / "current") with CAS-safe updates so the
 * status endpoint can answer authoritatively.
 *
 * FDL Art.29 — no tipping off. The store intentionally holds only the
 * minimum needed to count and de-dupe subjects (name + entity type +
 * last-seen timestamp). Hit details and screening results are NEVER
 * written here — those remain in the screening-events store guarded by
 * four-eyes approval.
 *
 * Security design:
 *   - Bearer-token auth via the shared authenticate middleware (same
 *     contract as /api/screening/save).
 *   - Rate-limited to 60 writes/IP/minute to prevent a malicious or
 *     buggy client from inflating the count via rapid toggles.
 *   - CAS envelope via setJSON { onlyIfMatch } on getWithMetadata — the
 *     read-modify-write pattern used across src/services for every
 *     durable store.
 *   - Never reflects the payload back verbatim. Returns count only.
 *
 * Regulatory basis:
 *   - FDL No.(10)/2025 Art.20-21 — CO situational awareness across
 *     all the devices the MLRO team uses.
 *   - FDL No.(10)/2025 Art.24 — 10-yr retention (CAS-envelope write).
 *   - FDL No.(10)/2025 Art.29 — no tipping off (minimum-data store).
 *   - FATF Rec 10 — ongoing CDD (the opt-in is the MLRO's active
 *     commitment to re-screen).
 */
import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';
import {
  normaliseEntityType,
  type EntityTypeSupported,
} from '../../src/domain/constants';

const STORE_NAME = 'ongoing-screening-opt-ins';
const STORE_KEY = 'current';
const MAX_BODY_SIZE = 4 * 1024;
const MAX_CAS_ATTEMPTS = 5;
const MAX_STORE_SUBJECTS = 10_000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':
    process.env.HAWKEYE_ALLOWED_ORIGIN ?? 'https://hawkeye-sterling-v2.netlify.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '600',
  Vary: 'Origin',
} as const;

interface OptInRecord {
  subjectName: string;
  entityType: EntityTypeSupported;
  lastSeenAt: string;
}

export interface OptInStoreEnvelope {
  version: 1;
  updatedAt: string;
  subjects: Record<string, OptInRecord>;
}

interface ValidatedBody {
  key: string;
  subjectName: string;
  entityType: EntityTypeSupported;
  ongoingScreening: boolean;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init.headers ?? {}) },
  });
}

export function canonicaliseKey(subjectId: string | undefined, subjectName: string): string {
  const id = typeof subjectId === 'string' ? subjectId.trim() : '';
  if (id.length > 0) return 'id:' + id.slice(0, 128).toLowerCase();
  const name = subjectName.trim().toLowerCase().replace(/\s+/g, ' ');
  return 'name:' + name.slice(0, 200);
}

function validateBody(
  raw: unknown
): { ok: true; value: ValidatedBody } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'body must be a JSON object' };
  const o = raw as Record<string, unknown>;

  if (typeof o.subjectName !== 'string' || o.subjectName.trim().length === 0) {
    return { ok: false, error: 'subjectName is required' };
  }
  if (o.subjectName.length > 200) return { ok: false, error: 'subjectName too long (max 200)' };

  if (o.subjectId !== undefined && (typeof o.subjectId !== 'string' || o.subjectId.length > 128)) {
    return { ok: false, error: 'subjectId must be a string up to 128 chars' };
  }

  const entityType = normaliseEntityType(o.entityType);
  if (entityType === null) {
    return { ok: false, error: 'entityType must be individual | organisation | unspecified' };
  }

  if (typeof o.ongoingScreening !== 'boolean') {
    return { ok: false, error: 'ongoingScreening must be a boolean' };
  }

  return {
    ok: true,
    value: {
      key: canonicaliseKey(typeof o.subjectId === 'string' ? o.subjectId : undefined, o.subjectName),
      subjectName: o.subjectName.trim(),
      entityType,
      ongoingScreening: o.ongoingScreening,
    },
  };
}

export function applyOptIn(
  prior: OptInStoreEnvelope | null,
  body: ValidatedBody,
  now: Date = new Date(),
): OptInStoreEnvelope {
  const subjects: Record<string, OptInRecord> =
    prior && prior.subjects && typeof prior.subjects === 'object' ? { ...prior.subjects } : {};

  if (body.ongoingScreening) {
    // Enforce the safety cap defensively — this should never trip under
    // normal use (a tenant with >10k ongoing-screening subjects has bigger
    // problems than a count-off-by-one), but it prevents pathological
    // growth from a buggy client loop.
    const existing = subjects[body.key];
    const size = Object.keys(subjects).length;
    if (!existing && size >= MAX_STORE_SUBJECTS) {
      return prior ?? { version: 1, updatedAt: now.toISOString(), subjects };
    }
    subjects[body.key] = {
      subjectName: body.subjectName,
      entityType: body.entityType,
      lastSeenAt: now.toISOString(),
    };
  } else {
    delete subjects[body.key];
  }

  return {
    version: 1,
    updatedAt: now.toISOString(),
    subjects,
  };
}

interface BlobStoreWithCas {
  getWithMetadata: (
    key: string,
    opts: { type: 'json' },
  ) => Promise<{ data: OptInStoreEnvelope | null; etag?: string } | null>;
  setJSON: (key: string, value: unknown, opts?: { onlyIfMatch?: string }) => Promise<unknown>;
}

async function writeWithCas(body: ValidatedBody): Promise<{ ok: boolean; count?: number; error?: string }> {
  let store: BlobStoreWithCas;
  try {
    store = getStore({ name: STORE_NAME, consistency: 'strong' }) as unknown as BlobStoreWithCas;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'blob store unavailable' };
  }
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    let current: OptInStoreEnvelope | null = null;
    let etag: string | undefined;
    try {
      const read = await store.getWithMetadata(STORE_KEY, { type: 'json' });
      if (read && read.data && typeof read.data === 'object') {
        current = read.data;
        etag = read.etag;
      }
    } catch {
      current = null;
      etag = undefined;
    }
    const next = applyOptIn(current, body);
    try {
      await store.setJSON(STORE_KEY, next, etag ? { onlyIfMatch: etag } : undefined);
      return { ok: true, count: Object.keys(next.subjects).length };
    } catch (err) {
      // CAS-miss → refetch + retry. Any other error → bail immediately with
      // a generic message so the caller never sees stack traces or storage
      // internals (opaque-error principle).
      const msg = err instanceof Error ? err.message : '';
      const isCasMiss = /412|precondition/i.test(msg);
      if (!isCasMiss) {
        return { ok: false, error: 'store write failed' };
      }
      // CAS miss on the final attempt — give up cleanly.
      if (attempt === MAX_CAS_ATTEMPTS - 1) {
        return { ok: false, error: 'CAS contention exceeded max attempts' };
      }
      // Otherwise fall through to the next iteration of the for-loop.
    }
  }
  return { ok: false, error: 'CAS contention exceeded max attempts' };
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed.' }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    max: 60,
    windowMs: 60_000,
    clientIp: context.ip,
    namespace: 'ongoing-screening-optin',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const lenHeader = req.headers.get('content-length');
  if (lenHeader && Number(lenHeader) > MAX_BODY_SIZE) {
    return jsonResponse({ ok: false, error: 'Body too large' }, { status: 413 });
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Body must be valid JSON' }, { status: 400 });
  }

  const validated = validateBody(raw);
  if (!validated.ok) {
    return jsonResponse({ ok: false, error: validated.error }, { status: 400 });
  }

  const result = await writeWithCas(validated.value);
  if (!result.ok) {
    return jsonResponse({ ok: false, error: result.error ?? 'store write failed' }, { status: 500 });
  }
  return jsonResponse({ ok: true, count: result.count ?? 0 });
};

export const config: Config = {
  method: ['POST', 'OPTIONS'],
};

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

export const __test__ = {
  canonicaliseKey,
  validateBody,
  applyOptIn,
};
