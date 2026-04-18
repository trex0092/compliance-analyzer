/**
 * Auth middleware — security invariants
 *
 * Locks in the fixes from the security review:
 *   F-01 — presented token is actually compared against the expected
 *          server-side token (not just shape-checked)
 *   F-02 — per-user approver keys produce distinct, verified userIds
 *          so the four-eyes invariant actually holds
 *   F-13 — userId is HMAC-derived, not a prefix of the secret token
 *
 * These tests go via the exported `authenticate` / `authenticateApprover`
 * functions, not the internal helpers, because the whole point is to
 * prove the end-to-end verification path works.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// @ts-expect-error — .mts path, no type declarations in tests
import {
  authenticate,
  authenticateApprover,
  __test__,
} from '../netlify/functions/middleware/auth.mts';
import { signJwt } from '../src/utils/jwt';
import { randomUUID } from 'node:crypto';

const { tokensEqual, hashUserId, parseApproverKeys } = __test__;

// -- env sandboxing ---------------------------------------------------------
const ORIG_ENV = { ...process.env };
beforeEach(() => {
  delete process.env.HAWKEYE_BRAIN_TOKEN;
  delete process.env.HAWKEYE_APPROVER_KEYS;
  // The middleware is "configured" if EITHER the hex token OR the JWT
  // secret is set, so the 503 fail-closed branch only fires when both
  // are absent. Clear both to keep the misconfigured-server assertions
  // deterministic.
  delete process.env.HAWKEYE_JWT_SECRET;
});
afterEach(() => {
  process.env = { ...ORIG_ENV };
});

// -- helpers ----------------------------------------------------------------
function req(headers: Record<string, string> = {}, method = 'POST'): Request {
  return new Request('https://example.com/api/test', {
    method,
    headers,
  });
}

// ---------------------------------------------------------------------------
// tokensEqual
// ---------------------------------------------------------------------------
describe('tokensEqual', () => {
  it('identical strings compare equal', () => {
    expect(tokensEqual('abc123', 'abc123')).toBe(true);
  });

  it('different strings of same length compare unequal', () => {
    expect(tokensEqual('abc123', 'xyz123')).toBe(false);
  });

  it('different lengths compare unequal', () => {
    expect(tokensEqual('abc', 'abcdef')).toBe(false);
  });

  it('empty strings compare equal', () => {
    expect(tokensEqual('', '')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hashUserId (F-13)
// ---------------------------------------------------------------------------
describe('hashUserId — no token-prefix leak', () => {
  const token = 'deadbeef'.repeat(6); // 48 hex chars

  it('does not return a prefix of the token', () => {
    const uid = hashUserId('brain', token);
    expect(token.startsWith(uid)).toBe(false);
    expect(token.includes(uid)).toBe(false);
  });

  it('different labels produce different userIds', () => {
    expect(hashUserId('brain', token)).not.toBe(hashUserId('approver:mlro', token));
  });

  it('same label + token is stable', () => {
    expect(hashUserId('brain', token)).toBe(hashUserId('brain', token));
  });

  it('userId is 16 hex chars', () => {
    expect(hashUserId('brain', token)).toMatch(/^[a-f0-9]{16}$/);
  });
});

// ---------------------------------------------------------------------------
// authenticate — single shared token (F-01)
// ---------------------------------------------------------------------------
describe('authenticate — shared brain token', () => {
  const valid = 'a'.repeat(48); // 48 hex chars

  it('fails closed (503) when HAWKEYE_BRAIN_TOKEN is unset', () => {
    const r = authenticate(req({ Authorization: `Bearer ${valid}` }));
    expect(r.ok).toBe(false);
    expect(r.response.status).toBe(503);
  });

  it('fails closed when HAWKEYE_BRAIN_TOKEN is too short', () => {
    process.env.HAWKEYE_BRAIN_TOKEN = 'short';
    const r = authenticate(req({ Authorization: `Bearer ${valid}` }));
    expect(r.ok).toBe(false);
    expect(r.response.status).toBe(503);
  });

  it('fails closed when HAWKEYE_BRAIN_TOKEN contains non-hex chars', () => {
    process.env.HAWKEYE_BRAIN_TOKEN = 'ZZZZZZZZ'.repeat(6);
    const r = authenticate(req({ Authorization: `Bearer ${valid}` }));
    expect(r.ok).toBe(false);
    expect(r.response.status).toBe(503);
  });

  it('rejects any random token that is not the server-side value', () => {
    process.env.HAWKEYE_BRAIN_TOKEN = valid;
    const attacker = 'b'.repeat(48);
    const r = authenticate(req({ Authorization: `Bearer ${attacker}` }));
    expect(r.ok).toBe(false);
    expect(r.response.status).toBe(401);
  });

  it('accepts the server-side token', () => {
    process.env.HAWKEYE_BRAIN_TOKEN = valid;
    const r = authenticate(req({ Authorization: `Bearer ${valid}` }));
    expect(r.ok).toBe(true);
    expect(r.userId).toMatch(/^[a-f0-9]{16}$/);
    // F-13: userId must NOT be a prefix of the token
    expect(valid.startsWith(r.userId)).toBe(false);
  });

  it('rejects missing Authorization header', () => {
    process.env.HAWKEYE_BRAIN_TOKEN = valid;
    const r = authenticate(req());
    expect(r.ok).toBe(false);
    expect(r.response.status).toBe(401);
  });

  it('rejects malformed Bearer (wrong scheme)', () => {
    process.env.HAWKEYE_BRAIN_TOKEN = valid;
    const r = authenticate(req({ Authorization: `Basic ${valid}` }));
    expect(r.ok).toBe(false);
    expect(r.response.status).toBe(401);
  });

  it('rejects a 32-hex-char token that is not the server value (proves F-01 fix)', () => {
    process.env.HAWKEYE_BRAIN_TOKEN = valid;
    const shapeValidButWrong = '1234567890abcdef'.repeat(3);
    const r = authenticate(req({ Authorization: `Bearer ${shapeValidButWrong}` }));
    expect(r.ok).toBe(false);
  });

  it('OPTIONS preflight bypasses auth', () => {
    const r = authenticate(req({}, 'OPTIONS'));
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseApproverKeys
// ---------------------------------------------------------------------------
describe('parseApproverKeys', () => {
  const t = (n: number) => String(n).padStart(48, '0');

  it('parses comma-separated user:token pairs', () => {
    const parsed = parseApproverKeys(`mlro:${t(1)},co:${t(2)}`);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ username: 'mlro', token: t(1) });
    expect(parsed[1]).toEqual({ username: 'co', token: t(2) });
  });

  it('ignores empty, malformed, or short entries', () => {
    const parsed = parseApproverKeys(
      `mlro:${t(1)},:${t(2)},co:,badentry,another:short`,
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].username).toBe('mlro');
  });

  it('deduplicates by username (first wins)', () => {
    const parsed = parseApproverKeys(`mlro:${t(1)},mlro:${t(2)}`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].token).toBe(t(1));
  });

  it('rejects non-hex tokens', () => {
    const parsed = parseApproverKeys('mlro:ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ');
    expect(parsed).toHaveLength(0);
  });

  it('handles undefined env var', () => {
    expect(parseApproverKeys(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// authenticateApprover — per-user four-eyes (F-02)
// ---------------------------------------------------------------------------
describe('authenticateApprover — per-user identity', () => {
  const tMlro = 'a'.repeat(48);
  const tCo = 'b'.repeat(48);
  const tAttacker = 'c'.repeat(48);

  it('fails closed (503) when fewer than 2 approvers configured', () => {
    process.env.HAWKEYE_APPROVER_KEYS = `mlro:${tMlro}`;
    const r = authenticateApprover(req({ Authorization: `Bearer ${tMlro}` }));
    expect(r.ok).toBe(false);
    expect(r.response.status).toBe(503);
  });

  it('accepts a registered approver and returns their username', () => {
    process.env.HAWKEYE_APPROVER_KEYS = `mlro:${tMlro},co:${tCo}`;
    const r = authenticateApprover(req({ Authorization: `Bearer ${tMlro}` }));
    expect(r.ok).toBe(true);
    expect(r.username).toBe('mlro');
  });

  it('distinguishes different approvers', () => {
    process.env.HAWKEYE_APPROVER_KEYS = `mlro:${tMlro},co:${tCo}`;
    const rMlro = authenticateApprover(req({ Authorization: `Bearer ${tMlro}` }));
    const rCo = authenticateApprover(req({ Authorization: `Bearer ${tCo}` }));
    expect(rMlro.username).toBe('mlro');
    expect(rCo.username).toBe('co');
    expect(rMlro.userId).not.toBe(rCo.userId);
  });

  it('rejects unregistered tokens', () => {
    process.env.HAWKEYE_APPROVER_KEYS = `mlro:${tMlro},co:${tCo}`;
    const r = authenticateApprover(req({ Authorization: `Bearer ${tAttacker}` }));
    expect(r.ok).toBe(false);
    expect(r.response.status).toBe(401);
  });

  it('F-02 PROOF: attacker with two random tokens cannot produce two distinct approver usernames', () => {
    process.env.HAWKEYE_APPROVER_KEYS = `mlro:${tMlro},co:${tCo}`;
    const fake1 = '1'.repeat(48);
    const fake2 = '2'.repeat(48);
    const r1 = authenticateApprover(req({ Authorization: `Bearer ${fake1}` }));
    const r2 = authenticateApprover(req({ Authorization: `Bearer ${fake2}` }));
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    // Under the OLD broken auth, these would have returned two
    // distinct 16-char prefixes. Now they both return a 401.
  });

  it('OPTIONS preflight bypasses approver auth', () => {
    const r = authenticateApprover(req({}, 'OPTIONS'));
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// authenticate — JWT path (browser MLRO login)
// ---------------------------------------------------------------------------
describe('authenticate — JWT path', () => {
  const JWT_SECRET = 'x'.repeat(48);
  const signForTest = (overrides: Partial<{ sub: string; ttlSec: number; nowSec: number }> = {}) =>
    signJwt({
      sub: overrides.sub ?? 'mlro',
      ttlSec: overrides.ttlSec ?? 3600,
      jti: randomUUID(),
      secret: JWT_SECRET,
      nowSec: overrides.nowSec,
    });

  it('accepts a JWT signed with the server secret', () => {
    process.env.HAWKEYE_JWT_SECRET = JWT_SECRET;
    const token = signForTest();
    const r = authenticate(req({ Authorization: `Bearer ${token}` }));
    expect(r.ok).toBe(true);
    expect(r.username).toBe('mlro');
    expect(r.userId).toMatch(/^[a-f0-9]{16}$/);
    expect(r.jwt?.sub).toBe('mlro');
  });

  it('rejects a JWT when no JWT secret is configured', () => {
    // Configure the hex path so we do not fall into the 503 branch;
    // the JWT must still be rejected since there is no secret to
    // verify it against.
    process.env.HAWKEYE_BRAIN_TOKEN = 'a'.repeat(48);
    const token = signForTest();
    const r = authenticate(req({ Authorization: `Bearer ${token}` }));
    expect(r.ok).toBe(false);
    expect(r.response.status).toBe(401);
  });

  it('rejects a JWT signed with a different secret', () => {
    process.env.HAWKEYE_JWT_SECRET = JWT_SECRET;
    const forged = signJwt({
      sub: 'mlro',
      ttlSec: 3600,
      jti: randomUUID(),
      secret: 'y'.repeat(48),
    });
    const r = authenticate(req({ Authorization: `Bearer ${forged}` }));
    expect(r.ok).toBe(false);
    expect(r.response.status).toBe(401);
  });

  it('rejects an expired JWT', () => {
    process.env.HAWKEYE_JWT_SECRET = JWT_SECRET;
    // Issued "in the past" with a short TTL that has already lapsed.
    const token = signJwt({
      sub: 'mlro',
      ttlSec: 60,
      jti: randomUUID(),
      secret: JWT_SECRET,
      nowSec: Math.floor(Date.now() / 1000) - 3600,
    });
    const r = authenticate(req({ Authorization: `Bearer ${token}` }));
    expect(r.ok).toBe(false);
    expect(r.response.status).toBe(401);
  });

  it('rejects an alg:none token even when the JWT secret is set', () => {
    process.env.HAWKEYE_JWT_SECRET = JWT_SECRET;
    // Hand-craft a three-segment token with a non-HS256 header.
    const b64url = (s: string): string =>
      Buffer.from(s, 'utf8')
        .toString('base64')
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '');
    const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const payload = b64url(
      JSON.stringify({
        sub: 'mlro',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        jti: 'xxx',
        v: 1,
      })
    );
    const forged = `${header}.${payload}.`;
    const r = authenticate(req({ Authorization: `Bearer ${forged}` }));
    expect(r.ok).toBe(false);
    expect(r.response.status).toBe(401);
  });

  it('returns DIFFERENT userIds for JWT and hex principals on the same secret material', () => {
    process.env.HAWKEYE_JWT_SECRET = JWT_SECRET;
    process.env.HAWKEYE_BRAIN_TOKEN = 'a'.repeat(48);
    const jwtToken = signForTest();
    const rJwt = authenticate(req({ Authorization: `Bearer ${jwtToken}` }));
    const rHex = authenticate(req({ Authorization: `Bearer ${'a'.repeat(48)}` }));
    expect(rJwt.ok).toBe(true);
    expect(rHex.ok).toBe(true);
    // JWT principal is labelled "jwt:<sub>", hex is labelled "brain",
    // so even a constant-JTI coincidence cannot collide the audit id.
    expect(rJwt.userId).not.toBe(rHex.userId);
  });

  it('still accepts the hex bearer when JWT secret is also configured', () => {
    process.env.HAWKEYE_BRAIN_TOKEN = 'a'.repeat(48);
    process.env.HAWKEYE_JWT_SECRET = JWT_SECRET;
    const r = authenticate(req({ Authorization: `Bearer ${'a'.repeat(48)}` }));
    expect(r.ok).toBe(true);
    expect(r.userId).toMatch(/^[a-f0-9]{16}$/);
  });

  it('rejects a bearer that is neither a valid JWT shape nor hex', () => {
    process.env.HAWKEYE_JWT_SECRET = JWT_SECRET;
    const r = authenticate(req({ Authorization: 'Bearer not.a.token!' }));
    expect(r.ok).toBe(false);
    expect(r.response.status).toBe(401);
  });
});
