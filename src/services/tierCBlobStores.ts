/**
 * Tier C Blob Stores — durable wrappers for the four safe-equivalent
 * services shipped in bb28201 (clamp suggestions, deferred outbound
 * queue, break-glass override, cross-tenant attestation).
 *
 * Why this exists:
 *   The in-memory classes in clampSuggestionLog.ts / deferred
 *   OutboundQueue.ts / breakGlassOverride.ts / zkCrossTenantAttest
 *   ation.ts are fine for unit tests but lose every entry on a
 *   Netlify function cold start. That is fatal for audit trails —
 *   a break-glass override record that vanishes on the next cold
 *   start cannot be presented at inspection.
 *
 *   This module layers thin blob-persistence wrappers over each
 *   class. Same pattern as BrainTelemetryStore / CaseReplayStore:
 *     - per-key-prefix in the shared `brain-memory` blob store
 *     - per-key write chain to serialise concurrent appends
 *     - fire-and-forget writes, await via `flush()` in tests
 *     - read returns empty list on blob miss, never throws
 *
 *   Pure append-only logs — mutations produce new entries, never
 *   edit in place. Compatible with the 10-year retention window
 *   required by FDL Art.24.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-24 (CO audit trail + retention)
 *   FDL No.10/2025 Art.29    (no tipping off — linted payloads)
 *   Cabinet Res 134/2025 Art.12-14, Art.19
 *   FATF Rec 11
 *   NIST AI RMF 1.0 MANAGE-3
 */

import type { BlobHandle } from './brainMemoryBlobStore';
import type { ClampSuggestion } from './clampSuggestionLog';
import type { OutboundMessage } from './deferredOutboundQueue';
import type { BreakGlassRequest } from './breakGlassOverride';
import type { CrossTenantCommitment } from './zkCrossTenantAttestation';

// ---------------------------------------------------------------------------
// Key layout
// ---------------------------------------------------------------------------

function safeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
}

const CLAMP_KEY = 'tierc/clamp-suggestions.jsonl';
function outboundKey(tenantId: string): string {
  return `tierc/outbound/${safeSegment(tenantId)}.jsonl`;
}
function breakGlassKey(tenantId: string): string {
  return `tierc/breakglass/${safeSegment(tenantId)}.jsonl`;
}
function crossTenantKey(saltVersion: string): string {
  return `tierc/cross-tenant/${safeSegment(saltVersion)}.jsonl`;
}

// ---------------------------------------------------------------------------
// Generic append-log helper
// ---------------------------------------------------------------------------

interface JsonlDoc<T> {
  entries: T[];
}

