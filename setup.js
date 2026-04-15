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

  function renderEnvBlock() {
    if (!state.brainToken) {
      writeOutput('env-output', '(click "Generate secrets" above to see your env var block)');
      return;
    }
    var lines = [
      'ANTHROPIC_API_KEY=' + (state.anthropic || 'sk-ant-PASTE-YOURS'),
      'HAWKEYE_BRAIN_TOKEN=hk-' + state.brainToken,
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
    setStatus('generate-status', 'ok', 'Generated');
    readInputs();
    renderEnvBlock();
  });

  ['input-anthropic', 'input-asana-token', 'input-asana-gid', 'input-site-url'].forEach(function (id) {
    byId(id).addEventListener('input', function () {
      readInputs();
      renderEnvBlock();
      updateLinks();
    });
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
    if (!state.siteUrl) {
      setStatus('verify-status', 'err', 'No site URL');
      return;
    }
    if (!state.brainToken) {
      setStatus('verify-status', 'err', 'Generate secrets first');
      return;
    }
    setStatus('verify-status', 'pending', 'Checking…');
    writeOutput('verify-output', 'Checking ' + state.siteUrl + ' …');
    var token = 'hk-' + state.brainToken;
    Promise.all([
      fetch(state.siteUrl + '/api/brain/diagnostics', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: '{}',
      }).then(function (r) { return { name: 'brain-diagnostics', status: r.status }; }).catch(function (e) { return { name: 'brain-diagnostics', err: String(e) }; }),
      fetch(state.siteUrl + '/api/brain/health', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: '{}',
      }).then(function (r) { return { name: 'brain-health', status: r.status }; }).catch(function (e) { return { name: 'brain-health', err: String(e) }; }),
    ]).then(function (results) {
      var allOk = results.every(function (r) { return r.status && r.status < 500; });
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
    var token = 'hk-' + state.brainToken;
    fetch(state.siteUrl + '/api/setup/cohort-upload', {
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

  // --- Step 8: bootstrap Asana ---
  byId('btn-bootstrap').addEventListener('click', function () {
    readInputs();
    var tenantId = byId('input-bootstrap-tenant').value.trim();
    if (!tenantId) {
      setStatus('bootstrap-status', 'err', 'Tenant required');
      return;
    }
    setStatus('bootstrap-status', 'pending', 'Provisioning…');
    var token = 'hk-' + state.brainToken;
    fetch(state.siteUrl + '/api/setup/asana-bootstrap', {
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

  // --- Live links ---
  function updateLinks() {
    if (!state.siteUrl) return;
    byId('link-tool').href = state.siteUrl + '/';
    byId('link-tool').textContent = '→ Open ' + state.siteUrl;
    byId('link-brain').href = state.siteUrl + '/#tab-brain';
    byId('link-brain').textContent = '→ Open Brain Console at ' + state.siteUrl;
    byId('link-status').href = state.siteUrl + '/status.html';
    byId('link-status').textContent = '→ Public status page at ' + state.siteUrl + '/status.html';
  }
})();
