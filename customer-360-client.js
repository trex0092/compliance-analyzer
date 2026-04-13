// ═══════════════════════════════════════════════════════════════════════════
// CUSTOMER 360 — single-pane drill-down for one customer.
// Aggregates CDD, transactions, screening hits, risk score, ESG grade,
// adverse media, approvals, audit trail, red-flag matches from localStorage
// into one view, rendered into #customer360Container.
//
// Regulatory basis:
//   FDL No.10/2025 Art.20-21 (CO situational awareness)
//   Cabinet Res 134/2025 Art.19 (continuous monitoring)
//   UAE PDPL (display only hashed identifiers when possible)
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  function safeJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function fmtAed(n) {
    if (typeof n !== 'number' || isNaN(n)) return '—';
    return 'AED ' + n.toLocaleString('en-AE');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      return isNaN(d.getTime()) ? esc(iso) : d.toISOString().slice(0, 10);
    } catch (_) {
      return esc(iso);
    }
  }

  // ── Aggregators ────────────────────────────────────────────────────────
  function collectCustomerIds() {
    var ids = new Set();

    // From CDD records
    var cdds = safeJson('fgl_cdd_records', []);
    cdds.forEach(function (c) { if (c && c.customerId) ids.add(c.customerId); });

    // From onboarding
    var onb = safeJson('fgl_onboarding_cases', []);
    onb.forEach(function (c) { if (c && c.customerId) ids.add(c.customerId); });

    // From transactions
    var txns = safeJson('fgl_transactions', []);
    txns.forEach(function (t) { if (t && t.customerId) ids.add(t.customerId); });

    // From ESG records
    var esg = safeJson('fgl_esg_records', []);
    esg.forEach(function (r) { if (r && r.customerId) ids.add(r.customerId); });

    // From sanctions matches
    var sanc = safeJson('fgl_sanctions_matches', []);
    sanc.forEach(function (s) { if (s && s.customerId) ids.add(s.customerId); });

    // From approvals (subject may be a customer id)
    var appr = safeJson('fgl_approvals', []);
    appr.forEach(function (a) {
      if (a && a.subject) {
        // best-effort: if the subject looks like a customer id, index it
        var m = /CUST[-_]\w+/i.exec(a.subject);
        if (m) ids.add(m[0].toUpperCase());
      }
    });

    return Array.from(ids).sort();
  }

  function buildProfile(customerId) {
    var profile = {
      customerId: customerId,
      displayName: null,
      cdd: null,
      onboarding: null,
      transactions: [],
      screening: [],
      esg: null,
      adverseMedia: [],
      approvals: [],
      audit: [],
      redFlags: [],
      incidents: [],
      riskScore: null
    };

    var cdds = safeJson('fgl_cdd_records', []);
    profile.cdd = cdds.find(function (c) { return c && c.customerId === customerId; }) || null;
    if (profile.cdd && profile.cdd.displayName) profile.displayName = profile.cdd.displayName;

    var onb = safeJson('fgl_onboarding_cases', []);
    profile.onboarding = onb.find(function (c) { return c && c.customerId === customerId; }) || null;
    if (!profile.displayName && profile.onboarding && profile.onboarding.displayName) {
      profile.displayName = profile.onboarding.displayName;
    }

    profile.transactions = safeJson('fgl_transactions', []).filter(function (t) { return t && t.customerId === customerId; });

    profile.screening = safeJson('fgl_sanctions_matches', []).filter(function (s) { return s && s.customerId === customerId; });

    var esg = safeJson('fgl_esg_records', []);
    profile.esg = esg.find(function (r) { return r && r.customerId === customerId; }) || null;
    if (!profile.displayName && profile.esg && profile.esg.displayName) {
      profile.displayName = profile.esg.displayName;
    }

    profile.adverseMedia = safeJson('fgl_adverse_media', []).filter(function (m) { return m && m.customerId === customerId; });

    profile.approvals = safeJson('fgl_approvals', []).filter(function (a) {
      return a && a.subject && a.subject.indexOf(customerId) !== -1;
    });

    profile.audit = safeJson('fgl_audit_log', []).filter(function (e) {
      return e && e.target && e.target.indexOf(customerId) !== -1;
    });

    profile.redFlags = safeJson('fgl_flag_hits', []).filter(function (f) { return f && f.customerId === customerId; });

    profile.incidents = safeJson('fgl_incidents', []).filter(function (i) { return i && i.customerId === customerId; });

    var risks = safeJson('fgl_risk_scores', []);
    var latest = risks
      .filter(function (r) { return r && r.customerId === customerId; })
      .sort(function (a, b) { return new Date(b.timestamp || 0) - new Date(a.timestamp || 0); })[0];
    profile.riskScore = latest || null;

    if (!profile.displayName) profile.displayName = customerId;
    return profile;
  }

  // ── Tile + section helpers ────────────────────────────────────────────
  function kpi(label, value, color) {
    color = color || '#d4a843';
    return '<div style="background:#0d1117;border:1px solid #21262d;border-left:3px solid ' + color + ';border-radius:4px;padding:10px;min-width:120px">' +
      '<div style="font-size:9px;color:#8b949e;text-transform:uppercase;letter-spacing:1px">' + esc(label) + '</div>' +
      '<div style="font-size:18px;font-weight:700;color:' + color + ';margin-top:3px">' + esc(value) + '</div>' +
      '</div>';
  }

  function section(title, body) {
    return '<div class="card" style="margin-bottom:12px;padding:14px">' +
      '<div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:#d4a843;text-transform:uppercase;margin-bottom:8px;border-bottom:1px solid #21262d;padding-bottom:6px">' + esc(title) + '</div>' +
      body +
      '</div>';
  }

  function emptyRow(msg) {
    return '<div style="font-size:11px;color:#484f58;padding:6px 2px">' + esc(msg) + '</div>';
  }

  function buildHtml(profile) {
    var html = '';

    // Header KPIs
    html += '<div class="card" style="padding:14px;margin-bottom:12px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">';
    html += '<div><div style="font-size:18px;font-weight:700;color:#e6edf3">' + esc(profile.displayName) + '</div>';
    html += '<div style="font-size:11px;color:#8b949e">id: ' + esc(profile.customerId) + ' · FDL Art.20 situational view</div></div>';
    html += '<div><button class="btn btn-sm btn-red" onclick="c360OpenIncident(\'' + esc(profile.customerId) + '\')">🚨 Open incident</button> ';
    html += '<button class="btn btn-sm btn-gold" onclick="c360DraftStr(\'' + esc(profile.customerId) + '\')">📝 Draft STR</button></div>';
    html += '</div>';

    var riskColor = !profile.riskScore ? '#484f58' :
      profile.riskScore.score >= 16 ? '#f85149' :
      profile.riskScore.score >= 11 ? '#E8A030' :
      profile.riskScore.score >= 6 ? '#d4a843' : '#3fb950';
    var esgGrade = profile.esg && profile.esg.score ? profile.esg.score.grade : '—';
    var esgColor = esgGrade === 'A' ? '#3fb950' : esgGrade === 'B' ? '#8FB849' : esgGrade === 'C' ? '#E8A030' : esgGrade === 'D' ? '#D94F4F' : esgGrade === 'F' ? '#A33' : '#484f58';

    html += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
    html += kpi('Risk score', profile.riskScore ? profile.riskScore.score : '—', riskColor);
    html += kpi('ESG grade', esgGrade, esgColor);
    html += kpi('Transactions', profile.transactions.length, '#4A8FC1');
    html += kpi('Screening hits', profile.screening.length, profile.screening.length > 0 ? '#f85149' : '#3fb950');
    html += kpi('Red flags', profile.redFlags.length, profile.redFlags.length > 0 ? '#E8A030' : '#3fb950');
    html += kpi('Adverse media', profile.adverseMedia.length, profile.adverseMedia.length > 0 ? '#E8A030' : '#3fb950');
    html += kpi('Approvals', profile.approvals.length, '#4A8FC1');
    html += kpi('Incidents', profile.incidents.length, profile.incidents.length > 0 ? '#D94F4F' : '#3fb950');
    html += '</div></div>';

    // CDD file
    var cddBody;
    if (!profile.cdd) {
      cddBody = emptyRow('No CDD file on record — onboard this customer first.');
    } else {
      cddBody = '<div style="font-size:11px;color:#cdcdcd;line-height:1.8">' +
        '<div><strong style="color:#8b949e">Risk tier:</strong> ' + esc(profile.cdd.riskTier || '—') + '</div>' +
        '<div><strong style="color:#8b949e">Jurisdiction:</strong> ' + esc(profile.cdd.jurisdiction || '—') + '</div>' +
        '<div><strong style="color:#8b949e">UBO:</strong> ' + esc(profile.cdd.ubo || '—') + '</div>' +
        '<div><strong style="color:#8b949e">PEP:</strong> ' + (profile.cdd.isPep ? 'YES' : 'no') + '</div>' +
        '<div><strong style="color:#8b949e">Last review:</strong> ' + fmtDate(profile.cdd.lastReviewAt) + '</div>' +
        '<div><strong style="color:#8b949e">Next review due:</strong> ' + fmtDate(profile.cdd.nextReviewAt) + '</div>' +
        '</div>';
    }
    html += section('CDD / KYC file', cddBody);

    // Transactions (last 10)
    var txBody;
    if (profile.transactions.length === 0) {
      txBody = emptyRow('No transactions on file.');
    } else {
      txBody = '<div style="max-height:260px;overflow:auto">';
      profile.transactions.slice(0, 10).forEach(function (t) {
        var col = t.flagged ? '#f85149' : '#3fb950';
        txBody += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-radius:4px;font-size:11px;background:#161b22;margin-bottom:3px;border-left:3px solid ' + col + '">' +
          '<span>' + fmtDate(t.date) + ' · ' + esc(t.type || '—') + '</span>' +
          '<span style="color:#8b949e">' + esc(t.direction || '—') + '</span>' +
          '<span style="color:' + col + ';font-weight:600">' + fmtAed(t.amountAed) + '</span>' +
          '</div>';
      });
      txBody += '</div>';
    }
    html += section('Recent transactions (last 10)', txBody);

    // Screening
    var scBody;
    if (profile.screening.length === 0) {
      scBody = '<div style="font-size:11px;color:#3fb950">✓ No active sanctions / PEP matches.</div>';
    } else {
      scBody = '';
      profile.screening.forEach(function (s) {
        scBody += '<div style="padding:8px 10px;border-radius:4px;font-size:11px;background:#161b22;margin-bottom:4px;border-left:3px solid #f85149">' +
          '<div style="font-weight:700;color:#f85149">' + esc(s.list || 'UNKNOWN') + ' · confidence ' + (s.confidence ? (s.confidence * 100).toFixed(0) + '%' : '—') + '</div>' +
          '<div style="color:#cdcdcd;margin-top:2px">' + esc(s.matchedName || '') + '</div>' +
          '<div style="color:#8b949e;font-size:10px;margin-top:2px">' + fmtDate(s.detectedAt) + '</div>' +
          '</div>';
      });
    }
    html += section('Sanctions / PEP screening', scBody);

    // Red flags
    var rfBody;
    if (profile.redFlags.length === 0) {
      rfBody = '<div style="font-size:11px;color:#3fb950">✓ No red-flag hits.</div>';
    } else {
      rfBody = '';
      profile.redFlags.forEach(function (f) {
        rfBody += '<div style="padding:6px 10px;border-radius:4px;font-size:11px;background:#161b22;margin-bottom:3px;border-left:3px solid #E8A030">' +
          '<div style="color:#E8A030;font-weight:600">' + esc(f.flag || '—') + '</div>' +
          '<div style="color:#8b949e;font-size:10px;margin-top:2px">' + fmtDate(f.detectedAt) + ' · ' + esc(f.ref || '') + '</div>' +
          '</div>';
      });
    }
    html += section('Red flag library matches', rfBody);

    // ESG
    var esgBody;
    if (!profile.esg) {
      esgBody = emptyRow('No ESG score on record. Score this customer from the ESG tab.');
    } else {
      var s = profile.esg.score || {};
      var pillars = s.pillars || {};
      esgBody = '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        kpi('Total', s.totalScore || '—', esgColor) +
        kpi('E', (pillars.E && pillars.E.score) || '—', '#3DA876') +
        kpi('S', (pillars.S && pillars.S.score) || '—', '#4A8FC1') +
        kpi('G', (pillars.G && pillars.G.score) || '—', '#E8A030') +
        kpi('Grade', s.grade || '—', esgColor) +
        kpi('Risk', s.riskLevel || '—', esgColor) +
        '</div>';
    }
    html += section('ESG score', esgBody);

    // Adverse media
    var amBody;
    if (profile.adverseMedia.length === 0) {
      amBody = '<div style="font-size:11px;color:#3fb950">✓ No adverse media hits.</div>';
    } else {
      amBody = '';
      profile.adverseMedia.slice(0, 5).forEach(function (m) {
        amBody += '<div style="padding:6px 10px;border-radius:4px;font-size:11px;background:#161b22;margin-bottom:3px;border-left:3px solid #E8A030">' +
          '<div style="color:#E8A030;font-weight:600">' + esc(m.headline || m.title || '—') + '</div>' +
          '<div style="color:#8b949e;font-size:10px;margin-top:2px">' + esc(m.source || '') + ' · ' + fmtDate(m.publishedAt) + '</div>' +
          '</div>';
      });
    }
    html += section('Adverse media', amBody);

    // Approvals
    var apBody;
    if (profile.approvals.length === 0) {
      apBody = emptyRow('No approval requests linked to this customer.');
    } else {
      apBody = '';
      profile.approvals.slice(0, 5).forEach(function (a) {
        var col = a.status === 'Approved' ? '#3fb950' : a.status === 'Rejected' ? '#f85149' : '#E8A030';
        apBody += '<div style="padding:6px 10px;border-radius:4px;font-size:11px;background:#161b22;margin-bottom:3px;border-left:3px solid ' + col + '">' +
          '<div style="color:#e6edf3;font-weight:600">' + esc(a.approvalType || '—') + '</div>' +
          '<div style="color:#8b949e;font-size:10px;margin-top:2px">' + esc(a.status || '—') + ' · ' + fmtDate(a.createdAt) + '</div>' +
          '</div>';
      });
    }
    html += section('Approvals', apBody);

    // Audit trail
    var aBody;
    if (profile.audit.length === 0) {
      aBody = emptyRow('No audit trail entries.');
    } else {
      aBody = '<div style="max-height:260px;overflow:auto">';
      profile.audit.slice(-20).reverse().forEach(function (e) {
        aBody += '<div style="display:flex;justify-content:space-between;font-size:10px;padding:3px 6px;border-bottom:1px solid #21262d;color:#cdcdcd">' +
          '<span>' + fmtDate(e.timestamp) + '</span>' +
          '<span style="color:#d4a843">' + esc(e.action || '—') + '</span>' +
          '<span style="color:#8b949e">' + esc(e.actor || '—') + '</span>' +
          '</div>';
      });
      aBody += '</div>';
    }
    html += section('Audit trail (last 20)', aBody);

    return html;
  }

  // ── Public API ────────────────────────────────────────────────────────
  function renderSelector() {
    var sel = document.getElementById('c360CustomerSelect');
    if (!sel) return;
    var ids = collectCustomerIds();
    if (ids.length === 0) {
      sel.innerHTML = '<option value="">No customers in scope</option>';
      return;
    }
    var current = sel.value;
    sel.innerHTML = '<option value="">Select a customer…</option>' +
      ids.map(function (id) {
        return '<option value="' + esc(id) + '"' + (id === current ? ' selected' : '') + '>' + esc(id) + '</option>';
      }).join('');
  }

  function render(customerId) {
    var el = document.getElementById('customer360Container');
    if (!el) return;
    if (!customerId) {
      el.innerHTML = '<div style="padding:20px;text-align:center;color:#8b949e;font-size:12px">Select a customer above to open their 360° view.</div>';
      return;
    }
    var profile = buildProfile(customerId);
    el.innerHTML = buildHtml(profile);
  }

  window.c360Refresh = function () {
    renderSelector();
    var sel = document.getElementById('c360CustomerSelect');
    render(sel ? sel.value : '');
  };
  window.c360Render = function (id) { render(id); };
  window.c360OnSelect = function () {
    var sel = document.getElementById('c360CustomerSelect');
    render(sel ? sel.value : '');
  };

  // Stubbed quick actions — MLRO can wire these to existing handlers later
  window.c360OpenIncident = function (id) {
    if (typeof toast === 'function') toast('Opening incident for ' + id, 'info');
    if (typeof switchTab === 'function') switchTab('incidents');
  };
  window.c360DraftStr = function (id) {
    if (typeof window.strDrafterOpen === 'function') {
      window.strDrafterOpen(id);
      return;
    }
    if (typeof toast === 'function') toast('STR drafter not yet available for ' + id, 'info');
  };

  // Hook up search box (filter customer list)
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'c360Search') {
      var q = (e.target.value || '').toLowerCase();
      var sel = document.getElementById('c360CustomerSelect');
      if (!sel) return;
      Array.prototype.forEach.call(sel.options, function (opt) {
        if (!opt.value) return;
        opt.style.display = opt.value.toLowerCase().indexOf(q) !== -1 ? '' : 'none';
      });
    }
  });

  // Hook tab-switch so the tab auto-populates on open
  document.addEventListener('click', function (e) {
    var tgt = e.target;
    if (!tgt) return;
    var arg = tgt.getAttribute && tgt.getAttribute('data-arg');
    if (arg === 'customer360') {
      setTimeout(function () { window.c360Refresh(); }, 50);
    }
  });
})();
