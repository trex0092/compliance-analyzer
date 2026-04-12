// ─── Signal Fusion Engine: Multi-Signal Decision Making ─────────────────────
// Combines technical, microstructure, arbitrage, flow, pattern, seasonal,
// and macro signals into a unified trading decision with confidence scoring.

import type {
  Metal, TradeSide, MarketRegime, SignalStrength,
  TradingSignal, FusedDecision, TAIndicators, FlowMetrics,
  ArbitrageOpportunity, PatternDetection, PriceQuote, RiskMetrics,
} from './types';

// ─── Signal Weights (configurable) ─────────────────────────────────────────

const DEFAULT_WEIGHTS: Record<TradingSignal['source'], number> = {
  TECHNICAL:      0.25,
  MICROSTRUCTURE: 0.20,
  FLOW:           0.15,
  PATTERN:        0.15,
  ARBITRAGE:      0.10,
  SENTIMENT:      0.05,
  SEASONAL:       0.05,
  MACRO:          0.05,
};

// ─── Regime Detection ───────────────────────────────────────────────────────

export function detectRegime(indicators: TAIndicators, prices: number[]): MarketRegime {
  const { adx14, bollingerBands, atr14, rsi14 } = indicators;
  const lastPrice = prices[prices.length - 1] ?? 0;

  // Volatility expansion
  const bbWidth = bollingerBands.width;
  const highVol = bbWidth > 0.04;

  // Trend strength
  const strongTrend = adx14 > 25;

  if (highVol && !strongTrend) return 'HIGH_VOLATILITY';

  if (strongTrend) {
    // Check direction using MAs
    const above50 = lastPrice > indicators.sma[50];
    const above200 = lastPrice > indicators.sma[200];

    if (above50 && above200) return 'TRENDING_UP';
    if (!above50 && !above200) return 'TRENDING_DOWN';
  }

  // Breakout detection
  if (lastPrice > bollingerBands.upper) return 'BREAKOUT';
  if (lastPrice < bollingerBands.lower) return 'BREAKOUT';

  // Mean reversion conditions
  if (rsi14 < 30 || rsi14 > 70) return 'MEAN_REVERSION';

  return 'RANGING';
}

// ─── Signal Generation ──────────────────────────────────────────────────────

export function generateTechnicalSignal(
  metal: Metal, indicators: TAIndicators, currentPrice: number,
): TradingSignal | null {
  let score = 0;
  const reasons: string[] = [];

  // Trend alignment
  if (currentPrice > indicators.sma[200]) { score += 2; reasons.push('Above SMA200'); }
  else { score -= 2; reasons.push('Below SMA200'); }

  if (currentPrice > indicators.sma[50]) score += 1;
  else score -= 1;

  // RSI
  if (indicators.rsi14 < 30) { score += 2; reasons.push('RSI oversold'); }
  else if (indicators.rsi14 > 70) { score -= 2; reasons.push('RSI overbought'); }

  // MACD
  if (indicators.macd.histogram > 0) { score += 1; reasons.push('MACD bullish'); }
  else { score -= 1; reasons.push('MACD bearish'); }

  // Bollinger
  if (currentPrice <= indicators.bollingerBands.lower) { score += 1.5; reasons.push('At lower BB'); }
  else if (currentPrice >= indicators.bollingerBands.upper) { score -= 1.5; reasons.push('At upper BB'); }

  const direction: TradeSide = score >= 0 ? 'BUY' : 'SELL';
  const confidence = Math.min(Math.abs(score) / 8, 1);
  if (confidence < 0.2) return null;

  const stopDistance = indicators.atr14 * 2;

  return {
    id: `SIG-TECH-${metal}-${Date.now()}`,
    source: 'TECHNICAL',
    metal,
    direction,
    strength: confidenceToStrength(confidence),
    confidence,
    weight: DEFAULT_WEIGHTS.TECHNICAL,
    entryPrice: currentPrice,
    targetPrice: direction === 'BUY'
      ? currentPrice + indicators.atr14 * 3
      : currentPrice - indicators.atr14 * 3,
    stopLoss: direction === 'BUY'
      ? currentPrice - stopDistance
      : currentPrice + stopDistance,
    riskReward: 1.5,
    timeHorizon: '4h',
    reasoning: reasons.join(', '),
    timestamp: Date.now(),
    expiresAt: Date.now() + 14_400_000, // 4h
  };
}

