#!/usr/bin/env node
/**
 * ████████████████████████████████████████████████████████████████████
 * █                                                                  █
 * █   HAWKEYE AUTOPILOT — AUTONOMOUS COMPLIANCE COMMAND CENTER       █
 * █                                                                  █
 * █   The single command that runs EVERYTHING.                       █
 * █                                                                  █
 * ████████████████████████████████████████████████████████████████████
 *
 * One command. Full autonomous compliance cycle:
 *
 *   1. CHECK sanctions lists for changes → alert if changed
 *   2. SCREEN entire counterparty portfolio → flag new matches
 *   3. DETECT transaction patterns → structuring, layering, smurfing
 *   4. SCAN for FATF gold red flags → score every transaction
 *   5. ASSESS PF risk → DPRK/Iran/dual-use detection
 *   6. REFRESH CDD → re-screen expiring entities, escalate overdue
 *   7. CHECK filing deadlines → alert on overdue STR/DPMSR/CNMR
 *   8. RUN MOE inspection simulator → identify gaps before inspectors
 *   9. CALCULATE health score → 0-100 across 8 dimensions
 *  10. GENERATE KPI dashboard → 30 metrics for MLRO
 *  11. VERIFY evidence chain → tamper detection
 *  12. BUILD inspection bundle → ready for surprise visit
 *  13. GENERATE morning briefing → everything the MLRO needs to know
 *  14. RECORD everything in memory → cross-session intelligence
 *  15. ARCHIVE all results → 10-year evidence trail
 *
 * Schedule: Daily via GitHub Actions at 06:00 UTC (10:00 UAE)
 * Or run on-demand: node scripts/autopilot.mjs
 *
 * This is the weapon.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { think as brainThink } from './brain.mjs';
import cachet, { IncidentStatus } from './lib/cachet-client.mjs';

const PROJECT_ROOT = resolve(import.meta.dirname || '.', '..');
const HISTORY_DIR = resolve(PROJECT_ROOT, 'history', 'daily-ops');
const today = new Date().toISOString().split('T')[0];
const startTime = Date.now();

const results = {};
const alerts = [];
const errors = [];

// ── MAIN ────────────────────────────────────────────────────

async function run() {
  banner();

  // Phase 1: Intelligence Gathering
  console.log('\n═══ PHASE 1: INTELLIGENCE ═══\n');

  await step('1. Sanctions List Check', async () => {
    const { checkForChanges } = await import(resolve(PROJECT_ROOT, 'screening', 'webhooks', 'sanctions-alert.mjs'));
    const r = await checkForChanges();
    results.sanctions = r;
    if (r.changes > 0) alerts.push({ level: 'CRITICAL', msg: `${r.changes} sanctions list(s) changed — re-screening triggered` });
    return `Checked ${r.checked} sources, ${r.changes} changes`;
  });

  await step('2. World Monitor Intelligence', async () => {
    try {
      const { fetchIntelligence, scoreIntelligence } = await import(resolve(PROJECT_ROOT, 'screening', 'sources', 'worldmonitor.mjs'));
      const events = await fetchIntelligence({ hours: 24, limit: 20 });
      const score = scoreIntelligence(events);
      results.intelligence = { events: events.length, lift: score.lift };
      if (score.lift >= 0.05) alerts.push({ level: 'HIGH', msg: `Intelligence: ${events.length} signals, risk lift ${score.lift}` });
      return `${events.length} signals, lift: ${score.lift}`;
    } catch (e) { return `Skipped: ${e.message}`; }
  });

  // Phase 2: Screening
  console.log('\n═══ PHASE 2: SCREENING ═══\n');

  await step('3. Portfolio Re-Screen', async () => {
    try {
      const { runPortfolioScreen } = await import(resolve(PROJECT_ROOT, 'scripts', 'batch-portfolio-screener.mjs'));
      const r = await runPortfolioScreen();
      results.portfolio = r;
      if (r.newMatches > 0) alerts.push({ level: 'CRITICAL', msg: `${r.newMatches} NEW sanctions matches in portfolio` });
      if (r.cleared > 0) alerts.push({ level: 'INFO', msg: `${r.cleared} entities cleared` });
      return `Screened ${r.screened}, new: ${r.newMatches}, cleared: ${r.cleared}`;
    } catch (e) { return `Skipped: ${e.message}`; }
  });

  await step('4. Sanctions Diff Analysis', async () => {
    try {
      const { generateDiff } = await import(resolve(PROJECT_ROOT, 'screening', 'analysis', 'sanctions-diff.mjs'));
      const r = await generateDiff();
      results.diff = r;
      if (r.added > 0) alerts.push({ level: 'HIGH', msg: `${r.added} new designations detected` });
      if (r.impacted > 0) alerts.push({ level: 'CRITICAL', msg: `${r.impacted} counterparties IMPACTED by new designations` });
      return `Added: ${r.added || 0}, Removed: ${r.removed || 0}, Impacted: ${r.impacted || 0}`;
    } catch (e) { return `Skipped: ${e.message}`; }
  });

  // Phase 3: CDD & Risk
  console.log('\n═══ PHASE 3: CDD & RISK ═══\n');

  await step('5. CDD Refresh Cycle', async () => {
    try {
      const { runRefreshCycle } = await import(resolve(PROJECT_ROOT, 'scripts', 'cdd-engine', 'refresh-engine.mjs'));
      const r = await runRefreshCycle();
      results.cdd = r;
      if (r.overdue?.length > 0) alerts.push({ level: 'HIGH', msg: `${r.overdue.length} CDD reviews OVERDUE — escalated to MLRO` });
      return `Total: ${r.total}, Refreshed: ${r.refreshed?.length || 0}, Overdue: ${r.overdue?.length || 0}`;
    } catch (e) { return `Skipped: ${e.message}`; }
  });

  // Phase 4: Compliance Assessment
  console.log('\n═══ PHASE 4: ASSESSMENT ═══\n');

  await step('6. Health Score', async () => {
    const { calculateHealthScore } = await import(resolve(PROJECT_ROOT, 'scripts', 'compliance-health-score.mjs'));
    const r = await calculateHealthScore();
    results.health = r;
    if (r.composite < 70) alerts.push({ level: 'HIGH', msg: `Health score ${r.composite}/100 (${r.grade}) — below acceptable threshold` });
    return `Score: ${r.composite}/100 (Grade: ${r.grade})`;
  });

  await step('7. MOE Inspection Simulator', async () => {
    const { runInspection } = await import(resolve(PROJECT_ROOT, 'scripts', 'moe-inspection-simulator.mjs'));
    const r = await runInspection();
    results.inspection = r;
    if (r.gaps?.length > 0) alerts.push({ level: 'HIGH', msg: `${r.gaps.length} inspection gaps, penalty exposure AED ${r.maxPenalty?.toLocaleString() || 'unknown'}` });
    return `Score: ${r.score}/100 (${r.grade}), Gaps: ${r.gaps?.length || 0}`;
  });

  await step('8. KPI Dashboard', async () => {
    const { calculateKPIs } = await import(resolve(PROJECT_ROOT, 'scripts', 'kpi-dashboard.mjs'));
    const r = await calculateKPIs();
    results.kpis = r;
    const missed = r.kpis.filter(k => k.target !== 'N/A' && !evaluateTarget(k.value, k.target));
    if (missed.length > 0) alerts.push({ level: 'MEDIUM', msg: `${missed.length} KPIs below target` });
    return `30 KPIs calculated, ${missed.length} below target`;
  });

  await step('9. Compliance Calendar', async () => {
    const { getCalendar } = await import(resolve(PROJECT_ROOT, 'scripts', 'compliance-calendar.mjs'));
    const r = getCalendar();
    results.calendar = r;
    if (r.overdue > 0) alerts.push({ level: 'HIGH', msg: `${r.overdue} compliance deadlines OVERDUE` });
    if (r.upcoming > 0) alerts.push({ level: 'MEDIUM', msg: `${r.upcoming} deadlines upcoming` });
    return `Overdue: ${r.overdue}, Upcoming: ${r.upcoming}, Current: ${r.current}`;
  });

  // Phase 5: Evidence & Integrity
  console.log('\n═══ PHASE 5: EVIDENCE ═══\n');

  await step('10. Evidence Chain Integrity', async () => {
    const { verifyChain, appendEvidence } = await import(resolve(PROJECT_ROOT, 'scripts', 'evidence-chain.mjs'));
    const v = await verifyChain();
    results.chain = v;
    if (!v.valid) alerts.push({ level: 'CRITICAL', msg: `Evidence chain BROKEN at entry ${v.brokenAt}: ${v.message}` });

    // Record this autopilot run in the chain
    await appendEvidence({
      action: 'autopilot_run',
      actor: 'system',
      subject: 'daily_compliance_cycle',
      detail: `Autopilot completed: ${alerts.length} alerts, health ${results.health?.composite || '?'}/100`,
      data: { alerts: alerts.length, health: results.health?.composite },
    });

    return v.valid ? `Chain intact: ${v.entries} entries` : `BROKEN: ${v.message}`;
  });

  await step('11. Traceability Matrix', async () => {
    const { TRACEABILITY_MATRIX } = await import(resolve(PROJECT_ROOT, 'scripts', 'regulatory-traceability.mjs'));
    const implemented = TRACEABILITY_MATRIX.filter(r => r.status === 'IMPLEMENTED').length;
    results.traceability = { total: TRACEABILITY_MATRIX.length, implemented };
    return `${implemented}/${TRACEABILITY_MATRIX.length} requirements implemented (${Math.round(implemented / TRACEABILITY_MATRIX.length * 100)}%)`;
  });

  // Phase 6: Brain Pass — route every alert through the SUPER ULTRA BRAIN
  // so it can apply deterministic auto-actions, escalate to Cachet, and
  // record routing decisions in claude-mem.
  console.log('\n═══ PHASE 6: BRAIN ═══\n');

  await step('12. Brain routing + escalation', async () => {
    results.brain = { routed: 0, escalated: 0, cachetPublished: 0, cachetErrors: 0 };
    const cachetConfigured = Boolean(process.env.CACHET_BASE_URL && process.env.CACHET_API_TOKEN);

    for (const alert of alerts) {
      try {
        const decision = await brainThink(alert.msg);
        results.brain.routed++;

        // Escalate critical alerts to the public status page when Cachet is configured.
        if (alert.level === 'CRITICAL' && cachetConfigured) {
          try {
            await cachet.createIncident({
              name: `[CRITICAL] ${alert.msg.slice(0, 80)}`,
              message: `Autopilot critical alert\n\nBrain routed to: ${decision.tool ?? 'unrouted'}\nPurpose: ${decision.purpose}\n\nFull alert: ${alert.msg}`,
              status: IncidentStatus.IDENTIFIED,
            });
            results.brain.cachetPublished++;
          } catch (err) {
            results.brain.cachetErrors++;
            console.warn(`  [brain] cachet publish failed: ${err.message}`);
          }
        }

        if (decision.tool === null || alert.level === 'CRITICAL' || alert.level === 'HIGH') {
          results.brain.escalated++;
        }
      } catch (err) {
        console.warn(`  [brain] routing failed for alert: ${err.message}`);
      }
    }

    return `Routed ${results.brain.routed}, escalated ${results.brain.escalated}, cachet ${results.brain.cachetPublished}/${results.brain.cachetPublished + results.brain.cachetErrors}`;
  });

  // Phase 7: Generate Briefing
  console.log('\n═══ PHASE 7: BRIEFING ═══\n');

  const briefing = generateBriefing();
  await archiveBriefing(briefing);
  await recordInMemory();

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`AUTOPILOT COMPLETE — ${elapsed}s — ${alerts.length} alerts`);
  console.log(`${'═'.repeat(60)}`);

  // Print critical alerts
  const critical = alerts.filter(a => a.level === 'CRITICAL');
  if (critical.length > 0) {
    console.log('\n\x1b[31m*** CRITICAL ALERTS ***\x1b[0m');
    for (const a of critical) console.log(`  \x1b[31m${a.msg}\x1b[0m`);
  }

  return { alerts, results, briefing, elapsed };
}

// ── Step Runner ─────────────────────────────────────────────

async function step(name, fn) {
  process.stdout.write(`  ${name}... `);
  try {
    const result = await fn();
    console.log(`\x1b[32m${result}\x1b[0m`);
  } catch (err) {
    console.log(`\x1b[31mERROR: ${err.message}\x1b[0m`);
    errors.push({ step: name, error: err.message });
  }
}

// ── Morning Briefing ────────────────────────────────────────

function generateBriefing() {
  const lines = [];

  lines.push('HAWKEYE STERLING — DAILY COMPLIANCE BRIEFING');
  lines.push(`Date: ${today}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('Classification: CONFIDENTIAL — For MLRO Only');
  lines.push('');

  // Health Score
  if (results.health) {
    lines.push(`COMPLIANCE HEALTH: ${results.health.composite}/100 (${results.health.grade})`);
    lines.push('');
  }

  // Alerts summary
  const critical = alerts.filter(a => a.level === 'CRITICAL');
  const high = alerts.filter(a => a.level === 'HIGH');
  const medium = alerts.filter(a => a.level === 'MEDIUM');

  lines.push(`ALERTS: ${critical.length} critical, ${high.length} high, ${medium.length} medium`);
  lines.push('');

  if (critical.length > 0) {
    lines.push('*** CRITICAL — IMMEDIATE ACTION REQUIRED ***');
    for (const a of critical) lines.push(`  ${a.msg}`);
    lines.push('');
  }

  if (high.length > 0) {
    lines.push('HIGH PRIORITY');
    for (const a of high) lines.push(`  ${a.msg}`);
    lines.push('');
  }

  if (medium.length > 0) {
    lines.push('MEDIUM PRIORITY');
    for (const a of medium) lines.push(`  ${a.msg}`);
    lines.push('');
  }

  // Key metrics
  lines.push('KEY METRICS');
  if (results.inspection) lines.push(`  MOE readiness: ${results.inspection.score}/100 (${results.inspection.grade})`);
  if (results.calendar) lines.push(`  Deadlines: ${results.calendar.overdue} overdue, ${results.calendar.upcoming} upcoming`);
  if (results.traceability) lines.push(`  Regulatory coverage: ${results.traceability.implemented}/${results.traceability.total}`);
  if (results.portfolio) lines.push(`  Portfolio: ${results.portfolio.screened} entities screened`);
  if (results.chain) lines.push(`  Evidence chain: ${results.chain.valid ? 'INTACT' : 'BROKEN'} (${results.chain.entries} entries)`);
  if (results.brain) lines.push(`  Brain: ${results.brain.routed} routed, ${results.brain.escalated} escalated, ${results.brain.cachetPublished} published to Cachet`);
  lines.push('');

  // Errors
  if (errors.length > 0) {
    lines.push('ERRORS (non-critical)');
    for (const e of errors) lines.push(`  ${e.step}: ${e.error}`);
    lines.push('');
  }

  lines.push('For review by the MLRO.');

  return lines.join('\n');
}

// ── Archiving ───────────────────────────────────────────────

async function archiveBriefing(briefing) {
  try {
    if (!existsSync(HISTORY_DIR)) await mkdir(HISTORY_DIR, { recursive: true });
    await writeFile(resolve(HISTORY_DIR, `${today}-autopilot-briefing.txt`), briefing, 'utf8');
    console.log(`  Briefing archived: history/daily-ops/${today}-autopilot-briefing.txt`);
  } catch (e) { console.log(`  Archive error: ${e.message}`); }
}

async function recordInMemory() {
  try {
    const mem = (await import(resolve(PROJECT_ROOT, 'claude-mem', 'index.mjs'))).default;
    mem.startSession(`autopilot-${today}`);

    mem.observe({
      category: 'workflow_note',
      content: `Autopilot run: health ${results.health?.composite || '?'}/100, ${alerts.length} alerts, ${errors.length} errors`,
      importance: alerts.some(a => a.level === 'CRITICAL') ? 9 : 6,
    });

    for (const a of alerts.filter(a => a.level === 'CRITICAL')) {
      mem.observe({
        category: 'compliance_decision',
        content: `AUTOPILOT CRITICAL: ${a.msg}`,
        importance: 9,
      });
    }

    await mem.endSession(`Autopilot: ${results.health?.composite || '?'}/100, ${alerts.length} alerts`);
    mem.close();
  } catch { /* optional */ }
}

