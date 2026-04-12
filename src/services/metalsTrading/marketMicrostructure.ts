// ─── Market Microstructure Analyzer ─────────────────────────────────────────
// Order book analysis, VPIN (Volume-synchronized Probability of Informed
// Trading), trade flow toxicity, smart money detection, liquidity metrics.

import type {
  Metal,
  Venue,
  TradeSide,
  OrderBook,
  OrderBookLevel,
  FlowMetrics,
  PriceQuote,
} from './types';

// ─── Order Book Analysis ────────────────────────────────────────────────────

export function analyzeOrderBook(
  bids: OrderBookLevel[],
  asks: OrderBookLevel[],
  metal: Metal,
  venue: Venue
): OrderBook {
  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? Infinity;
  const midPrice = (bestBid + bestAsk) / 2;
  const spread = bestAsk - bestBid;

  const totalBidQty = bids.slice(0, 10).reduce((s, l) => s + l.quantity, 0);
  const totalAskQty = asks.slice(0, 10).reduce((s, l) => s + l.quantity, 0);
  const totalQty = totalBidQty + totalAskQty;
  const imbalance = totalQty > 0 ? (totalBidQty - totalAskQty) / totalQty : 0;

  return {
    metal,
    venue,
    bids,
    asks,
    midPrice,
    spread,
    imbalance,
    depth10: totalBidQty + totalAskQty,
    timestamp: Date.now(),
  };
}

// ─── Liquidity Metrics ──────────────────────────────────────────────────────

export interface LiquidityMetrics {
  bidAskSpread: number;
  bidAskSpreadBps: number;
  depth5Bps: number; // qty available within 5bps of mid
  depth10Bps: number; // qty available within 10bps of mid
  depth50Bps: number; // qty available within 50bps of mid
  resiliency: number; // how fast book refills after a trade (0-1)
  impactCost1k: number; // price impact of 1000 oz market order
  impactCost10k: number; // price impact of 10000 oz market order
  topOfBookSize: number; // qty at best bid + best ask
  bookAsymmetry: number; // -1 (ask heavy) to +1 (bid heavy)
}

export function computeLiquidity(book: OrderBook): LiquidityMetrics {
  const mid = book.midPrice;
  const spreadBps = mid > 0 ? (book.spread / mid) * 10_000 : 0;

  const withinBps = (levels: OrderBookLevel[], bps: number) =>
    levels
      .filter((l) => (Math.abs(l.price - mid) / mid) * 10_000 <= bps)
      .reduce((s, l) => s + l.quantity, 0);

  const depth5Bps = withinBps(book.bids, 5) + withinBps(book.asks, 5);
  const depth10Bps = withinBps(book.bids, 10) + withinBps(book.asks, 10);
  const depth50Bps = withinBps(book.bids, 50) + withinBps(book.asks, 50);

  // Impact cost simulation
  const impactCost = (side: 'buy' | 'sell', qty: number): number => {
    const levels = side === 'buy' ? book.asks : book.bids;
    let remaining = qty;
    let totalCost = 0;

    for (const level of levels) {
      const filled = Math.min(remaining, level.quantity);
      totalCost += filled * level.price;
      remaining -= filled;
      if (remaining <= 0) break;
    }

    const avgPrice = qty > 0 ? totalCost / (qty - remaining) : mid;
    return Math.abs(avgPrice - mid);
  };

  const topBidSize = book.bids[0]?.quantity ?? 0;
  const topAskSize = book.asks[0]?.quantity ?? 0;
  const topTotal = topBidSize + topAskSize;

  return {
    bidAskSpread: book.spread,
    bidAskSpreadBps: spreadBps,
    depth5Bps,
    depth10Bps,
    depth50Bps,
    resiliency: depth50Bps > 0 ? Math.min((depth5Bps / depth50Bps) * 2, 1) : 0,
    impactCost1k: impactCost('buy', 1000),
    impactCost10k: impactCost('buy', 10000),
    topOfBookSize: topTotal,
    bookAsymmetry: topTotal > 0 ? (topBidSize - topAskSize) / topTotal : 0,
  };
}

// ─── VPIN (Volume-synchronized Probability of Informed Trading) ──────────

