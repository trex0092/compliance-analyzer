/**
 * Regression tests for the read-modify-write race on
 * `handleUpdate` in netlify/functions/customer-profile.mts.
 *
 * Without CAS, two concurrent PATCHes against the same customer
 * both read the same snapshot, each compute their own merged
 * record, and the second setJSON silently overwrites the first
 * patcher's field changes. Lost field updates on a customer
 * profile are an FDL Art.24 audit-chain gap — the regulatory
 * record will not reflect what the two MLROs actually typed.
 *
 * The fix threads a `casUpdate(id, transform)` method through
 * `ProfileStore`. `handleUpdate` uses it when available; the
 * transform is re-invoked on every CAS retry so the merge happens
 * on top of the freshest record, not a stale snapshot. These
 * tests drive `handleUpdate` through a fake store that simulates
 * a concurrent writer landing between our read and our write.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { CustomerProfileV2 } from '../src/domain/customerProfile';
import {
  handleUpdate,
  type HandlerDeps,
  type ProfileStore,
} from '../netlify/functions/customer-profile.mts';

function makeValidProfile(id = 'cust-race'): CustomerProfileV2 {
  return {
    schemaVersion: 2,
    id,
    legalName: 'RACE TRADING L.L.C',
    customerType: 'legal',
    country: 'AE',
    jurisdiction: 'Dubai',
    licenseNumber: 'DET-RACE',
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
        kind: 'bank-statement',
        issuer: 'Emirates NBD',
        issuedAt: '01/01/2026',
        verifiedAt: '02/01/2026',
        reference: 'ENBD-RACE',
      },
    ],
    beneficialOwners: [
      {
        fullName: 'Owner Person',
        nationality: 'AE',
        ownershipPercentage: 100,
        isPep: false,
        verifiedAt: '01/01/2026',
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    lastReviewedAt: '2026-01-01T00:00:00.000Z',
    lastReviewerUserId: 'init',
  } as CustomerProfileV2;
}

// A CAS-aware in-memory store that lets each test script a
// "concurrent writer" hook that fires between our read and our
// write, exactly once.
function makeCasMemoryStore(seed: CustomerProfileV2, concurrentWriter?: (profile: CustomerProfileV2) => CustomerProfileV2) {
  const state = new Map<string, { profile: CustomerProfileV2; etag: string }>();
  state.set(seed.id, { profile: seed, etag: 'etag-0' });
  let etagRev = 0;
  let writerFired = false;
  let casAttempts = 0;
  const store: ProfileStore = {
    async list() { return Array.from(state.keys()).map((id) => `profile/${id}.json`); },
    async get(id) { return state.get(id)?.profile ?? null; },
    async set(id, p) { state.set(id, { profile: p, etag: 'etag-' + ++etagRev }); },
    async tombstone() { /* not exercised */ },
    async casUpdate(id, transform) {
      for (let attempt = 0; attempt < 5; attempt++) {
        casAttempts++;
        const cur = state.get(id);
        const existing = cur?.profile ?? null;
        const etag = cur?.etag ?? null;

        // Fire the concurrent-writer hook exactly once, between
        // our read and our write on the FIRST attempt.
        if (!writerFired && concurrentWriter && existing) {
          writerFired = true;
          const bumped = concurrentWriter(existing);
          state.set(id, { profile: bumped, etag: 'etag-' + ++etagRev });
        }

        const next = transform(existing);
        if (next === null) return { ok: false, notFound: true };

        const latest = state.get(id);
        if (etag && latest && latest.etag !== etag) {
          // CAS conflict — retry.
          continue;
        }
        state.set(id, { profile: next, etag: 'etag-' + ++etagRev });
        return { ok: true, profile: next };
      }
      return { ok: false, contention: true };
    },
  };
  return { store, state, get casAttempts() { return casAttempts; } };
}

function deps(store: ProfileStore): HandlerDeps {
  return {
    store,
    nowIso: '2026-04-17T12:00:00.000Z',
    userId: 'tester',
  };
}

describe('handleUpdate — CAS retry preserves a concurrent patch', () => {
  it('retries and merges on top of a concurrent writer', async () => {
    const initial = makeValidProfile('cust-1');
    const { store, state, casAttempts: _ } = makeCasMemoryStore(initial, (cur) => ({
      // Concurrent writer changes riskRating and adds a review stamp.
      ...cur,
      riskRating: 'high',
      lastReviewerUserId: 'concurrent-mlro',
    }));

    // Our patch changes pepStatus.
    const result = await handleUpdate(
      { id: 'cust-1', patch: { pepStatus: 'screened' } as Partial<CustomerProfileV2> },
      deps(store),
    );
    expect(result.status).toBe(200);

    // The concurrent writer's riskRating='high' must be preserved,
    // AND our pepStatus='screened' must land.
    const final = state.get('cust-1')!.profile;
    expect(final.riskRating).toBe('high');
    expect(final.pepStatus).toBe('screened');
    // Our user stamp overwrites — we are the winner of the final
    // vote, which is expected since we re-merged on top.
    expect(final.lastReviewerUserId).toBe('tester');
  });

  it('surfaces 404 when the record does not exist', async () => {
    const { store } = makeCasMemoryStore(makeValidProfile('other'));
    const result = await handleUpdate(
      { id: 'missing', patch: { pepStatus: 'screened' } as Partial<CustomerProfileV2> },
      deps(store),
    );
    expect(result.status).toBe(404);
  });

  it('surfaces 422 when validation fails (even via the CAS path)', async () => {
    const initial = makeValidProfile('cust-422');
    const { store } = makeCasMemoryStore(initial);
    // invalid patch — licenseExpiryDate in the wrong format.
    const result = await handleUpdate(
      { id: 'cust-422', patch: { licenseExpiryDate: 'not-a-date' } as Partial<CustomerProfileV2> },
      deps(store),
    );
    expect(result.status).toBe(422);
    const body = result.body as { ok: boolean; error: string };
    expect(body.error).toBe('validation_failed');
  });
});

describe('handleUpdate — fallback path (no casUpdate on the store)', () => {
  it('works without casUpdate (pre-existing behaviour preserved)', async () => {
    const initial = makeValidProfile('cust-legacy');
    const state = new Map<string, CustomerProfileV2>([[initial.id, initial]]);
    const legacyStore: ProfileStore = {
      async list() { return Array.from(state.keys()).map((id) => `profile/${id}.json`); },
      async get(id) { return state.get(id) ?? null; },
      async set(id, p) { state.set(id, p); },
      async tombstone() {},
      // NOTE: no casUpdate
    };
    const result = await handleUpdate(
      { id: 'cust-legacy', patch: { pepStatus: 'screened' } as Partial<CustomerProfileV2> },
      deps(legacyStore),
    );
    expect(result.status).toBe(200);
    expect(state.get('cust-legacy')!.pepStatus).toBe('screened');
  });
});
