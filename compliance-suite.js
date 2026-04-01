/**
 * Fine Gold LLC — UAE AML/CFT Compliance Suite
 * Version 2.0.0 | April 2026
 * Regulatory: UAE FDL No.(10) of 2025 | FATF Rec. 22/23 | LBMA RGG v9
 *
 * Adds:
 *  1. Customer Risk Assessment (CRA/CDD/EDD)
 *  2. UBO Register
 *  3. STR Case Management
 *  4. TFS Operations
 *  5. Red Flag Library
 *  6. Approval Matrix (Four-Eyes)
 *  7. Regulatory Mapping & Jurisdiction Selector
 */

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
    return prefix + '-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-6);
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-GB'); }
  function toast(msg, type) {
    if (global.toast) { global.toast(msg, type); return; }
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#333;color:#fff;padding:12px 20px;border-radius:10px;z-index:9999;font-size:13px';
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
    return `<span style="background:${col}22;color:${col};border:1px solid ${col}44;border-radius:5px;padding:2px 8px;font-size:10px;font-family:'DM Mono',monospace;white-space:nowrap">${status}</span>`;
  }

  // ─── ASANA INTEGRATION ───────────────────────────────────────────────────────
  async function pushToAsana(title, notes, section) {
    try {
      if (typeof asanaFetch !== 'function') return null;
      const projectId = (typeof ASANA_PROJECT !== 'undefined' && ASANA_PROJECT) ? ASANA_PROJECT : '1213759768596515';
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
  const NEW_TABS = [
    { id: 'cra',       icon: '👤', label: 'CRA',       title: 'Customer Risk Assessment' },
    { id: 'ubo',       icon: '🏛️', label: 'UBO',       title: 'UBO Register' },
    { id: 'str',       icon: '🚨', label: 'STR Cases', title: 'STR Case Management' },
    { id: 'tfs',       icon: '🔒', label: 'TFS Ops',   title: 'TFS Operations' },
    { id: 'redflags',  icon: '🚩', label: 'Red Flags', title: 'Red Flag Library' },
    { id: 'approvals2','icon':'✅', label: 'Approvals', title: 'Approval Matrix' },
    { id: 'regmap',    icon: '📋', label: 'Reg Map',   title: 'Regulatory Mapping' },
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
      el.innerHTML = `${t.icon} ${t.label}`;
      el.onclick = () => switchToSuiteTab(t.id);
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
      tfs: renderTFS, redflags: renderRedFlags,
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

  const CRA_RISK_WEIGHTS = {
    customerType:   { Individual: 1, 'Corporate Entity': 2, 'Trust/Foundation': 3, 'NPO/Charity': 3 },
    nationality:    { UAE: 0, GCC: 1, 'FATF Member': 1, 'FATF Grey List': 3, 'FATF Black List': 4, 'CAHRA Country': 4 },
    pepStatus:      { 'Not a PEP': 0, 'Former PEP (>1yr)': 2, 'Family/Associate of PEP': 2, 'Active PEP': 4 },
    businessType:   { 'Gold Retailer': 2, 'Refinery': 3, 'Jewellery Manufacturer': 2, 'Bullion Trader': 3, 'End Consumer': 1, 'Financial Institution': 2, 'Other': 2 },
    transactionVol: { 'Under AED 55,000': 0, 'AED 55,000–500,000': 1, 'AED 500,000–2M': 2, 'Over AED 2M': 3 },
    cashPayment:    { 'No': 0, 'Partial': 2, 'Majority Cash': 4 },
    sanctionsHit:   { 'No Match': 0, 'Potential Match – Pending': 3, 'Cleared False Positive': 0, 'Confirmed Match': 10 },
    sourceOfFunds:  { 'Verified/Documented': 0, 'Partially Verified': 2, 'Unverified': 4 },
    geography:      { 'UAE Only': 0, 'GCC': 1, 'EU/US/UK': 1, 'High Risk Jurisdiction': 3, 'CAHRA Region': 4 },
    adverseMedia:   { 'None': 0, 'Possible': 2, 'Confirmed': 4 },
  };

  function calcCRAScore(form) {
    let score = 0;
    Object.keys(CRA_RISK_WEIGHTS).forEach(k => {
      const val = form[k];
      const w = CRA_RISK_WEIGHTS[k];
      if (w && val !== undefined) score += (w[val] || 0);
    });
    return score;
  }

  function scoreToRating(score) {
    if (score >= 15) return 'Very High';
    if (score >= 9)  return 'High';
    if (score >= 4)  return 'Medium';
    return 'Low';
  }

  function scoreToCDD(rating) {
    if (rating === 'Very High') return 'EDD Required + Senior Management Approval';
    if (rating === 'High')      return 'EDD Required';
    if (rating === 'Medium')    return 'Standard CDD + Enhanced Monitoring';
    return 'Standard CDD';
  }

  function renderCRA() {
    const el = document.getElementById('suite-content-cra');
    if (!el) return;
    const records = load(SK.CRA) || [];

    el.innerHTML = `
      <div class="card" style="margin-bottom:1.2rem">
        <div class="top-bar">
          <span class="sec-title">👤 Customer Risk Assessment — CDD/EDD</span>
          <span style="font-size:11px;color:var(--muted)">UAE FDL No.(10) of 2025 | Art. 12-16 | FATF Rec. 10</span>
          <button class="btn btn-gold" style="width:auto;padding:8px 16px" onclick="suiteOpenCRAForm()">+ New Assessment</button>
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
                    <div class="f-title">${r.customerName} ${badge(r.rating)}</div>
                    <div class="f-body" style="margin-top:4px">${r.customerType} | ${r.nationality} | Score: ${r.score} | CDD: ${r.cddLevel}</div>
                    <div class="f-ref">Assessed: ${fmtDate(r.date)} | Ref: ${r.id} | Next Review: ${fmtDate(r.nextReview)}</div>
                  </div>
                </div>
                <div style="display:flex;gap:6px;align-items:center">
                  <button class="btn btn-sm" onclick="suiteEditCRA(${i})">Edit</button>
                  <button class="btn btn-sm btn-blue" onclick="suiteSyncCRAToAsana(${i})">Asana</button>
                  <button class="btn btn-sm btn-red" onclick="suiteDeleteCRA(${i})">Delete</button>
                </div>
              </div>
              ${r.notes ? `<div class="rec">${r.notes}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>

      <!-- CRA Form Modal -->
      <div class="modal-overlay" id="craModal">
        <div class="modal" style="max-width:600px;width:95%">
          <button class="modal-close" onclick="document.getElementById('craModal').classList.remove('open')">✕</button>
          <div class="modal-title">Customer Risk Assessment Form</div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:1rem;font-family:'DM Mono',monospace">UAE FDL No.(10) of 2025 | FATF Rec. 10 | FATF DPMS Guidance 2020</div>

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
              <select id="cra-nationality"><option value="">Select</option>${Object.keys(CRA_RISK_WEIGHTS.nationality).map(v=>`<option>${v}</option>`).join('')}</select>
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

          <div id="cra-score-box" style="background:var(--surface2);border-radius:10px;padding:12px;margin:10px 0;display:none">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span class="lbl" style="margin:0">CALCULATED RISK RATING</span>
              <span id="cra-score-display" style="font-size:22px;font-weight:700;font-family:'Playfair Display',serif"></span>
            </div>
            <div id="cra-cdd-display" style="font-size:12px;color:var(--muted);margin-top:4px;font-family:'DM Mono',monospace"></div>
          </div>

          <div><span class="lbl">Compliance Notes / Observations</span>
            <textarea id="cra-notes" placeholder="Document any specific risk observations, mitigating factors, or actions required..." style="min-height:80px"></textarea>
          </div>
          <div class="row row-2" style="margin-top:10px">
            <div><span class="lbl">Assessment Date</span><input type="date" id="cra-date" value="${today()}"/></div>
            <div><span class="lbl">Next Review Date</span><input type="date" id="cra-review"/></div>
          </div>

          <div style="display:flex;gap:8px;margin-top:1rem">
            <button class="btn btn-gold" onclick="suiteCalcAndSaveCRA()" style="flex:1">Calculate Score & Save</button>
            <button class="btn btn-sm" onclick="document.getElementById('craModal').classList.remove('open')" style="padding:12px 20px">Cancel</button>
          </div>
        </div>
      </div>
    `;
  }

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
    const editIdx = parseInt(document.getElementById('cra-edit-idx').value);
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
  };

  global.suiteDeleteCRA = function(idx) {
    if (!confirm('Delete this customer risk assessment?')) return;
    const records = load(SK.CRA) || [];
    records.splice(idx, 1);
    save(SK.CRA, records);
    renderCRA();
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
  // Reg: UAE Cabinet Decision No.(10) of 2019 | UAE FDL No.(10) of 2025 Art.18
  // ════════════════════════════════════════════════════════════════════════════

  function renderUBO() {
    const el = document.getElementById('suite-content-ubo');
    if (!el) return;
    const records = load(SK.UBO) || [];

    el.innerHTML = `
      <div class="card">
        <div class="top-bar">
          <span class="sec-title">🏛️ UBO Register — Beneficial Ownership</span>
          <span style="font-size:11px;color:var(--muted)">UAE Cabinet Decision No.(10) of 2019 | FDL No.(10) of 2025 Art.18</span>
          <button class="btn btn-gold" style="width:auto;padding:8px 16px" onclick="suiteOpenUBOForm()">+ Add UBO</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:1rem">
          <div class="metric m-ok"><div class="metric-num">${records.length}</div><div class="metric-lbl">Total UBOs</div></div>
          <div class="metric m-c"><div class="metric-num">${records.filter(r=>r.screeningStatus==='Potential Match – Pending').length}</div><div class="metric-lbl">Screening Pending</div></div>
          <div class="metric m-h"><div class="metric-num">${records.filter(r=>{ const d=new Date(r.nextReview); return d < new Date(Date.now()+30*86400000); }).length}</div><div class="metric-lbl">Review Due ≤30d</div></div>
          <div class="metric m-m"><div class="metric-num">${records.filter(r=>r.ownershipPct>=25).length}</div><div class="metric-lbl">≥25% Ownership</div></div>
        </div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="border-bottom:1px solid var(--border)">
                ${['Entity','UBO Name','Nationality','DOB','Ownership %','Control Type','Screening','Verified','Next Review','Actions'].map(h=>`<th style="text-align:left;padding:8px;font-size:11px;color:var(--muted);font-family:'DM Mono',monospace">${h}</th>`).join('')}
              </tr>
            </thead>
            <tbody id="ubo-tbody">
              ${records.length===0 ? `<tr><td colspan="10" style="text-align:center;padding:2rem;color:var(--muted);font-size:13px">No UBO records. Click "+ Add UBO" to begin.</td></tr>` : ''}
              ${records.map((r,i)=>`
                <tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:8px;font-size:12px;font-weight:500">${r.entityName}</td>
                  <td style="padding:8px;font-size:12px">${r.uboName}</td>
                  <td style="padding:8px;font-size:12px">${r.nationality}</td>
                  <td style="padding:8px;font-size:12px">${fmtDate(r.dob)}</td>
                  <td style="padding:8px;font-size:12px;text-align:center;font-weight:600;color:${r.ownershipPct>=25?'var(--gold)':'var(--text)'}">${r.ownershipPct}%</td>
                  <td style="padding:8px;font-size:12px">${r.controlType}</td>
                  <td style="padding:8px">${badge(r.screeningStatus||'Pending')}</td>
                  <td style="padding:8px;font-size:12px">${fmtDate(r.verifiedDate)}</td>
                  <td style="padding:8px;font-size:12px;color:${new Date(r.nextReview)<new Date()?'var(--red)':'var(--text)'}">${fmtDate(r.nextReview)}</td>
                  <td style="padding:8px">
                    <div style="display:flex;gap:4px">
                      <button class="btn btn-sm" onclick="suiteEditUBO(${i})">Edit</button>
                      <button class="btn btn-sm btn-blue" onclick="suiteSyncUBOToAsana(${i})">Asana</button>
                      <button class="btn btn-sm btn-red" onclick="suiteDeleteUBO(${i})">Del</button>
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
          <button class="modal-close" onclick="document.getElementById('uboModal').classList.remove('open')">✕</button>
          <div class="modal-title">UBO Record</div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:1rem;font-family:'DM Mono',monospace">UAE Cabinet Decision No.(10) of 2019 | Capture all persons owning ≥25% or exercising ultimate control</div>
          <input type="hidden" id="ubo-edit-idx" value="-1">
          <div class="row row-2">
            <div><span class="lbl">Legal Entity Name *</span><input id="ubo-entity" placeholder="Company/Trust/Fund name"/></div>
            <div><span class="lbl">UBO Full Legal Name *</span><input id="ubo-name" placeholder="As per passport"/></div>
          </div>
          <div class="row row-2">
            <div><span class="lbl">Nationality</span><input id="ubo-nationality" placeholder="Country of citizenship"/></div>
            <div><span class="lbl">Date of Birth</span><input type="date" id="ubo-dob"/></div>
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
            <div><span class="lbl">Document Expiry Date</span><input type="date" id="ubo-docexpiry"/></div>
          </div>
          <div class="row row-2">
            <div><span class="lbl">Date Verified</span><input type="date" id="ubo-verified" value="${today()}"/></div>
            <div><span class="lbl">Next Review Date</span><input type="date" id="ubo-review"/></div>
          </div>
          <div><span class="lbl">Notes</span><textarea id="ubo-notes" style="min-height:60px" placeholder="Ownership structure notes, supporting documents, escalation notes..."></textarea></div>
          <div style="display:flex;gap:8px;margin-top:1rem">
            <button class="btn btn-gold" onclick="suiteSaveUBO()" style="flex:1">Save UBO Record</button>
            <button class="btn btn-sm" onclick="document.getElementById('uboModal').classList.remove('open')" style="padding:12px 20px">Cancel</button>
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
    const editIdx = parseInt(document.getElementById('ubo-edit-idx').value);
    const record = {
      id: editIdx >= 0 ? records[editIdx].id : uid('UBO'),
      entityName: entity, uboName: name,
      nationality: document.getElementById('ubo-nationality').value,
      dob: document.getElementById('ubo-dob').value,
      residence: document.getElementById('ubo-residence').value,
      ownershipPct: parseFloat(document.getElementById('ubo-pct').value) || 0,
      controlType: document.getElementById('ubo-control').value,
      pepStatus: document.getElementById('ubo-pep').value,
      screeningStatus: document.getElementById('ubo-screening').value,
      docType: document.getElementById('ubo-doctype').value,
      docRef: document.getElementById('ubo-docref').value,
      docExpiry: document.getElementById('ubo-docexpiry').value,
      verifiedDate: document.getElementById('ubo-verified').value,
      nextReview: document.getElementById('ubo-review').value,
      notes: document.getElementById('ubo-notes').value.trim(),
      updatedAt: new Date().toISOString(),
    };
    if (editIdx >= 0) { records[editIdx] = record; } else { records.unshift(record); }
    save(SK.UBO, records);
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
    const notes = `Entity: ${r.entityName}\nUBO: ${r.uboName}\nNationality: ${r.nationality}\nOwnership: ${r.ownershipPct}%\nControl: ${r.controlType}\nPEP: ${r.pepStatus}\nScreening: ${r.screeningStatus}\nDoc: ${r.docType} ${r.docRef}\nVerified: ${fmtDate(r.verifiedDate)}\nNext Review: ${fmtDate(r.nextReview)}\n\nRegulatory: UAE Cabinet Decision No.(10) of 2019 | FDL No.(10) of 2025 Art.18`;
    const gid = await pushToAsana(`[UBO] ${r.entityName} — ${r.uboName} (${r.ownershipPct}%)`, notes, 'ubo');
    if (gid) { toast('Synced to Asana', 'success'); } else { toast('Asana sync failed — check token in Settings', 'error'); }
  };

  // ════════════════════════════════════════════════════════════════════════════
  // 3. STR CASE MANAGEMENT
  // Reg: UAE FDL No.(10) of 2025 Art.20 | UAE FIU goAML | FATF Rec. 20
  // ════════════════════════════════════════════════════════════════════════════

  const STR_RED_FLAGS_DPMS = [
    'Customer reluctant to provide identification',
    'Unusual cash payments above AED 55,000',
    'Multiple structured transactions below AED 55,000 threshold',
    'Customer requests anonymity or third-party payment',
    'Inconsistency between declared source of funds and known business',
    'Purchases inconsistent with customer profile or business activity',
    'Customer known to law enforcement or adverse media',
    'Gold purchased immediately converted/exported',
    'Involvement of CAHRA or high-risk jurisdiction',
    'PEP involvement without satisfactory source of wealth explanation',
    'Unusually complex ownership or payment structure',
    'Customer declines to complete CDD documentation',
    'Sanctions list match or potential match identified',
    'Trade-Based Money Laundering indicators (over/under-invoicing)',
    'Terrorism financing red flag (political links, specific geography)',
    'Proliferation financing concern (dual-use goods reference)',
    'Transaction with no apparent business rationale',
    'Customer behaviour changes after CDD request',
  ];

  function renderSTR() {
    const el = document.getElementById('suite-content-str');
    if (!el) return;
    const cases = load(SK.STR) || [];

    el.innerHTML = `
      <div class="card">
        <div class="top-bar">
          <span class="sec-title">🚨 STR Case Management</span>
          <span style="font-size:11px;color:var(--muted)">UAE FDL No.(10) of 2025 Art.20 | goAML | FATF Rec.20 | File within 30 days of suspicion</span>
          <button class="btn btn-gold" style="width:auto;padding:8px 16px" onclick="suiteOpenSTRForm()">+ New STR Case</button>
        </div>
        <div style="background:rgba(217,79,79,0.1);border:1px solid rgba(217,79,79,0.3);border-radius:10px;padding:10px 14px;margin-bottom:1rem;font-size:12px;color:var(--red);font-family:'DM Mono',monospace">
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
                  <div class="f-title">${c.id} — ${c.subjectName} ${badge(c.status)}</div>
                  <div class="f-body" style="margin-top:4px">Type: ${c.reportType} | Priority: ${c.priority} | Opened: ${fmtDate(c.dateOpened)}</div>
                  <div class="f-ref">Filing Deadline: ${fmtDate(c.filingDeadline)} | Investigator: ${c.investigator||'Unassigned'}</div>
                </div>
              </div>
              <div style="display:flex;gap:6px">
                <button class="btn btn-sm" onclick="suiteEditSTR(${i})">View/Edit</button>
                <button class="btn btn-sm btn-blue" onclick="suiteSyncSTRToAsana(${i})">Asana</button>
                <button class="btn btn-sm btn-red" onclick="suiteDeleteSTR(${i})">Delete</button>
              </div>
            </div>
            <div style="font-size:12px;color:var(--muted);margin-top:8px;padding:8px;background:var(--surface2);border-radius:6px;line-height:1.5">${(c.narrative||'').slice(0,200)}${(c.narrative||'').length>200?'...':''}</div>
          </div>
        `).join('')}
      </div>

      <!-- STR Form Modal -->
      <div class="modal-overlay" id="strModal">
        <div class="modal" style="max-width:680px;width:95%;max-height:90vh">
          <button class="modal-close" onclick="document.getElementById('strModal').classList.remove('open')">✕</button>
          <div class="modal-title">STR Case File</div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:1rem;font-family:'DM Mono',monospace">UAE FDL No.(10) of 2025 Art.20 | File to UAE FIU via goAML within 30 days of suspicion arising</div>
          <input type="hidden" id="str-edit-idx" value="-1">

          <div class="row row-2">
            <div><span class="lbl">Report Type *</span>
              <select id="str-type"><option value="">Select</option><option>STR – Suspicious Transaction Report</option><option>SAR – Suspicious Activity Report</option><option>FFR – Funds Freeze Report</option><option>PNMR – Partial Name Match Report</option></select>
            </div>
            <div><span class="lbl">Priority</span>
              <select id="str-priority"><option>Standard (30 days)</option><option>Urgent (Immediate – TF/PF)</option></select>
            </div>
          </div>
          <div class="row row-2">
            <div><span class="lbl">Subject Name *</span><input id="str-subject" placeholder="Individual or entity name"/></div>
            <div><span class="lbl">Subject Type</span>
              <select id="str-subjtype"><option value="">Select</option><option>Individual</option><option>Legal Entity</option><option>Both</option></select>
            </div>
          </div>
          <div class="row row-2">
            <div><span class="lbl">Date Suspicion Arose *</span><input type="date" id="str-suspicion-date"/></div>
            <div><span class="lbl">Filing Deadline (auto +30d)</span><input type="date" id="str-deadline" readonly style="opacity:0.7"/></div>
          </div>
          <div><span class="lbl">Red Flags Identified (select all that apply) *</span>
            <div id="str-flags-container" style="display:grid;grid-template-columns:1fr 1fr;gap:4px;background:var(--surface2);padding:10px;border-radius:8px;border:1px solid var(--border);max-height:180px;overflow-y:auto;margin-top:4px">
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
            <button class="btn btn-gold" onclick="suiteSaveSTR()" style="flex:1">Save Case</button>
            <button class="btn btn-sm" onclick="document.getElementById('strModal').classList.remove('open')" style="padding:12px 20px">Cancel</button>
          </div>
        </div>
      </div>
    `;

    // Wire up auto-deadline
    const sd = document.getElementById('str-suspicion-date');
    if (sd) sd.addEventListener('change', function() {
      const d = new Date(this.value);
      d.setDate(d.getDate() + 30);
      document.getElementById('str-deadline').value = d.toISOString().slice(0,10);
    });
  }

  global.suiteOpenSTRForm = function() {
    document.getElementById('str-edit-idx').value = '-1';
    ['str-subject','str-tx-dates','str-investigator','str-goaml-ref','str-notes','str-narrative'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
    ['str-type','str-subjtype'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
    document.getElementById('str-status').value = 'Draft';
    document.getElementById('str-priority').value = 'Standard (30 days)';
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
    document.getElementById('str-priority').value = c.priority || 'Standard (30 days)';
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
    const editIdx = parseInt(document.getElementById('str-edit-idx').value);
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
  };

  global.suiteDeleteSTR = function(idx) {
    if (!confirm('Delete this STR case? This action cannot be undone.')) return;
    const cases = load(SK.STR) || [];
    cases.splice(idx, 1);
    save(SK.STR, cases);
    renderSTR();
  };

  global.suiteSyncSTRToAsana = async function(idx) {
    const cases = load(SK.STR) || [];
    const c = cases[idx];
    if (!c) return;
    toast('Syncing to Asana...', 'info');
    const notes = `CASE: ${c.id}\nReport Type: ${c.reportType}\nSubject: ${c.subjectName}\nStatus: ${c.status}\nSuspicion Date: ${fmtDate(c.suspicionDate)}\nFiling Deadline: ${fmtDate(c.filingDeadline)}\nPriority: ${c.priority}\nInvestigator: ${c.investigator}\ngoAML Ref: ${c.goamlRef||'Pending'}\n\nRed Flags: ${(c.flags||[]).join('; ')}\n\nNarrative (excerpt): ${(c.narrative||'').slice(0,500)}\n\nRegulatory Basis: UAE FDL No.(10) of 2025 Art.20 | FATF Rec.20\n\n⚠️ CONFIDENTIAL — Do not share with subject`;
    const gid = await pushToAsana(`[${c.reportType.split('–')[0].trim()}] ${c.subjectName} — ${c.status}`, notes, 'str');
    if (gid) { toast('Synced to Asana', 'success'); } else { toast('Asana sync failed', 'error'); }
  };

  // ════════════════════════════════════════════════════════════════════════════
  // 4. TFS OPERATIONS
  // Reg: UAE Cabinet Resolution 74/2020 | UNSCR | FDL No.(10) of 2025 Art.14-15
  // ════════════════════════════════════════════════════════════════════════════

  function renderTFS() {
    const el = document.getElementById('suite-content-tfs');
    if (!el) return;
    const events = load(SK.TFS) || [];

    el.innerHTML = `
      <div class="card">
        <div class="top-bar">
          <span class="sec-title">🔒 TFS Operations — Targeted Financial Sanctions</span>
          <span style="font-size:11px;color:var(--muted)">UAE Cabinet Resolution 74/2020 | UNSCR | FDL No.(10) of 2025 Art.14-15</span>
          <button class="btn btn-gold" style="width:auto;padding:8px 16px" onclick="suiteOpenTFSForm()">+ New Screening Event</button>
        </div>

        <div style="background:var(--surface2);border-radius:10px;padding:14px;margin-bottom:1rem">
          <div class="sec-title" style="margin-bottom:10px">Active Screening Lists — UAE DPMS Obligation</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:12px">
            ${[
              ['UN Consolidated Sanctions List','UNSCR – Mandatory','✅'],
              ['UAE Local Terrorist List (EOCN)','Executive Office – Mandatory','✅'],
              ['OFAC SDN List','US – Best Practice','✅'],
              ['EU Consolidated Sanctions','EU – Best Practice','✅'],
              ['UK OFSI Consolidated','UK – Best Practice','✅'],
              ['Interpol Red Notices','International – Best Practice','✅'],
            ].map(([name,basis,status])=>`
              <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px">
                <div style="font-weight:500">${status} ${name}</div>
                <div style="color:var(--muted);font-size:11px;margin-top:3px">${basis}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <div style="background:rgba(217,79,79,0.08);border:1px solid rgba(217,79,79,0.25);border-radius:10px;padding:12px;margin-bottom:1rem;font-size:12px;font-family:'DM Mono',monospace">
          🔴 FREEZE WITHOUT DELAY: If a true hit is confirmed, assets must be frozen immediately without prior notice. Notify: (1) UAE FIU via goAML FFR, (2) Executive Office (EOCN) for UAE list matches, (3) CBUAE or MoE as applicable. UAE FDL No.(10) of 2025 Art.15
        </div>

        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:1rem">
          <div class="metric m-c"><div class="metric-num">${events.filter(e=>e.disposition==='True Hit').length}</div><div class="metric-lbl">True Hits</div></div>
          <div class="metric m-h"><div class="metric-num">${events.filter(e=>e.disposition==='Potential Match – Pending').length}</div><div class="metric-lbl">Pending Review</div></div>
          <div class="metric m-ok"><div class="metric-num">${events.filter(e=>e.disposition==='False Positive').length}</div><div class="metric-lbl">False Positives</div></div>
          <div class="metric m-m"><div class="metric-num">${events.length}</div><div class="metric-lbl">Total Events</div></div>
        </div>

        ${events.length===0 ? '<p style="color:var(--muted);font-size:13px;text-align:center;padding:2rem">No screening events recorded.</p>' : ''}
        ${events.map((e,i)=>`
          <div class="finding ${e.disposition==='True Hit'?'f-critical':e.disposition==='Potential Match – Pending'?'f-high':'f-ok'}" style="margin-bottom:8px">
            <div class="f-head">
              <div class="f-head-left">
                <div>
                  <div class="f-title">${e.screenedName} ${badge(e.disposition)}</div>
                  <div class="f-body">List: ${e.listName} | Event: ${e.eventType} | Screened: ${fmtDate(e.screeningDate)}</div>
                  <div class="f-ref">Ref: ${e.id} | Reviewed by: ${e.reviewedBy||'—'} | Frozen: ${e.frozenStatus||'N/A'}</div>
                </div>
              </div>
              <div style="display:flex;gap:6px">
                <button class="btn btn-sm" onclick="suiteEditTFS(${i})">Edit</button>
                <button class="btn btn-sm btn-blue" onclick="suiteSyncTFSToAsana(${i})">Asana</button>
                <button class="btn btn-sm btn-red" onclick="suiteDeleteTFS(${i})">Delete</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- TFS Form Modal -->
      <div class="modal-overlay" id="tfsModal">
        <div class="modal" style="max-width:580px;width:95%">
          <button class="modal-close" onclick="document.getElementById('tfsModal').classList.remove('open')">✕</button>
          <div class="modal-title">TFS Screening Event</div>
          <input type="hidden" id="tfs-edit-idx" value="-1">
          <div class="row row-2">
            <div><span class="lbl">Name Screened *</span><input id="tfs-name" placeholder="Individual or entity name"/></div>
            <div><span class="lbl">Screening Event Type</span>
              <select id="tfs-event"><option>New Customer Onboarding</option><option>Periodic Rescreening</option><option>List Update Trigger</option><option>Transaction Pre-Approval</option><option>Ad Hoc Review</option></select>
            </div>
          </div>
          <div class="row row-2">
            <div><span class="lbl">List(s) Screened Against *</span><input id="tfs-list" placeholder="e.g. UN + UAE EOCN + OFAC"/></div>
            <div><span class="lbl">Screening Date *</span><input type="date" id="tfs-date" value="${today()}"/></div>
          </div>
          <div class="row row-2">
            <div><span class="lbl">Disposition *</span>
              <select id="tfs-disposition"><option value="">Select</option><option>No Match – Cleared</option><option>Potential Match – Pending</option><option>False Positive</option><option>True Hit</option></select>
            </div>
            <div><span class="lbl">Reviewed By</span><input id="tfs-reviewer" placeholder="Compliance Officer / MLRO"/></div>
          </div>
          <div id="tfs-freeze-section" style="display:none">
            <div style="background:rgba(217,79,79,0.12);border:1px solid rgba(217,79,79,0.4);border-radius:10px;padding:12px;margin:10px 0">
              <div style="color:var(--red);font-weight:600;font-size:13px;margin-bottom:8px">🔴 TRUE HIT — IMMEDIATE FREEZE REQUIRED</div>
              <div class="row row-2">
                <div><span class="lbl">Assets Frozen?</span>
                  <select id="tfs-frozen"><option>Yes – Immediately</option><option>No – Pending</option></select>
                </div>
                <div><span class="lbl">Freeze Date</span><input type="date" id="tfs-freeze-date"/></div>
              </div>
              <div class="row row-2">
                <div><span class="lbl">goAML FFR Filed?</span>
                  <select id="tfs-ffr"><option value="">Select</option><option>Yes – Filed</option><option>Pending</option><option>Not Required</option></select>
                </div>
                <div><span class="lbl">EOCN Notified?</span>
                  <select id="tfs-eocn"><option value="">Select</option><option>Yes – Notified</option><option>Pending</option><option>Not Applicable</option></select>
                </div>
              </div>
            </div>
          </div>
          <div><span class="lbl">Disposition Rationale / Notes</span>
            <textarea id="tfs-notes" style="min-height:80px" placeholder="Explain disposition decision. For false positives: document differentiation basis. For true hits: document freeze actions taken."></textarea>
          </div>
          <div style="display:flex;gap:8px;margin-top:1rem">
            <button class="btn btn-gold" onclick="suiteSaveTFS()" style="flex:1">Save Event</button>
            <button class="btn btn-sm" onclick="document.getElementById('tfsModal').classList.remove('open')" style="padding:12px 20px">Cancel</button>
          </div>
        </div>
      </div>
    `;

    const disp = document.getElementById('tfs-disposition');
    if (disp) disp.addEventListener('change', function() {
      const sec = document.getElementById('tfs-freeze-section');
      if (sec) sec.style.display = this.value === 'True Hit' ? 'block' : 'none';
    });
  }

  global.suiteOpenTFSForm = function() {
    document.getElementById('tfs-edit-idx').value = '-1';
    ['tfs-name','tfs-list','tfs-reviewer','tfs-notes'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
    document.getElementById('tfs-date').value = today();
    document.getElementById('tfs-disposition').value = '';
    document.getElementById('tfs-event').value = 'New Customer Onboarding';
    document.getElementById('tfs-freeze-section').style.display = 'none';
    document.getElementById('tfsModal').classList.add('open');
  };

  global.suiteEditTFS = function(idx) {
    const events = load(SK.TFS) || [];
    const e = events[idx];
    if (!e) return;
    document.getElementById('tfs-edit-idx').value = idx;
    document.getElementById('tfs-name').value = e.screenedName || '';
    document.getElementById('tfs-event').value = e.eventType || '';
    document.getElementById('tfs-list').value = e.listName || '';
    document.getElementById('tfs-date').value = e.screeningDate || today();
    document.getElementById('tfs-disposition').value = e.disposition || '';
    document.getElementById('tfs-reviewer').value = e.reviewedBy || '';
    document.getElementById('tfs-notes').value = e.notes || '';
    if (e.disposition === 'True Hit') {
      document.getElementById('tfs-freeze-section').style.display = 'block';
      document.getElementById('tfs-frozen').value = e.frozenStatus || '';
      document.getElementById('tfs-freeze-date').value = e.freezeDate || '';
      document.getElementById('tfs-ffr').value = e.ffrFiled || '';
      document.getElementById('tfs-eocn').value = e.eocnNotified || '';
    }
    document.getElementById('tfsModal').classList.add('open');
  };

  global.suiteSaveTFS = function() {
    const name = document.getElementById('tfs-name').value.trim();
    const disp = document.getElementById('tfs-disposition').value;
    if (!name || !disp) { toast('Name and disposition are required', 'error'); return; }
    const events = load(SK.TFS) || [];
    const editIdx = parseInt(document.getElementById('tfs-edit-idx').value);
    const record = {
      id: editIdx >= 0 ? events[editIdx].id : uid('TFS'),
      screenedName: name,
      eventType: document.getElementById('tfs-event').value,
      listName: document.getElementById('tfs-list').value,
      screeningDate: document.getElementById('tfs-date').value,
      disposition: disp,
      reviewedBy: document.getElementById('tfs-reviewer').value,
      notes: document.getElementById('tfs-notes').value,
      frozenStatus: disp === 'True Hit' ? document.getElementById('tfs-frozen').value : null,
      freezeDate: disp === 'True Hit' ? document.getElementById('tfs-freeze-date').value : null,
      ffrFiled: disp === 'True Hit' ? document.getElementById('tfs-ffr').value : null,
      eocnNotified: disp === 'True Hit' ? document.getElementById('tfs-eocn').value : null,
      updatedAt: new Date().toISOString(),
    };
    if (editIdx >= 0) { events[editIdx] = record; } else { events.unshift(record); }
    save(SK.TFS, events);
    document.getElementById('tfsModal').classList.remove('open');
    if (disp === 'True Hit') toast('⚠️ TRUE HIT saved — ensure freeze and reporting obligations are met immediately', 'error');
    else toast(`TFS event saved — ${disp}`, 'success');
    renderTFS();
  };

  global.suiteDeleteTFS = function(idx) {
    if (!confirm('Delete this TFS screening event?')) return;
    const events = load(SK.TFS) || [];
    events.splice(idx, 1);
    save(SK.TFS, events);
    renderTFS();
  };

  global.suiteSyncTFSToAsana = async function(idx) {
    const events = load(SK.TFS) || [];
    const e = events[idx];
    if (!e) return;
    const notes = `TFS Event: ${e.id}\nScreened: ${e.screenedName}\nDisposition: ${e.disposition}\nLists: ${e.listName}\nDate: ${fmtDate(e.screeningDate)}\nReviewed by: ${e.reviewedBy}\n${e.disposition==='True Hit'?`\nFROZEN: ${e.frozenStatus}\nFFR Filed: ${e.ffrFiled}\nEOCN Notified: ${e.eocnNotified}`:''}`;
    const gid = await pushToAsana(`[TFS] ${e.screenedName} — ${e.disposition}`, notes, 'tfs');
    if (gid) toast('Synced to Asana', 'success'); else toast('Asana sync failed', 'error');
  };

  // ════════════════════════════════════════════════════════════════════════════
  // 5. RED FLAG LIBRARY
  // Reg: FATF DPMS Guidance 2020 | UAE FDL No.(10) of 2025 | Wolfsberg ACSS
  // ════════════════════════════════════════════════════════════════════════════

  const RED_FLAGS_DB = {
    'Customer Due Diligence': [
      { flag: 'Customer refuses or is unable to provide required identification documents', ref: 'UAE FDL No.(10)/2025 Art.12 | FATF Rec.10' },
      { flag: 'Customer provides inconsistent or suspicious identification information', ref: 'UAE FDL No.(10)/2025 Art.12' },
      { flag: 'Customer uses nominee, proxy, or third party without clear explanation', ref: 'FATF DPMS 2020 §4.3' },
      { flag: 'Customer declines to provide source of funds information', ref: 'UAE FDL No.(10)/2025 Art.14' },
      { flag: 'Customer behaviour changes after CDD is requested', ref: 'FATF DPMS 2020 §4.2' },
      { flag: 'Customer known to law enforcement or subject to adverse media', ref: 'FATF Rec.12' },
      { flag: 'Beneficial ownership structure is complex or opaque without business justification', ref: 'UAE Cabinet Decision No.(10)/2019' },
      { flag: 'PEP status concealed or only revealed after initial screening', ref: 'FATF Rec.12 | UAE FDL No.(10)/2025 Art.16' },
    ],
    'Transaction Patterns': [
      { flag: 'Structuring: multiple transactions just below AED 55,000 reporting threshold', ref: 'UAE FDL No.(10)/2025 Art.20 | FATF DPMS 2020' },
      { flag: 'Large cash payment for gold with no clear business rationale', ref: 'UAE FDL No.(10)/2025 | FATF DPMS 2020 §4.2' },
      { flag: 'Purchases inconsistent with customer profile or declared business activity', ref: 'FATF DPMS 2020 §4.2' },
      { flag: 'Immediate resale of purchased gold at a loss', ref: 'FATF DPMS 2020 §4.3' },
      { flag: 'Unusual urgency to complete transaction or pressure to bypass procedures', ref: 'FATF DPMS 2020 §4.2' },
      { flag: 'Payment by multiple unrelated third parties', ref: 'Wolfsberg ACSS 2019' },
      { flag: 'Transaction volume significantly above customer historical pattern', ref: 'FATF Rec.20' },
      { flag: 'Round number transactions repeated at regular intervals', ref: 'FATF DPMS 2020' },
    ],
    'Geography & Jurisdiction': [
      { flag: 'Customer or counterparty located in FATF Grey or Black List jurisdiction', ref: 'FATF Rec.19 | UAE FDL No.(10)/2025' },
      { flag: 'Transaction involves CAHRA (Conflict-Affected or High-Risk Area)', ref: 'LBMA RGG v9 Step 2 | OECD Due Diligence §4' },
      { flag: 'Gold origin from high-risk mining region without documentation', ref: 'LBMA RGG v9 Step 3 | OECD §4' },
      { flag: 'Shipment route inconsistent with declared origin or destination', ref: 'Wolfsberg ACSS 2019 | FATF TPML' },
      { flag: 'Involvement of jurisdiction subject to UAE or international sanctions', ref: 'UAE Cabinet Resolution 74/2020 | UNSCR' },
      { flag: 'Customer recently relocated from high-risk jurisdiction without explanation', ref: 'FATF DPMS 2020 §4.3' },
    ],
    'Supply Chain (LBMA)': [
      { flag: 'Supplier unable to provide chain of custody documentation', ref: 'LBMA RGG v9 Step 2' },
      { flag: 'Gold assay or hallmarking inconsistency', ref: 'LBMA RGG v9 Step 1' },
      { flag: 'Refinery not on LBMA Good Delivery List or equivalent', ref: 'LBMA RGG v9 Step 3' },
      { flag: 'Supplier previously flagged for CAHRA or conflict mineral links', ref: 'LBMA RGG v9 Step 2 | OECD §5' },
      { flag: 'Documentary inconsistency between origin, weight, and assay certificates', ref: 'LBMA RGG v9 Step 2' },
      { flag: 'Supplier relationship lacks contractual AML/CFT representations', ref: 'LBMA RGG v9 Step 3' },
    ],
    'Terrorism & Proliferation Financing': [
      { flag: 'Customer linked to known terrorist individual, group or state sponsor', ref: 'UAE Cabinet Resolution 74/2020 | FATF Rec.5-8' },
      { flag: 'Transaction with UNSC designated person or entity', ref: 'UNSCR | UAE FDL No.(10)/2025 Art.14' },
      { flag: 'Gold used as payment/barter in context with TF typology', ref: 'FATF TF Guidance 2019' },
      { flag: 'Customer references dual-use goods, restricted technology, or arms', ref: 'FATF Rec.7 | UNSCR 1540' },
      { flag: 'Transaction linked to jurisdiction under proliferation financing sanctions', ref: 'UAE Cabinet Resolution 74/2020 | FATF Rec.7' },
      { flag: 'Unusual interest in anti-detection or counter-surveillance', ref: 'FATF TF Guidance 2019' },
    ],
    'Trade-Based Money Laundering': [
      { flag: 'Invoice price significantly above or below market gold price', ref: 'Wolfsberg ACSS 2019 | FATF TBML Guidance' },
      { flag: 'Over- or under-shipment: quantity received differs from documentation', ref: 'FATF TBML Guidance 2020' },
      { flag: 'Multiple invoicing of same shipment', ref: 'FATF TBML Guidance 2020' },
      { flag: 'Complex back-to-back trade finance with no clear commercial rationale', ref: 'Wolfsberg ACSS 2019' },
      { flag: 'Goods description in shipping documents inconsistent with gold trading', ref: 'FATF TBML Guidance 2020' },
    ],
  };

  function renderRedFlags() {
    const el = document.getElementById('suite-content-redflags');
    if (!el) return;
    el.innerHTML = `
      <div class="card">
        <div class="top-bar">
          <span class="sec-title">🚩 Red Flag Library — DPMS Gold Trading</span>
          <span style="font-size:11px;color:var(--muted)">FATF DPMS 2020 | UAE FDL No.(10) of 2025 | LBMA RGG v9 | Wolfsberg ACSS</span>
        </div>
        <input type="text" id="rf-search" placeholder="Search red flags..." oninput="suiteFilterRedFlags(this.value)" style="margin-bottom:1rem"/>
        <div id="rf-results">
          ${Object.entries(RED_FLAGS_DB).map(([cat, flags]) => `
            <div class="card" style="margin-bottom:1rem;padding:1rem">
              <div class="sec-title" style="margin-bottom:10px">${cat}</div>
              ${flags.map(f => `
                <div class="rf-item" data-text="${f.flag.toLowerCase()}" style="padding:10px;border-radius:8px;border:1px solid var(--border);margin-bottom:6px;background:var(--surface2)">
                  <div style="font-size:13px;font-weight:500;margin-bottom:4px">🚩 ${f.flag}</div>
                  <div style="font-size:11px;color:var(--gold);font-family:'DM Mono',monospace">${f.ref}</div>
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  global.suiteFilterRedFlags = function(query) {
    const q = query.toLowerCase();
    document.querySelectorAll('.rf-item').forEach(item => {
      item.style.display = !q || item.dataset.text.includes(q) ? '' : 'none';
    });
  };

  // ════════════════════════════════════════════════════════════════════════════
  // 6. APPROVAL MATRIX (FOUR-EYES)
  // Reg: UAE FDL No.(10) of 2025 | CBUAE AML Standards | Best Practice
  // ════════════════════════════════════════════════════════════════════════════

  const APPROVAL_TYPES = [
    { type: 'PEP Onboarding', sla: 48, desc: 'Senior Management approval required for PEP onboarding. UAE FDL No.(10)/2025 Art.16' },
    { type: 'High-Risk Customer Onboarding', sla: 24, desc: 'EDD sign-off required before relationship commences. UAE FDL No.(10)/2025 Art.14' },
    { type: 'Sanctions True Hit', sla: 2, desc: 'Immediate freeze and MLRO/Senior Management notification. UAE Cabinet Resolution 74/2020' },
    { type: 'STR/SAR Filing', sla: 24, desc: 'MLRO approval required before goAML submission. UAE FDL No.(10)/2025 Art.20' },
    { type: 'EDD Sign-Off', sla: 48, desc: 'Enhanced Due Diligence requires compliance sign-off.' },
    { type: 'Transaction Exception', sla: 4, desc: 'Unusual transaction above threshold requires approval before processing.' },
    { type: 'Customer Risk Upgrade', sla: 48, desc: 'Risk rating upgrade to High/Very High requires review.' },
    { type: 'Relationship Exit', sla: 72, desc: 'Exit of customer relationship requires documentation and approval.' },
  ];

  function renderApprovals() {
    const el = document.getElementById('suite-content-approvals2');
    if (!el) return;
    const records = load(SK.APPROVALS) || [];
    const pending = records.filter(r => r.status === 'Pending' || r.status === 'Under Review');

    el.innerHTML = `
      <div class="card">
        <div class="top-bar">
          <span class="sec-title">✅ Approval Matrix — Four-Eyes Control</span>
          <span style="font-size:11px;color:var(--muted)">UAE FDL No.(10) of 2025 | Senior Management Approval Requirements</span>
          <button class="btn btn-gold" style="width:auto;padding:8px 16px" onclick="suiteOpenApprovalForm()">+ New Approval Request</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:1rem">
          <div class="metric m-c"><div class="metric-num">${pending.length}</div><div class="metric-lbl">Pending</div></div>
          <div class="metric m-h"><div class="metric-num">${records.filter(r=>{ const h=(new Date()-new Date(r.createdAt))/3600000; return r.status==='Pending'&&h>r.slahours; }).length}</div><div class="metric-lbl">SLA Breached</div></div>
          <div class="metric m-ok"><div class="metric-num">${records.filter(r=>r.status==='Approved').length}</div><div class="metric-lbl">Approved</div></div>
          <div class="metric m-m"><div class="metric-num">${records.filter(r=>r.status==='Rejected').length}</div><div class="metric-lbl">Rejected</div></div>
        </div>

        <div class="sec-title" style="margin-bottom:10px">Approval Type Reference — SLA Requirements</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:1.5rem">
          ${APPROVAL_TYPES.map(a=>`
            <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px">
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
                  <button class="btn btn-sm btn-blue" onclick="suiteSyncApprovalToAsana(${i})">Asana</button>
                  <button class="btn btn-sm btn-red" onclick="suiteDeleteApproval(${i})">Del</button>
                </div>
              </div>
              ${r.rationale ? `<div class="rec" style="margin-top:8px">${r.rationale}</div>` : ''}
              ${r.decision ? `<div style="font-size:12px;color:var(--muted);margin-top:6px">Decision: ${r.decision} | By: ${r.decidedBy} | ${fmtDate(r.decidedAt)}</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>

      <!-- Approval Form Modal -->
      <div class="modal-overlay" id="approvalModal">
        <div class="modal" style="max-width:520px;width:95%">
          <button class="modal-close" onclick="document.getElementById('approvalModal').classList.remove('open')">✕</button>
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
            <button class="btn btn-gold" onclick="suiteSaveApproval()" style="flex:1">Submit for Approval</button>
            <button class="btn btn-sm" onclick="document.getElementById('approvalModal').classList.remove('open')" style="padding:12px 20px">Cancel</button>
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
    if (!type || !subject) { toast('Type and subject are required', 'error'); return; }
    const slaEntry = APPROVAL_TYPES.find(a => a.type === type);
    const records = load(SK.APPROVALS) || [];
    const record = {
      id: uid('APR'),
      approvalType: type,
      subject,
      requestedBy: document.getElementById('approval-requester').value,
      approver: document.getElementById('approval-approver').value,
      rationale: document.getElementById('approval-rationale').value,
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

  global.suiteDecideApproval = function(idx, decision) {
    const name = prompt(`Enter your name to confirm ${decision}:`);
    if (!name) return;
    const records = load(SK.APPROVALS) || [];
    records[idx].status = decision;
    records[idx].decision = decision;
    records[idx].decidedBy = name;
    records[idx].decidedAt = new Date().toISOString();
    save(SK.APPROVALS, records);
    toast(`Decision recorded: ${decision}`, decision==='Approved'?'success':'error');
    renderApprovals();
  };

  global.suiteDeleteApproval = function(idx) {
    if (!confirm('Delete this approval record?')) return;
    const records = load(SK.APPROVALS) || [];
    records.splice(idx, 1);
    save(SK.APPROVALS, records);
    renderApprovals();
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
      obligations: ['DNFBP registration with MoE','Annual risk assessment submission','CDD per Art.12-16','TFS per Cabinet Resolution 74/2020','STR via goAML within 30 days','LBMA RGG v9 for gold sourcing','Record retention 5 years minimum'],
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
    { framework: 'UAE FDL No.(10) of 2025', area: 'Primary AML/CFT', articles: 'Art.1-30', applicability: 'All UAE entities', lastUpdated: '2025', status: 'Active' },
    { framework: 'UAE Cabinet Resolution No.(10) of 2019', area: 'Beneficial Ownership', articles: 'Full', applicability: 'All UAE entities', lastUpdated: '2019', status: 'Active' },
    { framework: 'UAE Cabinet Resolution No.(74) of 2020', area: 'TFS/Sanctions', articles: 'Full', applicability: 'All UAE entities', lastUpdated: '2020', status: 'Active' },
    { framework: 'FATF Recommendations (2023)', area: 'International Standards', articles: 'Rec. 1-40', applicability: 'FATF Members', lastUpdated: '2023', status: 'Active' },
    { framework: 'FATF DPMS Guidance 2020', area: 'Precious Metals', articles: 'Full', applicability: 'DPMS entities', lastUpdated: '2020', status: 'Active' },
    { framework: 'LBMA RGG v9', area: 'Gold Supply Chain', articles: 'Steps 1-5', applicability: 'Gold dealers/refiners', lastUpdated: '2023', status: 'Active' },
    { framework: 'OECD Due Diligence (Minerals)', area: 'Supply Chain', articles: 'Full', applicability: 'CAHRA exposure', lastUpdated: '2016', status: 'Active' },
    { framework: 'Wolfsberg ACSS 2019', area: 'Trade Finance/AML', articles: 'Full', applicability: 'Trade finance', lastUpdated: '2019', status: 'Active' },
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
          <div style="background:var(--surface2);border-radius:8px;padding:10px">
            <div style="font-size:11px;color:var(--muted);font-family:'DM Mono',monospace">SUPERVISOR</div>
            <div style="font-size:14px;font-weight:600;margin-top:4px;color:var(--gold)">${jRules.supervisor||'—'}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">${jRules.primaryLaw||'—'}</div>
          </div>
        </div>
        <div style="margin-top:1rem">
          <div class="sec-title" style="margin-bottom:8px">Key Obligations — ${jurisdiction}</div>
          ${(jRules.obligations||[]).map(o=>`<div style="padding:8px 12px;background:var(--surface2);border-left:3px solid var(--gold);border-radius:0 6px 6px 0;margin-bottom:6px;font-size:13px">✓ ${o}</div>`).join('')}
        </div>
      </div>

      <div class="card" style="margin-bottom:1.2rem">
        <div class="sec-title" style="margin-bottom:10px">Applicable Regulatory Frameworks</div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="border-bottom:1px solid var(--border)">
              ${['Framework','Area','Provision','Applicability','Status'].map(h=>`<th style="text-align:left;padding:8px;color:var(--muted);font-family:'DM Mono',monospace;font-size:11px">${h}</th>`).join('')}
            </tr></thead>
            <tbody>
              ${REGULATORY_FRAMEWORK.map(r=>`
                <tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:8px;font-weight:500;color:var(--gold)">${r.framework}</td>
                  <td style="padding:8px">${r.area}</td>
                  <td style="padding:8px;font-family:'DM Mono',monospace;font-size:11px">${r.articles}</td>
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
          <button class="btn btn-gold" style="width:auto;padding:8px 16px" onclick="suiteAddRegChange()">+ Log Change</button>
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
              <button class="btn btn-sm btn-red" onclick="suiteDeleteRegChange(${i})">Del</button>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Reg Change Modal -->
      <div class="modal-overlay" id="regchangeModal">
        <div class="modal" style="max-width:500px;width:95%">
          <button class="modal-close" onclick="document.getElementById('regchangeModal').classList.remove('open')">✕</button>
          <div class="modal-title">Log Regulatory Change</div>
          <div><span class="lbl">Framework / Regulation</span><input id="rc-framework" placeholder="e.g. UAE FDL No.(10) of 2025"/></div>
          <div><span class="lbl">Change Type</span>
            <select id="rc-type"><option>New Regulation</option><option>Amendment</option><option>New Guidance</option><option>FATF Update</option><option>Supervisor Circular</option><option>Other</option></select>
          </div>
          <div><span class="lbl">Description *</span><textarea id="rc-desc" style="min-height:80px" placeholder="Describe the regulatory change and its requirements..."></textarea></div>
          <div class="row row-2">
            <div><span class="lbl">Effective Date</span><input type="date" id="rc-date"/></div>
            <div><span class="lbl">Impacted Controls/Documents</span><input id="rc-controls" placeholder="e.g. Compliance Manual, EWRA, CDD procedure"/></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:1rem">
            <button class="btn btn-gold" onclick="suiteSaveRegChange()" style="flex:1">Save</button>
            <button class="btn btn-sm" onclick="document.getElementById('regchangeModal').classList.remove('open')" style="padding:12px 20px">Cancel</button>
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
    console.log('[ComplianceSuite] v2.0.0 initialized — UAE AML/CFT modules loaded');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 200);
  }

})(window);

// ════════════════════════════════════════════════════════════════════════════
// COMPLIANCE SUITE EXTENSION v2.1 — UAE AML/CFT COMPLIANCE FIXES
// Adds: Full TFS UAE workflow, DPMSR threshold, CDD hard stops,
//       UBO freshness, AI governance, record retention, linked transactions
// Regulatory: Cabinet Resolution No.(134) of 2025 | Cabinet Decision 74/2020
//             EOCN TFS Guidance | MoE Circular 08/AML/2021
// ════════════════════════════════════════════════════════════════════════════

(function(global) {
  'use strict';

  function load(key) { try { return JSON.parse(localStorage.getItem(key)||'null'); } catch{return null;} }
  function save(key,val) { try { localStorage.setItem(key,JSON.stringify(val)); } catch(e){} }
  function today() { return new Date().toISOString().slice(0,10); }
  function fmtDate(d) { if(!d) return '—'; return new Date(d).toLocaleDateString('en-GB'); }
  function addBusinessDays(date, days) {
    const d = new Date(date);
    let added = 0;
    while (added < days) { d.setDate(d.getDate()+1); if(d.getDay()!==0&&d.getDay()!==6) added++; }
    return d.toISOString().slice(0,10);
  }
  function toast(msg,type) { if(global.toast) global.toast(msg,type); }

  const SK2 = {
    TFS2:    'fgl_tfs2_v1',
    DPMSR:   'fgl_dpmsr_v1',
    RETAIN:  'fgl_retention_v1',
    AILOG:   'fgl_ailog_v1',
    LINKED:  'fgl_linked_txn_v1',
  };

  // ── INJECT NEW TABS ─────────────────────────────────────────────────────────
  const SUITE2_TABS = [
    { id: 'tfs2',    icon: '🇦🇪', label: 'TFS UAE',   title: 'Full UAE TFS Workflow' },
    { id: 'dpmsr',   icon: '📊', label: 'DPMSR',      title: 'DPMSR Threshold Reporting' },
    { id: 'retention', icon: '🗄️', label: 'Retention', title: 'Record Retention — Art.25' },
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
      el.innerHTML = `${t.icon} ${t.label}`;
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
    return `<span style="background:${col}22;color:${col};border:1px solid ${col}44;border-radius:5px;padding:2px 8px;font-size:10px;font-family:'DM Mono',monospace">${status}</span>`;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TFS2 — FULL UAE TFS WORKFLOW
  // Reg: Cabinet Decision No.(74) of 2020 | EOCN TFS Guidance
  // 4 Outcomes: Confirmed Match, Partial Match, False Positive, Negative
  // CNMR within 5 business days | Freeze within 24 hours | goAML FFR
  // ════════════════════════════════════════════════════════════════════════════

  function renderTFS2() {
    const el = document.getElementById('suite2-content-tfs2');
    if (!el) return;
    const events = load(SK2.TFS2)||[];

    el.innerHTML = `
    <div class="card" style="margin-bottom:1.2rem">
      <div class="top-bar">
        <span class="sec-title">🇦🇪 UAE TFS Workflow — Full 4-Outcome Process</span>
        <span style="font-size:11px;color:var(--muted)">Cabinet Decision No.(74) of 2020 | EOCN Executive Office TFS Guidance</span>
        <button class="btn btn-gold" style="width:auto;padding:8px 16px" onclick="suite2OpenTFSForm()">+ New Screening Event</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:1rem">
        <div style="background:var(--surface2);border-radius:10px;padding:14px;border-left:3px solid var(--gold)">
          <div class="sec-title" style="margin-bottom:8px;border:none;padding:0">MANDATORY UAE Lists</div>
          <div style="font-size:12px;margin-bottom:6px">✅ <strong>UAE Local Terrorist List</strong> — EOCN / Executive Office</div>
          <div style="font-size:12px;margin-bottom:6px">✅ <strong>UNSC Consolidated Sanctions List</strong> — UN Security Council</div>
          <div style="font-size:11px;color:var(--muted);margin-top:8px;font-family:'DM Mono',monospace">Cabinet Decision No.(74)/2020 — These two lists are legally mandatory for all UAE reporting entities. Failure to screen constitutes a regulatory offence.</div>
        </div>
        <div style="background:var(--surface2);border-radius:10px;padding:14px;border-left:3px solid var(--blue)">
          <div class="sec-title" style="margin-bottom:8px;border:none;padding:0">ENHANCED CONTROLS (Not Legally Mandatory)</div>
          <div style="font-size:12px;margin-bottom:4px">⬜ OFAC SDN — US unilateral sanctions</div>
          <div style="font-size:12px;margin-bottom:4px">⬜ EU Consolidated Sanctions</div>
          <div style="font-size:12px;margin-bottom:4px">⬜ UK OFSI Consolidated</div>
          <div style="font-size:12px;margin-bottom:4px">⬜ Interpol Red Notices</div>
          <div style="font-size:11px;color:var(--muted);margin-top:8px;font-family:'DM Mono',monospace">EOCN Guidance — For non-UAE unilateral/multilateral lists, consult your supervisory authority for appropriate course of action.</div>
        </div>
      </div>

      <div style="background:rgba(217,79,79,0.08);border:1px solid rgba(217,79,79,0.25);border-radius:10px;padding:12px;margin-bottom:1rem;font-size:12px">
        <strong style="color:var(--red)">🔴 UAE TFS MANDATORY OBLIGATIONS ON CONFIRMED MATCH:</strong><br>
        <div style="margin-top:6px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div>1. <strong>Freeze assets immediately</strong> — within 24 hours — without prior notice to subject</div>
          <div>2. <strong>No tipping off</strong> — do not inform subject of freeze or report</div>
          <div>3. <strong>File FFR via goAML</strong> — Funds Freeze Report to UAE FIU</div>
          <div>4. <strong>Submit CNMR to EOCN</strong> — Confirmed Name Match Report within 5 business days</div>
        </div>
      </div>

      <div style="background:rgba(232,160,48,0.08);border:1px solid rgba(232,160,48,0.25);border-radius:10px;padding:12px;margin-bottom:1rem;font-size:12px">
        <strong style="color:var(--amber)">🟡 UAE TFS PARTIAL MATCH OBLIGATIONS:</strong><br>
        <div style="margin-top:6px">
          1. <strong>Suspend transaction</strong> — hold, do not proceed<br>
          2. <strong>Conduct enhanced verification</strong> — differentiate subject from listed person<br>
          3. <strong>Submit PNMR to EOCN</strong> — Partial Name Match Report within 5 business days<br>
          4. If match confirmed: treat as Confirmed Match above
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:1rem">
        <div class="metric m-c"><div class="metric-num">${events.filter(e=>e.outcome==='Confirmed Match').length}</div><div class="metric-lbl">Confirmed Matches</div></div>
        <div class="metric m-h"><div class="metric-num">${events.filter(e=>e.outcome==='Partial Match').length}</div><div class="metric-lbl">Partial Matches</div></div>
        <div class="metric m-ok"><div class="metric-num">${events.filter(e=>e.outcome==='Negative – No Match').length}</div><div class="metric-lbl">Cleared</div></div>
        <div class="metric m-m"><div class="metric-num">${events.filter(e=>e.cnmrStatus==='Pending'||e.pnmrStatus==='Pending').length}</div><div class="metric-lbl">Report Pending</div></div>
      </div>

      ${events.length===0?'<p style="color:var(--muted);font-size:13px;text-align:center;padding:2rem">No TFS screening events. Click "+ New Screening Event" to begin.</p>':''}
      ${events.map((e,i) => {
        const isConfirmed = e.outcome==='Confirmed Match';
        const isPartial = e.outcome==='Partial Match';
        const cnmrDeadline = e.screeningDate ? addBusinessDays(e.screeningDate, 5) : null;
        const cnmrOverdue = cnmrDeadline && new Date(cnmrDeadline)<new Date() && (e.cnmrStatus==='Pending');
        return `
        <div class="finding ${isConfirmed?'f-critical':isPartial?'f-high':'f-ok'}" style="margin-bottom:10px">
          <div class="f-head">
            <div class="f-head-left"><div>
              <div class="f-title">${e.screenedName} ${badge2(e.outcome)} ${cnmrOverdue?badge2('Overdue'):''}</div>
              <div class="f-body">Lists: ${e.listsScreened} | Event: ${e.eventType} | Date: ${fmtDate(e.screeningDate)}</div>
              ${isConfirmed?`<div class="f-ref">Freeze: ${e.frozenWithin24h||'Not confirmed'} | FFR: ${e.ffrFiled||'Pending'} | CNMR: ${e.cnmrStatus||'Pending'} (deadline: ${fmtDate(cnmrDeadline)})</div>`:''}
              ${isPartial?`<div class="f-ref">Transaction Suspended: ${e.txSuspended||'Pending'} | PNMR: ${e.pnmrStatus||'Pending'} (deadline: ${fmtDate(cnmrDeadline)})</div>`:''}
              <div class="f-ref">Reviewer: ${e.reviewedBy||'—'} | Ref: ${e.id}</div>
            </div></div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-sm" onclick="suite2EditTFS(${i})">View/Edit</button>
              <button class="btn btn-sm btn-red" onclick="suite2DeleteTFS(${i})">Delete</button>
            </div>
          </div>
          ${e.notes?`<div class="rec">${e.notes}</div>`:''}
        </div>`;
      }).join('')}
    </div>

    <!-- TFS2 Modal -->
    <div class="modal-overlay" id="tfs2Modal">
      <div class="modal" style="max-width:680px;width:95%;max-height:92vh">
        <button class="modal-close" onclick="document.getElementById('tfs2Modal').classList.remove('open')">✕</button>
        <div class="modal-title">UAE TFS Screening Event</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:1rem;font-family:'DM Mono',monospace">Cabinet Decision No.(74) of 2020 | EOCN TFS Guidance | Mandatory: UAE Local Terrorist List + UNSC Consolidated List</div>
        <input type="hidden" id="tfs2-edit-idx" value="-1">

        <div class="row row-2">
          <div><span class="lbl">Name Screened *</span><input id="tfs2-name" placeholder="Full legal name of individual or entity"/></div>
          <div><span class="lbl">Screening Event Type *</span>
            <select id="tfs2-event"><option>New Customer Onboarding</option><option>Periodic Rescreening</option><option>List Update Trigger</option><option>Transaction Pre-Approval</option><option>Supplier/Refinery Onboarding</option><option>UBO Screening</option><option>Ad Hoc Review</option></select>
          </div>
        </div>
        <div><span class="lbl">Lists Screened (tick all that apply)</span>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;background:var(--surface2);padding:10px;border-radius:8px;border:1px solid var(--border);margin-top:4px">
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" id="tfs2-list-uae" style="width:auto" checked/> 🇦🇪 UAE Local Terrorist List (EOCN) <span style="color:var(--red);font-size:10px">MANDATORY</span></label>
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" id="tfs2-list-un" style="width:auto" checked/> 🌐 UNSC Consolidated Sanctions List <span style="color:var(--red);font-size:10px">MANDATORY</span></label>
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" id="tfs2-list-ofac" style="width:auto"/> 🇺🇸 OFAC SDN (Enhanced)</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" id="tfs2-list-eu" style="width:auto"/> 🇪🇺 EU Consolidated (Enhanced)</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" id="tfs2-list-uk" style="width:auto"/> 🇬🇧 UK OFSI (Enhanced)</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" id="tfs2-list-interpol" style="width:auto"/> 🔵 Interpol Red Notices (Enhanced)</label>
          </div>
        </div>
        <div class="row row-2" style="margin-top:10px">
          <div><span class="lbl">Screening Date *</span><input type="date" id="tfs2-date" value="${today()}"/></div>
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
                onclick="suite2SelectOutcome('${o.val}')"
                style="background:var(--surface2);border:2px solid var(--border);color:var(--text);font-size:11px;padding:10px 6px">
                ${o.icon} ${o.val}
              </button>
            `).join('')}
          </div>
          <input type="hidden" id="tfs2-outcome" value=""/>
        </div>

        <!-- FALSE POSITIVE SECTION -->
        <div id="tfs2-fp-section" style="display:none;margin-top:10px">
          <div style="background:rgba(61,168,118,0.1);border:1px solid rgba(61,168,118,0.3);border-radius:10px;padding:12px">
            <div style="color:var(--green);font-weight:600;font-size:13px;margin-bottom:8px">⚪ FALSE POSITIVE — Differentiation Required</div>
            <div><span class="lbl">Differentiation Basis *</span>
              <select id="tfs2-fp-basis"><option value="">Select</option><option>Different date of birth confirmed</option><option>Different nationality confirmed</option><option>Different gender confirmed</option><option>Name spelling variation — different person</option><option>ID document verification confirms different person</option><option>Other</option></select>
            </div>
            <div style="margin-top:8px"><span class="lbl">Supporting Evidence</span><input id="tfs2-fp-evidence" placeholder="Document reference confirming differentiation"/></div>
          </div>
        </div>

        <!-- PARTIAL MATCH SECTION -->
        <div id="tfs2-partial-section" style="display:none;margin-top:10px">
          <div style="background:rgba(232,160,48,0.1);border:1px solid rgba(232,160,48,0.3);border-radius:10px;padding:12px">
            <div style="color:var(--amber);font-weight:600;font-size:13px;margin-bottom:8px">🟡 PARTIAL MATCH — PNMR Required within 5 Business Days</div>
            <div class="row row-2">
              <div><span class="lbl">Transaction Suspended?</span>
                <select id="tfs2-tx-suspended"><option value="">Select</option><option>Yes – Transaction Suspended</option><option>No Transaction Involved</option></select>
              </div>
              <div><span class="lbl">PNMR Deadline</span><input type="date" id="tfs2-pnmr-deadline" readonly style="opacity:0.7"/></div>
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
          <div style="background:rgba(217,79,79,0.1);border:1px solid rgba(217,79,79,0.4);border-radius:10px;padding:12px">
            <div style="color:var(--red);font-weight:700;font-size:13px;margin-bottom:8px">🔴 CONFIRMED MATCH — IMMEDIATE ACTION REQUIRED</div>
            <div style="font-size:12px;color:var(--muted);margin-bottom:10px;font-family:'DM Mono',monospace">Cabinet Decision 74/2020 | EOCN TFS Guidance | Freeze within 24h | CNMR within 5 business days</div>
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
              <div><span class="lbl">CNMR Deadline (5 business days)</span><input type="date" id="tfs2-cnmr-deadline" readonly style="opacity:0.7"/></div>
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
          <button class="btn btn-gold" onclick="suite2SaveTFS()" style="flex:1">Save Screening Event</button>
          <button class="btn btn-sm" onclick="document.getElementById('tfs2Modal').classList.remove('open')" style="padding:12px 20px">Cancel</button>
        </div>
      </div>
    </div>`;

    // Wire date change to calculate CNMR/PNMR deadlines
    setTimeout(() => {
      const d = document.getElementById('tfs2-date');
      if (d) d.addEventListener('change', function() {
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

  global.suite2OpenTFSForm = function() {
    document.getElementById('tfs2-edit-idx').value = '-1';
    ['tfs2-name','tfs2-reviewer','tfs2-notes','tfs2-fp-evidence','tfs2-pnmr-ref','tfs2-ffr-ref','tfs2-cnmr-ref'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
    ['tfs2-fp-basis','tfs2-tx-suspended','tfs2-pnmr-status','tfs2-frozen','tfs2-ffr','tfs2-cnmr-status','tfs2-supervisor','tfs2-mlro','tfs2-mgmt'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
    ['tfs2-list-uae','tfs2-list-un'].forEach(id=>{const e=document.getElementById(id);if(e)e.checked=true;});
    ['tfs2-list-ofac','tfs2-list-eu','tfs2-list-uk','tfs2-list-interpol'].forEach(id=>{const e=document.getElementById(id);if(e)e.checked=false;});
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

  global.suite2SaveTFS = function() {
    const name = document.getElementById('tfs2-name').value.trim();
    const outcome = document.getElementById('tfs2-outcome').value;
    if (!name) { toast('Screened name is required','error'); return; }
    if (!outcome) { toast('Select a screening outcome','error'); return; }
    const lists = [];
    if (document.getElementById('tfs2-list-uae')?.checked) lists.push('UAE Local Terrorist List (EOCN)');
    if (document.getElementById('tfs2-list-un')?.checked) lists.push('UNSC Consolidated');
    if (document.getElementById('tfs2-list-ofac')?.checked) lists.push('OFAC SDN');
    if (document.getElementById('tfs2-list-eu')?.checked) lists.push('EU Consolidated');
    if (document.getElementById('tfs2-list-uk')?.checked) lists.push('UK OFSI');
    if (document.getElementById('tfs2-list-interpol')?.checked) lists.push('Interpol');
    const events = load(SK2.TFS2)||[];
    const editIdx = parseInt(document.getElementById('tfs2-edit-idx').value);
    const record = {
      id: editIdx>=0 ? events[editIdx].id : `TFS2-${Date.now()}`,
      screenedName: name,
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
    };
    if (editIdx>=0) { events[editIdx]=record; } else { events.unshift(record); }
    save(SK2.TFS2, events);
    document.getElementById('tfs2Modal').classList.remove('open');
    if (outcome==='Confirmed Match') toast('🔴 CONFIRMED MATCH saved — ensure freeze, FFR, and CNMR obligations are met within deadlines','error');
    else if (outcome==='Partial Match') toast('🟡 PARTIAL MATCH saved — PNMR must be filed within 5 business days','info');
    else toast('TFS event saved — '+outcome,'success');
    renderTFS2();
  };

  global.suite2DeleteTFS = function(idx) {
    if (!confirm('Delete this TFS screening event?')) return;
    const events = load(SK2.TFS2)||[];
    events.splice(idx,1);
    save(SK2.TFS2, events);
    renderTFS2();
  };

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
        <span class="sec-title">📊 DPMSR — Threshold Reporting & Linked Transaction Detection</span>
        <span style="font-size:11px;color:var(--muted)">MoE Circular 08/AML/2021 | AED 55,000 Threshold | Cabinet Resolution 134/2025 Art.13</span>
        <button class="btn btn-gold" style="width:auto;padding:8px 16px" onclick="suite2OpenDPMSRForm()">+ New Threshold Case</button>
      </div>

      <div style="background:var(--surface2);border-radius:10px;padding:14px;margin-bottom:1rem">
        <div class="sec-title" style="margin-bottom:10px;border:none;padding:0">AED 55,000 Threshold — Mandatory CDD Requirements</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;font-size:12px">
          <div style="background:var(--surface);border-radius:8px;padding:10px;border-left:3px solid var(--gold)">
            <div style="font-weight:600;margin-bottom:6px">Resident Individual</div>
            <div>✅ Emirates ID or valid residence permit</div>
            <div>✅ Transaction amount and date</div>
            <div>✅ Payment method</div>
            <div style="color:var(--muted);font-size:11px;margin-top:6px">Cash transactions ≥ AED 55,000</div>
          </div>
          <div style="background:var(--surface);border-radius:8px;padding:10px;border-left:3px solid var(--blue)">
            <div style="font-weight:600;margin-bottom:6px">Non-Resident Individual</div>
            <div>✅ Passport copy (valid)</div>
            <div>✅ Country of residence</div>
            <div>✅ Transaction amount and date</div>
            <div style="color:var(--muted);font-size:11px;margin-top:6px">Cash transactions ≥ AED 55,000</div>
          </div>
          <div style="background:var(--surface);border-radius:8px;padding:10px;border-left:3px solid var(--amber)">
            <div style="font-weight:600;margin-bottom:6px">Entity / Company</div>
            <div>✅ Trade licence (valid)</div>
            <div>✅ Company representative ID</div>
            <div>✅ Authorization document</div>
            <div style="color:var(--muted);font-size:11px;margin-top:6px">Cash or wire transfer ≥ AED 55,000</div>
          </div>
        </div>
        <div style="margin-top:10px;font-size:12px;color:var(--amber);font-family:'DM Mono',monospace">
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
              <div class="f-title">${c.customerName} — AED ${Number(c.amount||0).toLocaleString()} ${c.cddComplete==='Incomplete'?'<span style="color:var(--red);font-size:11px">⛔ CDD INCOMPLETE</span>':''}</div>
              <div class="f-body">Type: ${c.customerType} | Payment: ${c.paymentMethod} | Date: ${fmtDate(c.txDate)}</div>
              <div class="f-ref">DPMSR: ${c.reportingRequired} | Linked: ${c.linkedFlag||'No'} | Filed: ${c.dpmsr_filed||'No'}</div>
            </div></div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-sm" onclick="suite2EditDPMSR(${i})">Edit</button>
              <button class="btn btn-sm btn-red" onclick="suite2DeleteDPMSR(${i})">Delete</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>

    <!-- DPMSR Modal -->
    <div class="modal-overlay" id="dpmsrModal">
      <div class="modal" style="max-width:620px;width:95%">
        <button class="modal-close" onclick="document.getElementById('dpmsrModal').classList.remove('open')">✕</button>
        <div class="modal-title">DPMSR Threshold Case</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:1rem;font-family:'DM Mono',monospace">MoE Circular 08/AML/2021 | AED 55,000 Threshold | goAML DPMSR Reporting</div>
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
          <div><span class="lbl">Transaction Date *</span><input type="date" id="dpmsr-txdate" value="${today()}"/></div>
        </div>
        <div class="row row-2">
          <div><span class="lbl">Payment Method *</span>
            <select id="dpmsr-payment"><option value="">Select</option><option>Cash</option><option>Bank Transfer / Wire</option><option>Cheque</option><option>Card</option><option>Crypto</option><option>Mixed</option></select>
          </div>
          <div><span class="lbl">Transaction Type</span>
            <select id="dpmsr-txtype"><option>Purchase of Gold</option><option>Sale of Gold</option><option>Exchange</option><option>Consignment</option><option>Other</option></select>
          </div>
        </div>

        <div id="dpmsr-threshold-alert" style="display:none;background:rgba(232,160,48,0.12);border:1px solid rgba(232,160,48,0.4);border-radius:10px;padding:10px;margin:10px 0;font-size:12px;color:var(--amber);font-family:'DM Mono',monospace">
          ⚠️ AED 55,000 THRESHOLD TRIGGERED — CDD documentation and DPMSR filing required
        </div>

        <div class="sec-title" style="margin-top:10px;margin-bottom:8px">CDD Requirements — Based on Customer Type</div>
        <div id="dpmsr-cdd-requirements" style="background:var(--surface2);border-radius:8px;padding:10px;font-size:12px;margin-bottom:10px">
          Select customer type above to see required CDD documents.
        </div>

        <div class="row row-2">
          <div><span class="lbl">ID Document Reference</span><input id="dpmsr-id-ref" placeholder="Emirates ID / Passport number"/></div>
          <div><span class="lbl">ID Expiry Date</span><input type="date" id="dpmsr-id-expiry"/></div>
        </div>
        <div id="dpmsr-entity-fields" style="display:none">
          <div class="row row-2">
            <div><span class="lbl">Trade Licence Number *</span><input id="dpmsr-trade-licence" placeholder="Trade licence number"/></div>
            <div><span class="lbl">Trade Licence Expiry</span><input type="date" id="dpmsr-trade-expiry"/></div>
          </div>
          <div><span class="lbl">Company Representative Name</span><input id="dpmsr-rep-name" placeholder="Name of authorized representative"/></div>
        </div>

        <div style="background:var(--surface2);border-radius:10px;padding:12px;margin-top:10px">
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
        <div id="dpmsr-cdd-warning" style="display:none;background:rgba(217,79,79,0.1);border:1px solid rgba(217,79,79,0.3);border-radius:8px;padding:10px;margin-top:6px;font-size:12px;color:var(--red)">
          ⛔ HARD STOP — Cabinet Resolution 134/2025 Art.14: The business relationship or transaction cannot proceed where CDD cannot be applied. Do not complete this transaction until CDD is obtained.
        </div>
        <div><span class="lbl">Notes</span><textarea id="dpmsr-notes" style="min-height:60px" placeholder="Additional context, source of funds notes, escalation notes..."></textarea></div>

        <div style="display:flex;gap:8px;margin-top:1rem">
          <button class="btn btn-gold" onclick="suite2SaveDPMSR()" style="flex:1">Save Threshold Case</button>
          <button class="btn btn-sm" onclick="document.getElementById('dpmsrModal').classList.remove('open')" style="padding:12px 20px">Cancel</button>
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
    if (amount >= 55000) {
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
    const cddStatus = document.getElementById('dpmsr-cdd-complete').value;
    if(cddStatus==='Incomplete'&&parseFloat(amount)>=55000){
      if(!confirm('⛔ CDD is incomplete. Cabinet Resolution 134/2025 Art.14 prohibits proceeding without CDD. Save record for follow-up?'))return;
    }
    const cases = load(SK2.DPMSR)||[];
    const editIdx = parseInt(document.getElementById('dpmsr-edit-idx').value);
    const record = {
      id: editIdx>=0?cases[editIdx].id:`DPMSR-${Date.now()}`,
      customerName:name, customerType:type, amount:parseFloat(amount),
      txDate:document.getElementById('dpmsr-txdate').value,
      paymentMethod:document.getElementById('dpmsr-payment').value,
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
      updatedAt:new Date().toISOString(),
    };
    if(editIdx>=0){cases[editIdx]=record;}else{cases.unshift(record);}
    save(SK2.DPMSR,cases);
    document.getElementById('dpmsrModal').classList.remove('open');
    toast(`DPMSR case saved — ${name} AED ${Number(amount).toLocaleString()}`,'success');
    renderDPMSR();
  };

  global.suite2DeleteDPMSR = function(idx) {
    if(!confirm('Delete this DPMSR case?'))return;
    const cases=load(SK2.DPMSR)||[];
    cases.splice(idx,1);
    save(SK2.DPMSR,cases);
    renderDPMSR();
  };

  // ════════════════════════════════════════════════════════════════════════════
  // RECORD RETENTION — STATUTORY 5-YEAR REQUIREMENT
  // Reg: Cabinet Resolution 134/2025 Art.25 | UAE FDL No.(10) of 2025
  // ════════════════════════════════════════════════════════════════════════════

  const RETENTION_CATEGORIES = [
    { cat:'CDD Files', period:5, basis:'Cabinet Resolution 134/2025 Art.25(1)' },
    { cat:'Transaction Records', period:5, basis:'Cabinet Resolution 134/2025 Art.25(2)' },
    { cat:'STR / SAR Files', period:10, basis:'Best practice — UAE FIU guidance' },
    { cat:'Risk Assessment Records', period:5, basis:'Cabinet Resolution 134/2025 Art.25' },
    { cat:'Business Correspondence', period:5, basis:'Cabinet Resolution 134/2025 Art.25(3)' },
    { cat:'Training Records', period:5, basis:'UAE FDL No.(10) of 2025 Art.16' },
    { cat:'Internal Audit Reports', period:5, basis:'Cabinet Resolution 134/2025 Art.25' },
    { cat:'LBMA Supply Chain Files', period:5, basis:'LBMA RGG v9 Step 2 | OECD §5' },
    { cat:'UBO / Beneficial Ownership Records', period:5, basis:'Cabinet Decision 109/2023 Art.38' },
    { cat:'goAML Submission Files', period:5, basis:'UAE FIU Guidance' },
  ];

  function renderRetention() {
    const el = document.getElementById('suite2-content-retention');
    if(!el) return;
    const records = load(SK2.RETAIN)||[];
    el.innerHTML = `
    <div class="card">
      <div class="top-bar">
        <span class="sec-title">🗄️ Record Retention Register</span>
        <span style="font-size:11px;color:var(--muted)">Cabinet Resolution 134/2025 Art.25 — Minimum 5 years | Records must enable transaction reconstruction</span>
        <button class="btn btn-gold" style="width:auto;padding:8px 16px" onclick="suite2AddRetentionRecord()">+ Add Record</button>
      </div>
      <div style="background:var(--surface2);border-radius:10px;padding:12px;margin-bottom:1rem;font-size:12px">
        <strong>Art.25 Requirements:</strong> Records must be retained for minimum 5 years. Records must be organized so individual transactions can be reconstructed and provided promptly to competent authorities upon request. STR files — best practice is 10 years minimum.
      </div>
      <div class="sec-title" style="margin-bottom:10px">Statutory Retention Schedule</div>
      <div style="overflow-x:auto;margin-bottom:1.5rem">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="border-bottom:1px solid var(--border)">
            ${['Record Category','Retention Period','Regulatory Basis'].map(h=>`<th style="text-align:left;padding:8px;color:var(--muted);font-family:'DM Mono',monospace;font-size:11px">${h}</th>`).join('')}
          </tr></thead>
          <tbody>
            ${RETENTION_CATEGORIES.map(r=>`<tr style="border-bottom:1px solid var(--border)">
              <td style="padding:8px;font-weight:500">${r.cat}</td>
              <td style="padding:8px;color:var(--gold);font-family:'DM Mono',monospace">${r.period} years</td>
              <td style="padding:8px;font-size:11px;color:var(--muted)">${r.basis}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="sec-title" style="margin-bottom:10px">Record Inventory</div>
      ${records.length===0?'<p style="color:var(--muted);font-size:13px;text-align:center;padding:1rem">No records logged.</p>':''}
      ${records.map((r,i)=>{
        const expiry = new Date(r.createdDate);
        expiry.setFullYear(expiry.getFullYear()+r.retentionYears);
        const daysLeft = Math.floor((expiry-new Date())/86400000);
        const status = daysLeft<0?'Overdue':daysLeft<90?'Due Soon':'Current';
        return `<div class="finding ${status==='Overdue'?'f-critical':status==='Due Soon'?'f-high':'f-ok'}" style="margin-bottom:8px">
          <div class="f-head">
            <div class="f-head-left"><div>
              <div class="f-title">${r.recordName} ${badge2(status)}</div>
              <div class="f-body">Category: ${r.category} | Created: ${fmtDate(r.createdDate)} | Expires: ${fmtDate(expiry.toISOString())}</div>
              <div class="f-ref">${r.basis} | Storage: ${r.storageLocation}</div>
            </div></div>
            <button class="btn btn-sm btn-red" onclick="suite2DeleteRetention(${i})">Delete</button>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="modal-overlay" id="retentionModal">
      <div class="modal" style="max-width:500px;width:95%">
        <button class="modal-close" onclick="document.getElementById('retentionModal').classList.remove('open')">✕</button>
        <div class="modal-title">Add Retention Record</div>
        <div><span class="lbl">Record Name / Description *</span><input id="ret-name" placeholder="e.g. Customer CDD file — Al Futtaim Trading"/></div>
        <div><span class="lbl">Category *</span>
          <select id="ret-cat" onchange="suite2AutoFillRetention()">
            <option value="">Select</option>${RETENTION_CATEGORIES.map(c=>`<option>${c.cat}</option>`).join('')}
          </select>
        </div>
        <div class="row row-2">
          <div><span class="lbl">Record Created Date</span><input type="date" id="ret-date" value="${today()}"/></div>
          <div><span class="lbl">Retention Period (years)</span><input type="number" id="ret-years" value="5" min="1"/></div>
        </div>
        <div><span class="lbl">Regulatory Basis</span><input id="ret-basis" placeholder="Auto-filled from category"/></div>
        <div><span class="lbl">Storage Location</span><input id="ret-storage" placeholder="e.g. Google Drive /Compliance/CDD/ | Physical: Filing cabinet A3"/></div>
        <div style="display:flex;gap:8px;margin-top:1rem">
          <button class="btn btn-gold" onclick="suite2SaveRetention()" style="flex:1">Save Record</button>
          <button class="btn btn-sm" onclick="document.getElementById('retentionModal').classList.remove('open')" style="padding:12px 20px">Cancel</button>
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
    document.getElementById('ret-years').value='5';
    document.getElementById('retentionModal').classList.add('open');
  };

  global.suite2SaveRetention = function() {
    const name=document.getElementById('ret-name').value.trim();
    if(!name){toast('Record name required','error');return;}
    const records=load(SK2.RETAIN)||[];
    records.unshift({
      id:`RET-${Date.now()}`, recordName:name,
      category:document.getElementById('ret-cat').value,
      createdDate:document.getElementById('ret-date').value,
      retentionYears:parseInt(document.getElementById('ret-years').value)||5,
      basis:document.getElementById('ret-basis').value,
      storageLocation:document.getElementById('ret-storage').value,
    });
    save(SK2.RETAIN,records);
    document.getElementById('retentionModal').classList.remove('open');
    toast('Retention record saved','success');
    renderRetention();
  };

  global.suite2DeleteRetention = function(idx) {
    if(!confirm('Delete this retention record?'))return;
    const records=load(SK2.RETAIN)||[];
    records.splice(idx,1);
    save(SK2.RETAIN,records);
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
        <button class="btn btn-gold" style="width:auto;padding:8px 16px" onclick="suite2LogAIReview()">+ Log AI Review</button>
      </div>
      <div style="background:rgba(74,143,193,0.1);border:1px solid rgba(74,143,193,0.3);border-radius:10px;padding:12px;margin-bottom:1rem;font-size:12px">
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
              <div class="f-title">${l.aiTask} ${badge2(l.decision)}</div>
              <div class="f-body">Reviewed by: ${l.reviewer} | Date: ${fmtDate(l.reviewDate)}</div>
              <div class="f-ref">Ref: ${l.id} | ${l.notes}</div>
            </div></div>
            <button class="btn btn-sm btn-red" onclick="suite2DeleteAILog(${i})">Delete</button>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="modal-overlay" id="ailogModal">
      <div class="modal" style="max-width:520px;width:95%">
        <button class="modal-close" onclick="document.getElementById('ailogModal').classList.remove('open')">✕</button>
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
          <div><span class="lbl">Review Date</span><input type="date" id="ailog-date" value="${today()}"/></div>
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
          <button class="btn btn-gold" onclick="suite2SaveAILog()" style="flex:1">Save Review Log</button>
          <button class="btn btn-sm" onclick="document.getElementById('ailogModal').classList.remove('open')" style="padding:12px 20px">Cancel</button>
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
  if (document.readyState==='loading') {
    document.addEventListener('DOMContentLoaded', injectSuite2);
  } else {
    setTimeout(injectSuite2, 400);
  }

})(window);

// ════════════════════════════════════════════════════════════════════════════
// ASANA SYNC — NEW MODULES (TFS UAE, DPMSR, AI Governance)
// ════════════════════════════════════════════════════════════════════════════

(function(global) {
  'use strict';

  function load(key) { try { return JSON.parse(localStorage.getItem(key)||'null'); } catch{return null;} }
  function save(key,val) { try { localStorage.setItem(key,JSON.stringify(val)); } catch(e){} }
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
      const projectId = (typeof ASANA_PROJECT !== 'undefined' && ASANA_PROJECT) ? ASANA_PROJECT : '1213759768596515';
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
      `Task Type: ${l.aiTask}`,
      `Decision: ${l.decision}`,
      `Reviewed By: ${l.reviewer}`,
      `Review Date: ${fmtDate(l.reviewDate)}`,
      `AI Output Summary: ${l.output||'—'}`,
      `Reviewer Notes: ${l.notes||'—'}`,
      `\nRegulatory Basis: Cabinet Resolution 134/2025 Art.24 | PDPL — Human review of automated processing`,
    ].join('\n');

    const title = `[AI-GOV] ${l.aiTask} — ${l.decision}`;
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
