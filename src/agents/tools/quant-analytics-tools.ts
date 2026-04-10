/**
 * Quantitative Analytics MCP Tools
 *
 * Statistical anomaly detection for AML transaction monitoring,
 * inspired by je-suis-tm/quant-trading strategies.
 *
 * Techniques applied:
 * 1. Bollinger Bands → Transaction volatility & anomaly detection
 * 2. Z-Score analysis → Outlier identification
 * 3. Monte Carlo simulation → Pattern probability assessment
 * 4. Structuring detection → Sub-threshold splitting patterns
 * 5. Velocity analysis → Rapid transaction burst detection
 *
 * Regulatory basis: FDL No.10/2025 Art.15-16,
 * MoE Circular 08/AML/2021 (AED 55K threshold)
 */

import type { ToolResult } from '../mcp-server';
import { DPMS_CASH_THRESHOLD_AED, STRUCTURING_CUMULATIVE_PCT } from '../../domain/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransactionDataPoint {
  amount: number;
  timestamp: string;
  currency: string;
  counterparty?: string;
  paymentMethod?: string;
}

export interface BollingerBandResult {
  upperBand: number;
  middleBand: number; // SMA
  lowerBand: number;
  currentValue: number;
  deviation: number;
  isAnomaly: boolean;
  bandWidth: number;
  percentB: number; // position within bands (>1 = above upper, <0 = below lower)
}

export interface StructuringAlert {
  detected: boolean;
  pattern: string;
  transactions: TransactionDataPoint[];
  cumulativeAmount: number;
  thresholdPct: number;
  confidence: number;
  timeWindowHours: number;
  regulatoryRef: string;
}

export interface ZScoreResult {
  zScore: number;
  mean: number;
  stdDev: number;
  isOutlier: boolean;
  outlierSeverity: 'none' | 'moderate' | 'severe' | 'extreme';
  pValue: number;
}

export interface MonteCarloResult {
  expectedValue: number;
  simulations: number;
  percentile95: number;
  percentile99: number;
  probabilityAboveThreshold: number;
  isAnomalous: boolean;
  confidenceInterval: [number, number];
}

export interface VelocityBurstResult {
  detected: boolean;
  transactionsInWindow: number;
  timeWindowMinutes: number;
  averageGap: number;
  minGap: number;
  burstScore: number;
}

export interface QuantAnalyticsReport {
  entityName: string;
  analyzedAt: string;
  transactionCount: number;
  bollingerBands: BollingerBandResult;
  structuring: StructuringAlert;
  zScore: ZScoreResult;
  monteCarlo: MonteCarloResult;
  velocityBurst: VelocityBurstResult;
  overallRiskScore: number;
  overallRiskLevel: 'low' | 'medium' | 'high' | 'critical';
  alerts: string[];
}

// ---------------------------------------------------------------------------
// Bollinger Bands (adapted from quant-trading)
// ---------------------------------------------------------------------------

