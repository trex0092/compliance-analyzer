// ─── Risk Matrix: Trading Risk Management & Circuit Breakers ────────────────
// Position sizing (Kelly, fixed fractional, volatility-adjusted), stop loss
// management, circuit breakers, correlation monitoring, drawdown protection.

import type { Metal, RiskLimits, CircuitBreaker, Portfolio, TradeSide } from './types';

// ─── Default Risk Limits ────────────────────────────────────────────────────

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxPositionSize: 1000, // 1000 troy oz
  maxPortfolioExposure: 5_000_000,
  maxLossPerTrade: 5_000,
  maxDailyLoss: 25_000,
  maxDrawdownPct: 10,
  maxConcentration: 0.6, // 60% in one metal
  maxLeverage: 10,
  maxOpenOrders: 20,
  maxDailyTrades: 100,
  cooldownAfterLoss: 300_000, // 5 min cooldown
};

// ─── Position Sizing Strategies ─────────────────────────────────────────────

export interface PositionSizeResult {
  quantity: number; // troy ounces
  dollarValue: number;
  riskAmount: number; // max $ at risk
  method: string;
  reasoning: string;
}

export function kellyPositionSize(
  winRate: number,
  avgWin: number,
  avgLoss: number,
  portfolioValue: number,
  currentPrice: number,
  fractionMultiplier: number = 0.25 // quarter-Kelly for safety
): PositionSizeResult {
  if (avgLoss === 0 || avgWin === 0) {
    return {
      quantity: 0,
      dollarValue: 0,
      riskAmount: 0,
      method: 'KELLY',
      reasoning: 'Insufficient trade history',
    };
  }

  const kelly = (winRate * avgWin - (1 - winRate) * avgLoss) / avgWin;
  const adjustedKelly = Math.max(0, kelly * fractionMultiplier);
  const dollarAllocation = portfolioValue * adjustedKelly;
  const quantity = currentPrice > 0 ? Math.floor(dollarAllocation / currentPrice) : 0;

  return {
    quantity,
    dollarValue: quantity * currentPrice,
    riskAmount: dollarAllocation * (1 - winRate),
    method: 'KELLY',
    reasoning: `Kelly: ${(kelly * 100).toFixed(1)}%, Adj: ${(adjustedKelly * 100).toFixed(1)}% (${fractionMultiplier}x)`,
  };
}

export function fixedFractionalSize(
  portfolioValue: number,
  riskPct: number,
  currentPrice: number,
  stopDistance: number
): PositionSizeResult {
  const riskAmount = portfolioValue * (riskPct / 100);
  const quantity = stopDistance > 0 ? Math.floor(riskAmount / stopDistance) : 0;

  return {
    quantity,
    dollarValue: quantity * currentPrice,
    riskAmount,
    method: 'FIXED_FRACTIONAL',
    reasoning: `Risk ${riskPct}% = $${riskAmount.toFixed(0)}, stop distance $${stopDistance.toFixed(2)}`,
  };
}

export function volatilityAdjustedSize(
  portfolioValue: number,
  targetVolPct: number,
  atr14: number,
  currentPrice: number
): PositionSizeResult {
  if (atr14 === 0 || currentPrice === 0) {
    return {
      quantity: 0,
      dollarValue: 0,
      riskAmount: 0,
      method: 'VOL_ADJUSTED',
      reasoning: 'Insufficient volatility data',
    };
  }

  const dollarVolPerUnit = atr14;
  const targetDollarVol = portfolioValue * (targetVolPct / 100);
  const quantity = Math.floor(targetDollarVol / dollarVolPerUnit);

  return {
    quantity,
    dollarValue: quantity * currentPrice,
    riskAmount: targetDollarVol,
    method: 'VOL_ADJUSTED',
    reasoning: `ATR: $${atr14.toFixed(2)}, target vol: ${targetVolPct}% = $${targetDollarVol.toFixed(0)}`,
  };
}

// ─── Stop Loss Management ───────────────────────────────────────────────────

export interface StopLossConfig {
  type: 'ATR' | 'PERCENT' | 'SUPPORT' | 'TRAILING' | 'CHANDELIER';
  atrMultiplier: number;
  percentDistance: number;
  trailingPct: number;
  chandelierPeriod: number;
}

