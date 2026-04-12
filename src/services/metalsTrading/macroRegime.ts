// ─── Macro Regime Analyzer ──────────────────────────────────────────────────
// Precious metals don't trade in a vacuum. Gold is driven by:
// - US Dollar strength (DXY) — inverse correlation
// - Real interest rates (TIPS yields) — inverse correlation
// - Yield curve shape — inversion = gold bullish
// - VIX (fear) — positive correlation
// - Central bank buying — structural demand
// - Inflation expectations — positive correlation
// This module models these macro relationships and generates signals.

import type { Metal, TradeSide } from './types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MacroSnapshot {
  dxy: number; // US Dollar Index (typically 90-110)
  realRate10y: number; // 10Y TIPS yield (typically -1% to +3%)
  nominalRate10y: number; // 10Y Treasury yield
  rate2y: number; // 2Y Treasury yield
  yieldCurveSpread: number; // 10Y - 2Y (negative = inverted)
  vix: number; // VIX fear index (typically 12-80)
  breakeven5y: number; // 5Y inflation expectations
  fedFundsRate: number; // Fed target rate
  cbuaeRate: number; // CBUAE repo rate
  cbGoldPurchases: number; // tons/month (central bank buying)
  timestamp: number;
}

export interface MacroRegime {
  name: string;
  description: string;
  goldBias: TradeSide | 'NEUTRAL';
  silverBias: TradeSide | 'NEUTRAL';
  confidence: number;
  drivers: MacroDriver[];
  historicalAnalog: string;
}

export interface MacroDriver {
  factor: string;
  value: number;
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  weight: number;
  reasoning: string;
}

export interface MacroCorrelation {
  factor: string;
  metal: Metal;
  correlation30d: number;
  correlation90d: number;
  isNormal: boolean;
  breakdown: boolean; // correlation has broken from historical norm
}

// ─── Correlation Engine ─────────────────────────────────────────────────────

export function computeCorrelation(seriesA: number[], seriesB: number[]): number {
  const n = Math.min(seriesA.length, seriesB.length);
  if (n < 5) return 0;
  const a = seriesA.slice(-n);
  const b = seriesB.slice(-n);
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let num = 0,
    denA = 0,
    denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den > 0 ? num / den : 0;
}

// ─── Macro Factor Analysis ──────────────────────────────────────────────────

