/**
 * Compliance Export Pipeline v1.0
 * Inspired by AWS Security Hub Compliance Analyzer (awslabs/security-hub-compliance-analyzer)
 * 4-stage pipeline: Extract > Condense > Analyze > Package
 *
 * Generates compliance artifact bundles (HTML executive report + CSV + JSON)
 * as downloadable ZIP files for MoE inspections, LBMA audits, and internal reviews.
 */
const CompliancePipeline = (function () {
  'use strict';

  const PIPELINE_KEY = 'fgl_pipeline_history';
  const MAX_HISTORY = 50;

  function getHistory() {
    try { return JSON.parse(localStorage.getItem(PIPELINE_KEY) || '[]'); } catch (_) { return []; }
  }
  function saveHistory(arr) {
    localStorage.setItem(PIPELINE_KEY, JSON.stringify(arr.slice(0, MAX_HISTORY)));
  }

  // ─── STAGE 1: EXTRACT ────────────────────────────────────────
  // Pull all compliance data from localStorage into a unified raw dataset
  function extract() {
    var raw = {};

    // Companies & active entity
    raw.companies = safeParse('fgl_companies', []);
    raw.activeCompanyIdx = Number(localStorage.getItem('fgl_active_company') || '0');
    raw.activeCompany = raw.companies[raw.activeCompanyIdx] || { name: 'Unknown Entity' };

    // Shipments / transactions
    raw.shipments = safeParse('fgl_shipments', []);

    // Compliance operations (cases, approvals, screenings, audit trail)
    var ops = safeParse('fgl_compliance_ops', {});
    raw.cases = ops.cases || [];
    raw.approvals = ops.approvals || [];
    raw.screenings = (ops.screenings || []).slice(0, 100);
    raw.auditTrail = ops.auditTrail || [];
    raw.kycReviews = ops.kycReviews || [];
    raw.regulatoryChanges = ops.regulatoryChanges || [];

    // Reports history
    raw.reportHistory = safeParse('fgl_report_history', []);

    // goAML filings
    raw.goamlReports = safeParse('fgl_goaml_reports', []);

    // Threshold alerts & CTR queue
    raw.thresholdAlerts = safeParse('fgl_threshold_alerts', []);
    raw.ctrQueue = safeParse('fgl_ctr_queue', []);

    // Gap register
    raw.gaps = safeParse('fgl_gap_register', []);

    // Training records
    raw.training = safeParse('fgl_training', []);

    // Circulars & meetings
    raw.circulars = safeParse('fgl_circulars', []);
    raw.meetings = safeParse('fgl_meetings', []);

    raw.extractedAt = new Date().toISOString();
    raw.extractedBy = 'CompliancePipeline v1.0';

    return raw;
  }

  // ─── STAGE 2: CONDENSE ───────────────────────────────────────
  // Transform raw data into summary tables and condensed records
  function condense(raw) {
    var summary = {};
    var now = new Date();

    // Entity info
    summary.entity = raw.activeCompany.name || 'Unknown';
    summary.reportDate = formatDate(now);
    summary.periodStart = formatDate(new Date(now.getFullYear(), now.getMonth() - 3, 1));
    summary.periodEnd = formatDate(now);

    // Cases summary
    var openCases = raw.cases.filter(function (c) { return c.status !== 'CLOSED'; });
    var closedCases = raw.cases.filter(function (c) { return c.status === 'CLOSED'; });
    summary.cases = {
      total: raw.cases.length,
      open: openCases.length,
      closed: closedCases.length,
      escalated: raw.cases.filter(function (c) { return c.disposition === 'ESCALATED'; }).length,
      bySeverity: countBy(raw.cases, 'severity')
    };

    // Screenings summary
    summary.screenings = {
      total: raw.screenings.length,
      matches: raw.screenings.filter(function (s) { return s.matchCount > 0 || s.result === 'MATCH'; }).length,
      clean: raw.screenings.filter(function (s) { return s.matchCount === 0 || s.result === 'CLEAR'; }).length,
      latest: raw.screenings.slice(0, 10).map(function (s) {
        return { date: s.date || s.ts, entity: s.entity || s.name, result: s.result || (s.matchCount > 0 ? 'MATCH' : 'CLEAR') };
      })
    };

    // Filings summary
    summary.filings = {
      totalGoAML: raw.goamlReports.length,
      totalReports: raw.reportHistory.length,
      byType: countBy(raw.goamlReports, 'type'),
      ctrPending: raw.ctrQueue.filter(function (c) { return c.status !== 'FILED'; }).length,
      ctrFiled: raw.ctrQueue.filter(function (c) { return c.status === 'FILED'; }).length
    };

    // Threshold alerts
    summary.thresholds = {
      total: raw.thresholdAlerts.length,
      breaches: raw.thresholdAlerts.filter(function (a) { return a.type === 'BREACH' || a.severity === 'high'; }).length,
      structuring: raw.thresholdAlerts.filter(function (a) { return a.type === 'STRUCTURING'; }).length
    };

    // Gaps
    summary.gaps = {
      total: raw.gaps.length,
      open: raw.gaps.filter(function (g) { return g.status !== 'closed' && g.status !== 'remediated'; }).length,
      critical: raw.gaps.filter(function (g) { return g.severity === 'critical' || g.priority === 'critical'; }).length
    };

    // Audit trail integrity
    summary.auditTrail = {
      entries: raw.auditTrail.length,
      latestAction: raw.auditTrail.length > 0 ? raw.auditTrail[raw.auditTrail.length - 1].action : 'N/A'
    };

    // Training
    summary.training = {
      total: raw.training.length,
      completed: raw.training.filter(function (t) { return t.status === 'completed' || t.completed; }).length
    };

    // Transaction records as CSV rows
    summary.transactionRows = raw.shipments.map(function (s) {
      return {
        date: s.date || '',
        type: s.type || s.transactionType || '',
        counterparty: s.counterparty || s.supplier || s.customer || '',
        amount: s.amount || s.value || '',
        currency: s.currency || 'AED',
        origin: s.origin || s.country || '',
        status: s.status || ''
      };
    });

    summary.condensedAt = new Date().toISOString();
    return summary;
  }

  // ─── STAGE 3: ANALYZE ────────────────────────────────────────
  // Score compliance, determine RAG status, identify critical findings
  function analyze(summary) {
    var analysis = {};
    var findings = [];
    var score = 100;

    // 1. Case management scoring
    if (summary.cases.open > 10) {
      score -= 15;
      findings.push({ severity: 'high', area: 'Case Management', finding: summary.cases.open + ' cases remain open — review and resolve backlog', ref: 'FDL Art.20-21' });
    } else if (summary.cases.open > 5) {
      score -= 8;
      findings.push({ severity: 'medium', area: 'Case Management', finding: summary.cases.open + ' open cases require attention', ref: 'FDL Art.20-21' });
    }

    // 2. Screening coverage
    if (summary.screenings.total === 0) {
      score -= 20;
      findings.push({ severity: 'critical', area: 'Sanctions Screening', finding: 'No screening records found — all customers must be screened', ref: 'FDL Art.35, FATF Rec 22/23' });
    } else if (summary.screenings.matches > 0) {
      findings.push({ severity: 'high', area: 'Sanctions Screening', finding: summary.screenings.matches + ' potential sanctions matches require review', ref: 'Cabinet Res 74/2020 Art.4-7' });
    }

    // 3. Filing compliance
    if (summary.filings.ctrPending > 0) {
      score -= 10;
      findings.push({ severity: 'high', area: 'FIU Reporting', finding: summary.filings.ctrPending + ' CTR filings pending submission via goAML', ref: 'MoE Circular 08/AML/2021' });
    }

    // 4. Threshold monitoring
    if (summary.thresholds.structuring > 0) {
      score -= 15;
      findings.push({ severity: 'critical', area: 'Transaction Monitoring', finding: summary.thresholds.structuring + ' structuring patterns detected — investigate immediately', ref: 'FDL Art.15-16' });
    }
    if (summary.thresholds.breaches > 0) {
      score -= 5;
      findings.push({ severity: 'medium', area: 'Transaction Monitoring', finding: summary.thresholds.breaches + ' threshold breaches flagged', ref: 'AED 55K DPMS threshold' });
    }

    // 5. Gap register
    if (summary.gaps.critical > 0) {
      score -= 20;
      findings.push({ severity: 'critical', area: 'Gap Register', finding: summary.gaps.critical + ' critical compliance gaps unresolved', ref: 'Cabinet Res 134/2025 Art.19' });
    } else if (summary.gaps.open > 0) {
      score -= 5;
      findings.push({ severity: 'low', area: 'Gap Register', finding: summary.gaps.open + ' gaps in remediation', ref: 'Cabinet Res 134/2025 Art.19' });
    }

    // 6. Audit trail
    if (summary.auditTrail.entries === 0) {
      score -= 10;
      findings.push({ severity: 'high', area: 'Audit Trail', finding: 'No audit trail entries — all actions must be logged', ref: 'FDL Art.24' });
    }

    // 7. Training
    if (summary.training.total > 0) {
      var pct = Math.round((summary.training.completed / summary.training.total) * 100);
      if (pct < 80) {
        score -= 10;
        findings.push({ severity: 'medium', area: 'Training', finding: 'Training completion at ' + pct + '% — target is 100%', ref: 'Cabinet Res 134/2025' });
      }
    }

    // Clamp score
    score = Math.max(0, Math.min(100, score));

    // Determine RAG
    var rag;
    if (score >= 80) rag = 'GREEN';
    else if (score >= 60) rag = 'AMBER';
    else rag = 'RED';

    analysis.complianceScore = score;
    analysis.ragStatus = rag;
    analysis.findings = findings.sort(function (a, b) {
      var order = { critical: 0, high: 1, medium: 2, low: 3 };
      return (order[a.severity] || 4) - (order[b.severity] || 4);
    });
    analysis.summary = summary;
    analysis.criticalCount = findings.filter(function (f) { return f.severity === 'critical'; }).length;
    analysis.highCount = findings.filter(function (f) { return f.severity === 'high'; }).length;
    analysis.mediumCount = findings.filter(function (f) { return f.severity === 'medium'; }).length;
    analysis.lowCount = findings.filter(function (f) { return f.severity === 'low'; }).length;
    analysis.analyzedAt = new Date().toISOString();

    return analysis;
  }

  // ─── STAGE 4: PACKAGE ────────────────────────────────────────
  // Bundle analysis into downloadable ZIP (HTML report + CSV + JSON)
  function packageArtifacts(analysis) {
    if (typeof JSZip === 'undefined') {
      toast('JSZip library not loaded — falling back to individual downloads', 'warn');
      return fallbackDownload(analysis);
    }

    var zip = new JSZip();
    var ts = new Date().toISOString().slice(0, 10);
    var entity = sanitizeFilename(analysis.summary.entity);
    var folderName = entity + '_Compliance_Pack_' + ts;
    var folder = zip.folder(folderName);

    // 1. Executive HTML Report
    folder.file('Executive_Report.html', generateHTMLReport(analysis));

    // 2. Findings CSV
    folder.file('Findings.csv', generateFindingsCSV(analysis));

    // 3. Full Analysis JSON
    folder.file('Analysis.json', JSON.stringify(analysis, null, 2));

    // 4. Transaction Records CSV
    if (analysis.summary.transactionRows.length > 0) {
      folder.file('Transactions.csv', generateTransactionsCSV(analysis.summary.transactionRows));
    }

    // 5. Screening Summary CSV
    if (analysis.summary.screenings.latest.length > 0) {
      folder.file('Screenings.csv', generateScreeningsCSV(analysis.summary.screenings.latest));
    }

    // 6. Compliance Score Card (JSON)
    folder.file('Scorecard.json', JSON.stringify({
      entity: analysis.summary.entity,
      period: analysis.summary.periodStart + ' to ' + analysis.summary.periodEnd,
      score: analysis.complianceScore,
      rag: analysis.ragStatus,
      critical: analysis.criticalCount,
      high: analysis.highCount,
      medium: analysis.mediumCount,
      low: analysis.lowCount,
      generatedAt: analysis.analyzedAt
    }, null, 2));

    // Generate ZIP and trigger download
    zip.generateAsync({ type: 'blob' }).then(function (blob) {
      var filename = folderName + '.zip';
      downloadBlob(blob, filename, 'application/zip');
      toast('Compliance pack downloaded: ' + filename, 'ok');

      // Record in history
      var history = getHistory();
      history.unshift({
        date: new Date().toISOString(),
        entity: analysis.summary.entity,
        score: analysis.complianceScore,
        rag: analysis.ragStatus,
        findings: analysis.findings.length,
        filename: filename
      });
      saveHistory(history);
    }).catch(function (err) {
      toast('ZIP generation failed: ' + err.message, 'error');
      fallbackDownload(analysis);
    });

    return analysis;
  }

  // Fallback: download files individually if JSZip unavailable
  function fallbackDownload(analysis) {
    downloadBlob(
      new Blob([generateHTMLReport(analysis)], { type: 'text/html' }),
      'Compliance_Executive_Report.html', 'text/html'
    );
    downloadBlob(
      new Blob([generateFindingsCSV(analysis)], { type: 'text/csv' }),
      'Compliance_Findings.csv', 'text/csv'
    );
    downloadBlob(
      new Blob([JSON.stringify(analysis, null, 2)], { type: 'application/json' }),
      'Compliance_Analysis.json', 'application/json'
    );
    toast('Downloaded 3 compliance artifacts (ZIP unavailable)', 'ok');
    return analysis;
  }

  // ─── HTML EXECUTIVE REPORT GENERATOR ─────────────────────────
  function generateHTMLReport(analysis) {
    var s = analysis.summary;
    var ragColor = analysis.ragStatus === 'GREEN' ? '#2ea043' : analysis.ragStatus === 'AMBER' ? '#d29922' : '#f85149';
    var ragBg = analysis.ragStatus === 'GREEN' ? '#2ea04320' : analysis.ragStatus === 'AMBER' ? '#d2992220' : '#f8514920';

    var findingsHTML = analysis.findings.map(function (f) {
      var sCol = f.severity === 'critical' ? '#f85149' : f.severity === 'high' ? '#db6d28' : f.severity === 'medium' ? '#d29922' : '#8b949e';
      return '<tr>' +
        '<td style="color:' + sCol + ';font-weight:600;text-transform:uppercase">' + esc(f.severity) + '</td>' +
        '<td>' + esc(f.area) + '</td>' +
        '<td>' + esc(f.finding) + '</td>' +
        '<td style="font-family:monospace;font-size:11px">' + esc(f.ref) + '</td>' +
        '</tr>';
    }).join('');

    return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Compliance Executive Report — ' + esc(s.entity) + '</title>' +
      '<style>' +
      '*{margin:0;padding:0;box-sizing:border-box}' +
      'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0d1117;color:#e6edf3;padding:24px;line-height:1.5}' +
      '.header{text-align:center;padding:32px;border-bottom:2px solid ' + ragColor + ';margin-bottom:24px}' +
      '.header h1{font-size:28px;color:#fff;margin-bottom:8px}' +
      '.header .subtitle{color:#8b949e;font-size:14px}' +
      '.score-card{display:flex;justify-content:center;gap:32px;margin:24px 0;flex-wrap:wrap}' +
      '.score-item{text-align:center;padding:20px 32px;border-radius:12px;background:#161b22;border:1px solid #30363d;min-width:140px}' +
      '.score-item .value{font-size:36px;font-weight:700}' +
      '.score-item .label{font-size:12px;color:#8b949e;text-transform:uppercase;margin-top:4px}' +
      '.rag-badge{display:inline-block;padding:6px 20px;border-radius:20px;font-weight:700;font-size:18px;background:' + ragBg + ';color:' + ragColor + ';border:2px solid ' + ragColor + '}' +
      '.section{margin:24px 0;padding:20px;background:#161b22;border-radius:8px;border:1px solid #30363d}' +
      '.section h2{font-size:18px;margin-bottom:12px;color:#fff;border-bottom:1px solid #30363d;padding-bottom:8px}' +
      'table{width:100%;border-collapse:collapse;font-size:13px}' +
      'th{text-align:left;padding:8px 12px;background:#21262d;color:#8b949e;text-transform:uppercase;font-size:11px;border-bottom:1px solid #30363d}' +
      'td{padding:8px 12px;border-bottom:1px solid #21262d}' +
      '.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}' +
      '.stat{padding:12px;background:#21262d;border-radius:6px}' +
      '.stat .val{font-size:24px;font-weight:700;color:#fff}' +
      '.stat .lbl{font-size:11px;color:#8b949e;text-transform:uppercase}' +
      '.footer{text-align:center;padding:20px;color:#484f58;font-size:11px;border-top:1px solid #21262d;margin-top:32px}' +
      '@media print{body{background:#fff;color:#1f2328}.header{border-color:#1f2328}.section,.score-item{background:#f6f8fa;border-color:#d0d7de}th{background:#eaeef2;color:#1f2328}td{border-color:#d0d7de}.footer{color:#656d76}}' +
      '</style></head><body>' +
      '<div class="header">' +
      '<h1>Compliance Executive Report</h1>' +
      '<div class="subtitle">' + esc(s.entity) + ' | Period: ' + esc(s.periodStart) + ' to ' + esc(s.periodEnd) + '</div>' +
      '<div style="margin-top:16px"><span class="rag-badge">' + analysis.ragStatus + '</span></div>' +
      '</div>' +

      '<div class="score-card">' +
      '<div class="score-item"><div class="value" style="color:' + ragColor + '">' + analysis.complianceScore + '%</div><div class="label">Compliance Score</div></div>' +
      '<div class="score-item"><div class="value" style="color:#f85149">' + analysis.criticalCount + '</div><div class="label">Critical</div></div>' +
      '<div class="score-item"><div class="value" style="color:#db6d28">' + analysis.highCount + '</div><div class="label">High</div></div>' +
      '<div class="score-item"><div class="value" style="color:#d29922">' + analysis.mediumCount + '</div><div class="label">Medium</div></div>' +
      '<div class="score-item"><div class="value" style="color:#8b949e">' + analysis.lowCount + '</div><div class="label">Low</div></div>' +
      '</div>' +

      '<div class="section"><h2>Operations Summary</h2>' +
      '<div class="stat-grid">' +
      statBox('Total Cases', s.cases.total) +
      statBox('Open Cases', s.cases.open) +
      statBox('Closed Cases', s.cases.closed) +
      statBox('Screenings Run', s.screenings.total) +
      statBox('Screening Matches', s.screenings.matches) +
      statBox('goAML Filings', s.filings.totalGoAML) +
      statBox('CTR Pending', s.filings.ctrPending) +
      statBox('Threshold Alerts', s.thresholds.total) +
      statBox('Open Gaps', s.gaps.open) +
      statBox('Audit Trail Entries', s.auditTrail.entries) +
      statBox('Training Records', s.training.total) +
      statBox('Training Completed', s.training.completed) +
      '</div></div>' +

      (analysis.findings.length > 0 ?
        '<div class="section"><h2>Findings (' + analysis.findings.length + ')</h2>' +
        '<table><thead><tr><th>Severity</th><th>Area</th><th>Finding</th><th>Regulatory Ref</th></tr></thead>' +
        '<tbody>' + findingsHTML + '</tbody></table></div>' : '') +

      '<div class="footer">' +
      'Generated by Hawkeye Sterling V2 Compliance Pipeline | ' + new Date().toISOString() + '<br>' +
      'This report is auto-generated. Verify all findings before regulatory submission.' +
      '</div>' +
      '</body></html>';
  }

  function statBox(label, value) {
    return '<div class="stat"><div class="val">' + (value != null ? value : 0) + '</div><div class="lbl">' + esc(label) + '</div></div>';
  }

  // ─── CSV GENERATORS ──────────────────────────────────────────
  function generateFindingsCSV(analysis) {
    var rows = ['Severity,Area,Finding,Regulatory Reference'];
    analysis.findings.forEach(function (f) {
      rows.push(csvRow([f.severity, f.area, f.finding, f.ref]));
    });
    return rows.join('\n');
  }

  function generateTransactionsCSV(txRows) {
    var rows = ['Date,Type,Counterparty,Amount,Currency,Origin,Status'];
    txRows.forEach(function (t) {
      rows.push(csvRow([t.date, t.type, t.counterparty, t.amount, t.currency, t.origin, t.status]));
    });
    return rows.join('\n');
  }

  function generateScreeningsCSV(screenings) {
    var rows = ['Date,Entity,Result'];
    screenings.forEach(function (s) {
      rows.push(csvRow([s.date, s.entity, s.result]));
    });
    return rows.join('\n');
  }

  // ─── RUN FULL PIPELINE ───────────────────────────────────────
  function runPipeline() {
    toast('Pipeline started: Extracting data...', 'info');

    try {
      // Stage 1
      var raw = extract();
      toast('Stage 1/4 complete: ' + Object.keys(raw).length + ' data sources extracted', 'info');

      // Stage 2
      var condensed = condense(raw);
      toast('Stage 2/4 complete: Data condensed for ' + condensed.entity, 'info');

      // Stage 3
      var analysis = analyze(condensed);
      toast('Stage 3/4 complete: Score ' + analysis.complianceScore + '% (' + analysis.ragStatus + ')', 'info');

      // Stage 4
      packageArtifacts(analysis);

      return analysis;
    } catch (err) {
      toast('Pipeline failed: ' + err.message, 'error');
      console.error('[CompliancePipeline] Error:', err);
      return null;
    }
  }

  // ─── UI RENDERING ────────────────────────────────────────────
  function renderPipelineTab() {
    var history = getHistory();
    var historyRows = history.map(function (h) {
      var ragColor = h.rag === 'GREEN' ? '#2ea043' : h.rag === 'AMBER' ? '#d29922' : '#f85149';
      return '<tr>' +
        '<td>' + esc(h.date ? h.date.slice(0, 10) : '') + '</td>' +
        '<td>' + esc(h.entity) + '</td>' +
        '<td style="color:' + ragColor + ';font-weight:600">' + h.score + '%</td>' +
        '<td><span style="color:' + ragColor + ';font-weight:600">' + esc(h.rag) + '</span></td>' +
        '<td>' + h.findings + '</td>' +
        '<td style="font-size:11px">' + esc(h.filename) + '</td>' +
        '</tr>';
    }).join('');

    return '<div class="card" style="margin-bottom:16px">' +
      '<div class="top-bar" style="margin-bottom:12px">' +
      '<span class="sec-title" style="margin:0;border:none;padding:0">Compliance Export Pipeline</span>' +
      '<div style="display:flex;gap:6px">' +
      '<button class="btn btn-sm btn-green" onclick="CompliancePipeline.runPipeline()">Run Full Pipeline</button>' +
      '<button class="btn btn-sm btn-blue" onclick="CompliancePipeline.runPreview()">Preview Analysis</button>' +
      '</div></div>' +

      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">' +
      pipelineStageCard('1', 'Extract', 'Pull all compliance data from local storage', '#58a6ff') +
      pipelineStageCard('2', 'Condense', 'Transform into summary tables & CSV rows', '#3fb950') +
      pipelineStageCard('3', 'Analyze', 'Score compliance, find gaps, assign RAG', '#d29922') +
      pipelineStageCard('4', 'Package', 'Bundle as ZIP: HTML report + CSV + JSON', '#f78166') +
      '</div>' +

      '<div style="background:#161b22;padding:12px;border-radius:6px;margin-bottom:12px;font-size:12px;color:#8b949e">' +
      '<strong style="color:#e6edf3">Pipeline Output:</strong> ' +
      'Executive_Report.html, Findings.csv, Analysis.json, Transactions.csv, Screenings.csv, Scorecard.json — all packaged as a single ZIP file.' +
      '</div>' +

      '<div id="pipelinePreview" style="display:none;margin-bottom:12px"></div>' +
      '</div>' +

      (history.length > 0 ?
        '<div class="card"><div class="top-bar" style="margin-bottom:8px">' +
        '<span class="sec-title" style="margin:0;border:none;padding:0">Pipeline History</span>' +
        '<button class="btn btn-sm btn-red" onclick="CompliancePipeline.clearHistory()">Clear</button>' +
        '</div>' +
        '<table style="width:100%;font-size:12px;border-collapse:collapse">' +
        '<thead><tr><th style="text-align:left;padding:6px;border-bottom:1px solid #30363d;color:#8b949e">Date</th>' +
        '<th style="text-align:left;padding:6px;border-bottom:1px solid #30363d;color:#8b949e">Entity</th>' +
        '<th style="text-align:left;padding:6px;border-bottom:1px solid #30363d;color:#8b949e">Score</th>' +
        '<th style="text-align:left;padding:6px;border-bottom:1px solid #30363d;color:#8b949e">RAG</th>' +
        '<th style="text-align:left;padding:6px;border-bottom:1px solid #30363d;color:#8b949e">Findings</th>' +
        '<th style="text-align:left;padding:6px;border-bottom:1px solid #30363d;color:#8b949e">File</th></tr></thead>' +
        '<tbody>' + historyRows + '</tbody></table></div>' : '');
  }

  function pipelineStageCard(num, title, desc, color) {
    return '<div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px;text-align:center;border-top:3px solid ' + color + '">' +
      '<div style="font-size:24px;font-weight:700;color:' + color + '">' + num + '</div>' +
      '<div style="font-size:14px;font-weight:600;color:#e6edf3;margin:4px 0">' + title + '</div>' +
      '<div style="font-size:11px;color:#8b949e">' + desc + '</div>' +
      '</div>';
  }

  // Preview without download
  function runPreview() {
    try {
      var raw = extract();
      var condensed = condense(raw);
      var analysis = analyze(condensed);

      var ragColor = analysis.ragStatus === 'GREEN' ? '#2ea043' : analysis.ragStatus === 'AMBER' ? '#d29922' : '#f85149';
      var el = document.getElementById('pipelinePreview');
      if (el) {
        el.style.display = 'block';
        el.innerHTML = '<div class="card" style="border:1px solid ' + ragColor + '">' +
          '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">' +
          '<span style="font-size:32px;font-weight:700;color:' + ragColor + '">' + analysis.complianceScore + '%</span>' +
          '<span style="padding:4px 12px;border-radius:12px;background:' + ragColor + '20;color:' + ragColor + ';font-weight:600">' + analysis.ragStatus + '</span>' +
          '<span style="color:#8b949e;font-size:12px">' + analysis.summary.entity + '</span>' +
          '</div>' +
          (analysis.findings.length > 0 ?
            '<div style="font-size:12px">' + analysis.findings.map(function (f) {
              var sCol = f.severity === 'critical' ? '#f85149' : f.severity === 'high' ? '#db6d28' : f.severity === 'medium' ? '#d29922' : '#8b949e';
              return '<div style="padding:4px 0;border-bottom:1px solid #21262d"><span style="color:' + sCol + ';font-weight:600;text-transform:uppercase;font-size:10px;width:60px;display:inline-block">' + f.severity + '</span> ' + esc(f.finding) + '</div>';
            }).join('') + '</div>' :
            '<div style="color:#3fb950;font-size:13px">No findings — all compliance areas are satisfactory.</div>'
          ) +
          '</div>';
      }
      toast('Analysis preview ready: ' + analysis.complianceScore + '% (' + analysis.ragStatus + ')', 'ok');
    } catch (err) {
      toast('Preview failed: ' + err.message, 'error');
    }
  }

  function clearPipelineHistory() {
    localStorage.removeItem(PIPELINE_KEY);
    toast('Pipeline history cleared', 'ok');
    var el = document.getElementById('tab-pipeline');
    if (el) el.innerHTML = renderPipelineTab();
  }

  // ─── UTILITY FUNCTIONS ───────────────────────────────────────
  function safeParse(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
    catch (_) { return fallback; }
  }

  function countBy(arr, key) {
    var counts = {};
    arr.forEach(function (item) {
      var val = item[key] || 'unknown';
      counts[val] = (counts[val] || 0) + 1;
    });
    return counts;
  }

  function formatDate(d) {
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    return dd + '/' + mm + '/' + d.getFullYear();
  }

  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function csvRow(fields) {
    return fields.map(function (f) {
      var s = String(f == null ? '' : f);
      return s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
    }).join(',');
  }

  function sanitizeFilename(name) {
    return String(name || 'Entity').replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_').slice(0, 50);
  }

  function downloadBlob(blob, filename, mimeType) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); document.body.removeChild(a); }, 100);
  }

  function toast(msg, type) {
    if (typeof window.toast === 'function') { window.toast(msg, type); return; }
    console.log('[Pipeline] ' + type + ': ' + msg);
  }

  // ─── PUBLIC API ──────────────────────────────────────────────
  return {
    extract: extract,
    condense: condense,
    analyze: analyze,
    package: packageArtifacts,
    runPipeline: runPipeline,
    runPreview: runPreview,
    renderPipelineTab: renderPipelineTab,
    clearHistory: clearPipelineHistory,
    getHistory: getHistory
  };
})();

// Expose globally
window.CompliancePipeline = CompliancePipeline;
