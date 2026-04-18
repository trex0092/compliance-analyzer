/**
 * fetchWithTimeout — shared timeout wrapper for every outbound
 * server-side `fetch()` in this codebase.
 *
 * WHY this exists:
 * A hung outbound fetch on a Netlify function silently exhausts the
 * platform's execution budget (10s free tier, 26s Pro) and the
 * function is killed with no audit entry. Several compliance flows
 * are built on outbound fetches where that is unacceptable:
 *
 *   - EOCN sanctions-feed pull  (FDL No.10/2025 Art.35, Cabinet Res 74/2020)
 *   - STR / freeze notifications to Teams / internal brain
 *   - MLRO command dispatch into Asana
 *   - advisor / provider AI calls
 *
 * Previously these sites were a mix of `AbortSignal.timeout(...)`,
 * `AbortController + setTimeout`, and bare `await fetch(url)`. Three
 * patterns, four local copies of a `fetchWithTimeout` helper, and
 * several true zero-timeout gaps where a hung upstream would cost
 * the whole Netlify invocation. This module is the single source
 * of truth.
 *
 * USAGE:
 *
 *   import { fetchWithTimeout, TimeoutError } from '../utils/fetchWithTimeout';
 *
 *   const res = await fetchWithTimeout(url, {
 *     method: 'POST',
 *     body: JSON.stringify(payload),
 *     timeoutMs: 10_000,  // required; no silent default
 *   });
 *
 *   // On timeout, `fetch` rejects with a `TimeoutError` whose
 *   // message includes the URL and elapsed duration. Callers that
 *   // need to distinguish timeouts from other failures can do
 *   // `if (err instanceof TimeoutError) { ... }`.
 *
 * The wrapper also lets callers pass their own AbortSignal (for
 * example, a request-scoped signal on a Netlify function) — if
 * provided, the upstream fetch aborts as soon as EITHER the
 * timeout fires OR the caller's signal aborts, whichever comes first.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO accountability — every outbound
 *     call in a compliance flow must either succeed, fail cleanly,
 *     or time out; silent exhaustion is not an acceptable outcome)
 *   - FDL No.10/2025 Art.24 (10-year record retention — a function
 *     killed by the platform leaves no audit row)
 *   - FATF Rec 10 / 11 (record-keeping and traceability)
 */

/**
 * Hard ceiling on any single round trip. Picked deliberately well
 * below Netlify's background-function budget (15 min) and above our
 * slowest legitimate upstream (bulk sanctions list pulls can hit
 * ~30-45s during a full monthly refresh), so typos like `6_000_000`
 * fail fast at the boundary instead of silently committing the
 * whole Netlify invocation to a run-away call. Callers that need
 * longer than this are in the wrong shape — that work belongs in
 * a background or scheduled function, not a request-scoped fetch.
 */
export const MAX_TIMEOUT_MS = 120_000;

/**
 * Redact query-string VALUES and userinfo from a URL before surfacing
 * it in error messages / logs. We keep the host + path + parameter
 * NAMES (useful for debugging) but replace each value with `***`.
 *
 * WHY: three live call sites embed sensitive data directly in the
 * request URL today:
 *   - `?api_key=<secret>`  (Brave, SerpAPI, Google Gemini)
 *   - `?key=<secret>`      (Google Gemini)
 *   - `?q=<subject-name>`  (adverse media — subject PII, FDL Art.29
 *     risk: a timeout stacktrace must not echo the subject back into
 *     an ops log where a non-MLRO could read it)
 *
 * A hung fetch was previously logged with the full URL in the
 * TimeoutError message. That message flows into Netlify function
 * logs (retained 30 days on Pro) and into Sentry / Datadog if
 * configured. Both are outside the FDL Art.24 audit perimeter.
 *
 * The function is tolerant: if the input is not a parseable URL
 * (e.g. relative path from a Request object, or a malformed string),
 * we fall back to the raw input unchanged rather than throwing —
 * the caller already has a separate failure on its hands.
 */
export function redactUrlForLogging(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.username || parsed.password) {
    parsed.username = '***';
    parsed.password = '';
  }
  if (parsed.search) {
    const keys = [...parsed.searchParams.keys()];
    parsed.search = keys.length
      ? '?' + keys.map((k) => `${encodeURIComponent(k)}=***`).join('&')
      : '';
  }
  return parsed.toString();
}

export class TimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;
  readonly elapsedMs: number;

  constructor(url: string, timeoutMs: number, elapsedMs: number) {
    const safe = redactUrlForLogging(url);
    super(`fetch timed out after ${elapsedMs}ms (budget ${timeoutMs}ms): ${safe}`);
    this.name = 'TimeoutError';
    // Store the REDACTED URL on the error. Callers that genuinely
    // need the raw URL already have it at the call site — they
    // should not fish it out of an error surface.
    this.url = safe;
    this.timeoutMs = timeoutMs;
    this.elapsedMs = elapsedMs;
  }
}

