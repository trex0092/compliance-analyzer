/**
 * Compliance Intelligence Module v1.0
 * Inspired by thedotmack/claude-mem (Knowledge Agent) + thedotmack/aims (Agent Feed + Blockchain Anchoring)
 *
 * Three pillars:
 * 1. Knowledge Base — Queryable corpus from compliance data (cases, screenings, audit trail)
 * 2. Audit Anchoring — SHA-256 hash-chain with verifiable anchors for immutable audit proof
 * 3. Agent Feed — Real-time compliance event timeline with automated alerts
 */
const ComplianceIntelligence = (function () {
  'use strict';

  const FEED_KEY = 'fgl_agent_feed';
  const ANCHOR_KEY = 'fgl_audit_anchors';
  const MAX_FEED = 500;
  const MAX_ANCHORS = 200;

  // ═══════════════════════════════════════════════════════════════
  // PILLAR 1: COMPLIANCE KNOWLEDGE BASE
  // Query all compliance data with structured search results
  // ═══════════════════════════════════════════════════════════════

  function buildCorpus() {
    var corpus = [];

    // Cases
    var ops = safeParse('fgl_compliance_ops', {});
    (ops.cases || []).forEach(function (c) {
      corpus.push({
        type: 'case',
        id: c.id || c.caseId,
        title: c.title || c.type || 'Case',
        content: JSON.stringify(c),
        severity: c.severity || 'medium',
        status: c.status || 'OPEN',
        date: c.createdAt || c.date || '',
        tags: ['case', c.status, c.severity, c.type].filter(Boolean)
      });
    });

    // Screenings
    (ops.screenings || []).forEach(function (s) {
      corpus.push({
        type: 'screening',
        id: s.id || ('SCR-' + (s.date || '').slice(0, 10)),
        title: (s.entity || s.name || 'Unknown') + ' — ' + (s.result || 'Screened'),
        content: JSON.stringify(s),
        severity: s.matchCount > 0 ? 'high' : 'low',
        status: s.result || 'CLEAR',
        date: s.date || s.ts || '',
        tags: ['screening', s.result, s.entity, s.name].filter(Boolean)
      });
    });

    // Audit trail
    (ops.auditTrail || []).forEach(function (a) {
      corpus.push({
        type: 'audit',
        id: a.hash || '',
        title: a.action || 'Audit Event',
        content: JSON.stringify(a),
        severity: 'low',
        status: 'logged',
        date: a.ts || '',
        tags: ['audit', a.action].filter(Boolean)
      });
    });

    // goAML filings
    safeParse('fgl_goaml_reports', []).forEach(function (g) {
      corpus.push({
        type: 'filing',
        id: g.reportId || g.id || '',
        title: (g.type || 'Filing') + ' — ' + (g.subject || ''),
        content: JSON.stringify(g),
        severity: 'medium',
        status: 'filed',
        date: g.date || '',
        tags: ['filing', 'goaml', g.type].filter(Boolean)
      });
    });

    // Threshold alerts
    safeParse('fgl_threshold_alerts', []).forEach(function (t) {
      corpus.push({
        type: 'alert',
        id: t.id || '',
        title: (t.type || 'Alert') + ' — AED ' + (t.amount || ''),
        content: JSON.stringify(t),
        severity: t.severity || 'high',
        status: t.status || 'active',
        date: t.date || t.ts || '',
        tags: ['alert', 'threshold', t.type].filter(Boolean)
      });
    });

    // Gap register
    safeParse('fgl_gap_register', []).forEach(function (g) {
      corpus.push({
        type: 'gap',
        id: g.id || '',
        title: g.title || g.description || 'Compliance Gap',
        content: JSON.stringify(g),
        severity: g.severity || g.priority || 'medium',
        status: g.status || 'open',
        date: g.createdAt || g.date || '',
        tags: ['gap', g.severity, g.status].filter(Boolean)
      });
    });

    // Shipments / transactions
    safeParse('fgl_shipments', []).forEach(function (s) {
      corpus.push({
        type: 'transaction',
        id: s.id || '',
        title: (s.type || 'Transaction') + ' — ' + (s.counterparty || s.supplier || s.customer || ''),
        content: JSON.stringify(s),
        severity: 'low',
        status: s.status || '',
        date: s.date || '',
        tags: ['transaction', 'shipment', s.type, s.counterparty, s.supplier, s.customer].filter(Boolean)
      });
    });

    return corpus;
  }

  function queryKnowledgeBase(query) {
    if (!query || !query.trim()) return [];
    var corpus = buildCorpus();
    var terms = query.toLowerCase().split(/\s+/).filter(function (t) { return t.length > 1; });

    var scored = corpus.map(function (doc) {
      var score = 0;
      var searchText = (doc.title + ' ' + doc.tags.join(' ') + ' ' + doc.type + ' ' + doc.status + ' ' + doc.content).toLowerCase();

      terms.forEach(function (term) {
        // Title match (highest weight)
        if (doc.title.toLowerCase().indexOf(term) >= 0) score += 10;
        // Tag match
        if (doc.tags.some(function (t) { return t && t.toLowerCase().indexOf(term) >= 0; })) score += 5;
        // Type match
        if (doc.type.toLowerCase() === term) score += 8;
        // Status match
        if (doc.status.toLowerCase().indexOf(term) >= 0) score += 4;
        // Content match
        var contentMatches = (searchText.match(new RegExp(escapeRegex(term), 'gi')) || []).length;
        score += Math.min(contentMatches, 5);
      });

      return { doc: doc, score: score };
    }).filter(function (r) { return r.score > 0; });

    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, 25).map(function (r) { return r.doc; });
  }

  // ═══════════════════════════════════════════════════════════════
  // PILLAR 2: AUDIT ANCHORING (Blockchain-style)
  // SHA-256 hash-chain with verifiable anchors
  // ═══════════════════════════════════════════════════════════════

  function getAnchors() {
    return safeParse(ANCHOR_KEY, []);
  }
  function saveAnchors(arr) {
    localStorage.setItem(ANCHOR_KEY, JSON.stringify(arr.slice(0, MAX_ANCHORS)));
  }

  // Create a verifiable anchor point from current audit state
  async function createAnchor(label) {
    var ops = safeParse('fgl_compliance_ops', {});
    var trail = ops.auditTrail || [];
    var now = new Date().toISOString();

    // Build anchor payload
    var payload = {
      label: label || 'Compliance State Anchor',
      timestamp: now,
      auditEntryCount: trail.length,
      lastAuditHash: trail.length > 0 ? trail[trail.length - 1].hash : 'GENESIS',
      lastAuditAction: trail.length > 0 ? trail[trail.length - 1].action : 'none',
      casesCount: (ops.cases || []).length,
      screeningsCount: (ops.screenings || []).length,
      openCases: (ops.cases || []).filter(function (c) { return c.status !== 'CLOSED'; }).length,
      goamlFilings: safeParse('fgl_goaml_reports', []).length,
      gapCount: safeParse('fgl_gap_register', []).length
    };

    // Generate SHA-256 hash of payload
    var payloadStr = JSON.stringify(payload);
    var hash = await sha256(payloadStr);

    // Chain to previous anchor
    var anchors = getAnchors();
    var prevHash = anchors.length > 0 ? anchors[0].hash : 'GENESIS_ANCHOR';

    var anchor = {
      id: 'ANC-' + Date.now(),
      hash: hash,
      prevAnchorHash: prevHash,
      payload: payload,
      chainLength: anchors.length + 1,
      createdAt: now
    };

    anchors.unshift(anchor);
    saveAnchors(anchors);

    // Also log to agent feed
    addFeedEvent('anchor', 'Audit anchor created: ' + hash.slice(0, 16) + '...', {
      anchorId: anchor.id,
      entries: payload.auditEntryCount,
      label: label
    });

    toast('Audit anchor created: ' + anchor.id, 'ok');
    return anchor;
  }

  // Verify anchor chain integrity
  async function verifyAnchors() {
    var anchors = getAnchors();
    if (anchors.length === 0) return { valid: true, message: 'No anchors to verify', count: 0 };

    var issues = [];

    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      // Verify hash matches payload
      var recomputed = await sha256(JSON.stringify(a.payload));
      if (recomputed !== a.hash) {
        issues.push('Anchor ' + a.id + ': hash mismatch (tampered payload)');
      }
      // Verify chain link
      if (i < anchors.length - 1) {
        if (a.prevAnchorHash !== anchors[i + 1].hash) {
          issues.push('Anchor ' + a.id + ': chain broken (prev hash mismatch)');
        }
      }
    }

    var result = {
      valid: issues.length === 0,
      count: anchors.length,
      issues: issues,
      message: issues.length === 0
        ? 'All ' + anchors.length + ' anchors verified — chain intact'
        : issues.length + ' integrity issues found'
    };

    addFeedEvent('verify', result.message, { valid: result.valid, count: result.count });
    toast(result.message, result.valid ? 'ok' : 'error');
    return result;
  }

  // Export anchor chain as verifiable JSON
  function exportAnchors() {
    var anchors = getAnchors();
    var exportData = {
      entity: (safeParse('fgl_companies', [])[Number(localStorage.getItem('fgl_active_company') || '0')] || {}).name || 'Unknown',
      exportedAt: new Date().toISOString(),
      anchorCount: anchors.length,
      anchors: anchors,
      verification: 'To verify: recompute SHA-256 of each anchor.payload and compare to anchor.hash. Verify anchor.prevAnchorHash matches previous anchor.hash.'
    };

    var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Audit_Anchor_Chain_' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); document.body.removeChild(a); }, 100);
    toast('Anchor chain exported', 'ok');
  }

  // SHA-256 using Web Crypto API
  async function sha256(message) {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      var msgBuffer = new TextEncoder().encode(message);
      var hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      var hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }
    // Fallback: simple hash for environments without Web Crypto
    return simpleHash(message);
  }

  function simpleHash(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      var char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(16, '0');
  }

  // ═══════════════════════════════════════════════════════════════
  // PILLAR 3: AGENT ALERT FEED
  // Real-time compliance event timeline
  // ═══════════════════════════════════════════════════════════════

  function getFeed() {
    return safeParse(FEED_KEY, []);
  }
  function saveFeed(arr) {
    localStorage.setItem(FEED_KEY, JSON.stringify(arr.slice(0, MAX_FEED)));
  }

  function addFeedEvent(type, message, data) {
    var feed = getFeed();
    feed.unshift({
      id: 'EVT-' + Date.now(),
      type: type,
      message: message,
      data: data || {},
      timestamp: new Date().toISOString(),
      agent: 'Hawkeye Sterling v2'
    });
    saveFeed(feed);
    return feed[0];
  }

  // Auto-scan: generate feed events from current compliance state
  function runComplianceScan() {
    var ops = safeParse('fgl_compliance_ops', {});
    var events = [];

    // Check for open high-severity cases
    var highCases = (ops.cases || []).filter(function (c) {
      return c.status !== 'CLOSED' && (c.severity === 'critical' || c.severity === 'high');
    });
    if (highCases.length > 0) {
      events.push(addFeedEvent('alert', highCases.length + ' high/critical cases require attention', { count: highCases.length }));
    }

    // Check screening matches
    var recentMatches = (ops.screenings || []).filter(function (s) {
      return (s.matchCount > 0 || s.result === 'MATCH');
    });
    if (recentMatches.length > 0) {
      events.push(addFeedEvent('screening', recentMatches.length + ' sanctions matches in screening history — verify resolution', { count: recentMatches.length }));
    }

    // Check pending CTRs
    var pendingCTR = safeParse('fgl_ctr_queue', []).filter(function (c) { return c.status !== 'FILED'; });
    if (pendingCTR.length > 0) {
      events.push(addFeedEvent('filing', pendingCTR.length + ' CTR filings pending — submit via goAML', { count: pendingCTR.length }));
    }

    // Check gaps
    var openGaps = safeParse('fgl_gap_register', []).filter(function (g) {
      return g.status !== 'closed' && g.status !== 'remediated';
    });
    if (openGaps.length > 0) {
      events.push(addFeedEvent('gap', openGaps.length + ' compliance gaps open — remediation required', { count: openGaps.length }));
    }

    // Check threshold alerts
    var thresholds = safeParse('fgl_threshold_alerts', []);
    var structuring = thresholds.filter(function (t) { return t.type === 'STRUCTURING'; });
    if (structuring.length > 0) {
      events.push(addFeedEvent('critical', structuring.length + ' structuring patterns detected — investigate per FDL Art.15-16', { count: structuring.length }));
    }

    // Audit trail check
    var trail = ops.auditTrail || [];
    events.push(addFeedEvent('status', 'Compliance scan complete: ' + (ops.cases || []).length + ' cases, ' +
      (ops.screenings || []).length + ' screenings, ' + trail.length + ' audit entries', {
      cases: (ops.cases || []).length,
      screenings: (ops.screenings || []).length,
      auditEntries: trail.length
    }));

    toast('Compliance scan complete — ' + events.length + ' events generated', 'ok');
    return events;
  }

  // ═══════════════════════════════════════════════════════════════
  // UI RENDERING
  // ═══════════════════════════════════════════════════════════════

  function renderIntelligenceTab() {
    return renderKnowledgeBaseSection() + renderAnchorSection() + renderFeedSection();
  }

  // Knowledge Base UI
  function renderKnowledgeBaseSection() {
    return '<div class="card" style="margin-bottom:16px">' +
      '<div class="top-bar" style="margin-bottom:12px">' +
      '<span class="sec-title" style="margin:0;border:none;padding:0">Compliance Knowledge Base</span>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:12px">' +
      '<input type="text" id="kbQuery" placeholder="Search cases, screenings, filings, alerts, gaps..." ' +
      'style="flex:1;padding:8px 12px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:13px" ' +
      'onkeydown="if(event.key===\'Enter\')ComplianceIntelligence.search()" />' +
      '<button class="btn btn-sm btn-blue" onclick="ComplianceIntelligence.search()">Search</button>' +
      '<button class="btn btn-sm btn-green" onclick="ComplianceIntelligence.runScan()">Scan</button>' +
      '</div>' +
      '<div style="font-size:11px;color:#8b949e;margin-bottom:8px">' +
      'Query your compliance corpus: try "sanctions match", "open cases", "high risk", "CTR pending", "gap critical"' +
      '</div>' +
      '<div id="kbResults"></div>' +
      '</div>';
  }

  function doSearch() {
    var input = document.getElementById('kbQuery');
    if (!input) return;
    var query = input.value.trim();
    if (!query) { toast('Enter a search query', 'warn'); return; }

    var results = queryKnowledgeBase(query);
    var el = document.getElementById('kbResults');
    if (!el) return;

    if (results.length === 0) {
      el.innerHTML = '<div style="padding:12px;color:#8b949e;text-align:center">No results found for "' + esc(query) + '"</div>';
      return;
    }

    el.innerHTML = '<div style="font-size:11px;color:#8b949e;margin-bottom:8px">' + results.length + ' results for "' + esc(query) + '"</div>' +
      results.map(function (r) {
        var typeIcon = { case: '📁', screening: '🔍', audit: '📝', filing: '📨', alert: '⚠️', gap: '🔴', transaction: '💰' }[r.type] || '📄';
        var sevColor = r.severity === 'critical' ? '#f85149' : r.severity === 'high' ? '#db6d28' : r.severity === 'medium' ? '#d29922' : '#8b949e';
        return '<div style="padding:8px 12px;border-bottom:1px solid #21262d;display:flex;align-items:flex-start;gap:8px">' +
          '<span style="font-size:16px">' + typeIcon + '</span>' +
          '<div style="flex:1;min-width:0">' +
          '<div style="font-size:13px;font-weight:500;color:#e6edf3">' + esc(r.title) + '</div>' +
          '<div style="font-size:11px;color:#8b949e;margin-top:2px">' +
          '<span style="color:' + sevColor + ';text-transform:uppercase;font-weight:600">' + esc(r.severity) + '</span>' +
          ' · ' + esc(r.type) + ' · ' + esc(r.status) +
          (r.date ? ' · ' + esc(String(r.date).slice(0, 10)) : '') +
          '</div></div></div>';
      }).join('');
  }

  // Anchor UI
  function renderAnchorSection() {
    var anchors = getAnchors();
    var anchorRows = anchors.slice(0, 10).map(function (a) {
      return '<tr>' +
        '<td style="font-family:monospace;font-size:10px;color:#58a6ff">' + esc(a.id) + '</td>' +
        '<td style="font-size:11px">' + esc(a.payload.label) + '</td>' +
        '<td style="font-family:monospace;font-size:10px">' + esc(a.hash.slice(0, 16)) + '...</td>' +
        '<td style="font-size:11px">' + a.payload.auditEntryCount + ' entries</td>' +
        '<td style="font-size:11px">' + esc(a.createdAt.slice(0, 16).replace('T', ' ')) + '</td>' +
        '</tr>';
    }).join('');

    return '<div class="card" style="margin-bottom:16px">' +
      '<div class="top-bar" style="margin-bottom:12px">' +
      '<span class="sec-title" style="margin:0;border:none;padding:0">Audit Anchoring (SHA-256 Chain)</span>' +
      '<div style="display:flex;gap:6px">' +
      '<button class="btn btn-sm btn-green" onclick="ComplianceIntelligence.anchor()">Create Anchor</button>' +
      '<button class="btn btn-sm btn-blue" onclick="ComplianceIntelligence.verify()">Verify Chain</button>' +
      '<button class="btn btn-sm btn-blue" onclick="ComplianceIntelligence.exportAnchors()">Export</button>' +
      '</div></div>' +
      '<div style="font-size:11px;color:#8b949e;margin-bottom:8px">' +
      'Immutable compliance checkpoints. Each anchor hashes the current audit state and chains to the previous anchor — tamper-proof compliance proof.' +
      '</div>' +
      '<div id="anchorVerifyResult"></div>' +
      (anchors.length > 0 ?
        '<table style="width:100%;font-size:12px;border-collapse:collapse">' +
        '<thead><tr>' +
        '<th style="text-align:left;padding:6px;border-bottom:1px solid #30363d;color:#8b949e">ID</th>' +
        '<th style="text-align:left;padding:6px;border-bottom:1px solid #30363d;color:#8b949e">Label</th>' +
        '<th style="text-align:left;padding:6px;border-bottom:1px solid #30363d;color:#8b949e">Hash</th>' +
        '<th style="text-align:left;padding:6px;border-bottom:1px solid #30363d;color:#8b949e">Audit State</th>' +
        '<th style="text-align:left;padding:6px;border-bottom:1px solid #30363d;color:#8b949e">Created</th>' +
        '</tr></thead><tbody>' + anchorRows + '</tbody></table>' :
        '<div style="padding:12px;color:#8b949e;text-align:center;font-size:12px">No anchors yet. Create one to snapshot your current compliance state.</div>'
      ) +
      '</div>';
  }

  // Feed UI
  function renderFeedSection() {
    var feed = getFeed();
    var feedItems = feed.slice(0, 20).map(function (e) {
      var typeIcon = { alert: '🚨', screening: '🔍', filing: '📨', gap: '🔴', critical: '⛔', status: '✅', anchor: '⚓', verify: '🔗' }[e.type] || '📢';
      var typeColor = { alert: '#db6d28', screening: '#58a6ff', filing: '#3fb950', gap: '#f85149', critical: '#f85149', status: '#8b949e', anchor: '#bc8cff', verify: '#58a6ff' }[e.type] || '#8b949e';
      return '<div style="padding:8px 0;border-bottom:1px solid #21262d;display:flex;gap:8px;align-items:flex-start">' +
        '<span style="font-size:14px">' + typeIcon + '</span>' +
        '<div style="flex:1">' +
        '<div style="font-size:12px;color:#e6edf3">' + esc(e.message) + '</div>' +
        '<div style="font-size:10px;color:#484f58;margin-top:2px">' +
        '<span style="color:' + typeColor + ';text-transform:uppercase;font-weight:600">' + esc(e.type) + '</span>' +
        ' · ' + esc(e.agent) + ' · ' + esc(e.timestamp.slice(0, 16).replace('T', ' ')) +
        '</div></div></div>';
    }).join('');

    return '<div class="card">' +
      '<div class="top-bar" style="margin-bottom:12px">' +
      '<span class="sec-title" style="margin:0;border:none;padding:0">Agent Feed</span>' +
      '<div style="display:flex;gap:6px">' +
      '<button class="btn btn-sm btn-blue" onclick="ComplianceIntelligence.runScan()">Run Scan</button>' +
      '<button class="btn btn-sm btn-red" onclick="ComplianceIntelligence.clearFeed()">Clear</button>' +
      '</div></div>' +
      '<div style="font-size:11px;color:#8b949e;margin-bottom:8px">' +
      'Automated compliance event stream — AI agent broadcasts compliance status, alerts, and actions.' +
      '</div>' +
      (feed.length > 0 ? feedItems :
        '<div style="padding:12px;color:#8b949e;text-align:center;font-size:12px">No events yet. Run a compliance scan to populate the feed.</div>'
      ) +
      '</div>';
  }

  // Wrapper for anchor with label prompt
  function anchorWithPrompt() {
    var label = prompt('Anchor label (e.g. "Q1 2026 Audit", "Pre-MoE Inspection"):');
    if (label === null) return;
    createAnchor(label || 'Manual Anchor');
    refreshTab();
  }

  // Verify and show result
  async function verifyAndShow() {
    var result = await verifyAnchors();
    var el = document.getElementById('anchorVerifyResult');
    if (el) {
      var color = result.valid ? '#3fb950' : '#f85149';
      el.innerHTML = '<div style="padding:8px 12px;border-radius:6px;border:1px solid ' + color + ';background:' + color + '15;margin-bottom:8px;font-size:12px">' +
        '<span style="color:' + color + ';font-weight:600">' + (result.valid ? '✓ VERIFIED' : '✗ INTEGRITY ISSUE') + '</span> — ' +
        esc(result.message) +
        (result.issues.length > 0 ? '<br>' + result.issues.map(function (i) { return '• ' + esc(i); }).join('<br>') : '') +
        '</div>';
    }
  }

  function clearFeed() {
    localStorage.removeItem(FEED_KEY);
    toast('Agent feed cleared', 'ok');
    refreshTab();
  }

  function refreshTab() {
    var el = document.getElementById('tab-intelligence');
    if (el) el.innerHTML = renderIntelligenceTab();
  }

  // ─── UTILITIES ───────────────────────────────────────────────
  function safeParse(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
    catch (_) { return fallback; }
  }

  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function toast(msg, type) {
    if (typeof window.toast === 'function') { window.toast(msg, type); return; }
    console.log('[Intelligence] ' + type + ': ' + msg);
  }

  // ─── PUBLIC API ──────────────────────────────────────────────
  return {
    // Knowledge Base
    buildCorpus: buildCorpus,
    query: queryKnowledgeBase,
    search: doSearch,

    // Audit Anchoring
    anchor: anchorWithPrompt,
    verify: verifyAndShow,
    createAnchor: createAnchor,
    verifyAnchors: verifyAnchors,
    exportAnchors: exportAnchors,
    getAnchors: getAnchors,

    // Agent Feed
    getFeed: getFeed,
    addEvent: addFeedEvent,
    runScan: function () { runComplianceScan(); refreshTab(); },
    clearFeed: clearFeed,

    // UI
    renderIntelligenceTab: renderIntelligenceTab
  };
})();

window.ComplianceIntelligence = ComplianceIntelligence;
