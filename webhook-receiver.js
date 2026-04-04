/**
 * Webhook Receiver Module — Hawkeye Sterling V2 v2.3
 * Polls the Cloudflare Worker proxy for real-time Asana/Slack webhook events.
 * Browser-side: polls GET /webhooks/events, processes events, shows notifications.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'fgl_webhook_events';
  const MAX_EVENTS = 500;
  const DEFAULT_POLL_INTERVAL = 30000; // 30 seconds

  // ── Known event types ─────────────────────────────────────────────────────
  const ASANA_EVENTS = ['task_completed', 'task_created', 'task_updated', 'comment_added'];
  const SLACK_EVENTS = ['message', 'reaction_added', 'channel_message'];

  // ── State ─────────────────────────────────────────────────────────────────
  let pollTimer = null;
  let pollInterval = DEFAULT_POLL_INTERVAL;
  let feedOpen = false;
  let onEventCallbacks = [];

  function getProxy() { return window.PROXY_URL || ''; }

  // ── localStorage helpers ──────────────────────────────────────────────────
  function loadEvents() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch (_) { return []; }
  }

  function saveEvents(events) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(0, MAX_EVENTS)));
  }

  // ── Toast notifications ───────────────────────────────────────────────────
  function showToast(event) {
    var container = document.getElementById('fgl-webhook-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'fgl-webhook-toast-container';
      container.style.cssText = 'position:fixed;top:16px;right:16px;z-index:10000;display:flex;flex-direction:column;gap:8px;max-width:360px;';
      document.body.appendChild(container);
    }

    var toast = document.createElement('div');
    toast.style.cssText = 'background:#1e293b;color:#f1f5f9;padding:12px 16px;border-radius:3px;box-shadow:0 4px 12px rgba(0,0,0,.25);font-size:13px;line-height:1.4;opacity:0;transition:opacity .3s;border-left:4px solid ' + (event.source === 'asana' ? '#f06a6a' : '#4a154b') + ';';
    toast.innerHTML = '<div style="font-weight:600;margin-bottom:2px;">' + escapeHtml(formatSourceLabel(event.source)) + '</div>' +
      '<div>' + escapeHtml(formatEventSummary(event)) + '</div>';

    container.appendChild(toast);
    // fade in
    requestAnimationFrame(function () { toast.style.opacity = '1'; });

    // auto-remove after 5 seconds
    setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 5000);
  }

  // ── Formatting helpers ────────────────────────────────────────────────────
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function formatSourceLabel(source) {
    if (source === 'asana') return 'Asana';
    if (source === 'slack') return 'Slack';
    return source || 'Unknown';
  }

  function formatEventType(type) {
    return (type || 'unknown').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function formatEventSummary(event) {
    var type = formatEventType(event.type);
    var detail = '';
    if (event.data) {
      if (event.data.name) detail = ': ' + event.data.name;
      else if (event.data.text) detail = ': ' + event.data.text.substring(0, 80);
      else if (event.data.channel) detail = ' in #' + event.data.channel;
    }
    return type + detail;
  }

  function formatTimestamp(ts) {
    try {
      var d = new Date(ts);
      var now = new Date();
      var diff = now - d;
      if (diff < 60000) return 'just now';
      if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
      if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
      return d.toLocaleDateString('en-GB');
    } catch (_) { return ''; }
  }

  // ── Polling ───────────────────────────────────────────────────────────────
  async function poll() {
    var proxy = getProxy();
    if (!proxy) return;

    try {
      var res = await fetch(proxy + '/webhooks/events');
      if (!res.ok) return;
      var data = await res.json();
      var newEvents = data.events || [];
      if (newEvents.length === 0) return;

      var events = loadEvents();
      var existingIds = {};
      for (var i = 0; i < events.length; i++) {
        existingIds[events[i].id] = true;
      }

      var added = [];
      for (var j = 0; j < newEvents.length; j++) {
        var evt = normalizeEvent(newEvents[j]);
        if (!existingIds[evt.id] && isKnownEventType(evt)) {
          events.unshift(evt);
          added.push(evt);
        }
      }

      if (added.length > 0) {
        saveEvents(events);
        // Show toasts for new events
        for (var k = 0; k < added.length; k++) {
          showToast(added[k]);
        }
        // Fire callbacks
        for (var c = 0; c < onEventCallbacks.length; c++) {
          try { onEventCallbacks[c](added); } catch (_) { /* ignore */ }
        }
        updateBellBadge();
      }
    } catch (_) {
      // Silently ignore polling errors — will retry next interval
    }
  }

  function normalizeEvent(raw) {
    var sanitize = function(s) { return typeof s === 'string' ? s.replace(/[<>"'&]/g, '') : ''; };
    return {
      id: sanitize(raw.id) || generateId(),
      source: sanitize(raw.source) || 'unknown',
      type: sanitize(raw.type) || 'unknown',
      data: typeof raw.data === 'object' && raw.data !== null ? raw.data : {},
      timestamp: sanitize(raw.timestamp) || new Date().toISOString(),
      read: raw.read === true,
    };
  }

  function isKnownEventType(event) {
    if (event.source === 'asana') return ASANA_EVENTS.indexOf(event.type) !== -1;
    if (event.source === 'slack') return SLACK_EVENTS.indexOf(event.type) !== -1;
    return true; // allow unknown sources through
  }

  function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return 'evt_' + crypto.randomUUID();
    return 'evt_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 8);
  }

  // ── Badge update ──────────────────────────────────────────────────────────
  function updateBellBadge() {
    var badge = document.getElementById('fgl-webhook-badge');
    if (!badge) return;
    var count = getUnreadCount();
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = count > 0 ? 'flex' : 'none';
  }

  // ── Public API ────────────────────────────────────────────────────────────
  function start(options) {
    options = options || {};
    pollInterval = options.interval || DEFAULT_POLL_INTERVAL;
    stop();
    poll(); // immediate first poll
    pollTimer = setInterval(poll, pollInterval);
  }

  function stop() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function getEvents(filter) {
    var events = loadEvents();
    if (!filter) return events;
    return events.filter(function (e) {
      if (filter.source && e.source !== filter.source) return false;
      if (filter.type && e.type !== filter.type) return false;
      if (filter.unreadOnly && e.read) return false;
      return true;
    });
  }

  function markRead(id) {
    var events = loadEvents();
    for (var i = 0; i < events.length; i++) {
      if (events[i].id === id) {
        events[i].read = true;
        break;
      }
    }
    saveEvents(events);
    updateBellBadge();
  }

  function markAllRead() {
    var events = loadEvents();
    for (var i = 0; i < events.length; i++) {
      events[i].read = true;
    }
    saveEvents(events);
    updateBellBadge();
  }

  function clearEvents() {
    if (!confirm('Are you sure you want to clear all events?')) return;
    localStorage.removeItem(STORAGE_KEY);
    updateBellBadge();
  }

  function getUnreadCount() {
    var events = loadEvents();
    var count = 0;
    for (var i = 0; i < events.length; i++) {
      if (!events[i].read) count++;
    }
    return count;
  }

  function onEvent(callback) {
    if (typeof callback === 'function') onEventCallbacks.push(callback);
  }

  // ── Render: Notification Bell ─────────────────────────────────────────────
  function renderNotificationBell() {
    var count = getUnreadCount();
    var badgeDisplay = count > 0 ? 'flex' : 'none';
    var badgeText = count > 99 ? '99+' : count;

    return '<div id="fgl-webhook-bell" style="position:relative;display:inline-block;cursor:pointer;" onclick="WebhookReceiver.toggleFeed()">' +
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>' +
        '<path d="M13.73 21a2 2 0 0 1-3.46 0"/>' +
      '</svg>' +
      '<span id="fgl-webhook-badge" style="display:' + badgeDisplay + ';position:absolute;top:-6px;right:-8px;background:#ef4444;color:#fff;font-size:10px;font-weight:700;min-width:18px;height:18px;border-radius:3px;align-items:center;justify-content:center;padding:0 4px;">' +
        badgeText +
      '</span>' +
    '</div>';
  }

  // ── Render: Event Feed Panel ──────────────────────────────────────────────
  function renderEventFeed() {
    var events = loadEvents();

    var html = '<div id="fgl-webhook-feed" style="width:380px;max-height:480px;background:#fff;border:1px solid #e2e8f0;border-radius:4px;box-shadow:0 8px 24px rgba(0,0,0,.12);overflow:hidden;font-family:system-ui,-apple-system,sans-serif;">';

    // Header
    html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e2e8f0;background:#f8fafc;">';
    html += '<span style="font-weight:600;font-size:14px;color:#1e293b;">Webhook Events</span>';
    html += '<div style="display:flex;gap:8px;">';
    html += '<button onclick="WebhookReceiver.markAllRead()" style="background:none;border:none;color:#3b82f6;font-size:12px;cursor:pointer;padding:2px 6px;">Mark all read</button>';
    html += '<button onclick="WebhookReceiver.clearEvents()" style="background:none;border:none;color:#94a3b8;font-size:12px;cursor:pointer;padding:2px 6px;">Clear</button>';
    html += '</div></div>';

    // Event list
    html += '<div style="max-height:400px;overflow-y:auto;">';

    if (events.length === 0) {
      html += '<div style="padding:32px 16px;text-align:center;color:#94a3b8;font-size:13px;">No events yet</div>';
    } else {
      for (var i = 0; i < events.length; i++) {
        var evt = events[i];
        var bgColor = evt.read ? '#fff' : '#f0f9ff';
        var dotColor = evt.source === 'asana' ? '#f06a6a' : '#4a154b';
        var readIndicator = evt.read ? '' : '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#3b82f6;margin-right:8px;flex-shrink:0;"></span>';

        html += '<div onclick="WebhookReceiver.markRead(\'' + escapeHtml(evt.id) + '\')" style="display:flex;align-items:flex-start;padding:10px 16px;border-bottom:1px solid #f1f5f9;cursor:pointer;background:' + bgColor + ';transition:background .15s;" onmouseover="this.style.background=\'#f8fafc\'" onmouseout="this.style.background=\'' + bgColor + '\'">';
        html += readIndicator;
        html += '<div style="flex:1;min-width:0;">';
        html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">';
        html += '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;"></span>';
        html += '<span style="font-weight:600;font-size:12px;color:#475569;">' + escapeHtml(formatSourceLabel(evt.source)) + '</span>';
        html += '<span style="font-size:11px;color:#94a3b8;margin-left:auto;white-space:nowrap;">' + escapeHtml(formatTimestamp(evt.timestamp)) + '</span>';
        html += '</div>';
        html += '<div style="font-size:13px;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(formatEventSummary(evt)) + '</div>';
        html += '</div></div>';
      }
    }

    html += '</div></div>';
    return html;
  }

  // ── Toggle feed panel ─────────────────────────────────────────────────────
  function toggleFeed() {
    feedOpen = !feedOpen;
    var existing = document.getElementById('fgl-webhook-feed-wrapper');
    if (existing) {
      existing.parentNode.removeChild(existing);
    }
    if (feedOpen) {
      var wrapper = document.createElement('div');
      wrapper.id = 'fgl-webhook-feed-wrapper';
      wrapper.style.cssText = 'position:fixed;top:48px;right:16px;z-index:9999;';
      wrapper.innerHTML = renderEventFeed();
      document.body.appendChild(wrapper);

      // Close when clicking outside
      setTimeout(function () {
        document.addEventListener('click', closeFeedOnClickOutside);
      }, 0);
    } else {
      document.removeEventListener('click', closeFeedOnClickOutside);
    }
  }

  function closeFeedOnClickOutside(e) {
    var feed = document.getElementById('fgl-webhook-feed-wrapper');
    var bell = document.getElementById('fgl-webhook-bell');
    if (feed && !feed.contains(e.target) && bell && !bell.contains(e.target)) {
      feedOpen = false;
      feed.parentNode.removeChild(feed);
      document.removeEventListener('click', closeFeedOnClickOutside);
    }
  }

  // ── Asana Read-Back Sync ──────────────────────────────────────────────────
  // When Asana events arrive, update local compliance data (cases, alerts, etc.)
  // Completed tasks are NOT removed — only marked as completed for audit trail.

  var TASK_LINKS_KEY = 'asana_task_links';

  function readTaskLinks() {
    try { return JSON.parse(localStorage.getItem(TASK_LINKS_KEY) || '[]'); } catch(e) { return []; }
  }

  function writeTaskLinks(links) {
    try { localStorage.setItem(TASK_LINKS_KEY, JSON.stringify(links)); } catch(e) {}
  }

  function findLinkByGid(gid) {
    return readTaskLinks().find(function(l) { return l.asanaGid === gid; });
  }

  function markLinkAsCompleted(gid) {
    var links = readTaskLinks();
    for (var i = 0; i < links.length; i++) {
      if (links[i].asanaGid === gid) {
        links[i].completedInAsana = true;
        links[i].completedAt = new Date().toISOString();
        break;
      }
    }
    writeTaskLinks(links);
  }

  /**
   * Process Asana events and update local compliance state.
   * task_completed → mark linked case/alert/approval as completed (not deleted)
   * comment_added → append to case audit log
   */
  function processAsanaReadback(events) {
    var updates = [];

    for (var i = 0; i < events.length; i++) {
      var evt = events[i];
      if (evt.source !== 'asana') continue;

      var gid = evt.data && evt.data.gid;
      if (!gid) continue;

      var link = findLinkByGid(gid);
      if (!link) continue;

      if (evt.type === 'task_completed') {
        markLinkAsCompleted(gid);
        var update = applyCompletionToLocalState(link, evt);
        if (update) updates.push(update);
      }

      if (evt.type === 'comment_added') {
        var commentUpdate = applyCommentToLocalState(link, evt);
        if (commentUpdate) updates.push(commentUpdate);
      }
    }

    // Show summary toast if any local updates were made
    if (updates.length > 0) {
      if (typeof toast === 'function') {
        toast(updates.length + ' item(s) synced from Asana', 'success');
      }
      console.log('[ReadbackSync] Applied ' + updates.length + ' updates from Asana:', updates);
    }

    return updates;
  }

  /**
   * When a task is completed in Asana, update the linked local entity.
   * Items are marked completed — never deleted.
   */
  function applyCompletionToLocalState(link, evt) {
    var localType = link.localType;
    var localId = link.localId;
    var taskName = (evt.data && evt.data.name) || link.asanaGid;
    var auditNote = 'Completed in Asana: "' + taskName + '"' + (evt.data && evt.data.user ? ' by ' + evt.data.user : '');

    if (localType === 'case') {
      return applyCaseCompletion(localId, auditNote);
    }
    if (localType === 'alert') {
      return applyAlertCompletion(localId, auditNote);
    }
    if (localType === 'approval') {
      return applyApprovalCompletion(localId, auditNote);
    }
    return { type: localType, id: localId, action: 'marked-completed', detail: auditNote };
  }

  function applyCaseCompletion(caseId, auditNote) {
    try {
      var cases = JSON.parse(localStorage.getItem('cases') || '[]');
      for (var i = 0; i < cases.length; i++) {
        if (cases[i].id === caseId) {
          // Don't auto-close — move to under-review so compliance officer decides
          if (cases[i].status === 'open') {
            cases[i].status = 'under-review';
          }
          cases[i].updatedAt = new Date().toISOString();
          // Append to audit log
          if (!cases[i].auditLog) cases[i].auditLog = [];
          cases[i].auditLog.push({
            id: 'audit_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6),
            at: new Date().toISOString(),
            by: 'asana-sync',
            action: 'status-changed',
            note: auditNote
          });
          localStorage.setItem('cases', JSON.stringify(cases));
          return { type: 'case', id: caseId, action: 'marked-completed', newStatus: cases[i].status, detail: auditNote };
        }
      }
    } catch(e) { console.warn('[ReadbackSync] Case update failed:', e); }
    return null;
  }

  function applyAlertCompletion(alertId, auditNote) {
    try {
      var alerts = JSON.parse(localStorage.getItem('alerts') || '[]');
      for (var i = 0; i < alerts.length; i++) {
        if (alerts[i].id === alertId) {
          // Mark dismissed but keep in the list
          alerts[i].dismissedAt = new Date().toISOString();
          localStorage.setItem('alerts', JSON.stringify(alerts));
          return { type: 'alert', id: alertId, action: 'marked-completed', detail: auditNote };
        }
      }
    } catch(e) { console.warn('[ReadbackSync] Alert update failed:', e); }
    return null;
  }

  function applyApprovalCompletion(approvalId, auditNote) {
    try {
      var approvals = JSON.parse(localStorage.getItem('approvals') || '[]');
      for (var i = 0; i < approvals.length; i++) {
        if (approvals[i].id === approvalId && approvals[i].status === 'pending') {
          // Task completed in Asana = approved (compliance officer marked it done)
          approvals[i].status = 'approved';
          approvals[i].decidedAt = new Date().toISOString();
          approvals[i].decidedBy = 'asana-sync';
          approvals[i].note = auditNote;
          localStorage.setItem('approvals', JSON.stringify(approvals));
          return { type: 'approval', id: approvalId, action: 'marked-completed', newStatus: 'approved', detail: auditNote };
        }
      }
    } catch(e) { console.warn('[ReadbackSync] Approval update failed:', e); }
    return null;
  }

  /**
   * When a comment is added in Asana, append it to the linked case's audit log.
   */
  function applyCommentToLocalState(link, evt) {
    if (link.localType !== 'case') return null;

    try {
      var cases = JSON.parse(localStorage.getItem('cases') || '[]');
      for (var i = 0; i < cases.length; i++) {
        if (cases[i].id === link.localId) {
          var commentText = (evt.data && evt.data.text) || 'Comment added in Asana';
          if (!cases[i].auditLog) cases[i].auditLog = [];
          cases[i].auditLog.push({
            id: 'audit_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6),
            at: evt.timestamp || new Date().toISOString(),
            by: (evt.data && evt.data.user) || 'asana-user',
            action: 'updated',
            note: '[Asana Comment] ' + commentText
          });
          cases[i].updatedAt = new Date().toISOString();
          localStorage.setItem('cases', JSON.stringify(cases));
          return { type: 'case', id: link.localId, action: 'comment-added', detail: commentText };
        }
      }
    } catch(e) { console.warn('[ReadbackSync] Comment sync failed:', e); }
    return null;
  }

  // ── Register readback processor as event callback ────────────────────────
  onEventCallbacks.push(function(newEvents) {
    processAsanaReadback(newEvents);
  });

  // ── Expose global ─────────────────────────────────────────────────────────
  window.WebhookReceiver = {
    start: start,
    stop: stop,
    getEvents: getEvents,
    markRead: function (id) { markRead(id); refreshFeedIfOpen(); },
    markAllRead: function () { markAllRead(); refreshFeedIfOpen(); },
    clearEvents: function () { clearEvents(); refreshFeedIfOpen(); },
    getUnreadCount: getUnreadCount,
    onEvent: onEvent,
    renderNotificationBell: renderNotificationBell,
    renderEventFeed: renderEventFeed,
    toggleFeed: toggleFeed,
    // Read-back sync API
    processAsanaReadback: processAsanaReadback,
    getTaskLinks: readTaskLinks,
  };

  function refreshFeedIfOpen() {
    if (!feedOpen) return;
    var wrapper = document.getElementById('fgl-webhook-feed-wrapper');
    if (wrapper) wrapper.innerHTML = renderEventFeed();
    updateBellBadge();
  }

})();