export interface FetchWithTimeoutInit extends RequestInit {
  /**
   * Hard upper bound on the round trip, in milliseconds. Required —
   * there is no silent default, because picking the wrong default
   * has been the exact source of past incidents. Common values:
   * 8_000 (internal), 15_000 (most third parties), 30_000 (bulk
   * sanctions-list pulls).
   */
  timeoutMs: number;
}

/**
 * Which side won the abort race. Recorded at the exact moment a
 * signal fires so the catch block can classify the rejection
 * correctly even when the caller's signal and the timeout signal
 * both end up aborted by the time we inspect them.
 *
 * Before this refactor we classified by looking at
 * `timeoutController.signal.aborted && !callerSignal.aborted`
 * after the await resolved. That check was wrong whenever the
 * timeout fired first and the caller's signal then fired while
 * the fetch was tearing down (not uncommon on a cancelled user
 * request that also happens to be slow) — both signals ended up
 * aborted, so we misclassified a real timeout as a caller abort
 * and no TimeoutError was raised, so the elapsed-time telemetry
 * was lost.
 */
type RaceWinner = 'timeout' | 'caller' | null;

/**
 * Combine the caller's own AbortSignal (if any) with the
 * timeout signal. Returns the combined signal and a getter for
 * which side fired first (for post-hoc classification).
 *
 * We implement this manually rather than using
 * `AbortSignal.any([...])` because that method is Node 20.3+ /
 * recent browsers only, and a few of our deploy targets
 * (Netlify builders, older CI images) still see older Node.
 */
function linkSignals(
  timeoutSignal: AbortSignal,
  callerSignal: AbortSignal | null | undefined
): { signal: AbortSignal; winner: () => RaceWinner } {
  let winner: RaceWinner = null;
  const markWinner = (who: Exclude<RaceWinner, null>): void => {
    if (winner === null) winner = who;
  };

  if (!callerSignal) {
    if (timeoutSignal.aborted) markWinner('timeout');
    else timeoutSignal.addEventListener('abort', () => markWinner('timeout'), { once: true });
    return { signal: timeoutSignal, winner: () => winner };
  }

  const controller = new AbortController();
  const abort = (reason: unknown): void => {
    if (!controller.signal.aborted) controller.abort(reason);
  };

  if (callerSignal.aborted) {
    markWinner('caller');
    abort(callerSignal.reason);
  } else {
    callerSignal.addEventListener(
      'abort',
      () => {
        markWinner('caller');
        abort(callerSignal.reason);
      },
      { once: true }
    );
  }
  if (timeoutSignal.aborted) {
    markWinner('timeout');
    abort(timeoutSignal.reason);
  } else {
    timeoutSignal.addEventListener(
      'abort',
      () => {
        markWinner('timeout');
        abort(timeoutSignal.reason);
      },
      { once: true }
    );
  }

  return { signal: controller.signal, winner: () => winner };
}

/**
 * Drop-in replacement for `fetch` with a mandatory timeout.
 * On timeout, rejects with a `TimeoutError` carrying the URL
 * and elapsed duration so the caller can log / count / alert
 * on timeouts specifically.
 *
 * The global `fetch` is looked up at call time rather than at
 * module load so this module stays safe to import in the
 * browser SPA context as well (compliance-suite.js will not
 * execute on require).
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: FetchWithTimeoutInit
): Promise<Response> {
  const { timeoutMs, signal: callerSignal, ...rest } = init;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError(
      `fetchWithTimeout: timeoutMs must be a positive finite number (got ${timeoutMs})`
    );
  }
  if (timeoutMs > MAX_TIMEOUT_MS) {
    throw new TypeError(
      `fetchWithTimeout: timeoutMs ${timeoutMs} exceeds the MAX_TIMEOUT_MS ceiling of ${MAX_TIMEOUT_MS}ms. ` +
        `Work that needs a longer budget belongs in a Netlify background or scheduled function, ` +
        `not a request-scoped fetch.`
    );
  }

  const urlForError =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : // Request object: read .url without consuming the body
          input.url;

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const { signal, winner } = linkSignals(
    timeoutController.signal,
    callerSignal as AbortSignal | undefined
  );
  const startedAt = Date.now();

  try {
    return await fetch(input, { ...rest, signal });
  } catch (err) {
    // Classify by which side of the race fired FIRST, not by which
    // signals happen to be aborted after the fetch rejected. See
    // the RaceWinner doc comment above for why this matters.
    if (winner() === 'timeout') {
      throw new TimeoutError(urlForError, timeoutMs, Date.now() - startedAt);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
