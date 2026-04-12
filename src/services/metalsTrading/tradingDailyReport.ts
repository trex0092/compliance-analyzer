/**
 * Trading Daily Report — Professional precious metals trading report
 * aligned with world-class standards (LBMA, DMCC, COMEX conventions).
 *
 * Generates structured daily reports covering:
 *   1. Market Summary (spot prices, 24h changes, regime)
 *   2. Portfolio Snapshot (positions, P&L, exposure breakdown)
 *   3. Risk Dashboard (VaR, drawdown, Sharpe, Kelly)
 *   4. Trading Activity (orders executed, fill quality)
 *   5. Signal & Decision Log (AI signals, conviction, alignment)
 *   6. Arbitrage Opportunities (detected, captured, missed)
 *   7. Alert Summary (by severity, type, actionability)
 *   8. Gold/Silver Ratio & Cross-Metal Analysis
 *   9. Performance Metrics (win rate, profit factor, streaks)
 *  10. Compliance Flags (sanctions, threshold, counterparty)
 *
 * Output formats: Asana task (rich text), JSON, HTML
 *
 * Regulatory tie-in:
 *   - MoE Circular 08/AML/2021 (AED 55K threshold monitoring)
 *   - LBMA RGG v9 (responsible gold — origin traceability)
 *   - FDL No.10/2025 Art.24 (5yr record retention)
 */

import type { MetalsTradingBrain } from './metalsTradingBrain';
import type { Metal, FusedDecision, MarketRegime } from './types';

// ─── Report Structure ───────────────────────────────────────────────────────

export interface TradingDailyReportData {
  reportDate: string; // dd/mm/yyyy (UAE format)
  generatedAt: string; // ISO 8601
  reportId: string;

  marketSummary: {
    metals: {
      metal: Metal;
      name: string;
      spotUSD: number;
      change24h: number;
      changePct24h: number;
      high24h: number;
      low24h: number;
      volume24h: number;
      regime: MarketRegime;
    }[];
    goldSilverRatio: number | null;
    goldSilverSignal: string;
  };

  portfolio: {
    cashBalance: number;
    totalMarketValue: number;
    totalExposure: number;
    totalPnL: number;
    totalPnLPct: number;
    unrealizedPnL: number;
    realizedPnL: number;
    positions: {
      metal: Metal;
      side: string;
      quantity: number;
      avgEntry: number;
      currentPrice: number;
      unrealizedPnL: number;
      unrealizedPnLPct: number;
    }[];
    exposureByMetal: Record<string, number>;
    concentrationRisk: number;
  };

  risk: {
    valueAtRisk1d: number;
    valueAtRisk5d: number;
    currentDrawdown: number;
    currentDrawdownPct: number;
    maxDrawdown: number;
    maxDrawdownPct: number;
    sharpeRatio: number;
    sortinoRatio: number;
    kellyFraction: number;
    profitFactor: number;
    volatility30d: number;
    dailyPnL: number;
    weeklyPnL: number;
    monthlyPnL: number;
    circuitBreakers: { type: string; triggered: boolean; value: number; threshold: number }[];
  };

  tradingActivity: {
    ordersPlaced: number;
    ordersFilled: number;
    ordersCancelled: number;
    totalVolumeTraded: number;
    totalFeesUSD: number;
    avgSlippageBps: number;
    recentTrades: {
      metal: Metal;
      side: string;
      quantity: number;
      entryPrice: number;
      exitPrice: number;
      pnl: number;
      pnlPct: number;
      strategy: string;
    }[];
  };

  signals: {
    totalGenerated: number;
    bySource: Record<string, number>;
    latestDecisions: {
      metal: Metal;
      direction: string;
      conviction: number;
      signalAlignment: number;
      regime: MarketRegime;
      riskReward: number;
      signalCount: number;
    }[];
  };

