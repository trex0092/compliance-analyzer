/**
 * Compliance Ops native modules — pink / red palette.
 *
 * Full feature parity with the source-of-truth tabs in index.html:
 *   #tab-training, #tab-employees, #tab-incidents, (reports panel).
 *
 * Same contract as workbench-modules.js — every renderer writes into
 * the landing's own .mv-* component classes and reads / writes the
 * same localStorage keys the main app uses, so data stays in sync
 * across the SPA and every landing.
 *
 * Regulatory anchors:
 *   FDL No.(10)/2025 Art.20 (CO duties), Art.24 (10yr records),
 *   Art.26-27 (STR filing), Art.29 (no tipping off).
 *   Cabinet Res 134/2025 Art.19 (internal review + SoD).
 *   MoE Circular 08/AML/2021 §9 (DPMS training).
 */
(function () {
  'use strict';

  // ─── Storage keys (shared with main SPA) ──────────────────────────
  var STORAGE = {
    training:    'fgl_training_records',
    employees:   'fgl_employees',
    incidents:   'fgl_incidents',
    reports:     'fgl_report_history',
    whistle:     'fgl_whistleblower_reports',
    circulars:   'fgl_circular_tracker',
    minutes:     'fgl_meeting_minutes',
    schedules:   'fgl_report_schedules'
  };

  // ─── Helpers ──────────────────────────────────────────────────────
  function safeParse(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (_) { return fallback; }
  }
  function safeSave(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (_) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function uid(p) { return (p || 'id') + '-' + Date.now() + '-' + Math.floor(Math.random() * 1000); }
  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.getUTCDate().toString().padStart(2, '0') + '/' +
        (d.getUTCMonth() + 1).toString().padStart(2, '0') + '/' + d.getUTCFullYear();
    } catch (_) { return iso; }
  }
  function toIsoFromDMY(s) {
    if (!s) return '';
    var m = String(s).match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/);
    if (!m) return s;
    return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  }
  function daysUntil(iso) {
    if (!iso) return null;
    var d = new Date(iso).getTime();
    if (isNaN(d)) return null;
    return Math.round((d - Date.now()) / 86400000);
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
  function download(name, mime, content) {
    try {
      var blob = new Blob([content], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 0);
    } catch (e) { alert('Export failed: ' + e.message); }
  }
  function csvRow(fields) {
    return fields.map(function (v) {
      var s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',');
  }

  // ─── Training ─────────────────────────────────────────────────────
  // Source of truth: index.html #tab-training.
  // Fields: employee, department, totalTrainings, subject, provider,
  //         duration, completed, completed_on.
  // Regulatory basis: MoE Circular 08/AML/2021 §9; FDL Art.24 retention.
  var TRAINING_SUBJECTS = [
    'AML/CFT Foundations',
    'AML/CFT Refresher',
    'Sanctions Screening',
    'PEP Screening',
    'STR / SAR Drafting',
    'goAML Submission',
    'UBO Identification',
    'CDD / EDD Procedures',
    'Records Retention',
    'Dual-Use & PF Controls',
    'LBMA Responsible Sourcing',
    'Data Protection & Privacy',
    'Whistleblower & Tip-Off Protections',
    'Fraud & Internal Controls',
    'Transaction Monitoring',
    'Trade-Based Money Laundering (TBML)',
    'Enterprise-Wide Risk Assessment (EWRA)',
    'Customer Risk Rating',
    'Cross-Border Cash & BNI Declarations (AED 60K)',
    'DPMS Cash Threshold Reporting (AED 55K)',
    'Asset Freeze & TFS (Cabinet Res 74/2020)',
    'High-Risk Jurisdictions / CAHRA',
    'LBMA RGG 5-Step Framework',
    'Dubai Good Delivery (DGD) Standards',
    'Responsible Sourcing of Gold (UAE MoE RSG)',
    'Virtual Assets & VASP Risks',
    'Proliferation Financing (Cabinet Res 156/2025)',
    'Source of Funds / Source of Wealth',
    'Beneficial Ownership Register (Cabinet Decision 109/2023)',
    'FATF Rec 16 — Wire Transfers',
    'FATF Rec 22/23 — DNFBP Obligations',
    'MoE Inspection Readiness',
    'Internal Audit of AML Programme',
    'New Technology Risk Assessment',
    'NPO & Charity Sector Risks',
    'Correspondent Relationships & Due Diligence',
    'Board & Senior Management AML Duties',
    'Four-Eyes Approval & Segregation of Duties',
    'No Tipping-Off (FDL Art.29)',
    'Gold-Specific Red Flags & Typologies',
    'Cybersecurity & AML Intersection',
    'Adverse Media & Open-Source Intelligence',
    'MLRO Role & Responsibilities',
    'UAE Penalties & Enforcement (Cabinet Res 71/2024)'
  ];

  function renderTraining(host) {
    var rows = safeParse(STORAGE.training, []);
    var completed = rows.filter(function (r) { return r.completed; });
    var expiring = rows.filter(function (r) {
      var d = daysUntil(r.expires_on);
      return d != null && d >= 0 && d <= 30;
    });
    var overdue = rows.filter(function (r) {
      var d = daysUntil(r.expires_on);
      return d != null && d < 0;
    });

    host.innerHTML = [
      head('Training Register',
        '<span class="mv-pill">MoE Circular 08/AML/2021 §9</span>'
      ),
      '<p class="mv-lede">AML/CFT, sanctions, and PEP-screening curricula per employee. Coverage logged against the 100% annual target. Retained 10 years under FDL Art.24.</p>',

      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v">' + rows.length + '</div><div class="mv-stat-k">Records</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="ok">' + completed.length + '</div><div class="mv-stat-k">Completed</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + expiring.length + '</div><div class="mv-stat-k">Expiring 30d</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + overdue.length + '</div><div class="mv-stat-k">Overdue</div></div>',
      '</div>',

      '<form id="co-train-form" class="mv-form">',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Employee name</span>',
            '<input type="text" name="employee" placeholder="Full name" required></label>',
          '<label class="mv-field"><span class="mv-field-label">Department</span>',
            '<input type="text" name="department" placeholder="e.g. Operations"></label>',
          '<label class="mv-field"><span class="mv-field-label">Total trainings (YTD)</span>',
            '<input type="number" name="total" min="0" step="1" value="1"></label>',
        '</div>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Subject</span>',
            '<select name="subject">',
              TRAINING_SUBJECTS.map(function (s) {
                return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
              }).join(''),
            '</select></label>',
          '<label class="mv-field"><span class="mv-field-label">Provider</span>',
            '<input type="text" name="provider" placeholder="ACAMS, in-house, etc."></label>',
        '</div>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Duration (hrs)</span>',
            '<input type="number" name="duration" min="0" step="0.5" placeholder="0"></label>',
          '<label class="mv-field"><span class="mv-field-label">Completed on (dd/mm/yyyy)</span>',
            '<input type="text" name="completed_on" placeholder="dd/mm/yyyy"></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-check"><input type="checkbox" name="completed" checked><span>Completed</span></label>',
        '</div>',
        '<div class="mv-form-actions">',
          '<button type="submit" class="mv-btn mv-btn-primary">Add Employee Training</button>',
          '<button type="reset" class="mv-btn mv-btn-ghost">Reset</button>',
        '</div>',
      '</form>',

      '<h3 class="mv-subhead">Register</h3>',
      rows.length
        ? '<ul class="mv-list">' + rows.slice().reverse().slice(0, 50).map(function (r) {
            var exp = daysUntil(r.expires_on);
            var tone = r.completed ? (exp != null && exp < 0 ? 'warn' : exp != null && exp <= 30 ? 'accent' : 'ok') : 'warn';
            var badge = r.completed ? (exp != null && exp < 0 ? 'Expired' : exp != null && exp <= 30 ? 'Expiring' : 'Done') : 'Pending';
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.employee) + ' — ' + esc(r.subject) + '</div>' +
                '<div class="mv-list-meta">' +
                  esc(r.department || '—') + ' · ' + esc(r.provider || 'in-house') + ' · ' +
                  (r.duration ? esc(r.duration) + 'h · ' : '') +
                  'completed ' + esc(fmtDate(r.completed_on)) + ' · expires ' + esc(fmtDate(r.expires_on)) +
                '</div>' +
              '</div>' +
              '<div class="mv-list-aside">' +
                '<span class="mv-badge" data-tone="' + tone + '">' + badge + '</span>' +
                '<button class="mv-btn mv-btn-sm mv-btn-ghost" data-action="co-train-del" data-id="' + esc(r.id) + '">×</button>' +
              '</div>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#127891;', 'No training records yet. Add one above to start the register.')
    ].join('');

    var form = host.querySelector('#co-train-form');
    if (form) {
      form.onsubmit = function (ev) {
        ev.preventDefault();
        var fd = new FormData(form);
        var row = {
          id: uid('tr'),
          employee: (fd.get('employee') || '').toString().trim(),
          department: (fd.get('department') || '').toString().trim(),
          total: parseInt(fd.get('total'), 10) || 1,
          subject: fd.get('subject'),
          provider: (fd.get('provider') || '').toString().trim(),
          duration: parseFloat(fd.get('duration')) || 0,
          completed: fd.get('completed') === 'on',
          completed_on: toIsoFromDMY(fd.get('completed_on')) || new Date().toISOString().slice(0, 10),
          created_at: new Date().toISOString()
        };
        if (!row.employee) return;
        rows.push(row);
        safeSave(STORAGE.training, rows);
        renderTraining(host);
      };
    }
    host.querySelectorAll('[data-action="co-train-del"]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-id');
        var next = rows.filter(function (r) { return r.id !== id; });
        safeSave(STORAGE.training, next);
        renderTraining(host);
      };
    });
  }

  // ─── Employees ────────────────────────────────────────────────────
  // Source of truth: index.html #tab-employees.
  // Regulatory basis: Cabinet Res 134/2025 Art.19 (SoD), FDL Art.20 (CO).
  var BUSINESS_UNITS = [
    'MADISON JEWELLERY TRADING L.L.C',
    'NAPLES JEWELLERY TRADING L.L.C',
    'GRAMALTIN A.S',
    'ZOE Precious Metals and Jewelery (FZE)',
    'FINE GOLD'
  ];

  function renderEmployees(host) {
    var rows = safeParse(STORAGE.employees, []);
    var q = (host.__empQuery || '').toLowerCase();
    var filtered = q
      ? rows.filter(function (e) {
          return [e.name, e.email, e.designation, e.nationality, e.eid, e.passport]
            .some(function (v) { return (v || '').toString().toLowerCase().indexOf(q) !== -1; });
        })
      : rows;

    var mlros = rows.filter(function (e) { return e.mlro; });
    var kycOk = rows.filter(function (e) { return e.kyc_ok; });
    var docExpSoon = rows.filter(function (e) {
      var eid = daysUntil(e.eid_expiry);
      var pp  = daysUntil(e.passport_expiry);
      return (eid != null && eid >= 0 && eid <= 60) || (pp != null && pp >= 0 && pp <= 60);
    });

    host.innerHTML = [
      head('Employee Directory',
        '<span class="mv-pill">Cabinet Res 134/2025 Art.19 · SoD</span>' +
        '<button class="mv-btn mv-btn-sm mv-btn-ghost" data-action="co-emp-reset">New Employee</button>'
      ),
      '<p class="mv-lede">Staff registry with role, MLRO flag, four-eyes eligibility, KYC status, Emirates ID and passport expiry watch.</p>',

      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v">' + rows.length + '</div><div class="mv-stat-k">Employees</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="accent">' + mlros.length + '</div><div class="mv-stat-k">MLRO</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="ok">' + kycOk.length + '</div><div class="mv-stat-k">KYC verified</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + docExpSoon.length + '</div><div class="mv-stat-k">Doc expiring 60d</div></div>',
      '</div>',

      '<form id="co-emp-form" class="mv-form">',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Full name</span>',
            '<input type="text" name="name" placeholder="Full legal name" required></label>',
          '<label class="mv-field"><span class="mv-field-label">Date of birth (dd/mm/yyyy)</span>',
            '<input type="text" name="dob" placeholder="dd/mm/yyyy"></label>',
        '</div>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Nationality</span>',
            '<input type="text" name="nationality" placeholder="e.g. UAE, India, Philippines"></label>',
          '<label class="mv-field"><span class="mv-field-label">Email</span>',
            '<input type="email" name="email" placeholder="employee@company.com"></label>',
        '</div>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Emirates ID</span>',
            '<input type="text" name="eid" placeholder="784-XXXX-XXXXXXX-X"></label>',
          '<label class="mv-field"><span class="mv-field-label">Emirates ID expiry (dd/mm/yyyy)</span>',
            '<input type="text" name="eid_expiry" placeholder="dd/mm/yyyy"></label>',
        '</div>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Passport number</span>',
            '<input type="text" name="passport" placeholder="Passport number"></label>',
          '<label class="mv-field"><span class="mv-field-label">Passport expiry (dd/mm/yyyy)</span>',
            '<input type="text" name="passport_expiry" placeholder="dd/mm/yyyy"></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Designation</span>',
            '<input type="text" name="designation" placeholder="e.g. Compliance Officer"></label>',
          '<label class="mv-field"><span class="mv-field-label">Date of joining (dd/mm/yyyy)</span>',
            '<input type="text" name="join_date" placeholder="dd/mm/yyyy"></label>',
          '<label class="mv-field"><span class="mv-field-label">Business unit</span>',
            '<select name="business_unit">',
              '<option value="">— select —</option>',
              BUSINESS_UNITS.map(function (b) {
                return '<option value="' + esc(b) + '">' + esc(b) + '</option>';
              }).join(''),
            '</select></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-check"><input type="checkbox" name="kyc_ok" checked><span>KYC verified</span></label>',
        '</div>',
        '<div class="mv-form-actions">',
          '<button type="submit" class="mv-btn mv-btn-primary">Save Employee</button>',
          '<button type="reset" class="mv-btn mv-btn-ghost">Reset</button>',
        '</div>',
      '</form>',

      '<div class="mv-subhead-row">',
        '<h3 class="mv-subhead">Directory</h3>',
        '<input type="text" id="co-emp-search" class="mv-search" placeholder="Search employees…" value="' + esc(q) + '">',
      '</div>',

      filtered.length
        ? '<ul class="mv-list">' + filtered.map(function (e) {
            var eid = daysUntil(e.eid_expiry);
            var pp  = daysUntil(e.passport_expiry);
            var warn = (eid != null && eid >= 0 && eid <= 60) || (pp != null && pp >= 0 && pp <= 60);
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(e.name) +
                  (e.mlro ? ' <span class="mv-badge" data-tone="accent">MLRO</span>' : '') +
                  (e.four_eyes ? ' <span class="mv-badge" data-tone="accent">4-EYES</span>' : '') +
                '</div>' +
                '<div class="mv-list-meta">' +
                  esc(e.designation || '—') + ' · ' +
                  esc(e.business_unit || 'no unit') + ' · ' +
                  esc(e.nationality || '') +
                  (e.email ? ' · ' + esc(e.email) : '') +
                '</div>' +
                '<div class="mv-list-meta">' +
                  'EID ' + esc(fmtDate(e.eid_expiry)) +
                  (eid != null && eid < 0 ? ' <em data-tone="warn">(expired)</em>' : eid != null && eid <= 60 ? ' <em data-tone="warn">(expires in ' + eid + 'd)</em>' : '') +
                  ' · Passport ' + esc(fmtDate(e.passport_expiry)) +
                  (pp != null && pp < 0 ? ' <em data-tone="warn">(expired)</em>' : pp != null && pp <= 60 ? ' <em data-tone="warn">(expires in ' + pp + 'd)</em>' : '') +
                '</div>' +
              '</div>' +
              '<div class="mv-list-aside">' +
                '<span class="mv-badge" data-tone="' + (e.kyc_ok ? 'ok' : 'warn') + '">' + (e.kyc_ok ? 'KYC ✓' : 'KYC pending') + '</span>' +
                (warn ? '<span class="mv-badge" data-tone="warn">Doc renewal</span>' : '') +
                '<button class="mv-btn mv-btn-sm mv-btn-ghost" data-action="co-emp-del" data-id="' + esc(e.id) + '">×</button>' +
              '</div>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#128100;', q ? 'No employees match your search.' : 'No employees registered. Add one above.')
    ].join('');

    var form = host.querySelector('#co-emp-form');
    if (form) {
      form.onsubmit = function (ev) {
        ev.preventDefault();
        var fd = new FormData(form);
        var row = {
          id: uid('emp'),
          name: (fd.get('name') || '').toString().trim(),
          dob: toIsoFromDMY(fd.get('dob')) || '',
          nationality: (fd.get('nationality') || '').toString().trim(),
          email: (fd.get('email') || '').toString().trim(),
          eid: (fd.get('eid') || '').toString().trim(),
          eid_expiry: toIsoFromDMY(fd.get('eid_expiry')) || '',
          passport: (fd.get('passport') || '').toString().trim(),
          passport_expiry: toIsoFromDMY(fd.get('passport_expiry')) || '',
          designation: (fd.get('designation') || '').toString().trim(),
          join_date: toIsoFromDMY(fd.get('join_date')) || '',
          business_unit: fd.get('business_unit') || '',
          kyc_ok: fd.get('kyc_ok') === 'on',
          created_at: new Date().toISOString()
        };
        if (!row.name) return;
        rows.push(row);
        safeSave(STORAGE.employees, rows);
        host.__empQuery = '';
        renderEmployees(host);
      };
    }
    var search = host.querySelector('#co-emp-search');
    if (search) {
      search.oninput = function () {
        host.__empQuery = search.value || '';
        var pos = search.selectionStart;
        renderEmployees(host);
        var next = host.querySelector('#co-emp-search');
        if (next) { next.focus(); try { next.setSelectionRange(pos, pos); } catch (_) {} }
      };
    }
    host.querySelectorAll('[data-action="co-emp-del"]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-id');
        if (!confirm('Remove this employee from the directory?')) return;
        var next = rows.filter(function (r) { return r.id !== id; });
        safeSave(STORAGE.employees, next);
        renderEmployees(host);
      };
    });
    host.querySelectorAll('[data-action="co-emp-reset"]').forEach(function (btn) {
      btn.onclick = function () {
        var f = host.querySelector('#co-emp-form');
        if (f) f.reset();
      };
    });
  }
  // ─── Incidents ────────────────────────────────────────────────────
  // Source of truth: index.html #tab-incidents.
  // Covers Incident Register + Whistleblower + STR/SAR trigger.
  // Regulatory basis: Cabinet Res 74/2020 Art.4-7 (freeze),
  //                   FDL Art.26-27 (STR filing),
  //                   FDL Art.29 (no tipping off).
  var INC_TYPES = {
    'Compliance': [
      ['breach', 'Compliance Breach'],
      ['aml_violation', 'AML Violation'],
      ['kyc_failure', 'KYC/CDD Failure'],
      ['tfs_violation', 'TFS Violation'],
      ['pep_issue', 'PEP Issue']
    ],
    'Criminal / Financial': [
      ['suspicious', 'Suspicious Activity'],
      ['fraud', 'Fraud'],
      ['sanctions_hit', 'Sanctions Hit'],
      ['money_laundering', 'Money Laundering']
    ],
    'Operational': [
      ['data_breach', 'Data Breach'],
      ['regulatory', 'Regulatory Notice'],
      ['whistleblower', 'Whistleblower Report'],
      ['str_filed', 'STR/SAR Filed']
    ]
  };
  var INC_TYPE_LABELS = (function () {
    var m = {};
    Object.keys(INC_TYPES).forEach(function (g) {
      INC_TYPES[g].forEach(function (p) { m[p[0]] = p[1]; });
    });
    m.other = 'Other';
    return m;
  })();
  var ROOT_CAUSES = [
    ['human_error', 'Human Error'],
    ['process_gap', 'Process / Procedure Gap'],
    ['system_failure', 'System / IT Failure'],
    ['training_gap', 'Training Deficiency'],
    ['third_party', 'Third Party / Vendor'],
    ['deliberate', 'Deliberate / Intentional'],
    ['regulatory_change', 'Regulatory Change'],
    ['unknown', 'Under Investigation']
  ];

  function renderIncidents(host) {
    var rows = safeParse(STORAGE.incidents, []);
    var whistle = safeParse(STORAGE.whistle, []);
    var filters = host.__incFilters || { status: '', severity: '', type: '', q: '' };

    var filtered = rows.filter(function (r) {
      if (filters.status   && r.status   !== filters.status)   return false;
      if (filters.severity && r.severity !== filters.severity) return false;
      if (filters.type     && r.type     !== filters.type)     return false;
      if (filters.q) {
        var q = filters.q.toLowerCase();
        if (![r.title, r.description, r.entities, r.reporter, r.department]
          .some(function (v) { return (v || '').toString().toLowerCase().indexOf(q) !== -1; })) return false;
      }
      return true;
    });

    var open = rows.filter(function (r) { return r.status === 'open'; });
    var investigating = rows.filter(function (r) { return r.status === 'investigating'; });
    var closed = rows.filter(function (r) { return r.status === 'closed'; });
    var crit = rows.filter(function (r) { return r.severity === 'critical' || r.severity === 'high'; });

    function typeOptions() {
      return Object.keys(INC_TYPES).map(function (g) {
        return '<optgroup label="' + esc(g) + '">' +
          INC_TYPES[g].map(function (p) {
            return '<option value="' + esc(p[0]) + '">' + esc(p[1]) + '</option>';
          }).join('') + '</optgroup>';
      }).join('') + '<option value="other">Other</option>';
    }
    function filterTypeOptions() {
      var flat = [];
      Object.keys(INC_TYPES).forEach(function (g) {
        INC_TYPES[g].forEach(function (p) { flat.push(p); });
      });
      flat.push(['other', 'Other']);
      return '<option value="">All Types</option>' + flat.map(function (p) {
        return '<option value="' + esc(p[0]) + '"' + (filters.type === p[0] ? ' selected' : '') + '>' + esc(p[1]) + '</option>';
      }).join('');
    }

    host.innerHTML = [
      head('Incident Register',
        '<span class="mv-pill">Cabinet Res 74/2020 Art.4-7 · FDL Art.26-29</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="co-inc-new-toggle">+ New incident</button>'
      ),
      '<p class="mv-lede">Sanctions matches, suspected tipping-off, breaches, whistleblower reports. Every record feeds the STR/SAR pipeline and the 24h EOCN + 5-business-day CNMR countdowns. No-tip-off protections apply (FDL Art.29).</p>',

      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v">' + rows.length + '</div><div class="mv-stat-k">Total</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + open.length + '</div><div class="mv-stat-k">Open</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="accent">' + investigating.length + '</div><div class="mv-stat-k">Investigating</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="ok">' + closed.length + '</div><div class="mv-stat-k">Closed</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + crit.length + '</div><div class="mv-stat-k">Critical / High</div></div>',
      '</div>',

      '<div class="mv-filter-row">',
        '<select id="co-inc-f-status" class="mv-filter">',
          '<option value="">All Status</option>',
          ['open','investigating','escalated','closed'].map(function (s) {
            return '<option value="' + s + '"' + (filters.status === s ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>';
          }).join(''),
        '</select>',
        '<select id="co-inc-f-severity" class="mv-filter">',
          '<option value="">All Severity</option>',
          ['critical','high','medium','low'].map(function (s) {
            return '<option value="' + s + '"' + (filters.severity === s ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>';
          }).join(''),
        '</select>',
        '<select id="co-inc-f-type" class="mv-filter">', filterTypeOptions(), '</select>',
        '<input type="text" id="co-inc-f-q" class="mv-search" placeholder="Search incidents…" value="' + esc(filters.q) + '">',
      '</div>',

      '<form id="co-inc-form" class="mv-form" style="display:none">',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Incident title</span>',
            '<input type="text" name="title" placeholder="Brief description" required></label>',
          '<label class="mv-field"><span class="mv-field-label">Type</span>',
            '<select name="type">', typeOptions(), '</select></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Severity</span>',
            '<select name="severity">',
              '<option value="critical">Critical</option>',
              '<option value="high">High</option>',
              '<option value="medium" selected>Medium</option>',
              '<option value="low">Low</option>',
            '</select></label>',
          '<label class="mv-field"><span class="mv-field-label">Date discovered (dd/mm/yyyy)</span>',
            '<input type="text" name="discovered" placeholder="dd/mm/yyyy"></label>',
          '<label class="mv-field"><span class="mv-field-label">Deadline (dd/mm/yyyy)</span>',
            '<input type="text" name="deadline" placeholder="dd/mm/yyyy"></label>',
        '</div>',
        '<label class="mv-field"><span class="mv-field-label">Description</span>',
          '<textarea name="description" rows="3" placeholder="What happened, when, and how it was discovered"></textarea></label>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Affected entities</span>',
            '<input type="text" name="entities" placeholder="Customers / counterparties"></label>',
          '<label class="mv-field"><span class="mv-field-label">Reported by</span>',
            '<input type="text" name="reporter" placeholder="Name or \'Anonymous\'"></label>',
        '</div>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Department</span>',
            '<input type="text" name="department" placeholder="e.g. Operations, Compliance"></label>',
          '<label class="mv-field"><span class="mv-field-label">Root cause</span>',
            '<select name="root_cause">',
              '<option value="">Select root cause…</option>',
              ROOT_CAUSES.map(function (p) {
                return '<option value="' + esc(p[0]) + '">' + esc(p[1]) + '</option>';
              }).join(''),
            '</select></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-check"><input type="checkbox" name="str_required"><span>STR/SAR required (FDL Art.26-27)</span></label>',
          '<label class="mv-check"><input type="checkbox" name="freeze_required"><span>Asset freeze (Cab.Res 74/2020)</span></label>',
          '<label class="mv-check"><input type="checkbox" name="no_tip_off" checked><span>No tip-off observed (Art.29)</span></label>',
        '</div>',
        '<div class="mv-form-actions">',
          '<button type="submit" class="mv-btn mv-btn-primary">Log Incident</button>',
          '<button type="button" class="mv-btn mv-btn-ghost" data-action="co-inc-new-toggle">Cancel</button>',
        '</div>',
      '</form>',

      '<h3 class="mv-subhead">Register</h3>',
      filtered.length
        ? '<ul class="mv-list">' + filtered.slice().reverse().slice(0, 50).map(function (r) {
            var sevTone = r.severity === 'critical' || r.severity === 'high' ? 'warn'
              : r.severity === 'medium' ? 'accent' : 'ok';
            var statusTone = r.status === 'open' ? 'warn'
              : r.status === 'investigating' ? 'accent'
              : r.status === 'escalated' ? 'warn' : 'ok';
            var dlDays = daysUntil(r.deadline);
            var dlHint = dlDays != null
              ? (dlDays < 0 ? ' <em data-tone="warn">(overdue ' + Math.abs(dlDays) + 'd)</em>'
                 : dlDays <= 3 ? ' <em data-tone="warn">(' + dlDays + 'd left)</em>' : '')
              : '';
            var asanaBadge = '';
            if (r.asanaUrl) {
              asanaBadge = ' <a class="mv-badge" data-tone="ok" href="' + esc(r.asanaUrl) + '" target="_blank" rel="noopener noreferrer">Asana ↗</a>';
            } else if (r.asanaPending) {
              asanaBadge = ' <span class="mv-badge" data-tone="accent">syncing…</span>';
            } else if (r.asanaError) {
              asanaBadge = ' <span class="mv-badge" data-tone="warn" title="' + esc(r.asanaError) + '">Asana failed</span>';
            }
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.title) +
                  (r.str_required ? ' <span class="mv-badge" data-tone="warn">STR</span>' : '') +
                  (r.freeze_required ? ' <span class="mv-badge" data-tone="warn">FREEZE</span>' : '') +
                  asanaBadge +
                '</div>' +
                '<div class="mv-list-meta">' +
                  esc(INC_TYPE_LABELS[r.type] || r.type || 'Other') + ' · ' +
                  'opened ' + esc(fmtDate(r.created_at)) +
                  (r.deadline ? ' · deadline ' + esc(fmtDate(r.deadline)) + dlHint : '') +
                  (r.department ? ' · ' + esc(r.department) : '') +
                '</div>' +
                (r.description ? '<div class="mv-list-meta">' + esc(r.description.slice(0, 180)) + (r.description.length > 180 ? '…' : '') + '</div>' : '') +
              '</div>' +
              '<div class="mv-list-aside">' +
                '<span class="mv-badge" data-tone="' + sevTone + '">' + esc(r.severity || 'medium') + '</span>' +
                '<select class="mv-inline-select" data-action="co-inc-status" data-id="' + esc(r.id) + '">' +
                  ['open','investigating','escalated','closed'].map(function (s) {
                    return '<option value="' + s + '"' + (r.status === s ? ' selected' : '') + '>' + s + '</option>';
                  }).join('') +
                '</select>' +
                '<span class="mv-badge" data-tone="' + statusTone + '">' + esc(r.status) + '</span>' +
                (r.str_required && !r.str_generated_at
                  ? '<button class="mv-btn mv-btn-sm" data-action="co-inc-gen-str" data-id="' + esc(r.id) + '">Draft STR</button>'
                  : r.str_generated_at
                    ? '<span class="mv-badge" data-tone="ok">STR drafted ' + esc(fmtDate(r.str_generated_at)) + '</span>'
                    : '') +
                (!r.asanaUrl ? '<button class="mv-btn mv-btn-sm" data-action="co-inc-flag" data-id="' + esc(r.id) + '">Flag to Asana</button>' : '') +
                '<button class="mv-btn mv-btn-sm mv-btn-ghost" data-action="co-inc-del" data-id="' + esc(r.id) + '">×</button>' +
              '</div>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#9888;', rows.length ? 'No incidents match your filters.' : 'No incidents logged. Clean slate.'),

      '<h3 class="mv-subhead">Whistleblower intake <span class="mv-pill">FDL Art.29 · anonymous-safe</span></h3>',
      '<form id="co-whistle-form" class="mv-form">',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Subject (anonymous allowed)</span>',
            '<input type="text" name="subject" placeholder="What is being reported?" required></label>',
          '<label class="mv-field"><span class="mv-field-label">Channel</span>',
            '<select name="channel">',
              '<option value="hotline">Hotline</option>',
              '<option value="email">Email</option>',
              '<option value="portal">Portal</option>',
              '<option value="in_person">In person</option>',
              '<option value="letter">Letter</option>',
            '</select></label>',
        '</div>',
        '<label class="mv-field"><span class="mv-field-label">Details</span>',
          '<textarea name="details" rows="3" placeholder="Facts only. Do NOT include the name of anyone who may be tipped off."></textarea></label>',
        '<div class="mv-form-actions">',
          '<button type="submit" class="mv-btn mv-btn-primary">Log Report</button>',
        '</div>',
      '</form>',
      whistle.length
        ? '<ul class="mv-list">' + whistle.slice().reverse().slice(0, 10).map(function (w) {
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(w.subject) + '</div>' +
                '<div class="mv-list-meta">' + esc(w.channel) + ' · ' + esc(fmtDate(w.created_at)) + '</div>' +
                (w.details ? '<div class="mv-list-meta">' + esc(w.details.slice(0, 180)) + (w.details.length > 180 ? '…' : '') + '</div>' : '') +
              '</div>' +
              '<span class="mv-badge" data-tone="accent">anonymous-safe</span>' +
            '</li>';
          }).join('') + '</ul>'
        : '<p class="mv-lede" style="font-size:12px;opacity:.7">No whistleblower reports yet.</p>'
    ].join('');

    // Wire filters.
    function setFilter(key, val) {
      host.__incFilters = Object.assign({}, filters, (function () { var o = {}; o[key] = val; return o; })());
      renderIncidents(host);
    }
    var fs = host.querySelector('#co-inc-f-status');     if (fs) fs.onchange = function () { setFilter('status', fs.value); };
    var fv = host.querySelector('#co-inc-f-severity');   if (fv) fv.onchange = function () { setFilter('severity', fv.value); };
    var ft = host.querySelector('#co-inc-f-type');       if (ft) ft.onchange = function () { setFilter('type', ft.value); };
    var fq = host.querySelector('#co-inc-f-q');
    if (fq) {
      fq.oninput = function () {
        host.__incFilters = Object.assign({}, filters, { q: fq.value });
        var pos = fq.selectionStart;
        renderIncidents(host);
        var next = host.querySelector('#co-inc-f-q');
        if (next) { next.focus(); try { next.setSelectionRange(pos, pos); } catch (_) {} }
      };
    }

    // Toggle new-incident form visibility.
    host.querySelectorAll('[data-action="co-inc-new-toggle"]').forEach(function (btn) {
      btn.onclick = function () {
        var f = host.querySelector('#co-inc-form');
        if (f) f.style.display = (f.style.display === 'none' ? '' : 'none');
      };
    });

    // Submit new incident.
    var iform = host.querySelector('#co-inc-form');
    if (iform) {
      iform.onsubmit = function (ev) {
        ev.preventDefault();
        var fd = new FormData(iform);
        var row = {
          id: uid('inc'),
          title: (fd.get('title') || '').toString().trim(),
          type: fd.get('type') || 'other',
          severity: fd.get('severity') || 'medium',
          discovered: toIsoFromDMY(fd.get('discovered')) || new Date().toISOString().slice(0, 10),
          deadline: toIsoFromDMY(fd.get('deadline')) || '',
          description: (fd.get('description') || '').toString().trim(),
          entities: (fd.get('entities') || '').toString().trim(),
          reporter: (fd.get('reporter') || '').toString().trim(),
          department: (fd.get('department') || '').toString().trim(),
          root_cause: fd.get('root_cause') || '',
          str_required: fd.get('str_required') === 'on',
          freeze_required: fd.get('freeze_required') === 'on',
          no_tip_off: fd.get('no_tip_off') === 'on',
          status: 'open',
          asanaPending: true,
          created_at: new Date().toISOString()
        };
        if (!row.title) return;
        rows.push(row);
        safeSave(STORAGE.incidents, rows);
        renderIncidents(host);
        syncIncidentToAsana(row.id);
      };
    }

    function syncIncidentToAsana(id) {
      var current = safeParse(STORAGE.incidents, []);
      var idx = -1;
      for (var i = 0; i < current.length; i++) { if (current[i].id === id) { idx = i; break; } }
      if (idx < 0) return;
      var r = current[idx];
      current[idx].asanaPending = true;
      safeSave(STORAGE.incidents, current);

      var notesLines = [
        'Incident: ' + (r.title || '—'),
        'Type: ' + (INC_TYPE_LABELS[r.type] || r.type || 'other'),
        'Severity: ' + (r.severity || 'medium'),
        'Discovered: ' + (r.discovered || '—'),
        'Deadline: ' + (r.deadline || '—'),
        'Status: ' + (r.status || 'open'),
        '',
        'Description:',
        r.description || '(none)',
        '',
        'Entities involved: ' + (r.entities || '—'),
        'Reporter: ' + (r.reporter || '—'),
        'Department: ' + (r.department || '—'),
        'Root cause: ' + (r.root_cause || '—'),
        '',
        'Obligations:',
        '- STR required: ' + (r.str_required ? 'YES — draft without delay (FDL Art.26-27)' : 'no'),
        '- Freeze required: ' + (r.freeze_required ? 'YES — execute within 24h, CNMR within 5 business days (Cabinet Res 74/2020 Art.4-7)' : 'no'),
        '- No-tipping-off: ' + (r.no_tip_off ? 'acknowledged (FDL Art.29)' : 'not acknowledged — review')
      ];

      var priority = (r.severity === 'critical') ? 'critical'
        : r.severity === 'high' ? 'high'
        : r.severity === 'medium' ? 'medium' : 'low';

      window.__hawkeyeAsana.createAsanaTaskRemote('compliance-ops', {
        name: '[' + (r.severity || 'medium').toUpperCase() + '] ' + r.title,
        notes: notesLines.join('\n'),
        category: r.type || 'incident',
        priority: priority,
        dueOn: r.deadline || undefined,
        citation: 'FDL Art.20, Art.24, Art.26-29; Cabinet Res 74/2020 Art.4-7; Cabinet Res 134/2025 Art.19',
        entity: r.entities || undefined,
        assignee: r.department || undefined
      }).then(function (res) {
        var after = safeParse(STORAGE.incidents, []);
        var j = -1;
        for (var k = 0; k < after.length; k++) { if (after[k].id === id) { j = k; break; } }
        if (j < 0) return;
        after[j].asanaPending = false;
        if (res.ok && res.gid) {
          after[j].asanaGid = res.gid;
          after[j].asanaUrl = res.url || null;
          after[j].asanaSyncedAt = new Date().toISOString();
          delete after[j].asanaError;
        } else {
          after[j].asanaError = res.error || 'unknown';
        }
        safeSave(STORAGE.incidents, after);
        rows = after;
        renderIncidents(host);
      });
    }

    // Manual flag button.
    host.querySelectorAll('[data-action="co-inc-flag"]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-id');
        btn.disabled = true;
        btn.textContent = 'Syncing…';
        syncIncidentToAsana(id);
      };
    });

    // Status change.
    host.querySelectorAll('[data-action="co-inc-status"]').forEach(function (sel) {
      sel.onchange = function () {
        var id = sel.getAttribute('data-id');
        var hit = rows.find(function (r) { return r.id === id; });
        if (!hit) return;
        hit.status = sel.value;
        hit.updated_at = new Date().toISOString();
        safeSave(STORAGE.incidents, rows);
        renderIncidents(host);
      };
    });

    // Draft STR (pushes a report row so it appears in the Reports register).
    host.querySelectorAll('[data-action="co-inc-gen-str"]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-id');
        var hit = rows.find(function (r) { return r.id === id; });
        if (!hit) return;
        hit.str_generated_at = new Date().toISOString();
        safeSave(STORAGE.incidents, rows);
        var reports = safeParse(STORAGE.reports, []);
        reports.push({
          id: uid('rep'),
          title: 'STR draft — ' + hit.title,
          kind: 'STR',
          format: 'XML',
          linked_incident: hit.id,
          citation: 'FDL Art.26-27',
          created_at: new Date().toISOString()
        });
        safeSave(STORAGE.reports, reports);
        renderIncidents(host);
      };
    });

    // Delete incident.
    host.querySelectorAll('[data-action="co-inc-del"]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-id');
        if (!confirm('Delete this incident? The 10-year retention rule (FDL Art.24) is your responsibility.')) return;
        var next = rows.filter(function (r) { return r.id !== id; });
        safeSave(STORAGE.incidents, next);
        renderIncidents(host);
      };
    });

    // Whistleblower submit.
    var wform = host.querySelector('#co-whistle-form');
    if (wform) {
      wform.onsubmit = function (ev) {
        ev.preventDefault();
        var fd = new FormData(wform);
        whistle.push({
          id: uid('wb'),
          subject: (fd.get('subject') || '').toString().trim(),
          channel: fd.get('channel') || 'portal',
          details: (fd.get('details') || '').toString().trim(),
          created_at: new Date().toISOString()
        });
        safeSave(STORAGE.whistle, whistle);
        renderIncidents(host);
      };
    }

  }
  // ─── Reports ──────────────────────────────────────────────────────
  // Source of truth: index.html reports panels + MLRO quarterly minutes.
  // Templates cover every goAML filing type plus rollups and minutes.
  // Regulatory basis: FDL Art.20, Art.24, Art.26-27; Cabinet Res 134/2025 Art.19.
  var REPORT_TEMPLATES = [
    { kind: 'STR',    label: 'STR — Suspicious Transaction Report',      format: 'XML', citation: 'FDL Art.26-27' },
    { kind: 'SAR',    label: 'SAR — Suspicious Activity Report',         format: 'XML', citation: 'FDL Art.26-27' },
    { kind: 'CTR',    label: 'CTR — Cash Transaction Report (>AED 55K)', format: 'XML', citation: 'MoE Circular 08/AML/2021' },
    { kind: 'DPMSR',  label: 'DPMSR — Quarterly DPMS rollup',            format: 'XML', citation: 'MoE Circular 08/AML/2021 §9' },
    { kind: 'CNMR',   label: 'CNMR — Cross-border Notification (>AED 60K)', format: 'XML', citation: 'Cabinet Res 74/2020 Art.7' },
    { kind: 'Audit',  label: 'Audit Pack — Inspection bundle',           format: 'ZIP', citation: 'FDL Art.24' },
    { kind: 'MLRO',   label: 'MLRO Digest — monthly digest to Board',    format: 'PDF', citation: 'Cabinet Res 134/2025 Art.19' },
    { kind: 'Risk',   label: 'Business Risk Assessment — annual',        format: 'PDF', citation: 'Cabinet Res 134/2025 Art.5' },
    { kind: 'UBO',    label: 'UBO Register — snapshot',                  format: 'XLSX', citation: 'Cabinet Decision 109/2023' }
  ];

  function renderReports(host) {
    var reports   = safeParse(STORAGE.reports,   []);
    var circulars = safeParse(STORAGE.circulars, []);
    var minutes   = safeParse(STORAGE.minutes,   []);
    var schedules = safeParse(STORAGE.schedules, []);

    var byKind = {};
    reports.forEach(function (r) { byKind[r.kind] = (byKind[r.kind] || 0) + 1; });

    var overdueCirc = circulars.filter(function (c) {
      var d = daysUntil(c.deadline);
      return !c.closed_at && d != null && d < 0;
    });

    host.innerHTML = [
      head('Reports',
        '<span class="mv-pill">FDL Art.20 · Art.24 · Cabinet Res 134/2025 Art.19</span>' +
        '<button class="mv-btn mv-btn-sm mv-btn-ghost" data-action="co-rep-clear">Clear</button>'
      ),
      '<p class="mv-lede">Regulator-ready outputs: goAML STR/SAR/CTR/DPMSR/CNMR XML, quarterly DPMS rollups, audit packs, MLRO digests, annual BRA, UBO snapshot. Every artefact is retained 10 years under FDL Art.24.</p>',

      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v">' + reports.length + '</div><div class="mv-stat-k">Total artefacts</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="accent">' + (byKind.STR || 0) + '</div><div class="mv-stat-k">STR</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="accent">' + (byKind.DPMSR || 0) + '</div><div class="mv-stat-k">DPMSR</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="accent">' + (byKind.CNMR || 0) + '</div><div class="mv-stat-k">CNMR</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + overdueCirc.length + '</div><div class="mv-stat-k">Circulars overdue</div></div>',
      '</div>',

      '<h3 class="mv-subhead">Generate from template</h3>',
      '<form id="co-rep-form" class="mv-form">',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Template</span>',
            '<select name="template">',
              REPORT_TEMPLATES.map(function (t, i) {
                return '<option value="' + i + '">' + esc(t.label) + ' — ' + esc(t.format) + '</option>';
              }).join(''),
            '</select></label>',
          '<label class="mv-field"><span class="mv-field-label">Reference period</span>',
            '<input type="text" name="period" placeholder="e.g. Q' + (Math.floor(new Date().getUTCMonth() / 3) + 1) + ' ' + new Date().getUTCFullYear() + '"></label>',
        '</div>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Subject / entity (optional)</span>',
            '<input type="text" name="subject" placeholder="Counterparty, customer, or narrative ID"></label>',
          '<label class="mv-field"><span class="mv-field-label">Prepared by</span>',
            '<input type="text" name="preparer" placeholder="MLRO / Deputy MLRO"></label>',
        '</div>',
        '<div class="mv-form-actions">',
          '<button type="submit" class="mv-btn mv-btn-primary">Generate artefact</button>',
        '</div>',
      '</form>',

      '<h3 class="mv-subhead">Artefact register</h3>',
      reports.length
        ? '<ul class="mv-list">' + reports.slice().reverse().slice(0, 40).map(function (r) {
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.title) + '</div>' +
                '<div class="mv-list-meta">' +
                  esc(r.kind) + ' · ' + esc(r.format || 'PDF') +
                  ' · generated ' + esc(fmtDate(r.created_at)) +
                  (r.period ? ' · ' + esc(r.period) : '') +
                  (r.citation ? ' · <strong>' + esc(r.citation) + '</strong>' : '') +
                '</div>' +
              '</div>' +
              '<div class="mv-list-aside">' +
                '<button class="mv-btn mv-btn-sm" data-action="co-rep-download" data-id="' + esc(r.id) + '">Download</button>' +
                '<button class="mv-btn mv-btn-sm mv-btn-ghost" data-action="co-rep-del" data-id="' + esc(r.id) + '">×</button>' +
              '</div>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#128203;', 'No reports yet. Pick a template above to generate one.'),

      '<h3 class="mv-subhead">Recurring schedule</h3>',
      '<form id="co-sched-form" class="mv-form">',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Artefact</span>',
            '<select name="kind">',
              REPORT_TEMPLATES.map(function (t) {
                return '<option value="' + esc(t.kind) + '">' + esc(t.kind) + '</option>';
              }).join(''),
            '</select></label>',
          '<label class="mv-field"><span class="mv-field-label">Cadence</span>',
            '<select name="cadence">',
              '<option value="weekly">Weekly</option>',
              '<option value="monthly" selected>Monthly</option>',
              '<option value="quarterly">Quarterly</option>',
              '<option value="annual">Annual</option>',
            '</select></label>',
          '<label class="mv-field"><span class="mv-field-label">Owner</span>',
            '<input type="text" name="owner" placeholder="MLRO / Deputy MLRO"></label>',
        '</div>',
        '<div class="mv-form-actions">',
          '<button type="submit" class="mv-btn mv-btn-primary">Add schedule</button>',
        '</div>',
      '</form>',
      schedules.length
        ? '<ul class="mv-list">' + schedules.map(function (s) {
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(s.kind) + ' — ' + esc(s.cadence) + '</div>' +
                '<div class="mv-list-meta">Owner ' + esc(s.owner || '—') + ' · added ' + esc(fmtDate(s.created_at)) + '</div>' +
              '</div>' +
              '<button class="mv-btn mv-btn-sm mv-btn-ghost" data-action="co-sched-del" data-id="' + esc(s.id) + '">×</button>' +
            '</li>';
          }).join('') + '</ul>'
        : '<p class="mv-lede" style="font-size:12px;opacity:.7">No schedules set.</p>',

      '<h3 class="mv-subhead">MoE / regulator circular tracker <span class="mv-pill">30-day policy-update rule</span></h3>',
      '<form id="co-circ-form" class="mv-form">',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Circular reference</span>',
            '<input type="text" name="ref" placeholder="e.g. MoE Circular 08/AML/2021" required></label>',
          '<label class="mv-field"><span class="mv-field-label">Issued (dd/mm/yyyy)</span>',
            '<input type="text" name="issued" placeholder="dd/mm/yyyy"></label>',
          '<label class="mv-field"><span class="mv-field-label">Policy-update deadline (dd/mm/yyyy)</span>',
            '<input type="text" name="deadline" placeholder="dd/mm/yyyy"></label>',
        '</div>',
        '<label class="mv-field"><span class="mv-field-label">Summary</span>',
          '<textarea name="summary" rows="2" placeholder="What changed and which control must be updated?"></textarea></label>',
        '<div class="mv-form-actions">',
          '<button type="submit" class="mv-btn mv-btn-primary">Track circular</button>',
        '</div>',
      '</form>',
      circulars.length
        ? '<ul class="mv-list">' + circulars.slice().reverse().map(function (c) {
            var d = daysUntil(c.deadline);
            var tone = c.closed_at ? 'ok' : (d != null && d < 0 ? 'warn' : d != null && d <= 7 ? 'accent' : 'ok');
            var label = c.closed_at ? 'Closed' : (d != null && d < 0 ? 'Overdue ' + Math.abs(d) + 'd' : d != null ? d + 'd left' : 'Open');
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(c.ref) + '</div>' +
                '<div class="mv-list-meta">Issued ' + esc(fmtDate(c.issued)) + ' · deadline ' + esc(fmtDate(c.deadline)) + '</div>' +
                (c.summary ? '<div class="mv-list-meta">' + esc(c.summary.slice(0, 200)) + (c.summary.length > 200 ? '…' : '') + '</div>' : '') +
              '</div>' +
              '<div class="mv-list-aside">' +
                '<span class="mv-badge" data-tone="' + tone + '">' + esc(label) + '</span>' +
                (c.closed_at
                  ? ''
                  : '<button class="mv-btn mv-btn-sm" data-action="co-circ-close" data-id="' + esc(c.id) + '">Close</button>') +
                '<button class="mv-btn mv-btn-sm mv-btn-ghost" data-action="co-circ-del" data-id="' + esc(c.id) + '">×</button>' +
              '</div>' +
            '</li>';
          }).join('') + '</ul>'
        : '<p class="mv-lede" style="font-size:12px;opacity:.7">No circulars tracked.</p>',

      '<h3 class="mv-subhead">MLRO meeting minutes <span class="mv-pill">Cabinet Res 134/2025 Art.19</span></h3>',
      '<form id="co-min-form" class="mv-form">',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Meeting date (dd/mm/yyyy)</span>',
            '<input type="text" name="meeting_date" placeholder="dd/mm/yyyy" required></label>',
          '<label class="mv-field"><span class="mv-field-label">Chair</span>',
            '<input type="text" name="chair" placeholder="MLRO"></label>',
        '</div>',
        '<label class="mv-field"><span class="mv-field-label">Attendees</span>',
          '<input type="text" name="attendees" placeholder="Comma-separated"></label>',
        '<label class="mv-field"><span class="mv-field-label">Agenda / decisions</span>',
          '<textarea name="body" rows="3" placeholder="Decisions, escalations, four-eyes approvals"></textarea></label>',
        '<div class="mv-form-actions">',
          '<button type="submit" class="mv-btn mv-btn-primary">Log minutes</button>',
        '</div>',
      '</form>',
      minutes.length
        ? '<ul class="mv-list">' + minutes.slice().reverse().slice(0, 12).map(function (m) {
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(fmtDate(m.meeting_date)) + ' — chair ' + esc(m.chair || '—') + '</div>' +
                '<div class="mv-list-meta">' + esc(m.attendees || '—') + '</div>' +
                (m.body ? '<div class="mv-list-meta">' + esc(m.body.slice(0, 220)) + (m.body.length > 220 ? '…' : '') + '</div>' : '') +
              '</div>' +
              '<button class="mv-btn mv-btn-sm mv-btn-ghost" data-action="co-min-del" data-id="' + esc(m.id) + '">×</button>' +
            '</li>';
          }).join('') + '</ul>'
        : '<p class="mv-lede" style="font-size:12px;opacity:.7">No minutes logged.</p>'
    ].join('');

    // ── Wire: report generation ──
    var rform = host.querySelector('#co-rep-form');
    if (rform) {
      rform.onsubmit = function (ev) {
        ev.preventDefault();
        var fd = new FormData(rform);
        var idx = parseInt(fd.get('template'), 10) || 0;
        var tpl = REPORT_TEMPLATES[idx] || REPORT_TEMPLATES[0];
        var period = (fd.get('period') || '').toString().trim() ||
          ('Q' + (Math.floor(new Date().getUTCMonth() / 3) + 1) + ' ' + new Date().getUTCFullYear());
        var subject = (fd.get('subject') || '').toString().trim();
        var preparer = (fd.get('preparer') || 'MLRO').toString().trim();
        reports.push({
          id: uid('rep'),
          title: tpl.label + (subject ? ' — ' + subject : '') + ' — ' + period,
          kind: tpl.kind,
          format: tpl.format,
          period: period,
          preparer: preparer,
          subject: subject,
          citation: tpl.citation,
          created_at: new Date().toISOString()
        });
        safeSave(STORAGE.reports, reports);
        renderReports(host);
      };
    }

    // ── Wire: report actions ──
    host.querySelectorAll('[data-action="co-rep-download"]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-id');
        var hit = reports.find(function (r) { return r.id === id; });
        if (!hit) return;
        var body = [
          '<!-- ' + hit.kind + ' artefact stub. Full payload is produced server-side via /goaml. -->',
          '<' + hit.kind + '>',
          '  <title>' + esc(hit.title) + '</title>',
          '  <period>' + esc(hit.period || '') + '</period>',
          '  <subject>' + esc(hit.subject || '') + '</subject>',
          '  <preparer>' + esc(hit.preparer || '') + '</preparer>',
          '  <citation>' + esc(hit.citation || '') + '</citation>',
          '  <generated_at>' + hit.created_at + '</generated_at>',
          '</' + hit.kind + '>'
        ].join('\n');
        var ext = (hit.format || 'xml').toLowerCase();
        var mime = ext === 'json' ? 'application/json' : ext === 'csv' ? 'text/csv' : 'application/xml';
        var fname = hit.kind.toLowerCase() + '-' + hit.id + '.' + ext;
        download(fname, mime, body);
      };
    });
    host.querySelectorAll('[data-action="co-rep-del"]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-id');
        if (!confirm('Delete this report? 10-year retention under FDL Art.24 applies.')) return;
        var next = reports.filter(function (r) { return r.id !== id; });
        safeSave(STORAGE.reports, next);
        renderReports(host);
      };
    });
    // CSV export removed — every report artefact now goes to Asana
    // via the /goaml · /audit-pack · /evidence-bundle skills, so the
    // MLRO does not need a standalone CSV download. The csvRow +
    // download helpers are kept because /evidence-bundle composes
    // multi-format zips that may still include CSV sheets.
    host.querySelectorAll('[data-action="co-rep-clear"]').forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm('Clear artefact register? Retention obligation stays with you.')) return;
        safeSave(STORAGE.reports, []);
        renderReports(host);
      };
    });

    // ── Wire: scheduler ──
    var sform = host.querySelector('#co-sched-form');
    if (sform) {
      sform.onsubmit = function (ev) {
        ev.preventDefault();
        var fd = new FormData(sform);
        schedules.push({
          id: uid('sch'),
          kind: fd.get('kind'),
          cadence: fd.get('cadence'),
          owner: (fd.get('owner') || '').toString().trim(),
          created_at: new Date().toISOString()
        });
        safeSave(STORAGE.schedules, schedules);
        renderReports(host);
      };
    }
    host.querySelectorAll('[data-action="co-sched-del"]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-id');
        var next = schedules.filter(function (s) { return s.id !== id; });
        safeSave(STORAGE.schedules, next);
        renderReports(host);
      };
    });

    // ── Wire: circulars ──
    var cform = host.querySelector('#co-circ-form');
    if (cform) {
      cform.onsubmit = function (ev) {
        ev.preventDefault();
        var fd = new FormData(cform);
        circulars.push({
          id: uid('circ'),
          ref: (fd.get('ref') || '').toString().trim(),
          issued: toIsoFromDMY(fd.get('issued')) || '',
          deadline: toIsoFromDMY(fd.get('deadline')) || '',
          summary: (fd.get('summary') || '').toString().trim(),
          created_at: new Date().toISOString()
        });
        safeSave(STORAGE.circulars, circulars);
        renderReports(host);
      };
    }
    host.querySelectorAll('[data-action="co-circ-close"]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-id');
        var hit = circulars.find(function (c) { return c.id === id; });
        if (!hit) return;
        hit.closed_at = new Date().toISOString();
        safeSave(STORAGE.circulars, circulars);
        renderReports(host);
      };
    });
    host.querySelectorAll('[data-action="co-circ-del"]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-id');
        var next = circulars.filter(function (c) { return c.id !== id; });
        safeSave(STORAGE.circulars, next);
        renderReports(host);
      };
    });

    // ── Wire: minutes ──
    var mform = host.querySelector('#co-min-form');
    if (mform) {
      mform.onsubmit = function (ev) {
        ev.preventDefault();
        var fd = new FormData(mform);
        minutes.push({
          id: uid('min'),
          meeting_date: toIsoFromDMY(fd.get('meeting_date')) || new Date().toISOString().slice(0, 10),
          chair: (fd.get('chair') || '').toString().trim(),
          attendees: (fd.get('attendees') || '').toString().trim(),
          body: (fd.get('body') || '').toString().trim(),
          created_at: new Date().toISOString()
        });
        safeSave(STORAGE.minutes, minutes);
        renderReports(host);
      };
    }
    host.querySelectorAll('[data-action="co-min-del"]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-id');
        var next = minutes.filter(function (m) { return m.id !== id; });
        safeSave(STORAGE.minutes, next);
        renderReports(host);
      };
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
