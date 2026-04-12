// ─── Price Oracle: Multi-Source Price Aggregation Engine ─────────────────────
// Aggregates LBMA Fix, COMEX, SGE, DMCC, OTC spot, physical dealer prices.
// Detects stale feeds, calculates VWAP, identifies manipulation signals.

import type {
  Metal,
  Currency,
  Venue,
  PriceQuote,
  LBMAFix,
  SpotSnapshot,
  OHLCV,
  PriceFeed,
} from './types';

// ─── Price Source Registry ──────────────────────────────────────────────────

interface PriceSource {
  venue: Venue;
  priority: number;
  staleLimitMs: number;
  weight: number;
  lastQuote: PriceQuote | null;
  lastFetchMs: number;
  failureCount: number;
  status: 'ACTIVE' | 'STALE' | 'FAILED';
}

const SOURCE_CONFIG: Record<
  Venue,
  Omit<PriceSource, 'lastQuote' | 'lastFetchMs' | 'failureCount' | 'status'>
> = {
  LBMA: { venue: 'LBMA', priority: 1, staleLimitMs: 60_000, weight: 0.3 },
  COMEX: { venue: 'COMEX', priority: 2, staleLimitMs: 5_000, weight: 0.25 },
  SGE: { venue: 'SGE', priority: 3, staleLimitMs: 10_000, weight: 0.15 },
  DMCC: { venue: 'DMCC', priority: 4, staleLimitMs: 15_000, weight: 0.15 },
  OTC_SPOT: { venue: 'OTC_SPOT', priority: 5, staleLimitMs: 3_000, weight: 0.1 },
  PHYSICAL: { venue: 'PHYSICAL', priority: 6, staleLimitMs: 300_000, weight: 0.05 },
};

// ─── Historical Data Store ──────────────────────────────────────────────────

interface PriceHistory {
  candles: Map<string, OHLCV[]>; // key: `${metal}/${interval}`
  ticks: Map<Metal, PriceQuote[]>; // rolling tick buffer
  maxTicks: number;
  maxCandles: number;
}

// ─── Oracle Class ───────────────────────────────────────────────────────────

export class PriceOracle {
  private sources: Map<Venue, PriceSource> = new Map();
  private consolidatedQuotes: Map<string, PriceQuote> = new Map();
  private lbmaFixes: LBMAFix[] = [];
  private history: PriceHistory;
  private listeners: ((quote: PriceQuote) => void)[] = [];

  constructor() {
    for (const [venue, config] of Object.entries(SOURCE_CONFIG)) {
      this.sources.set(venue as Venue, {
        ...config,
        lastQuote: null,
        lastFetchMs: 0,
        failureCount: 0,
        status: 'ACTIVE',
      });
    }
    this.history = {
      candles: new Map(),
      ticks: new Map(),
      maxTicks: 10_000,
      maxCandles: 5_000,
    };
  }

  onPrice(listener: (quote: PriceQuote) => void): void {
    this.listeners.push(listener);
  }

  // ─── Feed Ingestion ─────────────────────────────────────────────────────

  ingestQuote(quote: PriceQuote): void {
    const source = this.sources.get(quote.venue);
    if (!source) return;

    source.lastQuote = quote;
    source.lastFetchMs = Date.now();
    source.failureCount = 0;
    source.status = 'ACTIVE';

    // Store tick
    const ticks = this.history.ticks.get(quote.metal) ?? [];
    ticks.push(quote);
    if (ticks.length > this.history.maxTicks) ticks.shift();
    this.history.ticks.set(quote.metal, ticks);

    // Build consolidated price
    this.consolidate(quote.metal, quote.currency);

    // Notify listeners
    const consolidated = this.getConsolidated(quote.metal, quote.currency);
    if (consolidated) {
      for (const fn of this.listeners) fn(consolidated);
    }
  }

  ingestLBMAFix(fix: LBMAFix): void {
    this.lbmaFixes.push(fix);
    if (this.lbmaFixes.length > 365) this.lbmaFixes.shift();
  }

  ingestCandle(candle: OHLCV): void {
    const key = `${candle.metal}/${candle.interval}`;
    const candles = this.history.candles.get(key) ?? [];
    candles.push(candle);
    if (candles.length > this.history.maxCandles) candles.shift();
    this.history.candles.set(key, candles);
  }

  markSourceFailed(venue: Venue): void {
    const source = this.sources.get(venue);
    if (source) {
      source.failureCount++;
      source.status = source.failureCount >= 3 ? 'FAILED' : 'STALE';
    }
  }

