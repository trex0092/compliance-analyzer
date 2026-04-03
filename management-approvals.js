/**
 * Management Approvals Module — Customer & Counterparty Due Diligence
 * 7 Sections: Customer Info, Sanctions Screening, Adverse Media, Identifications,
 * PF Assessment, RBA Customer Risk Scoring, Sign-Off & Authorization
 */
(function () {
  'use strict';

  const MA_STORAGE = 'fgl_mgmt_approvals';

  function parse(key, fb) {
    return typeof safeLocalParse === 'function' ? safeLocalParse(key, fb) : (() => { try { return JSON.parse(localStorage.getItem(key)) || fb; } catch (_) { return fb; } })();
  }
  function save(key, v) {
    if (typeof safeLocalSave === 'function') safeLocalSave(key, v);
    else localStorage.setItem(key, JSON.stringify(v));
  }

  function getApprovals() { return parse(MA_STORAGE, []); }
  function saveApprovals(list) { save(MA_STORAGE, list); }

  function esc(s) {
    if (typeof window.escHtml === 'function') return window.escHtml(s);
    const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER MAIN TAB
  // ══════════════════════════════════════════════════════════════

  function renderApprovalsTab() {
    const approvals = getApprovals();
    const company = typeof getActiveCompany === 'function' ? getActiveCompany() : { name: '' };

    let html = `
<div class="card">
  <div class="top-bar" style="margin-bottom:10px">
    <span class="sec-title" style="margin:0;border:none;padding:0">Management Approvals — Customer & Counterparty Due Diligence</span>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn btn-sm btn-blue" onclick="ManagementApprovals.newApproval()">+ New Assessment</button>
      <button class="btn btn-sm btn-green" onclick="ManagementApprovals.exportCurrentPDF()">PDF</button>
      <button class="btn btn-sm btn-green" onclick="ManagementApprovals.exportCurrentDOCX()">Word</button>
      <button class="btn btn-sm btn-red" onclick="ManagementApprovals.clearAllApprovals()">Clear</button>
    </div>
  </div>
  <p style="font-size:12px;color:var(--muted);margin-bottom:12px">
    Compliance Assessment — Customer & Counterparty Due Diligence ${new Date().getFullYear()}.
    Complete all 7 sections for each customer/counterparty.
  </p>
</div>

<!-- Assessment List -->
<div class="card">
  <span class="sec-title">Saved Assessments <span style="color:var(--muted);font-size:10px">(${approvals.length})</span></span>`;

    if (approvals.length) {
      html += approvals.map((a, idx) => {
        const riskColor = a.riskClassification === 'High-Risk' ? 'var(--red)' : a.riskClassification === 'Medium-Risk' ? 'var(--amber)' : 'var(--green)';
        return `
  <div class="asana-item">
    <div style="flex:1">
      <div class="asana-name">${esc(a.customerInfo?.companyName || 'Unnamed')}</div>
      <div class="asana-meta">${a.customerInfo?.country || 'N/A'} | Risk: <span style="color:${riskColor};font-weight:600">${a.riskClassification || 'Not assessed'}</span> | CDD: ${a.cddLevel || 'N/A'} | ${a.businessDecision || 'Pending'}</div>
      <div class="asana-meta">Created: ${new Date(a.createdAt).toLocaleDateString('en-GB')}</div>
    </div>
    <div style="display:flex;gap:4px">
      <button class="btn-sm btn-green" onclick="ManagementApprovals.editApproval(${idx})">Edit</button>
      <button class="btn-sm btn-red" onclick="ManagementApprovals.deleteApproval(${idx})">Del</button>
    </div>
  </div>`;
      }).join('');
    } else {
      html += '<p style="color:var(--muted);font-size:13px">No assessments yet. Click "+ New Assessment" to create one.</p>';
    }
    html += '</div>';

    // Editor form (hidden by default, shown when editing)
    html += `<div id="maEditorPanel" style="display:none">${renderEditorForm()}</div>`;

    return html;
  }

  // ══════════════════════════════════════════════════════════════
  // EDITOR FORM — All 7 Sections
  // ══════════════════════════════════════════════════════════════

  function renderEditorForm() {
    return `
<!-- SECTION 1: CUSTOMER INFORMATION -->
<div class="card">
  <span class="sec-title" style="color:var(--gold)">SECTION 1 — CUSTOMER INFORMATION</span>
  <div class="row row-2" style="margin-bottom:8px">
    <div><span class="lbl">Company Name</span><input type="text" id="maCompanyName" placeholder="Full legal name" /></div>
    <div><span class="lbl">Country of Registration</span><input type="text" id="maCountry" placeholder="e.g., United Arab Emirates" /></div>
  </div>
  <div class="row row-3" style="margin-bottom:8px">
    <div><span class="lbl">Date of Registration</span><input type="date" id="maRegDate" /></div>
    <div><span class="lbl">Commercial Register</span><input type="text" id="maCommRegister" placeholder="e.g., DMCC-31770" /></div>
    <div><span class="lbl">License Expiry Date</span><input type="date" id="maLicenseExpiry" /></div>
  </div>
  <div class="row row-3" style="margin-bottom:8px">
    <div><span class="lbl">GoAML Registration Status</span><select id="maGoAML"><option value="Registered">Registered</option><option value="Not Registered">Not Registered</option><option value="Pending">Pending</option></select></div>
    <div><span class="lbl">FATF Grey List Status</span><select id="maFATF" onchange="this.style.color=this.value==='Negative'?'var(--green)':'var(--red)'" style="color:var(--green)"><option value="Negative" style="color:var(--green)">Negative</option><option value="Positive" style="color:var(--red)">Positive</option></select></div>
    <div><span class="lbl">CAHRA Status</span><select id="maCAHRA" onchange="this.style.color=this.value==='Negative'?'var(--green)':'var(--red)'" style="color:var(--green)"><option value="Negative" style="color:var(--green)">Negative</option><option value="Positive" style="color:var(--red)">Positive</option></select></div>
  </div>
  <div class="row row-2">
    <div><span class="lbl">PEP Status</span><select id="maPEP" onchange="this.style.color=this.value==='Negative'?'var(--green)':'var(--red)'" style="color:var(--green)"><option value="Negative" style="color:var(--green)">Negative</option><option value="Positive" style="color:var(--red)">Positive</option></select></div>
  </div>
</div>

<!-- SECTION 2: SANCTIONS SCREENING -->
<div class="card">
  <span class="sec-title" style="color:var(--gold)">SECTION 2 — SANCTIONS SCREENING</span>
  ${renderSanctionsRow('maS_UAE', 'UAE Local Terrorist List (EOCN / Executive Office)')}
  ${renderSanctionsRow('maS_UN', 'UN Consolidated Sanctions List (UNSC)')}
  ${renderSanctionsRow('maS_OFAC', 'OFAC Specially Designated Nationals List (SDN)')}
  ${renderSanctionsRow('maS_UK', 'UK OFSI Consolidated Financial Sanctions List')}
  ${renderSanctionsRow('maS_EU', 'EU Consolidated Financial Sanctions List')}
  ${renderSanctionsRow('maS_INTERPOL', 'INTERPOL Red Notices (where applicable)')}
</div>

<!-- SECTION 3: ADVERSE MEDIA SCREENING -->
<div class="card">
  <span class="sec-title" style="color:var(--gold)">SECTION 3 — ADVERSE MEDIA SCREENING</span>
  ${renderAdverseRow('maA_Criminal', 'Criminal / Fraud Allegations')}
  ${renderAdverseRow('maA_ML', 'Money Laundering')}
  ${renderAdverseRow('maA_TF', 'Terrorist Financing, or Proliferation Financing Links')}
  ${renderAdverseRow('maA_Regulatory', 'Regulatory Actions, Fines, or Investigations')}
  ${renderAdverseRow('maA_Reputation', 'Negative Reputation or Commercial Disputes')}
  ${renderAdverseRow('maA_Political', 'Political Controversy or PEP Connections')}
  ${renderAdverseRow('maA_HR', 'Human Rights, Environmental, or Ethical Violations')}
</div>

<!-- SECTION 4: IDENTIFICATIONS -->
<div class="card">
  <span class="sec-title" style="color:var(--gold)">SECTION 4 — IDENTIFICATIONS</span>
  <div id="maIndividualsContainer"></div>
  <button class="btn btn-sm btn-green" onclick="ManagementApprovals.addIndividual()" style="margin-top:8px">+ Add Individual</button>
</div>

<!-- SECTION 5: PROLIFERATION FINANCING (PF) ASSESSMENT -->
<div class="card">
  <span class="sec-title" style="color:var(--gold)">SECTION 5 — PROLIFERATION FINANCING (PF) ASSESSMENT</span>
  ${renderPFRow('maPF_DPMS', 'DPMS Sector Inherent PF Exposure (NRA 2024)')}
  ${renderPFRow('maPF_Jurisdiction', 'Jurisdictional Exposure - Counterparty or Transaction Origin')}
  ${renderPFRow('maPF_DualUse', 'Dual-Use Goods or Materials (Cabinet Resolution No. 156 of 2025)')}
  ${renderPFRow('maPF_UNPF', 'UN PF Sanctions List Match (UNSCR 1718/2231/1540)')}
  ${renderPFRow('maPF_Unusual', 'Unusual Trade Patterns or Transaction Volumes')}
  ${renderPFRow('maPF_Links', 'Links to Proliferation Networks or Controlled Technology')}
  ${renderPFRow('maPF_Overall', 'Overall PF Risk Conclusion')}
</div>

<!-- SECTION 6: RISK-BASED ASSESSMENT (RBA) -->
<div class="card">
  <span class="sec-title" style="color:var(--gold)">SECTION 6 — RISK-BASED ASSESSMENT (RBA) — CUSTOMER RISK SCORING</span>
  <div class="row row-2" style="margin-bottom:8px">
    <div><span class="lbl">Overall Risk Classification</span><select id="maRiskClass" onchange="this.style.color=this.value==='Low-Risk'?'var(--green)':this.value==='Medium-Risk'?'var(--amber)':'var(--red)'" style="color:var(--green)"><option value="Low-Risk" style="color:var(--green)">Low-Risk</option><option value="Medium-Risk" style="color:var(--amber)">Medium-Risk</option><option value="High-Risk" style="color:var(--red)">High-Risk</option></select></div>
    <div><span class="lbl">CDD Level Required</span><select id="maCDDLevel" onchange="this.style.color=this.value==='CDD'?'var(--green)':this.value==='SDD'?'var(--amber)':'var(--red)'" style="color:var(--green)"><option value="CDD" style="color:var(--green)">Standard CDD</option><option value="SDD" style="color:var(--amber)">Simplified DD (SDD)</option><option value="EDD" style="color:var(--red)">Enhanced DD (EDD)</option></select></div>
  </div>
  <div class="row row-2" style="margin-bottom:8px">
    <div><span class="lbl">Business Relationship Decision</span><select id="maBusinessDecision" onchange="this.style.color=this.value==='Approved'?'var(--green)':this.value==='Not Approved'?'var(--red)':'#FF69B4'" style="color:var(--green)"><option value="Approved" style="color:var(--green)">Approved</option><option value="Not Approved" style="color:var(--red)">Not Approved</option><option value="Pending" style="color:#FF69B4">Pending Review</option></select></div>
    <div><span class="lbl">Trigger Events Requiring Immediate Review</span><select id="maTriggerEvents"><option value="No">No</option><option value="Yes">Yes</option></select></div>
  </div>
  <div><span class="lbl">Assessment Notes</span><textarea id="maAssessmentNotes" rows="3" placeholder="Additional risk assessment notes..."></textarea></div>
</div>

<!-- SECTION 7: SIGN-OFF & AUTHORIZATION -->
<div class="card">
  <span class="sec-title" style="color:var(--gold)">SECTION 7 — SIGN-OFF & AUTHORIZATION</span>
  <div class="row row-2" style="margin-bottom:8px">
    <div><span class="lbl">Approved By (Name)</span><input type="text" id="maApprovedBy" placeholder="e.g., Shiyad Kattuparambil Abdulkareem" /></div>
    <div><span class="lbl">Approved By (Title)</span><input type="text" id="maApprovedTitle" placeholder="e.g., Managing Director" /></div>
  </div>
  <div class="row row-2" style="margin-bottom:8px">
    <div><span class="lbl">Prepared By (Name)</span><input type="text" id="maPreparedBy" placeholder="e.g., Luisa Fernanda" /></div>
    <div><span class="lbl">Prepared By (Title)</span><input type="text" id="maPreparedTitle" placeholder="e.g., Compliance Officer" /></div>
  </div>
  <div class="row row-2">
    <div><span class="lbl">Approval Date</span><input type="date" id="maApprovalDate" /></div>
  </div>
</div>

<div style="display:flex;gap:8px;margin-top:10px">
  <button class="btn btn-gold" onclick="ManagementApprovals.saveCurrentApproval()" style="flex:1">Save Assessment</button>
  <button class="btn btn-sm" onclick="ManagementApprovals.cancelEdit()">Cancel</button>
</div>`;
  }

  function renderSanctionsRow(prefix, label) {
    return `<div style="display:grid;grid-template-columns:1fr 100px 120px 1fr;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);align-items:center">
      <span style="font-size:11px;color:var(--text)">${label}</span>
      <select id="${prefix}_result" onchange="this.style.color=this.value==='Negative'?'var(--green)':this.value==='Positive'?'var(--red)':'var(--amber)'" style="color:var(--green)"><option value="Negative" style="color:var(--green)">Negative</option><option value="Positive" style="color:var(--red)">Positive</option><option value="Pending" style="color:var(--amber)">Pending</option></select>
      <input type="date" id="${prefix}_date" style="font-size:10px" />
      <input type="text" id="${prefix}_remarks" placeholder="Remarks..." style="font-size:10px" />
    </div>`;
  }

  function renderAdverseRow(prefix, label) {
    return `<div style="display:grid;grid-template-columns:1fr 100px 1fr;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);align-items:center">
      <span style="font-size:11px;color:var(--text)">${label}</span>
      <select id="${prefix}_finding" onchange="this.style.color=this.value==='Negative'?'var(--green)':this.value==='Positive'?'var(--red)':'var(--amber)'" style="color:var(--green)"><option value="Negative" style="color:var(--green)">Negative</option><option value="Positive" style="color:var(--red)">Positive</option><option value="Pending" style="color:var(--amber)">Pending</option></select>
      <input type="text" id="${prefix}_details" placeholder="Details / Source..." style="font-size:10px" />
    </div>`;
  }

  function renderPFRow(prefix, label) {
    return `<div style="display:grid;grid-template-columns:1fr 100px 1fr;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);align-items:center">
      <span style="font-size:11px;color:var(--text)">${label}</span>
      <select id="${prefix}_level" onchange="this.style.color=this.value==='Low'?'var(--green)':this.value==='Medium'?'var(--amber)':'var(--red)'" style="color:var(--green)"><option value="Low" style="color:var(--green)">Low</option><option value="Medium" style="color:var(--amber)">Medium</option><option value="High" style="color:var(--red)">High</option></select>
      <input type="text" id="${prefix}_notes" placeholder="Assessment notes..." style="font-size:10px" />
    </div>`;
  }

  // ══════════════════════════════════════════════════════════════
  // INDIVIDUALS (dynamic add/remove)
  // ══════════════════════════════════════════════════════════════

  let currentIndividuals = [];
  let editIndex = -1;

  function renderIndividuals() {
    const container = document.getElementById('maIndividualsContainer');
    if (!container) return;
    if (!currentIndividuals.length) currentIndividuals.push(emptyIndividual(1));
    container.innerHTML = currentIndividuals.map((ind, i) => `
      <div style="background:var(--surface2);border-radius:8px;padding:10px;margin-bottom:8px;border-left:3px solid var(--gold)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-size:12px;font-weight:600;color:var(--gold)">Individual ${i + 1}</span>
          ${currentIndividuals.length > 1 ? `<button class="btn-sm btn-red" onclick="ManagementApprovals.removeIndividual(${i})" style="font-size:9px">Remove</button>` : ''}
        </div>
        <div class="row row-3" style="margin-bottom:6px">
          <div><span class="lbl">Designation</span><input type="text" class="maInd_designation" value="${esc(ind.designation)}" placeholder="e.g., Shareholder & Director" /></div>
          <div><span class="lbl">Name</span><input type="text" class="maInd_name" value="${esc(ind.name)}" placeholder="Full name" /></div>
          <div><span class="lbl">Shares %</span><input type="text" class="maInd_shares" value="${esc(ind.shares)}" placeholder="e.g., 50%" /></div>
        </div>
        <div class="row row-3" style="margin-bottom:6px">
          <div><span class="lbl">Individual/Corporate</span><select class="maInd_type"><option value="Individual" ${ind.type==='Individual'?'selected':''}>Individual</option><option value="Corporate" ${ind.type==='Corporate'?'selected':''}>Corporate</option></select></div>
          <div><span class="lbl">Nationality</span><input type="text" class="maInd_nationality" value="${esc(ind.nationality)}" placeholder="e.g., UAE" /></div>
          <div><span class="lbl">Passport Number/ID</span><input type="text" class="maInd_passport" value="${esc(ind.passport)}" /></div>
        </div>
        <div class="row row-3" style="margin-bottom:6px">
          <div><span class="lbl">Passport Expiry Date</span><input type="date" class="maInd_passportExpiry" value="${ind.passportExpiry}" /></div>
          <div><span class="lbl">Gender</span><select class="maInd_gender"><option value="Male" ${ind.gender==='Male'?'selected':''}>Male</option><option value="Female" ${ind.gender==='Female'?'selected':''}>Female</option></select></div>
          <div><span class="lbl">Date of Birth/Registration</span><input type="date" class="maInd_dob" value="${ind.dob}" /></div>
        </div>
        <div class="row row-3" style="margin-bottom:6px">
          <div><span class="lbl">Emirates ID</span><input type="text" class="maInd_eid" value="${esc(ind.eid)}" placeholder="784-XXXX-XXXXXXX-X" /></div>
          <div><span class="lbl">Emirates ID Expiry</span><input type="date" class="maInd_eidExpiry" value="${ind.eidExpiry}" /></div>
          <div><span class="lbl">Proof of Address</span><input type="text" class="maInd_proofAddr" value="${esc(ind.proofAddr)}" placeholder="e.g., Lease Agreement" /></div>
        </div>
        <div class="row row-2">
          <div><span class="lbl">PEP Status</span><select class="maInd_pep" onchange="this.style.color=this.value==='Negative'?'var(--green)':'var(--red)'" style="color:${ind.pep==='Positive'?'var(--red)':'var(--green)'}"><option value="Negative" style="color:var(--green)" ${ind.pep==='Negative'?'selected':''}>Negative</option><option value="Positive" style="color:var(--red)" ${ind.pep==='Positive'?'selected':''}>Positive</option></select></div>
        </div>
      </div>
    `).join('');
  }

  function emptyIndividual(num) {
    return { designation: '', name: '', shares: '', type: 'Individual', nationality: '', passport: '', passportExpiry: '', gender: 'Male', dob: '', eid: '', eidExpiry: '', proofAddr: '', pep: 'Negative' };
  }

  function addIndividual() {
    currentIndividuals.push(emptyIndividual(currentIndividuals.length + 1));
    renderIndividuals();
  }

  function removeIndividual(idx) {
    currentIndividuals.splice(idx, 1);
    renderIndividuals();
  }

  // ══════════════════════════════════════════════════════════════
  // COLLECT / POPULATE FORM DATA
  // ══════════════════════════════════════════════════════════════

  function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }
  function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v || ''; }

  function collectIndividuals() {
    const fields = ['designation','name','shares','type','nationality','passport','passportExpiry','gender','dob','eid','eidExpiry','proofAddr','pep'];
    const result = [];
    const containers = document.querySelectorAll('#maIndividualsContainer > div');
    containers.forEach(c => {
      const ind = {};
      fields.forEach(f => {
        const el = c.querySelector('.maInd_' + f);
        if (el) ind[f] = el.value;
      });
      result.push(ind);
    });
    return result;
  }

  function collectSanctions(prefix) {
    return { result: val(prefix + '_result'), date: val(prefix + '_date'), remarks: val(prefix + '_remarks') };
  }

  function collectAdverse(prefix) {
    return { finding: val(prefix + '_finding'), details: val(prefix + '_details') };
  }

  function collectPF(prefix) {
    return { level: val(prefix + '_level'), notes: val(prefix + '_notes') };
  }

  function collectFormData() {
    return {
      customerInfo: {
        companyName: val('maCompanyName'), country: val('maCountry'), regDate: val('maRegDate'),
        commRegister: val('maCommRegister'), licenseExpiry: val('maLicenseExpiry'),
        goAML: val('maGoAML'), fatf: val('maFATF'), cahra: val('maCAHRA'), pep: val('maPEP')
      },
      sanctions: {
        UAE: collectSanctions('maS_UAE'), UN: collectSanctions('maS_UN'), OFAC: collectSanctions('maS_OFAC'),
        UK: collectSanctions('maS_UK'), EU: collectSanctions('maS_EU'), INTERPOL: collectSanctions('maS_INTERPOL')
      },
      adverse: {
        criminal: collectAdverse('maA_Criminal'), ml: collectAdverse('maA_ML'), tf: collectAdverse('maA_TF'),
        regulatory: collectAdverse('maA_Regulatory'), reputation: collectAdverse('maA_Reputation'),
        political: collectAdverse('maA_Political'), hr: collectAdverse('maA_HR')
      },
      individuals: collectIndividuals(),
      pf: {
        dpms: collectPF('maPF_DPMS'), jurisdiction: collectPF('maPF_Jurisdiction'), dualUse: collectPF('maPF_DualUse'),
        unPF: collectPF('maPF_UNPF'), unusual: collectPF('maPF_Unusual'), links: collectPF('maPF_Links'), overall: collectPF('maPF_Overall')
      },
      riskClassification: val('maRiskClass'),
      cddLevel: val('maCDDLevel'),
      businessDecision: val('maBusinessDecision'),
      triggerEvents: val('maTriggerEvents'),
      assessmentNotes: val('maAssessmentNotes'),
      signOff: {
        approvedBy: val('maApprovedBy'), approvedTitle: val('maApprovedTitle'),
        preparedBy: val('maPreparedBy'), preparedTitle: val('maPreparedTitle'),
        approvalDate: val('maApprovalDate')
      }
    };
  }

  function populateForm(data) {
    if (!data) return;
    const ci = data.customerInfo || {};
    setVal('maCompanyName', ci.companyName); setVal('maCountry', ci.country);
    setVal('maRegDate', ci.regDate); setVal('maCommRegister', ci.commRegister);
    setVal('maLicenseExpiry', ci.licenseExpiry); setVal('maGoAML', ci.goAML);
    setVal('maFATF', ci.fatf); setVal('maCAHRA', ci.cahra); setVal('maPEP', ci.pep);

    const s = data.sanctions || {};
    ['UAE','UN','OFAC','UK','EU','INTERPOL'].forEach(k => {
      const v = s[k] || {};
      setVal('maS_' + k + '_result', v.result); setVal('maS_' + k + '_date', v.date); setVal('maS_' + k + '_remarks', v.remarks);
    });

    const a = data.adverse || {};
    ['criminal','ml','tf','regulatory','reputation','political','hr'].forEach(k => {
      const pfx = 'maA_' + k.charAt(0).toUpperCase() + k.slice(1);
      const v = a[k] || {};
      setVal(pfx + '_finding', v.finding); setVal(pfx + '_details', v.details);
    });
    // Fix capitalized keys
    if (a.Criminal) { setVal('maA_Criminal_finding', a.Criminal.finding); setVal('maA_Criminal_details', a.Criminal.details); }
    if (a.ML) { setVal('maA_ML_finding', a.ML.finding); setVal('maA_ML_details', a.ML.details); }
    if (a.TF) { setVal('maA_TF_finding', a.TF.finding); setVal('maA_TF_details', a.TF.details); }
    if (a.Regulatory) { setVal('maA_Regulatory_finding', a.Regulatory.finding); setVal('maA_Regulatory_details', a.Regulatory.details); }
    if (a.Reputation) { setVal('maA_Reputation_finding', a.Reputation.finding); setVal('maA_Reputation_details', a.Reputation.details); }
    if (a.Political) { setVal('maA_Political_finding', a.Political.finding); setVal('maA_Political_details', a.Political.details); }
    if (a.HR) { setVal('maA_HR_finding', a.HR.finding); setVal('maA_HR_details', a.HR.details); }

    currentIndividuals = (data.individuals && data.individuals.length) ? data.individuals : [emptyIndividual(1)];
    renderIndividuals();

    const pf = data.pf || {};
    ['dpms','jurisdiction','dualUse','unPF','unusual','links','overall'].forEach(k => {
      const pfx = 'maPF_' + k.charAt(0).toUpperCase() + k.slice(1);
      const v = pf[k] || {};
      setVal(pfx + '_level', v.level); setVal(pfx + '_notes', v.notes);
    });
    // Fix capitalized keys
    if (pf.DPMS) { setVal('maPF_DPMS_level', pf.DPMS.level); setVal('maPF_DPMS_notes', pf.DPMS.notes); }
    if (pf.Jurisdiction) { setVal('maPF_Jurisdiction_level', pf.Jurisdiction.level); setVal('maPF_Jurisdiction_notes', pf.Jurisdiction.notes); }
    if (pf.DualUse) { setVal('maPF_DualUse_level', pf.DualUse.level); setVal('maPF_DualUse_notes', pf.DualUse.notes); }
    if (pf.UNPF) { setVal('maPF_UNPF_level', pf.UNPF.level); setVal('maPF_UNPF_notes', pf.UNPF.notes); }
    if (pf.Unusual) { setVal('maPF_Unusual_level', pf.Unusual.level); setVal('maPF_Unusual_notes', pf.Unusual.notes); }
    if (pf.Links) { setVal('maPF_Links_level', pf.Links.level); setVal('maPF_Links_notes', pf.Links.notes); }
    if (pf.Overall) { setVal('maPF_Overall_level', pf.Overall.level); setVal('maPF_Overall_notes', pf.Overall.notes); }

    setVal('maRiskClass', data.riskClassification); setVal('maCDDLevel', data.cddLevel);
    setVal('maBusinessDecision', data.businessDecision); setVal('maTriggerEvents', data.triggerEvents);
    setVal('maAssessmentNotes', data.assessmentNotes);

    const so = data.signOff || {};
    setVal('maApprovedBy', so.approvedBy); setVal('maApprovedTitle', so.approvedTitle);
    setVal('maPreparedBy', so.preparedBy); setVal('maPreparedTitle', so.preparedTitle);
    setVal('maApprovalDate', so.approvalDate);
  }

  // ══════════════════════════════════════════════════════════════
  // CRUD OPERATIONS
  // ══════════════════════════════════════════════════════════════

  function newApproval() {
    editIndex = -1;
    currentIndividuals = [emptyIndividual(1)];
    refresh();
    setTimeout(() => {
      const panel = document.getElementById('maEditorPanel');
      if (panel) { panel.style.display = 'block'; renderIndividuals(); panel.scrollIntoView({ behavior: 'smooth' }); }
    }, 50);
  }

  function editApproval(idx) {
    const approvals = getApprovals();
    if (!approvals[idx]) return;
    editIndex = idx;
    refresh();
    setTimeout(() => {
      const panel = document.getElementById('maEditorPanel');
      if (panel) { panel.style.display = 'block'; populateForm(approvals[idx]); panel.scrollIntoView({ behavior: 'smooth' }); }
    }, 50);
  }

  function saveCurrentApproval() {
    const data = collectFormData();
    if (!data.customerInfo.companyName) { if (typeof toast === 'function') toast('Company name is required', 'error'); return; }
    data.updatedAt = new Date().toISOString();

    const approvals = getApprovals();
    if (editIndex >= 0 && approvals[editIndex]) {
      data.createdAt = approvals[editIndex].createdAt;
      approvals[editIndex] = data;
    } else {
      data.createdAt = new Date().toISOString();
      approvals.unshift(data);
    }
    saveApprovals(approvals);
    editIndex = -1;
    refresh();
    if (typeof toast === 'function') toast('Assessment saved', 'success');
    // Asana sync
    if (typeof autoSyncToAsana === 'function') {
      autoSyncToAsana(
        `Approval: ${data.entityName||'Entity'} — ${data.decision||'Pending'}`,
        `Management Approval Assessment\nEntity: ${data.entityName||''}\nType: ${data.assessmentType||''}\nRisk Level: ${data.riskLevel||''}\nDecision: ${data.decision||''}\nApproved By: ${data.approvedBy||''}\nDate: ${data.assessmentDate||''}\nConditions: ${data.conditions||''}\nNotes: ${data.notes||''}`,
        14
      ).then(gid => { if (gid && typeof toast === 'function') toast('Approval synced to Asana','success',2000); });
    }
  }

  function deleteApproval(idx) {
    if (!confirm('Delete this assessment?')) return;
    const approvals = getApprovals();
    approvals.splice(idx, 1);
    saveApprovals(approvals);
    refresh();
    if (typeof toast === 'function') toast('Assessment deleted', 'info');
  }

  function cancelEdit() {
    editIndex = -1;
    const panel = document.getElementById('maEditorPanel');
    if (panel) panel.style.display = 'none';
  }

  function clearAllApprovals() {
    if (!confirm('Clear ALL assessments? This cannot be undone.')) return;
    saveApprovals([]);
    refresh();
    if (typeof toast === 'function') toast('All assessments cleared', 'success');
  }

  // ══════════════════════════════════════════════════════════════
  // EXPORT PDF
  // ══════════════════════════════════════════════════════════════

  function exportCurrentPDF() {
    const approvals = getApprovals();
    if (!approvals.length) { if (typeof toast === 'function') toast('No assessments to export', 'error'); return; }
    if (typeof window.jspdf === 'undefined') { if (typeof toast === 'function') toast('jsPDF not loaded', 'error'); return; }
    const a = approvals[0];
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const ci = a.customerInfo || {};
    doc.setFontSize(14); doc.setTextColor(30, 42, 56);
    doc.text('COMPLIANCE ASSESSMENT - CUSTOMER & COUNTERPARTY DUE DILIGENCE ' + new Date().getFullYear(), 14, 18);
    doc.setFontSize(10); doc.text((ci.companyName || '') + ' | ' + (ci.country || ''), 14, 26);
    doc.setFontSize(9); doc.setTextColor(80);
    let y = 36;
    doc.text('Section 1: Customer Information', 14, y); y += 8;
    ['Company Name: ' + (ci.companyName || ''), 'Country: ' + (ci.country || ''), 'Registration: ' + (ci.regDate || ''), 'Commercial Register: ' + (ci.commRegister || ''), 'GoAML: ' + (ci.goAML || ''), 'FATF: ' + (ci.fatf || ''), 'CAHRA: ' + (ci.cahra || ''), 'PEP: ' + (ci.pep || '')]
      .forEach(line => { doc.text(line, 18, y); y += 5; });
    y += 4;
    doc.text('Risk Classification: ' + (a.riskClassification || 'N/A'), 14, y); y += 5;
    doc.text('CDD Level: ' + (a.cddLevel || 'N/A'), 14, y); y += 5;
    doc.text('Business Decision: ' + (a.businessDecision || 'N/A'), 14, y);
    doc.save((ci.companyName || 'Assessment').replace(/\s+/g, '_') + '_CDD.pdf');
    if (typeof toast === 'function') toast('PDF exported', 'success');
  }

  function exportCurrentDOCX() {
    const approvals = getApprovals();
    if (!approvals.length) { if (typeof toast === 'function') toast('No assessments', 'error'); return; }
    const a = approvals[0];
    const ci = a.customerInfo || {};
    let html = window.wordDocHeader ? window.wordDocHeader('Compliance Assessment - Customer & Counterparty Due Diligence') : '<html><head><meta charset="utf-8"></head><body>';
    html += '<h2>Section 1: Customer Information</h2><table>';
    [['Company Name', ci.companyName], ['Country', ci.country], ['Registration Date', ci.regDate], ['Commercial Register', ci.commRegister], ['License Expiry', ci.licenseExpiry], ['GoAML', ci.goAML], ['FATF Grey List', ci.fatf], ['CAHRA', ci.cahra], ['PEP', ci.pep]]
      .forEach(r => html += '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1] || '') + '</td></tr>');
    html += '</table>';
    html += '<h2>Section 6: Risk-Based Assessment</h2><table>';
    [['Risk Classification', a.riskClassification], ['CDD Level', a.cddLevel], ['Business Decision', a.businessDecision], ['Trigger Events', a.triggerEvents]]
      .forEach(r => html += '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1] || '') + '</td></tr>');
    html += '</table>' + (window.wordDocFooter ? window.wordDocFooter() : '</body></html>');
    const fn = (ci.companyName || 'Assessment').replace(/\s+/g, '_') + '_CDD.doc';
    if (window.downloadWordDoc) { window.downloadWordDoc(html, fn); }
    else { const blob = new Blob(['\ufeff' + html], { type: 'application/msword' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = fn; link.click(); URL.revokeObjectURL(link.href); }
    if (typeof toast === 'function') toast('Word exported', 'success');
  }

  // ══════════════════════════════════════════════════════════════
  // REFRESH & PUBLIC API
  // ══════════════════════════════════════════════════════════════

  function refresh() {
    const el = document.getElementById('tab-approvals');
    if (el) el.innerHTML = renderApprovalsTab();
  }

  window.ManagementApprovals = {
    renderApprovalsTab,
    refresh,
    newApproval,
    editApproval,
    saveCurrentApproval,
    deleteApproval,
    cancelEdit,
    addIndividual,
    removeIndividual,
    exportCurrentPDF,
    exportCurrentDOCX,
    clearAllApprovals
  };

})();
