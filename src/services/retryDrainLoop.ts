/**
 * Retry Drain Loop — client-side tick that drains the Asana retry
 * queue while the SPA tab is visible.
 *
 * The Netlify cron drains the queue every minute from the server
 * side, but the SPA maintains its own localStorage-backed retry
 * queue (asanaQueue.ts) that only the client can drain. When the
 * user closes the tab or goes offline, entries pile up. This
 * module starts a visibility-aware tick that calls
 * processRetryQueue() every RETRY_INTERVAL_MS while the document
 * is visible.
 *
 * Pure wrapper over setInterval — the tick interval is
 * configurable for tests, and the loop respects the page
 * visibility API so a hidden tab doesn't burn the rate limit.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (never lose an audit-relevant task)
 *   - Cabinet Res 134/2025 Art.19 (resilient operational telemetry)
 */

import { getQueueStatus, processRetryQueue } from './asanaQueue';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 5 * 60_000; // 5 minutes — matches Netlify cron cadence
const MIN_INTERVAL_MS = 30_000; // never tick faster than 30s

export interface RetryDrainOptions {
  intervalMs?: number;
  /** Injected for tests — replaces setInterval/clearInterval. */
  setIntervalFn?: (cb: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
  /** Injected for tests — replaces document.visibilityState check. */
  isVisible?: () => boolean;
  /** Injected for tests — replaces processRetryQueue. */
  drain?: () => Promise<{ processed: number; succeeded: number; failed: number }>;
}

export interface RetryDrainState {
  running: boolean;
  lastTickAtIso?: string;
  lastDrainedCount: number;
  totalDrained: number;
  totalFailed: number;
  skippedHiddenTabs: number;
}

// ---------------------------------------------------------------------------
// Singleton state — one loop per tab
// ---------------------------------------------------------------------------

let state: RetryDrainState = {
  running: false,
  lastDrainedCount: 0,
  totalDrained: 0,
  totalFailed: 0,
  skippedHiddenTabs: 0,
};

let activeHandle: unknown | undefined;
let activeClearFn: ((h: unknown) => void) | undefined;

export function getRetryDrainState(): RetryDrainState {
  return { ...state };
}

// ---------------------------------------------------------------------------
// Default visibility check
// ---------------------------------------------------------------------------

function defaultIsVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden';
}

// ---------------------------------------------------------------------------
// Start / stop
// ---------------------------------------------------------------------------

/**
 * Start the retry drain loop. Idempotent — calling twice is a
 * no-op. Returns a stop function the caller can invoke on unmount.
 */
export function startRetryDrainLoop(options: RetryDrainOptions = {}): () => void {
  if (state.running) {
    return stopRetryDrainLoop;
  }

  const interval = Math.max(MIN_INTERVAL_MS, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  const setFn = options.setIntervalFn ?? ((cb, ms) => setInterval(cb, ms));
  const clearFn = options.clearIntervalFn ?? ((h) => clearInterval(h as number));
  const visible = options.isVisible ?? defaultIsVisible;
  const drain = options.drain ?? processRetryQueue;

  const tick = async (): Promise<void> => {
    state.lastTickAtIso = new Date().toISOString();
    if (!visible()) {
      state.skippedHiddenTabs++;
      return;
    }
    const status = getQueueStatus();
    if (status.pending === 0) {
      state.lastDrainedCount = 0;
      return;
    }
    try {
      const result = await drain();
      state.lastDrainedCount = result.succeeded;
      state.totalDrained += result.succeeded;
      state.totalFailed += result.failed;
    } catch {
      /* queue drain errors are already logged inside processRetryQueue */
    }
  };

  activeHandle = setFn(() => {
    void tick();
  }, interval);
  activeClearFn = clearFn;
  state = { ...state, running: true };

  // Run one tick immediately so a user opening the tab with a
  // non-empty queue sees the drain happen right away.
  void tick();

  return stopRetryDrainLoop;
}

export function stopRetryDrainLoop(): void {
  if (!state.running) return;
  if (activeHandle !== undefined && activeClearFn) {
    activeClearFn(activeHandle);
  }
  activeHandle = undefined;
  activeClearFn = undefined;
  state = { ...state, running: false };
}

/** Reset for tests. */
export function __resetRetryDrainLoopForTests(): void {
  stopRetryDrainLoop();
  state = {
    running: false,
    lastDrainedCount: 0,
    totalDrained: 0,
    totalFailed: 0,
    skippedHiddenTabs: 0,
  };
}
