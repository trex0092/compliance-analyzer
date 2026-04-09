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
}

/**
 * Sanitize an IP string into a safe Blob key.
 * Blob keys must avoid special characters.
 */
function ipToKey(ip: string): string {
  return 'rl:' + ip.replace(/[^a-zA-Z0-9.:_-]/g, '_').slice(0, 64);
}

async function getEntry(key: string): Promise<RateLimitEntry | null> {
  try {
    const store = getStore(BLOB_STORE_NAME);
    const data = await store.get(key, { type: 'json' });
    return data as RateLimitEntry | null;
  } catch {
    // Blobs unavailable — use memory fallback
    return memoryStore.get(key) ?? null;
  }
}

async function setEntry(key: string, entry: RateLimitEntry): Promise<void> {
  try {
    const store = getStore(BLOB_STORE_NAME);
    await store.setJSON(key, entry);
  } catch {
    // Blobs unavailable — use memory fallback
    memoryStore.set(key, entry);
  }
}

export async function checkRateLimit(
  req: Request,
  config: RateLimitConfig = {}
): Promise<Response | null> {
  const { windowMs = 15 * 60 * 1000, max = 100 } = config;

  // Prefer explicit clientIp (from Netlify context.ip — cannot be spoofed)
  // over X-Forwarded-For (can be spoofed by attackers).
  const rawIp =
    config.clientIp ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  const key = ipToKey(rawIp);
  const now = Date.now();

  let entry = await getEntry(key);
  if (!entry || now - entry.windowStart > windowMs) {
    entry = { windowStart: now, count: 0 };
  }

  entry.count++;
  await setEntry(key, entry);

  if (entry.count > max) {
    console.warn(`[RATE-LIMIT] Blocked ${rawIp} — ${entry.count} requests in window`);
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