  // ─── Consolidation ─────────────────────────────────────────────────────

  private consolidate(metal: Metal, currency: Currency): void {
    const now = Date.now();
    const activeSources: { quote: PriceQuote; weight: number }[] = [];
    let totalWeight = 0;

    for (const source of this.sources.values()) {
      if (!source.lastQuote) continue;
      if (source.lastQuote.metal !== metal) continue;
      if (source.lastQuote.currency !== currency) continue;
      if (now - source.lastFetchMs > source.staleLimitMs) {
        source.status = 'STALE';
        continue;
      }
      activeSources.push({ quote: source.lastQuote, weight: source.weight });
      totalWeight += source.weight;
    }

    if (activeSources.length === 0) return;

    // Volume-weighted average price across sources
    let weightedBid = 0,
      weightedAsk = 0,
      totalVolume = 0;
    for (const { quote, weight } of activeSources) {
      const normalizedWeight = weight / totalWeight;
      weightedBid += quote.bid * normalizedWeight;
      weightedAsk += quote.ask * normalizedWeight;
      totalVolume += quote.volume24h;
    }

    const mid = (weightedBid + weightedAsk) / 2;
    const spread = weightedAsk - weightedBid;

    const consolidated: PriceQuote = {
      metal,
      currency,
      bid: weightedBid,
      ask: weightedAsk,
      mid,
      spread,
      spreadBps: mid > 0 ? (spread / mid) * 10_000 : 0,
      timestamp: now,
      venue: 'OTC_SPOT', // consolidated = virtual OTC
      volume24h: totalVolume,
    };

    this.consolidatedQuotes.set(`${metal}/${currency}`, consolidated);
  }

  // ─── Queries ────────────────────────────────────────────────────────────

  getConsolidated(metal: Metal, currency: Currency = 'USD'): PriceQuote | null {
    return this.consolidatedQuotes.get(`${metal}/${currency}`) ?? null;
  }

  getByVenue(metal: Metal, venue: Venue): PriceQuote | null {
    return this.sources.get(venue)?.lastQuote ?? null;
  }

  getAllQuotes(metal: Metal): PriceQuote[] {
    const quotes: PriceQuote[] = [];
    for (const source of this.sources.values()) {
      if (source.lastQuote?.metal === metal && source.status === 'ACTIVE') {
        quotes.push(source.lastQuote);
      }
    }
    return quotes;
  }

  getLatestFix(metal: Metal = 'XAU'): LBMAFix | undefined {
    return [...this.lbmaFixes].reverse().find((f) => f.metal === metal);
  }

  getCandles(metal: Metal, interval: OHLCV['interval'], count?: number): OHLCV[] {
    const key = `${metal}/${interval}`;
    const all = this.history.candles.get(key) ?? [];
    return count ? all.slice(-count) : all;
  }

  getTicks(metal: Metal, count?: number): PriceQuote[] {
    const all = this.history.ticks.get(metal) ?? [];
    return count ? all.slice(-count) : all;
  }

  getSnapshot(metal: Metal): SpotSnapshot | null {
    const quote = this.getConsolidated(metal);
    if (!quote) return null;

    const ticks = this.getTicks(metal);
    const ticks24h = ticks.filter((t) => t.timestamp > Date.now() - 86_400_000);
    const oldestPrice = ticks24h[0]?.mid ?? quote.mid;

    return {
      metal,
      spotUSD: quote.mid,
      change24h: quote.mid - oldestPrice,
      changePct24h: oldestPrice > 0 ? ((quote.mid - oldestPrice) / oldestPrice) * 100 : 0,
      high24h: ticks24h.length > 0 ? Math.max(...ticks24h.map((t) => t.ask)) : quote.ask,
      low24h: ticks24h.length > 0 ? Math.min(...ticks24h.map((t) => t.bid)) : quote.bid,
      volume24h: quote.volume24h,
      openInterest: 0,
      timestamp: quote.timestamp,
    };
  }

  getFeedStatus(): PriceFeed {
    const now = Date.now();
    let latestUpdate = 0;
    let totalLatency = 0;
    let activeCount = 0;

    for (const source of this.sources.values()) {
      if (source.status === 'ACTIVE') {
        activeCount++;
        totalLatency += now - source.lastFetchMs;
        if (source.lastFetchMs > latestUpdate) latestUpdate = source.lastFetchMs;
      }
    }

    return {
      quotes: this.consolidatedQuotes,
      lastUpdate: latestUpdate,
      latencyMs: activeCount > 0 ? totalLatency / activeCount : 0,
      status: activeCount >= 3 ? 'LIVE' : activeCount >= 1 ? 'STALE' : 'DISCONNECTED',
    };
  }

