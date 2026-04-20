/**
 * Asana Client Bridge — tiny shared browser helper loaded by the four
 * MLRO surfaces (/workbench, /logistics, /compliance-ops, /routines)
 * so they all go through the same token-reader + /api/asana/task call
 * without duplicating boilerplate.
 *
 * Exposes:
 *   window.__hawkeyeAsana.createAsanaTaskRemote(source, payload)
 *     → Promise<{ ok, gid?, url?, projectGid?, projectName?, error? }>
 *
 *   source ∈ 'workbench' | 'logistics' | 'compliance-ops' | 'routines'
 *
 * Token is read from localStorage key 'hawkeye.watchlist.adminToken'
 * — the same key the Screening Command page writes when the MLRO
 * signs in, so one sign-in covers every surface.
 *
 * Regulatory basis: FDL No.(10)/2025 Art.20-21, Art.24.
 */
(function () {
  'use strict';

  var TOKEN_KEY = 'hawkeye.watchlist.adminToken';

  function getToken() {
    try { return (localStorage.getItem(TOKEN_KEY) || '').trim(); }
    catch (_) { return ''; }
  }

  function createAsanaTaskRemote(source, payload) {
    var token = getToken();
    if (!token) {
      return Promise.resolve({
        ok: false,
        error: 'no-token — sign in on /screening-command first to save your HAWKEYE_BRAIN_TOKEN'
      });
    }
    var body = Object.assign({ source: source }, payload || {});
    return fetch('/api/asana/task', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) return { ok: false, error: (json && json.error) || ('HTTP ' + res.status) };
        return json;
      }).catch(function () {
        return { ok: false, error: 'HTTP ' + res.status };
      });
    }).catch(function (err) {
      return { ok: false, error: (err && err.message) || 'network-error' };
    });
  }

  var configPromise = null;
  function getConfig() {
    if (configPromise) return configPromise;
    var token = getToken();
    if (!token) return Promise.resolve({ ok: false, error: 'no-token' });
    configPromise = fetch('/api/asana/config', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) return { ok: false, error: (json && json.error) || ('HTTP ' + res.status) };
        return json;
      }).catch(function () { return { ok: false, error: 'HTTP ' + res.status }; });
    }).catch(function (err) {
      configPromise = null;
      return { ok: false, error: (err && err.message) || 'network-error' };
    });
    return configPromise;
  }

  function getProjectUrl(source) {
    return getConfig().then(function (cfg) {
      if (!cfg || !cfg.ok || !cfg.projects) return null;
      var gid = cfg.projects[source];
      return gid ? 'https://app.asana.com/0/' + encodeURIComponent(gid) : null;
    });
  }

  window.__hawkeyeAsana = {
    createAsanaTaskRemote: createAsanaTaskRemote,
    getConfig: getConfig,
    getProjectUrl: getProjectUrl,
    getToken: getToken
  };
})();
