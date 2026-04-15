/**
 * Tests for the pure handler functions in
 * netlify/functions/customer-profile.mts. The handlers take an
 * injected ProfileStore so we never hit Netlify Blobs in tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { CustomerProfileV2 } from '../src/domain/customerProfile';
import {
  __test__,
  handleCreate,
  handleDelete,
  handleGet,
  handleList,
  handleUpdate,
  type HandlerDeps,
  type ProfileStore,
} from '../netlify/functions/customer-profile.mts';

// ---------------------------------------------------------------------------
// In-memory store for tests
// ---------------------------------------------------------------------------

function makeMemoryStore(): ProfileStore & {
  readonly state: Map<string, CustomerProfileV2>;
  readonly tombstones: Array<{ id: string; payload: { reason: string; tombstonedAt: string } }>;
} {
  const state = new Map<string, CustomerProfileV2>();
  const tombstones: Array<{
    id: string;
    payload: { reason: string; tombstonedAt: string };
  }> = [];
  return {
    state,
    tombstones,
    async list() {
      return Array.from(state.keys()).map((id) => `profile/${id}.json`);
    },
    async get(id: string) {
      return state.get(id) ?? null;
    },
    async set(id: string, profile: CustomerProfileV2) {
      state.set(id, profile);
    },
    async tombstone(id, payload) {
      state.delete(id);
      tombstones.push({ id, payload });
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture: a fully valid profile
// ---------------------------------------------------------------------------

function makeValidProfile(id = 'cust-test'): CustomerProfileV2 {
  return {
    schemaVersion: 2,
    id,
    legalName: 'TEST TRADING L.L.C',
    customerType: 'legal',
    country: 'AE',
    jurisdiction: 'Dubai',
    licenseNumber: 'DET-TEST',
    licenseIssuer: 'Dubai DET',
    licenseIssueDate: '01/01/2024',
    licenseExpiryDate: '01/01/2030',
    licenseStatus: 'active',
    businessModel: 'Jewellery wholesale trading in UAE',
    activity: 'Jewellery Trading',
    sector: 'jewellery-retail',
    expectedMonthlyVolumeAed: 100_000,
    expectedTransactionCountPerMonth: 10,
    riskRating: 'medium',
    riskRatingAssignedAt: '01/01/2026',
    riskRatingExpiresAt: '01/07/2026',
    pepStatus: 'clear',
    sanctionsStatus: 'clear',
    sourceOfFundsStatus: 'verified',
    sourceOfFundsEvidence: [
      {
        blobKey: 'evidence/sof.pdf',
        filename: 'sof.pdf',
        mimeType: 'application/pdf',
        uploadedAt: '2026-01-01T00:00:00Z',
        uploadedBy: 'mlro',
        sha256: 'a'.repeat(64),
      },
    ],
    sourceOfWealthStatus: 'not_applicable',
    shareholders: [
      {
        id: 'sh-1',
        type: 'natural',
        fullName: 'Owner One',
        ownershipPercent: 60,
        dateOfBirth: '01/01/1980',
        nationality: 'AE',
        emiratesIdNumber: '784-1980-1111111-1',
        emiratesIdExpiry: '01/01/2030',
        uboVerifiedAt: '01/01/2026',
        pepCheckStatus: 'clear',
        sanctionsCheckStatus: 'clear',
        adverseMediaCheckStatus: 'clear',
        evidenceAttachments: [
          {
            blobKey: 'evidence/sh1.pdf',
            filename: 'sh1.pdf',
            mimeType: 'application/pdf',
            uploadedAt: '2026-01-01T00:00:00Z',
            uploadedBy: 'mlro',
            sha256: 'b'.repeat(64),
          },
        ],
      },
    ],
    managers: [
      {
        id: 'mgr-1',
        fullName: 'MLRO Guy',
        role: 'mlro',
        dateOfBirth: '01/01/1980',
        nationality: 'AE',
        emiratesIdNumber: '784-1980-2222222-2',
        emiratesIdExpiry: '01/01/2030',
        passportNumber: 'A1',
        passportCountry: 'AE',
        passportExpiry: '01/01/2030',
        appointmentDate: '01/01/2024',
        isSanctionsAuthority: true,
        isStrFilingAuthority: true,
        pepCheckStatus: 'clear',
        sanctionsCheckStatus: 'clear',
        adverseMediaCheckStatus: 'clear',
      },
      {
        id: 'mgr-2',
        fullName: 'CO Guy',
        role: 'co',
        dateOfBirth: '01/01/1985',
        nationality: 'AE',
        emiratesIdNumber: '784-1985-3333333-3',
        emiratesIdExpiry: '01/01/2030',
        passportNumber: 'A2',
        passportCountry: 'AE',
        passportExpiry: '01/01/2030',
        appointmentDate: '01/01/2024',
        isSanctionsAuthority: true,
        isStrFilingAuthority: false,
        pepCheckStatus: 'clear',
        sanctionsCheckStatus: 'clear',
        adverseMediaCheckStatus: 'clear',
      },
    ],
    entityType: 'standalone',
    createdAt: '2026-01-01T00:00:00Z',
    nextReviewDueAt: '01/07/2026',
    recordRetentionUntil: '01/01/2036',
  };
}

function makeDeps(store: ProfileStore): HandlerDeps {
  return {
    store,
    nowIso: '2026-04-15T10:00:00.000Z',
    userId: 'test-user',
  };
}

// ---------------------------------------------------------------------------
// validateRequest
// ---------------------------------------------------------------------------

describe('validateRequest', () => {
  const { validateRequest } = __test__;

  it('rejects non-object', () => {
    expect(validateRequest('not-an-object').ok).toBe(false);
    expect(validateRequest(null).ok).toBe(false);
  });

  it('rejects unknown action', () => {
    const res = validateRequest({ action: 'upsert' });
    expect(res.ok).toBe(false);
  });

  it('accepts valid create request', () => {
    const res = validateRequest({ action: 'create', profile: {} });
    expect(res.ok).toBe(true);
  });

  it('rejects create without profile', () => {
    expect(validateRequest({ action: 'create' }).ok).toBe(false);
  });

  it('rejects get without id', () => {
    expect(validateRequest({ action: 'get' }).ok).toBe(false);
    expect(validateRequest({ action: 'get', id: '' }).ok).toBe(false);
  });

  it('accepts list without args', () => {
    expect(validateRequest({ action: 'list' }).ok).toBe(true);
  });

  it('rejects update without patch', () => {
    expect(validateRequest({ action: 'update', id: 'x' }).ok).toBe(false);
  });

  it('rejects delete without reason', () => {
    expect(validateRequest({ action: 'delete', id: 'x' }).ok).toBe(false);
    expect(validateRequest({ action: 'delete', id: 'x', reason: 'no' }).ok).toBe(false);
  });

  it('accepts delete with a real reason', () => {
    const res = validateRequest({
      action: 'delete',
      id: 'x',
      reason: 'Customer exited relationship',
    });
    expect(res.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleCreate
// ---------------------------------------------------------------------------

describe('handleCreate', () => {
  let store: ReturnType<typeof makeMemoryStore>;
  let deps: HandlerDeps;

  beforeEach(() => {
    store = makeMemoryStore();
    deps = makeDeps(store);
  });

  it('creates a valid profile and persists it', async () => {
    const profile = makeValidProfile();
    const result = await handleCreate({ action: 'create', profile }, deps);
    expect(result.status).toBe(200);
    const body = result.body as { ok: boolean; profile: CustomerProfileV2 };
    expect(body.ok).toBe(true);
    expect(body.profile.id).toBe('cust-test');
    expect(store.state.has('cust-test')).toBe(true);
  });

  it('rejects an invalid profile with 422 + findings', async () => {
    const profile = { ...makeValidProfile(), id: '' }; // empty id is a blocker
    const result = await handleCreate({ action: 'create', profile }, deps);
    expect(result.status).toBe(422);
    const body = result.body as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('validation_failed');
    expect(store.state.size).toBe(0);
  });

  it('rejects duplicate id with 409', async () => {
    const profile = makeValidProfile();
    await handleCreate({ action: 'create', profile }, deps);
    const second = await handleCreate({ action: 'create', profile }, deps);
    expect(second.status).toBe(409);
  });

  it('forces schemaVersion=2 and overwrites createdAt', async () => {
    const tampered = {
      ...makeValidProfile(),
      schemaVersion: 99 as unknown as 2,
      createdAt: '1970-01-01T00:00:00Z',
    };
    const result = await handleCreate({ action: 'create', profile: tampered }, deps);
    expect(result.status).toBe(200);
    const body = result.body as { profile: CustomerProfileV2 };
    expect(body.profile.schemaVersion).toBe(2);
    expect(body.profile.createdAt).toBe('2026-04-15T10:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// handleGet
// ---------------------------------------------------------------------------

describe('handleGet', () => {
  let store: ReturnType<typeof makeMemoryStore>;
  let deps: HandlerDeps;

  beforeEach(() => {
    store = makeMemoryStore();
    deps = makeDeps(store);
  });

  it('returns 404 when not found', async () => {
    const result = await handleGet({ action: 'get', id: 'missing' }, deps);
    expect(result.status).toBe(404);
  });

  it('returns the profile when it exists', async () => {
    store.state.set('cust-1', makeValidProfile('cust-1'));
    const result = await handleGet({ action: 'get', id: 'cust-1' }, deps);
    expect(result.status).toBe(200);
    const body = result.body as { profile: CustomerProfileV2 };
    expect(body.profile.id).toBe('cust-1');
  });
});

// ---------------------------------------------------------------------------
// handleList
// ---------------------------------------------------------------------------

describe('handleList', () => {
  let store: ReturnType<typeof makeMemoryStore>;
  let deps: HandlerDeps;

  beforeEach(() => {
    store = makeMemoryStore();
    deps = makeDeps(store);
  });

  it('returns empty list when nothing exists', async () => {
    const result = await handleList({ action: 'list' }, deps);
    expect(result.status).toBe(200);
    const body = result.body as { count: number; profiles: unknown[] };
    expect(body.count).toBe(0);
    expect(body.profiles).toHaveLength(0);
  });

  it('returns id+legalName+riskRating+licenseExpiryDate+country summaries', async () => {
    store.state.set('c1', makeValidProfile('c1'));
    store.state.set('c2', { ...makeValidProfile('c2'), legalName: 'NAPLES LLC' });
    const result = await handleList({ action: 'list' }, deps);
    expect(result.status).toBe(200);
    const body = result.body as {
      count: number;
      profiles: Array<{
        id: string;
        legalName: string;
        riskRating: string;
        licenseExpiryDate: string;
        country: string;
      }>;
    };
    expect(body.count).toBe(2);
    const ids = body.profiles.map((p) => p.id).sort();
    expect(ids).toEqual(['c1', 'c2']);
    for (const p of body.profiles) {
      expect(p).toHaveProperty('legalName');
      expect(p).toHaveProperty('riskRating');
      expect(p).toHaveProperty('licenseExpiryDate');
      expect(p).toHaveProperty('country');
    }
  });
});

// ---------------------------------------------------------------------------
// handleUpdate
// ---------------------------------------------------------------------------

describe('handleUpdate', () => {
  let store: ReturnType<typeof makeMemoryStore>;
  let deps: HandlerDeps;

  beforeEach(() => {
    store = makeMemoryStore();
    deps = makeDeps(store);
  });

  it('returns 404 when updating missing profile', async () => {
    const result = await handleUpdate(
      { action: 'update', id: 'missing', patch: { jurisdiction: 'Sharjah' } },
      deps
    );
    expect(result.status).toBe(404);
  });

  it('merges the patch and persists', async () => {
    store.state.set('cust-1', makeValidProfile('cust-1'));
    const result = await handleUpdate(
      { action: 'update', id: 'cust-1', patch: { jurisdiction: 'Sharjah', riskRating: 'high' } },
      deps
    );
    expect(result.status).toBe(200);
    const body = result.body as { profile: CustomerProfileV2 };
    expect(body.profile.jurisdiction).toBe('Sharjah');
    expect(body.profile.riskRating).toBe('high');
    // id + schemaVersion + createdAt are preserved
    expect(body.profile.id).toBe('cust-1');
    expect(body.profile.schemaVersion).toBe(2);
  });

  it('refuses to overwrite id / schemaVersion / createdAt via patch', async () => {
    store.state.set('cust-1', makeValidProfile('cust-1'));
    const tampered = {
      action: 'update' as const,
      id: 'cust-1',
      patch: {
        id: 'pwned',
        schemaVersion: 99 as unknown as 2,
        createdAt: '1970-01-01T00:00:00Z',
      },
    };
    const result = await handleUpdate(tampered, deps);
    expect(result.status).toBe(200);
    const body = result.body as { profile: CustomerProfileV2 };
    expect(body.profile.id).toBe('cust-1');
    expect(body.profile.schemaVersion).toBe(2);
    expect(body.profile.createdAt).toBe('2026-01-01T00:00:00Z');
  });

  it('stamps lastReviewedAt + lastReviewerUserId on every update', async () => {
    store.state.set('cust-1', makeValidProfile('cust-1'));
    const result = await handleUpdate(
      { action: 'update', id: 'cust-1', patch: { jurisdiction: 'Sharjah' } },
      deps
    );
    expect(result.status).toBe(200);
    const body = result.body as { profile: CustomerProfileV2 };
    expect(body.profile.lastReviewedAt).toBe('2026-04-15T10:00:00.000Z');
    expect(body.profile.lastReviewerUserId).toBe('test-user');
  });

  it('rejects a patch that makes the profile invalid', async () => {
    store.state.set('cust-1', makeValidProfile('cust-1'));
    const result = await handleUpdate(
      { action: 'update', id: 'cust-1', patch: { country: 'United Arab Emirates' } },
      deps
    );
    expect(result.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// handleDelete (tombstone)
// ---------------------------------------------------------------------------

describe('handleDelete', () => {
  let store: ReturnType<typeof makeMemoryStore>;
  let deps: HandlerDeps;

  beforeEach(() => {
    store = makeMemoryStore();
    deps = makeDeps(store);
  });

  it('returns 404 when deleting missing profile', async () => {
    const result = await handleDelete(
      { action: 'delete', id: 'missing', reason: 'Customer never onboarded' },
      deps
    );
    expect(result.status).toBe(404);
  });

  it('tombstones (not hard deletes) a live profile', async () => {
    store.state.set('cust-1', makeValidProfile('cust-1'));
    const result = await handleDelete(
      { action: 'delete', id: 'cust-1', reason: 'Customer exited relationship' },
      deps
    );
    expect(result.status).toBe(200);
    // Profile removed from live store.
    expect(store.state.has('cust-1')).toBe(false);
    // Tombstone written.
    expect(store.tombstones).toHaveLength(1);
    expect(store.tombstones[0]!.id).toBe('cust-1');
    expect(store.tombstones[0]!.payload.reason).toBe('Customer exited relationship');
  });
});
