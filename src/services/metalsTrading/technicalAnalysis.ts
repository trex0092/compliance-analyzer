// ─── Technical Analysis Engine for Precious Metals ──────────────────────────
// Full suite: MA, RSI, MACD, Bollinger, Stochastic, ATR, ADX, Ichimoku,
// Fibonacci, Pivot Points, Volume Profile, Support/Resistance, Pattern Detection

import type { OHLCV, TAIndicators, PatternDetection, Metal, TradeSide } from './types';

// ─── Core Indicator Functions ───────────────────────────────────────────────

export function sma(data: number[], period: number): number {
  if (data.length < period) return data[data.length - 1] ?? 0;
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function ema(data: number[], period: number): number {
  if (data.length === 0) return 0;
  const k = 2 / (period + 1);
  let result = data[0];
  for (let i = 1; i < data.length; i++) {
    result = data[i] * k + result * (1 - k);
  }
  return result;
}

export function wma(data: number[], period: number): number {
  if (data.length < period) return data[data.length - 1] ?? 0;
  const slice = data.slice(-period);
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < slice.length; i++) {
    const w = i + 1;
    weightedSum += slice[i] * w;
    totalWeight += w;
  }
  return weightedSum / totalWeight;
}

// ─── RSI ────────────────────────────────────────────────────────────────────

export function rsi(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ─── MACD ───────────────────────────────────────────────────────────────────

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9
): { value: number; signal: number; histogram: number } {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const macdLine = fastEma - slowEma;

  // Build MACD line history for signal
  const macdHistory: number[] = [];
  for (let i = slow; i <= closes.length; i++) {
    const fEma = ema(closes.slice(0, i), fast);
    const sEma = ema(closes.slice(0, i), slow);
    macdHistory.push(fEma - sEma);
  }

  const signalLine = ema(macdHistory, signal);
  return { value: macdLine, signal: signalLine, histogram: macdLine - signalLine };
}

// ─── Bollinger Bands ────────────────────────────────────────────────────────

export function bollingerBands(
  closes: number[],
  period = 20,
  stdDevMultiplier = 2
): { upper: number; middle: number; lower: number; width: number } {
  const middle = sma(closes, period);
  const slice = closes.slice(-period);
  const stdDev = Math.sqrt(slice.reduce((sum, v) => sum + (v - middle) ** 2, 0) / period);

  const upper = middle + stdDev * stdDevMultiplier;
  const lower = middle - stdDev * stdDevMultiplier;
  return { upper, middle, lower, width: middle > 0 ? (upper - lower) / middle : 0 };
}

// ─── Stochastic Oscillator ──────────────────────────────────────────────────

export function stochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod = 14,
  dPeriod = 3
): { k: number; d: number } {
  if (closes.length < kPeriod) return { k: 50, d: 50 };

  const kValues: number[] = [];
  for (let i = kPeriod - 1; i < closes.length; i++) {
    const periodHighs = highs.slice(i - kPeriod + 1, i + 1);
    const periodLows = lows.slice(i - kPeriod + 1, i + 1);
    const high = Math.max(...periodHighs);
    const low = Math.min(...periodLows);
    const range = high - low;
    kValues.push(range > 0 ? ((closes[i] - low) / range) * 100 : 50);
  }

  const k = kValues[kValues.length - 1];
  const d = sma(kValues, dPeriod);
  return { k, d };
}

// ─── ATR (Average True Range) ───────────────────────────────────────────────

export function atr(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (closes.length < 2) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }

  return sma(trueRanges, period);
}

// ─── ADX (Average Directional Index) ────────────────────────────────────────

export function adx(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (closes.length < period * 2) return 25;

  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const trueRanges: number[] = [];

  for (let i = 1; i < highs.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trueRanges.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      )
    );
  }

  const smoothedPlusDM = ema(plusDM, period);
  const smoothedMinusDM = ema(minusDM, period);
  const smoothedTR = ema(trueRanges, period);

  const plusDI = smoothedTR > 0 ? (smoothedPlusDM / smoothedTR) * 100 : 0;
  const minusDI = smoothedTR > 0 ? (smoothedMinusDM / smoothedTR) * 100 : 0;

  const diSum = plusDI + minusDI;
  const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
  return dx;
}

// ─── OBV (On-Balance Volume) ────────────────────────────────────────────────

export function obv(closes: number[], volumes: number[]): number {
  let result = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) result += volumes[i];
    else if (closes[i] < closes[i - 1]) result -= volumes[i];
  }
  return result;
}

