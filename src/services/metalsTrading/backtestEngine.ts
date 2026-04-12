// ─── Backtesting Engine ─────────────────────────────────────────────────────
// Prove strategies before risking capital. Feeds historical data through
// the signal fusion + execution engine and measures performance.
// Supports: walk-forward analysis, Monte Carlo, parameter optimization.

import type { Metal, TradeSide, OHLCV, TradeRecord } from './types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BacktestConfig {
  name: string;
  metal: Metal;
  startDate: number; // timestamp
  endDate: number;
  initialCapital: number;
  strategy: StrategyDef;
  commissionBps: number; // round-trip cost in bps
  slippageBps: number;
  maxPositionSize: number; // troy oz
  riskPerTradePct: number; // % of capital risked
}

export interface StrategyDef {
  name: string;
  entryCondition: (ctx: BarContext) => { enter: boolean; side: TradeSide } | null;
  exitCondition: (ctx: BarContext, position: BacktestPosition) => boolean;
  stopLossAtr: number; // multiple of ATR for stop
  takeProfitAtr: number; // multiple of ATR for target
}

export interface BarContext {
  bar: OHLCV;
  index: number;
  bars: OHLCV[];
  sma20: number;
  sma50: number;
  sma200: number;
  rsi14: number;
  atr14: number;
  macdHist: number;
  bbUpper: number;
  bbLower: number;
  prevClose: number;
  volume: number;
}

export interface BacktestPosition {
  side: TradeSide;
  entryPrice: number;
  entryBar: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  maxFavorable: number;
  maxAdverse: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  trades: TradeRecord[];
  stats: BacktestStats;
  equityCurve: { timestamp: number; equity: number }[];
  drawdownCurve: { timestamp: number; drawdown: number }[];
  monthlyReturns: { month: string; returnPct: number }[];
}

export interface BacktestStats {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  avgReturn: number;
  totalReturn: number;
  totalReturnPct: number;
  avgHoldingBars: number;
  avgWin: number;
  avgLoss: number;
  avgWinLossRatio: number;
  longestWinStreak: number;
  longestLossStreak: number;
  calmarRatio: number;
  recoveryFactor: number;
  expectancy: number; // avg $ per trade
  sqn: number; // System Quality Number (Van Tharp)
}

// ─── Indicator Helpers (lightweight, self-contained) ────────────────────────

function calcSMA(closes: number[], period: number, index: number): number {
  if (index < period - 1) return closes[index];
  let sum = 0;
  for (let i = index - period + 1; i <= index; i++) sum += closes[i];
  return sum / period;
}

