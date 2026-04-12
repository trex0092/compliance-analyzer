// ─── Execution Analytics (TCA — Transaction Cost Analysis) ──────────────────
// Measures execution quality: slippage, market impact, timing cost,
// venue performance, and implementation shortfall.
// The difference between a profitable and unprofitable strategy is often
// just execution quality.

import type { Metal, Venue, TradeSide, Order, Execution } from './types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TCAResult {
  orderId: string;
  metal: Metal;
  side: TradeSide;
  venue: Venue;
  decisionPrice: number; // price when we decided to trade
  arrivalPrice: number; // mid-price when order hit the market
  executionPrice: number; // actual fill price
  benchmarkVWAP: number; // VWAP during execution window
  implementationShortfall: number; // total cost vs decision price
  slippageCost: number; // fill vs arrival
  marketImpact: number; // price moved due to our order
  timingCost: number; // cost of delay (decision to arrival)
  spreadCost: number; // half-spread paid
  feeCost: number;
  totalCostBps: number; // total all-in cost in bps
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface VenueAnalytics {
  venue: Venue;
  totalOrders: number;
  avgSlippageBps: number;
  avgImpactBps: number;
  avgTotalCostBps: number;
  fillRate: number; // % of orders fully filled
  avgFillTimeMs: number;
  bestExecution: boolean; // is this the best venue?
}

export interface ExecutionSummary {
  period: string;
  totalOrders: number;
  totalCostUSD: number;
  avgCostBps: number;
  gradeDistribution: Record<string, number>;
  byVenue: VenueAnalytics[];
  byMetal: Record<Metal, { orders: number; avgCostBps: number }>;
  worstExecution: TCAResult | null;
  bestExecution: TCAResult | null;
  recommendations: string[];
}

// ─── TCA Calculation ────────────────────────────────────────────────────────

export function analyzeTrade(
  order: Order,
  execution: Execution,
  decisionPrice: number,
  arrivalPrice: number,
  vwap: number
): TCAResult {
  const fillPrice = execution.price;
  const qty = execution.quantity;
  const mid = arrivalPrice;

  // Implementation shortfall: total cost from decision to fill
  const isShortfall = order.side === 'BUY' ? fillPrice - decisionPrice : decisionPrice - fillPrice;

  // Timing cost: delay from decision to arrival
  const timingCost =
    order.side === 'BUY' ? arrivalPrice - decisionPrice : decisionPrice - arrivalPrice;

  // Slippage: arrival to fill
  const slippage = order.side === 'BUY' ? fillPrice - arrivalPrice : arrivalPrice - fillPrice;

  // Market impact estimate (simplified)
  const marketImpact = slippage * 0.6; // ~60% of slippage is market impact

  // Spread cost
  const spreadCost = mid > 0 ? mid * 0.0002 : 0; // estimated half-spread

  const totalCost = Math.abs(isShortfall) + execution.fees / qty;
  const totalCostBps = mid > 0 ? (totalCost / mid) * 10_000 : 0;

  // Grade
  let grade: TCAResult['grade'];
  if (totalCostBps < 2) grade = 'A';
  else if (totalCostBps < 5) grade = 'B';
  else if (totalCostBps < 10) grade = 'C';
  else if (totalCostBps < 20) grade = 'D';
  else grade = 'F';

  return {
    orderId: order.id,
    metal: order.metal,
    side: order.side,
    venue: execution.venue,
    decisionPrice,
    arrivalPrice,
    executionPrice: fillPrice,
    benchmarkVWAP: vwap,
    implementationShortfall: isShortfall,
    slippageCost: slippage,
    marketImpact,
    timingCost,
    spreadCost,
    feeCost: execution.fees / qty,
    totalCostBps,
    grade,
  };
}

// ─── Venue Performance Analysis ─────────────────────────────────────────────

