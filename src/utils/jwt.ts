/**
 * Minimal HS256 JWT helpers — sign + verify.
 *
 * WHY a hand-rolled implementation rather than `jsonwebtoken`:
 *   - Zero new dependency. The rest of the repo already bans `eval()`-
 *     style loose deps from the Netlify-function bundle (see
 *     CLAUDE.md §9 + the pre-commit-security hook).
 *   - HS256 is tiny: base64url-encoded header + payload joined by ".",
 *     HMAC-SHA256 of that joined string with a shared secret, base64url
 *     appended. No crypto hand-rolling — we call `node:crypto.createHmac`.
 *   - The MLRO login flow is the only JWT site in this codebase. A
 *     full JWT library (with RS256, JWK rotation, nested JWS, etc.)
 *     is dead weight here.
 *
 * LIMITATIONS (deliberate):
 *   - HS256 only. RS256 / ES256 are NOT implemented — we have no need
 *     for asymmetric verification.
 *   - No `nbf` / `iss` / `aud` enforcement. Payload carries `sub`,
 *     `iat`, `exp`, `jti`. Add claim enforcement inline at the call
 *     site if you need it; we resist generic JWT-library drift.
 *   - Clock skew tolerance is a parameter to `verifyJwt` (default: 0)
 *     — callers that need looser tolerance pass `clockSkewSec`.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO accountability — every authenticated
 *     action must be traceable to an identified principal; a signed
 *     JWT with a stable `sub` and `jti` gives us that without a
 *     session-store round trip per request)
 *   - FDL No.10/2025 Art.24 (10-year retention — the `jti` is how
 *     the audit trail correlates every action to a specific login
 *     session)
 *   - CLAUDE.md Seguridad §5 (secure session tokens)
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const HEADER_HS256 = { alg: 'HS256', typ: 'JWT' } as const;

export interface JwtPayload {
  /** Subject — the identified principal (e.g. "mlro"). */
  sub: string;
  /** Issued at, seconds since epoch. */
  iat: number;
  /** Expires at, seconds since epoch. */
  exp: number;
  /** JWT id — unique per token, used for audit correlation. */
  jti: string;
  /** Envelope version (bump on incompatible payload changes). */
  v: number;
}

export interface SignJwtInput {
  /** Stable principal identifier (e.g. "mlro"). */
  sub: string;
  /** Lifetime in seconds. Must be > 0. */
  ttlSec: number;
  /** Unique token id; generate via crypto.randomUUID or randomBytes. */
  jti: string;
  /** HS256 secret. 32+ bytes recommended. */
  secret: string;
  /** Payload version. Defaults to 1. */
  v?: number;
  /** Override "now" (tests). */
  nowSec?: number;
}

export class JwtError extends Error {
  readonly code: JwtErrorCode;
  constructor(code: JwtErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'JwtError';
  }
}

export type JwtErrorCode =
  | 'malformed'
  | 'bad-header'
  | 'bad-payload'
  | 'bad-signature'
  | 'expired'
  | 'future-iat'
  | 'missing-claim';

