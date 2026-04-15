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
  // Paste once, never again. The token lives in localStorage under
  // TOKEN_KEY and is restored on every page load. We save on THREE
  // triggers so no code path can lose the token:
  //   1. input   — every keystroke / paste, debounced to the next tick
  //   2. blur    — when the user tabs out of the field (legacy trigger)
  //   3. beforeunload — belt-and-braces for tab close / navigation
  // The save is a no-op when the value hasn't changed, so the triple
  // trigger is free from a performance point of view.
  function saveToken() {
    try {
      const value = tokenInput.value.trim();
      if (value) {
        localStorage.setItem(TOKEN_KEY, value);
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
    } catch (_err) { /* localStorage may be disabled — ignore */ }
  }

  try {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) tokenInput.value = saved;
  } catch (_err) {
    /* localStorage may be disabled in private mode — fall through silently */
  }

  tokenInput.addEventListener('blur', function () {
    saveToken();
    // Auto-verify token format + server acceptance on blur
    validateToken();
  });

  tokenInput.addEventListener('input', function () {
    // Save on every keystroke / paste so a tab close never loses it
    saveToken();
    // Clear any previous status while the user is still typing
    updateTokenStatus('pending', '');
  });

  window.addEventListener('beforeunload', saveToken);

  // ─── Token validation (client-side format + server round trip) ───

  const TOKEN_MIN = 32;
  const TOKEN_HEX_RE = /^[a-f0-9]+$/i;

  function updateTokenStatus(state, message) {
    let statusEl = document.getElementById('tokenStatus');
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.id = 'tokenStatus';
      statusEl.style.marginTop = '8px';
      statusEl.style.fontSize = '13px';
      statusEl.style.padding = '8px 12px';
      statusEl.style.borderRadius = '3px';
      statusEl.style.display = 'none';
      tokenInput.parentNode.insertBefore(statusEl, tokenInput.nextSibling);
    }
    if (!message) {
      statusEl.style.display = 'none';
      return;
    }
    statusEl.style.display = 'block';
    if (state === 'ok') {
      statusEl.style.background = 'rgba(61,168,118,0.12)';
      statusEl.style.border = '1px solid var(--green)';
      statusEl.style.color = 'var(--green)';
      statusEl.textContent = '✓ ' + message;
    } else if (state === 'error') {
      statusEl.style.background = 'rgba(217,79,79,0.12)';
      statusEl.style.border = '1px solid var(--red)';
      statusEl.style.color = 'var(--red)';
      statusEl.textContent = '✗ ' + message;
    } else {
      statusEl.style.background = 'rgba(201,168,76,0.08)';
      statusEl.style.border = '1px solid var(--border)';
      statusEl.style.color = 'var(--muted)';
      statusEl.textContent = '… ' + message;
    }
  }

  async function validateToken() {
    const token = tokenInput.value.trim();
    if (!token) {
      updateTokenStatus('pending', '');
      return false;
    }
    // Client-side format check (matches the server's auth middleware)
    if (token.length < TOKEN_MIN) {
      updateTokenStatus(
        'error',
        'Token too short (' + token.length + ' chars; server requires at least ' + TOKEN_MIN + '). Did you truncate it when copying?'
      );
      return false;
    }
    if (!TOKEN_HEX_RE.test(token)) {
      const badChars = [];
      for (let i = 0; i < token.length; i++) {
        if (!/[a-f0-9]/i.test(token.charAt(i))) {
          badChars.push(token.charAt(i));
        }
      }
      updateTokenStatus(
        'error',
        'Token has non-hex characters. The server only accepts 0-9 and a-f. ' +
          'You may have pasted the wrong token (e.g. the Asana token, which has other characters). ' +
          (badChars.length > 0 && badChars.length <= 10 ? 'Bad chars: ' + badChars.join(' ') : '')
      );
      return false;
    }
    // Round-trip check: GET /api/watchlist with this token
    updateTokenStatus('pending', 'Verifying token with server…');
    try {
      const res = await fetch(API_BASE, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token },
      });
      if (res.status === 401) {
        updateTokenStatus(
          'error',
          'Server rejected the token. Format is OK, but it does not match HAWKEYE_BRAIN_TOKEN in Netlify. Double-check you copied the right env var value (not ASANA_TOKEN, not ANTHROPIC_API_KEY).'
        );
        return false;
      }
      if (res.status === 503) {
        updateTokenStatus(
          'error',
          'Server says HAWKEYE_BRAIN_TOKEN is not configured. Set it in Netlify → Environment variables → Add variable, then redeploy.'
        );
        return false;
      }
      if (!res.ok) {
        updateTokenStatus('error', 'Unexpected server response: HTTP ' + res.status);
        return false;
      }
      // Success — parse the response and refresh the list while we're at it
      const json = await res.json();
      const count = (json && json.count) || 0;
      updateTokenStatus('ok', 'Token verified. Server is monitoring ' + count + ' subject' + (count === 1 ? '' : 's') + '.');
      return true;
    } catch (err) {
      const msg = (err && err.message) ? err.message : 'unknown';
      updateTokenStatus('error', 'Network error while verifying: ' + msg);
      return false;
    }
  }

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
    // Client-side format check first (fail fast without a network call)
    if (token.length < TOKEN_MIN) {
      return {
        ok: false,
        error: 'Token too short (' + token.length + ' chars). The server requires at least ' + TOKEN_MIN + ' hex characters. Double-check you copied the full HAWKEYE_BRAIN_TOKEN value.',
      };
    }
    if (!TOKEN_HEX_RE.test(token)) {
      return {
        ok: false,
        error: 'Token has non-hex characters. The server only accepts 0-9 and a-f. You may have pasted the wrong token — check that you copied HAWKEYE_BRAIN_TOKEN (not ASANA_TOKEN or ANTHROPIC_API_KEY).',
      };
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
        // Translate common status codes into actionable messages
        if (res.status === 401) {
          return {
            ok: false,
            error: 'Server rejected the token (401). Format is OK but it does not match HAWKEYE_BRAIN_TOKEN in Netlify. Double-check you copied the right env var value from Netlify → Environment variables.',
          };
        }
        if (res.status === 503) {
          return {
            ok: false,
            error: 'Server says HAWKEYE_BRAIN_TOKEN is not configured. Set it in Netlify → Environment variables, then redeploy.',
          };
        }
        if (res.status === 429) {
          return {
            ok: false,
            error: 'Rate limited (429). Wait a minute and try again.',
          };
        }
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
    // Final safety net: persist the token at action time so a click
    // that bypasses blur (Enter key, touch tap without focus) still
    // leaves a saved credential behind.
    saveToken();
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

  // On initial load: if a token is already saved from a previous session,
  // auto-validate it so the user immediately sees whether it still works.
  // Always refresh the list afterwards — even on validation failure —
  // so the stat box never sits on its HTML default "—" and the user
  // gets an actionable error instead of a silent-looking page.
  if (tokenInput.value.trim()) {
    validateToken().finally(function () {
      refreshList();
    });
  } else {
    refreshList();
  }
})();