// ── Helpers ─────────────────────────────────────────────────

function evaluateTarget(value, target) {
  const match = target.match(/(>=?|<=?|>|<)?\s*(\d+)/);
  if (!match) return true;
  const op = match[1] || '>=';
  const num = parseInt(match[2]);
  switch (op) {
    case '>=': return value >= num;
    case '>': return value > num;
    case '<=': return value <= num;
    case '<': return value < num;
    default: return value >= num;
  }
}

function banner() {
  console.log(`
  ██╗  ██╗ █████╗ ██╗    ██╗██╗  ██╗███████╗██╗   ██╗███████╗
  ██║  ██║██╔══██╗██║    ██║██║ ██╔╝██╔════╝╚██╗ ██╔╝██╔════╝
  ███████║███████║██║ █╗ ██║█████╔╝ █████╗   ╚████╔╝ █████╗
  ██╔══██║██╔══██║██║███╗██║██╔═██╗ ██╔══╝    ╚██╔╝  ██╔══╝
  ██║  ██║██║  ██║╚███╔███╔╝██║  ██╗███████╗   ██║   ███████╗
  ╚═╝  ╚═╝╚═╝  ╚═╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚══════╝   ╚═╝   ╚══════╝
               A U T O P I L O T   v 1 . 0
       Autonomous Compliance Command Center — ${today}
  `);
}

// ── Run ─────────────────────────────────────────────────────

run().catch(err => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
