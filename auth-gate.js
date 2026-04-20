/**
 * MLRO Auth Gate — shared client-side session manager loaded on every
 * protected page so the MLRO signs in ONCE at the homepage and every
 * other surface (/workbench, /logistics, /compliance-ops, /routines,
 * /screening-command, /watchlist-admin) reads the session silently.
 *
 * Flow:
 *   1. Page loads → checks localStorage for `hawkeye.session.jwt`
 *      + `hawkeye.session.expiresAt`.
 *   2. If absent or expired → redirect to `/` with the current URL
 *      captured in `?return=` so the user lands back where they
 *      intended after signing in.
 *   3. If present → mirror the JWT into `hawkeye.watchlist.adminToken`
 *      so the existing `asana-client-bridge.js` and legacy pages that
 *      read that key keep working unchanged. One sign-in, one place.
 *
 * The homepage (`/`, index.html) is UNgated — it hosts the sign-in
 * form and must be reachable without a session.
 *
 * Exposes:
 *   window.__hawkeyeAuth = {
 *     isSignedIn()       -> boolean
 *     getJwt()           -> string | null
 *     getMlroName()      -> string | null
 *     logout()           -> clears session + redirects to /
 *     login(name, pass)  -> Promise<{ok, error?}>
 *   }
 *
 * Regulatory basis:
 *   - FDL No.(10)/2025 Art.20-21 (CO accountability — every
 *     authenticated surface traces back to a named principal)
 *   - FDL No.(10)/2025 Art.24 (10-year audit retention — jti
 *     correlates session → actions)
 *   - CLAUDE.md Seguridad §5 (secure session tokens)
 */
(function () {
  'use strict';

  var JWT_KEY       = 'hawkeye.session.jwt';
  var EXP_KEY       = 'hawkeye.session.expiresAt';
  var JTI_KEY       = 'hawkeye.session.jti';
  var NAME_KEY      = 'hawkeye.session.mlroName';
  var LEGACY_KEY    = 'hawkeye.watchlist.adminToken';

  function now() { return Math.floor(Date.now() / 1000); }

  function safeGet(k) {
    try { return localStorage.getItem(k); } catch (_) { return null; }
  }
  function safeSet(k, v) {
    try { localStorage.setItem(k, v); } catch (_) {}
  }
  function safeDel(k) {
    try { localStorage.removeItem(k); } catch (_) {}
  }

  function getJwt() {
    var jwt = safeGet(JWT_KEY);
    if (!jwt) return null;
    var exp = parseInt(safeGet(EXP_KEY) || '0', 10);
    if (!exp || exp <= now()) {
      clearSession();
      return null;
    }
    return jwt;
  }

  function isSignedIn() {
    return !!getJwt();
  }

  function getMlroName() {
    return safeGet(NAME_KEY);
  }

  function storeSession(token, expiresAt, jti, mlroName) {
    safeSet(JWT_KEY, token);
    safeSet(EXP_KEY, String(expiresAt || 0));
    if (jti) safeSet(JTI_KEY, jti);
    if (mlroName) safeSet(NAME_KEY, mlroName);
    // Legacy mirror so asana-client-bridge.js and every page that
    // reads hawkeye.watchlist.adminToken keeps working without a
    // code change on day one.
    safeSet(LEGACY_KEY, token);
  }

  function clearSession() {
    safeDel(JWT_KEY);
    safeDel(EXP_KEY);
    safeDel(JTI_KEY);
    safeDel(NAME_KEY);
    safeDel(LEGACY_KEY);
  }

  function login(mlroName, password) {
    if (!password) {
      return Promise.resolve({ ok: false, error: 'Password is required.' });
    }
    return fetch('/api/hawkeye-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password })
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) {
          var msg = (json && json.error) || ('Login failed (HTTP ' + res.status + ').');
          return { ok: false, error: msg };
        }
        if (!json || !json.token || !json.expiresAt) {
          return { ok: false, error: 'Login response malformed.' };
        }
        storeSession(json.token, json.expiresAt, json.jti, mlroName || 'MLRO');
        return { ok: true };
      }).catch(function () {
        return { ok: false, error: 'Login response could not be parsed.' };
      });
    }).catch(function (err) {
      return { ok: false, error: (err && err.message) || 'Network error.' };
    });
  }

  function logout() {
    clearSession();
    try {
      location.href = '/';
    } catch (_) {}
  }

  // Page gate. Called automatically on script load. If this page is
  // marked as protected via <script data-auth-gate="true" …>, and
  // there is no valid session, redirect to the homepage, capturing
  // the current path in `?return=` for post-login redirect.
  function runGate() {
    var tag = document.currentScript || (function () {
      var s = document.getElementsByTagName('script');
      for (var i = s.length - 1; i >= 0; i--) {
        if (s[i].src && s[i].src.indexOf('auth-gate.js') !== -1) return s[i];
      }
      return null;
    })();
    if (!tag) return;
    var mode = tag.getAttribute('data-auth-gate');
    if (mode !== 'protect') return;
    if (isSignedIn()) return;
    var back = location.pathname + location.search + location.hash;
    var url = '/?return=' + encodeURIComponent(back);
    // Replace so the back button doesn't trap the user on a gated page.
    try { location.replace(url); } catch (_) { location.href = url; }
  }

  window.__hawkeyeAuth = {
    isSignedIn: isSignedIn,
    getJwt: getJwt,
    getMlroName: getMlroName,
    login: login,
    logout: logout,
    storeSession: storeSession,
    clearSession: clearSession
  };

  // Run the gate immediately on load so protected pages never flash
  // their contents before the redirect fires.
  runGate();
})();
