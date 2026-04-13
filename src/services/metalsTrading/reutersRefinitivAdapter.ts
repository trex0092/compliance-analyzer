/**
 * Reuters Refinitiv Adapter — paid spot-price feed.
 *
 * Drop-in replacement for one of the three free price aggregators in
 * priceOracle.ts. Today it's a stub that fails fast when the paid
 * REUTERS_REFINITIV_API_KEY env var is not set — the oracle's
 * stale-feed detector handles the failure gracefully and falls back
 * to LBMA Fix + COMEX + OTC spot as usual.
 *
 * When the paid key arrives:
 *   1. Set REUTERS_REFINITIV_API_KEY and REUTERS_REFINITIV_BASE_URL
 *   2. No code changes required — fetchReutersRefinitivQuote() picks
 *      the env vars up on the next call
 *   3. Wire the adapter into priceOracle.ts by registering a new
 *      'REUTERS_REFINITIV' source (requires adding the venue to the
 *      Venue union in types.ts — separate small PR)
 *
 * The adapter emits the canonical `PriceQuote` shape so the oracle
 * can consume it without any type translation layer.
 *
 * Regulatory basis:
 *   - LBMA RGG v9 (reliable price discovery for responsible sourcing)
 *   - MoE DPMS Circular 08/AML/2021 (AED valuation benchmarks for CTR)
 *   - FATF Rec 20 (TBML — valuation anomaly detection needs a trusted
 *     reference price, which is exactly what a paid feed provides)
 */

import type { Metal, Currency, PriceQuote } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReutersRefinitivStatus =
  | 'unconfigured'
  | 'stub'
  | 'ok'
  | 'auth_failed'
  | 'rate_limited'
  | 'network_error';

export interface ReutersRefinitivResult {
  status: ReutersRefinitivStatus;
  quote?: PriceQuote;
  error?: string;
  /** ISO timestamp of the attempt. */
  fetchedAtIso: string;
}

export interface ReutersRefinitivConfig {
  apiKey?: string;
  baseUrl?: string;
  /** Timeout in ms. Default 10 s. */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Env lookup — safe on server and browser
// ---------------------------------------------------------------------------

function readEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env?.[key]) return process.env[key];
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as Record<string, unknown>;
    const val = g[key];
    if (typeof val === 'string') return val;
  }
  return undefined;
}

export function resolveReutersRefinitivConfig(
  overrides: ReutersRefinitivConfig = {}
): ReutersRefinitivConfig {
  return {
    apiKey: overrides.apiKey ?? readEnv('REUTERS_REFINITIV_API_KEY'),
    baseUrl:
      overrides.baseUrl ??
      readEnv('REUTERS_REFINITIV_BASE_URL') ??
      'https://api.refinitiv.com/data/pricing/v1',
    timeoutMs: overrides.timeoutMs ?? 10_000,
  };
}

