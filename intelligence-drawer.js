/**
 * Hawkeye Sterling — Intelligence Drawer.
 *
 * Shared floating brain panel that turns any landing into a live
 * analytics workspace. Reads the landing's own localStorage data,
 * feeds it through the client-side super-brain (brain-boot.js), and
 * surfaces reasoning + deep-thinking + data analytics on demand.
 *
 * Layered intelligence — cheap → expensive:
 *   1. Local typology pre-scan (window.__brainTypology — 47 rules, zero API cost)
 *   2. Per-landing preset analyses (structuring, Benford, velocity, PEP, layering, etc.)
 *   3. Shapley XAI provenance (window.__brainXAI)
 *   4. Full MegaBrain analysis (window.__brainAnalyze — API call, advisor-tool beta)
 *   5. Entity memory recall (window.__brainMemory)
 *
 * Regulatory basis: FDL No.(10)/2025 Art.20-21 (CO duties),
 *                   Art.26-27 (STR filing), Art.29 (no tipping off),
 *                   Cabinet Res 134/2025 Art.19 (internal review),
 *                   Cabinet Res 74/2020 Art.4-7 (24h freeze),
 *                   FATF Rec 10, 12, 15, 20, 22, NIST AI RMF.
 *
 * Registry contract:
 *   window.__intelligenceDrawer.mount(hostKey, config)
 *     hostKey: 'screening-command' | 'workbench' | ... (landing slug)
 *     config:  {
 *       storageKeys: { subjects, transactions, strCases, watchlist, ... },
 *       presets:     [{ id, label, fn: (ctx) => { summary, details, citations } }],
 *       entityBuilder: (ctx) => entity,    // used for __brainAnalyze
 *       txBuilder:     (ctx) => txList,    // used for __brainTypology.scan
 *     }
 *
 * CSP: external file, no eval, no inline handlers, no external fetches
 * beyond the brain-boot endpoints already allowlisted.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  if (window.__intelligenceDrawer) return;

  // ─── Helpers ─────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function safeParse(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (_) { return fallback; }
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.getUTCDate().toString().padStart(2, '0') + '/' +
        (d.getUTCMonth() + 1).toString().padStart(2, '0') + '/' + d.getUTCFullYear();
    } catch (_) { return iso; }
  }
  function pct(v) { return (Math.max(0, Math.min(1, v || 0)) * 100).toFixed(1) + '%'; }
  function clone(x) { try { return JSON.parse(JSON.stringify(x)); } catch (_) { return x; } }

  // ─── Drawer DOM (singleton) ──────────────────────────────────────
  var drawer = null;
  var body = null;
  var config = null;
  var landing = null;
  var lastCtx = null;

  function ensureDrawer() {
    if (drawer) return drawer;
    injectStyles();
    drawer = document.createElement('aside');
    drawer.className = 'intel-drawer';
    drawer.setAttribute('role', 'region');
    drawer.setAttribute('aria-label', 'Intelligence Drawer');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.innerHTML = [
      '<header class="intel-head">',
        '<div class="intel-brand">',
          '<span class="intel-dot"></span>',
          '<span class="intel-brand-t">INTELLIGENCE</span>',
          '<span class="intel-brand-sub">Weaponized super-brain</span>',
        '</div>',
        '<button type="button" class="intel-close" aria-label="Close drawer">&times;</button>',
      '</header>',
      '<div class="intel-status" id="intel-status"></div>',
      '<div class="intel-body" id="intel-body">',
        '<p class="intel-empty">Open a drawer from a landing to see analytics.</p>',
      '</div>',
      '<footer class="intel-foot">',
        '<span class="intel-foot-v">v3.0</span>',
        '<span class="intel-foot-reg">FDL Art.20-21 · Art.29 · Cabinet Res 134/2025 Art.19 · NIST AI RMF</span>',
      '</footer>'
    ].join('');
    document.body.appendChild(drawer);
    body = drawer.querySelector('#intel-body');
    drawer.querySelector('.intel-close').addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    return drawer;
  }

  function injectStyles() {
    if (document.getElementById('intel-drawer-styles')) return;
    var css = [
      '.intel-launcher {',
      '  position: fixed; right: 22px; bottom: 22px; z-index: 600;',
      '  display: inline-flex; align-items: center; gap: 12px;',
      '  padding: 15px 24px; border-radius: 999px;',
      '  border: 1px solid rgba(244, 114, 182, 0.75);',
      '  background:',
      '    linear-gradient(160deg, rgba(92,20,54,0.97), rgba(40,10,26,0.97)),',
      '    conic-gradient(from 0deg, rgba(244,114,182,0.0) 0deg, rgba(244,114,182,0.55) 90deg, rgba(168,85,247,0.55) 180deg, rgba(244,114,182,0.0) 270deg);',
      '  background-origin: border-box; background-clip: padding-box, border-box;',
      '  color: #fce7f3; font-family: "DM Mono", monospace;',
      '  font-size: 12px; letter-spacing: 2.5px; text-transform: uppercase; font-weight: 700;',
      '  cursor: pointer; overflow: hidden; isolation: isolate;',
      '  box-shadow:',
      '    0 0 0 1px rgba(244,114,182,0.35) inset,',
      '    0 0 18px rgba(244,114,182,0.45) inset,',
      '    0 12px 32px rgba(236,72,153,0.45),',
      '    0 0 48px rgba(236,72,153,0.35),',
      '    0 0 96px rgba(168,85,247,0.25);',
      '  transition: transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s ease, letter-spacing .22s ease;',
      '  animation: intelLauncherBreathe 3.2s ease-in-out infinite;',
      '}',
      '.intel-launcher::before {',
      '  content: ""; position: absolute; inset: -2px; border-radius: 999px;',
      '  padding: 2px; background: conic-gradient(from 0deg, #f472b6, #a855f7, #ec4899, #f472b6);',
      '  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);',
      '  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);',
      '  -webkit-mask-composite: xor; mask-composite: exclude;',
      '  opacity: .85; animation: intelLauncherSpin 6s linear infinite; z-index: -1;',
      '}',
      '.intel-launcher::after {',
      '  content: ""; position: absolute; inset: 0; border-radius: 999px;',
      '  background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.22) 50%, transparent 70%);',
      '  transform: translateX(-120%); animation: intelLauncherShimmer 3.6s ease-in-out infinite; pointer-events: none;',
      '}',
      '.intel-launcher > span { position: relative; z-index: 1; }',
      '.intel-launcher:hover {',
      '  transform: translateY(-3px) scale(1.04); letter-spacing: 3px;',
      '  box-shadow:',
      '    0 0 0 1px rgba(244,114,182,0.55) inset,',
      '    0 0 22px rgba(244,114,182,0.6) inset,',
      '    0 18px 44px rgba(236,72,153,0.7),',
      '    0 0 72px rgba(236,72,153,0.55),',
      '    0 0 140px rgba(168,85,247,0.4);',
      '}',
      '.intel-launcher:active { transform: translateY(-1px) scale(1.01); }',
      '.intel-launcher .intel-pulse {',
      '  position: relative; width: 12px; height: 12px; border-radius: 50%;',
      '  background: radial-gradient(circle at 30% 30%, #fff 0%, #f9a8d4 35%, #f472b6 70%, #db2777 100%);',
      '  box-shadow: 0 0 14px #f472b6, 0 0 28px rgba(244,114,182,0.7);',
      '  animation: intelPulse 1.8s ease-in-out infinite;',
      '}',
      '.intel-launcher .intel-pulse::before, .intel-launcher .intel-pulse::after {',
      '  content: ""; position: absolute; inset: -4px; border-radius: 50%;',
      '  border: 1px solid rgba(244,114,182,0.7); animation: intelRipple 2.2s ease-out infinite;',
      '}',
      '.intel-launcher .intel-pulse::after { animation-delay: 1.1s; }',
      '@keyframes intelPulse { 0%,100%{opacity:.85;transform:scale(1)} 50%{opacity:1;transform:scale(1.25)} }',
      '@keyframes intelRipple { 0%{transform:scale(1);opacity:.8} 100%{transform:scale(2.6);opacity:0} }',
      '@keyframes intelLauncherSpin { to { transform: rotate(360deg); } }',
      '@keyframes intelLauncherShimmer { 0%{transform:translateX(-120%)} 55%,100%{transform:translateX(120%)} }',
      '@keyframes intelLauncherBreathe { 0%,100%{filter:brightness(1)} 50%{filter:brightness(1.18) saturate(1.15)} }',
      '@media (prefers-reduced-motion: reduce) {',
      '  .intel-launcher, .intel-launcher::before, .intel-launcher::after, .intel-launcher .intel-pulse, .intel-launcher .intel-pulse::before, .intel-launcher .intel-pulse::after { animation: none; }',
      '}',
      '',
      '.intel-drawer {',
      '  position: fixed; top: 0; right: 0; bottom: 0; width: min(520px, 94vw);',
      '  z-index: 700; transform: translateX(110%); transition: transform .24s ease;',
      '  background: linear-gradient(180deg, #160309 0%, #1a050d 40%, #22081a 100%);',
      '  border-left: 1px solid rgba(244, 114, 182, 0.35);',
      '  box-shadow: -12px 0 32px rgba(0, 0, 0, 0.55);',
      '  color: #fce7f3; display: flex; flex-direction: column;',
      '  font-family: "Inter", system-ui, sans-serif;',
      '}',
      '.intel-drawer[aria-hidden="false"] { transform: translateX(0); }',
      '.intel-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px 14px; border-bottom: 1px solid rgba(244,114,182,0.2); }',
      '.intel-brand { display: flex; align-items: center; gap: 10px; }',
      '.intel-dot { width: 9px; height: 9px; border-radius: 50%; background: #f472b6; box-shadow: 0 0 10px #f472b6; }',
      '.intel-brand-t { font-family: "DM Mono", monospace; font-size: 12px; letter-spacing: 3px; color: #f472b6; }',
      '.intel-brand-sub { font-family: "DM Mono", monospace; font-size: 9px; letter-spacing: 2px; color: #a35676; }',
      '.intel-close { background: transparent; border: 1px solid rgba(244,114,182,0.3); color: #fce7f3; border-radius: 8px; width: 32px; height: 32px; cursor: pointer; font-size: 18px; line-height: 1; }',
      '.intel-close:hover { border-color: #f472b6; color: #f472b6; }',
      '.intel-status { padding: 10px 20px; font-family: "DM Mono", monospace; font-size: 10px; letter-spacing: 1.5px; color: #b7688f; border-bottom: 1px solid rgba(244,114,182,0.12); }',
      '.intel-body { flex: 1; overflow-y: auto; padding: 16px 20px 24px; }',
      '.intel-foot { padding: 10px 20px 14px; border-top: 1px solid rgba(244,114,182,0.2); font-family: "DM Mono", monospace; font-size: 9px; letter-spacing: 1.5px; color: #6e2e4c; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }',
      '',
      '.intel-empty { color: #a35676; font-size: 13px; opacity: .8; }',
      '.intel-section { margin-bottom: 22px; }',
      '.intel-section h3 { font-family: "DM Mono", monospace; font-size: 10px; letter-spacing: 2.5px; text-transform: uppercase; color: #f472b6; margin: 0 0 10px; }',
      '.intel-section p { font-size: 12px; line-height: 1.55; color: #fbcfe8; margin: 0 0 8px; }',
      '',
      '.intel-stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px,1fr)); gap: 10px; margin-bottom: 14px; }',
      '.intel-stat { padding: 12px 14px; border: 1px solid rgba(244,114,182,0.2); border-radius: 10px; background: rgba(40,10,25,0.55); }',
      '.intel-stat-v { font-family: "Playfair Display", serif; font-weight: 700; font-size: 22px; color: #fce7f3; line-height: 1; }',
      '.intel-stat-v[data-tone="warn"] { color: #fca5a5; }',
      '.intel-stat-v[data-tone="crit"] { color: #f87171; }',
      '.intel-stat-v[data-tone="ok"] { color: #86efac; }',
      '.intel-stat-v[data-tone="accent"] { color: #f472b6; }',
      '.intel-stat-k { font-family: "DM Mono", monospace; font-size: 9px; letter-spacing: 2px; text-transform: uppercase; color: #a35676; margin-top: 4px; }',
      '',
      '.intel-presets { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }',
      '.intel-preset { text-align: left; background: rgba(40,10,25,0.55); border: 1px solid rgba(244,114,182,0.18); color: #fce7f3; padding: 11px 14px; border-radius: 10px; font-size: 12px; cursor: pointer; transition: border-color .15s ease; font-family: "Inter", system-ui, sans-serif; }',
      '.intel-preset:hover { border-color: #f472b6; }',
      '.intel-preset b { display: block; font-family: "DM Mono", monospace; font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: #f472b6; margin-bottom: 4px; font-weight: 600; }',
      '.intel-preset .intel-preset-note { display: block; font-size: 10px; color: #a35676; margin-top: 4px; letter-spacing: 0; }',
      '',
      '.intel-hit-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }',
      '.intel-hit { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 10px 12px; border: 1px solid rgba(244,114,182,0.18); border-radius: 10px; background: rgba(40,10,25,0.5); }',
      '.intel-hit-main { flex: 1; min-width: 0; }',
      '.intel-hit-t { font-size: 12px; color: #fce7f3; margin-bottom: 2px; }',
      '.intel-hit-m { font-family: "DM Mono", monospace; font-size: 9px; letter-spacing: 1.5px; color: #a35676; }',
      '.intel-hit-s { font-family: "DM Mono", monospace; font-size: 9px; letter-spacing: 1.5px; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; flex-shrink: 0; }',
      '.intel-hit-s[data-sev="critical"] { background: rgba(239,68,68,0.22); color: #fca5a5; border: 1px solid rgba(239,68,68,0.4); }',
      '.intel-hit-s[data-sev="high"]     { background: rgba(239,68,68,0.14); color: #fca5a5; border: 1px solid rgba(239,68,68,0.3); }',
      '.intel-hit-s[data-sev="medium"]   { background: rgba(236,72,153,0.18); color: #f472b6; border: 1px solid rgba(236,72,153,0.4); }',
      '.intel-hit-s[data-sev="low"]      { background: rgba(34,197,94,0.14); color: #86efac; border: 1px solid rgba(34,197,94,0.4); }',
      '',
      '.intel-result { padding: 12px 14px; border: 1px solid rgba(244,114,182,0.25); border-radius: 10px; background: rgba(40,10,25,0.6); margin-bottom: 10px; }',
      '.intel-result pre { white-space: pre-wrap; word-break: break-word; font-family: "DM Mono", monospace; font-size: 11px; color: #fbcfe8; margin: 0; }',
      '.intel-result .intel-verdict { display: inline-block; font-family: "DM Mono", monospace; font-size: 10px; letter-spacing: 2px; text-transform: uppercase; padding: 4px 10px; border-radius: 999px; margin-bottom: 8px; }',
      '.intel-result .intel-verdict[data-v="freeze"], .intel-result .intel-verdict[data-v="file_str"], .intel-result .intel-verdict[data-v="escalate"] { background: rgba(239,68,68,0.2); color: #fca5a5; border: 1px solid rgba(239,68,68,0.4); }',
      '.intel-result .intel-verdict[data-v="review"] { background: rgba(236,72,153,0.2); color: #f472b6; border: 1px solid rgba(236,72,153,0.4); }',
      '.intel-result .intel-verdict[data-v="monitor"], .intel-result .intel-verdict[data-v="clear"] { background: rgba(34,197,94,0.18); color: #86efac; border: 1px solid rgba(34,197,94,0.4); }',
      '',
      '.intel-feedback-row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }',
      '.intel-feedback-row button { background: transparent; border: 1px solid rgba(244,114,182,0.3); color: #fce7f3; padding: 6px 12px; border-radius: 6px; font-family: "DM Mono", monospace; font-size: 10px; letter-spacing: 1.5px; cursor: pointer; }',
      '.intel-feedback-row button:hover { border-color: #f472b6; color: #f472b6; }'
    ].join('\n');
    var style = document.createElement('style');
    style.id = 'intel-drawer-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function open() {
    ensureDrawer();
    drawer.setAttribute('aria-hidden', 'false');
    refresh();
  }
  function close() {
    if (drawer) drawer.setAttribute('aria-hidden', 'true');
  }
  function toggle() {
    ensureDrawer();
    if (drawer.getAttribute('aria-hidden') === 'false') close();
    else open();
  }

  function setStatus(txt) {
    var el = drawer && drawer.querySelector('#intel-status');
    if (el) el.textContent = txt;
  }

  // ─── Build a read-only snapshot of the landing's data ────────────
  function snapshot() {
    if (!config || !config.storageKeys) return { keys: {}, totals: {} };
    var keys = {};
    var totals = {};
    Object.keys(config.storageKeys).forEach(function (k) {
      var rows = safeParse(config.storageKeys[k], []);
      keys[k] = rows;
      totals[k] = rows.length;
    });
    return { keys: keys, totals: totals };
  }

  function defaultCtx() {
    var snap = snapshot();
    var entity = (config && config.entityBuilder) ? safeCall(config.entityBuilder, snap) : { id: landing };
    var txs = (config && config.txBuilder) ? safeCall(config.txBuilder, snap) : [];
    lastCtx = { snap: snap, entity: entity || {}, txs: txs || [], landing: landing, generatedAt: new Date().toISOString() };
    return lastCtx;
  }
  function safeCall(fn, arg) {
    try { return fn(arg); } catch (_) { return null; }
  }

  // ─── Render ──────────────────────────────────────────────────────
  function refresh() {
    if (!body) return;
    var ctx = defaultCtx();
    var typ = (window.__brainTypology && window.__brainTypology.scan(ctx.entity, ctx.txs)) || [];
    var crit = typ.filter(function (h) { return h.severity === 'critical'; });
    var high = typ.filter(function (h) { return h.severity === 'high'; });
    var totals = ctx.snap.totals;
    var totalRows = Object.values(totals).reduce(function (s, n) { return s + n; }, 0);

    setStatus('Landing: ' + landing + ' · ' + totalRows + ' records in scope · brain ' +
      (window.__HAWKEYE_BRAIN ? 'v' + window.__HAWKEYE_BRAIN.version + ' online' : 'offline-local'));

    body.innerHTML = [
      '<div class="intel-section">',
        '<h3>Snapshot</h3>',
        '<div class="intel-stat-row">',
          Object.keys(totals).map(function (k) {
            return '<div class="intel-stat"><div class="intel-stat-v">' + totals[k] + '</div>' +
              '<div class="intel-stat-k">' + esc(k) + '</div></div>';
          }).join(''),
        '</div>',
      '</div>',

      '<div class="intel-section">',
        '<h3>Local typology pre-scan <span style="font-size:9px;opacity:.7;">(47 rules · zero API cost)</span></h3>',
        typ.length
          ? '<div class="intel-stat-row">' +
              '<div class="intel-stat"><div class="intel-stat-v" data-tone="crit">' + crit.length + '</div><div class="intel-stat-k">Critical</div></div>' +
              '<div class="intel-stat"><div class="intel-stat-v" data-tone="warn">' + high.length + '</div><div class="intel-stat-k">High</div></div>' +
              '<div class="intel-stat"><div class="intel-stat-v">' + typ.length + '</div><div class="intel-stat-k">Total</div></div>' +
            '</div>' +
            '<ul class="intel-hit-list">' +
              typ.slice(0, 12).map(function (h) {
                return '<li class="intel-hit">' +
                  '<div class="intel-hit-main">' +
                    '<div class="intel-hit-t">' + esc(h.name) + '</div>' +
                    '<div class="intel-hit-m">' + esc(h.typologyId) + ' · FATF ' + esc(h.fatfRef) + ' · ' + esc(h.uaeRef) + '</div>' +
                  '</div>' +
                  '<span class="intel-hit-s" data-sev="' + esc(h.severity) + '">' + esc(h.severity) + '</span>' +
                '</li>';
              }).join('') +
            '</ul>'
          : '<p>No typology matches in the local pre-scan. Load more data or run a preset analysis.</p>',
      '</div>',

      (config && config.presets && config.presets.length)
        ? '<div class="intel-section">' +
            '<h3>Preset analyses</h3>' +
            '<div class="intel-presets">' +
              config.presets.map(function (p, i) {
                return '<button type="button" class="intel-preset" data-preset="' + i + '">' +
                  '<b>' + esc(p.label) + '</b>' +
                  (p.note ? '<span class="intel-preset-note">' + esc(p.note) + '</span>' : '') +
                '</button>';
              }).join('') +
            '</div>' +
          '</div>'
        : '',

      '<div class="intel-section">',
        '<h3>Deep analysis <span style="font-size:9px;opacity:.7;">(advisor-tool beta · Sonnet→Opus)</span></h3>',
        '<p>Pushes the full landing snapshot, typology hits, and entity memory context into the MegaBrain pipeline. Returns verdict + Shapley XAI + regulatory-basis trace. Files tipping-off linter and records to the 10-year audit trail.</p>',
        '<button type="button" class="intel-preset" data-action="intel-full"><b>▶ Run full MegaBrain analysis</b><span class="intel-preset-note">Falls back to local reasoning if the API is unreachable.</span></button>',
        '<div id="intel-result-slot"></div>',
      '</div>'
    ].join('');

    // Wire preset buttons.
    body.querySelectorAll('[data-preset]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-preset'), 10);
        var preset = config.presets[idx];
        if (!preset) return;
        runPreset(preset, ctx);
      });
    });
    // Wire full analysis.
    body.querySelectorAll('[data-action="intel-full"]').forEach(function (btn) {
      btn.addEventListener('click', function () { runFullAnalysis(ctx); });
    });
  }

  function resultSlot() {
    return body && body.querySelector('#intel-result-slot');
  }

  function runPreset(preset, ctx) {
    var slot = resultSlot();
    if (slot) slot.innerHTML = '<div class="intel-result"><div class="intel-verdict" data-v="processing">Processing…</div></div>';
    var out;
    try { out = preset.fn(ctx) || {}; }
    catch (e) { out = { summary: 'Preset failed: ' + (e && e.message || e), citations: [] }; }
    renderResult(out, { title: preset.label });
  }

  function runFullAnalysis(ctx) {
    var slot = resultSlot();
    if (slot) slot.innerHTML = '<div class="intel-result"><div class="intel-verdict" data-v="processing">Calling MegaBrain…</div></div>';

    // Redact tip-off-risky fields before the API call (FDL Art.29).
    var redactedEntity = Object.assign({}, ctx.entity || {});
    delete redactedEntity.rawSubjectNotes;
    delete redactedEntity.draftStrNarrative;

    var fallback = localReason(ctx);

    if (!window.__brainAnalyze) {
      renderResult(fallback, { title: 'Local reasoning (brain-boot.js not loaded)' });
      return;
    }

    try {
      window.__brainAnalyze({
        tenantId: (redactedEntity.id || 'hawkeye-' + landing),
        topic: (config && config.topic) || 'screening_command_intelligence',
        entity: redactedEntity,
        transactions: ctx.txs
      }).then(function (result) {
        if (!result) { renderResult(fallback, { title: 'API returned no result — local reasoning' }); return; }
        var out = {
          verdict: result.verdict,
          confidence: result.confidence,
          summary: result.narrative || fallback.summary,
          provenance: result._provenanceText,
          citations: fallback.citations,
          rawResult: result
        };
        renderResult(out, { title: 'MegaBrain analysis', showFeedback: true, entityId: redactedEntity.id });
      }).catch(function (err) {
        fallback.summary = 'API call failed (' + (err && err.message || err) + '). Using local reasoning:\n\n' + fallback.summary;
        renderResult(fallback, { title: 'Local fallback' });
      });
    } catch (e) {
      renderResult(fallback, { title: 'Local fallback' });
    }
  }

  // Local reasoning: assemble a narrative from typology hits + counts.
  function localReason(ctx) {
    var typ = (window.__brainTypology && window.__brainTypology.scan(ctx.entity, ctx.txs)) || [];
    var crit = typ.filter(function (h) { return h.severity === 'critical'; });
    var high = typ.filter(function (h) { return h.severity === 'high'; });
    var verdict = crit.length ? 'escalate' : high.length ? 'review' : 'monitor';
    var confidence = crit.length ? 0.82 : high.length ? 0.65 : 0.4;
    var lines = [];
    lines.push('LOCAL REASONING — rule-based fallback, no API call.');
    lines.push('');
    lines.push('Records in scope: ' + JSON.stringify(ctx.snap.totals));
    lines.push('Typology matches: ' + typ.length + ' (' + crit.length + ' critical, ' + high.length + ' high).');
    if (typ.length) {
      lines.push('');
      lines.push('Top matches:');
      typ.slice(0, 6).forEach(function (h) {
        lines.push('  • [' + h.severity.toUpperCase() + '] ' + h.name + ' (' + h.typologyId + ') — FATF ' + h.fatfRef + ' · ' + h.uaeRef);
      });
    }
    lines.push('');
    lines.push('Verdict: ' + verdict.toUpperCase() + ' (confidence ' + pct(confidence) + ')');
    if (verdict === 'escalate') lines.push('Recommend: MLRO four-eyes review, consider STR/SAR filing (FDL Art.26-27).');
    if (verdict === 'review')   lines.push('Recommend: CO review, document rationale, update risk rating.');
    return {
      verdict: verdict,
      confidence: confidence,
      summary: lines.join('\n'),
      citations: ['FDL No.(10)/2025 Art.20-21, Art.26-27', 'Cabinet Res 134/2025 Art.19', 'FATF Rec 10, 20']
    };
  }

  function renderResult(out, meta) {
    meta = meta || {};
    var slot = resultSlot();
    if (!slot) return;
    var verdict = (out && out.verdict) || '—';
    var html = [
      '<div class="intel-result">',
        '<div class="intel-verdict" data-v="' + esc(verdict) + '">' + esc((meta.title || 'Result') + ' · ' + verdict + (out.confidence != null ? ' · ' + pct(out.confidence) : '')) + '</div>',
        '<pre>' + esc(out.summary || '') + '</pre>',
        out.provenance ? '<pre style="margin-top:10px;opacity:.8">' + esc(out.provenance) + '</pre>' : '',
        out.citations && out.citations.length
          ? '<div style="margin-top:10px;font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1.5px;color:#a35676">' +
              'Regulatory basis: ' + out.citations.map(esc).join(' · ') + '</div>'
          : '',
      '</div>',
      meta.showFeedback && meta.entityId
        ? '<div class="intel-feedback-row">' +
            '<span style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1.5px;color:#a35676">MLRO feedback:</span>' +
            '<button type="button" data-fb="confirm">Confirm</button>' +
            '<button type="button" data-fb="false_positive">False positive</button>' +
            '<button type="button" data-fb="escalated">Escalated</button>' +
          '</div>'
        : ''
    ].join('');
    slot.innerHTML = html;
    slot.querySelectorAll('[data-fb]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var resolution = btn.getAttribute('data-fb');
        if (window.__brainFeedbackLoop && meta.entityId) {
          window.__brainFeedbackLoop.record(meta.entityId, resolution, {
            originalVerdict: verdict,
            originalConfidence: out.confidence,
            landing: landing,
            loggedAt: new Date().toISOString()
          });
        }
        btn.disabled = true;
        btn.textContent = resolution + ' ✓';
      });
    });
  }

  // ─── Launcher button ─────────────────────────────────────────────
  function mountLauncher(labelOverride) {
    if (document.querySelector('.intel-launcher')) return;
    injectStyles();
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'intel-launcher';
    btn.innerHTML = '<span class="intel-pulse"></span><span>' + esc(labelOverride || 'Intelligence') + '</span>';
    btn.addEventListener('click', toggle);
    document.body.appendChild(btn);
  }

  // ─── Public API ──────────────────────────────────────────────────
  window.__intelligenceDrawer = {
    mount: function (landingKey, cfg) {
      landing = landingKey || 'unknown';
      config = cfg || {};
      mountLauncher(cfg && cfg.launcherLabel);
      return { open: open, close: close, toggle: toggle, refresh: refresh };
    },
    open: open,
    close: close,
    toggle: toggle,
    refresh: refresh,
    getContext: function () { return clone(lastCtx); }
  };
})();
