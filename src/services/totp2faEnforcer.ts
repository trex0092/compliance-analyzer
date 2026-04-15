/**
 * TOTP 2FA Enforcer — RFC-6238-compatible TOTP validator for
 * per-user two-factor enforcement.
 *
 * Why this exists:
 *   Every customer-facing brain endpoint uses Bearer tokens, but
 *   the tool UI is a web app — a compromised session cookie is a
 *   full takeover. 2FA with a TOTP authenticator (Google
 *   Authenticator, Authy, 1Password) is the minimum bar for any
 *   compliance tool with PII + regulator access.
 *
 *   This module is the PURE validator. No secret storage, no QR
 *   code generation — those go to the frontend + a separate secret
 *   store. The validator takes a shared secret (base32) + the
 *   user-supplied 6-digit code + the current wall time and returns
 *   whether the code is valid.
 *
 *   RFC-6238 specifies HMAC-SHA1 over the current time-step (T=30s
 *   by default). This module implements the algorithm from scratch
 *   using SubtleCrypto so there is no external dependency.
 *
 * Regulatory basis:
 *   ISO/IEC 27001 A.9.4 (secure authentication)
 *   NIST SP 800-63B (multi-factor authentication)
 *   EU NIS 2 Directive (essential entity — strong authentication)
 *   FDL No.10/2025 Art.20-22 (CO operational security)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TotpOptions {
  /** Time-step in seconds. Default 30. */
  stepSeconds?: number;
  /** Code length. Default 6. */
  digits?: 6 | 7 | 8;
  /** Clock drift tolerance in steps. Default 1. */
  driftSteps?: number;
}

export interface ValidateInput {
  secretBase32: string;
  code: string;
  /** Current time in seconds since epoch. */
  nowSeconds: number;
}

export interface ValidateResult {
  ok: boolean;
  reason: string;
  /**
   * Matched step offset from the current time step. -1 or +1 means
   * the code was valid under clock drift, 0 means the current step.
   * Undefined when not valid.
   */
  matchedStepOffset?: number;
}

// ---------------------------------------------------------------------------
// Base32 (RFC-4648) decode
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function decodeBase32(input: string): Uint8Array {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  if (clean.length === 0) return new Uint8Array(0);

  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]!);
    if (idx < 0) throw new Error(`decodeBase32: invalid character at position ${i}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------------------
// HOTP / TOTP core
// ---------------------------------------------------------------------------

async function hmacSha1(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  // Use globalThis.crypto.subtle — available in Node 20+ and every browser.
  // The `as any` dance keeps this file dependency-free.
  const subtle = (globalThis as unknown as { crypto: { subtle: SubtleCrypto } }).crypto.subtle;
  const cryptoKey = await subtle.importKey(
    'raw',
    key as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const sig = await subtle.sign('HMAC', cryptoKey, message as unknown as BufferSource);
  return new Uint8Array(sig);
}

function encodeCounter(counter: number): Uint8Array {
  const buf = new Uint8Array(8);
  // counter is a 64-bit big-endian integer. JS number is 53-bit safe;
  // realistic counters for TOTP fit comfortably.
  let n = counter;
  for (let i = 7; i >= 0; i--) {
    buf[i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  return buf;
}

function dynamicTruncate(hmac: Uint8Array, digits: 6 | 7 | 8): string {
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binCode =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  const mod = Math.pow(10, digits);
  const code = binCode % mod;
  return code.toString().padStart(digits, '0');
}

export async function generateTotp(
  secretBase32: string,
  nowSeconds: number,
  opts: TotpOptions = {}
): Promise<string> {
  const step = opts.stepSeconds ?? 30;
  const digits = opts.digits ?? 6;
  const key = decodeBase32(secretBase32);
  const counter = Math.floor(nowSeconds / step);
  const hmac = await hmacSha1(key, encodeCounter(counter));
  return dynamicTruncate(hmac, digits);
}

// ---------------------------------------------------------------------------
// Public validator
// ---------------------------------------------------------------------------

export async function validateTotp(
  input: ValidateInput,
  opts: TotpOptions = {}
): Promise<ValidateResult> {
  if (!input.secretBase32 || input.secretBase32.length === 0) {
    return { ok: false, reason: 'secretBase32 missing' };
  }
  if (!input.code || !/^\d+$/.test(input.code)) {
    return { ok: false, reason: 'code must be all digits' };
  }
  const digits = opts.digits ?? 6;
  if (input.code.length !== digits) {
    return { ok: false, reason: `code must be ${digits} digits` };
  }
  const drift = opts.driftSteps ?? 1;
  const step = opts.stepSeconds ?? 30;
  const baseCounter = Math.floor(input.nowSeconds / step);
  const key = decodeBase32(input.secretBase32);

  for (let offset = -drift; offset <= drift; offset++) {
    const hmac = await hmacSha1(key, encodeCounter(baseCounter + offset));
    const candidate = dynamicTruncate(hmac, digits);
    if (timingSafeEqual(candidate, input.code)) {
      return {
        ok: true,
        reason: offset === 0 ? 'valid (current step)' : `valid (drift offset ${offset})`,
        matchedStepOffset: offset,
      };
    }
  }
  return { ok: false, reason: 'code did not match any step in the drift window' };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Exports for tests.
export const __test__ = { encodeCounter, dynamicTruncate, timingSafeEqual };