export function calculateBollingerBands(
  amounts: number[],
  period: number = 20,
  stdDevMultiplier: number = 2
): BollingerBandResult {
  if (amounts.length < period) {
    // Not enough data — use all available
    const sma = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    return {
      upperBand: sma,
      middleBand: sma,
      lowerBand: sma,
      currentValue: amounts[amounts.length - 1] ?? 0,
      deviation: 0,
      isAnomaly: false,
      bandWidth: 0,
      percentB: 0.5,
    };
  }

  // Calculate SMA over the period
  const recentAmounts = amounts.slice(-period);
  const sma = recentAmounts.reduce((a, b) => a + b, 0) / period;

  // Standard deviation
  const variance = recentAmounts.reduce((sum, val) => sum + (val - sma) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  const upperBand = sma + stdDevMultiplier * stdDev;
  const lowerBand = sma - stdDevMultiplier * stdDev;
  const currentValue = amounts[amounts.length - 1];
  const bandWidth = (upperBand - lowerBand) / sma;
  const percentB = bandWidth > 0 ? (currentValue - lowerBand) / (upperBand - lowerBand) : 0.5;

  // Anomaly if current value exceeds bands
  const deviation = Math.abs(currentValue - sma) / (stdDev || 1);
  const isAnomaly = currentValue > upperBand || currentValue < lowerBand;

  return {
    upperBand,
    middleBand: sma,
    lowerBand,
    currentValue,
    deviation,
    isAnomaly,
    bandWidth,
    percentB,
  };
}

// ---------------------------------------------------------------------------
// Structuring Detection
// ---------------------------------------------------------------------------

export function detectStructuring(
  transactions: TransactionDataPoint[],
  threshold: number = DPMS_CASH_THRESHOLD_AED,
  timeWindowHours: number = 48
): StructuringAlert {
  if (transactions.length === 0) {
    return {
      detected: false,
      pattern: 'none',
      transactions: [],
      cumulativeAmount: 0,
      thresholdPct: 0,
      confidence: 0,
      timeWindowHours,
      regulatoryRef: 'FDL No.10/2025 Art.15-16',
    };
  }

  // Sort by timestamp
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const windowMs = timeWindowHours * 60 * 60 * 1000;
  let maxStructuringScore = 0;
  let bestWindow: TransactionDataPoint[] = [];
  let bestCumulative = 0;

  // Sliding window analysis
  for (let i = 0; i < sorted.length; i++) {
    const windowStart = new Date(sorted[i].timestamp).getTime();
    const windowEnd = windowStart + windowMs;

    const inWindow = sorted.filter((tx) => {
      const t = new Date(tx.timestamp).getTime();
      return t >= windowStart && t <= windowEnd;
    });

    const cumulative = inWindow.reduce((sum, tx) => sum + tx.amount, 0);

    // Structuring indicators:
    // 1. Multiple transactions just below threshold
    const justBelowThreshold = inWindow.filter(
      (tx) => tx.amount >= threshold * 0.5 && tx.amount < threshold
    );

    // 2. Cumulative near/above threshold
    const cumulativePct = cumulative / threshold;

    // 3. Consistent amounts (low variance = suspicious)
    const amounts = inWindow.map((tx) => tx.amount);
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const cv =
      amounts.length > 1
        ? Math.sqrt(amounts.reduce((s, v) => s + (v - mean) ** 2, 0) / amounts.length) / mean
        : 1;

    // Score: high when many sub-threshold txns with low variance add up near threshold
    let score = 0;
    if (justBelowThreshold.length >= 2) score += 0.3;
    if (cumulativePct >= STRUCTURING_CUMULATIVE_PCT && cumulativePct < 1.1) score += 0.3;
    if (cv < 0.3 && inWindow.length >= 3) score += 0.2; // suspiciously consistent amounts
    if (inWindow.length >= 3 && cumulative >= threshold) score += 0.2;

    if (score > maxStructuringScore) {
      maxStructuringScore = score;
      bestWindow = inWindow;
      bestCumulative = cumulative;
    }
  }

  const detected = maxStructuringScore >= 0.5;
  let pattern = 'none';
  if (maxStructuringScore >= 0.8) pattern = 'high-confidence-structuring';
  else if (maxStructuringScore >= 0.5) pattern = 'potential-structuring';
  else if (maxStructuringScore >= 0.3) pattern = 'low-confidence-pattern';

  return {
    detected,
    pattern,
    transactions: bestWindow,
    cumulativeAmount: bestCumulative,
    thresholdPct: bestCumulative / threshold,
    confidence: maxStructuringScore,
    timeWindowHours,
    regulatoryRef: 'FDL No.10/2025 Art.15-16',
  };
}

// ---------------------------------------------------------------------------
// Z-Score Analysis
// ---------------------------------------------------------------------------

export function calculateZScore(currentValue: number, historicalValues: number[]): ZScoreResult {
  if (historicalValues.length === 0) {
    return {
      zScore: 0,
      mean: currentValue,
      stdDev: 0,
      isOutlier: false,
      outlierSeverity: 'none',
      pValue: 1,
    };
  }

  const n = historicalValues.length;
  const mean = historicalValues.reduce((a, b) => a + b, 0) / n;
  // Use sample variance (Bessel's correction, N-1) for more conservative outlier detection
  const variance =
    historicalValues.reduce((sum, val) => sum + (val - mean) ** 2, 0) / Math.max(1, n - 1);
  const stdDev = Math.sqrt(variance);

  const zScore = stdDev > 0 ? (currentValue - mean) / stdDev : 0;
  const absZ = Math.abs(zScore);

  let outlierSeverity: ZScoreResult['outlierSeverity'] = 'none';
  if (absZ >= 4) outlierSeverity = 'extreme';
  else if (absZ >= 3) outlierSeverity = 'severe';
  else if (absZ >= 2) outlierSeverity = 'moderate';

  // Approximate p-value using normal distribution
  const pValue = approximatePValue(absZ);

  return {
    zScore,
    mean,
    stdDev,
    isOutlier: absZ >= 2,
    outlierSeverity,
    pValue,
  };
}

// ---------------------------------------------------------------------------
// Monte Carlo Simulation
// ---------------------------------------------------------------------------

export function runMonteCarloSimulation(
  historicalAmounts: number[],
  threshold: number = DPMS_CASH_THRESHOLD_AED,
  simulations: number = 10_000
): MonteCarloResult {
  if (historicalAmounts.length === 0) {
    return {
      expectedValue: 0,
      simulations,
      percentile95: 0,
      percentile99: 0,
      probabilityAboveThreshold: 0,
      isAnomalous: false,
      confidenceInterval: [0, 0],
    };
  }

  const mean = historicalAmounts.reduce((a, b) => a + b, 0) / historicalAmounts.length;
  const stdDev = Math.sqrt(
    historicalAmounts.reduce((sum, val) => sum + (val - mean) ** 2, 0) / historicalAmounts.length
  );

  // Generate simulated values using Box-Muller transform
  const simulated: number[] = [];
  for (let i = 0; i < simulations; i++) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    simulated.push(Math.max(0, mean + z * stdDev));
  }

  simulated.sort((a, b) => a - b);

  const p95 = simulated[Math.floor(simulations * 0.95)];
  const p99 = simulated[Math.floor(simulations * 0.99)];
  const aboveThreshold = simulated.filter((v) => v >= threshold).length;
  const probabilityAboveThreshold = aboveThreshold / simulations;

  const ci95Low = simulated[Math.floor(simulations * 0.025)];
  const ci95High = simulated[Math.floor(simulations * 0.975)];

  return {
    expectedValue: mean,
    simulations,
    percentile95: p95,
    percentile99: p99,
    probabilityAboveThreshold,
    isAnomalous: probabilityAboveThreshold > 0.05,
    confidenceInterval: [ci95Low, ci95High],
  };
}