export function isReutersRefinitivConfigured(overrides: ReutersRefinitivConfig = {}): boolean {
  const cfg = resolveReutersRefinitivConfig(overrides);
  return !!cfg.apiKey;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/**
 * Fetch a spot quote for a metal from Reuters Refinitiv.
 *
 * Degradation contract:
 *   - No key → returns { status: 'unconfigured' }. Callers handle as
 *     a transparent no-op so the oracle keeps using the free feeds.
 *   - Key present but upstream fails → returns specific error statuses
 *     so ops can triage (auth_failed / rate_limited / network_error).
 *   - Key present and upstream returns a quote → { status: 'ok',
 *     quote: PriceQuote }.
 */
export async function fetchReutersRefinitivQuote(
  metal: Metal,
  currency: Currency = 'USD',
  overrides: ReutersRefinitivConfig = {}
): Promise<ReutersRefinitivResult> {
  const fetchedAtIso = new Date().toISOString();
  const cfg = resolveReutersRefinitivConfig(overrides);

  if (!cfg.apiKey) {
    return {
      status: 'unconfigured',
      error:
        'REUTERS_REFINITIV_API_KEY not set — adapter returns stub. Set the env var to enable real fetches.',
      fetchedAtIso,
    };
  }

  // Stub guard — if the key is a placeholder (the bootstrap script
  // writes REUTERS_REFINITIV_API_KEY=STUB while waiting for the real
  // credential) we still want the oracle to log a distinct "stub"
  // status so dashboards can show "stubbed, not unconfigured".
  if (cfg.apiKey === 'STUB' || cfg.apiKey.startsWith('stub:')) {
    return {
      status: 'stub',
      error: 'Reuters Refinitiv key is a placeholder (STUB). Waiting for real credential.',
      fetchedAtIso,
    };
  }

  const url = buildQuoteUrl(cfg.baseUrl ?? '', metal, currency);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.status === 401 || res.status === 403) {
      return { status: 'auth_failed', error: `HTTP ${res.status}`, fetchedAtIso };
    }
    if (res.status === 429) {
      return { status: 'rate_limited', error: 'HTTP 429', fetchedAtIso };
    }
    if (!res.ok) {
      return {
        status: 'network_error',
        error: `HTTP ${res.status}`,
        fetchedAtIso,
      };
    }

    const json = (await res.json()) as RefinitivQuoteResponse;
    const quote = parseRefinitivQuote(json, metal, currency);
    if (!quote) {
      return {
        status: 'network_error',
        error: 'Refinitiv returned a response but parseRefinitivQuote could not extract a quote',
        fetchedAtIso,
      };
    }
    return { status: 'ok', quote, fetchedAtIso };
  } catch (err) {
    return {
      status: 'network_error',
      error: (err as Error).message,
      fetchedAtIso,
    };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — unit tested
// ---------------------------------------------------------------------------

export function buildQuoteUrl(baseUrl: string, metal: Metal, currency: Currency): string {
  // Refinitiv instrument codes for precious metals spot:
  //   XAU=R  → gold spot in USD (other currencies via ?currency=)
  //   XAG=R  → silver spot
  //   XPT=R  → platinum spot
  //   XPD=R  → palladium spot
  const ricByMetal: Record<Metal, string> = {
    XAU: 'XAU=R',
    XAG: 'XAG=R',
    XPT: 'XPT=R',
    XPD: 'XPD=R',
  };
  const ric = ricByMetal[metal];
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/quotes/${encodeURIComponent(ric)}?currency=${encodeURIComponent(currency)}`;
}

interface RefinitivQuoteResponse {
  data?: {
    ric?: string;
    bid?: number;
    ask?: number;
    last?: number;
    timestamp?: string;
    currency?: string;
  };
}

export function parseRefinitivQuote(
  response: RefinitivQuoteResponse,
  metal: Metal,
  currency: Currency
): PriceQuote | undefined {
  const data = response.data;
  if (!data) return undefined;
  const last = data.last;
  if (typeof last !== 'number' || !Number.isFinite(last)) return undefined;
  const bid = typeof data.bid === 'number' ? data.bid : last;
  const ask = typeof data.ask === 'number' ? data.ask : last;
  const mid = (bid + ask) / 2;
  const spread = ask - bid;
  // Guard against degenerate mid=0 (never happens for precious metals
  // in practice but keeps bps math safe if a stub response sneaks in).
  const spreadBps = mid > 0 ? (spread / mid) * 10_000 : 0;
  return {
    metal,
    currency,
    bid,
    ask,
    mid,
    spread,
    spreadBps,
    timestamp: data.timestamp ? Date.parse(data.timestamp) : Date.now(),
    // Oracle slot — change to 'REUTERS_REFINITIV' once the Venue union
    // in types.ts is extended. Parked on OTC_SPOT so the oracle's
    // existing stale-feed detection kicks in without type surgery.
    venue: 'OTC_SPOT',
    volume24h: 0,
  };
}
