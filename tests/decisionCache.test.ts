import { describe, it, expect } from 'vitest';
import { DecisionCache, decisionKey } from '@/services/decisionCache';

describe('decisionCache — keys', () => {
  it('same features + same policy version → same key', async () => {
    const a = await decisionKey({ a: 1, b: 'x' }, 'v1');
    const b = await decisionKey({ b: 'x', a: 1 }, 'v1'); // key order swapped
    expect(a).toBe(b);
  });

  it('different policy version → different key', async () => {
    const a = await decisionKey({ x: 1 }, 'v1');
    const b = await decisionKey({ x: 1 }, 'v2');
    expect(a).not.toBe(b);
  });
});

describe('decisionCache — get/set', () => {
  it('hit on second lookup', async () => {
    const cache = new DecisionCache<string>({ policyVersion: 'v1' });
    await cache.set({ a: 1 }, 'decision-A');
    const v = await cache.get({ a: 1 });
    expect(v).toBe('decision-A');
    expect(cache.stats().hits).toBe(1);
    expect(cache.stats().size).toBe(1);
  });

  it('miss on different features', async () => {
    const cache = new DecisionCache<string>({ policyVersion: 'v1' });
    await cache.set({ a: 1 }, 'decision-A');
    const v = await cache.get({ a: 2 });
    expect(v).toBeUndefined();
    expect(cache.stats().misses).toBe(1);
  });

  it('TTL expires entries', async () => {
    let now = 1000;
    const cache = new DecisionCache<string>({
      policyVersion: 'v1',
      ttlMs: 500,
      now: () => now,
    });
    await cache.set({ a: 1 }, 'x');
    now = 2000;
    const v = await cache.get({ a: 1 });
    expect(v).toBeUndefined();
  });

  it('size cap evicts oldest', async () => {
    const cache = new DecisionCache<number>({ policyVersion: 'v1', maxEntries: 3 });
    for (let i = 0; i < 5; i++) await cache.set({ i }, i);
    expect(cache.stats().size).toBe(3);
    expect(cache.stats().evictions).toBe(2);
  });
});

describe('decisionCache — getOrCompute', () => {
  it('computes on miss, caches on hit', async () => {
    const cache = new DecisionCache<number>({ policyVersion: 'v1' });
    let computed = 0;
    const compute = () => {
      computed++;
      return 42;
    };
    const a = await cache.getOrCompute({ a: 1 }, compute);
    const b = await cache.getOrCompute({ a: 1 }, compute);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(computed).toBe(1);
  });

  it('invalidate clears the cache', async () => {
    const cache = new DecisionCache<number>({ policyVersion: 'v1' });
    await cache.set({ a: 1 }, 1);
    cache.invalidate();
    expect(cache.stats().size).toBe(0);
  });
});