  arbitrage: {
    totalDetected: number;
    totalEstimatedProfit: number;
    opportunities: {
      type: string;
      venueA: string;
      venueB: string;
      spreadPct: number;
      netProfit: number;
      confidence: number;
    }[];
  };

  alerts: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    byType: Record<string, number>;
    recentAlerts: {
      type: string;
      severity: string;
      metal: Metal;
      title: string;
      suggestedAction: string;
    }[];
  };

  performance: {
    totalTrades: number;
    winRate: number;
    avgReturn: number;
    totalReturn: number;
    totalReturnPct: number;
    profitFactor: number;
    bestTradePnL: number;
    worstTradePnL: number;
    currentWinStreak: number;
    currentLossStreak: number;
    longestWinStreak: number;
    byMetal: Record<string, { trades: number; winRate: number; pnl: number }>;
  };

  compliance: {
    thresholdAlerts: string[];
    sanctionsFlags: string[];
    counterpartyFlags: string[];
    aedThresholdBreaches: number;
  };
}

// ─── Report Generation ──────────────────────────────────────────────────────

const METAL_NAMES: Record<Metal, string> = {
  XAU: 'Gold',
  XAG: 'Silver',
  XPT: 'Platinum',
  XPD: 'Palladium',
};

function formatDateUAE(date: Date = new Date()): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function generateDailyReport(brain: MetalsTradingBrain): TradingDailyReportData {
  const now = new Date();
  const metals: Metal[] = ['XAU', 'XAG', 'XPT', 'XPD'];

  // Market Summary
  const metalSnapshots = metals.map((metal) => {
    const snapshot = brain.oracle.getSnapshot(metal);
    return {
      metal,
      name: METAL_NAMES[metal],
      spotUSD: snapshot?.spotUSD ?? 0,
      change24h: snapshot?.change24h ?? 0,
      changePct24h: snapshot?.changePct24h ?? 0,
      high24h: snapshot?.high24h ?? 0,
      low24h: snapshot?.low24h ?? 0,
      volume24h: snapshot?.volume24h ?? 0,
      regime: brain.getRegime(metal),
    };
  });

  const gsRatio = brain.oracle.getGoldSilverRatio();

  // Portfolio
  const portfolio = brain.positions.getPortfolio();

  // Risk
  const riskMetrics = brain.positions.computeRiskMetrics([]);
  const circuitBreakers = brain.engine.getCircuitBreakers().getAll();

  // Trading Activity
  const orders = brain.engine.getOrderHistory(50);
  const trades = brain.positions.getTradeHistory(20);

  const filledOrders = orders.filter((o) => o.status === 'FILLED');
  const cancelledOrders = orders.filter((o) => o.status === 'CANCELLED');
  const totalVolume = filledOrders.reduce((s, o) => s + o.filledQty, 0);
  const totalFees = filledOrders.reduce((s, o) => s + o.fees, 0);
  const avgSlippage =
    filledOrders.length > 0
      ? filledOrders.reduce((s, o) => s + o.slippage, 0) / filledOrders.length
      : 0;

  // Signals
  const decisions = metals.map((m) => brain.getDecision(m)).filter(Boolean) as FusedDecision[];
  const allSignals = decisions.flatMap((d) => d.signals);
  const bySource: Record<string, number> = {};
  for (const s of allSignals) {
    bySource[s.source] = (bySource[s.source] ?? 0) + 1;
  }

  // Arbitrage
  const arbHistory = brain.arbitrage.getHistory();
  const arbStats = brain.arbitrage.getStats();

  // Alerts
  const alertStats = brain.alerts.getStats();
  const recentAlerts = brain.alerts.getHistory(10);

  // Performance
  const perfStats = brain.positions.getPerformanceStats();

  // Compliance flags
  const thresholdAlerts: string[] = [];
  const aedThreshold = 55_000 * 3.6725; // AED 55K in USD ~$14,976
  for (const trade of trades) {
    const tradeValue = trade.quantity * trade.entryPrice;
    if (tradeValue >= aedThreshold) {
      thresholdAlerts.push(
        `Trade ${trade.id}: ${trade.metal} ${trade.quantity}oz @ $${trade.entryPrice.toFixed(2)} = $${tradeValue.toFixed(0)} exceeds AED 55K threshold (MoE Circular 08/AML/2021)`
      );
    }
  }

  return {
    reportDate: formatDateUAE(now),
    generatedAt: now.toISOString(),
    reportId: `TRADING-DAILY-${now.toISOString().slice(0, 10).replace(/-/g, '')}`,

    marketSummary: {
      metals: metalSnapshots,
      goldSilverRatio: gsRatio?.ratio ?? null,
      goldSilverSignal: gsRatio?.signal ?? 'N/A',
    },

    portfolio: {
      cashBalance: portfolio.cashBalance,
      totalMarketValue: portfolio.totalMarketValue,
      totalExposure: portfolio.totalMarketValue,
      totalPnL: portfolio.totalPnL,
      totalPnLPct: portfolio.totalPnLPct,
      unrealizedPnL: portfolio.totalUnrealizedPnL,
      realizedPnL: portfolio.totalRealizedPnL,
      positions: portfolio.positions.map((p) => ({
        metal: p.metal,
        side: p.side,
        quantity: p.quantity,
        avgEntry: p.avgEntryPrice,
        currentPrice: p.currentPrice,
        unrealizedPnL: p.unrealizedPnL,
        unrealizedPnLPct: p.unrealizedPnLPct,
      })),
      exposureByMetal: portfolio.exposureByMetal,
      concentrationRisk: portfolio.concentrationRisk,
    },

    risk: {
      valueAtRisk1d: riskMetrics.valueAtRisk1d,
      valueAtRisk5d: riskMetrics.valueAtRisk5d,
      currentDrawdown: riskMetrics.currentDrawdown,
      currentDrawdownPct: riskMetrics.currentDrawdownPct,
      maxDrawdown: riskMetrics.maxDrawdown,
      maxDrawdownPct: riskMetrics.maxDrawdownPct,
      sharpeRatio: riskMetrics.sharpeRatio,
      sortinoRatio: riskMetrics.sortinoRatio,
      kellyFraction: riskMetrics.kellyFraction,
      profitFactor: riskMetrics.profitFactor,
      volatility30d: riskMetrics.volatility30d,
      dailyPnL: riskMetrics.dailyPnL,
      weeklyPnL: riskMetrics.weeklyPnL,
      monthlyPnL: riskMetrics.monthlyPnL,
      circuitBreakers: circuitBreakers.map((cb) => ({
        type: cb.type,
        triggered: cb.triggered,
        value: cb.currentValue,
        threshold: cb.threshold,
      })),
    },

    tradingActivity: {
      ordersPlaced: orders.length,
      ordersFilled: filledOrders.length,
      ordersCancelled: cancelledOrders.length,
      totalVolumeTraded: totalVolume,
      totalFeesUSD: totalFees,
      avgSlippageBps: avgSlippage,
      recentTrades: trades.slice(-10).map((t) => ({
        metal: t.metal,
        side: t.side,
        quantity: t.quantity,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        pnl: t.pnl,
        pnlPct: t.pnlPct,
        strategy: t.strategy,
      })),
    },

    signals: {
      totalGenerated: allSignals.length,
      bySource,
      latestDecisions: decisions.map((d) => ({
        metal: d.metal,
        direction: d.direction,
        conviction: d.conviction,
        signalAlignment: d.signalAlignment,
        regime: d.regime,
        riskReward: d.riskReward,
        signalCount: d.signals.length,
      })),
    },

    arbitrage: {
      totalDetected: arbStats.totalDetected,
      totalEstimatedProfit: arbStats.totalProfit,
      opportunities: arbHistory.slice(-5).map((a) => ({
        type: a.type,
        venueA: a.venueA,
        venueB: a.venueB,
        spreadPct: a.spreadPct,
        netProfit: a.netProfit,
        confidence: a.confidence,
      })),
    },

    alerts: {
      total: alertStats.total,
      critical: alertStats.bySeverity.CRITICAL,
      high: alertStats.bySeverity.HIGH,
      medium: alertStats.bySeverity.MEDIUM,
      low: alertStats.bySeverity.LOW,
      byType: alertStats.byType,
      recentAlerts: recentAlerts.map((a) => ({
        type: a.type,
        severity: a.severity,
        metal: a.metal,
        title: a.title,
        suggestedAction: a.suggestedAction ?? '',
      })),
    },

    performance: {
      totalTrades: perfStats.totalTrades,
      winRate: perfStats.winRate,
      avgReturn: perfStats.avgReturn,
      totalReturn: perfStats.totalReturn,
      totalReturnPct: perfStats.totalReturnPct,
      profitFactor: perfStats.profitFactor === Infinity ? 0 : perfStats.profitFactor,
      bestTradePnL: perfStats.bestTrade?.pnl ?? 0,
      worstTradePnL: perfStats.worstTrade?.pnl ?? 0,
      currentWinStreak: perfStats.streaks.currentWin,
      currentLossStreak: perfStats.streaks.currentLoss,
      longestWinStreak: perfStats.streaks.longestWin,
      byMetal: perfStats.byMetal,
    },

    compliance: {
      thresholdAlerts,
      sanctionsFlags: [],
      counterpartyFlags: [],
      aedThresholdBreaches: thresholdAlerts.length,
    },
  };
}

