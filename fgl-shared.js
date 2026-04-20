/**
 * Shared helpers for the native module renderers across all landings.
 *
 * Exposes:
 *   window.__fglShared = {
 *     safeParse, safeSave, esc, fmtDate, businessDays, diffHours,
 *     head, emptyState, filterBar, chipRow, countdown, timelineHtml,
 *     audit(kind, action, entity, meta), recentAudit(kind?),
 *     crossRef.store(kind, id, payload), crossRef.lookup(kind, id),
 *     crossRef.list(kind)
 *   }
 *
 * Audit trail writes to localStorage key `fgl_audit_trail`; the main
 * app already reads from `fgl_*` so audit data persists across every
 * Hawkeye surface (FDL No.10/2025 Art.24).
 *
 * Cross-ref writes to `fgl_cross_ref` and is used so Subject Screening
 * → STR Cases → Approvals (four-eyes) can link records by id without
 * each module knowing the storage schema of the others.
 */
(function () {
  'use strict';
  if (window.__fglShared) return;

  var AUDIT_KEY = 'fgl_audit_trail';
  var XREF_KEY = 'fgl_cross_ref';

  function safeParse(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (_) { return fallback; }
  }
  function safeSave(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (_) {}
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
  // Returns the ISO date string that is N UAE business days after `from`.
  // Weekends = Saturday + Sunday per UAE 2022+ working week.
  function businessDays(from, n) {
    var d = from ? new Date(from) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    var added = 0;
    while (added < n) {
      d.setUTCDate(d.getUTCDate() + 1);
      var dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) added++;
    }
    return d.toISOString();
  }
  function diffHours(toIso) {
    if (!toIso) return null;
    var t = new Date(toIso).getTime();
    if (isNaN(t)) return null;
    return Math.round((t - Date.now()) / 3600000);
  }

  // ─── Component partials ──────────────────────────────────────────
  function head(title, actionsHtml) {
    return '<div class="mv-head"><h2 class="mv-title">' + esc(title) + '</h2>' +
      '<div class="mv-actions">' + (actionsHtml || '') + '</div></div>';
  }
  function emptyState(icon, msg, cta) {
    return '<div class="mv-empty-state"><div class="mv-empty-icon">' + icon + '</div>' +
      '<p>' + esc(msg) + '</p>' +
      (cta ? '<div class="mv-empty-cta">' + cta + '</div>' : '') + '</div>';
  }
  function filterBar(html) {
    return '<div class="mv-filter-bar">' + html + '</div>';
  }
  function chipRow(name, options, current) {
    // options: [{value, label}]; current = string; renders a toggle-chip
    // row; each chip carries data-chip-group/data-chip-value so the
    // caller can wire listeners generically.
    return '<div class="mv-chip-row" data-chip-group="' + esc(name) + '">' +
      options.map(function (o) {
        return '<button type="button" class="mv-chip' + (o.value === current ? ' is-active' : '') +
          '" data-chip-value="' + esc(o.value) + '">' + esc(o.label) + '</button>';
      }).join('') + '</div>';
  }
  function countdown(deadlineIso, label) {
    var h = diffHours(deadlineIso);
    if (h == null) return '<span class="mv-badge">—</span>';
    var cls = h < 0 ? ' is-overdue' : h < 6 ? ' is-urgent' : h < 24 ? ' is-soon' : '';
    var text = h < 0 ? 'Overdue by ' + Math.abs(h) + 'h' :
      h < 48 ? 'Due in ' + h + 'h' :
      'Due in ' + Math.ceil(h / 24) + 'd';
    return '<span class="mv-countdown' + cls + '" title="' + esc(label || 'Deadline') + '">' +
      esc(text) + '</span>';
  }
  function timelineHtml(entries) {
    if (!entries || !entries.length) return '';
    return '<ol class="mv-timeline">' + entries.map(function (e) {
      return '<li><time>' + esc(fmtDate(e.at)) + '</time>' +
        '<strong>' + esc(e.actor || 'system') + '</strong>' +
        '<span>' + esc(e.note) + '</span></li>';
    }).join('') + '</ol>';
  }

  // ─── Audit trail ─────────────────────────────────────────────────
  function audit(kind, action, entity, meta) {
    var log = safeParse(AUDIT_KEY, []);
    log.push({
      id: 'au-' + Date.now() + '-' + Math.floor(Math.random() * 1e6),
      at: new Date().toISOString(),
      kind: kind, action: action, entity: entity,
      meta: meta || null
    });
    // Keep last 2000 entries; full audit trail remains in server-side
    // Netlify Blob storage per CLAUDE.md; this is the client-visible
    // mirror the MLRO sees across surfaces.
    if (log.length > 2000) log.splice(0, log.length - 2000);
    safeSave(AUDIT_KEY, log);
    return log[log.length - 1];
  }
  function recentAudit(kind, limit) {
    var log = safeParse(AUDIT_KEY, []);
    if (kind) log = log.filter(function (e) { return e.kind === kind; });
    return log.slice(-(limit || 50)).reverse();
  }

  // ─── Cross-ref ───────────────────────────────────────────────────
  function xrefStore(kind, id, payload) {
    var map = safeParse(XREF_KEY, {});
    map[kind] = map[kind] || {};
    map[kind][id] = payload;
    safeSave(XREF_KEY, map);
  }
  function xrefLookup(kind, id) {
    var map = safeParse(XREF_KEY, {});
    return (map[kind] || {})[id] || null;
  }
  function xrefList(kind) {
    var map = safeParse(XREF_KEY, {});
    var bucket = map[kind] || {};
    return Object.keys(bucket).map(function (id) {
      return Object.assign({ __id: id }, bucket[id]);
    });
  }

  window.__fglShared = {
    safeParse: safeParse,
    safeSave: safeSave,
    esc: esc,
    fmtDate: fmtDate,
    businessDays: businessDays,
    diffHours: diffHours,
    head: head,
    emptyState: emptyState,
    filterBar: filterBar,
    chipRow: chipRow,
    countdown: countdown,
    timelineHtml: timelineHtml,
    audit: audit,
    recentAudit: recentAudit,
    crossRef: { store: xrefStore, lookup: xrefLookup, list: xrefList }
  };
})();