export function analyzeMacroDrivers(snapshot: MacroSnapshot): MacroDriver[] {
  const drivers: MacroDriver[] = [];

  // 1. US Dollar (DXY) — Gold's #1 inverse driver
  const dxySignal: MacroDriver = {
    factor: 'US Dollar (DXY)',
    value: snapshot.dxy,
    signal: snapshot.dxy > 105 ? 'BEARISH' : snapshot.dxy < 100 ? 'BULLISH' : 'NEUTRAL',
    weight: 0.25,
    reasoning:
      snapshot.dxy > 105
        ? `Strong dollar (${snapshot.dxy.toFixed(1)}) pressures gold`
        : snapshot.dxy < 100
          ? `Weak dollar (${snapshot.dxy.toFixed(1)}) supports gold`
          : `Dollar neutral (${snapshot.dxy.toFixed(1)})`,
  };
  drivers.push(dxySignal);

  // 2. Real Rates — Gold's #2 inverse driver
  drivers.push({
    factor: 'Real Rates (10Y TIPS)',
    value: snapshot.realRate10y,
    signal:
      snapshot.realRate10y > 2.0 ? 'BEARISH' : snapshot.realRate10y < 0.5 ? 'BULLISH' : 'NEUTRAL',
    weight: 0.25,
    reasoning:
      snapshot.realRate10y > 2.0
        ? `High real rates (${snapshot.realRate10y.toFixed(2)}%) compete with gold`
        : snapshot.realRate10y < 0.5
          ? `Low/negative real rates (${snapshot.realRate10y.toFixed(2)}%) make gold attractive`
          : `Real rates neutral (${snapshot.realRate10y.toFixed(2)}%)`,
  });

  // 3. Yield Curve — Inversion signals recession risk, gold bullish
  drivers.push({
    factor: 'Yield Curve (10Y-2Y)',
    value: snapshot.yieldCurveSpread,
    signal:
      snapshot.yieldCurveSpread < -0.5
        ? 'BULLISH'
        : snapshot.yieldCurveSpread > 1.5
          ? 'BEARISH'
          : 'NEUTRAL',
    weight: 0.1,
    reasoning:
      snapshot.yieldCurveSpread < -0.5
        ? `Inverted curve (${snapshot.yieldCurveSpread.toFixed(2)}%) — recession risk, gold safe haven`
        : snapshot.yieldCurveSpread > 1.5
          ? `Steep curve (${snapshot.yieldCurveSpread.toFixed(2)}%) — growth optimism, gold less needed`
          : `Curve normal (${snapshot.yieldCurveSpread.toFixed(2)}%)`,
  });

  // 4. VIX — Fear = gold buying
  drivers.push({
    factor: 'VIX (Fear Index)',
    value: snapshot.vix,
    signal: snapshot.vix > 30 ? 'BULLISH' : snapshot.vix < 15 ? 'BEARISH' : 'NEUTRAL',
    weight: 0.15,
    reasoning:
      snapshot.vix > 30
        ? `Elevated fear (VIX ${snapshot.vix.toFixed(1)}) — flight to gold`
        : snapshot.vix < 15
          ? `Complacency (VIX ${snapshot.vix.toFixed(1)}) — risk-on, gold ignored`
          : `Moderate volatility (VIX ${snapshot.vix.toFixed(1)})`,
  });

  // 5. Inflation Expectations — Higher inflation = gold bullish
  drivers.push({
    factor: 'Inflation Expectations (5Y BEI)',
    value: snapshot.breakeven5y,
    signal:
      snapshot.breakeven5y > 3.0 ? 'BULLISH' : snapshot.breakeven5y < 2.0 ? 'BEARISH' : 'NEUTRAL',
    weight: 0.1,
    reasoning:
      snapshot.breakeven5y > 3.0
        ? `High inflation expectations (${snapshot.breakeven5y.toFixed(2)}%) — gold as inflation hedge`
        : snapshot.breakeven5y < 2.0
          ? `Low inflation (${snapshot.breakeven5y.toFixed(2)}%) — less demand for gold hedge`
          : `Inflation expectations moderate (${snapshot.breakeven5y.toFixed(2)}%)`,
  });

  // 6. Central Bank Gold Purchases — Structural demand driver
  drivers.push({
    factor: 'CB Gold Purchases',
    value: snapshot.cbGoldPurchases,
    signal:
      snapshot.cbGoldPurchases > 50
        ? 'BULLISH'
        : snapshot.cbGoldPurchases < 10
          ? 'NEUTRAL'
          : 'NEUTRAL',
    weight: 0.15,
    reasoning:
      snapshot.cbGoldPurchases > 50
        ? `Heavy CB buying (${snapshot.cbGoldPurchases}t/mo) — structural demand, de-dollarization`
        : `Moderate CB activity (${snapshot.cbGoldPurchases}t/mo)`,
  });

  return drivers;
}

// ─── Regime Classification ──────────────────────────────────────────────────

