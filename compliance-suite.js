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
