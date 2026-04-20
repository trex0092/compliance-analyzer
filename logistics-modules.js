/**
 * Logistics native modules — green palette.
 */
(function () {
  'use strict';

  var STORAGE = {
    inbound: 'fgl_inbound_shipments',
    tracking: 'fgl_shipment_tracking',
    accounts: 'fgl_approved_accounts',
    local: 'fgl_local_shipments'
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
  function emptyState(icon, msg) {
    return '<div class="mv-empty-state"><div class="mv-empty-icon">' + icon + '</div>' +
      '<p>' + esc(msg) + '</p></div>';
  }

  function toIsoFromDMY(dmy) {
    var s = (dmy || '').toString().trim();
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return '';
    return m[3] + '-' + m[2].padStart(2,'0') + '-' + m[1].padStart(2,'0');
  }

  var INBOUND_MATERIALS = [
    ['gold_bar',     'Gold bar (cast)'],
    ['gold_minted',  'Gold bar (minted / kilobar)'],
    ['gold_grain',   'Gold grain / shot'],
    ['gold_dore',    'Gold dore'],
    ['gold_scrap',   'Gold scrap / jewellery'],
    ['silver_bar',   'Silver bar'],
    ['silver_grain', 'Silver grain'],
    ['platinum',     'Platinum'],
    ['palladium',    'Palladium'],
    ['mixed_pm',     'Mixed precious metals']
  ];

  function renderInbound(host) {
    var rows = safeParse(STORAGE.inbound, []);
    var assayCleared = rows.filter(function (r) { return r.assay_ok; }).length;
    var confidenceScore = rows.length > 0 ? Math.round((assayCleared / rows.length) * 100) : 0;
    var totalKg = rows.reduce(function (a, r) { return a + (parseFloat(r.kg) || 0); }, 0);
    var totalValue = rows.reduce(function (a, r) { return a + (parseFloat(r.value_aed) || 0); }, 0);
    var cahraFlags = rows.filter(function (r) { return r.cahra; }).length;

    host.innerHTML = [
      head('Inbound Advice',
        '<span class="mv-pill">10yr retention · FDL Art.24</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="lg-in-new-toggle">+ New shipment</button>'
      ),
      '<p class="mv-lede">Every incoming shipment recorded against supplier, invoice, assay, and Dubai Customs / Brinks paperwork. Primary control for supply-chain traceability.</p>',
      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v">' + rows.length + '</div><div class="mv-stat-k">Records</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="ok">' + assayCleared + '</div><div class="mv-stat-k">Assay ✓</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="' + (confidenceScore >= 80 ? 'ok' : 'warn') + '">' + confidenceScore + '%</div><div class="mv-stat-k">Confidence</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v">' + totalKg.toFixed(2) + '</div><div class="mv-stat-k">Total kg</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v">' + (totalValue ? 'AED ' + Math.round(totalValue).toLocaleString() : '—') + '</div><div class="mv-stat-k">Declared value</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + cahraFlags + '</div><div class="mv-stat-k">CAHRA flags</div></div>',
      '</div>',

      '<form id="lg-in-form" class="mv-form" style="display:none">',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Supplier / refiner</span>',
            '<input type="text" name="supplier" required placeholder="Supplier name"></label>',
          '<label class="mv-field"><span class="mv-field-label">Supplier country</span>',
            '<input type="text" name="origin_country" placeholder="e.g. UAE, CH, AE"></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Invoice number</span>',
            '<input type="text" name="invoice" placeholder="INV-2026-0001"></label>',
          '<label class="mv-field"><span class="mv-field-label">Airway bill / BoL</span>',
            '<input type="text" name="awb" placeholder="AWB / BoL no."></label>',
          '<label class="mv-field"><span class="mv-field-label">Arrived on (dd/mm/yyyy)</span>',
            '<input type="text" name="arrived_on" placeholder="dd/mm/yyyy"></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Material</span>',
            '<select name="material">',
              INBOUND_MATERIALS.map(function (p) {
                return '<option value="' + esc(p[0]) + '">' + esc(p[1]) + '</option>';
              }).join(''),
            '</select></label>',
          '<label class="mv-field"><span class="mv-field-label">Gross weight (kg)</span>',
            '<input type="number" name="kg" min="0" step="0.001" placeholder="0.000"></label>',
          '<label class="mv-field"><span class="mv-field-label">Fineness (‰)</span>',
            '<input type="number" name="fineness" min="0" max="1000" step="0.1" placeholder="e.g. 999.9"></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Declared value (AED)</span>',
            '<input type="number" name="value_aed" min="0" step="0.01" placeholder="0.00"></label>',
          '<label class="mv-field"><span class="mv-field-label">Dubai Customs ref</span>',
            '<input type="text" name="customs_ref" placeholder="DXB-CUS-..."></label>',
          '<label class="mv-field"><span class="mv-field-label">Secure carrier</span>',
            '<select name="carrier">',
              '<option value="brinks">Brinks</option>',
              '<option value="malca_amit">Malca-Amit</option>',
              '<option value="g4s">G4S</option>',
              '<option value="loomis">Loomis</option>',
              '<option value="other">Other</option>',
            '</select></label>',
        '</div>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Assay certificate ref</span>',
            '<input type="text" name="assay_ref" placeholder="Assay cert no."></label>',
          '<label class="mv-field"><span class="mv-field-label">LBMA / DGD chain of custody</span>',
            '<input type="text" name="coc" placeholder="CoC statement / supplier attestation"></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-check"><input type="checkbox" name="assay_ok"><span>Assay cleared</span></label>',
          '<label class="mv-check"><input type="checkbox" name="sanctions_clear" checked><span>Sanctions screening clear</span></label>',
          '<label class="mv-check"><input type="checkbox" name="cahra"><span>CAHRA / high-risk jurisdiction</span></label>',
        '</div>',
        '<label class="mv-field"><span class="mv-field-label">Notes</span>',
          '<textarea name="notes" rows="2" placeholder="Anomalies, discrepancies, follow-ups"></textarea></label>',
        '<div class="mv-form-actions">',
          '<button type="submit" class="mv-btn mv-btn-primary">Save shipment</button>',
          '<button type="button" class="mv-btn mv-btn-ghost" data-action="lg-in-new-toggle">Cancel</button>',
        '</div>',
      '</form>',

      rows.length
        ? '<ul class="mv-list">' + rows.slice(-20).reverse().map(function (r) {
            var matLabel = (INBOUND_MATERIALS.filter(function (p) { return p[0] === r.material; })[0] || [null, r.material || ''])[1];
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.supplier) + ' — ' + esc(r.kg || '0') + ' kg' +
                  (matLabel ? ' <span class="mv-badge" data-tone="accent">' + esc(matLabel) + '</span>' : '') +
                '</div>' +
                '<div class="mv-list-meta">' +
                  'Arrived ' + esc(fmtDate(r.arrived_on)) +
                  ' · invoice ' + esc(r.invoice || '—') +
                  (r.origin_country ? ' · from ' + esc(r.origin_country) : '') +
                  (r.fineness ? ' · ' + esc(r.fineness) + '‰' : '') +
                  (r.value_aed ? ' · AED ' + esc(Number(r.value_aed).toLocaleString()) : '') +
                '</div>' +
                (r.customs_ref || r.awb ? '<div class="mv-list-meta">' +
                  (r.customs_ref ? 'Customs ' + esc(r.customs_ref) : '') +
                  (r.awb ? ' · AWB ' + esc(r.awb) : '') +
                '</div>' : '') +
              '</div>' +
              '<div class="mv-list-aside">' +
                (r.cahra ? '<span class="mv-badge" data-tone="warn">CAHRA</span>' : '') +
                '<span class="mv-badge" data-tone="' + (r.assay_ok ? 'ok' : 'warn') + '">' +
                  (r.assay_ok ? 'Cleared' : 'Pending assay') + '</span>' +
              '</div>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#128230;', 'No inbound shipments recorded.')
    ].join('');

    host.querySelectorAll('[data-action="lg-in-new-toggle"]').forEach(function (btn) {
      btn.onclick = function () {
        var form = host.querySelector('#lg-in-form');
        if (!form) return;
        form.style.display = form.style.display === 'none' ? '' : 'none';
        if (form.style.display !== 'none') form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    });
    var form = host.querySelector('#lg-in-form');
    if (form) {
      form.onsubmit = function (ev) {
        ev.preventDefault();
        var fd = new FormData(form);
        rows.push({
          id: 'in-' + Date.now(),
          supplier: (fd.get('supplier') || '').toString().trim(),
          origin_country: (fd.get('origin_country') || '').toString().trim(),
          invoice: (fd.get('invoice') || '').toString().trim(),
          awb: (fd.get('awb') || '').toString().trim(),
          arrived_on: toIsoFromDMY(fd.get('arrived_on')) || new Date().toISOString().slice(0, 10),
          material: fd.get('material') || 'gold_bar',
          kg: parseFloat(fd.get('kg')) || 0,
          fineness: parseFloat(fd.get('fineness')) || 0,
          value_aed: parseFloat(fd.get('value_aed')) || 0,
          customs_ref: (fd.get('customs_ref') || '').toString().trim(),
          carrier: fd.get('carrier') || 'brinks',
          assay_ref: (fd.get('assay_ref') || '').toString().trim(),
          coc: (fd.get('coc') || '').toString().trim(),
          assay_ok: fd.get('assay_ok') === 'on',
          sanctions_clear: fd.get('sanctions_clear') === 'on',
          cahra: fd.get('cahra') === 'on',
          notes: (fd.get('notes') || '').toString().trim(),
          created_at: new Date().toISOString()
        });
        safeSave(STORAGE.inbound, rows);
        renderInbound(host);
      };
    }
  }

  var TRACK_STATUSES = [
    ['scheduled',   'Scheduled'],
    ['in_transit',  'In transit'],
    ['at_border',   'At border / customs'],
    ['delivered',   'Delivered'],
    ['deviation',   'Route deviation'],
    ['held',        'Held / inspection'],
    ['lost',        'Lost / incident']
  ];
  var TRACK_CARRIERS = ['Brinks', 'Malca-Amit', 'G4S', 'Loomis', 'Ferrari', 'DHL Premium', 'Fedex Custom Critical', 'In-house', 'Other'];

  function renderTracking(host) {
    var rows = safeParse(STORAGE.tracking, []);
    var inTransit = rows.filter(function (r) { return r.status === 'in_transit' || r.status === 'at_border'; });
    var deviations = rows.filter(function (r) { return r.status === 'deviation' || r.status === 'held' || r.status === 'lost'; });
    var delivered = rows.filter(function (r) { return r.status === 'delivered'; });

    host.innerHTML = [
      head('Tracking',
        '<span class="mv-pill">Live GPS · custody chain</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="lg-tr-new-toggle">+ Track shipment</button>'
      ),
      '<p class="mv-lede">Live in-transit status, ETA, carrier, and custody handovers for every shipment on the move. Flags any deviation from declared routing.</p>',
      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v">' + rows.length + '</div><div class="mv-stat-k">Tracked</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="accent">' + inTransit.length + '</div><div class="mv-stat-k">In transit</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + deviations.length + '</div><div class="mv-stat-k">Deviations</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="ok">' + delivered.length + '</div><div class="mv-stat-k">Delivered</div></div>',
      '</div>',

      '<form id="lg-tr-form" class="mv-form" style="display:none">',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Shipment reference</span>',
            '<input type="text" name="ref" required placeholder="SHP-2026-0001"></label>',
          '<label class="mv-field"><span class="mv-field-label">Carrier</span>',
            '<select name="carrier">',
              TRACK_CARRIERS.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join(''),
            '</select></label>',
          '<label class="mv-field"><span class="mv-field-label">Mode</span>',
            '<select name="mode">',
              '<option value="air">Air</option>',
              '<option value="road">Road</option>',
              '<option value="sea">Sea</option>',
              '<option value="rail">Rail</option>',
              '<option value="courier">Courier</option>',
            '</select></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Origin</span>',
            '<input type="text" name="origin" placeholder="City / vault / refinery"></label>',
          '<label class="mv-field"><span class="mv-field-label">Destination</span>',
            '<input type="text" name="destination" placeholder="City / vault / refinery"></label>',
          '<label class="mv-field"><span class="mv-field-label">ETA (dd/mm/yyyy)</span>',
            '<input type="text" name="eta" placeholder="dd/mm/yyyy"></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Gross weight (kg)</span>',
            '<input type="number" name="kg" min="0" step="0.001" placeholder="0.000"></label>',
          '<label class="mv-field"><span class="mv-field-label">Declared value (AED)</span>',
            '<input type="number" name="value_aed" min="0" step="0.01" placeholder="0.00"></label>',
          '<label class="mv-field"><span class="mv-field-label">Status</span>',
            '<select name="status">',
              TRACK_STATUSES.map(function (p) {
                return '<option value="' + esc(p[0]) + '"' + (p[0] === 'in_transit' ? ' selected' : '') + '>' + esc(p[1]) + '</option>';
              }).join(''),
            '</select></label>',
        '</div>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Custody officer</span>',
            '<input type="text" name="officer" placeholder="Handler / driver name"></label>',
          '<label class="mv-field"><span class="mv-field-label">Last GPS ping</span>',
            '<input type="text" name="last_ping" placeholder="Lat / Lng or location label"></label>',
        '</div>',
        '<label class="mv-field"><span class="mv-field-label">Declared route</span>',
          '<textarea name="route" rows="2" placeholder="Waypoints, border crossings, handover points"></textarea></label>',
        '<div class="mv-form-actions">',
          '<button type="submit" class="mv-btn mv-btn-primary">Save shipment</button>',
          '<button type="button" class="mv-btn mv-btn-ghost" data-action="lg-tr-new-toggle">Cancel</button>',
        '</div>',
      '</form>',

      rows.length
        ? '<ul class="mv-list">' + rows.slice(-20).reverse().map(function (r) {
            var statusLabel = (TRACK_STATUSES.filter(function (p) { return p[0] === r.status; })[0] || [null, r.status || 'in_transit'])[1];
            var tone = r.status === 'deviation' || r.status === 'held' || r.status === 'lost' ? 'warn'
              : r.status === 'delivered' ? 'ok' : 'accent';
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.ref) + ' · ' + esc(r.carrier || '—') +
                  (r.mode ? ' <span class="mv-badge" data-tone="accent">' + esc(r.mode) + '</span>' : '') +
                '</div>' +
                '<div class="mv-list-meta">' + esc(r.origin || '—') + ' → ' + esc(r.destination || '—') +
                  ' · ETA ' + esc(fmtDate(r.eta)) +
                  (r.kg ? ' · ' + esc(r.kg) + ' kg' : '') +
                  (r.value_aed ? ' · AED ' + esc(Number(r.value_aed).toLocaleString()) : '') +
                '</div>' +
                (r.officer || r.last_ping ? '<div class="mv-list-meta">' +
                  (r.officer ? 'Custody: ' + esc(r.officer) : '') +
                  (r.last_ping ? ' · Ping: ' + esc(r.last_ping) : '') +
                '</div>' : '') +
              '</div>' +
              '<span class="mv-badge" data-tone="' + tone + '">' + esc(statusLabel) + '</span>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#9992;', 'No shipments in transit.')
    ].join('');

    host.querySelectorAll('[data-action="lg-tr-new-toggle"]').forEach(function (btn) {
      btn.onclick = function () {
        var form = host.querySelector('#lg-tr-form');
        if (!form) return;
        form.style.display = form.style.display === 'none' ? '' : 'none';
        if (form.style.display !== 'none') form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    });
    var form = host.querySelector('#lg-tr-form');
    if (form) {
      form.onsubmit = function (ev) {
        ev.preventDefault();
        var fd = new FormData(form);
        rows.push({
          id: 'tr-' + Date.now(),
          ref: (fd.get('ref') || '').toString().trim(),
          carrier: fd.get('carrier') || 'Brinks',
          mode: fd.get('mode') || 'air',
          origin: (fd.get('origin') || '').toString().trim(),
          destination: (fd.get('destination') || '').toString().trim(),
          eta: toIsoFromDMY(fd.get('eta')),
          kg: parseFloat(fd.get('kg')) || 0,
          value_aed: parseFloat(fd.get('value_aed')) || 0,
          status: fd.get('status') || 'in_transit',
          officer: (fd.get('officer') || '').toString().trim(),
          last_ping: (fd.get('last_ping') || '').toString().trim(),
          route: (fd.get('route') || '').toString().trim(),
          created_at: new Date().toISOString()
        });
        safeSave(STORAGE.tracking, rows);
        renderTracking(host);
      };
    }
  }

  var ACCOUNT_TYPES = [
    ['supplier',    'Supplier'],
    ['refiner',     'Refiner'],
    ['vault',       'Vault / Bullion Depository'],
    ['broker',      'Broker / Dealer'],
    ['customer',    'Customer'],
    ['mint',        'Mint'],
    ['logistics',   'Logistics / Secure Carrier'],
    ['bank',        'Correspondent Bank'],
    ['vasp',        'Virtual Asset Service Provider']
  ];
  var CDD_LEVELS = [
    ['sdd', 'SDD — Simplified'],
    ['cdd', 'CDD — Standard'],
    ['edd', 'EDD — Enhanced']
  ];

  function renderApprovedAccounts(host) {
    var rows = safeParse(STORAGE.accounts, []);
    var uboOk = rows.filter(function (r) { return r.ubo_verified; }).length;
    var lbmaAccred = rows.filter(function (r) { return r.lbma_accredited; }).length;
    var dgdAccred = rows.filter(function (r) { return r.dgd_accredited; }).length;
    var expSoon = rows.filter(function (r) {
      if (!r.approval_expires) return false;
      var days = (new Date(r.approval_expires).getTime() - Date.now()) / 86400000;
      return days >= 0 && days <= 60;
    }).length;

    host.innerHTML = [
      head('Approved Accounts',
        '<span class="mv-pill">Cabinet Decision 109/2023 · UBO &gt; 25%</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="lg-acc-new-toggle">+ Add counterparty</button>'
      ),
      '<p class="mv-lede">Pre-vetted suppliers, refiners, and vault counterparties cleared through CDD, sanctions screening, and UBO verification.</p>',
      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v">' + rows.length + '</div><div class="mv-stat-k">Approved</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="ok">' + uboOk + '</div><div class="mv-stat-k">UBO ✓</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="ok">' + lbmaAccred + '</div><div class="mv-stat-k">LBMA accredited</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="ok">' + dgdAccred + '</div><div class="mv-stat-k">DGD accredited</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + expSoon + '</div><div class="mv-stat-k">Expiring 60d</div></div>',
      '</div>',

      '<form id="lg-acc-form" class="mv-form" style="display:none">',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Counterparty name</span>',
            '<input type="text" name="name" required placeholder="Legal name"></label>',
          '<label class="mv-field"><span class="mv-field-label">Type</span>',
            '<select name="type">',
              ACCOUNT_TYPES.map(function (p) {
                return '<option value="' + esc(p[0]) + '">' + esc(p[1]) + '</option>';
              }).join(''),
            '</select></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Jurisdiction</span>',
            '<input type="text" name="jurisdiction" placeholder="e.g. UAE, CH, SG"></label>',
          '<label class="mv-field"><span class="mv-field-label">LEI / registration no.</span>',
            '<input type="text" name="lei" placeholder="LEI or trade licence no."></label>',
          '<label class="mv-field"><span class="mv-field-label">CDD level</span>',
            '<select name="cdd_level">',
              CDD_LEVELS.map(function (p) {
                return '<option value="' + esc(p[0]) + '"' + (p[0] === 'cdd' ? ' selected' : '') + '>' + esc(p[1]) + '</option>';
              }).join(''),
            '</select></label>',
        '</div>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">UBO name (> 25%)</span>',
            '<input type="text" name="ubo_name" placeholder="Beneficial owner"></label>',
          '<label class="mv-field"><span class="mv-field-label">UBO nationality</span>',
            '<input type="text" name="ubo_nationality" placeholder="e.g. UAE"></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Last sanctions screening (dd/mm/yyyy)</span>',
            '<input type="text" name="last_screen" placeholder="dd/mm/yyyy"></label>',
          '<label class="mv-field"><span class="mv-field-label">Approval expires (dd/mm/yyyy)</span>',
            '<input type="text" name="approval_expires" placeholder="dd/mm/yyyy"></label>',
          '<label class="mv-field"><span class="mv-field-label">Approved by</span>',
            '<input type="text" name="approved_by" placeholder="MLRO / CO"></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-check"><input type="checkbox" name="ubo_verified"><span>UBO verified</span></label>',
          '<label class="mv-check"><input type="checkbox" name="lbma_accredited"><span>LBMA accredited</span></label>',
          '<label class="mv-check"><input type="checkbox" name="dgd_accredited"><span>Dubai Good Delivery</span></label>',
        '</div>',
        '<label class="mv-field"><span class="mv-field-label">Notes</span>',
          '<textarea name="notes" rows="2" placeholder="Audit findings, risk context, review cadence"></textarea></label>',
        '<div class="mv-form-actions">',
          '<button type="submit" class="mv-btn mv-btn-primary">Approve counterparty</button>',
          '<button type="button" class="mv-btn mv-btn-ghost" data-action="lg-acc-new-toggle">Cancel</button>',
        '</div>',
      '</form>',

      rows.length
        ? '<ul class="mv-list">' + rows.map(function (r) {
            var typeLabel = (ACCOUNT_TYPES.filter(function (p) { return p[0] === r.type; })[0] || [null, r.type || 'supplier'])[1];
            var cddLabel = (CDD_LEVELS.filter(function (p) { return p[0] === r.cdd_level; })[0] || [null, (r.cdd_level || 'cdd').toUpperCase()])[1];
            var expSoonFlag = r.approval_expires && ((new Date(r.approval_expires).getTime() - Date.now()) / 86400000) <= 60;
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.name) +
                  ' <span class="mv-badge" data-tone="accent">' + esc(typeLabel) + '</span>' +
                  ' <span class="mv-badge">' + esc(cddLabel) + '</span>' +
                '</div>' +
                '<div class="mv-list-meta">' +
                  esc(r.jurisdiction || '—') +
                  (r.lei ? ' · ' + esc(r.lei) : '') +
                  (r.ubo_name ? ' · UBO ' + esc(r.ubo_name) : '') +
                  (r.approval_expires ? ' · expires ' + esc(fmtDate(r.approval_expires)) : '') +
                '</div>' +
                (r.approved_by || r.last_screen ? '<div class="mv-list-meta">' +
                  (r.approved_by ? 'Approved by ' + esc(r.approved_by) : '') +
                  (r.last_screen ? ' · last screen ' + esc(fmtDate(r.last_screen)) : '') +
                '</div>' : '') +
              '</div>' +
              '<div class="mv-list-aside">' +
                (r.lbma_accredited ? '<span class="mv-badge" data-tone="ok">LBMA</span>' : '') +
                (r.dgd_accredited ? '<span class="mv-badge" data-tone="ok">DGD</span>' : '') +
                (expSoonFlag ? '<span class="mv-badge" data-tone="warn">Renewal due</span>' : '') +
                '<span class="mv-badge" data-tone="' + (r.ubo_verified ? 'ok' : 'warn') + '">' +
                  (r.ubo_verified ? 'UBO verified' : 'UBO pending') + '</span>' +
              '</div>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#9989;', 'No approved counterparties yet.')
    ].join('');

    host.querySelectorAll('[data-action="lg-acc-new-toggle"]').forEach(function (btn) {
      btn.onclick = function () {
        var form = host.querySelector('#lg-acc-form');
        if (!form) return;
        form.style.display = form.style.display === 'none' ? '' : 'none';
        if (form.style.display !== 'none') form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    });
    var form = host.querySelector('#lg-acc-form');
    if (form) {
      form.onsubmit = function (ev) {
        ev.preventDefault();
        var fd = new FormData(form);
        rows.push({
          id: 'acc-' + Date.now(),
          name: (fd.get('name') || '').toString().trim(),
          type: fd.get('type') || 'supplier',
          jurisdiction: (fd.get('jurisdiction') || '').toString().trim(),
          lei: (fd.get('lei') || '').toString().trim(),
          cdd_level: fd.get('cdd_level') || 'cdd',
          ubo_name: (fd.get('ubo_name') || '').toString().trim(),
          ubo_nationality: (fd.get('ubo_nationality') || '').toString().trim(),
          last_screen: toIsoFromDMY(fd.get('last_screen')),
          approval_expires: toIsoFromDMY(fd.get('approval_expires')),
          approved_by: (fd.get('approved_by') || '').toString().trim(),
          ubo_verified: fd.get('ubo_verified') === 'on',
          lbma_accredited: fd.get('lbma_accredited') === 'on',
          dgd_accredited: fd.get('dgd_accredited') === 'on',
          notes: (fd.get('notes') || '').toString().trim(),
          created_at: new Date().toISOString()
        });
        safeSave(STORAGE.accounts, rows);
        renderApprovedAccounts(host);
      };
    }
  }

  var LOCAL_MODES = [
    ['in_house',   'In-house secure transport'],
    ['brinks',     'Brinks'],
    ['malca_amit', 'Malca-Amit'],
    ['g4s',        'G4S'],
    ['loomis',     'Loomis'],
    ['self',       'Self-transport'],
    ['courier',    'Secure courier']
  ];

  function renderLocalShipments(host) {
    var rows = safeParse(STORAGE.local, []);
    var reportable = rows.filter(function (r) { return (r.value_aed || 0) >= 55000; });
    var nearThreshold = rows.filter(function (r) { return (r.value_aed || 0) >= 50000 && (r.value_aed || 0) < 55000; });
    var weekCutoff = Date.now() - 7 * 86400000;
    var thisWeek = rows.filter(function (r) {
      if (!r.transferred_on) return false;
      return new Date(r.transferred_on).getTime() >= weekCutoff;
    });
    var totalKg = rows.reduce(function (a, r) { return a + (parseFloat(r.kg) || 0); }, 0);
    var totalValue = rows.reduce(function (a, r) { return a + (parseFloat(r.value_aed) || 0); }, 0);

    host.innerHTML = [
      head('Local Shipments',
        '<span class="mv-pill">AED 55K DPMS CTR · MoE 08/AML/2021</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="lg-loc-new-toggle">+ New transfer</button>'
      ),
      '<p class="mv-lede">Intra-UAE and counter-to-counter transfers. Same-day movements between branches, refiners, and vault counterparties. Auto-flags transactions ≥ AED 55,000.</p>',
      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v">' + rows.length + '</div><div class="mv-stat-k">Transfers</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + reportable.length + '</div><div class="mv-stat-k">≥ AED 55K (CTR)</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + nearThreshold.length + '</div><div class="mv-stat-k">Near threshold</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="accent">' + thisWeek.length + '</div><div class="mv-stat-k">This week</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v">' + totalKg.toFixed(2) + '</div><div class="mv-stat-k">Total kg</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v">' + (totalValue ? 'AED ' + Math.round(totalValue).toLocaleString() : '—') + '</div><div class="mv-stat-k">Total value</div></div>',
      '</div>',

      '<form id="lg-loc-form" class="mv-form" style="display:none">',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Transfer reference</span>',
            '<input type="text" name="ref" placeholder="LOC-2026-0001"></label>',
          '<label class="mv-field"><span class="mv-field-label">From (branch / counterparty)</span>',
            '<input type="text" name="from" required placeholder="Origin"></label>',
          '<label class="mv-field"><span class="mv-field-label">To (branch / counterparty)</span>',
            '<input type="text" name="to" required placeholder="Destination"></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Gross weight (kg)</span>',
            '<input type="number" name="kg" min="0" step="0.001" placeholder="0.000"></label>',
          '<label class="mv-field"><span class="mv-field-label">Value (AED)</span>',
            '<input type="number" name="value_aed" min="0" step="0.01" placeholder="0.00"></label>',
          '<label class="mv-field"><span class="mv-field-label">Transferred on (dd/mm/yyyy)</span>',
            '<input type="text" name="transferred_on" placeholder="dd/mm/yyyy"></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Transfer mode</span>',
            '<select name="mode">',
              LOCAL_MODES.map(function (p) {
                return '<option value="' + esc(p[0]) + '">' + esc(p[1]) + '</option>';
              }).join(''),
            '</select></label>',
          '<label class="mv-field"><span class="mv-field-label">Custody officer</span>',
            '<input type="text" name="officer" placeholder="Name / driver"></label>',
          '<label class="mv-field"><span class="mv-field-label">Receipt reference</span>',
            '<input type="text" name="receipt" placeholder="Signed receipt no."></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-check"><input type="checkbox" name="receipt_signed"><span>Receipt signed</span></label>',
          '<label class="mv-check"><input type="checkbox" name="counter_verified"><span>Counter-to-counter verified</span></label>',
          '<label class="mv-check"><input type="checkbox" name="cash_component"><span>Cash component</span></label>',
        '</div>',
        '<label class="mv-field"><span class="mv-field-label">Notes</span>',
          '<textarea name="notes" rows="2" placeholder="Handover notes, anomalies, linked invoices"></textarea></label>',
        '<div class="mv-form-actions">',
          '<button type="submit" class="mv-btn mv-btn-primary">Save transfer</button>',
          '<button type="button" class="mv-btn mv-btn-ghost" data-action="lg-loc-new-toggle">Cancel</button>',
        '</div>',
      '</form>',

      rows.length
        ? '<ul class="mv-list">' + rows.slice(-20).reverse().map(function (r) {
            var modeLabel = (LOCAL_MODES.filter(function (p) { return p[0] === r.mode; })[0] || [null, r.mode || ''])[1];
            var amt = r.value_aed || 0;
            var badge = amt >= 55000 ? { tone: 'warn', label: 'CTR file' }
              : amt >= 50000 ? { tone: 'warn', label: 'Near threshold' }
              : { tone: 'ok', label: 'Under threshold' };
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.from) + ' → ' + esc(r.to) +
                  (r.ref ? ' <em style="opacity:.7">(' + esc(r.ref) + ')</em>' : '') +
                '</div>' +
                '<div class="mv-list-meta">' + esc(fmtDate(r.transferred_on)) +
                  ' · AED ' + esc(amt.toLocaleString()) +
                  (r.kg ? ' · ' + esc(r.kg) + ' kg' : '') +
                  (modeLabel ? ' · ' + esc(modeLabel) : '') +
                '</div>' +
                (r.officer || r.receipt ? '<div class="mv-list-meta">' +
                  (r.officer ? 'Custody: ' + esc(r.officer) : '') +
                  (r.receipt ? ' · Receipt: ' + esc(r.receipt) : '') +
                '</div>' : '') +
              '</div>' +
              '<div class="mv-list-aside">' +
                (r.cash_component ? '<span class="mv-badge" data-tone="warn">Cash</span>' : '') +
                '<span class="mv-badge" data-tone="' + badge.tone + '">' + badge.label + '</span>' +
              '</div>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#128666;', 'No local shipments recorded.')
    ].join('');

    host.querySelectorAll('[data-action="lg-loc-new-toggle"]').forEach(function (btn) {
      btn.onclick = function () {
        var form = host.querySelector('#lg-loc-form');
        if (!form) return;
        form.style.display = form.style.display === 'none' ? '' : 'none';
        if (form.style.display !== 'none') form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    });
    var form = host.querySelector('#lg-loc-form');
    if (form) {
      form.onsubmit = function (ev) {
        ev.preventDefault();
        var fd = new FormData(form);
        rows.push({
          id: 'loc-' + Date.now(),
          ref: (fd.get('ref') || '').toString().trim(),
          from: (fd.get('from') || '').toString().trim(),
          to: (fd.get('to') || '').toString().trim(),
          kg: parseFloat(fd.get('kg')) || 0,
          value_aed: parseFloat(fd.get('value_aed')) || 0,
          transferred_on: toIsoFromDMY(fd.get('transferred_on')) || new Date().toISOString().slice(0, 10),
          mode: fd.get('mode') || 'in_house',
          officer: (fd.get('officer') || '').toString().trim(),
          receipt: (fd.get('receipt') || '').toString().trim(),
          receipt_signed: fd.get('receipt_signed') === 'on',
          counter_verified: fd.get('counter_verified') === 'on',
          cash_component: fd.get('cash_component') === 'on',
          notes: (fd.get('notes') || '').toString().trim(),
          created_at: new Date().toISOString()
        });
        safeSave(STORAGE.local, rows);
        renderLocalShipments(host);
      };
    }
  }

  window.__landingModules = window.__landingModules || {};
  window.__landingModules.logistics = {
    shipments: renderInbound,
    'inbound-advice': renderInbound,
    tracking: renderTracking,
    approvedaccounts: renderApprovedAccounts,
    'approved-accounts': renderApprovedAccounts,
    localshipments: renderLocalShipments,
    'local-shipments': renderLocalShipments
  };
})();