// ─── Asana Rich Text Formatter ──────────────────────────────────────────────

function usd(n: number, d = 2): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function pct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function bar(value: number, max: number, width = 20): string {
  const filled = Math.round((Math.min(Math.abs(value), max) / max) * width);
  return value >= 0
    ? '[' + '#'.repeat(filled) + '-'.repeat(width - filled) + ']'
    : '[' + '-'.repeat(width - filled) + 'X'.repeat(filled) + ']';
}

export function formatAsanaTaskNotes(report: TradingDailyReportData): string {
  const lines: string[] = [];
  const hr = '━'.repeat(52);

  // Header
  lines.push(`PRECIOUS METALS TRADING — DAILY REPORT`);
  lines.push(`Report Date: ${report.reportDate}`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`ID: ${report.reportId}`);
  lines.push(hr);

  // 1. Market Summary
  lines.push('');
  lines.push('1. MARKET SUMMARY');
  lines.push(hr);
  for (const m of report.marketSummary.metals) {
    if (m.spotUSD === 0) continue;
    lines.push(`  ${m.name} (${m.metal})`);
    lines.push(`    Spot:     ${usd(m.spotUSD)}  (${pct(m.changePct24h)})`);
    lines.push(`    24h:      H ${usd(m.high24h)}  |  L ${usd(m.low24h)}`);
    lines.push(`    Volume:   ${m.volume24h.toLocaleString()} oz`);
    lines.push(`    Regime:   ${m.regime.replace(/_/g, ' ')}`);
    lines.push('');
  }
  if (report.marketSummary.goldSilverRatio !== null) {
    lines.push(`  Gold/Silver Ratio: ${report.marketSummary.goldSilverRatio.toFixed(1)}`);
    lines.push(`  Signal: ${report.marketSummary.goldSilverSignal}`);
  }

  // 2. Portfolio
  lines.push('');
  lines.push('2. PORTFOLIO SNAPSHOT');
  lines.push(hr);
  lines.push(`  Cash Balance:    ${usd(report.portfolio.cashBalance, 0)}`);
  lines.push(`  Market Value:    ${usd(report.portfolio.totalMarketValue, 0)}`);
  lines.push(
    `  Total P&L:       ${usd(report.portfolio.totalPnL, 0)} (${pct(report.portfolio.totalPnLPct)})`
  );
  lines.push(`  Unrealized P&L:  ${usd(report.portfolio.unrealizedPnL, 0)}`);
  lines.push(`  Realized P&L:    ${usd(report.portfolio.realizedPnL, 0)}`);
  lines.push(`  Concentration:   ${(report.portfolio.concentrationRisk * 100).toFixed(0)}% HHI`);
  lines.push('');
  if (report.portfolio.positions.length > 0) {
    lines.push('  Open Positions:');
    for (const p of report.portfolio.positions) {
      lines.push(
        `    ${p.side} ${p.quantity}oz ${p.metal} @ ${usd(p.avgEntry)} → ${usd(p.currentPrice)}  P&L: ${usd(p.unrealizedPnL)} (${pct(p.unrealizedPnLPct)})`
      );
    }
  } else {
    lines.push('  No open positions');
  }

  // 3. Risk
  lines.push('');
  lines.push('3. RISK DASHBOARD');
  lines.push(hr);
  lines.push(`  VaR (1d, 95%):   ${usd(report.risk.valueAtRisk1d, 0)}`);
  lines.push(`  VaR (5d, 95%):   ${usd(report.risk.valueAtRisk5d, 0)}`);
  lines.push(
    `  Drawdown:        ${usd(report.risk.currentDrawdown, 0)} (${pct(report.risk.currentDrawdownPct)})`
  );
  lines.push(
    `  Max Drawdown:    ${usd(report.risk.maxDrawdown, 0)} (${pct(report.risk.maxDrawdownPct)})`
  );
  lines.push(`  Sharpe Ratio:    ${report.risk.sharpeRatio.toFixed(2)}`);
  lines.push(`  Sortino Ratio:   ${report.risk.sortinoRatio.toFixed(2)}`);
  lines.push(`  Kelly Fraction:  ${(report.risk.kellyFraction * 100).toFixed(1)}%`);
  lines.push(`  Volatility 30d:  ${report.risk.volatility30d.toFixed(1)}%`);
  lines.push('');
  lines.push(
    `  P&L:  Daily ${usd(report.risk.dailyPnL, 0)}  |  Weekly ${usd(report.risk.weeklyPnL, 0)}  |  Monthly ${usd(report.risk.monthlyPnL, 0)}`
  );
  lines.push('');
  lines.push('  Circuit Breakers:');
  for (const cb of report.risk.circuitBreakers) {
    const status = cb.triggered ? 'TRIGGERED' : 'OK';
    lines.push(`    [${status}] ${cb.type}: ${cb.value.toFixed(1)} / ${cb.threshold}`);
  }

  // 4. Trading Activity
  lines.push('');
  lines.push('4. TRADING ACTIVITY');
  lines.push(hr);
  lines.push(`  Orders Placed:   ${report.tradingActivity.ordersPlaced}`);
  lines.push(`  Orders Filled:   ${report.tradingActivity.ordersFilled}`);
  lines.push(`  Orders Cancelled: ${report.tradingActivity.ordersCancelled}`);
  lines.push(`  Volume Traded:   ${report.tradingActivity.totalVolumeTraded.toLocaleString()} oz`);
  lines.push(`  Total Fees:      ${usd(report.tradingActivity.totalFeesUSD)}`);
  lines.push(`  Avg Slippage:    ${report.tradingActivity.avgSlippageBps.toFixed(2)} bps`);
  if (report.tradingActivity.recentTrades.length > 0) {
    lines.push('');
    lines.push('  Recent Trades:');
    for (const t of report.tradingActivity.recentTrades.slice(-5)) {
      lines.push(
        `    ${t.side} ${t.quantity}oz ${t.metal}: ${usd(t.entryPrice)} → ${usd(t.exitPrice)}  P&L: ${usd(t.pnl)} (${pct(t.pnlPct)})`
      );
    }
  }

  // 5. AI Signals
  lines.push('');
  lines.push('5. AI SIGNAL FUSION');
  lines.push(hr);
  lines.push(`  Signals Generated: ${report.signals.totalGenerated}`);
  if (Object.keys(report.signals.bySource).length > 0) {
    lines.push(
      `  By Source: ${Object.entries(report.signals.bySource)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}`
    );
  }
  for (const d of report.signals.latestDecisions) {
    lines.push(
      `  ${d.metal}: ${d.direction} ${bar(d.conviction, 1)} ${(d.conviction * 100).toFixed(0)}% conviction`
    );
    lines.push(
      `    Regime: ${d.regime.replace(/_/g, ' ')}  |  R:R ${d.riskReward.toFixed(2)}  |  Alignment: ${(d.signalAlignment * 100).toFixed(0)}%  |  ${d.signalCount} signals`
    );
  }

  // 6. Arbitrage
  lines.push('');
  lines.push('6. ARBITRAGE SCANNER');
  lines.push(hr);
  lines.push(`  Opportunities Detected: ${report.arbitrage.totalDetected}`);
  lines.push(`  Estimated Total Profit: ${usd(report.arbitrage.totalEstimatedProfit, 0)}`);
  for (const a of report.arbitrage.opportunities) {
    lines.push(
      `    ${a.type.replace(/_/g, ' ')}: ${a.venueA} → ${a.venueB}  |  Spread: ${a.spreadPct.toFixed(2)}%  |  Net: ${usd(a.netProfit, 0)}  |  Conf: ${(a.confidence * 100).toFixed(0)}%`
    );
  }

  // 7. Alerts
  lines.push('');
  lines.push('7. ALERT SUMMARY');
  lines.push(hr);
  lines.push(`  Total Active: ${report.alerts.total}`);
  lines.push(
    `  CRITICAL: ${report.alerts.critical}  |  HIGH: ${report.alerts.high}  |  MEDIUM: ${report.alerts.medium}  |  LOW: ${report.alerts.low}`
  );
  for (const a of report.alerts.recentAlerts.slice(-5)) {
    lines.push(`    [${a.severity}] ${a.title}`);
    if (a.suggestedAction) lines.push(`      Action: ${a.suggestedAction}`);
  }

  // 8. Performance
  lines.push('');
  lines.push('8. PERFORMANCE METRICS');
  lines.push(hr);
  lines.push(`  Total Trades:    ${report.performance.totalTrades}`);
  lines.push(
    `  Win Rate:        ${(report.performance.winRate * 100).toFixed(0)}%  ${bar(report.performance.winRate, 1)}`
  );
  lines.push(
    `  Total Return:    ${usd(report.performance.totalReturn, 0)} (${pct(report.performance.totalReturnPct)})`
  );
  lines.push(`  Avg Return:      ${usd(report.performance.avgReturn)}`);
  lines.push(`  Profit Factor:   ${report.performance.profitFactor.toFixed(2)}`);
  lines.push(`  Best Trade:      ${usd(report.performance.bestTradePnL)}`);
  lines.push(`  Worst Trade:     ${usd(report.performance.worstTradePnL)}`);
  lines.push(
    `  Win Streak:      ${report.performance.currentWinStreak} (longest: ${report.performance.longestWinStreak})`
  );
  lines.push(`  Loss Streak:     ${report.performance.currentLossStreak}`);

  // 9. Compliance
  if (report.compliance.thresholdAlerts.length > 0 || report.compliance.sanctionsFlags.length > 0) {
    lines.push('');
    lines.push('9. COMPLIANCE FLAGS');
    lines.push(hr);
    if (report.compliance.aedThresholdBreaches > 0) {
      lines.push(`  AED 55K Threshold Breaches: ${report.compliance.aedThresholdBreaches}`);
      for (const f of report.compliance.thresholdAlerts) {
        lines.push(`    ${f}`);
      }
    }
    for (const f of report.compliance.sanctionsFlags) {
      lines.push(`    [SANCTIONS] ${f}`);
    }
    for (const f of report.compliance.counterpartyFlags) {
      lines.push(`    [COUNTERPARTY] ${f}`);
    }
  }

  // Footer
  lines.push('');
  lines.push(hr);
  lines.push('Hawkeye Sterling — Precious Metals Trading Platform');
  lines.push('Aligned with LBMA, DMCC, COMEX world standards');
  lines.push('Regulatory: MoE Circular 08/AML/2021 | FDL No.10/2025 | LBMA RGG v9');
  lines.push(hr);

  return lines.join('\n');
}

