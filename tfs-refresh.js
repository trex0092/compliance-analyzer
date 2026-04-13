/**
 * TFS (Targeted Financial Sanctions) List Refresh Module v1.0
 * FATF Recommendations 6 & 7 — UN/OFAC/EU/UK sanctions list management
 * Auto-refreshes consolidated sanctions lists and checks screening matches.
 */
const TFSRefresh = (function() {
  'use strict';
  function esc(s) { if (!s && s!==0) return ''; var d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

  const STORAGE_KEY = 'fgl_tfs_lists';
  const REFRESH_LOG_KEY = 'fgl_tfs_refresh_log';
  const MATCH_LOG_KEY = 'fgl_tfs_matches';
  const REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

  // Use global scoping if available (company isolation)
  function _sk(key) { return typeof scopeKey === 'function' ? scopeKey(key) : key; }
  function _parse(key, fb) { try { return JSON.parse(localStorage.getItem(_sk(key)) || JSON.stringify(fb)); } catch(_){ return fb; } }
  function _save(key, val) { localStorage.setItem(_sk(key), JSON.stringify(val)); }
  function _remove(key) { localStorage.removeItem(_sk(key)); }

  // Sanctions list sources
  // NOTE: Until a real server-side ingest pipeline is wired to these sources,
  // every list stays in NOT_CHECKED state and screenEntity() hard-fails BLOCKED.
  // See docs/sanctions-ingest.md for the target architecture. Direct violation
  // of FATF Rec 6-7 and FDL Art.22 if screened results are treated as authoritative.
  const SANCTIONS_LISTS = [
    { id: 'UN_CONSOLIDATED', name: 'UN Security Council Consolidated List', source: 'United Nations', frequency: 'Daily', lastKnownCount: 734, category: 'UNSC Resolutions' },
    { id: 'OFAC_SDN', name: 'OFAC SDN List', source: 'US Treasury', frequency: 'Daily', lastKnownCount: 12500, category: 'US Sanctions' },
    { id: 'OFAC_CONS', name: 'OFAC Consolidated Non-SDN', source: 'US Treasury', frequency: 'Daily', lastKnownCount: 4200, category: 'US Sanctions' },
    { id: 'EU_CONSOLIDATED', name: 'EU Consolidated Sanctions List', source: 'European Union', frequency: 'Daily', lastKnownCount: 2100, category: 'EU Sanctions' },
    { id: 'UK_OFSI', name: 'UK OFSI Consolidated List', source: 'HM Treasury', frequency: 'Daily', lastKnownCount: 3800, category: 'UK Sanctions' },
    { id: 'EOCN', name: 'UAE Executive Office for Control & Non-Proliferation TFS', source: 'UAE EOCN', frequency: 'As issued', lastKnownCount: 0, category: 'UAE Sanctions' },
    { id: 'UAE_LOCAL', name: 'UAE Local Terrorist List', source: 'UAE Cabinet', frequency: 'As updated', lastKnownCount: 150, category: 'UAE Sanctions' },
    { id: 'INTERPOL_RED', name: 'Interpol Red Notices', source: 'Interpol', frequency: 'Real-time', lastKnownCount: 7300, category: 'Law Enforcement' },
    { id: 'WORLD_CHECK', name: 'Refinitiv World-Check (indicator)', source: 'LSEG', frequency: 'Daily', lastKnownCount: 0, category: 'Commercial Database' },
    { id: 'FATF_HIGH_RISK', name: 'FATF High-Risk Jurisdictions (Black List)', source: 'FATF', frequency: 'Tri-annual', lastKnownCount: 3, category: 'FATF Lists' },
    { id: 'FATF_GREY', name: 'FATF Jurisdictions Under Monitoring (Grey List)', source: 'FATF', frequency: 'Tri-annual', lastKnownCount: 21, category: 'FATF Lists' },
    { id: 'CAHRA_EU', name: 'EU Conflict-Affected and High-Risk Areas (CAHRA)', source: 'European Union', frequency: 'Quarterly', lastKnownCount: 28, category: 'Responsible Sourcing' },
    { id: 'PEP_DATABASE', name: 'Politically Exposed Persons Database', source: 'Multiple Sources', frequency: 'Daily', lastKnownCount: 1800000, category: 'PEP Screening' },
    { id: 'ADVERSE_MEDIA', name: 'Adverse Media and Negative News Screening', source: 'Multiple Sources', frequency: 'Real-time', lastKnownCount: 0, category: 'Media Screening' },
    { id: 'DUBAI_FIU', name: 'Dubai Financial Intelligence Unit (FIU) Alerts', source: 'UAE FIU / goAML', frequency: 'As issued', lastKnownCount: 0, category: 'UAE Regulatory' },
    { id: 'LBMA_RESPONSIBLE', name: 'LBMA Responsible Gold Guidance - Conflict List', source: 'LBMA', frequency: 'Annual', lastKnownCount: 45, category: 'Responsible Sourcing' },
  ];

  function getListStatus() {
    const saved = _parse(STORAGE_KEY, null);
    if (!saved) {
      return SANCTIONS_LISTS.map(l => ({ ...l, lastRefreshed: null, status: 'NOT_CHECKED', entryCount: l.lastKnownCount }));
    }
    const savedIds = new Set(saved.map(s => s.id));
    const newLists = SANCTIONS_LISTS.filter(l => !savedIds.has(l.id)).map(l => ({ ...l, lastRefreshed: null, status: 'NOT_CHECKED', entryCount: l.lastKnownCount }));
    if (newLists.length) {
      const merged = [...saved, ...newLists];
      _save(STORAGE_KEY, merged);
      return merged;
    }
    return saved;
  }

  function saveListStatus(lists) { _save(STORAGE_KEY, lists); }
  function getRefreshLog() { return _parse(REFRESH_LOG_KEY, []); }
  function saveRefreshLog(log) { _save(REFRESH_LOG_KEY, log.slice(0, 200)); }
  function getMatches() { return _parse(MATCH_LOG_KEY, []); }
  function saveMatches(arr) { _save(MATCH_LOG_KEY, arr.slice(0, 500)); }

  async function refreshList(listId) {
    const lists = getListStatus();
    const list = lists.find(l => l.id === listId);
    if (!list) return;

    // NEVER mark a list CURRENT without a real server-side fetch that produced
    // a parsed entry count + content checksum + source etag. Until the ingest
    // pipeline exists, every refresh lands in NOT_WIRED, which the screen
    // engine treats as "no current lists available" and hard-fails BLOCKED.
    // (Audit §1.1-1.3: LLM-simulated refresh was a regulator-grade defect.)
    list.status = 'NOT_WIRED';
    list.lastRefreshed = null;
    list.lastError = 'Real sanctions-list ingest pipeline not yet wired. Screening blocked — manual verification via the official regulator portal is required before any business activity.';
    list.entryCount = 0;
    list.newEntries = 0;
    list.removedEntries = 0;

    saveListStatus(lists);

    const log = getRefreshLog();
    log.unshift({
      listId: list.id,
      listName: list.name,
      status: list.status,
      date: new Date().toISOString(),
      newEntries: list.newEntries || 0,
    });
    saveRefreshLog(log);

    if (typeof logAudit === 'function') logAudit('tfs', `Refreshed ${list.name}: ${list.status}`);
    return list;
  }

  async function refreshAll() {
    if (typeof toast === 'function') toast('Marking all sanctions lists as NOT_WIRED...', 'info');
    const listIds = getListStatus().map(l => l.id);
    for (const id of listIds) {
      await refreshList(id);
    }
    if (typeof logAudit === 'function') logAudit('tfs', 'Bulk refresh — all lists marked NOT_WIRED (real ingest pipeline pending)');
    if (typeof toast === 'function') toast('Sanctions lists marked NOT_WIRED — real ingest pipeline pending. Screen manually.', 'info', 8000);
    refresh();
  }

  async function screenEntity(name, type, country) {
    if (!name) return null;

    // Sanitize inputs — defense in depth against prompt injection and
    // accidental control characters in LLM payloads.
    const safeName = String(name).replace(/[\u0000-\u001F"\\`${}]/g, '').slice(0, 200);
    const safeType = String(type || 'individual').replace(/[^A-Za-z _-]/g, '').slice(0, 40);
    const safeCountry = String(country || '').replace(/[\u0000-\u001F"\\`${}]/g, '').slice(0, 120);

    const lists = getListStatus();
    const currentLists = lists.filter(l => l.status === 'CURRENT').map(l => l.name).join(', ');
    const countryInfo = safeCountry ? ` Registered Country/Citizenship: ${safeCountry}.` : '';

    // CRITICAL: Do NOT screen against empty/stale/unwired lists.
    // Until a real server-side ingest pipeline is in place (see
    // docs/sanctions-ingest.md), this path must always BLOCK and route
    // the operator to manual verification. FATF Rec 6-7, FDL Art.22,
    // Cabinet Res 74/2020 Art.4-7.
    if (!currentLists.trim()) {
      var blocked = {
        id: 'screen-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now()),
        entity: safeName,
        type: safeType,
        country: safeCountry,
        result: 'MANUAL_REVIEW',
        matches: [],
        recommendation: 'BLOCKED: real sanctions-list ingest pipeline not yet wired. The compliance officer MUST perform manual screening against: UAE EOCN, UNSC Consolidated (scsanctions.un.org), OFAC SDN (sanctionssearch.ofac.treas.gov), EU Consolidated, UK OFSI, plus any local UAE terrorist list. Do NOT proceed with the business relationship until verification is documented.',
        date: new Date().toISOString(),
        listsChecked: 'NONE — ingest pipeline not wired',
        error: 'NO_CURRENT_LISTS',
      };
      // Persist so the audit trail captures every BLOCKED attempt.
      var bm = getMatches();
      bm.unshift(blocked);
      saveMatches(bm);
      if (typeof logAudit === 'function') logAudit('tfs', 'BLOCKED screen (no wired lists) for ' + safeName);
      if (typeof toast === 'function') toast('Screening BLOCKED — sanctions ingest pipeline not wired. Verify manually.', 'error', 8000);
      return blocked;
    }

    if (typeof callAI === 'function') {
      try {
        const data = await callAI({
          model: 'claude-haiku-4-5',
          max_tokens: 1024,
          temperature: 0,
          system: 'You are a Tier-1 compliance screening engine operating at the standard of Refinitiv World-Check, Dow Jones Risk & Compliance, and LexisNexis Bridger.\n\nRULES:\n1. NEVER fabricate sanctions designations — only report confirmed ones.\n2. Adverse media is SEPARATE from sanctions. Being investigated != being sanctioned.\n3. When adverse media IS found, report it ASSERTIVELY with full detail — sources, dates, jurisdictions, status.\n4. ALWAYS investigate the entity\'s CORPORATE NETWORK: family, business partners, directorships, beneficial ownership.\n5. Categorize adverse media: Financial Crime, Corruption, Terrorism, Organized Crime, Environmental Crime, Human Rights, Regulatory Enforcement, Litigation, Sanctions Evasion.\n\nSources: ICIJ, OCCRP, Reporter Brasil, Mongabay, Global Witness, Turkish Minute, Ahval News, Cumhuriyet, Middle East Eye, Al Jazeera, Bellingcat, BBC, Reuters, Bloomberg, FT, local media. NGOs: Transparency International, BHRRC, Amnesty, HRW. Gold: LBMA, DMCC.\n\nReturn only valid JSON.',
          messages: [{
            role: 'user',
            content: `TIER-1 COMPLIANCE SCREENING — REFINITIV/DOW JONES STANDARD:

Entity: "${safeName}" (type: ${safeType}).${countryInfo}

Check ALL: sanctions (OFAC SDN/SSI/CAPTA, UN, EU, UK OFSI, UAE EOCN, UAE Central Bank, Swiss SECO, Australian DFAT, Canadian SEMA), PEP, corporate network, and do EXHAUSTIVE adverse media investigation. For each adverse media finding provide: allegation, source, date, jurisdiction, status. Investigate corporate connections and family business ties.

Return JSON: {"result":"CLEAR|MATCH|POTENTIAL_MATCH","matches":[{"list":"source","matchType":"sanctions|adverse_media|pep|corporate_network","confidence":0.0-1.0,"details":"specific findings with sources and dates","category":"risk category"}],"recommendation":"COMPREHENSIVE Tier-1 report: SANCTIONS (confirmed only), CORPORATE NETWORK, ADVERSE MEDIA (every finding with source/date/category), PEP, REQUIRED ACTIONS, RISK LEVEL, REGULATORY BASIS."}`
          }]
        });

        const raw = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
        let cleaned2 = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        const objM2 = cleaned2.match(/\{[\s\S]*\}/);
        if (objM2) cleaned2 = objM2[0];
        let result;
        try { result = JSON.parse(cleaned2); } catch(_) { result = { result: 'POTENTIAL_MATCH', matches: [], recommendation: 'Manual review required — AI response could not be parsed' }; }

        // Enforce confidence thresholds (Refinitiv World-Check standard):
        // >= 0.9 = CONFIRMED, 0.5-0.89 = POTENTIAL, < 0.5 = DISMISS.
        // Per FDL Art.24 every match including dismissed ones must be
        // persisted to the audit trail — never silently filtered.
        if (result.matches && Array.isArray(result.matches)) {
          var dismissed = [];
          result.matches.forEach(function(m) {
            var conf = Number(m.confidence);
            if (!Number.isFinite(conf)) { m.confidence = 0.5; conf = 0.5; }
            m.confidence = Math.max(0, Math.min(1, conf));
            if (m.confidence >= 0.9) { m.threshold = 'CONFIRMED'; }
            else if (m.confidence >= 0.5) { m.threshold = 'POTENTIAL'; }
            else {
              m.threshold = 'DISMISS';
              dismissed.push(m);
              if (typeof logAudit === 'function') {
                logAudit('tfs', 'Dismissed low-confidence match (' + m.list + ') for ' + safeName + ' at conf=' + m.confidence.toFixed(2));
              }
            }
          });
          // Keep the raw set (including dismissed) so the audit trail is
          // reconstructable; downstream renderers can filter for display.
          result.dismissedMatches = dismissed;
          var actionable = result.matches.filter(function(m) { return m.threshold !== 'DISMISS'; });
          if (actionable.length === 0 && result.result === 'POTENTIAL_MATCH') {
            result.result = 'CLEAR';
            result.recommendation = (result.recommendation || '') + ' [All matches below 0.5 confidence — dismissed with audit-log per FDL Art.24.]';
          }
        }

        const match = {
          id: Date.now(),
          entity: name,
          type,
          country: country || '',
          result: result.result,
          matches: result.matches || [],
          recommendation: result.recommendation,
          date: new Date().toISOString(),
          listsChecked: currentLists,
          confidenceThresholdsApplied: true,
        };

        const matches = getMatches();
        matches.unshift(match);
        saveMatches(matches);

        return match;
      } catch (e) {
        if (e.isBillingError || (typeof isBillingError === 'function' && isBillingError(e))) {
          if (typeof toast === 'function') toast('API credits exhausted — TFS screening unavailable. Add credits at console.anthropic.com or screen manually.', 'info', 8000);
          const manualMatch = {
            id: Date.now(),
            entity: name,
            type,
            country: country || '',
            result: 'MANUAL_REVIEW',
            matches: [],
            recommendation: 'AI screening unavailable (API credits exhausted). Perform manual screening against official sanctions lists: UN Consolidated (scsanctions.un.org), OFAC SDN (ofac.treasury.gov), EU Consolidated (eeas.europa.eu), UK OFSI (gov.uk/ofsi), UAE EOCN.',
            date: new Date().toISOString(),
            listsChecked: 'Manual verification required',
          };
          const savedMatches = getMatches();
          savedMatches.unshift(manualMatch);
          saveMatches(savedMatches);
          if (typeof logAudit === 'function') logAudit('tfs', `TFS screening ${name}: MANUAL_REVIEW (API credits exhausted)`);
          return manualMatch;
        }
        if (typeof toast === 'function') toast(`TFS screening error: ${e.message}`, 'error');
      }
    }
    return null;
  }

  function isStale(list) {
    if (!list.lastRefreshed) return true;
    return (Date.now() - new Date(list.lastRefreshed).getTime()) > REFRESH_INTERVAL;
  }

  function renderTFSPanel() {
    const lists = getListStatus();
    const log = getRefreshLog();
    const matches = getMatches();

    const staleCount = lists.filter(l => isStale(l)).length;
    const currentCount = lists.filter(l => l.status === 'CURRENT' && !isStale(l)).length;

    const statusIcon = s => s === 'CURRENT' ? '🟢' : s === 'REFRESHING' ? '🔄' : s === 'ERROR' ? '🔴' : s === 'NEEDS_CHECK' ? '🟡' : '⚪';

    const listsHtml = lists.map(l => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px;border:1px solid var(--border);border-radius:3px;margin-bottom:4px;${isStale(l) ? 'border-color:var(--amber)' : ''}">
        <span style="font-size:14px">${statusIcon(l.status)}</span>
        <div style="flex:1">
          <div style="font-size:12px;font-weight:500">${esc(l.name)}</div>
          <div style="font-size:10px;color:var(--muted)">${esc(l.source)} · ~${(l.entryCount || 0).toLocaleString('en-GB')} entries · ${esc(l.frequency)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:10px;color:${isStale(l) ? 'var(--amber)' : 'var(--muted)'}">${l.lastRefreshed ? new Date(l.lastRefreshed).toLocaleDateString('en-GB') : 'Never'}</div>
          ${l.newEntries ? `<div style="font-size:10px;color:var(--amber)">+${parseInt(l.newEntries, 10)||0} new</div>` : ''}
        </div>
        <button class="btn btn-sm btn-blue" data-action="TFSRefresh.refreshListAndRefresh" data-arg="${esc(l.id).replace(/'/g,'&#39;')}" style="min-width:60px">Refresh</button>
      </div>
    `).join('');

    const tfsLabel = r => r === 'MATCH' ? 'POSITIVE MATCH' : r === 'POTENTIAL_MATCH' ? 'POTENTIAL MATCH' : r === 'MANUAL_REVIEW' ? 'MANUAL REVIEW REQUIRED' : 'NEGATIVE MATCH';
    const recentMatches = matches.slice(0, 10).map(m => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
        <div>
          <span class="badge ${m.result === 'CLEAR' ? 'b-ok' : m.result === 'MATCH' ? 'b-c' : 'b-h'}">${tfsLabel(m.result)}</span>
          <span style="font-size:12px;margin-left:6px">${esc(m.entity)}${m.country ? ' · ' + esc(m.country) : ''}${m.adverseMedia && Object.values(m.adverseMedia).some(v => v === 'Found') ? ' · <span style="color:#D94F4F">Adverse</span>' : ''}</span>
        </div>
        <span style="font-size:11px;color:var(--muted)">${new Date(m.date).toLocaleDateString('en-GB')}</span>
      </div>
    `).join('') || '<p style="color:var(--muted);font-size:13px">No TFS screening results yet.</p>';

    return `
      <div class="card">
        <div class="top-bar" style="margin-bottom:10px">
          <span class="lbl" style="margin:0">Targeted Financial Sanctions (TFS) List Manager</span>
          <div style="display:flex;gap:6px">
            <button class="btn btn-sm btn-gold" data-action="TFSRefresh.refreshAll">Refresh All Lists</button>
          </div>
        </div>
        <div class="token-note" style="margin-bottom:12px">
          <strong>Regulatory basis:</strong> FATF Recommendations 6 & 7 require immediate implementation of UN Security Council targeted financial sanctions. UAE Federal Decree-Law No.10/2025 Art.22 mandates screening against UAE local and international sanctions lists before establishing business relationships or processing transactions.
        </div>

        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px">
          <div style="background:var(--surface2);border-radius:3px;padding:10px;text-align:center">
            <div style="font-size:20px;font-weight:500;color:var(--green)">${currentCount}</div>
            <div style="font-size:10px;color:var(--muted);font-family:'Montserrat',sans-serif">Lists Current</div>
          </div>
          <div style="background:var(--surface2);border-radius:3px;padding:10px;text-align:center">
            <div style="font-size:20px;font-weight:500;color:var(--amber)">${staleCount}</div>
            <div style="font-size:10px;color:var(--muted);font-family:'Montserrat',sans-serif">Stale (>24h)</div>
          </div>
          <div style="background:var(--surface2);border-radius:3px;padding:10px;text-align:center">
            <div style="font-size:20px;font-weight:500">${lists.reduce((s, l) => s + (l.entryCount || 0), 0).toLocaleString('en-GB')}</div>
            <div style="font-size:10px;color:var(--muted);font-family:'Montserrat',sans-serif">Total Entries</div>
          </div>
        </div>

        ${listsHtml}
      </div>

      <div id="tfsScreenResult" style="display:none"></div>

      <div class="card">
        <div class="top-bar" style="margin-bottom:8px">
          <span class="lbl" style="margin:0">Recent TFS Screening Results</span>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-sm btn-green" data-action="TFSRefresh.exportPDF" style="padding:3px 10px;font-size:10px">PDF</button>
            <button class="btn btn-sm btn-green" data-action="TFSRefresh.exportDOCX" style="padding:3px 10px;font-size:10px">Word</button>
            <button class="btn btn-sm btn-red" data-action="TFSRefresh.clearResults" style="padding:3px 10px;font-size:10px">Clear</button>
          </div>
        </div>
        <div id="tfsMatchHistory">${recentMatches}</div>
      </div>
    `;
  }

  async function runScreen() {
    const name = document.getElementById('tfsEntityName')?.value?.trim();
    const type = document.getElementById('tfsEntityType')?.value;
    const country = document.getElementById('tfsCountryCitizenship')?.value?.trim() || '';
    if (!name) { toast('Enter entity name', 'error'); return; }

    const resultEl = document.getElementById('tfsScreenResult');
    if (resultEl) resultEl.innerHTML = '<p style="color:var(--muted);font-size:12px">Screening...</p>';

    const match = await screenEntity(name, type, country);
    if (match && resultEl) {
      const matchesHtml = (match.matches || []).map(m => `
        <div style="padding:6px;background:var(--surface2);border-radius:4px;margin-top:4px;font-size:12px">
          <strong>${esc(m.list)}</strong> — ${esc(m.matchType)} match (${Math.round((m.confidence || 0) * 100)}% confidence)
          <div style="color:var(--muted);font-size:11px">${esc(m.details || '')}</div>
        </div>
      `).join('');

      const tfsComp = match.result === 'MATCH' ? { label:'POSITIVE MATCH', desc:'The screened entity has been positively identified on one or more sanctions lists. Under UAE Federal Decree-Law No.10/2025 (Art.22) and FATF Recommendation 6, the business relationship must NOT proceed. Immediately freeze any assets, file a Suspicious Transaction Report (STR) via goAML, and escalate to the MLRO and senior management.', color:'#D94F4F', bg:'rgba(217,79,79,0.08)' }
        : match.result === 'POTENTIAL_MATCH' ? { label:'POTENTIAL MATCH', desc:'The screened entity has partial or similar name matches against sanctions lists. Enhanced Due Diligence (EDD) is required. The compliance officer must manually verify identity documents, cross-reference date of birth, nationality, and ID numbers to confirm or dismiss. Do NOT proceed until the match is resolved and documented.', color:'#E8A838', bg:'rgba(232,168,56,0.08)' }
        : match.result === 'MANUAL_REVIEW' ? { label:'MANUAL REVIEW REQUIRED', desc:'AI-powered screening is currently unavailable (API credits exhausted). The compliance officer must perform manual screening against all mandatory sanctions lists: UAE Local Terrorist List (EOCN), UNSC Consolidated List (Cabinet Decision 74/2020), OFAC SDN, EU Consolidated, and UK OFSI. Do NOT proceed with the business relationship until manual screening is completed and documented.', color:'#E8A838', bg:'rgba(232,168,56,0.08)' }
        : { label:'NEGATIVE MATCH', desc:'No matches found against sanctions lists. The entity is cleared for onboarding or transaction processing under standard CDD. Per FATF Rec 10 and UAE Federal Decree-Law No.10/2025 (Art.16), maintain records for a minimum of 10 years. Re-screen periodically or upon trigger events.', color:'#27AE60', bg:'rgba(39,174,96,0.08)' };

      const borderColor = match.result === 'CLEAR' ? 'var(--green)' : match.result === 'MANUAL_REVIEW' ? 'var(--amber, #E8A838)' : 'var(--red)';
      const badgeCls = match.result === 'CLEAR' ? 'b-ok' : match.result === 'MANUAL_REVIEW' ? 'b-h' : 'b-c';
      resultEl.innerHTML = `
        <div style="padding:10px;border:1px solid ${borderColor};border-radius:3px;margin-top:8px">
          <span class="badge ${badgeCls}">${tfsComp.label}</span>
          <span style="font-size:13px;margin-left:8px;font-weight:500">${esc(match.entity)}</span>
          ${matchesHtml}
          <p style="font-size:12px;margin-top:8px">${esc(match.recommendation || '')}</p>
        </div>
        <div style="margin-top:10px;padding:12px 14px;border-left:4px solid ${tfsComp.color};background:${tfsComp.bg};border-radius:3px">
          <div style="font-size:12px;font-weight:600;color:${tfsComp.color};margin-bottom:4px;font-family:'Montserrat',sans-serif">${tfsComp.label} — COMPLIANCE BASIS</div>
          <div style="font-size:12px;line-height:1.5">${tfsComp.desc}</div>
        </div>
      `;
    }
    refresh();
  }

  function refresh() {
    const el = document.getElementById('tfs-embedded-content') || document.getElementById('tab-tfs');
    if (el) el.innerHTML = renderTFSPanel();
  }

  // Auto-check for stale lists on load
  function autoCheck() {
    const lists = getListStatus();
    const stale = lists.filter(l => isStale(l));
    if (stale.length > 0 && typeof toast === 'function') {
      toast(`${stale.length} sanctions list(s) need refresh. Go to TFS tab.`, 'info');
    }
  }

  // Run auto-check after a short delay with jitter to avoid thundering
  // herd if multiple operator tabs load simultaneously.
  var _autoCheckHandle = setTimeout(autoCheck, 5000 + Math.floor(Math.random() * 5000));
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', function() { clearTimeout(_autoCheckHandle); });
  }

  function clearResults() {
    if (!confirm('Clear ALL TFS screening results? This cannot be undone.')) return;
    _remove(MATCH_LOG_KEY);
    const el = document.getElementById('tfsMatchHistory');
    if (el) el.innerHTML = '<p style="font-size:13px;color:var(--muted)">No screening results.</p>';
    toast('TFS results cleared');
  }

  function exportPDF() {
    const matches = getMatches();
    if (!matches.length) { toast('No results to export','error'); return; }
    const doc = new jspdf.jsPDF();
    const pw = doc.internal.pageSize.getWidth();
    doc.setFillColor(30,30,30); doc.rect(0,0,pw,28,'F');
    doc.setFontSize(16); doc.setTextColor(180,151,90); doc.text('TFS Screening Results Report', 14, 18);
    doc.setFontSize(8); doc.setTextColor(120); doc.text('Generated: ' + new Date().toLocaleDateString('en-GB'), pw-14, 18, {align:'right'});
    let y = 36;
    matches.forEach((m, idx) => {
      if (y > 260) { doc.addPage(); y = 20; }
      const rc = m.result==='MATCH'?[217,79,79]:m.result==='POTENTIAL_MATCH'||m.result==='MANUAL_REVIEW'?[232,168,56]:[39,174,96];
      const label = m.result==='MATCH'?'POSITIVE MATCH':m.result==='POTENTIAL_MATCH'?'POTENTIAL MATCH':m.result==='MANUAL_REVIEW'?'MANUAL REVIEW':'NEGATIVE MATCH';
      doc.setFillColor(40,40,40); doc.rect(14, y-4, pw-28, 8, 'F');
      doc.setFontSize(10); doc.setTextColor(180,151,90); doc.text((idx+1)+'. '+(m.entity||m.name||'Unknown'), 16, y+1);
      doc.setTextColor(...rc); doc.text(label, pw-16, y+1, {align:'right'});
      y += 10;
      doc.setFontSize(8); doc.setTextColor(160);
      doc.text('Type: '+(m.type||'—')+'  |  Country: '+(m.country||'—')+'  |  Date: '+new Date(m.timestamp||m.date||0).toLocaleDateString('en-GB'), 16, y);
      y += 5;
      if (m.matches && m.matches.length) {
        m.matches.forEach(hit => { doc.text('  List: '+(hit.list||'—')+' | Confidence: '+Math.round((hit.confidence||0)*100)+'%', 16, y); y += 4; });
      }
      y += 6;
    });
    doc.save('TFS_Screening_'+new Date().toISOString().slice(0,10)+'.pdf');
    toast('PDF exported','success');
  }

  function exportDOCX() {
    const matches = getMatches();
    if (!matches.length) { toast('No results to export','error'); return; }
    const colorFor = r => r==='MATCH'?'#D94F4F':r==='POTENTIAL_MATCH'||r==='MANUAL_REVIEW'?'#E8A838':'#27AE60';
    const labelFor = r => r==='MATCH'?'POSITIVE MATCH':r==='POTENTIAL_MATCH'?'POTENTIAL MATCH':r==='MANUAL_REVIEW'?'MANUAL REVIEW':'NEGATIVE MATCH';
    let html = window.wordDocHeader ? window.wordDocHeader('TFS Screening Results Report') : '<html><head><meta charset="utf-8"></head><body>';
    html += '<table><tr><th>#</th><th>Entity</th><th>Type</th><th>Country</th><th>Result</th><th>Date</th><th>Lists Checked</th></tr>';
    matches.forEach((m, idx) => {
      const hits = (m.matches||[]).map(h=>h.list).join(', ')||'—';
      html += '<tr><td>'+(idx+1)+'</td><td>'+(esc(m.entity||m.name)||'')+'</td><td>'+(esc(m.type)||'')+'</td><td>'+(esc(m.country)||'')+'</td><td style="color:'+colorFor(m.result)+';font-weight:700">'+labelFor(m.result)+'</td><td>'+new Date(m.timestamp||m.date||0).toLocaleDateString('en-GB')+'</td><td>'+esc(hits)+'</td></tr>';
    });
    html += '</table>' + (window.wordDocFooter ? window.wordDocFooter() : '</body></html>');
    if (window.downloadWordDoc) { window.downloadWordDoc(html, 'TFS_Screening_'+new Date().toISOString().slice(0,10)+'.doc'); }
    else { const blob = new Blob(['\ufeff'+html],{type:'application/msword'}); const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='TFS_Screening_'+new Date().toISOString().slice(0,10)+'.doc';a.click(); }
    toast('Word exported','success');
  }

  function exportCSV() {
    const matches = getMatches();
    if (!matches.length) { toast('No results to export','error'); return; }
    const headers = ['Entity','Type','Country','Result','Date','Lists'];
    const labelFor = r => r==='MATCH'?'POSITIVE MATCH':r==='POTENTIAL_MATCH'?'POTENTIAL MATCH':r==='MANUAL_REVIEW'?'MANUAL REVIEW':'NEGATIVE MATCH';
    // CSV formula-injection guard: prefix cells starting with = + - @ \t \r
    // so Excel/Sheets don't interpret them as formulas.
    const csvSafe = function(v) {
      var s = String(v == null ? '' : v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const rows = matches.map(m => [m.entity||m.name, m.type, m.country, labelFor(m.result), new Date(m.timestamp||m.date||0).toLocaleDateString('en-GB'), (m.matches||[]).map(h=>h.list).join('; ')]);
    const csv = [headers,...rows].map(r=>r.map(csvSafe).join(',')).join('\n');
    const blob = new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='TFS_Screening_'+new Date().toISOString().slice(0,10)+'.csv';a.click();
    toast('CSV exported','success');
  }

  function refreshListAndRefresh(id) { refreshList(id).then(function() { refresh(); }); }

  return {
    refreshList,
    refreshAll,
    refreshListAndRefresh,
    screenEntity,
    renderTFSPanel,
    runScreen,
    refresh,
    getListStatus,
    SANCTIONS_LISTS,
    clearResults,
    exportPDF,
    exportDOCX,
    exportCSV,
  };
})();