// ─── Ichimoku Cloud ─────────────────────────────────────────────────────────

export function ichimoku(
  highs: number[],
  lows: number[],
  closes: number[]
): { tenkan: number; kijun: number; senkouA: number; senkouB: number; chikou: number } {
  const midpoint = (arr: number[], period: number) => {
    const slice = arr.slice(-period);
    return (Math.max(...slice) + Math.min(...slice)) / 2;
  };

  const tenkan = midpoint(closes, 9);
  const kijun = midpoint(closes, 26);
  const senkouA = (tenkan + kijun) / 2;
  const senkouB = midpoint(closes, 52);
  const chikou = closes[closes.length - 1] ?? 0;

  return { tenkan, kijun, senkouA, senkouB, chikou };
}

// ─── Fibonacci Retracement ──────────────────────────────────────────────────

export function fibonacci(
  highs: number[],
  lows: number[]
): { levels: number[]; trend: 'UP' | 'DOWN' } {
  const recentHigh = Math.max(...highs.slice(-50));
  const recentLow = Math.min(...lows.slice(-50));
  const lastClose = highs[highs.length - 1];
  const trend = lastClose > (recentHigh + recentLow) / 2 ? 'UP' : 'DOWN';
  const range = recentHigh - recentLow;

  const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
  const levels =
    trend === 'UP'
      ? fibLevels.map((f) => recentHigh - range * f)
      : fibLevels.map((f) => recentLow + range * f);

  return { levels, trend };
}

// ─── Pivot Points ───────────────────────────────────────────────────────────

export function pivotPoints(
  high: number,
  low: number,
  close: number
): { pivot: number; r1: number; r2: number; r3: number; s1: number; s2: number; s3: number } {
  const pivot = (high + low + close) / 3;
  return {
    pivot,
    r1: 2 * pivot - low,
    r2: pivot + (high - low),
    r3: high + 2 * (pivot - low),
    s1: 2 * pivot - high,
    s2: pivot - (high - low),
    s3: low - 2 * (high - pivot),
  };
}

// ─── Volume Profile ─────────────────────────────────────────────────────────

export function volumeProfile(
  candles: OHLCV[],
  bins = 50
): { poc: number; valueAreaHigh: number; valueAreaLow: number } {
  if (candles.length === 0) return { poc: 0, valueAreaHigh: 0, valueAreaLow: 0 };

  const allPrices = candles.flatMap((c) => [c.high, c.low]);
  const priceHigh = Math.max(...allPrices);
  const priceLow = Math.min(...allPrices);
  const binSize = (priceHigh - priceLow) / bins;

  const volumeByBin = new Array(bins).fill(0);
  for (const candle of candles) {
    const midPrice = (candle.high + candle.low) / 2;
    const bin = Math.min(Math.floor((midPrice - priceLow) / binSize), bins - 1);
    volumeByBin[bin] += candle.volume;
  }

  const pocBin = volumeByBin.indexOf(Math.max(...volumeByBin));
  const poc = priceLow + (pocBin + 0.5) * binSize;

  // Value area = 70% of volume around POC
  const totalVolume = volumeByBin.reduce((a, b) => a + b, 0);
  const targetVolume = totalVolume * 0.7;
  let areaVolume = volumeByBin[pocBin];
  let lower = pocBin,
    upper = pocBin;

  while (areaVolume < targetVolume && (lower > 0 || upper < bins - 1)) {
    const addLower = lower > 0 ? volumeByBin[lower - 1] : 0;
    const addUpper = upper < bins - 1 ? volumeByBin[upper + 1] : 0;
    if (addLower >= addUpper && lower > 0) {
      lower--;
      areaVolume += addLower;
    } else if (upper < bins - 1) {
      upper++;
      areaVolume += addUpper;
    } else break;
  }

  return {
    poc,
    valueAreaHigh: priceLow + (upper + 1) * binSize,
    valueAreaLow: priceLow + lower * binSize,
  };
}

// ─── Support & Resistance Detection ─────────────────────────────────────────

export function detectSupportResistance(
  candles: OHLCV[],
  sensitivity = 3
): { support: number[]; resistance: number[] } {
  if (candles.length < sensitivity * 2 + 1) return { support: [], resistance: [] };

  const support: number[] = [];
  const resistance: number[] = [];

  for (let i = sensitivity; i < candles.length - sensitivity; i++) {
    const current = candles[i];
    let isLocalMin = true;
    let isLocalMax = true;

    for (let j = i - sensitivity; j <= i + sensitivity; j++) {
      if (j === i) continue;
      if (candles[j].low <= current.low) isLocalMin = false;
      if (candles[j].high >= current.high) isLocalMax = false;
    }

    if (isLocalMin) support.push(current.low);
    if (isLocalMax) resistance.push(current.high);
  }

  return { support: dedup(support, 0.005), resistance: dedup(resistance, 0.005) };
}

