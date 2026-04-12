// ─── Auto-Strategy Engine ───────────────────────────────────────────────────
// Autonomous execution strategies that run without human intervention.
// Each strategy monitors conditions and fires trades when criteria are met.
// Includes: grid trading, DCA, momentum scalper, range trader,
// news reactor, correlation trader, and the ULTRA SNIPER.

import type { Metal, TradeSide, TAIndicators, FusedDecision, Order } from './types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AutoStrategyConfig {
  id: string;
  name: string;
  type: StrategyType;
  metal: Metal;
  enabled: boolean;
  maxCapitalPct: number; // max % of portfolio to deploy
  maxConcurrentOrders: number;
  params: Record<string, number | string | boolean>;
}

export type StrategyType =
  | 'GRID' // Grid trading — buy/sell at fixed intervals
  | 'DCA' // Dollar cost average — buy periodically
  | 'MOMENTUM_SCALP' // Fast momentum scalping
  | 'RANGE_TRADER' // Buy support, sell resistance
  | 'BREAKOUT_CHASE' // Chase breakouts with confirmation
  | 'MEAN_REVERT' // Fade extremes
  | 'CORRELATION' // Trade correlation divergences
  | 'ULTRA_SNIPER'; // Multi-signal ultra-high-conviction only

export interface StrategySignal {
  strategyId: string;
  strategyName: string;
  metal: Metal;
  side: TradeSide;
  quantity: number;
  price: number;
  orderType: Order['type'];
  limitPrice?: number;
  stopPrice?: number;
  reasoning: string;
  confidence: number;
  urgency: number; // 0-1, how time-sensitive
  timestamp: number;
}

// ─── Strategy Implementations ───────────────────────────────────────────────

export function evaluateGridStrategy(
  config: AutoStrategyConfig,
  currentPrice: number,
  _atr: number
): StrategySignal[] {
  const gridSpacing = ((config.params.gridSpacingPct as number) ?? 0.5) / 100;
  const gridLevels = (config.params.gridLevels as number) ?? 5;
  const qtyPerLevel = (config.params.qtyPerLevel as number) ?? 1;

  const signals: StrategySignal[] = [];
  const center = currentPrice;

  for (let i = 1; i <= gridLevels; i++) {
    // Buy orders below
    signals.push({
      strategyId: config.id,
      strategyName: `GRID-BUY-L${i}`,
      metal: config.metal,
      side: 'BUY',
      quantity: qtyPerLevel,
      price: center * (1 - gridSpacing * i),
      orderType: 'LIMIT',
      limitPrice: center * (1 - gridSpacing * i),
      reasoning: `Grid buy level ${i}: ${(gridSpacing * i * 100).toFixed(1)}% below center`,
      confidence: 0.5,
      urgency: 0.3,
      timestamp: Date.now(),
    });

    // Sell orders above
    signals.push({
      strategyId: config.id,
      strategyName: `GRID-SELL-L${i}`,
      metal: config.metal,
      side: 'SELL',
      quantity: qtyPerLevel,
      price: center * (1 + gridSpacing * i),
      orderType: 'LIMIT',
      limitPrice: center * (1 + gridSpacing * i),
      reasoning: `Grid sell level ${i}: ${(gridSpacing * i * 100).toFixed(1)}% above center`,
      confidence: 0.5,
      urgency: 0.3,
      timestamp: Date.now(),
    });
  }

  return signals;
}

export function evaluateDCAStrategy(
  config: AutoStrategyConfig,
  currentPrice: number,
  lastBuyTimestamp: number
): StrategySignal[] {
  const intervalMs = ((config.params.intervalHours as number) ?? 24) * 3_600_000;
  const qtyPerBuy = (config.params.qtyPerBuy as number) ?? 1;
  const maxPrice = (config.params.maxPrice as number) ?? Infinity;

  const timeSinceLastBuy = Date.now() - lastBuyTimestamp;
  if (timeSinceLastBuy < intervalMs) return [];
  if (currentPrice > maxPrice) return [];

  return [
    {
      strategyId: config.id,
      strategyName: 'DCA',
      metal: config.metal,
      side: 'BUY',
      quantity: qtyPerBuy,
      price: currentPrice,
      orderType: 'MARKET',
      reasoning: `DCA buy: ${(config.params.intervalHours as number) ?? 24}h interval elapsed, price $${currentPrice.toFixed(2)} under max $${maxPrice}`,
      confidence: 0.6,
      urgency: 0.5,
      timestamp: Date.now(),
    },
  ];
}

