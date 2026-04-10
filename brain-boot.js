/**
 * Brain Boot — installs window.__brainNotify() for legacy JS modules.
 *
 * The React/TS side uses src/services/brainBridge.ts, which is nice and
 * typed. The root-level *.js compliance modules (compliance-suite.js,
 * threshold-monitor.js, tfs-refresh.js, workflow-engine.js) are plain
 * non-bundled browser scripts and can't `import` TS. This file gives
 * them a single global hook: window.__brainNotify(event).
 *
 * Contract: fire-and-forget. Never throws, never blocks, never logs PII.
 *
 * Server: POST /api/brain  →  netlify/functions/brain.mts
 */
(function () {
  if (typeof window === 'undefined') return;
  if (typeof window.__brainNotify === 'function') return; // already installed

  var ENDPOINT = '/api/brain';
  var VALID_KINDS = {
    str_saved: 1,
    sanctions_match: 1,
    threshold_breach: 1,
    deadline_missed: 1,
    cdd_overdue: 1,
    evidence_break: 1,
    manual: 1,
  };
  var VALID_SEVERITIES = { info: 1, low: 1, medium: 1, high: 1, critical: 1 };

  function sanitize(s, cap) {
    if (typeof s !== 'string') return '';
    return s.replace(/[\r\n\t\u0000-\u001f]/g, ' ').trim().slice(0, cap);
  }

  function getToken() {
    try {
      if (typeof localStorage === 'undefined') return null;
      return localStorage.getItem('auth.token');
    } catch (_e) {
      return null;
    }
  }

  /**
   * Fire-and-forget notification to the compliance brain.
   * @param {object} event
   * @returns {boolean} true if dispatched, false if rejected locally
   */
  window.__brainNotify = function brainNotify(event) {
    try {
      if (!event || typeof event !== 'object') return false;
      if (!VALID_KINDS[event.kind]) return false;
      if (!VALID_SEVERITIES[event.severity]) return false;

      var cleaned = {
        kind: event.kind,
        severity: event.severity,
        summary: sanitize(event.summary, 500),
      };
      if (!cleaned.summary) return false;
      if (event.subject) cleaned.subject = sanitize(event.subject, 200);
      if (event.refId) cleaned.refId = sanitize(event.refId, 64);
      if (typeof event.matchScore === 'number' && isFinite(event.matchScore)) {
        cleaned.matchScore = Math.max(0, Math.min(1, event.matchScore));
      }
      if (event.meta && typeof event.meta === 'object') cleaned.meta = event.meta;

      var token = getToken();
      if (!token) return false;

      // keepalive so the POST survives page navigation (e.g. after saving a case
      // the user may navigate away before the brain responds).
      fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify(cleaned),
        keepalive: true,
      }).catch(function () {
        /* brain is best-effort — never surface errors to the UI */
      });

      return true;
    } catch (_err) {
      return false;
    }
  };

  // Diagnostic — exposed so ops can verify the bridge from the console.
  window.__brainNotify.version = '1.0.0';
  window.__brainNotify.endpoint = ENDPOINT;
})();