function dedup(levels: number[], tolerance: number): number[] {
  const result: number[] = [];
  for (const level of levels.sort((a, b) => a - b)) {
    const last = result[result.length - 1];
    if (last === undefined || Math.abs(level - last) / last > tolerance) {
      result.push(level);
    }
  }
  return result;
}

// ─── Pattern Detection ──────────────────────────────────────────────────────

export function detectPatterns(candles: OHLCV[]): PatternDetection[] {
  const patterns: PatternDetection[] = [];
  if (candles.length < 20) return patterns;

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const lastClose = closes[closes.length - 1];
  const atrVal = atr(highs, lows, closes);

  // Double Bottom
  const recentLows = lows.slice(-30);
  const minIdx1 = recentLows.indexOf(Math.min(...recentLows.slice(0, 15)));
  const minIdx2 = recentLows.indexOf(Math.min(...recentLows.slice(15)));
  if (
    minIdx2 > minIdx1 &&
    Math.abs(recentLows[minIdx1] - recentLows[minIdx2]) / recentLows[minIdx1] < 0.02
  ) {
    const neckline = Math.max(...highs.slice(-30).slice(minIdx1, minIdx2));
    if (lastClose > neckline * 0.99) {
      patterns.push({
        pattern: 'DOUBLE_BOTTOM',
        type: 'REVERSAL',
        direction: 'BULLISH',
        confidence: 0.72,
        entryPrice: lastClose,
        targetPrice: neckline + (neckline - recentLows[minIdx1]),
        stopPrice: recentLows[minIdx2] - atrVal,
        riskReward: 2.0,
        detectedAt: Date.now(),
      });
    }
  }

  // Breakout detection
  const high20 = Math.max(...highs.slice(-20));
  const low20 = Math.min(...lows.slice(-20));
  const range20 = high20 - low20;
  if (lastClose > high20 - range20 * 0.05) {
    patterns.push({
      pattern: 'BREAKOUT_HIGH',
      type: 'CONTINUATION',
      direction: 'BULLISH',
      confidence: 0.65,
      entryPrice: lastClose,
      targetPrice: lastClose + range20,
      stopPrice: high20 - range20 * 0.3,
      riskReward: range20 / (range20 * 0.3),
      detectedAt: Date.now(),
    });
  }

  if (lastClose < low20 + range20 * 0.05) {
    patterns.push({
      pattern: 'BREAKOUT_LOW',
      type: 'CONTINUATION',
      direction: 'BEARISH',
      confidence: 0.65,
      entryPrice: lastClose,
      targetPrice: lastClose - range20,
      stopPrice: low20 + range20 * 0.3,
      riskReward: range20 / (range20 * 0.3),
      detectedAt: Date.now(),
    });
  }

  // Engulfing candle
  if (candles.length >= 2) {
    const prev = candles[candles.length - 2];
    const curr = candles[candles.length - 1];
    if (
      prev.close < prev.open &&
      curr.close > curr.open &&
      curr.open <= prev.close &&
      curr.close >= prev.open
    ) {
      patterns.push({
        pattern: 'BULLISH_ENGULFING',
        type: 'REVERSAL',
        direction: 'BULLISH',
        confidence: 0.6,
        entryPrice: curr.close,
        targetPrice: curr.close + atrVal * 2,
        stopPrice: curr.low - atrVal * 0.5,
        riskReward: 2.0,
        detectedAt: Date.now(),
      });
    }
    if (
      prev.close > prev.open &&
      curr.close < curr.open &&
      curr.open >= prev.close &&
      curr.close <= prev.open
    ) {
      patterns.push({
        pattern: 'BEARISH_ENGULFING',
        type: 'REVERSAL',
        direction: 'BEARISH',
        confidence: 0.6,
        entryPrice: curr.close,
        targetPrice: curr.close - atrVal * 2,
        stopPrice: curr.high + atrVal * 0.5,
        riskReward: 2.0,
        detectedAt: Date.now(),
      });
    }
  }

  return patterns;
}

// ─── Full Indicator Suite ───────────────────────────────────────────────────

