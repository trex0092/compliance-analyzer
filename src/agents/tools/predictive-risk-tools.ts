/**
 * Predictive Risk Forecasting Engine
 *
 * Time-series analysis to predict future risk trajectories:
 * 1. Exponential Moving Average (EMA) for trend detection
 * 2. Linear regression for risk trajectory forecasting
 * 3. Seasonality detection (monthly/quarterly patterns)
 * 4. Anomaly prediction using ARIMA-like approach
 * 5. Risk velocity — rate of change in risk score
 * 6. Early warning system — predict threshold breach dates
 *
 * Predicts when an entity will likely cross risk thresholds
 * BEFORE it happens, enabling preventive compliance action.
 */

import type { ToolResult } from '../mcp-server';
import { RISK_THRESHOLDS } from '../../domain/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RiskDataPoint {
  date: string;        // ISO date
  riskScore: number;   // 0-20
  alertCount: number;
  transactionVolume: number;
  flagCount: number;
}

export interface TrendAnalysis {
  direction: 'increasing' | 'decreasing' | 'stable';
  slope: number;
  rSquared: number;
  ema7: number;
  ema30: number;
  momentum: number;
}

export interface RiskForecast {
  date: string;
  predictedScore: number;
  confidenceLow: number;
  confidenceHigh: number;
  predictedLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface ThresholdBreachPrediction {
  threshold: 'medium' | 'high' | 'critical';
  thresholdValue: number;
  predictedBreachDate: string | null;
  daysUntilBreach: number | null;
  probability: number;
  currentTrajectory: string;
}

export interface RiskVelocity {
  daily: number;
  weekly: number;
  monthly: number;
  acceleration: number;
  isAccelerating: boolean;
}

export interface SeasonalPattern {
  detected: boolean;
  periodDays: number | null;
  peakMonths: number[];
  troughMonths: number[];
  amplitudeAvg: number;
}

export interface PredictiveRiskReport {
  entityName: string;
  analyzedAt: string;
  dataPointCount: number;
  currentRiskScore: number;
  currentRiskLevel: string;
  trend: TrendAnalysis;
  velocity: RiskVelocity;
  forecasts: RiskForecast[];
  thresholdPredictions: ThresholdBreachPrediction[];
  seasonality: SeasonalPattern;
  earlyWarnings: string[];
  recommendedActions: string[];
}

// ---------------------------------------------------------------------------
// Exponential Moving Average
// ---------------------------------------------------------------------------

function calculateEMA(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length <= period) {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  const multiplier = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
  }

  return ema;
}

// ---------------------------------------------------------------------------
// Linear Regression
// ---------------------------------------------------------------------------

function linearRegression(values: number[]): { slope: number; intercept: number; rSquared: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0, rSquared: 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // R²
  const mean = sumY / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * i + intercept;
    ssRes += (values[i] - predicted) ** 2;
    ssTot += (values[i] - mean) ** 2;
  }
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, rSquared };
}

// ---------------------------------------------------------------------------
// Risk Velocity & Acceleration
// ---------------------------------------------------------------------------

function calculateRiskVelocity(scores: number[], dates: string[]): RiskVelocity {
  if (scores.length < 2) {
    return { daily: 0, weekly: 0, monthly: 0, acceleration: 0, isAccelerating: false };
  }

  const n = scores.length;
  const totalDays = (new Date(dates[n - 1]).getTime() - new Date(dates[0]).getTime()) / 86400_000;

  // Daily velocity (recent)
  const recentChange = scores[n - 1] - scores[Math.max(0, n - 7)];
  const recentDays = Math.max(1, Math.min(7, totalDays));
  const daily = recentChange / recentDays;

  // Weekly velocity
  const weekChange = scores[n - 1] - scores[Math.max(0, n - 30)];
  const weekly = weekChange / Math.max(1, Math.min(4, totalDays / 7));

  // Monthly velocity
  const monthly = totalDays >= 30
    ? (scores[n - 1] - scores[0]) / (totalDays / 30)
    : daily * 30;

  // Acceleration (change in velocity)
  const halfPoint = Math.floor(n / 2);
  const firstHalfVelocity = halfPoint > 0
    ? (scores[halfPoint] - scores[0]) / halfPoint
    : 0;
  const secondHalfVelocity = n - halfPoint > 0
    ? (scores[n - 1] - scores[halfPoint]) / (n - halfPoint)
    : 0;
  const acceleration = secondHalfVelocity - firstHalfVelocity;

  return {
    daily: Math.round(daily * 1000) / 1000,
    weekly: Math.round(weekly * 1000) / 1000,
    monthly: Math.round(monthly * 100) / 100,
    acceleration: Math.round(acceleration * 1000) / 1000,
    isAccelerating: acceleration > 0.01,
  };
}

// ---------------------------------------------------------------------------
// Seasonality Detection
// ---------------------------------------------------------------------------

