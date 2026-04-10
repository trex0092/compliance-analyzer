/**
 * Watchlist Admin — vanilla JS mobile-friendly UI for managing the
 * compliance watchlist. Served as a static file alongside the main
 * tool. No build step, no framework, no dependencies.
 *
 * Talks to /api/watchlist (same-origin), using the HAWKEYE_BRAIN_TOKEN
 * the user pastes once and we save in localStorage. Saves / restores
 * the token locally so it's only entered once per device.
 *
 * CSP-compliant: loaded as an external file (script-src 'self' in
 * netlify.toml covers this), all event handlers attached via
 * addEventListener (not inline onclick), no eval, no Function()
 * constructor, no dynamic script loading.
 */
(function () {
  'use strict';

  const API_BASE = '/api/watchlist';
  const TOKEN_KEY = 'hawkeye.watchlist.adminToken';

  const $ = (id) => document.getElementById(id);
  const tokenInput = $('token');
  const subjectNameInput = $('subjectName');
  const subjectIdInput = $('subjectId');
  const riskTierSelect = $('riskTier');
  const jurisdictionInput = $('jurisdiction');
  const notesInput = $('notes');
  const addBtn = $('addBtn');
  const addMsg = $('addMsg');
  const refreshBtn = $('refreshBtn');
  const subjectList = $('subjectList');
  const statCount = $('statCount');

  // ─── Token persistence ────────────────────────────────────────────
  try {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) tokenInput.value = saved;
  } catch (_err) {
    /* localStorage may be disabled in private mode — fall through silently */
  }

  tokenInput.addEventListener('blur', function () {
    try {
      if (tokenInput.value) {
        localStorage.setItem(TOKEN_KEY, tokenInput.value);
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
    } catch (_err) { /* ignore */ }
  });

  // ─── UI helpers ───────────────────────────────────────────────────

  function showMessage(el, text, isError) {
    el.innerHTML = '';
    if (!text) return;
    const div = document.createElement('div');
    div.className = 'msg ' + (isError ? 'msg-error' : 'msg-success');
    div.textContent = text;
    el.appendChild(div);
  }

  /** Generate a stable, human-readable id from a subject name. */
  function generateId(name) {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const ts = Date.now().toString(36).slice(-6);
    return (slug || 'subject') + '-' + ts;
  }

  // ─── API client ───────────────────────────────────────────────────

  async function apiCall(method, body) {
    const token = tokenInput.value.trim();
    if (!token) {
      return { ok: false, error: 'Token required — paste it in the Authentication box above.' };
    }
    try {
      const init = {
        method: method,
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      };
      if (body) init.body = JSON.stringify(body);

      const res = await fetch(API_BASE, init);
      let json = null;
      try {
        json = await res.json();
      } catch (_parseErr) {
        /* response was not JSON — let the status speak for itself */
      }
      if (!res.ok) {
        const errMsg = (json && json.error) || ('HTTP ' + res.status);
        return { ok: false, error: errMsg };
      }
      return { ok: true, data: json };
    } catch (err) {
      const msg = (err && err.message) ? err.message : 'unknown';
      return { ok: false, error: 'Network error: ' + msg };
    }
  }

  // ─── Add flow ─────────────────────────────────────────────────────

  async function addSubject() {
    addBtn.disabled = true;
    addBtn.textContent = 'Adding…';
    showMessage(addMsg, '', false);

    const name = subjectNameInput.value.trim();
    if (!name) {
      showMessage(addMsg, 'Subject name is required.', true);
      addBtn.disabled = false;
      addBtn.textContent = 'Add to monitoring';
      return;
    }

    const id = subjectIdInput.value.trim() || generateId(name);
    const metadata = {};
    if (jurisdictionInput.value.trim()) metadata.jurisdiction = jurisdictionInput.value.trim();
    if (notesInput.value.trim()) metadata.notes = notesInput.value.trim();
    metadata.addedVia = 'watchlist-admin';

    const result = await apiCall('POST', {
      action: 'add',
      id: id,
      subjectName: name,
      riskTier: riskTierSelect.value,
      metadata: metadata,
    });

    if (result.ok) {
      showMessage(
        addMsg,
        'Added "' + name + '" to the watchlist (id: ' + id + '). Monitoring begins at the next scheduled run (06:00 or 14:00 UTC). Luisa will see the first Asana task within 30 seconds of that run.',
        false
      );
      subjectNameInput.value = '';
      subjectIdInput.value = '';
      jurisdictionInput.value = '';
      notesInput.value = '';
      riskTierSelect.value = 'medium';
      await refreshList();
    } else {
      showMessage(addMsg, 'Could not add subject: ' + result.error, true);
    }

    addBtn.disabled = false;
    addBtn.textContent = 'Add to monitoring';
  }

  // ─── List + remove flow ───────────────────────────────────────────

  async function refreshList() {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Loading…';

    const result = await apiCall('GET');

    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Refresh list';

    if (!result.ok) {
      statCount.textContent = '?';
      subjectList.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Could not load watchlist: ' + result.error;
      subjectList.appendChild(p);
      return;
    }

    const data = result.data || {};
    const wl = data.watchlist || { entries: [] };
    const entries = Array.isArray(wl.entries) ? wl.entries : [];
    statCount.textContent = String(entries.length);

    subjectList.innerHTML = '';
    if (entries.length === 0) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No subjects being monitored yet. Add one above to start.';
      subjectList.appendChild(p);
      return;
    }

    entries.forEach(function (entry) {
      subjectList.appendChild(buildSubjectRow(entry));
    });
  }

  function buildSubjectRow(entry) {
    const row = document.createElement('div');
    row.className = 'subject-row';

    const info = document.createElement('div');
    info.className = 'subject-info';

    const name = document.createElement('div');
    name.className = 'subject-name';
    name.textContent = entry.subjectName || '(unnamed)';

    const idEl = document.createElement('div');
    idEl.className = 'subject-id';
    idEl.textContent = entry.id || '—';

    info.appendChild(name);
    info.appendChild(idEl);

    const tier = document.createElement('span');
    const tierValue = entry.riskTier || 'medium';
    tier.className = 'subject-tier tier-' + tierValue;
    tier.textContent = tierValue;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-small';
    removeBtn.textContent = 'Remove';
    removeBtn.type = 'button';
    removeBtn.addEventListener('click', function () {
      removeSubject(entry.id, entry.subjectName || '(unnamed)');
    });

    row.appendChild(info);
    row.appendChild(tier);
    row.appendChild(removeBtn);

    return row;
  }

  async function removeSubject(id, name) {
    const confirmed = window.confirm(
      'Stop monitoring "' + name + '"? This removes them from the watchlist immediately. The next scheduled run will not check this subject.'
    );
    if (!confirmed) return;

    const result = await apiCall('POST', { action: 'remove', id: id });
    if (result.ok) {
      await refreshList();
    } else {
      window.alert('Could not remove subject: ' + result.error);
    }
  }

  // ─── Wire it up ───────────────────────────────────────────────────

  addBtn.addEventListener('click', addSubject);
  refreshBtn.addEventListener('click', refreshList);

  // Pressing Enter in any input submits the add form
  [subjectNameInput, subjectIdInput, jurisdictionInput, notesInput].forEach(function (input) {
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addSubject();
      }
    });
  });

  // Initial load so the user sees the current count right away
  refreshList();
})();