async function loadJsonl<T>(blob: BlobHandle, key: string): Promise<T[]> {
  try {
    const raw = await blob.getJSON<JsonlDoc<T> | null>(key);
    if (raw && Array.isArray(raw.entries)) return raw.entries.slice();
    return [];
  } catch (err) {
    console.warn(
      '[tierCBlobStores] load failed:',
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
}

async function appendJsonl<T>(blob: BlobHandle, key: string, entry: T, cap: number): Promise<void> {
  const existing = await loadJsonl<T>(blob, key);
  existing.push(entry);
  if (existing.length > cap) existing.splice(0, existing.length - cap);
  await blob.setJSON(key, { entries: existing });
}

async function replaceJsonl<T>(blob: BlobHandle, key: string, entries: T[]): Promise<void> {
  await blob.setJSON(key, { entries });
}

// ---------------------------------------------------------------------------
// Clamp Suggestion Blob Store
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CLAMP = 1000;

export class ClampSuggestionBlobStore {
  private readonly blob: BlobHandle;
  private readonly cap: number;
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(blob: BlobHandle, opts: { max?: number } = {}) {
    this.blob = blob;
    this.cap = opts.max ?? DEFAULT_MAX_CLAMP;
  }

  append(entry: ClampSuggestion): void {
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => appendJsonl(this.blob, CLAMP_KEY, entry, this.cap))
      .catch((err) =>
        console.error(
          '[clampSuggestionBlobStore] append failed:',
          err instanceof Error ? err.message : String(err)
        )
      );
  }

  async flush(): Promise<void> {
    await this.writeChain;
  }

  async all(): Promise<ClampSuggestion[]> {
    return loadJsonl<ClampSuggestion>(this.blob, CLAMP_KEY);
  }

  async decide(id: string, status: ClampSuggestion['status']): Promise<boolean> {
    const entries = await loadJsonl<ClampSuggestion>(this.blob, CLAMP_KEY);
    const idx = entries.findIndex((e) => e.id === id);
    if (idx < 0) return false;
    entries[idx] = { ...entries[idx]!, status };
    await replaceJsonl(this.blob, CLAMP_KEY, entries);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Deferred Outbound Blob Store — tenant-scoped
// ---------------------------------------------------------------------------

const DEFAULT_MAX_OUTBOUND = 2000;

export class DeferredOutboundBlobStore {
  private readonly blob: BlobHandle;
  private readonly cap: number;
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(blob: BlobHandle, opts: { max?: number } = {}) {
    this.blob = blob;
    this.cap = opts.max ?? DEFAULT_MAX_OUTBOUND;
  }

  persist(entry: OutboundMessage): void {
    const key = outboundKey(entry.tenantId);
    const prior = this.chains.get(key) ?? Promise.resolve();
    const next = prior
      .catch(() => undefined)
      .then(() => appendJsonl(this.blob, key, entry, this.cap))
      .catch((err) =>
        console.error(
          '[deferredOutboundBlobStore] persist failed:',
          err instanceof Error ? err.message : String(err)
        )
      );
    this.chains.set(key, next);
  }

  async flush(): Promise<void> {
    await Promise.allSettled(Array.from(this.chains.values()));
  }

  async pending(tenantId: string): Promise<OutboundMessage[]> {
    const entries = await loadJsonl<OutboundMessage>(this.blob, outboundKey(tenantId));
    return entries.filter((e) => e.status === 'pending_mlro_release');
  }

  async transition(
    tenantId: string,
    id: string,
    toStatus: OutboundMessage['status'],
    now: () => Date = () => new Date()
  ): Promise<boolean> {
    const key = outboundKey(tenantId);
    const entries = await loadJsonl<OutboundMessage>(this.blob, key);
    const idx = entries.findIndex((e) => e.id === id);
    if (idx < 0) return false;
    if (entries[idx]!.status !== 'pending_mlro_release') return false;
    entries[idx] = {
      ...entries[idx]!,
      status: toStatus,
      releasedAtIso: toStatus === 'released' ? now().toISOString() : entries[idx]!.releasedAtIso,
    };
    await replaceJsonl(this.blob, key, entries);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Break-Glass Blob Store — tenant-scoped
// ---------------------------------------------------------------------------

const DEFAULT_MAX_BREAKGLASS = 2000;

export class BreakGlassBlobStore {
  private readonly blob: BlobHandle;
  private readonly cap: number;
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(blob: BlobHandle, opts: { max?: number } = {}) {
    this.blob = blob;
    this.cap = opts.max ?? DEFAULT_MAX_BREAKGLASS;
  }

  persist(entry: BreakGlassRequest): void {
    const key = breakGlassKey(entry.tenantId);
    const prior = this.chains.get(key) ?? Promise.resolve();
    const next = prior
      .catch(() => undefined)
      .then(() => appendJsonl(this.blob, key, entry, this.cap))
      .catch((err) =>
        console.error(
          '[breakGlassBlobStore] persist failed:',
          err instanceof Error ? err.message : String(err)
        )
      );
    this.chains.set(key, next);
  }

  async flush(): Promise<void> {
    await Promise.allSettled(Array.from(this.chains.values()));
  }

  async all(tenantId: string): Promise<BreakGlassRequest[]> {
    return loadJsonl<BreakGlassRequest>(this.blob, breakGlassKey(tenantId));
  }

  async get(tenantId: string, id: string): Promise<BreakGlassRequest | null> {
    const entries = await loadJsonl<BreakGlassRequest>(this.blob, breakGlassKey(tenantId));
    return entries.find((e) => e.id === id) ?? null;
  }

  /**
   * Atomic approve — refuses self-approval + bad-state + unknown-id.
   * Tests run this via the class, production functions call it from
   * inside an MLRO-authenticated endpoint.
   */
  async approve(
    tenantId: string,
    id: string,
    approverId: string,
    now: () => Date = () => new Date()
  ): Promise<{ ok: boolean; reason: string }> {
    const key = breakGlassKey(tenantId);
    const entries = await loadJsonl<BreakGlassRequest>(this.blob, key);
    const idx = entries.findIndex((e) => e.id === id);
    if (idx < 0) return { ok: false, reason: 'unknown_id' };
    const e = entries[idx]!;
    if (e.status !== 'pending_second_approval') {
      return { ok: false, reason: `bad_state:${e.status}` };
    }
    if (!approverId || approverId === e.requestedBy) {
      return { ok: false, reason: 'self_approval_prohibited' };
    }
    entries[idx] = {
      ...e,
      approvedBy: approverId,
      approvedAtIso: now().toISOString(),
      status: 'approved',
    };
    await replaceJsonl(this.blob, key, entries);
    return { ok: true, reason: 'approved' };
  }

  async reject(
    tenantId: string,
    id: string,
    approverId: string
  ): Promise<{ ok: boolean; reason: string }> {
    const key = breakGlassKey(tenantId);
    const entries = await loadJsonl<BreakGlassRequest>(this.blob, key);
    const idx = entries.findIndex((e) => e.id === id);
    if (idx < 0) return { ok: false, reason: 'unknown_id' };
    const e = entries[idx]!;
    if (e.status !== 'pending_second_approval') {
      return { ok: false, reason: `bad_state:${e.status}` };
    }
    if (!approverId || approverId === e.requestedBy) {
      return { ok: false, reason: 'self_approval_prohibited' };
    }
    entries[idx] = { ...e, approvedBy: approverId, status: 'rejected' };
    await replaceJsonl(this.blob, key, entries);
    return { ok: true, reason: 'rejected' };
  }
}

// ---------------------------------------------------------------------------
// Cross-Tenant Commitment Blob Store — salt-version-scoped
// ---------------------------------------------------------------------------

const DEFAULT_MAX_XT = 5000;

export class CrossTenantCommitmentBlobStore {
  private readonly blob: BlobHandle;
  private readonly cap: number;
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(blob: BlobHandle, opts: { max?: number } = {}) {
    this.blob = blob;
    this.cap = opts.max ?? DEFAULT_MAX_XT;
  }

  persist(commitment: CrossTenantCommitment): void {
    const key = crossTenantKey(commitment.saltVersion);
    const prior = this.chains.get(key) ?? Promise.resolve();
    const next = prior
      .catch(() => undefined)
      .then(() => appendJsonl(this.blob, key, commitment, this.cap))
      .catch((err) =>
        console.error(
          '[crossTenantBlobStore] persist failed:',
          err instanceof Error ? err.message : String(err)
        )
      );
    this.chains.set(key, next);
  }

  async flush(): Promise<void> {
    await Promise.allSettled(Array.from(this.chains.values()));
  }

  async forSaltVersion(saltVersion: string): Promise<CrossTenantCommitment[]> {
    return loadJsonl<CrossTenantCommitment>(this.blob, crossTenantKey(saltVersion));
  }
}

// Exports for tests.
export const __test__ = {
  safeSegment,
  CLAMP_KEY,
  outboundKey,
  breakGlassKey,
  crossTenantKey,
  DEFAULT_MAX_CLAMP,
  DEFAULT_MAX_OUTBOUND,
  DEFAULT_MAX_BREAKGLASS,
  DEFAULT_MAX_XT,
};
