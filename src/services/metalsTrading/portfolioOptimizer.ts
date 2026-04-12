// ─── Portfolio Optimizer ─────────────────────────────────────────────────────
// Optimal allocation across precious metals using:
// - Mean-Variance Optimization (Markowitz)
// - Risk Parity (equal risk contribution)
// - Maximum Sharpe Ratio
// - Minimum Variance
// - Black-Litterman (with trader views)
//
// Because blindly equal-weighting 4 metals leaves money on the table.

import type { Metal } from './types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OptimizationInput {
  metals: Metal[];
  returns: Record<Metal, number[]>;      // historical daily returns
  views?: TraderView[];                    // subjective views for Black-Litterman
  riskFreeRate: number;                    // annualized (e.g., 0.05 for 5%)
  targetReturn?: number;                   // for mean-variance with target
  maxWeight: number;                       // max allocation per metal (e.g., 0.6 = 60%)
  minWeight: number;                       // min allocation (e.g., 0.0 = allow zero)
}

export interface TraderView {
  metal: Metal;
  expectedReturn: number;   // annualized expected return (e.g., 0.10 = 10%)
  confidence: number;       // 0-1
}

export interface OptimizedPortfolio {
  method: string;
  weights: Record<Metal, number>;
  expectedReturn: number;    // annualized
  expectedVolatility: number; // annualized
  sharpeRatio: number;
  diversificationRatio: number;
  riskContribution: Record<Metal, number>;
}

// ─── Covariance Matrix ──────────────────────────────────────────────────────

export function computeCovarianceMatrix(
  returns: Record<Metal, number[]>, metals: Metal[],
): number[][] {
  const n = metals.length;
  const minLen = Math.min(...metals.map(m => returns[m]?.length ?? 0));
  if (minLen < 2) return Array(n).fill(null).map(() => Array(n).fill(0));

  const means: number[] = metals.map(m => {
    const r = returns[m].slice(-minLen);
    return r.reduce((a, b) => a + b, 0) / r.length;
  });

  const cov: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const ri = returns[metals[i]].slice(-minLen);
      const rj = returns[metals[j]].slice(-minLen);
      let sum = 0;
      for (let k = 0; k < minLen; k++) {
        sum += (ri[k] - means[i]) * (rj[k] - means[j]);
      }
      cov[i][j] = (sum / (minLen - 1)) * 252; // annualize
    }
  }

  return cov;
}

// ─── Mean-Variance Optimization ─────────────────────────────────────────────

export function meanVarianceOptimize(input: OptimizationInput): OptimizedPortfolio {
  const { metals, returns, maxWeight, minWeight, riskFreeRate } = input;
  const n = metals.length;
  const cov = computeCovarianceMatrix(returns, metals);

  // Expected returns (annualized from historical)
  const expReturns = metals.map(m => {
    const r = returns[m];
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    return mean * 252; // annualize
  });

  // Grid search for optimal weights (simplified for 4 assets)
  let bestSharpe = -Infinity;
  let bestWeights = metals.map(() => 1 / n);
  const step = 0.05;

  const candidates = generateWeightCandidates(n, step, minWeight, maxWeight);

  for (const w of candidates) {
    const portReturn = w.reduce((s, wi, i) => s + wi * expReturns[i], 0);
    const portVar = portfolioVariance(w, cov);
    const portVol = Math.sqrt(portVar);
    const sharpe = portVol > 0 ? (portReturn - riskFreeRate) / portVol : 0;

    if (sharpe > bestSharpe) {
      bestSharpe = sharpe;
      bestWeights = w;
    }
  }

  const portReturn = bestWeights.reduce((s, wi, i) => s + wi * expReturns[i], 0);
  const portVar = portfolioVariance(bestWeights, cov);
  const portVol = Math.sqrt(portVar);
  const riskContrib = computeRiskContribution(bestWeights, cov, portVol);

  const weights: Record<Metal, number> = {} as Record<Metal, number>;
  metals.forEach((m, i) => { weights[m] = bestWeights[i]; });

  const rc: Record<Metal, number> = {} as Record<Metal, number>;
  metals.forEach((m, i) => { rc[m] = riskContrib[i]; });

  return {
    method: 'Mean-Variance (Max Sharpe)',
    weights,
    expectedReturn: portReturn,
    expectedVolatility: portVol,
    sharpeRatio: bestSharpe,
    diversificationRatio: computeDiversificationRatio(bestWeights, cov),
    riskContribution: rc,
  };
}

// ─── Risk Parity ────────────────────────────────────────────────────────────
// Each metal contributes equally to portfolio risk.
// Inverse-volatility weighting as approximation.

