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

  function createAsanaTaskRemote(source, payload) {
    if (window.__hawkeyeAsana && window.__hawkeyeAsana.createAsanaTaskRemote) {
      return window.__hawkeyeAsana.createAsanaTaskRemote(source, payload);
    }
    return Promise.resolve({ ok: false, error: 'asana-client-bridge.js not loaded' });
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
  var TASK_CATEGORIES = [
    ['cdd_review',      'CDD / EDD Review'],
    ['sanctions_screen','Sanctions Screening'],
    ['pep_refresh',     'PEP Refresh'],
    ['str_drafting',    'STR / SAR Drafting'],
    ['goaml_filing',    'goAML Filing'],
    ['training',        'Staff Training'],
    ['audit_prep',      'Audit / Inspection Prep'],
    ['ubo_verify',      'UBO Re-verification'],
    ['policy_update',   'Policy Update'],
    ['risk_assessment', 'Risk Assessment (EWRA / CRA)'],
    ['tfs_check',       'TFS Freeze Confirmation'],
    ['monthly_attest',  'Monthly Attestation'],
    ['quarterly_kpi',   'Quarterly KPI Report'],
    ['annual_report',   'Annual Compliance Report'],
    ['ctr_filing',      'CTR Filing (AED 55K)'],
    ['cnmr_filing',     'CNMR Filing (5 bd)'],
    ['record_retention','Records Retention Check'],
    ['lbma_audit',      'LBMA RGG Annual Audit'],
    ['other',           'Other']
  ];
  var TASK_STATUSES = [
    ['open',        'Open'],
    ['in_progress', 'In progress'],
    ['blocked',     'Blocked'],
    ['review',      'In review'],
    ['completed',   'Completed']
  ];

  function renderComplianceTasks(host) {
    var tasks = safeParse(STORAGE.asanaTasks, []);
    var openTasks = tasks.filter(function (t) { return !t.completed && t.status !== 'completed'; });
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
    var highPriority = openTasks.filter(function (t) { return t.priority === 'high' || t.priority === 'critical'; });

    var html = [
      head('Compliance Tasks',
        '<span class="mv-pill">FDL Art.24 · audit-logged</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="wb-task-new-toggle">+ New Task</button>'
      ),
      '<p class="mv-lede">MLRO task register synced with Asana. Every status change is audit-logged under <strong>FDL Art.24</strong>.</p>',
      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v">' + openTasks.length + '</div><div class="mv-stat-k">Open</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + overdue.length + '</div><div class="mv-stat-k">Overdue</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="accent">' + dueThisWeek.length + '</div><div class="mv-stat-k">Due this week</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + highPriority.length + '</div><div class="mv-stat-k">High priority</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v">' + tasks.length + '</div><div class="mv-stat-k">Total</div></div>',
      '</div>',

      '<form id="wb-task-form" class="mv-form" style="display:none">',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Task name</span>',
            '<input type="text" name="name" required placeholder="Short descriptive title"></label>',
          '<label class="mv-field"><span class="mv-field-label">Category</span>',
            '<select name="category">',
              TASK_CATEGORIES.map(function (p) {
                return '<option value="' + esc(p[0]) + '">' + esc(p[1]) + '</option>';
              }).join(''),
            '</select></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Priority</span>',
            '<select name="priority">',
              '<option value="low">Low</option>',
              '<option value="medium" selected>Medium</option>',
              '<option value="high">High</option>',
              '<option value="critical">Critical</option>',
            '</select></label>',
          '<label class="mv-field"><span class="mv-field-label">Due date (dd/mm/yyyy)</span>',
            '<input type="text" name="due_on" placeholder="dd/mm/yyyy"></label>',
          '<label class="mv-field"><span class="mv-field-label">Status</span>',
            '<select name="status">',
              TASK_STATUSES.map(function (p) {
                return '<option value="' + esc(p[0]) + '">' + esc(p[1]) + '</option>';
              }).join(''),
            '</select></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Assignee</span>',
            '<input type="text" name="assignee" placeholder="MLRO / CO / staff name"></label>',
          '<label class="mv-field"><span class="mv-field-label">Regulatory basis</span>',
            '<input type="text" name="citation" placeholder="e.g. FDL Art.20, Cab.Res 134/2025 Art.19"></label>',
          '<label class="mv-field"><span class="mv-field-label">Linked entity (optional)</span>',
            '<input type="text" name="entity" placeholder="Customer / counterparty / list"></label>',
        '</div>',
        '<label class="mv-field"><span class="mv-field-label">Notes</span>',
          '<textarea name="notes" rows="2" placeholder="Context, acceptance criteria, links"></textarea></label>',
        '<div class="mv-form-actions">',
          '<button type="submit" class="mv-btn mv-btn-primary">Save task</button>',
          '<button type="button" class="mv-btn mv-btn-ghost" data-action="wb-task-new-toggle">Cancel</button>',
        '</div>',
      '</form>'
    ];

    if (!openTasks.length) {
      html.push(emptyState('&#9997;', 'No open compliance tasks. Create one or sync from Asana.'));
    } else {
      html.push('<ul class="mv-list">');
      openTasks.slice(0, 25).forEach(function (t, i) {
        var catLabel = (TASK_CATEGORIES.filter(function (p) { return p[0] === t.category; })[0] || [null, t.category || ''])[1];
        var statusLabel = (TASK_STATUSES.filter(function (p) { return p[0] === t.status; })[0] || [null, t.status || 'open'])[1];
        var overdueFlag = t.due_on && new Date(t.due_on) < new Date();
        var prio = t.priority || 'medium';
        var prioTone = prio === 'critical' || prio === 'high' ? 'warn' : prio === 'medium' ? 'accent' : 'ok';
        var syncBadge = '';
        if (t.sync_status === 'synced' && t.asanaUrl) {
          syncBadge = ' <a class="mv-badge" data-tone="ok" href="' + esc(t.asanaUrl) + '" target="_blank" rel="noopener noreferrer">Asana ↗</a>';
        } else if (t.sync_status === 'pending') {
          syncBadge = ' <span class="mv-badge" data-tone="accent">syncing…</span>';
        } else if (t.sync_status === 'failed') {
          syncBadge = ' <span class="mv-badge" data-tone="warn" title="' + esc(t.sync_error || '') + '">Asana failed</span>';
        }
        html.push(
          '<li class="mv-list-item">' +
            '<div class="mv-list-main">' +
              '<div class="mv-list-title">' + esc(t.name || 'Untitled task') +
                (catLabel ? ' <span class="mv-badge" data-tone="accent">' + esc(catLabel) + '</span>' : '') +
                syncBadge +
              '</div>' +
              '<div class="mv-list-meta">Due ' + esc(fmtDate(t.due_on)) +
                (overdueFlag ? ' <em data-tone="warn">(overdue)</em>' : '') +
                ' · ' + esc(t.assignee || t.assignee_name || 'Unassigned') +
                (t.citation ? ' · ' + esc(t.citation) : '') +
              '</div>' +
              (t.notes ? '<div class="mv-list-meta" style="opacity:.75">' + esc(t.notes) + '</div>' : '') +
            '</div>' +
            '<div class="mv-list-aside">' +
              '<span class="mv-badge" data-tone="' + prioTone + '">' + esc(prio) + '</span>' +
              '<span class="mv-badge">' + esc(statusLabel) + '</span>' +
              '<button class="mv-btn mv-btn-sm mv-btn-ok" data-action="wb-task-complete" data-idx="' + i + '">Done</button>' +
            '</div>' +
          '</li>'
        );
      });
      html.push('</ul>');
    }

    host.innerHTML = html.join('');

    host.querySelectorAll('[data-action="wb-task-new-toggle"]').forEach(function (btn) {
      btn.onclick = function () {
        var form = host.querySelector('#wb-task-form');
        if (!form) return;
        form.style.display = form.style.display === 'none' ? '' : 'none';
        if (form.style.display !== 'none') form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    });
    var form = host.querySelector('#wb-task-form');
    if (form) {
      form.onsubmit = function (ev) {
        ev.preventDefault();
        var fd = new FormData(form);
        var toIso = function (dmy) {
          var s = (dmy || '').toString().trim();
          var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (!m) return null;
          return m[3] + '-' + m[2].padStart(2,'0') + '-' + m[1].padStart(2,'0');
        };
        var localId = 'local-' + Date.now();
        var newTask = {
          gid: localId,
          localId: localId,
          name: (fd.get('name') || '').toString().trim(),
          category: fd.get('category') || 'other',
          priority: fd.get('priority') || 'medium',
          due_on: toIso(fd.get('due_on')),
          status: fd.get('status') || 'open',
          assignee: (fd.get('assignee') || '').toString().trim() || 'MLRO',
          assignee_name: (fd.get('assignee') || '').toString().trim() || 'MLRO',
          citation: (fd.get('citation') || '').toString().trim(),
          entity: (fd.get('entity') || '').toString().trim(),
          notes: (fd.get('notes') || '').toString().trim(),
          completed: false,
          sync_status: 'pending',
          created_at: new Date().toISOString()
        };
        tasks.push(newTask);
        safeSave(STORAGE.asanaTasks, tasks);
        renderComplianceTasks(host);

        // Async best-effort sync to Asana via the unified backend.
        var notesLines = [
          newTask.notes || '(no notes)',
          '',
          'Entered from /workbench Compliance Tasks surface.',
          'Due: ' + (newTask.due_on || 'n/a'),
          'Assignee (display): ' + newTask.assignee
        ];
        createAsanaTaskRemote('workbench', {
          name: newTask.name,
          notes: notesLines.join('\n'),
          category: newTask.category,
          priority: newTask.priority,
          dueOn: newTask.due_on || undefined,
          citation: newTask.citation || undefined,
          entity: newTask.entity || undefined,
          assignee: newTask.assignee
        }).then(function (res) {
          var current = safeParse(STORAGE.asanaTasks, []);
          var idx = -1;
          for (var i = 0; i < current.length; i++) {
            if (current[i].localId === localId) { idx = i; break; }
          }
          if (idx < 0) return;
          if (res.ok && res.gid) {
            current[idx].gid = res.gid;
            current[idx].asanaUrl = res.url || null;
            current[idx].projectGid = res.projectGid || null;
            current[idx].sync_status = 'synced';
            current[idx].synced_at = new Date().toISOString();
          } else {
            current[idx].sync_status = 'failed';
            current[idx].sync_error = res.error || 'unknown';
          }
          safeSave(STORAGE.asanaTasks, current);
          tasks = current;
          renderComplianceTasks(host);
        });
      };
    }
    host.querySelectorAll('[data-action="wb-task-complete"]').forEach(function (btn) {
      btn.onclick = function () {
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        var target = openTasks[idx];
        if (!target) return;
        var global = tasks.indexOf(target);
        if (global >= 0) {
          tasks[global].completed = true;
          tasks[global].status = 'completed';
          tasks[global].completed_at = new Date().toISOString();
          safeSave(STORAGE.asanaTasks, tasks);
          renderComplianceTasks(host);
        }
      };
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
      form.onsubmit = function (ev) {
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
      };
    }
  }

  // ─── Module 03 · Approvals ────────────────────────────────────────
  var APPROVAL_KINDS = [
    ['edd_upgrade',      'EDD Upgrade (SDD/CDD → EDD)'],
    ['freeze_confirm',   'Asset Freeze Confirmation (24h EOCN)'],
    ['freeze_release',   'Asset Freeze Release'],
    ['str_filing',       'STR / SAR Filing'],
    ['ctr_filing',       'CTR Filing (AED 55K+)'],
    ['cnmr_filing',      'CNMR Filing (5 bd)'],
    ['sanction_override','Sanctions False-Positive Dismiss'],
    ['pep_onboard',      'PEP Onboarding'],
    ['high_risk_onboard','High-Risk Customer Onboarding'],
    ['counterparty_add', 'Counterparty Allowlist Addition'],
    ['policy_change',    'Policy / Procedure Change'],
    ['threshold_override','Threshold Override'],
    ['ubo_disclose',     'UBO Disclosure Waiver'],
    ['cash_over_55k',    'Cash Transaction ≥ AED 55K'],
    ['vasp_onboard',     'VASP / Virtual Asset Onboarding'],
    ['other',            'Other']
  ];

  function renderApprovals(host) {
    var approvals = safeParse(STORAGE.approvals, []);
    var pending = approvals.filter(function (a) { return a.status === 'pending'; });
    var approved = approvals.filter(function (a) { return a.status === 'approved'; });
    var rejected = approvals.filter(function (a) { return a.status === 'rejected'; });
    var urgent = pending.filter(function (a) { return a.priority === 'critical' || a.priority === 'high'; });

    host.innerHTML = [
      head('Four-Eyes Approvals',
        '<span class="mv-pill">Cabinet Res 134/2025 Art.19 · SoD</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="wb-appr-new-toggle">+ New approval</button>'
      ),
      '<p class="mv-lede">High-risk decisions — EDD upgrades, freeze confirmations, STR filings — require two independent approvers. Every action is written to the 10-year audit trail.</p>',

      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + pending.length + '</div><div class="mv-stat-k">Pending</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + urgent.length + '</div><div class="mv-stat-k">Urgent</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="ok">' + approved.length + '</div><div class="mv-stat-k">Approved</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v">' + rejected.length + '</div><div class="mv-stat-k">Rejected</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v">' + approvals.length + '</div><div class="mv-stat-k">Total</div></div>',
      '</div>',

      '<form id="wb-appr-form" class="mv-form" style="display:none">',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Approval title</span>',
            '<input type="text" name="title" required placeholder="What needs approval?"></label>',
          '<label class="mv-field"><span class="mv-field-label">Kind</span>',
            '<select name="kind">',
              APPROVAL_KINDS.map(function (p) {
                return '<option value="' + esc(p[0]) + '">' + esc(p[1]) + '</option>';
              }).join(''),
            '</select></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Subject / counterparty</span>',
            '<input type="text" name="subject" placeholder="Customer / entity"></label>',
          '<label class="mv-field"><span class="mv-field-label">Amount (AED, if any)</span>',
            '<input type="number" name="amount" min="0" step="0.01" placeholder="0.00"></label>',
          '<label class="mv-field"><span class="mv-field-label">Priority</span>',
            '<select name="priority">',
              '<option value="low">Low</option>',
              '<option value="medium" selected>Medium</option>',
              '<option value="high">High</option>',
              '<option value="critical">Critical</option>',
            '</select></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Initiator (MLRO)</span>',
            '<input type="text" name="initiator" placeholder="Name" value="MLRO"></label>',
          '<label class="mv-field"><span class="mv-field-label">Deadline (dd/mm/yyyy)</span>',
            '<input type="text" name="deadline" placeholder="dd/mm/yyyy"></label>',
          '<label class="mv-field"><span class="mv-field-label">Regulatory citation</span>',
            '<input type="text" name="citation" placeholder="e.g. Cab.Res 134/2025 Art.19"></label>',
        '</div>',
        '<label class="mv-field"><span class="mv-field-label">Justification</span>',
          '<textarea name="justification" rows="3" placeholder="Why this requires four-eyes — risk, threshold, regulatory driver"></textarea></label>',
        '<div class="mv-form-actions">',
          '<button type="submit" class="mv-btn mv-btn-primary">Queue approval</button>',
          '<button type="button" class="mv-btn mv-btn-ghost" data-action="wb-appr-new-toggle">Cancel</button>',
        '</div>',
      '</form>',

      pending.length
        ? '<ul class="mv-list">' + pending.map(function (a, i) {
            var kindLabel = (APPROVAL_KINDS.filter(function (p) { return p[0] === a.kind; })[0] || [null, a.kind || 'Other'])[1];
            var prio = a.priority || 'medium';
            var prioTone = prio === 'critical' || prio === 'high' ? 'warn' : prio === 'medium' ? 'accent' : 'ok';
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(a.title) +
                  ' <span class="mv-badge" data-tone="accent">' + esc(kindLabel) + '</span>' +
                  ' <span class="mv-badge" data-tone="' + prioTone + '">' + esc(prio) + '</span>' +
                '</div>' +
                '<div class="mv-list-meta">' +
                  (a.subject ? 'Subject: ' + esc(a.subject) + ' · ' : '') +
                  (a.amount ? 'AED ' + esc(Number(a.amount).toLocaleString()) + ' · ' : '') +
                  'initiated by ' + esc(a.initiator || 'unknown') +
                  ' · ' + esc(fmtDate(a.created_at)) +
                  (a.deadline ? ' · deadline ' + esc(fmtDate(a.deadline)) : '') +
                '</div>' +
                (a.justification ? '<div class="mv-list-meta" style="opacity:.75">' + esc(a.justification.slice(0, 200)) + (a.justification.length > 200 ? '…' : '') + '</div>' : '') +
                (a.citation ? '<div class="mv-list-meta">Citation: ' + esc(a.citation) + '</div>' : '') +
              '</div>' +
              '<div class="mv-list-aside">' +
                '<button class="mv-btn mv-btn-sm mv-btn-ok" data-action="wb-appr-approve" data-idx="' + i + '">Approve</button>' +
                '<button class="mv-btn mv-btn-sm mv-btn-ghost" data-action="wb-appr-reject" data-idx="' + i + '">Reject</button>' +
              '</div>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#9989;', 'No approvals waiting. All decisions are up to date.')
    ].join('');

    host.querySelectorAll('[data-action="wb-appr-new-toggle"]').forEach(function (btn) {
      btn.onclick = function () {
        var form = host.querySelector('#wb-appr-form');
        if (!form) return;
        form.style.display = form.style.display === 'none' ? '' : 'none';
        if (form.style.display !== 'none') form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    });
    var form = host.querySelector('#wb-appr-form');
    if (form) {
      form.onsubmit = function (ev) {
        ev.preventDefault();
        var fd = new FormData(form);
        var toIso = function (dmy) {
          var s = (dmy || '').toString().trim();
          var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (!m) return null;
          return m[3] + '-' + m[2].padStart(2,'0') + '-' + m[1].padStart(2,'0');
        };
        approvals.push({
          id: 'appr-' + Date.now(),
          title: (fd.get('title') || '').toString().trim(),
          kind: fd.get('kind') || 'other',
          subject: (fd.get('subject') || '').toString().trim(),
          amount: parseFloat(fd.get('amount')) || 0,
          priority: fd.get('priority') || 'medium',
          initiator: (fd.get('initiator') || 'MLRO').toString().trim(),
          deadline: toIso(fd.get('deadline')),
          citation: (fd.get('citation') || '').toString().trim(),
          justification: (fd.get('justification') || '').toString().trim(),
          status: 'pending',
          created_at: new Date().toISOString()
        });
        safeSave(STORAGE.approvals, approvals);
        renderApprovals(host);
      };
    }
    host.querySelectorAll('[data-action="wb-appr-approve"]').forEach(function (btn) {
      btn.onclick = function () {
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
      };
    });
    host.querySelectorAll('[data-action="wb-appr-reject"]').forEach(function (btn) {
      btn.onclick = function () {
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
      };
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