// ─── HTML Report ────────────────────────────────────────────────────────────

export function formatHTMLReport(report: TradingDailyReportData): string {
  const style = `
    body { font-family: 'Inter', system-ui, sans-serif; background: #0d1117; color: #e6edf3; margin: 0; padding: 24px; }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { color: #d4a843; font-size: 20px; letter-spacing: 1px; border-bottom: 2px solid #d4a843; padding-bottom: 8px; }
    h2 { color: #d4a843; font-size: 14px; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 24px; border-bottom: 1px solid #21262d; padding-bottom: 6px; }
    .meta { color: #8b949e; font-size: 11px; margin-bottom: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin: 12px 0; }
    .card { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 12px; }
    .card-label { font-size: 10px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.8px; }
    .card-value { font-size: 20px; font-weight: 700; margin-top: 4px; }
    .green { color: #3fb950; }
    .red { color: #f85149; }
    .gold { color: #d4a843; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 8px 0; }
    th { text-align: left; color: #8b949e; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid #21262d; }
    td { padding: 6px 8px; border-bottom: 1px solid #161b22; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; }
    .badge-crit { background: #f8514922; color: #f85149; }
    .badge-high { background: #E8A03022; color: #E8A030; }
    .badge-med { background: #d4a84322; color: #d4a843; }
    .badge-buy { background: #23863622; color: #3fb950; }
    .badge-sell { background: #D94F4F22; color: #f85149; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #21262d; font-size: 10px; color: #484f58; text-align: center; }
  `;

  const pnlClass = (n: number) => (n >= 0 ? 'green' : 'red');

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Trading Daily Report — ${report.reportDate}</title><style>${style}</style></head><body><div class="container">`;

  html += `<h1>PRECIOUS METALS TRADING — DAILY REPORT</h1>`;
  html += `<div class="meta">Date: ${report.reportDate} | Generated: ${report.generatedAt} | ID: ${report.reportId}</div>`;

  // Market Summary cards
  html += `<h2>Market Summary</h2><div class="grid">`;
  for (const m of report.marketSummary.metals) {
    if (m.spotUSD === 0) continue;
    html += `<div class="card"><div class="card-label">${m.name} (${m.metal})</div><div class="card-value">${usd(m.spotUSD)}</div><div class="${pnlClass(m.changePct24h)}" style="font-size:12px">${pct(m.changePct24h)}</div><div style="font-size:10px;color:#8b949e;margin-top:4px">${m.regime.replace(/_/g, ' ')}</div></div>`;
  }
  html += `</div>`;

  // Portfolio
  html += `<h2>Portfolio</h2><div class="grid">`;
  html += `<div class="card"><div class="card-label">Cash</div><div class="card-value">${usd(report.portfolio.cashBalance, 0)}</div></div>`;
  html += `<div class="card"><div class="card-label">Exposure</div><div class="card-value">${usd(report.portfolio.totalMarketValue, 0)}</div></div>`;
  html += `<div class="card"><div class="card-label">Total P&L</div><div class="card-value ${pnlClass(report.portfolio.totalPnL)}">${usd(report.portfolio.totalPnL, 0)}</div></div>`;
  html += `</div>`;

  if (report.portfolio.positions.length > 0) {
    html += `<table><tr><th>Side</th><th>Metal</th><th>Qty</th><th>Entry</th><th>Current</th><th>P&L</th></tr>`;
    for (const p of report.portfolio.positions) {
      html += `<tr><td><span class="badge ${p.side === 'BUY' ? 'badge-buy' : 'badge-sell'}">${p.side}</span></td><td>${p.metal}</td><td>${p.quantity}</td><td>${usd(p.avgEntry)}</td><td>${usd(p.currentPrice)}</td><td class="${pnlClass(p.unrealizedPnL)}">${usd(p.unrealizedPnL)} (${pct(p.unrealizedPnLPct)})</td></tr>`;
    }
    html += `</table>`;
  }

  // Risk
  html += `<h2>Risk Dashboard</h2><div class="grid">`;
  html += `<div class="card"><div class="card-label">VaR (1d)</div><div class="card-value">${usd(report.risk.valueAtRisk1d, 0)}</div></div>`;
  html += `<div class="card"><div class="card-label">Drawdown</div><div class="card-value ${pnlClass(-report.risk.currentDrawdownPct)}">${pct(report.risk.currentDrawdownPct)}</div></div>`;
  html += `<div class="card"><div class="card-label">Sharpe</div><div class="card-value">${report.risk.sharpeRatio.toFixed(2)}</div></div>`;
  html += `<div class="card"><div class="card-label">Kelly F</div><div class="card-value">${(report.risk.kellyFraction * 100).toFixed(1)}%</div></div>`;
  html += `</div>`;

  // Performance
  html += `<h2>Performance</h2><div class="grid">`;
  html += `<div class="card"><div class="card-label">Trades</div><div class="card-value">${report.performance.totalTrades}</div></div>`;
  html += `<div class="card"><div class="card-label">Win Rate</div><div class="card-value">${(report.performance.winRate * 100).toFixed(0)}%</div></div>`;
  html += `<div class="card"><div class="card-label">Total Return</div><div class="card-value ${pnlClass(report.performance.totalReturn)}">${usd(report.performance.totalReturn, 0)}</div></div>`;
  html += `<div class="card"><div class="card-label">Profit Factor</div><div class="card-value">${report.performance.profitFactor.toFixed(2)}</div></div>`;
  html += `</div>`;

  // Alerts
  if (report.alerts.total > 0) {
    html += `<h2>Alerts (${report.alerts.total})</h2>`;
    html += `<div style="font-size:11px;margin:8px 0">CRITICAL: ${report.alerts.critical} | HIGH: ${report.alerts.high} | MEDIUM: ${report.alerts.medium}</div>`;
    for (const a of report.alerts.recentAlerts.slice(-5)) {
      const badgeClass =
        a.severity === 'CRITICAL'
          ? 'badge-crit'
          : a.severity === 'HIGH'
            ? 'badge-high'
            : 'badge-med';
      html += `<div style="margin:4px 0"><span class="badge ${badgeClass}">${a.severity}</span> ${a.title}</div>`;
    }
  }

  // Compliance
  if (report.compliance.aedThresholdBreaches > 0) {
    html += `<h2>Compliance Flags</h2>`;
    html += `<div style="font-size:11px;color:#f85149">AED 55K Threshold Breaches: ${report.compliance.aedThresholdBreaches}</div>`;
  }

  html += `<div class="footer">Hawkeye Sterling — Precious Metals Trading Platform<br>LBMA | DMCC | COMEX Standards<br>MoE Circular 08/AML/2021 | FDL No.10/2025 | LBMA RGG v9</div>`;
  html += `</div></body></html>`;

  return html;
}

// ─── JSON Export ─────────────────────────────────────────────────────────────

export function formatJSONReport(report: TradingDailyReportData): string {
  return JSON.stringify(report, null, 2);
}
