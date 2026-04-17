/**
 * Regression tests for the CAS-conflict detection in the persistent
 * rate-limit middleware (netlify/functions/middleware/rate-limit.mts).
 *
 * Previous bug: @netlify/blobs `setJSON(..., { onlyIfMatch })` returns
 * `{ modified: false }` when the CAS precondition fails, instead of
 * throwing. The middleware's helper checked `ok !== false`, which
 * treats the `{ modified: false }` object as truthy and hence as a
 * successful write. The CAS retry loop therefore exited on the first
 * attempt even when the write did not persist — so two lambdas
 * racing to update the same rate-limit counter could each decide
 * they had written `count=5`, and only one of the two `count++`
 * increments actually landed. Attackers could exceed the documented
 * rate.
 *
 * The fix inspects `ok?.modified` and only returns success when the
 * SDK reports `modified: true` (or when a legacy SDK returns
 * `undefined`). These tests exercise both branches without touching
 * the real Netlify Blobs service.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

interface StubStore {
  getWithMetadata: (key: string, opts: unknown) => Promise<unknown>;
  setJSON: (key: string, value: unknown, opts: unknown) => Promise<unknown>;
}

let stubStore: StubStore;
vi.mock('@netlify/blobs', () => ({
  getStore: () => stubStore,
}));

async function callCheckRateLimit(clientIp = '1.2.3.4') {
  // Import fresh each call so the module-level `memoryStore` in the
  // middleware starts empty for every test.
  const mod = await import(
    '../netlify/functions/middleware/rate-limit.mts?t=' + Date.now()
  );
  const req = new Request('https://example.test/x', { method: 'POST' });
  return mod.checkRateLimit(req, {
    clientIp, namespace: 'test-ns', max: 10, windowMs: 60_000,
  });
}

beforeEach(() => {
  // Default stub — in-memory, no CAS conflicts.
  const data = new Map<string, { entry: unknown; etag: string }>();
  let etagCounter = 0;
  stubStore = {
    async getWithMetadata(key) {
      const v = data.get(key);
      if (!v) return null;
      return { data: v.entry, etag: v.etag };
    },
    async setJSON(key, value, opts: any) {
      // Mimic the modern SDK: enforce onlyIfMatch; return
      // { modified: true/false, etag }.
      const existing = data.get(key);
      if (opts?.onlyIfMatch) {
        if (!existing || existing.etag !== opts.onlyIfMatch) {
          return { modified: false };
        }
      }
      if (opts?.onlyIfNew) {
        if (existing) return { modified: false };
      }
      const etag = 'etag-' + ++etagCounter;
      data.set(key, { entry: value, etag });
      return { modified: true, etag };
    },
  };
});

afterEach(() => {
  vi.resetModules();
});

describe('rate-limit — CAS success path', () => {
  it('passes requests under the limit', async () => {
    const r1 = await callCheckRateLimit();
    expect(r1).toBeNull();
    const r2 = await callCheckRateLimit();
    expect(r2).toBeNull();
  });
});

describe('rate-limit — CAS conflict is detected and retried', () => {
  it('detects `{ modified: false }` as conflict and retries', async () => {
    // Arrange: wrap setJSON so the FIRST attempt returns modified:false
    // (simulating a concurrent writer). The retry should succeed.
    const data = new Map<string, { entry: unknown; etag: string }>();
    let callCount = 0;
    stubStore = {
      async getWithMetadata(key) {
        const v = data.get(key);
        if (!v) return null;
        return { data: v.entry, etag: v.etag };
      },
      async setJSON(key, value) {
        callCount++;
        if (callCount === 1) {
          // CAS conflict on first attempt.
          return { modified: false };
        }
        data.set(key, { entry: value, etag: 'etag-ok' });
        return { modified: true, etag: 'etag-ok' };
      },
    };

    const res = await callCheckRateLimit('9.9.9.9');
    expect(res).toBeNull(); // eventually allowed
    expect(callCount).toBeGreaterThan(1); // proved the retry ran
  });

  it('fails closed with 429 when CAS loses four times in a row', async () => {
    let callCount = 0;
    stubStore = {
      async getWithMetadata() {
        return { data: null, etag: null };
      },
      async setJSON() {
        callCount++;
        return { modified: false }; // always conflict
      },
    };

    const res = await callCheckRateLimit('8.8.8.8');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    // Must have attempted the configured 4 retries before giving up.
    expect(callCount).toBe(4);
  });
});

describe('rate-limit — legacy SDK compatibility (void return)', () => {
  it('treats `undefined` from setJSON as success', async () => {
    const data = new Map<string, { entry: unknown; etag: string }>();
    stubStore = {
      async getWithMetadata(key) {
        const v = data.get(key);
        return v ? { data: v.entry, etag: v.etag } : null;
      },
      async setJSON(key, value) {
        data.set(key, { entry: value, etag: 'legacy' });
        return undefined;
      },
    };
    const res = await callCheckRateLimit('7.7.7.7');
    expect(res).toBeNull();
  });
});
