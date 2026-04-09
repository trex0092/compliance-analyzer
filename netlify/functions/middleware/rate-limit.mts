/**
 * Serverless Rate Limiter — In-memory sliding window
 *
 * Provides rate limiting for Netlify Functions.
 *
 * IMPORTANT: This in-memory store resets on cold start and is NOT shared
 * across concurrent function instances. It provides best-effort protection
 * but is NOT a reliable defense against determined attackers. For production
 * hardening, migrate to a persistent store (Netlify Blobs, KV, or Redis).
 *
 * Limits per CLAUDE.md security requirements:
 *  - General API: 100 requests per IP per 15 minutes
 *  - Auth endpoints: 5 requests per IP per 15 minutes
 *  - Sensitive endpoints: 10 requests per IP per 15 minutes
 */

interface RateLimitEntry {
  windowStart: number;
  count: number;
}

const store = new Map<string, RateLimitEntry>();

export interface RateLimitConfig {
  windowMs?: number;
  max?: number;
  /** Pass context.ip from Netlify Functions for reliable client IP. */
  clientIp?: string;
}

export function checkRateLimit(
  req: Request,
  config: RateLimitConfig = {}
): Response | null {
  const { windowMs = 15 * 60 * 1000, max = 100 } = config;

  // Prefer explicit clientIp (from Netlify context.ip — cannot be spoofed)
  // over X-Forwarded-For (can be spoofed by attackers).
  const key = config.clientIp
    || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
  const now = Date.now();

  let entry = store.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    entry = { windowStart: now, count: 0 };
    store.set(key, entry);
  }

  entry.count++;

  if (entry.count > max) {
    console.warn(`[RATE-LIMIT] Blocked ${key} — ${entry.count} requests in window`);
    return Response.json(
      { error: "Too many requests, please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(windowMs / 1000)),
          "X-RateLimit-Limit": String(max),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  return null;
}
