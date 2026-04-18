/**
 * CBUAE FX rate poller (cron).
 *
 * Fetches published AED-base exchange rates from the Central Bank of
 * UAE once per day and persists the snapshot. Downstream code that
 * needs to convert a transaction amount to AED for STR/CTR filings
 * reads the latest blob; if the blob is older than 7 days, callers
 * must refuse to convert and escalate — the FX service will not
 * return stale rates silently.
 *
 * This is the server-side counterpart of `src/services/cbuaeRates.ts`,
 * which is browser-only (uses localStorage). The cron persists to
 * Netlify Blobs so every tenant sees the same authoritative rate.
 *
 * Regulatory alignment:
 *   CLAUDE.md coding rule 7: "AED as primary. When converting, use
 *   published CBUAE rates, not hardcoded."
 */

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { USD_TO_AED } from '../../src/domain/constants';
import { fetchWithTimeout } from '../../src/utils/fetchWithTimeout';

const FX_STORE = 'fx-rates';
const FX_AUDIT_STORE = 'fx-rates-audit';
const FETCH_TIMEOUT_MS = 15_000;
const CBUAE_URL = 'https://www.centralbank.ae/en/fx-rates';

interface FxSnapshot {
  baseCurrency: 'AED';
  source: 'cbuae-live' | 'peg-fallback';
  fetchedAt: string;
  rates: Record<string, number>;
}

// Same parser as the browser module, but returns a plain object.
// Duplicating the 20-line pattern set here is cheaper than sharing
// code across runtimes and dragging localStorage into the function.
function parseCBUAERates(html: string): Record<string, number> {
  const rates: Record<string, number> = { USD: USD_TO_AED };
  const patterns: [string, RegExp][] = [
    ['EUR', /EUR[^0-9]*?([\d.]+)/i],
    ['GBP', /GBP[^0-9]*?([\d.]+)/i],
    ['CHF', /CHF[^0-9]*?([\d.]+)/i],
    ['JPY', /JPY[^0-9]*?([\d.]+)/i],
    ['CAD', /CAD[^0-9]*?([\d.]+)/i],
    ['AUD', /AUD[^0-9]*?([\d.]+)/i],
    ['SGD', /SGD[^0-9]*?([\d.]+)/i],
    ['INR', /INR[^0-9]*?([\d.]+)/i],
    ['CNY', /CNY[^0-9]*?([\d.]+)/i],
    ['SAR', /SAR[^0-9]*?([\d.]+)/i],
    ['QAR', /QAR[^0-9]*?([\d.]+)/i],
    ['OMR', /OMR[^0-9]*?([\d.]+)/i],
    ['KWD', /KWD[^0-9]*?([\d.]+)/i],
    ['BHD', /BHD[^0-9]*?([\d.]+)/i],
  ];
  for (const [code, pattern] of patterns) {
    const m = html.match(pattern);
    if (m) {
      const n = parseFloat(m[1]);
      if (Number.isFinite(n) && n > 0 && n < 1000) {
        rates[code] = n;
      }
    }
  }
  return rates;
}

async function writeAudit(payload: Record<string, unknown>): Promise<void> {
  const store = getStore(FX_AUDIT_STORE);
  const iso = new Date().toISOString();
  await store.setJSON(`${iso.slice(0, 10)}/${Date.now()}.json`, {
    ...payload,
    recordedAt: iso,
  });
}

export default async (): Promise<Response> => {
  const startedAt = new Date().toISOString();
  let snapshot: FxSnapshot;

  try {
    const response = await fetchWithTimeout(CBUAE_URL, { timeoutMs: FETCH_TIMEOUT_MS });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const html = await response.text();
    const rates = parseCBUAERates(html);
    snapshot = {
      baseCurrency: 'AED',
      source: 'cbuae-live',
      fetchedAt: new Date().toISOString(),
      rates,
    };
  } catch (err) {
    // Peg fallback: USD is pegged to AED so at least one rate is stable.
    // The snapshot is still persisted but tagged so downstream code can
    // treat a long run of peg-fallback snapshots as an escalation signal.
    const message = err instanceof Error ? err.message : String(err);
    snapshot = {
      baseCurrency: 'AED',
      source: 'peg-fallback',
      fetchedAt: new Date().toISOString(),
      rates: { USD: USD_TO_AED },
    };
    await writeAudit({ event: 'fx_cron_fetch_failed', error: message });
  }

  const store = getStore(FX_STORE);
  await store.setJSON('latest.json', snapshot);
  await store.setJSON(`history/${snapshot.fetchedAt.slice(0, 10)}.json`, snapshot);
  await writeAudit({
    event: 'fx_cron_success',
    source: snapshot.source,
    rates: Object.keys(snapshot.rates).length,
    startedAt,
  });

  return Response.json({ ok: true, source: snapshot.source, rates: snapshot.rates });
};

export const config: Config = {
  // Once per day at 03:00 UTC (07:00 Asia/Dubai) — after CBUAE's daily
  // publication cycle but before business hours open.
  schedule: '0 3 * * *',
};
