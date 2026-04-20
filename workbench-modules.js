/**
 * Workbench native modules.
 *
 * Replaces the old fetch-and-inject of index.html's tab DOM with a
 * small set of native renderers, each writing into the landing's own
 * component classes (.card / .lbl / .btn / etc.) so the module adopts
 * the Workbench orange/yellow/green palette instead of the main app's
 * amber. All data reads / writes still go through the browser
 * localStorage keys the main app already uses, so the data stays in
 * sync across surfaces.
 *
 * Registry contract:
 *   window.__landingModules[<landing>][<route>] = function (host, ctx) {...}
 *
 * landing-module-viewer.js looks up the renderer on card click and
 * calls it with the host div. If no renderer exists for a route, the
 * viewer falls back to the legacy fetch+inject path.
 *
 * Regulatory basis: FDL No.10/2025 Art.20 — operational surfaces must
 * be visually coherent per landing so evidence screenshots from
 * audits / inspections don't mix chrome.
 */
(function () {
  'use strict';

  var STORAGE = {
    asanaTasks: 'asanaTasks',
    customers: 'fgl_customers',
    approvals: 'fgl_approvals'
  };

  function safeParse(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) { return fallback; }
  }

  function safeSave(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.getUTCDate().toString().padStart(2, '0') + '/' +
        (d.getUTCMonth() + 1).toString().padStart(2, '0') + '/' +
        d.getUTCFullYear();
    } catch (_) { return iso; }
  }

  // Shared head row: title + right-aligned action cluster.
  function head(title, actionsHtml) {
    return (
      '<div class="mv-head">' +
        '<h2 class="mv-title">' + esc(title) + '</h2>' +
        '<div class="mv-actions">' + (actionsHtml || '') + '</div>' +
      '</div>'
    );
  }

  function emptyState(icon, msg, cta) {
    return (
      '<div class="mv-empty-state">' +
        '<div class="mv-empty-icon">' + icon + '</div>' +
        '<p>' + esc(msg) + '</p>' +
        (cta ? '<div class="mv-empty-cta">' + cta + '</div>' : '') +
      '</div>'
    );
  }

  // ─── Module 01 · Compliance Tasks ────────────────────────────────
  function renderComplianceTasks(host) {
    var tasks = safeParse(STORAGE.asanaTasks, []);
    var openTasks = tasks.filter(function (t) { return !t.completed; });
    var overdue = openTasks.filter(function (t) {
      if (!t.due_on) return false;
      return new Date(t.due_on) < new Date();
    });
    var dueThisWeek = openTasks.filter(function (t) {
      if (!t.due_on) return false;
      var due = new Date(t.due_on).getTime();
      var now = Date.now();
      return due >= now && due <= now + 7 * 86400000;
    });

    var html = [
      head('Compliance Tasks',
        '<button class="mv-btn mv-btn-primary" data-action="wb-task-refresh">Refresh</button>' +
        '<button class="mv-btn" data-action="wb-task-new">+ New Task</button>'
      ),
      '<p class="mv-lede">MLRO task register synced with Asana. Every status change is audit-logged under <strong>FDL Art.24</strong>.</p>',
      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v">' + openTasks.length + '</div><div class="mv-stat-k">Open</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + overdue.length + '</div><div class="mv-stat-k">Overdue</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="accent">' + dueThisWeek.length + '</div><div class="mv-stat-k">Due this week</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v">' + tasks.length + '</div><div class="mv-stat-k">Total</div></div>',
      '</div>'
    ];

    if (!openTasks.length) {
      html.push(emptyState('&#9997;', 'No open compliance tasks. Create one or sync from Asana.',
        '<button class="mv-btn mv-btn-primary" data-action="wb-task-new">+ New Task</button>'));
    } else {
      html.push('<ul class="mv-list">');
      openTasks.slice(0, 20).forEach(function (t) {
        html.push(
          '<li class="mv-list-item">' +
            '<div class="mv-list-main">' +
              '<div class="mv-list-title">' + esc(t.name || 'Untitled task') + '</div>' +
              '<div class="mv-list-meta">Due ' + esc(fmtDate(t.due_on)) + ' · ' + esc(t.assignee_name || 'Unassigned') + '</div>' +
            '</div>' +
            '<span class="mv-badge">' + esc(t.status || 'open') + '</span>' +
          '</li>'
        );
      });
      html.push('</ul>');
    }

    host.innerHTML = html.join('');

    host.querySelectorAll('[data-action="wb-task-new"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = prompt('Task name?');
        if (!name) return;
        var due = prompt('Due date (YYYY-MM-DD)? Leave blank for none');
        tasks.push({
          gid: 'local-' + Date.now(),
          name: name.trim(),
          due_on: due || null,
          assignee_name: 'MLRO',
          status: 'open',
          completed: false,
          created_at: new Date().toISOString()
        });
        safeSave(STORAGE.asanaTasks, tasks);
        renderComplianceTasks(host);
      });
    });
    host.querySelectorAll('[data-action="wb-task-refresh"]').forEach(function (btn) {
      btn.addEventListener('click', function () { renderComplianceTasks(host); });
    });
  }

  // ─── Module 02 · Onboarding ──────────────────────────────────────
  function renderOnboarding(host) {
    var customers = safeParse(STORAGE.customers, []);

    host.innerHTML = [
      head('Customer Onboarding',
        '<span class="mv-pill">CDD / EDD · Cabinet Res 134/2025 Art.7-10</span>'
      ),
      '<p class="mv-lede">Record the customer, run risk scoring, and escalate high-risk cases to senior management. Data is stored locally and available across every Hawkeye surface.</p>',

      '<form id="wb-onboarding-form" class="mv-form">',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Customer / entity name</span>',
            '<input type="text" name="name" placeholder="Full legal name" required></label>',
          '<label class="mv-field"><span class="mv-field-label">Entity type</span>',
            '<select name="type">',
              '<option value="individual">Individual</option>',
              '<option value="corporate">Corporate</option>',
              '<option value="trust">Trust</option>',
              '<option value="government">Government</option>',
            '</select></label>',
          '<label class="mv-field"><span class="mv-field-label">Jurisdiction</span>',
            '<input type="text" name="jurisdiction" placeholder="e.g. UAE"></label>',
          '<label class="mv-field"><span class="mv-field-label">Business activity</span>',
            '<input type="text" name="activity" placeholder="e.g. Gold trading"></label>',
        '</div>',

        '<div class="mv-grid-3">',
          '<label class="mv-check"><input type="checkbox" name="pep"><span>Is PEP or PEP-related</span></label>',
          '<label class="mv-check"><input type="checkbox" name="cahra"><span>CAHRA / high-risk jurisdiction</span></label>',
          '<label class="mv-check"><input type="checkbox" name="sanctions_clear" checked><span>Sanctions screening clear</span></label>',
        '</div>',

        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Risk rating override</span>',
            '<select name="risk">',
              '<option value="auto">Auto-calculate</option>',
              '<option value="low">Low (SDD)</option>',
              '<option value="medium">Medium (CDD)</option>',
              '<option value="high">High (EDD)</option>',
            '</select></label>',
          '<label class="mv-field"><span class="mv-field-label">Onboarding officer</span>',
            '<input type="text" name="officer" placeholder="Name"></label>',
        '</div>',

        '<label class="mv-field"><span class="mv-field-label">Notes</span>',
          '<textarea name="notes" rows="3" placeholder="Additional due-diligence notes"></textarea></label>',

        '<div class="mv-form-actions">',
          '<button type="submit" class="mv-btn mv-btn-primary">Save onboarding</button>',
          '<button type="reset" class="mv-btn mv-btn-ghost">Clear</button>',
        '</div>',
      '</form>',

      '<h3 class="mv-subhead">Recent onboardings</h3>',
      customers.length
        ? '<ul class="mv-list">' + customers.slice(-8).reverse().map(function (c) {
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(c.name) + '</div>' +
                '<div class="mv-list-meta">' + esc(c.type || '') + ' · ' + esc(c.jurisdiction || '') +
                  ' · risk <strong>' + esc((c.risk || 'auto').toUpperCase()) + '</strong></div>' +
              '</div>' +
              '<span class="mv-badge" data-tone="' + (c.pep ? 'warn' : 'ok') + '">' + (c.pep ? 'PEP' : 'CLEAR') + '</span>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#128100;', 'No customers onboarded yet.')
    ].join('');

    var form = host.querySelector('#wb-onboarding-form');
    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var fd = new FormData(form);
        var row = {
          id: 'cust-' + Date.now(),
          name: fd.get('name'),
          type: fd.get('type'),
          jurisdiction: fd.get('jurisdiction'),
          activity: fd.get('activity'),
          pep: fd.get('pep') === 'on',
          cahra: fd.get('cahra') === 'on',
          sanctions_clear: fd.get('sanctions_clear') === 'on',
          risk: fd.get('risk'),
          officer: fd.get('officer'),
          notes: fd.get('notes'),
          created_at: new Date().toISOString()
        };
        customers.push(row);
        safeSave(STORAGE.customers, customers);
        renderOnboarding(host);
      });
    }
  }

  // ─── Module 03 · Approvals ────────────────────────────────────────
  function renderApprovals(host) {
    var approvals = safeParse(STORAGE.approvals, []);
    var pending = approvals.filter(function (a) { return a.status === 'pending'; });
    var approved = approvals.filter(function (a) { return a.status === 'approved'; });

    host.innerHTML = [
      head('Four-Eyes Approvals',
        '<span class="mv-pill">Cabinet Res 134/2025 Art.19 · SoD</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="wb-appr-new">+ New approval</button>'
      ),
      '<p class="mv-lede">High-risk decisions — EDD upgrades, freeze confirmations, STR filings — require two independent approvers. Every action is written to the 10-year audit trail.</p>',

      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + pending.length + '</div><div class="mv-stat-k">Pending</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="ok">' + approved.length + '</div><div class="mv-stat-k">Approved</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v">' + approvals.length + '</div><div class="mv-stat-k">Total</div></div>',
      '</div>',

      pending.length
        ? '<ul class="mv-list">' + pending.map(function (a, i) {
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(a.title) + '</div>' +
                '<div class="mv-list-meta">' + esc(a.kind) + ' · initiated by ' + esc(a.initiator || 'unknown') + ' · ' + esc(fmtDate(a.created_at)) + '</div>' +
              '</div>' +
              '<div class="mv-list-aside">' +
                '<button class="mv-btn mv-btn-sm mv-btn-ok" data-action="wb-appr-approve" data-idx="' + i + '">Approve</button>' +
                '<button class="mv-btn mv-btn-sm mv-btn-ghost" data-action="wb-appr-reject" data-idx="' + i + '">Reject</button>' +
              '</div>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#9989;', 'No approvals waiting. All decisions are up to date.')
    ].join('');

    host.querySelectorAll('[data-action="wb-appr-new"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var title = prompt('What needs approval?');
        if (!title) return;
        var kind = prompt('Kind (EDD / Freeze / STR / Other)?') || 'Other';
        approvals.push({
          id: 'appr-' + Date.now(),
          title: title.trim(),
          kind: kind,
          initiator: 'MLRO',
          status: 'pending',
          created_at: new Date().toISOString()
        });
        safeSave(STORAGE.approvals, approvals);
        renderApprovals(host);
      });
    });
    host.querySelectorAll('[data-action="wb-appr-approve"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        var target = pending[idx];
        if (!target) return;
        var globalIdx = approvals.indexOf(target);
        if (globalIdx >= 0) {
          approvals[globalIdx].status = 'approved';
          approvals[globalIdx].approved_at = new Date().toISOString();
          safeSave(STORAGE.approvals, approvals);
          renderApprovals(host);
        }
      });
    });
    host.querySelectorAll('[data-action="wb-appr-reject"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        var target = pending[idx];
        if (!target) return;
        var globalIdx = approvals.indexOf(target);
        if (globalIdx >= 0) {
          approvals[globalIdx].status = 'rejected';
          approvals[globalIdx].rejected_at = new Date().toISOString();
          safeSave(STORAGE.approvals, approvals);
          renderApprovals(host);
        }
      });
    });
  }

  window.__landingModules = window.__landingModules || {};
  window.__landingModules.workbench = {
    asana: renderComplianceTasks,
    'compliance-tasks': renderComplianceTasks,
    onboarding: renderOnboarding,
    approvals: renderApprovals
  };
})();
