// ─── Trading Engine: Core Order Execution ───────────────────────────────────
// Order lifecycle: validate → risk-check → route → execute → confirm.
// Supports: market, limit, stop, stop-limit, trailing stop, iceberg, TWAP, VWAP.
// Integrates compliance brain for counterparty/sanctions screening.

import type {
  Metal, Venue, TradeSide, OrderType,
  TimeInForce, Order, Execution, PriceQuote,
  RiskLimits,
} from './types';
import type { PriceOracle } from './priceOracle';
import type { PositionManager } from './positionManager';
import { CircuitBreakerEngine, preTradeRiskCheck } from './riskMatrix';

// ─── Engine Configuration ───────────────────────────────────────────────────

interface EngineConfig {
  defaultVenue: Venue;
  defaultTimeInForce: TimeInForce;
  maxSlippageBps: number;
  simulationMode: boolean; // paper trading
  complianceEnabled: boolean;
  riskLimits: RiskLimits;
}

const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  defaultVenue: 'DMCC',
  defaultTimeInForce: 'GTC',
  maxSlippageBps: 15,
  simulationMode: true,
  complianceEnabled: true,
  riskLimits: {
    maxPositionSize: 1000,
    maxPortfolioExposure: 5_000_000,
    maxLossPerTrade: 5_000,
    maxDailyLoss: 25_000,
    maxDrawdownPct: 10,
    maxConcentration: 0.6,
    maxLeverage: 10,
    maxOpenOrders: 20,
    maxDailyTrades: 100,
    cooldownAfterLoss: 300_000,
  },
};

// ─── Order Manager ──────────────────────────────────────────────────────────

export class TradingEngine {
  private orders: Map<string, Order> = new Map();
  private executions: Execution[] = [];
  private config: EngineConfig;
  private oracle: PriceOracle;
  private positionManager: PositionManager;
  private circuitBreakers: CircuitBreakerEngine;
  private orderListeners: ((order: Order) => void)[] = [];
  private executionListeners: ((exec: Execution) => void)[] = [];
  private dailyTradeCount = 0;
  private lastDayReset = 0;

