// ─── Metals Trading Brain: AI Orchestrator ──────────────────────────────────
// Ties together: PriceOracle, TechnicalAnalysis, ArbitrageScanner,
// MarketMicrostructure, AlertWeapon, PositionManager, RiskMatrix,
// SignalFusion, TradingEngine. Produces unified trading decisions.

import type {
  Metal, TradingSession, TradingConfig, MetalsBrainResponse,
  PriceQuote, OHLCV, FusedDecision,
  MarketRegime, TradingSignal,
} from './types';
import { PriceOracle, generateSimulatedPrices } from './priceOracle';
import { computeAllIndicators, detectPatterns } from './technicalAnalysis';
import { ArbitrageScanner } from './arbitrageScanner';
import { FlowAnalyzer, analyzeOrderBook } from './marketMicrostructure';
import { AlertWeapon } from './alertWeapon';
import { PositionManager } from './positionManager';
import { CircuitBreakerEngine, DEFAULT_RISK_LIMITS } from './riskMatrix';
import {
  detectRegime, generateTechnicalSignal, generateFlowSignal,
  generateMicrostructureSignal, generatePatternSignal, fuseSignals,
} from './signalFusion';
import { TradingEngine } from './tradingEngine';

// ─── Default Configuration ──────────────────────────────────────────────────

const DEFAULT_CONFIG: TradingConfig = {
  activeMetal: ['XAU', 'XAG', 'XPT', 'XPD'],
  baseCurrency: 'USD',
  activeVenues: ['LBMA', 'COMEX', 'DMCC', 'OTC_SPOT'],
  riskLimits: DEFAULT_RISK_LIMITS,
  executionStrategy: {
    id: 'default',
    name: 'Adaptive',
    type: 'ADAPTIVE',
    maxSlippageBps: 15,
    urgency: 0.5,
    splitOrders: true,
    maxOrderSize: 500,
    cooldownMs: 5000,
    venuePreference: ['DMCC', 'LBMA', 'COMEX'],
  },
  alertPreferences: {} as TradingConfig['alertPreferences'],
  signalWeights: {
    TECHNICAL: 0.25,
    MICROSTRUCTURE: 0.20,
    FLOW: 0.15,
    PATTERN: 0.15,
    ARBITRAGE: 0.10,
    SENTIMENT: 0.05,
    SEASONAL: 0.05,
    MACRO: 0.05,
  },
  priceUpdateIntervalMs: 1000,
  complianceMode: true,
};

// ─── Brain Class ────────────────────────────────────────────────────────────

export class MetalsTradingBrain {
  readonly oracle: PriceOracle;
  readonly arbitrage: ArbitrageScanner;
  readonly alerts: AlertWeapon;
  readonly positions: PositionManager;
  readonly engine: TradingEngine;
  readonly config: TradingConfig;

  private flowAnalyzers: Map<Metal, FlowAnalyzer> = new Map();
  private circuitBreakers: CircuitBreakerEngine;
  private simulationInterval: ReturnType<typeof setInterval> | null = null;
  private candleHistory: Map<string, OHLCV[]> = new Map();
  private latestDecisions: Map<Metal, FusedDecision> = new Map();
  private latestRegimes: Map<Metal, MarketRegime> = new Map();
  private sessionId: string;
  private startedAt: number;

  constructor(config: Partial<TradingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.oracle = new PriceOracle();
    this.arbitrage = new ArbitrageScanner();
    this.alerts = new AlertWeapon();
    this.positions = new PositionManager(100_000);
    this.circuitBreakers = new CircuitBreakerEngine(this.config.riskLimits);
    this.engine = new TradingEngine(this.oracle, this.positions);
    this.sessionId = `SESSION-${Date.now()}`;
    this.startedAt = Date.now();

    for (const metal of this.config.activeMetal) {
      this.flowAnalyzers.set(metal as Metal, new FlowAnalyzer());
    }

    // Seed initial simulated data
    this.seedHistoricalData();
  }

  // ─── Start/Stop Simulation ──────────────────────────────────────────

  startSimulation(intervalMs: number = 2000): void {
    if (this.simulationInterval) return;

    this.simulationInterval = setInterval(() => {
      this.tick();
    }, intervalMs);
  }