export function generateFlowSignal(
  metal: Metal, flow: FlowMetrics, currentPrice: number, atr: number,
): TradingSignal | null {
  let score = 0;
  const reasons: string[] = [];

  // Smart money direction
  if (flow.smartMoneyDirection === 'BUY') { score += 3; reasons.push('Smart money buying'); }
  else if (flow.smartMoneyDirection === 'SELL') { score -= 3; reasons.push('Smart money selling'); }

  // Flow imbalance
  if (Math.abs(flow.tradeFlowImbalance) > 0.3) {
    score += flow.tradeFlowImbalance > 0 ? 2 : -2;
    reasons.push(`Flow imbalance: ${(flow.tradeFlowImbalance * 100).toFixed(0)}%`);
  }

  // Toxicity check
  if (flow.toxicity > 0.7) {
    score *= 0.5; // Reduce conviction when flow is toxic
    reasons.push(`High toxicity: ${(flow.toxicity * 100).toFixed(0)}%`);
  }

  // Smart vs retail divergence
  if (flow.smartMoneyDirection !== 'NEUTRAL' && flow.retailDirection !== 'NEUTRAL' &&
      flow.smartMoneyDirection !== flow.retailDirection) {
    score += flow.smartMoneyDirection === 'BUY' ? 1.5 : -1.5;
    reasons.push('Smart/retail divergence');
  }

  const direction: TradeSide = score >= 0 ? 'BUY' : 'SELL';
  const confidence = Math.min(Math.abs(score) / 7, 1);
  if (confidence < 0.2) return null;

  return {
    id: `SIG-FLOW-${metal}-${Date.now()}`,
    source: 'FLOW',
    metal,
    direction,
    strength: confidenceToStrength(confidence),
    confidence,
    weight: DEFAULT_WEIGHTS.FLOW,
    entryPrice: currentPrice,
    targetPrice: direction === 'BUY' ? currentPrice + atr * 2 : currentPrice - atr * 2,
    stopLoss: direction === 'BUY' ? currentPrice - atr * 1.5 : currentPrice + atr * 1.5,
    riskReward: 1.33,
    timeHorizon: '1h',
    reasoning: reasons.join(', '),
    timestamp: Date.now(),
    expiresAt: Date.now() + 3_600_000,
  };
}

export function generateMicrostructureSignal(
  metal: Metal, flow: FlowMetrics, bookImbalance: number,
  currentPrice: number, atr: number,
): TradingSignal | null {
  let score = 0;
  const reasons: string[] = [];

  // Order book imbalance
  if (Math.abs(bookImbalance) > 0.3) {
    score += bookImbalance > 0 ? 2 : -2;
    reasons.push(`Book imbalance: ${(bookImbalance * 100).toFixed(0)}%`);
  }

  // VPIN
  if (flow.vpin > 0.6) {
    reasons.push(`High VPIN: ${(flow.vpin * 100).toFixed(0)}%`);
    // Informed trading detected - follow the direction
    if (flow.netFlow > 0) score += 1.5;
    else if (flow.netFlow < 0) score -= 1.5;
  }

  // Large trade activity
  if (flow.largeTradeCount > 5) {
    const largeDirection = flow.buyVolume > flow.sellVolume ? 1 : -1;
    score += largeDirection * 1;
    reasons.push(`${flow.largeTradeCount} large trades`);
  }

  const direction: TradeSide = score >= 0 ? 'BUY' : 'SELL';
  const confidence = Math.min(Math.abs(score) / 5, 1);
  if (confidence < 0.25) return null;

  return {
    id: `SIG-MICRO-${metal}-${Date.now()}`,
    source: 'MICROSTRUCTURE',
    metal,
    direction,
    strength: confidenceToStrength(confidence),
    confidence,
    weight: DEFAULT_WEIGHTS.MICROSTRUCTURE,
    entryPrice: currentPrice,
    targetPrice: direction === 'BUY' ? currentPrice + atr * 1.5 : currentPrice - atr * 1.5,
    stopLoss: direction === 'BUY' ? currentPrice - atr : currentPrice + atr,
    riskReward: 1.5,
    timeHorizon: '15m',
    reasoning: reasons.join(', '),
    timestamp: Date.now(),
    expiresAt: Date.now() + 900_000,
  };
}

