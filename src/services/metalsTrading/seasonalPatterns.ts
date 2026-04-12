// ─── Seasonal Pattern Engine ────────────────────────────────────────────────
// Gold and silver have well-documented seasonal patterns driven by:
// - Indian wedding/festival season (Oct-Dec) → gold demand surge
// - Chinese New Year (Jan-Feb) → gold gifting demand
// - Ramadan → gold/jewelry buying in GCC
// - Summer doldrums (Jun-Aug) → low volume, weak prices
// - Year-end rebalancing (Dec) → portfolio flows
// - January effect → new allocation flows
//
// This engine quantifies these patterns and generates seasonal signals.

import type { Metal, TradeSide } from './types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SeasonalPattern {
  name: string;
  metal: Metal;
  startMonth: number;    // 1-12
  endMonth: number;
  direction: TradeSide;
  avgReturnPct: number;  // historical average return during period
  winRate: number;        // % of years this pattern held
  strength: number;       // 0-1 composite score
  catalyst: string;
  currentlyActive: boolean;
  daysUntilStart: number;
  daysUntilEnd: number;
}

export interface SeasonalScore {
  metal: Metal;
  month: number;
  score: number;          // -100 to +100
  direction: TradeSide | 'NEUTRAL';
  activePatterns: string[];
  reasoning: string;
}

// ─── Historical Seasonal Data (30-year averages) ────────────────────────────

interface MonthlyStats {
  avgReturn: number;   // % average return for the month
  winRate: number;     // % of years positive
  avgVolume: number;   // relative volume (1.0 = average)
}

const GOLD_MONTHLY: Record<number, MonthlyStats> = {
  1:  { avgReturn: +1.8,  winRate: 0.65, avgVolume: 1.15 },  // January: new year flows
  2:  { avgReturn: -0.3,  winRate: 0.45, avgVolume: 0.95 },  // Feb: post-CNY pullback
  3:  { avgReturn: -0.5,  winRate: 0.42, avgVolume: 0.90 },  // March: quiet
  4:  { avgReturn: +0.8,  winRate: 0.55, avgVolume: 0.95 },  // April: Akshaya Tritiya
  5:  { avgReturn: -0.2,  winRate: 0.48, avgVolume: 0.85 },  // May: sell in May
  6:  { avgReturn: -0.8,  winRate: 0.40, avgVolume: 0.75 },  // June: summer lull
  7:  { avgReturn: +0.5,  winRate: 0.52, avgVolume: 0.80 },  // July: early recovery
  8:  { avgReturn: +1.5,  winRate: 0.62, avgVolume: 1.05 },  // Aug: pre-India season
  9:  { avgReturn: +2.2,  winRate: 0.68, avgVolume: 1.20 },  // Sep: India buying begins
  10: { avgReturn: +1.0,  winRate: 0.58, avgVolume: 1.25 },  // Oct: Diwali, Dhanteras
  11: { avgReturn: +1.2,  winRate: 0.60, avgVolume: 1.30 },  // Nov: wedding season peak
  12: { avgReturn: -0.1,  winRate: 0.47, avgVolume: 1.10 },  // Dec: year-end rebalancing
};

const SILVER_MONTHLY: Record<number, MonthlyStats> = {
  1:  { avgReturn: +2.5,  winRate: 0.62, avgVolume: 1.10 },
  2:  { avgReturn: +1.2,  winRate: 0.55, avgVolume: 1.05 },
  3:  { avgReturn: -0.8,  winRate: 0.42, avgVolume: 0.90 },
  4:  { avgReturn: +1.5,  winRate: 0.58, avgVolume: 1.00 },
  5:  { avgReturn: -1.0,  winRate: 0.38, avgVolume: 0.85 },
  6:  { avgReturn: -1.5,  winRate: 0.35, avgVolume: 0.75 },
  7:  { avgReturn: +0.8,  winRate: 0.52, avgVolume: 0.80 },
  8:  { avgReturn: +2.0,  winRate: 0.63, avgVolume: 1.10 },
  9:  { avgReturn: +2.8,  winRate: 0.70, avgVolume: 1.25 },
  10: { avgReturn: +0.5,  winRate: 0.50, avgVolume: 1.15 },
  11: { avgReturn: +1.8,  winRate: 0.60, avgVolume: 1.20 },
  12: { avgReturn: -0.5,  winRate: 0.45, avgVolume: 1.05 },
};

// ─── Named Seasonal Windows ────────────────────────────────────────────────

