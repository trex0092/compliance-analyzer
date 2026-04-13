/**
 * Tests for the toast stream poller client.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  pollToastStreamOnce,
  __resetToastStreamPollerForTests,
} from '@/services/toastStreamPoller';

beforeEach(() => {
  __resetToastStreamPollerForTests();
  // Polyfill localStorage for the toast buffer writes.
  const storage = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
    key: (i: number) => Array.from(storage.keys())[i] ?? null,
    get length() {
      return storage.size;
    },
  } as unknown as Storage;
});

describe('pollToastStreamOnce', () => {
  it('returns no-token error when token is missing', async () => {
    const result = await pollToastStreamOnce({
      getToken: () => undefined,
      fetchFn: vi.fn() as unknown as typeof fetch,
    });
    expect(result.error).toBe('no-token');
    expect(result.drained).toBe(0);
  });

  it('drains events and pushes them to the buffer', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        events: [
          {
            id: 't1',
            kind: 'asana_comment',
            severity: 'info',
            title: 'Comment',
            body: 'body',
            atIso: '2026-04-13T12:00:00.000Z',
          },
          {
            id: 't2',
            kind: 'asana_mention',
            severity: 'warning',
            title: 'Mention',
            body: 'you were mentioned',
            atIso: '2026-04-13T12:01:00.000Z',
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const result = await pollToastStreamOnce({
      getToken: () => 'secret',
      fetchFn,
    });
    expect(result.drained).toBe(2);
    expect(result.events).toHaveLength(2);
  });

  it('reports HTTP error when the endpoint returns non-2xx', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const result = await pollToastStreamOnce({
      getToken: () => 'bad-token',
      fetchFn,
    });
    expect(result.error).toBe('HTTP 401');
  });

  it('handles fetch throwing', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('network boom');
    }) as unknown as typeof fetch;
    const result = await pollToastStreamOnce({
      getToken: () => 'secret',
      fetchFn,
    });
    expect(result.drained).toBe(0);
    expect(result.error).toContain('network');
  });

  it('sends the Authorization header as a Bearer token', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ events: [] }),
    })) as unknown as typeof fetch;
    await pollToastStreamOnce({
      getToken: () => 'my-token',
      fetchFn,
    });
    const call = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer my-token');
  });
});
