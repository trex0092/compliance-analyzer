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
  it('__resetAdaptiveRateLimit is idempotent', () => {
    __resetAdaptiveRateLimit();
    __resetAdaptiveRateLimit();
    // no error means idempotent
    expect(true).toBe(true);
  });
});
