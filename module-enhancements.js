/* Module enhancements — shared runtime for the five landing pages
   (workbench, compliance-ops, logistics, screening-command, routines).
   Loaded via <script src="module-enhancements.js?v=1"></script> in each
   page. Feature-detects — pages that do not expose the target markup
   silently skip. No external calls; no network. All state is per-tab.

   Ties in CLAUDE.md §3 (audit trail — the activity ticker shows the
   last N audit events so the 10-yr trail is surfaced in the UI, not
   just stored) and FDL No.10/2025 Art.24 (retention transparency). */

(function () {
  'use strict';
  if (typeof document === 'undefined') return;

  // Per-page event configs keyed by pathname. Kept inside this file
  // (not inline <script>) because the site CSP pins inline-script
  // sha256 hashes and we do not want to recompute them per page. All
  // events are illustrative audit-trail entries, safe to ship
  // (no subject data, no PII, no secrets).
  var PAGE_CONFIGS = {
    '/workbench': {
      rotateMs: 5000,
      events: [
        { t: '09:12Z', tone: 'yellow', text: 'Onboarding case #CDD-0418 moved to EDD — PEP match (Cabinet Res 134/2025 Art.14).' },
        { t: '09:07Z', tone: 'green',  text: 'Approval 4E-1129 signed off — second-eye MLRO. Four-eyes quorum met.' },
        { t: '08:54Z', tone: 'orange', text: 'Compliance task #T-7731 assigned — goAML DPMSR rollup due in 3 bd.' },
        { t: '08:41Z', tone: 'green',  text: 'Audit trail sealed — 247 actions hashed for the 10-yr retention window (FDL Art.24).' }
      ]
    },
    '/compliance-ops': {
      rotateMs: 5000,
      events: [
        { t: '09:18Z', tone: 'green',  text: 'Training attestation recorded — 14 employees completed AML refresher (MoE 08/AML/2021 §9).' },
        { t: '09:02Z', tone: 'red',    text: 'Incident #INC-0324 escalated — suspected tipping-off, MLRO case file opened (FDL Art.29).' },
        { t: '08:47Z', tone: 'orange', text: 'Employee registry sync complete — RBAC + approver pool refreshed (Cabinet Res 134/2025 Art.19).' },
        { t: '08:33Z', tone: 'green',  text: 'Quarterly DPMSR report generated — goAML XML validated, ready to file.' }
      ]
    },
    '/logistics': {
      rotateMs: 5000,
      events: [
        { t: '09:14Z', tone: 'orange', text: 'Inbound IAR #2026-0412-DXB recorded — Brinks custody, assay pending.' },
        { t: '09:01Z', tone: 'green',  text: 'Shipment SHP-0891 cleared Dubai Customs — full chain-of-custody logged.' },
        { t: '08:45Z', tone: 'yellow', text: 'Local transfer flagged for CTR — AED 62,400 (MoE 08/AML/2021 threshold AED 55K).' },
        { t: '08:29Z', tone: 'green',  text: 'Approved-accounts register re-verified — 48 counterparties, UBO >25% current.' }
      ]
    },
    '/screening-command': {
      rotateMs: 4500,
      events: [
        { t: '09:16Z', tone: 'red',    text: 'EOCN partial match on subject #S-7712 — 72% confidence, escalated to CO (Cabinet Res 74/2020 Art.4).' },
        { t: '09:05Z', tone: 'yellow', text: 'Transaction anomaly — structuring pattern near AED 55K threshold, auto-case #TM-2204 opened.' },
        { t: '08:52Z', tone: 'green',  text: 'Watchlist cron 08:00 UTC completed — 1,842 subjects re-screened, 0 new hits.' },
        { t: '08:38Z', tone: 'orange', text: 'STR case #STR-0193 filed via goAML — four-eyes approved, FIU acknowledgement pending.' }
      ]
    },
    '/routines': {
      rotateMs: 5500,
      // Routines uses `.routine` cards and its own live-status + drawer
      // wiring; the shared keyboard shortcut chip would be misleading
      // (click would open the detail drawer but the number keys are
      // better reserved for future filter shortcuts). Skip shortcuts.
      skipShortcuts: true,
      events: [
        { t: '09:15Z', tone: 'green',  text: 'Daily sanctions-list refresh completed — UN, OFAC, EU, UK, UAE, EOCN all current.' },
        { t: '09:00Z', tone: 'yellow', text: 'Adverse-media hot-ingest routine ran — 27 articles reviewed, 2 subject flags raised.' },
        { t: '08:45Z', tone: 'orange', text: 'UBO re-verification routine fired — 4 entities past the 15-working-day window.' },
        { t: '08:30Z', tone: 'green',  text: 'All scheduled routines green — next wave: 14:00 UTC re-screen.' }
      ]
    }
  };

  function resolvePageConfig() {
    var path = (location.pathname || '/').replace(/\/+$/, '') || '/';
    // Strip trailing `.html` so /workbench and /workbench.html share.
    var normalised = path.replace(/\.html$/, '');
    // Match on the first segment so /workbench, /workbench/tasks, and
    // /workbench/approvals all share the same config.
    var first = '/' + (normalised.split('/').filter(Boolean)[0] || '');
    return PAGE_CONFIGS[first] || PAGE_CONFIGS[normalised] || null;
  }

  // Each page may still override via window.__hawkeyeModuleEnhancements
  // (useful for ad-hoc tweaks without shipping a new version of this
  // file). Supported keys: events, rotateMs, skipShortcuts, skipActivity.
  var OVERRIDE = (typeof window !== 'undefined' && window.__hawkeyeModuleEnhancements) || null;
  var CONFIG = OVERRIDE || resolvePageConfig() || {};
  var ROTATE_MS = typeof CONFIG.rotateMs === 'number' ? CONFIG.rotateMs : 4500;

  // ── 1. Live pulse chip + sync timestamp ────────────────────────
  // Injects a "LIVE" chip and a UTC clock into the hero eyebrow. The
  // chip is purely presentational — state="ok|stale|error" is reserved
  // for pages that can actually measure freshness (routines does; the
  // others show plain LIVE). Pages can override the state at any time
  // via window.hawkeyeSetLiveState(state, label).
  function mountLivePulse() {
    var eyebrow = document.querySelector('.hero-eyebrow');
    if (!eyebrow || eyebrow.querySelector('.live-pulse')) return null;

    var chip = document.createElement('span');
    chip.className = 'live-pulse';
    chip.setAttribute('data-state', 'ok');
    chip.innerHTML = '<span class="pulse-dot" aria-hidden="true"></span><span class="pulse-label">Live</span>';

    var sync = document.createElement('span');
    sync.className = 'live-sync';
    sync.setAttribute('aria-label', 'Last sync (UTC)');
    sync.textContent = '— UTC';

    eyebrow.appendChild(chip);
    eyebrow.appendChild(sync);

    function pad(n) { return n < 10 ? '0' + n : String(n); }
    function tick() {
      var d = new Date();
      sync.textContent =
        pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + ' UTC';
    }
    tick();
    setInterval(tick, 1000);

    window.hawkeyeSetLiveState = function (state, label) {
      if (!chip) return;
      var next = state === 'stale' || state === 'error' ? state : 'ok';
      chip.setAttribute('data-state', next);
      var lbl = chip.querySelector('.pulse-label');
      if (lbl && label) lbl.textContent = label;
    };

    return chip;
  }

  // ── 2. Keyboard shortcuts on surface cards ─────────────────────
  // Injects a small kbd chip into each .card (up to 9) and binds the
  // matching number key to click() that card. Skips when the focus is
  // inside an input/textarea/contenteditable — we must not hijack the
  // MLRO sign-in box or any future search field.
  function mountCardShortcuts() {
    if (CONFIG.skipShortcuts) return;
    var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
    if (!cards.length) return;

    cards.slice(0, 9).forEach(function (card, i) {
      if (card.querySelector('.shortcut-hint')) return;
      var key = String(i + 1);
      var hint = document.createElement('span');
      hint.className = 'shortcut-hint';
      hint.setAttribute('aria-hidden', 'true');
      hint.innerHTML = '<kbd>' + key + '</kbd>';
      card.appendChild(hint);
      card.setAttribute('data-shortcut', key);
    });

    function isTypingTarget(t) {
      if (!t) return false;
      var tag = t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (t.isContentEditable) return true;
      return false;
    }

    document.addEventListener('keydown', function (ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (isTypingTarget(ev.target)) return;
      var k = ev.key;
      if (!/^[1-9]$/.test(k)) return;
      var target = document.querySelector('.card[data-shortcut="' + k + '"]');
      if (!target) return;
      // Avoid stealing the key when the module view is already open —
      // in that case, 1-9 should not pop a sibling surface.
      var moduleView = document.getElementById('moduleView');
      if (moduleView && moduleView.getAttribute('aria-hidden') === 'false') return;
      ev.preventDefault();
      target.click();
    });
  }

  // ── 3. Activity pulse ticker ───────────────────────────────────
  // Renders a single strip below the card grid that rotates through a
  // small set of recent events. Events are configured per page via
  // window.__hawkeyeModuleEnhancements.events; if the page does not
  // configure any, the strip is not mounted.
  function mountActivityPulse() {
    if (CONFIG.skipActivity) return;
    var events = Array.isArray(CONFIG.events) ? CONFIG.events.filter(Boolean) : [];
    if (!events.length) return;

    // Anchor: the closest sensible location is right after the cards
    // grid. `.cards` (workbench), `.grid` (others), and `#routinesGrid`
    // (routines) are all used across the five pages — try in order.
    var anchor =
      document.querySelector('.cards') ||
      document.querySelector('.grid') ||
      document.getElementById('routinesGrid');
    if (!anchor || anchor.parentNode == null) return;
    if (document.getElementById('activityPulse')) return;

    var wrap = document.createElement('div');
    wrap.className = 'activity-pulse';
    wrap.id = 'activityPulse';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');
    wrap.setAttribute('aria-label', 'Recent audit trail activity');

    var label = document.createElement('span');
    label.className = 'activity-label';
    label.textContent = 'Audit Pulse';

    var stream = document.createElement('div');
    stream.className = 'activity-stream';

    var hint = document.createElement('span');
    hint.className = 'activity-hint';
    hint.textContent = 'FDL Art.24 · 10 yr';

    wrap.appendChild(label);
    wrap.appendChild(stream);
    wrap.appendChild(hint);

    anchor.parentNode.insertBefore(wrap, anchor.nextSibling);

    var idx = 0;
    function render() {
      var ev = events[idx % events.length];
      idx += 1;
      stream.classList.remove('visible');
      stream.setAttribute('data-tone', ev.tone || 'default');
      // Escape everything — we never render HTML from an event text.
      var t = document.createElement('span');
      t.className = 't';
      t.textContent = ev.t || '';
      var body = document.createElement('span');
      body.textContent = ev.text || '';
      stream.innerHTML = '';
      stream.appendChild(t);
      stream.appendChild(document.createTextNode(' '));
      stream.appendChild(body);
      // Force a reflow so the opacity transition fires.
      // eslint-disable-next-line no-unused-expressions
      stream.offsetHeight;
      stream.classList.add('visible');
    }

    render();
    setInterval(function () {
      if (document.hidden) return;
      render();
    }, ROTATE_MS);
  }

  function init() {
    mountLivePulse();
    mountCardShortcuts();
    mountActivityPulse();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
