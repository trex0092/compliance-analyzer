// ─── ULTRA MEGA Precious Metals Trading Platform — Type System ──────────────
// Covers: Gold (XAU), Silver (XAG), Platinum (XPT), Palladium (XPD)
// Markets: LBMA, COMEX, SGE, DMCC, OTC Spot, Physical Dealer

export type Metal = 'XAU' | 'XAG' | 'XPT' | 'XPD';
export type Currency = 'USD' | 'AED' | 'EUR' | 'GBP' | 'CHF' | 'CNY' | 'JPY';
export type TradeSide = 'BUY' | 'SELL';
export type OrderType =
  | 'MARKET'
  | 'LIMIT'
  | 'STOP'
  | 'STOP_LIMIT'
  | 'TRAILING_STOP'
  | 'ICEBERG'
  | 'TWAP'
  | 'VWAP';
export type OrderStatus = 'PENDING' | 'PARTIAL' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'EXPIRED';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK' | 'DAY' | 'GTD';
export type Venue = 'LBMA' | 'COMEX' | 'SGE' | 'DMCC' | 'OTC_SPOT' | 'PHYSICAL';
export type MarketRegime =
  | 'TRENDING_UP'
  | 'TRENDING_DOWN'
  | 'RANGING'
  | 'HIGH_VOLATILITY'
  | 'BREAKOUT'
  | 'MEAN_REVERSION';
export type SignalStrength = 'ULTRA_STRONG' | 'STRONG' | 'MODERATE' | 'WEAK' | 'NEUTRAL';
export type AlertSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

// ─── Price Data ─────────────────────────────────────────────────────────────

export interface PriceQuote {
  metal: Metal;
  currency: Currency;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  spreadBps: number;
  timestamp: number;
  venue: Venue;
  volume24h: number;
}

export interface OHLCV {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
  metal: Metal;
  currency: Currency;
  interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';
}

export interface PriceFeed {
  quotes: Map<string, PriceQuote>; // key: `${metal}/${currency}@${venue}`
  lastUpdate: number;
  latencyMs: number;
  status: 'LIVE' | 'STALE' | 'DISCONNECTED';
}

export interface LBMAFix {
  metal: Metal;
  amFixUSD: number;
  pmFixUSD: number;
  date: string; // dd/mm/yyyy
  participants: number;
}

export interface SpotSnapshot {
  metal: Metal;
  spotUSD: number;
  change24h: number;
  changePct24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  openInterest: number;
  timestamp: number;
}

// ─── Order & Execution ──────────────────────────────────────────────────────

export interface Order {
  id: string;
  metal: Metal;
  currency: Currency;
  side: TradeSide;
  type: OrderType;
  quantity: number; // troy ounces
  price?: number; // limit price
  stopPrice?: number;
  trailingAmount?: number;
  trailingPct?: number;
  icebergVisibleQty?: number;
  twapSlices?: number;
  twapIntervalMs?: number;
  timeInForce: TimeInForce;
  venue: Venue;
  status: OrderStatus;
  filledQty: number;
  avgFillPrice: number;
  fees: number;
  slippage: number;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  parentOrderId?: string;
  tags: string[];
  strategyId?: string;
  complianceCleared: boolean;
}

export interface Execution {
  id: string;
  orderId: string;
  metal: Metal;
  side: TradeSide;
  quantity: number;
  price: number;
  fees: number;
  venue: Venue;
  counterpartyId?: string;
  timestamp: number;
  settlementDate: string;
  tradeRef: string;
}

export interface ExecutionStrategy {
  id: string;
  name: string;
  type: 'AGGRESSIVE' | 'PASSIVE' | 'ADAPTIVE' | 'SNIPER' | 'STEALTH';
  maxSlippageBps: number;
  urgency: number; // 0-1
  splitOrders: boolean;
  maxOrderSize: number;
  cooldownMs: number;
  venuePreference: Venue[];
}

// ─── Position & Portfolio ───────────────────────────────────────────────────

export interface Position {
  metal: Metal;
  currency: Currency;
  venue: Venue;
  side: TradeSide;
  quantity: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPct: number;
  realizedPnL: number;
  totalPnL: number;
  marketValue: number;
  costBasis: number;
  openDate: number;
  lastTradeDate: number;
  stopLoss?: number;
  takeProfit?: number;
  trailingStop?: number;
}

export interface Portfolio {
  positions: Position[];
  totalMarketValue: number;
  totalCostBasis: number;
  totalUnrealizedPnL: number;
  totalRealizedPnL: number;
  totalPnL: number;
  totalPnLPct: number;
  cashBalance: number;
  marginUsed: number;
  marginAvailable: number;
  buyingPower: number;
  exposureByMetal: Record<Metal, number>;
  exposureByVenue: Record<Venue, number>;
  concentrationRisk: number; // 0-1, 1 = all in one position
  lastUpdate: number;
}

// ─── Risk Management ────────────────────────────────────────────────────────

