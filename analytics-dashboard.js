/**
 * Analytics Dashboard Module — Hawkeye Sterling V2 v2.5
 * Chart.js-powered visual analytics with Asana task metrics
 * Provides: trend charts, risk distribution, gap analysis, screening activity, Asana KPIs
 */
(function () {
  'use strict';

  const ANALYTICS_HISTORY_KEY = 'fgl_analytics_history';
  const ANALYTICS_SNAPSHOT_KEY = 'fgl_analytics_snapshots';
  const MAX_SNAPSHOTS = 365;

  // ── Helper: read localStorage via host app's scoping ──
  function parse(key, fb) {
    return typeof safeLocalParse === 'function' ? safeLocalParse(key, fb) : (() => { try { return JSON.parse(localStorage.getItem(key)) || fb; } catch (_) { return fb; } })();
  }
  function save(key, v) {
    if (typeof safeLocalSave === 'function') safeLocalSave(key, v);
    else localStorage.setItem(key, JSON.stringify(v));
  }

  // ── Snapshot: capture daily KPI point ──
  function captureSnapshot() {
    const snaps = parse(ANALYTICS_SNAPSHOT_KEY, []);
    const today = new Date().toISOString().slice(0, 10);
    if (snaps.length && snaps[snaps.length - 1].date === today) return; // already captured today

    const gaps = parse('fgl_gaps_v2', []);
    const incidents = parse('fgl_incidents', []);
    const screenings = parse('fgl_screenings', []);
    const customers = parse('fgl_onboarding', []);
    const training = parse('fgl_employee_training', []);
    const thresholdAlerts = parse('fgl_threshold_alerts', []);
    const auditTrail = parse('fgl_audit_trail', []);

    const openGaps = gaps.filter(g => g.status !== 'closed' && g.status !== 'resolved').length;
    const closedGaps = gaps.filter(g => g.status === 'closed' || g.status === 'resolved').length;
    const critGaps = gaps.filter(g => g.severity === 'critical' && g.status !== 'closed' && g.status !== 'resolved').length;
    const highGaps = gaps.filter(g => g.severity === 'high' && g.status !== 'closed' && g.status !== 'resolved').length;
    const medGaps = gaps.filter(g => g.severity === 'medium' && g.status !== 'closed' && g.status !== 'resolved').length;
    const lowGaps = gaps.filter(g => g.severity === 'low' && g.status !== 'closed' && g.status !== 'resolved').length;

    const openIncidents = incidents.filter(i => i.status === 'open').length;
    const avgRisk = customers.length ? Math.round(customers.reduce((s, c) => s + (c.risk?.score || 0), 0) / customers.length) : 0;

    const now = new Date();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const recentScreenings = screenings.filter(s => new Date(s.date) > thirtyDaysAgo).length;

    const completedTraining = (training || []).filter(t => t.status === 'completed' || t.completed).length;
    const totalTraining = (training || []).length;

    snaps.push({
      date: today,
      openGaps, closedGaps, critGaps, highGaps, medGaps, lowGaps,
      totalGaps: gaps.length,
      openIncidents, totalIncidents: incidents.length,
      screenings30d: recentScreenings, totalScreenings: screenings.length,
      avgRisk, totalCustomers: customers.length,
      completedTraining, totalTraining,
      thresholdAlerts: thresholdAlerts.length,
      auditEvents: auditTrail.length,
      critCustomers: customers.filter(c => c.risk?.level === 'CRITICAL').length,
      highCustomers: customers.filter(c => c.risk?.level === 'HIGH').length,
      medCustomers: customers.filter(c => c.risk?.level === 'MEDIUM').length,
      lowCustomers: customers.filter(c => c.risk?.level === 'LOW' || !c.risk?.level).length
    });

    save(ANALYTICS_SNAPSHOT_KEY, snaps.slice(-MAX_SNAPSHOTS));
  }

  // ── Chart instances cache ──
  let charts = {};

  function destroyCharts() {
    Object.values(charts).forEach(c => { try { c.destroy(); } catch (_) {} });
    charts = {};
  }

  // ── Chart color palette matching app theme ──
  const C = {
    gold: '#C9A84C', goldLight: '#E8C97A', goldDim: 'rgba(201,168,76,0.15)',
    red: '#D94F4F', redDim: 'rgba(217,79,79,0.4)',
    green: '#3DA876', greenDim: 'rgba(61,168,118,0.4)',
    amber: '#E8A030', amberDim: 'rgba(232,160,48,0.4)',
    blue: '#4A8FC1', blueDim: 'rgba(74,143,193,0.4)',
    muted: '#7A7870', surface: '#161719', surface2: '#1E2023',
    text: '#F0EDE8', border: 'rgba(255,255,255,0.07)'
  };

  // ── Chart.js global defaults ──
  function applyChartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.color = C.muted;
    Chart.defaults.borderColor = C.border;
    Chart.defaults.font.family = "'Montserrat', sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.pointStyleWidth = 10;
    Chart.defaults.plugins.tooltip.backgroundColor = C.surface2;
    Chart.defaults.plugins.tooltip.borderColor = C.border;
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.titleFont = { family: "'Montserrat', sans-serif", size: 11 };
    Chart.defaults.plugins.tooltip.bodyFont = { family: "'Montserrat', sans-serif", size: 12 };
  }

  // ══════════════════════════════════════════════════════════════
  // CHART BUILDERS
  // ══════════════════════════════════════════════════════════════

  function buildComplianceTrendChart(canvas, snapshots) {
    const labels = snapshots.map(s => s.date);
    charts.complianceTrend = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Open Gaps', data: snapshots.map(s => s.openGaps), borderColor: C.red, backgroundColor: C.redDim, tension: 0.3, fill: false, pointRadius: 2 },
          { label: 'Closed Gaps', data: snapshots.map(s => s.closedGaps), borderColor: C.green, backgroundColor: C.greenDim, tension: 0.3, fill: false, pointRadius: 2 },
          { label: 'Open Incidents', data: snapshots.map(s => s.openIncidents), borderColor: C.amber, backgroundColor: C.amberDim, tension: 0.3, fill: false, pointRadius: 2 },
          { label: 'Avg Risk Score', data: snapshots.map(s => s.avgRisk), borderColor: C.blue, backgroundColor: C.blueDim, tension: 0.3, fill: false, pointRadius: 2, yAxisID: 'y1' }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: { beginAtZero: true, grid: { color: C.border }, title: { display: true, text: 'Count' } },
          y1: { position: 'right', beginAtZero: true, max: 100, grid: { drawOnChartArea: false }, title: { display: true, text: 'Risk Score' } },
          x: { grid: { color: C.border }, ticks: { maxRotation: 45 } }
        },
        plugins: { legend: { position: 'top' } }
      }
    });
  }

  function buildRiskDistributionChart(canvas, snapshot) {
    charts.riskDist = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Critical', 'High', 'Medium', 'Low'],
        datasets: [{
          data: [snapshot.critCustomers || 0, snapshot.highCustomers || 0, snapshot.medCustomers || 0, snapshot.lowCustomers || 0],
          backgroundColor: [C.red, C.amber, C.blue, C.green],
          borderColor: C.surface, borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw} customer${ctx.raw !== 1 ? 's' : ''}` } }
        }
      }
    });
  }

  function buildGapSeverityChart(canvas, snapshot) {
    charts.gapSeverity = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: ['Critical', 'High', 'Medium', 'Low'],
        datasets: [{
          label: 'Open Gaps by Severity',
          data: [snapshot.critGaps || 0, snapshot.highGaps || 0, snapshot.medGaps || 0, snapshot.lowGaps || 0],
          backgroundColor: [C.redDim, C.amberDim, C.blueDim, C.greenDim],
          borderColor: [C.red, C.amber, C.blue, C.green],
          borderWidth: 1, borderRadius: 6
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, grid: { color: C.border }, ticks: { stepSize: 1 } },
          x: { grid: { display: false } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }

  function buildScreeningActivityChart(canvas, snapshots) {
    const labels = snapshots.map(s => s.date);
    charts.screeningActivity = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Screenings (30d rolling)',
          data: snapshots.map(s => s.screenings30d),
          backgroundColor: C.goldDim, borderColor: C.gold, borderWidth: 1, borderRadius: 4
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, grid: { color: C.border }, ticks: { stepSize: 1 } },
          x: { grid: { display: false }, ticks: { maxRotation: 45 } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }

  function buildTrainingProgressChart(canvas, snapshot) {
    const completed = snapshot.completedTraining || 0;
    const pending = (snapshot.totalTraining || 0) - completed;
    charts.trainingProgress = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Completed', 'Pending'],
        datasets: [{
          data: [completed, Math.max(0, pending)],
          backgroundColor: [C.green, C.surface2],
          borderColor: C.surface, borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw} record${ctx.raw !== 1 ? 's' : ''}` } }
        }
      }
    });
  }

  function buildIncidentTrendChart(canvas, snapshots) {
    charts.incidentTrend = new Chart(canvas, {
      type: 'line',
      data: {
        labels: snapshots.map(s => s.date),
        datasets: [
          { label: 'Open Incidents', data: snapshots.map(s => s.openIncidents), borderColor: C.red, backgroundColor: 'rgba(217,79,79,0.1)', tension: 0.3, fill: true, pointRadius: 2 },
          { label: 'Total Incidents', data: snapshots.map(s => s.totalIncidents), borderColor: C.muted, backgroundColor: 'transparent', tension: 0.3, fill: false, pointRadius: 2, borderDash: [5, 3] }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, grid: { color: C.border }, ticks: { stepSize: 1 } },
          x: { grid: { color: C.border }, ticks: { maxRotation: 45 } }
        },
        plugins: { legend: { position: 'top' } }
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  // ASANA ANALYTICS
  // ══════════════════════════════════════════════════════════════

  function getAsanaTaskStats() {
    const tasks = parse('fgl_asana_tasks', []);
    if (!tasks.length) return null;
    const completed = tasks.filter(t => t.completed).length;
    const overdue = tasks.filter(t => !t.completed && t.due_on && new Date(t.due_on) < new Date()).length;
    const inProgress = tasks.filter(t => !t.completed && !t.due_on || (t.due_on && new Date(t.due_on) >= new Date())).length;

    // Group by section/tag
    const bySection = {};
    tasks.forEach(t => {
      const section = (t.memberships && t.memberships[0]?.section?.name) || t.section || 'Unassigned';
      if (!bySection[section]) bySection[section] = { total: 0, completed: 0, overdue: 0 };
      bySection[section].total++;
      if (t.completed) bySection[section].completed++;
      else if (t.due_on && new Date(t.due_on) < new Date()) bySection[section].overdue++;
    });

    return { total: tasks.length, completed, overdue, inProgress, bySection };
  }

  function buildAsanaChart(canvas, stats) {
    if (!stats) return;
    charts.asanaTasks = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Completed', 'In Progress', 'Overdue'],
        datasets: [{
          data: [stats.completed, stats.inProgress, stats.overdue],
          backgroundColor: [C.green, C.blue, C.red],
          borderColor: C.surface, borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '60%',
        plugins: { legend: { position: 'bottom' } }
      }
    });
  }

  function buildAsanaSectionChart(canvas, stats) {
    if (!stats) return;
    const sections = Object.keys(stats.bySection);
    const data = sections.map(s => stats.bySection[s]);
    charts.asanaSections = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: sections.map(s => s.length > 20 ? s.slice(0, 18) + '…' : s),
        datasets: [
          { label: 'Completed', data: data.map(d => d.completed), backgroundColor: C.greenDim, borderColor: C.green, borderWidth: 1, borderRadius: 4 },
          { label: 'Overdue', data: data.map(d => d.overdue), backgroundColor: C.redDim, borderColor: C.red, borderWidth: 1, borderRadius: 4 },
          { label: 'Remaining', data: data.map(d => d.total - d.completed - d.overdue), backgroundColor: C.blueDim, borderColor: C.blue, borderWidth: 1, borderRadius: 4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        indexAxis: 'y',
        scales: {
          x: { stacked: true, beginAtZero: true, grid: { color: C.border }, ticks: { stepSize: 1 } },
          y: { stacked: true, grid: { display: false } }
        },
        plugins: { legend: { position: 'top' } }
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  // KPI CARDS
  // ══════════════════════════════════════════════════════════════

  function kpiCard(label, value, color, subtitle, icon) {
    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:1rem;text-align:center">
      <div style="font-size:11px;color:var(--muted);letter-spacing:1px;text-transform:uppercase;font-family:'Montserrat',sans-serif;margin-bottom:6px">${icon ? icon + ' ' : ''}${label}</div>
      <div style="font-size:28px;font-weight:700;color:${color};font-family:'Cinzel',serif">${value}</div>
      ${subtitle ? `<div style="font-size:11px;color:var(--muted);margin-top:4px">${subtitle}</div>` : ''}
    </div>`;
  }

  function trendIndicator(current, previous) {
    if (previous === undefined || previous === null) return '';
    const diff = current - previous;
    if (diff === 0) return '<span style="color:var(--muted)">→ no change</span>';
    const arrow = diff > 0 ? '↑' : '↓';
    const color = diff > 0 ? 'var(--red)' : 'var(--green)';
    return `<span style="color:${color}">${arrow} ${Math.abs(diff)}</span>`;
  }

  // ══════════════════════════════════════════════════════════════
  // EXPORT FUNCTIONS
  // ══════════════════════════════════════════════════════════════

  function exportAnalyticsCSV() {
    const snaps = parse(ANALYTICS_SNAPSHOT_KEY, []);
    if (!snaps.length) { if (typeof toast === 'function') toast('No analytics data to export', 'error'); return; }
    const headers = Object.keys(snaps[0]);
    const csv = [headers.join(',')].concat(snaps.map(s => headers.map(h => JSON.stringify(s[h] ?? '')).join(','))).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Compliance_Analytics_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    if (typeof toast === 'function') toast('Analytics CSV exported', 'success');
    if (typeof logAudit === 'function') logAudit('analytics_export', 'CSV analytics data exported');
  }

  function exportChartPNG(chartKey, filename) {
    if (!charts[chartKey]) return;
    const a = document.createElement('a');
    a.href = charts[chartKey].toBase64Image();
    a.download = filename || `chart_${chartKey}_${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
    if (typeof toast === 'function') toast('Chart exported as PNG', 'success');
  }

  // ══════════════════════════════════════════════════════════════
  // SYNC TO ASANA: push analytics summary as task/comment
  // ══════════════════════════════════════════════════════════════

  async function syncAnalyticsSummaryToAsana() {
    const proxy = window.PROXY_URL;
    const asanaToken = window.ASANA_TOKEN;
    if (!proxy && !asanaToken) { if (typeof toast === 'function') toast('Asana not connected. Add your Asana Token or Proxy URL in Settings first.', 'error', 4000); return; }

    const snap = getCurrentSnapshot();
    const summary = [
      `📊 Compliance Analytics Summary — ${new Date().toLocaleDateString('en-AE', { timeZone: 'Asia/Dubai' })}`,
      '',
      `Open Gaps: ${snap.openGaps} (Crit: ${snap.critGaps}, High: ${snap.highGaps})`,
      `Closed Gaps: ${snap.closedGaps}`,
      `Open Incidents: ${snap.openIncidents} / ${snap.totalIncidents} total`,
      `Screenings (30d): ${snap.screenings30d}`,
      `Avg Risk Score: ${snap.avgRisk}/100`,
      `Customers: ${snap.totalCustomers} (Crit: ${snap.critCustomers}, High: ${snap.highCustomers})`,
      `Training: ${snap.completedTraining}/${snap.totalTraining} completed`,
      `Threshold Alerts: ${snap.thresholdAlerts}`,
      '',
      `Generated by Hawkeye Sterling V2 v2.5`
    ].join('\n');

    try {
      const resolver = typeof AsanaProjectResolver !== 'undefined' ? AsanaProjectResolver : null;
      const asanaProjectId = resolver ? resolver.resolveProject('compliance') : (localStorage.getItem('asanaProjectId') || '1213759768596515');
      const taskBody = JSON.stringify({
        data: {
          name: `📊 Analytics Report — ${new Date().toISOString().slice(0, 10)}`,
          notes: summary,
          projects: [asanaProjectId],
          due_on: new Date().toISOString().slice(0, 10)
        }
      });
      const res = typeof asanaFetch === 'function'
        ? await asanaFetch('/tasks', { method: 'POST', body: taskBody })
        : await fetch(proxy + '/asana/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: taskBody });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      if (typeof toast === 'function') toast('Analytics summary synced to Asana', 'success');
      if (typeof logAudit === 'function') logAudit('analytics_asana_sync', 'Analytics summary pushed to Asana');
    } catch (e) {
      if (typeof toast === 'function') toast(`Asana sync failed: ${e.message}`, 'error');
    }
  }

  // ── Get current snapshot without saving ──
  function getCurrentSnapshot() {
    const gaps = parse('fgl_gaps_v2', []);
    const incidents = parse('fgl_incidents', []);
    const screenings = parse('fgl_screenings', []);
    const customers = parse('fgl_onboarding', []);
    const training = parse('fgl_employee_training', []);
    const thresholdAlerts = parse('fgl_threshold_alerts', []);

    const now = new Date();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

    return {
      date: new Date().toISOString().slice(0, 10),
      openGaps: gaps.filter(g => g.status !== 'closed' && g.status !== 'resolved').length,
      closedGaps: gaps.filter(g => g.status === 'closed' || g.status === 'resolved').length,
      critGaps: gaps.filter(g => g.severity === 'critical' && g.status !== 'closed' && g.status !== 'resolved').length,
      highGaps: gaps.filter(g => g.severity === 'high' && g.status !== 'closed' && g.status !== 'resolved').length,
      medGaps: gaps.filter(g => g.severity === 'medium' && g.status !== 'closed' && g.status !== 'resolved').length,
      lowGaps: gaps.filter(g => g.severity === 'low' && g.status !== 'closed' && g.status !== 'resolved').length,
      totalGaps: gaps.length,
      openIncidents: incidents.filter(i => i.status === 'open').length,
      totalIncidents: incidents.length,
      screenings30d: screenings.filter(s => new Date(s.date) > thirtyDaysAgo).length,
      totalScreenings: screenings.length,
      avgRisk: customers.length ? Math.round(customers.reduce((s, c) => s + (c.risk?.score || 0), 0) / customers.length) : 0,
      totalCustomers: customers.length,
      completedTraining: (training || []).filter(t => t.status === 'completed' || t.completed).length,
      totalTraining: (training || []).length,
      thresholdAlerts: (thresholdAlerts || []).length,
      critCustomers: customers.filter(c => c.risk?.level === 'CRITICAL').length,
      highCustomers: customers.filter(c => c.risk?.level === 'HIGH').length,
      medCustomers: customers.filter(c => c.risk?.level === 'MEDIUM').length,
      lowCustomers: customers.filter(c => c.risk?.level === 'LOW' || !c.risk?.level).length
    };
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER FULL ANALYTICS TAB
  // ══════════════════════════════════════════════════════════════

  function renderAnalyticsTab() {
    if (!window.Chart) {
      return `<div class="card"><p style="color:var(--red);font-size:13px">Chart.js library not loaded. Please check your internet connection and refresh.</p></div>`;
    }

    applyChartDefaults();
    captureSnapshot();

    const snaps = parse(ANALYTICS_SNAPSHOT_KEY, []);
    const current = snaps.length ? snaps[snaps.length - 1] : getCurrentSnapshot();
    const prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;
    const asanaStats = getAsanaTaskStats();

    const completionRate = current.totalGaps ? Math.round((current.closedGaps / current.totalGaps) * 100) : 0;
    const trainingRate = current.totalTraining ? Math.round((current.completedTraining / current.totalTraining) * 100) : 0;

    let html = `
      <div class="card">
        <div class="top-bar" style="margin-bottom:10px">
          <span class="sec-title" style="margin:0;border:none;padding:0">Analytics Dashboard</span>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-sm btn-blue" onclick="AnalyticsDashboard.refresh()">Refresh</button>
            <button class="btn btn-sm btn-green" onclick="AnalyticsDashboard.exportCSV()">Export CSV</button>
            <button class="btn btn-sm btn-green" onclick="AnalyticsDashboard.syncToAsana()" title="Push analytics summary to Asana">Sync to Asana</button>
          </div>
        </div>
        <p style="font-size:12px;color:var(--muted);margin-bottom:12px">Visual compliance analytics with trend tracking. Snapshots are captured daily for historical analysis.</p>
      </div>

      <!-- KPI Summary Cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px">
        ${kpiCard('Open Gaps', current.openGaps, 'var(--red)', trendIndicator(current.openGaps, prev?.openGaps), '🔴')}
        ${kpiCard('Closed Gaps', current.closedGaps, 'var(--green)', `${completionRate}% closure rate`, '✅')}
        ${kpiCard('Open Incidents', current.openIncidents, 'var(--amber)', trendIndicator(current.openIncidents, prev?.openIncidents), '⚠️')}
        ${kpiCard('Screenings (30d)', current.screenings30d, 'var(--gold)', trendIndicator(current.screenings30d, prev?.screenings30d), '🔍')}
        ${kpiCard('Avg Risk', current.avgRisk + '/100', current.avgRisk > 60 ? 'var(--red)' : current.avgRisk > 40 ? 'var(--amber)' : 'var(--green)', trendIndicator(current.avgRisk, prev?.avgRisk), '📊')}
        ${kpiCard('Training', trainingRate + '%', trainingRate >= 80 ? 'var(--green)' : trainingRate >= 50 ? 'var(--amber)' : 'var(--red)', `${current.completedTraining}/${current.totalTraining}`, '🎓')}
      </div>

      <!-- Compliance Trend Chart -->
      <div class="card">
        <div class="top-bar" style="margin-bottom:10px">
          <span class="sec-title" style="margin:0;border:none;padding:0">Compliance Trend</span>
          <button class="btn btn-sm btn-green" onclick="AnalyticsDashboard.exportChart('complianceTrend','Compliance_Trend.png')">Export PNG</button>
        </div>
        <div style="height:300px;position:relative"><canvas id="chartComplianceTrend"></canvas></div>
        ${snaps.length < 2 ? '<p style="font-size:11px;color:var(--muted);margin-top:8px">Trend data will accumulate as daily snapshots are captured. Visit this tab daily to build history.</p>' : ''}
      </div>

      <!-- Risk Distribution + Gap Severity (side by side) -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="card">
          <div class="top-bar" style="margin-bottom:10px">
            <span class="sec-title" style="margin:0;border:none;padding:0">Customer Risk Distribution</span>
            <button class="btn btn-sm btn-green" onclick="AnalyticsDashboard.exportChart('riskDist','Risk_Distribution.png')">PNG</button>
          </div>
          <div style="height:250px;position:relative"><canvas id="chartRiskDist"></canvas></div>
        </div>
        <div class="card">
          <div class="top-bar" style="margin-bottom:10px">
            <span class="sec-title" style="margin:0;border:none;padding:0">Open Gaps by Severity</span>
            <button class="btn btn-sm btn-green" onclick="AnalyticsDashboard.exportChart('gapSeverity','Gap_Severity.png')">PNG</button>
          </div>
          <div style="height:250px;position:relative"><canvas id="chartGapSeverity"></canvas></div>
        </div>
      </div>

      <!-- Screening Activity + Incident Trend -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
        <div class="card">
          <div class="top-bar" style="margin-bottom:10px">
            <span class="sec-title" style="margin:0;border:none;padding:0">Screening Activity</span>
            <button class="btn btn-sm btn-green" onclick="AnalyticsDashboard.exportChart('screeningActivity','Screening_Activity.png')">PNG</button>
          </div>
          <div style="height:250px;position:relative"><canvas id="chartScreeningActivity"></canvas></div>
        </div>
        <div class="card">
          <div class="top-bar" style="margin-bottom:10px">
            <span class="sec-title" style="margin:0;border:none;padding:0">Incident Trend</span>
            <button class="btn btn-sm btn-green" onclick="AnalyticsDashboard.exportChart('incidentTrend','Incident_Trend.png')">PNG</button>
          </div>
          <div style="height:250px;position:relative"><canvas id="chartIncidentTrend"></canvas></div>
        </div>
      </div>

      <!-- Training Progress + Asana Task Overview -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
        <div class="card">
          <div class="top-bar" style="margin-bottom:10px">
            <span class="sec-title" style="margin:0;border:none;padding:0">Training Completion</span>
            <button class="btn btn-sm btn-green" onclick="AnalyticsDashboard.exportChart('trainingProgress','Training_Progress.png')">PNG</button>
          </div>
          <div style="height:250px;position:relative"><canvas id="chartTrainingProgress"></canvas></div>
        </div>
        <div class="card">
          <div class="top-bar" style="margin-bottom:10px">
            <span class="sec-title" style="margin:0;border:none;padding:0">Asana Task Overview</span>
            ${asanaStats ? `<button class="btn btn-sm btn-green" onclick="AnalyticsDashboard.exportChart('asanaTasks','Asana_Tasks.png')">PNG</button>` : ''}
          </div>
          ${asanaStats ? `<div style="height:250px;position:relative"><canvas id="chartAsanaTasks"></canvas></div>` : '<p style="font-size:12px;color:var(--muted);padding:20px 0">No Asana tasks synced yet. Connect Asana in Settings and sync tasks to see analytics here.</p>'}
        </div>
      </div>

      ${asanaStats ? `
      <!-- Asana Section Breakdown -->
      <div class="card" style="margin-top:12px">
        <div class="top-bar" style="margin-bottom:10px">
          <span class="sec-title" style="margin:0;border:none;padding:0">Asana Tasks by Section</span>
          <button class="btn btn-sm btn-green" onclick="AnalyticsDashboard.exportChart('asanaSections','Asana_Sections.png')">PNG</button>
        </div>
        <div style="height:${Math.max(200, Object.keys(asanaStats.bySection).length * 40)}px;position:relative"><canvas id="chartAsanaSections"></canvas></div>
        <div style="margin-top:12px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:12px">
          <div style="padding:8px;background:var(--surface2);border-radius:3px;text-align:center"><span style="color:var(--green);font-weight:600">${asanaStats.completed}</span> <span style="color:var(--muted)">Completed</span></div>
          <div style="padding:8px;background:var(--surface2);border-radius:3px;text-align:center"><span style="color:var(--blue);font-weight:600">${asanaStats.inProgress}</span> <span style="color:var(--muted)">In Progress</span></div>
          <div style="padding:8px;background:var(--surface2);border-radius:3px;text-align:center"><span style="color:var(--red);font-weight:600">${asanaStats.overdue}</span> <span style="color:var(--muted)">Overdue</span></div>
        </div>
      </div>` : ''}

      <!-- Data Info -->
      <div class="card" style="margin-top:12px">
        <span class="sec-title">Analytics Data</span>
        <p style="font-size:12px;color:var(--muted)">
          ${snaps.length} daily snapshot${snaps.length !== 1 ? 's' : ''} recorded
          ${snaps.length ? ` (${snaps[0].date} → ${snaps[snaps.length - 1].date})` : ''}.
          Snapshots are captured each time you visit the Analytics tab.
        </p>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-sm btn-red" onclick="if(confirm('Clear all analytics history? This cannot be undone.')){localStorage.removeItem('${ANALYTICS_SNAPSHOT_KEY}');AnalyticsDashboard.refresh();}" >Clear History</button>
        </div>
      </div>`;

    return html;
  }

  // ── Post-render: initialize charts after DOM is ready ──
  function initCharts() {
    if (!window.Chart) return;

    destroyCharts();

    const snaps = parse(ANALYTICS_SNAPSHOT_KEY, []);
    const current = snaps.length ? snaps[snaps.length - 1] : getCurrentSnapshot();
    const asanaStats = getAsanaTaskStats();

    // Use at least current snapshot for charts that need data points
    const chartSnaps = snaps.length ? snaps : [current];

    const trendCanvas = document.getElementById('chartComplianceTrend');
    if (trendCanvas) buildComplianceTrendChart(trendCanvas, chartSnaps);

    const riskCanvas = document.getElementById('chartRiskDist');
    if (riskCanvas) buildRiskDistributionChart(riskCanvas, current);

    const gapCanvas = document.getElementById('chartGapSeverity');
    if (gapCanvas) buildGapSeverityChart(gapCanvas, current);

    const screenCanvas = document.getElementById('chartScreeningActivity');
    if (screenCanvas) buildScreeningActivityChart(screenCanvas, chartSnaps);

    const incidentCanvas = document.getElementById('chartIncidentTrend');
    if (incidentCanvas) buildIncidentTrendChart(incidentCanvas, chartSnaps);

    const trainingCanvas = document.getElementById('chartTrainingProgress');
    if (trainingCanvas) buildTrainingProgressChart(trainingCanvas, current);

    if (asanaStats) {
      const asanaCanvas = document.getElementById('chartAsanaTasks');
      if (asanaCanvas) buildAsanaChart(asanaCanvas, asanaStats);

      const asanaSectCanvas = document.getElementById('chartAsanaSections');
      if (asanaSectCanvas) buildAsanaSectionChart(asanaSectCanvas, asanaStats);
    }
  }

  function refresh() {
    const el = document.getElementById('tab-analytics');
    if (el) {
      el.innerHTML = renderAnalyticsTab();
      setTimeout(initCharts, 50);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════════

  window.AnalyticsDashboard = {
    renderAnalyticsTab,
    initCharts,
    refresh,
    captureSnapshot,
    getCurrentSnapshot,
    exportCSV: exportAnalyticsCSV,
    exportChart: exportChartPNG,
    syncToAsana: syncAnalyticsSummaryToAsana,
    getAsanaTaskStats
  };

})();
