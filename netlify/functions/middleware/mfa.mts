/**
 * MFA Middleware — second factor for the setup wizard.
 *
 * Enforces a TOTP (RFC 6238, HMAC-SHA1, 30s step, 6 digits) code
 * alongside the bearer-token check in `./auth.mts`. Both factors must
 * pass for the request to reach business logic.
 *
 * The TOTP secret lives in the `SETUP_MFA_TOTP_SECRET` env var,
 * base32-encoded per RFC 4648. The MLRO provisions the secret
 * out-of-band (1Password, Bitwarden, Authy) and rotates it by
 * updating the Netlify env var.
 *
 * Fail-closed semantics:
 *   - Missing env var           → 503 "MFA not configured"
 *   - Missing X-MFA-Code header → 401 "Missing MFA code"
 *   - Malformed header          → 401 "Invalid MFA code format"
 *   - Verification fails        → 401 "Invalid MFA code"
 *
 * The 6-digit code is never logged, per CLAUDE.md logging rules.
 *
 * Regulatory basis:
 *   Cabinet Res 134/2025 Art.5  (firm risk appetite)
 *   Cabinet Res 134/2025 Art.19 (internal review)
 *
 * Used by: netlify/functions/setup-*.mts (all setup-wizard endpoints).
 */

import { verifyTotp } from '../../../src/utils/mfa';

const HEADER_KEY = 'X-MFA-Code';
const SECRET_MIN_LENGTH = 16;

export interface MfaResult {
  ok: boolean;
  response?: Response;
}

function reject(status: number, error: string): MfaResult {
  return { ok: false, response: Response.json({ error }, { status }) };
}

/**
 * Enforce MFA on a request. Returns `{ ok: true }` on success.
 * On failure the `response` field holds a pre-built Response the
 * caller should return directly.
 *
 * Preflight (OPTIONS) requests skip MFA — CORS preflight cannot
 * carry custom headers.
 */
export async function requireMfa(req: Request): Promise<MfaResult> {
  if (req.method === 'OPTIONS') {
    return { ok: true };
  }

  const secret = process.env.SETUP_MFA_TOTP_SECRET;
  if (!secret || secret.length < SECRET_MIN_LENGTH) {
    console.error('[mfa] SETUP_MFA_TOTP_SECRET is missing or too short');
    return reject(503, 'MFA is not configured on this server');
  }

  const headerValue = req.headers.get(HEADER_KEY);
  if (!headerValue) {
    return reject(401, `Missing ${HEADER_KEY} header`);
  }

  // Normalise but do not log. Accept a single 6-digit group, possibly
  // with a space in the middle (e.g. "123 456") as most authenticator
  // apps format them.
  const normalised = headerValue.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalised)) {
    return reject(401, `Invalid ${HEADER_KEY} format (6 digits required)`);
  }

  const ok = await verifyTotp(normalised, secret);
  if (!ok) {
    // Do not echo the code or the secret in logs.
    console.warn('[mfa] rejected code (ip=%s)', (req.headers.get('x-nf-client-connection-ip') ?? 'unknown'));
    return reject(401, 'Invalid MFA code');
  }

  return { ok: true };
}
