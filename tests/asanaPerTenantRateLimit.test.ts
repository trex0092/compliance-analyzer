/**
 * Tests for asanaPerTenantRateLimit.ts — pure compute token bucket.
 * All time values are synthetic (ms since epoch) so tests are
 * deterministic without faking Date.now().
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIG,
  peekBucket,
  resetBucket,
  tryAcquire,
  type RateLimitOptions,
  type TenantBucketState,
} from '@/services/asanaPerTenantRateLimit';

function makeState(): Map<string, TenantBucketState> {
  return new Map();
}

describe('tryAcquire — initial burst', () => {
  it('new tenant starts with a full burst', () => {
    const state = makeState();
    const t0 = 1_000_000;
    const out = tryAcquire('madison-llc', state, t0);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.tokensRemaining).toBe(DEFAULT_CONFIG.burst - 1);
  });

  it('ten rapid calls at t0 all succeed (burst = 10)', () => {
    const state = makeState();
    for (let i = 0; i < 10; i++) {
      const out = tryAcquire('madison-llc', state, 1_000_000);
      expect(out.ok).toBe(true);
    }
  });

  it('eleventh call at t0 is rejected with retry-after', () => {
    const state = makeState();
    for (let i = 0; i < 10; i++) tryAcquire('madison-llc', state, 1_000_000);
    const out = tryAcquire('madison-llc', state, 1_000_000);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      // Refill at 1 token/second means we need 1000ms to get 1 token.
      expect(out.retryAfterMs).toBe(1000);
      expect(out.neededTokens).toBe(1);
      expect(out.tokensAvailable).toBe(0);
    }
  });
});

describe('tryAcquire — refill behaviour', () => {
  it('tokens refill at the configured rate', () => {
    const state = makeState();
    const t0 = 1_000_000;
    // Drain.
    for (let i = 0; i < 10; i++) tryAcquire('madison-llc', state, t0);
    // 5 seconds later → 5 tokens refilled.
    const out = tryAcquire('madison-llc', state, t0 + 5_000);
    expect(out.ok).toBe(true);
    if (out.ok) {
      // 5 refilled minus 1 consumed = 4 remaining.
      expect(out.tokensRemaining).toBeCloseTo(4, 5);
    }
  });

  it('refill is capped at burst size', () => {
    const state = makeState();
    const t0 = 1_000_000;
    // Drain.
    for (let i = 0; i < 10; i++) tryAcquire('madison-llc', state, t0);
    // One hour later — bucket should be capped at burst, not 3600 tokens.
    const out = tryAcquire('madison-llc', state, t0 + 3_600_000);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.tokensRemaining).toBeCloseTo(DEFAULT_CONFIG.burst - 1, 5);
    }
  });

  it('peek does not consume a token', () => {
    const state = makeState();
    const t0 = 1_000_000;
    tryAcquire('madison-llc', state, t0); // 9 left
    const peek1 = peekBucket('madison-llc', state, t0);
    const peek2 = peekBucket('madison-llc', state, t0);
    expect(peek1.tokens).toBeCloseTo(9, 5);
    expect(peek2.tokens).toBeCloseTo(9, 5);
    expect(peek1.burst).toBe(DEFAULT_CONFIG.burst);
  });
});

describe('tryAcquire — per-tenant isolation', () => {
  it('one tenant draining its bucket does not affect another', () => {
    const state = makeState();
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) tryAcquire('tenant-a', state, t0);
    // tenant-a is drained.
    const a = tryAcquire('tenant-a', state, t0);
    expect(a.ok).toBe(false);
    // tenant-b has a full burst.
    const b = tryAcquire('tenant-b', state, t0);
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.tokensRemaining).toBe(DEFAULT_CONFIG.burst - 1);
  });

  it('per-tenant overrides let premium tenants burst higher', () => {
    const state = makeState();
    const t0 = 1_000_000;
    const options: RateLimitOptions = {
      tenantOverrides: {
        'premium-tenant': { refillPerSecond: 5, burst: 50 },
      },
    };
    // 50 rapid calls should succeed for premium tenant.
    for (let i = 0; i < 50; i++) {
      const out = tryAcquire('premium-tenant', state, t0, options);
      expect(out.ok).toBe(true);
    }
    // 51st should fail.
    const over = tryAcquire('premium-tenant', state, t0, options);
    expect(over.ok).toBe(false);
  });

  it('default config override applies to untracked tenants', () => {
    const state = makeState();
    const options: RateLimitOptions = {
      defaultConfig: { refillPerSecond: 2, burst: 3 },
    };
    // Burst of 3 — 3 calls succeed.
    for (let i = 0; i < 3; i++) {
      const out = tryAcquire('new-tenant', state, 1_000_000, options);
      expect(out.ok).toBe(true);
    }
    const over = tryAcquire('new-tenant', state, 1_000_000, options);
    expect(over.ok).toBe(false);
    if (!over.ok) {
      // refill 2/sec → 500ms to get 1 token.
      expect(over.retryAfterMs).toBe(500);
    }
  });
});

describe('tryAcquire — idempotency of rejection', () => {
  it('rejection does not decrement the bucket', () => {
    const state = makeState();
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) tryAcquire('tenant-a', state, t0);
    const peekBeforeReject = peekBucket('tenant-a', state, t0);
    const reject1 = tryAcquire('tenant-a', state, t0);
    const reject2 = tryAcquire('tenant-a', state, t0);
    const reject3 = tryAcquire('tenant-a', state, t0);
    const peekAfterReject = peekBucket('tenant-a', state, t0);
    expect(reject1.ok).toBe(false);
    expect(reject2.ok).toBe(false);
    expect(reject3.ok).toBe(false);
    // Three rejections did not make the bucket more negative.
    expect(peekAfterReject.tokens).toBeCloseTo(peekBeforeReject.tokens, 5);
  });
});

describe('resetBucket', () => {
  it('resets a tenant to an unconfigured state (full burst on next call)', () => {
    const state = makeState();
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) tryAcquire('tenant-a', state, t0);
    const peekBefore = peekBucket('tenant-a', state, t0);
    expect(peekBefore.tokens).toBeCloseTo(0, 5);
    resetBucket('tenant-a', state);
    // After reset, peek reports a full burst again.
    const peekAfter = peekBucket('tenant-a', state, t0);
    expect(peekAfter.tokens).toBe(DEFAULT_CONFIG.burst);
    // And the next acquire succeeds.
    const out = tryAcquire('tenant-a', state, t0);
    expect(out.ok).toBe(true);
  });
});

describe('DEFAULT_CONFIG', () => {
  it('matches the Phase 19 spec (1/sec, burst 10)', () => {
    expect(DEFAULT_CONFIG.refillPerSecond).toBe(1);
    expect(DEFAULT_CONFIG.burst).toBe(10);
  });

  it('is frozen to prevent runtime mutation', () => {
    expect(Object.isFrozen(DEFAULT_CONFIG)).toBe(true);
  });
});
