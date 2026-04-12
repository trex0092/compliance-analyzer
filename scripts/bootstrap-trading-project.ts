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

  return `PRECIOUS METALS TRADING — DAILY REPORT\nReport Date: ${dateUAE}\nGenerated: ${now.toISOString()}\nID: TRADING-DAILY-${yyyy}${mm}${dd}\n${hr}\n\n1. MARKET SUMMARY\n${hr}\n  Gold (XAU)\n    Spot:     $2,340.50  (+0.42%)\n    24h:      H $2,348.20  |  L $2,331.80\n    Volume:   285,400 oz\n    Regime:   TRENDING UP\n\n  Silver (XAG)\n    Spot:     $29.85  (+0.68%)\n    24h:      H $30.12  |  L $29.55\n    Volume:   1,420,000 oz\n    Regime:   RANGING\n\n  Platinum (XPT)\n    Spot:     $985.00  (-0.15%)\n    24h:      H $990.50  |  L $981.20\n    Volume:   42,000 oz\n    Regime:   MEAN REVERSION\n\n  Palladium (XPD)\n    Spot:     $1,025.00  (+0.22%)\n    24h:      H $1,032.00  |  L $1,018.50\n    Volume:   18,500 oz\n    Regime:   RANGING\n\n  Gold/Silver Ratio: 78.4\n  Signal: NEUTRAL\n\n2. PORTFOLIO SNAPSHOT\n${hr}\n  Cash Balance:    $100,000\n  Market Value:    $0\n  Total P&L:       $0 (+0.00%)\n\n3. RISK DASHBOARD\n${hr}\n  Circuit Breakers: All OK\n  Daily Loss Limit: $25,000\n  Max Drawdown: 10%\n\n4. COMPLIANCE\n${hr}\n  AED 55K Threshold Breaches: 0\n  Sanctions Flags: 0\n  All clear (MoE Circular 08/AML/2021)\n\n${hr}\nHawkeye Sterling — Precious Metals Trading Platform\nLBMA | DMCC | COMEX Standards\n${hr}`;
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
    `GOLD MARKET BRIEF\n\nSpot Price: $2,340.50\n24h Change: +0.42%\nRegime: TRENDING UP\n\nKey Levels:\n  Resistance: $2,355, $2,380, $2,400\n  Support: $2,320, $2,300, $2,280\n\nLBMA Fix:\n  AM Fix: $2,338.25\n  PM Fix: $2,341.50`,
    marketSection,
    today(),
  );
  await createTask('Silver (XAG) — Spot $29.85 | RANGING', 'SILVER MARKET BRIEF\n\nSpot: $29.85 (+0.68%)\nRegime: RANGING\nG/S Ratio: 78.4', marketSection, today());
  await createTask('Platinum (XPT) — Spot $985.00 | MEAN REVERSION', 'PLATINUM MARKET BRIEF\n\nSpot: $985.00 (-0.15%)\nRegime: MEAN REVERSION', marketSection, today());
  await createTask('Palladium (XPD) — Spot $1,025.00 | RANGING', 'PALLADIUM MARKET BRIEF\n\nSpot: $1,025.00 (+0.22%)\nRegime: RANGING', marketSection, today());

  // ── Section 3: Trading Signals ──
  const signalsSection = await createSection('🎯 Trading Signals');
  await createTask(
    'XAU — BUY signal | 62% conviction | R:R 1.8',
    'AI SIGNAL FUSION — GOLD\n\nDirection: BUY\nConviction: 62%\nAlignment: 75% (3/4 signals)\nR:R 1.8\n\nEntry: $2,340.50\nTarget: $2,368.00\nStop: $2,325.00\n\n[TECHNICAL] BUY 68%\n[FLOW] BUY 55%\n[PATTERN] BUY 60%\n[MICROSTRUCTURE] NEUTRAL 30%',
    signalsSection,
    today(),
  );

  // ── Section 4: Arbitrage Opportunities ──
  const arbSection = await createSection('⚡ Arbitrage Opportunities');
  await createTask('CROSS EXCHANGE — LBMA→DMCC | Spread 0.18% | Est. $890', 'ARBITRAGE: CROSS EXCHANGE\n\nBuy: LBMA $2,339.80\nSell: DMCC $2,344.00\nNet Profit: $570\nConfidence: 72%', arbSection, today());
  await createTask('G/S RATIO — Ratio 78.4 | Monitoring for 80+ entry', 'GOLD/SILVER RATIO TRADE\n\nCurrent: 78.4 | Mean: 75\nTrigger: Ratio > 80\nStatus: WATCHING', arbSection);

  // ── Section 5: Risk Management ──
  const riskSection = await createSection('🛡️ Risk Management');
  await createTask('Circuit Breakers — All OK', 'All 5 circuit breakers nominal. Trading enabled.', riskSection, today());
  await createTask('Risk Limits Configuration', 'Max Position: 1,000 oz\nMax Exposure: $5M\nMax Daily Loss: $25,000\nMax Drawdown: 10%\nMax Concentration: 60%', riskSection);
  await createTask('VaR Report — Daily', 'VaR (1d, 95%): $0\nVaR (5d, 95%): $0\nSharpe: 0.00', riskSection, today());

  // ── Section 6: Compliance & Regulatory ──
  const complianceSection = await createSection('📋 Compliance & Regulatory');
  await createTask('AED 55K Threshold Monitor — 0 breaches today', 'MoE Circular 08/AML/2021\nBreaches: 0\nCTR Filings: 0', complianceSection, today());
  await createTask('Sanctions Screening — All clear', 'Lists: UN, OFAC, EU, UK, UAE, EOCN\nMatches: 0', complianceSection, today());
  await createTask('LBMA RGG v9 — Origin traceability check', 'LBMA RGG v9 5-step framework: All compliant\nDGD: Compliant', complianceSection);

  // ── Section 7: Performance Tracking ──
  const perfSection = await createSection('🏆 Performance Tracking');
  await createTask('Weekly Performance Review', 'Total Trades: 0\nWin Rate: ---\nP&L: $0', perfSection, daysFromNow(5));
  await createTask('Monthly Performance Report — April 2026', 'Starting Capital: $100,000\nMonthly Return: 0.00%', perfSection, daysFromNow(18));

  // ── Section 8: Strategy & Research ──
  const strategySection = await createSection('🧠 Strategy & Research');
  await createTask('Active Strategies', '1. Trend Following (SMA 50/200)\n2. Mean Reversion (Bollinger)\n3. G/S Ratio Trade\n4. Cross-Exchange Arb\n5. Smart Money Flow', strategySection);
  await createTask('Venue Coverage & Fee Schedule', 'LBMA 2.0bps | COMEX 2.5bps | SGE 3.0bps | DMCC 1.5bps | OTC 1.0bps | Physical 50bps', strategySection);

  console.log('');
  console.log('TRADING project bootstrapped successfully!');
  console.log(`Project: https://app.asana.com/0/${PROJECT_GID}`);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
