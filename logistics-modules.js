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

  function renderInbound(host) {
    var rows = safeParse(STORAGE.inbound, []);
    var assayCleared = rows.filter(function (r) { return r.assay_ok; }).length;
    var confidenceScore = rows.length > 0 ? Math.round((assayCleared / rows.length) * 100) : 0;
    host.innerHTML = [
      head('Inbound Advice',
        '<span class="mv-pill">10yr retention · FDL Art.24</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="lg-in-new">+ New shipment</button>'
      ),
      '<p class="mv-lede">Every incoming shipment recorded against supplier, invoice, assay, and Dubai Customs / Brinks paperwork. Primary control for supply-chain traceability.</p>',
      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v">' + rows.length + '</div><div class="mv-stat-k">Records</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="ok">' + assayCleared + '</div><div class="mv-stat-k">Assay ✓</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="' + (confidenceScore >= 80 ? 'ok' : 'warn') + '">' + confidenceScore + '%</div><div class="mv-stat-k">Confidence</div></div>',
      '</div>',
      rows.length
        ? '<ul class="mv-list">' + rows.slice(-15).reverse().map(function (r) {
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.supplier) + ' — ' + esc(r.kg || '0') + ' kg</div>' +
                '<div class="mv-list-meta">Arrived ' + esc(fmtDate(r.arrived_on)) +
                  ' · invoice ' + esc(r.invoice || '—') + '</div>' +
              '</div>' +
              '<span class="mv-badge" data-tone="' + (r.assay_ok ? 'ok' : 'warn') + '">' +
                (r.assay_ok ? 'Cleared' : 'Pending assay') + '</span>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#128230;', 'No inbound shipments recorded.')
    ].join('');

    host.querySelectorAll('[data-action="lg-in-new"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var supplier = prompt('Supplier?');
        if (!supplier) return;
        var kg = prompt('Weight (kg)?') || '0';
        var invoice = prompt('Invoice number?') || '';
        var assay_ok = confirm('Assay cleared?');
        rows.push({
          id: 'in-' + Date.now(), supplier: supplier.trim(), kg: kg, invoice: invoice,
          arrived_on: new Date().toISOString().slice(0, 10), assay_ok: assay_ok
        });
        safeSave(STORAGE.inbound, rows);
        renderInbound(host);
      });
    });
  }

  function renderTracking(host) {
    var rows = safeParse(STORAGE.tracking, []);
    host.innerHTML = [
      head('Tracking',
        '<span class="mv-pill">Live GPS · custody chain</span>'
      ),
      '<p class="mv-lede">Live in-transit status, ETA, carrier, and custody handovers for every shipment on the move. Flags any deviation from declared routing.</p>',
      rows.length
        ? '<ul class="mv-list">' + rows.slice(-15).reverse().map(function (r) {
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.ref) + ' · ' + esc(r.carrier || '—') + '</div>' +
                '<div class="mv-list-meta">' + esc(r.origin || '—') + ' → ' + esc(r.destination || '—') +
                  ' · ETA ' + esc(fmtDate(r.eta)) + '</div>' +
              '</div>' +
              '<span class="mv-badge" data-tone="' + (r.status === 'deviation' ? 'warn' : 'ok') + '">' + esc(r.status || 'in-transit') + '</span>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#9992;', 'No shipments in transit.')
    ].join('');
  }

  function renderApprovedAccounts(host) {
    var rows = safeParse(STORAGE.accounts, []);
    host.innerHTML = [
      head('Approved Accounts',
        '<span class="mv-pill">Cabinet Decision 109/2023 · UBO &gt; 25%</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="lg-acc-new">+ Add counterparty</button>'
      ),
      '<p class="mv-lede">Pre-vetted suppliers, refiners, and vault counterparties cleared through CDD, sanctions screening, and UBO verification.</p>',
      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v">' + rows.length + '</div><div class="mv-stat-k">Approved</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="ok">' + rows.filter(function (r) { return r.ubo_verified; }).length + '</div><div class="mv-stat-k">UBO ✓</div></div>',
      '</div>',
      rows.length
        ? '<ul class="mv-list">' + rows.map(function (r) {
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.name) + '</div>' +
                '<div class="mv-list-meta">' + esc(r.type || 'supplier') + ' · ' + esc(r.jurisdiction || '') + '</div>' +
              '</div>' +
              '<span class="mv-badge" data-tone="' + (r.ubo_verified ? 'ok' : 'warn') + '">' +
                (r.ubo_verified ? 'UBO verified' : 'UBO pending') + '</span>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#9989;', 'No approved counterparties yet.')
    ].join('');

    host.querySelectorAll('[data-action="lg-acc-new"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = prompt('Counterparty name?');
        if (!name) return;
        var type = prompt('Type (supplier / refiner / vault)?') || 'supplier';
        var jur = prompt('Jurisdiction?') || '';
        var ubo = confirm('UBO verified?');
        rows.push({
          id: 'acc-' + Date.now(), name: name.trim(), type: type, jurisdiction: jur, ubo_verified: ubo
        });
        safeSave(STORAGE.accounts, rows);
        renderApprovedAccounts(host);
      });
    });
  }

  function renderLocalShipments(host) {
    var rows = safeParse(STORAGE.local, []);
    host.innerHTML = [
      head('Local Shipments',
        '<span class="mv-pill">AED 55K DPMS CTR · MoE 08/AML/2021</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="lg-loc-new">+ New transfer</button>'
      ),
      '<p class="mv-lede">Intra-UAE and counter-to-counter transfers. Same-day movements between branches, refiners, and vault counterparties. Auto-flags transactions ≥ AED 55,000.</p>',
      rows.length
        ? '<ul class="mv-list">' + rows.slice(-15).reverse().map(function (r) {
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.from) + ' → ' + esc(r.to) + '</div>' +
                '<div class="mv-list-meta">' + esc(fmtDate(r.transferred_on)) +
                  ' · AED ' + esc((r.value_aed || 0).toLocaleString()) + '</div>' +
              '</div>' +
              (r.value_aed >= 55000
                ? '<span class="mv-badge" data-tone="warn">CTR file</span>'
                : '<span class="mv-badge" data-tone="ok">Under threshold</span>') +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#128666;', 'No local shipments recorded.')
    ].join('');

    host.querySelectorAll('[data-action="lg-loc-new"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var from = prompt('From (branch/counterparty)?');
        if (!from) return;
        var to = prompt('To?') || '';
        var value = parseFloat(prompt('Value in AED?') || '0') || 0;
        rows.push({
          id: 'loc-' + Date.now(), from: from.trim(), to: to.trim(),
          value_aed: value, transferred_on: new Date().toISOString().slice(0, 10)
        });
        safeSave(STORAGE.local, rows);
        renderLocalShipments(host);
      });
    });
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
