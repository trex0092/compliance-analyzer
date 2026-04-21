/**
 * Dispatch Dedup Blob — Netlify-Blobs-backed idempotency index for the
 * server-side autopilot cron path.
 *
 * Why a separate module from dispatchAuditLog.ts:
 *
 *   dispatchAuditLog.ts stores its ring buffer in browser localStorage
 *   and is therefore a no-op in the Netlify Node runtime. The cron at
 *   netlify/functions/asana-super-brain-autopilot-cron.mts runs every
 *   15 minutes in Node, where `typeof localStorage === 'undefined'`
 *   makes the `skipAlreadyDispatched` guard in runSuperBrainBatch()
 *   silently ineffective. Left un-addressed, every cron tick would
 *   re-dispatch every open case — doubling Asana task creation,
 *   inflating the audit trail, and eventually tripping Asana's rate
 *   limiter.
 *
 *   This module gives the cron a runtime-appropriate dedup path. It
 *   intentionally does NOT touch the browser dispatchAuditLog surface
 *   — the in-SPA listener (autoDispatchListener.ts) continues to use
 *   localStorage and is untouched.
 *
 * Storage model:
 *   - One Netlify Blob key per dispatch index: `by-case/<caseId>.json`
 *   - Each key, if present, records the first successful dispatch:
 *       { caseId, dispatchedAtIso, verdict?, runId }
 *   - Checking "has this case been dispatched?" is a single
 *     `getWithMetadata` call. Marking a dispatch is a CAS write with
 *     `onlyIfMatch: etag`. On CAS conflict (another cron run racing
 *     through the same case), we treat the existing record as
 *     authoritative and return `{ ok: true, alreadyMarked: true }` —
 *     duplicate-dispatch is the failure mode we are preventing, so
 *     losing the write on conflict is exactly what we want.
 *
 *   - A separate rolling index `recent.json` would be tempting for
 *     fast queries, but any RMW on a single shared blob re-introduces
 *     exactly the race we are closing here. Stick with per-case keys.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (immutable 10-year audit retention —
 *     dedup prevents the audit log from recording the same decision
 *     twice under different timestamps).
 *   - Cabinet Res 134/2025 Art.19 (auditable internal review).
 */

import { getStore } from '@netlify/blobs';

const STORE_NAME = 'dispatch-dedup';
const KEY = (caseId: string): string => `by-case/${encodeURIComponent(caseId)}.json`;

export interface DispatchMarker {
  caseId: string;
  dispatchedAtIso: string;
  verdict?: string;
  runId?: string;
}

export async function hasCaseBeenDispatchedBlob(caseId: string): Promise<boolean> {
  const store = getStore(STORE_NAME);
  const raw = await store.get(KEY(caseId), { type: 'json' }).catch(() => null);
  return raw !== null && raw !== undefined;
}

export async function markCaseDispatchedBlob(
  marker: DispatchMarker
): Promise<{ ok: boolean; alreadyMarked?: boolean }> {
  const store = getStore(STORE_NAME);
  const withMeta = await store
    .getWithMetadata(KEY(marker.caseId), { type: 'json' })
    .catch(() => null);

  // Already marked — treat as success. The first writer wins; any
  // subsequent dispatch attempt for the same case was by definition
  // a duplicate and we do NOT want to stomp the original timestamp.
  if (withMeta && withMeta.data) {
    return { ok: true, alreadyMarked: true };
  }

  try {
    await store.setJSON(KEY(marker.caseId), marker, {
      onlyIfMatch: withMeta?.etag,
    } as Parameters<typeof store.setJSON>[2]);
    return { ok: true };
  } catch {
    // CAS conflict — another writer marked it between our read and
    // our write. That is still the correct outcome (the case is now
    // recorded as dispatched). Surface alreadyMarked so the caller
    // skips the follow-up Asana task creation.
    return { ok: true, alreadyMarked: true };
  }
}

export async function filterUndispatchedCasesBlob<T extends { id: string }>(
  cases: readonly T[]
): Promise<{ remaining: T[]; skippedIds: string[] }> {
  const remaining: T[] = [];
  const skippedIds: string[] = [];
  for (const c of cases) {
    const seen = await hasCaseBeenDispatchedBlob(c.id);
    if (seen) {
      skippedIds.push(c.id);
    } else {
      remaining.push(c);
    }
  }
  return { remaining, skippedIds };
}
