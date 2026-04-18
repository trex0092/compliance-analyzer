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

  // ─── Token format check ──────────────────────────────────────────
  function tokenFormatError(token) {
    if (!token) return 'Token required — paste it in the Authentication box above.';
    if (token.length < TOKEN_MIN) {
      return (
        'Token too short (' + token.length + ' chars; server requires at least ' + TOKEN_MIN + ').'
      );
    }
    if (!TOKEN_HEX_RE.test(token)) {
      return 'Token has non-hex characters. Server only accepts 0-9 and a-f.';
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
            error: 'Server rejected token (401). Check HAWKEYE_BRAIN_TOKEN in Netlify.',
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
        if (res.status === 401) return { ok: false, error: 'Server rejected token (401).' };
        if (res.status === 503) return { ok: false, error: 'Server misconfigured.' };
        if (res.status === 429) return { ok: false, error: 'Rate limited.' };
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
    return String(s == null ? '' : s)
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
  const enrollSelect = $('enrollInWatchlist');
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
  const legalAckCheckbox = $('legalAck');
  const freezeNoticeEl = $('freezeNotice');
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
    const el = document.querySelector(
      'input[data-tier="enhanced"][data-control="adverseMedia"]'
    );
    return el ? !!el.checked : true;
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
    if (legalAckCheckbox) legalAckCheckbox.checked = false;
    if (freezeNoticeEl) freezeNoticeEl.hidden = true;
    showMessage(saveMsg, '', 'info');
  }

  outcomeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      outcomeBtns.forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      currentOutcome = btn.getAttribute('data-outcome');
      if (freezeNoticeEl) {
        freezeNoticeEl.hidden = currentOutcome !== 'confirmed_match';
      }
    });
  });

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
    if (legalAckCheckbox && !legalAckCheckbox.checked) {
      showMessage(
        saveMsg,
        'Acknowledge the legal notice before saving (FDL Art.20-21 attestation).',
        'error'
      );
      return;
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
    const asanaMsg = asana.ok
      ? 'Asana task created (gid ' + asana.gid + ').'
      : asana.error
        ? 'Asana notification failed: ' + asana.error
        : 'Asana notification skipped.';
    showMessage(
      saveMsg,
      'Saved event ' + data.eventId + '. ' + asanaMsg + ' MoE audit record locked.',
      'success'
    );
  }

  saveBtn.addEventListener('click', saveScreeningEvent);

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

    html.push('<div class="subject-row">');
    html.push('<div class="subject-info">');
    html.push(
      '<div class="subject-name">' + escapeHTML(data.subject && data.subject.name) + '</div>'
    );
    html.push(
      '<div class="subject-id">' +
        escapeHTML(data.subject && data.subject.id) +
        ' · ran ' +
        escapeHTML(data.ranAt) +
        '</div>'
    );
    html.push('</div>');
    html.push(
      '<span class="classification ' +
        escapeHTML(topClass) +
        '">' +
        escapeHTML(topClass) +
        ' · ' +
        pct(topScore) +
        '</span>'
    );
    html.push('</div>');

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
      for (const l of hitLists) {
        if (!Array.isArray(l.hits) || l.hits.length === 0) continue;
        html.push(
          '<div class="help-text" style="margin-top:8px;">' + escapeHTML(l.list) + ':</div>'
        );
        for (const h of l.hits) {
          const bd = h.breakdown || {};
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
    } else if (am.provider === 'none') {
      html.push(
        '<div class="help-text" style="margin-top:8px;">Adverse-media provider not configured (set BRAVE_SEARCH_KEY, SERPAPI_KEY, or GOOGLE_CSE_KEY + GOOGLE_CSE_CX).</div>'
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

    screenResult.innerHTML = html.join('');
  }

  async function runScreening() {
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

    // Hide any stale disposition while a fresh screen runs
    hideDisposition();

    screenBtn.disabled = true;
    screenBtn.innerHTML = '<span class="spinner"></span>Screening…';

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
      enrollInWatchlist: enrollSelect.value === 'true',
      runAdverseMedia: isAdverseMediaEnabled(),
      createAsanaTask: true,
    };
    const result = await apiPost(SCREENING_ENDPOINT, body);
    if (!result.ok) {
      showMessage(screenMsg, result.error, 'error');
      lastRun = null;
    } else {
      lastRun = result.data;
      const topClass =
        (result.data && result.data.sanctions && result.data.sanctions.topClassification) || 'none';
      const anomalies = (result.data && result.data.anomalies) || [];
      const verb =
        topClass === 'confirmed'
          ? 'CONFIRMED sanctions match — freeze workflow triggered'
          : topClass === 'potential'
            ? 'POTENTIAL match — MLRO review required'
            : topClass === 'weak'
              ? 'Weak match — documented and dismissed if false positive'
              : 'No sanctions match';
      const anomSuffix =
        anomalies.length > 0
          ? ' · ' + anomalies.length + ' anomaly(ies) routed to Asana'
          : '';
      showMessage(
        screenMsg,
        verb + anomSuffix + '. Complete the disposition below to close the event.',
        topClass === 'none' && anomalies.length === 0 ? 'success' : 'error'
      );
      renderScreeningResult(result.data);
      showDisposition();
      refreshWatchlist();
    }

    screenBtn.disabled = false;
    screenBtn.textContent = 'Run Screening';
  }

  screenBtn.addEventListener('click', runScreening);

  // ─── Transaction monitoring flow ─────────────────────────────────
  const tmCustomerIdInput = $('tmCustomerId');
  const tmCustomerNameInput = $('tmCustomerName');
  const tmAmountInput = $('tmAmount');
  const tmRiskRatingSelect = $('tmRiskRating');
  const tmOriginCountryInput = $('tmOriginCountry');
  const tmDestCountryInput = $('tmDestCountry');
  const tmTxLast30Input = $('tmTxLast30');
  const tmCumLast30Input = $('tmCumLast30');
  const tmPaymentMethodSelect = $('tmPaymentMethod');
  const tmPayerMatchesSelect = $('tmPayerMatches');
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
    showMessage(
      tmMsg,
      'Running rule + velocity + behavioral + cumulative + cross-border checks…',
      'info'
    );
    tmResult.innerHTML = '';

    const tx = {
      amount: amount,
      currency: 'AED',
      customerName: customerName,
      customerRiskRating: tmRiskRatingSelect.value,
      payerMatchesCustomer: tmPayerMatchesSelect.value === 'true',
      originCountry: tmOriginCountryInput.value.trim() || undefined,
      destinationCountry: tmDestCountryInput.value.trim() || undefined,
      transactionsLast30Days: Number(tmTxLast30Input.value) || 0,
      cumulativeAmountLast30Days: Number(tmCumLast30Input.value) || 0,
      paymentMethod: tmPaymentMethodSelect.value,
    };

    const result = await apiPost(TM_ENDPOINT, {
      customerId: customerId,
      customerName: customerName,
      transactions: [tx],
      createAsanaOnCritical: true,
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

    tmBtn.disabled = false;
    tmBtn.textContent = 'Run Transaction Monitor';
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
      html.push(
        '<span class="classification ' +
          (e.riskTier === 'high' ? 'confirmed' : e.riskTier === 'medium' ? 'potential' : 'none') +
          '">' +
          escapeHTML(e.riskTier || 'medium') +
          '</span>'
      );
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

  // ─── Auto-load watchlist on boot if a token is already saved ──────
  try {
    if (localStorage.getItem(TOKEN_KEY)) {
      refreshWatchlist();
    }
  } catch (_e) {
    /* ignore */
  }
})();
