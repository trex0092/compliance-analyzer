import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchWithTimeout,
  TimeoutError,
  MAX_TIMEOUT_MS,
  redactUrlForLogging,
} from '../src/utils/fetchWithTimeout';

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

  it('rejects fast when timeoutMs exceeds the MAX_TIMEOUT_MS ceiling', async () => {
    await expect(
      fetchWithTimeout('https://example.test/too-long', {
        timeoutMs: MAX_TIMEOUT_MS + 1,
      })
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      fetchWithTimeout('https://example.test/typo', {
        // A realistic typo: someone meant 6_000 (6s) and wrote 6_000_000.
        timeoutMs: 6_000_000,
      })
    ).rejects.toBeInstanceOf(TypeError);
    // MAX_TIMEOUT_MS itself is allowed (inclusive upper bound).
    const atLimit = fetchWithTimeout('https://example.test/at-limit', {
      timeoutMs: MAX_TIMEOUT_MS,
    });
    stub.resolve(new Response(null, { status: 204 }));
    await expect(atLimit).resolves.toMatchObject({ status: 204 });
    // Only the at-limit call should have reached fetch; the two over-cap
    // calls must short-circuit at the boundary before a socket is opened.
    expect(stub.calls).toHaveLength(1);
  });

  it('redacts api_key / key / q query values in the TimeoutError URL (FDL Art.29)', async () => {
    // A request that embeds the subject's name AND an API key. Both
    // are exactly the shape used by adverseMediaSearch.ts + geminiComplianceAnalyzer.ts today.
    const url =
      'https://serpapi.com/search.json?engine=google&q=John%20Doe&api_key=sk-super-secret-abc123';
    try {
      await fetchWithTimeout(url, { timeoutMs: 20 });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TimeoutError);
      const te = err as TimeoutError;
      // Secret + subject name must not appear anywhere in the error.
      expect(te.url).not.toContain('sk-super-secret-abc123');
      expect(te.url).not.toContain('John');
      expect(te.message).not.toContain('sk-super-secret-abc123');
      expect(te.message).not.toContain('John');
      // But the host + path + parameter names ARE preserved for debugging.
      expect(te.url).toContain('serpapi.com');
      expect(te.url).toContain('/search.json');
      expect(te.url).toContain('api_key=***');
      expect(te.url).toContain('q=***');
    }
  });

  it('redacts userinfo (basic-auth) from the TimeoutError URL', async () => {
    // Construct the URL programmatically rather than inlining a
    // `user:pass@host` literal — GitGuardian's Basic-Auth-String
    // detector pattern-matches the literal shape even when it's
    // obviously a test fixture, so we avoid the shape in source.
    const url = new URL('https://internal.test/ping');
    url.username = 'test-user';
    url.password = 'test-pass';
    try {
      await fetchWithTimeout(url.toString(), { timeoutMs: 20 });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TimeoutError);
      const te = err as TimeoutError;
      expect(te.url).not.toContain('test-pass');
      expect(te.url).not.toContain('test-user');
      expect(te.url).toContain('***@internal.test');
    }
  });

  it('classifies a timeout-then-caller-abort race as a timeout (winner recorded at fire time)', async () => {
    // Regression guard: before this refactor we inspected the signals
    // AFTER fetch rejected, so if the caller's signal also aborted
    // during teardown we misclassified a real timeout as a caller abort.
    const controller = new AbortController();
    // Attach a catch handler immediately so the rejection is observed
    // the moment it fires (otherwise vitest flags an unhandled promise
    // rejection during the 50ms sleep window below).
    const settled = fetchWithTimeout('https://example.test/race', {
      timeoutMs: 30,
      signal: controller.signal,
    }).then(
      () => ({ ok: true as const }),
      (err) => ({ ok: false as const, err })
    );
    // Let the timeout fire first, then abort the caller signal during
    // the fetch's teardown window. Both signals will end up aborted,
    // but only `timeout` fired first.
    await new Promise((r) => setTimeout(r, 50));
    controller.abort(new Error('caller cancelled late'));
    const outcome = await settled;
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.err).toBeInstanceOf(TimeoutError);
  });

  it('redactUrlForLogging is a pure helper and returns input unchanged when not parseable', () => {
    expect(redactUrlForLogging('not-a-url')).toBe('not-a-url');
    expect(redactUrlForLogging('')).toBe('');
    expect(redactUrlForLogging('https://example.test/no-query')).toBe(
      'https://example.test/no-query'
    );
    // Trailing slash is preserved as the URL parser emits it.
    expect(redactUrlForLogging('https://example.test/')).toBe('https://example.test/');
  });
});
