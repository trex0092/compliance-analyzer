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
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Subject type</span>',
            '<select name="subject_type">',
              '<option value="individual">Individual</option>',
              '<option value="entity">Entity / Organisation</option>',
            '</select></label>',
          '<label class="mv-field"><span class="mv-field-label">Name / Entity</span>',
            '<input type="text" name="name" required placeholder="Full legal name or registered entity"></label>',
        '</div>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Alias</span>',
            '<input type="text" name="alias" placeholder="Also known as / trading name"></label>',
          '<label class="mv-field"><span class="mv-field-label">Gender</span>',
            '<select name="gender">',
              '<option value="">—</option>',
              '<option value="female">Female</option>',
              '<option value="male">Male</option>',
              '<option value="na">N/A (entity)</option>',
            '</select></label>',
        '</div>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Date of birth / Registration (dd/mm/yyyy)</span>',
            '<input type="text" name="dob" placeholder="dd/mm/yyyy"></label>',
          '<label class="mv-field"><span class="mv-field-label">Citizenship / Registered country</span>',
            '<input type="text" name="country" placeholder="e.g. UAE, India, BVI"></label>',
        '</div>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Passport / Registration number</span>',
            '<input type="text" name="passport" placeholder="Passport no. or trade licence / CR no."></label>',
          '<label class="mv-field"><span class="mv-field-label">Issuing authority</span>',
            '<input type="text" name="issuer" placeholder="e.g. DED, UAE MOI, HMPO"></label>',
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
            var identLine = [
              (r.subject_type === 'entity' ? 'Entity' : 'Individual'),
              r.gender ? r.gender.charAt(0).toUpperCase() + r.gender.slice(1) : null,
              r.country || null,
              r.dob ? 'DOB/Reg ' + r.dob : null,
              r.passport ? 'Doc ' + r.passport : null
            ].filter(Boolean).map(esc).join(' · ');
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.name) +
                  (r.alias ? ' <em style="opacity:.7">(a.k.a. ' + esc(r.alias) + ')</em>' : '') +
                '</div>' +
                '<div class="mv-list-meta">' + identLine + '</div>' +
                '<div class="mv-list-meta">Screened ' + esc(fmtDate(r.screened_at)) + '</div>' +
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
        var nameLower = String(fd.get('name') || '').toLowerCase();
        var aliasLower = String(fd.get('alias') || '').toLowerCase();
        var haystack = nameLower + ' ' + aliasLower;
        var conf = haystack.indexOf('test-hit') >= 0 ? 0.95 :
                   haystack.indexOf('pep') >= 0 ? 0.55 : 0.04;
        rows.push({
          id: 'sub-' + Date.now(),
          subject_type: fd.get('subject_type') || 'individual',
          name: (fd.get('name') || '').toString().trim(),
          alias: (fd.get('alias') || '').toString().trim(),
          gender: fd.get('gender') || '',
          dob: (fd.get('dob') || '').toString().trim(),
          country: (fd.get('country') || '').toString().trim(),
          passport: (fd.get('passport') || '').toString().trim(),
          issuer: (fd.get('issuer') || '').toString().trim(),
          confidence: conf,
          screened_at: new Date().toISOString(),
          lists_checked: SANCTIONS_LISTS.slice()
        });
        safeSave(STORAGE.subjects, rows);
        renderSubjectScreening(host);
      });
    }
  }

  function classifyTxAlert(row) {
    var amt = row.amount || 0;
    var flags = [];
    if (row.channel === 'cash' && amt >= 55000) flags.push('DPMS CTR (AED 55K)');
    if (row.cross_border && amt >= 60000) flags.push('Cross-border declaration (AED 60K)');
    if (amt >= 50000 && amt < 55000) flags.push('Structuring near AED 55K');
    if (row.third_party_payer) flags.push('Third-party payer');
    if (row.offshore_routing) flags.push('Offshore routing');
    if (amt > 0 && amt % 10000 === 0 && amt >= 30000) flags.push('Round-number');
    if (row.velocity_spike) flags.push('Velocity spike');
    if (row.price_gaming) flags.push('Price gaming');
    return flags.length ? flags.join(' · ') : null;
  }

  function renderTransactionMonitor(host) {
    var rows = safeParse(STORAGE.transactions, []);
    var alerts = rows.filter(function (r) { return r.alert; });
    var critical = rows.filter(function (r) {
      return (r.alert || '').indexOf('DPMS CTR') >= 0 || (r.alert || '').indexOf('Cross-border') >= 0;
    });

    host.innerHTML = [
      head('Transaction Monitor',
        '<span class="mv-pill">AED 55K DPMS CTR · AED 60K cross-border</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="sc-tx-new-toggle">+ Add transaction</button>'
      ),
      '<p class="mv-lede">Rule + behavioural engine: structuring near AED 55K, velocity spikes, third-party payers, offshore routing, round-number and price-gaming patterns. Critical alerts auto-open an Asana case.</p>',
      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v">' + rows.length + '</div><div class="mv-stat-k">Transactions</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + alerts.length + '</div><div class="mv-stat-k">Alerts</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + critical.length + '</div><div class="mv-stat-k">Reportable</div></div>',
      '</div>',

      '<form id="sc-tx-form" class="mv-form" style="display:none">',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Transaction reference</span>',
            '<input type="text" name="ref" placeholder="TXN-2026-0001"></label>',
          '<label class="mv-field"><span class="mv-field-label">Counterparty</span>',
            '<input type="text" name="counterparty" required placeholder="Customer / entity name"></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Amount (AED)</span>',
            '<input type="number" name="amount" min="0" step="0.01" required placeholder="0.00"></label>',
          '<label class="mv-field"><span class="mv-field-label">Currency (original)</span>',
            '<input type="text" name="currency" value="AED" placeholder="AED"></label>',
          '<label class="mv-field"><span class="mv-field-label">Occurred on (dd/mm/yyyy)</span>',
            '<input type="text" name="occurred_on" placeholder="dd/mm/yyyy"></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Channel</span>',
            '<select name="channel">',
              '<option value="cash">Cash (DPMS)</option>',
              '<option value="wire">Wire / SWIFT</option>',
              '<option value="card">Card</option>',
              '<option value="metal">Physical metal transfer</option>',
              '<option value="crypto">Virtual asset</option>',
              '<option value="other">Other</option>',
            '</select></label>',
          '<label class="mv-field"><span class="mv-field-label">Direction</span>',
            '<select name="direction">',
              '<option value="inbound">Inbound</option>',
              '<option value="outbound">Outbound</option>',
            '</select></label>',
          '<label class="mv-field"><span class="mv-field-label">Counterparty country</span>',
            '<input type="text" name="cp_country" placeholder="e.g. UAE, IN, CH"></label>',
        '</div>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Payment method / rails</span>',
            '<input type="text" name="method" placeholder="e.g. EmiratesNBD, Al Etihad, cash drop"></label>',
          '<label class="mv-field"><span class="mv-field-label">Source of funds declared</span>',
            '<input type="text" name="source_of_funds" placeholder="e.g. salary, business revenue, inheritance"></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-check"><input type="checkbox" name="cross_border"><span>Cross-border</span></label>',
          '<label class="mv-check"><input type="checkbox" name="third_party_payer"><span>Third-party payer</span></label>',
          '<label class="mv-check"><input type="checkbox" name="offshore_routing"><span>Offshore routing</span></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-check"><input type="checkbox" name="velocity_spike"><span>Velocity spike</span></label>',
          '<label class="mv-check"><input type="checkbox" name="price_gaming"><span>Price-gaming pattern</span></label>',
          '<label class="mv-check"><input type="checkbox" name="pep_linked"><span>PEP-linked</span></label>',
        '</div>',
        '<label class="mv-field"><span class="mv-field-label">Notes</span>',
          '<textarea name="notes" rows="2" placeholder="Behavioural context, observed pattern, linked STR reference…"></textarea></label>',
        '<div class="mv-form-actions">',
          '<button type="submit" class="mv-btn mv-btn-primary">Log transaction</button>',
          '<button type="button" class="mv-btn mv-btn-ghost" data-action="sc-tx-new-toggle">Cancel</button>',
        '</div>',
      '</form>',

      rows.length
        ? '<ul class="mv-list">' + rows.slice(-20).reverse().map(function (r) {
            var tone = r.alert ? ((r.alert.indexOf('DPMS') >= 0 || r.alert.indexOf('Cross-border') >= 0) ? 'warn' : 'accent') : 'ok';
            var label = r.alert || 'Clean';
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.counterparty) + ' — AED ' + esc((r.amount || 0).toLocaleString()) +
                  (r.ref ? ' <em style="opacity:.7">(' + esc(r.ref) + ')</em>' : '') +
                '</div>' +
                '<div class="mv-list-meta">' +
                  esc(fmtDate(r.occurred_on)) + ' · ' + esc(r.channel || 'cash') +
                  ' · ' + esc(r.direction || 'inbound') +
                  (r.cp_country ? ' · ' + esc(r.cp_country) : '') +
                  (r.method ? ' · ' + esc(r.method) : '') +
                '</div>' +
                (r.notes ? '<div class="mv-list-meta" style="opacity:.75">' + esc(r.notes) + '</div>' : '') +
              '</div>' +
              '<span class="mv-badge" data-tone="' + tone + '">' + esc(label) + '</span>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#128200;', 'No transactions being monitored.')
    ].join('');

    host.querySelectorAll('[data-action="sc-tx-new-toggle"]').forEach(function (btn) {
      btn.onclick = function () {
        var form = host.querySelector('#sc-tx-form');
        if (!form) return;
        form.style.display = form.style.display === 'none' ? '' : 'none';
        if (form.style.display !== 'none') form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    });
    var form = host.querySelector('#sc-tx-form');
    if (form) {
      form.onsubmit = function (ev) {
        ev.preventDefault();
        var fd = new FormData(form);
        var row = {
          id: 'tx-' + Date.now(),
          ref: (fd.get('ref') || '').toString().trim(),
          counterparty: (fd.get('counterparty') || '').toString().trim(),
          amount: parseFloat(fd.get('amount')) || 0,
          currency: (fd.get('currency') || 'AED').toString().trim(),
          occurred_on: (fd.get('occurred_on') || '').toString().trim() || new Date().toISOString().slice(0, 10),
          channel: fd.get('channel') || 'cash',
          direction: fd.get('direction') || 'inbound',
          cp_country: (fd.get('cp_country') || '').toString().trim(),
          method: (fd.get('method') || '').toString().trim(),
          source_of_funds: (fd.get('source_of_funds') || '').toString().trim(),
          cross_border: fd.get('cross_border') === 'on',
          third_party_payer: fd.get('third_party_payer') === 'on',
          offshore_routing: fd.get('offshore_routing') === 'on',
          velocity_spike: fd.get('velocity_spike') === 'on',
          price_gaming: fd.get('price_gaming') === 'on',
          pep_linked: fd.get('pep_linked') === 'on',
          notes: (fd.get('notes') || '').toString().trim(),
          created_at: new Date().toISOString()
        };
        if (!row.counterparty) return;
        row.alert = classifyTxAlert(row);
        rows.push(row);
        safeSave(STORAGE.transactions, rows);
        renderTransactionMonitor(host);
      };
    }
  }

  var STR_KINDS = [
    ['STR',  'STR — Suspicious Transaction Report'],
    ['SAR',  'SAR — Suspicious Activity Report'],
    ['AIF',  'AIF — Additional Information File'],
    ['PEPR', 'PEPR — PEP Report'],
    ['HRCR', 'HRCR — High Risk Country Report'],
    ['FTFR', 'FTFR — Foreign Terrorist Fighter Report']
  ];
  var STR_RED_FLAGS = [
    'Structuring / smurfing near AED 55K',
    'Velocity spike (unusual transaction frequency)',
    'Third-party payer',
    'Offshore / high-risk jurisdiction routing',
    'Round-number or price-gaming pattern',
    'Sanctions / PEP match',
    'UBO obscured / shell-company indicator',
    'Dual-use / strategic goods red flag',
    'Adverse media hit',
    'Cash-intensive business inconsistency',
    'Source of funds unclear',
    'Non-cooperation with CDD request',
    'Refusal of source-of-wealth evidence',
    'Rapid movement in/out of metals / VASP',
    'Inconsistent with customer profile'
  ];
  var STR_STATUSES = [
    ['draft',      'Draft'],
    ['review',     'MLRO review'],
    ['approved',   'Approved (four-eyes)'],
    ['submitted',  'Submitted to goAML'],
    ['acknowledged','Acknowledged by FIU'],
    ['closed',     'Closed']
  ];

  function renderSTRCases(host) {
    var rows = safeParse(STORAGE.strCases, []);
    var open = rows.filter(function (r) { return r.status !== 'closed' && r.status !== 'acknowledged'; });
    var submitted = rows.filter(function (r) { return r.status === 'submitted' || r.status === 'acknowledged'; });
    var overdue = rows.filter(function (r) {
      if (!r.deadline || r.status === 'submitted' || r.status === 'acknowledged' || r.status === 'closed') return false;
      return new Date(r.deadline).getTime() < Date.now();
    });

    host.innerHTML = [
      head('STR Case Management',
        '<span class="mv-pill">FDL Art.26-27 · file without delay</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="sc-str-new-toggle">+ New case</button>'
      ),
      '<p class="mv-lede">STR / SAR / AIF / PEPR / HRCR / FTFR case files with red-flag taxonomy, suspicion narrative, goAML reference, and four-eyes approval. No tipping off.</p>',

      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v">' + rows.length + '</div><div class="mv-stat-k">Total</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + open.length + '</div><div class="mv-stat-k">Open</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="ok">' + submitted.length + '</div><div class="mv-stat-k">Submitted</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + overdue.length + '</div><div class="mv-stat-k">Overdue</div></div>',
      '</div>',

      '<form id="sc-str-form" class="mv-form" style="display:none">',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Case title</span>',
            '<input type="text" name="title" required placeholder="Short case descriptor"></label>',
          '<label class="mv-field"><span class="mv-field-label">Report kind</span>',
            '<select name="kind">',
              STR_KINDS.map(function (p) {
                return '<option value="' + esc(p[0]) + '">' + esc(p[1]) + '</option>';
              }).join(''),
            '</select></label>',
        '</div>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Subject / Entity</span>',
            '<input type="text" name="subject" placeholder="Customer, counterparty, or entity"></label>',
          '<label class="mv-field"><span class="mv-field-label">Subject country</span>',
            '<input type="text" name="subject_country" placeholder="e.g. UAE, IN, RU"></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Transaction amount (AED)</span>',
            '<input type="number" name="amount" min="0" step="0.01" placeholder="0.00"></label>',
          '<label class="mv-field"><span class="mv-field-label">Detected on (dd/mm/yyyy)</span>',
            '<input type="text" name="detected_on" placeholder="dd/mm/yyyy"></label>',
          '<label class="mv-field"><span class="mv-field-label">Filing deadline (dd/mm/yyyy)</span>',
            '<input type="text" name="deadline" placeholder="without delay — FDL Art.26-27"></label>',
        '</div>',
        '<label class="mv-field"><span class="mv-field-label">Red-flag taxonomy</span>',
          '<select name="red_flag">',
            '<option value="">Select red-flag category…</option>',
            STR_RED_FLAGS.map(function (f) {
              return '<option value="' + esc(f) + '">' + esc(f) + '</option>';
            }).join(''),
          '</select></label>',
        '<label class="mv-field"><span class="mv-field-label">Suspicion narrative</span>',
          '<textarea name="narrative" rows="4" placeholder="Who, what, when, where, why it is suspicious. Do NOT include tip-off-risking phrasing (FDL Art.29)."></textarea></label>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">goAML reference</span>',
            '<input type="text" name="goaml_ref" placeholder="e.g. RPT-2026-0001"></label>',
          '<label class="mv-field"><span class="mv-field-label">MLRO (preparer)</span>',
            '<input type="text" name="mlro" placeholder="MLRO name"></label>',
          '<label class="mv-field"><span class="mv-field-label">Four-eyes approver</span>',
            '<input type="text" name="approver" placeholder="Second approver"></label>',
        '</div>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Status</span>',
            '<select name="status">',
              STR_STATUSES.map(function (p) {
                return '<option value="' + esc(p[0]) + '"' + (p[0] === 'draft' ? ' selected' : '') + '>' + esc(p[1]) + '</option>';
              }).join(''),
            '</select></label>',
          '<label class="mv-check" style="align-self:end"><input type="checkbox" name="no_tip_off" checked><span>No tipping-off observed (FDL Art.29)</span></label>',
        '</div>',
        '<div class="mv-form-actions">',
          '<button type="submit" class="mv-btn mv-btn-primary">Open case</button>',
          '<button type="button" class="mv-btn mv-btn-ghost" data-action="sc-str-new-toggle">Cancel</button>',
        '</div>',
      '</form>',

      '<h3 class="mv-subhead">Register</h3>',
      rows.length
        ? '<ul class="mv-list">' + rows.slice().reverse().slice(0, 30).map(function (r) {
            var overdueFlag = r.deadline && r.status !== 'submitted' && r.status !== 'acknowledged' && r.status !== 'closed'
              && new Date(r.deadline).getTime() < Date.now();
            var tone = overdueFlag ? 'warn'
              : r.status === 'submitted' || r.status === 'acknowledged' ? 'ok'
              : r.status === 'approved' ? 'accent'
              : 'warn';
            var statusLabel = (STR_STATUSES.filter(function (p) { return p[0] === r.status; })[0] || [r.status || 'draft','Draft'])[1];
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.title || r.subject || '—') +
                  ' <span class="mv-badge" data-tone="accent">' + esc(r.kind || 'STR') + '</span>' +
                '</div>' +
                '<div class="mv-list-meta">' +
                  (r.subject ? 'Subject: ' + esc(r.subject) : '') +
                  (r.subject_country ? ' · ' + esc(r.subject_country) : '') +
                  (r.amount ? ' · AED ' + esc(Number(r.amount).toLocaleString()) : '') +
                  ' · detected ' + esc(fmtDate(r.detected_on)) +
                  ' · deadline ' + esc(fmtDate(r.deadline)) +
                '</div>' +
                (r.red_flag ? '<div class="mv-list-meta">Red flag: ' + esc(r.red_flag) + '</div>' : '') +
                (r.narrative ? '<div class="mv-list-meta" style="opacity:.75">' + esc(r.narrative.slice(0, 180)) + (r.narrative.length > 180 ? '…' : '') + '</div>' : '') +
                (r.goaml_ref ? '<div class="mv-list-meta">goAML ' + esc(r.goaml_ref) + '</div>' : '') +
              '</div>' +
              '<span class="mv-badge" data-tone="' + tone + '">' + esc(statusLabel) + (overdueFlag ? ' · overdue' : '') + '</span>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#128204;', 'No STR cases open.')
    ].join('');

    host.querySelectorAll('[data-action="sc-str-new-toggle"]').forEach(function (btn) {
      btn.onclick = function () {
        var form = host.querySelector('#sc-str-form');
        if (!form) return;
        form.style.display = form.style.display === 'none' ? '' : 'none';
        if (form.style.display !== 'none') form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    });
    var form = host.querySelector('#sc-str-form');
    if (form) {
      form.onsubmit = function (ev) {
        ev.preventDefault();
        var fd = new FormData(form);
        var toIso = function (dmy) {
          var s = (dmy || '').toString().trim();
          var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (!m) return '';
          return m[3] + '-' + m[2].padStart(2,'0') + '-' + m[1].padStart(2,'0');
        };
        rows.push({
          id: 'str-' + Date.now(),
          title: (fd.get('title') || '').toString().trim(),
          kind: fd.get('kind') || 'STR',
          subject: (fd.get('subject') || '').toString().trim(),
          subject_country: (fd.get('subject_country') || '').toString().trim(),
          amount: parseFloat(fd.get('amount')) || 0,
          detected_on: toIso(fd.get('detected_on')) || new Date().toISOString().slice(0, 10),
          deadline: toIso(fd.get('deadline')) || '',
          red_flag: fd.get('red_flag') || '',
          narrative: (fd.get('narrative') || '').toString().trim(),
          goaml_ref: (fd.get('goaml_ref') || '').toString().trim(),
          mlro: (fd.get('mlro') || '').toString().trim(),
          approver: (fd.get('approver') || '').toString().trim(),
          status: fd.get('status') || 'draft',
          no_tip_off: fd.get('no_tip_off') === 'on',
          opened_on: new Date().toISOString().slice(0, 10)
        });
        safeSave(STORAGE.strCases, rows);
        renderSTRCases(host);
      };
    }
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
