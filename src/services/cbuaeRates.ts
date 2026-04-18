/**
 * CBUAE Exchange Rate Service
 *
 * Fetches live exchange rates from the Central Bank of UAE.
 * Falls back to the hardcoded peg rate if the API is unavailable.
 *
 * The AED is pegged to USD at 3.6725 — this rarely changes, but
 * cross-rates (EUR, GBP, etc.) fluctuate daily.
 *
 * Auditor question: "Where do your FX rates come from?"
 * Answer: "Live CBUAE feed, refreshed daily, with peg fallback."
 */

import { USD_TO_AED } from '../domain/constants';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';

export interface ExchangeRates {
  baseCurrency: 'AED';
  source: 'cbuae-live' | 'cbuae-cached' | 'hardcoded-fallback';
  fetchedAt: string;
  rates: Record<string, number>;
}

const RATES_STORAGE_KEY = 'fgl_cbuae_rates';
const RATES_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch live rates from CBUAE.
 * The CBUAE publishes daily rates at their website.
 * We use a proxy to avoid CORS.
 */
export async function fetchCBUAERates(proxyUrl?: string): Promise<ExchangeRates> {
  // CBUAE rate page — we parse their published rates
  const CBUAE_URL = 'https://www.centralbank.ae/en/fx-rates';

  try {
    const url = proxyUrl ? `${proxyUrl}/proxy?url=${encodeURIComponent(CBUAE_URL)}` : CBUAE_URL;

    const response = await fetchWithTimeout(url, { timeoutMs: 15000 });
    if (!response.ok) throw new Error(`CBUAE returned ${response.status}`);

    const html = await response.text();
    const rates = parseCBUAERates(html);

    const result: ExchangeRates = {
      baseCurrency: 'AED',
      source: 'cbuae-live',
      fetchedAt: new Date().toISOString(),
      rates,
    };

    // Cache for offline/fallback
    try {
      localStorage.setItem(RATES_STORAGE_KEY, JSON.stringify(result));
    } catch {
      // Storage full — not critical
    }

    return result;
  } catch {
    // Try cached rates
    return getCachedOrFallbackRates();
  }
}

/**
 * Parse CBUAE HTML for exchange rates.
 * Extracts common currency pairs.
 */
function parseCBUAERates(html: string): Record<string, number> {
  const rates: Record<string, number> = {
    USD: USD_TO_AED, // Pegged
  };

  // Common patterns in CBUAE rate tables
  const currencyPatterns: [string, RegExp][] = [
    ['EUR', /EUR[^0-9]*?([\d.]+)/i],
    ['GBP', /GBP[^0-9]*?([\d.]+)/i],
    ['CHF', /CHF[^0-9]*?([\d.]+)/i],
    ['JPY', /JPY[^0-9]*?([\d.]+)/i],
    ['CAD', /CAD[^0-9]*?([\d.]+)/i],
    ['AUD', /AUD[^0-9]*?([\d.]+)/i],
    ['INR', /INR[^0-9]*?([\d.]+)/i],
    ['SAR', /SAR[^0-9]*?([\d.]+)/i],
    ['KWD', /KWD[^0-9]*?([\d.]+)/i],
    ['BHD', /BHD[^0-9]*?([\d.]+)/i],
    ['OMR', /OMR[^0-9]*?([\d.]+)/i],
    ['QAR', /QAR[^0-9]*?([\d.]+)/i],
    ['CNY', /CNY[^0-9]*?([\d.]+)/i],
    ['TRY', /TRY[^0-9]*?([\d.]+)/i],
  ];

  for (const [currency, pattern] of currencyPatterns) {
    const match = html.match(pattern);
    if (match) {
      const rate = parseFloat(match[1]);
      if (rate > 0 && rate < 100) {
        rates[currency] = rate;
      }
    }
  }

  return rates;
}

/**
 * Get cached rates or fall back to hardcoded peg.
 */
export function getCachedOrFallbackRates(): ExchangeRates {
  try {
    const cached = localStorage.getItem(RATES_STORAGE_KEY);
    if (cached) {
      const parsed: ExchangeRates = JSON.parse(cached);
      const age = Date.now() - new Date(parsed.fetchedAt).getTime();
      if (age < RATES_MAX_AGE_MS) {
        return { ...parsed, source: 'cbuae-cached' };
      }
    }
  } catch {
    // Corrupted cache
  }

  // Hardcoded fallback — USD/AED peg + estimated cross rates
  return {
    baseCurrency: 'AED',
    source: 'hardcoded-fallback',
    fetchedAt: new Date().toISOString(),
    rates: {
      USD: USD_TO_AED,
      EUR: USD_TO_AED * 1.08,
      GBP: USD_TO_AED * 1.27,
      CHF: USD_TO_AED * 1.12,
      INR: USD_TO_AED / 83.5,
      SAR: 0.98,
      TRY: USD_TO_AED / 32.0,
    },
  };
}

/**
 * Convert an amount to AED using the best available rate.
 */
export function convertToAED(
  amount: number,
  fromCurrency: string,
  rates: ExchangeRates
): { amountAED: number; rate: number; source: string } {
  if (fromCurrency === 'AED') {
    return { amountAED: amount, rate: 1, source: rates.source };
  }

  const rate = rates.rates[fromCurrency.toUpperCase()];
  if (!rate) {
    // Unknown currency — use USD peg as best guess.
    // WARNING: This is inaccurate for non-USD currencies.
    // Callers should check source === 'unknown-currency-fallback' and flag for review.
    console.warn(
      `[cbuaeRates] Currency "${fromCurrency}" not in CBUAE rates. Using USD peg as fallback — amount may be inaccurate.`
    );
    return {
      amountAED: amount * USD_TO_AED,
      rate: USD_TO_AED,
      source: 'unknown-currency-fallback',
    };
  }

  return {
    amountAED: Math.round(amount * rate * 100) / 100,
    rate,
    source: rates.source,
  };
}
