// ─── Position Manager: Portfolio Tracking, P&L, Margin, VaR ─────────────────
// Real-time position tracking across metals and venues.
// Kelly criterion sizing, VaR calculation, correlation monitoring.

import type {
  Metal, Venue, TradeSide, Position, Portfolio,
  RiskMetrics, Execution, TradeRecord,
  PerformanceStats, PriceQuote,
} from './types';

// ─── Position Manager ───────────────────────────────────────────────────────

export class PositionManager {
  private positions: Map<string, Position> = new Map(); // key: `${metal}/${venue}`
  private tradeHistory: TradeRecord[] = [];
  private cashBalance: number;
  private initialCapital: number;
  private peakEquity: number;

  constructor(initialCapital: number = 100_000) {
    this.cashBalance = initialCapital;
    this.initialCapital = initialCapital;
    this.peakEquity = initialCapital;
  }

  private posKey(metal: Metal, venue: Venue): string {
    return `${metal}/${venue}`;
  }

  // ─── Execute Trade ──────────────────────────────────────────────────

  applyExecution(exec: Execution): void {
    const key = this.posKey(exec.metal, exec.venue);
    const existing = this.positions.get(key);

    if (exec.side === 'BUY') {
      if (existing && existing.side === 'BUY') {
        // Add to long position
        const totalQty = existing.quantity + exec.quantity;
        const totalCost = existing.avgEntryPrice * existing.quantity + exec.price * exec.quantity;
        existing.avgEntryPrice = totalCost / totalQty;
        existing.quantity = totalQty;
        existing.costBasis = totalCost;
        existing.lastTradeDate = exec.timestamp;
      } else if (existing && existing.side === 'SELL') {
        // Close or flip short
        this.closePartial(key, existing, exec);
      } else {
        // New long
        this.positions.set(key, {
          metal: exec.metal,
          currency: 'USD',
          venue: exec.venue,
          side: 'BUY',
          quantity: exec.quantity,
          avgEntryPrice: exec.price,
          currentPrice: exec.price,
          unrealizedPnL: 0,
          unrealizedPnLPct: 0,
          realizedPnL: 0,
          totalPnL: 0,
          marketValue: exec.price * exec.quantity,
          costBasis: exec.price * exec.quantity,
          openDate: exec.timestamp,
          lastTradeDate: exec.timestamp,
        });
      }
      this.cashBalance -= exec.price * exec.quantity + exec.fees;
    } else {
      // SELL
      if (existing && existing.side === 'SELL') {
        // Add to short
        const totalQty = existing.quantity + exec.quantity;
        const totalCost = existing.avgEntryPrice * existing.quantity + exec.price * exec.quantity;
        existing.avgEntryPrice = totalCost / totalQty;
        existing.quantity = totalQty;
        existing.costBasis = totalCost;
        existing.lastTradeDate = exec.timestamp;
      } else if (existing && existing.side === 'BUY') {
        // Close or flip long
        this.closePartial(key, existing, exec);
      } else {
        // New short
        this.positions.set(key, {
          metal: exec.metal,
          currency: 'USD',
          venue: exec.venue,
          side: 'SELL',
          quantity: exec.quantity,
          avgEntryPrice: exec.price,
          currentPrice: exec.price,
          unrealizedPnL: 0,
          unrealizedPnLPct: 0,
          realizedPnL: 0,
          totalPnL: 0,
          marketValue: exec.price * exec.quantity,
          costBasis: exec.price * exec.quantity,
          openDate: exec.timestamp,
          lastTradeDate: exec.timestamp,
        });
      }
      this.cashBalance += exec.price * exec.quantity - exec.fees;
    }
  }