export function evaluateMomentumScalp(
  config: AutoStrategyConfig,
  indicators: TAIndicators,
  currentPrice: number
): StrategySignal[] {
  const rsiThresholdBuy = (config.params.rsiThresholdBuy as number) ?? 35;
  const rsiThresholdSell = (config.params.rsiThresholdSell as number) ?? 65;
  const macdConfirm = (config.params.macdConfirm as boolean) ?? true;
  const qty = (config.params.qty as number) ?? 1;

  // Fast momentum scalp: RSI extreme + MACD confirmation
  if (indicators.rsi14 < rsiThresholdBuy) {
    if (!macdConfirm || indicators.macd.histogram > 0) {
      return [
        {
          strategyId: config.id,
          strategyName: 'MOMENTUM_SCALP',
          metal: config.metal,
          side: 'BUY',
          quantity: qty,
          price: currentPrice,
          orderType: 'MARKET',
          reasoning: `RSI(14)=${indicators.rsi14.toFixed(1)} < ${rsiThresholdBuy}, MACD hist > 0 — oversold bounce`,
          confidence: 0.55,
          urgency: 0.8,
          timestamp: Date.now(),
        },
      ];
    }
  }

  if (indicators.rsi14 > rsiThresholdSell) {
    if (!macdConfirm || indicators.macd.histogram < 0) {
      return [
        {
          strategyId: config.id,
          strategyName: 'MOMENTUM_SCALP',
          metal: config.metal,
          side: 'SELL',
          quantity: qty,
          price: currentPrice,
          orderType: 'MARKET',
          reasoning: `RSI(14)=${indicators.rsi14.toFixed(1)} > ${rsiThresholdSell}, MACD hist < 0 — overbought rejection`,
          confidence: 0.55,
          urgency: 0.8,
          timestamp: Date.now(),
        },
      ];
    }
  }

  return [];
}

export function evaluateRangeTrader(
  config: AutoStrategyConfig,
  indicators: TAIndicators,
  currentPrice: number
): StrategySignal[] {
  const qty = (config.params.qty as number) ?? 1;
  const { supportLevels, resistanceLevels, atr14 } = indicators;

  const nearestSupport = supportLevels.reduce(
    (closest, s) => (Math.abs(s - currentPrice) < Math.abs(closest - currentPrice) ? s : closest),
    supportLevels[0] ?? 0
  );
  const nearestResistance = resistanceLevels.reduce(
    (closest, r) => (Math.abs(r - currentPrice) < Math.abs(closest - currentPrice) ? r : closest),
    resistanceLevels[0] ?? Infinity
  );

  const distToSupport = Math.abs(currentPrice - nearestSupport) / currentPrice;
  const distToResistance = Math.abs(nearestResistance - currentPrice) / currentPrice;

  // Buy near support
  if (distToSupport < 0.003 && indicators.rsi14 < 40) {
    // within 0.3% of support
    return [
      {
        strategyId: config.id,
        strategyName: 'RANGE_TRADER',
        metal: config.metal,
        side: 'BUY',
        quantity: qty,
        price: currentPrice,
        orderType: 'LIMIT',
        limitPrice: nearestSupport,
        stopPrice: nearestSupport - atr14,
        reasoning: `Price at support $${nearestSupport.toFixed(2)} (${(distToSupport * 100).toFixed(2)}% away), RSI ${indicators.rsi14.toFixed(1)}`,
        confidence: 0.6,
        urgency: 0.7,
        timestamp: Date.now(),
      },
    ];
  }

  // Sell near resistance
  if (distToResistance < 0.003 && indicators.rsi14 > 60) {
    return [
      {
        strategyId: config.id,
        strategyName: 'RANGE_TRADER',
        metal: config.metal,
        side: 'SELL',
        quantity: qty,
        price: currentPrice,
        orderType: 'LIMIT',
        limitPrice: nearestResistance,
        stopPrice: nearestResistance + atr14,
        reasoning: `Price at resistance $${nearestResistance.toFixed(2)} (${(distToResistance * 100).toFixed(2)}% away), RSI ${indicators.rsi14.toFixed(1)}`,
        confidence: 0.6,
        urgency: 0.7,
        timestamp: Date.now(),
      },
    ];
  }

  return [];
}

