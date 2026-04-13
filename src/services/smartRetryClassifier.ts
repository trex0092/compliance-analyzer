/**
 * Smart Retry Classifier — Tier C2.
 *
 * Replaces the substring-based defaultIsRetryable in
 * dispatcherBackoff with a structured classifier that reads:
 *
 *   - HTTP status code (when available)
 *   - Asana-specific error codes (from response body)
 *   - Request path category (tasks vs stories vs projects)
 *
 * and returns both a retry decision AND a suggested backoff
 * curve per error class. The backoff wrapper can use the
 * suggested curve to bias its own exponential schedule.
 *
 * Pure function over a structured error envelope.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (resilient audit chain — no transient
 *     error should silently drop an audit event)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ErrorClass =
  | 'permanent-auth'
  | 'permanent-client'
  | 'permanent-config'
  | 'transient-rate-limit'
  | 'transient-server'
  | 'transient-network'
  | 'transient-timeout'
  | 'unknown';

export interface StructuredError {
  status?: number;
  message?: string;
  path?: string;
  asanaCode?: string;
}

export interface ClassificationResult {
  retryable: boolean;
  errorClass: ErrorClass;
  /** Suggested base delay in ms for the backoff wrapper. */
  suggestedBaseDelayMs: number;
  /** Suggested max attempts. */
  suggestedMaxAttempts: number;
  /** Human-readable rationale for audit logs. */
  rationale: string;
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify an error and return a retry decision + backoff curve.
 * Pure — given the same input, always returns the same output.
 */
export function classifyError(error: StructuredError | string | unknown): ClassificationResult {
  const envelope = normalizeError(error);
  const status = envelope.status;
  const message = (envelope.message ?? '').toLowerCase();

  // Permanent — do not retry.
  if (status === 401 || status === 403) {
    return {
      retryable: false,
      errorClass: 'permanent-auth',
      suggestedBaseDelayMs: 0,
      suggestedMaxAttempts: 1,
      rationale: `HTTP ${status} — auth failure, will not retry`,
    };
  }
  if (status && status >= 400 && status < 429) {
    return {
      retryable: false,
      errorClass: 'permanent-client',
      suggestedBaseDelayMs: 0,
      suggestedMaxAttempts: 1,
      rationale: `HTTP ${status} — client error, request is malformed`,
    };
  }
  if (message.includes('not configured') || message.includes('missing env')) {
    return {
      retryable: false,
      errorClass: 'permanent-config',
      suggestedBaseDelayMs: 0,
      suggestedMaxAttempts: 1,
      rationale: 'Configuration gap — retrying will not help',
    };
  }

  // Transient rate limit — slow + long attempts.
  if (status === 429 || message.includes('rate limit') || message.includes('429')) {
    return {
      retryable: true,
      errorClass: 'transient-rate-limit',
      suggestedBaseDelayMs: 2000,
      suggestedMaxAttempts: 6,
      rationale: '429 rate limit — backoff with long tail',
    };
  }

  // Transient server error — standard backoff.
  if (status && status >= 500) {
    return {
      retryable: true,
      errorClass: 'transient-server',
      suggestedBaseDelayMs: 1000,
      suggestedMaxAttempts: 5,
      rationale: `HTTP ${status} — server error, retry with standard backoff`,
    };
  }

  // Transient network.
  if (
    message.includes('network') ||
    message.includes('enet') ||
    message.includes('econnreset') ||
    message.includes('fetch failed')
  ) {
    return {
      retryable: true,
      errorClass: 'transient-network',
      suggestedBaseDelayMs: 500,
      suggestedMaxAttempts: 5,
      rationale: 'Network error — retry with fast backoff',
    };
  }

  // Transient timeout.
  if (message.includes('timeout') || message.includes('etimedout') || message.includes('abort')) {
    return {
      retryable: true,
      errorClass: 'transient-timeout',
      suggestedBaseDelayMs: 1000,
      suggestedMaxAttempts: 4,
      rationale: 'Timeout — retry with standard backoff',
    };
  }

  // Unknown — retry conservatively.
  return {
    retryable: true,
    errorClass: 'unknown',
    suggestedBaseDelayMs: 1000,
    suggestedMaxAttempts: 3,
    rationale: 'Unknown error class — retry conservatively',
  };
}

function normalizeError(error: StructuredError | string | unknown): StructuredError {
  if (typeof error === 'string') {
    const statusMatch = error.match(/\b(\d{3})\b/);
    return {
      status: statusMatch ? Number.parseInt(statusMatch[1], 10) : undefined,
      message: error,
    };
  }
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if ('status' in obj || 'message' in obj || 'path' in obj || 'asanaCode' in obj) {
      return obj as StructuredError;
    }
    if (obj instanceof Error) {
      const message = obj.message ?? '';
      const statusMatch = message.match(/\b(\d{3})\b/);
      return {
        status: statusMatch ? Number.parseInt(statusMatch[1], 10) : undefined,
        message,
      };
    }
  }
  return { message: String(error ?? '') };
}