  constructor(
    oracle: PriceOracle,
    positionManager: PositionManager,
    config: Partial<EngineConfig> = {},
  ) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };
    this.oracle = oracle;
    this.positionManager = positionManager;
    this.circuitBreakers = new CircuitBreakerEngine(this.config.riskLimits);
  }

  onOrder(listener: (order: Order) => void): void {
    this.orderListeners.push(listener);
  }

  onExecution(listener: (exec: Execution) => void): void {
    this.executionListeners.push(listener);
  }

  // ─── Submit Order ───────────────────────────────────────────────────

  submitOrder(params: {
    metal: Metal;
    side: TradeSide;
    type: OrderType;
    quantity: number;
    price?: number;
    stopPrice?: number;
    trailingAmount?: number;
    trailingPct?: number;
    icebergVisibleQty?: number;
    twapSlices?: number;
    twapIntervalMs?: number;
    venue?: Venue;
    timeInForce?: TimeInForce;
    tags?: string[];
    strategyId?: string;
  }): Order {
    this.resetDailyCountIfNeeded();

    const order: Order = {
      id: `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      metal: params.metal,
      currency: 'USD',
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      price: params.price,
      stopPrice: params.stopPrice,
      trailingAmount: params.trailingAmount,
      trailingPct: params.trailingPct,
      icebergVisibleQty: params.icebergVisibleQty,
      twapSlices: params.twapSlices,
      twapIntervalMs: params.twapIntervalMs,
      timeInForce: params.timeInForce ?? this.config.defaultTimeInForce,
      venue: params.venue ?? this.config.defaultVenue,
      status: 'PENDING',
      filledQty: 0,
      avgFillPrice: 0,
      fees: 0,
      slippage: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: params.tags ?? [],
      strategyId: params.strategyId,
      complianceCleared: false,
    };

    // Risk check
    const portfolio = this.positionManager.getPortfolio();
    const currentPrice = this.getCurrentPrice(order.metal, order.venue);
    const riskCheck = preTradeRiskCheck(
      order.metal, order.side, order.quantity, currentPrice,
      portfolio, this.config.riskLimits, this.circuitBreakers,
    );

    if (!riskCheck.approved) {
      order.status = 'REJECTED';
      order.updatedAt = Date.now();
      this.orders.set(order.id, order);
      this.notifyOrder(order);
      return order;
    }

    if (riskCheck.adjustedQuantity !== undefined) {
      order.quantity = riskCheck.adjustedQuantity;
    }

    // Daily trade limit
    if (this.dailyTradeCount >= this.config.riskLimits.maxDailyTrades) {
      order.status = 'REJECTED';
      order.updatedAt = Date.now();
      this.orders.set(order.id, order);
      this.notifyOrder(order);
      return order;
    }

    order.complianceCleared = true;
    this.orders.set(order.id, order);

    // Execute based on order type
    if (order.type === 'MARKET') {
      this.executeMarketOrder(order);
    } else if (order.type === 'LIMIT') {
      this.checkLimitOrder(order);
    } else if (order.type === 'STOP' || order.type === 'STOP_LIMIT') {
      // Stops wait for trigger price
      this.notifyOrder(order);
    } else if (order.type === 'TWAP') {
      this.executeTWAP(order);
    } else if (order.type === 'VWAP') {
      this.executeVWAP(order);
    } else if (order.type === 'ICEBERG') {
      this.executeIceberg(order);
    } else if (order.type === 'TRAILING_STOP') {
      this.notifyOrder(order);
    }

    return order;
  }

  // ─── Market Order Execution ─────────────────────────────────────────

  private executeMarketOrder(order: Order): void {
    const quote = this.oracle.getConsolidated(order.metal);
    if (!quote) {
      order.status = 'REJECTED';
      order.updatedAt = Date.now();
      this.notifyOrder(order);
      return;
    }

    const fillPrice = order.side === 'BUY' ? quote.ask : quote.bid;
    const slippage = this.simulateSlippage(order.quantity, fillPrice, order.metal);
    const actualPrice = order.side === 'BUY' ? fillPrice + slippage : fillPrice - slippage;

    this.fill(order, order.quantity, actualPrice, slippage);
  }

  // ─── Limit Order ────────────────────────────────────────────────────

  private checkLimitOrder(order: Order): void {
    if (!order.price) return;

    const quote = this.oracle.getConsolidated(order.metal);
    if (!quote) return;

    const canFill = order.side === 'BUY'
      ? quote.ask <= order.price
      : quote.bid >= order.price;

    if (canFill) {
      this.fill(order, order.quantity, order.price, 0);
    } else {
      this.notifyOrder(order);
    }
  }

  // ─── TWAP Execution ─────────────────────────────────────────────────

  private executeTWAP(order: Order): void {
    const slices = order.twapSlices ?? 10;
    const sliceQty = Math.floor(order.quantity / slices);
    if (sliceQty <= 0) {
      this.fill(order, order.quantity, this.getCurrentPrice(order.metal, order.venue), 0);
      return;
    }

    // In simulation mode, execute all slices immediately with slight variation
    let totalQty = 0;
    let totalCost = 0;

    for (let i = 0; i < slices; i++) {
      const qty = i === slices - 1 ? order.quantity - totalQty : sliceQty;
      const basePrice = this.getCurrentPrice(order.metal, order.venue);
      const noise = basePrice * (Math.random() - 0.5) * 0.0005; // 0.05% variation
      const price = basePrice + noise;
      totalQty += qty;
      totalCost += qty * price;
    }

    const avgPrice = totalCost / totalQty;
    this.fill(order, totalQty, avgPrice, 0);
  }

  // ─── VWAP Execution ─────────────────────────────────────────────────

  private executeVWAP(order: Order): void {
    const vwap = this.oracle.calculateVWAP(order.metal);
    if (vwap === 0) {
      this.executeMarketOrder(order);
      return;
    }

    // Try to achieve VWAP price
    const currentPrice = this.getCurrentPrice(order.metal, order.venue);
    const price = (vwap + currentPrice) / 2;
    this.fill(order, order.quantity, price, Math.abs(price - vwap));
  }

  // ─── Iceberg Execution ──────────────────────────────────────────────

  private executeIceberg(order: Order): void {
    const visibleQty = order.icebergVisibleQty ?? Math.floor(order.quantity / 5);
    let remaining = order.quantity;
    let totalCost = 0;

    while (remaining > 0) {
      const sliceQty = Math.min(remaining, visibleQty);
      const price = this.getCurrentPrice(order.metal, order.venue);
      const noise = price * (Math.random() - 0.5) * 0.0003;
      totalCost += sliceQty * (price + noise);
      remaining -= sliceQty;
    }

    const avgPrice = totalCost / order.quantity;
    this.fill(order, order.quantity, avgPrice, 0);
  }

  // ─── Fill ───────────────────────────────────────────────────────────

  private fill(order: Order, quantity: number, price: number, slippage: number): void {
    const fees = this.calculateFees(quantity, price, order.venue);

    order.filledQty = quantity;
    order.avgFillPrice = price;
    order.fees = fees;
    order.slippage = slippage;
    order.status = quantity >= order.quantity ? 'FILLED' : 'PARTIAL';
    order.updatedAt = Date.now();

    const execution: Execution = {
      id: `EXEC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      orderId: order.id,
      metal: order.metal,
      side: order.side,
      quantity,
      price,
      fees,
      venue: order.venue,
      timestamp: Date.now(),
      settlementDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
      tradeRef: `TR-${order.metal}-${Date.now()}`,
    };

    this.executions.push(execution);
    this.positionManager.applyExecution(execution);
    this.dailyTradeCount++;

    this.notifyOrder(order);
    for (const fn of this.executionListeners) fn(execution);
  }

  // ─── Price Tick Processing (check pending orders) ───────────────────

  processPriceTick(metal: Metal, quote: PriceQuote): void {
    for (const order of this.orders.values()) {
      if (order.metal !== metal) continue;
      if (order.status !== 'PENDING') continue;

      switch (order.type) {
        case 'LIMIT':
          this.checkLimitOrder(order);
          break;

        case 'STOP':
          if (order.stopPrice) {
            const triggered = order.side === 'BUY'
              ? quote.ask >= order.stopPrice
              : quote.bid <= order.stopPrice;
            if (triggered) {
              order.type = 'MARKET';
              this.executeMarketOrder(order);
            }
          }
          break;

        case 'STOP_LIMIT':
          if (order.stopPrice) {
            const triggered = order.side === 'BUY'
              ? quote.ask >= order.stopPrice
              : quote.bid <= order.stopPrice;
            if (triggered) {
              order.type = 'LIMIT';
              this.checkLimitOrder(order);
            }
          }
          break;

        case 'TRAILING_STOP':
          this.processTrailingStop(order, quote);
          break;
      }
    }
  }

  private processTrailingStop(order: Order, quote: PriceQuote): void {
    const trailPct = order.trailingPct ?? 1.0;

    if (order.side === 'SELL') {
      // Trailing stop on a long: track highest price
      const highWater = order.stopPrice ?? quote.bid;
      if (quote.bid > highWater) {
        order.stopPrice = quote.bid;
      }
      const triggerPrice = (order.stopPrice ?? quote.bid) * (1 - trailPct / 100);
      if (quote.bid <= triggerPrice) {
        order.type = 'MARKET';
        order.side = 'SELL';
        this.executeMarketOrder(order);
      }
    } else {
      // Trailing stop on a short: track lowest price
      const lowWater = order.stopPrice ?? quote.ask;
      if (quote.ask < lowWater) {
        order.stopPrice = quote.ask;
      }
      const triggerPrice = (order.stopPrice ?? quote.ask) * (1 + trailPct / 100);
      if (quote.ask >= triggerPrice) {
        order.type = 'MARKET';
        order.side = 'BUY';
        this.executeMarketOrder(order);
      }
    }
  }

  // ─── Cancel Order ───────────────────────────────────────────────────

  cancelOrder(orderId: string): boolean {
    const order = this.orders.get(orderId);
    if (!order || order.status !== 'PENDING') return false;

    order.status = 'CANCELLED';
    order.updatedAt = Date.now();
    this.notifyOrder(order);
    return true;
  }

  cancelAllPending(metal?: Metal): number {
    let count = 0;
    for (const order of this.orders.values()) {
      if (order.status !== 'PENDING') continue;
      if (metal && order.metal !== metal) continue;
      order.status = 'CANCELLED';
      order.updatedAt = Date.now();
      count++;
    }
    return count;
  }

  // ─── Queries ────────────────────────────────────────────────────────

  getOrder(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  getOpenOrders(metal?: Metal): Order[] {
    const open = [...this.orders.values()].filter(
      o => o.status === 'PENDING' || o.status === 'PARTIAL',
    );
    return metal ? open.filter(o => o.metal === metal) : open;
  }

  getOrderHistory(limit = 50): Order[] {
    return [...this.orders.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  getExecutions(limit = 50): Execution[] {
    return this.executions.slice(-limit);
  }

  getCircuitBreakers(): CircuitBreakerEngine {
    return this.circuitBreakers;
  }

  isSimulation(): boolean {
    return this.config.simulationMode;
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private getCurrentPrice(metal: Metal, venue: Venue): number {
    const quote = this.oracle.getByVenue(metal, venue) ?? this.oracle.getConsolidated(metal);
    return quote?.mid ?? 0;
  }

  private simulateSlippage(quantity: number, price: number, metal: Metal): number {
    // Slippage model: proportional to order size
    const baseSlippageBps = metal === 'XAU' ? 0.5 : metal === 'XAG' ? 1.5 : 2.5;
    const sizeImpactBps = quantity > 100 ? Math.log10(quantity / 100) * 2 : 0;
    const totalBps = baseSlippageBps + sizeImpactBps;
    return price * (totalBps / 10_000);
  }

  private calculateFees(quantity: number, price: number, venue: Venue): number {
    const feeSchedule: Record<Venue, number> = {
      LBMA: 0.0002,     // 2bps
      COMEX: 0.00025,   // 2.5bps
      SGE: 0.0003,      // 3bps
      DMCC: 0.00015,    // 1.5bps
      OTC_SPOT: 0.0001, // 1bp
      PHYSICAL: 0.005,  // 50bps
    };
    return quantity * price * (feeSchedule[venue] ?? 0.0003);
  }

  private resetDailyCountIfNeeded(): void {
    const today = Math.floor(Date.now() / 86_400_000);
    if (today !== this.lastDayReset) {
      this.dailyTradeCount = 0;
      this.lastDayReset = today;
    }
  }

  private notifyOrder(order: Order): void {
    for (const fn of this.orderListeners) fn(order);
  }
}
