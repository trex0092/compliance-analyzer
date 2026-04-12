// ─── Predictive Intelligence Engine ─────────────────────────────────────────
// Forward-looking price prediction combining: momentum extrapolation,
// mean reversion probability, volatility regime forecasting, order flow
// pressure prediction, and ensemble model fusion.
// This is NOT reactive TA — this PREDICTS where price will be.

import type { Metal, OHLCV, TradeSide } from './types';

// ─── Prediction Types ───────────────────────────────────────────────────────

export interface PricePrediction {
  metal: Metal;
  currentPrice: number;
  predictions: {
    horizon: string; // '5m' | '1h' | '4h' | '1d' | '1w'
    predictedPrice: number;
    confidence: number; // 0-1
    direction: TradeSide;
    expectedMove: number; // absolute
    expectedMovePct: number; // percentage
    modelAgreement: number; // how many models agree (0-1)
  }[];
  dominantModel: string;
  regime: string;
  timestamp: number;
}

export interface ModelOutput {
  name: string;
  predictedPrice: number;
  confidence: number;
  weight: number;
}

// ─── Model 1: Momentum Extrapolation (Hurst Exponent) ──────────────────────
// If H > 0.5, trending — momentum continues.
// If H < 0.5, mean-reverting — momentum will fade.
// If H = 0.5, random walk — no edge.

export function hurstExponent(prices: number[]): number {
  if (prices.length < 20) return 0.5;

  const n = prices.length;
  const logReturns = [];
  for (let i = 1; i < n; i++) {
    logReturns.push(Math.log(prices[i] / prices[i - 1]));
  }

  // R/S analysis
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const deviations = logReturns.map((r) => r - mean);

  // Cumulative deviations
  const cumDev: number[] = [];
  let cumSum = 0;
  for (const d of deviations) {
    cumSum += d;
    cumDev.push(cumSum);
  }

  const range = Math.max(...cumDev) - Math.min(...cumDev);
  const stdDev = Math.sqrt(deviations.reduce((s, d) => s + d * d, 0) / deviations.length);

  if (stdDev === 0) return 0.5;
  const rs = range / stdDev;

  // H = log(R/S) / log(n)
  const h = Math.log(rs) / Math.log(logReturns.length);
  return Math.max(0, Math.min(1, h));
}

export function momentumExtrapolation(candles: OHLCV[], horizonBars: number): ModelOutput {
  const closes = candles.map((c) => c.close);
  const h = hurstExponent(closes);
  const currentPrice = closes[closes.length - 1];

  // Recent momentum (last 20 bars)
  const recentMomentum =
    closes.length >= 20
      ? (closes[closes.length - 1] - closes[closes.length - 20]) / closes[closes.length - 20]
      : 0;

  let extrapolatedMove: number;
  let confidence: number;

  if (h > 0.55) {
    // Trending — extrapolate momentum forward
    const decayFactor = Math.pow(0.95, horizonBars / 20); // momentum decays
    extrapolatedMove = recentMomentum * decayFactor * (horizonBars / 20);
    confidence = Math.min((h - 0.5) * 4, 0.85); // higher H = more confidence
  } else if (h < 0.45) {
    // Mean-reverting — expect reversal
    extrapolatedMove = -recentMomentum * 0.5 * (horizonBars / 20);
    confidence = Math.min((0.5 - h) * 4, 0.75);
  } else {
    // Random walk — no reliable prediction
    extrapolatedMove = 0;
    confidence = 0.15;
  }

  return {
    name: `MOMENTUM (H=${h.toFixed(2)})`,
    predictedPrice: currentPrice * (1 + extrapolatedMove),
    confidence,
    weight: h > 0.55 ? 0.35 : h < 0.45 ? 0.25 : 0.1,
  };
}

// ─── Model 2: Mean Reversion Probability ───────────────────────────────────
// Calculates z-score of current price vs rolling mean.
// Extreme z-scores predict snapback.

export function meanReversionModel(candles: OHLCV[], period: number = 50): ModelOutput {
  const closes = candles.map((c) => c.close);
  if (closes.length < period) {
    return {
      name: 'MEAN_REVERSION',
      predictedPrice: closes[closes.length - 1],
      confidence: 0,
      weight: 0,
    };
  }

  const currentPrice = closes[closes.length - 1];
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const stdDev = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);

  if (stdDev === 0) {
    return { name: 'MEAN_REVERSION', predictedPrice: currentPrice, confidence: 0, weight: 0 };
  }

  const zScore = (currentPrice - mean) / stdDev;

  // Beyond 2 sigma = high probability of reversion
  let predictedPrice = currentPrice;
  let confidence = 0;

  if (Math.abs(zScore) > 2.5) {
    // Extreme deviation — strong reversion expected
    predictedPrice = mean + stdDev * Math.sign(zScore) * 1.0; // expect snap to 1 sigma
    confidence = 0.75;
  } else if (Math.abs(zScore) > 2.0) {
    predictedPrice = mean + stdDev * Math.sign(zScore) * 1.5;
    confidence = 0.55;
  } else if (Math.abs(zScore) > 1.5) {
    predictedPrice = mean + stdDev * Math.sign(zScore) * 1.0;
    confidence = 0.35;
  } else {
    confidence = 0.1;
  }

  return {
    name: `MEAN_REV (z=${zScore.toFixed(2)})`,
    predictedPrice,
    confidence,
    weight: Math.abs(zScore) > 2 ? 0.3 : 0.15,
  };
}

