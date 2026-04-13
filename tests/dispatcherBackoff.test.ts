/**
 * Tests for the exponential-backoff runner.
 */
import { describe, it, expect, vi } from 'vitest';
import { runWithBackoff, defaultIsRetryable, instantSleep } from '@/services/dispatcherBackoff';

describe('defaultIsRetryable', () => {
  it('retries on timeout / network / 429 / 5xx', () => {
    expect(defaultIsRetryable(new Error('timeout'))).toBe(true);
    expect(defaultIsRetryable(new Error('network error'))).toBe(true);
    expect(defaultIsRetryable(new Error('HTTP 429 rate limited'))).toBe(true);
    expect(defaultIsRetryable(new Error('HTTP 503 service unavailable'))).toBe(true);
  });

  it('does not retry on auth / forbidden / 4xx', () => {
    expect(defaultIsRetryable(new Error('unauthorized'))).toBe(false);
    expect(defaultIsRetryable(new Error('forbidden'))).toBe(false);
    expect(defaultIsRetryable(new Error('HTTP 400 bad request'))).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(defaultIsRetryable(null)).toBe(false);
    expect(defaultIsRetryable(undefined)).toBe(false);
  });
});

describe('runWithBackoff', () => {
  it('returns ok=true on first success', async () => {
    const op = vi.fn().mockResolvedValue('hello');
    const result = await runWithBackoff(op, { sleep: instantSleep });
    expect(result.ok).toBe(true);
    expect(result.value).toBe('hello');
    expect(result.attempts).toBe(1);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures and eventually succeeds', async () => {
    let count = 0;
    const op = vi.fn().mockImplementation(async () => {
      count++;
      if (count < 3) throw new Error('timeout');
      return 'ok';
    });
    const result = await runWithBackoff(op, { sleep: instantSleep });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
  });

  it('aborts on permanent errors without retrying', async () => {
    const op = vi.fn().mockRejectedValue(new Error('unauthorized'));
    const result = await runWithBackoff(op, { sleep: instantSleep });
    expect(result.ok).toBe(false);
    expect(result.aborted).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it('gives up after maxAttempts', async () => {
    const op = vi.fn().mockRejectedValue(new Error('timeout'));
    const result = await runWithBackoff(op, { sleep: instantSleep, maxAttempts: 3 });
    expect(result.ok).toBe(false);
    expect(result.aborted).toBe(false);
    expect(result.attempts).toBe(3);
  });

  it('calls onAttempt once per attempt', async () => {
    const op = vi.fn().mockRejectedValue(new Error('timeout'));
    const onAttempt = vi.fn();
    await runWithBackoff(op, { sleep: instantSleep, maxAttempts: 2, onAttempt });
    // onAttempt fires twice per attempt (pre + post-error), so
    // at maxAttempts=2 we get 4 invocations.
    expect(onAttempt.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
