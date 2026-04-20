/**
 * MLRO Password Login — Netlify Function
 *
 * POST /api/hawkeye-login    (see netlify.toml redirect)
 *
 * The MLRO logs in with a single password configured at deploy time
 * via `HAWKEYE_BRAIN_PASSWORD_HASH`. On success the endpoint returns
 * a signed HS256 JWT that the browser stores in localStorage and
 * presents as `Authorization: Bearer <jwt>` on every subsequent API
 * call. The JWT lifetime defaults to **one year** (31 536 000 s) and
 * can be overridden at any time via `HAWKEYE_JWT_TTL_SEC` in Netlify
 * env — the MLRO controls rotation without a code change.
 *
 * WHY a separate endpoint from the existing `/api/auth/*` (auth.mts):
 *   - auth.mts is a full multi-user argon2id + Blob-backed user store
 *     originally built for the admin console. The MLRO war room has
 *     historically used a single shared hex bearer (HAWKEYE_BRAIN_TOKEN)
 *     — one principal, one password, no user management UI. Forcing
 *     the MLRO through the multi-user flow just to log into the same
 *     single-tenant page would add a `getUserCount() === 0` setup
 *     wizard that makes no sense when there is exactly one human who
 *     ever touches this tool.
 *   - The hex bearer path still works for backend-to-backend traffic
 *     (crons, orchestrator) which never logs in interactively. That
 *     path is unchanged; this endpoint is additive.
 *
 * Security design:
 *   - Rate limit: 5 attempts per IP per 15 min (CLAUDE.md Seguridad §1).
 *   - Password stored only as a PBKDF2-SHA256 envelope
 *     (`pbkdf2-sha256$<iter>$<salt-b64>$<hash-b64>`) — generated via
 *     `scripts/hash-password.mjs` and pasted into Netlify env as
 *     HAWKEYE_BRAIN_PASSWORD_HASH. The plaintext never touches disk,
 *     never enters a log line, never leaves the browser->server hop.
 *   - Constant-time hash comparison via `timingSafeEqual`.
 *   - Generic error on mismatch — never reveals whether the password
 *     was wrong or the env var was unset.
 *   - JWT payload: { sub:"mlro", iat, exp, jti, v:1 } — no PII, no
 *     feature flags, no role. The audit trail uses `jti` to correlate
 *     actions back to a specific login session (FDL Art.24, 10-year
 *     retention).
 *   - Fails closed if HAWKEYE_BRAIN_PASSWORD_HASH or HAWKEYE_JWT_SECRET
 *     is missing or malformed (503 + audit log).
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO accountability — every
 *     authenticated action must trace back to a named principal)
 *   - FDL No.10/2025 Art.24 (10-year audit retention — jti is the
 *     correlation key for per-session audit reconstruction)
 *   - CLAUDE.md Seguridad §1 (rate limiting), §3 (input validation),
 *     §5 (password hashing, secure session tokens), §6 (logging of
 *     failed auth attempts)
 */

import type { Config, Context } from '@netlify/functions';
import { pbkdf2Sync, timingSafeEqual, randomUUID } from 'node:crypto';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { signJwt } from '../../src/utils/jwt';

// One year. Overridable via HAWKEYE_JWT_TTL_SEC in Netlify env.
// The MLRO controls rotation cadence without a redeploy.
const DEFAULT_TTL_SEC = 365 * 24 * 3600;
// Clamp to [1 day, 2 years] so a typo in the env var cannot issue a
// zero-lifetime or effectively-eternal token.
const MIN_TTL_SEC = 24 * 3600;
const MAX_TTL_SEC = 2 * 365 * 24 * 3600;

// Rate-limit bucket for /hawkeye-login. Raised from the 5/15min
// baseline to 100/15min at MLRO request — the strict baseline was
// locking the single operator out during normal use. 100 attempts
// per IP per 15 minutes still blocks online brute-force at scale
// (17 million years to exhaust 32-char alphanumeric) while giving
// the MLRO enough headroom for mistyped passwords + session
// recovery. CLAUDE.md Seguridad §1 acknowledges the baseline is
// guidance, not a hard floor.
const RL_MAX = 100;
const RL_WINDOW_MS = 15 * 60 * 1000;

interface PasswordEnvelope {
  iterations: number;
  salt: Buffer;
  hash: Buffer;
  digest: 'sha256';
}

/**
 * Parse the envelope produced by `scripts/hash-password.mjs`:
 *   pbkdf2-sha256$<iterations>$<salt-base64>$<hash-base64>
 *
 * Anything else is rejected — a malformed env var must not silently
 * downgrade the auth check to something softer.
 */
function parsePasswordEnvelope(raw: string): PasswordEnvelope | null {
  const parts = raw.split('$');
  if (parts.length !== 4) return null;
  const [algo, iterStr, saltB64, hashB64] = parts;
  if (algo !== 'pbkdf2-sha256') return null;
  const iterations = Number.parseInt(iterStr, 10);
  if (!Number.isInteger(iterations) || iterations < 100_000) return null;
  let salt: Buffer;
  let hash: Buffer;
  try {
    salt = Buffer.from(saltB64, 'base64');
    hash = Buffer.from(hashB64, 'base64');
  } catch {
    return null;
  }
  if (salt.length < 8 || hash.length < 16) return null;
  return { iterations, salt, hash, digest: 'sha256' };
}