// ---------------------------------------------------------------------------
// Velocity Burst Detection
// ---------------------------------------------------------------------------

export function detectVelocityBurst(
  transactions: TransactionDataPoint[],
  windowMinutes: number = 60,
  burstThreshold: number = 5
): VelocityBurstResult {
  if (transactions.length < 2) {
    return {
      detected: false,
      transactionsInWindow: transactions.length,
      timeWindowMinutes: windowMinutes,
      averageGap: 0,
      minGap: 0,
      burstScore: 0,
    };
  }

  const sorted = [...transactions].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const windowMs = windowMinutes * 60 * 1000;
  let maxInWindow = 0;

  // Find densest window
  for (let i = 0; i < sorted.length; i++) {
    const start = new Date(sorted[i].timestamp).getTime();
    const count = sorted.filter((tx) => {
      const t = new Date(tx.timestamp).getTime();
      return t >= start && t <= start + windowMs;
    }).length;
    maxInWindow = Math.max(maxInWindow, count);
  }

  // Calculate gaps between consecutive transactions
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap =
      new Date(sorted[i].timestamp).getTime() - new Date(sorted[i - 1].timestamp).getTime();
    gaps.push(gap / 60_000); // convert to minutes
  }

  const averageGap = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const minGap = gaps.length > 0 ? Math.min(...gaps) : 0;

  const burstScore = Math.min(1, maxInWindow / burstThreshold);

  return {
    detected: maxInWindow >= burstThreshold,
    transactionsInWindow: maxInWindow,
    timeWindowMinutes: windowMinutes,
    averageGap,
    minGap,
    burstScore,
  };
}

// ---------------------------------------------------------------------------
// Full Analytics Report
// ---------------------------------------------------------------------------

