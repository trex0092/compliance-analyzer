/**
 * Tests for the Reuters Refinitiv adapter — pure helpers only.
 * Network paths are stubbed via vi.stubGlobal where needed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildQuoteUrl,
  parseRefinitivQuote,
  resolveReutersRefinitivConfig,
  isReutersRefinitivConfigured,
  fetchReutersRefinitivQuote,
} from '@/services/metalsTrading/reutersRefinitivAdapter';

// Env stash
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ['REUTERS_REFINITIV_API_KEY', 'REUTERS_REFINITIV_BASE_URL']) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe('resolveReutersRefinitivConfig', () => {
  it('reads env vars when present', () => {
    process.env.REUTERS_REFINITIV_API_KEY = 'test-key';
    process.env.REUTERS_REFINITIV_BASE_URL = 'https://example.test/pricing';
    const cfg = resolveReutersRefinitivConfig();
    expect(cfg.apiKey).toBe('test-key');
    expect(cfg.baseUrl).toBe('https://example.test/pricing');
  });

  it('falls back to default base URL', () => {
    process.env.REUTERS_REFINITIV_API_KEY = 'k';
    const cfg = resolveReutersRefinitivConfig();
    expect(cfg.baseUrl).toContain('refinitiv.com');
  });

  it('isReutersRefinitivConfigured returns false without a key', () => {
    expect(isReutersRefinitivConfigured()).toBe(false);
  });

  it('isReutersRefinitivConfigured returns true with a key', () => {
    process.env.REUTERS_REFINITIV_API_KEY = 'test-key';
    expect(isReutersRefinitivConfigured()).toBe(true);
  });
});

describe('buildQuoteUrl', () => {
  it('builds a XAU=R URL for gold', () => {
    const url = buildQuoteUrl('https://api.refinitiv.com/data/pricing/v1', 'XAU', 'USD');
    expect(url).toContain('XAU%3DR');
    expect(url).toContain('currency=USD');
  });

  it('builds a XAG=R URL for silver', () => {
    const url = buildQuoteUrl('https://api.refinitiv.com/data/pricing/v1', 'XAG', 'AED');
    expect(url).toContain('XAG%3DR');
    expect(url).toContain('currency=AED');
  });

  it('strips trailing slashes on the base URL', () => {
    const url = buildQuoteUrl('https://api.refinitiv.com/data/pricing/v1/', 'XAU', 'USD');
    expect(url).not.toContain('//quotes');
  });
});

describe('parseRefinitivQuote', () => {
  it('returns undefined on missing data', () => {
    expect(parseRefinitivQuote({}, 'XAU', 'USD')).toBeUndefined();
  });

  it('returns undefined when last price is missing', () => {
    expect(parseRefinitivQuote({ data: { bid: 1, ask: 2 } }, 'XAU', 'USD')).toBeUndefined();
  });

  it('returns a canonical PriceQuote when data is present', () => {
    const quote = parseRefinitivQuote(
      { data: { last: 2400, bid: 2399, ask: 2401, timestamp: '2026-04-13T12:00:00Z' } },
      'XAU',
      'USD'
    );
    expect(quote).toBeDefined();
    expect(quote?.metal).toBe('XAU');
    expect(quote?.currency).toBe('USD');
    expect(quote?.mid).toBe(2400);
    expect(quote?.bid).toBe(2399);
    expect(quote?.ask).toBe(2401);
    expect(quote?.spread).toBeCloseTo(2);
    expect(quote?.spreadBps).toBeGreaterThan(0);
  });

  it('handles missing bid/ask by falling back to last', () => {
    const quote = parseRefinitivQuote({ data: { last: 2400 } }, 'XAU', 'USD');
    expect(quote?.bid).toBe(2400);
    expect(quote?.ask).toBe(2400);
    expect(quote?.spread).toBe(0);
  });
});

describe('fetchReutersRefinitivQuote', () => {
  it('returns unconfigured status when no key is set', async () => {
    const result = await fetchReutersRefinitivQuote('XAU', 'USD');
    expect(result.status).toBe('unconfigured');
    expect(result.quote).toBeUndefined();
  });

  it('returns stub status when key is the STUB placeholder', async () => {
    process.env.REUTERS_REFINITIV_API_KEY = 'STUB';
    const result = await fetchReutersRefinitivQuote('XAU', 'USD');
    expect(result.status).toBe('stub');
  });

  it('returns auth_failed on 401', async () => {
    process.env.REUTERS_REFINITIV_API_KEY = 'real-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 401,
            text: async () => 'Unauthorized',
            json: async () => ({}),
          }) as Response
      )
    );
    const result = await fetchReutersRefinitivQuote('XAU', 'USD');
    expect(result.status).toBe('auth_failed');
  });

  it('returns rate_limited on 429', async () => {
    process.env.REUTERS_REFINITIV_API_KEY = 'real-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 429,
            text: async () => 'rate limit',
            json: async () => ({}),
          }) as Response
      )
    );
    const result = await fetchReutersRefinitivQuote('XAU', 'USD');
    expect(result.status).toBe('rate_limited');
  });

  it('returns ok with a parsed quote on success', async () => {
    process.env.REUTERS_REFINITIV_API_KEY = 'real-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            text: async () => '',
            json: async () => ({
              data: { last: 2450, bid: 2449, ask: 2451, timestamp: '2026-04-13T12:00:00Z' },
            }),
          }) as Response
      )
    );
    const result = await fetchReutersRefinitivQuote('XAU', 'USD');
    expect(result.status).toBe('ok');
    expect(result.quote?.mid).toBe(2450);
  });
});