export class VPINCalculator {
  private buckets: { buyVolume: number; sellVolume: number }[] = [];
  private currentBucket: { buyVolume: number; sellVolume: number } = {
    buyVolume: 0,
    sellVolume: 0,
  };
  private bucketSize: number;
  private windowSize: number;

  constructor(bucketSize: number = 50, windowSize: number = 50) {
    this.bucketSize = bucketSize;
    this.windowSize = windowSize;
  }

  addTrade(price: number, volume: number, side: TradeSide): void {
    if (side === 'BUY') {
      this.currentBucket.buyVolume += volume;
    } else {
      this.currentBucket.sellVolume += volume;
    }

    const totalBucketVolume = this.currentBucket.buyVolume + this.currentBucket.sellVolume;
    if (totalBucketVolume >= this.bucketSize) {
      this.buckets.push({ ...this.currentBucket });
      this.currentBucket = { buyVolume: 0, sellVolume: 0 };

      if (this.buckets.length > this.windowSize * 2) {
        this.buckets = this.buckets.slice(-this.windowSize);
      }
    }
  }

  getVPIN(): number {
    const window = this.buckets.slice(-this.windowSize);
    if (window.length === 0) return 0;

    let totalImbalance = 0;
    let totalVolume = 0;

    for (const bucket of window) {
      totalImbalance += Math.abs(bucket.buyVolume - bucket.sellVolume);
      totalVolume += bucket.buyVolume + bucket.sellVolume;
    }

    return totalVolume > 0 ? totalImbalance / totalVolume : 0;
  }
}

// ─── Trade Flow Analysis ────────────────────────────────────────────────────

interface TradeEvent {
  price: number;
  volume: number;
  side: TradeSide;
  timestamp: number;
}

export class FlowAnalyzer {
  private trades: TradeEvent[] = [];
  private maxHistory: number;
  private vpinCalc: VPINCalculator;
  private largeTradeMultiplier: number;

  constructor(maxHistory: number = 10_000, largeTradeMultiplier: number = 5) {
    this.maxHistory = maxHistory;
    this.vpinCalc = new VPINCalculator();
    this.largeTradeMultiplier = largeTradeMultiplier;
  }

  addTrade(trade: TradeEvent): void {
    this.trades.push(trade);
    if (this.trades.length > this.maxHistory) this.trades.shift();
    this.vpinCalc.addTrade(trade.price, trade.volume, trade.side);
  }

  analyze(metal: Metal): FlowMetrics {
    const now = Date.now();
    const recentWindow = 300_000; // 5 minutes
    const recent = this.trades.filter((t) => t.timestamp > now - recentWindow);

    const buyVolume = recent.filter((t) => t.side === 'BUY').reduce((s, t) => s + t.volume, 0);
    const sellVolume = recent.filter((t) => t.side === 'SELL').reduce((s, t) => s + t.volume, 0);
    const totalVolume = buyVolume + sellVolume;
    const avgTradeSize = recent.length > 0 ? totalVolume / recent.length : 0;

    const largeThreshold = avgTradeSize * this.largeTradeMultiplier;
    const largeTrades = recent.filter((t) => t.volume >= largeThreshold);
    const largeBuyVol = largeTrades
      .filter((t) => t.side === 'BUY')
      .reduce((s, t) => s + t.volume, 0);
    const largeSellVol = largeTrades
      .filter((t) => t.side === 'SELL')
      .reduce((s, t) => s + t.volume, 0);

    const vpin = this.vpinCalc.getVPIN();
    const imbalance = totalVolume > 0 ? (buyVolume - sellVolume) / totalVolume : 0;

    // Smart money = large trades, retail = small trades
    const smartDirection: TradeSide | 'NEUTRAL' =
      largeBuyVol > largeSellVol * 1.3
        ? 'BUY'
        : largeSellVol > largeBuyVol * 1.3
          ? 'SELL'
          : 'NEUTRAL';

    const smallBuyVol = buyVolume - largeBuyVol;
    const smallSellVol = sellVolume - largeSellVol;
    const retailDirection: TradeSide | 'NEUTRAL' =
      smallBuyVol > smallSellVol * 1.3
        ? 'BUY'
        : smallSellVol > smallBuyVol * 1.3
          ? 'SELL'
          : 'NEUTRAL';

    return {
      metal,
      vpin,
      tradeFlowImbalance: imbalance,
      avgTradeSize,
      largeTradeCount: largeTrades.length,
      largeTradeThreshold: largeThreshold,
      buyVolume,
      sellVolume,
      netFlow: buyVolume - sellVolume,
      toxicity: vpin, // VPIN = toxicity metric
      smartMoneyDirection: smartDirection,
      retailDirection,
      timestamp: now,
    };
  }

