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

export class TimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;
  readonly elapsedMs: number;

  constructor(url: string, timeoutMs: number, elapsedMs: number) {
    super(`fetch timed out after ${elapsedMs}ms (budget ${timeoutMs}ms): ${url}`);
    this.name = 'TimeoutError';
    this.url = url;
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
 * Combine the caller's own AbortSignal (if any) with the
 * timeout signal. Returns a signal that aborts when EITHER
 * the timeout fires OR the caller's signal aborts.
 *
 * We implement this manually rather than using
 * `AbortSignal.any([...])` because that method is Node 20.3+ /
 * recent browsers only, and a few of our deploy targets
 * (Netlify builders, older CI images) still see older Node.
 */
function linkSignals(
  timeoutSignal: AbortSignal,
  callerSignal: AbortSignal | null | undefined
): AbortSignal {
  if (!callerSignal) return timeoutSignal;
  const controller = new AbortController();

  const abort = (reason: unknown): void => {
    if (!controller.signal.aborted) controller.abort(reason);
  };

  if (callerSignal.aborted) {
    abort(callerSignal.reason);
  } else {
    callerSignal.addEventListener('abort', () => abort(callerSignal.reason), { once: true });
  }
  if (timeoutSignal.aborted) {
    abort(timeoutSignal.reason);
  } else {
    timeoutSignal.addEventListener('abort', () => abort(timeoutSignal.reason), { once: true });
  }

  return controller.signal;
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

  const urlForError =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : // Request object: read .url without consuming the body
          input.url;

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signal = linkSignals(timeoutController.signal, callerSignal as AbortSignal | undefined);
  const startedAt = Date.now();

  try {
    return await fetch(input, { ...rest, signal });
  } catch (err) {
    if (
      timeoutController.signal.aborted &&
      !(callerSignal && (callerSignal as AbortSignal).aborted)
    ) {
      // The timeout won the race.
      throw new TimeoutError(urlForError, timeoutMs, Date.now() - startedAt);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
