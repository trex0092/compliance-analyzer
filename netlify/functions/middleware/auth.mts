/**
 * Authentication Middleware for Netlify Functions
 *
 * Two flavours:
 *
 *   1. authenticate(req)          — single shared bearer token.
 *      Checks the `Authorization: Bearer <token>` header against the
 *      server-side HAWKEYE_BRAIN_TOKEN env var using a constant-time
 *      comparison. Suitable for backend-to-backend traffic (the
 *      orchestrator, the autopilot) where there is no per-user identity.
 *
 *   2. authenticateApprover(req)  — per-user bearer tokens.
 *      Checks against HAWKEYE_APPROVER_KEYS, a comma-separated list of
 *      `username:hex-token` pairs. Used by the four-eyes approvals
 *      endpoint where two DISTINCT human approvers are required. A
 *      shared token cannot support four-eyes by definition.
 *
 * Both flavours:
 *   - Fail closed if the relevant env var is missing or malformed.
 *   - Return a stable userId derived via HMAC (not a token prefix) so
 *     log lines and audit trails cannot be used to brute-force the
 *     token.
 *   - Strip CORS preflight (OPTIONS) past the auth check.
 *
 * Security review findings addressed in this file:
 *   F-01 — single-shared token was never compared against the server
 *          value; any 32-hex string was accepted.
 *   F-02 — four-eyes was bypassable because userId was derived from
 *          the token; the attacker could generate two random tokens to
 *          satisfy "two distinct approvers".
 *   F-13 — userId was the first 16 chars of the secret, leaking token
 *          prefix into every log line.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { JwtError, looksLikeJwt, verifyJwt, type JwtPayload } from "../../../src/utils/jwt";

export interface AuthResult {
  ok: boolean;
  /** Stable, non-reversible identifier for audit logs. */
  userId?: string;
  /** Raw username from the approver-keys mapping, if applicable. */
  username?: string;
  /**
   * When the caller presented a JWT (browser-issued MLRO login token),
   * this carries the validated payload so downstream endpoints can log
   * the `jti` against the audit trail without re-verifying.
   */
  jwt?: JwtPayload;
  response?: Response;
}

const HEADER_KEY = "Authorization";
const TOKEN_MIN_LENGTH = 32;

// Salt for HMAC derivation of userId. Different from the token itself —
// rotating the salt does not require rotating tokens.
const USERID_SALT = "hawkeye-userid-v1";

function unauthorized(message: string): AuthResult {
  return {
    ok: false,
    response: Response.json({ error: message }, { status: 401 }),
  };
}

function serverMisconfigured(message: string): AuthResult {
  return {
    ok: false,
    response: Response.json({ error: message }, { status: 503 }),
  };
}

/**
 * Extract the Authorization Bearer value without shape-gating it to hex.
 * A bearer can be either a 32+ char hex token (backend-to-backend) or
 * an HS256 JWT (browser MLRO login). The format branch happens in the
 * caller (`authenticate`), which delegates to the right verifier.
 */
function extractBearer(req: Request): { ok: true; token: string } | { ok: false; response: Response } {
  const authHeader = req.headers.get(HEADER_KEY);
  if (!authHeader) {
    return {
      ok: false,
      response: Response.json({ error: "Missing Authorization header" }, { status: 401 }),
    };
  }
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return {
      ok: false,
      response: Response.json(
        { error: "Invalid Authorization format. Use: Bearer <token>" },
        { status: 401 },
      ),
    };
  }
  const token = parts[1];
  // Shape gate: must be EITHER a JWT (two dots, ≥20 chars) OR a hex
  // bearer (≥TOKEN_MIN_LENGTH, all [a-f0-9]). Any other shape is a
  // malformed credential and is rejected before we touch any secret.
  const isJwt = looksLikeJwt(token);
  const isHex = token.length >= TOKEN_MIN_LENGTH && /^[a-f0-9]+$/i.test(token);
  if (!isJwt && !isHex) {
    return {
      ok: false,
      response: Response.json({ error: "Invalid token" }, { status: 401 }),
    };
  }
  return { ok: true, token };
}

/**
 * Constant-time string comparison. Both strings must have the same
 * byte length before we call timingSafeEqual — we compare lengths
 * first, with a dummy equal-length compare if they differ, so the
 * total time is independent of the mismatch point.
 */
function tokensEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    // Dummy compare to keep timing constant regardless of which input
    // is longer.
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

function hashUserId(label: string, token: string): string {
  return createHmac("sha256", USERID_SALT)
    .update(`${label}|${token}`)
    .digest("hex")
    .slice(0, 16);
}

// ---------------------------------------------------------------------------
// Flavour 1 — single shared bearer (HAWKEYE_BRAIN_TOKEN)
// ---------------------------------------------------------------------------

/**
 * Verify a request against either:
 *   (a) an HS256 JWT issued by /api/hawkeye-login (browser MLRO path), or
 *   (b) the shared HAWKEYE_BRAIN_TOKEN hex bearer (backend-to-backend).
 *
 * The JWT path lets the MLRO sign in once with a password and carry a
 * 1-year session token in localStorage; the hex path stays unchanged
 * for crons, the orchestrator, and the setup wizard. Whichever path
 * fires, the returned `userId` is HMAC-derived so log lines and the
 * audit trail cannot be used to reconstruct the raw credential.
 *
 * Server is considered "configured" if EITHER the JWT secret or the
 * brain token is present — we only fail-closed (503) when both are
 * absent, since either one alone is enough to authenticate callers.
 */