export function generatePatternSignal(
  metal: Metal, patterns: PatternDetection[], currentPrice: number,
): TradingSignal | null {
  if (patterns.length === 0) return null;

  // Take highest confidence pattern
  const best = patterns.reduce((a, b) => a.confidence > b.confidence ? a : b);

  return {
    id: `SIG-PAT-${metal}-${Date.now()}`,
    source: 'PATTERN',
    metal,
    direction: best.direction === 'BULLISH' ? 'BUY' : 'SELL',
    strength: confidenceToStrength(best.confidence),
    confidence: best.confidence,
    weight: DEFAULT_WEIGHTS.PATTERN,
    entryPrice: best.entryPrice,
    targetPrice: best.targetPrice,
    stopLoss: best.stopPrice,
    riskReward: best.riskReward,
    timeHorizon: '4h',
    reasoning: `${best.pattern} (${best.type}) — R:R ${best.riskReward.toFixed(1)}`,
    timestamp: Date.now(),
    expiresAt: Date.now() + 14_400_000,
  };
}

// ─── Signal Fusion ──────────────────────────────────────────────────────────

export function fuseSignals(
  metal: Metal,
  signals: TradingSignal[],
  regime: MarketRegime,
  riskMetrics: RiskMetrics,
  currentPrice: number,
  weights: Record<TradingSignal['source'], number> = DEFAULT_WEIGHTS,
): FusedDecision {
  if (signals.length === 0) {
    return emptyDecision(metal, regime, currentPrice);
  }

  // Regime-adjusted weights
  const adjustedWeights = { ...weights };
  switch (regime) {
    case 'TRENDING_UP':
    case 'TRENDING_DOWN':
      adjustedWeights.TECHNICAL *= 1.3;
      adjustedWeights.PATTERN *= 1.2;
      adjustedWeights.MICROSTRUCTURE *= 0.8;
      break;
    case 'RANGING':
    case 'MEAN_REVERSION':
      adjustedWeights.MICROSTRUCTURE *= 1.3;
      adjustedWeights.FLOW *= 1.2;
      adjustedWeights.TECHNICAL *= 0.8;
      break;
    case 'HIGH_VOLATILITY':
      adjustedWeights.FLOW *= 1.3;
      adjustedWeights.MICROSTRUCTURE *= 1.2;
      adjustedWeights.PATTERN *= 0.7;
      break;
    case 'BREAKOUT':
      adjustedWeights.TECHNICAL *= 1.4;
      adjustedWeights.FLOW *= 1.2;
      break;
  }

  // Normalize weights
  const totalWeight = Object.values(adjustedWeights).reduce((a, b) => a + b, 0);
  for (const key of Object.keys(adjustedWeights) as TradingSignal['source'][]) {
    adjustedWeights[key] /= totalWeight;
  }

  // Weighted score
  let buyScore = 0;
  let sellScore = 0;
  let totalSignalWeight = 0;
  let weightedEntry = 0;
  let weightedTarget = 0;
  let weightedStop = 0;

  for (const sig of signals) {
    const w = (adjustedWeights[sig.source] ?? 0) * sig.confidence;
    if (sig.direction === 'BUY') buyScore += w;
    else sellScore += w;
    totalSignalWeight += w;

    weightedEntry += sig.entryPrice * w;
    weightedTarget += sig.targetPrice * w;
    weightedStop += sig.stopLoss * w;
  }

  const direction: TradeSide = buyScore >= sellScore ? 'BUY' : 'SELL';
  const conviction = totalSignalWeight > 0
    ? Math.abs(buyScore - sellScore) / totalSignalWeight
    : 0;

  // Signal alignment (do they agree?)
  const buySignals = signals.filter(s => s.direction === 'BUY').length;
  const sellSignals = signals.filter(s => s.direction === 'SELL').length;
  const signalAlignment = signals.length > 0
    ? Math.max(buySignals, sellSignals) / signals.length
    : 0;

  const entryPrice = totalSignalWeight > 0 ? weightedEntry / totalSignalWeight : currentPrice;
  const targetPrice = totalSignalWeight > 0 ? weightedTarget / totalSignalWeight : currentPrice;
  const stopLoss = totalSignalWeight > 0 ? weightedStop / totalSignalWeight : currentPrice;

  const riskReward = Math.abs(entryPrice - stopLoss) > 0
    ? Math.abs(targetPrice - entryPrice) / Math.abs(entryPrice - stopLoss)
    : 0;

  // Position sizing via Kelly or adjusted
  const kellySize = riskMetrics.kellyFraction * riskMetrics.optimalPositionSize;
  const positionSize = kellySize * conviction * signalAlignment;

  // Expected value
  const winProb = conviction * signalAlignment;
  const potentialWin = Math.abs(targetPrice - entryPrice);
  const potentialLoss = Math.abs(entryPrice - stopLoss);
  const expectedValue = winProb * potentialWin - (1 - winProb) * potentialLoss;

  const reasoning: string[] = [
    `Regime: ${regime}`,
    `Signals: ${buySignals} BUY / ${sellSignals} SELL (alignment: ${(signalAlignment * 100).toFixed(0)}%)`,
    `Conviction: ${(conviction * 100).toFixed(1)}%`,
    `R:R ${riskReward.toFixed(2)}, EV: $${expectedValue.toFixed(2)}`,
    ...signals.map(s => `[${s.source}] ${s.direction} (${(s.confidence * 100).toFixed(0)}%): ${s.reasoning}`),
  ];

  return {
    id: `DEC-${metal}-${Date.now()}`,
    metal,
    direction,
    conviction,
    regime,
    signals,
    signalAlignment,
    entryPrice,
    targetPrice,
    stopLoss,
    positionSize,
    riskReward,
    expectedValue,
    kellySize,
    reasoning,
    complianceCheck: { cleared: true, flags: [] },
    timestamp: Date.now(),
  };
}

function emptyDecision(metal: Metal, regime: MarketRegime, price: number): FusedDecision {
  return {
    id: `DEC-${metal}-${Date.now()}`,
    metal,
    direction: 'BUY',
    conviction: 0,
    regime,
    signals: [],
    signalAlignment: 0,
    entryPrice: price,
    targetPrice: price,
    stopLoss: price,
    positionSize: 0,
    riskReward: 0,
    expectedValue: 0,
    kellySize: 0,
    reasoning: ['No signals generated — standing aside'],
    complianceCheck: { cleared: true, flags: [] },
    timestamp: Date.now(),
  };
}

function confidenceToStrength(confidence: number): SignalStrength {
  if (confidence >= 0.85) return 'ULTRA_STRONG';
  if (confidence >= 0.65) return 'STRONG';
  if (confidence >= 0.45) return 'MODERATE';
  if (confidence >= 0.25) return 'WEAK';
  return 'NEUTRAL';
}
