/**
 * Compliance Ops native modules — pink / red palette.
 * Same contract as workbench-modules.js.
 */
(function () {
  'use strict';

  var STORAGE = {
    training: 'fgl_training_records',
    employees: 'fgl_employees',
    incidents: 'fgl_incidents',
    reports: 'fgl_report_history'
  };

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
  function emptyState(icon, msg, cta) {
    return '<div class="mv-empty-state"><div class="mv-empty-icon">' + icon + '</div>' +
      '<p>' + esc(msg) + '</p>' +
      (cta ? '<div class="mv-empty-cta">' + cta + '</div>' : '') + '</div>';
  }

  // ─── Training ────────────────────────────────────────────────────
  function renderTraining(host) {
    var rows = safeParse(STORAGE.training, []);
    var completed = rows.filter(function (r) { return r.completed; });
    var expiring = rows.filter(function (r) {
      if (!r.expires_on) return false;
      var d = new Date(r.expires_on).getTime();
      return d > Date.now() && d < Date.now() + 30 * 86400000;
    });

    host.innerHTML = [
      head('Training Register',
        '<span class="mv-pill">MoE Circular 08/AML/2021 §9</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="co-train-new">+ New record</button>'
      ),
      '<p class="mv-lede">AML/CFT, sanctions, and PEP-screening curricula per employee. Coverage logged against the 100% annual target.</p>',
      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v">' + rows.length + '</div><div class="mv-stat-k">Records</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="ok">' + completed.length + '</div><div class="mv-stat-k">Completed</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + expiring.length + '</div><div class="mv-stat-k">Expiring 30d</div></div>',
      '</div>',
      rows.length
        ? '<ul class="mv-list">' + rows.slice(-15).reverse().map(function (r) {
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.employee) + ' — ' + esc(r.subject) + '</div>' +
                '<div class="mv-list-meta">Completed ' + esc(fmtDate(r.completed_on)) +
                  ' · expires ' + esc(fmtDate(r.expires_on)) + '</div>' +
              '</div>' +
              '<span class="mv-badge" data-tone="' + (r.completed ? 'ok' : 'warn') + '">' +
                (r.completed ? 'Done' : 'Pending') + '</span>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#127891;', 'No training records yet. Start with a new entry.')
    ].join('');

    host.querySelectorAll('[data-action="co-train-new"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var employee = prompt('Employee name?');
        if (!employee) return;
        var subject = prompt('Subject (e.g. AML/CFT refresher)?') || 'AML/CFT';
        var completed_on = prompt('Completed on (YYYY-MM-DD)?') || new Date().toISOString().slice(0, 10);
        var expires_on = prompt('Expires on (YYYY-MM-DD)?') || '';
        rows.push({
          id: 'tr-' + Date.now(), employee: employee.trim(), subject: subject.trim(),
          completed: true, completed_on: completed_on, expires_on: expires_on
        });
        safeSave(STORAGE.training, rows);
        renderTraining(host);
      });
    });
  }

  // ─── Employees ───────────────────────────────────────────────────
  function renderEmployees(host) {
    var rows = safeParse(STORAGE.employees, []);
    host.innerHTML = [
      head('Employee Directory',
        '<span class="mv-pill">Cabinet Res 134/2025 Art.19 · SoD</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="co-emp-new">+ New employee</button>'
      ),
      '<p class="mv-lede">Staff registry with role, MLRO flag, KYC status, and four-eyes eligibility.</p>',
      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v">' + rows.length + '</div><div class="mv-stat-k">Employees</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v">' + rows.filter(function (e) { return e.mlro; }).length + '</div><div class="mv-stat-k">MLRO</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v">' + rows.filter(function (e) { return e.kyc_ok; }).length + '</div><div class="mv-stat-k">KYC verified</div></div>',
      '</div>',
      rows.length
        ? '<ul class="mv-list">' + rows.map(function (e) {
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(e.name) + '</div>' +
                '<div class="mv-list-meta">' + esc(e.role || '') + ' · ' + esc(e.email || '') + '</div>' +
              '</div>' +
              (e.mlro ? '<span class="mv-badge" data-tone="accent">MLRO</span>' : '') +
              '<span class="mv-badge" data-tone="' + (e.kyc_ok ? 'ok' : 'warn') + '">' +
                (e.kyc_ok ? 'KYC ✓' : 'KYC pending') + '</span>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#128100;', 'No employees registered. Add one to start.')
    ].join('');

    host.querySelectorAll('[data-action="co-emp-new"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = prompt('Employee name?');
        if (!name) return;
        var role = prompt('Role?') || '';
        var email = prompt('Email?') || '';
        var mlro = confirm('Is this the MLRO?');
        rows.push({ id: 'emp-' + Date.now(), name: name.trim(), role: role.trim(), email: email.trim(), mlro: mlro, kyc_ok: true });
        safeSave(STORAGE.employees, rows);
        renderEmployees(host);
      });
    });
  }

  // ─── Incidents ───────────────────────────────────────────────────
  function renderIncidents(host) {
    var rows = safeParse(STORAGE.incidents, []);
    var open = rows.filter(function (r) { return r.status === 'open'; });
    var investigating = rows.filter(function (r) { return r.status === 'investigating'; });

    host.innerHTML = [
      head('Incident Register',
        '<span class="mv-pill">Cabinet Res 74/2020 Art.4-7</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="co-inc-new">+ New incident</button>'
      ),
      '<p class="mv-lede">Sanctions matches, suspected tipping-off, breach triage. 24h EOCN and 5-business-day CNMR countdowns.</p>',
      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v">' + rows.length + '</div><div class="mv-stat-k">Total</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + open.length + '</div><div class="mv-stat-k">Open</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="accent">' + investigating.length + '</div><div class="mv-stat-k">Investigating</div></div>',
      '</div>',
      rows.length
        ? '<ul class="mv-list">' + rows.slice(-15).reverse().map(function (r, i) {
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.title) + '</div>' +
                '<div class="mv-list-meta">' + esc(r.severity || 'medium') + ' · opened ' + esc(fmtDate(r.created_at)) + '</div>' +
              '</div>' +
              '<span class="mv-badge" data-tone="' + (r.status === 'open' ? 'warn' : r.status === 'investigating' ? 'accent' : 'ok') + '">' +
                esc(r.status) + '</span>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#9888;', 'No incidents logged. Clean slate.')
    ].join('');

    host.querySelectorAll('[data-action="co-inc-new"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var title = prompt('Incident title?');
        if (!title) return;
        var severity = prompt('Severity (low / medium / high / critical)?') || 'medium';
        rows.push({
          id: 'inc-' + Date.now(), title: title.trim(), severity: severity,
          status: 'open', created_at: new Date().toISOString()
        });
        safeSave(STORAGE.incidents, rows);
        renderIncidents(host);
      });
    });
  }

  // ─── Reports ─────────────────────────────────────────────────────
  function renderReports(host) {
    var rows = safeParse(STORAGE.reports, []);
    host.innerHTML = [
      head('Reports',
        '<span class="mv-pill">FDL No.(10)/2025 Art.20 · Art.24</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="co-rep-gen">Generate quarterly</button>'
      ),
      '<p class="mv-lede">Regulator-ready outputs: goAML STR/SAR/CTR/DPMSR/CNMR XML, quarterly DPMS rollups, audit packs, MLRO digests.</p>',
      rows.length
        ? '<ul class="mv-list">' + rows.slice(-20).reverse().map(function (r) {
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.title) + '</div>' +
                '<div class="mv-list-meta">' + esc(r.kind) + ' · generated ' + esc(fmtDate(r.created_at)) + '</div>' +
              '</div>' +
              '<span class="mv-badge">' + esc(r.format || 'pdf') + '</span>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#128203;', 'No reports yet. Generate one to see it here.')
    ].join('');

    host.querySelectorAll('[data-action="co-rep-gen"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var quarter = 'Q' + Math.floor(new Date().getUTCMonth() / 3 + 1) + ' ' + new Date().getUTCFullYear();
        rows.push({
          id: 'rep-' + Date.now(),
          title: 'Quarterly DPMS report — ' + quarter,
          kind: 'DPMSR',
          format: 'XML',
          created_at: new Date().toISOString()
        });
        safeSave(STORAGE.reports, rows);
        renderReports(host);
      });
    });
  }

  window.__landingModules = window.__landingModules || {};
  window.__landingModules['compliance-ops'] = {
    training: renderTraining,
    employees: renderEmployees,
    incidents: renderIncidents,
    reports: renderReports
  };
})();