export function runQuantAnalytics(
  entityName: string,
  transactions: TransactionDataPoint[],
  historicalAmounts?: number[]
): ToolResult<QuantAnalyticsReport> {
  if (transactions.length === 0) {
    return { ok: false, error: 'No transactions provided for analysis' };
  }

  const amounts = transactions.map((tx) => tx.amount);
  const history = historicalAmounts ?? amounts.slice(0, -1);
  const currentAmount = amounts[amounts.length - 1];

  // Run all analyses
  const bollingerBands = calculateBollingerBands(amounts);
  const structuring = detectStructuring(transactions);
  const zScore = calculateZScore(currentAmount, history);
  const monteCarlo = runMonteCarloSimulation(history);
  const velocityBurst = detectVelocityBurst(transactions);

  // Composite risk score (0–20)
  const alerts: string[] = [];
  let riskScore = 0;

  if (bollingerBands.isAnomaly) {
    riskScore += 4;
    alerts.push(`Bollinger Band breach — value ${bollingerBands.deviation.toFixed(1)}σ from mean`);
  }
  if (structuring.detected) {
    riskScore += 6;
    alerts.push(
      `Structuring detected — ${structuring.pattern} (confidence: ${(structuring.confidence * 100).toFixed(0)}%)`
    );
  }
  if (zScore.isOutlier) {
    riskScore +=
      zScore.outlierSeverity === 'extreme' ? 5 : zScore.outlierSeverity === 'severe' ? 4 : 2;
    alerts.push(`Z-Score outlier — ${zScore.outlierSeverity} (z=${zScore.zScore.toFixed(2)})`);
  }
  if (monteCarlo.isAnomalous) {
    riskScore += 3;
    alerts.push(
      `Monte Carlo anomaly — ${(monteCarlo.probabilityAboveThreshold * 100).toFixed(1)}% probability above threshold`
    );
  }
  if (velocityBurst.detected) {
    riskScore += 3;
    alerts.push(
      `Velocity burst — ${velocityBurst.transactionsInWindow} txns in ${velocityBurst.timeWindowMinutes} min`
    );
  }

  let overallRiskLevel: QuantAnalyticsReport['overallRiskLevel'] = 'low';
  if (riskScore >= 16) overallRiskLevel = 'critical';
  else if (riskScore >= 11) overallRiskLevel = 'high';
  else if (riskScore >= 6) overallRiskLevel = 'medium';

  return {
    ok: true,
    data: {
      entityName,
      analyzedAt: new Date().toISOString(),
      transactionCount: transactions.length,
      bollingerBands,
      structuring,
      zScore,
      monteCarlo,
      velocityBurst,
      overallRiskScore: riskScore,
      overallRiskLevel,
      alerts,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function approximatePValue(z: number): number {
  // Abramowitz & Stegun approximation for cumulative normal
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  const absZ = Math.abs(z);
  const t = 1.0 / (1.0 + p * absZ);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp((-absZ * absZ) / 2);

  return 2 * (1 - 0.5 * (1.0 + sign * y));
}

// ---------------------------------------------------------------------------
// Schema exports for MCP registration
// ---------------------------------------------------------------------------

export const QUANT_TOOL_SCHEMAS = [
  {
    name: 'analyze_transactions_quant',
    description:
      'Run full quantitative analysis on transaction history: Bollinger Bands (volatility), Z-Score (outliers), Monte Carlo (probability), structuring detection (AED 55K threshold splitting), velocity burst detection. Inspired by quant-trading strategies.',
    inputSchema: {
      type: 'object',
      properties: {
        entityName: { type: 'string', description: 'Entity being analyzed' },
        transactions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              amount: { type: 'number' },
              timestamp: { type: 'string' },
              currency: { type: 'string' },
              counterparty: { type: 'string' },
              paymentMethod: { type: 'string' },
            },
            required: ['amount', 'timestamp', 'currency'],
          },
          description: 'Array of transaction data points',
        },
        historicalAmounts: {
          type: 'array',
          items: { type: 'number' },
          description: 'Optional historical amounts for baseline comparison',
        },
      },
      required: ['entityName', 'transactions'],
    },
  },
  {
    name: 'detect_structuring',
    description:
      'Detect transaction structuring patterns (splitting to avoid AED 55,000 threshold). Uses sliding-window analysis with cumulative amount, variance, and frequency scoring. Regulatory: FDL Art.15-16.',
    inputSchema: {
      type: 'object',
      properties: {
        transactions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              amount: { type: 'number' },
              timestamp: { type: 'string' },
              currency: { type: 'string' },
            },
            required: ['amount', 'timestamp', 'currency'],
          },
        },
        threshold: { type: 'number', description: 'Threshold amount (default: AED 55,000)' },
        timeWindowHours: { type: 'number', description: 'Analysis window in hours (default: 48)' },
      },
      required: ['transactions'],
    },
  },
  {
    name: 'bollinger_bands_analysis',
    description:
      'Calculate Bollinger Bands for transaction amount series. Detects volatility anomalies where current transaction amount falls outside 2σ bands. Useful for identifying unusual transaction behavior.',
    inputSchema: {
      type: 'object',
      properties: {
        amounts: {
          type: 'array',
          items: { type: 'number' },
          description: 'Historical transaction amounts',
        },
        period: { type: 'number', description: 'Moving average period (default: 20)' },
        stdDevMultiplier: { type: 'number', description: 'Band width multiplier (default: 2)' },
      },
      required: ['amounts'],
    },
  },
  {
    name: 'monte_carlo_risk',
    description:
      'Run Monte Carlo simulation on historical transaction data to model probability of exceeding AED 55K threshold. Returns percentiles, confidence intervals, and anomaly flag.',
    inputSchema: {
      type: 'object',
      properties: {
        historicalAmounts: { type: 'array', items: { type: 'number' } },
        threshold: {
          type: 'number',
          description: 'Threshold to check against (default: AED 55,000)',
        },
        simulations: { type: 'number', description: 'Number of simulations (default: 10,000)' },
      },
      required: ['historicalAmounts'],
    },
  },
] as const;