// ─── Model 3: Volatility Regime Forecast (GARCH-like) ──────────────────────
// Predicts whether volatility will expand or contract.
// High vol → expect contraction (mean reversion of vol).
// Low vol → expect expansion (breakout coming).

export function volatilityForecast(candles: OHLCV[]): {
  currentVol: number;
  forecastedVol: number;
  volRegime: 'EXPANDING' | 'CONTRACTING' | 'STABLE';
  volPercentile: number;
} {
  const closes = candles.map((c) => c.close);
  if (closes.length < 30) {
    return { currentVol: 0, forecastedVol: 0, volRegime: 'STABLE', volPercentile: 50 };
  }

  // Calculate rolling volatility
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }

  // Short-term vol (5-bar)
  const recentReturns = returns.slice(-5);
  const shortVol = Math.sqrt(recentReturns.reduce((s, r) => s + r * r, 0) / recentReturns.length);

  // Long-term vol (30-bar)
  const longReturns = returns.slice(-30);
  const longVol = Math.sqrt(longReturns.reduce((s, r) => s + r * r, 0) / longReturns.length);

  // EWMA volatility forecast (lambda = 0.94, like RiskMetrics)
  const lambda = 0.94;
  let ewmaVar = longVol * longVol;
  for (const r of returns.slice(-20)) {
    ewmaVar = lambda * ewmaVar + (1 - lambda) * r * r;
  }
  const forecastedVol = Math.sqrt(ewmaVar);

  // Vol percentile (where is current vol relative to history?)
  const allVols: number[] = [];
  for (let i = 20; i < returns.length; i++) {
    const windowReturns = returns.slice(i - 20, i);
    const vol = Math.sqrt(windowReturns.reduce((s, r) => s + r * r, 0) / windowReturns.length);
    allVols.push(vol);
  }
  allVols.sort((a, b) => a - b);
  const rank = allVols.filter((v) => v <= shortVol).length;
  const volPercentile = allVols.length > 0 ? (rank / allVols.length) * 100 : 50;

  const volRegime =
    shortVol > longVol * 1.3 ? 'EXPANDING' : shortVol < longVol * 0.7 ? 'CONTRACTING' : 'STABLE';

  return { currentVol: shortVol, forecastedVol, volRegime, volPercentile };
}

// ─── Model 4: Order Flow Pressure Predictor ────────────────────────────────
// Uses cumulative delta (buy vol - sell vol) trend to predict
// near-term price direction. Divergence = reversal signal.

export function orderFlowPredictor(
  prices: number[],
  buyVolumes: number[],
  sellVolumes: number[]
): ModelOutput {
  const n = Math.min(prices.length, buyVolumes.length, sellVolumes.length);
  if (n < 10) {
    return {
      name: 'ORDER_FLOW',
      predictedPrice: prices[prices.length - 1] ?? 0,
      confidence: 0,
      weight: 0,
    };
  }

  const currentPrice = prices[n - 1];

  // Cumulative delta
  const cumDelta: number[] = [];
  let delta = 0;
  for (let i = 0; i < n; i++) {
    delta += buyVolumes[i] - sellVolumes[i];
    cumDelta.push(delta);
  }

  // Recent delta trend (last 10 bars)
  const recentDelta = cumDelta.slice(-10);
  const deltaSlope = linearRegSlope(recentDelta);

  // Price trend (last 10 bars)
  const recentPrices = prices.slice(-10);
  const priceSlope = linearRegSlope(recentPrices);

  // Divergence detection
  const priceTrend = priceSlope > 0 ? 'UP' : 'DOWN';
  const flowTrend = deltaSlope > 0 ? 'UP' : 'DOWN';
  const isDivergent = priceTrend !== flowTrend;

  let predictedMove = 0;
  let confidence = 0;

  if (isDivergent) {
    // Flow diverges from price — flow usually leads
    // If price up but delta down → bearish divergence → expect down
    // If price down but delta up → bullish divergence → expect up
    predictedMove = deltaSlope > 0 ? currentPrice * 0.003 : -currentPrice * 0.003;
    confidence = 0.65;
  } else {
    // Confirmation — momentum continues
    predictedMove = deltaSlope > 0 ? currentPrice * 0.001 : -currentPrice * 0.001;
    confidence = 0.4;
  }

  return {
    name: isDivergent ? 'FLOW_DIVERGENCE' : 'FLOW_CONFIRM',
    predictedPrice: currentPrice + predictedMove,
    confidence,
    weight: isDivergent ? 0.3 : 0.15,
  };
}