export interface RiskLimits {
  maxPositionSize: number; // max troy oz per position
  maxPortfolioExposure: number; // max total market value
  maxLossPerTrade: number; // max loss before auto-close
  maxDailyLoss: number; // daily stop
  maxDrawdownPct: number; // max drawdown from peak
  maxConcentration: number; // max % in single metal
  maxLeverage: number;
  maxOpenOrders: number;
  maxDailyTrades: number;
  cooldownAfterLoss: number; // ms cooldown after hitting loss limit
}

export interface RiskMetrics {
  valueAtRisk1d: number; // 1-day 95% VaR
  valueAtRisk5d: number; // 5-day 95% VaR
  conditionalVaR: number; // Expected Shortfall
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  currentDrawdown: number;
  currentDrawdownPct: number;
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  avgWinLossRatio: number;
  dailyPnL: number;
  weeklyPnL: number;
  monthlyPnL: number;
  volatility30d: number;
  beta: number; // vs gold
  correlation: CorrelationMatrix;
  kellyFraction: number;
  optimalPositionSize: number;
}

export interface CorrelationMatrix {
  pairs: { metalA: Metal; metalB: Metal; correlation: number; period: number }[];
}

export interface CircuitBreaker {
  id: string;
  type: 'DAILY_LOSS' | 'DRAWDOWN' | 'VOLATILITY_SPIKE' | 'RAPID_LOSS' | 'CORRELATION_BREAK';
  threshold: number;
  currentValue: number;
  triggered: boolean;
  triggeredAt?: number;
  cooldownUntil?: number;
  action: 'HALT_TRADING' | 'REDUCE_SIZE' | 'CLOSE_ALL' | 'ALERT_ONLY';
}

// ─── Technical Analysis ─────────────────────────────────────────────────────

export interface TAIndicators {
  metal: Metal;
  timestamp: number;
  sma: Record<number, number>; // period -> value (20, 50, 100, 200)
  ema: Record<number, number>;
  rsi14: number;
  macd: { value: number; signal: number; histogram: number };
  bollingerBands: { upper: number; middle: number; lower: number; width: number };
  stochastic: { k: number; d: number };
  atr14: number;
  adx14: number;
  obv: number;
  vwap: number;
  fibonacci: { levels: number[]; trend: 'UP' | 'DOWN' };
  pivotPoints: {
    pivot: number;
    r1: number;
    r2: number;
    r3: number;
    s1: number;
    s2: number;
    s3: number;
  };
  ichimoku: { tenkan: number; kijun: number; senkouA: number; senkouB: number; chikou: number };
  volumeProfile: { poc: number; valueAreaHigh: number; valueAreaLow: number };
  supportLevels: number[];
  resistanceLevels: number[];
}

export interface PatternDetection {
  pattern: string;
  type: 'CONTINUATION' | 'REVERSAL' | 'BILATERAL';
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  entryPrice: number;
  targetPrice: number;
  stopPrice: number;
  riskReward: number;
  detectedAt: number;
}

// ─── Arbitrage ──────────────────────────────────────────────────────────────

export interface ArbitrageOpportunity {
  id: string;
  type:
    | 'SPOT_FUTURES'
    | 'CROSS_EXCHANGE'
    | 'TRIANGULAR'
    | 'RATIO_TRADE'
    | 'PHYSICAL_PAPER'
    | 'REGIONAL';
  metalA: Metal;
  metalB?: Metal;
  venueA: Venue;
  venueB: Venue;
  priceA: number;
  priceB: number;
  spreadAbs: number;
  spreadPct: number;
  estimatedProfit: number;
  estimatedCosts: number;
  netProfit: number;
  confidence: number;
  expiryMs: number; // how long the window lasts
  detectedAt: number;
  riskFactors: string[];
  executionPlan: { step: number; action: string; venue: Venue; side: TradeSide; qty: number }[];
}

// ─── Market Microstructure ──────────────────────────────────────────────────

export interface OrderBookLevel {
  price: number;
  quantity: number;
  orderCount: number;
}

export interface OrderBook {
  metal: Metal;
  venue: Venue;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  midPrice: number;
  spread: number;
  imbalance: number; // -1 to +1 (bid heavy to ask heavy)
  depth10: number; // total qty within 10 levels
  timestamp: number;
}

export interface FlowMetrics {
  metal: Metal;
  vpin: number; // Volume-synchronized Probability of Informed Trading
  tradeFlowImbalance: number;
  avgTradeSize: number;
  largeTradeCount: number;
  largeTradeThreshold: number;
  buyVolume: number;
  sellVolume: number;
  netFlow: number;
  toxicity: number; // 0-1, how toxic is the flow
  smartMoneyDirection: TradeSide | 'NEUTRAL';
  retailDirection: TradeSide | 'NEUTRAL';
  timestamp: number;
}

// ─── Alerts ─────────────────────────────────────────────────────────────────