  private closePartial(key: string, pos: Position, exec: Execution): void {
    const closeQty = Math.min(pos.quantity, exec.quantity);
    const pnlPerUnit = pos.side === 'BUY'
      ? exec.price - pos.avgEntryPrice
      : pos.avgEntryPrice - exec.price;
    const realizedPnL = pnlPerUnit * closeQty;

    // Record trade
    this.tradeHistory.push({
      id: `TR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      metal: exec.metal,
      side: pos.side,
      entryPrice: pos.avgEntryPrice,
      exitPrice: exec.price,
      quantity: closeQty,
      pnl: realizedPnL,
      pnlPct: pos.avgEntryPrice > 0 ? (pnlPerUnit / pos.avgEntryPrice) * 100 : 0,
      holdingPeriodMs: exec.timestamp - pos.openDate,
      entryTime: pos.openDate,
      exitTime: exec.timestamp,
      strategy: 'manual',
      signalSource: 'manual',
      maxFavorableExcursion: 0,
      maxAdverseExcursion: 0,
      fees: exec.fees,
      slippage: 0,
    });

    pos.realizedPnL += realizedPnL;

    if (exec.quantity >= pos.quantity) {
      // Fully closed
      this.positions.delete(key);
      if (exec.quantity > pos.quantity) {
        // Flip
        const flipQty = exec.quantity - pos.quantity;
        const flipSide: TradeSide = pos.side === 'BUY' ? 'SELL' : 'BUY';
        this.positions.set(key, {
          metal: exec.metal,
          currency: 'USD',
          venue: exec.venue,
          side: flipSide,
          quantity: flipQty,
          avgEntryPrice: exec.price,
          currentPrice: exec.price,
          unrealizedPnL: 0,
          unrealizedPnLPct: 0,
          realizedPnL: 0,
          totalPnL: 0,
          marketValue: exec.price * flipQty,
          costBasis: exec.price * flipQty,
          openDate: exec.timestamp,
          lastTradeDate: exec.timestamp,
        });
      }
    } else {
      pos.quantity -= closeQty;
      pos.costBasis = pos.avgEntryPrice * pos.quantity;
      pos.lastTradeDate = exec.timestamp;
    }
  }

  // ─── Mark to Market ─────────────────────────────────────────────────

  updatePrices(quotes: Map<Metal, PriceQuote>): void {
    for (const pos of this.positions.values()) {
      const quote = quotes.get(pos.metal);
      if (!quote) continue;

      pos.currentPrice = pos.side === 'BUY' ? quote.bid : quote.ask;
      pos.marketValue = pos.currentPrice * pos.quantity;

      const pnlPerUnit = pos.side === 'BUY'
        ? pos.currentPrice - pos.avgEntryPrice
        : pos.avgEntryPrice - pos.currentPrice;

      pos.unrealizedPnL = pnlPerUnit * pos.quantity;
      pos.unrealizedPnLPct = pos.avgEntryPrice > 0
        ? (pnlPerUnit / pos.avgEntryPrice) * 100 : 0;
      pos.totalPnL = pos.unrealizedPnL + pos.realizedPnL;
    }

    // Track peak equity for drawdown
    const equity = this.getEquity();
    if (equity > this.peakEquity) this.peakEquity = equity;
  }

  // ─── Portfolio Snapshot ─────────────────────────────────────────────

  getPortfolio(): Portfolio {
    const positions = Array.from(this.positions.values());
    let totalMV = 0, totalCB = 0, totalUPnL = 0, totalRPnL = 0;

    const exposureByMetal: Record<Metal, number> = { XAU: 0, XAG: 0, XPT: 0, XPD: 0 };
    const exposureByVenue: Record<Venue, number> = { LBMA: 0, COMEX: 0, SGE: 0, DMCC: 0, OTC_SPOT: 0, PHYSICAL: 0 };

    for (const p of positions) {
      totalMV += p.marketValue;
      totalCB += p.costBasis;
      totalUPnL += p.unrealizedPnL;
      totalRPnL += p.realizedPnL;
      exposureByMetal[p.metal] += p.marketValue;
      exposureByVenue[p.venue] += p.marketValue;
    }

    const totalPnL = totalUPnL + totalRPnL;

    // Concentration risk (HHI)
    const metalValues = Object.values(exposureByMetal);
    const totalExposure = metalValues.reduce((a, b) => a + b, 0) || 1;
    const hhi = metalValues.reduce((sum, v) => sum + (v / totalExposure) ** 2, 0);

    return {
      positions,
      totalMarketValue: totalMV,
      totalCostBasis: totalCB,
      totalUnrealizedPnL: totalUPnL,
      totalRealizedPnL: totalRPnL,
      totalPnL,
      totalPnLPct: this.initialCapital > 0 ? (totalPnL / this.initialCapital) * 100 : 0,
      cashBalance: this.cashBalance,
      marginUsed: totalMV * 0.1, // 10% margin requirement
      marginAvailable: this.cashBalance - totalMV * 0.1,
      buyingPower: (this.cashBalance - totalMV * 0.1) / 0.1, // 10x leverage
      exposureByMetal,
      exposureByVenue,
      concentrationRisk: hhi,
      lastUpdate: Date.now(),
    };
  }

  getEquity(): number {
    const portfolio = this.getPortfolio();
    return this.cashBalance + portfolio.totalUnrealizedPnL;
  }

  getPosition(metal: Metal, venue?: Venue): Position | null {
    if (venue) return this.positions.get(this.posKey(metal, venue)) ?? null;
    // Return largest position for this metal
    let largest: Position | null = null;
    for (const p of this.positions.values()) {
      if (p.metal === metal && (!largest || p.marketValue > largest.marketValue)) {
        largest = p;
      }
    }
    return largest;
  }

  getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  // ─── Risk Metrics ───────────────────────────────────────────────────

  computeRiskMetrics(returns: number[]): RiskMetrics {
    const equity = this.getEquity();
    const drawdown = this.peakEquity - equity;
    const drawdownPct = this.peakEquity > 0 ? (drawdown / this.peakEquity) * 100 : 0;

    const wins = this.tradeHistory.filter(t => t.pnl > 0);
    const losses = this.tradeHistory.filter(t => t.pnl < 0);
    const winRate = this.tradeHistory.length > 0 ? wins.length / this.tradeHistory.length : 0;
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;
    const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : Infinity;

    // Historical VaR (parametric)
    const sortedReturns = [...returns].sort((a, b) => a - b);
    const var95idx = Math.floor(returns.length * 0.05);
    const var95 = sortedReturns[var95idx] ?? 0;
    const portfolioValue = this.getPortfolio().totalMarketValue + this.cashBalance;

    // Standard deviation for Sharpe
    const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdDev = returns.length > 1
      ? Math.sqrt(returns.reduce((sum, r) => sum + (r - meanReturn) ** 2, 0) / (returns.length - 1))
      : 0;

    // Downside deviation for Sortino
    const negReturns = returns.filter(r => r < 0);
    const downsideDev = negReturns.length > 1
      ? Math.sqrt(negReturns.reduce((sum, r) => sum + r ** 2, 0) / negReturns.length)
      : 0;

    // Kelly criterion
    const kellyFraction = avgLoss > 0
      ? (winRate * avgWin - (1 - winRate) * avgLoss) / avgWin
      : 0;

    // Daily P&L (last 24h trades)
    const now = Date.now();
    const dailyTrades = this.tradeHistory.filter(t => t.exitTime > now - 86_400_000);
    const dailyPnL = dailyTrades.reduce((s, t) => s + t.pnl, 0);
    const weeklyTrades = this.tradeHistory.filter(t => t.exitTime > now - 604_800_000);
    const weeklyPnL = weeklyTrades.reduce((s, t) => s + t.pnl, 0);
    const monthlyTrades = this.tradeHistory.filter(t => t.exitTime > now - 2_592_000_000);
    const monthlyPnL = monthlyTrades.reduce((s, t) => s + t.pnl, 0);

    return {
      valueAtRisk1d: Math.abs(var95 * portfolioValue),
      valueAtRisk5d: Math.abs(var95 * portfolioValue * Math.sqrt(5)),
      conditionalVaR: Math.abs(var95 * portfolioValue * 1.4),
      sharpeRatio: stdDev > 0 ? (meanReturn * 252) / (stdDev * Math.sqrt(252)) : 0,
      sortinoRatio: downsideDev > 0 ? (meanReturn * 252) / (downsideDev * Math.sqrt(252)) : 0,
      maxDrawdown: drawdown,
      maxDrawdownPct: drawdownPct,
      currentDrawdown: drawdown,
      currentDrawdownPct: drawdownPct,
      winRate,
      profitFactor,
      avgWin,
      avgLoss,
      avgWinLossRatio: avgLoss > 0 ? avgWin / avgLoss : Infinity,
      dailyPnL,
      weeklyPnL,
      monthlyPnL,
      volatility30d: stdDev * Math.sqrt(252) * 100,
      beta: 1.0,
      correlation: { pairs: [] },
      kellyFraction: Math.max(0, Math.min(kellyFraction, 0.25)),
      optimalPositionSize: Math.max(0, kellyFraction * portfolioValue * 0.5),
    };
  }

  // ─── Performance Stats ──────────────────────────────────────────────

  getPerformanceStats(): PerformanceStats {
    const trades = this.tradeHistory;
    if (trades.length === 0) {
      return {
        totalTrades: 0, winRate: 0, avgReturn: 0, totalReturn: 0, totalReturnPct: 0,
        profitFactor: 0, sharpeRatio: 0, sortinoRatio: 0, maxDrawdown: 0, maxDrawdownPct: 0,
        avgHoldingPeriod: 0, bestTrade: {} as TradeRecord, worstTrade: {} as TradeRecord,
        streaks: { currentWin: 0, currentLoss: 0, longestWin: 0, longestLoss: 0 },
        byMetal: { XAU: { trades: 0, winRate: 0, pnl: 0 }, XAG: { trades: 0, winRate: 0, pnl: 0 }, XPT: { trades: 0, winRate: 0, pnl: 0 }, XPD: { trades: 0, winRate: 0, pnl: 0 } },
        byStrategy: {},
        equityCurve: [],
      };
    }

    const wins = trades.filter(t => t.pnl > 0);
    const totalPnL = trades.reduce((s, t) => s + t.pnl, 0);

    // Streaks
    let currentWin = 0, currentLoss = 0, longestWin = 0, longestLoss = 0;
    let streak = 0;
    for (const t of trades) {
      if (t.pnl > 0) {
        if (streak > 0) streak++; else streak = 1;
        if (streak > longestWin) longestWin = streak;
      } else {
        if (streak < 0) streak--; else streak = -1;
        if (-streak > longestLoss) longestLoss = -streak;
      }
    }
    if (streak > 0) currentWin = streak;
    if (streak < 0) currentLoss = -streak;

    // By metal
    const byMetal: Record<Metal, { trades: number; winRate: number; pnl: number }> = {
      XAU: { trades: 0, winRate: 0, pnl: 0 },
      XAG: { trades: 0, winRate: 0, pnl: 0 },
      XPT: { trades: 0, winRate: 0, pnl: 0 },
      XPD: { trades: 0, winRate: 0, pnl: 0 },
    };
    for (const t of trades) {
      byMetal[t.metal].trades++;
      byMetal[t.metal].pnl += t.pnl;
      if (t.pnl > 0) byMetal[t.metal].winRate++;
    }
    for (const m of Object.values(byMetal)) {
      if (m.trades > 0) m.winRate = m.winRate / m.trades;
    }

    // By strategy
    const byStrategy: Record<string, { trades: number; winRate: number; pnl: number }> = {};
    for (const t of trades) {
      if (!byStrategy[t.strategy]) byStrategy[t.strategy] = { trades: 0, winRate: 0, pnl: 0 };
      byStrategy[t.strategy].trades++;
      byStrategy[t.strategy].pnl += t.pnl;
      if (t.pnl > 0) byStrategy[t.strategy].winRate++;
    }
    for (const s of Object.values(byStrategy)) {
      if (s.trades > 0) s.winRate = s.winRate / s.trades;
    }

    // Equity curve
    let equity = this.initialCapital;
    const equityCurve = trades.map(t => {
      equity += t.pnl;
      return { timestamp: t.exitTime, equity };
    });

    const sorted = [...trades].sort((a, b) => b.pnl - a.pnl);

    return {
      totalTrades: trades.length,
      winRate: wins.length / trades.length,
      avgReturn: totalPnL / trades.length,
      totalReturn: totalPnL,
      totalReturnPct: this.initialCapital > 0 ? (totalPnL / this.initialCapital) * 100 : 0,
      profitFactor: trades.filter(t => t.pnl < 0).reduce((s, t) => s + Math.abs(t.pnl), 0) > 0
        ? wins.reduce((s, t) => s + t.pnl, 0) / trades.filter(t => t.pnl < 0).reduce((s, t) => s + Math.abs(t.pnl), 0)
        : Infinity,
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdown: this.peakEquity - this.getEquity(),
      maxDrawdownPct: this.peakEquity > 0 ? ((this.peakEquity - this.getEquity()) / this.peakEquity) * 100 : 0,
      avgHoldingPeriod: trades.reduce((s, t) => s + t.holdingPeriodMs, 0) / trades.length,
      bestTrade: sorted[0],
      worstTrade: sorted[sorted.length - 1],
      streaks: { currentWin, currentLoss, longestWin, longestLoss },
      byMetal,
      byStrategy,
      equityCurve,
    };
  }

  getTradeHistory(limit?: number): TradeRecord[] {
    return limit ? this.tradeHistory.slice(-limit) : this.tradeHistory;
  }

  getCashBalance(): number {
    return this.cashBalance;
  }
}
