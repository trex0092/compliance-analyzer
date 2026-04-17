/**
 * RFC 6238 TOTP (Time-based One-Time Password) verifier.
 *
 * Zero-dependency. Uses Web Crypto API — works in Node 20+,
 * the browser, and the Netlify serverless/edge runtime.
 *
 * This module is the second factor for the setup wizard. The
 * first factor is the bearer token verified by
 * `netlify/functions/middleware/auth.mts`. Both must pass for
 * the request to reach the business logic of any
 * `netlify/functions/setup-*.mts` endpoint.
 *
 * Regulatory basis:
 *   Cabinet Res 134/2025 Art.5  (firm risk appetite — hardening
 *                                high-blast-radius admin surfaces)
 *   Cabinet Res 134/2025 Art.19 (internal review — compensating
 *                                control against a leaked bearer
 *                                token)
 *
 * Design notes:
 *   - 30-second step, 6 digits, HMAC-SHA1: the RFC 6238 baseline
 *     and what every authenticator app (Google Authenticator, 1Password,
 *     Bitwarden, Authy) produces by default.
 *   - ±1 step window (90s total) to tolerate device clock drift.
 *   - Constant-time string compare on the final 6 digits to avoid
 *     timing leaks on near-misses.
 *   - Fail-closed: any malformed input, missing secret, or decode
 *     error is rejected.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEFAULT_PERIOD_SECONDS = 30;
const DEFAULT_DIGITS = 6;
const DEFAULT_WINDOW = 1;

export interface VerifyTotpOptions {
  /** Step length in seconds. RFC 6238 default is 30. */
  period?: number;
  /** Code length in digits. RFC 6238 default is 6. */
  digits?: number;
  /** How many steps either side of "now" to accept. Default 1 (±30s). */
  window?: number;
  /**
   * Override "now" in seconds since the epoch. Tests use this; production
   * callers should not set it.
   */
  nowSeconds?: number;
}

/**
 * Decode a base32 (RFC 4648) string — upper-case letters and digits
 * 2-7, optional `=` padding — to raw bytes. Ignores whitespace and
 * lower-cases, to survive copy-paste.
 *
 * Returns null on any invalid character so the caller can fail closed.
 */
function base32Decode(input: string): Uint8Array | null {
  const cleaned = input.replace(/\s+/g, '').toUpperCase().replace(/=+$/, '');
  if (cleaned.length === 0) {
    return null;
  }
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned.charAt(i);
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) {
      return null;
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/**
 * Compute an 8-byte big-endian counter from a step counter.
 */
function counterToBytes(counter: number): Uint8Array {
  const buf = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i -= 1) {
    buf[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  return buf;
}

async function hmacSha1(keyBytes: Uint8Array, messageBytes: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, messageBytes as BufferSource);
  return new Uint8Array(sig);
}

/**
 * Dynamic truncation per RFC 4226 §5.3 → RFC 6238.
 */
function truncate(digest: Uint8Array, digits: number): string {
  const offset = digest[digest.length - 1] & 0x0f;
  const binCode =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  const modulo = 10 ** digits;
  return (binCode % modulo).toString().padStart(digits, '0');
}

/**
 * Constant-time string compare. Avoids early-exit timing leaks on
 * near-miss codes. Both inputs are expected to be short (6-8 digits)
 * so any length mismatch is treated as a mismatch without branching
 * on content.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Compute a TOTP code for a given time step. Exported for tests that
 * want to assert against RFC 6238 vectors. Production callers should
 * use `verifyTotp`.
 */
export async function computeTotp(
  secretBase32: string,
  nowSeconds: number,
  opts: { period?: number; digits?: number } = {}
): Promise<string | null> {
  const period = opts.period ?? DEFAULT_PERIOD_SECONDS;
  const digits = opts.digits ?? DEFAULT_DIGITS;
  const secret = base32Decode(secretBase32);
  if (!secret) {
    return null;
  }
  const counter = Math.floor(nowSeconds / period);
  const digest = await hmacSha1(secret, counterToBytes(counter));
  return truncate(digest, digits);
}

/**
 * Verify a submitted TOTP code against a base32 secret.
 *
 * Returns true iff the code matches any step in the window around "now".
 * Returns false for any malformed input, missing secret, or decode error.
 */
export async function verifyTotp(
  code: string,
  secretBase32: string,
  opts: VerifyTotpOptions = {}
): Promise<boolean> {
  const period = opts.period ?? DEFAULT_PERIOD_SECONDS;
  const digits = opts.digits ?? DEFAULT_DIGITS;
  const window = opts.window ?? DEFAULT_WINDOW;
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (typeof code !== 'string' || !/^\d+$/.test(code) || code.length !== digits) {
    return false;
  }
  if (typeof secretBase32 !== 'string' || secretBase32.length < 16) {
    return false;
  }

  const secret = base32Decode(secretBase32);
  if (!secret || secret.length === 0) {
    return false;
  }

  const baseCounter = Math.floor(now / period);
  // Compute every candidate up-front and compare them all so the
  // total time is independent of which step matched (or none did).
  const candidates: string[] = [];
  for (let delta = -window; delta <= window; delta += 1) {
    const counter = baseCounter + delta;
    if (counter < 0) {
      candidates.push(''.padStart(digits, '0'));
      continue;
    }
    const digest = await hmacSha1(secret, counterToBytes(counter));
    candidates.push(truncate(digest, digits));
  }
  let matched = false;
  for (const candidate of candidates) {
    if (constantTimeEqual(candidate, code)) {
      matched = true;
    }
  }
  return matched;
}
