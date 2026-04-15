/**
 * Brain URL normalization — defensive sanitization for the
 * HAWKEYE_BRAIN_URL / PUBLIC_BASE_URL env vars so operator typos
 * in the Netlify / GitHub dashboards cannot break the scheduled
 * workflows or the CORS allowlist.
 *
 * Why this exists:
 *   Operators paste URLs by hand into the Netlify and GitHub env
 *   UIs on phones. We have observed these typo classes in the wild:
 *
 *     1. Trailing slash:   "https://hawkeye-sterling-v2.netlify.app/"
 *        → downstream path builds like `${url}/api/brain` produce
 *          "...netlify.app//api/brain" which 404s in some edge
 *          configurations and fails the CORS exact-match.
 *
 *     2. Trailing dot (FQDN marker):
 *          "https://hawkeye-sterling-v2.netlify.app."
 *        → some DNS resolvers treat this as a different host
 *          (the trailing dot means "no suffix search"); the CORS
 *          header compare fails.
 *
 *     3. Leading / trailing whitespace from clipboard paste.
 *
 *     4. Mixed case in the hostname from autocorrect.
 *
 *   This module does the minimum safe normalization. It does NOT
 *   try to be smart about path components or query strings — the
 *   brain URL is expected to be the bare origin.
 *
 * Pure function. No I/O, no state, no network. Safe for tests and
 * for netlify functions.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO continuous operational oversight)
 *   Cabinet Res 134/2025 Art.19 (internal review — dashboard drift)
 *   NIST AI RMF 1.0 MANAGE-3 (incident response readiness — fail
 *                             fast on misconfiguration)
 */

/**
 * Canonical production brain URL. This is the single source of
 * truth for the default — every env fallback across the repo
 * should reference this constant or call `normalizeBrainUrl(undefined)`.
 */
export const CANONICAL_BRAIN_URL = 'https://hawkeye-sterling-v2.netlify.app';

/**
 * Legacy URL substring. Used by `containsLegacyBrainHost` below so
 * the env validator can flag any dashboard drift where an operator
 * left the old URL in place on one of the Netlify / GitHub env vars.
 */
export const LEGACY_BRAIN_HOST = 'compliance-analyzer.netlify.app';

/**
 * Normalize a brain URL. Accepts `undefined` / empty string and
 * returns the canonical default. Accepts strings with stray
 * whitespace, trailing slashes, trailing dots, and returns a
 * canonicalized origin with no trailing path.
 *
 * Contract:
 *   - Input `undefined` or `""` → returns `CANONICAL_BRAIN_URL`.
 *   - Input with leading / trailing whitespace → trimmed.
 *   - Input with trailing `/` or `.` (any number) → stripped.
 *   - Input without a scheme → `https://` is prepended. (Operators
 *     occasionally paste the bare host.)
 *   - Input with `http://` → left as-is. The caller's HTTPS
 *     validation (in asanaEnvCheck.ts) still fires separately.
 *
 * This function never throws. It returns a best-effort canonical
 * form so downstream code can always build URLs deterministically.
 */
export function normalizeBrainUrl(raw: string | undefined | null): string {
  if (raw === undefined || raw === null) return CANONICAL_BRAIN_URL;
  let u = String(raw).trim();
  if (u.length === 0) return CANONICAL_BRAIN_URL;

  // Early guard: bare scheme fragments (e.g. `http`, `https:`,
  // `https:/`, `https://`) have no host and cannot be repaired by
  // normalization. Return the canonical default immediately so the
  // prepend-https step below does not produce broken values like
  // `https://https:/`.
  if (/^https?:?\/?\/?$/i.test(u)) {
    return CANONICAL_BRAIN_URL;
  }

  // Prepend https:// if the caller pasted a bare host.
  if (!/^https?:\/\//i.test(u)) {
    u = 'https://' + u;
  }

  // Strip trailing dots and slashes repeatedly. `while` covers
  // pathological cases like `....///` at the end.
  while (u.length > 0 && (u.endsWith('/') || u.endsWith('.'))) {
    u = u.slice(0, -1);
  }

  // Post-strip guard: if the normalization stripped everything down
  // to just a scheme remnant, fall back to the canonical default
  // rather than return a broken URL. Covers pathological input like
  // `/`, `.`, `///....///` that walked through the prepend step.
  if (/^https?:?\/?\/?$/i.test(u)) {
    return CANONICAL_BRAIN_URL;
  }

  return u;
}

/**
 * Detect whether a URL / env-var value contains the legacy host.
 * Used by `envConfigValidator` to warn operators that a dashboard
 * env var is still pointing at the retired site.
 *
 * Case-insensitive. Substring match — any occurrence anywhere in
 * the string is flagged. An empty / undefined input returns false.
 */
export function containsLegacyBrainHost(value: string | undefined | null): boolean {
  if (value === undefined || value === null) return false;
  return String(value).toLowerCase().includes(LEGACY_BRAIN_HOST);
}