function linearRegSlope(data: number[]): number {
  const n = data.length;
  if (n < 2) return 0;
  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += data[i];
    sumXY += i * data[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  return denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
}

// ─── Model 5: Support/Resistance Magnet Model ─────────────────────────────
// Price is attracted to high-volume levels (POC from volume profile).
// Predicts price will migrate toward nearest high-volume node.

export function magnetModel(
  currentPrice: number,
  poc: number,
  valueAreaHigh: number,
  valueAreaLow: number,
  _atr: number
): ModelOutput {
  const distToPOC = poc - currentPrice;
  const distPct = Math.abs(distToPOC) / currentPrice;

  // If price is within value area, predict drift toward POC
  // If price is outside value area, predict it will re-enter
  let predictedPrice = currentPrice;
  let confidence = 0;

  if (currentPrice > valueAreaHigh) {
    // Above value area — gravity pulls back
    predictedPrice = valueAreaHigh;
    confidence = 0.5;
  } else if (currentPrice < valueAreaLow) {
    // Below value area — gravity pulls back
    predictedPrice = valueAreaLow;
    confidence = 0.5;
  } else if (distPct > 0.005) {
    // Inside value area but away from POC — drift toward POC
    predictedPrice = currentPrice + distToPOC * 0.3;
    confidence = 0.35;
  } else {
    // At POC — expect consolidation
    predictedPrice = currentPrice;
    confidence = 0.2;
  }

  return {
    name: 'MAGNET (VP)',
    predictedPrice,
    confidence,
    weight: 0.15,
  };
}

// ─── Ensemble Prediction ────────────────────────────────────────────────────

export function ensemblePrediction(
  metal: Metal,
  candles: OHLCV[],
  horizonBars: number,
  poc: number,
  vaHigh: number,
  vaLow: number,
  buyVolumes?: number[],
  sellVolumes?: number[]
): PricePrediction {
  const closes = candles.map((c) => c.close);
  const currentPrice = closes[closes.length - 1] ?? 0;

  const models: ModelOutput[] = [];

  // Run all models
  models.push(momentumExtrapolation(candles, horizonBars));
  models.push(meanReversionModel(candles));

  const atr = candles.length >= 15 ? calculateSimpleATR(candles, 14) : currentPrice * 0.01;
  models.push(magnetModel(currentPrice, poc, vaHigh, vaLow, atr));

  if (buyVolumes && sellVolumes) {
    models.push(orderFlowPredictor(closes, buyVolumes, sellVolumes));
  }

  // Weighted ensemble
  let totalWeight = 0;
  let weightedPrice = 0;
  let totalConfidence = 0;
  let buyVotes = 0;
  let sellVotes = 0;

  for (const model of models) {
    if (model.confidence < 0.1) continue;
    const w = model.weight * model.confidence;
    weightedPrice += model.predictedPrice * w;
    totalWeight += w;
    totalConfidence += model.confidence * model.weight;

    if (model.predictedPrice > currentPrice) buyVotes += model.weight;
    else if (model.predictedPrice < currentPrice) sellVotes += model.weight;
  }

  const ensemblePrice = totalWeight > 0 ? weightedPrice / totalWeight : currentPrice;
  const ensembleConfidence = Math.min(totalConfidence, 0.9);
  const direction: TradeSide = ensemblePrice >= currentPrice ? 'BUY' : 'SELL';
  const totalVotes = buyVotes + sellVotes;
  const modelAgreement = totalVotes > 0 ? Math.max(buyVotes, sellVotes) / totalVotes : 0;

  // Volatility forecast for confidence adjustment
  const volForecast = volatilityForecast(candles);

  // Dominant model
  const dominant = models.reduce((a, b) =>
    a.weight * a.confidence > b.weight * b.confidence ? a : b
  );

  const horizonMap: Record<number, string> = { 1: '5m', 12: '1h', 48: '4h', 288: '1d', 2016: '1w' };
  const horizonLabel = horizonMap[horizonBars] ?? `${horizonBars}bars`;

  return {
    metal,
    currentPrice,
    predictions: [
      {
        horizon: horizonLabel,
        predictedPrice: ensemblePrice,
        confidence: ensembleConfidence,
        direction,
        expectedMove: ensemblePrice - currentPrice,
        expectedMovePct:
          currentPrice > 0 ? ((ensemblePrice - currentPrice) / currentPrice) * 100 : 0,
        modelAgreement,
      },
    ],
    dominantModel: dominant.name,
    regime: volForecast.volRegime,
    timestamp: Date.now(),
  };
}

function calculateSimpleATR(candles: OHLCV[], period: number): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      )
    );
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}