export type AlertType =
  | 'PRICE_BREAKOUT'
  | 'PRICE_TARGET'
  | 'ARBITRAGE_WINDOW'
  | 'SPREAD_WIDENING'
  | 'VOLUME_ANOMALY'
  | 'CORRELATION_BREAK'
  | 'PATTERN_COMPLETE'
  | 'RISK_LIMIT_BREACH'
  | 'CIRCUIT_BREAKER'
  | 'LIQUIDITY_DRY'
  | 'FLOW_TOXICITY'
  | 'SMART_MONEY_MOVE'
  | 'SANCTIONS_COUNTERPARTY'
  | 'REGIME_CHANGE'
  | 'STOP_HUNT'
  | 'POSITION_EXPIRY'
  | 'MARGIN_CALL'
  | 'GOLD_SILVER_RATIO';

export interface TradingAlert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  metal: Metal;
  title: string;
  message: string;
  data: Record<string, unknown>;
  actionable: boolean;
  suggestedAction?: string;
  suggestedOrder?: Partial<Order>;
  createdAt: number;
  expiresAt?: number;
  acknowledged: boolean;
  autoExecute: boolean;
}

// ─── Signals & Decisions ────────────────────────────────────────────────────

export interface TradingSignal {
  id: string;
  source:
    | 'TECHNICAL'
    | 'MICROSTRUCTURE'
    | 'ARBITRAGE'
    | 'SENTIMENT'
    | 'FLOW'
    | 'PATTERN'
    | 'SEASONAL'
    | 'MACRO';
  metal: Metal;
  direction: TradeSide;
  strength: SignalStrength;
  confidence: number; // 0-1
  weight: number; // signal weight in fusion
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  riskReward: number;
  timeHorizon: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';
  reasoning: string;
  timestamp: number;
  expiresAt: number;
}

export interface FusedDecision {
  id: string;
  metal: Metal;
  direction: TradeSide;
  conviction: number; // 0-1 overall conviction
  regime: MarketRegime;
  signals: TradingSignal[];
  signalAlignment: number; // 0-1, how aligned are signals
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  positionSize: number;
  riskReward: number;
  expectedValue: number;
  kellySize: number;
  reasoning: string[];
  complianceCheck: { cleared: boolean; flags: string[] };
  timestamp: number;
}

// ─── Performance Analytics ──────────────────────────────────────────────────

export interface TradeRecord {
  id: string;
  metal: Metal;
  side: TradeSide;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPct: number;
  holdingPeriodMs: number;
  entryTime: number;
  exitTime: number;
  strategy: string;
  signalSource: string;
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
  fees: number;
  slippage: number;
}

export interface PerformanceStats {
  totalTrades: number;
  winRate: number;
  avgReturn: number;
  totalReturn: number;
  totalReturnPct: number;
  profitFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  avgHoldingPeriod: number;
  bestTrade: TradeRecord;
  worstTrade: TradeRecord;
  streaks: { currentWin: number; currentLoss: number; longestWin: number; longestLoss: number };
  byMetal: Record<Metal, { trades: number; winRate: number; pnl: number }>;
  byStrategy: Record<string, { trades: number; winRate: number; pnl: number }>;
  equityCurve: { timestamp: number; equity: number }[];
}

// ─── Session / Config ───────────────────────────────────────────────────────

export interface TradingSession {
  id: string;
  startedAt: number;
  config: TradingConfig;
  portfolio: Portfolio;
  riskMetrics: RiskMetrics;
  performance: PerformanceStats;
  activeAlerts: TradingAlert[];
  openOrders: Order[];
  tradeHistory: TradeRecord[];
  circuitBreakers: CircuitBreaker[];
}

export interface TradingConfig {
  activeMetal: Metal[];
  baseCurrency: Currency;
  activeVenues: Venue[];
  riskLimits: RiskLimits;
  executionStrategy: ExecutionStrategy;
  alertPreferences: Record<
    AlertType,
    { enabled: boolean; autoExecute: boolean; minSeverity: AlertSeverity }
  >;
  signalWeights: Record<TradingSignal['source'], number>;
  priceUpdateIntervalMs: number;
  complianceMode: boolean; // ties into existing compliance brain
}

// ─── Brain Integration ──────────────────────────────────────────────────────

export interface MetalsBrainRequest {
  metal: Metal;
  currentPrice: PriceQuote;
  technicals: TAIndicators;
  microstructure: FlowMetrics;
  orderBook: OrderBook;
  arbitrageOpps: ArbitrageOpportunity[];
  portfolio: Portfolio;
  riskMetrics: RiskMetrics;
  regime: MarketRegime;
  recentAlerts: TradingAlert[];
  history: OHLCV[];
}

export interface MetalsBrainResponse {
  decision: FusedDecision;
  alerts: TradingAlert[];
  riskAdjustments: { positionId?: string; action: string; reason: string }[];
  marketCommentary: string;
  confidence: number;
  processingTimeMs: number;
}
