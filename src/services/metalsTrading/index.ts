// ─── ULTRA MEGA Precious Metals Trading Platform — Barrel Export ─────────────
export * from './types';
export { PriceOracle, generateSimulatedPrices } from './priceOracle';
export {
  sma,
  ema,
  wma,
  rsi,
  macd,
  bollingerBands,
  stochastic,
  atr,
  adx,
  obv,
  ichimoku,
  fibonacci,
  pivotPoints,
  volumeProfile,
  detectSupportResistance,
  detectPatterns,
  computeAllIndicators,
  generateTASignals,
} from './technicalAnalysis';
export { ArbitrageScanner } from './arbitrageScanner';
export {
  analyzeOrderBook,
  computeLiquidity,
  VPINCalculator,
  FlowAnalyzer,
  decomposeSpread,
} from './marketMicrostructure';
export { AlertWeapon } from './alertWeapon';
export { PositionManager } from './positionManager';
export {
  DEFAULT_RISK_LIMITS,
  kellyPositionSize,
  fixedFractionalSize,
  volatilityAdjustedSize,
  calculateStopLoss,
  CircuitBreakerEngine,
  preTradeRiskCheck,
} from './riskMatrix';
export {
  detectRegime,
  generateTechnicalSignal,
  generateFlowSignal,
  generateMicrostructureSignal,
  generatePatternSignal,
  fuseSignals,
} from './signalFusion';
export { TradingEngine } from './tradingEngine';
export { MetalsTradingBrain, createTradingBrain } from './metalsTradingBrain';
export {
  generateDailyReport,
  formatAsanaTaskNotes,
  formatHTMLReport,
  formatJSONReport,
} from './tradingDailyReport';
export { dispatchDailyTradingReport, generateTradingReportBundle } from './tradingReportDispatcher';
export {
  hurstExponent,
  momentumExtrapolation,
  meanReversionModel,
  volatilityForecast,
  orderFlowPredictor,
  magnetModel,
  ensemblePrediction,
} from './predictiveIntelligence';
export {
  computeCorrelation,
  analyzeMacroDrivers,
  classifyMacroRegime,
  generateSimulatedMacro,
} from './macroRegime';
export {
  getActivePatterns,
  getSeasonalScore,
  getSeasonalCalendar,
  getUpcomingPatterns,
} from './seasonalPatterns';
export { runBacktest, monteCarloSimulation, STRATEGIES } from './backtestEngine';
export {
  evaluateStrategy,
  evaluateGridStrategy,
  evaluateDCAStrategy,
  evaluateMomentumScalp,
  evaluateRangeTrader,
  evaluateUltraSniper,
} from './autoStrategy';
export { analyzeTimeframe, computeConfluence } from './multiTimeframe';
export {
  analyzeTrade,
  analyzeVenuePerformance,
  generateExecutionSummary,
} from './executionAnalytics';
export {
  computeCovarianceMatrix,
  meanVarianceOptimize,
  riskParityOptimize,
  minVarianceOptimize,
  optimizePortfolio,
} from './portfolioOptimizer';
