/**
 * Security regression tests for the asana-proxy Netlify function.
 *
 * Catches the path-normalisation bypass where `/tasks/..` (or its
 * URL-encoded form `/tasks/%2e%2e`) passed the `/^\/tasks\/[^/]+$/`
 * allowlist regex because `..` is non-slash, but then got collapsed
 * by `new URL()` into `/api/1.0/` — a pathname that was never
 * allowlisted. The proxy would then happily forward the request to
 * Asana.
 *
 * The fix refuses any literal `..` or `%2e%2e` sequence in the path,
 * and also verifies that `new URL()` did not change the pathname
 * before forwarding. These tests assert both defences, plus the
 * happy path, without ever letting a real Asana fetch occur.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const AUTH_TOKEN = 'a'.repeat(32);
const ASANA_TOKEN = 'b'.repeat(40);

const fetchCalls: Array<{ url: string; method: string }> = [];

beforeEach(() => {
  fetchCalls.length = 0;
  process.env.HAWKEYE_BRAIN_TOKEN = AUTH_TOKEN;
  process.env.ASANA_API_TOKEN = ASANA_TOKEN;
  // Any upstream fetch succeeds with an empty data envelope. If the
  // defence is broken and we forward a rejected path, the fetchCalls
  // array will capture it and the assertion will fail.
  vi.stubGlobal('fetch', async (url: string | URL, init: RequestInit = {}) => {
    fetchCalls.push({
      url: typeof url === 'string' ? url : url.toString(),
      method: init.method ?? 'GET',
    });
    return {
      ok: true, status: 200,
      async text() { return '{"data":{}}'; },
    };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.HAWKEYE_BRAIN_TOKEN;
  delete process.env.ASANA_API_TOKEN;
});

async function callProxy(body: unknown): Promise<Response> {
  const mod = await import('../netlify/functions/asana-proxy.mts?t=' + Date.now());
  const handler = (mod as unknown as { default: (req: Request, ctx: unknown) => Promise<Response> }).default;
  const req = new Request('https://example.test/api/asana/proxy', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return handler(req, { ip: '127.0.0.1' });
}

describe('asana-proxy — path normalisation bypass defences', () => {
  it('rejects /tasks/.. before forwarding', async () => {
    const res = await callProxy({ method: 'GET', path: '/tasks/..' });
    expect(res.status).toBe(400);
    expect(fetchCalls.length).toBe(0);
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain('parent-directory');
  });

  it('rejects URL-encoded dot-dot /tasks/%2e%2e', async () => {
    const res = await callProxy({ method: 'GET', path: '/tasks/%2e%2e' });
    expect(res.status).toBe(400);
    expect(fetchCalls.length).toBe(0);
  });

  it('rejects a mixed-encoding dot-dot /tasks/.%2e', async () => {
    const res = await callProxy({ method: 'GET', path: '/tasks/.%2e' });
    expect(res.status).toBe(400);
    expect(fetchCalls.length).toBe(0);
  });

  it('rejects uppercase encoded /tasks/%2E%2E', async () => {
    const res = await callProxy({ method: 'GET', path: '/tasks/%2E%2E' });
    expect(res.status).toBe(400);
    expect(fetchCalls.length).toBe(0);
  });

  it('still allows a legitimate task GET', async () => {
    const res = await callProxy({ method: 'GET', path: '/tasks/1111' });
    expect(res.status).toBe(200);
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].url).toBe('https://app.asana.com/api/1.0/tasks/1111');
  });

  it('still allows a POST with a body', async () => {
    const res = await callProxy({
      method: 'POST',
      path: '/tasks',
      body: { data: { name: 'x', workspace: 'ws1' } },
    });
    expect(res.status).toBe(200);
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].url).toBe('https://app.asana.com/api/1.0/tasks');
    expect(fetchCalls[0].method).toBe('POST');
  });

  it('rejects a path not in the allowlist (baseline)', async () => {
    const res = await callProxy({ method: 'GET', path: '/webhooks' });
    expect(res.status).toBe(400);
    expect(fetchCalls.length).toBe(0);
  });
});
