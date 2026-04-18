import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt, looksLikeJwt, JwtError } from '../src/utils/jwt';
import { createHmac, randomUUID } from 'node:crypto';

/**
 * JWT helper — signature + claim invariants.
 *
 * Scope:
 *   - sign/verify round-trip preserves the payload
 *   - alg:none, RS256, bad JSON headers are all rejected
 *   - signature forgery (right header/payload, wrong MAC) rejected
 *   - expired / future-iat / missing-claim branches each fire with
 *     the documented error `code`
 *   - looksLikeJwt() dispatcher accepts exactly the right shapes
 *
 * Why: the middleware's JWT branch is the ONLY door the browser has
 * into every authenticated endpoint once the MLRO signs in. A subtle
 * verify bug (accepting alg:none, skipping expiry, etc.) is a
 * session-compromise bug. Test every failure mode explicitly.
 */

const SECRET = 'x'.repeat(48); // 48 chars ≥ 32-byte floor

function b64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), 'utf8')
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

describe('signJwt / verifyJwt — round trip', () => {
  it('accepts a freshly-signed token and returns the payload', () => {
    const jti = randomUUID();
    const token = signJwt({ sub: 'mlro', ttlSec: 3600, jti, secret: SECRET });
    const payload = verifyJwt({ token, secret: SECRET });
    expect(payload.sub).toBe('mlro');
    expect(payload.jti).toBe(jti);
    expect(payload.v).toBe(1);
    expect(payload.exp).toBeGreaterThan(payload.iat);
    expect(payload.exp - payload.iat).toBe(3600);
  });

  it('signs deterministically for a fixed nowSec + jti', () => {
    const t1 = signJwt({ sub: 'mlro', ttlSec: 60, jti: 'fixed', secret: SECRET, nowSec: 1_000_000 });
    const t2 = signJwt({ sub: 'mlro', ttlSec: 60, jti: 'fixed', secret: SECRET, nowSec: 1_000_000 });
    expect(t1).toBe(t2);
  });

  it('rejects a secret shorter than 32 bytes on sign', () => {
    expect(() =>
      signJwt({ sub: 'mlro', ttlSec: 60, jti: 'x', secret: 'tooshort' })
    ).toThrow(JwtError);
  });

  it('rejects a secret shorter than 32 bytes on verify', () => {
    const token = signJwt({ sub: 'mlro', ttlSec: 60, jti: 'x', secret: SECRET });
    expect(() => verifyJwt({ token, secret: 'tooshort' })).toThrow(JwtError);
  });
});

describe('verifyJwt — rejections', () => {
  it('rejects a token that is not three segments', () => {
    try {
      verifyJwt({ token: 'only.two', secret: SECRET });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JwtError);
      expect((err as JwtError).code).toBe('malformed');
    }
  });

  it('rejects alg:none even with a valid payload', () => {
    const header = b64urlJson({ alg: 'none', typ: 'JWT' });
    const payload = b64urlJson({
      sub: 'mlro',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
      jti: 'x',
      v: 1,
    });
    const token = `${header}.${payload}.`;
    try {
      verifyJwt({ token, secret: SECRET });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JwtError);
      expect((err as JwtError).code).toBe('bad-header');
    }
  });

  it('rejects RS256 (asymmetric is not implemented)', () => {
    const header = b64urlJson({ alg: 'RS256', typ: 'JWT' });
    const payload = b64urlJson({
      sub: 'mlro',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
      jti: 'x',
      v: 1,
    });
    // Sign with HMAC so the SIGNATURE is well-formed — this proves the
    // rejection is on the header alg, not on the MAC.
    const signingInput = `${header}.${payload}`;
    const sig = createHmac('sha256', SECRET)
      .update(signingInput)
      .digest('base64')
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    try {
      verifyJwt({ token: `${signingInput}.${sig}`, secret: SECRET });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JwtError);
      expect((err as JwtError).code).toBe('bad-header');
    }
  });

  it('rejects a signature forged against a different secret', () => {
    const forged = signJwt({ sub: 'mlro', ttlSec: 60, jti: 'x', secret: 'y'.repeat(48) });
    try {
      verifyJwt({ token: forged, secret: SECRET });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JwtError);
      expect((err as JwtError).code).toBe('bad-signature');
    }
  });

  it('rejects an expired token with code=expired', () => {
    const token = signJwt({
      sub: 'mlro',
      ttlSec: 60,
      jti: 'x',
      secret: SECRET,
      nowSec: Math.floor(Date.now() / 1000) - 3600,
    });
    try {
      verifyJwt({ token, secret: SECRET });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JwtError);
      expect((err as JwtError).code).toBe('expired');
    }
  });

  it('rejects a future-dated iat with code=future-iat', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = signJwt({
      sub: 'mlro',
      ttlSec: 3600,
      jti: 'x',
      secret: SECRET,
      nowSec: nowSec + 60_000, // ~16 hours in the future
    });
    try {
      verifyJwt({ token, secret: SECRET });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JwtError);
      expect((err as JwtError).code).toBe('future-iat');
    }
  });

  it('honours clockSkewSec for borderline expiry', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    // iat = now - 120, exp = now - 60  (expired 60 seconds ago)
    const token = signJwt({
      sub: 'mlro',
      ttlSec: 60,
      jti: 'x',
      secret: SECRET,
      nowSec: nowSec - 120,
    });
    // Zero skew → expired.
    expect(() => verifyJwt({ token, secret: SECRET })).toThrow(JwtError);
    // 120s skew → accepted.
    const payload = verifyJwt({ token, secret: SECRET, clockSkewSec: 120 });
    expect(payload.sub).toBe('mlro');
  });

  it('rejects missing claims with code=missing-claim', () => {
    // Payload that passes JSON.parse but lacks jti.
    const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
    const payload = b64urlJson({
      sub: 'mlro',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
      v: 1,
    });
    const signingInput = `${header}.${payload}`;
    const sig = createHmac('sha256', SECRET)
      .update(signingInput)
      .digest('base64')
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    try {
      verifyJwt({ token: `${signingInput}.${sig}`, secret: SECRET });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JwtError);
      expect((err as JwtError).code).toBe('missing-claim');
    }
  });
});

describe('looksLikeJwt — dispatch hint', () => {
  it('accepts a freshly-signed token', () => {
    const token = signJwt({ sub: 'mlro', ttlSec: 60, jti: 'x', secret: SECRET });
    expect(looksLikeJwt(token)).toBe(true);
  });

  it('rejects a hex bearer (no dots)', () => {
    expect(looksLikeJwt('a'.repeat(48))).toBe(false);
  });

  it('rejects empty / short / non-string inputs', () => {
    expect(looksLikeJwt('')).toBe(false);
    expect(looksLikeJwt('a.b.c')).toBe(false); // too short
    // @ts-expect-error — intentional runtime check
    expect(looksLikeJwt(null)).toBe(false);
    // @ts-expect-error
    expect(looksLikeJwt(undefined)).toBe(false);
  });

  it('rejects a string with the wrong number of dots', () => {
    expect(looksLikeJwt('a.b')).toBe(false);
    expect(looksLikeJwt('a.b.c.d')).toBe(false);
  });
});