  stopSimulation(): void {
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
    }
  }

  isRunning(): boolean {
    return this.simulationInterval !== null;
  }

  // ─── Core Tick ──────────────────────────────────────────────────────

  tick(): MetalsBrainResponse[] {
    const responses: MetalsBrainResponse[] = [];

    for (const metal of this.config.activeMetal as Metal[]) {
      const response = this.processMetal(metal);
      responses.push(response);
    }

    // Cross-metal analysis
    this.checkGoldSilverRatio();

    return responses;
  }

  private processMetal(metal: Metal): MetalsBrainResponse {
    const start = Date.now();

    // 1. Ingest new price
    const quote = generateSimulatedPrices(metal);
    this.oracle.ingestQuote(quote);

    // Build candle from tick
    this.updateCandle(metal, quote);

    // 2. Compute technicals
    const candles = this.getCandles(metal);
    const indicators = candles.length >= 20
      ? computeAllIndicators(candles, metal)
      : null;

    // 3. Flow analysis
    const flowAnalyzer = this.flowAnalyzers.get(metal);
    const side = Math.random() > 0.5 ? 'BUY' as const : 'SELL' as const;
    flowAnalyzer?.addTrade({
      price: quote.mid,
      volume: Math.floor(Math.random() * 100) + 1,
      side,
      timestamp: Date.now(),
    });
    const flowMetrics = flowAnalyzer?.analyze(metal);

    // 4. Order book (simulated)
    const book = this.simulateOrderBook(metal, quote);

    // 5. Patterns
    const patterns = candles.length >= 20 ? detectPatterns(candles) : [];

    // 6. Regime detection
    const regime = indicators
      ? detectRegime(indicators, candles.map(c => c.close))
      : 'RANGING' as MarketRegime;
    this.latestRegimes.set(metal, regime);

    // 7. Generate signals
    const signals: TradingSignal[] = [];

    if (indicators) {
      const techSignal = generateTechnicalSignal(metal, indicators, quote.mid);
      if (techSignal) signals.push(techSignal);
    }

    if (flowMetrics) {
      const flowSignal = generateFlowSignal(metal, flowMetrics, quote.mid, indicators?.atr14 ?? quote.mid * 0.01);
      if (flowSignal) signals.push(flowSignal);

      const microSignal = generateMicrostructureSignal(
        metal, flowMetrics, book.imbalance, quote.mid, indicators?.atr14 ?? quote.mid * 0.01,
      );
      if (microSignal) signals.push(microSignal);
    }

    if (patterns.length > 0) {
      const patternSignal = generatePatternSignal(metal, patterns, quote.mid);
      if (patternSignal) signals.push(patternSignal);
    }

    // 8. Fuse signals into decision
    const riskMetrics = this.positions.computeRiskMetrics([]);
    const decision = fuseSignals(metal, signals, regime, riskMetrics, quote.mid, this.config.signalWeights);
    this.latestDecisions.set(metal, decision);

    // 9. Arbitrage scan
    const arbOpps = this.arbitrage.scanAll(this.oracle);

    // 10. Alert evaluation
    const newAlerts = this.alerts.evaluate({
      metal,
      price: quote,
      indicators: indicators ?? undefined,
      flow: flowMetrics,
      book,
      arbitrage: arbOpps,
      positions: this.positions.getAllPositions().filter(p => p.metal === metal),
      riskMetrics,
      circuitBreakers: this.circuitBreakers.getAll(),
      regime,
      priceHistory: this.oracle.getTicks(metal, 20),
    });

    // 11. Process pending orders
    this.engine.processPriceTick(metal, quote);

    // 12. Update positions with new prices
    const quoteMap = new Map<Metal, PriceQuote>();
    quoteMap.set(metal, quote);
    this.positions.updatePrices(quoteMap);

    return {
      decision,
      alerts: newAlerts,
      riskAdjustments: [],
      marketCommentary: this.generateCommentary(metal, quote, regime, decision, signals),
      confidence: decision.conviction,
      processingTimeMs: Date.now() - start,
    };
  }

  // ─── Gold/Silver Ratio Monitoring ───────────────────────────────────

  private checkGoldSilverRatio(): void {
    const gsRatio = this.oracle.getGoldSilverRatio();
    if (gsRatio) {
      this.alerts.evaluate({
        metal: 'XAU',
        price: this.oracle.getConsolidated('XAU')!,
        goldSilverRatio: gsRatio.ratio,
      });
    }
  }

  // ─── Session State ─────────────────────────────────────────────────

  getSession(): TradingSession {
    return {
      id: this.sessionId,
      startedAt: this.startedAt,
      config: this.config,
      portfolio: this.positions.getPortfolio(),
      riskMetrics: this.positions.computeRiskMetrics([]),
      performance: this.positions.getPerformanceStats(),
      activeAlerts: this.alerts.getActive(),
      openOrders: this.engine.getOpenOrders(),
      tradeHistory: this.positions.getTradeHistory(),
      circuitBreakers: this.circuitBreakers.getAll(),
    };
  }

  getDecision(metal: Metal): FusedDecision | undefined {
    return this.latestDecisions.get(metal);
  }

  getRegime(metal: Metal): MarketRegime {
    return this.latestRegimes.get(metal) ?? 'RANGING';
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private seedHistoricalData(): void {
    for (const metal of this.config.activeMetal as Metal[]) {
      const candles: OHLCV[] = [];
      const basePrices: Record<Metal, number> = {
        XAU: 2340.50, XAG: 29.85, XPT: 985.00, XPD: 1025.00,
      };
      let price = basePrices[metal];

      for (let i = 200; i >= 0; i--) {
        const change = (Math.random() - 0.48) * price * 0.008; // slight upward bias
        const open = price;
        price += change;
        const high = Math.max(open, price) + Math.random() * price * 0.003;
        const low = Math.min(open, price) - Math.random() * price * 0.003;

        candles.push({
          open,
          high,
          low,
          close: price,
          volume: Math.floor(Math.random() * 50_000) + 10_000,
          timestamp: Date.now() - i * 3_600_000,
          metal,
          currency: 'USD',
          interval: '1h',
        });
      }

      this.candleHistory.set(`${metal}/1h`, candles);
    }
  }

  private updateCandle(metal: Metal, quote: PriceQuote): void {
    const key = `${metal}/1h`;
    const candles = this.candleHistory.get(key) ?? [];
    const currentHour = Math.floor(Date.now() / 3_600_000);

    if (candles.length > 0) {
      const lastCandle = candles[candles.length - 1];
      const lastHour = Math.floor(lastCandle.timestamp / 3_600_000);

      if (currentHour === lastHour) {
        // Update current candle
        lastCandle.high = Math.max(lastCandle.high, quote.ask);
        lastCandle.low = Math.min(lastCandle.low, quote.bid);
        lastCandle.close = quote.mid;
        lastCandle.volume += Math.floor(Math.random() * 100);
      } else {
        // New candle
        candles.push({
          open: quote.mid,
          high: quote.ask,
          low: quote.bid,
          close: quote.mid,
          volume: Math.floor(Math.random() * 1000),
          timestamp: Date.now(),
          metal,
          currency: 'USD',
          interval: '1h',
        });
        if (candles.length > 500) candles.shift();
      }
    }

    this.candleHistory.set(key, candles);
  }

  private getCandles(metal: Metal): OHLCV[] {
    return this.candleHistory.get(`${metal}/1h`) ?? [];
  }

  private simulateOrderBook(metal: Metal, quote: PriceQuote) {
    const levels = 10;
    const bids = [];
    const asks = [];
    for (let i = 0; i < levels; i++) {
      const offset = quote.spread * (i + 1) * 0.5;
      bids.push({ price: quote.bid - offset, quantity: Math.floor(Math.random() * 500) + 50, orderCount: Math.floor(Math.random() * 10) + 1 });
      asks.push({ price: quote.ask + offset, quantity: Math.floor(Math.random() * 500) + 50, orderCount: Math.floor(Math.random() * 10) + 1 });
    }
    return analyzeOrderBook(bids, asks, metal, quote.venue);
  }

  private generateCommentary(
    metal: Metal, quote: PriceQuote, regime: MarketRegime,
    decision: FusedDecision, signals: TradingSignal[],
  ): string {
    const parts: string[] = [];
    parts.push(`${metal} @ $${quote.mid.toFixed(2)} (${regime})`);

    if (decision.conviction > 0.6) {
      parts.push(`Strong ${decision.direction} signal (${(decision.conviction * 100).toFixed(0)}% conviction)`);
    } else if (decision.conviction > 0.3) {
      parts.push(`Moderate ${decision.direction} lean (${(decision.conviction * 100).toFixed(0)}% conviction)`);
    } else {
      parts.push('No clear direction — stand aside');
    }

    if (signals.length > 0) {
      const alignment = decision.signalAlignment;
      parts.push(`${signals.length} signals, ${(alignment * 100).toFixed(0)}% aligned`);
    }

    return parts.join(' | ');
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createTradingBrain(config?: Partial<TradingConfig>): MetalsTradingBrain {
  return new MetalsTradingBrain(config);
}
