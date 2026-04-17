/**
 * Regression tests for the read-modify-write race in auth.mts
 * `recordFailedAttempt`.
 *
 * Without CAS, N concurrent failed logins against the same username
 * all read the lockout record with `count: 0`, each increment to 1,
 * and all write `count: 1`. The MAX_FAILED_ATTEMPTS=5 threshold
 * therefore becomes `5 * concurrency` in practice before the lockout
 * fires — which is exactly the gap a credential-stuffing attacker
 * is trying to exploit.
 *
 * The fix wraps the read-modify-write in a CAS retry loop using
 * Netlify Blobs `getWithMetadata` + `setJSON({ onlyIfMatch })`.
 * These tests drive `recordFailedAttempt` through a fake blob store
 * that scripts etag evolution so we can reproduce the race
 * deterministically.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

interface FakeEntry { value: unknown; etag: string }
let lockoutData: Map<string, FakeEntry>;
let auditLogs: unknown[];
let etagCounter = 0;
let setJsonCalls = 0;

vi.mock('@netlify/blobs', () => ({
  getStore: (name: string) => {
    // Two stores matter: LOCKOUT_STORE and the audit log store. We
    // back both by the same map/array for simplicity.
    if (name === 'auth-lockouts') {
      return {
        async get(key: string) {
          return lockoutData.get(key)?.value ?? null;
        },
        async getWithMetadata(key: string) {
          const v = lockoutData.get(key);
          if (!v) return null;
          return { data: v.value, etag: v.etag };
        },
        async setJSON(key: string, value: unknown, opts: any) {
          setJsonCalls++;
          const existing = lockoutData.get(key);
          if (opts?.onlyIfMatch) {
            if (!existing || existing.etag !== opts.onlyIfMatch) {
              return { modified: false };
            }
          }
          if (opts?.onlyIfNew) {
            if (existing) return { modified: false };
          }
          const etag = 'etag-' + ++etagCounter;
          lockoutData.set(key, { value, etag });
          return { modified: true, etag };
        },
        async delete(key: string) { lockoutData.delete(key); },
      };
    }
    // Any other store (audit log) — no-op writes.
    return {
      async setJSON(_k: string, v: unknown) {
        auditLogs.push(v);
        return { modified: true, etag: 'x' };
      },
      async get() { return null; },
      async delete() {},
    };
  },
}));

beforeEach(() => {
  lockoutData = new Map();
  auditLogs = [];
  etagCounter = 0;
  setJsonCalls = 0;
});

afterEach(() => {
  vi.resetModules();
});

async function freshModule() {
  return await import('../netlify/functions/auth.mts?t=' + Date.now());
}

describe('recordFailedAttempt — CAS prevents lost-update race', () => {
  it('increments the counter by exactly N when N failures race', async () => {
    const { __test__ } = await freshModule();
    // Simulate 5 concurrent failed logins for the same username.
    await Promise.all(
      Array.from({ length: 5 }, () => __test__.recordFailedAttempt('victim', '1.2.3.4')),
    );
    const final = await __test__.getLockout('victim');
    expect(final).not.toBeNull();
    expect(final!.count).toBe(5);
    // Must have locked out (5 >= MAX_FAILED_ATTEMPTS).
    expect(final!.lockedUntil).toBeGreaterThan(Date.now());
    // Exactly one 'account_locked' event, regardless of how many
    // concurrent threads observed the count hitting the threshold.
    const lockEvents = auditLogs.filter((l: any) => l?.event === 'account_locked');
    expect(lockEvents.length).toBe(1);
  });

  it('preserves the existing lockedUntil across re-reads', async () => {
    const { __test__ } = await freshModule();
    // First failure.
    await __test__.recordFailedAttempt('target', 'ip');
    const after1 = await __test__.getLockout('target');
    expect(after1!.count).toBe(1);
    // Bump to MAX directly (simulating 4 more failures, not racing).
    await __test__.recordFailedAttempt('target', 'ip');
    await __test__.recordFailedAttempt('target', 'ip');
    await __test__.recordFailedAttempt('target', 'ip');
    await __test__.recordFailedAttempt('target', 'ip');
    const locked = await __test__.getLockout('target');
    expect(locked!.count).toBe(5);
    const firstLockedUntil = locked!.lockedUntil!;
    // Another failure while already locked must NOT bump the
    // lockedUntil forward (which would let an attacker extend the
    // lockout window by spamming; we want the window fixed on the
    // first transition).
    await new Promise((r) => setTimeout(r, 5));
    await __test__.recordFailedAttempt('target', 'ip');
    const still = await __test__.getLockout('target');
    expect(still!.count).toBe(6);
    expect(still!.lockedUntil).toBe(firstLockedUntil);
  });

  it('retries on CAS conflict and eventually records the vote', async () => {
    const { __test__ } = await freshModule();
    // Inject a conflict for the first attempt by tracking setJSON
    // calls and pre-bumping the etag between the read and the first
    // write. Easiest: race two sequential increments via Promise.all.
    await Promise.all([
      __test__.recordFailedAttempt('u1', 'ip1'),
      __test__.recordFailedAttempt('u1', 'ip2'),
      __test__.recordFailedAttempt('u1', 'ip3'),
    ]);
    const final = await __test__.getLockout('u1');
    expect(final!.count).toBe(3);
    // setJSON was called at least 3 times; CAS retries may have
    // added more. Either way, the counter is exact.
    expect(setJsonCalls).toBeGreaterThanOrEqual(3);
  });
});
