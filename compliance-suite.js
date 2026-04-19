/**
 * Hawkeye Sterling — UAE AML/CFT Compliance Suite
 * Version 2.0.0 | April 2026
 * Regulatory: UAE FDL No.(10) of 2025 | FATF Rec. 22/23 | LBMA RGG v9
 *
 * Adds:
 *  1. Customer Risk Assessment (CRA/CDD/EDD)
 *  2. UBO Register
 *  3. 🚨 STR Case Management
 *  4. TFS Operations
 *  5. Red Flag Library
 *  6. Approval Matrix (Four-Eyes)
 *  7. Regulatory Mapping & Jurisdiction Selector
 */

// Global date format helper for dd/mm/yyyy auto-formatting
window.csFormatDateInput = function (el) {
  let v = el.value.replace(/[^0-9]/g, '');
  if (v.length > 8) v = v.slice(0, 8);
  if (v.length >= 5) v = v.slice(0, 2) + '/' + v.slice(2, 4) + '/' + v.slice(4);
  else if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
  el.value = v;
};

(function (global) {
  'use strict';

  // ─── STORAGE KEYS ────────────────────────────────────────────────────────────
  const SK = {
    CRA:       'fgl_cra_v2',
    UBO:       'fgl_ubo_v2',
    STR:       'fgl_str_cases_v2',
    TFS:       'fgl_tfs_events_v2',
    APPROVALS: 'fgl_approvals_v2',
    REGMAP:    'fgl_regmap_v2',
    JURISDICTION: 'fgl_jurisdiction_v2',
  };

  // ─── HELPERS ─────────────────────────────────────────────────────────────────
  function load(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) { console.warn('Storage error', e); }
  }
  function uid(prefix) {
    // Use crypto.randomUUID when available (all modern browsers). Fall back
    // to a timestamp + random-bytes suffix for legacy / insecure contexts.
    var suffix;
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      suffix = crypto.randomUUID().split('-')[0];
    } else if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      var buf = new Uint8Array(4);
      crypto.getRandomValues(buf);
      suffix = Array.from(buf).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
    } else {
      throw new Error('[compliance-suite.uid] Web Crypto unavailable — cannot mint a safe identifier in this context.');
    }
    return prefix + '-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-6) + '-' + suffix;
  }
  function today() { const n=new Date(); return String(n.getDate()).padStart(2,'0')+'/'+String(n.getMonth()+1).padStart(2,'0')+'/'+n.getFullYear(); }
  function parseDDMMYYYY(s) {
    if(!s) return null;
    const p=s.split('/');
    if(p.length!==3) return null;
    const dd=parseInt(p[0],10), mm=parseInt(p[1],10), yyyy=parseInt(p[2],10);
    if(isNaN(dd)||isNaN(mm)||isNaN(yyyy)) return null;
    if(mm<1||mm>12||dd<1||dd>31||yyyy<1900||yyyy>2100) return null;
    const dt=new Date(yyyy,mm-1,dd);
    if(dt.getFullYear()!==yyyy||dt.getMonth()!==mm-1||dt.getDate()!==dd) return null;
    return dt;
  }
  function fmtDate(d) { if (!d) return '—'; const dt = (typeof d==='string'&&d.includes('/')) ? parseDDMMYYYY(d) : new Date(d); if(!dt||isNaN(dt.getTime())) return d; return String(dt.getDate()).padStart(2,'0')+'/'+String(dt.getMonth()+1).padStart(2,'0')+'/'+dt.getFullYear(); }
  function fmtDateDDMMYYYY(dt) { return String(dt.getDate()).padStart(2,'0')+'/'+String(dt.getMonth()+1).padStart(2,'0')+'/'+dt.getFullYear(); }
  function esc(s) { if (!s && s!==0) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

  // ─── Decision-engine helpers (FDL Art.29 — never transmit raw subject) ─
  // Hash a subject string into an opaque 32-hex identifier so the
  // weaponized brain backend never sees the raw name. The hash is
  // intentionally non-cryptographic — it only needs to be stable so
  // the same subject produces the same id, and one-way enough that
  // backend logs cannot be reverse-mapped to a real customer.
  global.cs2HashSubject = function(subject) {
    var s = String(subject || '');
    var h1 = 0x811c9dc5;
    var h2 = 0xcbf29ce4;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 ^= c; h1 = (h1 * 0x01000193) >>> 0;
      h2 ^= (c + i); h2 = (h2 * 0x100000001b3) >>> 0;
    }
    return 'subj-' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  };
  // Resolve the active tenant id from the auth session, falling back
  // to "default" so single-tenant installs continue to work.
  global.cs2TenantId = function() {
    try {
      if (typeof AuthRBAC !== 'undefined' && AuthRBAC.getCurrentUser) {
        var u = AuthRBAC.getCurrentUser();
        if (u && u.tenantId) return String(u.tenantId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
      }
    } catch (_) { /* ignore */ }
    try {
      var t = localStorage.getItem('fgl_tenant_id');
      if (t) return String(t).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    } catch (_) { /* ignore */ }
    return 'default';
  };

  function toast(msg, type) {
    if (global.toast) { global.toast(msg, type); return; }
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#333;color:#fff;padding:12px 20px;border-radius:4px;z-index:9999;font-size:13px';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }
  function badge(status) {
    const map = {
      'Low':'#3DA876','Medium':'#E8A030','High':'#D94F4F','Very High':'#D94F4F',
      'Compliant':'#3DA876','Pending':'#E8A030','Non-Compliant':'#D94F4F',
      'Open':'#4A8FC1','Closed':'#3DA876','Filed':'#3DA876','Draft':'#E8A030',
      'Approved':'#3DA876','Rejected':'#D94F4F','Under Review':'#E8A030',
      'True Hit':'#D94F4F','False Positive':'#3DA876','Frozen':'#D94F4F',
      'Active':'#3DA876','Inactive':'#7A7870',
    };
    const col = map[status] || '#7A7870';
    return `<span style="background:${col}22;color:${col};border:1px solid ${col}44;border-radius:3px;padding:2px 8px;font-size:10px;font-family:'Montserrat',sans-serif;white-space:nowrap">${esc(status)}</span>`;
  }

  // ─── ASANA INTEGRATION ───────────────────────────────────────────────────────
  async function pushToAsana(title, notes, section) {
    try {
      if (typeof asanaFetch !== 'function') return null;
      const resolver = typeof AsanaProjectResolver !== 'undefined' ? AsanaProjectResolver : null;
      const projectId = resolver ? resolver.resolveProject('compliance') : ((typeof ASANA_PROJECT !== 'undefined' && ASANA_PROJECT) ? ASANA_PROJECT : '1213759768596515');
      const body = {
        data: {
          name: title,
          notes: notes,
          projects: [projectId],
        }
      };
      const resp = await asanaFetch('/tasks', { method: 'POST', body: JSON.stringify(body) });
      const data = await resp.json();
      return data?.data?.gid || null;
    } catch(e) { console.warn('Asana push error:', e); return null; }
  }

  // ─── INJECT TABS ─────────────────────────────────────────────────────────────
  // Red Flags + 4-Eyes append to the tail.
  // STR Cases tab removed from main-tool nav — STR workflows surface via
  // Incidents on /compliance-ops and via the Approvals queue on /workbench.
  // CRA merged into Risk Assessment tab
  // UBO tab removed from main-tool nav per product decision
  const NEW_TABS = [
    { id: 'redflags',  icon: '🚩', label: 'Red Flags', title: 'Red Flag Library' },
    { id: 'approvals2','icon':'✅', label: '4-Eyes', title: 'Four-Eyes Approval Matrix' },
  ];

  function injectTabs() {
    const nav = document.getElementById('tabsNav');
    if (!nav) return;
    NEW_TABS.forEach(t => {
      if (document.getElementById('suite-tab-' + t.id)) return;
      const el = document.createElement('div');
      el.className = 'tab';
      el.id = 'suite-tab-' + t.id;
      el.title = t.title;
      el.innerHTML = (t.icon ? t.icon + ' ' : '') + t.label;
      el.onclick = () => switchToSuiteTab(t.id);
      if (t.insertAfter) {
        const anchor = nav.querySelector('[data-arg="' + t.insertAfter + '"]');
        if (anchor && anchor.parentNode === nav) {
          anchor.insertAdjacentElement('afterend', el);
          return;
        }
      }
      nav.appendChild(el);
    });
  }

  function switchToSuiteTab(name) {
    // Deactivate all tabs and contents
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    // Activate this tab button
    const btn = document.getElementById('suite-tab-' + name);
    if (btn) btn.classList.add('active');
    // Activate content
    const content = document.getElementById('suite-content-' + name);
    if (content) content.classList.add('active');
    // Render
    const renders = {
      cra: renderCRA, ubo: renderUBO, str: renderSTR,
      redflags: renderRedFlags,
      approvals2: renderApprovals, regmap: renderRegMap,
    };
    if (renders[name]) renders[name]();
  }

  function injectContentContainers() {
    const appEl = document.querySelector('.app') || document.body;
    NEW_TABS.forEach(t => {
      if (document.getElementById('suite-content-' + t.id)) return;
      const el = document.createElement('div');
      el.className = 'tab-content';
      el.id = 'suite-content-' + t.id;
      appEl.appendChild(el);
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 1. CUSTOMER RISK ASSESSMENT (CRA / CDD / EDD)
  // Reg: UAE FDL No.(10) of 2025, Art. 12-16 | FATF Rec. 10 | FATF DPMS 2020
  // ════════════════════════════════════════════════════════════════════════════

  // Country Risk Database — editable, stored in localStorage so it survives updates
  const CRA_COUNTRY_RISK_KEY = 'fgl_country_risk_db';
  const CRA_COUNTRY_RISK_DEFAULTS = {
    // FATF Black List (High-Risk Jurisdictions Subject to Call for Action) — as of Feb 2025
    'Myanmar': 'FATF Black List', 'Iran': 'FATF Black List', 'North Korea (DPRK)': 'FATF Black List',
    // FATF Grey List (Jurisdictions Under Increased Monitoring) — as of Feb 2025
    'Algeria': 'FATF Grey List', 'Angola': 'FATF Grey List', 'Bulgaria': 'FATF Grey List',
    'Burkina Faso': 'FATF Grey List', 'Cameroon': 'FATF Grey List', 'Côte d\'Ivoire': 'FATF Grey List',
    'Croatia': 'FATF Grey List', 'Democratic Republic of Congo': 'FATF Grey List',
    'Haiti': 'FATF Grey List', 'Kenya': 'FATF Grey List', 'Lebanon': 'FATF Grey List',
    'Mali': 'FATF Grey List', 'Monaco': 'FATF Grey List', 'Mozambique': 'FATF Grey List',
    'Namibia': 'FATF Grey List', 'Nepal': 'FATF Grey List', 'Nigeria': 'FATF Grey List',
    'Philippines': 'FATF Grey List', 'Senegal': 'FATF Grey List', 'South Africa': 'FATF Grey List',
    'South Sudan': 'FATF Grey List', 'Syria': 'FATF Grey List', 'Tanzania': 'FATF Grey List',
    'Venezuela': 'FATF Grey List', 'Vietnam': 'FATF Grey List', 'Yemen': 'FATF Grey List',
    // CAHRA (Conflict-Affected and High-Risk Areas)
    'Afghanistan': 'CAHRA', 'Central African Republic': 'CAHRA', 'Libya': 'CAHRA',
    'Somalia': 'CAHRA', 'Sudan': 'CAHRA', 'Iraq': 'CAHRA', 'Colombia': 'CAHRA',
    'Democratic Republic of Congo': 'CAHRA', 'Eritrea': 'CAHRA',
    // GCC
    'UAE': 'GCC', 'Saudi Arabia': 'GCC', 'Qatar': 'GCC', 'Kuwait': 'GCC', 'Bahrain': 'GCC', 'Oman': 'GCC',
    // FATF Members / Low Risk (sample)
    'United States': 'FATF Member', 'United Kingdom': 'FATF Member', 'Germany': 'FATF Member',
    'France': 'FATF Member', 'Japan': 'FATF Member', 'Canada': 'FATF Member', 'Australia': 'FATF Member',
    'Italy': 'FATF Member', 'Spain': 'FATF Member', 'Netherlands': 'FATF Member',
    'Switzerland': 'FATF Member', 'Singapore': 'FATF Member', 'Hong Kong': 'FATF Member',
    'India': 'FATF Member', 'China': 'FATF Member',
    // Russia suspended from FATF 24 Feb 2023 — remains suspended as of 2026.
    // Treat as high-risk (scored 3) per FATF Plenary statements and UAE MoE guidance.
    'Russia': 'FATF Suspended',
    'Brazil': 'FATF Member', 'Mexico': 'FATF Member', 'Turkey': 'FATF Member',
    'South Korea': 'FATF Member', 'Israel': 'FATF Member', 'Belgium': 'FATF Member',
    'Austria': 'FATF Member', 'Sweden': 'FATF Member', 'Norway': 'FATF Member',
    'Denmark': 'FATF Member', 'Finland': 'FATF Member', 'Portugal': 'FATF Member',
    'Ireland': 'FATF Member', 'New Zealand': 'FATF Member', 'Luxembourg': 'FATF Member',
    'Greece': 'FATF Member', 'Czech Republic': 'FATF Member', 'Poland': 'FATF Member',
    'Argentina': 'FATF Member', 'Malaysia': 'FATF Member', 'Thailand': 'FATF Member',
    'Indonesia': 'FATF Member', 'Pakistan': 'FATF Member', 'Egypt': 'FATF Member',
    'Jordan': 'FATF Member', 'Morocco': 'FATF Member', 'Tunisia': 'FATF Member',
  };

  function getCountryRiskDB() {
    try {
      var saved = JSON.parse(localStorage.getItem(CRA_COUNTRY_RISK_KEY));
      if (saved && Object.keys(saved).length > 0) return saved;
    } catch(_) {}
    // Initialize with defaults
    localStorage.setItem(CRA_COUNTRY_RISK_KEY, JSON.stringify(CRA_COUNTRY_RISK_DEFAULTS));
    return { ...CRA_COUNTRY_RISK_DEFAULTS };
  }

  function saveCountryRiskDB(db) {
    localStorage.setItem(CRA_COUNTRY_RISK_KEY, JSON.stringify(db));
  }

  function getCountryRiskLevel(countryName) {
    var db = getCountryRiskDB();
    if (db[countryName]) return db[countryName];
    // Try partial match
    for (var k in db) {
      if (k.toLowerCase() === countryName.toLowerCase()) return db[k];
    }
    return 'Other';
  }

  function countryRiskToScore(riskLevel) {
    if (riskLevel === 'FATF Black List') return 4;
    if (riskLevel === 'CAHRA') return 4;
    if (riskLevel === 'FATF Suspended') return 3; // Russia since Feb 2023
    if (riskLevel === 'FATF Grey List') return 3;
    if (riskLevel === 'GCC') return 1;
    if (riskLevel === 'FATF Member') return 1;
    return 2; // Unknown/Other
  }

  // Build nationality options sorted by risk (highest first)
  function getNationalityOptions() {
    var db = getCountryRiskDB();
    var entries = Object.entries(db);
    var order = { 'FATF Black List': 0, 'CAHRA': 1, 'FATF Suspended': 2, 'FATF Grey List': 2, 'Other': 3, 'GCC': 4, 'FATF Member': 5 };
    entries.sort(function(a, b) { return (order[a[1]] || 3) - (order[b[1]] || 3) || a[0].localeCompare(b[0]); });
    return entries;
  }

  // ─── FULL RISK MODEL — Editable, persistent, auto-updatable ────────────
  const CRA_RISK_MODEL_KEY = 'fgl_cra_risk_model';

  const CRA_RISK_MODEL_DEFAULTS = {
    // Risk factor weights: { category: { option: score } }
    weights: {
      customerType:   { Individual: 1, 'Corporate Entity': 2, 'Trust/Foundation': 3, 'NPO/Charity': 3 },
      pepStatus:      { 'Not a PEP': 0, 'Former PEP (>1yr)': 2, 'Family/Associate of PEP': 2, 'Active PEP': 4 },
      businessType:   { 'Gold Retailer': 2, 'Refinery': 3, 'Jewellery Manufacturer': 2, 'Bullion Trader': 3, 'End Consumer': 1, 'Financial Institution': 2, 'Other': 2 },
      transactionVol: { 'Under AED 55,000': 0, 'AED 55,000–500,000': 1, 'AED 500,000–2M': 2, 'Over AED 2M': 3 },
      cashPayment:    { 'No': 0, 'Partial': 2, 'Majority Cash': 4 },
      sanctionsHit:   { 'No Match': 0, 'Potential Match – Pending': 3, 'Cleared False Positive': 0, 'Confirmed Match': 10 },
      sourceOfFunds:  { 'Verified/Documented': 0, 'Partially Verified': 2, 'Unverified': 4 },
      geography:      { 'UAE Only': 0, 'GCC': 1, 'FATF Member Country': 1, 'FATF Grey List Country': 3, 'FATF Black List Country': 4, 'CAHRA Region': 4, 'Other': 2 },
      adverseMedia:   { 'None': 0, 'Possible': 2, 'Confirmed': 4 },
      pfExposure:     { 'None Identified': 0, 'Low – Indirect Exposure': 1, 'Medium – Dual-Use or PF Jurisdiction': 3, 'High – Direct PF Indicators': 5 },
      deliveryChannel:{ 'Face-to-Face': 0, 'Established Intermediary': 1, 'Non-Face-to-Face / Online': 2, 'Anonymous / Unverified Channel': 4 },
      ownershipComplexity: { 'Simple / Transparent': 0, 'Moderate Layers': 1, 'Complex Multi-Jurisdiction': 3, 'Opaque / Nominee Structures': 4 },
    },
    // Score thresholds: Very High = RISK_CRITICAL (16), High = RISK_HIGH (11),
    // Medium = RISK_MEDIUM (6), Low = 0. These are the canonical MoE values
    // from src/domain/constants.ts. Never fork. CLAUDE.md Constants Architecture.
    thresholds: {
      'Very High': global.COMPLIANCE_CONSTANTS.RISK_CRITICAL, // 16
      'High':      global.COMPLIANCE_CONSTANTS.RISK_HIGH,     // 11
      'Medium':    global.COMPLIANCE_CONSTANTS.RISK_MEDIUM,   // 6
      'Low':       0,
    },
    // CDD level per rating
    cddLevels: {
      'Very High': 'EDD Required + Senior Management Approval',
      'High': 'EDD Required',
      'Medium': 'Standard CDD + Enhanced Monitoring',
      'Low': 'Standard CDD',
    },
    // Review frequency in months per rating
    reviewFrequency: { 'Very High': 3, 'High': 3, 'Medium': 6, 'Low': 12 },
    // Regulatory basis
    regulatoryBasis: 'UAE FDL No.(10) of 2025 | Art. 12-16 | FATF Rec. 10 | FATF DPMS Guidance 2020',
    // Last updated
    lastUpdated: new Date().toISOString(),
    lastUpdatedBy: 'System Default',
  };

  // Category display labels
  const CRA_CATEGORY_LABELS = {
    customerType: 'Customer Type',
    nationality: 'Nationality / Jurisdiction',
    pepStatus: 'PEP Status',
    businessType: 'Business Type',
    transactionVol: 'Transaction Volume',
    cashPayment: 'Cash Payment',
    sanctionsHit: 'Sanctions Screening',
    sourceOfFunds: 'Source of Funds',
    geography: 'Geographic Exposure',
    adverseMedia: 'Adverse Media',
    pfExposure: 'PF Exposure (EOCN)',
    deliveryChannel: 'Delivery Channel',
    ownershipComplexity: 'Ownership Complexity',
  };

  function getRiskModel() {
    try {
      var saved = JSON.parse(localStorage.getItem(CRA_RISK_MODEL_KEY));
      if (saved && saved.weights && saved.thresholds) return saved;
    } catch(_) {}
    localStorage.setItem(CRA_RISK_MODEL_KEY, JSON.stringify(CRA_RISK_MODEL_DEFAULTS));
    return JSON.parse(JSON.stringify(CRA_RISK_MODEL_DEFAULTS));
  }

  function saveRiskModel(model) {
    model.lastUpdated = new Date().toISOString();
    localStorage.setItem(CRA_RISK_MODEL_KEY, JSON.stringify(model));
  }

  // Build CRA_RISK_WEIGHTS from the stored model (for backward compatibility)
  var CRA_RISK_WEIGHTS = {};
  function refreshRiskWeights() {
    var model = getRiskModel();
    CRA_RISK_WEIGHTS = { ...model.weights };
    // Add nationality from country risk DB
    CRA_RISK_WEIGHTS.nationality = {};
    var db = getCountryRiskDB();
    for (var country in db) CRA_RISK_WEIGHTS.nationality[country] = countryRiskToScore(db[country]);
    CRA_RISK_WEIGHTS.nationality['Other'] = 2;
  }
  refreshRiskWeights();

  function calcCRAScore(form) {
    var score = 0;
    Object.keys(CRA_RISK_WEIGHTS).forEach(function(k) {
      var val = form[k];
      var w = CRA_RISK_WEIGHTS[k];
      if (w && val !== undefined) score += (w[val] || 0);
    });
    return score;
  }

  function scoreToRating(score) {
    var model = getRiskModel();
    var t = model.thresholds;
    if (score >= t['Very High']) return 'Very High';
    if (score >= t['High']) return 'High';
    if (score >= t['Medium']) return 'Medium';
    return 'Low';
  }

  function scoreToCDD(rating) {
    var model = getRiskModel();
    return model.cddLevels[rating] || 'Standard CDD';
  }

  function renderCRA() {
    const el = document.getElementById('cra-embedded-content') || document.getElementById('suite-content-cra');
    if (!el) return;
    const records = load(SK.CRA) || [];
    // Sync CRA records to Risk Assessment storage for unified view
    if (records.length > 0) {
      try {
        const raKey = 'fgl_risk_assessments';
        const existing = JSON.parse(localStorage.getItem(raKey) || '[]');
        records.forEach(r => {
          if (!existing.find(e => e.id === r.id)) {
            existing.push({ id: r.id, entityName: r.customerName, totalScore: r.score || 0, determination: r.cddLevel || r.rating, assessDate: r.createdAt?.slice(0,10) || new Date().toISOString().slice(0,10), assessedBy: r.reviewedBy || '—', source: 'CRA' });
          }
        });
        localStorage.setItem(raKey, JSON.stringify(existing));
      } catch(e) { console.warn('[CRA] Risk assessment sync error:', e); }
    }

    el.innerHTML = `
      <div class="card" style="margin-bottom:1.2rem">
        <div class="top-bar">
          <span class="sec-title">👤 Customer Risk Assessment — CDD/EDD</span>
          <span style="font-size:11px;color:var(--muted)">UAE FDL No.(10) of 2025 | Art. 12-16 | FATF Rec. 10</span>
          <button class="btn btn-sm btn-blue" style="padding:6px 12px;font-size:11px" data-action="suiteOpenCRAForm">+ New Assessment</button>
          <button class="btn btn-sm btn-gold" style="padding:6px 12px;font-size:11px" data-action="suiteOpenRiskConfig">Risk Model Config</button>
          <button class="btn btn-sm btn-red" style="padding:6px 12px;font-size:11px" data-action="suiteAutoUpdateRiskModel">Auto-Update Risk Model</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:1rem">
          <div class="metric m-c"><div class="metric-num">${records.filter(r=>r.rating==='Very High').length}</div><div class="metric-lbl">Very High Risk</div></div>
          <div class="metric m-h"><div class="metric-num">${records.filter(r=>r.rating==='High').length}</div><div class="metric-lbl">High Risk</div></div>
          <div class="metric m-m"><div class="metric-num">${records.filter(r=>r.rating==='Medium').length}</div><div class="metric-lbl">Medium Risk</div></div>
          <div class="metric m-ok"><div class="metric-num">${records.filter(r=>r.rating==='Low').length}</div><div class="metric-lbl">Low Risk</div></div>
        </div>
        <div id="cra-list">
          ${records.length === 0 ? '<p style="color:var(--muted);font-size:13px;text-align:center;padding:2rem">No customer risk assessments recorded. Click "+ New Assessment" to begin.</p>' : ''}
          ${records.map((r,i) => `
            <div class="finding ${r.rating==='Very High'||r.rating==='High'?'f-critical':'f-'+r.rating.toLowerCase().replace(' ','-')}" style="margin-bottom:8px">
              <div class="f-head">
                <div class="f-head-left">
                  <div>
                    <div class="f-title">${esc(r.customerName)} ${badge(r.rating)}</div>
                    <div class="f-body" style="margin-top:4px">${esc(r.customerType)} | ${esc(r.nationality)} | Score: ${r.score} | CDD: ${esc(r.cddLevel)}</div>
                    <div class="f-ref">Assessed: ${fmtDate(r.date)} | Ref: ${r.id} | Next Review: ${fmtDate(r.nextReview)}</div>
                  </div>
                </div>
                <div style="display:flex;gap:6px;align-items:center">
                  <button class="btn btn-sm btn-gold" data-action="suiteEditCRA" data-arg="${i}">Edit</button>
                  <button class="btn btn-sm btn-blue" data-action="suiteSyncCRAToAsana" data-arg="${i}">Asana</button>
                  <button class="btn btn-sm btn-red" data-action="suiteDeleteCRA" data-arg="${i}">Delete</button>
                </div>
              </div>
              ${r.notes ? `<div class="rec">${esc(r.notes)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>

      <!-- CRA Form Modal -->
      <div class="modal-overlay" id="craModal">
        <div class="modal" style="max-width:600px;width:95%">
          <button class="modal-close" data-action="_closeModal" data-arg="craModal">✕</button>
          <div class="modal-title">Customer Risk Assessment Form</div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:1rem;font-family:'Montserrat',sans-serif">UAE FDL No.(10) of 2025 | FATF Rec. 10 | FATF DPMS Guidance 2020</div>

          <input type="hidden" id="cra-edit-idx" value="-1">

          <div class="row row-2">
            <div><span class="lbl">Customer Full Name *</span><input id="cra-name" placeholder="Full legal name"/></div>
            <div><span class="lbl">Customer ID / Account Ref</span><input id="cra-ref" placeholder="Internal reference"/></div>
          </div>
          <div class="row row-2">
            <div><span class="lbl">Customer Type *</span>
              <select id="cra-type"><option value="">Select</option>${Object.keys(CRA_RISK_WEIGHTS.customerType).map(v=>`<option>${v}</option>`).join('')}</select>
            </div>
            <div><span class="lbl">Nationality / Jurisdiction *</span>
              <select id="cra-nationality"><option value="">Select Country</option>${getNationalityOptions().map(function(e){
                var c=e[0], r=e[1];
                var riskLabel = r === 'FATF Black List' ? ' ⚫ BLACK LIST' : r === 'CAHRA' ? ' 🔴 CAHRA' : r === 'FATF Grey List' ? ' 🟡 GREY LIST' : r === 'GCC' ? ' 🟢 GCC' : r === 'FATF Member' ? ' 🟢 FATF' : '';
                return '<option value="'+c+'">'+c+riskLabel+'</option>';
              }).join('')}<option value="Other">Other</option></select>
            </div>
          </div>
          <div class="row row-2">
            <div><span class="lbl">Business Type *</span>
              <select id="cra-biztype"><option value="">Select</option>${Object.keys(CRA_RISK_WEIGHTS.businessType).map(v=>`<option>${v}</option>`).join('')}</select>
            </div>
            <div><span class="lbl">PEP Status *</span>
              <select id="cra-pep"><option value="">Select</option>${Object.keys(CRA_RISK_WEIGHTS.pepStatus).map(v=>`<option>${v}</option>`).join('')}</select>
            </div>
          </div>
          <div class="row row-2">
            <div><span class="lbl">Expected Transaction Volume</span>
              <select id="cra-vol"><option value="">Select</option>${Object.keys(CRA_RISK_WEIGHTS.transactionVol).map(v=>`<option>${v}</option>`).join('')}</select>
            </div>
            <div><span class="lbl">Cash Payment Proportion</span>
              <select id="cra-cash"><option value="">Select</option>${Object.keys(CRA_RISK_WEIGHTS.cashPayment).map(v=>`<option>${v}</option>`).join('')}</select>
            </div>
          </div>
          <div class="row row-2">
            <div><span class="lbl">Sanctions Screening Result *</span>
              <select id="cra-sanctions"><option value="">Select</option>${Object.keys(CRA_RISK_WEIGHTS.sanctionsHit).map(v=>`<option>${v}</option>`).join('')}</select>
            </div>
            <div><span class="lbl">Source of Funds Verification</span>
              <select id="cra-sof"><option value="">Select</option>${Object.keys(CRA_RISK_WEIGHTS.sourceOfFunds).map(v=>`<option>${v}</option>`).join('')}</select>
            </div>
          </div>
          <div class="row row-2">
            <div><span class="lbl">Geographic Exposure</span>
              <select id="cra-geo"><option value="">Select</option>${Object.keys(CRA_RISK_WEIGHTS.geography).map(v=>`<option>${v}</option>`).join('')}</select>
            </div>
            <div><span class="lbl">Adverse Media Check</span>
              <select id="cra-media"><option value="">Select</option>${Object.keys(CRA_RISK_WEIGHTS.adverseMedia).map(v=>`<option>${v}</option>`).join('')}</select>
            </div>
          </div>
          <div class="row row-3">
            <div><span class="lbl">PF Exposure (EOCN)</span>
              <select id="cra-pf"><option value="">Select</option>${Object.keys(CRA_RISK_WEIGHTS.pfExposure).map(v=>`<option>${v}</option>`).join('')}</select>
            </div>
            <div><span class="lbl">Delivery Channel</span>
              <select id="cra-delivery"><option value="">Select</option>${Object.keys(CRA_RISK_WEIGHTS.deliveryChannel).map(v=>`<option>${v}</option>`).join('')}</select>
            </div>
            <div><span class="lbl">Ownership Complexity</span>
              <select id="cra-ownership"><option value="">Select</option>${Object.keys(CRA_RISK_WEIGHTS.ownershipComplexity).map(v=>`<option>${v}</option>`).join('')}</select>
            </div>
          </div>

          <div id="cra-score-box" style="background:var(--surface2);border-radius:4px;padding:12px;margin:10px 0;display:none">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span class="lbl" style="margin:0">CALCULATED RISK RATING</span>
              <span id="cra-score-display" style="font-size:22px;font-weight:700;font-family:'Cinzel',serif"></span>
            </div>
            <div id="cra-cdd-display" style="font-size:12px;color:var(--muted);margin-top:4px;font-family:'Montserrat',sans-serif"></div>
          </div>

          <div><span class="lbl">Compliance Notes / Observations</span>
            <textarea id="cra-notes" placeholder="Document any specific risk observations, mitigating factors, or actions required..." style="min-height:80px"></textarea>
          </div>
          <div class="row row-2" style="margin-top:10px">
            <div><span class="lbl">Assessment Date</span><input type="text" id="cra-date" value="${today()}" placeholder="dd/mm/yyyy" oninput="csFormatDateInput(this)" maxlength="10"/></div>
            <div><span class="lbl">Next Review Date</span><input type="text" id="cra-review" placeholder="dd/mm/yyyy" oninput="csFormatDateInput(this)" maxlength="10"/></div>
          </div>

          <div style="display:flex;gap:8px;margin-top:1rem">
            <button class="btn btn-gold" data-action="suiteCalcAndSaveCRA" style="flex:1">Calculate Score & Save</button>
            <button class="btn btn-sm" data-action="_closeModal" data-arg="craModal" style="padding:12px 20px">Cancel</button>
          </div>
        </div>
      </div>
    `;
  }

  global.renderCRA = renderCRA;
  global.suiteOpenCRAForm = function() {
    document.getElementById('cra-edit-idx').value = '-1';
    ['cra-name','cra-ref','cra-notes'].forEach(id => { const e = document.getElementById(id); if(e) e.value=''; });
    ['cra-type','cra-nationality','cra-biztype','cra-pep','cra-vol','cra-cash','cra-sanctions','cra-sof','cra-geo','cra-media'].forEach(id => { const e = document.getElementById(id); if(e) e.value=''; });
    document.getElementById('cra-date').value = today();
    document.getElementById('cra-review').value = '';
    const sb = document.getElementById('cra-score-box');
    if (sb) sb.style.display = 'none';
    document.getElementById('craModal').classList.add('open');
  };

  global.suiteEditCRA = function(idx) {
    const records = load(SK.CRA) || [];
    const r = records[idx];
    if (!r) return;
    document.getElementById('cra-edit-idx').value = idx;
    document.getElementById('cra-name').value = r.customerName || '';
    document.getElementById('cra-ref').value = r.ref || '';
    document.getElementById('cra-type').value = r.customerType || '';
    document.getElementById('cra-nationality').value = r.nationality || '';
    document.getElementById('cra-biztype').value = r.businessType || '';
    document.getElementById('cra-pep').value = r.pepStatus || '';
    document.getElementById('cra-vol').value = r.transactionVol || '';
    document.getElementById('cra-cash').value = r.cashPayment || '';
    document.getElementById('cra-sanctions').value = r.sanctionsHit || '';
    document.getElementById('cra-sof').value = r.sourceOfFunds || '';
    document.getElementById('cra-geo').value = r.geography || '';
    document.getElementById('cra-media').value = r.adverseMedia || '';
    document.getElementById('cra-pf').value = r.pfExposure || '';
    document.getElementById('cra-delivery').value = r.deliveryChannel || '';
    document.getElementById('cra-ownership').value = r.ownershipComplexity || '';
    document.getElementById('cra-notes').value = r.notes || '';
    document.getElementById('cra-date').value = r.date || today();
    document.getElementById('cra-review').value = r.nextReview || '';
    document.getElementById('craModal').classList.add('open');
  };

  global.suiteCalcAndSaveCRA = function() {
    const name = document.getElementById('cra-name').value.trim();
    if (!name) { toast('Customer name is required', 'error'); return; }
    const form = {
      customerType:   document.getElementById('cra-type').value,
      nationality:    document.getElementById('cra-nationality').value,
      pepStatus:      document.getElementById('cra-pep').value,
      businessType:   document.getElementById('cra-biztype').value,
      transactionVol: document.getElementById('cra-vol').value,
      cashPayment:    document.getElementById('cra-cash').value,
      sanctionsHit:   document.getElementById('cra-sanctions').value,
      sourceOfFunds:  document.getElementById('cra-sof').value,
      geography:      document.getElementById('cra-geo').value,
      adverseMedia:   document.getElementById('cra-media').value,
      pfExposure:     document.getElementById('cra-pf').value,
      deliveryChannel:document.getElementById('cra-delivery').value,
      ownershipComplexity: document.getElementById('cra-ownership').value,
    };
    const score = calcCRAScore(form);
    const rating = scoreToRating(score);
    const cddLevel = scoreToCDD(rating);

    const sb = document.getElementById('cra-score-box');
    if (sb) {
      sb.style.display = 'block';
      const colors = {'Low':'#3DA876','Medium':'#E8A030','High':'#D94F4F','Very High':'#D94F4F'};
      document.getElementById('cra-score-display').style.color = colors[rating] || '#fff';
      document.getElementById('cra-score-display').textContent = `${rating} (${score} pts)`;
      document.getElementById('cra-cdd-display').textContent = cddLevel;
    }

    const records = load(SK.CRA) || [];
    const editIdx = parseInt(document.getElementById('cra-edit-idx').value, 10);
    const record = {
      id: editIdx >= 0 ? records[editIdx].id : uid('CRA'),
      customerName: name,
      ref: document.getElementById('cra-ref').value.trim(),
      ...form, score, rating, cddLevel,
      notes: document.getElementById('cra-notes').value.trim(),
      date: document.getElementById('cra-date').value || today(),
      nextReview: document.getElementById('cra-review').value,
      asanaGid: editIdx >= 0 ? (records[editIdx].asanaGid || null) : null,
      updatedAt: new Date().toISOString(),
    };

    if (editIdx >= 0) { records[editIdx] = record; } else { records.unshift(record); }
    save(SK.CRA, records);
    document.getElementById('craModal').classList.remove('open');
    toast(`CRA saved — ${name}: ${rating}`, 'success');
    renderCRA();

    // Brain hook: if the CRA logs a sanctions hit, escalate to the brain
    // immediately. The brain routes confirmed matches to the 24h freeze
    // protocol (Cabinet Res 74/2020) and escalates potential matches to
    // the Compliance Officer for four-eyes review.
    try {
      if (typeof global.__brainNotify === 'function' && form.sanctionsHit && form.sanctionsHit !== 'No Match') {
        var _score = form.sanctionsHit === 'Confirmed Match' ? 0.95
                   : form.sanctionsHit === 'Potential Match – Pending' ? 0.7
                   : 0.2;
        global.__brainNotify({
          kind: 'sanctions_match',
          severity: _score >= 0.9 ? 'critical' : _score >= 0.5 ? 'high' : 'medium',
          summary: 'CRA sanctions hit: ' + form.sanctionsHit + ' on ' + name,
          subject: name,
          matchScore: _score,
          refId: record.id,
          meta: {
            rating: rating,
            cddLevel: cddLevel,
            pepStatus: form.pepStatus,
            geography: form.geography,
            nationality: form.nationality,
          },
        });
        // Decision engine hook: route the sanctions-hit case through the
        // weaponized brain so the 24h freeze countdown + four-eyes path
        // start automatically when this request lands at /api/decision.
        if (typeof global.__decisionNotify === 'function') {
          var _hashed = (typeof global.cs2HashSubject === 'function')
            ? global.cs2HashSubject(name)
            : 'subject-' + record.id;
          global.__decisionNotify({
            tenantId: (typeof global.cs2TenantId === 'function' ? global.cs2TenantId() : 'default'),
            topic: 'CRA sanctions hit',
            entity: {
              id: record.id,
              name: _hashed,
              isSanctionsConfirmed: form.sanctionsHit === 'Confirmed Match',
              features: {
                priorAlerts90d: 1,
                txValue30dAED: 0,
                nearThresholdCount30d: 0,
                crossBorderRatio30d: form.geography && /CAHRA|Black|Grey|Cross/i.test(form.geography) ? 1 : 0,
                isPep: !!(form.pepStatus && /PEP/i.test(form.pepStatus) && !/Not a PEP/i.test(form.pepStatus)),
                highRiskJurisdiction: !!(form.geography && /CAHRA|Black|Grey/i.test(form.geography)),
                hasAdverseMedia: !!(form.adverseMedia && /Confirmed|Possible/i.test(form.adverseMedia)),
                daysSinceOnboarding: 0,
                sanctionsMatchScore: _score,
                cashRatio30d: 0,
              },
              actorUserId: (typeof AuthRBAC !== 'undefined' && AuthRBAC.getCurrentUser && AuthRBAC.getCurrentUser()?.id) || 'unknown',
            },
            sealAttestation: true,
          });
        }
      }
    } catch (_brainErr) { /* best-effort */ }

    // Auto-sync to Asana
    var craIdx = editIdx >= 0 ? editIdx : 0;
    try {
      if (typeof autoSyncToAsana === 'function') {
        var craTitle = '[CRA] ' + name + ' — ' + rating + ' Risk';
        var craNotes = 'Customer Risk Assessment: ' + record.id
          + '\nCustomer: ' + name
          + '\nType: ' + form.customerType + ' | Nationality: ' + form.nationality
          + '\nRisk Score: ' + score + ' | Rating: ' + rating
          + '\nCDD Level: ' + cddLevel
          + '\nPEP: ' + form.pepStatus + ' | Sanctions Hit: ' + form.sanctionsHit
          + '\nAdverse Media: ' + form.adverseMedia
          + '\nNext Review: ' + (record.nextReview || 'TBD')
          + (record.notes ? '\nNotes: ' + record.notes : '')
          + '\n\nRef: UAE FDL No.10/2025 Art.12-16, FATF Rec 10';
        var craDays = rating === 'Very High' || rating === 'High' ? 3 : 14;
        autoSyncToAsana(craTitle, craNotes, craDays).then(function(gid) {
          if (gid) { var recs = load(SK.CRA)||[]; if(recs[craIdx]) { recs[craIdx].asanaGid = gid; save(SK.CRA, recs); } toast('CRA synced to Asana','success',2000); }
        }).catch(function(e){ console.warn('[CRA] Asana sync failed:', e); });
      }
    } catch(e) { console.warn('[CRA] Post-save error:', e); }
  };

  global.suiteDeleteCRA = function(idx) {
    if (!confirm('Delete this customer risk assessment?')) return;
    const records = load(SK.CRA) || [];
    records.splice(idx, 1);
    save(SK.CRA, records);
    renderCRA();
  };

  // Update Country Risk Database using AI + live web search
  global.suiteUpdateCountryRisk = async function() {
    if (typeof callAI !== 'function') { toast('No AI provider configured', 'error'); return; }
    toast('Updating country risk data — fetching latest FATF lists...', 'info', 30000);

    // Use Tavily for live search if available
    var liveData = '';
    if (typeof searchWebForScreening === 'function') {
      try {
        var webResults = await searchWebForScreening('FATF grey list black list 2025 2026', 'regulation', '');
        if (webResults) liveData = '\n\nLIVE WEB SEARCH RESULTS:\n' + webResults;
      } catch(e) { console.warn('[RiskModel] Web search failed:', e); }
    }

    try {
      var data = await callAI({
        model: 'claude-haiku-4-5', max_tokens: 2000, temperature: 0,
        system: 'You are a regulatory compliance specialist. Return ONLY valid JSON — a single object where keys are country names and values are one of: "FATF Black List", "FATF Grey List", "CAHRA", "GCC", "FATF Member", or "Other".',
        messages: [{ role: 'user', content: 'Provide the CURRENT and most up-to-date country risk classifications:\n\n1. FATF Black List (High-Risk Jurisdictions Subject to a Call for Action) — list ALL countries currently on it\n2. FATF Grey List (Jurisdictions Under Increased Monitoring) — list ALL countries currently on it\n3. CAHRA (Conflict-Affected and High-Risk Areas per EU/OECD) — list all\n4. GCC member states\n5. FATF Member countries\n\nReturn a JSON object: {"country name": "risk classification", ...}\nInclude at least 80 countries covering all the above categories. Countries not in any special list should be "FATF Member" if they are, or "Other".' + liveData }]
      });

      var raw = (data.content || []).filter(function(b){return b.type==='text'}).map(function(b){return b.text}).join('');
      var cleaned = raw.replace(/```json?\n?/g,'').replace(/```/g,'').trim();
      var m = cleaned.match(/\{[\s\S]*\}/);
      if (m) {
        var newDB = JSON.parse(m[0]);
        if (Object.keys(newDB).length > 20) {
          saveCountryRiskDB(newDB);
          // Refresh dynamic weights
          CRA_RISK_WEIGHTS.nationality = {};
          for (var c in newDB) CRA_RISK_WEIGHTS.nationality[c] = countryRiskToScore(newDB[c]);
          CRA_RISK_WEIGHTS.nationality['Other'] = 2;
          toast('Country risk data updated — ' + Object.keys(newDB).length + ' countries refreshed', 'success');
          renderCRA();
          return;
        }
      }
      toast('Could not parse updated country risk data', 'error');
    } catch(e) {
      var bm = (e.message||'').toLowerCase();
      if (e.isBillingError || bm.indexOf('credit')!==-1 || bm.indexOf('balance')!==-1 || bm.indexOf('billing')!==-1 || bm.indexOf('insufficient')!==-1 || bm.indexOf('quota')!==-1) { toast('API credits exhausted — update unavailable. Add credits at console.anthropic.com.','info',8000); }
      else { toast('Country risk update failed: ' + e.message, 'error'); }
    }
  };

  // View/Edit Country Risk Database
  global.suiteViewCountryRisk = function() {
    var db = getCountryRiskDB();
    var entries = Object.entries(db);
    var order = { 'FATF Black List': 0, 'CAHRA': 1, 'FATF Suspended': 2, 'FATF Grey List': 2, 'Other': 3, 'GCC': 4, 'FATF Member': 5 };
    entries.sort(function(a, b) { return (order[a[1]] || 3) - (order[b[1]] || 3) || a[0].localeCompare(b[0]); });

    var colorFor = function(r) { return r === 'FATF Black List' ? '#D94F4F' : r === 'CAHRA' ? '#D94F4F' : r === 'FATF Grey List' ? '#E8A838' : r === 'GCC' ? '#3DA876' : r === 'FATF Member' ? '#3DA876' : 'var(--muted)'; };
    var countByRisk = {};
    entries.forEach(function(e) { countByRisk[e[1]] = (countByRisk[e[1]] || 0) + 1; });

    var html = '<div class="modal-overlay" id="countryRiskModal"><div class="modal" style="max-width:700px;width:95%;max-height:90vh">';
    html += '<button class="modal-close" data-action="_closeModal" data-arg="countryRiskModal">✕</button>';
    html += '<div class="modal-title">Country Risk Database</div>';
    html += '<div class="token-note" style="margin-bottom:1rem"><strong>FATF & CAHRA Classifications:</strong> This database determines risk scoring in the CRA. Update it when FATF publishes new grey/black list changes (typically every February, June, October). Click "Update Country Risk Data" to auto-refresh from the latest sources.</div>';

    // Summary badges
    html += '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">';
    ['FATF Black List','CAHRA','FATF Grey List','GCC','FATF Member','Other'].forEach(function(r) {
      if (countByRisk[r]) html += '<span style="font-size:10px;padding:3px 8px;border-radius:4px;background:' + colorFor(r) + '22;color:' + colorFor(r) + ';border:1px solid ' + colorFor(r) + '44;font-weight:600">' + r + ': ' + countByRisk[r] + '</span>';
    });
    html += '</div>';

    // Add country form
    html += '<div style="display:flex;gap:6px;margin-bottom:10px">';
    html += '<input id="crisk-new-country" placeholder="Country name" style="flex:1;font-size:12px">';
    html += '<select id="crisk-new-level" style="font-size:12px"><option>FATF Black List</option><option>FATF Grey List</option><option>CAHRA</option><option>GCC</option><option>FATF Member</option><option>Other</option></select>';
    html += '<button class="btn btn-sm btn-gold" data-action="suiteAddCountryRisk" style="padding:4px 10px;font-size:11px">Add</button>';
    html += '</div>';

    // Country table
    html += '<div style="max-height:400px;overflow-y:auto;border:1px solid var(--border);border-radius:3px">';
    html += '<div style="display:grid;grid-template-columns:1fr 140px 60px;padding:6px 10px;background:rgba(180,151,90,0.1);font-size:10px;font-weight:600;color:var(--gold);font-family:\'Montserrat\',sans-serif;border-bottom:1px solid var(--border)"><span>COUNTRY</span><span>CLASSIFICATION</span><span></span></div>';
    entries.forEach(function(e) {
      html += '<div style="display:grid;grid-template-columns:1fr 140px 60px;padding:4px 10px;border-bottom:1px solid var(--border);font-size:11px;align-items:center">';
      html += '<span>' + e[0] + '</span>';
      html += '<span style="color:' + colorFor(e[1]) + ';font-weight:600;font-size:10px">' + e[1] + '</span>';
      html += '<button class="btn btn-sm btn-red" onclick="suiteRemoveCountryRisk(\'' + e[0].replace(/'/g,"\\'") + '\')" style="padding:1px 6px;font-size:9px">✕</button>';
      html += '</div>';
    });
    html += '</div>';

    html += '<div style="display:flex;gap:8px;margin-top:1rem"><button class="btn btn-sm" data-action="_closeModal" data-arg="countryRiskModal" style="flex:1;padding:10px">Close</button></div>';
    html += '</div></div>';

    // Remove old modal if exists
    var old = document.getElementById('countryRiskModal');
    if (old) old.remove();
    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById('countryRiskModal').classList.add('open');
  };

  global.suiteAddCountryRisk = function() {
    var name = document.getElementById('crisk-new-country').value.trim();
    var level = document.getElementById('crisk-new-level').value;
    if (!name) { toast('Enter country name', 'error'); return; }
    var db = getCountryRiskDB();
    db[name] = level;
    saveCountryRiskDB(db);
    CRA_RISK_WEIGHTS.nationality[name] = countryRiskToScore(level);
    toast(name + ' → ' + level, 'success');
    suiteViewCountryRisk(); // refresh modal
  };

  global.suiteRemoveCountryRisk = function(name) {
    var db = getCountryRiskDB();
    delete db[name];
    saveCountryRiskDB(db);
    delete CRA_RISK_WEIGHTS.nationality[name];
    toast(name + ' removed', 'success');
    suiteViewCountryRisk();
  };

  // ─── RISK MODEL CONFIGURATION — Edit all weights, thresholds, CDD levels ───
  global.suiteOpenRiskConfig = function() {
    var model = getRiskModel();
    var html = '<div class="modal-overlay" id="riskConfigModal"><div class="modal" style="max-width:800px;width:95%;max-height:92vh">';
    html += '<button class="modal-close" data-action="_closeModal" data-arg="riskConfigModal">✕</button>';
    html += '<div class="modal-title">Risk Model Configuration</div>';
    html += '<div class="token-note" style="margin-bottom:1rem"><strong>Risk Appetite & Regulatory Configuration:</strong> Modify risk factor weights, score thresholds, CDD levels, and review frequencies. Changes take effect immediately for all new assessments. Last updated: ' + new Date(model.lastUpdated).toLocaleDateString('en-GB') + ' by ' + (model.lastUpdatedBy || 'System') + '</div>';

    // Score Thresholds
    html += '<div style="background:var(--surface2);border-radius:4px;padding:14px;margin-bottom:12px;border-left:3px solid var(--gold)">';
    html += '<div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:8px;font-family:\'Montserrat\',sans-serif">SCORE THRESHOLDS & CDD LEVELS</div>';
    html += '<div style="display:grid;grid-template-columns:100px 80px 1fr 80px;gap:6px;font-size:11px;align-items:center">';
    html += '<span style="font-weight:600;color:var(--muted)">Rating</span><span style="font-weight:600;color:var(--muted)">Min Score</span><span style="font-weight:600;color:var(--muted)">CDD Level</span><span style="font-weight:600;color:var(--muted)">Review (months)</span>';
    ['Very High','High','Medium','Low'].forEach(function(r) {
      var color = r === 'Very High' || r === 'High' ? 'var(--red)' : r === 'Medium' ? 'var(--amber)' : 'var(--green)';
      html += '<span style="color:' + color + ';font-weight:600">' + r + '</span>';
      html += '<input type="number" id="rc-thresh-' + r.replace(/ /g,'_') + '" value="' + (model.thresholds[r] || 0) + '" min="0" max="50" style="font-size:11px;padding:4px;width:70px">';
      html += '<input id="rc-cdd-' + r.replace(/ /g,'_') + '" value="' + (model.cddLevels[r] || '') + '" style="font-size:11px;padding:4px">';
      html += '<input type="number" id="rc-review-' + r.replace(/ /g,'_') + '" value="' + (model.reviewFrequency[r] || 12) + '" min="1" max="60" style="font-size:11px;padding:4px;width:70px">';
    });
    html += '</div></div>';

    // Risk Factor Weights
    var weightCategories = ['customerType','pepStatus','businessType','transactionVol','cashPayment','sanctionsHit','sourceOfFunds','geography','adverseMedia'];
    weightCategories.forEach(function(cat) {
      var label = CRA_CATEGORY_LABELS[cat] || cat;
      var weights = model.weights[cat] || {};
      html += '<div style="background:var(--surface2);border-radius:3px;padding:10px 12px;margin-bottom:8px">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
      html += '<span style="font-size:11px;font-weight:600;color:var(--gold);font-family:\'Montserrat\',sans-serif">' + label.toUpperCase() + '</span>';
      html += '<button class="btn btn-sm" onclick="suiteAddRiskOption(\'' + cat + '\')" style="padding:2px 8px;font-size:9px">+ Add Option</button>';
      html += '</div>';
      html += '<div id="rc-cat-' + cat + '" style="display:grid;grid-template-columns:1fr 60px 30px;gap:4px;font-size:11px">';
      Object.entries(weights).forEach(function(e) {
        html += '<span style="padding:2px 0">' + e[0] + '</span>';
        html += '<input type="number" class="rc-weight" data-cat="' + cat + '" data-opt="' + e[0].replace(/"/g,'&quot;') + '" value="' + e[1] + '" min="0" max="20" style="font-size:11px;padding:2px 4px;width:55px">';
        html += '<button class="btn btn-sm btn-red" onclick="suiteRemoveRiskOption(\'' + cat + '\',\'' + e[0].replace(/'/g,"\\'") + '\')" style="padding:1px 4px;font-size:8px">✕</button>';
      });
      html += '</div></div>';
    });

    // Regulatory basis
    html += '<div style="margin-top:8px"><span class="lbl">Regulatory Basis</span>';
    html += '<input id="rc-reg-basis" value="' + (model.regulatoryBasis || '').replace(/"/g,'&quot;') + '" style="font-size:11px"></div>';

    // Country Risk DB link
    html += '<div style="margin-top:8px;display:flex;gap:8px">';
    html += '<button class="btn btn-sm btn-gold" data-action="suiteViewCountryRisk" style="padding:6px 12px;font-size:11px">Edit Country Risk Database</button>';
    html += '<button class="btn btn-sm btn-red" data-action="suiteAutoUpdateRiskModel" style="padding:6px 12px;font-size:11px">Auto-Update from Regulations</button>';
    html += '</div>';

    // Save / Cancel
    html += '<div style="display:flex;gap:8px;margin-top:1rem">';
    html += '<button class="btn btn-gold" data-action="suiteSaveRiskConfig" style="flex:1;padding:12px;font-size:13px;font-weight:600">Save Risk Model</button>';
    html += '<button class="btn btn-sm" data-action="_closeModal" data-arg="riskConfigModal" style="padding:12px 20px">Cancel</button>';
    html += '</div>';

    html += '</div></div>';

    var old = document.getElementById('riskConfigModal');
    if (old) old.remove();
    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById('riskConfigModal').classList.add('open');
  };

  global.suiteSaveRiskConfig = function() {
    var model = getRiskModel();
    // Save thresholds
    ['Very High','High','Medium','Low'].forEach(function(r) {
      var key = r.replace(/ /g,'_');
      model.thresholds[r] = parseInt(document.getElementById('rc-thresh-' + key).value, 10) || 0;
      model.cddLevels[r] = document.getElementById('rc-cdd-' + key).value;
      model.reviewFrequency[r] = parseInt(document.getElementById('rc-review-' + key).value, 10) || 12;
    });
    // Save weights
    document.querySelectorAll('.rc-weight').forEach(function(el) {
      var cat = el.getAttribute('data-cat');
      var opt = el.getAttribute('data-opt');
      if (!model.weights[cat]) model.weights[cat] = {};
      model.weights[cat][opt] = parseInt(el.value, 10) || 0;
    });
    model.regulatoryBasis = document.getElementById('rc-reg-basis').value;
    model.lastUpdatedBy = 'Manual Edit';
    saveRiskModel(model);
    refreshRiskWeights();
    document.getElementById('riskConfigModal').classList.remove('open');
    toast('Risk model saved — all weights and thresholds updated', 'success');
    renderCRA();
  };

  global.suiteAddRiskOption = function(cat) {
    var name = prompt('Enter new option name for ' + (CRA_CATEGORY_LABELS[cat] || cat) + ':');
    if (!name) return;
    var score = parseInt(prompt('Enter risk score (0-10) for "' + name + '":'), 10);
    if (isNaN(score)) return;
    var model = getRiskModel();
    if (!model.weights[cat]) model.weights[cat] = {};
    model.weights[cat][name] = score;
    saveRiskModel(model);
    refreshRiskWeights();
    suiteOpenRiskConfig(); // refresh modal
  };

  global.suiteRemoveRiskOption = function(cat, opt) {
    var model = getRiskModel();
    if (model.weights[cat]) delete model.weights[cat][opt];
    saveRiskModel(model);
    refreshRiskWeights();
    suiteOpenRiskConfig();
  };

  // Auto-Update Risk Model using AI + live web search
  global.suiteAutoUpdateRiskModel = async function() {
    if (typeof callAI !== 'function') { toast('No AI provider', 'error'); return; }
    toast('Auto-updating risk model from latest regulations — searching live sources...', 'info', 45000);

    var currentModel = getRiskModel();

    // Live web search for latest regulatory changes
    var liveData = '';
    if (typeof searchWebForScreening === 'function') {
      try {
        var r1 = await searchWebForScreening('FATF grey list black list 2025 2026 update', 'regulation', '');
        var r2 = await searchWebForScreening('UAE AML CFT regulation 2025 2026 FDL CBUAE update', 'regulation', '');
        if (r1) liveData += '\n\n' + r1;
        if (r2) liveData += '\n\n' + r2;
      } catch(e) { console.warn('[RiskModel] Auto-update web search failed:', e); }
    }

    try {
      var data = await callAI({
        model: 'claude-haiku-4-5', max_tokens: 2000, temperature: 0,
        system: 'You are a UAE AML/CFT regulatory specialist for the gold and precious metals sector. Return ONLY valid JSON.',
        messages: [{ role: 'user', content: 'Based on the LATEST regulations and FATF guidance, provide an updated risk model for a UAE DPMS (Dealer in Precious Metals and Stones) Customer Risk Assessment.\n\nCurrent model:\n' + JSON.stringify(currentModel.weights, null, 2) + '\n\nCurrent thresholds: ' + JSON.stringify(currentModel.thresholds) + '\nCurrent CDD levels: ' + JSON.stringify(currentModel.cddLevels) + '\nCurrent review frequency: ' + JSON.stringify(currentModel.reviewFrequency) + '\n\nReturn updated JSON:\n{"weights":{"customerType":{"option":score},"pepStatus":{"option":score},"businessType":{"option":score},"transactionVol":{"option":score},"cashPayment":{"option":score},"sanctionsHit":{"option":score},"sourceOfFunds":{"option":score},"geography":{"option":score},"adverseMedia":{"option":score}},"thresholds":{"Very High":number,"High":number,"Medium":number,"Low":0},"cddLevels":{"Very High":"...","High":"...","Medium":"...","Low":"..."},"reviewFrequency":{"Very High":months,"High":months,"Medium":months,"Low":months},"regulatoryBasis":"updated regulatory references","countryRiskUpdates":{"country":"FATF Black List|FATF Grey List|CAHRA|GCC|FATF Member|Other"}}\n\nIMPORTANT:\n- Add any NEW risk categories that recent regulations require (e.g., new business types, new PEP categories)\n- Update thresholds if regulatory guidance has changed\n- Include countryRiskUpdates ONLY for countries whose FATF status has CHANGED\n- Reference: UAE FDL No.10/2025, Cabinet Resolution 134/2025, FATF Rec 10/12/22, FATF DPMS Guidance 2020, CBUAE guidance\n- Keep ALL existing options, only add/modify as needed' + liveData }]
      });

      var raw = (data.content || []).filter(function(b){return b.type==='text'}).map(function(b){return b.text}).join('');
      var cleaned = raw.replace(/```json?\n?/g,'').replace(/```/g,'').trim();
      var m = cleaned.match(/\{[\s\S]*\}/);
      if (m) {
        var updated = JSON.parse(m[0]);

        // Apply weight updates
        if (updated.weights) {
          Object.keys(updated.weights).forEach(function(cat) {
            currentModel.weights[cat] = updated.weights[cat];
          });
        }
        if (updated.thresholds) currentModel.thresholds = updated.thresholds;
        if (updated.cddLevels) currentModel.cddLevels = updated.cddLevels;
        if (updated.reviewFrequency) currentModel.reviewFrequency = updated.reviewFrequency;
        if (updated.regulatoryBasis) currentModel.regulatoryBasis = updated.regulatoryBasis;
        currentModel.lastUpdatedBy = 'AI Auto-Update';
        saveRiskModel(currentModel);
        refreshRiskWeights();

        // Apply country risk updates
        if (updated.countryRiskUpdates) {
          var db = getCountryRiskDB();
          var countryChanges = 0;
          Object.entries(updated.countryRiskUpdates).forEach(function(e) {
            if (db[e[0]] !== e[1]) { db[e[0]] = e[1]; countryChanges++; }
          });
          if (countryChanges > 0) {
            saveCountryRiskDB(db);
            refreshRiskWeights();
          }
          toast('Risk model auto-updated — ' + countryChanges + ' country changes applied', 'success');
        } else {
          toast('Risk model auto-updated from latest regulations', 'success');
        }
        renderCRA();
        return;
      }
      toast('Could not parse AI response', 'error');
    } catch(e) {
      var bm2 = (e.message||'').toLowerCase();
      if (e.isBillingError || bm2.indexOf('credit')!==-1 || bm2.indexOf('balance')!==-1 || bm2.indexOf('billing')!==-1 || bm2.indexOf('insufficient')!==-1 || bm2.indexOf('quota')!==-1) { toast('API credits exhausted — auto-update unavailable. Add credits at console.anthropic.com.','info',8000); }
      else { toast('Auto-update failed: ' + e.message, 'error'); }
    }
  };

  global.suiteSyncCRAToAsana = async function(idx) {
    const records = load(SK.CRA) || [];
    const r = records[idx];
    if (!r) return;
    toast('Syncing to Asana...', 'info');
    const notes = `Customer: ${r.customerName}\nRisk Rating: ${r.rating}\nScore: ${r.score}\nCDD Level: ${r.cddLevel}\nNationality: ${r.nationality}\nPEP: ${r.pepStatus}\nSanctions: ${r.sanctionsHit}\nRef: ${r.id}\nAssessed: ${fmtDate(r.date)}\nNext Review: ${fmtDate(r.nextReview)}\n\nNotes: ${r.notes || 'None'}\n\nRegulatory Basis: UAE FDL No.(10) of 2025 Art.12-16 | FATF Rec.10`;
    const gid = await pushToAsana(`[CRA] ${r.customerName} — ${r.rating} Risk`, notes, 'cra');
    if (gid) { records[idx].asanaGid = gid; save(SK.CRA, records); toast('Synced to Asana', 'success'); }
    else { toast('Asana sync failed — check token in Settings', 'error'); }
  };

  // ════════════════════════════════════════════════════════════════════════════
  // 2. UBO REGISTER
  // Reg: UAE Cabinet Decision No.(109) of 2023 | UAE FDL No.(10) of 2025 Art.18
  // ════════════════════════════════════════════════════════════════════════════

  function renderUBO() {
    const el = document.getElementById('suite-content-ubo');
    if (!el) return;
    const records = load(SK.UBO) || [];

    el.innerHTML = `
      <div class="card">
        <div class="top-bar">
          <span class="sec-title">🏛️ UBO Register — Beneficial Ownership</span>
          <span style="font-size:11px;color:var(--muted)">UAE Cabinet Decision No.(109) of 2023 | FDL No.(10) of 2025 Art.18</span>
          <button class="btn btn-sm btn-blue" style="padding:6px 12px;font-size:11px" data-action="suiteOpenUBOForm">+ Add UBO</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:1rem">
          <div class="metric m-ok"><div class="metric-num">${records.length}</div><div class="metric-lbl">Total UBOs</div></div>
          <div class="metric m-c"><div class="metric-num">${records.filter(r=>r.screeningStatus==='Potential Match – Pending').length}</div><div class="metric-lbl">Screening Pending</div></div>
          <div class="metric m-h"><div class="metric-num">${records.filter(r=>{ const d=parseDDMMYYYY(r.nextReview)||new Date(r.nextReview); return d < new Date(Date.now()+30*86400000); }).length}</div><div class="metric-lbl">Review Due ≤30d</div></div>
          <div class="metric m-m"><div class="metric-num">${records.filter(r=>r.ownershipPct>=25).length}</div><div class="metric-lbl">≥25% Ownership</div></div>
        </div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="border-bottom:1px solid var(--border)">
                ${['Entity','UBO Name','Nationality','DOB','Ownership %','Control Type','Screening','Verified','Next Review','Actions'].map(h=>`<th style="text-align:left;padding:8px;font-size:11px;color:var(--muted);font-family:'Montserrat',sans-serif">${h}</th>`).join('')}
              </tr>
            </thead>
            <tbody id="ubo-tbody">
              ${records.length===0 ? `<tr><td colspan="10" style="text-align:center;padding:2rem;color:var(--muted);font-size:13px">No UBO records. Click "+ Add UBO" to begin.</td></tr>` : ''}
              ${records.map((r,i)=>`
                <tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:8px;font-size:12px;font-weight:500">${esc(r.entityName)}</td>
                  <td style="padding:8px;font-size:12px">${esc(r.uboName)}</td>
                  <td style="padding:8px;font-size:12px">${esc(r.nationality)}</td>
                  <td style="padding:8px;font-size:12px">${fmtDate(r.dob)}</td>
                  <td style="padding:8px;font-size:12px;text-align:center;font-weight:600;color:${r.ownershipPct>=25?'var(--gold)':'var(--text)'}">${r.ownershipPct}%</td>
                  <td style="padding:8px;font-size:12px">${esc(r.controlType)}</td>
                  <td style="padding:8px">${badge(r.screeningStatus||'Pending')}</td>
                  <td style="padding:8px;font-size:12px">${fmtDate(r.verifiedDate)}</td>
                  <td style="padding:8px;font-size:12px;color:${new Date(r.nextReview)<new Date()?'var(--red)':'var(--text)'}">${fmtDate(r.nextReview)}</td>
                  <td style="padding:8px">
                    <div style="display:flex;gap:4px">
                      <button class="btn btn-sm btn-gold" data-action="suiteEditUBO" data-arg="${i}">Edit</button>
                      <button class="btn btn-sm btn-blue" data-action="suiteSyncUBOToAsana" data-arg="${i}">Asana</button>
                      <button class="btn btn-sm btn-red" data-action="suiteDeleteUBO" data-arg="${i}">Del</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- UBO Form Modal -->
      <div class="modal-overlay" id="uboModal">
        <div class="modal" style="max-width:580px;width:95%">
          <button class="modal-close" data-action="_closeModal" data-arg="uboModal">✕</button>
          <div class="modal-title">UBO Record</div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:1rem;font-family:'Montserrat',sans-serif">UAE Cabinet Decision No.(109) of 2023 | Capture all persons owning ≥25% or exercising ultimate control</div>
          <input type="hidden" id="ubo-edit-idx" value="-1">
          <div class="row row-2">
            <div><span class="lbl">Legal Entity Name *</span><input id="ubo-entity" placeholder="Company/Trust/Fund name"/></div>
            <div><span class="lbl">UBO Full Legal Name *</span><input id="ubo-name" placeholder="As per passport"/></div>
          </div>
          <div class="row row-2">
            <div><span class="lbl">Nationality</span><input id="ubo-nationality" placeholder="Country of citizenship"/></div>
            <div><span class="lbl">Date of Birth</span><input type="text" id="ubo-dob" placeholder="dd/mm/yyyy" oninput="csFormatDateInput(this)" maxlength="10"/></div>
          </div>
          <div class="row row-2">
            <div><span class="lbl">Country of Residence</span><input id="ubo-residence" placeholder="Country"/></div>
            <div><span class="lbl">Ownership Percentage *</span><input type="number" id="ubo-pct" placeholder="e.g. 51" min="0" max="100"/></div>
          </div>
          <div class="row row-2">
            <div><span class="lbl">Control Type *</span>
              <select id="ubo-control"><option value="">Select</option><option>Direct Ownership</option><option>Indirect Ownership</option><option>Nominee Arrangement</option><option>Voting Rights</option><option>Board Control</option><option>Other Control Mechanism</option></select>
            </div>
            <div><span class="lbl">PEP Status</span>
              <select id="ubo-pep"><option value="">Select</option><option>Not a PEP</option><option>Active PEP</option><option>Former PEP</option><option>Family/Associate of PEP</option></select>
            </div>
          </div>
          <div class="row row-2">
            <div><span class="lbl">Sanctions Screening Status</span>
              <select id="ubo-screening"><option value="">Select</option><option>No Match – Cleared</option><option>Potential Match – Pending</option><option>False Positive – Cleared</option><option>Confirmed Match – Escalated</option></select>
            </div>
            <div><span class="lbl">Verification Document Type</span>
              <select id="ubo-doctype"><option value="">Select</option><option>Passport</option><option>Emirates ID</option><option>National ID</option><option>Driving Licence</option><option>Other Government ID</option></select>
            </div>
          </div>
          <div class="row row-2">
            <div><span class="lbl">Document Reference / Number</span><input id="ubo-docref" placeholder="Document number"/></div>
            <div><span class="lbl">Document Expiry Date</span><input type="text" id="ubo-docexpiry" placeholder="dd/mm/yyyy" oninput="csFormatDateInput(this)" maxlength="10"/></div>
          </div>
          <div class="row row-2">
            <div><span class="lbl">Date Verified</span><input type="text" id="ubo-verified" value="${today()}" placeholder="dd/mm/yyyy" oninput="csFormatDateInput(this)" maxlength="10"/></div>
            <div><span class="lbl">Next Review Date</span><input type="text" id="ubo-review" placeholder="dd/mm/yyyy" oninput="csFormatDateInput(this)" maxlength="10"/></div>
          </div>
          <div><span class="lbl">Notes</span><textarea id="ubo-notes" style="min-height:60px" placeholder="Ownership structure notes, supporting documents, escalation notes..."></textarea></div>
          <div style="display:flex;gap:8px;margin-top:1rem">
            <button class="btn btn-gold" data-action="suiteSaveUBO" style="flex:1">Save UBO Record</button>
            <button class="btn btn-sm" data-action="_closeModal" data-arg="uboModal" style="padding:12px 20px">Cancel</button>
          </div>
        </div>
      </div>
    `;
  }

  global.suiteOpenUBOForm = function() {
    document.getElementById('ubo-edit-idx').value = '-1';
    ['ubo-entity','ubo-name','ubo-nationality','ubo-residence','ubo-docref','ubo-notes'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
    ['ubo-control','ubo-pep','ubo-screening','ubo-doctype'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
    ['ubo-dob','ubo-docexpiry','ubo-review'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
    document.getElementById('ubo-verified').value = today();
    document.getElementById('ubo-pct').value = '';
    document.getElementById('uboModal').classList.add('open');
  };

  global.suiteEditUBO = function(idx) {
    const records = load(SK.UBO) || [];
    const r = records[idx];
    if (!r) return;
    document.getElementById('ubo-edit-idx').value = idx;
    document.getElementById('ubo-entity').value = r.entityName || '';
    document.getElementById('ubo-name').value = r.uboName || '';
    document.getElementById('ubo-nationality').value = r.nationality || '';
    document.getElementById('ubo-dob').value = r.dob || '';
    document.getElementById('ubo-residence').value = r.residence || '';
    document.getElementById('ubo-pct').value = r.ownershipPct || '';
    document.getElementById('ubo-control').value = r.controlType || '';
    document.getElementById('ubo-pep').value = r.pepStatus || '';
    document.getElementById('ubo-screening').value = r.screeningStatus || '';
    document.getElementById('ubo-doctype').value = r.docType || '';
    document.getElementById('ubo-docref').value = r.docRef || '';
    document.getElementById('ubo-docexpiry').value = r.docExpiry || '';
    document.getElementById('ubo-verified').value = r.verifiedDate || today();
    document.getElementById('ubo-review').value = r.nextReview || '';
    document.getElementById('ubo-notes').value = r.notes || '';
    document.getElementById('uboModal').classList.add('open');
  };

  global.suiteSaveUBO = function() {
    const entity = document.getElementById('ubo-entity').value.trim();
    const name = document.getElementById('ubo-name').value.trim();
    if (!entity || !name) { toast('Entity and UBO name are required', 'error'); return; }
    const records = load(SK.UBO) || [];
    const editIdx = parseInt(document.getElementById('ubo-edit-idx').value, 10);
    const prior = editIdx >= 0 ? records[editIdx] : null;
    const ownershipPct = parseFloat(document.getElementById('ubo-pct').value) || 0;

    // Cabinet Decision 109/2023: UBO must be re-verified within 15 working
    // days of any ownership change. Auto-compute nextReview from the
    // verified date; if the UI supplies a different value we still clamp
    // it to the statutory limit.
    const verifiedDate = document.getElementById('ubo-verified').value || today();
    const uiNextReview = document.getElementById('ubo-review').value;
    const statutoryNextReview = addBusinessDays(verifiedDate, THRESHOLDS.UBO_REVERIFICATION_WORKING_DAYS);
    let nextReview = uiNextReview;
    if (!nextReview) {
      nextReview = statutoryNextReview;
    } else {
      // If ownership changed vs prior record, force-recalculate the deadline
      // from today using the 15 working-day rule — the UI value is advisory.
      if (prior && prior.ownershipPct !== ownershipPct) {
        nextReview = statutoryNextReview;
        toast('Ownership change detected — next review pinned to ' + nextReview + ' per Cabinet Decision 109/2023 (15 working days).', 'info');
      }
    }

    const record = {
      id: editIdx >= 0 ? records[editIdx].id : uid('UBO'),
      entityName: entity, uboName: name,
      nationality: document.getElementById('ubo-nationality').value,
      dob: document.getElementById('ubo-dob').value,
      residence: document.getElementById('ubo-residence').value,
      ownershipPct: ownershipPct,
      controlType: document.getElementById('ubo-control').value,
      pepStatus: document.getElementById('ubo-pep').value,
      screeningStatus: document.getElementById('ubo-screening').value,
      docType: document.getElementById('ubo-doctype').value,
      docRef: document.getElementById('ubo-docref').value,
      docExpiry: document.getElementById('ubo-docexpiry').value,
      verifiedDate: verifiedDate,
      nextReview: nextReview,
      notes: document.getElementById('ubo-notes').value.trim(),
      updatedAt: new Date().toISOString(),
    };
    if (editIdx >= 0) { records[editIdx] = record; } else { records.unshift(record); }
    save(SK.UBO, records);
    if (typeof logAudit === 'function') logAudit('ubo', (editIdx >= 0 ? 'updated' : 'created') + ' UBO ' + record.id + ' nextReview=' + nextReview);
    document.getElementById('uboModal').classList.remove('open');
    toast(`UBO saved — ${name}`, 'success');
    renderUBO();
  };

  global.suiteDeleteUBO = function(idx) {
    if (!confirm('Delete this UBO record?')) return;
    const records = load(SK.UBO) || [];
    records.splice(idx, 1);
    save(SK.UBO, records);
    renderUBO();
  };

  global.suiteSyncUBOToAsana = async function(idx) {
    const records = load(SK.UBO) || [];
    const r = records[idx];
    if (!r) return;
    toast('Syncing to Asana...', 'info');
    const notes = `Entity: ${r.entityName}\nUBO: ${r.uboName}\nNationality: ${r.nationality}\nOwnership: ${r.ownershipPct}%\nControl: ${r.controlType}\nPEP: ${r.pepStatus}\nScreening: ${r.screeningStatus}\nDoc: ${r.docType} ${r.docRef}\nVerified: ${fmtDate(r.verifiedDate)}\nNext Review: ${fmtDate(r.nextReview)}\n\nRegulatory: UAE Cabinet Decision No.(109) of 2023 | FDL No.(10) of 2025 Art.18`;
    const gid = await pushToAsana(`[UBO] ${r.entityName} — ${r.uboName} (${r.ownershipPct}%)`, notes, 'ubo');
    if (gid) { toast('Synced to Asana', 'success'); } else { toast('Asana sync failed — check token in Settings', 'error'); }
  };

  // ════════════════════════════════════════════════════════════════════════════
  // 3. STR CASE MANAGEMENT
  // Reg: UAE FDL No.(10) of 2025 Art.20 | UAE FIU goAML | FATF Rec. 20
  // ════════════════════════════════════════════════════════════════════════════

  const STR_RED_FLAGS_DPMS = [
    // — Customer Due Diligence —
    'Customer reluctant to provide identification',
    'Customer declines to complete CDD documentation',
    'Inconsistency between declared source of funds and known business',
    'Customer behaviour changes after CDD request',
    'Customer requests anonymity or third-party payment',
    'Customer cannot be reached at declared address or phone',
    'Customer ID has expired or shows tampering signs',
    'Customer provides Emirates ID that fails Federal Authority verification',
    'Customer profile inconsistent with claimed occupation',
    'Customer recently relocated from FATF grey/black-list jurisdiction',
    // — Cash & threshold patterns —
    'Unusual cash payments above AED 55,000',
    'Multiple structured transactions below AED 55,000 threshold',
    'Cash deposit followed by immediate gold purchase',
    'Cash carried in non-traceable form (envelopes, bricks)',
    'Customer asks how to avoid the AED 55,000 reporting threshold',
    'Cumulative linked transactions exceeding AED 55,000 in 7-day window',
    'Round-number cash transactions repeated weekly',
    // — Behaviour & profile —
    'Purchases inconsistent with customer profile or business activity',
    'Customer known to law enforcement or adverse media',
    'Customer expresses indifference to purity, weight, or assay',
    'Customer expresses indifference to price or market quote',
    'Customer in apparent rush to complete transaction',
    'Customer asks staff to bypass standard procedures',
    'Customer attempts to influence or befriend compliance staff',
    'Customer brings unrelated companions who handle the cash',
    // — Geography & sanctions —
    'Involvement of CAHRA or high-risk jurisdiction',
    'Customer/counterparty in OFAC SDN, UN, EU, UK, or UAE EOCN list',
    'Sanctions list match or potential match identified',
    'Cross-border movement to jurisdiction without trade rationale',
    'Goods routed through transhipment hub linked to TBML typologies',
    // — UBO & structure —
    'Unusually complex ownership or payment structure',
    'Beneficial owner cannot be confirmed within Cabinet 109/2023 windows',
    'PEP involvement without satisfactory source of wealth explanation',
    'Domestic PEP family member acting on behalf of the PEP',
    'Use of nominee directors or shareholders without legitimate purpose',
    // — Outflow / disposal —
    'Gold purchased immediately converted/exported',
    'Resale at a loss within hours of purchase',
    'Customer asks for delivery to a different name than the buyer',
    'Customer asks for collection by a courier with no verifiable identity',
    // — TBML / TF / PF —
    'Trade-Based Money Laundering indicators (over/under-invoicing)',
    'Terrorism financing red flag (political links, specific geography)',
    'Proliferation financing concern (dual-use goods reference)',
    'Customer asks about converting gold into negotiable instruments offshore',
    'Customer references restricted technologies or controlled goods alongside gold',
    // — Documentation & integrity —
    'Transaction with no apparent business rationale',
    'False or altered invoice / assay / weight certificate',
    'Mismatched signatures across related documentation',
    'Repeated requests to alter or rebill prior invoices',
    // — Crypto / virtual asset —
    'Settlement requested in stablecoin or virtual asset',
    'Wallet address linked to a known illicit cluster',
    'Customer cannot explain origin of crypto used to pay',
    // — Internal escalation —
    'Internal staff observation prompting MLRO escalation',
    'Pattern detected by automated monitoring exceeding rule threshold',
    'External tip-off, whistleblower disclosure, or law-enforcement request',
  ];

  function renderSTR() {
    const el = document.getElementById('suite-content-str');
    if (!el) return;
    const cases = load(SK.STR) || [];

    el.innerHTML = `
      <div class="card">
        <div class="top-bar">
          <span class="sec-title">STR Case Management</span>
          <span style="font-size:11px;color:var(--muted)">UAE FDL No.(10) of 2025 Art.26-27 | goAML | FATF Rec.20 | File WITHOUT DELAY upon suspicion</span>
          <button class="btn btn-sm btn-blue" style="padding:6px 12px;font-size:11px" data-action="suiteOpenSTRForm">+ New STR Case</button>
        </div>
        <div style="background:rgba(217,79,79,0.1);border:1px solid rgba(217,79,79,0.3);border-radius:4px;padding:10px 14px;margin-bottom:1rem;font-size:12px;color:var(--red);font-family:'Montserrat',sans-serif">
          ⚠️ CONFIDENTIALITY NOTICE: STR information is strictly confidential. Tipping off a subject is a criminal offence under UAE FDL No.(10) of 2025 Art.21. Do not disclose to any person that a report has been or will be filed.
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:1rem">
          <div class="metric m-c"><div class="metric-num">${cases.filter(c=>c.status==='Draft').length}</div><div class="metric-lbl">Draft</div></div>
          <div class="metric m-h"><div class="metric-num">${cases.filter(c=>c.status==='Under Review').length}</div><div class="metric-lbl">Under Review</div></div>
          <div class="metric m-m"><div class="metric-num">${cases.filter(c=>c.status==='Approved – Pending Filing').length}</div><div class="metric-lbl">Pending Filing</div></div>
          <div class="metric m-ok"><div class="metric-num">${cases.filter(c=>c.status==='Filed – goAML').length}</div><div class="metric-lbl">Filed</div></div>
        </div>
        ${cases.length===0 ? '<p style="color:var(--muted);font-size:13px;text-align:center;padding:2rem">No STR cases. Click "+ New STR Case" to begin investigation.</p>' : ''}
        ${cases.map((c,i)=>`
          <div class="finding ${c.status==='Filed – goAML'?'f-ok':c.status==='Draft'?'f-critical':'f-high'}" style="margin-bottom:10px">
            <div class="f-head">
              <div class="f-head-left">
                <div>
                  <div class="f-title">${esc(c.id)} — ${esc(c.subjectName)} ${badge(c.status)}</div>
                  <div class="f-body" style="margin-top:4px">Type: ${esc(c.reportType)} | Priority: ${esc(c.priority)} | Opened: ${fmtDate(c.dateOpened)}</div>
                  <div class="f-ref">Filing Deadline: ${fmtDate(c.filingDeadline)} | Investigator: ${esc(c.investigator||'Unassigned')}</div>
                </div>
              </div>
              <div style="display:flex;gap:6px">
                <button class="btn btn-sm btn-gold" data-action="suiteEditSTR" data-arg="${i}">View/Edit</button>
                <button class="btn btn-sm btn-blue" data-action="suiteSyncSTRToAsana" data-arg="${i}">Asana</button>
                <button class="btn btn-sm btn-red" data-action="suiteDeleteSTR" data-arg="${i}">Delete</button>
              </div>
            </div>
            <div style="font-size:12px;color:var(--muted);margin-top:8px;padding:8px;background:var(--surface2);border-radius:3px;line-height:1.5">${esc((c.narrative||'').slice(0,200))}${(c.narrative||'').length>200?'...':''}</div>
          </div>
        `).join('')}
      </div>

      <!-- STR Form Modal -->
      <div class="modal-overlay" id="strModal">
        <div class="modal" style="max-width:680px;width:95%;max-height:90vh">
          <button class="modal-close" data-action="_closeModal" data-arg="strModal">✕</button>
          <div class="modal-title">STR Case File</div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:1rem;font-family:'Montserrat',sans-serif">UAE FDL No.(10) of 2025 Art.26-27 | File to UAE FIU via goAML WITHOUT DELAY upon suspicion arising</div>
          <input type="hidden" id="str-edit-idx" value="-1">

          <div class="row row-2">
            <div><span class="lbl">Report Type *</span>
              <select id="str-type"><option value="">Select</option><option>STR – Suspicious Transaction Report</option><option>SAR – Suspicious Activity Report</option><option>FFR – Funds Freeze Report</option><option>PNMR – Partial Name Match Report</option></select>
            </div>
            <div><span class="lbl">Priority</span>
              <select id="str-priority"><option>Without Delay (FDL Art.26-27)</option><option>Urgent (Immediate – TF/PF)</option></select>
            </div>
          </div>
          <div class="row row-2">
            <div><span class="lbl">Subject Name *</span><input id="str-subject" placeholder="Individual or entity name"/></div>
            <div><span class="lbl">Subject Type</span>
              <select id="str-subjtype"><option value="">Select</option><option>Individual</option><option>Legal Entity</option><option>Both</option></select>
            </div>
          </div>
          <div class="row row-2">
            <div><span class="lbl">Date Suspicion Arose *</span><input type="text" id="str-suspicion-date" placeholder="dd/mm/yyyy" oninput="csFormatDateInput(this)" maxlength="10"/></div>
            <div><span class="lbl">Filing Deadline (Without Delay — file immediately)</span><input type="text" id="str-deadline" readonly style="opacity:0.7" placeholder="dd/mm/yyyy"/></div>
          </div>
          <div><span class="lbl">Red Flags Identified (select all that apply) *</span>
            <div id="str-flags-container" style="display:grid;grid-template-columns:1fr 1fr;gap:4px;background:var(--surface2);padding:10px;border-radius:3px;border:1px solid var(--border);max-height:180px;overflow-y:auto;margin-top:4px">
              ${STR_RED_FLAGS_DPMS.map((f,i)=>`<label style="display:flex;align-items:flex-start;gap:6px;cursor:pointer;font-size:11px;padding:3px 0"><input type="checkbox" id="strf-${i}" style="width:auto;margin-top:2px"/>${f}</label>`).join('')}
            </div>
          </div>
          <div style="margin-top:10px"><span class="lbl">Suspicion Narrative *</span>
            <textarea id="str-narrative" style="min-height:140px" placeholder="Describe the basis for suspicion in detail. Include: (1) subject profile, (2) transaction chronology, (3) red flags observed, (4) why suspicion arose, (5) any mitigating factors considered and rejected. This narrative will form the basis of the goAML submission."></textarea>
          </div>
          <div class="row row-2" style="margin-top:10px">
            <div><span class="lbl">Transaction Amount (AED)</span><input type="number" id="str-amount" placeholder="0.00"/></div>
            <div><span class="lbl">Transaction Date(s)</span><input id="str-tx-dates" placeholder="e.g. 01/04/2026"/></div>
          </div>
          <div class="row row-2">
            <div><span class="lbl">Investigator / MLRO</span><input id="str-investigator" placeholder="Name of person handling"/></div>
            <div><span class="lbl">Case Status *</span>
              <select id="str-status"><option>Draft</option><option>Under Review</option><option>Approved – Pending Filing</option><option>Filed – goAML</option><option>Closed – No Further Action</option></select>
            </div>
          </div>
          <div><span class="lbl">goAML Reference Number (after filing)</span><input id="str-goaml-ref" placeholder="goAML submission reference"/></div>
          <div><span class="lbl">Internal Notes</span><textarea id="str-notes" style="min-height:60px" placeholder="Internal escalation notes, management approvals, supporting documents..."></textarea></div>

          <div style="display:flex;gap:8px;margin-top:1rem">
            <button class="btn btn-gold" data-action="suiteSaveSTR" style="flex:1">Save Case</button>
            <button class="btn btn-sm" data-action="_closeModal" data-arg="strModal" style="padding:12px 20px">Cancel</button>
          </div>
        </div>
      </div>
    `;

    // Wire up auto-deadline
    const sd = document.getElementById('str-suspicion-date');
    if (sd) sd.addEventListener('input', function() {
      if (!this.value || this.value.length < 10) return;
      const d = parseDDMMYYYY(this.value);
      if (!d || isNaN(d.getTime())) return;
      // STR must be filed WITHOUT DELAY per FDL Art.26-27
      // Deadline = same day as suspicion date (regulatory backstop is immediate)
      document.getElementById('str-deadline').value = fmtDateDDMMYYYY(d);
    });
  }

  global.suiteOpenSTRForm = function() {
    document.getElementById('str-edit-idx').value = '-1';
    ['str-subject','str-tx-dates','str-investigator','str-goaml-ref','str-notes','str-narrative'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
    ['str-type','str-subjtype'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
    document.getElementById('str-status').value = 'Draft';
    document.getElementById('str-priority').value = 'Without Delay (FDL Art.26-27)';
    document.getElementById('str-suspicion-date').value = '';
    document.getElementById('str-deadline').value = '';
    document.getElementById('str-amount').value = '';
    STR_RED_FLAGS_DPMS.forEach((_,i) => { const cb=document.getElementById('strf-'+i); if(cb) cb.checked=false; });
    document.getElementById('strModal').classList.add('open');
  };

  global.suiteEditSTR = function(idx) {
    const cases = load(SK.STR) || [];
    const c = cases[idx];
    if (!c) return;
    document.getElementById('str-edit-idx').value = idx;
    document.getElementById('str-type').value = c.reportType || '';
    document.getElementById('str-priority').value = c.priority || 'Without Delay (FDL Art.26-27)';
    document.getElementById('str-subject').value = c.subjectName || '';
    document.getElementById('str-subjtype').value = c.subjectType || '';
    document.getElementById('str-suspicion-date').value = c.suspicionDate || '';
    document.getElementById('str-deadline').value = c.filingDeadline || '';
    document.getElementById('str-narrative').value = c.narrative || '';
    document.getElementById('str-amount').value = c.amount || '';
    document.getElementById('str-tx-dates').value = c.txDates || '';
    document.getElementById('str-investigator').value = c.investigator || '';
    document.getElementById('str-status').value = c.status || 'Draft';
    document.getElementById('str-goaml-ref').value = c.goamlRef || '';
    document.getElementById('str-notes').value = c.notes || '';
    const flags = c.flags || [];
    STR_RED_FLAGS_DPMS.forEach((f,i) => { const cb=document.getElementById('strf-'+i); if(cb) cb.checked=flags.includes(f); });
    document.getElementById('strModal').classList.add('open');
  };

  global.suiteSaveSTR = function() {
    const subject = document.getElementById('str-subject').value.trim();
    const rtype = document.getElementById('str-type').value;
    if (!subject || !rtype) { toast('Subject name and report type are required', 'error'); return; }
    const selectedFlags = STR_RED_FLAGS_DPMS.filter((_,i) => document.getElementById('strf-'+i)?.checked);
    const cases = load(SK.STR) || [];
    const editIdx = parseInt(document.getElementById('str-edit-idx').value, 10);
    const record = {
      id: editIdx >= 0 ? cases[editIdx].id : uid('STR'),
      reportType: rtype,
      priority: document.getElementById('str-priority').value,
      subjectName: subject,
      subjectType: document.getElementById('str-subjtype').value,
      suspicionDate: document.getElementById('str-suspicion-date').value,
      filingDeadline: document.getElementById('str-deadline').value,
      flags: selectedFlags,
      narrative: document.getElementById('str-narrative').value.trim(),
      amount: document.getElementById('str-amount').value,
      txDates: document.getElementById('str-tx-dates').value,
      investigator: document.getElementById('str-investigator').value.trim(),
      status: document.getElementById('str-status').value,
      goamlRef: document.getElementById('str-goaml-ref').value.trim(),
      notes: document.getElementById('str-notes').value.trim(),
      dateOpened: editIdx >= 0 ? cases[editIdx].dateOpened : today(),
      updatedAt: new Date().toISOString(),
    };
    if (editIdx >= 0) { cases[editIdx] = record; } else { cases.unshift(record); }
    save(SK.STR, cases);
    document.getElementById('strModal').classList.remove('open');
    toast(`STR case saved — ${subject}`, 'success');
    renderSTR();

    // Brain hook: fire-and-forget notify the SUPER ULTRA BRAIN so it can
    // start the filing deadline tracker, apply the FDL Art.29 confidentiality
    // lock, and append to the evidence chain. Never blocks the UI.
    try {
      if (typeof global.__brainNotify === 'function') {
        global.__brainNotify({
          kind: 'str_saved',
          severity: (record.priority && /urgent|critical|immediate/i.test(record.priority)) ? 'critical' : 'high',
          summary: `STR saved: ${record.reportType} for ${subject}`,
          subject: subject,
          refId: record.id,
          meta: {
            reportType: record.reportType,
            priority: record.priority,
            flagCount: (record.flags || []).length,
            hasNarrative: !!record.narrative,
            filed: !!record.goamlRef,
          },
        });
      }
      // Decision engine hook: when the operator has opted in to the
      // weaponized brain, also POST the case through /api/decision so
      // the 97-subsystem pipeline runs and surfaces a verdict in the
      // war-room feed. Subject identity is hashed before transmission
      // — the engine NEVER receives the raw subject name.
      if (typeof global.__decisionNotify === 'function') {
        var hashedSubject = (typeof global.cs2HashSubject === 'function')
          ? global.cs2HashSubject(subject)
          : 'subject-' + (record.id || 'unknown');
        global.__decisionNotify({
          tenantId: (typeof global.cs2TenantId === 'function' ? global.cs2TenantId() : 'default'),
          topic: 'STR draft saved',
          entity: {
            id: record.id,
            name: hashedSubject,
            features: {
              priorAlerts90d: 0,
              txValue30dAED: parseFloat(record.amount) || 0,
              nearThresholdCount30d: 0,
              crossBorderRatio30d: 0,
              isPep: false,
              highRiskJurisdiction: false,
              hasAdverseMedia: !!record.narrative && /adverse|media|sanction/i.test(record.narrative),
              daysSinceOnboarding: 0,
              sanctionsMatchScore: 0,
              cashRatio30d: 0,
            },
            actorUserId: (typeof AuthRBAC !== 'undefined' && AuthRBAC.getCurrentUser && AuthRBAC.getCurrentUser()?.id) || 'unknown',
          },
          filing: {
            decisionType: 'str_filing',
            approvals: [],
          },
          sealAttestation: true,
        });
      }
    } catch (_brainErr) { /* brain is best-effort — never break the save path */ }
  };

  global.suiteDeleteSTR = function(idx) {
    // STR records are legally required to be retained for 10 years (FDL Art.24/25).
    // Deletion is prohibited — archive instead.
    const cases = load(SK.STR) || [];
    const c = cases[idx];
    if (!c) return;
    if (c.status === 'Filed' || (c.status && c.status.startsWith('Filed')) || c.goamlRef) {
      toast('Filed STR cases cannot be deleted — records must be retained for 10 years per FDL Art.24.', 'error', 5000);
      return;
    }
    if (!confirm('⚠️ Archive this draft STR case?\n\nFiled STR cases cannot be deleted per FDL Art.24.\nThis draft will be marked as Archived but retained in the system.')) return;
    cases[idx].status = 'Archived';
    cases[idx].archivedAt = new Date().toISOString();
    save(SK.STR, cases);
    renderSTR();
    toast('STR case archived (retained per FDL Art.24)', 'info');
  };

  global.suiteSyncSTRToAsana = async function(idx) {
    const cases = load(SK.STR) || [];
    const c = cases[idx];
    if (!c) return;
    // FDL Art.29 — No tipping off: redact subject-identifying information before external sync
    if (!confirm('⚠️ FDL Art.29 WARNING — No Tipping Off\n\nSTR data will be synced to Asana with subject details REDACTED to prevent unauthorized disclosure.\n\nEnsure Asana access is restricted to authorized compliance personnel only.\n\nProceed?')) return;
    toast('Syncing to Asana (redacted)...', 'info');
    const notes = `CASE: ${c.id}\nReport Type: ${c.reportType}\nSubject: [REDACTED — FDL Art.29]\nStatus: ${c.status}\nSuspicion Date: ${fmtDate(c.suspicionDate)}\nFiling Deadline: ${fmtDate(c.filingDeadline)}\nPriority: ${c.priority}\nInvestigator: ${c.investigator}\ngoAML Ref: ${c.goamlRef||'Pending'}\n\nRegulatory Basis: UAE FDL No.(10) of 2025 Art.20 | FATF Rec.20\n\n⚠️ CONFIDENTIAL — Subject details withheld per FDL Art.29 (No Tipping Off)`;
    const gid = await pushToAsana(`[${c.reportType.split('–')[0].trim()}] Case ${c.id} — ${c.status}`, notes, 'str');
    if (gid) { toast('Synced to Asana (redacted)', 'success'); } else { toast('Asana sync failed', 'error'); }
  };

  // ════════════════════════════════════════════════════════════════════════════
  // TFS Operations migrated to unified TFS module (TFS UAE tab)
  // Old SK.TFS records auto-migrated to SK2.TFS2 on first load

  // 5. RED FLAG LIBRARY
  // Reg: FATF DPMS Guidance 2020 | UAE FDL No.(10) of 2025 | Wolfsberg ACSS
  // ════════════════════════════════════════════════════════════════════════════

  // ── RISK SCORING MODEL ──────────────────────────────────────────────────────
  // L × I = Score | Low:1-5 | Medium:6-10 | High:11-15 | Critical:16-25
  // Multipliers: High-risk jurisdiction ×1.5 | PEP ×1.5 | Sanctions ×2 | Cash ×1.5 | Repeat ×1.5
  // Ref: UAE FDL No.(10)/2025 | Cabinet Resolution 134/2025 | FATF Rec.1 | FATF DPMS 2020
  // ─────────────────────────────────────────────────────────────────────────────

  const RF_LEVEL = {
    Critical: { col:'#D94F4F', bg:'rgba(217,79,79,0.12)', border:'rgba(217,79,79,0.3)', action:'Immediate escalation — consider reject, suspend, freeze, or STR/SAR' },
    High:     { col:'#E8A030', bg:'rgba(232,160,48,0.12)', border:'rgba(232,160,48,0.3)', action:'EDD required — compliance review, hold until clarified' },
    Medium:   { col:'#4A8FC1', bg:'rgba(74,143,193,0.12)', border:'rgba(74,143,193,0.3)', action:'Analyst review — refresh KYC if repeated' },
    Low:      { col:'#3DA876', bg:'rgba(61,168,118,0.12)', border:'rgba(61,168,118,0.3)', action:'Log only — include in trend analysis' },
  };

  function rfLevel(score) {
    if (score >= 16) return 'Critical';
    if (score >= 11) return 'High';
    if (score >= 6)  return 'Medium';
    return 'Low';
  }

  const RF_MULTIPLIERS = {
    'high_risk_jurisdiction': { label:'High-risk jurisdiction', factor:1.5 },
    'pep':                    { label:'PEP involvement',        factor:1.5 },
    'sanctions':              { label:'Sanctions proximity',    factor:2.0 },
    'cash':                   { label:'Cash/untraceable funds', factor:1.5 },
    'repeat':                 { label:'Repeat occurrence',      factor:1.5 },
  };

  const RED_FLAGS_DB = {
    'Customer Due Diligence': [
      { flag:'Customer refuses or is unable to provide required identification documents', ref:'UAE FDL No.(10)/2025 Art.12 | FATF Rec.10', l:4, i:4, mx:['cash'] },
      { flag:'Customer refuses to explain UBO, source of funds, source of wealth, or business activity', ref:'UAE FDL No.(10)/2025 Art.12-14 | FATF Rec.10', l:4, i:4, mx:[] },
      { flag:'Customer provides inconsistent or suspicious identification information', ref:'UAE FDL No.(10)/2025 Art.12', l:4, i:3, mx:[] },
      { flag:'Customer is evasive or refuses to provide or update KYC documents', ref:'UAE FDL No.(10)/2025 Art.12 | FATF Rec.10', l:4, i:4, mx:[] },
      { flag:'Customer shows concern or resistance toward compliance requirements', ref:'FATF DPMS 2020 §4.2 | Cabinet Resolution 134/2025 Art.12', l:3, i:3, mx:[] },
      { flag:'Customer avoids face-to-face meetings without valid reason', ref:'FATF DPMS 2020 §4.2', l:3, i:3, mx:[] },
      { flag:'Customer uses nominee, proxy, or third party without clear explanation', ref:'FATF DPMS 2020 §4.3', l:4, i:4, mx:[] },
      { flag:'Customer declines to provide source of funds information', ref:'UAE FDL No.(10)/2025 Art.14', l:5, i:5, mx:['cash'] },
      { flag:'Customer behaviour changes or relationship is terminated after CDD is requested', ref:'FATF DPMS 2020 §4.2', l:3, i:4, mx:[] },
      { flag:'Customer known to law enforcement or subject to adverse media', ref:'FATF Rec.12', l:3, i:4, mx:[] },
      { flag:'Customer appears in adverse media or NGO reports linked to financial crime', ref:'FATF Rec.12 | UAE FDL No.(10)/2025 Art.12', l:3, i:4, mx:[] },
      { flag:'Customer is under criminal investigation', ref:'UAE FDL No.(10)/2025 Art.12 | FATF Rec.10', l:4, i:5, mx:['sanctions'] },
      { flag:'Customer uses personal email address instead of corporate email for business dealings', ref:'FATF DPMS 2020 §4.2', l:2, i:2, mx:[] },
      { flag:'Customer address cannot be verified or does not match official records', ref:'UAE FDL No.(10)/2025 Art.12 | Cabinet Resolution 134/2025 Art.8', l:4, i:3, mx:[] },
      { flag:'Registered address differs from actual operating address without explanation', ref:'UAE FDL No.(10)/2025 Art.12', l:3, i:3, mx:[] },
      { flag:'Customer cannot be found in official, regulatory, or public records', ref:'UAE FDL No.(10)/2025 Art.12 | FATF Rec.10', l:4, i:4, mx:[] },
      { flag:'Directors or shareholders show no real or verifiable activity in the company', ref:'UAE Cabinet Decision No.(10)/2019 | FATF Rec.24', l:3, i:4, mx:[] },
      { flag:'Directors lack competence or relevant knowledge of the stated business activity', ref:'FATF DPMS 2020 §4.2 | UAE Cabinet Decision No.(10)/2019', l:3, i:3, mx:[] },
      { flag:'Beneficial ownership structure is complex or opaque without business justification', ref:'UAE Cabinet Decision No.(10)/2019', l:4, i:4, mx:['high_risk_jurisdiction'] },
      { flag:'PEP status concealed or only revealed after initial screening', ref:'FATF Rec.12 | UAE FDL No.(10)/2025 Art.16', l:4, i:5, mx:['pep'] },
      { flag:'Customer or company appears on UAE Local Terrorist List or UNSC Consolidated Sanctions List', ref:'Cabinet Decision No.(74)/2020 | EOCN TFS Guidance', l:5, i:5, mx:['sanctions'] },
    ],
    'Ownership & Corporate Structure': [
      { flag:'Multiple unrelated companies share the same registered address', ref:'UAE Cabinet Decision No.(10)/2019 | FATF Rec.24', l:3, i:3, mx:[] },
      { flag:'Use of shell companies or entities with no clear or verifiable business activity', ref:'FATF Rec.24 | UAE Cabinet Decision No.(10)/2019', l:5, i:5, mx:['high_risk_jurisdiction'] },
      { flag:'Use of newly formed entities without clear business justification', ref:'FATF DPMS 2020 §4.3', l:3, i:4, mx:[] },
      { flag:'Same bank account used across multiple different types of business', ref:'FATF DPMS 2020 §4.2', l:3, i:3, mx:[] },
      { flag:'Frequent changes in bank accounts, signatories, or account details', ref:'FATF DPMS 2020 §4.3 | Cabinet Resolution 134/2025 Art.13', l:4, i:3, mx:['repeat'] },
      { flag:'Use of intermediaries with no clear role or verifiable value in the transaction', ref:'Wolfsberg ACSS 2019 | FATF DPMS 2020', l:4, i:4, mx:[] },
      { flag:'Ownership structure is unnecessarily layered or involves multiple jurisdictions without commercial rationale', ref:'UAE Cabinet Decision No.(10)/2019 | FATF Rec.24', l:4, i:4, mx:['high_risk_jurisdiction'] },
    ],
    'Transaction Patterns': [
      { flag:'Structuring: multiple transactions just below AED 55,000 reporting threshold', ref:'UAE FDL No.(10)/2025 | MoE Circular 08/AML/2021 | FATF DPMS 2020', l:4, i:4, mx:['cash','repeat'] },
      { flag:'Prominent or sudden increase in precious metals supply or purchase without justification', ref:'FATF DPMS 2020 §4.2 | Cabinet Resolution 134/2025 Art.13', l:3, i:4, mx:[] },
      { flag:'Large cash payment for gold with no clear business rationale', ref:'UAE FDL No.(10)/2025 | FATF DPMS 2020 §4.2', l:4, i:4, mx:['cash'] },
      { flag:'Buying or selling precious metals at significantly below market value in cash', ref:'FATF DPMS 2020 §4.3 | Wolfsberg ACSS 2019', l:4, i:5, mx:['cash'] },
      { flag:'Manipulation of metal pricing or weight/assay figures across documentation', ref:'FATF TBML Guidance 2020 | LBMA RGG v9 Step 2', l:4, i:4, mx:[] },
      { flag:'Purchases inconsistent with customer profile or declared business activity', ref:'FATF DPMS 2020 §4.2', l:4, i:4, mx:[] },
      { flag:'Immediate resale of purchased gold at a loss', ref:'FATF DPMS 2020 §4.3', l:4, i:4, mx:[] },
      { flag:'Unusual urgency to complete transaction or pressure to bypass compliance procedures', ref:'FATF DPMS 2020 §4.2', l:3, i:4, mx:[] },
      { flag:'Customer shows no interest in payment terms, pricing, or transaction details', ref:'FATF DPMS 2020 §4.2', l:3, i:3, mx:[] },
      { flag:'Customer is unaware of the structure of their own transaction', ref:'FATF DPMS 2020 §4.3', l:3, i:4, mx:[] },
      { flag:'Cancellation of transaction when additional information or documentation is requested', ref:'FATF DPMS 2020 §4.2 | Cabinet Resolution 134/2025 Art.12', l:3, i:3, mx:[] },
      { flag:'Preference for multiple small cash transactions rather than single traceable payments', ref:'FATF DPMS 2020 | MoE Circular 08/AML/2021', l:4, i:4, mx:['cash','repeat'] },
      { flag:'Multiple transactions in a short period to purchase gold bullion from same or related parties', ref:'FATF DPMS 2020 §4.3 | Cabinet Resolution 134/2025 Art.13', l:4, i:4, mx:['repeat'] },
      { flag:'Multiple linked transactions involving the same parties or related individuals', ref:'Cabinet Resolution 134/2025 Art.13 | MoE Circular 08/AML/2021', l:4, i:3, mx:['repeat'] },
      { flag:'Payment by multiple unrelated third parties without explanation', ref:'Wolfsberg ACSS 2019', l:4, i:4, mx:[] },
      { flag:'Unexplained third-party payments or payments from unrelated entities', ref:'Wolfsberg ACSS 2019 | FATF DPMS 2020 §4.3', l:5, i:4, mx:[] },
      { flag:'Use of third-party companies without clear justification or business relationship', ref:'Wolfsberg ACSS 2019 | FATF DPMS 2020', l:4, i:4, mx:[] },
      { flag:'Use of complex or unnecessary payment methods: virtual assets, prepaid cards, e-wallets', ref:'FATF Rec.15 | VARA UAE | Cabinet Resolution 134/2025', l:4, i:4, mx:[] },
      { flag:'Use of fiduciary accounts or nominee arrangements without explanation', ref:'FATF DPMS 2020 §4.3 | UAE Cabinet Decision No.(10)/2019', l:4, i:4, mx:[] },
      { flag:'Payments in unusual currencies or from locations unrelated to declared business', ref:'FATF DPMS 2020 | Wolfsberg ACSS 2019', l:3, i:4, mx:[] },
      { flag:'Requests to alter, conceal, or misrepresent transaction details or documentation', ref:'UAE FDL No.(10)/2025 Art.18 | FATF Rec.20', l:5, i:5, mx:['repeat'] },
      { flag:'Funds inconsistent with customer profile, declared income, or business activity', ref:'UAE FDL No.(10)/2025 Art.14 | Cabinet Resolution 134/2025 Art.13', l:4, i:4, mx:[] },
      { flag:'Cash from unknown, unverifiable, or undocumented origin', ref:'UAE FDL No.(10)/2025 Art.14 | FATF Rec.10', l:5, i:5, mx:['cash'] },
      { flag:'Transaction volume significantly above customer historical pattern', ref:'FATF Rec.20', l:4, i:4, mx:[] },
      { flag:'Round number transactions repeated at regular intervals', ref:'FATF DPMS 2020', l:3, i:3, mx:['repeat'] },
    ],
    'Geography & Jurisdiction': [
      { flag:'Customer or counterparty located in FATF Grey or Black List jurisdiction', ref:'FATF Rec.19 | UAE FDL No.(10)/2025', l:4, i:4, mx:['high_risk_jurisdiction'] },
      { flag:'Transaction involves CAHRA (Conflict-Affected or High-Risk Area)', ref:'LBMA RGG v9 Step 2 | OECD Due Diligence §4', l:5, i:5, mx:['high_risk_jurisdiction'] },
      { flag:'Gold origin from high-risk mining region without documentation', ref:'LBMA RGG v9 Step 3 | OECD §4', l:4, i:4, mx:['high_risk_jurisdiction'] },
      { flag:'Shipment route inconsistent with declared origin or destination', ref:'Wolfsberg ACSS 2019 | FATF TBML Guidance', l:4, i:4, mx:[] },
      { flag:'Complex or illogical delivery instructions involving unrelated foreign jurisdictions', ref:'FATF TBML Guidance 2020 | Wolfsberg ACSS 2019', l:4, i:4, mx:['high_risk_jurisdiction'] },
      { flag:'End-user or ultimate consignee located in a high-risk or sanctioned jurisdiction', ref:'FATF Rec.19 | Cabinet Decision No.(74)/2020', l:4, i:5, mx:['high_risk_jurisdiction','sanctions'] },
      { flag:'Involvement of jurisdiction subject to UAE or international sanctions', ref:'UAE Cabinet Resolution 74/2020 | UNSCR', l:5, i:5, mx:['sanctions'] },
      { flag:'Involvement of high-risk or tax haven jurisdictions without commercial rationale', ref:'FATF Rec.19 | OECD Tax Haven Guidance', l:4, i:4, mx:['high_risk_jurisdiction'] },
      { flag:'Customer recently relocated from high-risk jurisdiction without explanation', ref:'FATF DPMS 2020 §4.3', l:3, i:4, mx:['high_risk_jurisdiction'] },
    ],
    'Supply Chain (LBMA)': [
      { flag:'Supplier unable to provide chain of custody documentation', ref:'LBMA RGG v9 Step 2', l:4, i:4, mx:[] },
      { flag:'Gold assay or hallmarking inconsistency', ref:'LBMA RGG v9 Step 1', l:4, i:4, mx:[] },
      { flag:'Refinery not on LBMA Good Delivery List or equivalent recognised standard', ref:'LBMA RGG v9 Step 3', l:4, i:4, mx:[] },
      { flag:'Precious metals originating from countries with no or limited known mining activity', ref:'LBMA RGG v9 Step 2 | OECD Due Diligence §4', l:4, i:4, mx:['high_risk_jurisdiction'] },
      { flag:'Supplier previously flagged for CAHRA or conflict mineral links', ref:'LBMA RGG v9 Step 2 | OECD §5', l:4, i:5, mx:['high_risk_jurisdiction'] },
      { flag:'Documentary inconsistency between origin, weight, and assay certificates', ref:'LBMA RGG v9 Step 2', l:4, i:4, mx:[] },
      { flag:'Supplier relationship lacks contractual AML/CFT representations or warranties', ref:'LBMA RGG v9 Step 3', l:3, i:4, mx:[] },
      { flag:'False or forged certificates of origin, assay certificates, or weight notes', ref:'LBMA RGG v9 Step 2 | FATF TBML Guidance 2020', l:5, i:5, mx:[] },
      { flag:'Cash payments in supply chain inconsistent with declared production volumes', ref:'LBMA RGG v9 Step 2 | OECD Due Diligence §4', l:4, i:4, mx:['cash'] },
      { flag:'Miners unable to provide valid identification or formal registration documents', ref:'LBMA RGG v9 Step 2 | OECD Due Diligence §4', l:4, i:4, mx:[] },
      { flag:'Use of intermediaries in sourcing chain without clear justification or documentation', ref:'LBMA RGG v9 Step 3 | OECD Due Diligence §5', l:4, i:4, mx:[] },
      { flag:'Mismatch between declared production volumes and actual sales volumes', ref:'LBMA RGG v9 Step 2 | OECD Due Diligence §4', l:4, i:4, mx:[] },
      { flag:'Mining operations controlled or influenced by armed groups or unofficial authorities', ref:'LBMA RGG v9 Step 2 | OECD Due Diligence §3', l:5, i:5, mx:['high_risk_jurisdiction'] },
    ],
    'Terrorism & Proliferation Financing': [
      { flag:'Customer linked to known terrorist individual, group, or state sponsor of terrorism', ref:'UAE Cabinet Resolution 74/2020 | FATF Rec.5-8', l:5, i:5, mx:['sanctions'] },
      { flag:'Transaction with UNSC designated person or entity', ref:'UNSCR | UAE FDL No.(10)/2025 Art.14', l:5, i:5, mx:['sanctions'] },
      { flag:'Gold used as payment, barter, or store of value in context with TF typology', ref:'FATF TF Guidance 2019', l:4, i:5, mx:['high_risk_jurisdiction'] },
      { flag:'Customer references dual-use goods, restricted technology, or arms procurement', ref:'FATF Rec.7 | UNSCR 1540', l:4, i:5, mx:['sanctions'] },
      { flag:'Transaction linked to jurisdiction under proliferation financing sanctions', ref:'UAE Cabinet Resolution 74/2020 | FATF Rec.7', l:4, i:5, mx:['sanctions','high_risk_jurisdiction'] },
      { flag:'Unusual interest in anti-detection methods or counter-surveillance', ref:'FATF TF Guidance 2019', l:4, i:4, mx:[] },
      { flag:'Customer or associated party subject to sanctions alert or new PEP designation', ref:'Cabinet Decision No.(74)/2020 | EOCN TFS Guidance | Cabinet Resolution 134/2025 Art.13', l:4, i:5, mx:['sanctions','pep'] },
    ],
    'Trade-Based Money Laundering': [
      { flag:'Invoice price significantly above or below prevailing market gold price', ref:'Wolfsberg ACSS 2019 | FATF TBML Guidance 2020', l:4, i:4, mx:[] },
      { flag:'Under-invoicing: declared value substantially below true market value', ref:'FATF TBML Guidance 2020 | Wolfsberg ACSS 2019', l:4, i:4, mx:[] },
      { flag:'Unusual structuring of invoices across multiple transactions or counterparties', ref:'FATF TBML Guidance 2020', l:4, i:3, mx:['repeat'] },
      { flag:'Over- or under-shipment: quantity received differs from documentation', ref:'FATF TBML Guidance 2020', l:4, i:4, mx:[] },
      { flag:'Multiple invoicing of same shipment or duplicate billing', ref:'FATF TBML Guidance 2020', l:4, i:4, mx:['repeat'] },
      { flag:'Complex back-to-back trade finance arrangements with no clear commercial rationale', ref:'Wolfsberg ACSS 2019', l:4, i:4, mx:[] },
      { flag:'Goods description in shipping documents inconsistent with gold or precious metals trading', ref:'FATF TBML Guidance 2020', l:4, i:4, mx:[] },
      { flag:'Transactions routed through offshore accounts or entities without clear business purpose', ref:'FATF TBML Guidance 2020 | Wolfsberg ACSS 2019', l:5, i:4, mx:['high_risk_jurisdiction'] },
      { flag:'Complex or indirect payment routes without economic or commercial justification', ref:'FATF TBML Guidance 2020 | Wolfsberg ACSS 2019', l:4, i:4, mx:[] },
      { flag:'Unclear or inconsistent end-user information across shipping and payment documents', ref:'FATF TBML Guidance 2020 | Wolfsberg ACSS 2019', l:4, i:5, mx:['high_risk_jurisdiction'] },
    ],
    'Ongoing Monitoring Triggers': [
      { flag:'Adverse media developments newly affecting an existing customer', ref:'Cabinet Resolution 134/2025 Art.13 | FATF Rec.10', l:3, i:4, mx:[] },
      { flag:'Changes in customer ownership, control structure, or legal status', ref:'UAE Cabinet Decision No.(10)/2019 | Cabinet Resolution 134/2025 Art.13', l:3, i:3, mx:[] },
      { flag:'Sanctions alert or new PEP designation affecting existing customer', ref:'Cabinet Decision No.(74)/2020 | EOCN TFS Guidance', l:4, i:5, mx:['sanctions','pep'] },
      { flag:'Doubts arising about previously obtained identification data or its continued accuracy', ref:'Cabinet Resolution 134/2025 Art.13 | UAE FDL No.(10)/2025 Art.12', l:4, i:4, mx:[] },
      { flag:'Inconsistencies identified between financial documents and actual customer behaviour', ref:'Cabinet Resolution 134/2025 Art.13 | FATF Rec.10', l:4, i:4, mx:[] },
      { flag:'Third-party funding without clear or documented relationship to the transaction', ref:'FATF DPMS 2020 §4.3 | Wolfsberg ACSS 2019', l:4, i:4, mx:[] },
      { flag:'Unusual or unexpected transaction pattern deviating from established customer profile', ref:'Cabinet Resolution 134/2025 Art.13 | FATF Rec.20', l:3, i:4, mx:[] },
      { flag:'Customer subject to regulatory action, fine, or investigation by any authority', ref:'UAE FDL No.(10)/2025 Art.12 | FATF Rec.10', l:4, i:5, mx:[] },
    ],
    'Virtual Assets & Digital Payments': [
      { flag:'Customer attempts to pay using cryptocurrency or virtual assets despite prohibition policy', ref:'FATF Rec.15 | VARA UAE | Cabinet Resolution 134/2025', l:4, i:4, mx:[] },
      { flag:'Customer requests conversion between precious metals and virtual assets', ref:'FATF Rec.15 | VARA UAE Regulations', l:4, i:5, mx:[] },
      { flag:'Customer uses unregulated or offshore virtual asset service provider (VASP)', ref:'FATF Rec.15 | VARA UAE', l:4, i:4, mx:['high_risk_jurisdiction'] },
      { flag:'Customer wallet address linked to darknet marketplace or mixing service', ref:'FATF Rec.15 | OFAC Guidance on Virtual Currencies', l:5, i:5, mx:['sanctions'] },
      { flag:'Customer uses privacy coins (Monero, Zcash) or anonymity-enhancing tools for metal purchases', ref:'FATF Updated Guidance on Virtual Assets 2021', l:5, i:5, mx:[] },
      { flag:'Multiple small crypto-to-fiat conversions used to fund precious metal purchase', ref:'FATF Rec.15 | VARA UAE', l:4, i:4, mx:['repeat'] },
      { flag:'Customer provides inconsistent wallet ownership information', ref:'FATF Travel Rule | VARA UAE Regulations', l:3, i:4, mx:[] },
      { flag:'Peer-to-peer transfer from unknown source used as payment method', ref:'FATF Virtual Asset Guidance 2021', l:4, i:4, mx:[] },
    ],
    'Proliferation Financing (PF)': [
      { flag:'Customer or end-user located in DPRK, Iran, or under UNSC PF sanctions', ref:'FATF Rec.7 | UNSCR 1718/1737 | Cabinet Resolution 74/2020', l:5, i:5, mx:['sanctions','high_risk_jurisdiction'] },
      { flag:'Transaction involves items with potential dual-use application (nuclear, chemical, biological, missile)', ref:'Cabinet Resolution 156/2025 | UNSCR 1540', l:5, i:5, mx:['sanctions'] },
      { flag:'Procurement patterns consistent with WMD-related acquisition networks', ref:'FATF Rec.7 | UNSCR PF Resolutions', l:5, i:5, mx:['sanctions'] },
      { flag:'Customer seeks to acquire unusual quantities of high-purity precious metals with strategic applications', ref:'FATF PF Guidance | UNSCR 2231', l:4, i:5, mx:[] },
      { flag:'End-user certificates are missing, forged, or from non-credible issuing authority', ref:'Cabinet Resolution 156/2025 | Wassenaar Arrangement', l:4, i:5, mx:[] },
      { flag:'Customer declines to disclose final end-user or end-use of purchased metals', ref:'FATF Rec.7 | UNSCR 1540', l:4, i:5, mx:[] },
      { flag:'Transaction involves freight forwarder or logistics company linked to sanctioned entity', ref:'OFAC Advisories | UNSCR Implementation', l:4, i:5, mx:['sanctions'] },
      { flag:'Customer shows unusual knowledge of export control regulations or evasion techniques', ref:'FATF PF Guidance 2021', l:4, i:4, mx:[] },
    ],
    'Environmental & Human Rights (ESG)': [
      { flag:'Gold sourced from artisanal mine with documented child labour or forced labour', ref:'LBMA RGG v9 Step 2 | OECD DDG Annex II', l:5, i:5, mx:['high_risk_jurisdiction'] },
      { flag:'Supplier operates in area with documented armed conflict over mining resources', ref:'LBMA RGG v9 Step 2 | OECD DDG §3', l:5, i:5, mx:['high_risk_jurisdiction'] },
      { flag:'Mining activity causing significant environmental damage (mercury, cyanide contamination)', ref:'LBMA RGG v9 Step 2 | Minamata Convention', l:4, i:4, mx:[] },
      { flag:'Supplier refuses environmental impact assessment or third-party audit', ref:'LBMA RGG v9 Step 4 | OECD DDG §5', l:3, i:4, mx:[] },
      { flag:'Gold originating from illegal or unlicensed mining operation', ref:'LBMA RGG v9 Step 2 | OECD DDG Annex II', l:5, i:5, mx:['high_risk_jurisdiction'] },
      { flag:'Supply chain involves displacement of indigenous communities without consent', ref:'LBMA RGG v9 Step 2 | UN Guiding Principles on Business and Human Rights', l:4, i:5, mx:[] },
      { flag:'Supplier lacks grievance mechanism or whistleblower channel for workers', ref:'LBMA RGG v9 Step 1 | UN Guiding Principles', l:3, i:3, mx:[] },
      { flag:'Supplier previously sanctioned or blacklisted for environmental violations', ref:'LBMA RGG v9 Step 3 | EU CAHRA Regulation', l:4, i:4, mx:[] },
    ],
    'Wire Transfer & Payment Anomalies': [
      { flag:'Wire transfer missing originator or beneficiary information (FATF Rec.16 violation)', ref:'FATF Rec.16 | CBUAE Wire Transfer Regulations', l:4, i:4, mx:[] },
      { flag:'Funds received from jurisdiction unrelated to the declared business relationship', ref:'FATF Rec.16 | Wolfsberg Wire Transfer Guidance', l:3, i:4, mx:['high_risk_jurisdiction'] },
      { flag:'Multiple wire transfers just below AED 3,500 threshold to avoid originator info requirements', ref:'FATF Rec.16 | Cabinet Resolution 134/2025', l:4, i:4, mx:['repeat'] },
      { flag:'Payment instructions changed at last moment to redirect to different beneficiary account', ref:'Wolfsberg ACSS 2019 | FATF TBML Guidance', l:4, i:4, mx:[] },
      { flag:'Correspondent bank relationship in jurisdiction with weak AML/CFT supervision', ref:'FATF Rec.13 | CBUAE Guidance', l:3, i:4, mx:['high_risk_jurisdiction'] },
      { flag:'Customer requests split payments across multiple bank accounts without business justification', ref:'FATF DPMS 2020 §4.3 | Wolfsberg ACSS 2019', l:4, i:3, mx:['repeat'] },
      { flag:'Rapid pass-through of funds: received and disbursed within 24 hours with no commercial activity', ref:'FATF Rec.20 | Cabinet Resolution 134/2025', l:4, i:4, mx:[] },
      { flag:'Customer insists on particular settlement method that reduces transparency', ref:'FATF DPMS 2020 §4.2', l:3, i:3, mx:[] },
    ],
    'Employee & Internal Controls': [
      { flag:'Employee bypasses compliance controls or overrides transaction monitoring alerts without documentation', ref:'UAE FDL No.(10)/2025 Art.21 | FATF Rec.18', l:5, i:5, mx:[] },
      { flag:'Employee refuses to complete mandatory AML/CFT training', ref:'UAE FDL No.(10)/2025 Art.21 | Cabinet Resolution 134/2025', l:3, i:4, mx:[] },
      { flag:'Employee lifestyle inconsistent with declared income or compensation', ref:'FATF Rec.18 | Internal Controls Best Practice', l:4, i:4, mx:[] },
      { flag:'Employee processes unusually high volume of transactions for a specific customer without explanation', ref:'FATF Rec.18 | Internal Audit Standards', l:4, i:4, mx:['repeat'] },
      { flag:'Employee has undisclosed external business relationship with a customer', ref:'UAE FDL No.(10)/2025 Art.21 | Conflict of Interest Policy', l:4, i:5, mx:[] },
      { flag:'Employee fails to report known suspicious activity to MLRO', ref:'UAE FDL No.(10)/2025 Art.26 | FATF Rec.20', l:5, i:5, mx:[] },
      { flag:'Employee accesses customer records without legitimate business reason', ref:'UAE Data Protection Law | Internal Controls', l:3, i:4, mx:[] },
      { flag:'Whistleblower report received regarding employee involvement in facilitation', ref:'UAE FDL No.(32)/2021 | Whistleblower Protection', l:5, i:5, mx:[] },
    ],
    'Responsible Sourcing (LBMA/OECD/DMCC/DGD/RMI)': [
      { flag:'Gold sourced from CAHRA (Conflict-Affected and High-Risk Area) without due diligence', ref:'LBMA RGG v9 Step 2 | OECD DDG Annex II | EU Conflict Minerals Reg', l:5, i:5, mx:['high_risk_jurisdiction'] },
      { flag:'Supplier fails LBMA Responsible Gold Guidance audit or loses Good Delivery status', ref:'LBMA RGG v9 Step 5 | DGD Standards', l:5, i:5, mx:[] },
      { flag:'Gold origin cannot be traced to mine or refinery of origin', ref:'LBMA RGG v9 Step 1 | OECD DDG Step 1 | RMI RMAP', l:5, i:5, mx:[] },
      { flag:'Artisanal/small-scale mining (ASM) source without enhanced DD', ref:'LBMA RGG v9 Step 2 | OECD DDG | RMI Due Diligence Standard', l:4, i:5, mx:[] },
      { flag:'Recycled gold declaration without verifiable provenance documentation', ref:'LBMA RGG v9 Step 1 | DMCC Rules for Responsible Sourcing', l:4, i:4, mx:[] },
      { flag:'Supplier not on DMCC Approved Refiner list or Dubai Good Delivery list', ref:'DMCC Rules | DGD Standards | LBMA Good Delivery List', l:4, i:4, mx:[] },
      { flag:'Discrepancy between declared gold origin and assay/hallmark markings', ref:'LBMA RGG v9 Step 1 | DGD Technical Standards', l:4, i:5, mx:[] },
      { flag:'Supply chain involves non-RMI conformant smelter or refinery', ref:'RMI RMAP Standard | OECD DDG Step 3', l:3, i:4, mx:[] },
    ],
    'Free Zone & Cross-Border': [
      { flag:'Customer operates across multiple UAE free zones without clear business rationale', ref:'FATF DPMS 2020 §4.3 | UAE FDL No.(10)/2025', l:3, i:3, mx:[] },
      { flag:'Goods re-exported from free zone without proper customs documentation', ref:'UAE Customs Law | DMCC Rules', l:4, i:4, mx:[] },
      { flag:'Customer uses free zone entity solely for transit/re-export to sanctioned jurisdiction', ref:'Cabinet Resolution 74/2020 | FATF Rec.19', l:5, i:5, mx:['sanctions','high_risk_jurisdiction'] },
      { flag:'Discrepancy between declared free zone activity and actual trading patterns', ref:'FATF DPMS 2020 | UAE Free Zone Authority Regulations', l:4, i:4, mx:[] },
      { flag:'Gold imported under free zone exemption then diverted to mainland without duties', ref:'UAE Customs Law | Free Zone Regulations', l:4, i:4, mx:[] },
      { flag:'Customer uses multiple free zone licenses to fragment transactions below reporting threshold', ref:'UAE FDL No.(10)/2025 | MoE Circular 08/AML/2021', l:4, i:4, mx:['repeat'] },
      { flag:'Cross-border shipment documentation inconsistent between exporting and importing country', ref:'FATF TBML Guidance 2020 | Wolfsberg ACSS 2019', l:4, i:4, mx:['high_risk_jurisdiction'] },
      { flag:'Customer requests delivery to bonded warehouse in third country without explanation', ref:'FATF TBML Guidance 2020', l:3, i:4, mx:['high_risk_jurisdiction'] },
    ],
    'Regulatory & Compliance Failures': [
      { flag:'Customer has been de-banked by multiple financial institutions', ref:'FATF Rec.10 | UAE FDL No.(10)/2025', l:4, i:5, mx:[] },
      { flag:'Customer subject to regulatory enforcement action in any jurisdiction', ref:'UAE FDL No.(10)/2025 Art.12 | FATF Rec.10', l:4, i:5, mx:[] },
      { flag:'Customer previously filed STR/SAR and continues same transaction patterns', ref:'UAE FDL No.(10)/2025 Art.26 | FATF Rec.20', l:5, i:5, mx:['repeat'] },
      { flag:'Customer entity has been struck off register but continues to trade', ref:'UAE Commercial Companies Law | FATF Rec.24', l:5, i:5, mx:[] },
      { flag:'Customer fails to provide updated KYC documents within agreed timeframe', ref:'UAE FDL No.(10)/2025 Art.12 | Cabinet Resolution 134/2025 Art.13', l:3, i:4, mx:[] },
      { flag:'Compliance controls bypassed or overridden by senior management instruction', ref:'UAE FDL No.(10)/2025 Art.21 | FATF Rec.18', l:5, i:5, mx:[] },
      { flag:'Customer uses legal professional privilege to obstruct compliance inquiries', ref:'FATF Rec.10 | UAE FDL No.(10)/2025', l:4, i:4, mx:[] },
      { flag:'Customer has outstanding regulatory fines or administrative penalties unpaid', ref:'Cabinet Resolution 71/2024 | UAE FDL No.(10)/2025', l:3, i:4, mx:[] },
    ],
    'Proliferation Financing — EOCN/FIU Institutional Risk': [
      { flag:'Customer or counterparty has nexus to DPRK, Iran, Syria, or UNSC PF-sanctioned state procurement networks', ref:'EOCN PF Guidance 2025 | UNSCR 1718/2231/1540 | Cabinet Resolution 74/2020', l:5, i:5, mx:['sanctions','high_risk_jurisdiction'] },
      { flag:'Transaction involves materials or equipment listed on UAE Strategic Goods Control List (Cabinet Resolution 156/2025)', ref:'Cabinet Resolution 156/2025 | UNSCR 1540 | EOCN PF RA Guidance', l:5, i:5, mx:['sanctions'] },
      { flag:'Customer attempts to procure high-purity precious metals or rare earth elements in quantities inconsistent with stated business', ref:'EOCN PF Guidance 2025 | FATF Rec.7 | UNSCR 2231', l:4, i:5, mx:[] },
      { flag:'End-user located in jurisdiction with known WMD development programme refuses to provide end-use certificate', ref:'EOCN PF Guidance 2025 | Cabinet Resolution 156/2025 | Wassenaar Arrangement', l:5, i:5, mx:['sanctions','high_risk_jurisdiction'] },
      { flag:'Transaction routed through multiple intermediaries to obscure final destination linked to PF-risk jurisdiction', ref:'EOCN PF Guidance 2025 | FATF PF Guidance 2021 | FDL No.10/2025', l:5, i:5, mx:['high_risk_jurisdiction','sanctions'] },
      { flag:'Customer entity is a front company or has opaque ownership linked to state-sponsored procurement agent', ref:'EOCN PF Guidance 2025 | FATF Rec.7 | Cabinet Resolution 74/2020', l:5, i:5, mx:['sanctions'] },
      { flag:'Shipping documentation shows transhipment through free zones to obfuscate final delivery to PF-sanctioned entity', ref:'EOCN PF Guidance 2025 | Cabinet Resolution 156/2025 | FATF Rec.7', l:5, i:5, mx:['sanctions','high_risk_jurisdiction'] },
      { flag:'Customer uses academic, research, or diplomatic cover to procure controlled or dual-use materials', ref:'EOCN PF Guidance 2025 | UNSCR 1540 | FATF PF Guidance 2021', l:4, i:5, mx:['sanctions'] },
      { flag:'Institutional PF risk assessment not conducted or not updated within 12 months as required by EOCN', ref:'EOCN PF RA Guidance 2025 | Cabinet Resolution 134/2025 Art.5 | FDL No.10/2025 Art.6', l:4, i:4, mx:[] },
      { flag:'Entity fails to implement targeted financial sanctions (TFS) freezing obligations without delay upon EOCN notification', ref:'EOCN TFS Guidance | Cabinet Resolution 74/2020 Art.4 | FDL No.10/2025 Art.14', l:5, i:5, mx:['sanctions'] },
      { flag:'Customer linked to military, intelligence, or defence procurement entity of PF-sanctioned country', ref:'EOCN PF Guidance 2025 | UNSCR 1718/2231 | FATF Rec.7', l:5, i:5, mx:['sanctions','high_risk_jurisdiction'] },
      { flag:'Transaction value or pattern inconsistent with legitimate commercial activity and consistent with PF acquisition typology', ref:'EOCN PF Guidance 2025 | FATF PF Guidance 2021 | UAE NRA 2024', l:4, i:5, mx:[] },
    ],
    'UAE FIU / goAML Reporting Red Flags': [
      { flag:'Failure to file STR/SAR within prescribed timeline after identifying suspicious activity', ref:'FDL No.10/2025 Art.26-27 | UAE FIU Guidance | FATF Rec.20', l:5, i:5, mx:[] },
      { flag:'goAML system access credentials shared among multiple staff members', ref:'UAE FIU goAML Guidance | FDL No.10/2025 Art.25 | Cabinet Resolution 134/2025', l:4, i:4, mx:[] },
      { flag:'DPMSR (DPMS Report) not filed for single or cumulative cash transactions ≥ AED 55,000', ref:'MoE Circular 08/AML/2021 | FDL No.10/2025 Art.16 | FATF Rec.22', l:5, i:5, mx:['cash'] },
      { flag:'Defensive STR filing without genuine suspicion analysis to avoid regulatory penalty', ref:'UAE FIU Guidance | FDL No.10/2025 Art.26 | FATF Rec.20', l:3, i:4, mx:[] },
      { flag:'STR filed but entity continues business relationship without enhanced monitoring or risk reassessment', ref:'UAE FIU Guidance | FDL No.10/2025 Art.26 | Cabinet Resolution 134/2025 Art.13', l:4, i:5, mx:['repeat'] },
      { flag:'Entity fails to respond to FIU information request within specified deadline', ref:'FDL No.10/2025 Art.14 & Art.42 | UAE FIU Guidance', l:5, i:5, mx:[] },
      { flag:'No SAR/STR log maintained or log does not capture required fields (date, subject, status, outcome)', ref:'FDL No.10/2025 Art.26 | Cabinet Resolution 134/2025 Art.17 | MoE Inspection Checklist', l:4, i:4, mx:[] },
      { flag:'Customer exhibits same suspicious patterns previously reported in STR but no escalation or exit decision made', ref:'UAE FIU Guidance | FDL No.10/2025 Art.15-16 | Cabinet Resolution 134/2025', l:5, i:5, mx:['repeat'] },
    ],
    'EOCN / Executive Office TFS Compliance': [
      { flag:'Screening not conducted within 24 hours of new EOCN/UNSC designation notification', ref:'EOCN TFS Guidance | Cabinet Resolution 74/2020 Art.4 | FDL No.10/2025 Art.14', l:5, i:5, mx:['sanctions'] },
      { flag:'CNMR (Compliance No-Match Report) not filed within 5 business days of confirmed/partial match', ref:'EOCN TFS Guidance | Cabinet Resolution 74/2020 Art.6', l:5, i:5, mx:['sanctions'] },
      { flag:'Entity does not maintain documented TFS screening procedures or screening audit trail', ref:'EOCN TFS Guidance | Cabinet Resolution 74/2020 | Cabinet Resolution 134/2025 Art.14', l:4, i:5, mx:[] },
      { flag:'Assets not frozen without delay upon confirmed match — any delay in executing freeze order', ref:'EOCN TFS Guidance | Cabinet Resolution 74/2020 Art.4-5 | FDL No.10/2025 Art.14', l:5, i:5, mx:['sanctions'] },
      { flag:'De-listing or unfreezing executed without prior EOCN authorization', ref:'EOCN TFS Guidance | Cabinet Resolution 74/2020 Art.7 | FDL No.10/2025', l:5, i:5, mx:['sanctions'] },
      { flag:'TFS screening database not updated to include latest EOCN Local Terrorist List and UNSC Consolidated List', ref:'EOCN TFS Guidance | Cabinet Resolution 74/2020 | Cabinet Resolution 134/2025', l:4, i:5, mx:['sanctions'] },
      { flag:'Attempt to circumvent or evade TFS measures through use of agents, nominees, or alternative payment channels', ref:'EOCN TFS Guidance | Cabinet Resolution 74/2020 Art.5 | FDL No.10/2025 Art.14', l:5, i:5, mx:['sanctions'] },
      { flag:'Entity permits transactions with designated person during "without delay" freeze period', ref:'EOCN TFS Guidance | Cabinet Resolution 74/2020 Art.4 | FATF Rec.6', l:5, i:5, mx:['sanctions'] },
    ],
    'MOE Supervisory & Inspection Red Flags': [
      { flag:'Entity unable to produce compliance manual, EWRA/BWRA, or risk appetite statement during MOE inspection', ref:'Cabinet Resolution 134/2025 Art.5-6 | FDL No.10/2025 Art.20-21 | MoE Inspection Framework', l:5, i:5, mx:[] },
      { flag:'Compliance Officer (CO/MLRO) not appointed or does not meet minimum competency requirements', ref:'FDL No.10/2025 Art.20 | Cabinet Resolution 134/2025 Art.18 | MoE DPMS Guidance', l:5, i:5, mx:[] },
      { flag:'No evidence of AML/CFT/CPF training conducted within the past 12 months for all relevant staff', ref:'FDL No.10/2025 Art.21 | Cabinet Resolution 134/2025 Art.20 | MoE Inspection Checklist', l:4, i:4, mx:[] },
      { flag:'Customer risk assessment (CRA) methodology does not align with NRA 2024 findings or sectoral guidance', ref:'Cabinet Resolution 134/2025 Art.5 | UAE NRA 2024 | MoE DPMS Circular', l:4, i:4, mx:[] },
      { flag:'Record retention policy missing or records destroyed before the mandatory 10-year retention period', ref:'FDL No.10/2025 Art.24 | Cabinet Resolution 134/2025 Art.21 | MoE DPMS Guidance', l:5, i:5, mx:[] },
      { flag:'Entity has not conducted independent AML/CFT audit as required by Cabinet Resolution 134/2025', ref:'Cabinet Resolution 134/2025 Art.19 | FATF Rec.18 | MoE Inspection Checklist', l:4, i:5, mx:[] },
      { flag:'Board/Senior Management have not been briefed on compliance findings within the last reporting period', ref:'FDL No.10/2025 Art.20-21 | Cabinet Resolution 134/2025 Art.18-19', l:4, i:4, mx:[] },
      { flag:'Entity operates without valid MoE DPMS registration or goAML portal access', ref:'FDL No.10/2025 Art.53 | MoE Circular 08/AML/2021 | MoE DPMS Registration Requirements', l:5, i:5, mx:[] },
    ],
    'PF Threats, Vulnerabilities & Consequences (EOCN Guidance)': [
      { flag:'UBO of customer entity is owned or controlled by UN-sanctioned person (indirect sanctions exposure)', ref:'EOCN PF RA Guidance 2025 | Cabinet Resolution 74/2020 | FATF Rec.7', l:5, i:5, mx:['sanctions'] },
      { flag:'Customer uses front or shell company to obscure link to proliferation network or sanctioned entity', ref:'EOCN PF RA Guidance 2025 | FATF Rec.24 | Cabinet Resolution 134/2025', l:5, i:5, mx:['sanctions','high_risk_jurisdiction'] },
      { flag:'Customer engages in production or trade of proliferation-sensitive goods alongside precious metals trading', ref:'EOCN PF RA Guidance 2025 | Cabinet Resolution 156/2025 Art.3-5', l:4, i:5, mx:['sanctions'] },
      { flag:'Gold purchase routed through neighbouring country of DPRK or Iran to circumvent TFS', ref:'EOCN PF RA Guidance 2025 | FATF PF Guidance 2021 | Cabinet Resolution 74/2020', l:5, i:5, mx:['sanctions','high_risk_jurisdiction'] },
      { flag:'Customer uses international corporate vehicles for gold investment or structuring without clear commercial rationale', ref:'EOCN PF RA Guidance 2025 | FATF Rec.24 | Cabinet Resolution 134/2025', l:4, i:4, mx:['high_risk_jurisdiction'] },
      { flag:'Inconsistency between proposed gold transactions and customer socio-economic profile or declared business activity', ref:'EOCN PF RA Guidance 2025 | FDL No.10/2025 Art.14 | FATF Rec.10', l:4, i:4, mx:[] },
      { flag:'Power of attorney holders or authorized signatories not subjected to full CDD and TFS screening', ref:'EOCN PF RA Guidance 2025 | Cabinet Resolution 134/2025 Art.8 | FDL No.10/2025 Art.12', l:4, i:5, mx:[] },
      { flag:'Senior management approval not obtained before onboarding customer posing PF risk', ref:'EOCN PF RA Guidance 2025 | Cabinet Resolution 134/2025 Art.14 | FDL No.10/2025 Art.16', l:5, i:5, mx:[] },
      { flag:'Beneficial ownership threshold not reduced from 25% to 10% for high-risk corporate customers as recommended by EOCN', ref:'EOCN PF RA Guidance 2025 | Cabinet Resolution 134/2025 Art.8', l:3, i:4, mx:[] },
      { flag:'No PF-specific training conducted for employees including customer-facing staff and screening personnel', ref:'EOCN PF RA Guidance 2025 | FDL No.10/2025 Art.21 | Cabinet Resolution 134/2025 Art.20', l:4, i:4, mx:[] },
      { flag:'New product, service, or delivery channel launched without prior PF vulnerability assessment', ref:'EOCN PF RA Guidance 2025 | Cabinet Resolution 134/2025 Art.5 | FDL No.10/2025 Art.22', l:4, i:4, mx:[] },
      { flag:'Employee screening for PF linkages not conducted before hiring or upon role change', ref:'EOCN PF RA Guidance 2025 | FDL No.10/2025 Art.21 | Cabinet Resolution 134/2025', l:3, i:4, mx:[] },
      { flag:'Entity has not consulted international PF typology reports or UAE sectoral PF reports in its risk assessment', ref:'EOCN PF RA Guidance 2025 | FATF PF Guidance 2021 | UAE NRA 2024', l:3, i:3, mx:[] },
      { flag:'Cyber risk to AML/CFT/CPF screening systems not assessed as PF vulnerability', ref:'EOCN PF RA Guidance 2025 | Cabinet Resolution 134/2025 Art.5', l:3, i:4, mx:[] },
      { flag:'Customer linked to illicit networks seeking nuclear, biological, or chemical materials or delivery systems', ref:'EOCN PF RA Guidance 2025 | UNSCR 1540 | FATF Rec.7 | Cabinet Resolution 156/2025', l:5, i:5, mx:['sanctions'] },
    ],
    'Virtual Assets & VASP Exposure': [
      { flag:'Customer pays for gold using stablecoin or other virtual asset', ref:'FATF Rec.15 | VARA UAE | Cabinet Resolution 134/2025 Art.16', l:4, i:4, mx:[] },
      { flag:'VASP wallet address matches OFAC SDN crypto addenda', ref:'OFAC SDN crypto addenda | Cabinet Resolution 74/2020', l:5, i:5, mx:['sanctions'] },
      { flag:'Wallet history shows mixer / tumbler usage prior to settlement', ref:'FATF VA Guidance 2021 | Cabinet Resolution 134/2025 Art.16', l:5, i:5, mx:[] },
      { flag:'Customer cannot explain origin of crypto used for payment', ref:'FATF Rec.15 | UAE FDL No.(10)/2025 Art.14', l:4, i:4, mx:[] },
      { flag:'Use of privacy coins (Monero, Zcash, Dash) for any portion of settlement', ref:'FATF VA Guidance 2021', l:5, i:5, mx:[] },
      { flag:'On-chain settlement immediately bridged to a non-custodial wallet', ref:'FATF Rec.15 | VARA UAE', l:4, i:4, mx:[] },
      { flag:'Wallet linked via clustering to a known darknet marketplace', ref:'FATF VA Guidance 2021', l:5, i:5, mx:['sanctions'] },
    ],
    'Adverse Media & Reputational': [
      { flag:'Customer named in ICIJ / OCCRP / Bellingcat / Global Witness investigation', ref:'FATF Rec.10 | UAE FDL No.(10)/2025 Art.14', l:4, i:5, mx:[] },
      { flag:'Customer subject to active law enforcement investigation in any jurisdiction', ref:'FATF Rec.10 | Cabinet Resolution 134/2025 Art.14', l:5, i:5, mx:[] },
      { flag:'Customer mentioned in Pandora / Panama / Paradise Papers leaks', ref:'FATF Rec.10 | UAE NRA 2024', l:4, i:4, mx:[] },
      { flag:'Customer subject to a recent civil asset-recovery order', ref:'FATF Rec.10', l:4, i:4, mx:[] },
      { flag:'Customer family member or close associate convicted of corruption', ref:'FATF Rec.12 | UAE FDL No.(10)/2025 Art.16', l:4, i:5, mx:['pep'] },
      { flag:'Customer mentioned in human-rights NGO report', ref:'OECD DDG | LBMA RGG v9 Step 5', l:4, i:5, mx:[] },
      { flag:'Customer linked to environmental crimes via investigative journalism', ref:'FATF Environmental Crime 2021', l:4, i:4, mx:[] },
    ],
    'Cyber & Insider Threat': [
      { flag:'Anomalous login pattern on the customer account (geo + device + time)', ref:'FATF Cyber-Enabled Crime 2023', l:3, i:4, mx:[] },
      { flag:'Customer credentials previously appeared in a known data-breach corpus', ref:'NIST 800-63B | UAE Cyber Security Council 2024', l:3, i:4, mx:[] },
      { flag:'Customer device fingerprint shared with a previously confirmed mule account', ref:'FATF Cyber-Enabled Crime 2023', l:5, i:5, mx:['repeat'] },
      { flag:'Insider staff member observed accessing customer record outside their portfolio', ref:'FATF Rec.18 | UAE Cyber Security Council 2024', l:4, i:4, mx:[] },
      { flag:'Insider staff member with access to the freeze workflow exhibits unusual login pattern', ref:'FATF Rec.18 | EOCN TFS Guidance', l:4, i:5, mx:[] },
    ],
    'Human Trafficking & Modern Slavery': [
      { flag:'Customer cannot speak for themselves; an unrelated third party answers', ref:'UAE Federal Law No.51/2006 | FATF HT Guidance 2018', l:5, i:5, mx:[] },
      { flag:'Visible signs of coercion or fear during in-person transaction', ref:'FATF HT Guidance 2018', l:5, i:5, mx:[] },
      { flag:'Customer carries identification belonging to multiple individuals', ref:'FATF HT Guidance 2018', l:5, i:5, mx:[] },
      { flag:'Customer pays for goods on behalf of someone not present', ref:'FATF HT Guidance 2018', l:4, i:4, mx:[] },
      { flag:'Customer staying in conditions inconsistent with declared income', ref:'UK Modern Slavery Act statement | FATF HT Guidance 2018', l:4, i:4, mx:[] },
    ],
    'Wildlife & Environmental Crime': [
      { flag:'Customer attempts to sell ivory, rhino horn, or other CITES-listed product alongside gold', ref:'CITES | FATF Environmental Crime 2021', l:5, i:5, mx:[] },
      { flag:'Suspected illegal mining proceeds laundered via gold purchase', ref:'FATF Illegal Mining 2021 | OECD DDG', l:5, i:5, mx:[] },
      { flag:'Source ASM site documented in UNEP environmental violation report', ref:'OECD DDG §4 | UNEP', l:4, i:5, mx:[] },
    ],
    'Tax Evasion & Underground Banking': [
      { flag:'Customer references hawala or undocumented value-transfer system', ref:'FATF Rec.14 | UAE FDL No.(10)/2025 Art.14', l:5, i:5, mx:[] },
      { flag:'Customer requests invoice in name of unrelated third-party for tax purposes', ref:'FATF TBML Guidance 2020 | UAE FTA', l:4, i:4, mx:[] },
      { flag:'Customer asks for split invoices to stay below VAT registration threshold', ref:'UAE FTA Decree-Law 8/2017 | FATF TBML 2020', l:4, i:4, mx:[] },
      { flag:'Customer pays in foreign currency from a country with strict capital controls', ref:'FATF Rec.14 | IMF capital-controls list', l:4, i:4, mx:['high_risk_jurisdiction'] },
    ],
    'Behavioural & Psychological': [
      { flag:'Customer rehearses answers to KYC questions verbatim from a script', ref:'FATF DPMS 2020 §4.2', l:3, i:4, mx:[] },
      { flag:'Customer makes nervous eye contact / sweats / fidgets when asked source-of-funds questions', ref:'FATF DPMS 2020 §4.2', l:2, i:3, mx:[] },
      { flag:'Customer threatens to take business elsewhere when asked compliance questions', ref:'FATF DPMS 2020 §4.2', l:3, i:4, mx:[] },
      { flag:'Customer attempts to bribe or tip the employee to skip verification', ref:'FATF Rec.10 | UAE Federal Law No.31/2021', l:5, i:5, mx:[] },
    ],
    'Trade-Based Money Laundering (TBML)': [
      { flag:'Invoice value materially mismatches LBMA spot reference for the day', ref:'FATF TBML 2020 | LBMA RGG v9', l:5, i:5, mx:['cash'] },
      { flag:'Multiple invoices from same counterparty issued on the same day with sequential numbers', ref:'FATF TBML 2020 §3.4', l:4, i:4, mx:[] },
      { flag:'Phantom shipment — invoice issued but no shipping document or chain-of-custody record', ref:'FATF TBML 2020 §3.2 | LBMA CoC', l:5, i:5, mx:[] },
      { flag:'Goods routed through 3+ jurisdictions before arriving at named consignee', ref:'FATF TBML 2020 | OECD DDG §3', l:4, i:5, mx:['high_risk_jurisdiction'] },
      { flag:'Re-invoicing — same goods invoiced twice to different parties', ref:'FATF TBML 2020 §3.4', l:5, i:5, mx:[] },
      { flag:'Shell-company consignee whose name does not match the customs declaration', ref:'FATF TBML 2020 | EOCN Bulletin', l:5, i:5, mx:[] },
      { flag:'Settlement currency differs from invoice currency without commercial justification', ref:'FATF TBML 2020 §3.5', l:3, i:4, mx:[] },
    ],
    'Proliferation Financing (PF) & Dual-Use': [
      { flag:'End-user listed on UAE Strategic Goods Control list', ref:'Cabinet Res 156/2025 | UAE FCSA', l:5, i:5, mx:['sanctions'] },
      { flag:'Counterparty linked to DPRK / Iran / Syria sanctioned entity per UN 1718/2231', ref:'UNSCR 1718 | UNSCR 2231 | Cabinet Res 74/2020', l:5, i:5, mx:['sanctions'] },
      { flag:'Refined gold purchased for delivery to a known weapons-procurement front company', ref:'FATF PF Guidance 2021', l:5, i:5, mx:['sanctions'] },
      { flag:'Customer attempts to source rhenium, tungsten, beryllium, or other dual-use precursor alongside gold', ref:'Wassenaar Arrangement | EU Reg 2021/821', l:5, i:5, mx:[] },
      { flag:'Trade finance request involves a maritime vessel flagged on UANI / OFAC SDN', ref:'OFAC Maritime Advisory 2020 | EOCN', l:5, i:5, mx:['sanctions'] },
    ],
    'Layering & Structuring': [
      { flag:'Multiple cash deposits just below AED 55K threshold across a 7-day window', ref:'MoE Circular 08/AML/2021 | FATF Rec.10', l:5, i:5, mx:['cash'] },
      { flag:'Customer splits one large transaction into 4+ smaller ones at different branches', ref:'FATF Rec.10 | UAE FDL No.(10)/2025 Art.15', l:5, i:5, mx:['cash'] },
      { flag:'Funds layered through 3+ correspondent accounts before reaching gold dealer', ref:'FATF Rec.13 | Wolfsberg CBDDQ', l:4, i:5, mx:[] },
      { flag:'Customer makes rapid back-to-back buy/sell trades with no economic rationale', ref:'FATF Rec.20 | LBMA RGG v9 §3', l:4, i:4, mx:[] },
      { flag:'Customer uses third-party agent to deposit funds, then collects gold personally', ref:'FATF Rec.10 | UAE FDL Art.13', l:4, i:5, mx:[] },
      { flag:'Beneficial owner declared after the third refusal to disclose', ref:'Cabinet Decision 109/2023 | FATF Rec.24', l:4, i:5, mx:[] },
    ],
    'NPO & Charity Abuse': [
      { flag:'Customer is registered NPO making bulk gold purchases inconsistent with stated charitable mission', ref:'FATF Rec.8 | UAE FDL Art.13', l:4, i:5, mx:[] },
      { flag:'NPO source-of-funds traced to jurisdictions on FATF grey/black list', ref:'FATF Rec.8 | FATF High-Risk Jurisdictions', l:5, i:5, mx:['high_risk_jurisdiction'] },
      { flag:'NPO uses gold as a value-transfer mechanism to terror-affected regions', ref:'FATF NPO Best Practices 2015 | UNSCR 1373', l:5, i:5, mx:['sanctions'] },
      { flag:'Charity invoice references project in CAHRA without OECD DDG mitigation evidence', ref:'OECD DDG §4 | LBMA RGG v9 Step 3', l:4, i:5, mx:['high_risk_jurisdiction'] },
    ],
    'PEP & Influence Risk': [
      { flag:'Foreign PEP attempts to purchase >AED 100K in physical gold for "personal use"', ref:'FATF Rec.12 | Cabinet Res 134/2025 Art.14', l:5, i:5, mx:['pep'] },
      { flag:'Domestic PEP family member structures purchases below CTR threshold', ref:'FATF Rec.12 | UAE FDL Art.14', l:4, i:5, mx:['pep','cash'] },
      { flag:'PEP source-of-wealth narrative not corroborated by published asset declaration', ref:'FATF PEP Guidance 2013 | UAE FDL Art.14', l:4, i:5, mx:['pep'] },
      { flag:'PEP introduces new counterparty and personally guarantees their KYC', ref:'FATF Rec.12 | Wolfsberg AAGD', l:4, i:5, mx:['pep'] },
      { flag:'Close associate of a PEP attempts to use a corporate vehicle to mask ownership', ref:'FATF Rec.12 | Cabinet Decision 109/2023', l:5, i:5, mx:['pep'] },
    ],
    'Insurance & Title Fraud': [
      { flag:'Insurance certificate for shipment shows altered values vs original carrier paperwork', ref:'FATF TBML 2020 | LBMA CoC', l:5, i:5, mx:[] },
      { flag:'Same insurance policy number used across multiple unrelated shipments', ref:'FATF TBML 2020 §3.4', l:4, i:5, mx:[] },
      { flag:'Title transfer occurs in a free zone with no underlying physical movement', ref:'FATF Free Trade Zones 2010 | EOCN', l:4, i:4, mx:[] },
      { flag:'Bonded warehouse receipt presented for gold not actually held in custody (audit fail)', ref:'LBMA Vault Operators Manual | DGD', l:5, i:5, mx:[] },
    ],
  };

  function renderRedFlags() {
    const el = document.getElementById('suite-content-redflags');
    if (!el) return;

    const customFlags = getCustomFlags();

    // Count flags by level (including custom)
    let counts = { Critical:0, High:0, Medium:0, Low:0, total:0 };
    Object.values(RED_FLAGS_DB).forEach(flags => flags.forEach(f => {
      const lvl = rfLevel(f.l * f.i);
      counts[lvl]++;
      counts.total++;
    }));
    customFlags.forEach(f => {
      const lvl = rfLevel(f.l * f.i);
      counts[lvl]++;
      counts.total++;
    });

    el.innerHTML = `
      <div class="card" style="margin-bottom:1rem">
        <div class="top-bar">
          <span class="sec-title">🚩 Red Flag Library — DPMS Gold Trading (${counts.total} Flags)</span>
          <span style="font-size:11px;color:var(--muted)">L × I Scoring | FATF DPMS 2020 | UAE FDL No.(10)/2025 | LBMA RGG v9 | Wolfsberg ACSS</span>
        </div>

        <!-- Risk Score Summary -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:1rem">
          <div class="metric m-c" style="cursor:pointer" data-action="suiteFilterRFLevel" data-arg="Critical">
            <div class="metric-num">${counts.Critical}</div>
            <div class="metric-lbl">Critical (16–25)</div>
          </div>
          <div class="metric m-h" style="cursor:pointer" data-action="suiteFilterRFLevel" data-arg="High">
            <div class="metric-num">${counts.High}</div>
            <div class="metric-lbl">High (11–15)</div>
          </div>
          <div class="metric m-m" style="cursor:pointer" data-action="suiteFilterRFLevel" data-arg="Medium">
            <div class="metric-num">${counts.Medium}</div>
            <div class="metric-lbl">Medium (6–10)</div>
          </div>
          <div class="metric m-ok" style="cursor:pointer" data-action="suiteFilterRFLevel" data-arg="Low">
            <div class="metric-num">${counts.Low}</div>
            <div class="metric-lbl">Low (1–5)</div>
          </div>
        </div>

        <!-- Scoring Model Reference -->
        <div style="background:var(--surface2);border-radius:4px;padding:12px;margin-bottom:1rem;font-size:12px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <strong style="color:var(--gold)">Risk Score = Likelihood (1–5) × Impact (1–5)</strong><br>
              <span style="color:var(--muted)">Critical ≥16 | High 11–15 | Medium 6–10 | Low 1–5</span>
            </div>
            <div>
              <strong style="color:var(--gold)">Multipliers</strong><br>
              <span style="color:var(--muted)">Sanctions ×2 | High-risk jurisdiction ×1.5 | PEP ×1.5 | Cash ×1.5 | Repeat ×1.5</span>
            </div>
          </div>
        </div>

        <!-- System Action Rules -->
        <div style="background:var(--surface2);border-radius:4px;padding:12px;margin-bottom:1rem;font-size:12px">
          <strong style="color:var(--gold)">Composite Risk Rule:</strong> TOTAL_SCORE = Σ (each flag score × multiplier)<br>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:8px">
            <div style="background:rgba(217,79,79,0.1);border-radius:3px;padding:8px;border-left:3px solid var(--red)">
              <div style="font-weight:600;color:var(--red)">≥1 CRITICAL flag</div>
              <div style="color:var(--muted);margin-top:2px">Immediate escalation + STR consideration</div>
            </div>
            <div style="background:rgba(232,160,48,0.1);border-radius:3px;padding:8px;border-left:3px solid var(--amber)">
              <div style="font-weight:600;color:var(--amber)">≥2 HIGH flags</div>
              <div style="color:var(--muted);margin-top:2px">STR consideration + EDD required</div>
            </div>
            <div style="background:rgba(74,143,193,0.1);border-radius:3px;padding:8px;border-left:3px solid var(--blue)">
              <div style="font-weight:600;color:#4A8FC1">≥3 MEDIUM flags</div>
              <div style="color:var(--muted);margin-top:2px">EDD trigger + enhanced monitoring</div>
            </div>
            <div style="background:rgba(61,168,118,0.1);border-radius:3px;padding:8px;border-left:3px solid var(--green)">
              <div style="font-weight:600;color:var(--green)">LOW only</div>
              <div style="color:var(--muted);margin-top:2px">Log + trend analysis only</div>
            </div>
          </div>
        </div>

        <!-- Search, Filter and Add -->
        <div style="display:flex;gap:8px;margin-bottom:1rem;flex-wrap:wrap">
          <input type="text" id="rf-search" placeholder="Search red flags..." oninput="suiteFilterRedFlags(this.value)" style="flex:1;min-width:200px"/>
          <select id="rf-level-filter" onchange="suiteFilterRFLevel(this.value)" style="width:150px">
            <option value="">All Levels</option>
            <option value="Critical">🔴 Critical</option>
            <option value="High">🟠 High</option>
            <option value="Medium">🟡 Medium</option>
            <option value="Low">🟢 Low</option>
          </select>
          <button class="btn btn-sm btn-green" data-action="suiteAddRedFlag" style="white-space:nowrap">+ Add Red Flag</button>
        </div>

        <div id="rf-results">
          ${Object.entries(RED_FLAGS_DB).map(([cat, flags]) => `
            <div class="card rf-category" style="margin-bottom:1rem;padding:1rem">
              <div class="sec-title" style="margin-bottom:10px">${cat} (${flags.length})</div>
              ${flags.map(f => {
                const score = f.l * f.i;
                const lvl = rfLevel(score);
                const rl = RF_LEVEL[lvl];
                const mxLabels = (f.mx||[]).map(m => RF_MULTIPLIERS[m]?.label).filter(Boolean);
                return `
                <div class="rf-item" data-text="${f.flag.toLowerCase()}" data-level="${lvl}"
                  style="padding:10px 12px;border-radius:3px;border:1px solid ${rl.border};margin-bottom:6px;background:${rl.bg}">
                  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
                    <div style="font-size:13px;font-weight:500;flex:1">${esc(f.flag)}</div>
                    <div style="flex-shrink:0;text-align:right">
                      <div style="background:${rl.bg};color:${rl.col};border:1px solid ${rl.border};border-radius:3px;padding:2px 8px;font-size:10px;font-family:'Montserrat',sans-serif;white-space:nowrap">${lvl} — ${score}</div>
                      <div style="font-size:10px;color:var(--muted);margin-top:3px;font-family:'Montserrat',sans-serif">L:${f.l} × I:${f.i} = ${score}</div>
                    </div>
                  </div>
                  <div style="font-size:11px;color:var(--gold);font-family:'Montserrat',sans-serif;margin-top:4px">${esc(f.ref)}</div>
                  <div style="font-size:11px;color:var(--muted);margin-top:4px">${rl.action}</div>
                  ${mxLabels.length ? `<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px">${mxLabels.map(m=>`<span style="background:rgba(232,160,48,0.15);color:var(--amber);border:1px solid rgba(232,160,48,0.3);border-radius:4px;padding:1px 6px;font-size:10px;font-family:'Montserrat',sans-serif">×${RF_MULTIPLIERS[(f.mx||[]).find(k=>RF_MULTIPLIERS[k]?.label===m)]?.factor} ${m}</span>`).join('')}</div>` : ''}
                </div>`;
              }).join('')}
            </div>
          `).join('')}
          ${customFlags.length ? `
            <div class="card rf-category" style="margin-bottom:1rem;padding:1rem">
              <div class="sec-title" style="margin-bottom:10px">Custom Red Flags (${customFlags.length})</div>
              ${customFlags.map(f => {
                const score = f.l * f.i;
                const lvl = rfLevel(score);
                const rl = RF_LEVEL[lvl];
                return `
                <div class="rf-item" data-text="${f.flag.toLowerCase()}" data-level="${lvl}"
                  style="padding:10px 12px;border-radius:3px;border:1px solid ${rl.border};margin-bottom:6px;background:${rl.bg}">
                  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
                    <div style="font-size:13px;font-weight:500;flex:1">${esc(f.flag)}</div>
                    <div style="flex-shrink:0;display:flex;align-items:center;gap:6px">
                      <div style="background:${rl.bg};color:${rl.col};border:1px solid ${rl.border};border-radius:3px;padding:2px 8px;font-size:10px;font-family:'Montserrat',sans-serif;white-space:nowrap">${lvl} — ${score}</div>
                      <button class="btn btn-sm btn-gold" data-action="suiteEditRedFlag" data-arg="${f.id}" style="padding:2px 6px;font-size:9px">Edit</button>
                      <button class="btn btn-sm btn-red" data-action="suiteDeleteRedFlag" data-arg="${f.id}" style="padding:2px 6px;font-size:9px">Del</button>
                    </div>
                  </div>
                  <div style="font-size:11px;color:var(--gold);font-family:'Montserrat',sans-serif;margin-top:4px">${esc(f.ref)}</div>
                  <div style="font-size:11px;color:var(--muted);margin-top:4px">L:${f.l} × I:${f.i} = ${score} · ${rl.action}</div>
                </div>`;
              }).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  global.suiteFilterRedFlags = function(query) {
    const q = query.toLowerCase();
    const lvl = document.getElementById('rf-level-filter')?.value || '';
    document.querySelectorAll('.rf-item').forEach(item => {
      const textMatch = !q || item.dataset.text.includes(q);
      const lvlMatch = !lvl || item.dataset.level === lvl;
      item.style.display = textMatch && lvlMatch ? '' : 'none';
    });
    // Hide empty categories
    document.querySelectorAll('.rf-category').forEach(cat => {
      const visible = [...cat.querySelectorAll('.rf-item')].some(i => i.style.display !== 'none');
      cat.style.display = visible ? '' : 'none';
    });
  };

  global.suiteFilterRFLevel = function(level) {
    const sel = document.getElementById('rf-level-filter');
    if (sel) sel.value = level;
    global.suiteFilterRedFlags(document.getElementById('rf-search')?.value || '');
  };

  // ── Custom Red Flags (user-added, stored in localStorage) ──
  const CUSTOM_RF_STORAGE = 'fgl_custom_red_flags';
  function getCustomFlags() { try { return JSON.parse(localStorage.getItem(CUSTOM_RF_STORAGE)||'[]'); } catch(e) { return []; } }
  function saveCustomFlags(flags) { localStorage.setItem(CUSTOM_RF_STORAGE, JSON.stringify(flags)); }

  global.suiteAddRedFlag = function() {
    const flag = prompt('Enter the red flag description:');
    if (!flag || !flag.trim()) return;
    const ref = prompt('Regulatory reference (e.g. FATF Rec.10):') || 'Custom';
    const l = parseInt(prompt('Likelihood (1-5):'), 10) || 3;
    const i = parseInt(prompt('Impact (1-5):'), 10) || 3;
    const custom = getCustomFlags();
    custom.push({ flag: flag.trim(), ref, l: Math.min(5,Math.max(1,l)), i: Math.min(5,Math.max(1,i)), mx: [], custom: true, id: Date.now() });
    saveCustomFlags(custom);
    renderRedFlags();
    toast('Red flag added', 'success');
  };

  global.suiteEditRedFlag = function(id) {
    const custom = getCustomFlags();
    const idx = custom.findIndex(f => f.id === id);
    if (idx < 0) return;
    const f = custom[idx];
    const flag = prompt('Edit red flag description:', f.flag);
    if (!flag || !flag.trim()) return;
    const ref = prompt('Regulatory reference:', f.ref) || f.ref;
    const l = parseInt(prompt('Likelihood (1-5):', f.l), 10) || f.l;
    const i = parseInt(prompt('Impact (1-5):', f.i), 10) || f.i;
    custom[idx] = { ...f, flag: flag.trim(), ref, l: Math.min(5,Math.max(1,l)), i: Math.min(5,Math.max(1,i)) };
    saveCustomFlags(custom);
    renderRedFlags();
    toast('Red flag updated', 'success');
  };

  global.suiteDeleteRedFlag = function(id) {
    if (!confirm('Delete this custom red flag?')) return;
    const custom = getCustomFlags().filter(f => f.id !== id);
    saveCustomFlags(custom);
    renderRedFlags();
    toast('Red flag deleted', 'success');
  };

  // ════════════════════════════════════════════════════════════════════════════
  // 6. APPROVAL MATRIX — UNIFIED (Four-Eyes + Management Approvals)
  // Reg: UAE FDL No.(10) of 2025 | Cabinet Resolution 134/2025 | CBUAE Standards
  // ════════════════════════════════════════════════════════════════════════════

  const APPROVAL_TYPES = [
    // ── FDL No.(10)/2025: Risk Assessment (Art.4) ──
    { type: 'EWRA/BWRA Annual Review', sla: 168, desc: 'Annual enterprise/business-wide risk assessment. FDL Art.4, Cabinet Res 134/2025 Art.3' },
    { type: 'New Product/Service ML/TF Risk Assessment', sla: 72, desc: 'Risk assessment before new product/service/technology launch. FDL Art.4(3)' },
    { type: 'Material Risk Change Review', sla: 48, desc: 'Quarterly review triggered by material change in risk profile. FDL Art.4, FATF Rec 1' },
    // ── FDL Art.12-13: Customer Identification & Verification ──
    { type: 'High-Risk Customer Onboarding', sla: 24, desc: 'EDD sign-off before relationship commences. FDL Art.12-14, FATF Rec 10' },
    { type: 'CDD Failure - Relationship Decision', sla: 24, desc: 'Business relationship cannot proceed where CDD incomplete. FDL Art.12(5), Cabinet Res 134/2025 Art.14' },
    { type: 'Inconsistent ID Information', sla: 24, desc: 'Customer provides inconsistent identification - escalation required. FDL Art.12' },
    { type: 'Customer Refuses KYC Documents', sla: 4, desc: 'Customer refuses identification documents - mandatory escalation. FDL Art.12, FATF Rec 10' },
    // ── FDL Art.14: Enhanced Due Diligence ──
    { type: 'EDD Sign-Off', sla: 48, desc: 'Enhanced Due Diligence requires compliance officer sign-off. FDL Art.14, FATF Rec 10' },
    { type: 'Source of Funds Verification', sla: 48, desc: 'SOF/SOW verification for high-risk customers. FDL Art.14, Cabinet Res 134/2025 Art.13' },
    { type: 'Customer Risk Upgrade', sla: 48, desc: 'Risk upgrade to High/Very High requires MLRO review. FDL Art.14, FATF RBA' },
    // ── FDL Art.16: PEP Requirements ──
    { type: 'PEP Onboarding', sla: 48, desc: 'Senior Management approval for PEP onboarding. FDL Art.16, FATF Rec 12' },
    { type: 'PEP Family/Associate Onboarding', sla: 48, desc: 'PEP family member or close associate requires same approval. FDL Art.16(2)' },
    { type: 'PEP Ongoing Monitoring Review', sla: 72, desc: 'Enhanced ongoing monitoring review for PEP relationships. FDL Art.16(3)' },
    // ── FDL Art.17: Wire Transfer Requirements ──
    { type: 'Wire Transfer Missing Info', sla: 4, desc: 'Incomplete originator/beneficiary info on wire transfer. FDL Art.17, FATF Rec 16' },
    { type: 'Cross-Border Wire Over Threshold', sla: 4, desc: 'Cross-border wire transfer requires full originator info. FDL Art.17, FATF Rec 16' },
    // ── FDL Art.18: Simplified Due Diligence ──
    { type: 'SDD Application', sla: 48, desc: 'Simplified Due Diligence requires documented justification. FDL Art.18, FATF Rec 10' },
    { type: 'SDD Eligibility Re-Assessment', sla: 48, desc: 'Annual re-assessment of SDD eligibility - any risk elevation triggers CDD upgrade. FDL Art.18' },
    // ── FDL Art.20-21: STR/SAR & Tipping Off ──
    { type: 'STR/SAR Filing', sla: 24, desc: 'MLRO approval before goAML submission to UAE FIU. FDL Art.20, FATF Rec 20' },
    { type: 'STR Post-Filing Monitoring', sla: 48, desc: 'Enhanced monitoring after STR filed - do not tip off. FDL Art.20-21' },
    { type: 'Tipping Off Risk', sla: 2, desc: 'Immediate MLRO lockdown - tipping off is criminal offence. FDL Art.21, FATF Rec 21' },
    { type: 'Whistleblower Report', sla: 24, desc: 'Anonymous report requires immediate investigation. FDL Art.21' },
    // ── FDL Art.21: Internal Controls & Compliance Officer ──
    { type: 'Compliance Manual Update', sla: 72, desc: 'Manual update requires MLRO and Board sign-off. FDL Art.21' },
    { type: 'Policy/Procedure Change', sla: 48, desc: 'AML/CFT policy changes require senior management approval. FDL Art.21' },
    { type: 'Training Programme Approval', sla: 72, desc: 'AML/CFT training plan requires MLRO approval. FDL Art.21, FATF Rec 18' },
    { type: 'Employee Compliance Bypass', sla: 4, desc: 'Employee bypassed compliance controls - immediate investigation. FDL Art.21, FATF Rec 18' },
    { type: 'Employee Failure to Report', sla: 4, desc: 'Employee failed to report suspicious activity to MLRO. FDL Art.26, FATF Rec 20' },
    { type: 'Compliance Officer Appointment', sla: 72, desc: 'MLRO/Deputy MLRO appointment/change requires Board approval. FDL Art.21' },
    { type: 'Independent Audit Report', sla: 168, desc: 'External AML audit findings require management response. FDL Art.21' },
    { type: 'Regulatory Inspection Prep', sla: 72, desc: 'MoE/Central Bank inspection preparation and response. FDL Art.21' },
    // ── FDL Art.22/35: TFS & Sanctions ──
    { type: 'Sanctions True Hit', sla: 2, desc: 'Immediate asset freeze and EOCN notification. FDL Art.22/35, Cabinet Res 74/2020' },
    { type: 'Sanctions Partial Match', sla: 24, desc: 'Suspend transaction, enhanced verification, PNMR to EOCN. FDL Art.22, EOCN Guidance' },
    { type: 'CNMR Filing to EOCN', sla: 120, desc: 'Confirmed Name Match Report to EOCN within 5 business days. Cabinet Res 74/2020' },
    { type: 'PNMR Filing to EOCN', sla: 120, desc: 'Partial Name Match Report to EOCN within 5 business days. EOCN TFS Guidance' },
    { type: 'FFR Filing via goAML', sla: 24, desc: 'Funds Freeze Report to UAE FIU via goAML. Cabinet Res 74/2020' },
    { type: 'Sanctions List Update Re-Screen', sla: 24, desc: 'New EOCN/UNSC designations require full customer re-screening. Cabinet Res 74/2020' },
    { type: 'Asset Freeze Implementation', sla: 2, desc: 'Freeze assets IMMEDIATELY (1-2 hours max per EOCN TFS Guidance). FDL Art.35, Cabinet Res 74/2020' },
    // ── FDL Art.25: Record Retention ──
    { type: 'Record Retention Extension', sla: 48, desc: 'Extension beyond 10-year retention period. FDL Art.25, Cabinet Res 134/2025 Art.25' },
    { type: 'Record Destruction Approval', sla: 72, desc: 'Records past retention period require approval before destruction. FDL Art.25' },
    // ── FDL Art.26: Reporting Obligations ──
    { type: 'FIU Information Request Response', sla: 24, desc: 'UAE FIU information request requires immediate response. FDL Art.26' },
    { type: 'MoE Circular Implementation', sla: 72, desc: 'New MoE circular requires policy update and implementation. MoE Directive' },
    // ── Cabinet Resolution 134/2025: DPMS Specific ──
    { type: 'DPMSR Filing', sla: 24, desc: 'Precious metals transaction at/above AED 55,000 threshold. Cabinet Res 134/2025 Art.14' },
    { type: 'Cash Transaction Above Threshold', sla: 4, desc: 'Cash transaction at/above AED 55,000 - CDD and DPMSR. Cabinet Res 134/2025 Art.14' },
    { type: 'Cumulative Cash Threshold Breach', sla: 4, desc: 'Multiple linked cash transactions totalling AED 55,000+. Cabinet Res 134/2025 Art.13' },
    { type: 'Structuring Pattern Detected', sla: 4, desc: 'Potential transaction structuring to avoid threshold. Cabinet Res 134/2025 Art.13' },
    { type: 'Transaction Exception', sla: 4, desc: 'Unusual transaction above threshold requires approval. Cabinet Res 134/2025 Art.14' },
    { type: 'Third-Party Payment', sla: 4, desc: 'Third-party payments require source verification. Cabinet Res 134/2025 Art.13, FATF Rec 16' },
    { type: 'Cross-Border Precious Metals', sla: 4, desc: 'Cross-border precious metals requires enhanced scrutiny. FATF Rec 22, Cabinet Res 134/2025' },
    // ── Cabinet Decision 74/2020: TFS Implementation ──
    { type: 'EOCN Local Terrorist List Match', sla: 2, desc: 'Match against UAE Local Terrorist List (EOCN). Cabinet Decision 74/2020' },
    { type: 'UNSC Consolidated List Match', sla: 2, desc: 'Match against UN Security Council Consolidated List. UNSCR, Cabinet Decision 74/2020' },
    // ── UBO/Beneficial Ownership ──
    { type: 'UBO Change', sla: 48, desc: 'Beneficial ownership change requires re-verification. FDL Art.18, FATF Rec 24/25' },
    { type: 'UBO Non-Compliance Escalation', sla: 24, desc: 'UBO information incomplete or non-compliant. Cabinet Decision 10/2019' },
    { type: 'Complex Ownership Structure Review', sla: 72, desc: 'Multi-layered or opaque ownership structure requires enhanced review. FATF Rec 24' },
    // ── LBMA / Responsible Sourcing ──
    { type: 'Supplier/Refinery Onboarding', sla: 48, desc: 'Supply chain due diligence for gold sourcing. LBMA RGG v9, OECD DDG' },
    { type: 'CAHRA Shipment Approval', sla: 24, desc: 'Conflict-affected/high-risk area shipment senior approval. LBMA RGG v9 Step 3' },
    { type: 'Recycled Gold Origin Verification', sla: 48, desc: 'Recycled gold declaration requires origin verification. LBMA RGG v9 Step 1' },
    { type: 'Artisanal Mining Source Detected', sla: 48, desc: 'ASM source requires enhanced DD and senior management approval. LBMA RGG v9 Step 2' },
    { type: 'Gold Origin Discrepancy', sla: 24, desc: 'Mismatch between declared and actual gold origin - investigation. LBMA RGG v9 Step 1' },
    { type: 'LBMA Audit Preparation', sla: 168, desc: 'Annual LBMA responsible gold audit preparation. LBMA RGG v9 Step 5' },
    { type: 'DMCC Responsible Sourcing Review', sla: 72, desc: 'DMCC member responsible sourcing compliance review. DMCC Rules' },
    // ── FATF Specific ──
    { type: 'FATF Mutual Evaluation Response', sla: 168, desc: 'MENAFATF mutual evaluation findings require action plan. FATF Methodology' },
    { type: 'FATF Grey List Country Transaction', sla: 24, desc: 'Transaction involving FATF grey-listed jurisdiction. FATF, FDL Art.14' },
    { type: 'Proliferation Financing Risk', sla: 24, desc: 'PF risk detected - assessment and senior management notification. FATF Rec 7, FDL Art.22' },
    // ── Relationship Management ──
    { type: 'Relationship Exit', sla: 72, desc: 'Customer exit requires documentation, STR review, and approval. FDL Art.16/20' },
    { type: 'Ongoing Monitoring Escalation', sla: 24, desc: 'Ongoing monitoring triggers requiring compliance review. FDL Art.13, Cabinet Res 134/2025 Art.13' },
    { type: 'Adverse Media Alert', sla: 24, desc: 'New adverse media on existing customer requires review. FDL Art.12, FATF Rec 10' },
    { type: 'Customer Risk Downgrade', sla: 48, desc: 'Risk rating downgrade requires documented justification. FDL Art.14, FATF RBA' },
    // ── Cabinet Resolution 156/2025 (MoE DNFBP Supervision) ──
    { type: 'MoE Supervisory Visit Response', sla: 72, desc: 'Response to MoE on-site/off-site supervisory findings. Cabinet Res 156/2025' },
    { type: 'MoE Compliance Gap Remediation', sla: 168, desc: 'Remediation plan for MoE-identified compliance gaps. Cabinet Res 156/2025' },
    { type: 'DNFBP Annual Return Filing', sla: 168, desc: 'Annual compliance return to MoE as supervising authority. Cabinet Res 156/2025' },
    { type: 'MoE Circular Implementation', sla: 72, desc: 'New MoE circular/directive requires policy update. Cabinet Res 156/2025, MoE Directives' },
    { type: 'DNFBP Re-Registration', sla: 168, desc: 'DNFBP re-registration with MoE including updated compliance info. Cabinet Res 156/2025' },
    { type: 'MoE Corrective Action Plan', sla: 72, desc: 'Corrective action plan submission after MoE supervisory action. Cabinet Res 156/2025' },
    { type: 'Supervisory Penalty Appeal', sla: 72, desc: 'Appeal of administrative penalty imposed by MoE. Cabinet Res 156/2025, FDL Art.40' },
    { type: 'Compliance Programme Assessment', sla: 168, desc: 'Self-assessment of AML/CFT programme effectiveness for MoE. Cabinet Res 156/2025' },
    { type: 'MoE Data/Information Request', sla: 48, desc: 'MoE request for compliance data, records, or documentation. Cabinet Res 156/2025' },
    { type: 'Suspicious Activity Internal Escalation', sla: 4, desc: 'Internal escalation of suspicious activity before STR decision. Cabinet Res 156/2025, FDL Art.20' },
    // ── UAE FIU (goAML) ──
    { type: 'FIU Dissemination Response', sla: 24, desc: 'Response to UAE FIU dissemination or intelligence request. FDL Art.26, FIU Directive' },
    { type: 'goAML System Issue Escalation', sla: 24, desc: 'goAML technical issue preventing STR/DPMSR filing. UAE FIU Technical Support' },
    { type: 'Delayed STR Filing Justification', sla: 24, desc: 'STR not filed without delay requires documented justification. FDL Art.26-27 mandates filing without delay upon suspicion.' },
    // ── EOCN (Executive Office) ──
    { type: 'EOCN Designation Notification', sla: 2, desc: 'New EOCN designation received - immediate customer database re-screen. EOCN Directive' },
    { type: 'EOCN De-Listing Response', sla: 48, desc: 'EOCN de-listing notification - review frozen assets/rejected relationships. EOCN Directive' },
    { type: 'EOCN Compliance Return', sla: 168, desc: 'Periodic compliance return to EOCN on TFS implementation. EOCN TFS Guidance' },
    // ── AI Governance ──
    { type: 'AI Output Human Review', sla: 24, desc: 'AI-generated compliance outputs require human sign-off. Cabinet Res 134/2025 Art.24' },
    // ── Administrative ──
    { type: 'Penalty/Fine Response', sla: 72, desc: 'Regulatory penalty requires management response and remediation plan. FDL Art.40' },
    { type: 'MoE Registration Renewal', sla: 168, desc: 'DNFBP registration renewal with Ministry of Economy. FDL Art.21, Cabinet Res 156/2025' },
    { type: 'Annual Compliance Report to MoE', sla: 168, desc: 'Annual compliance report submission to supervisor. FDL Art.21, Cabinet Res 156/2025' },
    { type: 'Board AML/CFT Report', sla: 72, desc: 'Quarterly/annual AML/CFT report to Board of Directors. FDL Art.21, FATF Rec 18' },
    { type: 'Compliance Committee Meeting', sla: 168, desc: 'Quarterly compliance committee meeting and minutes. FDL Art.21, Cabinet Res 156/2025' },
    { type: 'NRA/Sectoral Risk Assessment Update', sla: 168, desc: 'Update EWRA/BWRA following new NRA or sectoral risk assessment. FDL Art.4, FATF Rec 1' },
    // ── EU Conflict Minerals Regulation ──
    { type: 'EU Conflict Minerals Import Declaration', sla: 48, desc: 'Importer due diligence obligation for gold, tin, tantalum, tungsten. EU Reg 2017/821' },
    { type: 'EU Supply Chain Due Diligence Report', sla: 168, desc: 'Annual public reporting on supply chain DD. EU Conflict Minerals Reg Art.7' },
    { type: 'EU CAHRA List Update Response', sla: 48, desc: 'EU CAHRA list update requires supply chain re-assessment. EU Reg 2017/821 Art.2' },
    // ── OECD Due Diligence Guidance ──
    { type: 'OECD DDG Step 1 - Management Systems', sla: 72, desc: 'Establish strong management systems for supply chain DD. OECD DDG Step 1' },
    { type: 'OECD DDG Step 2 - Risk Identification', sla: 48, desc: 'Identify and assess supply chain risks. OECD DDG Step 2, Annex II' },
    { type: 'OECD DDG Step 3 - Risk Mitigation Strategy', sla: 72, desc: 'Design and implement risk mitigation strategy. OECD DDG Step 3' },
    { type: 'OECD DDG Step 4 - Independent Audit', sla: 168, desc: 'Commission independent third-party audit. OECD DDG Step 4' },
    { type: 'OECD DDG Step 5 - Annual Report', sla: 168, desc: 'Publish annual report on supply chain DD. OECD DDG Step 5' },
    { type: 'OECD Annex II Red Flag Trigger', sla: 24, desc: 'OECD Annex II red flag identified in supply chain. OECD DDG Annex II' },
    // ── DMCC Specific ──
    { type: 'DMCC Membership Compliance Review', sla: 168, desc: 'Annual DMCC compliance review and attestation. DMCC Rules & Regulations' },
    { type: 'DMCC Responsible Sourcing Declaration', sla: 72, desc: 'DMCC responsible sourcing declaration for gold imports. DMCC Rules Ch.9' },
    { type: 'DMCC Disciplinary Action Response', sla: 72, desc: 'Response to DMCC disciplinary/enforcement action. DMCC Rules' },
    { type: 'DMCC Gold Import/Export Permit', sla: 24, desc: 'DMCC gold import/export permit application. DMCC Trade Rules' },
    // ── Dubai Good Delivery (DGD) ──
    { type: 'DGD Accreditation Application', sla: 168, desc: 'Dubai Good Delivery accreditation/renewal. DGD Technical Standards' },
    { type: 'DGD Quality Assurance Review', sla: 72, desc: 'DGD quality assurance and assay verification. DGD Standards' },
    { type: 'DGD Non-Conformance Remediation', sla: 48, desc: 'Remediation of DGD non-conformance findings. DGD Standards' },
    // ── RMI (Responsible Mining Initiative) ──
    { type: 'RMI RMAP Conformance Assessment', sla: 168, desc: 'Responsible Minerals Assurance Process audit. RMI RMAP Standard' },
    { type: 'RMI Due Diligence Standard Review', sla: 72, desc: 'Annual review of RMI due diligence standard compliance. RMI DDS' },
    { type: 'RMI Smelter/Refiner Non-Conformance', sla: 48, desc: 'Non-conformant smelter/refiner identified in supply chain. RMI RMAP' },
    // ── AI Governance & Ethics ──
    { type: 'AI Model Deployment Approval', sla: 48, desc: 'AI model used in compliance requires human oversight approval. Cabinet Res 134/2025 Art.24' },
    { type: 'AI Bias Assessment', sla: 72, desc: 'Assessment of AI screening tool for bias and fairness. UAE AI Ethics Guidelines' },
    { type: 'AI Decision Override Documentation', sla: 24, desc: 'Human override of AI compliance recommendation requires documentation. Art.24' },
    { type: 'AI Ethics Review', sla: 72, desc: 'Periodic ethical review of AI tools used in compliance decisions. UAE AI Principles' },
    { type: 'AI Transparency Report', sla: 168, desc: 'Report on AI tool accuracy, false positive/negative rates. UAE AI Ethics' },
    // ── Training & Compliance Culture ──
    { type: 'Annual AML/CFT Training Plan', sla: 168, desc: 'Annual training programme design and MLRO approval. FDL Art.21, FATF Rec 18' },
    { type: 'New Employee Induction Training', sla: 72, desc: 'AML/CFT induction for new staff within first month. FDL Art.21' },
    { type: 'Board/Senior Management Training', sla: 168, desc: 'Annual AML/CFT awareness training for Board/senior management. FDL Art.21' },
    { type: 'Compliance Culture Assessment', sla: 168, desc: 'Annual assessment of compliance culture across the organisation. FATF Rec 18' },
    { type: 'Training Effectiveness Evaluation', sla: 72, desc: 'Post-training assessment and effectiveness evaluation. FDL Art.21, FATF Rec 18' },
    { type: 'Specialised DPMS Training', sla: 168, desc: 'Sector-specific training for precious metals compliance. FATF DPMS 2020' },
    // ── ESG (Environmental, Social, Governance) ──
    { type: 'ESG Due Diligence Assessment', sla: 72, desc: 'Environmental, Social, and Governance due diligence for new suppliers/customers. UN Guiding Principles' },
    { type: 'Environmental Impact Assessment', sla: 168, desc: 'Assessment of environmental impact of gold sourcing operations. OECD DDG, LBMA RGG' },
    { type: 'Human Rights Due Diligence', sla: 72, desc: 'Human rights impact assessment for supply chain. UN Guiding Principles, OECD DDG Annex II' },
    { type: 'Child/Forced Labour Risk Assessment', sla: 48, desc: 'Assessment of child or forced labour risk in supply chain. ILO Conventions, OECD DDG' },
    { type: 'Indigenous Peoples Rights Review', sla: 72, desc: 'Review of operations impact on indigenous communities. FPIC, UN DRIP' },
    { type: 'ESG Incident Report', sla: 24, desc: 'ESG-related incident requiring immediate investigation and disclosure. ESG Framework' },
    { type: 'Carbon Footprint/Climate Disclosure', sla: 168, desc: 'Carbon footprint assessment and climate-related disclosure. TCFD, ESG Reporting' },
    { type: 'Governance Structure Change', sla: 72, desc: 'Material change in corporate governance requiring Board approval. ESG Governance' },
    { type: 'ESG Annual Report', sla: 168, desc: 'Annual ESG/sustainability report preparation and approval. GRI Standards' },
    { type: 'Responsible Sourcing Certification Renewal', sla: 168, desc: 'Renewal of LBMA/RMI/DMCC responsible sourcing certifications. LBMA RGG, RMI RMAP' },
    // ── New (2026-04 expansion) ──
    // Virtual Asset / VASP exposure
    { type: 'VASP Settlement Approval', sla: 24, desc: 'Settlement using a virtual asset requires CO + Senior MLRO approval. FATF Rec 15, VARA UAE' },
    { type: 'Sanctioned Wallet Detection', sla: 2, desc: 'Wallet matches OFAC SDN crypto addenda — immediate freeze + EOCN notification. OFAC SDN | Cabinet Res 74/2020' },
    { type: 'Mixer/Tumbler Exposure', sla: 4, desc: 'On-chain history shows mixer / tumbler usage — EDD required. FATF VA Guidance 2021' },
    { type: 'Crypto-to-Gold Conversion', sla: 24, desc: 'Customer pays for gold using crypto — full source-of-funds investigation. FATF Rec 15' },
    // Modern slavery / human rights
    { type: 'Modern Slavery Indicator', sla: 4, desc: 'Behavioural / verbal indicator of trafficking or coercion — immediate escalation. UAE Federal Law 51/2006, FATF HT Guidance 2018' },
    { type: 'Suspected Forced Labour Source', sla: 24, desc: 'Source-of-supply investigation suggests forced labour. UK Modern Slavery Act, OECD DDG' },
    // Wildlife / environmental
    { type: 'Environmental Crime Indicator', sla: 24, desc: 'Customer or supplier linked to illegal mining, wildlife trafficking, or other environmental crime. FATF Environmental Crime 2021' },
    { type: 'CITES-Listed Goods Encountered', sla: 4, desc: 'CITES-listed product offered alongside gold — immediate refusal + STR. CITES, FATF Environmental Crime 2021' },
    // Tax & underground banking
    { type: 'Hawala / IVTS Reference', sla: 24, desc: 'Customer references hawala / informal value-transfer system. FATF Rec 14, FDL Art.14' },
    { type: 'Customs Duty Evasion Indicator', sla: 48, desc: 'Suspected customs duty / VAT evasion via gold transit. UAE FTA, FATF TBML 2020' },
    // Cyber / insider
    { type: 'Insider Misuse Investigation', sla: 4, desc: 'Suspected insider compliance bypass or unauthorised data access. FATF Rec 18, UAE Cyber Security Council 2024' },
    { type: 'Customer Account Takeover', sla: 4, desc: 'Customer credentials compromised — immediate freeze + customer notification. NIST 800-63B' },
    { type: 'Compromised Workstation Detected', sla: 4, desc: 'Compliance workstation flagged for malware / unusual activity. FATF Cyber-Enabled Crime 2023' },
    // Adverse media / public records
    { type: 'ICIJ / OCCRP Disclosure Match', sla: 48, desc: 'Customer named in investigative journalism leak (Pandora, Panama, Paradise, etc.). FATF Rec 10' },
    { type: 'Civil Asset Recovery Order', sla: 48, desc: 'Customer subject to civil forfeiture / asset recovery — full review. FATF Rec 10, FDL Art.14' },
    // EU AI Act / NIST AI RMF (governance)
    { type: 'AI System High-Risk Re-Classification', sla: 168, desc: 'AI risk classification change requires governance review. EU AI Act Art.6, NIST AI RMF MAP 1.1' },
    { type: 'AI Model Drift Threshold Breach', sla: 24, desc: 'Production AI model drift exceeded calibration threshold. NIST AI RMF MS-1.1, EU AI Act Art.15' },
    { type: 'AI Incident Notification', sla: 24, desc: 'Serious AI system incident — EU AI Act Art.62 reporting deadline. EU AI Act Art.62' },
    // Ops / continuity
    { type: 'Business Continuity Activation', sla: 4, desc: 'BCP activation triggered by incident — operations + compliance review. ISO 22301, FATF Rec 18' },
    { type: 'Third-Party Service Provider Failure', sla: 24, desc: 'Vendor outage affecting a compliance-critical service. ISO 27001 A.15' },
    { type: 'Data Breach Notification', sla: 72, desc: 'Personal data breach — UAE PDPL Art.20 notification within 72 hours. UAE PDPL Art.20' },
    // Inspector / regulator
    { type: 'EOCN Inspector Visit', sla: 4, desc: 'Live EOCN inspector visit — open the inspector portal + provision read-only Asana access. EOCN Inspection Manual §9' },
    { type: 'LBMA Audit Walkthrough', sla: 168, desc: 'Annual LBMA RGG audit walkthrough preparation. LBMA RGG v9 Step 5' },
    { type: 'MoE Joint Inspection', sla: 72, desc: 'Joint MoE + EOCN supervisory visit — full audit pack. Cabinet Res 156/2025' },
    // ── Trade & Settlement controls ──
    { type: 'Bullion Pre-Trade Compliance Override', sla: 1, desc: 'CO override of pre-trade compliance gate breach (>80% exposure, AED 55K threshold). FDL Art.20' },
    { type: 'OTC Counterparty Onboarding', sla: 48, desc: 'OTC bullion counterparty CDD + Wolfsberg AAGD review. Wolfsberg AAGD 2017 | LBMA RGG v9' },
    { type: 'Vault-Out Authorisation', sla: 4, desc: 'Physical gold withdrawal from bonded vault — chain-of-custody sign-off. LBMA Vault Operators Manual' },
    { type: 'Free-Zone Title Transfer', sla: 24, desc: 'Title transfer of bullion in DMCC/JAFZA without physical movement — TBML risk review. FATF Free Trade Zones 2010' },
    { type: 'Refining Tolling Approval', sla: 48, desc: 'Toll-refining contract for third-party metal — origin diligence + ASM screening. LBMA RGG v9 Step 2 | OECD DDG' },
    // ── Cross-border & TFS ──
    { type: 'Cross-Border Cash Declaration Validation', sla: 4, desc: 'Cross-border cash/BNI ≥ AED 60K declaration verification + FCSA notification. Cabinet Res 134/2025 Art.16' },
    { type: 'Outbound Wire to High-Risk Jurisdiction', sla: 4, desc: 'Wire transfer to FATF grey/black-list country — EDD + STR consideration. FATF Rec.13 | UAE FDL Art.14' },
    { type: 'Sanctions De-listing Verification', sla: 8, desc: 'Counterparty appears removed from sanctions list — independent confirmation before unfreezing. Cabinet Res 74/2020 Art.11' },
    { type: 'Strategic Goods License Cross-Check', sla: 24, desc: 'Strategic Goods Control list verification before settlement of dual-use ancillary goods. Cabinet Res 156/2025 | FCSA' },
    // ── ESG & Reputation ──
    { type: 'ESG Critical Risk Customer Decision', sla: 24, desc: 'Customer with ESG critical risk score — continue / exit / EDD. GRI 2021 | LBMA RGG v9 Step 5' },
    { type: 'Adverse Media High-Severity Match', sla: 8, desc: 'Adverse media hit ≥ severity 8 — relationship review + Asana case open. FATF Rec 12 | Wolfsberg AAGD' },
    { type: 'Modern Slavery Indicator Confirmation', sla: 24, desc: 'Confirmed modern slavery indicator in supply chain — escalate to MLRO + Board. UK MSA s.54 | OECD DDG §4' },
    { type: 'Climate-Risk Material Disclosure', sla: 168, desc: 'Material climate-risk impact on customer book — TCFD-aligned disclosure decision. TCFD | ISSB IFRS S2' },
    // ── Tech / AI governance ──
    { type: 'AI Model Promotion to Production', sla: 72, desc: 'New ML/AI model gating: bias eval + drift baseline + rollback plan signed off. EU AI Act Art.9 | NIST AI RMF GV-1.6' },
    { type: 'AI Hallucination Override', sla: 4, desc: 'CO override of an LLM-generated compliance recommendation — manual review + audit trail. NIST AI RMF MS-2.5' },
    { type: 'Source-Code Privileged Access', sla: 24, desc: 'Engineer requests temporary write access to compliance code — pair-review + audit log. ISO 27001 A.9.4' },
    { type: 'Database Schema Migration', sla: 48, desc: 'Production database schema change — backup + rollback + audit trail review. ISO 27001 A.12' },
    { type: 'Vendor MCP Server Allowlist Change', sla: 24, desc: 'Add/remove MCP server from connect-src CSP allowlist. CSP §H-2 audit | OWASP ASVS 14' },
    // ── Privacy & DSR ──
    { type: 'PDPL Data Subject Access Request', sla: 240, desc: 'Data subject access request (10-day SLA) — DPO sign-off before fulfilment. UAE PDPL Art.13' },
    { type: 'PDPL Right to Erasure', sla: 240, desc: 'Right-to-erasure request — confirm no AML 10-year retention conflict before deletion. UAE PDPL Art.14 | UAE FDL Art.24' },
    { type: 'Cross-Border Data Transfer', sla: 48, desc: 'Personal data transfer outside UAE — adequacy / SCC / consent verification. UAE PDPL Art.22' },
  ];

  function renderApprovals() {
    const el = document.getElementById('suite-content-approvals2');
    if (!el) return;
    const records = load(SK.APPROVALS) || [];
    const pending = records.filter(r => r.status === 'Pending' || r.status === 'Under Review');
    // Also load management approvals from management-approvals.js
    const mgmtApprovals = (() => { try { return JSON.parse(localStorage.getItem('fgl_mgmt_approvals')||'[]'); } catch{return [];} })();
    const mgmtPending = mgmtApprovals.filter(a => a.status === 'Pending' || a.status === 'In Progress' || !a.status);

    el.innerHTML = `
      <div class="card">
        <div class="top-bar">
          <span class="sec-title">✅ Approval Matrix — Four-Eyes Control</span>
          <span style="font-size:11px;color:var(--muted)">UAE FDL No.(10) of 2025 | Senior Management Approval Requirements</span>
          <button class="btn btn-sm btn-blue" style="padding:6px 12px;font-size:11px" data-action="suiteOpenApprovalForm">+ New Approval Request</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:1rem">
          <div class="metric m-c"><div class="metric-num">${pending.length}</div><div class="metric-lbl">Pending</div></div>
          <div class="metric m-h"><div class="metric-num">${records.filter(r=>{ const h=(new Date()-new Date(r.createdAt))/3600000; return r.status==='Pending'&&h>r.slaHours; }).length}</div><div class="metric-lbl">SLA Breached</div></div>
          <div class="metric m-ok"><div class="metric-num">${records.filter(r=>r.status==='Approved').length}</div><div class="metric-lbl">Approved</div></div>
          <div class="metric m-m"><div class="metric-num">${records.filter(r=>r.status==='Rejected').length}</div><div class="metric-lbl">Rejected</div></div>
        </div>

        <div class="sec-title" style="margin-bottom:10px">Approval Type Reference — SLA Requirements</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:1.5rem">
          ${APPROVAL_TYPES.map(a=>`
            <div style="background:var(--surface2);border:1px solid var(--border);border-radius:3px;padding:10px">
              <div style="font-size:12px;font-weight:600">${a.type} — SLA: ${a.sla}h</div>
              <div style="font-size:11px;color:var(--muted);margin-top:3px">${a.desc}</div>
            </div>
          `).join('')}
        </div>

        <div class="sec-title" style="margin-bottom:10px">Approval Queue</div>
        ${records.length===0 ? '<p style="color:var(--muted);font-size:13px;text-align:center;padding:1rem">No approval records.</p>' : ''}
        ${records.map((r,i) => {
          const hoursElapsed = (new Date()-new Date(r.createdAt))/3600000;
          const slaBreach = r.status==='Pending' && hoursElapsed > r.slaHours;
          return `
            <div class="finding ${r.status==='Rejected'?'f-critical':slaBreach?'f-high':r.status==='Approved'?'f-ok':'f-medium'}" style="margin-bottom:8px">
              <div class="f-head">
                <div class="f-head-left">
                  <div>
                    <div class="f-title">${r.approvalType} — ${r.subject} ${badge(r.status)} ${slaBreach?badge('SLA Breached'):''}</div>
                    <div class="f-body">Requested by: ${r.requestedBy} | Approver: ${r.approver||'Unassigned'} | SLA: ${r.slaHours}h</div>
                    <div class="f-ref">Created: ${fmtDate(r.createdAt)} | Ref: ${r.id}</div>
                  </div>
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                  ${r.status==='Pending'||r.status==='Under Review' ? `
                    <button class="btn btn-sm btn-green" onclick="suiteDecideApproval(${i},'Approved')">Approve</button>
                    <button class="btn btn-sm btn-red" onclick="suiteDecideApproval(${i},'Rejected')">Reject</button>
                  ` : ''}
                  <button class="btn btn-sm btn-blue" data-action="suiteSyncApprovalToAsana" data-arg="${i}">Asana</button>
                  <button class="btn btn-sm btn-red" data-action="suiteDeleteApproval" data-arg="${i}">Del</button>
                </div>
              </div>
              ${r.rationale ? `<div class="rec" style="margin-top:8px">${esc(r.rationale)}</div>` : ''}
              ${r.decision ? `<div style="font-size:12px;color:var(--muted);margin-top:6px">Decision: ${esc(r.decision)} | By: ${esc(r.decidedBy)} | ${fmtDate(r.decidedAt)}</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>

      <!-- Management Approvals Summary (from management-approvals.js) -->
      <div class="card" style="margin-top:1.2rem">
        <div class="top-bar">
          <span class="sec-title">📋 Management CDD Approvals — Customer & Counterparty</span>
          <span style="font-size:11px;color:var(--muted)">Cabinet Resolution 134/2025 Art.12-14 | Customer risk-based approval records</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:1rem">
          <div class="metric m-ok"><div class="metric-num">${mgmtApprovals.length}</div><div class="metric-lbl">Total CDD Approvals</div></div>
          <div class="metric m-h"><div class="metric-num">${mgmtPending.length}</div><div class="metric-lbl">Pending Review</div></div>
          <div class="metric m-ok"><div class="metric-num">${mgmtApprovals.filter(a=>a.status==='Approved'||a.status==='Completed').length}</div><div class="metric-lbl">Approved</div></div>
        </div>
        ${mgmtApprovals.length === 0 ? '<p style="color:var(--muted);font-size:13px;text-align:center;padding:1rem">No management approvals recorded. Use the Management Approvals tab to add customer CDD approvals.</p>' : ''}
        ${mgmtApprovals.slice(0,10).map((a,i) => {
          const st = a.status || 'Pending';
          const col = st==='Approved'||st==='Completed' ? 'var(--green)' : st==='Rejected' ? 'var(--red)' : 'var(--amber)';
          const name = a.customerName||a.entityName||'—';
          const type = a.customerType||a.entityType||'—';
          const risk = a.riskRating||'—';
          const date = a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-GB') : '—';
          return '<div style="padding:10px 14px;border-radius:4px;border:1px solid var(--border);background:var(--surface2);margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;gap:10px">'
            + '<div><div style="font-size:13px;font-weight:500">'+name+'</div>'
            + '<div style="font-size:11px;color:var(--muted);font-family:\'Montserrat\',sans-serif;margin-top:2px">'+type+' | Risk: '+risk+' | '+date+'</div></div>'
            + '<div style="display:flex;align-items:center;gap:8px">'
            + '<span style="background:'+col+'22;color:'+col+';border:1px solid '+col+'44;border-radius:3px;padding:2px 8px;font-size:10px;font-family:\'Montserrat\',sans-serif">'+st+'</span>'
            + '<button class="btn btn-sm btn-blue" data-action="suiteSyncMgmtApprovalToAsana" data-arg="+i+">Asana</button>'
            + '</div></div>';
        }).join('')}
        ${mgmtApprovals.length > 10 ? `<div style="font-size:12px;color:var(--muted);text-align:center;padding:8px">Showing 10 of ${mgmtApprovals.length} records. Open Management Approvals tab for full list.</div>` : ''}
      </div>

      <!-- Approval Form Modal -->
      <div class="modal-overlay" id="approvalModal">
        <div class="modal" style="max-width:520px;width:95%">
          <button class="modal-close" data-action="_closeModal" data-arg="approvalModal">✕</button>
          <div class="modal-title">New Approval Request</div>
          <input type="hidden" id="approval-edit-idx" value="-1">
          <div><span class="lbl">Approval Type *</span>
            <select id="approval-type"><option value="">Select</option>${APPROVAL_TYPES.map(a=>`<option>${a.type}</option>`).join('')}</select>
          </div>
          <div><span class="lbl">Subject / Reference *</span><input id="approval-subject" placeholder="Customer name, case ID, or transaction reference"/></div>
          <div class="row row-2" style="margin-top:10px">
            <div><span class="lbl">Requested By</span><input id="approval-requester" placeholder="Your name / role"/></div>
            <div><span class="lbl">Designated Approver</span><input id="approval-approver" placeholder="MLRO / Senior Management"/></div>
          </div>
          <div><span class="lbl">Rationale / Background</span>
            <textarea id="approval-rationale" style="min-height:80px" placeholder="Explain why approval is required and provide relevant context..."></textarea>
          </div>
          <div style="display:flex;gap:8px;margin-top:1rem">
            <button class="btn btn-gold" data-action="suiteSaveApproval" style="flex:1">Submit for Approval</button>
            <button class="btn btn-sm" data-action="_closeModal" data-arg="approvalModal" style="padding:12px 20px">Cancel</button>
          </div>
        </div>
      </div>
    `;
  }

  global.suiteOpenApprovalForm = function() {
    document.getElementById('approval-edit-idx').value = '-1';
    ['approval-subject','approval-requester','approval-approver','approval-rationale'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
    document.getElementById('approval-type').value = '';
    document.getElementById('approvalModal').classList.add('open');
  };

  global.suiteSaveApproval = function() {
    const type = document.getElementById('approval-type').value;
    const subject = document.getElementById('approval-subject').value.trim();
    const requester = document.getElementById('approval-requester').value.trim();
    const approver = document.getElementById('approval-approver').value.trim();
    const rationale = document.getElementById('approval-rationale').value.trim();
    if (!type || !subject) { toast('Type and subject are required', 'error'); return; }
    if (!requester) { toast('Requested By is required', 'error'); return; }
    if (!approver)  { toast('Designated Approver is required', 'error'); return; }
    if (!rationale || rationale.length < 20) {
      toast('Rationale is required (minimum 20 characters) — auditors need a documented basis.', 'error');
      return;
    }
    const slaEntry = APPROVAL_TYPES.find(a => a.type === type);
    const records = load(SK.APPROVALS) || [];
    const record = {
      id: uid('APR'),
      approvalType: type,
      subject,
      requestedBy: requester,
      approver: approver,
      rationale: rationale,
      slaHours: slaEntry ? slaEntry.sla : 48,
      status: 'Pending',
      createdAt: new Date().toISOString(),
    };
    records.unshift(record);
    save(SK.APPROVALS, records);
    document.getElementById('approvalModal').classList.remove('open');
    toast('Approval request submitted', 'success');
    renderApprovals();
  };

  // Four-eyes requires an authenticated session — the approver's identity
  // MUST come from the signed-in user, not from a prompt() dialog. This
  // blocks the single-actor bypass where one user types two different
  // names in the same browser session.
  //
  // Explicit list of approval types that require two independent approvers.
  // Every type in APPROVAL_TYPES that concerns sanctions / STR / EDD / TFS
  // / asset freeze / FFR / CNMR / DPMSR filings / high-risk onboarding
  // MUST be tagged true here. Do not rely on substring matching.
  var FOUR_EYES_APPROVAL_TYPES = new Set([
    'STR Filing',
    'STR/SAR Filing',
    'STR Filing via goAML',
    'SAR Filing',
    'SAR Filing via goAML',
    'FFR Filing via goAML',
    'CNMR Filing to EOCN',
    'CNMR Filing',
    'EDD Approval',
    'EDD Onboarding',
    'Sanctions Match',
    'Sanctions True Hit',
    'Sanctions Partial Match',
    'UNSC Consolidated List Match',
    'EOCN Local Terrorist List Match',
    'Sanctions List Update Re-Screen',
    'TFS Freeze',
    'Asset Freeze',
    'Transaction Suspension',
    'PEP Onboarding',
    'High Risk Customer',
    'UBO Override',
    'UBO Change',
    'Compliance Exception',
    'DPMSR Filing',
    // ── 2026-04 expansion ──
    'VASP Settlement Approval',
    'Sanctioned Wallet Detection',
    'Mixer/Tumbler Exposure',
    'Crypto-to-Gold Conversion',
    'Modern Slavery Indicator',
    'Suspected Forced Labour Source',
    'Environmental Crime Indicator',
    'CITES-Listed Goods Encountered',
    'Hawala / IVTS Reference',
    'Insider Misuse Investigation',
    'Customer Account Takeover',
    'AI Incident Notification',
    'Data Breach Notification',
    'EOCN Inspector Visit',
    'MoE Joint Inspection',
    // ── 2026-04 secondary expansion ──
    'Bullion Pre-Trade Compliance Override',
    'OTC Counterparty Onboarding',
    'Vault-Out Authorisation',
    'Free-Zone Title Transfer',
    'Refining Tolling Approval',
    'Cross-Border Cash Declaration Validation',
    'Outbound Wire to High-Risk Jurisdiction',
    'Sanctions De-listing Verification',
    'Strategic Goods License Cross-Check',
    'ESG Critical Risk Customer Decision',
    'Adverse Media High-Severity Match',
    'Modern Slavery Indicator Confirmation',
    'AI Model Promotion to Production',
    'AI Hallucination Override',
    'Source-Code Privileged Access',
    'Database Schema Migration',
    'Vendor MCP Server Allowlist Change',
    'PDPL Right to Erasure',
    'Cross-Border Data Transfer',
  ]);
  function approvalRequiresFourEyes(record) {
    if (!record) return false;
    if (FOUR_EYES_APPROVAL_TYPES.has(record.approvalType)) return true;
    return !!(record.slaHours && record.slaHours <= 4);
  }
  global.approvalRequiresFourEyes = approvalRequiresFourEyes;

  global.suiteDecideApproval = function(idx, decision) {
    // Require an authenticated session. If AuthRBAC isn't wired (e.g. a
    // dev harness), fall back to prompt() but also record that the
    // decision is UNAUTHENTICATED so it cannot masquerade as a valid
    // four-eyes approval.
    var authed = null;
    try {
      if (typeof AuthRBAC !== 'undefined' && typeof AuthRBAC.getCurrentUser === 'function') {
        authed = AuthRBAC.getCurrentUser();
      }
    } catch (_) { authed = null; }

    if (!authed || !authed.username) {
      toast('You must be signed in to approve. Four-eyes requires an authenticated session.', 'error');
      return;
    }

    var name = authed.username;
    var sessionId = authed.sessionId || authed.id || ('session-' + name);
    var userId = authed.id || authed.userId || name;

    const records = load(SK.APPROVALS) || [];
    const record = records[idx];
    if (!record) { toast('Approval record not found', 'error'); return; }

    const requiresFourEyes = approvalRequiresFourEyes(record);

    if (requiresFourEyes && decision === 'Approved') {
      if (!record.firstApprover) {
        record.firstApprover = name;
        record.firstApproverUserId = userId;
        record.firstApproverSessionId = sessionId;
        record.firstApprovalAt = new Date().toISOString();
        record.status = 'Under Review';
        save(SK.APPROVALS, records);
        toast('First approval recorded by ' + name + '. A second INDEPENDENT approver (different user) is required (Four-Eyes Principle).', 'info');
        if (typeof logAudit === 'function') logAudit('approvals', 'First approver ' + name + ' on ' + record.id);
        renderApprovals();
        return;
      }
      // Reject if the same user, same user-id, OR same session is trying
      // to provide the second approval.
      if ((record.firstApproverUserId && record.firstApproverUserId === userId)
          || (record.firstApprover && record.firstApprover.toLowerCase().trim() === name.toLowerCase().trim())
          || (record.firstApproverSessionId && record.firstApproverSessionId === sessionId)) {
        toast('Four-Eyes Violation: the second approver must be a DIFFERENT authenticated user than ' + record.firstApprover + '.', 'error');
        if (typeof logAudit === 'function') logAudit('approvals', 'BLOCKED four-eyes self-approval attempt on ' + record.id + ' by ' + name);
        return;
      }
      record.secondApprover = name;
      record.secondApproverUserId = userId;
      record.secondApproverSessionId = sessionId;
      record.secondApprovalAt = new Date().toISOString();
    }

    record.status = decision;
    record.decision = decision;
    record.decidedBy = name;
    record.decidedByUserId = userId;
    record.decidedAt = new Date().toISOString();

    if (!record.auditTrail) record.auditTrail = [];
    record.auditTrail.push({
      action: decision,
      actor: name,
      actorUserId: userId,
      timestamp: new Date().toISOString(),
      fourEyes: requiresFourEyes,
      firstApprover: record.firstApprover || null,
      secondApprover: record.secondApprover || null,
    });

    save(SK.APPROVALS, records);
    if (typeof logAudit === 'function') logAudit('approvals', decision + ' ' + record.id + ' by ' + name + (requiresFourEyes ? ' (4-eyes)' : ''));
    toast('Decision recorded: ' + decision + (requiresFourEyes ? ' (Four-Eyes verified)' : ''), decision==='Approved' ? 'success' : 'error');
    renderApprovals();
  };

  global.suiteDeleteApproval = function(idx) {
    if (!confirm('Delete this approval record?')) return;
    const records = load(SK.APPROVALS) || [];
    records.splice(idx, 1);
    save(SK.APPROVALS, records);
    renderApprovals();
  };

  global.suiteSyncMgmtApprovalToAsana = async function(idx) {
    const mgmtApprovals = (() => { try { return JSON.parse(localStorage.getItem('fgl_mgmt_approvals')||'[]'); } catch{return [];} })();
    const a = mgmtApprovals[idx];
    if (!a) return;
    if (typeof toast === 'function') toast('Syncing to Asana...','info');
    try {
      if (typeof asanaFetch !== 'function') { toast('Asana not configured','error'); return; }
      const resolver = typeof AsanaProjectResolver !== 'undefined' ? AsanaProjectResolver : null;
      const projectId = resolver ? resolver.resolveProject('workflow') : ((typeof ASANA_PROJECT !== 'undefined' && ASANA_PROJECT) ? ASANA_PROJECT : '1213759768596515');
      const title = `[MGMT-APPROVAL] ${a.customerName||a.entityName||'Unknown'} — ${a.status||'Pending'}`;
      const notes = [
        `Customer: ${a.customerName||a.entityName||'—'}`,
        `Type: ${a.customerType||a.entityType||'—'}`,
        `Risk Rating: ${a.riskRating||'—'}`,
        `Status: ${a.status||'Pending'}`,
        `Reviewed By: ${a.reviewedBy||a.approvedBy||'—'}`,
        `Date: ${a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-GB') : '—'}`,
        `Notes: ${a.notes||a.comments||'—'}`,
        `\nRegulatory Basis: Cabinet Resolution 134/2025 Art.12-14 | CDD/EDD Approval`,
      ].join('\n');
      const resp = await asanaFetch('/tasks', { method:'POST', body: JSON.stringify({ data: { name: title, notes, projects: [projectId] } }) });
      const data = await resp.json();
      if (data?.data?.gid) { toast('Synced to Asana','success'); }
      else { toast('Asana sync failed','error'); }
    } catch(e) { toast('Asana sync error: '+e.message,'error'); }
  };

  global.suiteSyncApprovalToAsana = async function(idx) {
    const records = load(SK.APPROVALS) || [];
    const r = records[idx];
    if (!r) return;
    const notes = `Approval Type: ${r.approvalType}\nSubject: ${r.subject}\nStatus: ${r.status}\nRequested by: ${r.requestedBy}\nApprover: ${r.approver}\nSLA: ${r.slaHours}h\nCreated: ${fmtDate(r.createdAt)}\n\nRationale: ${r.rationale}`;
    const gid = await pushToAsana(`[APPROVAL] ${r.approvalType} — ${r.subject}`, notes, 'approvals');
    if (gid) toast('Synced to Asana', 'success'); else toast('Asana sync failed', 'error');
  };

  // ════════════════════════════════════════════════════════════════════════════
  // 7. REGULATORY MAPPING & JURISDICTION SELECTOR
  // ════════════════════════════════════════════════════════════════════════════

  const JURISDICTION_RULES = {
    'Mainland DNFBP (MoE)': {
      supervisor: 'Ministry of Economy',
      primaryLaw: 'UAE FDL No.(10) of 2025',
      obligations: ['DNFBP registration with MoE','Annual risk assessment submission','CDD per Art.12-16','TFS per Cabinet Resolution 74/2020','STR via goAML within 30 days','LBMA RGG v9 for gold sourcing','Record retention 10 years minimum per UAE FDL No.(10)/2025'],
    },
    'DIFC (DFSA)': {
      supervisor: 'Dubai Financial Services Authority',
      primaryLaw: 'DIFC AML Law No.1 of 2024 + DFSA AML Module',
      obligations: ['DFSA registration and supervision','DFSA AML Module compliance','Immediate DFSA notification post-STR filing to UAE FIU','Enhanced record retention','DFSA Annual AML Return'],
    },
    'ADGM (FSRA)': {
      supervisor: 'ADGM Financial Services Regulatory Authority',
      primaryLaw: 'FSRA AML/CFT Rules 2022',
      obligations: ['FSRA registration','FSRA AML/CFT Rules compliance','Senior AML Officer appointment','FSRA STR notification requirements','Annual compliance report to FSRA'],
    },
  };

  const REGULATORY_FRAMEWORK = [
    // ── Federal Legislation ──
    { framework: 'Federal Decree-Law No.(10) of 2025', area: 'Primary AML/CFT/PF', articles: 'Art.1-40', applicability: 'All UAE entities', lastUpdated: '2025', status: 'Active' },
    { framework: 'Federal Decree-Law No.(31) of 2021 (UAE Penal Code)', area: 'Predicate Offences', articles: 'Bribery, Corruption, Fraud', applicability: 'All UAE entities', lastUpdated: '2021', status: 'Active' },
    // ── Executive Regulations ──
    { framework: 'Cabinet Resolution No.(134) of 2025', area: 'CDD, Risk Assessment, Internal Controls', articles: 'Art.1-30', applicability: 'All UAE entities', lastUpdated: '2025', status: 'Active' },
    { framework: 'Cabinet Resolution No.(156) of 2025', area: 'Admin Violations, PF, Strategic Goods', articles: 'Full', applicability: 'All UAE entities', lastUpdated: '2025', status: 'Active' },
    { framework: 'Cabinet Resolution No.(74) of 2020', area: 'TFS/UNSC/Local Terrorist List', articles: 'Full — asset freezing', applicability: 'All UAE entities', lastUpdated: '2020', status: 'Active' },
    { framework: 'Cabinet Resolution No.(71) of 2024', area: 'Administrative Penalties (MoE/MoJ)', articles: 'AED 10K–100M range', applicability: 'DPMS under MoE', lastUpdated: '2024', status: 'Active' },
    // ── Beneficial Ownership ──
    { framework: 'Cabinet Decision No.(109) of 2023', area: 'Beneficial Owner Procedures', articles: 'UBO identification & verification', applicability: 'All UAE companies', lastUpdated: '2023', status: 'Active' },
    { framework: 'Cabinet Resolution No.(132) of 2023', area: 'UBO Violation Penalties', articles: 'Administrative penalties', applicability: 'All UAE companies', lastUpdated: '2023', status: 'Active' },
    // ── Supervisory & Sectoral Guidance ──
    { framework: 'MoE Practical Guide for DNFBPs', area: 'DPMS Compliance Guide', articles: 'Full', applicability: 'DPMS under MoE', lastUpdated: '2024', status: 'Active' },
    { framework: 'MoE Supplemental Guidance for DPMS (May 2019)', area: 'DPMS-Specific AML/CFT', articles: 'Full', applicability: 'DPMS entities', lastUpdated: '2019', status: 'Active' },
    { framework: 'MoE Circular No.(1) of 2024', area: 'NRA 2024 Integration', articles: 'Full', applicability: 'All DNFBPs', lastUpdated: '2024', status: 'Active' },
    { framework: 'MoE Circular No. 08/AML/2021', area: 'DPMSR Reporting Requirements', articles: 'goAML DPMSR filing', applicability: 'DPMS entities', lastUpdated: '2021', status: 'Active' },
    { framework: 'UAE FIU goAML Instructions', area: 'STR/SAR/DPMSR Filing', articles: 'Portal & reporting', applicability: 'All reporting entities', lastUpdated: '2024', status: 'Active' },
    { framework: 'UAE National Risk Assessment (NRA) 2024', area: 'National ML/TF/PF Risk', articles: 'DPMS: medium-to-high', applicability: 'All sectors', lastUpdated: '2024', status: 'Active' },
    { framework: 'Executive Office AML/CFT Guidance', area: 'AML/CFT Coordination', articles: 'Full', applicability: 'All UAE entities', lastUpdated: '2024', status: 'Active' },
    // ── International Standards ──
    { framework: 'FATF Recommendations', area: 'International AML/CFT', articles: 'Rec. 1-40', applicability: 'FATF members/assessed', lastUpdated: '2023', status: 'Active' },
    { framework: 'FATF DPMS Guidance 2020', area: 'Precious Metals Sector', articles: 'Full', applicability: 'DPMS entities', lastUpdated: '2020', status: 'Active' },
    { framework: 'LBMA Responsible Gold Guidance v9', area: 'Gold Supply Chain DD', articles: 'Steps 1-5', applicability: 'Gold dealers/refiners', lastUpdated: '2023', status: 'Active' },
    { framework: 'OECD DDG for Responsible Supply Chains (CAHRAs)', area: 'Conflict Minerals DD', articles: 'Full + Annexes', applicability: 'CAHRA-exposed entities', lastUpdated: '2016', status: 'Active' },
    { framework: 'OECD DDG Gold Supplement', area: 'Gold-Specific DD', articles: 'Full', applicability: 'Gold supply chain', lastUpdated: '2016', status: 'Active' },
    { framework: 'World Gold Council Conflict-Free Gold Standard', area: 'Conflict-Free Sourcing', articles: 'Full', applicability: 'Gold producers/traders', lastUpdated: '2023', status: 'Active' },
    { framework: 'UNSC Sanctions Framework', area: 'International Sanctions', articles: 'UNSC Resolutions', applicability: 'All member states', lastUpdated: '2025', status: 'Active' },
    { framework: 'Wolfsberg ACSS 2019', area: 'Trade Finance/AML', articles: 'Full', applicability: 'Trade finance', lastUpdated: '2019', status: 'Active' },
    // ── Whistleblower Protection ──
    { framework: 'Federal Decree-Law No.(32) of 2021', area: 'Whistleblower Protection', articles: 'Full', applicability: 'All UAE entities', lastUpdated: '2021', status: 'Active' },
  ];

  function renderRegMap() {
    const el = document.getElementById('suite-content-regmap');
    if (!el) return;
    const data = load(SK.REGMAP) || {};
    const jurisdiction = data.jurisdiction || 'Mainland DNFBP (MoE)';
    const jRules = JURISDICTION_RULES[jurisdiction] || {};
    const changelog = data.changelog || [];

    el.innerHTML = `
      <div class="card" style="margin-bottom:1.2rem">
        <div class="top-bar">
          <span class="sec-title">📋 Regulatory Mapping — ${jurisdiction}</span>
        </div>
        <div class="row row-2">
          <div>
            <span class="lbl">Jurisdiction / Supervisor</span>
            <select id="regmap-jurisdiction" onchange="suiteChangeJurisdiction(this.value)">
              ${Object.keys(JURISDICTION_RULES).map(j=>`<option ${j===jurisdiction?'selected':''}>${j}</option>`).join('')}
            </select>
          </div>
          <div style="background:var(--surface2);border-radius:3px;padding:10px">
            <div style="font-size:11px;color:var(--muted);font-family:'Montserrat',sans-serif">SUPERVISOR</div>
            <div style="font-size:14px;font-weight:600;margin-top:4px;color:var(--gold)">${jRules.supervisor||'—'}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">${jRules.primaryLaw||'—'}</div>
          </div>
        </div>
        <div style="margin-top:1rem">
          <div class="sec-title" style="margin-bottom:8px">Key Obligations — ${jurisdiction}</div>
          ${(jRules.obligations||[]).map(o=>`<div style="padding:8px 12px;background:var(--surface2);border-left:3px solid var(--gold);border-radius:0 3px 3px 0;margin-bottom:6px;font-size:13px">✓ ${o}</div>`).join('')}
        </div>
      </div>

      <div class="card" style="margin-bottom:1.2rem">
        <div class="sec-title" style="margin-bottom:10px">Applicable Regulatory Frameworks</div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="border-bottom:1px solid var(--border)">
              ${['Framework','Area','Provision','Applicability','Status'].map(h=>`<th style="text-align:left;padding:8px;color:var(--muted);font-family:'Montserrat',sans-serif;font-size:11px">${h}</th>`).join('')}
            </tr></thead>
            <tbody>
              ${REGULATORY_FRAMEWORK.map(r=>`
                <tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:8px;font-weight:500;color:var(--gold)">${r.framework}</td>
                  <td style="padding:8px">${r.area}</td>
                  <td style="padding:8px;font-family:'Montserrat',sans-serif;font-size:11px">${r.articles}</td>
                  <td style="padding:8px">${r.applicability}</td>
                  <td style="padding:8px">${badge(r.status)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="top-bar">
          <span class="sec-title">Regulatory Change Log</span>
          <button class="btn btn-sm btn-blue" style="padding:6px 12px;font-size:11px" data-action="suiteAddRegChange">+ Log Change</button>
        </div>
        ${changelog.length===0 ? '<p style="color:var(--muted);font-size:13px;text-align:center;padding:1rem">No regulatory changes logged.</p>' : ''}
        ${changelog.map((c,i)=>`
          <div class="finding f-medium" style="margin-bottom:8px">
            <div class="f-head">
              <div class="f-head-left">
                <div>
                  <div class="f-title">${c.framework} — ${c.changeType}</div>
                  <div class="f-body">${c.description}</div>
                  <div class="f-ref">Effective: ${fmtDate(c.effectiveDate)} | Impact: ${c.impactedControls}</div>
                </div>
              </div>
              <button class="btn btn-sm btn-red" data-action="suiteDeleteRegChange" data-arg="${i}">Del</button>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Reg Change Modal -->
      <div class="modal-overlay" id="regchangeModal">
        <div class="modal" style="max-width:500px;width:95%">
          <button class="modal-close" data-action="_closeModal" data-arg="regchangeModal">✕</button>
          <div class="modal-title">Log Regulatory Change</div>
          <div><span class="lbl">Framework / Regulation</span><input id="rc-framework" placeholder="e.g. UAE FDL No.(10) of 2025"/></div>
          <div><span class="lbl">Change Type</span>
            <select id="rc-type"><option>New Regulation</option><option>Amendment</option><option>New Guidance</option><option>FATF Update</option><option>Supervisor Circular</option><option>Other</option></select>
          </div>
          <div><span class="lbl">Description *</span><textarea id="rc-desc" style="min-height:80px" placeholder="Describe the regulatory change and its requirements..."></textarea></div>
          <div class="row row-2">
            <div><span class="lbl">Effective Date</span><input type="text" id="rc-date" placeholder="dd/mm/yyyy" oninput="csFormatDateInput(this)" maxlength="10"/></div>
            <div><span class="lbl">Impacted Controls/Documents</span><input id="rc-controls" placeholder="e.g. Compliance Manual, EWRA, CDD procedure"/></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:1rem">
            <button class="btn btn-gold" data-action="suiteSaveRegChange" style="flex:1">Save</button>
            <button class="btn btn-sm" data-action="_closeModal" data-arg="regchangeModal" style="padding:12px 20px">Cancel</button>
          </div>
        </div>
      </div>
    `;
  }

  global.suiteChangeJurisdiction = function(val) {
    const data = load(SK.REGMAP) || {};
    data.jurisdiction = val;
    save(SK.REGMAP, data);
    renderRegMap();
  };

  global.suiteAddRegChange = function() {
    ['rc-framework','rc-desc','rc-controls'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
    document.getElementById('rc-date').value = today();
    document.getElementById('regchangeModal').classList.add('open');
  };

  global.suiteSaveRegChange = function() {
    const desc = document.getElementById('rc-desc').value.trim();
    if (!desc) { toast('Description is required', 'error'); return; }
    const data = load(SK.REGMAP) || {};
    if (!data.changelog) data.changelog = [];
    data.changelog.unshift({
      framework: document.getElementById('rc-framework').value,
      changeType: document.getElementById('rc-type').value,
      description: desc,
      effectiveDate: document.getElementById('rc-date').value,
      impactedControls: document.getElementById('rc-controls').value,
      loggedAt: new Date().toISOString(),
    });
    save(SK.REGMAP, data);
    document.getElementById('regchangeModal').classList.remove('open');
    toast('Regulatory change logged', 'success');
    renderRegMap();
  };

  global.suiteDeleteRegChange = function(idx) {
    if (!confirm('Delete this regulatory change entry?')) return;
    const data = load(SK.REGMAP) || {};
    if (data.changelog) data.changelog.splice(idx, 1);
    save(SK.REGMAP, data);
    renderRegMap();
  };

  // ─── INITIALIZATION ──────────────────────────────────────────────────────────
  function init() {
    injectTabs();
    injectContentContainers();
    // Auto-render CRA into embedded container (merged into Risk & CRA tab)
    setTimeout(function() { if (document.getElementById('cra-embedded-content')) renderCRA(); }, 500);
    console.log('[ComplianceSuite] v2.0.0 initialized — UAE AML/CFT modules loaded');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 200);
  }

})(window);

// ════════════════════════════════════════════════════════════════════════════
// COMPLIANCE SUITE v2.2 — 2026-04-01 11:58 — 10yr retention
// COMPLIANCE SUITE EXTENSION v2.1 — UAE AML/CFT COMPLIANCE FIXES
// Adds: Full TFS UAE workflow, DPMSR threshold, CDD hard stops,
//       UBO freshness, AI governance, record retention, linked transactions
// Regulatory: Cabinet Resolution No.(134) of 2025 | Cabinet Decision 74/2020
//             EOCN TFS Guidance | MoE Circular 08/AML/2021
// ════════════════════════════════════════════════════════════════════════════

(function(global) {
  'use strict';

  function load(key) { try { return JSON.parse(localStorage.getItem(key)||'null'); } catch{return null;} }
  function save(key,val) { try { localStorage.setItem(key,JSON.stringify(val)); } catch(e){ console.warn('[Storage] Save failed for', key, e); } }
  function today() { const n=new Date(); return String(n.getDate()).padStart(2,'0')+'/'+String(n.getMonth()+1).padStart(2,'0')+'/'+n.getFullYear(); }
  function parseDDMMYYYY(s) {
    if(!s) return null;
    const p=s.split('/');
    if(p.length!==3) return null;
    const dd=parseInt(p[0],10), mm=parseInt(p[1],10), yyyy=parseInt(p[2],10);
    if(isNaN(dd)||isNaN(mm)||isNaN(yyyy)) return null;
    if(mm<1||mm>12||dd<1||dd>31||yyyy<1900||yyyy>2100) return null;
    const dt=new Date(yyyy,mm-1,dd);
    if(dt.getFullYear()!==yyyy||dt.getMonth()!==mm-1||dt.getDate()!==dd) return null;
    return dt;
  }
  function fmtDate(d) { if(!d) return '—'; const dt = (typeof d==='string'&&d.includes('/')) ? parseDDMMYYYY(d) : new Date(d); if(!dt||isNaN(dt.getTime())) return d; return String(dt.getDate()).padStart(2,'0')+'/'+String(dt.getMonth()+1).padStart(2,'0')+'/'+dt.getFullYear(); }
  function fmtDateDDMMYYYY(dt) { return String(dt.getDate()).padStart(2,'0')+'/'+String(dt.getMonth()+1).padStart(2,'0')+'/'+dt.getFullYear(); }

  // UAE public holidays (approximate — Islamic dates shift yearly; update annually)
  const UAE_PUBLIC_HOLIDAYS_2025 = [
    '01/01/2025','30/03/2025','31/03/2025','01/04/2025', // New Year, Eid Al Fitr
    '05/06/2025','06/06/2025','07/06/2025','08/06/2025', // Arafat + Eid Al Adha
    '27/06/2025', // Islamic New Year
    '05/09/2025', // Prophet's Birthday
    '01/12/2025','02/12/2025','03/12/2025' // Commemoration + National Day
  ];
  const UAE_PUBLIC_HOLIDAYS_2026 = [
    '01/01/2026','20/03/2026','21/03/2026','22/03/2026', // New Year, Eid Al Fitr
    '26/05/2026','27/05/2026','28/05/2026','29/05/2026', // Arafat + Eid Al Adha
    '17/06/2026', // Islamic New Year
    '26/08/2026', // Prophet's Birthday
    '01/12/2026','02/12/2026','03/12/2026' // Commemoration + National Day
  ];
  const UAE_HOLIDAYS_SET = new Set([...UAE_PUBLIC_HOLIDAYS_2025, ...UAE_PUBLIC_HOLIDAYS_2026]);

  function isUAEHoliday(dt) {
    return UAE_HOLIDAYS_SET.has(fmtDateDDMMYYYY(dt));
  }

  function addBusinessDays(date, days) {
    const d = parseDDMMYYYY(date) || new Date(date);
    let added = 0;
    while (added < days) { d.setDate(d.getDate()+1); if(d.getDay()!==0&&d.getDay()!==6&&!isUAEHoliday(d)) added++; }
    return fmtDateDDMMYYYY(d);
  }
  function esc(s) { if (!s && s!==0) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
  function toast(msg,type) { if(global.toast) global.toast(msg,type); }

  // Regulatory threshold constants — pulled from the canonical bridge
  // (constants-bridge.js → src/domain/constants.ts). Never hardcode a
  // regulatory value here; update constants.ts instead and re-run the
  // regulatory update skill. CLAUDE.md "Constants Architecture".
  if (!global.COMPLIANCE_CONSTANTS) {
    throw new Error('[compliance-suite] COMPLIANCE_CONSTANTS missing. Include constants-bridge.js before compliance-suite.js.');
  }
  const THRESHOLDS = {
    DPMSR_PRECIOUS_METALS: global.COMPLIANCE_CONSTANTS.DPMS_CASH_THRESHOLD_AED, // 55000 — MoE Circular 08/AML/2021
    CROSS_BORDER_CASH:     global.COMPLIANCE_CONSTANTS.CROSS_BORDER_CASH_THRESHOLD_AED, // 60000 — Cabinet Res 134/2025 Art.16
    UBO_PERCENTAGE:        global.COMPLIANCE_CONSTANTS.UBO_OWNERSHIP_THRESHOLD_PCT * 100, // 25 — Cabinet Decision 109/2023
    RETENTION_YEARS:       global.COMPLIANCE_CONSTANTS.RECORD_RETENTION_YEARS, // 10 — FDL Art.24
    UBO_REVERIFICATION_WORKING_DAYS: global.COMPLIANCE_CONSTANTS.UBO_REVERIFICATION_WORKING_DAYS, // 15
    CNMR_FILING_DEADLINE_BUSINESS_DAYS: global.COMPLIANCE_CONSTANTS.CNMR_FILING_DEADLINE_BUSINESS_DAYS, // 5
    RISK_CRITICAL: global.COMPLIANCE_CONSTANTS.RISK_CRITICAL, // 16
    RISK_HIGH:     global.COMPLIANCE_CONSTANTS.RISK_HIGH,     // 11
    RISK_MEDIUM:   global.COMPLIANCE_CONSTANTS.RISK_MEDIUM,   // 6
  };

  const SK2 = {
    TFS2:    'fgl_tfs2_v1',
    DPMSR:   'fgl_dpmsr_v1',
    RETAIN:  'fgl_retention_v1',
    AILOG:   'fgl_ailog_v1',
    LINKED:  'fgl_linked_txn_v1',
  };

  // ── INJECT NEW TABS ─────────────────────────────────────────────────────────
  const SUITE2_TABS = [
    // TFS merged into Screening & TFS tab
    // DPMSR + Retention removed from main-tool nav per product decision
    { id: 'ailog',   icon: '🤖', label: 'AI Govern',  title: 'AI Output Governance' },
  ];

  function injectSuite2() {
    const nav = document.getElementById('tabsNav');
    if (!nav) return;
    SUITE2_TABS.forEach(t => {
      if (document.getElementById('suite2-tab-'+t.id)) return;
      const el = document.createElement('div');
      el.className = 'tab';
      el.id = 'suite2-tab-'+t.id;
      el.title = t.title;
      el.innerHTML = (t.icon ? t.icon + ' ' : '') + t.label;
      el.onclick = () => switchToSuite2Tab(t.id);
      nav.appendChild(el);
    });
    SUITE2_TABS.forEach(t => {
      if (document.getElementById('suite2-content-'+t.id)) return;
      const el = document.createElement('div');
      el.className = 'tab-content';
      el.id = 'suite2-content-'+t.id;
      (document.querySelector('.app')||document.body).appendChild(el);
    });
  }

  function switchToSuite2Tab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    const btn = document.getElementById('suite2-tab-'+name);
    if (btn) btn.classList.add('active');
    const content = document.getElementById('suite2-content-'+name);
    if (content) content.classList.add('active');
    const renders = { tfs2: renderTFS2, dpmsr: renderDPMSR, retention: renderRetention, ailog: renderAILog };
    if (renders[name]) renders[name]();
  }

  function badge2(status) {
    const map = {
      'Confirmed Match':'#D94F4F','Partial Match':'#E8A030','False Positive':'#3DA876',
      'Negative – No Match':'#3DA876','Frozen':'#D94F4F','CNMR Filed':'#3DA876',
      'PNMR Filed':'#3DA876','Pending Review':'#E8A030','Cleared':'#3DA876',
      'Overdue':'#D94F4F','Current':'#3DA876','Due Soon':'#E8A030',
      'Approved':'#3DA876','Rejected':'#D94F4F','Pending':'#E8A030',
    };
    const col = map[status]||'#7A7870';
    return `<span style="background:${col}22;color:${col};border:1px solid ${col}44;border-radius:3px;padding:2px 8px;font-size:10px;font-family:'Montserrat',sans-serif">${esc(status)}</span>`;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TFS2 — FULL UAE TFS WORKFLOW
  // Reg: Cabinet Decision No.(74) of 2020 | EOCN TFS Guidance
  // 4 Outcomes: Confirmed Match, Partial Match, False Positive, Negative
  // CNMR within 5 business days | Freeze IMMEDIATELY (EOCN: 1-2h max) | goAML FFR
  // ════════════════════════════════════════════════════════════════════════════

  function renderTFS2() {
    const el = document.getElementById('tfs-embedded-content') || document.getElementById('suite2-content-tfs2');
    if (!el) return;
    const events = load(SK2.TFS2)||[];

    el.innerHTML = `
    <div class="card" style="margin-bottom:1.2rem">
      <div class="top-bar">
        <span class="sec-title">TFS Workflow — Full 4-Outcome Process</span>
        <span style="font-size:11px;color:var(--muted)">Cabinet Decision No.(74) of 2020 | EOCN Executive Office TFS Guidance</span>
        <div style="display:flex;gap:6px">
          <button class="btn btn-sm btn-blue" onclick="if(typeof refreshSanctionsLists==='function'){refreshSanctionsLists().then(function(){renderTFS2()}).catch(function(e){console.warn('[TFS] Refresh failed:',e);renderTFS2()})}else{renderTFS2()}">Refresh</button>
          <button class="btn btn-sm btn-blue" style="padding:6px 12px;font-size:11px" data-action="suite2OpenTFSForm">+ New Screening Event</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:1rem">
        <div style="background:var(--surface2);border-radius:4px;padding:14px;border-left:3px solid var(--gold)">
          <div class="sec-title" style="margin-bottom:8px;border:none;padding:0">MANDATORY UAE Lists</div>
          <div style="font-size:12px;margin-bottom:6px">✅ <strong>UAE Local Terrorist List</strong> — EOCN / Executive Office</div>
          <div style="font-size:12px;margin-bottom:6px">✅ <strong>UNSC Consolidated Sanctions List</strong> — UN Security Council</div>
          <div style="font-size:11px;color:var(--muted);margin-top:8px;font-family:'Montserrat',sans-serif">Cabinet Decision No.(74)/2020 — These two lists are legally mandatory for all UAE reporting entities. Failure to screen constitutes a regulatory offence.</div>
        </div>
        <div style="background:var(--surface2);border-radius:4px;padding:14px;border-left:3px solid var(--blue)">
          <div class="sec-title" style="margin-bottom:8px;border:none;padding:0">ENHANCED CONTROLS (Not Legally Mandatory)</div>
          <div style="font-size:12px;margin-bottom:4px">⬜ OFAC SDN — US unilateral sanctions</div>
          <div style="font-size:12px;margin-bottom:4px">⬜ EU Consolidated Sanctions</div>
          <div style="font-size:12px;margin-bottom:4px">⬜ UK OFSI Consolidated</div>
          <div style="font-size:12px;margin-bottom:4px">⬜ Interpol Red Notices</div>
          <div style="font-size:11px;color:var(--muted);margin-top:8px;font-family:'Montserrat',sans-serif">EOCN Guidance — For non-UAE unilateral/multilateral lists, consult your supervisory authority for appropriate course of action.</div>
        </div>
      </div>

      ${events.length===0?'<p style="color:var(--muted);font-size:13px;text-align:center;padding:2rem">No TFS screening events. Click "+ New Screening Event" to begin.</p>':''}
      ${events.map((e,i) => {
        const isConfirmed = e.outcome==='Confirmed Match';
        const isPartial = e.outcome==='Partial Match';
        const cnmrDeadline = e.screeningDate ? addBusinessDays(e.screeningDate, 5) : null;
        const cnmrOverdue = cnmrDeadline && parseDDMMYYYY(cnmrDeadline)<new Date() && (e.cnmrStatus==='Pending');
        return `
        <div class="finding ${isConfirmed?'f-critical':isPartial?'f-high':'f-ok'}" style="margin-bottom:10px">
          <div class="f-head">
            <div class="f-head-left"><div>
              <div class="f-title">${esc(e.screenedName)} ${badge2(e.outcome)} ${cnmrOverdue?badge2('Overdue'):''}</div>
              <div class="f-body">Lists: ${esc(e.listsScreened)} | Event: ${esc(e.eventType)} | Date: ${esc(fmtDate(e.screeningDate))}</div>
              ${isConfirmed?`<div class="f-ref">Freeze: ${esc(e.frozenWithin24h||'Not confirmed')} | FFR: ${esc(e.ffrFiled||'Pending')} | CNMR: ${esc(e.cnmrStatus||'Pending')} (deadline: ${esc(fmtDate(cnmrDeadline))})</div>`:''}
              ${isPartial?`<div class="f-ref">Transaction Suspended: ${esc(e.txSuspended||'Pending')} | PNMR: ${esc(e.pnmrStatus||'Pending')} (deadline: ${esc(fmtDate(cnmrDeadline))})</div>`:''}
              <div class="f-ref">Reviewer: ${esc(e.reviewedBy||'—')} | Ref: ${esc(e.id)}</div>
            </div></div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-sm btn-gold" data-action="suite2EditTFS" data-arg="${i}">View/Edit</button>
              <button class="btn btn-sm btn-red" data-action="suite2DeleteTFS" data-arg="${i}">Delete</button>
            </div>
          </div>
          ${e.notes?`<div class="rec">${esc(e.notes)}</div>`:''}
        </div>`;
      }).join('')}

    </div>

    <!-- TFS2 Modal -->
    <div class="modal-overlay" id="tfs2Modal">
      <div class="modal" style="max-width:680px;width:95%;max-height:92vh">
        <button class="modal-close" data-action="_closeModal" data-arg="tfs2Modal">✕</button>
        <div class="modal-title">TFS Screening Event</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:1rem;font-family:'Montserrat',sans-serif">Cabinet Decision No.(74) of 2020 | EOCN TFS Guidance | Mandatory: UAE Local Terrorist List + UNSC Consolidated List</div>
        <input type="hidden" id="tfs2-edit-idx" value="-1">

        <div class="row" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
          <div><span class="lbl">Name Screened *</span><input id="tfs2-name" placeholder="Full legal name of individual or entity"/></div>
          <div><span class="lbl">Entity Type *</span>
            <select id="tfs2-entity-type"><option value="Individual">Individual</option><option value="Company">Company</option></select>
          </div>
          <div><span class="lbl">Date of Birth / Registration</span><input type="text" id="tfs2-dob" placeholder="dd/mm/yyyy" oninput="csFormatDateInput(this)" maxlength="10"/></div>
        </div>
        <div class="row" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
          <div><span class="lbl">Screening Event Type *</span>
            <select id="tfs2-event"><option>New Customer Onboarding</option><option>Periodic Rescreening</option><option>List Update Trigger</option><option>Transaction Pre-Approval</option><option>Supplier/Refinery Onboarding</option><option>UBO Screening</option><option>Ad Hoc Review</option></select>
          </div>
          <div><span class="lbl">Country</span><input id="tfs2-country" placeholder="e.g. UAE, Iran, Russia"/></div>
          <div><span class="lbl">ID / Register No.</span><input id="tfs2-idnumber" placeholder="Passport, EID, Trade License"/></div>
        </div>
        <div><span class="lbl">Lists Screened (tick all that apply)</span>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;background:var(--surface2);padding:10px;border-radius:3px;border:1px solid var(--border);margin-top:4px">
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" id="tfs2-list-uae" style="width:auto" checked/> 🇦🇪 UAE Local Terrorist List (EOCN)</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" id="tfs2-list-un" style="width:auto" checked/> 🌐 UNSC Consolidated Sanctions List</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" id="tfs2-list-ofac" style="width:auto" checked/> 🇺🇸 OFAC SDN (Enhanced)</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" id="tfs2-list-eu" style="width:auto" checked/> 🇪🇺 EU Consolidated (Enhanced)</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" id="tfs2-list-uk" style="width:auto" checked/> 🇬🇧 UK OFSI (Enhanced)</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" id="tfs2-list-interpol" style="width:auto" checked/> 🔵 Interpol Red Notices (Enhanced)</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" id="tfs2-list-adverse" style="width:auto" checked/> 📰 Adverse Media Screening</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" id="tfs2-list-pep" style="width:auto" checked/> 🏛️ Political Controversy / PEP</label>
          </div>
        </div>
        <div class="row row-2" style="margin-top:10px">
          <div><span class="lbl">Screening Date *</span><input type="text" id="tfs2-date" value="${today()}" placeholder="dd/mm/yyyy" oninput="csFormatDateInput(this)" maxlength="10"/></div>
          <div><span class="lbl">Reviewed By</span><input id="tfs2-reviewer" placeholder="Compliance Officer / MLRO name"/></div>
        </div>
        <div><span class="lbl">Screening Outcome *</span>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:4px" id="tfs2-outcome-btns">
            ${[
              {val:'Negative – No Match', col:'var(--green)', icon:'✅'},
              {val:'False Positive', col:'var(--green)', icon:'⚪'},
              {val:'Partial Match', col:'var(--amber)', icon:'🟡'},
              {val:'Confirmed Match', col:'var(--red)', icon:'🔴'},
            ].map(o=>`
              <button type="button" class="btn" id="tfs2-btn-${o.val.replace(/\s/g,'_')}"
                data-action="suite2SelectOutcome" data-arg="${o.val}"
                style="background:var(--surface2);border:2px solid var(--border);color:var(--text);font-size:11px;padding:10px 6px">
                ${o.icon} ${o.val}
              </button>
            `).join('')}
          </div>
          <input type="hidden" id="tfs2-outcome" value=""/>
        </div>

        <!-- FALSE POSITIVE SECTION -->
        <div id="tfs2-fp-section" style="display:none;margin-top:10px">
          <div style="background:rgba(61,168,118,0.1);border:1px solid rgba(61,168,118,0.3);border-radius:4px;padding:12px">
            <div style="color:var(--green);font-weight:600;font-size:13px;margin-bottom:8px">⚪ FALSE POSITIVE — Differentiation Required</div>
            <div><span class="lbl">Differentiation Basis *</span>
              <select id="tfs2-fp-basis"><option value="">Select</option><option>Different date of birth confirmed</option><option>Different nationality confirmed</option><option>Different gender confirmed</option><option>Name spelling variation — different person</option><option>ID document verification confirms different person</option><option>Other</option></select>
            </div>
            <div style="margin-top:8px"><span class="lbl">Supporting Evidence</span><input id="tfs2-fp-evidence" placeholder="Document reference confirming differentiation"/></div>
          </div>
        </div>

        <!-- PARTIAL MATCH SECTION -->
        <div id="tfs2-partial-section" style="display:none;margin-top:10px">
          <div style="background:rgba(232,160,48,0.1);border:1px solid rgba(232,160,48,0.3);border-radius:4px;padding:12px">
            <div style="color:var(--amber);font-weight:600;font-size:13px;margin-bottom:8px">🟡 PARTIAL MATCH — PNMR Required within 5 Business Days</div>
            <div class="row row-2">
              <div><span class="lbl">Transaction Suspended?</span>
                <select id="tfs2-tx-suspended"><option value="">Select</option><option>Yes – Transaction Suspended</option><option>No Transaction Involved</option></select>
              </div>
              <div><span class="lbl">PNMR Deadline</span><input type="text" id="tfs2-pnmr-deadline" readonly style="opacity:0.7" placeholder="dd/mm/yyyy"/></div>
            </div>
            <div class="row row-2">
              <div><span class="lbl">PNMR Filed to EOCN?</span>
                <select id="tfs2-pnmr-status"><option>Pending</option><option>Filed – Reference Obtained</option><option>Not Required – False Positive Confirmed</option></select>
              </div>
              <div><span class="lbl">PNMR Reference</span><input id="tfs2-pnmr-ref" placeholder="EOCN PNMR reference number"/></div>
            </div>
          </div>
        </div>

        <!-- CONFIRMED MATCH SECTION -->
        <div id="tfs2-confirmed-section" style="display:none;margin-top:10px">
          <div style="background:rgba(217,79,79,0.1);border:1px solid rgba(217,79,79,0.4);border-radius:4px;padding:12px">
            <div style="color:var(--red);font-weight:700;font-size:13px;margin-bottom:8px">🔴 CONFIRMED MATCH — IMMEDIATE ACTION REQUIRED</div>
            <div style="font-size:12px;color:var(--muted);margin-bottom:10px;font-family:'Montserrat',sans-serif">Cabinet Decision 74/2020 | EOCN TFS Guidance | Freeze IMMEDIATELY (EOCN: 1-2h max) | CNMR within 5 business days</div>
            <div class="row row-2">
              <div><span class="lbl">Assets Frozen Within 24h? *</span>
                <select id="tfs2-frozen"><option value="">Select</option><option>Yes – Frozen Immediately</option><option>No Assets to Freeze</option><option>Freeze Pending – Escalated</option></select>
              </div>
              <div><span class="lbl">Freeze Date/Time</span><input type="datetime-local" id="tfs2-freeze-dt"/></div>
            </div>
            <div class="row row-2">
              <div><span class="lbl">FFR Filed via goAML? *</span>
                <select id="tfs2-ffr"><option value="">Select</option><option>Yes – FFR Filed</option><option>Pending – Within 24h</option><option>Not Required</option></select>
              </div>
              <div><span class="lbl">goAML FFR Reference</span><input id="tfs2-ffr-ref" placeholder="goAML FFR reference"/></div>
            </div>
            <div class="row row-2">
              <div><span class="lbl">CNMR Filed to EOCN? *</span>
                <select id="tfs2-cnmr-status"><option>Pending</option><option>Filed – Reference Obtained</option></select>
              </div>
              <div><span class="lbl">CNMR Deadline (5 business days)</span><input type="text" id="tfs2-cnmr-deadline" readonly style="opacity:0.7" placeholder="dd/mm/yyyy"/></div>
            </div>
            <div class="row row-2">
              <div><span class="lbl">CNMR Reference</span><input id="tfs2-cnmr-ref" placeholder="EOCN CNMR reference"/></div>
              <div><span class="lbl">Supervisor Notified?</span>
                <select id="tfs2-supervisor"><option value="">Select</option><option>Yes – MoE Notified</option><option>Yes – CBUAE Notified</option><option>Yes – DFSA Notified</option><option>Pending</option></select>
              </div>
            </div>
            <div class="row row-2">
              <div><span class="lbl">MLRO Notified?</span>
                <select id="tfs2-mlro"><option value="">Select</option><option>Yes – Immediately</option><option>Pending</option></select>
              </div>
              <div><span class="lbl">Senior Management Notified?</span>
                <select id="tfs2-mgmt"><option value="">Select</option><option>Yes – Immediately</option><option>Pending</option></select>
              </div>
            </div>
          </div>
        </div>

        <div style="margin-top:10px"><span class="lbl">Disposition Rationale / Notes *</span>
          <textarea id="tfs2-notes" style="min-height:80px" placeholder="Document the full basis for your screening decision. For false positives: state exactly how you differentiated. For confirmed/partial matches: describe the match and actions taken."></textarea>
        </div>

        <div style="display:flex;gap:8px;margin-top:1rem">
          <button class="btn btn-gold" data-action="suite2SaveTFS" style="flex:1">Save Screening Event</button>
          <button class="btn btn-sm btn-blue" data-action="suite2RunScreening" style="flex:1;padding:12px">Run Screening</button>
          <button class="btn btn-sm" data-action="_closeModal" data-arg="tfs2Modal" style="padding:12px 20px">Cancel</button>
        </div>
      </div>
    </div>

`;

    // Wire date change to calculate CNMR/PNMR deadlines
    setTimeout(() => {
      const d = document.getElementById('tfs2-date');
      if (d) d.addEventListener('input', function() {
        if (!this.value || this.value.length < 10) return;
        const dl = addBusinessDays(this.value, 5);
        ['tfs2-cnmr-deadline','tfs2-pnmr-deadline'].forEach(id => {
          const el = document.getElementById(id); if(el) el.value = dl;
        });
      });
    }, 100);
  }

  global.suite2SelectOutcome = function(val) {
    document.getElementById('tfs2-outcome').value = val;
    // Reset all buttons
    ['Negative_–_No_Match','False_Positive','Partial_Match','Confirmed_Match'].forEach(v => {
      const btn = document.getElementById('tfs2-btn-'+v);
      if (btn) { btn.style.background='var(--surface2)'; btn.style.borderColor='var(--border)'; }
    });
    // Highlight selected
    const key = val.replace(/\s/g,'_');
    const btn = document.getElementById('tfs2-btn-'+key);
    if (btn) {
      const cols = {'Negative_–_No_Match':'var(--green)','False_Positive':'var(--green)','Partial_Match':'var(--amber)','Confirmed_Match':'var(--red)'};
      btn.style.borderColor = cols[key]||'var(--gold)';
      btn.style.background = (cols[key]||'var(--gold)')+'22';
    }
    // Show/hide sections
    document.getElementById('tfs2-fp-section').style.display = val==='False Positive'?'block':'none';
    document.getElementById('tfs2-partial-section').style.display = val==='Partial Match'?'block':'none';
    document.getElementById('tfs2-confirmed-section').style.display = val==='Confirmed Match'?'block':'none';
    // Auto-calculate deadlines
    const dateEl = document.getElementById('tfs2-date');
    if (dateEl && dateEl.value && (val==='Confirmed Match'||val==='Partial Match')) {
      const dl = addBusinessDays(dateEl.value, 5);
      ['tfs2-cnmr-deadline','tfs2-pnmr-deadline'].forEach(id => {
        const el = document.getElementById(id); if(el) el.value = dl;
      });
    }
  };

  global.renderTFS2 = renderTFS2;
  global.suite2OpenTFSForm = function() {
    document.getElementById('tfs2-edit-idx').value = '-1';
    ['tfs2-name','tfs2-reviewer','tfs2-notes','tfs2-fp-evidence','tfs2-pnmr-ref','tfs2-ffr-ref','tfs2-cnmr-ref'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
    ['tfs2-fp-basis','tfs2-tx-suspended','tfs2-pnmr-status','tfs2-frozen','tfs2-ffr','tfs2-cnmr-status','tfs2-supervisor','tfs2-mlro','tfs2-mgmt'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
    ['tfs2-list-uae','tfs2-list-un'].forEach(id=>{const e=document.getElementById(id);if(e)e.checked=true;});
    ['tfs2-list-ofac','tfs2-list-eu','tfs2-list-uk','tfs2-list-interpol','tfs2-list-adverse','tfs2-list-pep'].forEach(id=>{const e=document.getElementById(id);if(e)e.checked=true;});
    document.getElementById('tfs2-date').value = today();
    document.getElementById('tfs2-outcome').value = '';
    document.getElementById('tfs2-freeze-dt').value = '';
    document.getElementById('tfs2-cnmr-deadline').value = '';
    document.getElementById('tfs2-pnmr-deadline').value = '';
    ['tfs2-fp-section','tfs2-partial-section','tfs2-confirmed-section'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none';});
    ['Negative_–_No_Match','False_Positive','Partial_Match','Confirmed_Match'].forEach(v=>{const btn=document.getElementById('tfs2-btn-'+v);if(btn){btn.style.background='var(--surface2)';btn.style.borderColor='var(--border)';}});
    document.getElementById('tfs2Modal').classList.add('open');
  };

  global.suite2EditTFS = function(idx) {
    const events = load(SK2.TFS2)||[];
    const e = events[idx];
    if (!e) return;
    suite2OpenTFSForm();
    document.getElementById('tfs2-edit-idx').value = idx;
    document.getElementById('tfs2-name').value = e.screenedName||'';
    if (document.getElementById('tfs2-entity-type')) document.getElementById('tfs2-entity-type').value = e.entityType||'Individual';
    if (document.getElementById('tfs2-dob')) document.getElementById('tfs2-dob').value = e.dob||'';
    if (document.getElementById('tfs2-country')) document.getElementById('tfs2-country').value = e.country||'';
    if (document.getElementById('tfs2-idnumber')) document.getElementById('tfs2-idnumber').value = e.idNumber||'';
    document.getElementById('tfs2-event').value = e.eventType||'';
    document.getElementById('tfs2-date').value = e.screeningDate||today();
    document.getElementById('tfs2-reviewer').value = e.reviewedBy||'';
    document.getElementById('tfs2-notes').value = e.notes||'';
    if (e.outcome) { setTimeout(()=>suite2SelectOutcome(e.outcome), 100); }
    // Restore list checkboxes
    if (e.listsScreened) {
      ['uae','un','ofac','eu','uk','interpol'].forEach(l=>{
        const el = document.getElementById('tfs2-list-'+l);
        if(el) el.checked = e.listsScreened.includes(l.toUpperCase());
      });
    }
  };

  global.suite2RunScreening = async function() {
    var name = document.getElementById('tfs2-name')?.value?.trim();
    var entityType = document.getElementById('tfs2-entity-type')?.value || 'Individual';
    var country = document.getElementById('tfs2-country')?.value?.trim() || '';
    var idNumber = document.getElementById('tfs2-idnumber')?.value?.trim() || '';
    if (!name) { toast('Enter the name to screen', 'error'); return; }

    var selectedLists = [];
    if (document.getElementById('tfs2-list-uae')?.checked) selectedLists.push('UAE EOCN');
    if (document.getElementById('tfs2-list-un')?.checked) selectedLists.push('UNSC');
    if (document.getElementById('tfs2-list-ofac')?.checked) selectedLists.push('OFAC SDN');
    if (document.getElementById('tfs2-list-eu')?.checked) selectedLists.push('EU');
    if (document.getElementById('tfs2-list-uk')?.checked) selectedLists.push('UK OFSI');
    if (document.getElementById('tfs2-list-interpol')?.checked) selectedLists.push('Interpol');
    if (document.getElementById('tfs2-list-adverse')?.checked) selectedLists.push('Adverse Media');
    if (document.getElementById('tfs2-list-pep')?.checked) selectedLists.push('PEP');

    var notesEl = document.getElementById('tfs2-notes');

    toast('Tier-1 deep screening "' + name + '" — live web search + AI analysis — may take 30-60 seconds...', 'info', 60000);

    try {
      if (typeof callAI !== 'function') { toast('No AI provider — select outcome manually', 'info'); return; }

      var dob = document.getElementById('tfs2-dob')?.value || '';
      var entityDesc = name + ' (' + entityType + ')';
      if (dob) entityDesc += ', DOB/Registration: ' + dob;
      if (country) entityDesc += ', ' + country;
      if (idNumber) entityDesc += ', ID: ' + idNumber;

      // Step 1: Live web search for real-time adverse media (if Tavily key configured)
      var liveSearchResults = '';
      if (typeof searchWebForScreening === 'function') {
        try {
          toast('Searching live web sources for "' + name + '"...', 'info', 15000);
          var webResults = await searchWebForScreening(name, entityType, country);
          if (webResults) {
            liveSearchResults = '\n\n' + webResults;
            toast('Live web search complete — analyzing with AI...', 'info', 30000);
          }
        } catch(webErr) {
          console.warn('[Screening] Web search failed:', webErr.message);
        }
      }

      // Step 2: AI screening with live search results included (with 429 retry)
      var screeningBody = {
        model: 'claude-haiku-4-5', max_tokens: 1024, temperature: 0,
        system: 'Compliance screening engine. RULES: Never fabricate sanctions. Adverse media separate from sanctions. Report findings with sources/dates. Check corporate network. If LIVE WEB SEARCH RESULTS provided, prioritize them. Return ONLY JSON: {"result":"CLEAR|MATCH|POTENTIAL_MATCH","sanctions_finding":"","pep_finding":"","adverse_media_found":false,"adverse_media_severity":"none|low|medium|high|critical","adverse_media_finding":"findings with sources","corporate_connections":"","required_actions":"","risk_level":"low|medium|high|critical"}',
        messages: [{ role: 'user', content: 'Screen: ' + entityDesc + '. Check sanctions (OFAC,UN,EU,UK,UAE EOCN), PEP, corporate network, adverse media (financial crime, corruption, terrorism, environmental, human rights). Be concise but thorough.' + liveSearchResults }]
      };
      var data = null;
      for (var _retry = 0; _retry < 3; _retry++) {
        try {
          data = await callAI(screeningBody);
          break;
        } catch(retryErr) {
          if (retryErr.message && retryErr.message.indexOf('429') !== -1 && _retry < 2) {
            toast('Rate limited — waiting ' + ((_retry+1)*10) + 's before retry...', 'info', 15000);
            await new Promise(function(w){ setTimeout(w, (_retry+1)*10000); });
          } else { throw retryErr; }
        }
      }
      if (!data) throw new Error('AI screening failed after retries');

      var raw = (data.content || []).filter(function(b){return b.type==='text'}).map(function(b){return b.text}).join('');
      // Robust JSON extraction with multiple fallback strategies
      var result = null;
      var cleaned = raw.replace(/```json?\n?/g,'').replace(/```/g,'').trim();
      // Strategy 1: direct parse
      try { result = JSON.parse(cleaned); } catch(_) {}
      // Strategy 2: extract JSON object
      if (!result) { var m = cleaned.match(/\{[\s\S]*\}/); if (m) { try { result = JSON.parse(m[0]); } catch(_) {} } }
      // Strategy 3: fix common issues
      if (!result) { var m2 = cleaned.match(/\{[\s\S]*\}/); if (m2) { var fixed = m2[0].replace(/,\s*([}\]])/g,'$1').replace(/\n/g,' ').replace(/\r/g,''); try { result = JSON.parse(fixed); } catch(_) {} } }
      // Strategy 4: extract key fields manually from raw text
      if (!result) {
        var resultMatch = raw.match(/"result"\s*:\s*"(CLEAR|MATCH|POTENTIAL_MATCH)"/);
        var advFound = raw.match(/"adverse_media_found"\s*:\s*(true|false)/);
        var advSev = raw.match(/"adverse_media_severity"\s*:\s*"(\w+)"/);
        result = {
          result: resultMatch ? resultMatch[1] : 'POTENTIAL_MATCH',
          adverse_media_found: advFound ? advFound[1] === 'true' : false,
          adverse_media_severity: advSev ? advSev[1] : 'unknown',
          sanctions_finding: 'Parsed from partial response — review raw output below.',
          adverse_media_finding: raw.substring(0, 3000),
          required_actions: 'Manual review required — AI response was partially parsed.',
          pep_finding: ''
        };
      }

      // Override: adverse media alone = POTENTIAL_MATCH (never MATCH without confirmed sanctions)
      // Only the AI's sanctions_finding determines if it's a true MATCH
      var hasSanctionsMatch = result.sanctions_finding && /confirmed.*designation|designated.*on|appears.*on.*SDN|appears.*on.*sanctions|sanctioned|MATCH.*OFAC|MATCH.*EOCN|MATCH.*UN.*Consolidated/i.test(result.sanctions_finding);
      if (result.adverse_media_found && result.adverse_media_severity && result.adverse_media_severity !== 'none' && result.adverse_media_severity !== 'low') {
        if (!hasSanctionsMatch) {
          // Adverse media without sanctions = POTENTIAL_MATCH (Partial Match), never Confirmed Match
          result.result = 'POTENTIAL_MATCH';
        }
      }
      // If AI returned MATCH but sanctions_finding says no designation found, downgrade to POTENTIAL_MATCH
      if (result.result === 'MATCH' && !hasSanctionsMatch) {
        if (result.sanctions_finding && /no.*confirmed|not.*found|not.*appear|not.*designated|no.*designation|does not appear/i.test(result.sanctions_finding)) {
          result.result = 'POTENTIAL_MATCH';
        }
      }

      // Apply outcome
      var r = result.result;
      if (r === 'CLEAR' || r === 'NO_MATCH') {
        suite2SelectOutcome('Negative – No Match');
        toast('Screening complete: No match found', 'success');
      } else if (r === 'MATCH') {
        suite2SelectOutcome('Confirmed Match');
        toast('CONFIRMED MATCH — Immediate action required!', 'error', 10000);
      } else {
        suite2SelectOutcome('Partial Match');
        toast('POTENTIAL MATCH — Enhanced Due Diligence required', 'error', 8000);
      }

      // Build comprehensive Tier-1 report (Refinitiv/Dow Jones standard)
      var report = '';
      report += 'SANCTIONS & PEP CHECK: ' + (result.sanctions_finding || 'No confirmed sanctions designations found.');
      if (result.pep_finding) report += ' PEP: ' + result.pep_finding;
      if (result.corporate_connections) report += '\n\nCORPORATE NETWORK & ASSOCIATIONS: ' + result.corporate_connections;
      report += '\n\nADVERSE MEDIA INVESTIGATION' + (result.adverse_media_found ? ' [FINDINGS DETECTED — Severity: ' + (result.adverse_media_severity||'').toUpperCase() + ']' : ' [No significant findings]');
      if (result.adverse_media_found && result.adverse_media_categories && result.adverse_media_categories.length) {
        report += ' — Categories: ' + result.adverse_media_categories.join(', ');
      }
      report += ':\n' + (result.adverse_media_finding || 'No adverse media findings.');
      report += '\n\nREQUIRED ACTIONS:\n' + (result.required_actions || 'Review screening results and determine appropriate compliance response.');
      report += '\n\nRISK LEVEL: ' + (result.risk_level || 'TBD').toUpperCase();
      report += '\n\nREGULATORY BASIS: ' + (result.regulatory_basis || 'UAE FDL No.10/2025, FATF Rec 6/10/22, Cabinet Decision No.74/2020, LBMA Responsible Gold Guidance.');
      if (liveSearchResults) {
        report += '\n\nSCREENING METHOD: AI analysis supplemented with LIVE WEB SEARCH (' + new Date().toISOString().split('T')[0] + '). Results reflect real-time adverse media from public sources.';
      }
      report += '\n\nIMPORTANT DISCLAIMER: This AI screening is based on training data' + (liveSearchResults ? ' supplemented with live web search results' : ' with a knowledge cutoff') + '. Always supplement with live database checks (Refinitiv World-Check, Dow Jones, LexisNexis) and current news searches before making final compliance decisions.';

      if (notesEl) notesEl.value = '[AI Screening] ' + report;

    } catch(e) {
      var billingMsg = (e.message || '').toLowerCase();
      if (e.isBillingError || billingMsg.indexOf('credit') !== -1 || billingMsg.indexOf('balance') !== -1 || billingMsg.indexOf('billing') !== -1 || billingMsg.indexOf('insufficient') !== -1 || billingMsg.indexOf('quota') !== -1) {
        toast('API credits exhausted — select screening outcome manually using the buttons above. Add credits at console.anthropic.com.', 'info', 10000);
        if (notesEl) notesEl.value = '[AI Unavailable] API credits exhausted. Manual screening required per FATF Rec 6 and UAE FDL No.10/2025 Art.22. Screen against: UAE Local Terrorist List (EOCN), UNSC Consolidated, OFAC SDN, EU Consolidated, UK OFSI.';
      } else {
        toast('Screening error: ' + e.message, 'error');
        if (notesEl) notesEl.value = '[AI Screening Error] ' + e.message + '. Manual screening required per FATF Rec 6 and UAE FDL No.10/2025 Art.22.';
      }
    }
  };

  global.suite2SaveTFS = function() {
    const name = document.getElementById('tfs2-name').value.trim();
    const outcome = document.getElementById('tfs2-outcome').value;
    if (!name) { toast('Screened name is required','error'); return; }
    if (!outcome) { toast('Select a screening outcome','error'); return; }

    // Mandatory list validation: UAE Local Terrorist List and UNSC are legally required
    const uaeChecked = document.getElementById('tfs2-list-uae')?.checked;
    const unChecked = document.getElementById('tfs2-list-un')?.checked;
    if (!uaeChecked || !unChecked) {
      const missing = [];
      if (!uaeChecked) missing.push('UAE Local Terrorist List (EOCN)');
      if (!unChecked) missing.push('UNSC Consolidated Sanctions List');
      if (!confirm('WARNING: The following mandatory lists are not checked: ' + missing.join(', ') + '.\n\nCabinet Decision No.(74)/2020 REQUIRES screening against these lists.\n\nProceed anyway? (This will be flagged as non-compliant)')) return;
    }

    const lists = [];
    if (uaeChecked) lists.push('UAE Local Terrorist List (EOCN)');
    if (unChecked) lists.push('UNSC Consolidated');
    if (document.getElementById('tfs2-list-ofac')?.checked) lists.push('OFAC SDN');
    if (document.getElementById('tfs2-list-eu')?.checked) lists.push('EU Consolidated');
    if (document.getElementById('tfs2-list-uk')?.checked) lists.push('UK OFSI');
    if (document.getElementById('tfs2-list-interpol')?.checked) lists.push('Interpol');
    if (document.getElementById('tfs2-list-adverse')?.checked) lists.push('Adverse Media');
    if (document.getElementById('tfs2-list-pep')?.checked) lists.push('🏛️ Political Controversy / PEP');
    const events = load(SK2.TFS2)||[];
    const editIdx = parseInt(document.getElementById('tfs2-edit-idx').value, 10);
    if (editIdx >= 0 && editIdx >= events.length) { toast('Record not found','error'); return; }
    const record = {
      id: editIdx>=0 ? events[editIdx].id : `TFS2-${Date.now()}`,
      screenedName: name,
      entityType: document.getElementById('tfs2-entity-type')?.value || 'Individual',
      dob: document.getElementById('tfs2-dob')?.value || '',
      country: document.getElementById('tfs2-country')?.value?.trim() || '',
      idNumber: document.getElementById('tfs2-idnumber')?.value?.trim() || '',
      eventType: document.getElementById('tfs2-event').value,
      listsScreened: lists.join(' | '),
      screeningDate: document.getElementById('tfs2-date').value,
      reviewedBy: document.getElementById('tfs2-reviewer').value,
      outcome,
      notes: document.getElementById('tfs2-notes').value,
      // False positive fields
      fpBasis: document.getElementById('tfs2-fp-basis')?.value||null,
      fpEvidence: document.getElementById('tfs2-fp-evidence')?.value||null,
      // Partial match fields
      txSuspended: document.getElementById('tfs2-tx-suspended')?.value||null,
      pnmrStatus: document.getElementById('tfs2-pnmr-status')?.value||null,
      pnmrDeadline: document.getElementById('tfs2-pnmr-deadline')?.value||null,
      pnmrRef: document.getElementById('tfs2-pnmr-ref')?.value||null,
      // Confirmed match fields
      frozenWithin24h: document.getElementById('tfs2-frozen')?.value||null,
      freezeDateTime: document.getElementById('tfs2-freeze-dt')?.value||null,
      ffrFiled: document.getElementById('tfs2-ffr')?.value||null,
      ffrRef: document.getElementById('tfs2-ffr-ref')?.value||null,
      cnmrStatus: document.getElementById('tfs2-cnmr-status')?.value||null,
      cnmrDeadline: document.getElementById('tfs2-cnmr-deadline')?.value||null,
      cnmrRef: document.getElementById('tfs2-cnmr-ref')?.value||null,
      supervisorNotified: document.getElementById('tfs2-supervisor')?.value||null,
      mlroNotified: document.getElementById('tfs2-mlro')?.value||null,
      mgmtNotified: document.getElementById('tfs2-mgmt')?.value||null,
      updatedAt: new Date().toISOString(),
      // Compliance audit trail
      auditTrail: (editIdx>=0 && events[editIdx]?.auditTrail) ? [
        ...events[editIdx].auditTrail,
        { action: 'UPDATED', actor: document.getElementById('tfs2-reviewer').value || 'unknown', timestamp: new Date().toISOString(), outcome: outcome }
      ] : [
        { action: 'CREATED', actor: document.getElementById('tfs2-reviewer').value || 'unknown', timestamp: new Date().toISOString(), outcome: outcome }
      ],
      mandatoryListsScreened: uaeChecked && unChecked,
    };
    if (editIdx>=0) { events[editIdx]=record; } else { events.unshift(record); }
    save(SK2.TFS2, events);
    document.getElementById('tfs2Modal').classList.remove('open');
    if (outcome==='Confirmed Match') toast('🔴 CONFIRMED MATCH saved — ensure freeze, FFR, and CNMR obligations are met within deadlines','error');
    else if (outcome==='Partial Match') toast('🟡 PARTIAL MATCH saved — PNMR must be filed within 5 business days','info');
    else toast('TFS event saved — '+outcome,'success');
    renderTFS2();

    // Auto-sync to dedicated SCREENING project in Asana
    var savedIdx = editIdx>=0 ? editIdx : 0;
    try {
      if (typeof syncScreeningToAsana === 'function' || typeof autoSyncToAsana === 'function' || typeof asanaPush === 'function') {
        var syncTitle = '[TFS] ' + name + ' — ' + outcome;
        // Phase 19 W-E — canonical regulatory citation block for TFS
        // screening tasks. Same output format as appendCitationBlock
        // in src/services/regulatoryCitationEnricher.ts (PR #184).
        // Inlined here because compliance-suite.js is a browser IIFE
        // and cannot import the TS module directly. Idempotency guard
        // uses the literal header so a re-sync of the same record
        // does not double the block.
        //
        // Verdict mapping by outcome:
        //   Confirmed Match → freeze (adds 24h freeze + CNMR + TFS
        //                             anchors)
        //   Partial Match   → escalate (adds Article 4 only)
        //   other           → flag (common set only)
        //
        // Escape hatch: window.__ASANA_CITATION_BLOCK_DISABLED = true
        // turns the append off at runtime without a code revert.
        function __phase19WeCitationBlock(outcomeLabel) {
          if (typeof window !== 'undefined' &&
              window.__ASANA_CITATION_BLOCK_DISABLED === true) {
            return '';
          }
          var common = [
            'UAE Federal Decree-Law No. 10 of 2025, Article 20 (MLRO duties)',
            'UAE Federal Decree-Law No. 10 of 2025, Article 24 (10-year retention)',
            'UAE Federal Decree-Law No. 10 of 2025, Article 29 (no tipping off)',
            'Cabinet Resolution 134/2025, Article 19 (internal review)'
          ];
          var extra = [];
          if (outcomeLabel === 'Confirmed Match') {
            extra = [
              'Cabinet Resolution 74/2020, Article 4 (24-hour freeze)',
              'Cabinet Resolution 74/2020, Article 7 (CNMR within 5 business days)',
              'UAE Federal Decree-Law No. 10 of 2025, Article 35 (TFS)'
            ];
          } else if (outcomeLabel === 'Partial Match') {
            extra = [
              'Cabinet Resolution 74/2020, Article 4 (24-hour freeze)'
            ];
          }
          var seen = Object.create(null);
          var lines = ['--- Regulatory citation (auto-generated) ---'];
          common.concat(extra).forEach(function(a){
            if (!seen[a]) { seen[a] = true; lines.push('• ' + a); }
          });
          return '\n\n' + lines.join('\n');
        }
        var syncNotes = 'TFS Screening Event: ' + record.id
          + '\nEntity: ' + name + ' (' + (record.entityType||'') + ')'
          + (record.country ? '\nCountry: ' + record.country : '')
          + (record.idNumber ? '\nID: ' + record.idNumber : '')
          + '\nEvent Type: ' + record.eventType
          + '\nLists: ' + record.listsScreened
          + '\nDate: ' + record.screeningDate
          + '\nOutcome: ' + outcome
          + '\nReviewed By: ' + (record.reviewedBy||'—')
          + (record.notes ? '\n\nNotes:\n' + record.notes : '')
          + '\n\nRegulatory Basis: UAE FDL No.10/2025, FATF Rec 6, Cabinet Decision No.74/2020'
          + __phase19WeCitationBlock(outcome);
        var daysUrgency = outcome==='Confirmed Match' ? 1 : outcome==='Partial Match' ? 5 : 30;
        // Use dedicated SCREENING project per entity
        if (typeof syncScreeningToAsana === 'function') {
          syncScreeningToAsana(name, syncTitle, syncNotes, daysUrgency).then(function(gid) {
            if (gid) { var ev = load(SK2.TFS2)||[]; if(ev[savedIdx]) { ev[savedIdx].asanaGid = gid; save(SK2.TFS2, ev); } toast('Screening synced to Asana (SCREENING project)','success',2000); }
          }).catch(function(e){ console.warn('[TFS] Asana screening sync failed:', e); });
        } else if (typeof autoSyncToAsana === 'function') {
          autoSyncToAsana(syncTitle, syncNotes, daysUrgency).then(function(gid) {
            if (gid) { var ev = load(SK2.TFS2)||[]; if(ev[savedIdx]) { ev[savedIdx].asanaGid = gid; save(SK2.TFS2, ev); } toast('Screening synced to Asana','success',2000); }
          }).catch(function(e){ console.warn('[TFS] Asana sync failed:', e); });
        } else if (typeof asanaPush === 'function') {
          asanaPush(syncTitle, syncNotes).then(function(gid) {
            if (gid) { var ev = load(SK2.TFS2)||[]; if(ev[savedIdx]) { ev[savedIdx].asanaGid = gid; save(SK2.TFS2, ev); } toast('Screening synced to Asana','success',2000); }
          }).catch(function(e){ console.warn('[TFS] Asana push failed:', e); });
        }
      }
    } catch(e) { console.warn('[TFS] Post-save error:', e); }
  };

  global.suite2DeleteTFS = function(idx) {
    if (!confirm('Delete this TFS screening event?')) return;
    const events = load(SK2.TFS2)||[];
    events.splice(idx,1);
    save(SK2.TFS2, events);
    renderTFS2();
  };

  // ════════════════════════════════════════════════════════════════════════════


  // ════════════════════════════════════════════════════════════════════════════
  // DPMSR — DEALERS IN PRECIOUS METALS AND STONES REPORT
  // Reg: MoE Circular 08/AML/2021 | AED 55,000 threshold | goAML DPMSR
  // ════════════════════════════════════════════════════════════════════════════

  function renderDPMSR() {
    const el = document.getElementById('suite2-content-dpmsr');
    if (!el) return;
    const cases = load(SK2.DPMSR)||[];

    el.innerHTML = `
    <div class="card">
      <div class="top-bar">
        <span class="sec-title">DPMSR — Threshold Reporting & Linked Transaction Detection</span>
        <span style="font-size:11px;color:var(--muted)">MoE Circular 08/AML/2021 | AED 55,000 Threshold | Cabinet Resolution 134/2025 Art.13</span>
        <button class="btn btn-sm btn-blue" style="padding:6px 12px;font-size:11px" data-action="suite2OpenDPMSRForm">+ New Threshold Case</button>
      </div>

      <div style="background:var(--surface2);border-radius:4px;padding:14px;margin-bottom:1rem">
        <div class="sec-title" style="margin-bottom:10px;border:none;padding:0">AED 55,000 Threshold — Mandatory CDD Requirements</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;font-size:12px">
          <div style="background:var(--surface);border-radius:3px;padding:10px;border-left:3px solid var(--gold)">
            <div style="font-weight:600;margin-bottom:6px">Resident Individual</div>
            <div>✅ Emirates ID or valid residence permit</div>
            <div>✅ Transaction amount and date</div>
            <div>✅ Payment method</div>
            <div style="color:var(--muted);font-size:11px;margin-top:6px">Cash transactions ≥ AED 55,000</div>
          </div>
          <div style="background:var(--surface);border-radius:3px;padding:10px;border-left:3px solid var(--blue)">
            <div style="font-weight:600;margin-bottom:6px">Non-Resident Individual</div>
            <div>✅ Passport copy (valid)</div>
            <div>✅ Country of residence</div>
            <div>✅ Transaction amount and date</div>
            <div style="color:var(--muted);font-size:11px;margin-top:6px">Cash transactions ≥ AED 55,000</div>
          </div>
          <div style="background:var(--surface);border-radius:3px;padding:10px;border-left:3px solid var(--amber)">
            <div style="font-weight:600;margin-bottom:6px">Entity / Company</div>
            <div>✅ Trade licence (valid)</div>
            <div>✅ Company representative ID</div>
            <div>✅ Authorization document</div>
            <div style="color:var(--muted);font-size:11px;margin-top:6px">Cash or wire transfer ≥ AED 55,000</div>
          </div>
        </div>
        <div style="margin-top:10px;font-size:12px;color:var(--amber);font-family:'Montserrat',sans-serif">
          ⚠️ LINKED TRANSACTION RULE: The AED 55,000 threshold applies to a single transaction OR several transactions that appear to be linked. The tool tracks linked transactions to detect structuring.
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:1rem">
        <div class="metric m-c"><div class="metric-num">${cases.filter(c=>c.reportingRequired==='Yes – DPMSR Required').length}</div><div class="metric-lbl">DPMSR Required</div></div>
        <div class="metric m-h"><div class="metric-num">${cases.filter(c=>c.linkedFlag==='Yes – Linked').length}</div><div class="metric-lbl">Linked Transactions</div></div>
        <div class="metric m-ok"><div class="metric-num">${cases.filter(c=>c.dpmsr_filed==='Yes – Filed').length}</div><div class="metric-lbl">DPMSR Filed</div></div>
        <div class="metric m-m"><div class="metric-num">${cases.filter(c=>c.cddComplete==='Incomplete').length}</div><div class="metric-lbl">CDD Incomplete ⚠️</div></div>
      </div>

      ${cases.length===0?'<p style="color:var(--muted);font-size:13px;text-align:center;padding:2rem">No threshold cases recorded.</p>':''}
      ${cases.map((c,i)=>`
        <div class="finding ${c.reportingRequired==='Yes – DPMSR Required'?'f-high':c.cddComplete==='Incomplete'?'f-critical':'f-ok'}" style="margin-bottom:8px">
          <div class="f-head">
            <div class="f-head-left"><div>
              <div class="f-title">${esc(c.customerName)} — AED ${Number(c.amount||0).toLocaleString()} ${c.cddComplete==='Incomplete'?'<span style="color:var(--red);font-size:11px">⛔ CDD INCOMPLETE</span>':''}</div>
              <div class="f-body">Type: ${esc(c.customerType)} | Payment: ${esc(c.paymentMethod)} | Date: ${esc(fmtDate(c.txDate))}</div>
              <div class="f-ref">DPMSR: ${esc(c.reportingRequired)} | Linked: ${esc(c.linkedFlag||'No')} | Filed: ${esc(c.dpmsr_filed||'No')}</div>
            </div></div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-sm btn-gold" data-action="suite2EditDPMSR" data-arg="${i}">Edit</button>
              <button class="btn btn-sm btn-red" data-action="suite2DeleteDPMSR" data-arg="${i}">Delete</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>

    <!-- DPMSR Modal -->
    <div class="modal-overlay" id="dpmsrModal">
      <div class="modal" style="max-width:620px;width:95%">
        <button class="modal-close" data-action="_closeModal" data-arg="dpmsrModal">✕</button>
        <div class="modal-title">DPMSR Threshold Case</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:1rem;font-family:'Montserrat',sans-serif">MoE Circular 08/AML/2021 | AED 55,000 Threshold | goAML DPMSR Reporting</div>
        <input type="hidden" id="dpmsr-edit-idx" value="-1">

        <div class="row row-2">
          <div><span class="lbl">Customer Name *</span><input id="dpmsr-customer" placeholder="Full legal name"/></div>
          <div><span class="lbl">Customer Type *</span>
            <select id="dpmsr-type" onchange="suite2CheckDPMSRCDD()">
              <option value="">Select</option>
              <option>Resident Individual</option>
              <option>Non-Resident Individual</option>
              <option>Entity / Company</option>
            </select>
          </div>
        </div>
        <div class="row row-2">
          <div><span class="lbl">Transaction Amount (AED) *</span><input type="number" id="dpmsr-amount" placeholder="e.g. 75000" oninput="suite2CalcDPMSRThreshold()"/></div>
          <div><span class="lbl">Transaction Date *</span><input type="text" id="dpmsr-txdate" value="${today()}" placeholder="dd/mm/yyyy" oninput="csFormatDateInput(this)" maxlength="10"/></div>
        </div>
        <div class="row row-2">
          <div><span class="lbl">Payment Method *</span>
            <select id="dpmsr-payment"><option value="">Select</option><option>Cash</option><option>Bank Transfer / Wire</option><option>Cheque</option><option>Card</option><option>Crypto</option><option>Mixed</option></select>
          </div>
          <div><span class="lbl">Transaction Type</span>
            <select id="dpmsr-txtype"><option>Purchase of Gold</option><option>Sale of Gold</option><option>Exchange</option><option>Consignment</option><option>Other</option></select>
          </div>
        </div>

        <div id="dpmsr-threshold-alert" style="display:none;background:rgba(232,160,48,0.12);border:1px solid rgba(232,160,48,0.4);border-radius:4px;padding:10px;margin:10px 0;font-size:12px;color:var(--amber);font-family:'Montserrat',sans-serif">
          ⚠️ AED 55,000 THRESHOLD TRIGGERED — CDD documentation and DPMSR filing required
        </div>

        <div class="sec-title" style="margin-top:10px;margin-bottom:8px">CDD Requirements — Based on Customer Type</div>
        <div id="dpmsr-cdd-requirements" style="background:var(--surface2);border-radius:3px;padding:10px;font-size:12px;margin-bottom:10px">
          Select customer type above to see required CDD documents.
        </div>

        <div class="row row-2">
          <div><span class="lbl">ID Document Reference</span><input id="dpmsr-id-ref" placeholder="Emirates ID / Passport number"/></div>
          <div><span class="lbl">ID Expiry Date</span><input type="text" id="dpmsr-id-expiry" placeholder="dd/mm/yyyy" oninput="csFormatDateInput(this)" maxlength="10"/></div>
        </div>
        <div id="dpmsr-entity-fields" style="display:none">
          <div class="row row-2">
            <div><span class="lbl">Trade Licence Number *</span><input id="dpmsr-trade-licence" placeholder="Trade licence number"/></div>
            <div><span class="lbl">Trade Licence Expiry</span><input type="text" id="dpmsr-trade-expiry" placeholder="dd/mm/yyyy" oninput="csFormatDateInput(this)" maxlength="10"/></div>
          </div>
          <div><span class="lbl">Company Representative Name</span><input id="dpmsr-rep-name" placeholder="Name of authorized representative"/></div>
        </div>

        <div style="background:var(--surface2);border-radius:4px;padding:12px;margin-top:10px">
          <div class="sec-title" style="margin-bottom:8px;border:none;padding:0">Linked Transaction Check</div>
          <div class="row row-2">
            <div><span class="lbl">Linked to Previous Transaction?</span>
              <select id="dpmsr-linked"><option>No – Standalone</option><option>Yes – Linked</option><option>Suspected – Under Review</option></select>
            </div>
            <div><span class="lbl">Previous Transaction Reference</span><input id="dpmsr-linked-ref" placeholder="Previous transaction ID if linked"/></div>
          </div>
          <div class="row row-2">
            <div><span class="lbl">Cumulative Linked Amount (AED)</span><input type="number" id="dpmsr-cumulative" placeholder="Total including linked transactions"/></div>
            <div><span class="lbl">Structuring Indicator?</span>
              <select id="dpmsr-structuring"><option>No</option><option>Suspected – Multiple below-threshold transactions</option><option>Confirmed – STR filed</option></select>
            </div>
          </div>
        </div>

        <div class="row row-2" style="margin-top:10px">
          <div><span class="lbl">Reporting Required?</span>
            <select id="dpmsr-reporting"><option value="">Select</option><option>Yes – DPMSR Required</option><option>No – Below Threshold</option><option>No – Exempt</option></select>
          </div>
          <div><span class="lbl">DPMSR Filed via goAML?</span>
            <select id="dpmsr-filed"><option>No</option><option>Yes – Filed</option><option>Pending</option></select>
          </div>
        </div>
        <div><span class="lbl">CDD Completeness</span>
          <select id="dpmsr-cdd-complete"><option>Complete</option><option>Incomplete</option><option>Partially Complete</option></select>
        </div>
        <div id="dpmsr-cdd-warning" style="display:none;background:rgba(217,79,79,0.1);border:1px solid rgba(217,79,79,0.3);border-radius:3px;padding:10px;margin-top:6px;font-size:12px;color:var(--red)">
          ⛔ HARD STOP — Cabinet Resolution 134/2025 Art.14: The business relationship or transaction cannot proceed where CDD cannot be applied. Do not complete this transaction until CDD is obtained.
        </div>
        <div><span class="lbl">Notes</span><textarea id="dpmsr-notes" style="min-height:60px" placeholder="Additional context, source of funds notes, escalation notes..."></textarea></div>

        <div style="display:flex;gap:8px;margin-top:1rem">
          <button class="btn btn-gold" data-action="suite2SaveDPMSR" style="flex:1">Save Threshold Case</button>
          <button class="btn btn-sm" data-action="_closeModal" data-arg="dpmsrModal" style="padding:12px 20px">Cancel</button>
        </div>
      </div>
    </div>`;

    // Wire CDD select
    setTimeout(() => {
      const cddSel = document.getElementById('dpmsr-cdd-complete');
      if (cddSel) cddSel.addEventListener('change', function() {
        const w = document.getElementById('dpmsr-cdd-warning');
        if (w) w.style.display = this.value==='Incomplete'?'block':'none';
      });
    }, 100);
  }

  global.suite2CalcDPMSRThreshold = function() {
    const amount = parseFloat(document.getElementById('dpmsr-amount').value)||0;
    const alert = document.getElementById('dpmsr-threshold-alert');
    const reporting = document.getElementById('dpmsr-reporting');
    if (amount >= THRESHOLDS.DPMSR_PRECIOUS_METALS) {
      if (alert) alert.style.display='block';
      if (reporting && !reporting.value) reporting.value='Yes – DPMSR Required';
    } else {
      if (alert) alert.style.display='none';
    }
  };

  global.suite2CheckDPMSRCDD = function() {
    const type = document.getElementById('dpmsr-type').value;
    const req = document.getElementById('dpmsr-cdd-requirements');
    const entityFields = document.getElementById('dpmsr-entity-fields');
    const cddMap = {
      'Resident Individual': '✅ Emirates ID copy (valid) | ✅ Transaction amount, date, payment method | ✅ Source of funds if ≥AED 55,000',
      'Non-Resident Individual': '✅ Passport copy (valid) | ✅ Country of residence | ✅ Transaction amount, date, payment method | ✅ Source of funds if ≥AED 55,000',
      'Entity / Company': '✅ Valid Trade Licence | ✅ Company Representative ID | ✅ Authorization document | ✅ UBO identification | ✅ Source of funds',
    };
    if (req) req.innerHTML = type ? cddMap[type]||'—' : 'Select customer type above to see required CDD documents.';
    if (entityFields) entityFields.style.display = type==='Entity / Company'?'block':'none';
  };

  global.suite2OpenDPMSRForm = function() {
    document.getElementById('dpmsr-edit-idx').value = '-1';
    ['dpmsr-customer','dpmsr-id-ref','dpmsr-linked-ref','dpmsr-rep-name','dpmsr-trade-licence','dpmsr-notes'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
    ['dpmsr-type','dpmsr-payment','dpmsr-reporting'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
    document.getElementById('dpmsr-txdate').value=today();
    document.getElementById('dpmsr-amount').value='';
    document.getElementById('dpmsr-filed').value='No';
    document.getElementById('dpmsr-cdd-complete').value='Complete';
    document.getElementById('dpmsr-linked').value='No – Standalone';
    document.getElementById('dpmsr-structuring').value='No';
    document.getElementById('dpmsr-threshold-alert').style.display='none';
    document.getElementById('dpmsr-cdd-warning').style.display='none';
    document.getElementById('dpmsr-entity-fields').style.display='none';
    document.getElementById('dpmsr-cdd-requirements').innerHTML='Select customer type above to see required CDD documents.';
    document.getElementById('dpmsrModal').classList.add('open');
  };

  global.suite2EditDPMSR = function(idx) {
    const cases = load(SK2.DPMSR)||[];
    const c = cases[idx];
    if(!c) return;
    suite2OpenDPMSRForm();
    document.getElementById('dpmsr-edit-idx').value=idx;
    document.getElementById('dpmsr-customer').value=c.customerName||'';
    document.getElementById('dpmsr-type').value=c.customerType||'';
    document.getElementById('dpmsr-amount').value=c.amount||'';
    document.getElementById('dpmsr-txdate').value=c.txDate||today();
    document.getElementById('dpmsr-payment').value=c.paymentMethod||'';
    document.getElementById('dpmsr-id-ref').value=c.idRef||'';
    document.getElementById('dpmsr-reporting').value=c.reportingRequired||'';
    document.getElementById('dpmsr-filed').value=c.dpmsr_filed||'No';
    document.getElementById('dpmsr-cdd-complete').value=c.cddComplete||'Complete';
    document.getElementById('dpmsr-notes').value=c.notes||'';
    suite2CheckDPMSRCDD();
    suite2CalcDPMSRThreshold();
    document.getElementById('dpmsrModal').classList.add('open');
  };

  global.suite2SaveDPMSR = function() {
    const name = document.getElementById('dpmsr-customer').value.trim();
    const type = document.getElementById('dpmsr-type').value;
    const amount = document.getElementById('dpmsr-amount').value;
    if(!name||!type||!amount){toast('Customer name, type, and amount are required','error');return;}
    const amountNum = parseFloat(amount);
    const cddStatus = document.getElementById('dpmsr-cdd-complete').value;
    if(cddStatus==='Incomplete' && amountNum>=THRESHOLDS.DPMSR_PRECIOUS_METALS){
      if(!confirm('⛔ CDD is incomplete. Cabinet Resolution 134/2025 Art.14 prohibits proceeding without CDD. Save record for follow-up?'))return;
    }

    // Cross-border AED 60K declaration check (Cabinet Res 134/2025 Art.16).
    // Payment methods that imply cross-border movement of cash or BNI trip
    // the declaration prompt automatically.
    const paymentMethod = document.getElementById('dpmsr-payment').value || '';
    const isCrossBorder = /cross[-\s]?border|international|wire (in|out)|import|export/i.test(paymentMethod);
    let crossBorderDeclarationId = '';
    if (isCrossBorder && amountNum >= THRESHOLDS.CROSS_BORDER_CASH) {
      crossBorderDeclarationId = prompt('Cross-border cash/BNI movement ≥ AED ' + THRESHOLDS.CROSS_BORDER_CASH + ' detected (Cabinet Res 134/2025 Art.16). Enter the Customs declaration reference:') || '';
      if (!crossBorderDeclarationId) {
        toast('Cross-border cash declaration is mandatory — record saved WITHOUT declaration ref; resolve before filing DPMSR.', 'error', 8000);
        if (typeof logAudit === 'function') logAudit('dpmsr', 'Cross-border AED ' + amountNum + ' without declaration ref for ' + name);
      }
    }

    const cases = load(SK2.DPMSR)||[];
    const editIdx = parseInt(document.getElementById('dpmsr-edit-idx').value, 10);
    const record = {
      id: editIdx>=0?cases[editIdx].id:`DPMSR-${Date.now()}`,
      customerName:name, customerType:type, amount:amountNum,
      txDate:document.getElementById('dpmsr-txdate').value,
      paymentMethod:paymentMethod,
      txType:document.getElementById('dpmsr-txtype').value,
      idRef:document.getElementById('dpmsr-id-ref').value,
      reportingRequired:document.getElementById('dpmsr-reporting').value,
      dpmsr_filed:document.getElementById('dpmsr-filed').value,
      cddComplete:cddStatus,
      linkedFlag:document.getElementById('dpmsr-linked').value,
      linkedRef:document.getElementById('dpmsr-linked-ref').value,
      cumulative:document.getElementById('dpmsr-cumulative').value,
      structuringIndicator:document.getElementById('dpmsr-structuring').value,
      notes:document.getElementById('dpmsr-notes').value,
      crossBorder: isCrossBorder,
      crossBorderDeclarationId: crossBorderDeclarationId,
      updatedAt:new Date().toISOString(),
    };
    if(editIdx>=0){cases[editIdx]=record;}else{cases.unshift(record);}
    save(SK2.DPMSR,cases);
    document.getElementById('dpmsrModal').classList.remove('open');
    toast(`DPMSR case saved — ${name} AED ${Number(amount).toLocaleString()}`,'success');
    renderDPMSR();

    // Auto-sync to Asana
    var dpIdx = editIdx>=0 ? editIdx : 0;
    try {
      if (typeof autoSyncToAsana === 'function') {
        var dpTitle = '[DPMSR] ' + name + ' — AED ' + Number(amount).toLocaleString();
        var dpNotes = 'DPMSR Case: ' + record.id
          + '\nCustomer: ' + name + ' (' + type + ')'
          + '\nAmount: AED ' + Number(amount).toLocaleString()
          + '\nDate: ' + record.txDate + ' | Payment: ' + record.paymentMethod
          + '\nTransaction Type: ' + record.txType
          + '\nCDD: ' + cddStatus + ' | Reporting: ' + record.reportingRequired
          + '\nFiled: ' + record.dpmsr_filed
          + (record.linkedFlag === 'Yes' ? '\nLinked Transaction: ' + record.linkedRef : '')
          + (record.notes ? '\nNotes: ' + record.notes : '')
          + '\n\nRef: Cabinet Resolution 134/2025 Art.14, FATF Rec 22';
        autoSyncToAsana(dpTitle, dpNotes, 3).then(function(gid) {
          if (gid) { var cs = load(SK2.DPMSR)||[]; if(cs[dpIdx]) { cs[dpIdx].asanaGid = gid; save(SK2.DPMSR, cs); } toast('DPMSR synced to Asana','success',2000); }
        }).catch(function(e){ console.warn('[DPMSR] Asana sync failed:', e); });
      }
    } catch(e) { console.warn('[DPMSR] Post-save error:', e); }
  };

  global.suite2DeleteDPMSR = function(idx) {
    if(!confirm('Delete this DPMSR case?'))return;
    const cases=load(SK2.DPMSR)||[];
    cases.splice(idx,1);
    save(SK2.DPMSR,cases);
    renderDPMSR();
  };

  // ════════════════════════════════════════════════════════════════════════════
  // RECORD RETENTION — STATUTORY 10-YEAR REQUIREMENT (MoE DPMS Guidance, FDL No.10/2025)
  // Reg: Cabinet Resolution 134/2025 Art.25 | UAE FDL No.(10) of 2025
  // ════════════════════════════════════════════════════════════════════════════

  const RETENTION_CATEGORIES = [
    { cat:'CDD Files',                    period:10, basis:'UAE FDL No.(10) of 2025 | Minimum 10 years' },
    { cat:'Transaction Records',          period:10, basis:'UAE FDL No.(10) of 2025 | Minimum 10 years' },
    { cat:'STR / SAR Files',              period:10, basis:'UAE FDL No.(10) of 2025 | UAE FIU Guidance' },
    { cat:'Risk Assessment Records',      period:10, basis:'UAE FDL No.(10) of 2025 | Cabinet Resolution 134/2025 Art.25' },
    { cat:'Business Correspondence',      period:10, basis:'UAE FDL No.(10) of 2025 | Cabinet Resolution 134/2025 Art.25(3)' },
    { cat:'Training Records',             period:10, basis:'UAE FDL No.(10) of 2025' },
    { cat:'Internal Audit Reports',       period:10, basis:'UAE FDL No.(10) of 2025 | Cabinet Resolution 134/2025 Art.25' },
    { cat:'LBMA Supply Chain Files',      period:10, basis:'UAE FDL No.(10) of 2025 | LBMA RGG v9 Step 2 | OECD §5' },
    { cat:'UBO / Beneficial Ownership Records', period:10, basis:'UAE FDL No.(10) of 2025 | Cabinet Decision 109/2023 Art.38' },
    { cat:'goAML Submission Files',       period:10, basis:'UAE FDL No.(10) of 2025 | UAE FIU Guidance' },
    { cat:'Compliance Programme Documents', period:10, basis:'UAE FDL No.(10) of 2025' },
    { cat:'DPMSR / Threshold Reports',    period:10, basis:'UAE FDL No.(10) of 2025 | MoE Circular 08/AML/2021' },
  ];

  function renderRetention() {
    const el = document.getElementById('suite2-content-retention');
    if(!el) return;
    const records = load(SK2.RETAIN)||[];
    el.innerHTML = `
    <div class="card">
      <div class="top-bar">
        <span class="sec-title">🗄️ Record Retention Register</span>
        <span style="font-size:11px;color:var(--muted)">UAE FDL No.(10) of 2025 — Minimum 10 years | Records must enable transaction reconstruction</span>
        <button class="btn btn-sm btn-blue" style="padding:6px 12px;font-size:11px" data-action="suite2AddRetentionRecord">+ Add Record</button>
      </div>
      <div style="background:rgba(217,79,79,0.08);border:1px solid var(--red);border-radius:4px;padding:12px;margin-bottom:1rem;font-size:12px;color:var(--red)">
        <strong style="color:var(--red)">UAE FDL No.(10) of 2025 — 10 Year Minimum:</strong> <span style="color:var(--text)">All records must be retained for a minimum of 10 years. Records must be organized so individual transactions can be reconstructed and provided promptly to competent authorities upon request. This applies to all CDD, transaction, STR, risk assessment, training, audit, and correspondence records.</span>
      </div>
      <div class="sec-title" style="margin-bottom:10px">Statutory Retention Schedule</div>
      <div style="overflow-x:auto;margin-bottom:1.5rem">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="border-bottom:1px solid var(--border)">
            ${['Record Category','Retention Period','Regulatory Basis'].map(h=>`<th style="text-align:left;padding:8px;color:var(--muted);font-family:'Montserrat',sans-serif;font-size:11px">${h}</th>`).join('')}
          </tr></thead>
          <tbody>
            ${RETENTION_CATEGORIES.map(r=>`<tr style="border-bottom:1px solid var(--border)">
              <td style="padding:8px;font-weight:500">${r.cat}</td>
              <td style="padding:8px;color:var(--gold);font-family:'Montserrat',sans-serif">${r.period} years</td>
              <td style="padding:8px;font-size:11px;color:var(--muted)">${esc(r.basis)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="sec-title" style="margin-bottom:10px">Record Inventory</div>
      ${records.length===0?'<p style="color:var(--muted);font-size:13px;text-align:center;padding:1rem">No records logged.</p>':''}
      ${records.map((r,i)=>{
        const expiry = parseDDMMYYYY(r.createdDate) || new Date(r.createdDate);
        expiry.setFullYear(expiry.getFullYear()+r.retentionYears);
        const daysLeft = Math.floor((expiry-new Date())/86400000);
        const status = daysLeft<0?'Overdue':daysLeft<90?'Due Soon':'Current';
        return `<div class="finding ${status==='Overdue'?'f-critical':status==='Due Soon'?'f-high':'f-ok'}" style="margin-bottom:8px">
          <div class="f-head">
            <div class="f-head-left"><div>
              <div class="f-title">${esc(r.recordName)} ${badge2(status)}</div>
              <div class="f-body">Category: ${esc(r.category)} | Created: ${esc(fmtDate(r.createdDate))} | Expires: ${esc(fmtDate(expiry.toISOString()))}</div>
              <div class="f-ref">${esc(r.basis)} | Storage: ${esc(r.storageLocation)}</div>
            </div></div>
            <button class="btn btn-sm btn-red" data-action="suite2DeleteRetention" data-arg="${i}">Archive</button>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="modal-overlay" id="retentionModal">
      <div class="modal" style="max-width:500px;width:95%">
        <button class="modal-close" data-action="_closeModal" data-arg="retentionModal">✕</button>
        <div class="modal-title">Add Retention Record</div>
        <div><span class="lbl">Record Name / Description *</span><input id="ret-name" placeholder="e.g. Customer CDD file — Al Futtaim Trading"/></div>
        <div><span class="lbl">Category *</span>
          <select id="ret-cat" onchange="suite2AutoFillRetention()">
            <option value="">Select</option>${RETENTION_CATEGORIES.map(c=>`<option>${c.cat}</option>`).join('')}
          </select>
        </div>
        <div class="row row-2">
          <div><span class="lbl">Record Created Date</span><input type="text" id="ret-date" value="${today()}" placeholder="dd/mm/yyyy" oninput="csFormatDateInput(this)" maxlength="10"/></div>
          <div><span class="lbl">Retention Period (years, min 10 — FDL Art.24)</span><input type="number" id="ret-years" value="10" min="10"/></div>
        </div>
        <div><span class="lbl">Regulatory Basis</span><input id="ret-basis" placeholder="Auto-filled from category"/></div>
        <div><span class="lbl">Storage Location</span><input id="ret-storage" placeholder="e.g. Google Drive /Compliance/CDD/ | Physical: Filing cabinet A3"/></div>
        <div style="display:flex;gap:8px;margin-top:1rem">
          <button class="btn btn-gold" data-action="suite2SaveRetention" style="flex:1">Save Record</button>
          <button class="btn btn-sm" data-action="_closeModal" data-arg="retentionModal" style="padding:12px 20px">Cancel</button>
        </div>
      </div>
    </div>`;
  }

  global.suite2AutoFillRetention = function() {
    const cat = document.getElementById('ret-cat').value;
    const entry = RETENTION_CATEGORIES.find(c=>c.cat===cat);
    if(entry) {
      document.getElementById('ret-years').value=entry.period;
      document.getElementById('ret-basis').value=entry.basis;
    }
  };

  global.suite2AddRetentionRecord = function() {
    ['ret-name','ret-basis','ret-storage'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
    document.getElementById('ret-cat').value='';
    document.getElementById('ret-date').value=today();
    document.getElementById('ret-years').value='10';
    document.getElementById('retentionModal').classList.add('open');
  };

  global.suite2SaveRetention = function() {
    const name=document.getElementById('ret-name').value.trim();
    if(!name){toast('Record name required','error');return;}
    var years = parseInt(document.getElementById('ret-years').value, 10);
    if (!Number.isFinite(years) || years < THRESHOLDS.RETENTION_YEARS) {
      toast('Retention period must be at least ' + THRESHOLDS.RETENTION_YEARS + ' years (FDL Art.24).', 'error');
      return;
    }
    const records=load(SK2.RETAIN)||[];
    records.unshift({
      id:`RET-${Date.now()}`, recordName:name,
      category:document.getElementById('ret-cat').value,
      createdDate:document.getElementById('ret-date').value,
      retentionYears:years,
      basis:document.getElementById('ret-basis').value,
      storageLocation:document.getElementById('ret-storage').value,
      createdAt: new Date().toISOString(),
    });
    save(SK2.RETAIN,records);
    document.getElementById('retentionModal').classList.remove('open');
    toast('Retention record saved','success');
    renderRetention();
  };

  global.suite2DeleteRetention = function(idx) {
    // FDL Art.24-25 prohibits destruction of retained records before the
    // statutory retention period expires. Replace destructive delete with
    // an `archivedAt` soft-archive that preserves the full record.
    const records=load(SK2.RETAIN)||[];
    const r = records[idx];
    if (!r) return;
    const created = parseDDMMYYYY(r.createdDate) || new Date(r.createdDate || 0);
    const expiry = new Date(created.getTime());
    expiry.setFullYear(expiry.getFullYear() + (r.retentionYears || THRESHOLDS.RETENTION_YEARS));
    if (expiry.getTime() > Date.now()) {
      toast('Cannot delete before ' + fmtDateDDMMYYYY(expiry) + ' (FDL Art.24). Archive instead.', 'error');
    }
    if(!confirm('Archive this retention record? It stays in the inventory with archivedAt timestamp until the retention period expires.'))return;
    r.archivedAt = new Date().toISOString();
    r.archivedBy = (typeof AuthRBAC !== 'undefined' && AuthRBAC.getCurrentUser && AuthRBAC.getCurrentUser()?.username) || 'unknown';
    records[idx] = r;
    save(SK2.RETAIN,records);
    if (typeof logAudit === 'function') logAudit('retention', 'Archived retention record ' + r.id + ' (' + r.recordName + ')');
    renderRetention();
  };

  // ════════════════════════════════════════════════════════════════════════════
  // AI GOVERNANCE — MANDATORY HUMAN REVIEW
  // Reg: Cabinet Resolution 134/2025 Art.24 | PDPL — Human review of automated processing
  // ════════════════════════════════════════════════════════════════════════════

  function renderAILog() {
    const el=document.getElementById('suite2-content-ailog');
    if(!el) return;
    const logs=load(SK2.AILOG)||[];
    el.innerHTML = `
    <div class="card">
      <div class="top-bar">
        <span class="sec-title">🤖 AI Output Governance — Human Review Log</span>
        <span style="font-size:11px;color:var(--muted)">Cabinet Resolution 134/2025 Art.24 | PDPL — Human review of automated processing decisions</span>
        <button class="btn btn-sm btn-blue" style="padding:6px 12px;font-size:11px" data-action="suite2LogAIReview">+ Log AI Review</button>
      </div>
      <div style="background:rgba(74,143,193,0.1);border:1px solid rgba(74,143,193,0.3);border-radius:4px;padding:12px;margin-bottom:1rem;font-size:12px">
        <strong>Governance Requirement (Art.24):</strong> All AI-generated compliance outputs — gap assessments, risk scores, STR drafts, screening results, recommendations — must be reviewed and signed off by a qualified human compliance professional before any action is taken. AI outputs are advisory only and cannot constitute regulatory decisions without human review and approval.
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:1rem">
        <div class="metric m-ok"><div class="metric-num">${logs.filter(l=>l.decision==='Approved – Action Taken').length}</div><div class="metric-lbl">Approved</div></div>
        <div class="metric m-h"><div class="metric-num">${logs.filter(l=>l.decision==='Modified Before Action').length}</div><div class="metric-lbl">Modified</div></div>
        <div class="metric m-c"><div class="metric-num">${logs.filter(l=>l.decision==='Rejected – No Action').length}</div><div class="metric-lbl">Rejected</div></div>
      </div>
      ${logs.length===0?'<p style="color:var(--muted);font-size:13px;text-align:center;padding:1rem">No AI review logs. Every AI-generated compliance output must be logged here before action is taken.</p>':''}
      ${logs.map((l,i)=>`
        <div class="finding ${l.decision==='Rejected – No Action'?'f-critical':l.decision==='Approved – Action Taken'?'f-ok':'f-high'}" style="margin-bottom:8px">
          <div class="f-head">
            <div class="f-head-left"><div>
              <div class="f-title">${esc(l.aiTask)} ${badge2(l.decision)}</div>
              <div class="f-body">Reviewed by: ${esc(l.reviewer)} | Date: ${fmtDate(l.reviewDate)}</div>
              <div class="f-ref">Ref: ${l.id} | ${esc(l.notes)}</div>
            </div></div>
            <button class="btn btn-sm btn-red" data-action="suite2DeleteAILog" data-arg="${i}">Delete</button>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="modal-overlay" id="ailogModal">
      <div class="modal" style="max-width:520px;width:95%">
        <button class="modal-close" data-action="_closeModal" data-arg="ailogModal">✕</button>
        <div class="modal-title">Log AI Output Review</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:1rem">Cabinet Resolution 134/2025 Art.24 — All AI outputs require human sign-off before action</div>
        <div><span class="lbl">AI Task / Output Type *</span>
          <select id="ailog-task"><option value="">Select</option>
            <option>Gap Assessment</option><option>Customer Risk Score</option><option>STR Draft</option>
            <option>Screening Result Analysis</option><option>Regulatory Analysis</option>
            <option>Transaction Red Flag Analysis</option><option>Supply Chain Assessment</option>
            <option>EDD Recommendation</option><option>Other AI Output</option>
          </select>
        </div>
        <div><span class="lbl">AI Output Summary *</span><textarea id="ailog-output" style="min-height:80px" placeholder="Summarize what the AI output contained/recommended..."></textarea></div>
        <div class="row row-2">
          <div><span class="lbl">Reviewed By *</span><input id="ailog-reviewer" placeholder="Name and role of reviewer"/></div>
          <div><span class="lbl">Review Date</span><input type="text" id="ailog-date" value="${today()}" placeholder="dd/mm/yyyy" oninput="csFormatDateInput(this)" maxlength="10"/></div>
        </div>
        <div><span class="lbl">Human Review Decision *</span>
          <select id="ailog-decision"><option value="">Select</option>
            <option>Approved – Action Taken</option>
            <option>Modified Before Action</option>
            <option>Rejected – No Action</option>
            <option>Referred for Further Review</option>
          </select>
        </div>
        <div><span class="lbl">Reviewer Notes / Modifications Made</span><textarea id="ailog-notes" style="min-height:60px" placeholder="Note any modifications made to AI output, reasons for rejection, or additional context..."></textarea></div>
        <div style="display:flex;gap:8px;margin-top:1rem">
          <button class="btn btn-gold" data-action="suite2SaveAILog" style="flex:1">Save Review Log</button>
          <button class="btn btn-sm" data-action="_closeModal" data-arg="ailogModal" style="padding:12px 20px">Cancel</button>
        </div>
      </div>
    </div>`;
  }

  global.suite2LogAIReview = function() {
    ['ailog-output','ailog-reviewer','ailog-notes'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
    ['ailog-task','ailog-decision'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
    document.getElementById('ailog-date').value=today();
    document.getElementById('ailogModal').classList.add('open');
  };

  global.suite2SaveAILog = function() {
    const task=document.getElementById('ailog-task').value;
    const reviewer=document.getElementById('ailog-reviewer').value.trim();
    const decision=document.getElementById('ailog-decision').value;
    if(!task||!reviewer||!decision){toast('Task, reviewer, and decision are required','error');return;}
    const logs=load(SK2.AILOG)||[];
    logs.unshift({
      id:`AIL-${Date.now()}`, aiTask:task,
      output:document.getElementById('ailog-output').value,
      reviewer, reviewDate:document.getElementById('ailog-date').value,
      decision, notes:document.getElementById('ailog-notes').value,
    });
    save(SK2.AILOG,logs);
    document.getElementById('ailogModal').classList.remove('open');
    toast('AI review logged','success');
    renderAILog();
  };

  global.suite2DeleteAILog = function(idx) {
    if(!confirm('Delete this AI review log?'))return;
    const logs=load(SK2.AILOG)||[];
    logs.splice(idx,1);
    save(SK2.AILOG,logs);
    renderAILog();
  };

  // ─── INIT ────────────────────────────────────────────────────────────────────
  function initSuite2() {
    injectSuite2();
    // Clear old screening cache (removed — was causing false negatives)
    try { localStorage.removeItem('fgl_screening_cache'); } catch(_) {}
    // Auto-render TFS into embedded container (merged into Screening & TFS tab)
    setTimeout(function() { if (document.getElementById('tfs-embedded-content')) renderTFS2(); }, 600);
  }
  if (document.readyState==='loading') {
    document.addEventListener('DOMContentLoaded', initSuite2);
  } else {
    setTimeout(initSuite2, 400);
  }

})(window);

// ════════════════════════════════════════════════════════════════════════════
// ASANA SYNC — NEW MODULES (TFS UAE, DPMSR, AI Governance)
// ════════════════════════════════════════════════════════════════════════════

(function(global) {
  'use strict';

  function load(key) { try { return JSON.parse(localStorage.getItem(key)||'null'); } catch{return null;} }
  function save(key,val) { try { localStorage.setItem(key,JSON.stringify(val)); } catch(e){ console.warn('[Storage] Save failed for', key, e); } }
  function fmtDate(d) { if(!d) return '—'; return new Date(d).toLocaleDateString('en-GB'); }
  function toast(msg,type) { if(global.toast) global.toast(msg,type); }

  const SK2 = {
    TFS2:  'fgl_tfs2_v1',
    DPMSR: 'fgl_dpmsr_v1',
    AILOG: 'fgl_ailog_v1',
  };

  async function asanaPush(title, notes) {
    try {
      if (typeof asanaFetch !== 'function') return null;
      const resolver = typeof AsanaProjectResolver !== 'undefined' ? AsanaProjectResolver : null;
      const projectId = resolver ? resolver.resolveProject('compliance') : ((typeof ASANA_PROJECT !== 'undefined' && ASANA_PROJECT) ? ASANA_PROJECT : '1213759768596515');
      const resp = await asanaFetch('/tasks', {
        method: 'POST',
        body: JSON.stringify({ data: { name: title, notes, projects: [projectId] } })
      });
      const data = await resp.json();
      return data?.data?.gid || null;
    } catch(e) { console.warn('Asana push error:', e); return null; }
  }

  // TFS UAE → Asana
  global.suite2SyncTFS2ToAsana = async function(idx) {
    const events = load(SK2.TFS2)||[];
    const e = events[idx];
    if (!e) return;
    toast('Syncing to Asana...','info');
    const notes = [
      `TFS Event: ${e.id}`,
      `Screened: ${e.screenedName}`,
      `Outcome: ${e.outcome}`,
      `Lists Screened: ${e.listsScreened}`,
      `Event Type: ${e.eventType}`,
      `Date: ${fmtDate(e.screeningDate)}`,
      `Reviewed by: ${e.reviewedBy}`,
      e.outcome==='Confirmed Match' ? [
        `Frozen Within 24h: ${e.frozenWithin24h||'Pending'}`,
        `FFR Filed: ${e.ffrFiled||'Pending'} | Ref: ${e.ffrRef||'—'}`,
        `CNMR Status: ${e.cnmrStatus||'Pending'} | Deadline: ${fmtDate(e.cnmrDeadline)} | Ref: ${e.cnmrRef||'—'}`,
        `Supervisor Notified: ${e.supervisorNotified||'Pending'}`,
        `MLRO Notified: ${e.mlroNotified||'Pending'}`,
        `Senior Management Notified: ${e.mgmtNotified||'Pending'}`,
      ].join('\n') : '',
      e.outcome==='Partial Match' ? [
        `Transaction Suspended: ${e.txSuspended||'Pending'}`,
        `PNMR Status: ${e.pnmrStatus||'Pending'} | Deadline: ${fmtDate(e.pnmrDeadline)} | Ref: ${e.pnmrRef||'—'}`,
      ].join('\n') : '',
      e.outcome==='False Positive' ? `Differentiation Basis: ${e.fpBasis||'—'} | Evidence: ${e.fpEvidence||'—'}` : '',
      `\nNotes: ${e.notes||'—'}`,
      `\nRegulatory Basis: Cabinet Decision No.(74) of 2020 | EOCN TFS Guidance`,
    ].filter(Boolean).join('\n');

    const title = `[TFS-UAE] ${e.screenedName} — ${e.outcome}`;
    const gid = await asanaPush(title, notes);
    if (gid) { events[idx].asanaGid = gid; save(SK2.TFS2, events); toast('Synced to Asana','success'); }
    else toast('Asana sync failed — check token in Settings','error');
  };

  // DPMSR → Asana
  global.suite2SyncDPMSRToAsana = async function(idx) {
    const cases = load(SK2.DPMSR)||[];
    const c = cases[idx];
    if (!c) return;
    toast('Syncing to Asana...','info');
    const notes = [
      `DPMSR Case: ${c.id}`,
      `Customer: ${c.customerName}`,
      `Type: ${c.customerType}`,
      `Amount: AED ${Number(c.amount||0).toLocaleString()}`,
      `Payment Method: ${c.paymentMethod}`,
      `Transaction Date: ${fmtDate(c.txDate)}`,
      `ID Reference: ${c.idRef||'—'}`,
      `Reporting Required: ${c.reportingRequired||'—'}`,
      `DPMSR Filed: ${c.dpmsr_filed||'No'}`,
      `CDD Complete: ${c.cddComplete}`,
      `Linked Transaction: ${c.linkedFlag||'No'}`,
      c.linkedFlag==='Yes – Linked' ? `Linked Ref: ${c.linkedRef||'—'} | Cumulative: AED ${Number(c.cumulative||0).toLocaleString()}` : '',
      `Structuring Indicator: ${c.structuringIndicator||'No'}`,
      `Notes: ${c.notes||'—'}`,
      `\nRegulatory Basis: MoE Circular 08/AML/2021 | AED 55,000 Threshold | Cabinet Resolution 134/2025 Art.13`,
    ].filter(Boolean).join('\n');

    const title = `[DPMSR] ${c.customerName} — AED ${Number(c.amount||0).toLocaleString()} — ${c.reportingRequired||'Pending'}`;
    const gid = await asanaPush(title, notes);
    if (gid) { cases[idx].asanaGid = gid; save(SK2.DPMSR, cases); toast('Synced to Asana','success'); }
    else toast('Asana sync failed — check token in Settings','error');
  };

  // AI Log → Asana
  global.suite2SyncAILogToAsana = async function(idx) {
    const logs = load(SK2.AILOG)||[];
    const l = logs[idx];
    if (!l) return;
    toast('Syncing to Asana...','info');
    const notes = [
      `AI Review Log: ${l.id}`,
      `Task Type: ${esc(l.aiTask)}`,
      `Decision: ${l.decision}`,
      `Reviewed By: ${esc(l.reviewer)}`,
      `Review Date: ${fmtDate(l.reviewDate)}`,
      `AI Output Summary: ${l.output||'—'}`,
      `Reviewer Notes: ${l.notes||'—'}`,
      `\nRegulatory Basis: Cabinet Resolution 134/2025 Art.24 | PDPL — Human review of automated processing`,
    ].join('\n');

    const title = `[AI-GOV] ${esc(l.aiTask)} — ${l.decision}`;
    const gid = await asanaPush(title, notes);
    if (gid) toast('Synced to Asana','success');
    else toast('Asana sync failed','error');
  };

  // ── PATCH RENDER FUNCTIONS to add Asana buttons ───────────────────────────
  // We override the render functions after the DOM loads to inject Asana buttons

  function patchTFS2Render() {
    // Add Asana button to each TFS2 event card after render
    document.querySelectorAll('[id^="suite2-content-tfs2"] .finding').forEach((card, i) => {
      const btnContainer = card.querySelector('.f-head > div:last-child');
      if (btnContainer && !btnContainer.querySelector('.asana-sync-btn')) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-blue asana-sync-btn';
        btn.textContent = 'Asana';
        btn.onclick = () => suite2SyncTFS2ToAsana(i);
        btnContainer.insertBefore(btn, btnContainer.querySelector('.btn-red'));
      }
    });
  }

  function patchDPMSRRender() {
    document.querySelectorAll('[id^="suite2-content-dpmsr"] .finding').forEach((card, i) => {
      const btnContainer = card.querySelector('.f-head > div:last-child');
      if (btnContainer && !btnContainer.querySelector('.asana-sync-btn')) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-blue asana-sync-btn';
        btn.textContent = 'Asana';
        btn.onclick = () => suite2SyncDPMSRToAsana(i);
        btnContainer.insertBefore(btn, btnContainer.querySelector('.btn-red'));
      }
    });
  }

  function patchAILogRender() {
    document.querySelectorAll('[id^="suite2-content-ailog"] .finding').forEach((card, i) => {
      const btnContainer = card.querySelector('.f-head > div:last-child');
      if (btnContainer && !btnContainer.querySelector('.asana-sync-btn')) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-blue asana-sync-btn';
        btn.textContent = 'Asana';
        btn.onclick = () => suite2SyncAILogToAsana(i);
        btnContainer.insertBefore(btn, btnContainer.querySelector('.btn-red'));
      }
    });
  }

  // Patch after each render call
  const origRenderTFS2 = global.renderTFS2;
  if (origRenderTFS2) {
    global.renderTFS2 = function() {
      origRenderTFS2();
      setTimeout(patchTFS2Render, 100);
    };
  }

  // Expose patch functions globally so switchToSuite2Tab can call them
  global.suite2PatchAsana = { tfs2: patchTFS2Render, dpmsr: patchDPMSRRender, ailog: patchAILogRender };

})(window);

// ════════════════════════════════════════════════════════════════════════════
// MIGRATION PATCH — Fix {entity} placeholder in saved calendar/Asana tasks
// Runs once on load, replaces literal {entity} with active company name
// ════════════════════════════════════════════════════════════════════════════
(function() {
  async function fixAsanaEntityTasks() {
    try {
      if (typeof asanaFetch !== 'function') { if(typeof toast==='function') toast('Asana not connected — configure token in Settings','error'); return; }
      const resolver = typeof AsanaProjectResolver !== 'undefined' ? AsanaProjectResolver : null;
      const projectId = resolver ? resolver.resolveProject('workflow') : ((typeof ASANA_PROJECT !== 'undefined' && ASANA_PROJECT) ? ASANA_PROJECT : '1213759768596515');
      const companyName = (resolver ? resolver.resolveEntityName() : ((typeof getActiveCompany === 'function') ? (getActiveCompany().name || 'Hawkeye Sterling') : 'Hawkeye Sterling')).trim();

      if (typeof toast === 'function') toast('Scanning Asana for {entity} tasks...', 'info');

      // Fetch ALL tasks including completed
      const r = await asanaFetch('/projects/' + projectId + '/tasks?opt_fields=name,gid,completed&limit=100');
      const d = await r.json();
      if (d.errors) throw new Error(d.errors[0]?.message || 'Asana error');

      const entityTasks = (d.data || []).filter(t => t.name && t.name.includes('{entity}'));
      if (!entityTasks.length) {
        if (typeof toast === 'function') toast('No {entity} tasks found — Asana is clean!', 'success');
        return;
      }

      // Identify duplicates: same template name appearing more than once
      const nameGroups = {};
      entityTasks.forEach(t => {
        const baseName = t.name.replace(/\{entity\}/g, '').trim();
        if (!nameGroups[baseName]) nameGroups[baseName] = [];
        nameGroups[baseName].push(t);
      });

      let deleted = 0;
      let renamed = 0;

      for (const [baseName, tasks] of Object.entries(nameGroups)) {
        // Keep the first one (rename it), delete all duplicates
        const toRename = tasks[0];
        const toDel = tasks.slice(1);

        // Rename the first one
        const newName = toRename.name.replace(/\{entity\}/g, companyName);
        await asanaFetch('/tasks/' + toRename.gid, {
          method: 'PUT',
          body: JSON.stringify({ data: { name: newName } })
        });
        renamed++;

        // Delete duplicates
        for (const dt of toDel) {
          await asanaFetch('/tasks/' + dt.gid, { method: 'DELETE' });
          deleted++;
        }
      }

      const msg = 'Fixed Asana: ' + renamed + ' renamed, ' + deleted + ' duplicates deleted';
      if (typeof toast === 'function') toast(msg, 'success');
      console.log('[EntityFix]', msg);

      // Reload tasks view if visible
      if (typeof loadAsanaTasks === 'function') setTimeout(loadAsanaTasks, 1000);

    } catch(e) {
      console.warn('[EntityFix] Error:', e);
      if (typeof toast === 'function') toast('Fix failed: ' + e.message, 'error');
    }
  }
  window.fixAsanaEntityTasks = fixAsanaEntityTasks;

  function fixEntityPlaceholders() {
    try {
      const activeComp = (typeof getActiveCompany === 'function') ? getActiveCompany() : {};
      const companyName = activeComp.name || 'Hawkeye Sterling';
      if (!companyName) return;

      // Fix CALENDAR_STORAGE deadlines
      const calKey = (typeof CALENDAR_STORAGE !== 'undefined') ? CALENDAR_STORAGE : 'fgl_calendar_v2';
      const calEntries = JSON.parse(localStorage.getItem(calKey) || '[]');
      let calFixed = 0;
      calEntries.forEach(entry => {
        if (entry.title && entry.title.includes('{entity}')) {
          entry.title = entry.title.replace(/\{entity\}/g, companyName);
          calFixed++;
        }
        if (entry.notes && entry.notes.includes('{entity}')) {
          entry.notes = entry.notes.replace(/\{entity\}/g, companyName);
        }
      });
      if (calFixed > 0) {
        localStorage.setItem(calKey, JSON.stringify(calEntries));
        console.log(`[Migration] Fixed ${calFixed} calendar entries with {entity} placeholder`);
      }

      // Also check all known storage keys for {entity}
      const keysToCheck = [
        'fgl_calendar_v2', 'fgl_calendar', 'fgl_gaps_v2', 'fgl_evidence',
        'fgl_asana_sync', 'fgl_workflow_log'
      ];
      keysToCheck.forEach(key => {
        const raw = localStorage.getItem(key);
        if (raw && raw.includes('{entity}')) {
          localStorage.setItem(key, raw.replace(/\{entity\}/g, companyName));
          console.log(`[Migration] Fixed {entity} in ${key}`);
        }
      });

    } catch(e) {
      console.warn('[Migration] Entity fix error:', e);
    }
  }

  // Run after app initializes so getActiveCompany() is available
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(fixEntityPlaceholders, 1500));
  } else {
    setTimeout(fixEntityPlaceholders, 1500);
  }
})();

// ════════════════════════════════════════════════════════════════════════════
// TFS DATA MIGRATION — Migrate old SK.TFS records into SK2.TFS2 format
// Runs once on load — preserves all historical screening data
// ════════════════════════════════════════════════════════════════════════════
(function() {
  'use strict';

  function migrateTFSRecords() {
    try {
      const OLD_KEY = 'fgl_tfs_events_v2';
      const NEW_KEY = 'fgl_tfs2_v1';
      const MIGRATED_KEY = 'fgl_tfs_migrated';

      if (localStorage.getItem(MIGRATED_KEY)) return; // Already done

      const oldRecords = JSON.parse(localStorage.getItem(OLD_KEY) || '[]');
      if (!oldRecords.length) { localStorage.setItem(MIGRATED_KEY, '1'); return; }

      const newRecords = JSON.parse(localStorage.getItem(NEW_KEY) || '[]');

      // Convert old format to new TFS2 format
      const converted = oldRecords.map(r => ({
        id: r.id || ('TFS2-MIGRATED-' + uid('')),
        screenedName: r.screenedName || '—',
        eventType: r.eventType || 'Ad Hoc Review',
        listsScreened: r.listName || 'Migrated from TFS Ops',
        screeningDate: r.screeningDate || new Date().toISOString().slice(0,10),
        reviewedBy: r.reviewedBy || '—',
        outcome: r.disposition === 'True Hit' ? 'Confirmed Match'
                : r.disposition === 'False Positive' ? 'False Positive'
                : r.disposition === 'Potential Match – Pending' ? 'Partial Match'
                : 'Negative – No Match',
        notes: r.notes || '',
        frozenWithin24h: r.frozenStatus || null,
        freezeDateTime: r.freezeDate || null,
        ffrFiled: r.ffrFiled || null,
        ffrRef: null,
        cnmrStatus: r.disposition === 'True Hit' ? 'Pending' : null,
        cnmrDeadline: null,
        pnmrStatus: r.disposition === 'Potential Match – Pending' ? 'Pending' : null,
        eocnNotified: r.eocnNotified || null,
        supervisorNotified: null,
        mlroNotified: null,
        mgmtNotified: null,
        migratedFrom: 'TFS Ops',
        updatedAt: r.updatedAt || new Date().toISOString(),
      }));

      // Merge — avoid duplicates by ID
      const existingIds = new Set(newRecords.map(r => r.id));
      const toAdd = converted.filter(r => !existingIds.has(r.id));

      if (toAdd.length > 0) {
        const merged = [...toAdd, ...newRecords];
        localStorage.setItem(NEW_KEY, JSON.stringify(merged));
        console.log('[TFS Migration] Migrated ' + toAdd.length + ' TFS records to unified TFS module');
        if (typeof toast === 'function') toast('TFS records migrated to unified TFS module', 'success');
      }

      localStorage.setItem(MIGRATED_KEY, '1');
    } catch(e) {
      console.warn('[TFS Migration] Error:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(migrateTFSRecords, 2000));
  } else {
    setTimeout(migrateTFSRecords, 2000);
  }
})();


// ════════════════════════════════════════════════════════════════════════════
// DATA MANAGER — Backup, Restore, Excel/CSV Export, PDF Report, Import
// All exports in formats regulators and compliance professionals can use
// ════════════════════════════════════════════════════════════════════════════
(function(global) {
  'use strict';

  const ALL_MODULES = [
    { key:'fgl_cra_v2',            label:'Customer Risk Assessments',   icon: '📋', cols:['id','customerName','customerType','rating','cddLevel','reviewDate','reviewedBy','notes'] },
    { key:'fgl_ubo_v2',            label:'UBO Register',                icon: '🏛️', cols:['id','entityName','uboName','nationality','dob','ownershipPct','verifiedDate','idType','idNumber','pepStatus','notes'] },
    { key:'fgl_str_cases_v2',      label:'STR / SAR Cases',             icon: '🚨', cols:['id','reportType','subjectName','subjectType','transactionRef','amount','currency','suspicionDate','status','filedBy','goamlRef','notes'] },
    { key:'fgl_tfs2_v1',           label:'TFS Screening Events',        icon:'🇦🇪', cols:['id','screenedName','eventType','listsScreened','screeningDate','outcome','reviewedBy','frozenWithin24h','ffrFiled','cnmrStatus','cnmrRef','notes'] },
    { key:'fgl_approvals_v2',      label:'Four-Eyes Approvals',         icon: '', cols:['id','approvalType','subject','requestedBy','status','decision','decidedBy','createdAt','notes'] },
    { key:'fgl_mgmt_approvals',    label:'Management CDD Approvals',    icon: '', cols:['id','customerName','customerType','riskRating','status','reviewedBy','createdAt','notes'] },
    { key:'fgl_dpmsr_v1',          label:'DPMSR Threshold Cases',       icon: '', cols:['id','customerName','customerType','amount','txDate','paymentMethod','reportingRequired','dpmsr_filed','cddComplete','linkedFlag','notes'] },
    { key:'fgl_retention_v1',      label:'Record Retention Register',   icon: '', cols:['id','recordName','category','createdDate','retentionYears','basis','storageLocation'] },
    { key:'fgl_ailog_v1',          label:'AI Governance Log',           icon: '', cols:['id','aiTask','reviewer','reviewDate','decision','output','notes'] },
    { key:'fgl_shipments',         label:'IAR Shipments',               icon: '', cols:['id','shipmentRef','supplier','origin','weight','purity','invoiceValue','currency','screeningStatus','cddStatus','date'] },
    { key:'fgl_local_shipments',   label:'Local Shipments',             icon: '', cols:['id','shipmentRef','customer','weight','purity','value','date','status'] },
    { key:'fgl_onboarding',        label:'Customer Onboarding',         icon: '', cols:['id','customerName','customerType','nationality','riskRating','status','createdAt'] },
    { key:'fgl_risk_assessments',  label:'Risk Assessments',            icon: '', cols:['id','entityName','totalScore','determination','assessDate','assessedBy'] },
    { key:'fgl_incidents',         label:'Incidents',                   icon: '', cols:['id','title','type','severity','status','reportedBy','reportedAt','resolution'] },
    { key:'fgl_employee_info',     label:'Employees',                   icon: '', cols:['id','name','role','department','email','joinDate','trainingStatus'] },
    { key:'fgl_employee_training', label:'Training Records',            icon: '', cols:['id','employeeName','course','completedDate','score','status'] },
    { key:'fgl_gaps_v2',           label:'Gap Register',                icon: '', cols:['id','title','severity','status','owner','targetDate','regulatoryRef'] },
    { key:'fgl_evidence',          label:'Evidence Tracker',            icon: '', cols:['id','title','category','status','linkedTo','uploadedAt'] },
    { key:'fgl_calendar',          label:'Compliance Calendar',         icon: '', cols:['id','title','date','category','completed','notes'] },
    { key:'fgl_iar_reports',       label:'IAR Reports',                 icon: '', cols:['id','reportRef','createdAt','status'] },
    { key:'fgl_company_profiles',  label:'Company Profiles',            icon: '', cols:['id','name','activity','location'] },
  ];

  function getSize(key) {
    try {
      const v = localStorage.getItem(key);
      if (!v) return null;
      const parsed = JSON.parse(v);
      const count = Array.isArray(parsed) ? parsed.length : typeof parsed === 'object' ? Object.keys(parsed).length : 1;
      const kb = (v.length / 1024).toFixed(1);
      return { count, kb, raw: v };
    } catch { return null; }
  }

  function fmtDate(d) { try { return new Date(d).toLocaleDateString('en-GB'); } catch { return d||'—'; } }
  function esc(s) { if (!s && s!==0) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

  // ── INJECT TAB ────────────────────────────────────────────────────────────
  function injectDataTab() {
    const nav = document.getElementById('tabsNav');
    if (!nav || document.getElementById('data-mgr-tab')) return;
    const btn = document.createElement('div');
    btn.className = 'tab'; btn.id = 'data-mgr-tab';
    btn.innerHTML = '💾 Data'; btn.title = 'Data Manager — Backup, Export, Import';
    btn.onclick = () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      const el = document.getElementById('data-mgr-content');
      if (el) { el.classList.add('active'); renderDataManager(); }
    };
    nav.appendChild(btn);
    const content = document.createElement('div');
    content.className = 'tab-content'; content.id = 'data-mgr-content';
    (document.querySelector('.app') || document.body).appendChild(content);
  }

  // ── RENDER ────────────────────────────────────────────────────────────────
  function renderDataManager() {
    const el = document.getElementById('data-mgr-content');
    if (!el) return;
    let totalRecords = 0, totalKb = 0;
    const moduleStats = ALL_MODULES.map(m => {
      const s = getSize(m.key);
      if (s) { totalRecords += s.count; totalKb += parseFloat(s.kb); }
      return { ...m, ...(s || { count:0, kb:'0.0', raw:null }) };
    });

    el.innerHTML = `
    <div class="card" style="margin-bottom:1rem">
      <div class="top-bar">
        <span class="sec-title">💾 Data Manager</span>
        <span style="font-size:11px;color:var(--muted)">${moduleStats.filter(m=>m.raw).length} active modules | ${totalRecords} records | ${totalKb.toFixed(1)} KB</span>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:1rem;flex-wrap:wrap">
        <button class="btn btn-sm btn-blue" style="padding:8px 14px;font-size:11px" data-action="dmExportAll">Backup</button>
        <button class="btn btn-sm btn-blue" style="padding:8px 14px;font-size:11px" onclick="document.getElementById('dm-import-file').click()">Restore</button>
        <button class="btn btn-sm btn-blue" style="padding:8px 14px;font-size:11px" data-action="dmExportSummaryReport">Summary</button>
        <button class="btn btn-sm btn-gold" style="padding:8px 14px;font-size:11px" data-action="dmDownloadAuditPack" title="Signed audit bundle for MoE / EOCN / LBMA inspectors (last 30 days)">📦 Audit Pack</button>
      </div>
      <input type="file" id="dm-import-file" accept=".json,.xlsx" style="display:none" onchange="dmImportBackup(this)"/>

      <div style="background:rgba(61,168,118,0.08);border:1px solid rgba(61,168,118,0.3);border-radius:4px;padding:12px;margin-bottom:1.5rem;font-size:12px">
        <strong style="color:var(--green)">✅ Ready to use.</strong>
        All data is in your browser. <strong>Download Full Backup daily</strong> — it opens directly in Excel, one tab per module. Save to your Google Drive compliance folder. This is your audit evidence file.
        <span style="color:var(--muted);display:block;margin-top:4px">${localStorage.getItem('fgl_last_backup') ? '🕐 Last backup: ' + fmtDate(localStorage.getItem('fgl_last_backup')) : '⚠️ No backup yet — click Full Backup now.'}</span>
      </div>

      <div class="sec-title" style="margin-bottom:10px">Modules</div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="border-bottom:2px solid var(--gold)">
            ${['','Module','Records','Size','Export'].map(h=>`<th style="text-align:left;padding:8px 10px;color:var(--gold);font-family:'Montserrat',sans-serif;font-size:10px;white-space:nowrap">${h}</th>`).join('')}
          </tr></thead>
          <tbody>
            ${moduleStats.map(m => {
              const has = !!m.raw;
              return `<tr style="border-bottom:1px solid var(--border);opacity:${has?1:0.45}">
                <td style="padding:8px 10px;font-size:15px">${m.icon}</td>
                <td style="padding:8px 10px;font-weight:${has?600:400}">${m.label}</td>
                <td style="padding:8px 10px;font-family:'Montserrat',sans-serif;color:${has?'var(--gold)':'var(--muted)'}">${has?m.count:'—'}</td>
                <td style="padding:8px 10px;font-family:'Montserrat',sans-serif;color:var(--muted)">${has?m.kb+' KB':'—'}</td>
                <td style="padding:8px 10px">
                  ${has ? `<div style="display:flex;gap:4px">
                    <button class="btn btn-sm" onclick="dmExportModuleExcel('${m.key}','${m.label}')" style="padding:3px 10px;font-size:10px">Excel</button>
                    <button class="btn btn-sm" onclick="dmExportModuleCSV('${m.key}','${m.label}')" style="padding:3px 10px;font-size:10px">CSV</button>
                    <button class="btn btn-sm btn-red" onclick="dmClearModule('${m.key}','${m.label}')" style="padding:3px 10px;font-size:10px">Clear</button>
                  </div>` : '—'}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  // ── CSV BUILDER (shared) ──────────────────────────────────────────────────
  function buildCSV(arr, preferredCols) {
    if (!arr.length) return '';
    const allKeys = [...new Set(arr.flatMap(r => Object.keys(r)))];
    const headers = preferredCols ? [...preferredCols.filter(c => allKeys.includes(c)), ...allKeys.filter(c => !preferredCols.includes(c))] : allKeys;
    const esc = v => {
      if (v === null || v === undefined) return '';
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g,'""')}"` : s;
    };
    return [headers.join(','), ...arr.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
  }

  // ── FULL BACKUP → EXCEL-LIKE HTML (opens in Excel) ───────────────────────
  global.dmExportAll = function() {
    const entity = (typeof getActiveCompany === 'function' ? getActiveCompany().name : 'Hawkeye Sterling');
    const ts = new Date().toISOString().slice(0,10);
    let sheetsHTML = '';
    let tocRows = '';
    let totalExported = 0;

    ALL_MODULES.forEach(m => {
      const raw = localStorage.getItem(m.key);
      if (!raw) return;
      try {
        const data = JSON.parse(raw);
        const arr = Array.isArray(data) ? data : typeof data === 'object' ? [data] : [];
        if (!arr.length) return;

        const allKeys = [...new Set(arr.flatMap(r => Object.keys(r)))];
        const headers = m.cols ? [...m.cols.filter(c => allKeys.includes(c)), ...allKeys.filter(c => !m.cols.includes(c))] : allKeys;

        const headerRow = headers.map(h => `<th style="background:#1a1a2e;color:#d4a017;border:1px solid #333;padding:6px 10px;font-size:11px;white-space:nowrap">${h}</th>`).join('');
        const dataRows = arr.map(r =>
          '<tr>' + headers.map(h => {
            let v = r[h];
            if (v === null || v === undefined) v = '';
            else if (typeof v === 'object') v = JSON.stringify(v);
            return `<td style="border:1px solid #333;padding:5px 10px;font-size:11px;max-width:300px">${esc(String(v))}</td>`;
          }).join('') + '</tr>'
        ).join('');

        tocRows += `<tr><td style="padding:4px 10px;font-size:12px">${m.icon} ${m.label}</td><td style="padding:4px 10px;font-size:12px;color:#d4a017">${arr.length}</td></tr>`;

        sheetsHTML += `
          <div style="margin-bottom:2rem;page-break-inside:avoid">
            <h3 style="color:#d4a017;font-family:Arial,sans-serif;margin-bottom:8px;font-size:13px">${m.icon} ${m.label} (${arr.length} records)</h3>
            <div style="overflow-x:auto">
              <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif">
                <thead><tr>${headerRow}</tr></thead>
                <tbody>${dataRows}</tbody>
              </table>
            </div>
          </div>`;
        totalExported++;
      } catch(e) { console.warn(e); }
    });

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Hawkeye Sterling — Compliance Data Export ${ts}</title>
<style>
  body { font-family: Arial, sans-serif; background: #0d0d1a; color: #e0e0e0; padding: 20px; }
  h1 { color: #d4a017; } h2 { color: #d4a017; border-bottom: 2px solid #d4a017; padding-bottom: 6px; }
  @media print { body { background: white; color: black; } th { background: #1a1a2e !important; } }
</style>
</head><body>
<h1>🏛️ ${esc(entity)} — Compliance Data Export</h1>
<p style="color:#aaa;font-size:12px">Generated: ${new Date().toLocaleString('en-GB')} | Modules: ${totalExported} | Tool: Hawkeye Sterling V2 v2.1</p>
<h2>Table of Contents</h2>
<table style="border-collapse:collapse;margin-bottom:2rem"><tbody>${tocRows}</tbody></table>
<h2>Module Data</h2>
${sheetsHTML}
</body></html>`;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FinGold-Compliance-Backup-${ts}.xls`;
    a.click();
    URL.revokeObjectURL(url);
    localStorage.setItem('fgl_last_backup', new Date().toISOString());
    if (typeof toast === 'function') toast(`✅ Excel backup downloaded — ${totalExported} modules`, 'success');
    renderDataManager();
  };

  // ── AUDIT PACK DOWNLOAD ───────────────────────────────────────────────────
  // Pulls the signed JSON bundle from /api/audit-pack and downloads it
  // as a single file. The file contains 30 days of brain events,
  // chain anchors, sanctions deltas, FX snapshots, and drift reports
  // — everything an MoE / EOCN / LBMA inspector needs to reconstruct
  // the compliance trail. HMAC-signed with HAWKEYE_AUDIT_HMAC_KEY.
  global.dmDownloadAuditPack = async function() {
    if (typeof toast === 'function') toast('Building signed audit pack...', 'info');
    var token = null;
    try { token = localStorage.getItem('auth.token'); } catch (_) { /* ignore */ }
    if (!token) {
      if (typeof toast === 'function') toast('Sign in required to fetch the audit pack.', 'error');
      return;
    }
    var tenantId = (typeof global.cs2TenantId === 'function' ? global.cs2TenantId() : 'default');
    var to = new Date();
    var from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    var qs = 'tenantId=' + encodeURIComponent(tenantId)
      + '&from=' + from.toISOString().slice(0, 10)
      + '&to=' + to.toISOString().slice(0, 10);
    try {
      var res = await fetch('/api/audit-pack?' + qs, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      });
      if (!res.ok) {
        var msg = 'HTTP ' + res.status;
        try { var body = await res.json(); if (body && body.error) msg = body.error; } catch (_) {}
        if (typeof toast === 'function') toast('Audit pack failed: ' + msg, 'error');
        return;
      }
      var pack = await res.json();
      var blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'audit-pack-' + tenantId + '-' + to.toISOString().slice(0,10) + '.json';
      a.click();
      URL.revokeObjectURL(url);
      if (typeof logAudit === 'function') logAudit('audit-pack', 'Downloaded ' + a.download);
      if (typeof toast === 'function') toast('✅ Audit pack downloaded' + (pack.manifest && pack.manifest.signature ? ' (HMAC-signed)' : ' (unsigned — set HAWKEYE_AUDIT_HMAC_KEY)'), 'success', 6000);

      // Best-effort: also dispatch an `audit_finding_logged` event to
      // /api/asana/dispatch so the audit pack lands as a parent task
      // in the Asana "Audit Findings" project. Failure here does not
      // unwind the local download — the pack is already on the
      // operator's disk.
      try {
        await fetch('/api/asana/dispatch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token,
          },
          keepalive: true,
          body: JSON.stringify({
            kind: 'audit_finding_logged',
            tenantId: tenantId,
            occurredAtIso: new Date().toISOString(),
            refId: 'audit-pack-' + tenantId + '-' + to.toISOString().slice(0,10),
            payload: {
              filename: a.download,
              counts: pack.manifest && pack.manifest.counts ? pack.manifest.counts : null,
              signed: !!(pack.manifest && pack.manifest.signature),
            },
          }),
        });
      } catch (_asanaErr) { /* best-effort */ }
    } catch (err) {
      if (typeof toast === 'function') toast('Audit pack network error: ' + err.message, 'error');
    }
  };

  // ── EXPORT SINGLE MODULE → EXCEL ─────────────────────────────────────────
  global.dmExportModuleExcel = function(key, label) {
    const raw = localStorage.getItem(key);
    if (!raw) { if (typeof toast === 'function') toast('No data in this module', 'error'); return; }
    try {
      const data = JSON.parse(raw);
      const arr = Array.isArray(data) ? data : typeof data === 'object' ? [data] : [];
      if (!arr.length) { if (typeof toast === 'function') toast('No records to export', 'error'); return; }
      const mod = ALL_MODULES.find(m => m.key === key);
      const allKeys = [...new Set(arr.flatMap(r => Object.keys(r)))];
      const headers = mod?.cols ? [...mod.cols.filter(c => allKeys.includes(c)), ...allKeys.filter(c => !mod.cols.includes(c))] : allKeys;
      const headerRow = headers.map(h => `<th style="background:#1a1a2e;color:#d4a017;border:1px solid #333;padding:6px 10px;font-size:11px">${h}</th>`).join('');
      const dataRows = arr.map(r => '<tr>' + headers.map(h => {
        let v = r[h]; if (v===null||v===undefined) v=''; else if (typeof v==='object') v=JSON.stringify(v);
        return `<td style="border:1px solid #333;padding:5px 10px;font-size:11px">${esc(String(v))}</td>`;
      }).join('') + '</tr>').join('');
      const ts = new Date().toISOString().slice(0,10);
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${label} ${ts}</title></head><body>
        <h2 style="font-family:Arial;color:#1a1a2e">${label} — ${arr.length} records — ${ts}</h2>
        <table style="border-collapse:collapse;font-family:Arial"><thead><tr>${headerRow}</tr></thead><tbody>${dataRows}</tbody></table>
      </body></html>`;
      const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `FinGold-${key}-${ts}.xls`; a.click();
      URL.revokeObjectURL(url);
      if (typeof toast === 'function') toast(`Excel downloaded — ${arr.length} records`, 'success');
    } catch(err) { if (typeof toast === 'function') toast('Export error: ' + err.message, 'error'); }
  };

  // ── EXPORT SINGLE MODULE → CSV ────────────────────────────────────────────
  global.dmExportModuleCSV = function(key, label) {
    const raw = localStorage.getItem(key);
    if (!raw) { if (typeof toast === 'function') toast('No data', 'error'); return; }
    try {
      const data = JSON.parse(raw);
      const arr = Array.isArray(data) ? data : typeof data === 'object' ? [data] : [];
      if (!arr.length) { if (typeof toast === 'function') toast('No records', 'error'); return; }
      const mod = ALL_MODULES.find(m => m.key === key);
      const csv = buildCSV(arr, mod?.cols);
      const ts = new Date().toISOString().slice(0,10);
      const blob = new Blob(['\uFEFF'+csv], { type: 'text/csv;charset=utf-8' }); // BOM for Excel
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `FinGold-${key}-${ts}.csv`; a.click();
      URL.revokeObjectURL(url);
      if (typeof toast === 'function') toast(`CSV downloaded — ${arr.length} records`, 'success');
    } catch(err) { if (typeof toast === 'function') toast('CSV error: ' + err.message, 'error'); }
  };

  // ── COMPLIANCE SUMMARY REPORT (HTML — printable / PDF) ───────────────────
  global.dmExportSummaryReport = function() {
    const entity = (typeof getActiveCompany === 'function' ? getActiveCompany().name : 'Hawkeye Sterling');
    const ts = new Date().toLocaleString('en-GB');
    const rows = ALL_MODULES.map(m => {
      const s = getSize(m.key);
      const count = s ? s.count : 0;
      const status = count > 0 ? `<span style="color:green">● Active (${count} records)</span>` : `<span style="color:#aaa">○ Empty</span>`;
      return `<tr style="border-bottom:1px solid #eee">
        <td style="padding:8px 12px">${m.icon} ${m.label}</td>
        <td style="padding:8px 12px;text-align:center">${count||'—'}</td>
        <td style="padding:8px 12px">${status}</td>
      </tr>`;
    }).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Compliance Summary — ${entity}</title>
    <style>
      body { font-family: Arial, sans-serif; color: #222; padding: 40px; max-width: 900px; margin: auto; }
      h1 { color: #8B6914; border-bottom: 3px solid #8B6914; padding-bottom: 10px; }
      table { width:100%; border-collapse:collapse; margin-top:16px; }
      th { background:#8B6914; color:white; padding:10px 12px; text-align:left; }
      @media print { button { display:none; } }
    </style>
    </head><body>
    <button data-action="window.print" style="float:right;padding:8px 16px;background:#8B6914;color:white;border:none;border-radius:3px;cursor:pointer;font-size:13px">🖨️ Print / Save PDF</button>
    <h1>🏛️ ${esc(entity)}</h1>
    <p><strong>Compliance Programme Status Report</strong><br>
    Generated: ${ts}<br>
    Tool: Hawkeye Sterling V2 v2.1<br>
    Frameworks: UAE FDL No.(10)/2025 | Cabinet Resolution 134/2025 | FATF | LBMA RGG v9</p>
    <table>
      <thead><tr><th>Module</th><th style="text-align:center">Records</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin-top:24px;color:#888;font-size:11px">
      This report was generated from the Hawkeye Sterling V2. Data is stored locally in the browser.
      For audit purposes, export individual modules using the Excel or CSV export functions.
    </p>
    </body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `FinGold-Compliance-Summary-${new Date().toISOString().slice(0,10)}.html`; a.click();
    URL.revokeObjectURL(url);
    if (typeof toast === 'function') toast('Summary report downloaded — open in browser and print to PDF', 'success');
  };

  // ── IMPORT / RESTORE ──────────────────────────────────────────────────────
  // Allowlist of backup keys that dmImportBackup will accept. Anything not
  // here is rejected — prevents an attacker-crafted backup from injecting
  // arbitrary localStorage keys that downstream code trusts.
  var BACKUP_KEY_ALLOWLIST = new Set([
    SK.CRA, SK.UBO, SK.STR, SK.TFS, SK.APPROVALS, SK.REGMAP, SK.JURISDICTION,
    SK2.TFS2, SK2.DPMSR, SK2.RETAIN, SK2.AILOG, SK2.LINKED,
    'fgl_cra_risk_model', 'fgl_country_risk_db',
  ]);

  // Derive a deterministic HMAC key for backup signing from the local
  // install. This does not provide cryptographic secrecy against a remote
  // attacker — it does prevent unsigned / cross-install / tampered backups
  // from being restored without an explicit operator override.
  async function backupKey() {
    if (!crypto || !crypto.subtle) {
      throw new Error('Web Crypto unavailable — backup signing disabled in insecure context.');
    }
    var seed = localStorage.getItem('fgl_backup_key_seed');
    if (!seed) {
      var buf = new Uint8Array(32);
      crypto.getRandomValues(buf);
      seed = Array.from(buf).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
      localStorage.setItem('fgl_backup_key_seed', seed);
    }
    var rawKey = new TextEncoder().encode(seed);
    return await crypto.subtle.importKey('raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  }

  async function signBackup(data) {
    var key = await backupKey();
    var bytes = new TextEncoder().encode(JSON.stringify(data));
    var sig = await crypto.subtle.sign('HMAC', key, bytes);
    return Array.from(new Uint8Array(sig)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
  }
  global.dmSignBackup = signBackup;

  async function verifyBackup(data, sigHex) {
    try {
      var key = await backupKey();
      var bytes = new TextEncoder().encode(JSON.stringify(data));
      var sig = new Uint8Array((sigHex || '').match(/../g || []).map(function(h){return parseInt(h, 16);}));
      return await crypto.subtle.verify('HMAC', key, sig, bytes);
    } catch (_) { return false; }
  }

  global.dmImportBackup = async function(input) {
    const file = input.files[0];
    if (!file) return;
    if (!file.name.endsWith('.json')) {
      if (typeof toast === 'function') toast('Please upload a .json backup file', 'error');
      input.value = ''; return;
    }
    const reader = new FileReader();
    reader.onload = async function(e) {
      try {
        const backup = JSON.parse(e.target.result);
        if (!backup || typeof backup !== 'object' || !backup.data || typeof backup.data !== 'object') {
          if (typeof toast === 'function') toast('Invalid backup structure', 'error'); return;
        }
        // Schema: { meta, data, signature }
        var signatureOk = false;
        if (backup.signature) {
          signatureOk = await verifyBackup(backup.data, backup.signature);
        }
        if (!signatureOk) {
          if (!confirm('⚠️ Backup signature missing or invalid. Only restore backups you generated yourself from this install. Continue anyway?')) {
            if (typeof logAudit === 'function') logAudit('dm', 'User cancelled unsigned backup restore');
            return;
          }
          if (typeof logAudit === 'function') logAudit('dm', 'User override: unsigned backup restored');
        }
        // Enforce the allowlist — reject unknown keys rather than writing them.
        var keys = Object.keys(backup.data).filter(function(k) { return BACKUP_KEY_ALLOWLIST.has(k); });
        var rejected = Object.keys(backup.data).filter(function(k) { return !BACKUP_KEY_ALLOWLIST.has(k); });
        if (rejected.length) {
          console.warn('[dmImportBackup] rejected unknown keys:', rejected);
          if (typeof logAudit === 'function') logAudit('dm', 'Rejected unknown backup keys: ' + rejected.join(','));
        }
        var modules = keys.length;
        var dated = backup.meta && backup.meta.timestamp ? fmtDate(backup.meta.timestamp) : 'unknown date';
        if (!confirm('Restore ' + modules + ' modules from backup (' + dated + ')?\n\nExisting records are kept. Backup records are merged in.' + (rejected.length ? '\n\n' + rejected.length + ' unknown keys were rejected.' : ''))) return;
        var restored = 0;
        keys.forEach(function(key) {
          try {
            var value = backup.data[key];
            var existing = null;
            try { existing = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { existing = null; }
            if (Array.isArray(existing) && Array.isArray(value)) {
              var ids = new Set(existing.map(function(r){return r.id || JSON.stringify(r);}));
              var toAdd = value.filter(function(r){return !ids.has(r.id || JSON.stringify(r));});
              localStorage.setItem(key, JSON.stringify(existing.concat(toAdd)));
            } else if (Array.isArray(value) || (value && typeof value === 'object')) {
              localStorage.setItem(key, JSON.stringify(value));
            } else {
              // Scalar values are not expected — skip.
              return;
            }
            restored++;
          } catch (_) {}
        });
        localStorage.setItem('fgl_last_backup', new Date().toISOString());
        if (typeof logAudit === 'function') logAudit('dm', 'Restored ' + restored + ' modules from backup (signatureOk=' + signatureOk + ')');
        if (typeof toast === 'function') toast('✅ Restored ' + restored + ' modules', 'success');
        renderDataManager();
        input.value = '';
      } catch(err) { if (typeof toast === 'function') toast('Failed to read backup: ' + err.message, 'error'); }
    };
    reader.readAsText(file);
  };

  // ── CLEAR MODULE ──────────────────────────────────────────────────────────
  // Retention-governed keys cannot be cleared without a Records Officer
  // role + 2-person approval + age check (FDL Art.24-25). Non-retention
  // keys can still be cleared by an admin.
  var RETENTION_PROTECTED_KEYS = new Set([
    SK.STR, SK.TFS, SK.UBO, SK.CRA, SK.APPROVALS,
    SK2.TFS2, SK2.DPMSR, SK2.RETAIN, SK2.AILOG, SK2.LINKED,
  ]);
  global.dmClearModule = function(key, label) {
    if (RETENTION_PROTECTED_KEYS.has(key)) {
      if (typeof toast === 'function') toast('"' + label + '" is retention-governed (FDL Art.24). Destruction requires Records Officer role + two-person approval + age-verified records.', 'error', 10000);
      if (typeof logAudit === 'function') logAudit('dm', 'BLOCKED clear of retention-governed module ' + key);
      return;
    }
    if (!confirm('⚠️ Clear ALL data in "' + label + '"?\n\nThis cannot be undone. Download a backup first.')) return;
    localStorage.removeItem(key);
    if (typeof logAudit === 'function') logAudit('dm', 'Cleared module ' + key);
    if (typeof toast === 'function') toast(label + ' cleared', 'success');
    renderDataManager();
  };

  // ── INIT ──────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(injectDataTab, 500));
  } else {
    setTimeout(injectDataTab, 500);
  }

})(window);
