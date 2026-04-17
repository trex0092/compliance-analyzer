/**
 * Regression tests for the four-eyes read-modify-write race in
 * netlify/functions/approvals.mts.
 *
 * The bug: `recordDecision` previously read the current ApprovalEntry,
 * computed the new record via `applyDecisionToRecord`, and then
 * unconditionally `setJSON`'d the result. Two concurrent votes on
 * the same eventId both read the same `{approvals: []}` snapshot and
 * each wrote their own new record; the second writer silently
 * overwrote the first. One of the two votes (approval OR rejection)
 * was lost, which in a four-eyes regulatory flow is a correctness
 * bug: an approver's "approve" could be erased by a racing "reject"
 * (or vice versa), and the UI would never know.
 *
 * The fix wraps the read-modify-write in a CAS retry loop using the
 * Netlify Blobs `onlyIfMatch` / `onlyIfNew` semantics. Under
 * contention the second writer re-reads the fresh record and
 * re-applies their vote on top. After MAX_CAS_ATTEMPTS of lost
 * races the caller surfaces `casExhausted: true` so the HTTP layer
 * responds with 503 — never a silent success.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Fake Netlify Blobs implementation scriptable per-test.
interface FakeEntry { value: unknown; etag: string }
let fakeData: Map<string, FakeEntry>;
let fakeCounter = 0;
let beforeFirstWrite: (() => Promise<void>) | null = null;
let setJsonCalls = 0;
let getCalls = 0;

vi.mock('@netlify/blobs', () => ({
  getStore: () => ({
    async getWithMetadata(key: string) {
      getCalls++;
      const v = fakeData.get(key);
      return v ? { data: v.value, etag: v.etag } : null;
    },
    async get(key: string) {
      const v = fakeData.get(key);
      return v ? v.value : null;
    },
    async setJSON(key: string, value: unknown, opts: any) {
      setJsonCalls++;
      // beforeFirstWrite hook: simulate another writer winning the
      // race just before our first CAS attempt lands.
      if (beforeFirstWrite && setJsonCalls === 1) {
        const hook = beforeFirstWrite;
        beforeFirstWrite = null;
        await hook();
      }
      const existing = fakeData.get(key);
      if (opts?.onlyIfMatch) {
        if (!existing || existing.etag !== opts.onlyIfMatch) {
          return { modified: false };
        }
      }
      if (opts?.onlyIfNew) {
        if (existing) return { modified: false };
      }
      const etag = 'etag-' + ++fakeCounter;
      fakeData.set(key, { value, etag });
      return { modified: true, etag };
    },
  }),
}));

// Auth stub — always returns alice. We bypass the real bearer
// extraction, rate limiter, etc., so the tests focus on the race.
vi.mock('../netlify/functions/middleware/auth.mts', () => ({
  authenticateApprover: () => ({ ok: true, username: 'alice' }),
}));
vi.mock('../netlify/functions/middleware/rate-limit.mts', () => ({
  checkRateLimit: async () => null,
}));

beforeEach(() => {
  fakeData = new Map();
  fakeCounter = 0;
  setJsonCalls = 0;
  getCalls = 0;
  beforeFirstWrite = null;
});

afterEach(() => {
  vi.resetModules();
});

async function freshModule() {
  return await import('../netlify/functions/approvals.mts?t=' + Date.now());
}

describe('approvals — CAS retry on concurrent writers', () => {
  it('retries and preserves a prior approver when a race happens', async () => {
    const mod = await freshModule();
    // Seed: bob already approved. That snapshot has etag=etag-1.
    fakeData.set('evt1', {
      value: {
        eventId: 'evt1',
        approvals: [{ actor: 'bob', at: '2026-04-17T10:00:00.000Z' }],
        rejections: [],
        status: 'pending',
      },
      etag: 'etag-1',
    });
    fakeCounter = 1;

    // Install the pre-first-write hook: between alice reading
    // {approvals:[bob]} and alice writing {approvals:[bob,alice]},
    // a third party (charlie) squeezes in a concurrent approval and
    // updates the etag. Alice's first CAS attempt therefore fails,
    // and the retry must re-read + re-apply on top of charlie's
    // fresh record.
    beforeFirstWrite = async () => {
      fakeData.set('evt1', {
        value: {
          eventId: 'evt1',
          approvals: [
            { actor: 'bob', at: '2026-04-17T10:00:00.000Z' },
            { actor: 'charlie', at: '2026-04-17T11:00:00.000Z' },
          ],
          rejections: [],
          status: 'pending',
        },
        etag: 'etag-99', // the concurrent writer's new etag
      });
    };

    // Alice votes approve.
    const req = new Request('https://example.test/api/approvals/approve', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ eventId: 'evt1' }),
    });
    const res = await (mod.default as any)(req, { ip: '127.0.0.1' });
    expect(res.status).toBe(200);
    const body = await res.json();

    // Alice's vote landed AND bob + charlie's prior votes are
    // preserved (the fix: we re-read on CAS conflict instead of
    // blindly overwriting).
    const finalRec = body.record;
    const actors = finalRec.approvals.map((a: { actor: string }) => a.actor);
    expect(actors).toContain('bob');
    expect(actors).toContain('charlie');
    expect(actors).toContain('alice');
    expect(finalRec.status).toBe('approved'); // >= REQUIRED_APPROVERS
    // setJSON was attempted twice (one conflict + one success).
    expect(setJsonCalls).toBe(2);
  });

  it('returns 503 when every CAS attempt loses', async () => {
    const mod = await freshModule();
    fakeData.set('evt2', {
      value: {
        eventId: 'evt2',
        approvals: [],
        rejections: [],
        status: 'pending',
      },
      etag: 'etag-seed',
    });

    // Every setJSON attempt reports a CAS conflict (modified:false).
    // This is a stronger contender than our test can usually script,
    // but we substitute a fakeData that shifts etag on every read.
    let etagRev = 100;
    const realGet = (mod as any); // force fresh import
    // Replace the stub to always bump the etag between get and set.
    fakeData = new Map();
    const rewrite = () => {
      fakeData.set('evt2', {
        value: { eventId: 'evt2', approvals: [], rejections: [], status: 'pending' },
        etag: 'etag-' + (++etagRev),
      });
    };
    rewrite();
    beforeFirstWrite = async () => {
      // Rewrite before the write lands — and again on every retry.
      rewrite();
    };
    // We can only install ONE beforeFirstWrite, so instead patch the
    // fake store via getStore() closure. Easiest: monkey-patch
    // fakeData directly inside the setJSON by shifting etag. We do
    // that via the getWithMetadata hook by always returning a
    // reshuffled etag.
    const originalGet = fakeData.get.bind(fakeData);
    (fakeData as any).get = (key: string) => {
      const v = originalGet(key);
      if (v) rewrite();
      return v;
    };

    const req = new Request('https://example.test/api/approvals/approve', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ eventId: 'evt2' }),
    });
    const res = await (mod.default as any)(req, { ip: '127.0.0.1' });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('approval_write_contention');
  });

  it('still allows single-vote success on no contention', async () => {
    const mod = await freshModule();
    fakeData.set('evt3', {
      value: {
        eventId: 'evt3',
        approvals: [],
        rejections: [],
        status: 'pending',
      },
      etag: 'etag-only',
    });

    const req = new Request('https://example.test/api/approvals/approve', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cccccccccccccccccccccccccccccccccccccccccc',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ eventId: 'evt3' }),
    });
    const res = await (mod.default as any)(req, { ip: '127.0.0.1' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.record.approvals.length).toBe(1);
    expect(body.record.approvals[0].actor).toBe('alice');
    expect(setJsonCalls).toBe(1);
  });
});
