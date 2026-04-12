// ─── Multi-Timeframe Confluence ─────────────────────────────────────────────
// The most powerful signals occur when multiple timeframes agree.
// This module aligns signals across 1m, 5m, 15m, 1h, 4h, 1d, 1w
// and produces a confluence score. Trades only when 3+ timeframes agree.

import type { Metal, TradeSide, OHLCV, TAIndicators } from './types';

// ─── Types ──────────────────────────────────────────────────────────────────

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export interface TimeframeBias {
  timeframe: Timeframe;
  bias: TradeSide | 'NEUTRAL';
  strength: number;         // 0-1
  trendAlignment: boolean;  // is price above/below SMA200?
  momentumAlignment: boolean; // is momentum (MACD) supporting?
  volumeConfirmation: boolean;
  keyLevel: string;         // nearest S/R
}

export interface ConfluenceResult {
  metal: Metal;
  overallBias: TradeSide | 'NEUTRAL';
  confluenceScore: number;  // 0-100
  agreeing: number;         // how many timeframes agree
  total: number;            // how many timeframes analyzed
  alignment: number;        // agreeing / total
  timeframes: TimeframeBias[];
  tradeable: boolean;       // confluence > threshold
  bestEntry: Timeframe;     // best timeframe for entry timing
  reasoning: string[];
}

// ─── Weight per Timeframe ───────────────────────────────────────────────────
// Higher timeframes carry more weight.

const TF_WEIGHTS: Record<Timeframe, number> = {
  '1m':  0.05,
  '5m':  0.08,
  '15m': 0.12,
  '1h':  0.18,
  '4h':  0.22,
  '1d':  0.25,
  '1w':  0.10,
};

// ─── Analyze Single Timeframe ───────────────────────────────────────────────

export function analyzeTimeframe(
  timeframe: Timeframe,
  candles: OHLCV[],
  metal: Metal,
): TimeframeBias {
  if (candles.length < 20) {
    return {
      timeframe, bias: 'NEUTRAL', strength: 0,
      trendAlignment: false, momentumAlignment: false,
      volumeConfirmation: false, keyLevel: 'N/A',
    };
  }

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const currentPrice = closes[closes.length - 1];

  // SMA
  const sma20 = avg(closes.slice(-20));
  const sma50 = closes.length >= 50 ? avg(closes.slice(-50)) : sma20;
  const sma200 = closes.length >= 200 ? avg(closes.slice(-200)) : sma50;

  // Trend
  const aboveSMA200 = currentPrice > sma200;
  const aboveSMA50 = currentPrice > sma50;
  const smaAligned = aboveSMA200 === aboveSMA50;

  // RSI
  const rsi = calcQuickRSI(closes, 14);

  // MACD histogram
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdHist = ema12 - ema26;

  // Volume trend (is recent volume above average?)
  const avgVol = avg(volumes);
  const recentVol = avg(volumes.slice(-5));
  const volumeUp = recentVol > avgVol * 1.1;

  // Score
  let score = 0;
  if (aboveSMA200) score += 2; else score -= 2;
  if (aboveSMA50) score += 1; else score -= 1;
  if (smaAligned) score += 0.5;
  if (rsi < 30) score += 1.5; // oversold = buy
  else if (rsi > 70) score -= 1.5; // overbought = sell
  if (macdHist > 0) score += 1; else score -= 1;

  const bias: TradeSide | 'NEUTRAL' = score > 1.5 ? 'BUY' : score < -1.5 ? 'SELL' : 'NEUTRAL';
  const strength = Math.min(Math.abs(score) / 6, 1);

  // Key level
  const high20 = Math.max(...candles.slice(-20).map(c => c.high));
  const low20 = Math.min(...candles.slice(-20).map(c => c.low));
  const nearResistance = Math.abs(currentPrice - high20) / currentPrice < 0.005;
  const nearSupport = Math.abs(currentPrice - low20) / currentPrice < 0.005;
  const keyLevel = nearResistance ? `R $${high20.toFixed(2)}` : nearSupport ? `S $${low20.toFixed(2)}` : `Mid-range`;

  return {
    timeframe,
    bias,
    strength,
    trendAlignment: smaAligned && aboveSMA200,
    momentumAlignment: (bias === 'BUY' && macdHist > 0) || (bias === 'SELL' && macdHist < 0),
    volumeConfirmation: volumeUp,
    keyLevel,
  };
}

// ─── Confluence Analysis ────────────────────────────────────────────────────

export function computeConfluence(
  metal: Metal,
  candlesByTF: Partial<Record<Timeframe, OHLCV[]>>,
  minConfluence: number = 60,
): ConfluenceResult {
  const timeframes: TimeframeBias[] = [];
  let weightedBuyScore = 0;
  let weightedSellScore = 0;
  let totalWeight = 0;

  const tfOrder: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

  for (const tf of tfOrder) {
    const candles = candlesByTF[tf];
    if (!candles || candles.length < 10) continue;

    const bias = analyzeTimeframe(tf, candles, metal);
    timeframes.push(bias);

    const weight = TF_WEIGHTS[tf] * bias.strength;
    if (bias.bias === 'BUY') weightedBuyScore += weight;
    else if (bias.bias === 'SELL') weightedSellScore += weight;
    totalWeight += TF_WEIGHTS[tf];
  }

  const total = timeframes.length;
  const buyCount = timeframes.filter(t => t.bias === 'BUY').length;
  const sellCount = timeframes.filter(t => t.bias === 'SELL').length;
  const agreeing = Math.max(buyCount, sellCount);
  const alignment = total > 0 ? agreeing / total : 0;

  const netScore = totalWeight > 0
    ? (weightedBuyScore - weightedSellScore) / totalWeight
    : 0;

  const overallBias: TradeSide | 'NEUTRAL' = netScore > 0.15 ? 'BUY' : netScore < -0.15 ? 'SELL' : 'NEUTRAL';
  const confluenceScore = Math.min(Math.abs(netScore) * 100 + alignment * 30, 100);
  const tradeable = confluenceScore >= minConfluence && agreeing >= 3;

  // Best entry timeframe = smallest TF that agrees with overall bias
  const bestEntry = timeframes
    .filter(t => t.bias === overallBias)
    .sort((a, b) => tfOrder.indexOf(a.timeframe) - tfOrder.indexOf(b.timeframe))[0]?.timeframe ?? '1h';

  const reasoning: string[] = [
    `${agreeing}/${total} timeframes agree on ${overallBias}`,
    `Confluence: ${confluenceScore.toFixed(0)}/100`,
    `Alignment: ${(alignment * 100).toFixed(0)}%`,
    ...timeframes.map(t =>
      `[${t.timeframe}] ${t.bias} (${(t.strength * 100).toFixed(0)}%) ${t.trendAlignment ? 'TREND' : ''} ${t.momentumAlignment ? 'MOM' : ''} ${t.volumeConfirmation ? 'VOL' : ''} @ ${t.keyLevel}`,
    ),
  ];

  return {
    metal,
    overallBias,
    confluenceScore,
    agreeing,
    total,
    alignment,
    timeframes,
    tradeable,
    bestEntry,
    reasoning,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function avg(data: number[]): number {
  return data.length > 0 ? data.reduce((a, b) => a + b, 0) / data.length : 0;
}

function calcQuickRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50;
  let avgGain = 0, avgLoss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change; else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcEMA(data: number[], period: number): number {
  if (data.length === 0) return 0;
  const k = 2 / (period + 1);
  let result = data[0];
  for (let i = 1; i < data.length; i++) result = data[i] * k + result * (1 - k);
  return result;
}
