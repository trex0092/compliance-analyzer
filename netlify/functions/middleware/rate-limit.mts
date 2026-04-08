/**
 * Serverless Rate Limiter — In-memory sliding window
 *
 * Provides rate limiting for Netlify Functions.
 * Uses in-memory store (resets on cold start, which is acceptable for serverless).
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

// Periodic cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.windowStart > 15 * 60 * 1000) store.delete(key);
  }
}, 5 * 60 * 1000);

export interface RateLimitConfig {
  windowMs?: number;
  max?: number;
}

export function checkRateLimit(
  req: Request,
  config: RateLimitConfig = {}
): Response | null {
  const { windowMs = 15 * 60 * 1000, max = 100 } = config;

  const forwarded = req.headers.get("x-forwarded-for");
  const key = forwarded?.split(",")[0]?.trim() || "unknown";
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
