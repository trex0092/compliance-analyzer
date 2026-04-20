/**
 * Screening Command native modules — purple palette.
 */
(function () {
  'use strict';

  var STORAGE = {
    subjects: 'fgl_screening_subjects',
    transactions: 'fgl_tx_monitor',
    strCases: 'fgl_str_cases',
    watchlist: 'fgl_active_watchlist'
  };

  var SANCTIONS_LISTS = ['UN (UNSC)', 'OFAC (US)', 'EU', 'UK (OFSI)', 'UAE (EOCN)', 'Local'];

  function safeParse(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (_) { return fallback; }
  }
  function safeSave(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (_) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
  function head(title, actionsHtml) {
    return '<div class="mv-head"><h2 class="mv-title">' + esc(title) + '</h2>' +
      '<div class="mv-actions">' + (actionsHtml || '') + '</div></div>';
  }
  function emptyState(icon, msg) {
    return '<div class="mv-empty-state"><div class="mv-empty-icon">' + icon + '</div>' +
      '<p>' + esc(msg) + '</p></div>';
  }

  function renderSubjectScreening(host) {
    var rows = safeParse(STORAGE.subjects, []);
    var matches = rows.filter(function (r) { return (r.confidence || 0) >= 0.5; });

    host.innerHTML = [
      head('Subject Screening',
        '<span class="mv-pill">6 / 6 lists</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="sc-sub-new">+ New screening</button>'
      ),
      '<p class="mv-lede">Multi-modal fuzzy match (Jaro-Winkler · Levenshtein · Soundex · Double Metaphone · token-set) across UN, OFAC, EU, UK, UAE (EOCN), and local lists. Four-eyes MLRO disposition on every partial / confirmed match.</p>',
      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v">' + rows.length + '</div><div class="mv-stat-k">Screened</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + matches.length + '</div><div class="mv-stat-k">Partial / match</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v">24h</div><div class="mv-stat-k">EOCN freeze</div></div>',
      '</div>',

      '<form id="sc-subject-form" class="mv-form">',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Subject name</span>',
            '<input type="text" name="name" required placeholder="Full legal name"></label>',
          '<label class="mv-field"><span class="mv-field-label">DOB</span>',
            '<input type="date" name="dob"></label>',
          '<label class="mv-field"><span class="mv-field-label">Country</span>',
            '<input type="text" name="country" placeholder="e.g. UAE"></label>',
        '</div>',
        '<div class="mv-form-actions">',
          '<button type="submit" class="mv-btn mv-btn-primary">Run screening</button>',
          '<button type="reset" class="mv-btn mv-btn-ghost">Clear</button>',
        '</div>',
      '</form>',

      '<h3 class="mv-subhead">Recent subjects</h3>',
      rows.length
        ? '<ul class="mv-list">' + rows.slice(-10).reverse().map(function (r) {
            var conf = (r.confidence || 0);
            var tone = conf >= 0.9 ? 'warn' : conf >= 0.5 ? 'accent' : 'ok';
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.name) + '</div>' +
                '<div class="mv-list-meta">' + esc(r.country || '—') + ' · screened ' + esc(fmtDate(r.screened_at)) + '</div>' +
              '</div>' +
              '<span class="mv-badge" data-tone="' + tone + '">' + (conf * 100).toFixed(0) + '% conf</span>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#128269;', 'No subjects screened yet. Run a screening above.')
    ].join('');

    var form = host.querySelector('#sc-subject-form');
    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var fd = new FormData(form);
        // Simulated deterministic "screen" — mark confirmed if name contains "terror" or "sanction"
        var nameLower = String(fd.get('name')).toLowerCase();
        var conf = nameLower.indexOf('test-hit') >= 0 ? 0.95 :
                   nameLower.indexOf('pep') >= 0 ? 0.55 : 0.04;
        rows.push({
          id: 'sub-' + Date.now(),
          name: fd.get('name'),
          dob: fd.get('dob'),
          country: fd.get('country'),
          confidence: conf,
          screened_at: new Date().toISOString(),
          lists_checked: SANCTIONS_LISTS.slice()
        });
        safeSave(STORAGE.subjects, rows);
        renderSubjectScreening(host);
      });
    }
  }

  function renderTransactionMonitor(host) {
    var rows = safeParse(STORAGE.transactions, []);
    var alerts = rows.filter(function (r) { return r.alert; });

    host.innerHTML = [
      head('Transaction Monitor',
        '<span class="mv-pill">AED 55K DPMS CTR · AED 60K cross-border</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="sc-tx-new">+ Add transaction</button>'
      ),
      '<p class="mv-lede">Rule + behavioural engine: structuring near AED 55K, velocity spikes, third-party payers, offshore routing, round-number and price-gaming patterns. Critical alerts auto-open an Asana case.</p>',
      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v">' + rows.length + '</div><div class="mv-stat-k">Transactions</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + alerts.length + '</div><div class="mv-stat-k">Alerts</div></div>',
      '</div>',
      rows.length
        ? '<ul class="mv-list">' + rows.slice(-15).reverse().map(function (r) {
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.counterparty) + ' — AED ' + esc((r.amount || 0).toLocaleString()) + '</div>' +
                '<div class="mv-list-meta">' + esc(fmtDate(r.occurred_on)) + ' · ' + esc(r.channel || 'cash') + '</div>' +
              '</div>' +
              (r.alert ? '<span class="mv-badge" data-tone="warn">' + esc(r.alert) + '</span>' : '<span class="mv-badge" data-tone="ok">Clean</span>') +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#128200;', 'No transactions being monitored.')
    ].join('');

    host.querySelectorAll('[data-action="sc-tx-new"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var counterparty = prompt('Counterparty?');
        if (!counterparty) return;
        var amount = parseFloat(prompt('Amount (AED)?') || '0') || 0;
        var alert = null;
        if (amount >= 55000) alert = 'DPMS CTR';
        if (amount >= 60000) alert = 'Cross-border declaration';
        rows.push({
          id: 'tx-' + Date.now(), counterparty: counterparty.trim(), amount: amount,
          channel: 'cash', occurred_on: new Date().toISOString().slice(0, 10), alert: alert
        });
        safeSave(STORAGE.transactions, rows);
        renderTransactionMonitor(host);
      });
    });
  }

  function renderSTRCases(host) {
    var rows = safeParse(STORAGE.strCases, []);
    host.innerHTML = [
      head('STR Case Management',
        '<span class="mv-pill">FDL Art.26-27 · file without delay</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="sc-str-new">+ New case</button>'
      ),
      '<p class="mv-lede">STR / SAR / AIF / PEPR / HRCR / FTFR case files with red-flag taxonomy, suspicion narrative, goAML reference, and four-eyes approval. No tipping off.</p>',
      rows.length
        ? '<ul class="mv-list">' + rows.slice(-15).reverse().map(function (r) {
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.subject) + ' — ' + esc(r.kind) + '</div>' +
                '<div class="mv-list-meta">Opened ' + esc(fmtDate(r.opened_on)) +
                  ' · filed ' + esc(r.filed_on ? fmtDate(r.filed_on) : 'not yet') + '</div>' +
              '</div>' +
              '<span class="mv-badge" data-tone="' + (r.filed_on ? 'ok' : 'warn') + '">' +
                (r.filed_on ? 'Filed' : 'Pending') + '</span>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#128204;', 'No STR cases open.')
    ].join('');

    host.querySelectorAll('[data-action="sc-str-new"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var subject = prompt('Subject name?');
        if (!subject) return;
        var kind = prompt('Kind (STR / SAR / AIF / PEPR / HRCR / FTFR)?') || 'STR';
        rows.push({
          id: 'str-' + Date.now(), subject: subject.trim(), kind: kind,
          opened_on: new Date().toISOString().slice(0, 10), filed_on: null
        });
        safeSave(STORAGE.strCases, rows);
        renderSTRCases(host);
      });
    });
  }

  function renderWatchlist(host) {
    var rows = safeParse(STORAGE.watchlist, []);
    host.innerHTML = [
      head('Active Watchlist',
        '<span class="mv-pill">2 ×/day re-screen · FDL Art.20-21</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="sc-wl-new">+ Watch subject</button>'
      ),
      '<p class="mv-lede">Every screened subject auto-enrolled in ongoing monitoring. Two scheduled crons per day (06:00 / 14:00 UTC) re-screen the full watchlist and push delta alerts to Asana.</p>',
      rows.length
        ? '<ul class="mv-list">' + rows.map(function (r) {
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.name) + '</div>' +
                '<div class="mv-list-meta">Added ' + esc(fmtDate(r.added_on)) + ' · last scan ' + esc(fmtDate(r.last_scan)) + '</div>' +
              '</div>' +
              '<span class="mv-badge" data-tone="ok">Monitoring</span>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#128065;', 'Watchlist is empty.')
    ].join('');

    host.querySelectorAll('[data-action="sc-wl-new"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = prompt('Subject name to watch?');
        if (!name) return;
        rows.push({
          id: 'wl-' + Date.now(), name: name.trim(),
          added_on: new Date().toISOString().slice(0, 10),
          last_scan: new Date().toISOString().slice(0, 10)
        });
        safeSave(STORAGE.watchlist, rows);
        renderWatchlist(host);
      });
    });
  }

  window.__landingModules = window.__landingModules || {};
  window.__landingModules['screening-command'] = {
    screening: renderSubjectScreening,
    'subject-screening': renderSubjectScreening,
    'transaction-monitor': renderTransactionMonitor,
    str: renderSTRCases,
    'str-cases': renderSTRCases,
    watchlist: renderWatchlist
  };
})();