export function calculateStopLoss(
  entryPrice: number,
  side: TradeSide,
  config: StopLossConfig,
  atr14: number,
  supportLevel?: number,
  resistanceLevel?: number,
  highestSinceEntry?: number,
  lowestSinceEntry?: number
): number {
  switch (config.type) {
    case 'ATR':
      return side === 'BUY'
        ? entryPrice - atr14 * config.atrMultiplier
        : entryPrice + atr14 * config.atrMultiplier;

    case 'PERCENT':
      return side === 'BUY'
        ? entryPrice * (1 - config.percentDistance / 100)
        : entryPrice * (1 + config.percentDistance / 100);

    case 'SUPPORT':
      if (side === 'BUY' && supportLevel) return supportLevel - atr14 * 0.5;
      if (side === 'SELL' && resistanceLevel) return resistanceLevel + atr14 * 0.5;
      // Fallback to ATR
      return side === 'BUY'
        ? entryPrice - atr14 * config.atrMultiplier
        : entryPrice + atr14 * config.atrMultiplier;

    case 'TRAILING':
      if (side === 'BUY' && highestSinceEntry) {
        return highestSinceEntry * (1 - config.trailingPct / 100);
      }
      if (side === 'SELL' && lowestSinceEntry) {
        return lowestSinceEntry * (1 + config.trailingPct / 100);
      }
      return side === 'BUY'
        ? entryPrice * (1 - config.trailingPct / 100)
        : entryPrice * (1 + config.trailingPct / 100);

    case 'CHANDELIER':
      if (side === 'BUY' && highestSinceEntry) {
        return highestSinceEntry - atr14 * config.atrMultiplier;
      }
      if (side === 'SELL' && lowestSinceEntry) {
        return lowestSinceEntry + atr14 * config.atrMultiplier;
      }
      return side === 'BUY'
        ? entryPrice - atr14 * config.atrMultiplier
        : entryPrice + atr14 * config.atrMultiplier;
  }
}

// ─── Circuit Breakers ───────────────────────────────────────────────────────

export class CircuitBreakerEngine {
  private breakers: CircuitBreaker[] = [];

  constructor(limits: RiskLimits) {
    this.breakers = [
      {
        id: 'CB-DAILY-LOSS',
        type: 'DAILY_LOSS',
        threshold: limits.maxDailyLoss,
        currentValue: 0,
        triggered: false,
        action: 'HALT_TRADING',
      },
      {
        id: 'CB-DRAWDOWN',
        type: 'DRAWDOWN',
        threshold: limits.maxDrawdownPct,
        currentValue: 0,
        triggered: false,
        action: 'REDUCE_SIZE',
      },
      {
        id: 'CB-VOL-SPIKE',
        type: 'VOLATILITY_SPIKE',
        threshold: 3.0, // 3x normal volatility
        currentValue: 1.0,
        triggered: false,
        action: 'REDUCE_SIZE',
      },
      {
        id: 'CB-RAPID-LOSS',
        type: 'RAPID_LOSS',
        threshold: 3, // 3 consecutive losses
        currentValue: 0,
        triggered: false,
        action: 'HALT_TRADING',
        cooldownUntil: undefined,
      },
      {
        id: 'CB-CORRELATION',
        type: 'CORRELATION_BREAK',
        threshold: 0.3, // correlation drop
        currentValue: 0,
        triggered: false,
        action: 'ALERT_ONLY',
      },
    ];
  }

  update(metrics: {
    dailyPnL: number;
    drawdownPct: number;
    volatilityRatio: number;
    consecutiveLosses: number;
    correlationShift: number;
  }): CircuitBreaker[] {
    const now = Date.now();
    const triggered: CircuitBreaker[] = [];

    for (const cb of this.breakers) {
      // Skip if in cooldown
      if (cb.cooldownUntil && now < cb.cooldownUntil) continue;

      switch (cb.type) {
        case 'DAILY_LOSS':
          cb.currentValue = Math.abs(metrics.dailyPnL);
          break;
        case 'DRAWDOWN':
          cb.currentValue = metrics.drawdownPct;
          break;
        case 'VOLATILITY_SPIKE':
          cb.currentValue = metrics.volatilityRatio;
          break;
        case 'RAPID_LOSS':
          cb.currentValue = metrics.consecutiveLosses;
          break;
        case 'CORRELATION_BREAK':
          cb.currentValue = metrics.correlationShift;
          break;
      }

      const wasTriggered = cb.triggered;
      cb.triggered = cb.currentValue >= cb.threshold;

      if (cb.triggered && !wasTriggered) {
        cb.triggeredAt = now;
        cb.cooldownUntil = now + 300_000; // 5 min cooldown after trigger
        triggered.push(cb);
      }
    }

    return triggered;
  }

