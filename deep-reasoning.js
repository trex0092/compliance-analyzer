/**
 * Deep Reasoning — MLRO browser surface for the advisor-assisted
 * compliance analysis endpoint (/api/brain-reason).
 *
 * Renders a collapsible card the MLRO uses to submit a free-form
 * compliance question plus optional case context, and displays the
 * Sonnet-executor reasoning text + Opus-advisor call count inline.
 *
 * Auth: reads the JWT stored by /login.html under hawkeye.session.jwt
 * (fallback: hawkeye.watchlist.adminToken legacy mirror). Posts it
 * as Authorization: Bearer <token>.
 *
 * Regulatory basis: FDL No.(10)/2025 Art.20-21 (CO reasoning trail)
 * and Art.24 (every reasoning turn is logged server-side).
 * Kept as a plain IIFE so it ships unmodified to the browser via
 * publish = '.' in netlify.toml, no bundler step. No CSP hash needed
 * because it loads via <script src>, not inline.
 */
(function () {
  'use strict';

  var MOUNT_ID = 'deepReasoningMount';
  var JWT_KEY = 'hawkeye.session.jwt';
  var LEGACY_KEY = 'hawkeye.watchlist.adminToken';

  function token() {
    try {
      return localStorage.getItem(JWT_KEY) || localStorage.getItem(LEGACY_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Minimal markdown → HTML for the model's output. Handles:
  //  - paragraphs (blank lines)
  //  - unordered lists ("- ", "* ")
  //  - bold (**x**)
  //  - inline code (`x`)
  // Everything else is escaped. No raw HTML from the model survives.
  function renderModelText(raw) {
    var text = escapeHtml(raw || '');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    var blocks = text.split(/\n{2,}/);
    var out = [];
    for (var i = 0; i < blocks.length; i++) {
      var blk = blocks[i].trim();
      if (!blk) continue;
      var lines = blk.split('\n');
      var isList = lines.every(function (l) {
        return /^\s*[-*]\s+/.test(l);
      });
      if (isList) {
        out.push(
          '<ul>' +
            lines
              .map(function (l) {
                return '<li>' + l.replace(/^\s*[-*]\s+/, '') + '</li>';
              })
              .join('') +
            '</ul>'
        );
      } else {
        out.push('<p>' + lines.join('<br>') + '</p>');
      }
    }
    return out.join('');
  }

  function injectStyles() {
    if (document.getElementById('dr-style')) return;
    var s = document.createElement('style');
    s.id = 'dr-style';
    s.textContent = [
      '.dr-card { margin: 28px auto 0; max-width: 920px; padding: 22px 24px;',
      '  background: linear-gradient(180deg, rgba(30,18,50,0.72), rgba(10,6,20,0.72));',
      '  border: 1px solid rgba(255,139,209,0.28); border-radius: 16px;',
      '  box-shadow: 0 18px 60px rgba(0,0,0,0.4); color: #ece8ff; }',
      '.dr-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; }',
      '.dr-title { font-size: 15px; font-weight: 700; letter-spacing: 0.02em;',
      '  background: linear-gradient(90deg,#ffd6a8,#ff8bd1 60%,#88b5ff);',
      '  -webkit-background-clip: text; background-clip: text; color: transparent; }',
      '.dr-sub { font-size: 11px; opacity: 0.7; margin-top: 4px; }',
      '.dr-toggle { background: none; border: 1px solid rgba(255,255,255,0.18);',
      '  color: #ece8ff; padding: 6px 12px; border-radius: 8px; font-size: 12px;',
      '  cursor: pointer; }',
      '.dr-toggle:hover { background: rgba(255,255,255,0.06); }',
      '.dr-body { margin-top: 16px; display: none; }',
      '.dr-body.open { display: block; }',
      '.dr-label { display: block; font-size: 11px; text-transform: uppercase;',
      '  letter-spacing: 0.08em; opacity: 0.75; margin: 12px 0 6px; }',
      '.dr-input, .dr-textarea { width: 100%; padding: 10px 12px;',
      '  background: rgba(255,255,255,0.05);',
      '  border: 1px solid rgba(255,255,255,0.14); border-radius: 10px;',
      '  color: inherit; font-size: 13px; outline: none; font-family: inherit; }',
      '.dr-textarea { min-height: 88px; resize: vertical; }',
      '.dr-input:focus, .dr-textarea:focus {',
      '  border-color: rgba(255,139,209,0.6); background: rgba(255,255,255,0.08); }',
      '.dr-actions { margin-top: 14px; display: flex; gap: 10px; align-items: center; }',
      '.dr-btn { padding: 9px 16px; background: linear-gradient(90deg,#ff8bd1,#ffd6a8);',
      '  color: #1a0a20; border: none; border-radius: 10px; font-weight: 700;',
      '  font-size: 13px; cursor: pointer; }',
      '.dr-btn:disabled { opacity: 0.5; cursor: wait; }',
      '.dr-hint { font-size: 11px; opacity: 0.6; }',
      '.dr-err { margin-top: 12px; font-size: 12px; color: #ffb0b0; min-height: 14px; }',
      '.dr-result { margin-top: 16px; padding: 14px 16px;',
      '  background: rgba(255,255,255,0.04); border-radius: 12px;',
      '  border: 1px solid rgba(255,255,255,0.1); }',
      '.dr-result p { margin: 0 0 10px; line-height: 1.55; font-size: 13px; }',
      '.dr-result p:last-child { margin-bottom: 0; }',
      '.dr-result ul { margin: 6px 0 10px 18px; font-size: 13px; line-height: 1.55; }',
      '.dr-result code { background: rgba(255,255,255,0.08); padding: 1px 5px;',
      '  border-radius: 4px; font-size: 12px; }',
      '.dr-meta { margin-top: 12px; font-size: 11px; opacity: 0.7;',
      '  display: flex; gap: 14px; flex-wrap: wrap; }',
      '.dr-meta b { color: #ffd6a8; font-weight: 600; }',
    ].join('\n');
    document.head.appendChild(s);
  }

  function render(mount) {
    mount.innerHTML = [
      '<div class="dr-card" role="region" aria-label="Deep Reasoning">',
      '  <div class="dr-head">',
      '    <div>',
      '      <div class="dr-title">DEEP REASONING · MLRO ADVISOR</div>',
      '      <div class="dr-sub">Sonnet executor · Opus advisor · FDL Art.20-21 reasoning trail</div>',
      '    </div>',
      '    <button class="dr-toggle" id="drToggle" type="button">Open</button>',
      '  </div>',
      '  <div class="dr-body" id="drBody">',
      '    <label class="dr-label" for="drQuestion">Compliance question</label>',
      '    <textarea class="dr-textarea" id="drQuestion" maxlength="2000"',
      '      placeholder="e.g. Customer A made 4 cash deposits of AED 50k each across 3 days. What CDD level applies and what red flags are present?"></textarea>',
      '    <label class="dr-label" for="drContext">Case context (optional)</label>',
      '    <textarea class="dr-textarea" id="drContext" maxlength="8000"',
      '      placeholder="Paste the customer profile, transaction list, or STR draft here. Up to 8000 chars."></textarea>',
      '    <div class="dr-actions">',
      '      <button class="dr-btn" id="drRun" type="button">Analyze</button>',
      '      <span class="dr-hint">Rate-limited 10/min per IP. Expect 10-30s for deep reasoning.</span>',
      '    </div>',
      '    <div class="dr-err" id="drErr" role="status" aria-live="polite"></div>',
      '    <div id="drResultWrap"></div>',
      '  </div>',
      '</div>',
    ].join('\n');

    var toggle = mount.querySelector('#drToggle');
    var body = mount.querySelector('#drBody');
    toggle.addEventListener('click', function () {
      body.classList.toggle('open');
      toggle.textContent = body.classList.contains('open') ? 'Close' : 'Open';
      if (body.classList.contains('open')) {
        try {
          mount.querySelector('#drQuestion').focus();
        } catch (_) {}
      }
    });

    var runBtn = mount.querySelector('#drRun');
    var errEl = mount.querySelector('#drErr');
    var resultWrap = mount.querySelector('#drResultWrap');
    runBtn.addEventListener('click', function () {
      var q = (mount.querySelector('#drQuestion').value || '').trim();
      var c = (mount.querySelector('#drContext').value || '').trim();
      errEl.textContent = '';
      resultWrap.innerHTML = '';
      if (!q) {
        errEl.textContent = 'Enter a compliance question.';
        return;
      }
      var t = token();
      if (!t) {
        errEl.textContent = 'No session token — sign in at /login.html first.';
        return;
      }
      runBtn.disabled = true;
      runBtn.textContent = 'Analyzing…';
      fetch('/api/brain-reason', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + t,
        },
        body: JSON.stringify({ question: q, caseContext: c || undefined }),
      })
        .then(function (res) {
          return res.text().then(function (text) {
            var json = null;
            try {
              json = text ? JSON.parse(text) : null;
            } catch (_) {}
            if (!res.ok) {
              var msg =
                (json && json.error) ||
                'Deep reasoning failed (HTTP ' + res.status + ')' +
                  (text ? ' — ' + text.slice(0, 160) : '');
              throw new Error(msg);
            }
            return json || {};
          });
        })
        .then(function (r) {
          if (!r || typeof r.text !== 'string') {
            throw new Error('Empty response from /api/brain-reason.');
          }
          var meta = r.usage || {};
          resultWrap.innerHTML = [
            '<div class="dr-result">',
            renderModelText(r.text),
            '</div>',
            '<div class="dr-meta">',
            '  <span>Advisor calls: <b>' + (r.advisorCallCount || 0) + '</b></span>',
            '  <span>Executor tokens: <b>' +
              (meta.executorInputTokens || 0) +
              ' in / ' +
              (meta.executorOutputTokens || 0) +
              ' out</b></span>',
            '  <span>Advisor tokens: <b>' +
              (meta.advisorInputTokens || 0) +
              ' in / ' +
              (meta.advisorOutputTokens || 0) +
              ' out</b></span>',
            '</div>',
          ].join('\n');
        })
        .catch(function (e) {
          errEl.textContent = (e && e.message) || 'Network error.';
        })
        .then(function () {
          runBtn.disabled = false;
          runBtn.textContent = 'Analyze';
        });
    });
  }

  function init() {
    var mount = document.getElementById(MOUNT_ID);
    if (!mount) return;
    injectStyles();
    render(mount);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
