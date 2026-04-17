/**
 * Regression tests for asana-comment-skill-handler.mts retry +
 * dead-letter semantics.
 *
 * The handler is the cron that drains the MLRO slash-command queue
 * and posts replies back to Asana. Two pre-existing production bugs:
 *
 *   1. When `asanaPost` returned a non-2xx response it resolved to
 *      `undefined`, which the drain loop silently treated as success
 *      and then DELETED the job. The MLRO's reply was lost on any
 *      4xx/5xx or network glitch.
 *
 *   2. A job that threw inside the drain loop was left in the
 *      `pending/` queue forever. A single poison-pill job would peg
 *      the shared Asana rate limit every minute, indefinitely.
 *
 * The fixed handler:
 *   - exposes a typed `AsanaPostResult<T>` envelope from asanaPost
 *     so non-ok responses are distinguishable from successes;
 *   - increments an `attempts` counter on every failure and moves
 *     the job to a `dead-letter/<jobId>.json` slot once attempts
 *     reach MAX_ATTEMPTS (5), so a broken job costs at most five
 *     cron ticks of noise.
 *
 * These tests drive the handler through a fake `@netlify/blobs`
 * store and a stubbed `fetch` so we never hit the real API.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Fake @netlify/blobs store
// ---------------------------------------------------------------------------

interface FakeBlob {
  data: Map<string, unknown>;
  listings: string[];
}

const stores = new Map<string, FakeBlob>();

function getFakeStore(name: string): FakeBlob {
  let s = stores.get(name);
  if (!s) {
    s = { data: new Map(), listings: [] };
    stores.set(name, s);
  }
  return s;
}

vi.mock('@netlify/blobs', () => ({
  getStore: (name: string) => {
    const s = getFakeStore(name);
    return {
      list: async ({ prefix }: { prefix: string }) => ({
        blobs: [...s.data.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((k) => ({ key: k })),
      }),
      get: async (key: string, _opts: unknown) => s.data.get(key) ?? null,
      setJSON: async (key: string, value: unknown) => {
        s.data.set(key, value);
        s.listings.push(key);
      },
      delete: async (key: string) => {
        s.data.delete(key);
      },
    };
  },
}));

// ---------------------------------------------------------------------------
// Stubbed fetch — responses are queued per URL+method.
// ---------------------------------------------------------------------------

type FakeResponse = { status: number; body: unknown };
const fetchQueue: FakeResponse[] = [];
const fetchCalls: Array<{ url: string; method: string; body?: string }> = [];

beforeEach(() => {
  stores.clear();
  fetchQueue.length = 0;
  fetchCalls.length = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    fetchCalls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body as string | undefined,
    });
    const res = fetchQueue.shift() ?? { status: 500, body: { error: 'queue-empty' } };
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      async json() { return res.body; },
      async text() { return typeof res.body === 'string' ? res.body : JSON.stringify(res.body); },
    };
  });
  process.env.ASANA_API_TOKEN = 'test-token';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ASANA_API_TOKEN;
});

async function runHandler() {
  // Re-import fresh so the module picks up the new fetch stub.
  const mod = await import('../netlify/functions/asana-comment-skill-handler.mts?t=' + Date.now());
  return (mod as unknown as { default: () => Promise<Response> }).default();
}

function enqueuePendingJob(jobId: string, overrides: Record<string, unknown> = {}) {
  const jobs = getFakeStore('asana-skill-jobs');
  jobs.data.set(`pending/${jobId}.json`, {
    jobId,
    storyGid: `story-${jobId}`,
    parentTaskGid: `task-${jobId}`,
    enqueuedAtIso: new Date().toISOString(),
    ...overrides,
  });
}

describe('asana-comment-skill-handler — non-2xx reply preserves the job', () => {
  it('does NOT delete a job when Asana returns 500 on the reply post', async () => {
    enqueuePendingJob('j1');
    // First call: GET story → 200 with a real slash-command body.
    fetchQueue.push({ status: 200, body: { data: { text: '/screen ACME LLC' } } });
    // Second call: POST reply → 500.
    fetchQueue.push({ status: 500, body: 'asana is down' });

    const res = await runHandler();
    const body = (await res.json()) as Record<string, number>;

    expect(body.replied).toBe(0);
    expect(body.errors).toBe(1);
    // Job is STILL in pending (not deleted) so it will retry.
    const jobs = getFakeStore('asana-skill-jobs');
    expect(jobs.data.has('pending/j1.json')).toBe(true);
    const kept = jobs.data.get('pending/j1.json') as { attempts?: number };
    expect(kept.attempts).toBe(1);
  });
});

describe('asana-comment-skill-handler — poison-pill dead-letter', () => {
  it('moves a job to dead-letter/ after MAX_ATTEMPTS (5) failures', async () => {
    // Seed the job with attempts = 4 so one more failure trips the
    // MAX_ATTEMPTS threshold.
    enqueuePendingJob('poison', { attempts: 4 });
    // GET story → 200, POST → 500.
    fetchQueue.push({ status: 200, body: { data: { text: '/screen X' } } });
    fetchQueue.push({ status: 500, body: 'still down' });

    const res = await runHandler();
    const body = (await res.json()) as Record<string, number>;

    const jobs = getFakeStore('asana-skill-jobs');
    expect(jobs.data.has('pending/poison.json')).toBe(false);
    expect(jobs.data.has('dead-letter/poison.json')).toBe(true);
    expect(body.deadLettered).toBe(1);
    const dl = jobs.data.get('dead-letter/poison.json') as { attempts: number };
    expect(dl.attempts).toBe(5);
  });

  it('keeps retrying for attempts < MAX_ATTEMPTS', async () => {
    enqueuePendingJob('retry', { attempts: 2 });
    fetchQueue.push({ status: 200, body: { data: { text: '/screen X' } } });
    fetchQueue.push({ status: 500, body: 'still down' });

    const res = await runHandler();
    const body = (await res.json()) as Record<string, number>;

    const jobs = getFakeStore('asana-skill-jobs');
    expect(jobs.data.has('dead-letter/retry.json')).toBe(false);
    expect(body.retried).toBe(1);
    const job = jobs.data.get('pending/retry.json') as { attempts: number; lastErrorMessage?: string };
    expect(job.attempts).toBe(3);
    expect(job.lastErrorMessage).toContain('500');
  });
});

describe('asana-comment-skill-handler — happy path still deletes the job', () => {
  it('deletes the pending job after a successful reply post', async () => {
    enqueuePendingJob('ok');
    fetchQueue.push({ status: 200, body: { data: { text: '/screen ACME LLC' } } });
    fetchQueue.push({ status: 200, body: { data: { gid: 'story-reply-1' } } });

    const res = await runHandler();
    const body = (await res.json()) as Record<string, number>;

    expect(body.replied).toBe(1);
    expect(body.errors).toBe(0);
    const jobs = getFakeStore('asana-skill-jobs');
    expect(jobs.data.has('pending/ok.json')).toBe(false);
  });
});
