/**
 * Toast Stream Poller — client-side drain for the Netlify
 * asana-toast-stream endpoint.
 *
 * The webhook receiver writes toast events to the
 * 'asana-toast-stream' blob store. The Netlify polling
 * endpoint at /api/asana-toast-stream drains it on demand.
 * This module calls that endpoint every 30 seconds (when the
 * tab is visible) and pushes any returned toasts into the
 * local asanaCommentMirror buffer so the SPA toast surface
 * picks them up.
 *
 * Singleton loop + tab-visibility aware + auth-aware — the
 * endpoint requires a bearer token, and the client reads it
 * from a globalThis slot the app init code populates.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.19-21 (real-time operational telemetry)
 *   - Cabinet Res 134/2025 Art.19 (auditable internal review)
 */

import { enqueueCommentToast, type SpaToastEvent } from './asanaCommentMirror';

const DEFAULT_INTERVAL_MS = 30_000;
const MIN_INTERVAL_MS = 10_000;
const DEFAULT_ENDPOINT = '/api/asana-toast-stream';

export interface ToastPollerOptions {
  intervalMs?: number;
  endpoint?: string;
  /** Injected fetch for tests. */
  fetchFn?: typeof fetch;
  /** Injected setInterval/clearInterval for tests. */
  setIntervalFn?: (cb: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
  /** Injected visibility check for tests. */
  isVisible?: () => boolean;
  /** Injected token resolver for tests. */
  getToken?: () => string | undefined;
}

export interface ToastPollerState {
  running: boolean;
  lastPollAtIso?: string;
  lastDrainedCount: number;
  totalDrained: number;
  totalErrors: number;
  skippedHidden: number;
  skippedUnauthed: number;
}

let state: ToastPollerState = {
  running: false,
  lastDrainedCount: 0,
  totalDrained: 0,
  totalErrors: 0,
  skippedHidden: 0,
  skippedUnauthed: 0,
};

let activeHandle: unknown | undefined;
let activeClearFn: ((h: unknown) => void) | undefined;

function defaultIsVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden';
}

function defaultGetToken(): string | undefined {
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as Record<string, unknown>;
    const token = g.HAWKEYE_BRAIN_TOKEN;
    if (typeof token === 'string' && token.length > 0) return token;
  }
  return undefined;
}

export function getToastPollerState(): ToastPollerState {
  return { ...state };
}

/**
 * Poll the toast stream once. Exposed for tests + manual
 * "refresh now" triggers in the UI.
 */
export async function pollToastStreamOnce(
  options: ToastPollerOptions = {}
): Promise<{ drained: number; events: SpaToastEvent[]; error?: string }> {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const fetchFn = options.fetchFn ?? fetch;
  const getToken = options.getToken ?? defaultGetToken;
  const token = getToken();

  state.lastPollAtIso = new Date().toISOString();

  if (!token) {
    state.skippedUnauthed++;
    return { drained: 0, events: [], error: 'no-token' };
  }

  try {
    const res = await fetchFn(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      state.totalErrors++;
      return { drained: 0, events: [], error: `HTTP ${res.status}` };
    }
    const payload = (await res.json()) as { events?: SpaToastEvent[]; count?: number };
    const events = Array.isArray(payload.events) ? payload.events : [];
    for (const event of events) {
      enqueueCommentToast(event);
    }
    state.lastDrainedCount = events.length;
    state.totalDrained += events.length;
    return { drained: events.length, events };
  } catch (err) {
    state.totalErrors++;
    return { drained: 0, events: [], error: (err as Error).message };
  }
}

export function startToastStreamPoller(options: ToastPollerOptions = {}): () => void {
  if (state.running) return stopToastStreamPoller;
  const interval = Math.max(MIN_INTERVAL_MS, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  const setFn = options.setIntervalFn ?? ((cb, ms) => setInterval(cb, ms));
  const clearFn = options.clearIntervalFn ?? ((h) => clearInterval(h as number));
  const visible = options.isVisible ?? defaultIsVisible;

  const tick = async (): Promise<void> => {
    if (!visible()) {
      state.skippedHidden++;
      return;
    }
    await pollToastStreamOnce(options);
  };

  activeHandle = setFn(() => {
    void tick();
  }, interval);
  activeClearFn = clearFn;
  state = { ...state, running: true };

  // Immediate first tick so the SPA catches pending events on mount.
  void tick();

  return stopToastStreamPoller;
}

export function stopToastStreamPoller(): void {
  if (!state.running) return;
  if (activeHandle !== undefined && activeClearFn) {
    activeClearFn(activeHandle);
  }
  activeHandle = undefined;
  activeClearFn = undefined;
  state = { ...state, running: false };
}

export function __resetToastStreamPollerForTests(): void {
  stopToastStreamPoller();
  state = {
    running: false,
    lastDrainedCount: 0,
    totalDrained: 0,
    totalErrors: 0,
    skippedHidden: 0,
    skippedUnauthed: 0,
  };
}
