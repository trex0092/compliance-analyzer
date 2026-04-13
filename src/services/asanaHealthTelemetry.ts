/**
 * Asana Health Telemetry — single-glance sync status for the MLRO.
 *
 * The dashboard needs one tile that answers: is Asana up? how many
 * retries are pending? are we getting rate limited? when did the last
 * call fail and why? This module produces that snapshot without
 * touching the Asana API — it reads the local retry queue, task-link
 * store, and the last-error tombstone we persist on every failed call.
 *
 * Pure-ish: reads localStorage (browser) and in-memory cache (tests).
 * No network traffic. Lives outside asanaClient.ts so we can unit test
 * the reducer without mocking fetch.
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (internal review — operational telemetry)
 *   - FDL No.10/2025 Art.24 (10yr retention — track sync failures)
 */

import { getQueueStatus } from './asanaQueue';
import { getLinkStats } from './asanaTaskLinks';
import { isAsanaConfigured } from './asanaClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AsanaHealthStatus = 'unconfigured' | 'healthy' | 'degraded' | 'critical';

export interface AsanaHealthSnapshot {
  status: AsanaHealthStatus;
  configured: boolean;
  /** Pending retry queue depth (retryable). */
  retryQueuePending: number;
  /** Permanently failed retry queue depth. */
  retryQueueFailed: number;
  /** Total tasks linked from local → Asana. */
  linksTotal: number;
  /** Tasks marked complete in Asana (two-way sync observed). */
  linksCompleted: number;
  /** Active (not yet completed) task links. */
  linksActive: number;
  /** Most recent Asana error observed, if any. */
  lastError?: string;
  /** ISO timestamp of the last error. */
  lastErrorAtIso?: string;
  /** Most recent 429 (rate limit) hit, if any. */
  lastRateLimitAtIso?: string;
  /** Human-readable summary for the dashboard tile. */
  summary: string;
}

// ---------------------------------------------------------------------------
// Tombstone storage
// ---------------------------------------------------------------------------

const LAST_ERROR_KEY = 'asana_health_last_error';
const LAST_RATE_LIMIT_KEY = 'asana_health_last_rate_limit';

interface LastErrorRecord {
  error: string;
  atIso: string;
}

function readLastError(): LastErrorRecord | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    const raw = localStorage.getItem(LAST_ERROR_KEY);
    return raw ? (JSON.parse(raw) as LastErrorRecord) : undefined;
  } catch {
    return undefined;
  }
}

function readLastRateLimit(): string | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    return localStorage.getItem(LAST_RATE_LIMIT_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Called by asanaClient on any failure so the health tile has something
 * to surface. Browser-only — node tests can call it directly for
 * reducer coverage.
 */
export function recordAsanaFailure(error: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const record: LastErrorRecord = {
      error: error.slice(0, 500),
      atIso: new Date().toISOString(),
    };
    localStorage.setItem(LAST_ERROR_KEY, JSON.stringify(record));
    if (/\b429\b/.test(error)) {
      localStorage.setItem(LAST_RATE_LIMIT_KEY, record.atIso);
    }
  } catch {
    /* storage quota — ignore, telemetry is degradation-tolerant */
  }
}

/** Clear the tombstones — called after a successful health refresh. */
export function clearAsanaFailureTombstones(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(LAST_ERROR_KEY);
    localStorage.removeItem(LAST_RATE_LIMIT_KEY);
  } catch {
    /* empty */
  }
}

// ---------------------------------------------------------------------------
// Pure reducer — this is what the tests target.
// ---------------------------------------------------------------------------

export interface AsanaHealthInputs {
  configured: boolean;
  retryQueue: { pending: number; failed: number };
  linkStats: { total: number; completed: number; active: number };
  lastError?: LastErrorRecord;
  lastRateLimitAtIso?: string;
  /** Optional ISO "now" for deterministic tests. */
  nowIso?: string;
}

export function reduceAsanaHealth(inputs: AsanaHealthInputs): AsanaHealthSnapshot {
  const now = new Date(inputs.nowIso ?? new Date().toISOString()).getTime();

  if (!inputs.configured) {
    return {
      status: 'unconfigured',
      configured: false,
      retryQueuePending: 0,
      retryQueueFailed: 0,
      linksTotal: inputs.linkStats.total,
      linksCompleted: inputs.linkStats.completed,
      linksActive: inputs.linkStats.active,
      summary: 'Asana not configured — set ASANA_TOKEN or proxy URL in Settings.',
    };
  }

  const { pending, failed } = inputs.retryQueue;
  const recentError =
    inputs.lastError && now - new Date(inputs.lastError.atIso).getTime() < 15 * 60_000
      ? inputs.lastError
      : undefined;
  const recentRateLimit =
    inputs.lastRateLimitAtIso && now - new Date(inputs.lastRateLimitAtIso).getTime() < 5 * 60_000
      ? inputs.lastRateLimitAtIso
      : undefined;

  // Status gate:
  //  - critical: anything permanently failed OR a recent error in the
  //              last 15 minutes that the operator should see.
  //  - degraded: retry queue non-empty OR recent rate limit in the
  //              last 5 minutes.
  //  - healthy:  everything else.
  let status: AsanaHealthStatus;
  if (failed > 0 || recentError) {
    status = 'critical';
  } else if (pending > 0 || recentRateLimit) {
    status = 'degraded';
  } else {
    status = 'healthy';
  }

  const summary =
    status === 'healthy'
      ? `Asana healthy — ${inputs.linkStats.total} linked, ${inputs.linkStats.active} active`
      : status === 'degraded'
        ? `Asana degraded — ${pending} retry pending${recentRateLimit ? ', recent 429' : ''}`
        : status === 'critical'
          ? `Asana critical — ${failed} failed, ${recentError ? 'recent error' : 'check logs'}`
          : 'Asana unconfigured';

  return {
    status,
    configured: true,
    retryQueuePending: pending,
    retryQueueFailed: failed,
    linksTotal: inputs.linkStats.total,
    linksCompleted: inputs.linkStats.completed,
    linksActive: inputs.linkStats.active,
    lastError: recentError?.error,
    lastErrorAtIso: recentError?.atIso,
    lastRateLimitAtIso: recentRateLimit,
    summary,
  };
}

// ---------------------------------------------------------------------------
// I/O wrapper used by the dashboard tile
// ---------------------------------------------------------------------------

export function getAsanaHealthSnapshot(): AsanaHealthSnapshot {
  return reduceAsanaHealth({
    configured: isAsanaConfigured(),
    retryQueue: getQueueStatus(),
    linkStats: (() => {
      const s = getLinkStats();
      return { total: s.total, completed: s.completed, active: s.active };
    })(),
    lastError: readLastError(),
    lastRateLimitAtIso: readLastRateLimit(),
  });
}