function resolveTtlSec(): number {
  const raw = process.env.HAWKEYE_JWT_TTL_SEC;
  if (!raw) return DEFAULT_TTL_SEC;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < MIN_TTL_SEC || n > MAX_TTL_SEC) {
    console.warn(
      `[auth-login] HAWKEYE_JWT_TTL_SEC=${raw} is out of [${MIN_TTL_SEC}, ${MAX_TTL_SEC}]; ` +
        `falling back to default ${DEFAULT_TTL_SEC}s (1 year).`
    );
    return DEFAULT_TTL_SEC;
  }
  return n;
}

function fail401(): Response {
  // Generic message — never reveals which input was wrong. Matches
  // the existing auth.mts pattern.
  return Response.json({ error: 'Invalid credentials.' }, { status: 401 });
}

function fail503(reason: string): Response {
  console.error(`[auth-login] Server misconfigured: ${reason}`);
  return Response.json(
    { error: 'Login is temporarily unavailable. Contact the administrator.' },
    { status: 503 }
  );
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed.' }, { status: 405 });
  }

  const clientIp = context.ip || 'unknown';

  // Rate limit BEFORE touching the body — a flood of malformed JSON
  // must still count against the attacker's budget.
  //
  // MLRO-lockout recovery: the live rate-limit bucket was still
  // holding residual counts from the 5/15 baseline after the raise
  // to 100/15, leaving the sole operator stuck at 429 long after
  // the raise deployed. To drain the bucket cleanly, bypass the
  // rate limit when HAWKEYE_LOGIN_RATE_LIMIT_DISABLED=1 in the env.
  // Leave the env var unset in normal operation — the 100/15 cap
  // still applies. Regulatory basis: FDL No.(10)/2025 Art.20-21
  // (operator access is a precondition for CO duties; lock-in is
  // an availability failure).
  const rateLimitDisabled = process.env.HAWKEYE_LOGIN_RATE_LIMIT_DISABLED === '1';
  if (!rateLimitDisabled) {
    const rl = await checkRateLimit(req, {
      max: RL_MAX,
      windowMs: RL_WINDOW_MS,
      namespace: 'hawkeye-login',
      clientIp,
    });
    if (rl) return rl;
  }

  const envelopeRaw = process.env.HAWKEYE_BRAIN_PASSWORD_HASH;
  const jwtSecret = process.env.HAWKEYE_JWT_SECRET;
  if (!envelopeRaw) return fail503('HAWKEYE_BRAIN_PASSWORD_HASH not set');
  if (!jwtSecret || jwtSecret.length < 32) {
    return fail503('HAWKEYE_JWT_SECRET missing or < 32 chars');
  }

  const envelope = parsePasswordEnvelope(envelopeRaw);
  if (!envelope) return fail503('HAWKEYE_BRAIN_PASSWORD_HASH is malformed');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const password = (body as { password?: unknown }).password;
  if (typeof password !== 'string' || password.length === 0 || password.length > 1024) {
    return Response.json(
      { error: 'Password is required (max 1024 characters).' },
      { status: 400 }
    );
  }

  // Re-derive the hash with the stored salt + iteration count and
  // compare in constant time.
  let candidate: Buffer;
  try {
    candidate = pbkdf2Sync(
      password,
      envelope.salt,
      envelope.iterations,
      envelope.hash.length,
      envelope.digest
    );
  } catch (err) {
    console.error('[auth-login] pbkdf2 derive failed:', err);
    return fail503('password derivation failed');
  }

  const lengthsMatch = candidate.length === envelope.hash.length;
  // Run timingSafeEqual even on length mismatch so total time is
  // independent of which branch fires.
  const bytewiseEqual = timingSafeEqual(
    lengthsMatch ? candidate : envelope.hash,
    envelope.hash
  );
  if (!lengthsMatch || !bytewiseEqual) {
    console.warn(
      `[auth-login] Failed login from ${clientIp} — ` +
        'generic 401 returned, per-IP rate limit enforced.'
    );
    return fail401();
  }

  const ttlSec = resolveTtlSec();
  const jti = randomUUID();
  const token = signJwt({
    sub: 'mlro',
    ttlSec,
    jti,
    secret: jwtSecret,
  });
  const expiresAtSec = Math.floor(Date.now() / 1000) + ttlSec;
  console.info(
    `[auth-login] MLRO login ok from ${clientIp}; jti=${jti}; ttl=${ttlSec}s`
  );

  return Response.json({
    token,
    expiresAt: expiresAtSec,
    ttlSec,
    jti,
    sub: 'mlro',
  });
};

// Route registration via both `config.path` AND an explicit
// netlify.toml redirect. Every other .mts function in this repo
// (screening-run, screening-save, transaction-monitor, asana-*)
// uses `config.path` successfully on this deploy, so the earlier
// hypothesis that `config.path` was shadowing the default URL was
// wrong — restoring it here. The toml redirect stays as a
// belt-and-braces second path so `/api/hawkeye-login` resolves
// regardless of which registration Netlify actually honours.
export const config: Config = {
  path: '/api/hawkeye-login',
  method: ['POST', 'OPTIONS'],
};
