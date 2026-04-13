/**
 * Dispatcher Backoff — exponential retry wrapper for the super-brain
 * pipeline.
 *
 * The individual services (asanaClient, strSubtaskLifecycle,
 * asanaSectionWriteBack, asanaBulkOperations) all have their own
 * retry logic, but the super-brain dispatcher coordinates them.
 * When a transient failure bubbles up, re-running the whole
 * pipeline from scratch is wasteful. This wrapper adds an
 * idempotency-aware retry loop around a single async operation:
 *
 *   - Retries on network-ish errors (timeout, 5xx, 429)
 *   - Exponential backoff: 1s → 2s → 4s → 8s → 16s (max 5 attempts)
 *   - Aborts immediately on permanent errors (auth, bad request)
 *   - Reports every attempt so the caller can log the trace
 *
 * Pure control flow — no I/O. The operation is whatever the caller
 * passes in.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (never drop an audit-relevant dispatch)
 *   - Cabinet Res 134/2025 Art.19 (resilient internal review)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackoffOptions {
  /** Max attempts (1 = no retry). Default 5. */
  maxAttempts?: number;
  /** Base delay in ms. Default 1000. */
  baseDelayMs?: number;
  /** Max delay cap in ms. Default 16000. */
  maxDelayMs?: number;
  /** Optional classifier. Return true for retryable errors. */
  isRetryable?: (error: unknown) => boolean;
  /** Injection point for tests — replaces setTimeout-based delay. */
  sleep?: (ms: number) => Promise<void>;
  /** Optional per-attempt trace hook. */
  onAttempt?: (attempt: number, error?: unknown) => void;
}

export interface BackoffResult<T> {
  ok: boolean;
  value?: T;
  error?: unknown;
  attempts: number;
  /** Whether the last attempt was aborted by isRetryable=false. */
  aborted: boolean;
}

// ---------------------------------------------------------------------------
// Default retryable classifier
// ---------------------------------------------------------------------------

/**
 * Treat network timeouts, 5xx, 429, and unknown errors as
 * retryable. 4xx (except 429) and explicit "auth" failures are
 * permanent.
 */
export function defaultIsRetryable(error: unknown): boolean {
  if (error === null || error === undefined) return false;
  const message = String(error).toLowerCase();
  if (message.includes('timeout') || message.includes('etimedout')) return true;
  if (message.includes('abort')) return true;
  if (message.includes('network') || message.includes('enet')) return true;
  if (message.includes('429')) return true;
  const fivehundred = message.match(/\b5\d{2}\b/);
  if (fivehundred) return true;
  if (
    message.includes('auth') ||
    message.includes('forbidden') ||
    message.includes('unauthorized') ||
    message.includes('invalid_grant') ||
    message.includes('permission')
  ) {
    return false;
  }
  const fourhundred = message.match(/\b4\d{2}\b/);
  if (fourhundred && !message.includes('429')) return false;
  // Default: treat unknown as retryable — the default classifier
  // errs on the side of resilience because the caller can always
  // pass a stricter classifier via options.isRetryable.
  return true;
}

// ---------------------------------------------------------------------------
// Pure runner
// ---------------------------------------------------------------------------

function computeDelay(attempt: number, base: number, max: number): number {
  return Math.min(max, base * Math.pow(2, attempt - 1));
}

export async function runWithBackoff<T>(
  operation: () => Promise<T>,
  options: BackoffOptions = {}
): Promise<BackoffResult<T>> {
  const maxAttempts = options.maxAttempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 16_000;
  const isRetryable = options.isRetryable ?? defaultIsRetryable;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    options.onAttempt?.(attempt);
    try {
      const value = await operation();
      return { ok: true, value, attempts: attempt, aborted: false };
    } catch (err) {
      lastError = err;
      options.onAttempt?.(attempt, err);
      if (!isRetryable(err)) {
        return { ok: false, error: err, attempts: attempt, aborted: true };
      }
      if (attempt < maxAttempts) {
        const delay = computeDelay(attempt, baseDelayMs, maxDelayMs);
        await sleep(delay);
      }
    }
  }

  return {
    ok: false,
    error: lastError,
    attempts: maxAttempts,
    aborted: false,
  };
}

// ---------------------------------------------------------------------------
// Helper: a synchronous sleep for tests
// ---------------------------------------------------------------------------

/** Zero-delay sleep used in tests so runWithBackoff returns fast. */
export const instantSleep = async (_ms: number): Promise<void> => {
  // Intentional no-op — lets tests exercise the retry loop without
  // waiting real wall-clock seconds.
  return;
};