export function analyzeVenuePerformance(results: TCAResult[]): VenueAnalytics[] {
  const byVenue = new Map<Venue, TCAResult[]>();

  for (const r of results) {
    const arr = byVenue.get(r.venue) ?? [];
    arr.push(r);
    byVenue.set(r.venue, arr);
  }

  const analytics: VenueAnalytics[] = [];
  let bestAvgCost = Infinity;
  let bestVenue: Venue | null = null;

  for (const [venue, trades] of byVenue) {
    const avgSlippage = trades.reduce((s, t) => s + Math.abs(t.slippageCost), 0) / trades.length;
    const avgImpact = trades.reduce((s, t) => s + Math.abs(t.marketImpact), 0) / trades.length;
    const avgCost = trades.reduce((s, t) => s + t.totalCostBps, 0) / trades.length;
    const avgMid = trades.reduce((s, t) => s + t.arrivalPrice, 0) / trades.length;

    if (avgCost < bestAvgCost) {
      bestAvgCost = avgCost;
      bestVenue = venue;
    }

    analytics.push({
      venue,
      totalOrders: trades.length,
      avgSlippageBps: avgMid > 0 ? (avgSlippage / avgMid) * 10_000 : 0,
      avgImpactBps: avgMid > 0 ? (avgImpact / avgMid) * 10_000 : 0,
      avgTotalCostBps: avgCost,
      fillRate: 1.0, // simplified
      avgFillTimeMs: 0,
      bestExecution: false,
    });
  }

  // Mark best venue
  for (const a of analytics) {
    if (a.venue === bestVenue) a.bestExecution = true;
  }

  return analytics;
}

// ─── Execution Summary ──────────────────────────────────────────────────────

export function generateExecutionSummary(
  results: TCAResult[],
  period: string = 'session'
): ExecutionSummary {
  if (results.length === 0) {
    return {
      period,
      totalOrders: 0,
      totalCostUSD: 0,
      avgCostBps: 0,
      gradeDistribution: {},
      byVenue: [],
      byMetal: {
        XAU: { orders: 0, avgCostBps: 0 },
        XAG: { orders: 0, avgCostBps: 0 },
        XPT: { orders: 0, avgCostBps: 0 },
        XPD: { orders: 0, avgCostBps: 0 },
      },
      worstExecution: null,
      bestExecution: null,
      recommendations: ['No executions to analyze'],
    };
  }

  const sorted = [...results].sort((a, b) => a.totalCostBps - b.totalCostBps);
  const grades: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const r of results) grades[r.grade]++;

  const totalCost = results.reduce(
    (s, r) => s + Math.abs(r.implementationShortfall) * r.executionPrice,
    0
  );
  const avgCost = results.reduce((s, r) => s + r.totalCostBps, 0) / results.length;

  // By metal
  const byMetal: Record<Metal, { orders: number; avgCostBps: number }> = {
    XAU: { orders: 0, avgCostBps: 0 },
    XAG: { orders: 0, avgCostBps: 0 },
    XPT: { orders: 0, avgCostBps: 0 },
    XPD: { orders: 0, avgCostBps: 0 },
  };
  for (const r of results) {
    byMetal[r.metal].orders++;
    byMetal[r.metal].avgCostBps += r.totalCostBps;
  }
  for (const m of Object.values(byMetal)) {
    if (m.orders > 0) m.avgCostBps /= m.orders;
  }

  // Recommendations
  const recommendations: string[] = [];
  if (avgCost > 10)
    recommendations.push('Avg execution cost > 10bps — consider using TWAP/VWAP for large orders');
  if (grades.D + grades.F > results.length * 0.2)
    recommendations.push('20%+ poor executions — review order timing and venue selection');

  const venueAnalytics = analyzeVenuePerformance(results);
  const bestVenue = venueAnalytics.find((v) => v.bestExecution);
  if (bestVenue)
    recommendations.push(
      `Best venue: ${bestVenue.venue} (avg ${bestVenue.avgTotalCostBps.toFixed(1)} bps)`
    );

  return {
    period,
    totalOrders: results.length,
    totalCostUSD: totalCost,
    avgCostBps: avgCost,
    gradeDistribution: grades,
    byVenue: venueAnalytics,
    byMetal,
    worstExecution: sorted[sorted.length - 1],
    bestExecution: sorted[0],
    recommendations,
  };
}
