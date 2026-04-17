/**
 * Serverless Rate Limiter — Persistent via Netlify Blobs
 *
 * Uses Netlify Blobs for rate limiting state, making it persistent
 * across cold starts and shared across concurrent function instances.
 *
 * Falls back to in-memory store if Blobs are unavailable (local dev).
 *
 * Limits per CLAUDE.md security requirements:
 *  - General API: 100 requests per IP per 15 minutes
 *  - Auth endpoints: 5 requests per IP per 15 minutes
 *  - Sensitive endpoints: 10 requests per IP per 15 minutes
 */

import { getStore } from '@netlify/blobs';

interface RateLimitEntry {
  windowStart: number;
  count: number;
}

// In-memory fallback for local dev / Blobs unavailability
const memoryStore = new Map<string, RateLimitEntry>();

const BLOB_STORE_NAME = 'rate-limits';

export interface RateLimitConfig {
  windowMs?: number;
  max?: number;
  /** Pass context.ip from Netlify Functions for reliable client IP. */
  clientIp?: string;
  /**
   * Namespace key — prevents route pollution. Every endpoint should pass
   * a distinct namespace (e.g. 'auth-login', 'auth-validate', 'approvals',
   * 'ai-proxy') so that a high-volume general endpoint cannot burn the
   * auth-route budget.
   */
  namespace?: string;
  /**
   * Optional extra subject key — e.g. the username for per-account login
   * brute-force detection. Combined with the IP bucket.
   */
  subject?: string;
}

/**
 * Sanitize an arbitrary string into a safe Blob key fragment.
 * Blob keys must avoid special characters.
 */
function safeKey(s: string): string {
  return s.replace(/[^a-zA-Z0-9.:_-]/g, '_').slice(0, 64);
}

function composeKey(namespace: string, subject: string | undefined, rawIp: string): string {
  const ns = safeKey(namespace || 'default');
  const subj = subject ? safeKey(subject) : '';
  const ip = safeKey(rawIp);
  return subj ? `rl:${ns}:${ip}:${subj}` : `rl:${ns}:${ip}`;
}

async function getEntryWithEtag(key: string): Promise<{ data: RateLimitEntry | null; etag: string | null }> {
  try {
    const store = getStore(BLOB_STORE_NAME);
    // getWithMetadata returns { data, etag } — use for CAS on setJSON.
    // Some Netlify Blobs SDK versions type this differently; widen to any.
    const result: any = await (store as any).getWithMetadata(key, { type: 'json' });
    if (!result) return { data: null, etag: null };
    return { data: (result.data ?? null) as RateLimitEntry | null, etag: (result.etag ?? null) as string | null };
  } catch {
    return { data: memoryStore.get(key) ?? null, etag: null };
  }
}

async function setEntryCas(key: string, entry: RateLimitEntry, etag: string | null): Promise<boolean> {
  try {
    const store = getStore(BLOB_STORE_NAME);
    // onlyIfMatch enforces compare-and-swap; if another concurrent request
    // already wrote a newer value, the write fails and we retry.
    const opts: any = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
    const ok: any = await (store as any).setJSON(key, entry, opts);
    // Modern @netlify/blobs returns `{ modified: boolean, etag?: string }`
    // and signals a CAS conflict with `modified: false` rather than a
    // thrown error. The previous `ok !== false` check treated that
    // object as a successful write, silently defeating the CAS retry
    // loop — under concurrency two lambdas reading the same etag both
    // saw "wrote = true" and we persisted only one of their writes, so
    // rate-limit counters under-counted and attackers could exceed
    // the documented rate. Older SDKs returned plain `undefined` on
    // success; we treat that as success for back-compat but require an
    // explicit non-false `modified` for the modern shape.
    if (ok == null) return true; // legacy SDK: no return value = success
    if (typeof ok === 'object' && 'modified' in ok) {
      return ok.modified === true;
    }
    return ok !== false;
  } catch {
    memoryStore.set(key, entry);
    return true;
  }
}

export async function checkRateLimit(
  req: Request,
  config: RateLimitConfig = {}
): Promise<Response | null> {
  const { windowMs = 15 * 60 * 1000, max = 100, namespace = 'default', subject } = config;

  // Prefer explicit clientIp (from Netlify context.ip — cannot be spoofed)
  // over X-Forwarded-For (can be spoofed by attackers).
  const rawIp =
    config.clientIp ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  const key = composeKey(namespace, subject, rawIp);
  const now = Date.now();

  // Retry loop on CAS conflict — prevents the racy count++ / setJSON
  // pattern from letting two concurrent requests each see count=4 and
  // both write count=5 (so the real value 6 is never observed).
  let entry: RateLimitEntry | null = null;
  let blocked = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, etag } = await getEntryWithEtag(key);
    const current = !data || now - data.windowStart > windowMs
      ? { windowStart: now, count: 0 }
      : { windowStart: data.windowStart, count: data.count };
    current.count++;
    const wrote = await setEntryCas(key, current, etag);
    if (wrote) { entry = current; break; }
  }
  if (!entry) {
    // If we couldn't CAS after retries, fail closed — safer to return 429
    // than to silently let the attacker through.
    return Response.json(
      { error: 'Rate limit state unavailable; request rejected.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(windowMs / 1000)) } }
    );
  }

  if (entry.count > max) {
    console.warn(`[RATE-LIMIT] Blocked ${rawIp} on ${namespace}${subject ? '/' + subject : ''} — ${entry.count} requests in window`);
    return Response.json(
      { error: 'Too many requests, please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil(windowMs / 1000)),
          'X-RateLimit-Limit': String(max),
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  }

  return null;
}
