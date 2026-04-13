/**
 * NORAD War Room client — SPA tab renderer.
 *
 * Consumes the `/api/warroom/stream` SSE endpoint and renders a
 * snapshot into `#warRoomContainer`. Also exposes:
 *
 *   window.warRoomStart()    — open the SSE stream
 *   window.warRoomStop()     — close the stream
 *   window.warRoomRefresh()  — one-shot snapshot render from the
 *                              last known state
 *   window.warRoomBrief()    — read the voice brief via the Web
 *                              Speech API wrapper (voiceMlroAssistant
 *                              is a browser module; the client uses
 *                              a lightweight inline brief reader)
 *
 * The module escapes every user-controlled value via a private
 * `esc()` helper so hostile event titles cannot execute as HTML.
 *
 * Regulatory basis:
 *   FDL Art.20-21 (CO situational awareness)
 *   Cabinet Res 134/2025 Art.19 (continuous monitoring)
 *   EOCN Inspection Manual §9
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  var container = null;
  var eventSource = null;
  var lastSnapshot = null;
  var startBtn = null;
  var stopBtn = null;

  function el(id) {
    return document.getElementById(id);
  }

  function escHtml(s) {
    if (s === null || s === undefined) return '';
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function ensureRefs() {
    if (!container) container = el('warRoomContainer');
    if (!startBtn) startBtn = el('warRoomStartBtn');
    if (!stopBtn) stopBtn = el('warRoomStopBtn');
  }

  var ACCENT = {
    ok: '#3DA876',
    info: '#4A8FC1',
    warn: '#E8A030',
    critical: '#D94F4F',
  };

  function renderTiles(tiles) {
    if (!Array.isArray(tiles) || tiles.length === 0) {
      return '<p style="color:var(--muted);font-size:12px;padding:12px">No KPI tiles.</p>';
    }
    return (
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px">' +
      tiles
        .map(function (t) {
          var color = ACCENT[t.accent] || ACCENT.info;
          return (
            '<div style="background:var(--surface2);border:1px solid ' +
            color +
            '44;border-left:4px solid ' +
            color +
            ';border-radius:4px;padding:12px">' +
            '<div style="font-size:10px;color:var(--muted);letter-spacing:0.5px;text-transform:uppercase">' +
            escHtml(t.label) +
            '</div>' +
            '<div style="font-size:28px;font-weight:600;color:' +
            color +
            ';margin-top:4px">' +
            escHtml(t.value) +
            '</div>' +
            (t.sublabel
              ? '<div style="font-size:10px;color:#7a7870;margin-top:2px">' +
                escHtml(t.sublabel) +
                '</div>'
              : '') +
            '</div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function renderIncidentRow(i) {
    var sevColor =
      i.severity === 'critical'
        ? ACCENT.critical
        : i.severity === 'high' || i.severity === 'medium'
          ? ACCENT.warn
          : '#7a7870';
    var minutesLabel =
      typeof i.minutesRemaining === 'number'
        ? '<div style="font-size:11px;color:' +
          (i.minutesRemaining < 60 ? ACCENT.critical : ACCENT.warn) +
          '">' +
          escHtml(i.minutesRemaining) +
          'm left</div>'
        : '';
    return (
      '<div style="display:flex;align-items:center;gap:12px;padding:8px 12px;border-bottom:1px solid #2a2a2a">' +
      '<span style="background:' +
      sevColor +
      '22;color:' +
      sevColor +
      ';border:1px solid ' +
      sevColor +
      '44;border-radius:3px;padding:2px 8px;font-size:10px;text-transform:uppercase;min-width:60px;text-align:center">' +
      escHtml(i.severity) +
      '</span>' +
      '<div style="flex:1;min-width:0">' +
      '<div style="font-size:12px;font-weight:500;color:#f5f5f5">' +
      escHtml(i.title) +
      '</div>' +
      '<div style="font-size:10px;color:#7a7870">' +
      (i.entityId ? 'Entity ' + escHtml(i.entityId) + ' · ' : '') +
      'opened ' +
      escHtml(i.openedAt) +
      '</div>' +
      '</div>' +
      minutesLabel +
      '</div>'
    );
  }

  function renderList(title, rows, emptyMessage) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return (
        '<section><div style="font-size:11px;font-weight:600;color:#a8a8a8;text-transform:uppercase;margin-bottom:6px;letter-spacing:0.5px">' +
        escHtml(title) +
        '</div><div style="background:#181818;border-radius:4px;padding:12px;color:var(--muted);font-size:12px">' +
        escHtml(emptyMessage) +
        '</div></section>'
      );
    }
    return (
      '<section><div style="font-size:11px;font-weight:600;color:#a8a8a8;text-transform:uppercase;margin-bottom:6px;letter-spacing:0.5px">' +
      escHtml(title) +
      '</div><div style="background:#181818;border-radius:4px">' +
      rows.map(renderIncidentRow).join('') +
      '</div></section>'
    );
  }

  function renderRecentEvents(events) {
    if (!Array.isArray(events) || events.length === 0) {
      return '<p style="color:var(--muted);font-size:12px">No recent events.</p>';
    }
    return events
      .map(function (title) {
        return '<div style="padding:2px 0">' + escHtml(title) + '</div>';
      })
      .join('');
  }

  function render(snapshot) {
    ensureRefs();
    if (!container) return;
    if (!snapshot) {
      container.innerHTML =
        '<p style="color:var(--muted);font-size:12px;padding:20px;text-align:center">No snapshot yet — click Start Live or Refresh.</p>';
      return;
    }
    container.innerHTML =
      '<div class="card" style="padding:16px">' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:12px">' +
      '<div>' +
      '<div style="font-size:16px;font-weight:600">🎯 War Room — Tenant ' +
      escHtml(snapshot.tenantId) +
      '</div>' +
      '<div style="font-size:10px;color:#7a7870">As of ' +
      escHtml(new Date(snapshot.asOf).toLocaleString('en-GB')) +
      '</div>' +
      '</div></div>' +
      renderTiles(snapshot.tiles) +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">' +
      renderList('Top incidents', snapshot.topIncidents, 'No active incidents.') +
      renderList('Upcoming deadlines', snapshot.upcomingDeadlines, 'No deadlines in window.') +
      '</div>' +
      '<section style="margin-top:16px">' +
      '<div style="font-size:11px;font-weight:600;color:#a8a8a8;text-transform:uppercase;margin-bottom:6px;letter-spacing:0.5px">Recent events</div>' +
      '<div style="background:#181818;border-radius:4px;padding:12px;font-size:11px;font-family:Menlo,ui-monospace,monospace;color:#cdcdcd;max-height:200px;overflow-y:auto">' +
      renderRecentEvents(snapshot.recentEventTitles) +
      '</div></section>' +
      '</div>';
  }

  function bearer() {
    try {
      return localStorage.getItem('auth.token');
    } catch (_) {
      return null;
    }
  }

  async function oneShotRefresh() {
    // The SSE endpoint also handles a one-shot GET, but we also
    // re-render whatever we've got if the user just wants to
    // repaint the last snapshot.
    ensureRefs();
    if (!container) return;
    if (lastSnapshot) {
      render(lastSnapshot);
      return;
    }
    container.innerHTML =
      '<p style="color:var(--muted);font-size:12px;padding:20px;text-align:center">No snapshot available yet. Click Start Live to open the stream.</p>';
  }

  function start() {
    ensureRefs();
    if (!container) return;
    if (eventSource) return;
    var token = bearer();
    if (!token) {
      container.innerHTML =
        '<p style="color:var(--red);font-size:12px;padding:20px;text-align:center">Sign in required — authenticated session is needed to open the war-room stream.</p>';
      return;
    }
    // EventSource does not send Authorization headers; we use a
    // query-string token only as a fallback for dev. Production
    // deployments should use a session cookie instead.
    var url = '/api/warroom/stream?tenantId=default';
    try {
      eventSource = new EventSource(url, { withCredentials: true });
    } catch (err) {
      container.innerHTML =
        '<p style="color:var(--red);font-size:12px;padding:20px">EventSource failed: ' +
        escHtml(String(err && err.message ? err.message : err)) +
        '</p>';
      return;
    }
    eventSource.addEventListener('snapshot', function (ev) {
      try {
        lastSnapshot = JSON.parse(ev.data);
        render(lastSnapshot);
      } catch (_) {
        /* ignore malformed frame */
      }
    });
    eventSource.addEventListener('error', function () {
      // EventSource auto-reconnects unless the server responds 401.
    });
    if (startBtn) startBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = '';
  }

  function stop() {
    if (eventSource) {
      try {
        eventSource.close();
      } catch (_) {
        /* ignore */
      }
      eventSource = null;
    }
    if (startBtn) startBtn.style.display = '';
    if (stopBtn) stopBtn.style.display = 'none';
  }

  function brief() {
    if (!lastSnapshot) {
      if (typeof toast === 'function') toast('No snapshot to brief yet — open the stream first.', 'info');
      return;
    }
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      if (typeof toast === 'function') toast('Voice brief not supported in this browser.', 'error');
      return;
    }
    var sentences = [];
    sentences.push('Compliance status as of ' + lastSnapshot.asOf.slice(0, 16).replace('T', ' ') + ' UTC.');
    var tiles = lastSnapshot.tiles || [];
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      sentences.push(t.label + ': ' + t.value + '.');
    }
    sentences.push('End of brief.');
    var synth = window.speechSynthesis;
    synth.cancel();
    var delay = 0;
    sentences.forEach(function (s) {
      setTimeout(function () {
        var u = new SpeechSynthesisUtterance(s);
        u.rate = 1.0;
        u.pitch = 1.0;
        u.lang = 'en-AE';
        synth.speak(u);
      }, delay);
      delay += 600;
    });
  }

  window.warRoomStart = start;
  window.warRoomStop = stop;
  window.warRoomRefresh = oneShotRefresh;
  window.warRoomBrief = brief;
})();
