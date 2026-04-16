/**
 * HAWKEYE STERLING — Setup Wizard client-side logic.
 *
 * Extracted from setup.html to comply with the strict CSP in
 * netlify.toml (script-src 'self' + specific hash allowlist).
 */
(function () {
  'use strict';

  // --- State ---
  var state = {
    brainToken: '',
    crossSalt: '',
    jwtSecret: '',
    bcryptPepper: '',
    anthropic: '',
    asanaToken: '',
    asanaGid: '',
    siteUrl: '',
  };

  // --- Persistence ---
  // The wizard regenerates fresh tokens on every Generate click, but the
  // Netlify env vars only get updated when the operator imports the env
  // block. If the operator refreshes the wizard tab between Generate and
  // the next deploy, the in-memory token is wiped and the new browser
  // token no longer matches HAWKEYE_BRAIN_TOKEN → "Invalid token" 401.
  //
  // Persist the generated secrets in localStorage so they survive
  // refreshes. The stored token only ever changes when the operator
  // explicitly clicks Generate again, so as long as they sync once,
  // every subsequent click of Verify / Upload / Bootstrap works.
  //
  // localStorage is same-origin, never sent over the network, and the
  // wizard is operator-only behind /setup.html which has noindex/nofollow.
  var STORAGE_KEY = 'hawkeye-setup-wizard-v1';

  function saveState() {
    try {
      // Snapshot the free-text fields too (tenant + cohort tenant) so a
      // mid-wizard refresh never wipes a half-finished flow.
      var tenantEl = byId('input-tenant');
      var bootstrapEl = byId('input-bootstrap-tenant');
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        brainToken: state.brainToken,
        crossSalt: state.crossSalt,
        jwtSecret: state.jwtSecret,
        bcryptPepper: state.bcryptPepper,
        anthropic: state.anthropic,
        asanaToken: state.asanaToken,
        asanaGid: state.asanaGid,
        siteUrl: state.siteUrl,
        tenantId: tenantEl ? tenantEl.value.trim() : '',
        bootstrapTenantId: bootstrapEl ? bootstrapEl.value.trim() : '',
      }));
    } catch (_) { /* localStorage may be disabled — fail silent */ }
  }

  function loadState() {
    var restoredSomething = false;
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return false;

      // Generated secrets — only count the wizard as "restored" when the
      // brain token itself was saved, to preserve the existing status
      // message semantics in the init block.
      if (typeof saved.brainToken === 'string' && saved.brainToken) {
        state.brainToken = saved.brainToken;
        state.crossSalt = saved.crossSalt || '';
        state.jwtSecret = saved.jwtSecret || '';
        state.bcryptPepper = saved.bcryptPepper || '';
        restoredSomething = true;
      }

      // User-typed inputs — always repopulate the DOM so the operator
      // never has to re-paste their Anthropic key, Asana token, workspace
      // GID, or Netlify site URL between tab reloads.
      state.anthropic = saved.anthropic || '';
      state.asanaToken = saved.asanaToken || '';
      state.asanaGid = saved.asanaGid || '';
      state.siteUrl = saved.siteUrl || '';
      var fieldMap = {
        'input-anthropic': state.anthropic,
        'input-asana-token': state.asanaToken,
        'input-asana-gid': state.asanaGid,
        'input-site-url': state.siteUrl,
      };
      Object.keys(fieldMap).forEach(function (id) {
        var el = byId(id);
        if (el && fieldMap[id]) el.value = fieldMap[id];
      });
      // Tenant fields have their own default values in the HTML — only
      // overwrite if the operator had explicitly customised them.
      if (saved.tenantId) {
        var tEl = byId('input-tenant');
        if (tEl) tEl.value = saved.tenantId;
      }
      if (saved.bootstrapTenantId) {
        var bEl = byId('input-bootstrap-tenant');
        if (bEl) bEl.value = saved.bootstrapTenantId;
      }
      if (state.anthropic || state.asanaToken || state.asanaGid || state.siteUrl) {
        restoredSomething = true;
      }
    } catch (_) { /* corrupt JSON — ignore */ }
    return restoredSomething;
  }

  // --- Helpers ---
  function randHex(bytes) {
    var arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function byId(id) { return document.getElementById(id); }

  function setStatus(id, kind, text) {
    var el = byId(id);
    if (!el) return;
    el.className = 'status ' + kind;
    el.textContent = text;
  }

  function writeOutput(id, text) {
    var el = byId(id);
    if (el) el.textContent = text;
  }

  function readInputs() {
    state.anthropic = byId('input-anthropic').value.trim();
    state.asanaToken = byId('input-asana-token').value.trim();
    state.asanaGid = byId('input-asana-gid').value.trim();
    state.siteUrl = byId('input-site-url').value.trim().replace(/\/+$/, '');
  }

  // Always return an absolute URL we can safely concatenate '/api/...' to.
  // Prefer an explicit Site URL from Step 4 if the user typed a valid
  // https://... origin. Otherwise fall back to window.location.origin so
  // the wizard just works when served from the same site it's calling.
  // This makes the wizard bulletproof against empty / malformed input.
  function apiBase() {
    var s = state.siteUrl || '';
    if (/^https?:\/\/[^/]+/i.test(s)) {
      // Keep only the origin, strip any accidental /setup.html or trailing path.
      try {
        var u = new URL(s);
        return u.origin;
      } catch (_) { /* fall through */ }
    }
    return window.location.origin;
  }

  function renderEnvBlock() {
    if (!state.brainToken) {
      writeOutput('env-output', '(click "Generate secrets" above to see your env var block)');
      return;
    }
    var lines = [
      'ANTHROPIC_API_KEY=' + (state.anthropic || 'sk-ant-PASTE-YOURS'),
      'HAWKEYE_BRAIN_TOKEN=' + state.brainToken,
      'HAWKEYE_ALLOWED_ORIGIN=' + (state.siteUrl || 'https://YOUR-SITE.netlify.app'),
      'HAWKEYE_CROSS_TENANT_SALT=v2026Q2-' + state.crossSalt,
      'ASANA_ACCESS_TOKEN=' + (state.asanaToken || '1/PASTE-YOURS'),
      'ASANA_WORKSPACE_GID=' + (state.asanaGid || 'PASTE-16-DIGITS'),
      'JWT_SIGNING_SECRET=' + state.jwtSecret,
      'BCRYPT_PEPPER=' + state.bcryptPepper,
      'BRAIN_TELEMETRY_ENABLED=true',
      'BRAIN_RATE_LIMIT_PER_15MIN=100',
      'HAWKEYE_CLAMP_CRON_TENANTS=tenant-a',
      'HAWKEYE_DELTA_SCREEN_TENANTS=tenant-a',
    ];
    writeOutput('env-output', lines.join('\n'));
  }

  // --- Step 4: generate secrets ---
  byId('btn-generate').addEventListener('click', function () {
    state.brainToken = randHex(32);
    state.crossSalt = randHex(16);
    state.jwtSecret = randHex(32);
    state.bcryptPepper = randHex(16);
    saveState();
    setStatus('generate-status', 'ok', 'Generated');
    readInputs();
    renderEnvBlock();
  });

  ['input-anthropic', 'input-asana-token', 'input-asana-gid', 'input-site-url'].forEach(function (id) {
    byId(id).addEventListener('input', function () {
      readInputs();
      saveState(); // paste once, survive every refresh
      renderEnvBlock();
      updateLinks();
    });
  });

  // Persist the Step 7 + Step 8 tenant fields on every keystroke too.
  ['input-tenant', 'input-bootstrap-tenant'].forEach(function (id) {
    var el = byId(id);
    if (el) el.addEventListener('input', saveState);
  });

  // --- Step 5: copy env block ---
  byId('btn-copy-env').addEventListener('click', function () {
    var text = byId('env-output').textContent;
    navigator.clipboard.writeText(text).then(function () {
      byId('btn-copy-env').textContent = 'Copied!';
      setTimeout(function () { byId('btn-copy-env').textContent = 'Copy'; }, 2000);
    });
  });

  // --- Step 6: verify ---
  byId('btn-verify').addEventListener('click', function () {
    readInputs();
    if (!state.brainToken) {
      setStatus('verify-status', 'err', 'Generate secrets first');
      return;
    }
    var base = apiBase();
    setStatus('verify-status', 'pending', 'Checking…');
    writeOutput('verify-output', 'Checking ' + base + ' …');
    var token = state.brainToken;
    Promise.all([
      fetch(base + '/api/brain/diagnostics', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: '{}',
      }).then(function (r) { return { name: 'brain-diagnostics', status: r.status }; }).catch(function (e) { return { name: 'brain-diagnostics', err: String(e) }; }),
      fetch(base + '/api/brain/health', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: '{}',
      }).then(function (r) { return { name: 'brain-health', status: r.status }; }).catch(function (e) { return { name: 'brain-health', err: String(e) }; }),
    ]).then(function (results) {
      // Consider the deploy "live" when at least the health endpoint
      // answers with < 500. brain-diagnostics imports heavy subsystems
      // and can legitimately be down without blocking the wizard.
      var healthRow = results.find(function (r) { return r.name === 'brain-health'; });
      var allOk = healthRow && healthRow.status && healthRow.status < 500;
      setStatus('verify-status', allOk ? 'ok' : 'err', allOk ? 'Live' : 'Degraded');
      writeOutput('verify-output', JSON.stringify(results, null, 2));
      updateLinks();
    });
  });

  // --- Step 7: upload cohort ---
  byId('btn-upload-cohort').addEventListener('click', function () {
    readInputs();
    var tenantId = byId('input-tenant').value.trim();
    var csv = byId('input-csv').value;
    if (!tenantId || !csv) {
      setStatus('cohort-status', 'err', 'Tenant + CSV required');
      return;
    }
    setStatus('cohort-status', 'pending', 'Uploading…');
    var token = state.brainToken;
    fetch(apiBase() + '/api/setup/cohort-upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: tenantId, csv: csv }),
    }).then(function (r) {
      return r.json().then(function (body) { return { status: r.status, body: body }; });
    }).then(function (res) {
      var ok = res.status < 400 && res.body && res.body.ok !== false;
      setStatus('cohort-status', ok ? 'ok' : 'err', ok ? 'Uploaded' : 'Failed');
      writeOutput('cohort-output', JSON.stringify(res.body, null, 2));
    }).catch(function (err) {
      setStatus('cohort-status', 'err', 'Network error');
      writeOutput('cohort-output', String(err));
    });
  });

  // --- Step 9: scan for lumped entity tasks ---
  byId('btn-scan-lumped').addEventListener('click', function () {
    readInputs();
    var projectGid = byId('input-scan-project-gid').value.trim();
    if (!projectGid) {
      setStatus('scan-lumped-status', 'err', 'Project GID required');
      return;
    }
    if (!/^\d+$/.test(projectGid)) {
      setStatus('scan-lumped-status', 'err', 'GID must be digits only');
      return;
    }
    setStatus('scan-lumped-status', 'pending', 'Scanning…');
    var token = state.brainToken;
    fetch(apiBase() + '/api/setup/scan-lumped-tasks', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectGid: projectGid }),
    }).then(function (r) {
      return r.json().then(function (body) { return { status: r.status, body: body }; });
    }).then(function (res) {
      var ok = res.status < 400 && res.body && res.body.ok !== false;
      setStatus('scan-lumped-status', ok ? 'ok' : 'err', ok ? 'Clean' : 'Findings');
      writeOutput('scan-lumped-output', JSON.stringify(res.body, null, 2));
    }).catch(function (err) {
      setStatus('scan-lumped-status', 'err', 'Network error');
      writeOutput('scan-lumped-output', String(err));
    });
  });

  // --- Step 8: bootstrap Asana ---
  byId('btn-bootstrap').addEventListener('click', function () {
    readInputs();
    var tenantId = byId('input-bootstrap-tenant').value.trim();
    if (!tenantId) {
      setStatus('bootstrap-status', 'err', 'Tenant required');
      return;
    }
    setStatus('bootstrap-status', 'pending', 'Provisioning…');
    var token = state.brainToken;
    fetch(apiBase() + '/api/setup/asana-bootstrap', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: tenantId }),
    }).then(function (r) {
      return r.json().then(function (body) { return { status: r.status, body: body }; });
    }).then(function (res) {
      var ok = res.status < 400 && res.body && res.body.ok !== false;
      setStatus('bootstrap-status', ok ? 'ok' : 'err', ok ? 'Ready' : 'Failed');
      writeOutput('bootstrap-output', JSON.stringify(res.body, null, 2));
    }).catch(function (err) {
      setStatus('bootstrap-status', 'err', 'Network error');
      writeOutput('bootstrap-output', String(err));
    });
  });

  // --- Step 9: provision KYC/CDD Tracker sections ---
  byId('btn-kyc-cdd-sections').addEventListener('click', function () {
    readInputs();
    var projectGid = byId('input-kyc-cdd-project-gid').value.trim();
    if (!projectGid) {
      setStatus('kyc-cdd-sections-status', 'err', 'Project GID required');
      return;
    }
    if (!/^\d+$/.test(projectGid)) {
      setStatus('kyc-cdd-sections-status', 'err', 'GID must be digits only');
      return;
    }
    setStatus('kyc-cdd-sections-status', 'pending', 'Provisioning sections…');
    var token = state.brainToken;
    fetch(apiBase() + '/api/setup/kyc-cdd-tracker-sections', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectGid: projectGid }),
    }).then(function (r) {
      return r.json().then(function (body) { return { status: r.status, body: body }; });
    }).then(function (res) {
      var ok = res.status < 400 && res.body && res.body.ok !== false;
      setStatus('kyc-cdd-sections-status', ok ? 'ok' : 'err', ok ? 'Ready' : 'Failed');
      writeOutput('kyc-cdd-sections-output', JSON.stringify(res.body, null, 2));
    }).catch(function (err) {
      setStatus('kyc-cdd-sections-status', 'err', 'Network error');
      writeOutput('kyc-cdd-sections-output', String(err));
    });
  });

  // --- Step 11: TM scan ---
  byId('btn-tm-scan').addEventListener('click', function () {
    readInputs();
    var dispatch = byId('input-tm-dispatch').checked;
    setStatus('tm-scan-status', 'pending', 'Scanning…');
    var token = state.brainToken;
    fetch(apiBase() + '/.netlify/functions/tm-scan-cron', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dispatch: dispatch }),
    }).then(function (r) {
      return r.json().then(function (body) { return { status: r.status, body: body }; });
    }).then(function (res) {
      var ok = res.status < 400 && res.body && res.body.ok !== false;
      var flagged = (res.body && res.body.flaggedCustomers) || 0;
      setStatus('tm-scan-status', ok ? 'ok' : 'err', ok ? (flagged > 0 ? flagged + ' flagged' : 'Clean') : 'Failed');
      writeOutput('tm-scan-output', JSON.stringify(res.body, null, 2));
    }).catch(function (err) {
      setStatus('tm-scan-status', 'err', 'Network error');
      writeOutput('tm-scan-output', String(err));
    });
  });

  // --- Live links ---
  function updateLinks() {
    var base = apiBase();
    byId('link-tool').href = base + '/';
    byId('link-tool').textContent = '→ Open ' + base;
    byId('link-brain').href = base + '/#tab-brain';
    byId('link-brain').textContent = '→ Open Brain Console at ' + base;
    byId('link-status').href = base + '/status.html';
    byId('link-status').textContent = '→ Public status page at ' + base + '/status.html';
  }

  // --- Init ---
  // Restore previously generated secrets from localStorage so the
  // operator can refresh the wizard tab without losing the in-memory
  // token (which would otherwise stop matching Netlify's
  // HAWKEYE_BRAIN_TOKEN env var until they re-imported the env block).
  if (loadState()) {
    setStatus('generate-status', 'ok', 'Restored from previous session');
    readInputs();
    renderEnvBlock();
    updateLinks();
  }
})();