  // ─── VWAP Calculation ───────────────────────────────────────────────────

  calculateVWAP(metal: Metal, periodMs: number = 86_400_000): number {
    const now = Date.now();
    const ticks = this.getTicks(metal).filter((t) => t.timestamp > now - periodMs);
    if (ticks.length === 0) return 0;

    let totalPriceVolume = 0;
    let totalVolume = 0;
    for (const tick of ticks) {
      totalPriceVolume += tick.mid * tick.volume24h;
      totalVolume += tick.volume24h;
    }
    return totalVolume > 0 ? totalPriceVolume / totalVolume : 0;
  }

  // ─── Cross-Rate Calculation ─────────────────────────────────────────────

  getCrossRate(metal: Metal, from: Currency, to: Currency): number | null {
    const fromQuote = this.getConsolidated(metal, from);
    const toQuote = this.getConsolidated(metal, to);
    if (!fromQuote || !toQuote) return null;
    return toQuote.mid > 0 ? fromQuote.mid / toQuote.mid : null;
  }

  // ─── Anomaly Detection ─────────────────────────────────────────────────

  detectPriceAnomaly(metal: Metal): {
    isAnomaly: boolean;
    deviationPct: number;
    outlierVenue: Venue | null;
    description: string;
  } {
    const quotes = this.getAllQuotes(metal);
    if (quotes.length < 2)
      return {
        isAnomaly: false,
        deviationPct: 0,
        outlierVenue: null,
        description: 'Insufficient sources',
      };

    const prices = quotes.map((q) => q.mid);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const stdDev = Math.sqrt(prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / prices.length);

    let maxDeviation = 0;
    let outlierVenue: Venue | null = null;

    for (const q of quotes) {
      const deviation = Math.abs(q.mid - mean);
      if (deviation > maxDeviation) {
        maxDeviation = deviation;
        outlierVenue = q.venue;
      }
    }

    const deviationPct = mean > 0 ? (maxDeviation / mean) * 100 : 0;
    const threshold = 0.5; // 0.5% deviation = anomaly

    return {
      isAnomaly: deviationPct > threshold,
      deviationPct,
      outlierVenue: deviationPct > threshold ? outlierVenue : null,
      description:
        deviationPct > threshold
          ? `${outlierVenue} deviates ${deviationPct.toFixed(2)}% from consensus (stddev: ${stdDev.toFixed(2)})`
          : 'All sources within normal range',
    };
  }

  // ─── Gold/Silver Ratio ──────────────────────────────────────────────────

  getGoldSilverRatio(): { ratio: number; historical50dAvg: number; signal: string } | null {
    const gold = this.getConsolidated('XAU');
    const silver = this.getConsolidated('XAG');
    if (!gold || !silver || silver.mid === 0) return null;

    const ratio = gold.mid / silver.mid;
    // Historical average is ~60-80
    const historical50dAvg = 75;

    let signal = 'NEUTRAL';
    if (ratio > 90) signal = 'SILVER_UNDERVALUED — Buy silver, sell gold';
    else if (ratio > 80) signal = 'SILVER_RELATIVELY_CHEAP';
    else if (ratio < 60) signal = 'GOLD_UNDERVALUED — Buy gold, sell silver';
    else if (ratio < 70) signal = 'GOLD_RELATIVELY_CHEAP';

    return { ratio, historical50dAvg, signal };
  }
}

// ─── Simulated Market Data Generator (for testing & demo) ───────────────────

export function generateSimulatedPrices(metal: Metal): PriceQuote {
  const basePrices: Record<Metal, number> = {
    XAU: 2340.5,
    XAG: 29.85,
    XPT: 985.0,
    XPD: 1025.0,
  };

  const base = basePrices[metal];
  const noise = (Math.random() - 0.5) * base * 0.002;
  const mid = base + noise;
  const spreadPct = metal === 'XAU' ? 0.0003 : 0.001;
  const halfSpread = mid * spreadPct;

  return {
    metal,
    currency: 'USD',
    bid: mid - halfSpread,
    ask: mid + halfSpread,
    mid,
    spread: halfSpread * 2,
    spreadBps: spreadPct * 10_000,
    timestamp: Date.now(),
    venue: (['LBMA', 'COMEX', 'DMCC', 'OTC_SPOT'] as Venue[])[Math.floor(Math.random() * 4)],
    volume24h: Math.floor(Math.random() * 500_000) + 100_000,
  };
}