  // Detect stop hunts (sharp move followed by reversal with large volume)
  detectStopHunt(recentQuotes: PriceQuote[]): {
    detected: boolean;
    direction: TradeSide;
    magnitude: number;
  } {
    if (recentQuotes.length < 10) return { detected: false, direction: 'BUY', magnitude: 0 };

    const prices = recentQuotes.map((q) => q.mid);
    const last5 = prices.slice(-5);
    const prev5 = prices.slice(-10, -5);

    const prevAvg = prev5.reduce((a, b) => a + b, 0) / prev5.length;
    const minRecent = Math.min(...last5);
    const maxRecent = Math.max(...last5);
    const lastPrice = prices[prices.length - 1];

    // Spike down then recovery = stop hunt on longs
    const downSpike = prevAvg > 0 ? ((prevAvg - minRecent) / prevAvg) * 100 : 0;
    const recovery = prevAvg > 0 ? ((lastPrice - minRecent) / prevAvg) * 100 : 0;

    if (downSpike > 0.3 && recovery > downSpike * 0.6) {
      return { detected: true, direction: 'BUY', magnitude: downSpike };
    }

    // Spike up then pullback = stop hunt on shorts
    const upSpike = prevAvg > 0 ? ((maxRecent - prevAvg) / prevAvg) * 100 : 0;
    const pullback = prevAvg > 0 ? ((maxRecent - lastPrice) / prevAvg) * 100 : 0;

    if (upSpike > 0.3 && pullback > upSpike * 0.6) {
      return { detected: true, direction: 'SELL', magnitude: upSpike };
    }

    return { detected: false, direction: 'BUY', magnitude: 0 };
  }
}

// ─── Spread Decomposition ───────────────────────────────────────────────────

export interface SpreadComponents {
  totalSpread: number;
  adverseSelection: number; // information asymmetry cost
  inventoryRisk: number; // market maker inventory cost
  orderProcessing: number; // fixed transaction costs
  adverseSelectionPct: number;
  inventoryRiskPct: number;
  orderProcessingPct: number;
}

export function decomposeSpread(
  spreads: number[], // historical spread snapshots
  priceChanges: number[], // mid-price changes
  inventoryProxy: number[] // net position of market makers
): SpreadComponents {
  if (spreads.length === 0)
    return {
      totalSpread: 0,
      adverseSelection: 0,
      inventoryRisk: 0,
      orderProcessing: 0,
      adverseSelectionPct: 33,
      inventoryRiskPct: 33,
      orderProcessingPct: 34,
    };

  const avgSpread = spreads.reduce((a, b) => a + b, 0) / spreads.length;

  // Simplified Roll model
  const autoCovariance = computeAutoCovariance(priceChanges);
  const adverseSelection = Math.max(0, Math.sqrt(Math.abs(autoCovariance)) * 2);

  // Inventory component — correlated with position
  const inventoryCorr = Math.abs(correlation(spreads, inventoryProxy));
  const inventoryRisk = avgSpread * inventoryCorr * 0.5;

  const orderProcessing = Math.max(0, avgSpread - adverseSelection - inventoryRisk);

  const total = adverseSelection + inventoryRisk + orderProcessing || 1;

  return {
    totalSpread: avgSpread,
    adverseSelection,
    inventoryRisk,
    orderProcessing,
    adverseSelectionPct: (adverseSelection / total) * 100,
    inventoryRiskPct: (inventoryRisk / total) * 100,
    orderProcessingPct: (orderProcessing / total) * 100,
  };
}

function computeAutoCovariance(data: number[]): number {
  if (data.length < 2) return 0;
  const mean = data.reduce((a, b) => a + b, 0) / data.length;
  let cov = 0;
  for (let i = 1; i < data.length; i++) {
    cov += (data[i] - mean) * (data[i - 1] - mean);
  }
  return cov / (data.length - 1);
}

function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const meanA = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const meanB = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0,
    denA = 0,
    denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den > 0 ? num / den : 0;
}
