/**
 * Asana Bidirectional Sync — Phase 2 #A17/A18.
 *
 * Phase 4 wired one-way sync (local → Asana) for compliance tasks.
 * This module adds the reverse direction (Asana → local) with a
 * conflict resolver for simultaneous edits.
 *
 * The model is dead simple last-writer-wins with an audit trail:
 *
 *   1. Each side records the `updatedAt` timestamp of every mutation.
 *   2. When the reconciler sees divergence, the newer timestamp wins.
 *   3. The losing value is preserved under `conflictHistory[]` so a
 *      compliance engineer can audit the override decision.
 *
 * LWW is defensible for compliance state because:
 *   - Both sides are humans (MLROs + analysts) with access control.
 *   - Every mutation is already logged with the actor.
 *   - The winning value is always the most recent intentional action.
 *
 * What this module does NOT do:
 *   - Auto-merge custom fields (use LWW per field instead).
 *   - Resolve semantic conflicts (e.g. "local said freeze, remote
 *     said pass" — that's a human escalation, not a reconcile).
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (10yr record retention — conflict history)
 *   - Cabinet Res 134/2025 Art.19 (auditable decisions)
 *   - FATF Rec 11 (record-keeping integrity)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncState<T> {
  value: T;
  /** Updater identity for the audit trail. */
  updatedBy: string;
  /** ISO timestamp of the update. */
  updatedAt: string;
}

export interface BidirectionalResolution<T> {
  /** The winning value. */
  value: T;
  /** Which side won. */
  winner: 'local' | 'remote' | 'tie';
  /** The losing value, preserved for audit. */
  losingValue?: T;
  /** Reason the winner was chosen. */
  reason: string;
  /** Updated conflict history to append to the record. */
  historyEntry: {
    at: string;
    localUpdatedBy: string;
    remoteUpdatedBy: string;
    localUpdatedAt: string;
    remoteUpdatedAt: string;
    winner: 'local' | 'remote' | 'tie';
    preservedValue: T | undefined;
  };
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Last-writer-wins resolver with conflict history preservation.
 * Deterministic: same inputs always produce the same result, so the
 * reconciler can be safely re-run idempotently.
 */
export function resolveBidirectional<T>(
  local: SyncState<T>,
  remote: SyncState<T>
): BidirectionalResolution<T> {
  const localMs = Date.parse(local.updatedAt);
  const remoteMs = Date.parse(remote.updatedAt);

  if (!Number.isFinite(localMs) && !Number.isFinite(remoteMs)) {
    return {
      value: local.value,
      winner: 'local',
      reason: 'both timestamps invalid — default to local',
      historyEntry: buildHistoryEntry(local, remote, 'local', undefined),
    };
  }
  if (!Number.isFinite(localMs)) {
    return {
      value: remote.value,
      winner: 'remote',
      reason: 'local timestamp invalid',
      historyEntry: buildHistoryEntry(local, remote, 'remote', local.value),
    };
  }
  if (!Number.isFinite(remoteMs)) {
    return {
      value: local.value,
      winner: 'local',
      reason: 'remote timestamp invalid',
      historyEntry: buildHistoryEntry(local, remote, 'local', remote.value),
    };
  }

  if (localMs > remoteMs) {
    return {
      value: local.value,
      winner: 'local',
      losingValue: remote.value,
      reason: `local is newer by ${Math.round((localMs - remoteMs) / 1000)}s`,
      historyEntry: buildHistoryEntry(local, remote, 'local', remote.value),
    };
  }
  if (remoteMs > localMs) {
    return {
      value: remote.value,
      winner: 'remote',
      losingValue: local.value,
      reason: `remote is newer by ${Math.round((remoteMs - localMs) / 1000)}s`,
      historyEntry: buildHistoryEntry(local, remote, 'remote', local.value),
    };
  }

  // Tie: values AND timestamps identical → nothing to do.
  // Values differ but timestamps identical → resolve to local by
  // default (client-side is authoritative when server edits arrived
  // at exactly the same millisecond — a near-impossible case).
  return {
    value: local.value,
    winner: 'tie',
    losingValue: remote.value,
    reason: 'identical timestamps — defaulting to local',
    historyEntry: buildHistoryEntry(local, remote, 'tie', remote.value),
  };
}

function buildHistoryEntry<T>(
  local: SyncState<T>,
  remote: SyncState<T>,
  winner: 'local' | 'remote' | 'tie',
  preservedValue: T | undefined
): BidirectionalResolution<T>['historyEntry'] {
  return {
    at: new Date().toISOString(),
    localUpdatedBy: local.updatedBy,
    remoteUpdatedBy: remote.updatedBy,
    localUpdatedAt: local.updatedAt,
    remoteUpdatedAt: remote.updatedAt,
    winner,
    preservedValue,
  };
}

// ---------------------------------------------------------------------------
// Reconciler — walks a dictionary of fields and applies LWW per field.
// ---------------------------------------------------------------------------

export interface FieldReconcileInput<T extends Record<string, unknown>> {
  local: { [K in keyof T]: SyncState<T[K]> };
  remote: { [K in keyof T]: SyncState<T[K]> };
}

export interface FieldReconcileResult<T extends Record<string, unknown>> {
  merged: T;
  perField: { [K in keyof T]: BidirectionalResolution<T[K]> };
  localWins: number;
  remoteWins: number;
  ties: number;
}

export function reconcileFields<T extends Record<string, unknown>>(
  input: FieldReconcileInput<T>
): FieldReconcileResult<T> {
  const merged = {} as T;
  const perField = {} as { [K in keyof T]: BidirectionalResolution<T[K]> };
  let localWins = 0;
  let remoteWins = 0;
  let ties = 0;

  for (const key of Object.keys(input.local) as Array<keyof T>) {
    const localSide = input.local[key];
    const remoteSide = input.remote[key];
    if (!remoteSide) {
      merged[key] = localSide.value;
      perField[key] = {
        value: localSide.value,
        winner: 'local',
        reason: 'remote missing',
        historyEntry: {
          at: new Date().toISOString(),
          localUpdatedBy: localSide.updatedBy,
          remoteUpdatedBy: 'n/a',
          localUpdatedAt: localSide.updatedAt,
          remoteUpdatedAt: 'n/a',
          winner: 'local',
          preservedValue: undefined,
        },
      };
      localWins += 1;
      continue;
    }
    const resolution = resolveBidirectional(localSide, remoteSide);
    merged[key] = resolution.value;
    perField[key] = resolution;
    if (resolution.winner === 'local') localWins += 1;
    else if (resolution.winner === 'remote') remoteWins += 1;
    else ties += 1;
  }

  return { merged, perField, localWins, remoteWins, ties };
}