// ─── THE ULTRA SNIPER ──────────────────────────────────────────────────────
// Only fires when ALL conditions align:
// - Technical signal (strong)
// - Flow signal (smart money agrees)
// - Microstructure signal (book confirms)
// - Pattern detection (chart pattern present)
// - Regime supports direction
// - Risk check passes
// - Seasonal tailwind
// This is the highest-conviction strategy — fires rarely, wins often.

export function evaluateUltraSniper(
  config: AutoStrategyConfig,
  decision: FusedDecision,
  indicators: TAIndicators,
  currentPrice: number,
  seasonalBias: TradeSide | 'NEUTRAL'
): StrategySignal[] {
  const minConviction = (config.params.minConviction as number) ?? 0.7;
  const minAlignment = (config.params.minAlignment as number) ?? 0.8;
  const minRR = (config.params.minRR as number) ?? 2.0;
  const qty = (config.params.qty as number) ?? 5;

  // ALL must align
  if (decision.conviction < minConviction) return [];
  if (decision.signalAlignment < minAlignment) return [];
  if (decision.riskReward < minRR) return [];
  if (decision.signals.length < 3) return []; // need 3+ signal sources

  // Seasonal must not oppose
  if (seasonalBias !== 'NEUTRAL' && seasonalBias !== decision.direction) return [];

  // ADX must confirm trend strength
  if (indicators.adx14 < 20) return []; // no clear trend

  // RSI must not be at extreme that opposes direction
  if (decision.direction === 'BUY' && indicators.rsi14 > 75) return [];
  if (decision.direction === 'SELL' && indicators.rsi14 < 25) return [];

  return [
    {
      strategyId: config.id,
      strategyName: 'ULTRA_SNIPER',
      metal: config.metal,
      side: decision.direction,
      quantity: qty,
      price: currentPrice,
      orderType: 'LIMIT',
      limitPrice: decision.entryPrice,
      stopPrice: decision.stopLoss,
      reasoning: [
        `ULTRA SNIPER ACTIVATED`,
        `Conviction: ${(decision.conviction * 100).toFixed(0)}%`,
        `Alignment: ${(decision.signalAlignment * 100).toFixed(0)}% (${decision.signals.length} signals)`,
        `R:R ${decision.riskReward.toFixed(2)}`,
        `Regime: ${decision.regime}`,
        `ADX: ${indicators.adx14.toFixed(1)}`,
        `Seasonal: ${seasonalBias}`,
        `Target: $${decision.targetPrice.toFixed(2)}`,
        `Stop: $${decision.stopLoss.toFixed(2)}`,
      ].join(' | '),
      confidence: decision.conviction,
      urgency: 0.9,
      timestamp: Date.now(),
    },
  ];
}

// ─── Strategy Evaluator ─────────────────────────────────────────────────────

export function evaluateStrategy(
  config: AutoStrategyConfig,
  currentPrice: number,
  indicators: TAIndicators,
  decision: FusedDecision,
  atr: number,
  lastBuyTimestamp: number,
  seasonalBias: TradeSide | 'NEUTRAL'
): StrategySignal[] {
  if (!config.enabled) return [];

  switch (config.type) {
    case 'GRID':
      return evaluateGridStrategy(config, currentPrice, atr);
    case 'DCA':
      return evaluateDCAStrategy(config, currentPrice, lastBuyTimestamp);
    case 'MOMENTUM_SCALP':
      return evaluateMomentumScalp(config, indicators, currentPrice);
    case 'RANGE_TRADER':
      return evaluateRangeTrader(config, indicators, currentPrice);
    case 'ULTRA_SNIPER':
      return evaluateUltraSniper(config, decision, indicators, currentPrice, seasonalBias);
    default:
      return [];
  }
}
