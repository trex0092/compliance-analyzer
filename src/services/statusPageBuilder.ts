/**
 * Status Page Builder — produces a static HTML + JSON status page
 * from the unified brain health report.
 *
 * Why this exists:
 *   Operators (and their customers, and regulators) want a single URL
 *   that shows whether the brain is up. The health dashboard in the
 *   Brain Console is authenticated; the status page is PUBLIC so
 *   anyone can hit it without a token.
 *
 *   This module is the pure renderer. Input: `HealthReport` from
 *   `brainHealthCheck.ts`. Output: a structured `StatusPage` with
 *   both an HTML string and a machine-readable JSON payload. The
 *   cron that runs hourly writes the HTML to `public/status.html`
 *   and the JSON to `public/status.json`.
 *
 *   Pure function — same input → same output.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO operational transparency)
 *   NIST AI RMF 1.0 GOVERN-3 (oversight + transparency)
 *   EU AI Act Art.13         (transparency to users)
 */

import type { HealthReport, HealthState } from './brainHealthCheck';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatusBadge {
  label: string;
  state: HealthState;
  detail: string;
}

export interface StatusPage {
  schemaVersion: 1;
  generatedAtIso: string;
  overall: HealthState;
  overallLabel: string;
  badges: readonly StatusBadge[];
  /** Machine-readable JSON payload. */
  json: string;
  /** Rendered public HTML page. */
  html: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stateColor(state: HealthState): string {
  switch (state) {
    case 'ok':
      return '#3DA876';
    case 'degraded':
      return '#E8A030';
    case 'broken':
      return '#D94F4F';
  }
}

function stateLabel(state: HealthState): string {
  switch (state) {
    case 'ok':
      return 'Operational';
    case 'degraded':
      return 'Partial outage';
    case 'broken':
      return 'Major outage';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function badgeHtml(badge: StatusBadge): string {
  const color = stateColor(badge.state);
  return `
  <div class="badge" style="background:#161b22;border:1px solid #21262d;border-left:4px solid ${color};border-radius:6px;padding:12px 16px;margin-bottom:8px;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div style="font-weight:600;color:#e6edf3;">${escapeHtml(badge.label)}</div>
      <div style="color:${color};font-weight:700;text-transform:uppercase;font-size:11px;">${escapeHtml(stateLabel(badge.state))}</div>
    </div>
    <div style="font-size:11px;color:#8b949e;margin-top:4px;">${escapeHtml(badge.detail)}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildStatusPage(health: HealthReport): StatusPage {
  const badges: StatusBadge[] = [];

  // Env config
  badges.push({
    label: 'Configuration',
    state: health.envReport.health,
    detail: health.envReport.summary,
  });

  // Dependencies
  for (const dep of health.dependencies) {
    badges.push({ label: dep.name, state: dep.state, detail: dep.detail });
  }

  // Crons — roll up into one badge
  const cronFailures = health.crons.filter((c) => c.lastResult === 'error');
  badges.push({
    label: `Scheduled Functions (${health.crons.length})`,
    state: cronFailures.length > 0 ? 'degraded' : 'ok',
    detail:
      cronFailures.length === 0
        ? 'All scheduled functions green'
        : `${cronFailures.length} failing: ${cronFailures.map((c) => c.id).join(', ')}`,
  });

  // Tier C queues
  const deadLetter = health.tierCQueues.deadLetterDepth;
  badges.push({
    label: 'Dead-letter queue',
    state: deadLetter > 50 ? 'broken' : deadLetter > 10 ? 'degraded' : 'ok',
    detail: `${deadLetter} item(s) awaiting drain`,
  });

  // Regulatory drift
  badges.push({
    label: 'Regulatory drift',
    state:
      health.regulatoryDrift.topSeverity === 'critical'
        ? 'broken'
        : health.regulatoryDrift.topSeverity === 'high' ||
            health.regulatoryDrift.topSeverity === 'medium'
          ? 'degraded'
          : 'ok',
    detail: health.regulatoryDrift.clean
      ? 'No drift'
      : `${health.regulatoryDrift.driftedKeyCount} key(s) drifted`,
  });

  // Test suite
  if (health.testSuite.passed !== null && health.testSuite.total !== null) {
    const testOk = health.testSuite.passed === health.testSuite.total;
    badges.push({
      label: 'Test suite',
      state: testOk ? 'ok' : 'degraded',
      detail: `${health.testSuite.passed}/${health.testSuite.total} passing`,
    });
  }

  // Overall pill
  const overallLabel = stateLabel(health.overall);
  const overallColor = stateColor(health.overall);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>HAWKEYE STERLING — Status</title>
  <meta name="description" content="Operational status of the HAWKEYE STERLING compliance brain.">
  <style>
    body { font-family: -apple-system, Segoe UI, Roboto, system-ui, sans-serif; background:#0d1117; color:#e6edf3; margin:0; padding:0; }
    main { max-width: 720px; margin: 40px auto; padding: 0 20px; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    .subtitle { color:#8b949e; font-size:12px; margin-bottom:24px; }
    .overall { background:#161b22; border:1px solid #21262d; border-left:4px solid ${overallColor}; border-radius:8px; padding:20px; margin-bottom:20px; }
    .overall .label { font-size:11px; color:#8b949e; text-transform:uppercase; letter-spacing:0.5px; }
    .overall .value { font-size:22px; font-weight:700; color:${overallColor}; margin-top:4px; }
    footer { color:#8b949e; font-size:10px; margin-top:32px; text-align:center; line-height:1.6; }
  </style>
</head>
<body>
  <main>
    <h1>HAWKEYE STERLING</h1>
    <div class="subtitle">UAE AML/CFT/CPF compliance brain &middot; public status</div>
    <div class="overall">
      <div class="label">Overall status</div>
      <div class="value">${escapeHtml(overallLabel)}</div>
      <div style="color:#8b949e;font-size:11px;margin-top:6px;">${escapeHtml(health.summary)}</div>
    </div>
    ${badges.map(badgeHtml).join('\n')}
    <footer>
      Generated at ${escapeHtml(health.checkedAtIso)}<br>
      Regulatory anchors: ${health.regulatory.slice(0, 4).map(escapeHtml).join(' &middot; ')}
    </footer>
  </main>
</body>
</html>`;

  const jsonPayload = {
    schemaVersion: 1,
    checkedAtIso: health.checkedAtIso,
    overall: health.overall,
    overallLabel,
    badges,
    summary: health.summary,
  };

  return {
    schemaVersion: 1,
    generatedAtIso: health.checkedAtIso,
    overall: health.overall,
    overallLabel,
    badges,
    json: JSON.stringify(jsonPayload, null, 2),
    html,
    regulatory: ['FDL No.10/2025 Art.20-22', 'NIST AI RMF 1.0 GOVERN-3', 'EU AI Act Art.13'],
  };
}

// Exports for tests.
export const __test__ = { stateColor, stateLabel, escapeHtml };
