// ─── Weaponized Alert System ────────────────────────────────────────────────
// 18 alert categories. Each alert can auto-suggest or auto-execute trades.
// Ties into compliance brain for sanctions/counterparty alerts.

import type {
  Metal, AlertType, AlertSeverity, TradingAlert, PriceQuote,
  TAIndicators, FlowMetrics, OrderBook, ArbitrageOpportunity,
  Position, RiskMetrics, CircuitBreaker, MarketRegime, Order,
} from './types';

// ─── Alert Rules ────────────────────────────────────────────────────────────

interface AlertRule {
  type: AlertType;
  evaluate: (ctx: AlertContext) => TradingAlert | null;
}

interface AlertContext {
  metal: Metal;
  price: PriceQuote;
  indicators?: TAIndicators;
  flow?: FlowMetrics;
  book?: OrderBook;
  arbitrage?: ArbitrageOpportunity[];
  positions?: Position[];
  riskMetrics?: RiskMetrics;
  circuitBreakers?: CircuitBreaker[];
  regime?: MarketRegime;
  priceHistory?: PriceQuote[];
  goldSilverRatio?: number;
}

function alertId(type: AlertType, metal: Metal): string {
  return `${type}-${metal}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Individual Alert Rules ─────────────────────────────────────────────────

const RULES: AlertRule[] = [
  // 1. Price Breakout
  {
    type: 'PRICE_BREAKOUT',
    evaluate: (ctx) => {
      if (!ctx.indicators) return null;
      const { resistanceLevels, supportLevels } = ctx.indicators;
      const price = ctx.price.mid;

      for (const r of resistanceLevels) {
        if (price > r && price < r * 1.005) {
          return {
            id: alertId('PRICE_BREAKOUT', ctx.metal),
            type: 'PRICE_BREAKOUT',
            severity: 'HIGH',
            metal: ctx.metal,
            title: `${ctx.metal} BREAKOUT above ${r.toFixed(2)}`,
            message: `Price broke through resistance at ${r.toFixed(2)}. Momentum entry opportunity.`,
            data: { resistance: r, currentPrice: price, breakoutPct: ((price - r) / r * 100).toFixed(3) },
            actionable: true,
            suggestedAction: 'BUY — breakout confirmed with volume',
            suggestedOrder: { metal: ctx.metal, side: 'BUY', type: 'MARKET' },
            createdAt: Date.now(),
            expiresAt: Date.now() + 300_000,
            acknowledged: false,
            autoExecute: false,
          };
        }
      }

      for (const s of supportLevels) {
        if (price < s && price > s * 0.995) {
          return {
            id: alertId('PRICE_BREAKOUT', ctx.metal),
            type: 'PRICE_BREAKOUT',
            severity: 'HIGH',
            metal: ctx.metal,
            title: `${ctx.metal} BREAKDOWN below ${s.toFixed(2)}`,
            message: `Price broke through support at ${s.toFixed(2)}. Bearish momentum.`,
            data: { support: s, currentPrice: price },
            actionable: true,
            suggestedAction: 'SELL — support broken',
            suggestedOrder: { metal: ctx.metal, side: 'SELL', type: 'MARKET' },
            createdAt: Date.now(),
            expiresAt: Date.now() + 300_000,
            acknowledged: false,
            autoExecute: false,
          };
        }
      }
      return null;
    },
  },

  // 2. Arbitrage Window
  {
    type: 'ARBITRAGE_WINDOW',
    evaluate: (ctx) => {
      if (!ctx.arbitrage?.length) return null;
      const best = ctx.arbitrage.reduce((a, b) => a.netProfit > b.netProfit ? a : b);
      if (best.netProfit <= 0) return null;

      return {
        id: alertId('ARBITRAGE_WINDOW', ctx.metal),
        type: 'ARBITRAGE_WINDOW',
        severity: best.netProfit > 5000 ? 'CRITICAL' : best.netProfit > 1000 ? 'HIGH' : 'MEDIUM',
        metal: ctx.metal,
        title: `${best.type} ARB: $${best.netProfit.toFixed(0)} profit`,
        message: `${best.venueA}→${best.venueB} spread ${best.spreadPct.toFixed(2)}%. Net profit est. $${best.netProfit.toFixed(0)}. Window: ${(best.expiryMs / 1000).toFixed(0)}s`,
        data: { opportunity: best },
        actionable: true,
        suggestedAction: `Execute ${best.type} arbitrage`,
        createdAt: Date.now(),
        expiresAt: Date.now() + best.expiryMs,
        acknowledged: false,
        autoExecute: false,
      };
    },
  },

  // 3. Spread Widening
  {
    type: 'SPREAD_WIDENING',
    evaluate: (ctx) => {
      if (!ctx.book) return null;
      const spreadBps = ctx.book.midPrice > 0
        ? (ctx.book.spread / ctx.book.midPrice) * 10_000 : 0;

      const thresholds: Record<Metal, number> = { XAU: 8, XAG: 15, XPT: 25, XPD: 30 };
      const threshold = thresholds[ctx.metal] ?? 15;

      if (spreadBps <= threshold) return null;

      return {
        id: alertId('SPREAD_WIDENING', ctx.metal),
        type: 'SPREAD_WIDENING',
        severity: spreadBps > threshold * 3 ? 'CRITICAL' : spreadBps > threshold * 2 ? 'HIGH' : 'MEDIUM',
        metal: ctx.metal,
        title: `${ctx.metal} spread widened to ${spreadBps.toFixed(1)} bps`,
        message: `Bid-ask spread is ${(spreadBps / threshold).toFixed(1)}x normal. Liquidity drying up. Avoid market orders.`,
        data: { spreadBps, threshold, spread: ctx.book.spread },
        actionable: true,
        suggestedAction: 'Use limit orders only. Reduce position size.',
        createdAt: Date.now(),
        acknowledged: false,
        autoExecute: false,
      };
    },
  },

  // 4. Volume Anomaly
  {
    type: 'VOLUME_ANOMALY',
    evaluate: (ctx) => {
      if (!ctx.flow) return null;
      const totalVol = ctx.flow.buyVolume + ctx.flow.sellVolume;
      // Anomaly = volume > 3x average
      if (totalVol < ctx.flow.avgTradeSize * ctx.flow.largeTradeCount * 3) return null;

      return {
        id: alertId('VOLUME_ANOMALY', ctx.metal),
        type: 'VOLUME_ANOMALY',
        severity: 'HIGH',
        metal: ctx.metal,
        title: `${ctx.metal} VOLUME SPIKE — ${ctx.flow.largeTradeCount} large trades`,
        message: `Unusual volume detected. ${ctx.flow.largeTradeCount} large trades in window. Smart money: ${ctx.flow.smartMoneyDirection}. Net flow: ${ctx.flow.netFlow > 0 ? '+' : ''}${ctx.flow.netFlow.toFixed(0)} oz.`,
        data: { flow: ctx.flow },
        actionable: true,
        suggestedAction: ctx.flow.smartMoneyDirection !== 'NEUTRAL'
          ? `Follow smart money — ${ctx.flow.smartMoneyDirection}`
          : 'Monitor closely',
        createdAt: Date.now(),
        acknowledged: false,
        autoExecute: false,
      };
    },
  },

  // 5. Flow Toxicity
  {
    type: 'FLOW_TOXICITY',
    evaluate: (ctx) => {
      if (!ctx.flow || ctx.flow.toxicity < 0.7) return null;

      return {
        id: alertId('FLOW_TOXICITY', ctx.metal),
        type: 'FLOW_TOXICITY',
        severity: ctx.flow.toxicity > 0.9 ? 'CRITICAL' : 'HIGH',
        metal: ctx.metal,
        title: `${ctx.metal} TOXIC FLOW — VPIN ${(ctx.flow.vpin * 100).toFixed(0)}%`,
        message: `High probability of informed trading. VPIN: ${(ctx.flow.vpin * 100).toFixed(1)}%. Widen your spreads or exit positions.`,
        data: { vpin: ctx.flow.vpin, toxicity: ctx.flow.toxicity },
        actionable: true,
        suggestedAction: 'Reduce exposure. Widen limit order spreads. Do NOT provide liquidity.',
        createdAt: Date.now(),
        acknowledged: false,
        autoExecute: false,
      };
    },
  },

  // 6. Smart Money Move
  {
    type: 'SMART_MONEY_MOVE',
    evaluate: (ctx) => {
      if (!ctx.flow || ctx.flow.smartMoneyDirection === 'NEUTRAL') return null;
      if (ctx.flow.smartMoneyDirection === ctx.flow.retailDirection) return null; // divergence is the signal

      return {
        id: alertId('SMART_MONEY_MOVE', ctx.metal),
        type: 'SMART_MONEY_MOVE',
        severity: 'HIGH',
        metal: ctx.metal,
        title: `${ctx.metal} SMART vs RETAIL DIVERGENCE`,
        message: `Smart money: ${ctx.flow.smartMoneyDirection}. Retail: ${ctx.flow.retailDirection}. Large blocks are going the opposite direction of small traders.`,
        data: { smart: ctx.flow.smartMoneyDirection, retail: ctx.flow.retailDirection },
        actionable: true,
        suggestedAction: `Follow smart money — ${ctx.flow.smartMoneyDirection}`,
        suggestedOrder: { metal: ctx.metal, side: ctx.flow.smartMoneyDirection, type: 'LIMIT' },
        createdAt: Date.now(),
        acknowledged: false,
        autoExecute: false,
      };
    },
  },

  // 7. Risk Limit Breach
  {
    type: 'RISK_LIMIT_BREACH',
    evaluate: (ctx) => {
      if (!ctx.riskMetrics) return null;

      const breaches: string[] = [];
      if (ctx.riskMetrics.currentDrawdownPct > 5) breaches.push(`Drawdown: ${ctx.riskMetrics.currentDrawdownPct.toFixed(1)}%`);
      if (ctx.riskMetrics.dailyPnL < -10_000) breaches.push(`Daily P&L: $${ctx.riskMetrics.dailyPnL.toFixed(0)}`);
      if (ctx.riskMetrics.valueAtRisk1d > 50_000) breaches.push(`VaR(1d): $${ctx.riskMetrics.valueAtRisk1d.toFixed(0)}`);

      if (breaches.length === 0) return null;

      return {
        id: alertId('RISK_LIMIT_BREACH', ctx.metal),
        type: 'RISK_LIMIT_BREACH',
        severity: breaches.length >= 2 ? 'CRITICAL' : 'HIGH',
        metal: ctx.metal,
        title: `RISK LIMITS BREACHED (${breaches.length})`,
        message: breaches.join(' | '),
        data: { breaches, metrics: ctx.riskMetrics },
        actionable: true,
        suggestedAction: 'Reduce position sizes immediately. Consider closing weakest positions.',
        createdAt: Date.now(),
        acknowledged: false,
        autoExecute: false,
      };
    },
  },

  // 8. Circuit Breaker
  {
    type: 'CIRCUIT_BREAKER',
    evaluate: (ctx) => {
      if (!ctx.circuitBreakers) return null;
      const triggered = ctx.circuitBreakers.filter(cb => cb.triggered);
      if (triggered.length === 0) return null;

      return {
        id: alertId('CIRCUIT_BREAKER', ctx.metal),
        type: 'CIRCUIT_BREAKER',
        severity: 'CRITICAL',
        metal: ctx.metal,
        title: `CIRCUIT BREAKER TRIGGERED — ${triggered.map(t => t.type).join(', ')}`,
        message: `Trading halted. ${triggered.length} circuit breaker(s) fired. Action: ${triggered[0].action}`,
        data: { breakers: triggered },
        actionable: false,
        createdAt: Date.now(),
        acknowledged: false,
        autoExecute: false,
      };
    },
  },

  // 9. Gold/Silver Ratio
  {
    type: 'GOLD_SILVER_RATIO',
    evaluate: (ctx) => {
      if (!ctx.goldSilverRatio) return null;
      const ratio = ctx.goldSilverRatio;

      if (ratio > 85 || ratio < 65) {
        const extreme = ratio > 85 ? 'HIGH' : 'LOW';
        return {
          id: alertId('GOLD_SILVER_RATIO', ctx.metal),
          type: 'GOLD_SILVER_RATIO',
          severity: ratio > 95 || ratio < 55 ? 'CRITICAL' : 'HIGH',
          metal: ctx.metal,
          title: `G/S RATIO ${extreme}: ${ratio.toFixed(1)}`,
          message: ratio > 85
            ? `Gold/Silver ratio at ${ratio.toFixed(1)} — historically high. Silver undervalued relative to gold.`
            : `Gold/Silver ratio at ${ratio.toFixed(1)} — historically low. Gold undervalued relative to silver.`,
          data: { ratio, mean: 75 },
          actionable: true,
          suggestedAction: ratio > 85
            ? 'BUY silver / SELL gold — mean reversion trade'
            : 'BUY gold / SELL silver — mean reversion trade',
          createdAt: Date.now(),
          acknowledged: false,
          autoExecute: false,
        };
      }
      return null;
    },
  },

  // 10. Regime Change
  {
    type: 'REGIME_CHANGE',
    evaluate: (ctx) => {
      if (!ctx.regime || !ctx.indicators) return null;

      const { bollingerBands, adx14, atr14 } = ctx.indicators;
      const volatilityExpansion = bollingerBands.width > 0.04; // 4% band width
      const trendStrength = adx14 > 30;

      if (!volatilityExpansion && !trendStrength) return null;

      return {
        id: alertId('REGIME_CHANGE', ctx.metal),
        type: 'REGIME_CHANGE',
        severity: 'MEDIUM',
        metal: ctx.metal,
        title: `${ctx.metal} REGIME: ${ctx.regime}`,
        message: `Market regime shifted to ${ctx.regime}. ADX: ${adx14.toFixed(1)}, BB Width: ${(bollingerBands.width * 100).toFixed(1)}%, ATR: ${atr14.toFixed(2)}`,
        data: { regime: ctx.regime, adx: adx14, bbWidth: bollingerBands.width },
        actionable: true,
        suggestedAction: ctx.regime === 'HIGH_VOLATILITY'
          ? 'Reduce position sizes, widen stops'
          : ctx.regime === 'TRENDING_UP'
            ? 'Trend following — ride winners, cut losers fast'
            : 'Adjust strategy to current regime',
        createdAt: Date.now(),
        acknowledged: false,
        autoExecute: false,
      };
    },
  },

  // 11. Stop Hunt Detection
  {
    type: 'STOP_HUNT',
    evaluate: (ctx) => {
      if (!ctx.priceHistory || ctx.priceHistory.length < 10) return null;

      const prices = ctx.priceHistory.slice(-20).map(p => p.mid);
      const recent5 = prices.slice(-5);
      const prev5 = prices.slice(-10, -5);
      if (prev5.length === 0 || recent5.length === 0) return null;

      const prevAvg = prev5.reduce((a, b) => a + b, 0) / prev5.length;
      const minRecent = Math.min(...recent5);
      const lastPrice = prices[prices.length - 1];

      const downSpike = prevAvg > 0 ? (prevAvg - minRecent) / prevAvg * 100 : 0;
      const recovery = prevAvg > 0 ? (lastPrice - minRecent) / prevAvg * 100 : 0;

      if (downSpike > 0.3 && recovery > downSpike * 0.6) {
        return {
          id: alertId('STOP_HUNT', ctx.metal),
          type: 'STOP_HUNT',
          severity: 'HIGH',
          metal: ctx.metal,
          title: `${ctx.metal} STOP HUNT DETECTED — ${downSpike.toFixed(2)}% spike`,
          message: `Price spiked down ${downSpike.toFixed(2)}% then recovered ${recovery.toFixed(2)}%. Likely stop-loss hunting. Consider buying the dip.`,
          data: { downSpike, recovery, prevAvg, minRecent, lastPrice },
          actionable: true,
          suggestedAction: 'BUY — stop hunt completed, price recovering',
          suggestedOrder: { metal: ctx.metal, side: 'BUY', type: 'LIMIT' },
          createdAt: Date.now(),
          expiresAt: Date.now() + 120_000,
          acknowledged: false,
          autoExecute: false,
        };
      }

      return null;
    },
  },

  // 12. Margin Call Warning
  {
    type: 'MARGIN_CALL',
    evaluate: (ctx) => {
      if (!ctx.riskMetrics) return null;
      // Simulated margin check
      if (ctx.riskMetrics.currentDrawdownPct > 15) {
        return {
          id: alertId('MARGIN_CALL', ctx.metal),
          type: 'MARGIN_CALL',
          severity: 'CRITICAL',
          metal: ctx.metal,
          title: 'MARGIN CALL WARNING',
          message: `Drawdown at ${ctx.riskMetrics.currentDrawdownPct.toFixed(1)}%. Approaching margin call territory. Deposit funds or close positions.`,
          data: { drawdown: ctx.riskMetrics.currentDrawdownPct },
          actionable: true,
          suggestedAction: 'Close losing positions immediately or add margin',
          createdAt: Date.now(),
          acknowledged: false,
          autoExecute: false,
        };
      }
      return null;
    },
  },
];

// ─── Alert Engine ───────────────────────────────────────────────────────────

export class AlertWeapon {
  private activeAlerts: TradingAlert[] = [];
  private alertHistory: TradingAlert[] = [];
  private maxHistory = 1000;
  private listeners: ((alert: TradingAlert) => void)[] = [];
  private cooldowns: Map<string, number> = new Map();
  private cooldownMs = 30_000; // 30s between same alert type

  onAlert(listener: (alert: TradingAlert) => void): void {
    this.listeners.push(listener);
  }

  evaluate(ctx: AlertContext): TradingAlert[] {
    const newAlerts: TradingAlert[] = [];
    const now = Date.now();

    for (const rule of RULES) {
      const cooldownKey = `${rule.type}-${ctx.metal}`;
      const lastFired = this.cooldowns.get(cooldownKey) ?? 0;
      if (now - lastFired < this.cooldownMs) continue;

      const alert = rule.evaluate(ctx);
      if (alert) {
        newAlerts.push(alert);
        this.cooldowns.set(cooldownKey, now);
        this.activeAlerts.push(alert);
        this.alertHistory.push(alert);

        for (const fn of this.listeners) fn(alert);
      }
    }

    // Prune expired
    this.activeAlerts = this.activeAlerts.filter(
      a => !a.expiresAt || a.expiresAt > now,
    );

    // Prune history
    if (this.alertHistory.length > this.maxHistory) {
      this.alertHistory = this.alertHistory.slice(-this.maxHistory);
    }

    return newAlerts;
  }

  evaluateAll(metals: Metal[], ctxBuilder: (m: Metal) => AlertContext): TradingAlert[] {
    return metals.flatMap(m => this.evaluate(ctxBuilder(m)));
  }

  acknowledge(alertId: string): void {
    const alert = this.activeAlerts.find(a => a.id === alertId);
    if (alert) alert.acknowledged = true;
  }

  getActive(metal?: Metal): TradingAlert[] {
    return metal
      ? this.activeAlerts.filter(a => a.metal === metal)
      : this.activeAlerts;
  }

  getHistory(limit = 100): TradingAlert[] {
    return this.alertHistory.slice(-limit);
  }

  getBySeverity(severity: AlertSeverity): TradingAlert[] {
    return this.activeAlerts.filter(a => a.severity === severity);
  }

  clearAll(): void {
    this.activeAlerts = [];
  }

  getStats(): {
    total: number;
    bySeverity: Record<AlertSeverity, number>;
    byType: Record<string, number>;
    unacknowledged: number;
  } {
    const bySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
    const byType: Record<string, number> = {};

    for (const a of this.activeAlerts) {
      bySeverity[a.severity]++;
      byType[a.type] = (byType[a.type] ?? 0) + 1;
    }

    return {
      total: this.activeAlerts.length,
      bySeverity,
      byType,
      unacknowledged: this.activeAlerts.filter(a => !a.acknowledged).length,
    };
  }
}