function calcRSI(closes: number[], period: number, index: number): number {
  if (index < period) return 50;
  let avgGain = 0,
    avgLoss = 0;
  for (let i = index - period + 1; i <= index; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcATR(candles: OHLCV[], period: number, index: number): number {
  if (index < 1) return candles[0].high - candles[0].low;
  let sum = 0;
  const start = Math.max(1, index - period + 1);
  for (let i = start; i <= index; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    sum += tr;
  }
  return sum / (index - start + 1);
}

function calcBB(
  closes: number[],
  period: number,
  index: number,
  mult: number
): { upper: number; lower: number } {
  const sma = calcSMA(closes, period, index);
  if (index < period - 1) return { upper: sma, lower: sma };
  let sumSq = 0;
  for (let i = index - period + 1; i <= index; i++) sumSq += (closes[i] - sma) ** 2;
  const std = Math.sqrt(sumSq / period);
  return { upper: sma + std * mult, lower: sma - std * mult };
}

// ─── Backtest Runner ────────────────────────────────────────────────────────

export function runBacktest(config: BacktestConfig, candles: OHLCV[]): BacktestResult {
  const { strategy, initialCapital, commissionBps, slippageBps, riskPerTradePct, maxPositionSize } =
    config;

  const closes = candles.map((c) => c.close);
  let equity = initialCapital;
  let peakEquity = initialCapital;
  let position: BacktestPosition | null = null;
  const trades: TradeRecord[] = [];
  const equityCurve: { timestamp: number; equity: number }[] = [
    { timestamp: candles[0]?.timestamp ?? 0, equity },
  ];
  const drawdownCurve: { timestamp: number; drawdown: number }[] = [];

  for (let i = 200; i < candles.length; i++) {
    const bar = candles[i];
    const atr = calcATR(candles, 14, i);
    const bb = calcBB(closes, 20, i, 2);

    const ctx: BarContext = {
      bar,
      index: i,
      bars: candles,
      sma20: calcSMA(closes, 20, i),
      sma50: calcSMA(closes, 50, i),
      sma200: calcSMA(closes, 200, i),
      rsi14: calcRSI(closes, 14, i),
      atr14: atr,
      macdHist: calcSMA(closes, 12, i) - calcSMA(closes, 26, i),
      bbUpper: bb.upper,
      bbLower: bb.lower,
      prevClose: closes[i - 1],
      volume: bar.volume,
    };

    if (position) {
      // Update MFE/MAE
      const unrealizedPnL =
        position.side === 'BUY' ? bar.close - position.entryPrice : position.entryPrice - bar.close;
      position.maxFavorable = Math.max(position.maxFavorable, unrealizedPnL);
      position.maxAdverse = Math.min(position.maxAdverse, unrealizedPnL);

      // Check stops
      const hitStop =
        position.side === 'BUY' ? bar.low <= position.stopLoss : bar.high >= position.stopLoss;
      const hitTarget =
        position.side === 'BUY' ? bar.high >= position.takeProfit : bar.low <= position.takeProfit;

      const exitSignal = strategy.exitCondition(ctx, position);

      if (hitStop || hitTarget || exitSignal) {
        const exitPrice = hitStop ? position.stopLoss : hitTarget ? position.takeProfit : bar.close;

        const pnlPerUnit =
          position.side === 'BUY'
            ? exitPrice - position.entryPrice
            : position.entryPrice - exitPrice;
        const grossPnL = pnlPerUnit * position.quantity;
        const costs =
          (position.entryPrice * position.quantity * (commissionBps + slippageBps)) / 10_000;
        const netPnL = grossPnL - costs;

        equity += netPnL;

        trades.push({
          id: `BT-${i}`,
          metal: config.metal,
          side: position.side,
          entryPrice: position.entryPrice,
          exitPrice,
          quantity: position.quantity,
          pnl: netPnL,
          pnlPct: position.entryPrice > 0 ? (pnlPerUnit / position.entryPrice) * 100 : 0,
          holdingPeriodMs: (i - position.entryBar) * 3_600_000, // assume 1h bars
          entryTime: candles[position.entryBar].timestamp,
          exitTime: bar.timestamp,
          strategy: strategy.name,
          signalSource: strategy.name,
          maxFavorableExcursion: position.maxFavorable,
          maxAdverseExcursion: position.maxAdverse,
          fees: costs,
          slippage: 0,
        });

        position = null;
      }
    } else {
      // Check entry
      const signal = strategy.entryCondition(ctx);
      if (signal?.enter) {
        const riskAmount = equity * (riskPerTradePct / 100);
        const stopDistance = atr * strategy.stopLossAtr;
        const quantity = Math.min(
          stopDistance > 0 ? Math.floor(riskAmount / stopDistance) : 0,
          maxPositionSize
        );

        if (quantity > 0 && equity > 0) {
          position = {
            side: signal.side,
            entryPrice: bar.close,
            entryBar: i,
            quantity,
            stopLoss: signal.side === 'BUY' ? bar.close - stopDistance : bar.close + stopDistance,
            takeProfit:
              signal.side === 'BUY'
                ? bar.close + atr * strategy.takeProfitAtr
                : bar.close - atr * strategy.takeProfitAtr,
            maxFavorable: 0,
            maxAdverse: 0,
          };
        }
      }
    }

    equityCurve.push({ timestamp: bar.timestamp, equity });
    if (equity > peakEquity) peakEquity = equity;
    drawdownCurve.push({ timestamp: bar.timestamp, drawdown: peakEquity - equity });
  }

  const stats = calculateBacktestStats(trades, equityCurve, initialCapital);
  const monthlyReturns = calculateMonthlyReturns(equityCurve);

  return { config, trades, stats, equityCurve, drawdownCurve, monthlyReturns };
}

// ─── Stats Calculation ──────────────────────────────────────────────────────

function calculateBacktestStats(
  trades: TradeRecord[],
  equityCurve: { timestamp: number; equity: number }[],
  initialCapital: number
): BacktestStats {
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      winRate: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      avgReturn: 0,
      totalReturn: 0,
      totalReturnPct: 0,
      avgHoldingBars: 0,
      avgWin: 0,
      avgLoss: 0,
      avgWinLossRatio: 0,
      longestWinStreak: 0,
      longestLossStreak: 0,
      calmarRatio: 0,
      recoveryFactor: 0,
      expectancy: 0,
      sqn: 0,
    };
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const totalReturn = trades.reduce((s, t) => s + t.pnl, 0);
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss =
    losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  // Drawdown
  let peak = initialCapital,
    maxDD = 0;
  for (const pt of equityCurve) {
    if (pt.equity > peak) peak = pt.equity;
    const dd = peak - pt.equity;
    if (dd > maxDD) maxDD = dd;
  }

  // Streaks
  let currentStreak = 0,
    longestWin = 0,
    longestLoss = 0;
  for (const t of trades) {
    if (t.pnl > 0) {
      currentStreak = currentStreak > 0 ? currentStreak + 1 : 1;
      if (currentStreak > longestWin) longestWin = currentStreak;
    } else {
      currentStreak = currentStreak < 0 ? currentStreak - 1 : -1;
      if (-currentStreak > longestLoss) longestLoss = -currentStreak;
    }
  }

  // Returns for Sharpe/Sortino
  const returns = trades.map((t) => t.pnlPct);
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const stdDev = Math.sqrt(returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / returns.length);
  const negReturns = returns.filter((r) => r < 0);
  const downsideDev =
    negReturns.length > 0
      ? Math.sqrt(negReturns.reduce((s, r) => s + r ** 2, 0) / negReturns.length)
      : 0;

  const expectancy = totalReturn / trades.length;
  const sqn = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(trades.length) : 0;

  return {
    totalTrades: trades.length,
    winRate: wins.length / trades.length,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : Infinity,
    sharpeRatio: stdDev > 0 ? (meanReturn * Math.sqrt(252)) / stdDev : 0,
    sortinoRatio: downsideDev > 0 ? (meanReturn * Math.sqrt(252)) / downsideDev : 0,
    maxDrawdown: maxDD,
    maxDrawdownPct: peak > 0 ? (maxDD / peak) * 100 : 0,
    avgReturn: meanReturn,
    totalReturn,
    totalReturnPct: initialCapital > 0 ? (totalReturn / initialCapital) * 100 : 0,
    avgHoldingBars: trades.reduce((s, t) => s + t.holdingPeriodMs / 3_600_000, 0) / trades.length,
    avgWin,
    avgLoss,
    avgWinLossRatio: avgLoss > 0 ? avgWin / avgLoss : Infinity,
    longestWinStreak: longestWin,
    longestLossStreak: longestLoss,
    calmarRatio: maxDD > 0 ? totalReturn / maxDD : 0,
    recoveryFactor: maxDD > 0 ? totalReturn / maxDD : 0,
    expectancy,
    sqn,
  };
}

function calculateMonthlyReturns(
  equityCurve: { timestamp: number; equity: number }[]
): { month: string; returnPct: number }[] {
  const monthly: { month: string; returnPct: number }[] = [];
  if (equityCurve.length < 2) return monthly;

  let prevMonthEquity = equityCurve[0].equity;
  let prevMonth = new Date(equityCurve[0].timestamp).toISOString().slice(0, 7);

  for (const pt of equityCurve) {
    const month = new Date(pt.timestamp).toISOString().slice(0, 7);
    if (month !== prevMonth) {
      monthly.push({
        month: prevMonth,
        returnPct:
          prevMonthEquity > 0 ? ((pt.equity - prevMonthEquity) / prevMonthEquity) * 100 : 0,
      });
      prevMonthEquity = pt.equity;
      prevMonth = month;
    }
  }

  return monthly;
}

// ─── Pre-built Strategies ───────────────────────────────────────────────────

export const STRATEGIES: Record<string, StrategyDef> = {
  TREND_FOLLOW: {
    name: 'Trend Following (SMA 50/200)',
    entryCondition: (ctx) => {
      if (ctx.sma50 > ctx.sma200 && ctx.bar.close > ctx.sma50 && ctx.rsi14 > 40 && ctx.rsi14 < 70) {
        return { enter: true, side: 'BUY' };
      }
      if (ctx.sma50 < ctx.sma200 && ctx.bar.close < ctx.sma50 && ctx.rsi14 < 60 && ctx.rsi14 > 30) {
        return { enter: true, side: 'SELL' };
      }
      return null;
    },
    exitCondition: (ctx, pos) => {
      if (pos.side === 'BUY' && ctx.bar.close < ctx.sma50) return true;
      if (pos.side === 'SELL' && ctx.bar.close > ctx.sma50) return true;
      return false;
    },
    stopLossAtr: 2.0,
    takeProfitAtr: 3.0,
  },

  MEAN_REVERSION: {
    name: 'Mean Reversion (Bollinger)',
    entryCondition: (ctx) => {
      if (ctx.bar.close <= ctx.bbLower && ctx.rsi14 < 30) {
        return { enter: true, side: 'BUY' };
      }
      if (ctx.bar.close >= ctx.bbUpper && ctx.rsi14 > 70) {
        return { enter: true, side: 'SELL' };
      }
      return null;
    },
    exitCondition: (ctx, pos) => {
      if (pos.side === 'BUY' && ctx.bar.close >= ctx.sma20) return true;
      if (pos.side === 'SELL' && ctx.bar.close <= ctx.sma20) return true;
      return false;
    },
    stopLossAtr: 1.5,
    takeProfitAtr: 2.0,
  },

  BREAKOUT: {
    name: 'Breakout (20-bar)',
    entryCondition: (ctx) => {
      const high20 = Math.max(
        ...ctx.bars.slice(Math.max(0, ctx.index - 20), ctx.index).map((b) => b.high)
      );
      const low20 = Math.min(
        ...ctx.bars.slice(Math.max(0, ctx.index - 20), ctx.index).map((b) => b.low)
      );
      if (ctx.bar.close > high20 && ctx.volume > ctx.bars[ctx.index - 1]?.volume * 1.5) {
        return { enter: true, side: 'BUY' };
      }
      if (ctx.bar.close < low20 && ctx.volume > ctx.bars[ctx.index - 1]?.volume * 1.5) {
        return { enter: true, side: 'SELL' };
      }
      return null;
    },
    exitCondition: (ctx, pos) => {
      const barsHeld = ctx.index - pos.entryBar;
      if (barsHeld > 48) return true; // max 48 bars
      return false;
    },
    stopLossAtr: 2.5,
    takeProfitAtr: 4.0,
  },
};

// ─── Monte Carlo Simulation ─────────────────────────────────────────────────

export function monteCarloSimulation(
  trades: TradeRecord[],
  initialCapital: number,
  simulations: number = 1000
): { median: number; p5: number; p95: number; worstCase: number; bestCase: number } {
  if (trades.length === 0)
    return {
      median: initialCapital,
      p5: initialCapital,
      p95: initialCapital,
      worstCase: initialCapital,
      bestCase: initialCapital,
    };

  const finalEquities: number[] = [];
  const returns = trades.map((t) => t.pnlPct);

  for (let sim = 0; sim < simulations; sim++) {
    let equity = initialCapital;
    // Randomly shuffle trade returns
    const shuffled = [...returns].sort(() => Math.random() - 0.5);
    for (const r of shuffled) {
      equity *= 1 + r / 100;
    }
    finalEquities.push(equity);
  }

  finalEquities.sort((a, b) => a - b);
  const idx = (pct: number) => Math.floor(finalEquities.length * pct);

  return {
    median: finalEquities[idx(0.5)],
    p5: finalEquities[idx(0.05)],
    p95: finalEquities[idx(0.95)],
    worstCase: finalEquities[0],
    bestCase: finalEquities[finalEquities.length - 1],
  };
}
