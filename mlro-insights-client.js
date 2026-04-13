// ═══════════════════════════════════════════════════════════════════════════
// MLRO Insights — geo-risk heatmap + data quality + approver workload +
// multi-entity rollup + audit-trail timeline. Single vanilla JS client
// that renders into the Insights tab without any chart library.
//
// Regulatory basis:
//   FDL No.10/2025 Art.19-21 (CO duties + internal review)
//   Cabinet Res 134/2025 Art.5,19 (risk appetite + continuous monitoring)
//   FATF Rec 1 (risk-based approach)
//   Wolfsberg Country Risk 2023 (for geo-risk bands)
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  function esc(s) {
    if (s === null || s === undefined) return '';
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function safeJson(key, fb) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fb; } catch (_) { return fb; }
  }

  // ── FATF / Wolfsberg country risk bands (simplified, reference only) ──
  // Each entry: ISO code → risk band 1..5 (1 low, 5 critical).
  // This is a working subset — real use would load from a maintained feed.
  var COUNTRY_RISK = {
    AE: 2, SA: 3, QA: 3, KW: 2, OM: 2, BH: 3, // GCC
    GB: 1, US: 1, CA: 1, AU: 1, NZ: 1, CH: 1, DE: 1, FR: 1, NL: 1, SE: 1, NO: 1, DK: 1, FI: 1, IE: 1, // Developed
    IN: 3, CN: 4, JP: 1, KR: 1, SG: 1, HK: 2, // APAC
    RU: 5, IR: 5, KP: 5, SY: 5, VE: 5, AF: 5, // Sanctioned
    TR: 4, PK: 4, EG: 4, LB: 4, IQ: 4, YE: 5, LY: 5, SD: 5, // Grey/black
    ZA: 3, NG: 4, KE: 3, ET: 4, GH: 3, // Africa
    BR: 3, AR: 3, MX: 3, CO: 3, CL: 2, // LATAM
  };

  var BAND_COLOR = { 1: '#3fb950', 2: '#8FB849', 3: '#E8A030', 4: '#D94F4F', 5: '#A33' };
  var BAND_LABEL = { 1: 'Low', 2: 'Low-Med', 3: 'Medium', 4: 'High', 5: 'Critical' };

  // ── Helpers ───────────────────────────────────────────────────────────
  function sectionHeader(title, sub) {
    return '<div style="margin:14px 0 8px 0;display:flex;align-items:baseline;gap:8px;border-bottom:1px solid #21262d;padding-bottom:6px">' +
      '<span style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:#d4a843;text-transform:uppercase">' + esc(title) + '</span>' +
      (sub ? '<span style="font-size:10px;color:#8b949e">' + esc(sub) + '</span>' : '') +
      '</div>';
  }

  function progressBar(pct, color) {
    var w = Math.max(0, Math.min(100, pct));
    return '<div style="flex:1;height:6px;background:#161b22;border-radius:3px;overflow:hidden">' +
      '<div style="width:' + w + '%;height:100%;background:' + color + '"></div>' +
      '</div>';
  }

  // ══════════════════════════════════════════════════════════════════════
  // 1. GEO-RISK HEATMAP
  // ══════════════════════════════════════════════════════════════════════
  function renderGeoHeatmap() {
    var cdds = safeJson('fgl_cdd_records', []);
    if (!cdds.length) {
      return sectionHeader('Geo-risk heatmap', 'FATF high-risk jurisdictions · Wolfsberg 2023') +
        '<div style="font-size:11px;color:#484f58;padding:6px">No CDD records yet — onboard a customer to populate the heatmap.</div>';
    }

    var buckets = {};
    cdds.forEach(function (c) {
      var code = ((c.countryCode || c.jurisdictionCode || c.jurisdiction || '') + '').toUpperCase().slice(0, 2);
      if (!code) return;
      if (!buckets[code]) buckets[code] = { code: code, count: 0, band: COUNTRY_RISK[code] || 3 };
      buckets[code].count++;
    });

    var list = Object.values(buckets).sort(function (a, b) { return (b.band * 1000 + b.count) - (a.band * 1000 + a.count); });
    var maxCount = Math.max.apply(null, list.map(function (x) { return x.count; }));

    var html = sectionHeader('Geo-risk heatmap', 'Customers by jurisdiction × FATF/Wolfsberg risk band');
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:4px">';
    list.forEach(function (b) {
      var col = BAND_COLOR[b.band];
      html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#161b22;border:1px solid #21262d;border-left:3px solid ' + col + ';border-radius:3px;font-size:11px">' +
        '<span style="color:#e6edf3;font-weight:600;width:30px">' + esc(b.code) + '</span>' +
        '<span style="color:' + col + ';font-size:9px;font-weight:700;text-transform:uppercase">' + BAND_LABEL[b.band] + '</span>' +
        progressBar((b.count / maxCount) * 100, col) +
        '<span style="color:#8b949e;width:30px;text-align:right">' + b.count + '</span>' +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  // ══════════════════════════════════════════════════════════════════════
  // 2. DATA QUALITY DASHBOARD
  // ══════════════════════════════════════════════════════════════════════
  function renderDataQuality() {
    var cdds = safeJson('fgl_cdd_records', []);
    var ubos = safeJson('fgl_ubo_records', []);
    var risks = safeJson('fgl_risk_scores', []);
    var now = Date.now();
    var thirtyD = 30 * 86400000;

    var issues = {
      missingUbo: 0,
      missingJurisdiction: 0,
      missingRiskScore: 0,
      missingLastReview: 0,
      staleRiskScore: 0, // older than 6mo
      missingOnboardingDate: 0,
      missingPepFlag: 0
    };

    cdds.forEach(function (c) {
      if (!c) return;
      if (!c.ubo && !ubos.find(function (u) { return u && u.customerId === c.customerId; })) issues.missingUbo++;
      if (!c.jurisdiction && !c.countryCode) issues.missingJurisdiction++;
      if (typeof c.isPep !== 'boolean') issues.missingPepFlag++;
      if (!c.onboardingDate) issues.missingOnboardingDate++;
      if (!c.lastReviewAt) issues.missingLastReview++;

      var latest = risks.filter(function (r) { return r && r.customerId === c.customerId; })
        .sort(function (a, b) { return new Date(b.timestamp || 0) - new Date(a.timestamp || 0); })[0];
      if (!latest) {
        issues.missingRiskScore++;
      } else {
        var age = now - new Date(latest.timestamp || 0).getTime();
        if (age > 6 * thirtyD) issues.staleRiskScore++;
      }
    });

    var total = cdds.length;
    var totalIssues = Object.values(issues).reduce(function (a, b) { return a + b; }, 0);
    var score = total === 0 ? 0 : Math.max(0, Math.round(100 - (totalIssues / (total * 7)) * 100));
    var scoreColor = score >= 85 ? '#3fb950' : score >= 70 ? '#8FB849' : score >= 50 ? '#E8A030' : '#D94F4F';

    var rows = [
      ['Missing UBO record (Cabinet Decision 109/2023)', issues.missingUbo],
      ['Missing jurisdiction (FATF Rec.10)', issues.missingJurisdiction],
      ['Missing PEP flag (FATF Rec.12)', issues.missingPepFlag],
      ['Missing onboarding date', issues.missingOnboardingDate],
      ['Missing last review date (FDL Art.19)', issues.missingLastReview],
      ['Missing risk score', issues.missingRiskScore],
      ['Stale risk score (>6 months)', issues.staleRiskScore]
    ];

    var html = sectionHeader('Data quality dashboard', total + ' CDD record(s) audited');
    html += '<div style="display:flex;gap:12px;align-items:center;margin-bottom:10px">' +
      '<div style="background:#0d1117;border:1px solid ' + scoreColor + '44;border-left:3px solid ' + scoreColor + ';border-radius:4px;padding:10px;min-width:120px">' +
      '<div style="font-size:9px;color:#8b949e;text-transform:uppercase;letter-spacing:1px">DQ Score</div>' +
      '<div style="font-size:22px;font-weight:700;color:' + scoreColor + '">' + score + '%</div>' +
      '</div>' +
      '<div style="flex:1;font-size:11px;color:#cdcdcd">' +
      (total === 0 ? 'No CDD records to audit.' : 'Data quality is the ratio of clean fields to total fields. Targets: ≥85% green · ≥70% amber · below 50% requires remediation plan per FDL Art.19.') +
      '</div></div>';

    html += '<div>';
    rows.forEach(function (r) {
      var pct = total === 0 ? 0 : (r[1] / total) * 100;
      var col = pct === 0 ? '#3fb950' : pct < 10 ? '#d4a843' : pct < 25 ? '#E8A030' : '#D94F4F';
      html += '<div style="display:flex;align-items:center;gap:8px;padding:4px 8px;font-size:11px;color:#cdcdcd">' +
        '<span style="flex:1">' + esc(r[0]) + '</span>' +
        progressBar(pct, col) +
        '<span style="width:48px;text-align:right;color:' + col + ';font-weight:600">' + r[1] + '</span>' +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  // ══════════════════════════════════════════════════════════════════════
  // 3. APPROVER WORKLOAD BALANCER
  // ══════════════════════════════════════════════════════════════════════
  function renderApproverWorkload() {
    var approvals = safeJson('fgl_approvals', []);
    var open = approvals.filter(function (a) { return a && a.status === 'Pending'; });
    if (open.length === 0) {
      return sectionHeader('Approver workload balancer', 'Pending four-eyes queue') +
        '<div style="font-size:11px;color:#3fb950;padding:6px">✓ No pending approvals.</div>';
    }

    var buckets = {};
    var unassigned = 0;
    var now = Date.now();
    open.forEach(function (a) {
      var name = (a.approver || '').trim();
      if (!name) { unassigned++; return; }
      if (!buckets[name]) buckets[name] = { name: name, count: 0, overdue: 0, oldest: 0 };
      buckets[name].count++;
      var createdMs = new Date(a.createdAt || 0).getTime();
      var sla = (a.slaHours || 48) * 3600000;
      if (now - createdMs > sla) buckets[name].overdue++;
      if (now - createdMs > buckets[name].oldest) buckets[name].oldest = now - createdMs;
    });

    var list = Object.values(buckets).sort(function (a, b) { return b.count - a.count; });
    var maxCount = Math.max.apply(null, list.map(function (x) { return x.count; }).concat([1]));

    var html = sectionHeader('Approver workload balancer', open.length + ' pending · ' + unassigned + ' unassigned');
    if (unassigned > 0) {
      html += '<div style="padding:8px 10px;background:rgba(232,160,48,0.08);border-left:3px solid #E8A030;font-size:11px;color:#E8A030;margin-bottom:6px">⚠ ' + unassigned + ' approval(s) have no designated approver.</div>';
    }
    list.forEach(function (b) {
      var ageH = Math.round(b.oldest / 3600000);
      var col = b.overdue > 0 ? '#D94F4F' : b.count > 5 ? '#E8A030' : '#3fb950';
      html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#161b22;border-left:3px solid ' + col + ';border-radius:3px;font-size:11px;margin-bottom:3px">' +
        '<span style="flex:1;color:#e6edf3;font-weight:600">' + esc(b.name) + '</span>' +
        progressBar((b.count / maxCount) * 100, col) +
        '<span style="color:#8b949e;width:60px;text-align:right">' + b.count + ' pending</span>' +
        '<span style="color:' + col + ';width:72px;text-align:right">' + (b.overdue > 0 ? b.overdue + ' overdue' : ageH + 'h oldest') + '</span>' +
        '</div>';
    });
    return html;
  }

  // ══════════════════════════════════════════════════════════════════════
  // 4. MULTI-ENTITY ROLLUP
  // ══════════════════════════════════════════════════════════════════════
  function renderMultiEntity() {
    var entities = safeJson('fgl_companies', []);
    if (!entities.length) {
      return sectionHeader('Multi-entity rollup') +
        '<div style="font-size:11px;color:#484f58;padding:6px">No additional legal entities configured.</div>';
    }
    var approvals = safeJson('fgl_approvals', []);
    var incidents = safeJson('fgl_incidents', []);
    var strs = safeJson('fgl_str_cases', []);

    var html = sectionHeader('Multi-entity rollup', entities.length + ' legal entit' + (entities.length === 1 ? 'y' : 'ies'));
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:6px">';
    entities.forEach(function (e) {
      if (!e || !e.id) return;
      var entityApprovals = approvals.filter(function (a) { return a && a.entityId === e.id; }).length;
      var entityIncidents = incidents.filter(function (i) { return i && i.entityId === e.id; }).length;
      var entityStrs = strs.filter(function (s) { return s && s.entityId === e.id; }).length;
      html += '<div style="background:#161b22;border:1px solid #21262d;border-left:3px solid #4A8FC1;border-radius:4px;padding:10px">' +
        '<div style="font-size:12px;font-weight:700;color:#e6edf3;margin-bottom:6px">' + esc(e.name || e.id) + '</div>' +
        '<div style="font-size:10px;color:#8b949e;display:flex;justify-content:space-between"><span>Approvals</span><span style="color:#4A8FC1;font-weight:600">' + entityApprovals + '</span></div>' +
        '<div style="font-size:10px;color:#8b949e;display:flex;justify-content:space-between"><span>Incidents</span><span style="color:#D94F4F;font-weight:600">' + entityIncidents + '</span></div>' +
        '<div style="font-size:10px;color:#8b949e;display:flex;justify-content:space-between"><span>STR cases</span><span style="color:#E8A030;font-weight:600">' + entityStrs + '</span></div>' +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  // ══════════════════════════════════════════════════════════════════════
  // 5. AUDIT TRAIL VISUAL TIMELINE
  // ══════════════════════════════════════════════════════════════════════
  function renderAuditTimeline() {
    var audit = safeJson('fgl_audit_log', []);
    if (!audit.length) {
      return sectionHeader('Audit trail timeline') +
        '<div style="font-size:11px;color:#484f58;padding:6px">No audit trail entries.</div>';
    }
    var recent = audit.slice(-40).reverse();
    var html = sectionHeader('Audit trail timeline', 'Last 40 actions');
    html += '<div style="position:relative;padding-left:16px;border-left:2px solid #21262d;max-height:420px;overflow:auto">';
    recent.forEach(function (e) {
      var col = /error|fail|block/i.test(e.action || '') ? '#f85149' : /warn/i.test(e.action || '') ? '#E8A030' : '#3fb950';
      var ts = '';
      try { ts = new Date(e.timestamp || Date.now()).toLocaleString(); } catch (_) { ts = String(e.timestamp || ''); }
      html += '<div style="position:relative;margin-bottom:10px">' +
        '<div style="position:absolute;left:-22px;top:6px;width:10px;height:10px;border-radius:50%;background:' + col + ';border:2px solid #0d1117"></div>' +
        '<div style="font-size:10px;color:#484f58">' + esc(ts) + '</div>' +
        '<div style="font-size:11px;color:' + col + ';font-weight:600;margin-top:1px">' + esc(e.action || '—') + '</div>' +
        '<div style="font-size:10px;color:#cdcdcd;margin-top:1px">' + esc(e.target || '') + (e.actor ? ' · by <span style="color:#d4a843">' + esc(e.actor) + '</span>' : '') + '</div>' +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  // ══════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════════════════
  function render() {
    var el = document.getElementById('insightsContainer');
    if (!el) return;
    var html = '<div class="card" style="padding:16px">';
    html += renderGeoHeatmap();
    html += renderDataQuality();
    html += renderApproverWorkload();
    html += renderMultiEntity();
    html += renderAuditTimeline();
    html += '</div>';
    el.innerHTML = html;
  }

  window.insightsRefresh = render;

  // Auto-render on tab switch
  document.addEventListener('click', function (e) {
    var tgt = e.target;
    if (!tgt) return;
    var arg = tgt.getAttribute && tgt.getAttribute('data-arg');
    if (arg === 'insights') {
      setTimeout(function () { try { render(); } catch (_) {} }, 50);
    }
  });
})();