export function classifyMacroRegime(snapshot: MacroSnapshot): MacroRegime {
  const drivers = analyzeMacroDrivers(snapshot);

  let bullishScore = 0;
  let bearishScore = 0;

  for (const d of drivers) {
    if (d.signal === 'BULLISH') bullishScore += d.weight;
    else if (d.signal === 'BEARISH') bearishScore += d.weight;
  }

  const netScore = bullishScore - bearishScore;

  // Regime archetypes
  if (snapshot.realRate10y < 0 && snapshot.vix > 25) {
    return {
      name: 'CRISIS_HAVEN',
      description: 'Negative real rates + elevated fear — peak gold environment',
      goldBias: 'BUY',
      silverBias: 'BUY',
      confidence: 0.85,
      drivers,
      historicalAnalog: '2020 COVID crash, 2008 GFC, 2011 Euro crisis',
    };
  }

  if (snapshot.dxy > 105 && snapshot.realRate10y > 2.0) {
    return {
      name: 'STRONG_DOLLAR_TIGHTENING',
      description: 'Strong dollar + high real rates — headwinds for gold',
      goldBias: 'SELL',
      silverBias: 'SELL',
      confidence: 0.7,
      drivers,
      historicalAnalog: '2022 Fed hiking cycle, 2014-2015 dollar rally',
    };
  }

  if (snapshot.breakeven5y > 3.0 && snapshot.realRate10y < 1.0) {
    return {
      name: 'INFLATIONARY',
      description: 'Rising inflation expectations with accommodative real rates',
      goldBias: 'BUY',
      silverBias: 'BUY',
      confidence: 0.75,
      drivers,
      historicalAnalog: '2021 reflation trade, 1970s stagflation',
    };
  }

  if (snapshot.yieldCurveSpread < -0.5) {
    return {
      name: 'RECESSION_WATCH',
      description: 'Inverted yield curve signals recession risk ahead',
      goldBias: 'BUY',
      silverBias: 'NEUTRAL',
      confidence: 0.6,
      drivers,
      historicalAnalog: '2019 pre-COVID inversion, 2006 pre-GFC',
    };
  }

  if (snapshot.cbGoldPurchases > 50 && snapshot.dxy < 102) {
    return {
      name: 'DE_DOLLARIZATION',
      description: 'Central banks aggressively buying gold, weakening dollar',
      goldBias: 'BUY',
      silverBias: 'BUY',
      confidence: 0.7,
      drivers,
      historicalAnalog: '2023-2024 BRICS CB accumulation',
    };
  }

  if (netScore > 0.15) {
    return {
      name: 'MACRO_BULLISH',
      description: 'Multiple macro factors favor gold',
      goldBias: 'BUY',
      silverBias: 'BUY',
      confidence: Math.min(netScore * 2, 0.75),
      drivers,
      historicalAnalog: 'Generic risk-off / accommodative environment',
    };
  }

  if (netScore < -0.15) {
    return {
      name: 'MACRO_BEARISH',
      description: 'Multiple macro factors weigh on gold',
      goldBias: 'SELL',
      silverBias: 'SELL',
      confidence: Math.min(Math.abs(netScore) * 2, 0.75),
      drivers,
      historicalAnalog: 'Generic risk-on / tightening environment',
    };
  }

  return {
    name: 'MACRO_NEUTRAL',
    description: 'Mixed macro signals — no clear direction from fundamentals',
    goldBias: 'NEUTRAL',
    silverBias: 'NEUTRAL',
    confidence: 0.3,
    drivers,
    historicalAnalog: 'Transition period between regimes',
  };
}

// ─── Simulated Macro Snapshot ───────────────────────────────────────────────

export function generateSimulatedMacro(): MacroSnapshot {
  return {
    dxy: 103.5 + (Math.random() - 0.5) * 4,
    realRate10y: 1.8 + (Math.random() - 0.5) * 1.5,
    nominalRate10y: 4.2 + (Math.random() - 0.5) * 0.8,
    rate2y: 4.5 + (Math.random() - 0.5) * 0.6,
    yieldCurveSpread: -0.3 + (Math.random() - 0.5) * 1.5,
    vix: 18 + (Math.random() - 0.5) * 15,
    breakeven5y: 2.4 + (Math.random() - 0.5) * 1.0,
    fedFundsRate: 5.25,
    cbuaeRate: 5.4,
    cbGoldPurchases: 35 + Math.floor(Math.random() * 40),
    timestamp: Date.now(),
  };
}
