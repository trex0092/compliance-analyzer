import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchWithTimeout, TimeoutError } from '../src/utils/fetchWithTimeout';

/**
 * Tests for the shared timeout wrapper.
 *
 * Scope:
 *   - Rejects a hung fetch with a TimeoutError carrying URL + duration
 *   - Does NOT time out when the fetch resolves under the budget
 *   - Propagates the caller's own AbortSignal (external cancellation
 *     wins, never misclassified as a timeout)
 *   - Rejects invalid timeout budgets fast (before the round trip)
 *
 * Implementation notes:
 *   - We stub the global `fetch` per test with a fake that returns a
 *     promise we control via `resolve` / `reject` so the test clock
 *     can race the timeout deterministically without a real TCP dial.
 *   - We do NOT use vi.useFakeTimers() here — the wrapper itself
 *     relies on real setTimeout + AbortController wiring, and faking
 *     time inside vitest has surprising interactions with
 *     AbortController's event dispatch. A 60ms real timer in a
 *     vitest test is cheap.
 */

interface StubFetchCall {
  input: RequestInfo | URL;
  init: RequestInit;
}

function stubFetch(): {
  calls: StubFetchCall[];
  resolve: (response: Response) => void;
  reject: (err: unknown) => void;
  wasAborted: () => boolean;
  restore: () => void;
} {
  const calls: StubFetchCall[] = [];
  let resolveInner: ((response: Response) => void) | null = null;
  let rejectInner: ((err: unknown) => void) | null = null;
  let capturedSignal: AbortSignal | null = null;

  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ input, init });
    capturedSignal = init.signal ?? null;
    return new Promise<Response>((res, rej) => {
      resolveInner = res;
      rejectInner = rej;
      if (capturedSignal) {
        const onAbort = (): void => {
          rej(
            Object.assign(new Error('aborted'), {
              name: 'AbortError',
            })
          );
        };
        if (capturedSignal.aborted) onAbort();
        else capturedSignal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }) as typeof fetch;

  return {
    calls,
    resolve: (r) => resolveInner?.(r),
    reject: (e) => rejectInner?.(e),
    wasAborted: () => capturedSignal?.aborted ?? false,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

describe('fetchWithTimeout', () => {
  let stub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    stub = stubFetch();
  });

  afterEach(() => {
    stub.restore();
    vi.restoreAllMocks();
  });

  it('resolves with the response when fetch completes under the budget', async () => {
    const promise = fetchWithTimeout('https://example.test/ok', { timeoutMs: 100 });
    stub.resolve(new Response('hello', { status: 200 }));
    const res = await promise;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello');
  });

  it('rejects with a TimeoutError when the budget elapses', async () => {
    const promise = fetchWithTimeout('https://example.test/slow', { timeoutMs: 40 });
    await expect(promise).rejects.toMatchObject({
      name: 'TimeoutError',
      url: 'https://example.test/slow',
      timeoutMs: 40,
    });
    expect(stub.wasAborted()).toBe(true);
  });

  it('TimeoutError carries both the configured budget and the elapsed time', async () => {
    try {
      await fetchWithTimeout('https://example.test/slow', { timeoutMs: 30 });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TimeoutError);
      const te = err as TimeoutError;
      expect(te.timeoutMs).toBe(30);
      expect(te.elapsedMs).toBeGreaterThanOrEqual(20);
      expect(te.url).toBe('https://example.test/slow');
      expect(te.message).toContain('https://example.test/slow');
    }
  });

  it('propagates the caller AbortSignal (caller abort is NOT reclassified as timeout)', async () => {
    const controller = new AbortController();
    const promise = fetchWithTimeout('https://example.test/cancel', {
      timeoutMs: 10_000,
      signal: controller.signal,
    });
    controller.abort(new Error('caller cancelled'));
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    // Timeout never fired; this was a caller-initiated cancel.
    // TimeoutError is deliberately NOT thrown in this path.
    expect(stub.wasAborted()).toBe(true);
  });

  it('forwards method, headers, and body to the underlying fetch', async () => {
    const promise = fetchWithTimeout('https://example.test/post', {
      method: 'POST',
      headers: { 'X-Trace': 'abc' },
      body: '{"k":"v"}',
      timeoutMs: 100,
    });
    stub.resolve(new Response(null, { status: 204 }));
    await promise;
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].init.method).toBe('POST');
    expect((stub.calls[0].init.headers as Record<string, string>)['X-Trace']).toBe('abc');
    expect(stub.calls[0].init.body).toBe('{"k":"v"}');
  });

  it('rejects fast when timeoutMs is not a positive finite number', async () => {
    await expect(
      fetchWithTimeout('https://example.test/x', { timeoutMs: 0 })
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      fetchWithTimeout('https://example.test/x', { timeoutMs: -5 })
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      fetchWithTimeout('https://example.test/x', {
        timeoutMs: Number.POSITIVE_INFINITY,
      })
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      fetchWithTimeout('https://example.test/x', { timeoutMs: Number.NaN })
    ).rejects.toBeInstanceOf(TypeError);
    // None of these should have reached the underlying fetch.
    expect(stub.calls).toHaveLength(0);
  });

  it('re-throws underlying non-timeout errors unchanged', async () => {
    const promise = fetchWithTimeout('https://example.test/boom', { timeoutMs: 1000 });
    stub.reject(new Error('ECONNREFUSED'));
    await expect(promise).rejects.toThrow('ECONNREFUSED');
  });

  it('accepts a URL object as input and preserves it on TimeoutError', async () => {
    const u = new URL('https://example.test/url-object');
    try {
      await fetchWithTimeout(u, { timeoutMs: 20 });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TimeoutError);
      expect((err as TimeoutError).url).toBe('https://example.test/url-object');
    }
  });
});
