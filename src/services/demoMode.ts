/**
 * Demo Mode — runtime toggle that swaps the live brain for a synthetic
 * dataset so operators (and sales, and trainers) can click through
 * every panel without touching real customer data.
 *
 * Why this exists:
 *   sampleDataLoader.ts produces the static dataset. This module is
 *   the RUNTIME switch that decides which data a given request sees.
 *   It is deliberately simple — a single boolean per session that
 *   lives in a tiny in-memory registry with a persistence hook.
 *
 *   Pure function — no I/O, no network. The session storage hook is
 *   injectable so tests use an in-memory fake and production wires
 *   it to sessionStorage / localStorage / a Netlify blob.
 *
 * Safety invariants:
 *   1. Demo mode is ALWAYS visible — a banner at the top of the page
 *      must render whenever demo mode is on. That banner is rendered
 *      by the UI layer, not this module, but the `shouldShowBanner`
 *      helper here is the source of truth.
 *   2. Demo mode NEVER writes to real blob stores. The dispatcher
 *      switches to `demo:*` prefixes automatically.
 *   3. Toggling demo mode on does NOT delete real data. Toggling
 *      demo mode off does NOT delete demo data — the operator must
 *      explicitly call `resetDemoData`.
 *   4. Demo mode is NEVER the default. Fresh sessions start in
 *      live mode unless the operator explicitly toggles on.
 *   5. Demo mode emits an audit log entry every time it is toggled
 *      on or off.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO training — drills under demo mode)
 *   FDL No.10/2025 Art.24    (audit trail of demo-mode toggles)
 *   NIST AI RMF 1.0 MANAGE-2 (clear separation of test + prod data)
 *   NIST AI RMF 1.0 MEASURE-4 (validation via drills)
 *   EU AI Act Art.15         (accuracy + robustness — drill readiness)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DemoSessionState = 'live' | 'demo';

export interface DemoModeSnapshot {
  state: DemoSessionState;
  /** ISO timestamp the state was last changed. */
  lastChangedAtIso: string;
  /** User gid of the operator who flipped the state. */
  lastChangedBy: string | null;
  /** Reason string captured at toggle time. */
  lastChangeReason: string | null;
}

export interface DemoAuditRecord {
  tsIso: string;
  event: 'demo_mode_on' | 'demo_mode_off' | 'demo_data_reset';
  userId: string;
  reason: string;
  regulatory: readonly string[];
}

/**
 * Persistence hook. Implementations:
 *   - tests:      in-memory Map
 *   - browser:    sessionStorage / localStorage
 *   - netlify:    Netlify Blob under `demo:state.json`
 */
export interface DemoStateStore {
  load(): Promise<DemoModeSnapshot>;
  save(snapshot: DemoModeSnapshot): Promise<void>;
  appendAudit(record: DemoAuditRecord): Promise<void>;
}

// ---------------------------------------------------------------------------
// Default initial state
// ---------------------------------------------------------------------------

export function initialSnapshot(): DemoModeSnapshot {
  return {
    state: 'live',
    lastChangedAtIso: '1970-01-01T00:00:00.000Z',
    lastChangedBy: null,
    lastChangeReason: null,
  };
}

// ---------------------------------------------------------------------------
// In-memory store (tests + fallback)
// ---------------------------------------------------------------------------

export class InMemoryDemoStateStore implements DemoStateStore {
  private snapshot: DemoModeSnapshot = initialSnapshot();
  private audit: DemoAuditRecord[] = [];

  async load(): Promise<DemoModeSnapshot> {
    return { ...this.snapshot };
  }
  async save(next: DemoModeSnapshot): Promise<void> {
    this.snapshot = { ...next };
  }
  async appendAudit(record: DemoAuditRecord): Promise<void> {
    this.audit.push(record);
  }
  auditLog(): readonly DemoAuditRecord[] {
    return [...this.audit];
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ToggleRequest {
  /** Operator user id (NOT a session token). */
  userId: string;
  /** Mandatory free-text reason for the audit trail. */
  reason: string;
  /** Override "now" for tests. */
  now?: () => Date;
}

function validateToggle(req: ToggleRequest): { ok: true } | { ok: false; error: string } {
  if (typeof req.userId !== 'string' || req.userId.length === 0) {
    return { ok: false, error: 'userId required' };
  }
  if (typeof req.reason !== 'string' || req.reason.trim().length < 3) {
    return { ok: false, error: 'reason required (≥3 chars)' };
  }
  return { ok: true };
}

export async function enableDemoMode(
  store: DemoStateStore,
  req: ToggleRequest
): Promise<DemoModeSnapshot> {
  const v = validateToggle(req);
  if (!v.ok) throw new Error(`enableDemoMode: ${v.error}`);
  const now = (req.now ?? (() => new Date()))();
  const tsIso = now.toISOString();
  const snapshot: DemoModeSnapshot = {
    state: 'demo',
    lastChangedAtIso: tsIso,
    lastChangedBy: req.userId,
    lastChangeReason: req.reason,
  };
  await store.save(snapshot);
  await store.appendAudit({
    tsIso,
    event: 'demo_mode_on',
    userId: req.userId,
    reason: req.reason,
    regulatory: ['FDL No.10/2025 Art.20-22', 'FDL No.10/2025 Art.24'],
  });
  return snapshot;
}

export async function disableDemoMode(
  store: DemoStateStore,
  req: ToggleRequest
): Promise<DemoModeSnapshot> {
  const v = validateToggle(req);
  if (!v.ok) throw new Error(`disableDemoMode: ${v.error}`);
  const now = (req.now ?? (() => new Date()))();
  const tsIso = now.toISOString();
  const snapshot: DemoModeSnapshot = {
    state: 'live',
    lastChangedAtIso: tsIso,
    lastChangedBy: req.userId,
    lastChangeReason: req.reason,
  };
  await store.save(snapshot);
  await store.appendAudit({
    tsIso,
    event: 'demo_mode_off',
    userId: req.userId,
    reason: req.reason,
    regulatory: ['FDL No.10/2025 Art.20-22', 'FDL No.10/2025 Art.24'],
  });
  return snapshot;
}

export async function resetDemoData(store: DemoStateStore, req: ToggleRequest): Promise<void> {
  const v = validateToggle(req);
  if (!v.ok) throw new Error(`resetDemoData: ${v.error}`);
  const now = (req.now ?? (() => new Date()))();
  await store.appendAudit({
    tsIso: now.toISOString(),
    event: 'demo_data_reset',
    userId: req.userId,
    reason: req.reason,
    regulatory: ['FDL No.10/2025 Art.24'],
  });
}

/**
 * Should the demo banner render? Returns true when state === 'demo'.
 * This is the single source of truth — UI layers import it instead
 * of checking the snapshot directly.
 */
export function shouldShowBanner(snapshot: DemoModeSnapshot): boolean {
  return snapshot.state === 'demo';
}

/**
 * Get the correct blob key prefix for a given snapshot. Live mode
 * returns 'brain:', demo mode returns 'demo:'. Every reader / writer
 * in the data path uses this to route blob I/O.
 */
export function blobPrefixFor(snapshot: DemoModeSnapshot): 'brain:' | 'demo:' {
  return snapshot.state === 'demo' ? 'demo:' : 'brain:';
}

// Exports for tests.
export const __test__ = { validateToggle };