  getAll(): CircuitBreaker[] {
    return this.breakers;
  }

  getTriggered(): CircuitBreaker[] {
    return this.breakers.filter((cb) => cb.triggered);
  }

  isTradingHalted(): boolean {
    return this.breakers.some((cb) => cb.triggered && cb.action === 'HALT_TRADING');
  }

  isSizeReduced(): boolean {
    return this.breakers.some((cb) => cb.triggered && cb.action === 'REDUCE_SIZE');
  }

  getSizeMultiplier(): number {
    if (this.isTradingHalted()) return 0;
    if (this.isSizeReduced()) return 0.5;
    return 1.0;
  }

  reset(breakerId: string): void {
    const cb = this.breakers.find((b) => b.id === breakerId);
    if (cb) {
      cb.triggered = false;
      cb.triggeredAt = undefined;
      cb.cooldownUntil = undefined;
    }
  }

  resetAll(): void {
    for (const cb of this.breakers) {
      cb.triggered = false;
      cb.triggeredAt = undefined;
      cb.cooldownUntil = undefined;
    }
  }
}

// ─── Pre-Trade Risk Check ───────────────────────────────────────────────────

export interface RiskCheckResult {
  approved: boolean;
  reason: string;
  adjustedQuantity?: number;
  warnings: string[];
}

export function preTradeRiskCheck(
  metal: Metal,
  side: TradeSide,
  quantity: number,
  price: number,
  portfolio: Portfolio,
  limits: RiskLimits,
  circuitBreakers: CircuitBreakerEngine
): RiskCheckResult {
  const warnings: string[] = [];
  let adjustedQty = quantity;

  // 1. Circuit breaker check
  if (circuitBreakers.isTradingHalted()) {
    return { approved: false, reason: 'Trading halted by circuit breaker', warnings };
  }

  // 2. Size reduction
  const sizeMultiplier = circuitBreakers.getSizeMultiplier();
  if (sizeMultiplier < 1) {
    adjustedQty = Math.floor(quantity * sizeMultiplier);
    warnings.push(`Size reduced to ${sizeMultiplier * 100}% by circuit breaker`);
  }

  // 3. Position size limit
  if (adjustedQty > limits.maxPositionSize) {
    adjustedQty = limits.maxPositionSize;
    warnings.push(`Capped at max position size: ${limits.maxPositionSize} oz`);
  }

  // 4. Portfolio exposure limit
  const newExposure = portfolio.totalMarketValue + adjustedQty * price;
  if (newExposure > limits.maxPortfolioExposure) {
    const maxQty = Math.floor((limits.maxPortfolioExposure - portfolio.totalMarketValue) / price);
    if (maxQty <= 0) {
      return { approved: false, reason: 'Portfolio exposure limit reached', warnings };
    }
    adjustedQty = maxQty;
    warnings.push('Reduced to fit portfolio exposure limit');
  }

  // 5. Concentration check
  const metalExposure = portfolio.exposureByMetal[metal] + adjustedQty * price;
  const totalAfter = portfolio.totalMarketValue + adjustedQty * price;
  if (totalAfter > 0 && metalExposure / totalAfter > limits.maxConcentration) {
    warnings.push(`${metal} concentration would exceed ${limits.maxConcentration * 100}%`);
  }

  // 6. Margin check
  const marginNeeded = adjustedQty * price * 0.1;
  if (marginNeeded > portfolio.marginAvailable) {
    const maxQty = Math.floor(portfolio.marginAvailable / (price * 0.1));
    if (maxQty <= 0) {
      return { approved: false, reason: 'Insufficient margin', warnings };
    }
    adjustedQty = maxQty;
    warnings.push('Reduced to available margin');
  }

  // 7. Daily trade limit
  if (portfolio.positions.length >= limits.maxOpenOrders) {
    return { approved: false, reason: 'Max open orders reached', warnings };
  }

  return {
    approved: true,
    reason: 'Approved',
    adjustedQuantity: adjustedQty !== quantity ? adjustedQty : undefined,
    warnings,
  };
}