export function authenticate(req: Request): AuthResult {
  if (req.method === "OPTIONS") {
    return { ok: true, userId: "preflight" };
  }

  const extracted = extractBearer(req);
  if (!extracted.ok) return { ok: false, response: extracted.response };
  const token = extracted.token;

  const jwtSecret = process.env.HAWKEYE_JWT_SECRET;
  const brainToken = process.env.HAWKEYE_BRAIN_TOKEN;

  const jwtConfigured = !!jwtSecret && jwtSecret.length >= TOKEN_MIN_LENGTH;
  const hexConfigured =
    !!brainToken && brainToken.length >= TOKEN_MIN_LENGTH && /^[a-f0-9]+$/i.test(brainToken);

  if (!jwtConfigured && !hexConfigured) {
    console.error(
      "[auth] Neither HAWKEYE_JWT_SECRET nor HAWKEYE_BRAIN_TOKEN is configured; refusing to authenticate.",
    );
    return serverMisconfigured("Server authentication is not configured");
  }

  // JWT path — browser-issued login token. We route to the JWT
  // verifier on shape (two dots) so a hex token that happens to
  // contain dots cannot flip branches, and so a JWT sent when the
  // server has no JWT secret fails with a clear 401 instead of
  // silently falling through to the hex compare.
  if (looksLikeJwt(token)) {
    if (!jwtConfigured) return unauthorized("Invalid token");
    try {
      const payload = verifyJwt({ token, secret: jwtSecret! });
      // hashUserId uses the JWT id, not the raw token, so the audit
      // trail identifier is stable across the token's lifetime but
      // does not leak any part of the signing material.
      return {
        ok: true,
        userId: hashUserId(`jwt:${payload.sub}`, payload.jti),
        username: payload.sub,
        jwt: payload,
      };
    } catch (err) {
      if (err instanceof JwtError) {
        // Log the code (not the message) so we see "expired" vs
        // "bad-signature" in ops dashboards without leaking payload
        // content or secret material.
        console.warn(`[auth] JWT rejected: code=${err.code}`);
      } else {
        console.warn("[auth] JWT rejected: unknown error");
      }
      return unauthorized("Invalid token");
    }
  }

  // Hex bearer path — backend-to-backend. Constant-time compare.
  if (!hexConfigured) return unauthorized("Invalid token");
  if (!tokensEqual(token, brainToken!)) {
    return unauthorized("Invalid token");
  }
  return { ok: true, userId: hashUserId("brain", token) };
}

// ---------------------------------------------------------------------------
// Flavour 2 — per-user approver keys (HAWKEYE_APPROVER_KEYS)
// ---------------------------------------------------------------------------

interface ApproverKey {
  username: string;
  token: string;
}

function parseApproverKeys(raw: string | undefined): ApproverKey[] {
  if (!raw) return [];
  const entries = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const out: ApproverKey[] = [];
  const seenUsernames = new Set<string>();
  for (const entry of entries) {
    const idx = entry.indexOf(":");
    if (idx <= 0) continue;
    const username = entry.slice(0, idx).trim();
    const token = entry.slice(idx + 1).trim();
    if (!username || !token) continue;
    if (token.length < TOKEN_MIN_LENGTH || !/^[a-f0-9]+$/i.test(token)) continue;
    if (seenUsernames.has(username)) continue; // first wins
    seenUsernames.add(username);
    out.push({ username, token });
  }
  return out;
}

/**
 * Verify a request against HAWKEYE_APPROVER_KEYS — a comma-separated
 * list of `username:token` pairs. Returns the matched username so the
 * approvals endpoint can enforce distinct-approver rules safely.
 *
 * The four-eyes gate REQUIRES this variant; the shared-token
 * `authenticate()` above is structurally insufficient (any caller
 * with the shared token is indistinguishable from any other).
 *
 * Example configuration:
 *   HAWKEYE_APPROVER_KEYS=mlro:abc...,co:def...,compliance-lead:ghi...
 *
 * Minimum required entries for four-eyes: 2.
 */
export function authenticateApprover(req: Request): AuthResult {
  if (req.method === "OPTIONS") {
    return { ok: true, userId: "preflight", username: "preflight" };
  }

  const approvers = parseApproverKeys(process.env.HAWKEYE_APPROVER_KEYS);
  if (approvers.length < 2) {
    console.error(
      `[auth] HAWKEYE_APPROVER_KEYS needs at least 2 valid entries for four-eyes; got ${approvers.length}`,
    );
    return serverMisconfigured("Approver keys are not configured");
  }

  const extracted = extractBearer(req);
  if (!extracted.ok) return { ok: false, response: extracted.response };

  // Constant-time scan: compare the presented token against every
  // registered approver. We iterate the full list (no early return on
  // match) so the total time is independent of which slot matched.
  let matchedUsername: string | null = null;
  for (const entry of approvers) {
    const isMatch = tokensEqual(extracted.token, entry.token);
    if (isMatch && matchedUsername === null) {
      matchedUsername = entry.username;
    }
  }

  if (matchedUsername === null) {
    return unauthorized("Invalid approver token");
  }

  return {
    ok: true,
    userId: hashUserId(`approver:${matchedUsername}`, extracted.token),
    username: matchedUsername,
  };
}

/**
 * Legacy in-memory rate limit — kept for backwards compatibility with
 * callers that import `rateLimit` from this module. New code should
 * use `checkRateLimit` from `./rate-limit.mts` which is blob-backed.
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 100;
const RATE_WINDOW_MS = 15 * 60 * 1000;

export function rateLimit(req: Request, clientIp?: string): AuthResult {
  const ip = clientIp || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT) {
    return {
      ok: false,
      response: Response.json({ error: "Too many requests. Try again later." }, { status: 429 }),
    };
  }
  return { ok: true };
}

// Exports for unit tests.
export const __test__ = {
  tokensEqual,
  hashUserId,
  parseApproverKeys,
};