const SEASONAL_WINDOWS: Omit<SeasonalPattern, 'currentlyActive' | 'daysUntilStart' | 'daysUntilEnd'>[] = [
  {
    name: 'Indian Wedding Season',
    metal: 'XAU',
    startMonth: 9,
    endMonth: 12,
    direction: 'BUY',
    avgReturnPct: 4.5,
    winRate: 0.65,
    strength: 0.75,
    catalyst: 'Diwali, Dhanteras, wedding season drive physical gold demand in India (world #2 consumer)',
  },
  {
    name: 'Chinese New Year',
    metal: 'XAU',
    startMonth: 1,
    endMonth: 2,
    direction: 'BUY',
    avgReturnPct: 2.0,
    winRate: 0.60,
    strength: 0.55,
    catalyst: 'Gold gifting tradition for Lunar New Year in China (world #1 consumer)',
  },
  {
    name: 'Ramadan Gold Buying',
    metal: 'XAU',
    startMonth: 3,
    endMonth: 4,
    direction: 'BUY',
    avgReturnPct: 1.2,
    winRate: 0.55,
    strength: 0.45,
    catalyst: 'GCC gold/jewelry purchases during Ramadan and Eid — DMCC/Dubai volumes spike',
  },
  {
    name: 'Summer Doldrums',
    metal: 'XAU',
    startMonth: 5,
    endMonth: 7,
    direction: 'SELL',
    avgReturnPct: -1.5,
    winRate: 0.58,
    strength: 0.50,
    catalyst: 'Low volume, reduced physical demand, "sell in May" effect across commodities',
  },
  {
    name: 'Silver September Rally',
    metal: 'XAG',
    startMonth: 8,
    endMonth: 10,
    direction: 'BUY',
    avgReturnPct: 5.5,
    winRate: 0.68,
    strength: 0.80,
    catalyst: 'Industrial restocking + India demand + G/S ratio compression',
  },
  {
    name: 'January Allocation Effect',
    metal: 'XAG',
    startMonth: 1,
    endMonth: 2,
    direction: 'BUY',
    avgReturnPct: 3.5,
    winRate: 0.62,
    strength: 0.60,
    catalyst: 'New year portfolio allocations, fresh mandates, commodity fund inflows',
  },
  {
    name: 'Akshaya Tritiya',
    metal: 'XAU',
    startMonth: 4,
    endMonth: 5,
    direction: 'BUY',
    avgReturnPct: 1.0,
    winRate: 0.55,
    strength: 0.40,
    catalyst: 'Hindu auspicious day for gold buying — concentrated demand event',
  },
  {
    name: 'Pre-Indian Season Buildup',
    metal: 'XAU',
    startMonth: 8,
    endMonth: 9,
    direction: 'BUY',
    avgReturnPct: 3.5,
    winRate: 0.65,
    strength: 0.70,
    catalyst: 'Dealers and refiners build inventory ahead of Q4 India demand',
  },
];

// ─── Analysis Functions ─────────────────────────────────────────────────────

function daysBetweenMonths(currentMonth: number, targetMonth: number): number {
  if (targetMonth >= currentMonth) return (targetMonth - currentMonth) * 30;
  return (12 - currentMonth + targetMonth) * 30;
}

export function getActivePatterns(date: Date = new Date()): SeasonalPattern[] {
  const month = date.getMonth() + 1;

  return SEASONAL_WINDOWS.map(w => {
    const isActive = w.startMonth <= w.endMonth
      ? month >= w.startMonth && month <= w.endMonth
      : month >= w.startMonth || month <= w.endMonth; // wraps around year

    return {
      ...w,
      currentlyActive: isActive,
      daysUntilStart: isActive ? 0 : daysBetweenMonths(month, w.startMonth),
      daysUntilEnd: isActive ? daysBetweenMonths(month, w.endMonth) : -1,
    };
  });
}

export function getSeasonalScore(metal: Metal, date: Date = new Date()): SeasonalScore {
  const month = date.getMonth() + 1;
  const monthly = metal === 'XAU' ? GOLD_MONTHLY : metal === 'XAG' ? SILVER_MONTHLY : GOLD_MONTHLY;
  const stats = monthly[month] ?? { avgReturn: 0, winRate: 0.5, avgVolume: 1.0 };

  const patterns = getActivePatterns(date).filter(p => p.currentlyActive && p.metal === metal);
  const activeNames = patterns.map(p => p.name);

  // Score: combine monthly stats + active pattern strength
  let score = stats.avgReturn * 10; // scale monthly return to -100..+100 range
  for (const p of patterns) {
    score += p.direction === 'BUY' ? p.strength * 25 : -p.strength * 25;
  }
  score = Math.max(-100, Math.min(100, score));

  const direction: TradeSide | 'NEUTRAL' = score > 15 ? 'BUY' : score < -15 ? 'SELL' : 'NEUTRAL';

  const reasoning = [
    `Month ${month}: avg return ${stats.avgReturn > 0 ? '+' : ''}${stats.avgReturn.toFixed(1)}%, win rate ${(stats.winRate * 100).toFixed(0)}%`,
    `Volume: ${stats.avgVolume > 1 ? 'above' : 'below'} average (${stats.avgVolume.toFixed(2)}x)`,
    ...activeNames.map(n => `Active: ${n}`),
  ].join('. ');

  return { metal, month, score, direction, activePatterns: activeNames, reasoning };
}

export function getSeasonalCalendar(metal: Metal): Record<number, { score: number; direction: string; patterns: string[] }> {
  const calendar: Record<number, { score: number; direction: string; patterns: string[] }> = {};
  for (let m = 1; m <= 12; m++) {
    const date = new Date(2026, m - 1, 15);
    const s = getSeasonalScore(metal, date);
    calendar[m] = { score: s.score, direction: s.direction, patterns: s.activePatterns };
  }
  return calendar;
}

export function getUpcomingPatterns(daysAhead: number = 60): SeasonalPattern[] {
  const patterns = getActivePatterns();
  return patterns.filter(p => !p.currentlyActive && p.daysUntilStart <= daysAhead)
    .sort((a, b) => a.daysUntilStart - b.daysUntilStart);
}