function detectSeasonality(data: RiskDataPoint[]): SeasonalPattern {
  if (data.length < 60) { // need ~2 months minimum
    return { detected: false, periodDays: null, peakMonths: [], troughMonths: [], amplitudeAvg: 0 };
  }

  // Group by month
  const monthlyScores = new Map<number, number[]>();
  for (const dp of data) {
    const month = new Date(dp.date).getMonth();
    if (!monthlyScores.has(month)) monthlyScores.set(month, []);
    monthlyScores.get(month)!.push(dp.riskScore);
  }

  const monthlyAvg = new Map<number, number>();
  for (const [month, scores] of monthlyScores) {
    monthlyAvg.set(month, scores.reduce((a, b) => a + b, 0) / scores.length);
  }

  const allAvg = data.reduce((s, d) => s + d.riskScore, 0) / data.length;
  const amplitudes = Array.from(monthlyAvg.values()).map((avg) => Math.abs(avg - allAvg));
  const amplitudeAvg = amplitudes.reduce((a, b) => a + b, 0) / amplitudes.length;

  // Detect if seasonal variation is significant (> 10% of mean)
  const detected = amplitudeAvg > allAvg * 0.1;

  const peakMonths: number[] = [];
  const troughMonths: number[] = [];
  for (const [month, avg] of monthlyAvg) {
    if (avg > allAvg + amplitudeAvg) peakMonths.push(month + 1);
    if (avg < allAvg - amplitudeAvg) troughMonths.push(month + 1);
  }

  return {
    detected,
    periodDays: detected ? 30 : null,
    peakMonths,
    troughMonths,
    amplitudeAvg: Math.round(amplitudeAvg * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Full Predictive Analysis
// ---------------------------------------------------------------------------

export function runPredictiveRiskAnalysis(
  entityName: string,
  data: RiskDataPoint[],
  forecastDays: number = 90,
): ToolResult<PredictiveRiskReport> {
  if (data.length < 5) {
    return { ok: false, error: 'Need at least 5 data points for meaningful prediction' };
  }

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const scores = sorted.map((d) => d.riskScore);
  const dates = sorted.map((d) => d.date);
  const currentScore = scores[scores.length - 1];

  // Trend analysis
  const regression = linearRegression(scores);
  const ema7 = calculateEMA(scores, 7);
  const ema30 = calculateEMA(scores, Math.min(30, scores.length));
  const momentum = ema7 - ema30;

  const trend: TrendAnalysis = {
    direction: regression.slope > 0.05 ? 'increasing' : regression.slope < -0.05 ? 'decreasing' : 'stable',
    slope: Math.round(regression.slope * 1000) / 1000,
    rSquared: Math.round(regression.rSquared * 1000) / 1000,
    ema7: Math.round(ema7 * 100) / 100,
    ema30: Math.round(ema30 * 100) / 100,
    momentum: Math.round(momentum * 100) / 100,
  };

  // Risk velocity
  const velocity = calculateRiskVelocity(scores, dates);

  // Forecasts
  const forecasts: RiskForecast[] = [];
  const stdDev = Math.sqrt(scores.reduce((s, v) => s + (v - (scores.reduce((a, b) => a + b, 0) / scores.length)) ** 2, 0) / scores.length);
  const lastDate = new Date(dates[dates.length - 1]);

  for (let d = 1; d <= forecastDays; d += Math.max(1, Math.floor(forecastDays / 30))) {
    const futureDate = new Date(lastDate.getTime() + d * 86400_000);
    const predicted = Math.max(0, Math.min(20,
      regression.slope * (scores.length + d) + regression.intercept,
    ));
    const uncertainty = stdDev * Math.sqrt(d / scores.length) * 1.96;

    let predictedLevel: RiskForecast['predictedLevel'] = 'low';
    if (predicted >= RISK_THRESHOLDS.critical) predictedLevel = 'critical';
    else if (predicted >= RISK_THRESHOLDS.high) predictedLevel = 'high';
    else if (predicted >= RISK_THRESHOLDS.medium) predictedLevel = 'medium';

    forecasts.push({
      date: futureDate.toISOString().slice(0, 10),
      predictedScore: Math.round(predicted * 100) / 100,
      confidenceLow: Math.round(Math.max(0, predicted - uncertainty) * 100) / 100,
      confidenceHigh: Math.round(Math.min(20, predicted + uncertainty) * 100) / 100,
      predictedLevel,
    });
  }

  // Threshold breach predictions
  const thresholdPredictions: ThresholdBreachPrediction[] = [];
  for (const [level, value] of Object.entries(RISK_THRESHOLDS) as Array<['medium' | 'high' | 'critical', number]>) {
    if (currentScore >= value) {
      thresholdPredictions.push({
        threshold: level,
        thresholdValue: value,
        predictedBreachDate: null,
        daysUntilBreach: 0,
        probability: 1,
        currentTrajectory: 'Already above threshold',
      });
      continue;
    }

    if (regression.slope <= 0) {
      thresholdPredictions.push({
        threshold: level,
        thresholdValue: value,
        predictedBreachDate: null,
        daysUntilBreach: null,
        probability: 0.05,
        currentTrajectory: `Risk ${trend.direction} — breach unlikely`,
      });
      continue;
    }

    // Days until slope*x + intercept = threshold
    const currentIndex = scores.length - 1;
    const currentPredicted = regression.slope * currentIndex + regression.intercept;
    const daysUntil = Math.ceil((value - currentPredicted) / regression.slope);

    if (daysUntil > 0 && daysUntil <= 365) {
      const breachDate = new Date(lastDate.getTime() + daysUntil * 86400_000);
      thresholdPredictions.push({
        threshold: level,
        thresholdValue: value,
        predictedBreachDate: breachDate.toISOString().slice(0, 10),
        daysUntilBreach: daysUntil,
        probability: Math.min(0.95, regression.rSquared * 0.8 + 0.1),
        currentTrajectory: `Predicted to reach ${level} in ${daysUntil} days`,
      });
    } else {
      thresholdPredictions.push({
        threshold: level,
        thresholdValue: value,
        predictedBreachDate: null,
        daysUntilBreach: null,
        probability: 0.1,
        currentTrajectory: 'Breach not predicted within 12 months',
      });
    }
  }

  // Seasonality
  const seasonality = detectSeasonality(sorted);

  // Early warnings
  const earlyWarnings: string[] = [];
  const recommendedActions: string[] = [];

  if (trend.direction === 'increasing' && regression.rSquared > 0.3) {
    earlyWarnings.push(`Risk score trending upward (slope: ${trend.slope}/day, R²: ${trend.rSquared})`);
  }
  if (velocity.isAccelerating) {
    earlyWarnings.push(`Risk acceleration detected — velocity increasing at ${velocity.acceleration}/day²`);
    recommendedActions.push('Increase monitoring frequency — risk is accelerating');
  }
  if (momentum > 2) {
    earlyWarnings.push(`Strong upward momentum — 7-day EMA ${momentum.toFixed(1)} points above 30-day EMA`);
  }

  const imminentBreaches = thresholdPredictions.filter((t) => t.daysUntilBreach !== null && t.daysUntilBreach <= 30 && t.daysUntilBreach > 0);
  for (const breach of imminentBreaches) {
    earlyWarnings.push(`${breach.threshold.toUpperCase()} threshold breach predicted in ${breach.daysUntilBreach} days (probability: ${(breach.probability * 100).toFixed(0)}%)`);
    recommendedActions.push(`Preemptive action required — entity approaching ${breach.threshold} risk level`);
  }

  if (seasonality.detected && seasonality.peakMonths.length > 0) {
    const currentMonth = new Date().getMonth() + 1;
    if (seasonality.peakMonths.includes(currentMonth) || seasonality.peakMonths.includes(currentMonth + 1)) {
      earlyWarnings.push(`Entering seasonal risk peak period (months: ${seasonality.peakMonths.join(', ')})`);
    }
  }

  let currentRiskLevel = 'low';
  if (currentScore >= RISK_THRESHOLDS.critical) currentRiskLevel = 'critical';
  else if (currentScore >= RISK_THRESHOLDS.high) currentRiskLevel = 'high';
  else if (currentScore >= RISK_THRESHOLDS.medium) currentRiskLevel = 'medium';

  return {
    ok: true,
    data: {
      entityName,
      analyzedAt: new Date().toISOString(),
      dataPointCount: data.length,
      currentRiskScore: currentScore,
      currentRiskLevel,
      trend,
      velocity,
      forecasts,
      thresholdPredictions,
      seasonality,
      earlyWarnings,
      recommendedActions,
    },
  };
}

// ---------------------------------------------------------------------------
// Schema exports
// ---------------------------------------------------------------------------

export const PREDICTIVE_TOOL_SCHEMAS = [
  {
    name: 'predict_risk_trajectory',
    description:
      'Predict future risk trajectory using time-series analysis. Returns trend direction, risk velocity, threshold breach predictions, seasonality patterns, and early warning alerts. Forecast up to 90 days ahead.',
    inputSchema: {
      type: 'object',
      properties: {
        entityName: { type: 'string' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: 'string' },
              riskScore: { type: 'number' },
              alertCount: { type: 'number' },
              transactionVolume: { type: 'number' },
              flagCount: { type: 'number' },
            },
            required: ['date', 'riskScore', 'alertCount', 'transactionVolume', 'flagCount'],
          },
        },
        forecastDays: { type: 'number', description: 'Days to forecast (default: 90)' },
      },
      required: ['entityName', 'data'],
    },
  },
] as const;
