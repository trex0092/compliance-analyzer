/**
 * Regression tests for the read-modify-write race in watchlist.mts
 * POST add/remove.
 *
 * Without CAS, two concurrent `add` calls for different subjects
 * both read the same `{entries: []}` snapshot, each push their own
 * entry, and the second setJSON silently overwrites the first
 * subject. This is an FDL Art.24 audit-chain gap: watchlist
 * membership is regulatory data; a silently dropped entry is a
 * compliance failure.
 *
 * These tests drive the function through a fake Netlify Blobs
 * store that scripts CAS etag evolution deterministically.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

interface FakeEntry { value: unknown; etag: string }
let watchlistData: Map<string, FakeEntry>;
let etagCounter = 0;
let setJsonCalls = 0;
let beforeFirstWrite: (() => void) | null = null;

vi.mock('@netlify/blobs', () => ({
  getStore: () => ({
    async get(key: string) {
      return watchlistData.get(key)?.value ?? null;
    },
    async getWithMetadata(key: string) {
      const v = watchlistData.get(key);
      if (!v) return null;
      return { data: v.value, etag: v.etag };
    },
    async setJSON(key: string, value: unknown, opts: any) {
      setJsonCalls++;
      if (beforeFirstWrite && setJsonCalls === 1) {
        const hook = beforeFirstWrite;
        beforeFirstWrite = null;
        hook();
      }
      const existing = watchlistData.get(key);
      if (opts?.onlyIfMatch) {
        if (!existing || existing.etag !== opts.onlyIfMatch) {
          return { modified: false };
        }
      }
      if (opts?.onlyIfNew) {
        if (existing) return { modified: false };
      }
      const etag = 'etag-' + ++etagCounter;
      watchlistData.set(key, { value, etag });
      return { modified: true, etag };
    },
    async delete(key: string) { watchlistData.delete(key); },
    async list() { return { blobs: [] }; },
  }),
}));

// Bypass auth + rate-limit — we are testing the CAS path only.
vi.mock('../netlify/functions/middleware/auth.mts', () => ({
  authenticate: () => ({ ok: true, userId: 'test-user' }),
}));
vi.mock('../netlify/functions/middleware/rate-limit.mts', () => ({
  checkRateLimit: async () => null,
}));

beforeEach(() => {
  watchlistData = new Map();
  etagCounter = 0;
  setJsonCalls = 0;
  beforeFirstWrite = null;
});

afterEach(() => { vi.resetModules(); });

async function freshModule() {
  return await import('../netlify/functions/watchlist.mts?t=' + Date.now());
}

async function postAction(body: unknown): Promise<Response> {
  const mod = await freshModule();
  const req = new Request('https://example.test/api/watchlist', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + 'a'.repeat(40),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return (mod.default as any)(req, { ip: '127.0.0.1' });
}

describe('watchlist — concurrent add retains all subjects', () => {
  it('preserves a concurrent writer when our CAS conflicts', async () => {
    // Seed: one entry (alice) at etag-1.
    watchlistData.set('current', {
      value: {
        version: 1,
        entries: [{ id: 'alice', subjectName: 'Alice', riskTier: 'high' }],
      },
      etag: 'etag-1',
    });
    etagCounter = 1;

    // Between our read of `{alice}` at etag-1 and our setJSON,
    // another writer adds charlie and bumps etag to etag-99.
    beforeFirstWrite = () => {
      watchlistData.set('current', {
        value: {
          version: 1,
          entries: [
            { id: 'alice', subjectName: 'Alice', riskTier: 'high' },
            { id: 'charlie', subjectName: 'Charlie', riskTier: 'medium' },
          ],
        },
        etag: 'etag-99',
      });
    };

    // We add bob.
    const res = await postAction({
      action: 'add', id: 'bob', subjectName: 'Bob', riskTier: 'low',
    });
    expect(res.status).toBe(200);

    const finalEntries = (watchlistData.get('current')!.value as any).entries;
    const ids = finalEntries.map((e: { id: string }) => e.id).sort();
    expect(ids).toEqual(['alice', 'bob', 'charlie']); // all three survive
    expect(setJsonCalls).toBe(2); // one conflict + one success
  });

  it('returns 503 when every CAS attempt loses', async () => {
    watchlistData.set('current', {
      value: { version: 1, entries: [] },
      etag: 'etag-seed',
    });
    // Every read returns a fresh etag so every CAS attempt fails.
    let rev = 0;
    vi.mocked({} as any); // noop
    const origGet = watchlistData.get.bind(watchlistData);
    (watchlistData as any).get = (k: string) => {
      const v = origGet(k);
      if (v) {
        v.etag = 'etag-' + ++rev;
        watchlistData.set(k, v);
      }
      return v;
    };

    const res = await postAction({
      action: 'add', id: 'x', subjectName: 'X', riskTier: 'low',
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('watchlist_write_contention');
  });

  it('single-writer happy path still works', async () => {
    const res = await postAction({
      action: 'add', id: 'only', subjectName: 'Only', riskTier: 'low',
    });
    expect(res.status).toBe(200);
    const entries = (watchlistData.get('current')!.value as any).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('only');
  });
});

describe('watchlist — concurrent remove preserves a concurrent add', () => {
  it('re-applies remove on top of a concurrent writer', async () => {
    // Seed: alice and bob, etag-1.
    watchlistData.set('current', {
      value: {
        version: 1,
        entries: [
          { id: 'alice', subjectName: 'Alice', riskTier: 'high' },
          { id: 'bob', subjectName: 'Bob', riskTier: 'medium' },
        ],
      },
      etag: 'etag-1',
    });
    etagCounter = 1;

    // Before our remove lands, a concurrent writer adds charlie.
    beforeFirstWrite = () => {
      watchlistData.set('current', {
        value: {
          version: 1,
          entries: [
            { id: 'alice', subjectName: 'Alice', riskTier: 'high' },
            { id: 'bob', subjectName: 'Bob', riskTier: 'medium' },
            { id: 'charlie', subjectName: 'Charlie', riskTier: 'low' },
          ],
        },
        etag: 'etag-99',
      });
    };

    // We remove alice.
    const res = await postAction({ action: 'remove', id: 'alice' });
    expect(res.status).toBe(200);

    const finalEntries = (watchlistData.get('current')!.value as any).entries;
    const ids = finalEntries.map((e: { id: string }) => e.id).sort();
    expect(ids).toEqual(['bob', 'charlie']); // alice removed, charlie preserved
  });
});
