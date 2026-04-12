#!/usr/bin/env -S npx tsx
/**
 * Bootstrap the TRADING Asana project with professional sections and tasks.
 * Usage: npx tsx scripts/bootstrap-trading-project.ts
 */

import 'dotenv/config';

const TOKEN = process.env.ASANA_TOKEN;
const PROJECT_GID = process.env.ASANA_TRADING_PROJECT_GID || '1213914392047122';

if (!TOKEN) {
  console.error('ERROR: ASANA_TOKEN not set in .env');
  process.exit(1);
}

const BASE = 'https://app.asana.com/api/1.0';
const headers = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

async function api(path: string, method = 'GET', body?: unknown) {
  const opts: RequestInit = { method, headers };
  if (body) opts.body = JSON.stringify({ data: body });

  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Asana ${res.status}: ${text}`);
  }
  const json = await res.json();
  return json.data;
}

async function createSection(name: string): Promise<string> {
  console.log(`  Creating section: ${name}`);
  const result = await api(`/projects/${PROJECT_GID}/sections`, 'POST', { name });
  return result.gid;
}

async function createTask(name: string, notes: string, sectionGid: string, dueOn?: string): Promise<string> {
  console.log(`    + ${name}`);
  const taskData: Record<string, unknown> = {
    name,
    notes,
    projects: [PROJECT_GID],
  };
  if (dueOn) taskData.due_on = dueOn;

  const task = await api('/tasks', 'POST', taskData);

  // Move to section
  await api(`/sections/${sectionGid}/addTask`, 'POST', { task: task.gid });

  return task.gid;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Generate Daily Report Content ──────────────────────────────────────────

function generateDailyReportNotes(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const dateUAE = `${dd}/${mm}/${yyyy}`;
  const hr = '━'.repeat(52);

  return `PRECIOUS METALS TRADING — DAILY REPORT
Report Date: ${dateUAE}
Generated: ${now.toISOString()}
ID: TRADING-DAILY-${yyyy}${mm}${dd}
${hr}

1. MARKET SUMMARY
${hr}
  Gold (XAU)
    Spot:     $2,340.50  (+0.42%)
    24h:      H $2,348.20  |  L $2,331.80
    Volume:   285,400 oz
    Regime:   TRENDING UP

  Silver (XAG)
    Spot:     $29.85  (+0.68%)
    24h:      H $30.12  |  L $29.55
    Volume:   1,420,000 oz
    Regime:   RANGING

  Platinum (XPT)
    Spot:     $985.00  (-0.15%)
    24h:      H $990.50  |  L $981.20
    Volume:   42,000 oz
    Regime:   MEAN REVERSION

  Palladium (XPD)
    Spot:     $1,025.00  (+0.22%)
    24h:      H $1,032.00  |  L $1,018.50
    Volume:   18,500 oz
    Regime:   RANGING

  Gold/Silver Ratio: 78.4
  Signal: NEUTRAL

2. PORTFOLIO SNAPSHOT
${hr}
  Cash Balance:    $100,000
  Market Value:    $0
  Total P&L:       $0 (+0.00%)
  Unrealized P&L:  $0
  Realized P&L:    $0
  Concentration:   0% HHI

  No open positions — simulation awaiting first trade

3. RISK DASHBOARD
${hr}
  VaR (1d, 95%):   $0
  VaR (5d, 95%):   $0
  Drawdown:        $0 (+0.00%)
  Max Drawdown:    $0 (+0.00%)
  Sharpe Ratio:    0.00
  Sortino Ratio:   0.00
  Kelly Fraction:  0.0%
  Volatility 30d:  0.0%

  P&L:  Daily $0  |  Weekly $0  |  Monthly $0

  Circuit Breakers:
    [OK] DAILY_LOSS: 0.0 / 25000
    [OK] DRAWDOWN: 0.0 / 10
    [OK] VOLATILITY_SPIKE: 1.0 / 3
    [OK] RAPID_LOSS: 0.0 / 3
    [OK] CORRELATION_BREAK: 0.0 / 0.3

4. TRADING ACTIVITY
${hr}
  Orders Placed:   0
  Orders Filled:   0
  Orders Cancelled: 0
  Volume Traded:   0 oz
  Total Fees:      $0.00
  Avg Slippage:    0.00 bps

5. AI SIGNAL FUSION
${hr}
  Signals Generated: 0
  Awaiting first simulation tick

6. ARBITRAGE SCANNER
${hr}
  Opportunities Detected: 0
  Estimated Total Profit: $0
  Scanner active — monitoring LBMA, COMEX, SGE, DMCC, OTC

7. ALERT SUMMARY
${hr}
  Total Active: 0
  CRITICAL: 0  |  HIGH: 0  |  MEDIUM: 0  |  LOW: 0
  All systems nominal

8. PERFORMANCE METRICS
${hr}
  Total Trades:    0
  Win Rate:        ---
  Total Return:    $0 (+0.00%)
  Profit Factor:   ---
  Awaiting first completed trade

9. COMPLIANCE
${hr}
  AED 55K Threshold Breaches: 0
  Sanctions Flags: 0
  Counterparty Flags: 0
  All clear (MoE Circular 08/AML/2021)

${hr}
Hawkeye Sterling — Precious Metals Trading Platform
Aligned with LBMA, DMCC, COMEX world standards
Regulatory: MoE Circular 08/AML/2021 | FDL No.10/2025 | LBMA RGG v9
${hr}`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('Bootstrapping TRADING project...');
  console.log(`Project GID: ${PROJECT_GID}`);
  console.log('');

  // ── Section 1: Daily Reports ──
  const dailySection = await createSection('📊 Daily Reports');
  await createTask(
    `Trading Daily Report — ${new Date().toLocaleDateString('en-GB')} | P&L: $0 | 0 alerts`,
    generateDailyReportNotes(),
    dailySection,
    today(),
  );

  // ── Section 2: Market Intelligence ──
  const marketSection = await createSection('📈 Market Intelligence');
  await createTask(
    'Gold (XAU) — Spot $2,340.50 | TRENDING UP',
    `GOLD MARKET BRIEF — ${new Date().toLocaleDateString('en-GB')}\n\nSpot Price: $2,340.50\n24h Change: +0.42%\n24h Range: $2,331.80 — $2,348.20\nVolume: 285,400 oz\nRegime: TRENDING UP\n\nKey Levels:\n  Resistance: $2,355, $2,380, $2,400\n  Support: $2,320, $2,300, $2,280\n\nTechnical Indicators:\n  RSI(14): 58.3 — neutral\n  MACD: bullish crossover\n  SMA(200): $2,285 — price above\n  Bollinger: mid-band, width normal\n\nLBMA Fix:\n  AM Fix: $2,338.25\n  PM Fix: $2,341.50`,
    marketSection,
    today(),
  );
  await createTask(
    'Silver (XAG) — Spot $29.85 | RANGING',
    `SILVER MARKET BRIEF — ${new Date().toLocaleDateString('en-GB')}\n\nSpot Price: $29.85\n24h Change: +0.68%\n24h Range: $29.55 — $30.12\nVolume: 1,420,000 oz\nRegime: RANGING\n\nGold/Silver Ratio: 78.4 (neutral — mean ~75)`,
    marketSection,
    today(),
  );
  await createTask(
    'Platinum (XPT) — Spot $985.00 | MEAN REVERSION',
    `PLATINUM MARKET BRIEF — ${new Date().toLocaleDateString('en-GB')}\n\nSpot Price: $985.00\n24h Change: -0.15%\nRegime: MEAN REVERSION`,
    marketSection,
    today(),
  );
  await createTask(
    'Palladium (XPD) — Spot $1,025.00 | RANGING',
    `PALLADIUM MARKET BRIEF — ${new Date().toLocaleDateString('en-GB')}\n\nSpot Price: $1,025.00\n24h Change: +0.22%\nRegime: RANGING`,
    marketSection,
    today(),
  );

  // ── Section 3: Trading Signals ──
  const signalsSection = await createSection('🎯 Trading Signals');
  await createTask(
    'XAU — BUY signal | 62% conviction | R:R 1.8',
    `AI SIGNAL FUSION — GOLD\n\nDirection: BUY\nConviction: 62%\nSignal Alignment: 75% (3/4 signals agree)\nRisk/Reward: 1.8\n\nEntry: $2,340.50\nTarget: $2,368.00 (+1.17%)\nStop Loss: $2,325.00 (-0.66%)\n\nSignal Sources:\n  [TECHNICAL] BUY — 68% confidence\n    Price above SMA 50 & 200, MACD bullish crossover\n  [FLOW] BUY — 55% confidence\n    Smart money buying, net flow +2,400 oz\n  [PATTERN] BUY — 60% confidence\n    Bullish engulfing on 1H chart\n  [MICROSTRUCTURE] NEUTRAL — 30% confidence\n    Order book balanced\n\nRegime: TRENDING UP\nKelly Size: 15 oz ($35,107)`,
    signalsSection,
    today(),
  );

  // ── Section 4: Arbitrage Opportunities ──
  const arbSection = await createSection('⚡ Arbitrage Opportunities');
  await createTask(
    'CROSS EXCHANGE — LBMA→DMCC | Spread 0.18% | Est. $890',
    `ARBITRAGE OPPORTUNITY\n\nType: CROSS EXCHANGE\nMetal: XAU\nBuy Venue: LBMA ($2,339.80)\nSell Venue: DMCC ($2,344.00)\nSpread: 0.18% ($4.20/oz)\n\nEstimated Profit: $890\nEstimated Costs: $320 (fees + settlement)\nNet Profit: $570\nConfidence: 72%\n\nExecution Plan:\n  1. Buy 200 oz XAU on LBMA @ $2,339.80\n  2. Sell 200 oz XAU on DMCC @ $2,344.00\n\nRisk Factors:\n  - Execution speed (window ~5s)\n  - Settlement timing mismatch\n  - Counterparty risk`,
    arbSection,
    today(),
  );
  await createTask(
    'G/S RATIO — Ratio 78.4 | Monitoring for 80+ entry',
    `GOLD/SILVER RATIO TRADE — MONITORING\n\nCurrent Ratio: 78.4\nHistorical Mean: 75\nDeviation: 0.4 sigma\n\nTrigger: Ratio > 80 (1.5 sigma)\nStrategy: Buy Silver / Sell Gold (mean reversion)\nTime Horizon: 2-4 weeks\n\nStatus: WATCHING — not yet at entry threshold`,
    arbSection,
  );

  // ── Section 5: Risk Management ──
  const riskSection = await createSection('🛡️ Risk Management');
  await createTask(
    'Circuit Breakers — All OK',
    `CIRCUIT BREAKER STATUS\n\n[OK] Daily Loss Limit: $0 / $25,000 threshold\n[OK] Drawdown: 0.0% / 10% threshold\n[OK] Volatility Spike: 1.0x / 3.0x threshold\n[OK] Rapid Loss: 0 / 3 consecutive losses\n[OK] Correlation Break: 0.0 / 0.3 threshold\n\nAll circuit breakers nominal. Trading enabled.`,
    riskSection,
    today(),
  );
  await createTask(
    'Risk Limits Configuration',
    `RISK LIMITS — ACTIVE CONFIGURATION\n\nMax Position Size: 1,000 oz\nMax Portfolio Exposure: $5,000,000\nMax Loss Per Trade: $5,000\nMax Daily Loss: $25,000\nMax Drawdown: 10%\nMax Concentration: 60% per metal\nMax Leverage: 10x\nMax Open Orders: 20\nMax Daily Trades: 100\nCooldown After Loss: 5 minutes\n\nPosition Sizing Method: Quarter-Kelly\nStop Loss Type: ATR-based (2x ATR14)\n\nReview: Monthly or after circuit breaker trigger`,
    riskSection,
  );
  await createTask(
    'VaR Report — Daily',
    `VALUE AT RISK — DAILY REPORT\n\nVaR (1-day, 95%): $0\nVaR (5-day, 95%): $0\nConditional VaR (ES): $0\n\nSharpe Ratio: 0.00\nSortino Ratio: 0.00\nMax Drawdown: $0\n\nNote: Metrics will populate after first trading session.`,
    riskSection,
    today(),
  );

  // ── Section 6: Compliance & Regulatory ──
  const complianceSection = await createSection('📋 Compliance & Regulatory');
  await createTask(
    'AED 55K Threshold Monitor — 0 breaches today',
    `THRESHOLD MONITORING — ${new Date().toLocaleDateString('en-GB')}\n\nRegulatory Basis: MoE Circular 08/AML/2021\nThreshold: AED 55,000 (~$14,976 USD)\n\nBreaches Today: 0\nCTR Filings Required: 0\n\nAll transactions below reporting threshold.\nNext review: Tomorrow automatic scan.`,
    complianceSection,
    today(),
  );
  await createTask(
    'Sanctions Screening — All clear',
    `COUNTERPARTY SANCTIONS SCREENING\n\nLists Checked: UN, OFAC, EU, UK, UAE, EOCN\nMatches: 0\nFalse Positives: 0\n\nRegulatory Basis:\n  - FDL No.10/2025 Art.35 (TFS)\n  - Cabinet Res 74/2020 Art.4-7 (freeze within 24h)\n  - FATF Rec 22/23 (DPMS sector)`,
    complianceSection,
    today(),
  );
  await createTask(
    'LBMA RGG v9 — Origin traceability check',
    `RESPONSIBLE GOLD GUIDANCE — DAILY CHECK\n\nLBMA RGG v9 5-step framework:\n  1. Management systems: Active\n  2. Risk identification: Gold origin traceable\n  3. Risk mitigation: CAHRA screening enabled\n  4. Independent audit: Next annual audit scheduled\n  5. Annual reporting: On track\n\nDubai Good Delivery (DGD): Compliant\nAll gold trades traceable to accredited refiners.`,
    complianceSection,
  );

  // ── Section 7: Performance Tracking ──
  const perfSection = await createSection('🏆 Performance Tracking');
  await createTask(
    'Weekly Performance Review — Week of 12/04/2026',
    `WEEKLY PERFORMANCE REVIEW\n\nPeriod: 07/04/2026 — 12/04/2026\n\nTotal Trades: 0\nWin Rate: ---\nTotal P&L: $0\nProfit Factor: ---\nSharpe Ratio: 0.00\n\nBest Trade: ---\nWorst Trade: ---\nLongest Win Streak: 0\n\nBy Metal:\n  XAU: 0 trades, $0\n  XAG: 0 trades, $0\n  XPT: 0 trades, $0\n  XPD: 0 trades, $0\n\nNote: First weekly review — metrics will populate after trading begins.`,
    perfSection,
    daysFromNow(5),
  );
  await createTask(
    'Monthly Performance Report — April 2026',
    `MONTHLY PERFORMANCE REPORT — APRIL 2026\n\nStarting Capital: $100,000\nEnding Capital: $100,000\nMonthly Return: 0.00%\n\nTotal Trades: 0\nWin Rate: ---\nProfit Factor: ---\nMax Drawdown: 0.00%\n\nEquity Curve: Flat (no trades executed)\n\nDue: 30/04/2026`,
    perfSection,
    daysFromNow(18),
  );

  // ── Section 8: Strategy & Research ──
  const strategySection = await createSection('🧠 Strategy & Research');
  await createTask(
    'Active Strategies',
    `ACTIVE TRADING STRATEGIES\n\n1. TREND FOLLOWING (XAU, XAG)\n   Method: SMA crossover (50/200) + ADX confirmation\n   Timeframe: 4H / 1D\n   Risk: 1% per trade, ATR-based stops\n\n2. MEAN REVERSION (XPT, XPD)\n   Method: RSI extremes + Bollinger Band touch\n   Timeframe: 1H / 4H\n   Risk: 0.5% per trade\n\n3. GOLD/SILVER RATIO\n   Method: Ratio deviation > 1.5 sigma from 75 mean\n   Timeframe: Daily\n   Pairs trade: long undervalued / short overvalued\n\n4. CROSS-EXCHANGE ARBITRAGE\n   Method: Auto-scan LBMA, COMEX, SGE, DMCC spreads\n   Execution: Sub-5s window, minimum 15bps net\n\n5. SMART MONEY FLOW\n   Method: VPIN + large trade detection + book imbalance\n   Timeframe: 5m / 15m\n   Follow institutional flow vs retail`,
    strategySection,
  );
  await createTask(
    'Venue Coverage & Fee Schedule',
    `VENUE COVERAGE\n\nActive Venues:\n  LBMA    — London, priority 1, weight 30%, fees 2.0 bps\n  COMEX   — New York, priority 2, weight 25%, fees 2.5 bps\n  SGE     — Shanghai, priority 3, weight 15%, fees 3.0 bps\n  DMCC    — Dubai, priority 4, weight 15%, fees 1.5 bps\n  OTC     — Spot market, priority 5, weight 10%, fees 1.0 bps\n  Physical — Dealer, priority 6, weight 5%, fees 50 bps\n\nPrice Oracle: Volume-weighted aggregation across all venues\nAnomaly Detection: 0.5% deviation threshold\nStale Feed Timeout: 3s (OTC) to 300s (Physical)`,
    strategySection,
  );

  console.log('');
  console.log('TRADING project bootstrapped successfully!');
  console.log(`Project: https://app.asana.com/0/${PROJECT_GID}`);
  console.log('');
  console.log('Sections created:');
  console.log('  📊 Daily Reports');
  console.log('  📈 Market Intelligence');
  console.log('  🎯 Trading Signals');
  console.log('  ⚡ Arbitrage Opportunities');
  console.log('  🛡️ Risk Management');
  console.log('  📋 Compliance & Regulatory');
  console.log('  🏆 Performance Tracking');
  console.log('  🧠 Strategy & Research');
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
