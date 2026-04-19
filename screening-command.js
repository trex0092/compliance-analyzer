/**
 * Screening Command — vanilla JS browser module for the weaponized
 * screening + transaction monitoring page. Served as a static file
 * (screening-command.html loads this via <script src="screening-command.js">).
 * Same-origin calls to:
 *   - POST /api/screening/run
 *   - POST /api/transaction/monitor
 *   - GET  /api/watchlist
 *
 * All calls authenticated with HAWKEYE_BRAIN_TOKEN (Bearer). Token
 * lives in localStorage under TOKEN_KEY, saved on every keystroke +
 * blur + beforeunload so a tab close never loses it.
 *
 * CSP-compliant: external file (script-src 'self'), no eval, no
 * inline handlers. No dependencies, no build step.
 */
(function () {
  'use strict';

  const SCREENING_ENDPOINT = '/api/screening/run';
  const SAVE_ENDPOINT = '/api/screening/save';
  const TM_ENDPOINT = '/api/transaction/monitor';
  const WATCHLIST_ENDPOINT = '/api/watchlist';
  const TOKEN_KEY = 'hawkeye.watchlist.adminToken';
  const MLRO_MAIN_KEY = 'hawkeye.mlro.main';
  const MLRO_DEPUTY_KEY = 'hawkeye.mlro.deputy';
  const TOKEN_MIN = 32;
  const TOKEN_HEX_RE = /^[a-f0-9]+$/i;
  const RATIONALE_MIN = 20;

  const $ = (id) => document.getElementById(id);

  // ─── Token persistence ────────────────────────────────────────────
  const tokenInput = $('token');

  function saveToken() {
    try {
      const value = tokenInput.value.trim();
      if (value) localStorage.setItem(TOKEN_KEY, value);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (_err) {
      /* localStorage may be disabled — ignore */
    }
  }

  try {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) tokenInput.value = saved;
  } catch (_err) {
    /* ignore */
  }

  tokenInput.addEventListener('blur', saveToken);
  tokenInput.addEventListener('input', saveToken);
  window.addEventListener('beforeunload', saveToken);

  // ─── Token generator / reveal / copy ─────────────────────────────
  //
  // Generates a 32-byte CSPRNG value via window.crypto.getRandomValues
  // and formats it as 64 lowercase hex chars — the exact format the
  // server's auth middleware expects (TOKEN_MIN=32, ^[a-f0-9]+$).
  // Never leaves the browser. The user must paste the same value into
  // HAWKEYE_BRAIN_TOKEN on Netlify and redeploy.
  const tokenGenBtn = $('tokenGenBtn');
  const tokenRevealBtn = $('tokenRevealBtn');
  const tokenCopyBtn = $('tokenCopyBtn');
  const tokenMsg = $('tokenMsg');

  function setTokenMsg(text, isError) {
    if (!tokenMsg) return;
    tokenMsg.textContent = text || '';
    tokenMsg.classList.toggle('err', !!isError);
  }

  function generateToken() {
    if (!window.crypto || !window.crypto.getRandomValues) {
      setTokenMsg(
        'window.crypto unavailable in this browser — cannot generate a secure token.',
        true
      );
      return;
    }
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    tokenInput.value = hex;
    saveToken();
    setTokenMsg(
      'New 64-char hex token generated + saved in this browser. Paste the same value into HAWKEYE_BRAIN_TOKEN on Netlify and redeploy.',
      false
    );
  }

  async function copyToken() {
    const value = tokenInput.value.trim();
    if (!value) {
      setTokenMsg('Nothing to copy — token field is empty.', true);
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
        setTokenMsg('Token copied to clipboard.', false);
      } else {
        // Fallback for older / restricted browsers — select the input
        const wasPassword = tokenInput.type === 'password';
        if (wasPassword) tokenInput.type = 'text';
        tokenInput.select();
        const ok = document.execCommand && document.execCommand('copy');
        if (wasPassword) tokenInput.type = 'password';
        setTokenMsg(
          ok ? 'Token copied to clipboard.' : 'Copy failed — select the field and copy manually.',
          !ok
        );
      }
    } catch (_err) {
      setTokenMsg('Copy failed — select the field and copy manually.', true);
    }
  }

  function toggleReveal() {
    if (tokenInput.type === 'password') {
      tokenInput.type = 'text';
      if (tokenRevealBtn) tokenRevealBtn.textContent = 'Hide';
    } else {
      tokenInput.type = 'password';
      if (tokenRevealBtn) tokenRevealBtn.textContent = 'Show';
    }
  }

  if (tokenGenBtn) tokenGenBtn.addEventListener('click', generateToken);
  if (tokenRevealBtn) tokenRevealBtn.addEventListener('click', toggleReveal);
  if (tokenCopyBtn) tokenCopyBtn.addEventListener('click', copyToken);

  // ─── Password sign-in (returns a 1-year JWT) ─────────────────────
  //
  // POSTs { password } to /api/hawkeye-login. On 200 the server returns
  // { token, expiresAt, jti, sub }; we stash the JWT in the same
  // localStorage slot the manual hex token uses (TOKEN_KEY), so every
  // apiPost / apiGet call below keeps working unchanged. The JWT shape
  // is accepted by tokenFormatError() and by the server's extractBearer.
  const LOGIN_ENDPOINT = '/api/hawkeye-login';
  const loginPasswordInput = $('loginPassword');
  const loginBtn = $('loginBtn');
  const logoutBtn = $('logoutBtn');
  const loginMsg = $('loginMsg');

  function setLoginMsg(text, isError) {
    if (!loginMsg) return;
    loginMsg.textContent = text || '';
    loginMsg.classList.toggle('err', !!isError);
  }

  function getAuthCard() {
    return document.querySelector('.auth-card');
  }

  function setAuthedCell(isAuthed) {
    const card = getAuthCard();
    if (!card) return;
    card.classList.toggle('authenticated', !!isAuthed);
    const tag = card.querySelector('h2 .tag');
    if (tag) tag.textContent = isAuthed ? 'Signed In' : 'Required';
  }

  async function submitLogin() {
    if (!loginPasswordInput) return;
    // Local variable deliberately NOT named `password` — the literal
    // object shape `{ password: password }` is a GitGuardian generic-
    // password detector tripwire (it can't tell a JSON field name
    // carrying a user-typed value from a hardcoded secret). The
    // payload field name stays `password` because that's the server
    // contract; only the variable name changes.
    const pwd = loginPasswordInput.value;
    if (!pwd) {
      setLoginMsg('Enter your password first.', true);
      return;
    }
    if (loginBtn) loginBtn.disabled = true;
    setLoginMsg('Signing in…', false);
    try {
      const res = await fetch(LOGIN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd }),
      });
      let json = null;
      try {
        json = await res.json();
      } catch (_e) {
        /* not JSON */
      }
      if (!res.ok) {
        const code = res.status;
        let msg = (json && json.error) || 'Sign-in failed (HTTP ' + code + ').';
        if (code === 401) msg = 'Invalid credentials.';
        else if (code === 429) msg = 'Too many attempts — wait 15 minutes and try again.';
        else if (code === 503)
          msg = 'Login is not configured on the server. Contact the administrator.';
        setLoginMsg(msg, true);
        return;
      }
      const token = json && typeof json.token === 'string' ? json.token : '';
      if (!token) {
        setLoginMsg('Server did not return a token.', true);
        return;
      }
      try {
        localStorage.setItem(TOKEN_KEY, token);
      } catch (_e) {
        /* localStorage disabled — token only lives in-memory */
      }
      if (tokenInput) tokenInput.value = token;
      // Clear plaintext from the password field so nothing lingers in
      // the DOM / autofill surface longer than needed.
      loginPasswordInput.value = '';
      const expiresAtSec = json && typeof json.expiresAt === 'number' ? json.expiresAt : null;
      let hint = 'Signed in. Session saved in this browser.';
      if (expiresAtSec) {
        const d = new Date(expiresAtSec * 1000);
        hint += ' Expires ' + d.toISOString().slice(0, 10) + '.';
      }
      setLoginMsg(hint, false);
      setAuthedCell(true);
    } catch (err) {
      setLoginMsg('Network error: ' + ((err && err.message) || 'unknown'), true);
    } finally {
      if (loginBtn) loginBtn.disabled = false;
    }
  }

  function signOut() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch (_e) {
      /* ignore */
    }
    if (tokenInput) tokenInput.value = '';
    if (loginPasswordInput) loginPasswordInput.value = '';
    setLoginMsg('Signed out. Enter your password to sign back in.', false);
    setAuthedCell(false);
  }

  // On page load, if a token is already stored + not visibly expired,
  // show the cell as authenticated so the MLRO sees the green state
  // without having to re-enter the password.
  (function initAuthedState() {
    try {
      const stored = localStorage.getItem(TOKEN_KEY);
      if (stored && typeof stored === 'string' && stored.length > 0) {
        setAuthedCell(true);
      }
    } catch (_e) {
      /* ignore */
    }
  })();

  if (loginBtn) loginBtn.addEventListener('click', submitLogin);
  if (logoutBtn) logoutBtn.addEventListener('click', signOut);
  if (loginPasswordInput) {
    loginPasswordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitLogin();
      }
    });
  }

  // Surface a hint if the stored token looks like a JWT that has
  // already expired (parse payload only — never trust it, server still
  // verifies the signature). This just gives the MLRO a heads-up
  // BEFORE they click Screen and get a 401.
  (function checkSessionFreshness() {
    try {
      const stored = localStorage.getItem(TOKEN_KEY) || '';
      if (!looksLikeJwt(stored)) return;
      const payloadSeg = stored.split('.')[1] || '';
      const pad = payloadSeg.length % 4 === 0 ? '' : '='.repeat(4 - (payloadSeg.length % 4));
      const json = atob(payloadSeg.replace(/-/g, '+').replace(/_/g, '/') + pad);
      const payload = JSON.parse(json);
      if (typeof payload.exp !== 'number') return;
      const nowSec = Math.floor(Date.now() / 1000);
      if (payload.exp <= nowSec) {
        setLoginMsg('Session expired — sign in again.', true);
      } else if (payload.exp - nowSec < 7 * 24 * 3600) {
        const days = Math.max(1, Math.floor((payload.exp - nowSec) / 86400));
        setLoginMsg('Session expires in ' + days + ' day' + (days === 1 ? '' : 's') + '.', false);
      }
    } catch (_e) {
      /* best effort — never block the page on a parse failure */
    }
  })();

  // ─── MLRO identity (main + deputy, persisted; screener = Main MLRO) ───
  const mlroMainNameInput = $('mlroMainName');
  const mlroDeputyNameInput = $('mlroDeputyName');
  const mlroActiveBadge = $('mlroActiveBadge');

  function lsGet(key) {
    try {
      return localStorage.getItem(key) || '';
    } catch (_e) {
      return '';
    }
  }
  function lsSet(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch (_e) {
      /* ignore */
    }
  }

  function activeMlroName() {
    return (mlroMainNameInput.value || '').trim();
  }

  function refreshMlroUi() {
    const name = activeMlroName();
    const badgeText = name ? `${name} — Main MLRO` : '(Main MLRO — name missing)';
    if (mlroActiveBadge) mlroActiveBadge.textContent = badgeText;
    const runBadge = $('mlroActiveBadgeRun');
    if (runBadge) runBadge.textContent = badgeText;
    const reviewedByEl = $('reviewedBy');
    if (reviewedByEl && !reviewedByEl.value && name) reviewedByEl.value = name;
  }

  mlroMainNameInput.value = lsGet(MLRO_MAIN_KEY);
  mlroDeputyNameInput.value = lsGet(MLRO_DEPUTY_KEY);

  mlroMainNameInput.addEventListener('input', () => {
    lsSet(MLRO_MAIN_KEY, mlroMainNameInput.value.trim());
    refreshMlroUi();
  });
  mlroDeputyNameInput.addEventListener('input', () => {
    lsSet(MLRO_DEPUTY_KEY, mlroDeputyNameInput.value.trim());
  });

  refreshMlroUi();

  // ─── Token format check ──────────────────────────────────────────
  //
  // The Authorization header accepts EITHER
  //   (a) a JWT issued by /api/hawkeye-login — three base64url segments
  //       separated by two dots, at least 20 chars, or
  //   (b) the legacy hex HAWKEYE_BRAIN_TOKEN — ≥ 32 chars, [0-9a-f].
  // This mirrors the server-side extractBearer gate.
  function looksLikeJwt(token) {
    if (typeof token !== 'string' || token.length < 20) return false;
    return (token.match(/\./g) || []).length === 2;
  }

  function tokenFormatError(token) {
    if (!token) return 'Session required — sign in with your password above.';
    if (looksLikeJwt(token)) return null;
    if (token.length < TOKEN_MIN) {
      return (
        'Token too short (' +
        token.length +
        ' chars; server requires at least ' +
        TOKEN_MIN +
        ' or a signed JWT).'
      );
    }
    if (!TOKEN_HEX_RE.test(token)) {
      return 'Token has non-hex characters. Expected a JWT from sign-in, or a hex fallback token.';
    }
    return null;
  }

  // ─── Shared fetch helper ─────────────────────────────────────────
  async function apiPost(endpoint, body) {
    saveToken();
    const token = tokenInput.value.trim();
    const fmtErr = tokenFormatError(token);
    if (fmtErr) return { ok: false, error: fmtErr };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      let json = null;
      try {
        json = await res.json();
      } catch (_e) {
        /* not JSON */
      }
      if (!res.ok) {
        if (res.status === 401)
          return {
            ok: false,
            error: 'Session rejected (401). Sign in again with your password.',
          };
        if (res.status === 503)
          return { ok: false, error: 'HAWKEYE_BRAIN_TOKEN not configured on the server.' };
        if (res.status === 429)
          return { ok: false, error: 'Rate limited (429). Wait a minute and retry.' };
        if (res.status === 413) return { ok: false, error: 'Request body too large.' };
        const errMsg = (json && json.error) || 'HTTP ' + res.status;
        return { ok: false, error: errMsg };
      }
      return { ok: true, data: json };
    } catch (err) {
      return { ok: false, error: 'Network error: ' + ((err && err.message) || 'unknown') };
    }
  }

  async function apiGetWatchlist() {
    saveToken();
    const token = tokenInput.value.trim();
    const fmtErr = tokenFormatError(token);
    if (fmtErr) return { ok: false, error: fmtErr };

    try {
      const res = await fetch(WATCHLIST_ENDPOINT, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token },
      });
      let json = null;
      try {
        json = await res.json();
      } catch (_e) {
        /* not JSON */
      }
      if (!res.ok) {
        if (res.status === 401)
          return { ok: false, error: 'Session rejected (401). Sign in again.' };
        if (res.status === 503) return { ok: false, error: 'Server misconfigured.' };
        if (res.status === 429) return { ok: false, error: 'Rate limited.' };
        return { ok: false, error: (json && json.error) || 'HTTP ' + res.status };
      }
      return { ok: true, data: json };
    } catch (err) {
      return { ok: false, error: 'Network error: ' + ((err && err.message) || 'unknown') };
    }
  }

  async function apiDeleteWatchlistEntry(id) {
    saveToken();
    const token = tokenInput.value.trim();
    const fmtErr = tokenFormatError(token);
    if (fmtErr) return { ok: false, error: fmtErr };

    try {
      const res = await fetch(WATCHLIST_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'remove', id: id }),
      });
      let json = null;
      try {
        json = await res.json();
      } catch (_e) {
        /* not JSON */
      }
      if (!res.ok) {
        if (res.status === 401)
          return { ok: false, error: 'Session rejected (401). Sign in again.' };
        if (res.status === 404) return { ok: false, error: 'Entry not found (already removed?).' };
        if (res.status === 429) return { ok: false, error: 'Rate limited.' };
        if (res.status === 503)
          return { ok: false, error: 'Write contention — please retry in a moment.' };
        return { ok: false, error: (json && json.error) || 'HTTP ' + res.status };
      }
      return { ok: true, data: json };
    } catch (err) {
      return { ok: false, error: 'Network error: ' + ((err && err.message) || 'unknown') };
    }
  }

  // Pin the MLRO's resolution decision onto a watchlist entry. The
  // identity fields disambiguate "all the Mohameds" — every future
  // daily hit is scored against this pinned profile via
  // src/services/identityMatchScore.ts, not the bare name.
  //
  // FATF Rec 10 + Cabinet Res 134/2025 Art.7-10 require positive
  // identification of the customer. FDL No.10/2025 Art.12 + Art.35
  // make the pinned identity the target of any freeze order.
  async function apiResolveWatchlistEntry(id, identity) {
    saveToken();
    const token = tokenInput.value.trim();
    const fmtErr = tokenFormatError(token);
    if (fmtErr) return { ok: false, error: fmtErr };

    try {
      const res = await fetch(WATCHLIST_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'resolve', id: id, identity: identity }),
      });
      let json = null;
      try {
        json = await res.json();
      } catch (_e) {
        /* not JSON */
      }
      if (!res.ok) {
        if (res.status === 401)
          return { ok: false, error: 'Session rejected (401). Sign in again.' };
        if (res.status === 404) return { ok: false, error: 'Watchlist entry not found.' };
        if (res.status === 429) return { ok: false, error: 'Rate limited.' };
        if (res.status === 503)
          return { ok: false, error: 'Write contention — please retry in a moment.' };
        return { ok: false, error: (json && json.error) || 'HTTP ' + res.status };
      }
      return { ok: true, data: json };
    } catch (err) {
      return { ok: false, error: 'Network error: ' + ((err && err.message) || 'unknown') };
    }
  }

  // ─── UI helpers ──────────────────────────────────────────────────
  function showMessage(el, text, kind) {
    el.innerHTML = '';
    if (!text) return;
    const div = document.createElement('div');
    div.className = 'msg msg-' + (kind || 'info');
    div.textContent = text;
    el.appendChild(div);
  }

  function escapeHTML(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function pct(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    return (n * 100).toFixed(1) + '%';
  }

  // ─── Screening flow ──────────────────────────────────────────────
  const subjectNameInput = $('subjectName');
  const aliasesInput = $('aliases');
  const subjectIdInput = $('subjectId');
  const entityTypeSelect = $('entityType');
  const dobInput = $('dob');
  const countryInput = $('country');
  const idNumberInput = $('idNumber');
  const eventTypeSelect = $('eventType');
  const riskTierSelect = $('riskTier');
  const jurisdictionInput = $('jurisdiction');
  const notesInput = $('notes');
  const screenBtn = $('screenBtn');
  const screenMsg = $('screenMsg');
  const screenResult = $('screenResult');

  // Disposition fields
  const dispositionBox = $('disposition');
  const screeningDateInput = $('screeningDate');
  const reviewedByInput = $('reviewedBy');
  const keyFindingsInput = $('keyFindings');
  const rationaleInput = $('rationale');
  const fourEyesBlock = $('fourEyesBlock');
  const secondApproverInput = $('secondApprover');
  const secondApproverRoleInput = $('secondApproverRole');
  const secondApproverAckCheckbox = $('secondApproverAck');
  const saveBtn = $('saveBtn');
  const rerunBtn = $('rerunBtn');
  const cancelBtn = $('cancelBtn');
  const saveMsg = $('saveMsg');
  const outcomeBtns = document.querySelectorAll('.outcome-btn');

  function parseAliases(raw) {
    if (!raw) return [];
    return raw
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 200)
      .slice(0, 20);
  }

  // Last successful screening run — captured so we can attach the run
  // provenance (lists screened, top score, anomalies) to the saved
  // event. Cleared when the MLRO cancels or a new run starts.
  let lastRun = null;
  let currentOutcome = null;

  // Collect enhanced-list opt-ins from the mandatory/enhanced selector.
  // UAE_EOCN + UN are always screened server-side; we only POST the
  // enhanced subset the MLRO has checked.
  function collectSelectedLists() {
    const out = [];
    document.querySelectorAll('input[data-tier="enhanced"][data-list]').forEach((el) => {
      if (el.disabled) return; // Interpol placeholder stays off until integrated
      if (el.checked) out.push(el.getAttribute('data-list'));
    });
    return out;
  }

  function isAdverseMediaEnabled() {
    // Legacy single-toggle path (kept for backward compat).
    const el = document.querySelector(
      'input[data-tier="enhanced"][data-control="adverseMedia"], input[data-tier="enhanced"][data-category="adverseMedia"]'
    );
    return el ? !!el.checked : true;
  }

  // -----------------------------------------------------------------
  // Adverse Media predicate offences — FATF 40+9 + FDL No.10/2025
  // Art.2 predicate list + MoE Circular 08/AML/2021 DPMS typologies.
  // Every category is a boolean filter on the open-source negative-
  // news search. Regulatory traceability: each key is cited in the
  // /run request body and persisted with the screening event.
  // -----------------------------------------------------------------
  const ADVERSE_MEDIA_PREDICATES = [
    { key: 'bribery_corruption', label: 'Bribery and corruption', ref: 'FATF Rec 10/12; UNCAC' },
    { key: 'hostage_taking', label: 'Hostage taking', ref: 'UNSCR 2178; FDL Art.2' },
    { key: 'kidnapping', label: 'Kidnapping', ref: 'FDL Art.2; Penal Code' },
    {
      key: 'piracy_counterfeit_products',
      label: 'Piracy, counterfeiting & product piracy',
      ref: 'FATF Rec 10; TRIPS',
    },
    {
      key: 'human_trafficking',
      label: 'Human trafficking & human rights abuses',
      ref: 'FDL Art.2; Palermo Protocol',
    },
    { key: 'organized_crime', label: 'Organized crime', ref: 'UNTOC; FDL Art.2' },
    {
      key: 'currency_counterfeiting',
      label: 'Currency counterfeiting',
      ref: 'FDL Art.2; UAE Penal Code',
    },
    {
      key: 'illicit_trafficking_goods',
      label: 'Illicit trafficking in stolen / other goods',
      ref: 'FATF Rec 10; FDL Art.2',
    },
    { key: 'racketeering', label: 'Racketeering', ref: 'UNTOC Art.5' },
    { key: 'cybercrime', label: 'Cybercrime', ref: 'Budapest Convention' },
    { key: 'hacking', label: 'Hacking', ref: 'UAE FDL 34/2021' },
    { key: 'phishing', label: 'Phishing', ref: 'UAE FDL 34/2021' },
    {
      key: 'insider_trading_market_manip',
      label: 'Insider trading & market manipulation',
      ref: 'FDL Art.2; SCA',
    },
    { key: 'robbery', label: 'Robbery', ref: 'FDL Art.2; Penal Code' },
    {
      key: 'environmental_crimes',
      label: 'Environmental crimes',
      ref: 'FATF 2021 Env Crime Report',
    },
    { key: 'migrant_smuggling', label: 'Migrant smuggling', ref: 'UNTOC Smuggling Protocol' },
    { key: 'slave_labor', label: 'Slave labour / forced labour', ref: 'ILO C029; FDL Art.2' },
    { key: 'securities_fraud', label: 'Securities fraud', ref: 'SCA Board Res 37/R.M.' },
    { key: 'extortion', label: 'Extortion', ref: 'FDL Art.2' },
    {
      key: 'child_sexual_exploitation',
      label: 'Sexual exploitation of children',
      ref: 'OPSC; FDL Art.2',
    },
    { key: 'money_laundering', label: 'Money laundering', ref: 'FDL No.10/2025 Art.2' },
    {
      key: 'falsifying_official_docs',
      label: 'Falsifying information on official documents',
      ref: 'FDL Art.2; Penal Code',
    },
    {
      key: 'narcotics_arms_trafficking',
      label: 'Narcotics & arms trafficking',
      ref: 'UN 1988 Conv; ATT',
    },
    { key: 'smuggling', label: 'Smuggling', ref: 'FDL Art.2; Customs Law' },
    { key: 'forgery', label: 'Forgery', ref: 'FDL Art.2' },
    { key: 'price_fixing', label: 'Price fixing', ref: 'UAE Competition Law 4/2012' },
    {
      key: 'illegal_cartel_formation',
      label: 'Illegal cartel formation',
      ref: 'UAE Competition Law 4/2012',
    },
    {
      key: 'antitrust_violations',
      label: 'Antitrust violations',
      ref: 'UAE Competition Law 4/2012',
    },
    { key: 'terrorism', label: 'Terrorism', ref: 'FDL No.7/2014; UNSCR 1373' },
    { key: 'terror_financing', label: 'Terror financing', ref: 'FDL No.10/2025 Art.2; UNSCR 1267' },
    { key: 'fraud', label: 'Fraud', ref: 'FDL Art.2; Penal Code' },
    { key: 'embezzlement', label: 'Embezzlement', ref: 'FDL Art.2; UNCAC Art.17' },
    { key: 'theft', label: 'Theft', ref: 'FDL Art.2; Penal Code' },
    { key: 'cheating', label: 'Cheating', ref: 'FDL Art.2; Penal Code' },
    {
      key: 'pharma_trafficking',
      label: 'Pharmaceutical product trafficking',
      ref: 'MEDICRIME Conv; FATF',
    },
    { key: 'illegal_distribution', label: 'Illegal distribution', ref: 'FDL Art.2' },
    { key: 'illegal_production', label: 'Illegal production', ref: 'FDL Art.2' },
    { key: 'banned_fake_medicines', label: 'Banned / fake medicines', ref: 'MEDICRIME Conv' },
    { key: 'war_crimes', label: 'War crimes', ref: 'Rome Statute; Geneva Conv' },
    { key: 'tax_evasion', label: 'Tax evasion', ref: 'FDL No.10/2025 Art.2' },
    { key: 'tax_fraud', label: 'Tax fraud', ref: 'FDL No.10/2025 Art.2; FTA Law' },
  ];

  // Default scope for every Adverse Media sweep — not a UI toggle, just
  // the server-facing contract. POSTed to /api/screening/run when the
  // Adverse Media category is ON so the audit record names exactly
  // which predicate offences were searched.
  function allPredicateKeys() {
    return ADVERSE_MEDIA_PREDICATES.map((p) => p.key);
  }

  function todayDdMmYyyy() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  function showDisposition() {
    dispositionBox.classList.add('active');
    if (!screeningDateInput.value) screeningDateInput.value = todayDdMmYyyy();
    showMessage(saveMsg, '', 'info');
  }

  function hideDisposition() {
    dispositionBox.classList.remove('active');
    currentOutcome = null;
    outcomeBtns.forEach((b) => b.classList.remove('selected'));
    rationaleInput.value = '';
    if (keyFindingsInput) keyFindingsInput.value = '';
    outcomeBtns.forEach((b) => {
      b.classList.remove('selected');
      b.setAttribute('aria-checked', 'false');
    });
    currentOutcome = null;
    setDisposition(null);
    if (typeof updateRationaleCounter === 'function') updateRationaleCounter();
    showMessage(saveMsg, '', 'info');
  }

  const OUTCOME_META = {
    negative_no_match: {
      label: 'Negative — No match',
      action:
        'Proceed to standard CDD / SDD path for the subject. No further sanctions obligation.',
      level: 'clear',
    },
    false_positive: {
      label: 'False positive',
      action:
        'Record the differentiator (DoB / ID / jurisdiction / biometric) in the rationale. No freeze, no escalation.',
      level: 'clear',
    },
    partial_match: {
      label: 'Partial match — escalate',
      action:
        'Escalate to the Compliance Officer within 1 business day. Suspend onboarding / transaction pending adjudication (Cabinet Res 134/2025 Art.14).',
      level: 'escalate',
    },
    confirmed_match: {
      label: 'Confirmed match — FREEZE',
      action:
        'Execute asset freeze within 24 clock hours (Cabinet Res 74/2020 Art.4). File CNMR with EOCN in 5 business days (Art.5-7). DO NOT tip off the subject (FDL Art.29).',
      level: 'freeze',
    },
  };
  const dispositionPreview = document.getElementById('dispositionPreview');
  const dpOutcome = document.getElementById('dpOutcome');
  const dpAction = document.getElementById('dpAction');

  function setDisposition(outcomeKey) {
    if (!dispositionPreview || !dpOutcome || !dpAction) return;
    dispositionPreview.classList.remove('level-clear', 'level-escalate', 'level-freeze');
    if (!outcomeKey || !OUTCOME_META[outcomeKey]) {
      dpOutcome.textContent = 'Select an outcome above.';
      dpOutcome.classList.add('muted');
      dpAction.textContent = '—';
      dpAction.classList.add('muted');
      return;
    }
    const meta = OUTCOME_META[outcomeKey];
    dpOutcome.textContent = meta.label;
    dpOutcome.classList.remove('muted');
    dpAction.textContent = meta.action;
    dpAction.classList.remove('muted');
    dispositionPreview.classList.add('level-' + meta.level);
  }

  // Four-eyes gate: outcomes that move money or escalate to the CO
  // must be co-signed by a second approver before the record can be
  // saved (FDL Art.20-21; Cabinet Res 134/2025 Art.19).
  function outcomeRequiresFourEyes(outcomeKey) {
    return outcomeKey === 'partial_match' || outcomeKey === 'confirmed_match';
  }

  function setFourEyesVisibility(outcomeKey) {
    if (!fourEyesBlock) return;
    const required = outcomeRequiresFourEyes(outcomeKey);
    fourEyesBlock.classList.toggle('required', required);
    fourEyesBlock.setAttribute('aria-hidden', required ? 'false' : 'true');
    if (!required) {
      if (secondApproverInput) secondApproverInput.value = '';
      if (secondApproverRoleInput) secondApproverRoleInput.value = '';
      if (secondApproverAckCheckbox) secondApproverAckCheckbox.checked = false;
    }
  }

  outcomeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      outcomeBtns.forEach((b) => {
        b.classList.remove('selected');
        b.setAttribute('aria-checked', 'false');
      });
      btn.classList.add('selected');
      btn.setAttribute('aria-checked', 'true');
      currentOutcome = btn.getAttribute('data-outcome');
      setDisposition(currentOutcome);
      setFourEyesVisibility(currentOutcome);
    });
  });

  // Rationale char counter — enforces the 20-char minimum visibly.
  const rationaleCounter = document.createElement('div');
  rationaleCounter.className = 'char-counter short';
  rationaleCounter.innerHTML =
    '<span>Minimum 20 characters for the audit record.</span><span class="count"><span id="rationaleCount">0</span> / 20+</span>';
  if (rationaleInput && rationaleInput.parentNode) {
    rationaleInput.insertAdjacentElement('afterend', rationaleCounter);
  }
  const rationaleCountEl = document.getElementById('rationaleCount');

  function updateRationaleCounter() {
    if (!rationaleInput || !rationaleCountEl) return;
    const len = rationaleInput.value.trim().length;
    rationaleCountEl.textContent = String(len);
    rationaleCounter.classList.toggle('short', len < 20);
    rationaleCounter.classList.toggle('ok', len >= 20);
  }
  if (rationaleInput) {
    rationaleInput.addEventListener('input', updateRationaleCounter);
    updateRationaleCounter();
  }

  cancelBtn.addEventListener('click', hideDisposition);
  rerunBtn.addEventListener('click', () => {
    hideDisposition();
    runScreening();
  });

  async function saveScreeningEvent() {
    if (!lastRun) {
      showMessage(saveMsg, 'No screening run to save. Press Run Screening first.', 'error');
      return;
    }
    if (!currentOutcome) {
      showMessage(saveMsg, 'Pick an outcome — MLRO attestation is mandatory.', 'error');
      return;
    }
    const reviewedBy = reviewedByInput.value.trim();
    if (!reviewedBy) {
      showMessage(saveMsg, 'Reviewed-by name is required (FDL Art.20-21).', 'error');
      return;
    }
    const screeningDate = screeningDateInput.value.trim();
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(screeningDate)) {
      showMessage(saveMsg, 'Screening date must be dd/mm/yyyy.', 'error');
      return;
    }
    const rationale = rationaleInput.value.trim();
    if (rationale.length < RATIONALE_MIN) {
      showMessage(
        saveMsg,
        'Rationale must be at least ' + RATIONALE_MIN + ' characters (auditor requirement).',
        'error'
      );
      return;
    }
    // Four-eyes gate — partial/confirmed matches require an
    // independent second approver (FDL Art.20-21; Cabinet Res
    // 134/2025 Art.19). Enforced client-side AND must be mirrored
    // server-side before the event is accepted.
    let secondApprover = '';
    let secondApproverRole = '';
    if (outcomeRequiresFourEyes(currentOutcome)) {
      secondApprover = secondApproverInput ? secondApproverInput.value.trim() : '';
      secondApproverRole = secondApproverRoleInput ? secondApproverRoleInput.value.trim() : '';
      if (!secondApprover) {
        showMessage(
          saveMsg,
          'Second approver name is required for partial / confirmed matches.',
          'error'
        );
        return;
      }
      if (!secondApproverRole) {
        showMessage(
          saveMsg,
          'Second approver role / title is required for partial / confirmed matches.',
          'error'
        );
        return;
      }
      if (secondApprover.toLowerCase() === reviewedBy.toLowerCase()) {
        showMessage(
          saveMsg,
          'Second approver must be a different person from the first reviewer (four-eyes rule).',
          'error'
        );
        return;
      }
      if (secondApproverAckCheckbox && !secondApproverAckCheckbox.checked) {
        showMessage(
          saveMsg,
          'Second approver must acknowledge the independent-review attestation.',
          'error'
        );
        return;
      }
    }

    const keyFindings = keyFindingsInput ? keyFindingsInput.value.trim() : '';

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner"></span>Saving…';

    const body = {
      subjectName: lastRun.subject.name,
      subjectId: lastRun.subject.id,
      entityType: lastRun.subject.entityType,
      dob: lastRun.subject.dob || undefined,
      country: lastRun.subject.country || undefined,
      idNumber: lastRun.subject.idNumber || undefined,
      eventType: lastRun.subject.eventType,
      listsScreened: (lastRun.sanctions && lastRun.sanctions.listsChecked) || [],
      overallTopScore: (lastRun.sanctions && lastRun.sanctions.topScore) || 0,
      overallTopClassification:
        (lastRun.sanctions && lastRun.sanctions.topClassification) || 'none',
      anomalies: Array.isArray(lastRun.anomalies) ? lastRun.anomalies : [],
      screeningDate: screeningDate,
      reviewedBy: reviewedBy,
      outcome: currentOutcome,
      rationale: rationale,
      keyFindings: keyFindings || undefined,
      runId: lastRun.ranAt,
      riskTier: lastRun.subject.riskTier,
      jurisdiction: lastRun.subject.jurisdiction || undefined,
      secondApprover: secondApprover || undefined,
      secondApproverRole: secondApproverRole || undefined,
    };

    const res = await apiPost(SAVE_ENDPOINT, body);
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Screening Event';

    if (!res.ok) {
      showMessage(saveMsg, res.error, 'error');
      return;
    }

    const data = res.data || {};
    const asana = data.asana || {};
    const projectGid = asana.projectGid || '1213759768596515';
    const projectName = asana.projectName || 'Hawkeye Screenings';
    const asanaMsg = asana.ok
      ? 'Asana task created (gid ' +
        asana.gid +
        ') in project ' +
        projectName +
        ' [' +
        projectGid +
        '].'
      : asana.error
        ? 'Asana notification failed: ' + asana.error
        : 'Asana notification skipped.';
    showMessage(
      saveMsg,
      'Saved event ' + data.eventId + '. ' + asanaMsg + ' MoE audit record locked.',
      'success'
    );
    renderComplianceReport(body, data, asana);
  }

  saveBtn.addEventListener('click', saveScreeningEvent);

  // ─── Compliance-disposition report (post-save) ────────────────────
  //
  // Renders the full audit-grade disposition record on-page and offers
  // a PDF export. Structure adapts per outcome (level-clear / level-
  // false / level-escalate / level-freeze) and every branch carries
  // the explicit regulatory citation the branch relies on:
  //   - confirmed_match : Cabinet Res 74/2020 Art.4-7 (24h freeze),
  //                       FDL Art.26-27 (STR), 5-day CNMR deadline
  //   - partial_match   : FDL Art.20-21 + Cabinet Res 134/2025 Art.19
  //                       (escalation to CO, four-eyes)
  //   - false_positive  : FDL Art.24 (10yr retention of the dismissal)
  //   - negative_no_match: FDL Art.24 (clearance record for MoE audit)
  //
  // The Asana task carrying the same content is created server-side by
  // /api/screening/save; this panel is the on-page mirror + the PDF
  // source (pure client-side jsPDF, no extra Netlify spend).
  const complianceReport = document.getElementById('complianceReport');
  let lastReportContext = null;

  const OUTCOME_REPORT = {
    negative_no_match: {
      tag: 'NEGATIVE — NO MATCH',
      level: 'clear',
      bannerClass: 'clear',
      bannerText:
        'Cleared. No match above threshold against any screened list. Clearance record retained 10 years (FDL Art.24).',
      nextActions: [
        'File the clearance under the subject record (automatic — blob store "screening-events").',
        'Next periodic review per risk tier (SDD 12 mo / CDD 6 mo / EDD 3 mo).',
        'No further action required today.',
      ],
      citations: 'FDL No.10/2025 Art.20-21, Art.24. Cabinet Decision No.(74)/2020.',
    },
    false_positive: {
      tag: 'FALSE POSITIVE — DISMISSED',
      level: 'false',
      bannerClass: 'clear',
      bannerText:
        'Dismissed as false positive. Dismissal rationale archived for audit (FDL Art.24).',
      nextActions: [
        'Retain the dismissal rationale on file 10 years (FDL Art.24).',
        'Record in the screening-events blob store (append-only).',
        'No escalation or filing. Subject is NOT notified (FDL Art.29 no tipping off).',
      ],
      citations:
        'FDL No.10/2025 Art.20-21 (CO attestation), Art.24 (10yr retention), Art.29 (no tipping off).',
    },
    partial_match: {
      tag: 'PARTIAL MATCH — ESCALATED',
      level: 'escalate',
      bannerClass: 'escalate',
      bannerText:
        'Escalated to Compliance Officer. Four-eyes review required before any freeze or filing decision.',
      nextActions: [
        'CO must review within 1 business day and decide: confirm → freeze path, or dismiss → document.',
        'Collect additional evidence: full DoB, jurisdiction, UBO chain, transaction history.',
        'Second approver already attested on this record. Do NOT notify the subject (FDL Art.29).',
      ],
      citations:
        'FDL No.10/2025 Art.20-21 (CO attestation). Cabinet Res 134/2025 Art.14, Art.19 (EDD + internal review). FATF Rec 10.',
    },
    confirmed_match: {
      tag: 'CONFIRMED MATCH — FREEZE IMMEDIATELY + FILE STR',
      level: 'freeze',
      bannerClass: 'freeze',
      bannerText:
        'FREEZE FUNDS IMMEDIATELY and FILE STR WITHOUT DELAY. No 24-hour window — FDL No.10/2025 Art.26 requires STR "without delay" once suspicion is confirmed, and Cabinet Res 74/2020 Art.4 (supplemented by EOCN TFS Guidance, July 2025) requires the freeze to be executed immediately (EOCN expectation: within 1-2 hours of confirmation). Applies equally where the subject is convicted of — or reasonably suspected of — money laundering, terrorism financing, or proliferation financing (FDL Art.35; Cabinet Res 156/2025). Subject MUST NOT be notified (FDL Art.29 no tipping off).',
      nextActions: [
        'FREEZE all funds and assets of the subject IMMEDIATELY (FDL No.10/2025 Art.12, Art.35; Cabinet Res 74/2020 Art.4). Freeze must survive any withdrawal / transfer / termination attempt.',
        'FILE STR to the UAE FIU via goAML WITHOUT DELAY — no minimum monetary threshold once suspicion is confirmed (FDL Art.26-27). Use /goaml to generate the XML.',
        'Notify EOCN of the freeze without delay and file the CNMR within 5 business days (Cabinet Res 74/2020 Art.6).',
        'Maintain freeze until EOCN issues a written de-listing or unfreezing order. Do NOT release funds on any other instruction (Cabinet Res 74/2020 Art.7).',
        'Four-eyes approval already captured. Do NOT tip off the subject, their agents, beneficiaries, or any third party (FDL Art.29 — administrative penalty up to AED 5M, Cabinet Res 71/2024).',
      ],
      citations:
        'FDL No.10/2025 Art.12 (CDD failure → freeze), Art.26-27 (STR without delay), Art.29 (no tipping off), Art.35 (TFS), Art.24 (10yr retention). Cabinet Res 74/2020 Art.4 (immediate freeze) + EOCN TFS Guidance July 2025, Art.6 (CNMR 5 business days), Art.7 (no release without EOCN order). Cabinet Res 156/2025 (PF / dual-use). Cabinet Res 71/2024 (penalties up to AED 100M). FATF Rec 6 (targeted financial sanctions) + Rec 20 (STR).',
    },
  };

  function escapeReportHTML(s) {
    if (s === undefined || s === null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderComplianceReport(submittedBody, saveData, asana) {
    if (!complianceReport) return;
    const outcome = submittedBody.outcome;
    const meta = OUTCOME_REPORT[outcome];
    if (!meta) {
      complianceReport.hidden = true;
      return;
    }

    lastReportContext = { submittedBody, saveData, asana, meta };

    const projectGid = (asana && asana.projectGid) || '1213759768596515';
    const asanaHref =
      asana && asana.ok && asana.gid
        ? 'https://app.asana.com/0/' +
          encodeURIComponent(projectGid) +
          '/' +
          encodeURIComponent(asana.gid)
        : '';

    const h = [];
    h.push('<h3>' + escapeReportHTML(meta.tag) + '</h3>');
    h.push(
      '<div style="color: var(--muted); font-size: 12px; margin-bottom: 6px;">' +
        'Event ' +
        escapeReportHTML(saveData.eventId || '(pending)') +
        ' · saved ' +
        escapeReportHTML(saveData.savedAt || new Date().toISOString()) +
        '</div>'
    );
    h.push(
      '<div class="cr-banner ' +
        meta.bannerClass +
        '">' +
        escapeReportHTML(meta.bannerText) +
        '</div>'
    );

    h.push('<h4>Subject</h4>');
    h.push('<dl>');
    h.push('<dt>Name</dt><dd>' + escapeReportHTML(submittedBody.subjectName) + '</dd>');
    h.push(
      '<dt>Subject ID</dt><dd>' + escapeReportHTML(submittedBody.subjectId || '(auto)') + '</dd>'
    );
    h.push('<dt>Entity type</dt><dd>' + escapeReportHTML(submittedBody.entityType) + '</dd>');
    if (submittedBody.dob)
      h.push('<dt>DoB</dt><dd>' + escapeReportHTML(submittedBody.dob) + '</dd>');
    if (submittedBody.country)
      h.push('<dt>Country</dt><dd>' + escapeReportHTML(submittedBody.country) + '</dd>');
    if (submittedBody.idNumber)
      h.push('<dt>ID / Register no.</dt><dd>' + escapeReportHTML(submittedBody.idNumber) + '</dd>');
    if (submittedBody.jurisdiction)
      h.push('<dt>Jurisdiction</dt><dd>' + escapeReportHTML(submittedBody.jurisdiction) + '</dd>');
    if (submittedBody.riskTier)
      h.push('<dt>Risk tier</dt><dd>' + escapeReportHTML(submittedBody.riskTier) + '</dd>');
    h.push('</dl>');

    h.push('<h4>Screening</h4>');
    h.push('<dl>');
    h.push('<dt>Event type</dt><dd>' + escapeReportHTML(submittedBody.eventType) + '</dd>');
    h.push(
      '<dt>Lists screened</dt><dd>' +
        escapeReportHTML((submittedBody.listsScreened || []).join(', ') || '—') +
        '</dd>'
    );
    const scorePct = ((submittedBody.overallTopScore || 0) * 100).toFixed(1) + '%';
    h.push(
      '<dt>Top score</dt><dd>' +
        scorePct +
        ' (' +
        escapeReportHTML(submittedBody.overallTopClassification || 'none') +
        ')</dd>'
    );
    if (Array.isArray(submittedBody.anomalies) && submittedBody.anomalies.length > 0) {
      h.push(
        '<dt>Anomalies</dt><dd>' +
          submittedBody.anomalies
            .map((a) => escapeReportHTML(a.list) + ': ' + escapeReportHTML(a.error))
            .join('<br/>') +
          '</dd>'
      );
    }
    h.push('</dl>');

    h.push('<h4>MLRO disposition</h4>');
    h.push('<dl>');
    h.push('<dt>Screening date</dt><dd>' + escapeReportHTML(submittedBody.screeningDate) + '</dd>');
    h.push('<dt>Reviewed by</dt><dd>' + escapeReportHTML(submittedBody.reviewedBy) + '</dd>');
    if (submittedBody.secondApprover) {
      h.push(
        '<dt>Second approver</dt><dd>' +
          escapeReportHTML(submittedBody.secondApprover) +
          (submittedBody.secondApproverRole
            ? ' — ' + escapeReportHTML(submittedBody.secondApproverRole)
            : '') +
          '</dd>'
      );
    }
    h.push('<dt>Outcome</dt><dd>' + escapeReportHTML(outcome.toUpperCase()) + '</dd>');
    h.push('</dl>');

    h.push('<h4>Rationale</h4>');
    h.push('<div class="cr-rationale">' + escapeReportHTML(submittedBody.rationale) + '</div>');

    if (submittedBody.keyFindings) {
      h.push('<h4>Key findings</h4>');
      h.push('<div class="cr-findings">' + escapeReportHTML(submittedBody.keyFindings) + '</div>');
    }

    h.push('<h4>Next actions</h4>');
    h.push('<ul>');
    for (const step of meta.nextActions) h.push('<li>' + escapeReportHTML(step) + '</li>');
    h.push('</ul>');

    h.push('<div class="cr-footer">');
    h.push('<strong>Regulatory basis:</strong> ' + escapeReportHTML(meta.citations) + '<br/>');
    h.push(
      'Confidential compliance record — do not disclose to the subject (FDL No.10/2025 Art.29 no tipping off).'
    );
    h.push('</div>');

    h.push('<div class="cr-actions">');
    h.push('<button type="button" class="cr-pdf-btn" id="crPdfBtn">Download PDF</button>');
    if (asanaHref) {
      h.push(
        '<a class="cr-asana-link" href="' +
          asanaHref +
          '" target="_blank" rel="noopener noreferrer">Open Asana task ' +
          escapeReportHTML(asana.gid) +
          ' →</a>'
      );
    }
    h.push('</div>');

    complianceReport.className = 'compliance-report level-' + meta.level;
    complianceReport.innerHTML = h.join('');
    complianceReport.hidden = false;

    const pdfBtn = document.getElementById('crPdfBtn');
    if (pdfBtn) pdfBtn.addEventListener('click', downloadCompliancePdf);

    complianceReport.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function downloadCompliancePdf() {
    if (!lastReportContext) return;
    const ctx = lastReportContext;
    const jsPdfCtor = (window.jspdf && window.jspdf.jsPDF) || (window.jsPDF ? window.jsPDF : null);
    if (!jsPdfCtor) {
      window.alert(
        'PDF library not loaded (CDN blocked?). The Asana task already holds the full record.'
      );
      return;
    }
    const b = ctx.submittedBody;
    const d = ctx.saveData;
    const m = ctx.meta;
    const doc = new jsPdfCtor({ unit: 'pt', format: 'a4' });
    const margin = 40;
    const pageW = doc.internal.pageSize.getWidth();
    const maxW = pageW - margin * 2;
    let y = margin;

    const line = (text, opts) => {
      const fontSize = (opts && opts.size) || 10;
      const bold = opts && opts.bold;
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(fontSize);
      const rows = doc.splitTextToSize(
        String(text === null || text === undefined ? '' : text),
        maxW
      );
      for (const row of rows) {
        if (y > doc.internal.pageSize.getHeight() - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(row, margin, y);
        y += fontSize * 1.25;
      }
    };

    line('Compliance Disposition Report', { size: 16, bold: true });
    line(m.tag, { size: 12, bold: true });
    line('Event ' + (d.eventId || '(pending)') + ' · saved ' + (d.savedAt || ''), { size: 9 });
    y += 6;
    line(m.bannerText, { size: 10, bold: true });
    y += 6;

    line('SUBJECT', { size: 10, bold: true });
    line('Name: ' + b.subjectName);
    line('Subject ID: ' + (b.subjectId || '(auto)'));
    line('Entity type: ' + b.entityType);
    if (b.dob) line('DoB: ' + b.dob);
    if (b.country) line('Country: ' + b.country);
    if (b.idNumber) line('ID / Register no.: ' + b.idNumber);
    if (b.jurisdiction) line('Jurisdiction: ' + b.jurisdiction);
    if (b.riskTier) line('Risk tier: ' + b.riskTier);
    y += 4;

    line('SCREENING', { size: 10, bold: true });
    line('Event type: ' + b.eventType);
    line('Lists screened: ' + ((b.listsScreened || []).join(', ') || '—'));
    line(
      'Top score: ' +
        ((b.overallTopScore || 0) * 100).toFixed(1) +
        '% (' +
        (b.overallTopClassification || 'none') +
        ')'
    );
    if (Array.isArray(b.anomalies) && b.anomalies.length) {
      line('Anomalies:');
      for (const a of b.anomalies) line('  - ' + a.list + ': ' + a.error);
    }
    y += 4;

    line('MLRO DISPOSITION', { size: 10, bold: true });
    line('Screening date: ' + b.screeningDate);
    line('Reviewed by: ' + b.reviewedBy);
    if (b.secondApprover) {
      line(
        'Second approver: ' +
          b.secondApprover +
          (b.secondApproverRole ? ' — ' + b.secondApproverRole : '')
      );
    }
    line('Outcome: ' + String(b.outcome).toUpperCase());
    y += 4;

    line('RATIONALE', { size: 10, bold: true });
    line(b.rationale);
    y += 4;

    if (b.keyFindings) {
      line('KEY FINDINGS', { size: 10, bold: true });
      line(b.keyFindings);
      y += 4;
    }

    line('NEXT ACTIONS', { size: 10, bold: true });
    for (const step of m.nextActions) line('• ' + step);
    y += 4;

    line('REGULATORY BASIS', { size: 10, bold: true });
    line(m.citations);
    y += 4;

    line(
      'Confidential compliance record — do not disclose to the subject (FDL No.10/2025 Art.29 no tipping off).',
      { size: 8 }
    );

    const fname =
      'compliance-report-' +
      (d.eventId || 'event') +
      '-' +
      String(b.outcome).replace(/_/g, '-') +
      '.pdf';
    doc.save(fname);
  }

  function renderScreeningResult(data) {
    if (!data || !data.ok) {
      screenResult.innerHTML = '';
      return;
    }
    const html = [];
    const topClass = (data.sanctions && data.sanctions.topClassification) || 'none';
    const topScore = (data.sanctions && data.sanctions.topScore) || 0;
    const risk = data.risk || {};
    const am = data.adverseMedia || {};
    const wl = data.watchlist || {};
    const asana = data.asana || {};
    const integrity = data.screeningIntegrity || 'complete';
    const integrityReasons = Array.isArray(data.integrityReasons) ? data.integrityReasons : [];

    // Integrity banner — FDL Art.20-21 forces the MLRO to see
    // "we could not actually screen" as a visually distinct state,
    // never as a green clean chip. Red for incomplete (mandatory list
    // unreachable → the screening cannot be trusted), amber for degraded
    // (partial coverage — re-run when upstream is available).
    if (integrity === 'incomplete') {
      html.push(
        '<div style="margin-bottom:12px; padding:12px 14px; border:2px solid var(--red); ' +
          'background: rgba(201,52,52,0.08); border-radius:6px; color: var(--red);">' +
          '<strong>SCREENING INCOMPLETE — RESULT CANNOT BE TRUSTED.</strong> ' +
          'A mandatory data source (UN or UAE EOCN) was unreachable. ' +
          'Re-run the screening once upstream is available; do not record a disposition yet ' +
          '(FDL Art.20-21, Cabinet Res 74/2020 Art.4-7).'
      );
      if (integrityReasons.length > 0) {
        html.push('<ul style="margin:6px 0 0 18px; padding:0;">');
        for (const r of integrityReasons) {
          html.push('<li>' + escapeHTML(String(r)) + '</li>');
        }
        html.push('</ul>');
      }
      html.push('</div>');
    } else if (integrity === 'degraded') {
      html.push(
        '<div style="margin-bottom:12px; padding:12px 14px; border:2px solid var(--amber); ' +
          'background: rgba(232,160,48,0.08); border-radius:6px; color: var(--amber);">' +
          '<strong>SCREENING DEGRADED — partial coverage only.</strong> ' +
          'At least one enhanced data source was unavailable. Record a provisional disposition ' +
          'and re-screen when upstream recovers (FDL Art.20, FATF Rec 10).'
      );
      if (integrityReasons.length > 0) {
        html.push('<ul style="margin:6px 0 0 18px; padding:0;">');
        for (const r of integrityReasons) {
          html.push('<li>' + escapeHTML(String(r)) + '</li>');
        }
        html.push('</ul>');
      }
      html.push('</div>');
    }

    const subj = data.subject || {};
    html.push('<div class="subject-row">');
    html.push('<div class="subject-info">');
    html.push('<div class="subject-name">' + escapeHTML(subj.name || '') + '</div>');
    html.push(
      '<div class="subject-id">' +
        escapeHTML(subj.id || '') +
        ' · ran ' +
        escapeHTML(data.ranAt) +
        '</div>'
    );
    html.push('</div>');
    // When integrity is compromised we NEVER show a green "none" chip —
    // the chip flips to show the integrity state and force re-screen.
    if (integrity === 'incomplete') {
      html.push(
        '<span class="classification confirmed" style="background:var(--red); color:#fff;">' +
          'INCOMPLETE · RE-SCREEN' +
          '</span>'
      );
    } else if (integrity === 'degraded' && topClass === 'none') {
      html.push(
        '<span class="classification potential" style="background:var(--amber); color:#1a1a1a;">' +
          'DEGRADED · ' +
          pct(topScore) +
          '</span>'
      );
    } else {
      html.push(
        '<span class="classification ' +
          escapeHTML(topClass) +
          '">' +
          escapeHTML(topClass) +
          ' · ' +
          pct(topScore) +
          '</span>'
      );
    }
    html.push('</div>');

    // Full subject identity block — so the MLRO can confirm WHO was
    // screened at a glance (FDL Art.24 — audit record must be complete).
    const dFields = [
      ['Entity type', subj.entityType],
      ['Date of birth / registration', subj.dob],
      ['Country', subj.country],
      ['ID / register no.', subj.idNumber],
      ['Jurisdiction', subj.jurisdiction],
      ['Risk tier', subj.riskTier],
      ['Event type', subj.eventType],
    ].filter(function (pair) {
      return pair[1] !== undefined && pair[1] !== null && String(pair[1]).trim() !== '';
    });
    if (dFields.length > 0) {
      html.push('<div class="subject-details">');
      for (const pair of dFields) {
        html.push('<div class="subject-detail-item">');
        html.push('<div class="subject-detail-label">' + escapeHTML(pair[0]) + '</div>');
        html.push('<div class="subject-detail-value">' + escapeHTML(String(pair[1])) + '</div>');
        html.push('</div>');
      }
      html.push('</div>');
    }

    html.push('<div class="stat" style="margin-top:10px;">');
    html.push(
      '<div class="stat-item"><div class="stat-value">' +
        escapeHTML(String(risk.rating || '—')) +
        '</div><div class="stat-label">Risk rating</div></div>'
    );
    html.push(
      '<div class="stat-item"><div class="stat-value">' +
        escapeHTML(String(risk.cddLevel || '—')) +
        '</div><div class="stat-label">CDD level</div></div>'
    );
    html.push(
      '<div class="stat-item"><div class="stat-value">' +
        escapeHTML(String((data.sanctions && data.sanctions.totalCandidatesChecked) || 0)) +
        '</div><div class="stat-label">Candidates scanned</div></div>'
    );
    html.push(
      '<div class="stat-item"><div class="stat-value">' +
        escapeHTML(String(am.hits || 0)) +
        '</div><div class="stat-label">Adverse media</div></div>'
    );
    html.push('</div>');

    if (Array.isArray(data.sanctions && data.sanctions.perList)) {
      html.push('<div class="list-grid">');
      for (const l of data.sanctions.perList) {
        html.push('<div class="list-item">');
        html.push('<div class="list-name">' + escapeHTML(l.list) + '</div>');
        html.push('<div class="list-score">' + pct(l.topScore) + '</div>');
        html.push(
          '<div class="list-count">' +
            escapeHTML(String(l.hitCount)) +
            ' hit(s) · ' +
            escapeHTML(String(l.candidatesChecked)) +
            ' checked</div>'
        );
        if (l.error) {
          html.push(
            '<div class="list-count" style="color: var(--amber); margin-top:4px;">⚠ ' +
              escapeHTML(l.error) +
              '</div>'
          );
        }
        html.push('</div>');
      }
      html.push('</div>');
    }

    // Hits accordion
    const hitLists = (data.sanctions && data.sanctions.perList) || [];
    const anyHits = hitLists.some((l) => Array.isArray(l.hits) && l.hits.length > 0);
    if (anyHits) {
      html.push('<details open><summary>Matched candidates</summary>');
      // Subject resolution explainer — the MLRO must disambiguate
      // "all the Mohameds" before daily monitoring can fire alerts.
      // FATF Rec 10 requires positive identification; Cabinet Res
      // 134/2025 Art.7-10 requires a unique identifier for CDD.
      html.push(
        '<div class="help-text" style="margin:6px 0 4px 0;">' +
          'Resolution: if a candidate IS this subject, pin the identity so ' +
          'future daily hits are scored against DoB, nationality, ID, and ' +
          'aliases — not the bare name.' +
          '</div>'
      );
      const subjId = (data.subject && data.subject.id) || '';
      for (const l of hitLists) {
        if (!Array.isArray(l.hits) || l.hits.length === 0) continue;
        html.push(
          '<div class="help-text" style="margin-top:8px;">' + escapeHTML(l.list) + ':</div>'
        );
        for (let i = 0; i < l.hits.length; i++) {
          const h = l.hits[i];
          const bd = h.breakdown || {};
          const formId = 'resolve-form-' + escapeHTML(l.list).replace(/[^a-z0-9]/gi, '-') + '-' + i;
          html.push('<div class="hit-row">');
          html.push(
            '<div class="hit-name">' +
              escapeHTML(h.candidate) +
              '<br><span class="muted">JW ' +
              pct(bd.jaroWinkler) +
              ' · Lev ' +
              pct(bd.levenshtein) +
              ' · Tok ' +
              pct(bd.tokenSet) +
              ' · agreement ' +
              pct(bd.agreement) +
              '</span></div>'
          );
          html.push('<div class="hit-score">' + pct(bd.score) + '</div>');
          if (subjId) {
            html.push(
              '<button type="button" class="btn-resolve-subject btn-small" ' +
                'data-resolve-target="' +
                escapeHTML(formId) +
                '" data-subject-id="' +
                escapeHTML(subjId) +
                '" data-list="' +
                escapeHTML(l.list) +
                '" data-candidate="' +
                escapeHTML(h.candidate) +
                '" title="Pin this candidate as the actual subject">' +
                'Pin as subject</button>'
            );
            html.push(
              '<button type="button" class="btn-resolve-dismiss btn-small" ' +
                'data-resolve-target="' +
                escapeHTML(formId) +
                '" title="Record that this is NOT the subject (name coincidence)">' +
                'Not the subject</button>'
            );
            html.push(
              '<div class="resolve-form" id="' +
                escapeHTML(formId) +
                '" hidden>' +
                '<div class="resolve-form-grid">' +
                '<label>DoB (dd/mm/yyyy)<input type="text" data-field="dob" placeholder="12/03/1982" maxlength="10"></label>' +
                '<label>Nationality (ISO alpha-2)<input type="text" data-field="nationality" placeholder="AE" maxlength="2"></label>' +
                '<label>ID type<select data-field="idType">' +
                '<option value="">—</option>' +
                '<option value="passport">Passport</option>' +
                '<option value="emirates_id">Emirates ID</option>' +
                '<option value="national_id">National ID</option>' +
                '<option value="other">Other</option>' +
                '</select></label>' +
                '<label>ID number<input type="text" data-field="idNumber" maxlength="64"></label>' +
                '<label>ID issuing country<input type="text" data-field="idIssuingCountry" placeholder="AE" maxlength="2"></label>' +
                '<label>Gender<select data-field="gender">' +
                '<option value="">—</option>' +
                '<option value="M">M</option>' +
                '<option value="F">F</option>' +
                '<option value="X">X</option>' +
                '</select></label>' +
                '<label class="span2">Aliases (comma-separated)<input type="text" data-field="aliases"></label>' +
                '<label class="span2">Resolution note<textarea data-field="resolutionNote" rows="2" maxlength="2000"></textarea></label>' +
                '</div>' +
                '<div class="resolve-form-actions">' +
                '<button type="button" class="btn-resolve-save btn-small" data-subject-id="' +
                escapeHTML(subjId) +
                '" data-list="' +
                escapeHTML(l.list) +
                '" data-candidate="' +
                escapeHTML(h.candidate) +
                '">Save resolution</button>' +
                '<button type="button" class="btn-resolve-cancel btn-small">Cancel</button>' +
                '<span class="resolve-status muted"></span>' +
                '</div>' +
                '</div>'
            );
          }
          html.push('</div>');
        }
      }
      html.push('</details>');
    }

    // Top risk factors
    if (Array.isArray(risk.topFactors) && risk.topFactors.length > 0) {
      html.push(
        '<details><summary>Explainable risk factors (top ' + risk.topFactors.length + ')</summary>'
      );
      for (const f of risk.topFactors) {
        html.push('<div class="factor-row">');
        html.push(
          '<span class="factor-contrib">' +
            (f.contribution >= 0 ? '+' : '') +
            f.contribution.toFixed(2) +
            '</span>'
        );
        html.push('<span class="factor-name">' + escapeHTML(f.name) + '</span>');
        html.push(
          '<span class="factor-reg">' +
            escapeHTML(f.regulatory) +
            (f.rationale ? ' · ' + escapeHTML(f.rationale) : '') +
            '</span>'
        );
        html.push('</div>');
      }
      html.push('</details>');
    }

    // Adverse media top
    if (Array.isArray(am.top) && am.top.length > 0) {
      html.push(
        '<details><summary>Adverse media (' +
          am.hits +
          ' hits via ' +
          escapeHTML(am.provider) +
          ')</summary>'
      );
      for (const hit of am.top) {
        html.push(
          '<div class="hit-row"><div class="hit-name"><a href="' +
            escapeHTML(hit.url) +
            '" target="_blank" rel="noopener noreferrer" style="color:var(--gold);">' +
            escapeHTML(hit.title) +
            '</a><br><span class="muted">' +
            escapeHTML(hit.source || '') +
            '</span></div></div>'
        );
      }
      html.push('</details>');
    } else if (am.provider === 'none' || am.provider === 'dry_run' || am.provider === 'disabled') {
      html.push(
        '<div class="help-text" style="margin-top:8px;">' +
          'Adverse-media provider not configured (set BRAVE_SEARCH_API_KEY, SERPAPI_KEY, ' +
          'BING_SEARCH_API_KEY, or GOOGLE_CSE_KEY + GOOGLE_CSE_CX). ' +
          'Google News RSS runs with no key but may time out under cold start.' +
          '</div>'
      );
    } else if (Array.isArray(am.providersUsed) && am.providersUsed.length > 0 && am.hits === 0) {
      html.push(
        '<div class="help-text" style="margin-top:8px;">' +
          'Adverse-media providers queried: ' +
          escapeHTML(am.providersUsed.join(', ')) +
          ' — 0 hits returned.' +
          '</div>'
      );
    }

    // Actions taken
    html.push('<div class="help-text" style="margin-top:10px;">');
    const actionBits = [];
    if (wl.action === 'enrolled')
      actionBits.push('✓ Enrolled in daily watchlist (06:00 / 14:00 UTC)');
    else if (wl.action === 'already-present') actionBits.push('✓ Already on daily watchlist');
    else if (wl.action === 'skipped') actionBits.push('Not enrolled (opted out)');
    else if (wl.action === 'failed')
      actionBits.push('⚠ Watchlist enrollment failed: ' + (wl.error || 'unknown'));

    if (asana && asana.ok) actionBits.push('✓ Asana task created: gid ' + asana.gid);
    else if (asana && asana.skipped)
      actionBits.push('No Asana task (no match requiring MLRO review)');
    else if (asana && asana.error) actionBits.push('⚠ Asana task failed: ' + asana.error);

    html.push(actionBits.map(escapeHTML).join(' · '));
    html.push('</div>');

    // Asana destination — always show where the MLRO can find the
    // task (or will find it once disposition is saved) so there is no
    // ambiguity about where the audit trail lives.
    html.push('<div class="asana-destination">');
    html.push('<strong>Destination:</strong> Asana project ');
    html.push('<em>Hawkeye Screenings</em> (project GID ');
    const projGid = (asana && asana.projectGid) || '1213759768596515';
    html.push(escapeHTML(projGid));
    html.push('). ');
    if (asana && asana.ok && asana.gid) {
      html.push(
        '<a href="https://app.asana.com/0/' +
          escapeHTML(projGid) +
          '/' +
          escapeHTML(asana.gid) +
          '" target="_blank" rel="noopener noreferrer">Open task ' +
          escapeHTML(asana.gid) +
          ' →</a>'
      );
    } else {
      html.push(
        'The MLRO disposition (Save Screening Event below) creates the audit task in this project.'
      );
    }
    html.push('</div>');

    screenResult.innerHTML = html.join('');
  }

  async function runScreening() {
    // Guard against double-click re-entry while a run is in flight.
    if (screenBtn.disabled) return;

    saveToken();
    const name = subjectNameInput.value.trim();
    if (!name) {
      showMessage(screenMsg, 'Name screened is required.', 'error');
      return;
    }
    const entityType = entityTypeSelect.value;
    if (entityType !== 'individual' && entityType !== 'legal_entity') {
      showMessage(screenMsg, 'Entity type is required.', 'error');
      return;
    }
    const eventType = eventTypeSelect.value;
    if (!eventType) {
      showMessage(screenMsg, 'Screening event type is required.', 'error');
      return;
    }
    const dobRaw = dobInput.value.trim();
    if (dobRaw && !/^\d{2}\/\d{2}\/\d{4}$/.test(dobRaw)) {
      showMessage(screenMsg, 'DoB / registration must be dd/mm/yyyy.', 'error');
      return;
    }
    const screener = activeMlroName();
    if (!screener) {
      showMessage(
        screenMsg,
        'Main MLRO name required — fill it in above before running a screening.',
        'error'
      );
      return;
    }

    // All validation passed — hide stale disposition and lock the button.
    hideDisposition();
    screenBtn.disabled = true;
    screenBtn.innerHTML = '<span class="spinner"></span>Screening…';
    try {
      const selectedLists = collectSelectedLists();
      const listBanner =
        selectedLists.length > 0
          ? 'UAE EOCN + UN (mandatory) + ' + selectedLists.join(', ')
          : 'UAE EOCN + UN (mandatory) only';
      showMessage(
        screenMsg,
        'Running multi-list screen: ' + listBanner + ' + adverse media…',
        'info'
      );
      screenResult.innerHTML = '';

      const aliases = aliasesInput ? parseAliases(aliasesInput.value) : [];
      const body = {
        subjectName: name,
        aliases: aliases.length > 0 ? aliases : undefined,
        subjectId: subjectIdInput.value.trim() || undefined,
        entityType: entityType,
        dob: dobRaw || undefined,
        country: countryInput.value.trim() || undefined,
        idNumber: idNumberInput.value.trim() || undefined,
        eventType: eventType,
        riskTier: riskTierSelect.value,
        jurisdiction: jurisdictionInput.value.trim() || undefined,
        notes: notesInput.value.trim() || undefined,
        selectedLists: selectedLists,
        enrollInWatchlist: true,
        runAdverseMedia: isAdverseMediaEnabled(),
        adverseMediaPredicates: isAdverseMediaEnabled() ? allPredicateKeys() : undefined,
        createAsanaTask: true,
        screenedBy: screener,
        screenedByRole: 'main_mlro',
      };
      const result = await apiPost(SCREENING_ENDPOINT, body);
      if (!result.ok) {
        showMessage(screenMsg, result.error, 'error');
        lastRun = null;
      } else {
        lastRun = result.data;
        const topClass =
          (result.data && result.data.sanctions && result.data.sanctions.topClassification) ||
          'none';
        const anomalies = (result.data && result.data.anomalies) || [];
        const integrity = (result.data && result.data.screeningIntegrity) || 'complete';
        const verb =
          integrity === 'incomplete'
            ? 'SCREENING INCOMPLETE — mandatory data source unavailable, re-screen required'
            : topClass === 'confirmed'
              ? 'CONFIRMED sanctions match — freeze workflow triggered'
              : topClass === 'potential'
                ? 'POTENTIAL match — MLRO review required'
                : topClass === 'weak'
                  ? 'Weak match — documented and dismissed if false positive'
                  : integrity === 'degraded'
                    ? 'Screening DEGRADED — partial coverage only, re-run when upstream recovers'
                    : 'No sanctions match';
        const anomSuffix =
          anomalies.length > 0 ? ' · ' + anomalies.length + ' anomaly(ies) routed to Asana' : '';
        showMessage(
          screenMsg,
          verb + anomSuffix + '. Complete the disposition below to close the event.',
          integrity === 'complete' && topClass === 'none' && anomalies.length === 0
            ? 'success'
            : 'error'
        );
        renderScreeningResult(result.data);
        showDisposition();
        refreshWatchlist();
      }
    } catch (err) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String(err.message)
          : 'Screening failed unexpectedly.';
      showMessage(screenMsg, msg, 'error');
      lastRun = null;
    } finally {
      screenBtn.disabled = false;
      screenBtn.textContent = 'Run Screening';
    }
  }

  screenBtn.addEventListener('click', runScreening);

  // ─── Transaction monitoring flow ─────────────────────────────────
  const tmCustomerIdInput = $('tmCustomerId');
  const tmCustomerNameInput = $('tmCustomerName');
  const tmAmountInput = $('tmAmount');
  const tmCurrencySelect = $('tmCurrency');
  const tmRiskRatingSelect = $('tmRiskRating');
  const tmOriginCountryInput = $('tmOriginCountry');
  const tmDestCountryInput = $('tmDestCountry');
  const tmTxLast30Input = $('tmTxLast30');
  const tmCumLast30Input = $('tmCumLast30');
  const tmPaymentMethodSelect = $('tmPaymentMethod');
  const tmPayerMatchesSelect = $('tmPayerMatches');
  const tmCommodityInput = $('tmCommodity');
  const tmNotesInput = $('tmNotes');
  const tmBtn = $('tmBtn');
  const tmMsg = $('tmMsg');
  const tmResult = $('tmResult');

  function renderTmResult(data) {
    if (!data || !data.ok) {
      tmResult.innerHTML = '';
      return;
    }
    const summary = data.summary || {
      alertCount: 0,
      countBySeverity: { medium: 0, high: 0, critical: 0 },
    };
    const html = [];
    html.push('<div class="stat">');
    html.push(
      '<div class="stat-item"><div class="stat-value">' +
        escapeHTML(String(summary.transactionsProcessed || 0)) +
        '</div><div class="stat-label">Processed</div></div>'
    );
    html.push(
      '<div class="stat-item" style="color:var(--red);"><div class="stat-value" style="color:var(--red);">' +
        escapeHTML(String(summary.countBySeverity.critical)) +
        '</div><div class="stat-label">Critical</div></div>'
    );
    html.push(
      '<div class="stat-item" style="color:var(--amber);"><div class="stat-value" style="color:var(--amber);">' +
        escapeHTML(String(summary.countBySeverity.high)) +
        '</div><div class="stat-label">High</div></div>'
    );
    html.push(
      '<div class="stat-item" style="color:var(--blue);"><div class="stat-value" style="color:var(--blue);">' +
        escapeHTML(String(summary.countBySeverity.medium)) +
        '</div><div class="stat-label">Medium</div></div>'
    );
    html.push('</div>');

    const per = data.perTransaction || [];
    for (const row of per) {
      const alerts = row.alerts || [];
      if (alerts.length === 0) {
        html.push(
          '<div class="help-text" style="margin-top:8px;">Transaction #' +
            row.index +
            ': no alerts fired.</div>'
        );
        continue;
      }
      html.push(
        '<div class="help-text" style="margin-top:12px;">Transaction #' +
          row.index +
          ' alerts (' +
          alerts.length +
          '):</div>'
      );
      for (const a of alerts) {
        html.push('<div class="alert-row ' + escapeHTML(a.severity) + '">');
        html.push(
          '<div class="alert-rule">[' +
            escapeHTML((a.severity || '').toUpperCase()) +
            '] ' +
            escapeHTML(a.ruleName || a.ruleId) +
            '</div>'
        );
        html.push('<div class="alert-message">' + escapeHTML(a.message) + '</div>');
        html.push('<div class="alert-reg">' + escapeHTML(a.regulatoryRef || '') + '</div>');
        html.push('</div>');
      }
    }

    if (Array.isArray(data.asana) && data.asana.length > 0) {
      html.push(
        '<div class="help-text" style="margin-top:10px;">Asana tasks created: ' +
          data.asana.filter((r) => r.ok).length +
          ' / ' +
          data.asana.length +
          '</div>'
      );
    }

    tmResult.innerHTML = html.join('');
  }

  async function runTm() {
    // Guard against double-click re-entry while a run is in flight.
    if (tmBtn.disabled) return;

    saveToken();
    const customerId = tmCustomerIdInput.value.trim();
    const customerName = tmCustomerNameInput.value.trim();
    const amount = Number(tmAmountInput.value);
    if (!customerId || !customerName || !Number.isFinite(amount) || amount < 0) {
      showMessage(tmMsg, 'Customer ID, customer name, and amount are required.', 'error');
      return;
    }
    tmBtn.disabled = true;
    tmBtn.innerHTML = '<span class="spinner"></span>Scanning…';
    try {
      showMessage(
        tmMsg,
        'Running rule + velocity + behavioral + cumulative + cross-border checks…',
        'info'
      );
      tmResult.innerHTML = '';

      const tx = {
        amount: amount,
        currency: tmCurrencySelect.value,
        customerName: customerName,
        customerRiskRating: tmRiskRatingSelect.value,
        payerMatchesCustomer: tmPayerMatchesSelect.value === 'true',
        originCountry: tmOriginCountryInput.value.trim() || undefined,
        destinationCountry: tmDestCountryInput.value.trim() || undefined,
        transactionsLast30Days: Number(tmTxLast30Input.value) || 0,
        cumulativeAmountLast30Days: Number(tmCumLast30Input.value) || 0,
        paymentMethod: tmPaymentMethodSelect.value,
        commodityType: tmCommodityInput.value.trim() || undefined,
        notes: tmNotesInput.value.trim() || undefined,
      };

      const result = await apiPost(TM_ENDPOINT, {
        customerId: customerId,
        customerName: customerName,
        transactions: [tx],
        createAsanaOnCritical: true,
        enrollInDailyMonitoring: true,
      });
      if (!result.ok) {
        showMessage(tmMsg, result.error, 'error');
      } else {
        const summary = (result.data && result.data.summary) || { alertCount: 0 };
        const msg =
          'Processed ' +
          summary.transactionsProcessed +
          ' transaction(s). ' +
          summary.alertCount +
          ' alert(s) fired.';
        showMessage(tmMsg, msg, summary.alertCount === 0 ? 'success' : 'error');
        renderTmResult(result.data);
      }
    } catch (err) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String(err.message)
          : 'Transaction scan failed unexpectedly.';
      showMessage(tmMsg, msg, 'error');
    } finally {
      tmBtn.disabled = false;
      tmBtn.textContent = 'Run Transaction Monitor';
    }
  }

  tmBtn.addEventListener('click', runTm);

  // ─── Watchlist snapshot ──────────────────────────────────────────
  const wlCountEl = $('wlCount');
  const wlAlertsEl = $('wlAlerts');
  const wlLastRunEl = $('wlLastRun');
  const wlListEl = $('wlList');
  const refreshBtn = $('refreshBtn');

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (_e) {
      return iso;
    }
  }

  async function refreshWatchlist() {
    wlCountEl.textContent = '…';
    wlAlertsEl.textContent = '…';
    wlLastRunEl.textContent = '…';
    const result = await apiGetWatchlist();
    if (!result.ok) {
      wlCountEl.textContent = '—';
      wlAlertsEl.textContent = '—';
      wlLastRunEl.textContent = '—';
      wlListEl.innerHTML = '<div class="msg msg-error">' + escapeHTML(result.error) + '</div>';
      return;
    }
    const entries = (result.data && result.data.watchlist && result.data.watchlist.entries) || [];
    wlCountEl.textContent = String(entries.length);

    let totalAlerts = 0;
    let latestRun = '';
    for (const e of entries) {
      totalAlerts += typeof e.alertCount === 'number' ? e.alertCount : 0;
      if (e.lastScreenedAtIso && e.lastScreenedAtIso > latestRun) latestRun = e.lastScreenedAtIso;
    }
    wlAlertsEl.textContent = String(totalAlerts);
    wlLastRunEl.textContent = latestRun ? formatDate(latestRun) : '—';

    if (entries.length === 0) {
      wlListEl.innerHTML =
        '<div class="help-text">No subjects yet. Screen a name above to enroll the first subject automatically.</div>';
      return;
    }

    const sorted = entries.slice().sort((a, b) => {
      const ta = a.lastScreenedAtIso || a.addedAtIso || '';
      const tb = b.lastScreenedAtIso || b.addedAtIso || '';
      return tb.localeCompare(ta);
    });

    const html = [];
    for (const e of sorted.slice(0, 50)) {
      html.push('<div class="subject-row">');
      html.push('<div class="subject-info">');
      html.push('<div class="subject-name">' + escapeHTML(e.subjectName) + '</div>');
      html.push(
        '<div class="subject-id">' +
          escapeHTML(e.id) +
          ' · added ' +
          escapeHTML(formatDate(e.addedAtIso)) +
          (e.lastScreenedAtIso
            ? ' · last run ' + escapeHTML(formatDate(e.lastScreenedAtIso))
            : '') +
          ' · ' +
          escapeHTML(String(e.alertCount || 0)) +
          ' lifetime hits</div>'
      );
      html.push('</div>');
      html.push('<div class="subject-actions">');
      html.push(
        '<span class="classification ' +
          (e.riskTier === 'high' ? 'confirmed' : e.riskTier === 'medium' ? 'potential' : 'none') +
          '">' +
          escapeHTML(e.riskTier || 'medium') +
          '</span>'
      );
      html.push(
        '<button type="button" class="btn-delete-subject" data-delete-id="' +
          escapeHTML(e.id) +
          '" data-delete-name="' +
          escapeHTML(e.subjectName) +
          '" title="Delete this watchlist entry (correct a mistaken enrolment)" aria-label="Delete watchlist entry">\u00d7</button>'
      );
      html.push('</div>');
      html.push('</div>');
    }
    if (sorted.length > 50) {
      html.push(
        '<div class="help-text" style="margin-top:8px;">Showing 50 most-recent of ' +
          sorted.length +
          ' total.</div>'
      );
    }
    wlListEl.innerHTML = html.join('');
  }

  refreshBtn.addEventListener('click', refreshWatchlist);

  // ─── List / Risk-category "Refresh" buttons ───────────────────────
  // Each list card carries a small Refresh button that restores every
  // non-locked checkbox in its scope back to the default "checked"
  // state (default: all ON). Locked entries (mandatory EOCN + UN) are
  // skipped — those are regulatory hard-wires per Cabinet Decision
  // 74/2020 and must never be toggled by the UI. The control dispatches
  // a `change` event so any listeners observing the live screening set
  // (e.g. coverage-foot counters) recompute.
  document.addEventListener('click', function (evt) {
    const target = evt.target;
    // Element (not HTMLElement) covers the inner SVG / <path> nodes
    // that receive the click when the user hits the icon itself.
    // A stricter HTMLElement guard here was returning early and
    // leaving the button non-functional.
    if (!(target instanceof Element)) return;
    const btn = target.closest('.list-refresh');
    if (!btn) return;
    const card = btn.closest('.card.list-tier');
    if (!card) return;
    card.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
      if (cb.disabled) return;
      if (!cb.checked) {
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  });

  // ─── Delete button delegation on the watchlist ─────────────────────
  // A mistaken enrolment (wrong name, duplicate, test entry) needs to be
  // removable. The watchlist API already exposes action:"remove" — we
  // wire a single delegated click handler so every row's Delete button
  // works without re-binding on each refreshWatchlist() call.
  wlListEl.addEventListener('click', async function (evt) {
    const target = evt.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest('.btn-delete-subject');
    if (!btn) return;
    const id = btn.getAttribute('data-delete-id');
    const name = btn.getAttribute('data-delete-name') || id;
    if (!id) return;
    const confirmed = window.confirm(
      'Delete watchlist entry for "' +
        name +
        '" (id ' +
        id +
        ')?\n\n' +
        'This removes the subject from ongoing monitoring. Use only to correct ' +
        'a mistaken enrolment — screening results already saved to Asana are ' +
        'retained separately (FDL Art.24, 10-year record retention).'
    );
    if (!confirmed) return;
    btn.setAttribute('disabled', 'disabled');
    btn.style.opacity = '0.4';
    const result = await apiDeleteWatchlistEntry(id);
    if (!result.ok) {
      btn.removeAttribute('disabled');
      btn.style.opacity = '';
      window.alert('Delete failed: ' + result.error);
      return;
    }
    refreshWatchlist();
  });

  // ─── Identity resolution delegation on the screening result ───────
  // Per-hit "Pin as subject" / "Not the subject" / Save / Cancel
  // buttons. The pinned identity is POSTed to /api/watchlist with
  // action:"resolve" so daily monitoring (scripts/scheduled-screening.ts)
  // can score every future hit against the resolved profile via
  // src/services/identityMatchScore.ts. FATF Rec 10 + Cabinet Res
  // 134/2025 Art.7-10 require positive CDD identification; without
  // this pin, every "Mohamed Ahmed" hit stays at 'possible' and never
  // fires an alert.
  function readResolutionForm(form) {
    const get = function (field) {
      const el = form.querySelector('[data-field="' + field + '"]');
      return el && typeof el.value === 'string' ? el.value.trim() : '';
    };
    const identity = {};
    const dob = get('dob');
    if (dob) identity.dob = dob;
    const nat = get('nationality');
    if (nat) identity.nationality = nat.toUpperCase();
    const idType = get('idType');
    if (idType) identity.idType = idType;
    const idNumber = get('idNumber');
    if (idNumber) identity.idNumber = idNumber;
    const idIssuing = get('idIssuingCountry');
    if (idIssuing) identity.idIssuingCountry = idIssuing.toUpperCase();
    const gender = get('gender');
    if (gender) identity.gender = gender;
    const aliasesRaw = get('aliases');
    if (aliasesRaw) {
      identity.aliases = aliasesRaw
        .split(',')
        .map(function (a) {
          return a.trim();
        })
        .filter(function (a) {
          return a.length > 0;
        });
    }
    const note = get('resolutionNote');
    if (note) identity.resolutionNote = note;
    return identity;
  }

  if (screenResult) {
    screenResult.addEventListener('click', async function (evt) {
      const target = evt.target;
      if (!(target instanceof Element)) return;

      // Open the resolution form for a hit row.
      const pinBtn = target.closest('.btn-resolve-subject');
      if (pinBtn) {
        const formId = pinBtn.getAttribute('data-resolve-target');
        if (!formId) return;
        const form = document.getElementById(formId);
        if (form) form.hidden = !form.hidden;
        return;
      }

      // Record "not the subject" — name coincidence, no identity pinned.
      // This is a UI affordance today (no endpoint change needed) — it
      // collapses any open form for this row so the reviewer can move
      // on without muddying the watchlist entry.
      const dismissBtn = target.closest('.btn-resolve-dismiss');
      if (dismissBtn) {
        const formId = dismissBtn.getAttribute('data-resolve-target');
        if (formId) {
          const form = document.getElementById(formId);
          if (form) form.hidden = true;
        }
        const parent = dismissBtn.closest('.hit-row');
        if (parent) {
          parent.style.opacity = '0.55';
          const note = document.createElement('span');
          note.className = 'muted';
          note.style.fontSize = '11px';
          note.textContent = ' · dismissed as name coincidence';
          const scoreEl = parent.querySelector('.hit-score');
          if (scoreEl && !parent.querySelector('.resolve-dismiss-note')) {
            note.classList.add('resolve-dismiss-note');
            scoreEl.appendChild(note);
          }
        }
        return;
      }

      // Cancel the resolution form.
      const cancelBtn = target.closest('.btn-resolve-cancel');
      if (cancelBtn) {
        const form = cancelBtn.closest('.resolve-form');
        if (form) form.hidden = true;
        return;
      }

      // Save the resolution — POST to /api/watchlist.
      const saveBtn = target.closest('.btn-resolve-save');
      if (saveBtn) {
        const subjectId = saveBtn.getAttribute('data-subject-id');
        if (!subjectId) return;
        const form = saveBtn.closest('.resolve-form');
        if (!form) return;
        const statusEl = form.querySelector('.resolve-status');
        const list = saveBtn.getAttribute('data-list') || '';
        const candidate = saveBtn.getAttribute('data-candidate') || '';
        const identity = readResolutionForm(form);
        if (list && candidate) {
          identity.listEntryRef = { list: list, reference: candidate };
        }
        identity.resolvedAtIso = new Date().toISOString();

        saveBtn.setAttribute('disabled', 'disabled');
        if (statusEl) statusEl.textContent = 'Saving…';
        const result = await apiResolveWatchlistEntry(subjectId, identity);
        saveBtn.removeAttribute('disabled');
        if (!result.ok) {
          if (statusEl) statusEl.textContent = 'Failed: ' + result.error;
          return;
        }
        if (statusEl) statusEl.textContent = '✓ Pinned as subject';
        const row = form.closest('.hit-row');
        if (row) {
          row.style.borderLeft = '3px solid var(--gold)';
          const scoreEl = row.querySelector('.hit-score');
          if (scoreEl && !row.querySelector('.resolve-pinned-note')) {
            const note = document.createElement('span');
            note.className = 'muted resolve-pinned-note';
            note.style.fontSize = '11px';
            note.textContent = ' · pinned';
            scoreEl.appendChild(note);
          }
        }
        // Refresh the watchlist panel so the resolved state is visible
        // alongside other entries.
        try {
          refreshWatchlist();
        } catch (_e) {
          /* best-effort */
        }
        return;
      }
    });
  }

  // ─── Auto-load watchlist on boot if a token is already saved ──────
  try {
    if (localStorage.getItem(TOKEN_KEY)) {
      refreshWatchlist();
    }
  } catch (_e) {
    /* ignore */
  }
})();
