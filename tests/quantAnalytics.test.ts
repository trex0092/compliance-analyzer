/**
 * Tests for Quantitative Analytics Tools
 *
 * Validates statistical anomaly detection algorithms:
 * - Bollinger Bands
 * - Structuring detection
 * - Z-Score analysis
 * - Monte Carlo simulation
 * - Velocity burst detection
 */

import { describe, it, expect } from 'vitest';
import {
  calculateBollingerBands,
  detectStructuring,
  calculateZScore,
  runMonteCarloSimulation,
  detectVelocityBurst,
  runQuantAnalytics,
  type TransactionDataPoint,
} from '../src/agents/tools/quant-analytics-tools';
import { DPMS_CASH_THRESHOLD_AED } from '../src/domain/constants';

// ---------------------------------------------------------------------------
// Bollinger Bands
// ---------------------------------------------------------------------------

describe('calculateBollingerBands', () => {
  it('detects anomaly when value exceeds upper band', () => {
    // 20 normal values around 10,000, then a spike
    const amounts = Array.from({ length: 20 }, () => 10_000 + Math.random() * 500);
    amounts.push(50_000); // clear outlier

    const result = calculateBollingerBands(amounts);
    expect(result.isAnomaly).toBe(true);
    expect(result.currentValue).toBe(50_000);
    expect(result.percentB).toBeGreaterThan(1);
  });

  it('returns non-anomaly for values within bands', () => {
    const amounts = Array.from({ length: 25 }, (_, i) => 10_000 + (i % 5) * 100);
    const result = calculateBollingerBands(amounts);
    expect(result.isAnomaly).toBe(false);
    expect(result.middleBand).toBeGreaterThan(0);
    expect(result.upperBand).toBeGreaterThan(result.middleBand);
    expect(result.lowerBand).toBeLessThan(result.middleBand);
  });

  it('handles small datasets gracefully', () => {
    const result = calculateBollingerBands([1000, 2000, 3000]);
    expect(result.middleBand).toBe(2000);
    expect(result.isAnomaly).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Structuring Detection
// ---------------------------------------------------------------------------

describe('detectStructuring', () => {
  it('detects classic structuring below AED 55K threshold', () => {
    const now = new Date();
    const transactions: TransactionDataPoint[] = [
      { amount: 18_000, timestamp: new Date(now.getTime()).toISOString(), currency: 'AED' },
      { amount: 18_000, timestamp: new Date(now.getTime() + 3600_000).toISOString(), currency: 'AED' },
      { amount: 18_000, timestamp: new Date(now.getTime() + 7200_000).toISOString(), currency: 'AED' },
    ];

    const result = detectStructuring(transactions);
    expect(result.detected).toBe(true);
    expect(result.cumulativeAmount).toBe(54_000);
    expect(result.regulatoryRef).toContain('FDL');
  });

  it('does not flag normal transactions', () => {
    const now = new Date();
    const transactions: TransactionDataPoint[] = [
      { amount: 5_000, timestamp: new Date(now.getTime()).toISOString(), currency: 'AED' },
      { amount: 3_000, timestamp: new Date(now.getTime() + 86400_000 * 7).toISOString(), currency: 'AED' },
    ];

    const result = detectStructuring(transactions);
    expect(result.detected).toBe(false);
  });

  it('handles empty transactions', () => {
    const result = detectStructuring([]);
    expect(result.detected).toBe(false);
    expect(result.cumulativeAmount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Z-Score Analysis
// ---------------------------------------------------------------------------

describe('calculateZScore', () => {
  it('flags extreme outliers', () => {
    const history = [100, 105, 98, 102, 99, 101, 103, 97, 104, 100];
    const result = calculateZScore(500, history);
    expect(result.isOutlier).toBe(true);
    expect(result.outlierSeverity).not.toBe('none');
    expect(result.zScore).toBeGreaterThan(3);
  });

  it('does not flag normal values', () => {
    const history = [100, 105, 98, 102, 99, 101, 103, 97, 104, 100];
    const result = calculateZScore(101, history);
    expect(result.isOutlier).toBe(false);
    expect(result.outlierSeverity).toBe('none');
  });

  it('handles empty history', () => {
    const result = calculateZScore(100, []);
    expect(result.zScore).toBe(0);
    expect(result.isOutlier).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Monte Carlo
// ---------------------------------------------------------------------------

describe('runMonteCarloSimulation', () => {
  it('produces valid distribution statistics', () => {
    const history = Array.from({ length: 100 }, () => 10_000 + Math.random() * 5_000);
    const result = runMonteCarloSimulation(history, DPMS_CASH_THRESHOLD_AED, 1_000);

    expect(result.simulations).toBe(1_000);
    expect(result.expectedValue).toBeGreaterThan(0);
    expect(result.percentile95).toBeGreaterThan(result.expectedValue);
    expect(result.percentile99).toBeGreaterThan(result.percentile95);
    expect(result.confidenceInterval[0]).toBeLessThan(result.confidenceInterval[1]);
  });

  it('flags anomalous probability above threshold', () => {
    // Values consistently close to threshold
    const history = Array.from({ length: 50 }, () => 50_000 + Math.random() * 10_000);
    const result = runMonteCarloSimulation(history, DPMS_CASH_THRESHOLD_AED, 1_000);

    expect(result.probabilityAboveThreshold).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const result = runMonteCarloSimulation([]);
    expect(result.expectedValue).toBe(0);
    expect(result.simulations).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// Velocity Burst
// ---------------------------------------------------------------------------

describe('detectVelocityBurst', () => {
  it('detects rapid transaction bursts', () => {
    const now = new Date();
    const transactions: TransactionDataPoint[] = Array.from({ length: 10 }, (_, i) => ({
      amount: 5_000,
      timestamp: new Date(now.getTime() + i * 60_000).toISOString(), // 1 per minute
      currency: 'AED',
    }));

    const result = detectVelocityBurst(transactions, 60, 5);
    expect(result.detected).toBe(true);
    expect(result.transactionsInWindow).toBeGreaterThanOrEqual(5);
    expect(result.burstScore).toBe(1);
  });

  it('does not flag normal transaction frequency', () => {
    const now = new Date();
    const transactions: TransactionDataPoint[] = [
      { amount: 5_000, timestamp: new Date(now.getTime()).toISOString(), currency: 'AED' },
      { amount: 5_000, timestamp: new Date(now.getTime() + 86400_000).toISOString(), currency: 'AED' },
    ];

    const result = detectVelocityBurst(transactions, 60, 5);
    expect(result.detected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Full Analytics Report
// ---------------------------------------------------------------------------

describe('runQuantAnalytics', () => {
  it('produces complete analysis report', () => {
    const now = new Date();
    const transactions: TransactionDataPoint[] = Array.from({ length: 25 }, (_, i) => ({
      amount: 10_000 + Math.random() * 2_000,
      timestamp: new Date(now.getTime() + i * 3600_000).toISOString(),
      currency: 'AED',
    }));

    const result = runQuantAnalytics('Test Entity', transactions);
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.entityName).toBe('Test Entity');
    expect(result.data!.transactionCount).toBe(25);
    expect(result.data!.bollingerBands).toBeDefined();
    expect(result.data!.structuring).toBeDefined();
    expect(result.data!.zScore).toBeDefined();
    expect(result.data!.monteCarlo).toBeDefined();
    expect(result.data!.velocityBurst).toBeDefined();
    expect(result.data!.overallRiskLevel).toBeDefined();
  });

  it('rejects empty transactions', () => {
    const result = runQuantAnalytics('Empty', []);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No transactions');
  });
});