function base64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  // Avoid String.replaceAll (ES2021) for compatibility with the
  // project's ES2020 tsconfig target. Regex + global flag is
  // equivalent and lint-clean.
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecodeToBuffer(s: string): Buffer {
  // Restore padding + standard alphabet.
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function hmacHs256(data: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

/**
 * Produce a signed HS256 JWT. Payload is `{sub, iat, exp, jti, v}`.
 * Caller controls the `jti` so the login endpoint can log it into
 * the audit trail alongside the issued token.
 */
export function signJwt(input: SignJwtInput): string {
  if (!input.secret || input.secret.length < 32) {
    throw new JwtError(
      'malformed',
      'signJwt: secret must be at least 32 bytes (32 ASCII characters or more).'
    );
  }
  if (!Number.isFinite(input.ttlSec) || input.ttlSec <= 0) {
    throw new JwtError('malformed', `signJwt: ttlSec must be > 0 (got ${input.ttlSec}).`);
  }
  if (!input.sub) throw new JwtError('malformed', 'signJwt: sub is required.');
  if (!input.jti) throw new JwtError('malformed', 'signJwt: jti is required.');

  const now = Math.floor(input.nowSec ?? Date.now() / 1000);
  const payload: JwtPayload = {
    sub: input.sub,
    iat: now,
    exp: now + Math.floor(input.ttlSec),
    jti: input.jti,
    v: input.v ?? 1,
  };
  const header64 = base64urlEncode(JSON.stringify(HEADER_HS256));
  const payload64 = base64urlEncode(JSON.stringify(payload));
  const signingInput = `${header64}.${payload64}`;
  const sig64 = base64urlEncode(hmacHs256(signingInput, input.secret));
  return `${signingInput}.${sig64}`;
}

export interface VerifyJwtInput {
  token: string;
  secret: string;
  /** Defaults to 0 — be strict on expiry by default. */
  clockSkewSec?: number;
  /** Override "now" (tests). */
  nowSec?: number;
}

/**
 * Verify an HS256 JWT. Returns the parsed payload on success; throws
 * `JwtError` with a stable `code` on any failure so the caller can
 * distinguish "expired" from "forged" in logs / metrics without
 * regex-ing error messages.
 */
export function verifyJwt(input: VerifyJwtInput): JwtPayload {
  const { token, secret } = input;
  if (!secret || secret.length < 32) {
    throw new JwtError(
      'malformed',
      'verifyJwt: secret must be at least 32 bytes.'
    );
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new JwtError('malformed', 'JWT must have three dot-separated segments.');
  }
  const [header64, payload64, sig64] = parts;

  // Header sanity. Reject alg:none / alg:RS256 etc. — we only accept HS256.
  let header: unknown;
  try {
    header = JSON.parse(base64urlDecodeToBuffer(header64).toString('utf8'));
  } catch {
    throw new JwtError('bad-header', 'JWT header is not valid JSON.');
  }
  if (
    typeof header !== 'object' ||
    header === null ||
    (header as { alg?: unknown }).alg !== 'HS256' ||
    (header as { typ?: unknown }).typ !== 'JWT'
  ) {
    throw new JwtError('bad-header', 'JWT header alg must be HS256 and typ must be JWT.');
  }

  // Signature FIRST, before we trust anything in the payload.
  const expected = hmacHs256(`${header64}.${payload64}`, secret);
  const actual = base64urlDecodeToBuffer(sig64);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new JwtError('bad-signature', 'JWT signature does not verify.');
  }

  // Now we can trust the payload.
  let payload: unknown;
  try {
    payload = JSON.parse(base64urlDecodeToBuffer(payload64).toString('utf8'));
  } catch {
    throw new JwtError('bad-payload', 'JWT payload is not valid JSON.');
  }
  if (typeof payload !== 'object' || payload === null) {
    throw new JwtError('bad-payload', 'JWT payload must be an object.');
  }
  const p = payload as Partial<JwtPayload>;
  if (typeof p.sub !== 'string' || !p.sub) {
    throw new JwtError('missing-claim', 'JWT payload.sub is required.');
  }
  if (typeof p.iat !== 'number' || typeof p.exp !== 'number') {
    throw new JwtError('missing-claim', 'JWT payload.iat / payload.exp are required.');
  }
  if (typeof p.jti !== 'string' || !p.jti) {
    throw new JwtError('missing-claim', 'JWT payload.jti is required.');
  }

  const now = Math.floor(input.nowSec ?? Date.now() / 1000);
  const skew = Math.max(0, Math.floor(input.clockSkewSec ?? 0));
  if (p.iat - skew > now) {
    throw new JwtError('future-iat', 'JWT iat is in the future.');
  }
  if (p.exp + skew <= now) {
    throw new JwtError('expired', 'JWT has expired.');
  }
  return { sub: p.sub, iat: p.iat, exp: p.exp, jti: p.jti, v: p.v ?? 1 };
}

/**
 * Cheap shape-check so the auth middleware can branch early
 * between hex token and JWT without paying for a signature verify
 * on every request. A hex token has NO dots; a JWT has exactly two.
 * Not a validation — just a dispatch hint.
 */
export function looksLikeJwt(s: string): boolean {
  if (typeof s !== 'string' || s.length < 20) return false;
  const dots = s.split('.').length - 1;
  return dots === 2;
}
