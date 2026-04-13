// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL COMPLIANCE STATUS BAR
// Auto-refreshing live KPI strip — pulls from localStorage keys that the
// vanilla SPA modules already write. No network calls. Refreshes every 30s
// and on every tab switch via a hook on window.switchTab.
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

  function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = String(val);
  }

  function setColor(id, val, threshold, warnColor, okColor) {
    var el = document.getElementById(id);
    if (!el) return;
    el.style.color = val >= threshold ? warnColor : okColor;
  }

  function gsbRefresh() {
    // Approvals
    var approvals = safeJson('fgl_approvals', []);
    var pending = approvals.filter(function (a) { return a.status === 'Pending'; }).length;
    setText('gsbApprovals', pending);
    setColor('gsbApprovals', pending, 5, '#D94F4F', '#4A8FC1');

    // SLA breached approvals
    var nowMs = Date.now();
    var breaches = approvals.filter(function (a) {
      if (a.status !== 'Pending' || !a.createdAt || !a.slaHours) return false;
      var dueMs = new Date(a.createdAt).getTime() + a.slaHours * 3600 * 1000;
      return nowMs > dueMs;
    }).length;
    setText('gsbSlaBreach', breaches);

    // Workflows fired today (workflow audit log written by workflow-engine.js)
    var wfLog = safeJson('fgl_workflow_audit', []);
    var today = new Date().toISOString().slice(0, 10);
    var todayCount = wfLog.filter(function (w) {
      return w && w.timestamp && w.timestamp.slice(0, 10) === today;
    }).length;
    setText('gsbWorkflows', todayCount);

    // Red flags hit (custom flag detections)
    var flagHits = safeJson('fgl_flag_hits', []);
    setText('gsbRedFlags', Array.isArray(flagHits) ? flagHits.length : 0);

    // Sanctions matches (last 30d)
    var sanctions = safeJson('fgl_sanctions_matches', []);
    var thirtyD = nowMs - 30 * 24 * 3600 * 1000;
    var recentSanctions = sanctions.filter(function (s) {
      if (!s || !s.detectedAt) return false;
      return new Date(s.detectedAt).getTime() >= thirtyD;
    }).length;
    setText('gsbSanctions', recentSanctions);

    // ESG critical risk customers
    var esg = safeJson('fgl_esg_records', []);
    var esgCrit = esg.filter(function (r) {
      return r && r.score && r.score.riskLevel === 'critical';
    }).length;
    setText('gsbEsgCritical', esgCrit);

    // Open incidents
    var incidents = safeJson('fgl_incidents', []);
    var openInc = incidents.filter(function (i) {
      return i && i.status && i.status !== 'Closed' && i.status !== 'closed' && i.status !== 'resolved';
    }).length;
    setText('gsbIncidents', openInc);

    // STR cases
    var strs = safeJson('fgl_str_cases', []);
    setText('gsbStrCases', Array.isArray(strs) ? strs.length : 0);

    // Heartbeat
    var beat = document.getElementById('gsbHeartbeat');
    if (beat) {
      var t = new Date().toLocaleTimeString();
      beat.textContent = '⚡ ' + t;
    }
  }

  window.gsbRefresh = gsbRefresh;

  // Hook into switchTab so we refresh on every navigation
  function installSwitchTabHook() {
    if (typeof window.switchTab !== 'function') return false;
    if (window._gsbHookInstalled) return true;
    var orig = window.switchTab;
    window.switchTab = function () {
      var r = orig.apply(this, arguments);
      try { gsbRefresh(); } catch (_) {}
      return r;
    };
    window._gsbHookInstalled = true;
    return true;
  }

  function init() {
    gsbRefresh();
    // Auto-refresh every 30 seconds
    setInterval(gsbRefresh, 30000);
    // Try to install the switchTab hook now and also on a short delay
    // since app-boot.js may not have defined it yet at script-eval time.
    if (!installSwitchTabHook()) {
      setTimeout(installSwitchTabHook, 500);
      setTimeout(installSwitchTabHook, 1500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
