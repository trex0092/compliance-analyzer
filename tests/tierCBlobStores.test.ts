/**
 * Tier C blob stores tests.
 */
import { describe, it, expect } from 'vitest';
import {
  ClampSuggestionBlobStore,
  DeferredOutboundBlobStore,
  BreakGlassBlobStore,
  CrossTenantCommitmentBlobStore,
  __test__,
} from '../src/services/tierCBlobStores';
import type { BlobHandle } from '../src/services/brainMemoryBlobStore';
import type { ClampSuggestion } from '../src/services/clampSuggestionLog';
import type { OutboundMessage } from '../src/services/deferredOutboundQueue';
import type { BreakGlassRequest } from '../src/services/breakGlassOverride';
import type { CrossTenantCommitment } from '../src/services/zkCrossTenantAttestation';

const { safeSegment, CLAMP_KEY, outboundKey, breakGlassKey, crossTenantKey } = __test__;

class FakeBlobHandle implements BlobHandle {
  readonly data = new Map<string, unknown>();
  async getJSON<T = unknown>(key: string): Promise<T | null> {
    const v = this.data.get(key);
    return v === undefined ? null : (v as T);
  }
  async setJSON(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

const now = () => new Date('2026-04-14T12:00:00.000Z');

// ---------------------------------------------------------------------------
// Key layout
// ---------------------------------------------------------------------------

describe('tierCBlobStores key layout', () => {
  it('safeSegment strips slashes', () => {
    expect(safeSegment('a/b')).toBe('a_b');
  });
  it('CLAMP_KEY is a single global path', () => {
    expect(CLAMP_KEY).toBe('tierc/clamp-suggestions.jsonl');
  });
  it('outboundKey scopes by tenant', () => {
    expect(outboundKey('tA')).toBe('tierc/outbound/tA.jsonl');
  });
  it('breakGlassKey scopes by tenant', () => {
    expect(breakGlassKey('tA')).toBe('tierc/breakglass/tA.jsonl');
  });
  it('crossTenantKey scopes by saltVersion', () => {
    expect(crossTenantKey('v1')).toBe('tierc/cross-tenant/v1.jsonl');
  });
});

// ---------------------------------------------------------------------------
// Clamp store
// ---------------------------------------------------------------------------

describe('ClampSuggestionBlobStore', () => {
  function sample(id: string): ClampSuggestion {
    return {
      id,
      clampKey: 'sanctionsMatchMin',
      currentValue: 0.5,
      proposedValue: 0.55,
      delta: 0.05,
      evidenceCount: 100,
      rationale: 'test',
      status: 'pending_mlro_review',
      createdAtIso: now().toISOString(),
      regulatory: 'FDL Art.20',
    };
  }

  it('append + all round-trips', async () => {
    const blob = new FakeBlobHandle();
    const store = new ClampSuggestionBlobStore(blob);
    store.append(sample('s1'));
    store.append(sample('s2'));
    await store.flush();
    const all = await store.all();
    expect(all).toHaveLength(2);
    expect(all.map((e) => e.id)).toEqual(['s1', 's2']);
  });

  it('decide updates status in place', async () => {
    const blob = new FakeBlobHandle();
    const store = new ClampSuggestionBlobStore(blob);
    store.append(sample('s1'));
    await store.flush();
    const ok = await store.decide('s1', 'accepted');
    expect(ok).toBe(true);
    const all = await store.all();
    expect(all[0]!.status).toBe('accepted');
  });

  it('decide returns false for unknown id', async () => {
    const blob = new FakeBlobHandle();
    const store = new ClampSuggestionBlobStore(blob);
    expect(await store.decide('missing', 'accepted')).toBe(false);
  });

  it('caps at max', async () => {
    const blob = new FakeBlobHandle();
    const store = new ClampSuggestionBlobStore(blob, { max: 3 });
    for (let i = 0; i < 5; i++) store.append(sample(`s${i}`));
    await store.flush();
    const all = await store.all();
    expect(all).toHaveLength(3);
    expect(all[0]!.id).toBe('s2'); // oldest 2 evicted
  });
});

// ---------------------------------------------------------------------------
// Outbound store
// ---------------------------------------------------------------------------

describe('DeferredOutboundBlobStore', () => {
  function sample(id: string, tenantId = 'tA'): OutboundMessage {
    return {
      id,
      tenantId,
      recipientRef: 'cust-1',
      channel: 'email',
      subject: 'Welcome',
      body: 'Welcome message',
      status: 'pending_mlro_release',
      createdAtIso: now().toISOString(),
      releasedAtIso: null,
      lintReport: { clean: true, findings: [], topSeverity: 'none', narrative: '' },
    };
  }

  it('persist + pending round-trip scoped per tenant', async () => {
    const blob = new FakeBlobHandle();
    const store = new DeferredOutboundBlobStore(blob);
    store.persist(sample('m1', 'tA'));
    store.persist(sample('m2', 'tB'));
    await store.flush();
    expect((await store.pending('tA')).map((e) => e.id)).toEqual(['m1']);
    expect((await store.pending('tB')).map((e) => e.id)).toEqual(['m2']);
  });

  it('transition to released sets releasedAtIso', async () => {
    const blob = new FakeBlobHandle();
    const store = new DeferredOutboundBlobStore(blob);
    store.persist(sample('m1'));
    await store.flush();
    const ok = await store.transition('tA', 'm1', 'released', now);
    expect(ok).toBe(true);
    const remaining = await store.pending('tA');
    expect(remaining).toHaveLength(0);
  });

  it('transition fails on unknown id or non-pending status', async () => {
    const blob = new FakeBlobHandle();
    const store = new DeferredOutboundBlobStore(blob);
    expect(await store.transition('tA', 'missing', 'released')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Break-glass store
// ---------------------------------------------------------------------------

describe('BreakGlassBlobStore', () => {
  function sample(id: string, tenantId = 'tA'): BreakGlassRequest {
    return {
      id,
      tenantId,
      caseId: 'case-1',
      fromVerdict: 'freeze',
      toVerdict: 'escalate',
      justification: 'legit review',
      regulatoryCitation: 'FDL Art.20',
      requestedBy: 'mlro-1',
      requestedAtIso: now().toISOString(),
      approvedBy: null,
      approvedAtIso: null,
      executedAtIso: null,
      status: 'pending_second_approval',
      lintReport: { clean: true, findings: [], topSeverity: 'none', narrative: '' },
    };
  }

  it('persist + all round-trip', async () => {
    const blob = new FakeBlobHandle();
    const store = new BreakGlassBlobStore(blob);
    store.persist(sample('b1'));
    store.persist(sample('b2'));
    await store.flush();
    expect(await store.all('tA')).toHaveLength(2);
  });

  it('approve refuses self-approval', async () => {
    const blob = new FakeBlobHandle();
    const store = new BreakGlassBlobStore(blob);
    store.persist(sample('b1'));
    await store.flush();
    const res = await store.approve('tA', 'b1', 'mlro-1');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('self_approval_prohibited');
  });

  it('approve with different user succeeds', async () => {
    const blob = new FakeBlobHandle();
    const store = new BreakGlassBlobStore(blob);
    store.persist(sample('b1'));
    await store.flush();
    const res = await store.approve('tA', 'b1', 'mlro-2', now);
    expect(res.ok).toBe(true);
    expect((await store.get('tA', 'b1'))!.status).toBe('approved');
  });

  it('reject refuses self + unknown', async () => {
    const blob = new FakeBlobHandle();
    const store = new BreakGlassBlobStore(blob);
    store.persist(sample('b1'));
    await store.flush();
    expect((await store.reject('tA', 'b1', 'mlro-1')).reason).toBe('self_approval_prohibited');
    expect((await store.reject('tA', 'missing', 'mlro-2')).reason).toBe('unknown_id');
    expect((await store.reject('tA', 'b1', 'mlro-2')).ok).toBe(true);
  });

  it('cannot approve an already-approved request', async () => {
    const blob = new FakeBlobHandle();
    const store = new BreakGlassBlobStore(blob);
    store.persist(sample('b1'));
    await store.flush();
    await store.approve('tA', 'b1', 'mlro-2', now);
    const again = await store.approve('tA', 'b1', 'mlro-3', now);
    expect(again.ok).toBe(false);
    expect(again.reason).toMatch(/bad_state/);
  });

  it('tenant isolation', async () => {
    const blob = new FakeBlobHandle();
    const store = new BreakGlassBlobStore(blob);
    store.persist(sample('b1', 'tA'));
    await store.flush();
    expect(await store.get('tB', 'b1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant store
// ---------------------------------------------------------------------------

describe('CrossTenantCommitmentBlobStore', () => {
  function sample(tenantId: string, commitHash: string): CrossTenantCommitment {
    return {
      commitHash,
      tenantId,
      publishedAtIso: now().toISOString(),
      saltVersion: 'v1',
    };
  }

  it('persist + forSaltVersion round-trips', async () => {
    const blob = new FakeBlobHandle();
    const store = new CrossTenantCommitmentBlobStore(blob);
    store.persist(sample('tA', 'h1'));
    store.persist(sample('tB', 'h1'));
    await store.flush();
    const all = await store.forSaltVersion('v1');
    expect(all).toHaveLength(2);
  });

  it('salt version isolation', async () => {
    const blob = new FakeBlobHandle();
    const store = new CrossTenantCommitmentBlobStore(blob);
    store.persist(sample('tA', 'h1'));
    store.persist({
      commitHash: 'h2',
      tenantId: 'tA',
      publishedAtIso: now().toISOString(),
      saltVersion: 'v2',
    });
    await store.flush();
    expect(await store.forSaltVersion('v1')).toHaveLength(1);
    expect(await store.forSaltVersion('v2')).toHaveLength(1);
  });
});