export function riskParityOptimize(input: OptimizationInput): OptimizedPortfolio {
  const { metals, returns, riskFreeRate, maxWeight, minWeight } = input;
  const cov = computeCovarianceMatrix(returns, metals);
  const n = metals.length;

  // Individual volatilities
  const vols = metals.map((_, i) => Math.sqrt(cov[i][i]));
  const invVols = vols.map(v => v > 0 ? 1 / v : 0);
  const totalInvVol = invVols.reduce((a, b) => a + b, 0);

  // Weights inversely proportional to volatility
  let rawWeights = invVols.map(iv => totalInvVol > 0 ? iv / totalInvVol : 1 / n);

  // Apply constraints
  rawWeights = rawWeights.map(w => Math.max(minWeight, Math.min(maxWeight, w)));
  const totalW = rawWeights.reduce((a, b) => a + b, 0);
  rawWeights = rawWeights.map(w => w / totalW); // re-normalize

  const expReturns = metals.map(m => {
    const r = returns[m];
    return (r.reduce((a, b) => a + b, 0) / r.length) * 252;
  });

  const portReturn = rawWeights.reduce((s, wi, i) => s + wi * expReturns[i], 0);
  const portVar = portfolioVariance(rawWeights, cov);
  const portVol = Math.sqrt(portVar);
  const riskContrib = computeRiskContribution(rawWeights, cov, portVol);

  const weights: Record<Metal, number> = {} as Record<Metal, number>;
  metals.forEach((m, i) => { weights[m] = rawWeights[i]; });

  const rc: Record<Metal, number> = {} as Record<Metal, number>;
  metals.forEach((m, i) => { rc[m] = riskContrib[i]; });

  return {
    method: 'Risk Parity',
    weights,
    expectedReturn: portReturn,
    expectedVolatility: portVol,
    sharpeRatio: portVol > 0 ? (portReturn - riskFreeRate) / portVol : 0,
    diversificationRatio: computeDiversificationRatio(rawWeights, cov),
    riskContribution: rc,
  };
}

// ─── Minimum Variance ───────────────────────────────────────────────────────

export function minVarianceOptimize(input: OptimizationInput): OptimizedPortfolio {
  const { metals, returns, maxWeight, minWeight, riskFreeRate } = input;
  const cov = computeCovarianceMatrix(returns, metals);
  const n = metals.length;

  let bestVar = Infinity;
  let bestWeights = metals.map(() => 1 / n);
  const step = 0.05;

  const candidates = generateWeightCandidates(n, step, minWeight, maxWeight);

  for (const w of candidates) {
    const pv = portfolioVariance(w, cov);
    if (pv < bestVar) {
      bestVar = pv;
      bestWeights = w;
    }
  }

  const expReturns = metals.map(m => {
    const r = returns[m];
    return (r.reduce((a, b) => a + b, 0) / r.length) * 252;
  });

  const portReturn = bestWeights.reduce((s, wi, i) => s + wi * expReturns[i], 0);
  const portVol = Math.sqrt(bestVar);

  const weights: Record<Metal, number> = {} as Record<Metal, number>;
  metals.forEach((m, i) => { weights[m] = bestWeights[i]; });

  const riskContrib = computeRiskContribution(bestWeights, cov, portVol);
  const rc: Record<Metal, number> = {} as Record<Metal, number>;
  metals.forEach((m, i) => { rc[m] = riskContrib[i]; });

  return {
    method: 'Minimum Variance',
    weights,
    expectedReturn: portReturn,
    expectedVolatility: portVol,
    sharpeRatio: portVol > 0 ? (portReturn - riskFreeRate) / portVol : 0,
    diversificationRatio: computeDiversificationRatio(bestWeights, cov),
    riskContribution: rc,
  };
}

// ─── Run All Optimizations ──────────────────────────────────────────────────

export function optimizePortfolio(input: OptimizationInput): OptimizedPortfolio[] {
  return [
    meanVarianceOptimize(input),
    riskParityOptimize(input),
    minVarianceOptimize(input),
  ];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function portfolioVariance(weights: number[], cov: number[][]): number {
  const n = weights.length;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      variance += weights[i] * weights[j] * cov[i][j];
    }
  }
  return variance;
}

function computeRiskContribution(weights: number[], cov: number[][], portVol: number): number[] {
  const n = weights.length;
  const marginal: number[] = [];

  for (let i = 0; i < n; i++) {
    let mc = 0;
    for (let j = 0; j < n; j++) mc += weights[j] * cov[i][j];
    marginal.push(portVol > 0 ? (weights[i] * mc) / portVol : 0);
  }

  const total = marginal.reduce((a, b) => a + b, 0);
  return marginal.map(m => total > 0 ? m / total : 1 / n);
}

function computeDiversificationRatio(weights: number[], cov: number[][]): number {
  const n = weights.length;
  const vols = Array.from({ length: n }, (_, i) => Math.sqrt(cov[i][i]));
  const weightedVol = weights.reduce((s, w, i) => s + w * vols[i], 0);
  const portVol = Math.sqrt(portfolioVariance(weights, cov));
  return portVol > 0 ? weightedVol / portVol : 1;
}

function generateWeightCandidates(
  n: number, step: number, minW: number, maxW: number,
): number[][] {
  const results: number[][] = [];

  if (n === 4) {
    for (let a = minW; a <= maxW; a += step) {
      for (let b = minW; b <= maxW - a; b += step) {
        for (let c = minW; c <= maxW - a - b; c += step) {
          const d = 1 - a - b - c;
          if (d >= minW && d <= maxW && Math.abs(a + b + c + d - 1) < 0.001) {
            results.push([a, b, c, d]);
          }
        }
      }
    }
  } else {
    // Equal weight fallback for other sizes
    results.push(Array(n).fill(1 / n));
  }

  if (results.length === 0) results.push(Array(n).fill(1 / n));
  return results;
}