export function computeAllIndicators(candles: OHLCV[], metal: Metal): TAIndicators {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);

  const lastCandle = candles[candles.length - 1];
  const sr = detectSupportResistance(candles);
  const vp = volumeProfile(candles);
  const fib = fibonacci(highs, lows);
  const pp = lastCandle
    ? pivotPoints(lastCandle.high, lastCandle.low, lastCandle.close)
    : pivotPoints(0, 0, 0);

  return {
    metal,
    timestamp: Date.now(),
    sma: {
      20: sma(closes, 20),
      50: sma(closes, 50),
      100: sma(closes, 100),
      200: sma(closes, 200),
    },
    ema: {
      9: ema(closes, 9),
      20: ema(closes, 20),
      50: ema(closes, 50),
      200: ema(closes, 200),
    },
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    bollingerBands: bollingerBands(closes),
    stochastic: stochastic(highs, lows, closes),
    atr14: atr(highs, lows, closes, 14),
    adx14: adx(highs, lows, closes, 14),
    obv: obv(closes, volumes),
    vwap:
      volumes.reduce((s, v, i) => s + closes[i] * v, 0) / (volumes.reduce((a, b) => a + b, 0) || 1),
    fibonacci: fib,
    pivotPoints: pp,
    ichimoku: ichimoku(highs, lows, closes),
    volumeProfile: vp,
    supportLevels: sr.support.slice(-5),
    resistanceLevels: sr.resistance.slice(-5),
  };
}

// ─── Signal Generation from TA ──────────────────────────────────────────────

export function generateTASignals(
  indicators: TAIndicators,
  currentPrice: number
): {
  direction: TradeSide;
  strength: number;
  reasons: string[];
} {
  let score = 0;
  const reasons: string[] = [];

  // Moving average alignment
  if (currentPrice > indicators.sma[200] && currentPrice > indicators.sma[50]) {
    score += 2;
    reasons.push('Price above SMA 50 & 200 — bullish trend');
  } else if (currentPrice < indicators.sma[200] && currentPrice < indicators.sma[50]) {
    score -= 2;
    reasons.push('Price below SMA 50 & 200 — bearish trend');
  }

  // RSI
  if (indicators.rsi14 < 30) {
    score += 1.5;
    reasons.push(`RSI ${indicators.rsi14.toFixed(1)} — oversold`);
  } else if (indicators.rsi14 > 70) {
    score -= 1.5;
    reasons.push(`RSI ${indicators.rsi14.toFixed(1)} — overbought`);
  }

  // MACD
  if (indicators.macd.histogram > 0 && indicators.macd.value > indicators.macd.signal) {
    score += 1;
    reasons.push('MACD bullish crossover');
  } else if (indicators.macd.histogram < 0 && indicators.macd.value < indicators.macd.signal) {
    score -= 1;
    reasons.push('MACD bearish crossover');
  }

  // Bollinger position
  if (currentPrice <= indicators.bollingerBands.lower) {
    score += 1;
    reasons.push('Price at lower Bollinger Band — potential bounce');
  } else if (currentPrice >= indicators.bollingerBands.upper) {
    score -= 1;
    reasons.push('Price at upper Bollinger Band — potential rejection');
  }

  // Stochastic
  if (indicators.stochastic.k < 20 && indicators.stochastic.k > indicators.stochastic.d) {
    score += 1;
    reasons.push('Stochastic bullish crossover in oversold');
  } else if (indicators.stochastic.k > 80 && indicators.stochastic.k < indicators.stochastic.d) {
    score -= 1;
    reasons.push('Stochastic bearish crossover in overbought');
  }

  // ADX trend strength
  if (indicators.adx14 > 25) {
    reasons.push(`ADX ${indicators.adx14.toFixed(1)} — strong trend`);
    score *= 1.2;
  }

  // Ichimoku
  if (currentPrice > indicators.ichimoku.senkouA && currentPrice > indicators.ichimoku.senkouB) {
    score += 0.5;
    reasons.push('Price above Ichimoku cloud — bullish');
  } else if (
    currentPrice < indicators.ichimoku.senkouA &&
    currentPrice < indicators.ichimoku.senkouB
  ) {
    score -= 0.5;
    reasons.push('Price below Ichimoku cloud — bearish');
  }

  const direction: TradeSide = score >= 0 ? 'BUY' : 'SELL';
  const strength = Math.min(Math.abs(score) / 8, 1);

  return { direction, strength, reasons };
}
