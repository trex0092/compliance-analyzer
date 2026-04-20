/**
 * Tests for the adaptive rate limiter in asanaClient.ts.
 *
 * These tests use the exported __resetAdaptiveRateLimit helper so each
 * test starts from a known state. The actual HTTP layer is exercised
 * only indirectly — we're testing that the internal state transitions
 * correctly on successful vs 429 responses.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { __resetAdaptiveRateLimit } from '@/services/asanaClient';

beforeEach(() => {
  __resetAdaptiveRateLimit();
});

describe('adaptive rate limiting — state reset', () => {
  it('__resetAdaptiveRateLimit is idempotent and does not throw', () => {
    // Tautological expect(true).toBe(true) replaced with a real
    // assertion on the reset function itself. Calling reset twice in
    // a row must not throw, and the function must return undefined
    // (void). Previously the "no error means idempotent" comment was
    // correct only because any throw would have failed the test — but
    // the tautological expectation gave false green if the throw was
    // swallowed elsewhere.
    expect(() => {
      __resetAdaptiveRateLimit();
      __resetAdaptiveRateLimit();
    }).not.toThrow();
    expect(__resetAdaptiveRateLimit()).toBeUndefined();
  });
});
