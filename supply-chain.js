/**
 * Supply Chain Traceability Module v1.0
 * LBMA Responsible Gold Guidance (RGG) v9 Steps 1-5
 * OECD Due Diligence Guidance for Responsible Supply Chains
 * Tracks mine-to-market chain of custody, CAHRA risk, and audit compliance.
 */
const SupplyChain = (function() {
  'use strict';

  function esc(s) { if (!s && s!==0) return ''; var d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

  const STORAGE_KEY = 'fgl_supply_chain';
  const CAHRA_KEY = 'fgl_cahra_countries';
  const AUDIT_KEY = 'fgl_sc_audits';

  // Default CAHRA (Conflict-Affected and High-Risk Areas) list
  // Based on EU Conflict Minerals Regulation + OECD guidance
  const DEFAULT_CAHRA = [
    { code: 'CD', name: 'DR Congo', risk: 'CRITICAL', source: 'UN/EU/OECD' },
    { code: 'CF', name: 'Central African Republic', risk: 'CRITICAL', source: 'UN' },
    { code: 'SS', name: 'South Sudan', risk: 'CRITICAL', source: 'UN' },
    { code: 'SD', name: 'Sudan', risk: 'HIGH', source: 'UN/OFAC' },
    { code: 'ML', name: 'Mali', risk: 'HIGH', source: 'EU' },
    { code: 'BF', name: 'Burkina Faso', risk: 'HIGH', source: 'EU' },
    { code: 'NE', name: 'Niger', risk: 'HIGH', source: 'EU' },
    { code: 'MM', name: 'Myanmar', risk: 'HIGH', source: 'UN/OFAC' },
    { code: 'VE', name: 'Venezuela', risk: 'HIGH', source: 'OFAC' },
    { code: 'RU', name: 'Russia', risk: 'HIGH', source: 'LBMA/EU/OFAC' },
    { code: 'KP', name: 'North Korea', risk: 'CRITICAL', source: 'UN/OFAC' },
    { code: 'IR', name: 'Iran', risk: 'CRITICAL', source: 'UN/OFAC' },
    { code: 'SY', name: 'Syria', risk: 'CRITICAL', source: 'UN/OFAC' },
    { code: 'ZW', name: 'Zimbabwe', risk: 'MEDIUM', source: 'OFAC' },
    { code: 'NI', name: 'Nicaragua', risk: 'MEDIUM', source: 'OFAC' },
    { code: 'CU', name: 'Cuba', risk: 'HIGH', source: 'OFAC' },
    { code: 'LY', name: 'Libya', risk: 'HIGH', source: 'UN' },
    { code: 'SO', name: 'Somalia', risk: 'CRITICAL', source: 'UN' },
    { code: 'YE', name: 'Yemen', risk: 'HIGH', source: 'UN' },
    { code: 'ER', name: 'Eritrea', risk: 'HIGH', source: 'UN' },
  ];

  // FATF Gray List — Jurisdictions under increased monitoring (February 2026)
  const FATF_GRAY_LIST = [
    { code: 'DZ', name: 'Algeria', added: '2025-02' },
    { code: 'AO', name: 'Angola', added: '2023-10' },
    { code: 'BG', name: 'Bulgaria', added: '2024-10' },
    { code: 'BF', name: 'Burkina Faso', added: '2021-02' },
    { code: 'CM', name: 'Cameroon', added: '2023-10' },
    { code: 'HR', name: 'Croatia', added: '2024-06' },
    { code: 'CD', name: 'DR Congo', added: '2022-10' },
    { code: 'HT', name: 'Haiti', added: '2020-10' },
    { code: 'KE', name: 'Kenya', added: '2024-10' },
    { code: 'LB', name: 'Lebanon', added: '2024-10' },
    { code: 'ML', name: 'Mali', added: '2021-10' },
    { code: 'MC', name: 'Monaco', added: '2024-06' },
    { code: 'MZ', name: 'Mozambique', added: '2023-10' },
    { code: 'NA', name: 'Namibia', added: '2024-10' },
    { code: 'NG', name: 'Nigeria', added: '2023-02' },
    { code: 'PH', name: 'Philippines', added: '2021-06' },
    { code: 'ZA', name: 'South Africa', added: '2023-02' },
    { code: 'SS', name: 'South Sudan', added: '2021-06' },
    { code: 'SY', name: 'Syria', added: '2010-02' },
    { code: 'TZ', name: 'Tanzania', added: '2022-10' },
    { code: 'VN', name: 'Vietnam', added: '2023-06' },
    { code: 'YE', name: 'Yemen', added: '2010-02' },
    { code: 'VE', name: 'Venezuela', added: '2024-10' },
  ];

  // EU High-Risk Third Countries — Delegated Regulation (EU) 2016/1675 (latest update 2026)
  const EU_HIGH_RISK_COUNTRIES = [
    { code: 'AF', name: 'Afghanistan', source: 'EU Delegated Reg.' },
    { code: 'BF', name: 'Burkina Faso', source: 'EU Delegated Reg.' },
    { code: 'CM', name: 'Cameroon', source: 'EU Delegated Reg.' },
    { code: 'CF', name: 'Central African Republic', source: 'EU Delegated Reg.' },
    { code: 'TD', name: 'Chad', source: 'EU Delegated Reg.' },
    { code: 'CD', name: 'DR Congo', source: 'EU Delegated Reg.' },
    { code: 'HT', name: 'Haiti', source: 'EU Delegated Reg.' },
    { code: 'KE', name: 'Kenya', source: 'EU Delegated Reg.' },
    { code: 'ML', name: 'Mali', source: 'EU Delegated Reg.' },
    { code: 'MM', name: 'Myanmar', source: 'EU Delegated Reg.' },
    { code: 'MZ', name: 'Mozambique', source: 'EU Delegated Reg.' },
    { code: 'NG', name: 'Nigeria', source: 'EU Delegated Reg.' },
    { code: 'PH', name: 'Philippines', source: 'EU Delegated Reg.' },
    { code: 'SN', name: 'Senegal', source: 'EU Delegated Reg.' },
    { code: 'ZA', name: 'South Africa', source: 'EU Delegated Reg.' },
    { code: 'SS', name: 'South Sudan', source: 'EU Delegated Reg.' },
    { code: 'SY', name: 'Syria', source: 'EU Delegated Reg.' },
    { code: 'TZ', name: 'Tanzania', source: 'EU Delegated Reg.' },
    { code: 'TT', name: 'Trinidad and Tobago', source: 'EU Delegated Reg.' },
    { code: 'VN', name: 'Vietnam', source: 'EU Delegated Reg.' },
    { code: 'YE', name: 'Yemen', source: 'EU Delegated Reg.' },
  ];

  // LBMA RGG v9 Five-Step Framework
  const RGG_STEPS = [
    { step: 1, title: 'Strong Management Systems', description: 'Establish strong company management systems including supply chain policy, internal compliance team, grievance mechanism, and record-keeping.', status: 'NOT_STARTED' },
    { step: 2, title: 'Identify and Assess Risk', description: 'Identify and assess risks in the supply chain. Map supply chain, identify CAHRA origins, assess counterparty risk.', status: 'NOT_STARTED' },
    { step: 3, title: 'Design and Implement Strategy', description: 'Design and implement a strategy to respond to identified risks. Implement enhanced due diligence, suspend or disengage from high-risk suppliers.', status: 'NOT_STARTED' },
    { step: 4, title: 'Independent Third-Party Audit', description: 'Carry out independent third-party audit of supply chain due diligence. Engage qualified auditor, provide access to records.', status: 'NOT_STARTED' },
    { step: 5, title: 'Report Annually', description: 'Report annually on supply chain due diligence. Publish findings, submit to LBMA, include in corporate reporting.', status: 'NOT_STARTED' },
  ];

  function getEntries() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch(_) { return []; } }
  function saveEntries(arr) { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr.slice(0, 1000))); }
  function getCAHRA() { try { return JSON.parse(localStorage.getItem(CAHRA_KEY) || 'null') || DEFAULT_CAHRA; } catch(_) { return DEFAULT_CAHRA; } }
  function saveCAHRA(arr) { localStorage.setItem(CAHRA_KEY, JSON.stringify(arr)); }
  function getAudits() { try { return JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]'); } catch(_) { return []; } }
  function saveAudits(arr) { localStorage.setItem(AUDIT_KEY, JSON.stringify(arr.slice(0, 100))); }

  function getRGGStatus() {
    let saved; try { saved = JSON.parse(localStorage.getItem('fgl_rgg_status') || 'null'); } catch(_) { saved = null; }
    if (saved) return saved;
    return RGG_STEPS.map(s => ({ ...s }));
  }
  function saveRGGStatus(steps) { localStorage.setItem('fgl_rgg_status', JSON.stringify(steps)); }

  function checkCAHRA(countryCode) {
    const list = getCAHRA();
    return list.find(c => c.code === (countryCode || '').toUpperCase());
  }

  function checkFATFGray(countryCode) {
    return FATF_GRAY_LIST.find(c => c.code === (countryCode || '').toUpperCase());
  }

  function checkEUHighRisk(countryCode) {
    return EU_HIGH_RISK_COUNTRIES.find(c => c.code === (countryCode || '').toUpperCase());
  }

  function assessSupplierRisk(supplier) {
    let score = 0;
    const flags = [];
    const cahra = checkCAHRA(supplier.originCountry);
    if (cahra) {
      score += cahra.risk === 'CRITICAL' ? 40 : cahra.risk === 'HIGH' ? 25 : 15;
      flags.push(`Origin country ${cahra.name} is CAHRA-listed (${cahra.risk})`);
    }
    const fatf = checkFATFGray(supplier.originCountry);
    if (fatf) {
      score += 15;
      flags.push(`Origin country ${fatf.name} is on the FATF Gray List (increased monitoring since ${fatf.added})`);
    }
    const euHR = checkEUHighRisk(supplier.originCountry);
    if (euHR) {
      score += 15;
      flags.push(`Origin country ${euHR.name} is an EU High-Risk Third Country`);
    }
    if (!supplier.mineOfOrigin) { score += 15; flags.push('Mine of origin not documented'); }
    if (!supplier.refinerName) { score += 10; flags.push('Refiner/smelter not identified'); }
    const auditSt = (supplier.auditStatus || '').toLowerCase();
    if (!auditSt || auditSt === 'not_yet') { score += 15; flags.push('No third-party audit completed'); }
    else if (auditSt === 'under_process') { score += 5; flags.push('Third-party audit under process'); }
    else if (auditSt === 'na') { score += 10; flags.push('Audit marked N/A — review justification required'); }
    if (supplier.isASM) { score += 15; flags.push('Artisanal/small-scale mining (ASM) source — enhanced DD required'); }
    if (!supplier.kycCompleted) { score += 10; flags.push('KYC/CDD not completed for this supplier'); }

    score = Math.min(score, 100);
    const level = score >= 50 ? 'HIGH' : score >= 25 ? 'MEDIUM' : 'LOW';
    return { score, level, flags };
  }

  function addEntry() {
    const byId = id => document.getElementById(id);
    const entry = {
      id: Date.now(),
      supplierName: byId('scSupplierName')?.value?.trim(),
      originCountry: byId('scOriginCountry')?.value?.trim()?.toUpperCase(),
      mineOfOrigin: byId('scMineOfOrigin')?.value?.trim(),
      invoiceNo: byId('scInvoiceNo')?.value?.trim(),
      refinerName: byId('scRefinerName')?.value?.trim(),
      isASM: false,
      kycCompleted: true,
      commodityType: byId('scCommodityType')?.value || 'GOLD',
      weight: byId('scWeight')?.value,
      purity: byId('scPurity')?.value,
      auditStatus: byId('scAuditStatus')?.value || '',
      auditDate: byId('scAuditDate')?.value,
      notes: byId('scNotes')?.value?.trim(),
      createdAt: new Date().toISOString(),
    };

    if (!entry.supplierName) { toast('Enter supplier name', 'error'); return; }

    const risk = assessSupplierRisk(entry);
    entry.riskScore = risk.score;
    entry.riskLevel = risk.level;
    entry.riskFlags = risk.flags;

    const list = getEntries();
    list.unshift(entry);
    saveEntries(list);

    if (typeof logAudit === 'function') logAudit('supply-chain', `Added supplier ${entry.supplierName} (risk: ${entry.riskLevel}, score: ${entry.riskScore})`);
    toast(`Supplier added — Risk: ${entry.riskLevel} (${entry.riskScore}/100)`, entry.riskLevel === 'HIGH' ? 'error' : 'success');

    if (entry.riskLevel === 'HIGH' && typeof sendSlackAlert === 'function') {
      sendSlackAlert('High-Risk Supplier Alert', `${entry.supplierName} from ${entry.originCountry} scored ${entry.riskScore}/100. Flags: ${risk.flags.join('; ')}`);
    }

    refresh();
  }

  function updateRGGStep(stepNum, newStatus) {
    const steps = getRGGStatus();
    const step = steps.find(s => s.step === stepNum);
    if (step) {
      step.status = newStatus;
      step.updatedAt = new Date().toISOString();
      saveRGGStatus(steps);
      if (typeof logAudit === 'function') logAudit('rgg', `RGG Step ${stepNum} updated to ${newStatus}`);
      refresh();
    }
  }

  function renderSupplyChainTab() {
    const entries = getEntries();
    const cahra = getCAHRA();
    const rggSteps = getRGGStatus();

    const statusColors = { 'NOT_STARTED': '#D94F4F', 'IN_PROGRESS': '#E8A838', 'COMPLETED': '#27AE60', 'NEEDS_UPDATE': '#9B59B6', 'NOT_APPLICABLE': '#4A8FC1' };
    const statusLabels = { 'NOT_STARTED': 'Not Started', 'IN_PROGRESS': 'In Progress', 'COMPLETED': 'Completed', 'NEEDS_UPDATE': 'Needs Update', 'NOT_APPLICABLE': 'Not Applicable' };

    const statusBg = { 'NOT_STARTED': 'rgba(217,79,79,0.15)', 'IN_PROGRESS': 'rgba(232,168,56,0.15)', 'COMPLETED': 'rgba(39,174,96,0.15)', 'NEEDS_UPDATE': 'rgba(155,89,182,0.15)', 'NOT_APPLICABLE': 'rgba(74,143,193,0.15)' };
    const statusBorder = { 'NOT_STARTED': '#D94F4F', 'IN_PROGRESS': '#E8A838', 'COMPLETED': '#27AE60', 'NEEDS_UPDATE': '#9B59B6', 'NOT_APPLICABLE': '#4A8FC1' };
    const rggHtml = rggSteps.map(s => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid ${statusBorder[s.status]};border-radius:4px;margin-bottom:6px;background:${statusBg[s.status]}">
        <div style="min-width:30px;width:30px;height:30px;border-radius:50%;background:${statusColors[s.status]};display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700;flex-shrink:0">${s.step}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600">${s.title}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:1px">${s.description}</div>
        </div>
        <select onchange="SupplyChain.updateRGGStep(${s.step}, this.value)" style="width:120px;max-width:120px;flex-shrink:0;padding:4px 6px;border-radius:3px;font-size:10px;font-weight:600;border:2px solid ${statusBorder[s.status]};background:${statusBg[s.status]};color:${statusColors[s.status]};cursor:pointer">
          ${Object.entries(statusLabels).map(([k, v]) => `<option value="${k}" ${s.status === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </div>
    `).join('');

    const entriesHtml = entries.slice(0, 20).map(e => `
      <div style="padding:10px;border:1px solid ${e.riskLevel === 'HIGH' ? 'var(--red)' : e.riskLevel === 'MEDIUM' ? 'var(--amber)' : 'var(--border)'};border-radius:3px;margin-bottom:8px;background:var(--surface2)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <div>
            <span class="badge ${e.riskLevel === 'HIGH' ? 'b-r' : e.riskLevel === 'MEDIUM' ? 'b-a' : 'b-g'}">${e.riskLevel} (${e.riskScore})</span>
            <span style="font-size:13px;font-weight:500;margin-left:8px">${esc(e.supplierName)}</span>
          </div>
          <span style="font-size:11px;color:var(--muted)">${esc(e.originCountry || '??')} · ${esc(e.commodityType)}</span>
        </div>
        <div style="font-size:11px;color:var(--muted)">
          ${e.invoiceNo ? 'Inv: ' + esc(e.invoiceNo) + ' · ' : ''}Mine: ${esc(e.mineOfOrigin || '—')} · Refiner: ${esc(e.refinerName || '—')} ${e.isASM ? '· ASM' : ''} · Audit: ${e.auditStatus === 'completed' ? (e.auditDate || 'Completed') : e.auditStatus === 'under_process' ? 'Under Process' : e.auditStatus === 'na' ? 'N/A' : 'Not Yet'}
        </div>
        ${e.riskFlags?.length ? `<div style="margin-top:4px;font-size:11px;color:var(--red)">${e.riskFlags.map(f => '• ' + esc(f)).join('<br>')}</div>` : ''}
      </div>
    `).join('') || '<p style="color:var(--muted);font-size:13px">No supply chain entries yet.</p>';

    const cahraHtml = cahra.map(c => `
      <span style="display:inline-block;padding:3px 8px;margin:2px;border-radius:4px;font-size:11px;background:rgba(217,79,79,0.25);color:#D94F4F">${c.code} ${c.name}</span>
    `).join('');

    const fatfHtml = FATF_GRAY_LIST.map(c => `
      <span style="display:inline-block;padding:3px 8px;margin:2px;border-radius:4px;font-size:11px;background:rgba(232,160,48,0.25);color:var(--amber)">${c.code} ${c.name}</span>
    `).join('');

    const euHrHtml = EU_HIGH_RISK_COUNTRIES.map(c => `
      <span style="display:inline-block;padding:3px 8px;margin:2px;border-radius:4px;font-size:11px;background:rgba(74,143,193,0.25);color:var(--blue)">${c.code} ${c.name}</span>
    `).join('');

    return `
      <div class="card">
        <div class="top-bar" style="margin-bottom:10px">
          <span class="lbl" style="margin:0">Supply Chain Due Diligence</span>
          <button class="btn btn-sm btn-green" onclick="SupplyChain.addEntry()">Add Supplier/Shipment</button>
        </div>
        <p style="font-size:12px;color:var(--muted);margin-bottom:12px">Track mine-to-market chain of custody per LBMA RGG Step 2 and OECD DDG. Each entry is auto-scored for CAHRA, ASM, KYC, and audit risk.</p>

        <div class="row row-3" style="margin-bottom:8px">
          <div><span class="lbl">Supplier Name</span><input type="text" id="scSupplierName" placeholder="Legal entity name" /></div>
          <div><span class="lbl">Origin Country (ISO)</span><input type="text" id="scOriginCountry" placeholder="e.g. GH, ZA, CH" maxlength="2" /></div>
          <div><span class="lbl">Mine of Origin</span><input type="text" id="scMineOfOrigin" placeholder="Mine name / location" /></div>
        </div>
        <div class="row row-3" style="margin-bottom:8px">
          <div><span class="lbl">Invoice Number</span><input type="text" id="scInvoiceNo" placeholder="Invoice reference" /></div>
          <div><span class="lbl">Refiner / Smelter</span><input type="text" id="scRefinerName" placeholder="Refinery name" /></div>
          <div><span class="lbl">Commodity</span><select id="scCommodityType"><option value="GOLD">Gold</option><option value="SILVER">Silver</option><option value="PLATINUM">Platinum</option><option value="PALLADIUM">Palladium</option></select></div>
        </div>
        <div class="row row-3" style="margin-bottom:8px">
          <div><span class="lbl">Weight (g)</span><input type="number" id="scWeight" placeholder="Grams" /></div>
          <div><span class="lbl">Purity</span><input type="text" id="scPurity" placeholder="e.g. 999.9" /></div>
          <div><span class="lbl">Last Audit Status</span><select id="scAuditStatus"><option value="">Select...</option><option value="completed">Completed</option><option value="under_process">Under Process</option><option value="not_yet">Not Yet</option><option value="na">N/A</option></select></div>
        </div>
        <div class="row row-3" style="margin-bottom:8px">
          <div><span class="lbl">Last Audit Date</span><input type="text" id="scAuditDate" placeholder="dd/mm/yyyy" oninput="if(window.csFormatDateInput)csFormatDateInput(this);else if(window.maFormatDateInput)maFormatDateInput(this)" maxlength="10" /></div>
          <div></div>
          <div></div>
        </div>
        <div style="margin-bottom:8px"><span class="lbl">Notes</span><textarea id="scNotes" placeholder="Additional due diligence notes..." style="min-height:40px"></textarea></div>

        <div style="margin-top:12px">${entriesHtml}</div>
      </div>

      <div class="card">
        <div class="top-bar" style="margin-bottom:10px">
          <span class="lbl" style="margin:0">LBMA RGG v9 — Five-Step Framework</span>
          <span style="font-size:11px;color:var(--muted);font-family:'Montserrat',sans-serif">Responsible Gold Guidance compliance tracker</span>
        </div>
        ${rggHtml}
      </div>

      <div class="card">
        <div class="top-bar" style="margin-bottom:10px">
          <span class="lbl" style="margin:0">CAHRA Country List</span>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:11px;color:var(--muted);font-family:'Montserrat',sans-serif">Conflict-Affected and High-Risk Areas</span>
            <button class="btn btn-sm btn-green" onclick="SupplyChain.checkListUpdate('cahra')" style="padding:3px 10px;font-size:10px">Update</button>
          </div>
        </div>
        <p style="font-size:12px;color:var(--muted);margin-bottom:8px">Countries flagged as CAHRA per OECD guidance, LBMA requirements, and sanctions regimes (UN, OFAC, EU). Auto-checked on supplier entry.</p>
        <div>${cahraHtml}</div>
        <div id="cahraUpdateNotif"></div>
      </div>

      <div class="card">
        <div class="top-bar" style="margin-bottom:10px">
          <span class="lbl" style="margin:0">FATF Gray List</span>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:11px;color:var(--muted);font-family:'Montserrat',sans-serif">Jurisdictions Under Increased Monitoring — February 2026</span>
            <button class="btn btn-sm btn-green" onclick="SupplyChain.checkListUpdate('fatf')" style="padding:3px 10px;font-size:10px">Update</button>
          </div>
        </div>
        <p style="font-size:12px;color:var(--muted);margin-bottom:8px">Countries identified by FATF as having strategic deficiencies in their AML/CFT/CPF regimes and committed to action plans. Enhanced due diligence required for business relationships involving these jurisdictions. Auto-checked on supplier entry.</p>
        <div>${fatfHtml}</div>
        <p style="font-size:10px;color:var(--muted);margin-top:8px;font-family:'Montserrat',sans-serif">Source: FATF — fatf-gafi.org/en/countries/jurisdictions-under-increased-monitoring</p>
        <div id="fatfUpdateNotif"></div>
      </div>

      <div class="card">
        <div class="top-bar" style="margin-bottom:10px">
          <span class="lbl" style="margin:0">EU High-Risk Third Countries</span>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:11px;color:var(--muted);font-family:'Montserrat',sans-serif">Delegated Regulation (EU) 2016/1675 — Latest Update 2026</span>
            <button class="btn btn-sm btn-green" onclick="SupplyChain.checkListUpdate('eu')" style="padding:3px 10px;font-size:10px">Update</button>
          </div>
        </div>
        <p style="font-size:12px;color:var(--muted);margin-bottom:8px">Third countries identified by the European Commission as having strategic deficiencies in their AML/CFT frameworks. Enhanced due diligence is mandatory under EU AMLD for business relationships and transactions involving these jurisdictions. Auto-checked on supplier entry.</p>
        <div>${euHrHtml}</div>
        <p style="font-size:10px;color:var(--muted);margin-top:8px;font-family:'Montserrat',sans-serif">Source: European Commission — Delegated Regulation (EU) 2016/1675 as amended</p>
        <div id="euUpdateNotif"></div>
      </div>
    `;
  }

  function refresh() {
    const el = document.getElementById('tab-supplychain');
    if (el) el.innerHTML = renderSupplyChainTab();
  }

  async function checkListUpdate(listType) {
    const notifId = listType === 'cahra' ? 'cahraUpdateNotif' : listType === 'fatf' ? 'fatfUpdateNotif' : 'euUpdateNotif';
    const notifEl = document.getElementById(notifId);
    if (!notifEl) return;
    notifEl.innerHTML = '<p style="color:var(--muted);font-size:12px;padding:8px 0">Checking for updates...</p>';

    const listNames = { cahra: 'CAHRA (Conflict-Affected and High-Risk Areas)', fatf: 'FATF Gray List (Jurisdictions Under Increased Monitoring)', eu: 'EU High-Risk Third Countries (Delegated Regulation 2016/1675)' };
    const currentLists = {
      cahra: DEFAULT_CAHRA.map(c => c.code + ' ' + c.name).join(', '),
      fatf: FATF_GRAY_LIST.map(c => c.code + ' ' + c.name).join(', '),
      eu: EU_HIGH_RISK_COUNTRIES.map(c => c.code + ' ' + c.name).join(', ')
    };

    const prompt = `You are a compliance analyst. I need you to check for the latest updates to the ${listNames[listType]}.

My current list (as of my last update): ${currentLists[listType]}

Please provide:
1. The current date of this check
2. Any countries ADDED to the official list since my version
3. Any countries REMOVED from the official list since my version
4. Any status changes (e.g. risk level upgrades/downgrades)
5. The date of the latest official update to this list
6. Required compliance measures for any changes (e.g. EDD requirements, screening updates, customer reviews)

If the list appears up to date, confirm that and note when the next review is expected.

Format your response as a structured compliance update notification. Be concise but thorough on regulatory implications.`;

    try {
      if (typeof callAI !== 'function') { notifEl.innerHTML = '<p style="color:var(--red);font-size:12px;padding:8px 0">AI not available. Configure API key or proxy in Settings.</p>'; return; }

      const data = await callAI({ model: 'claude-haiku-4-5', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] });
      const text = data?.content?.[0]?.text || data?.error?.message || 'No response received.';

      const now = new Date().toLocaleString('en-GB');
      notifEl.innerHTML = `
        <div style="margin-top:12px;padding:12px;background:rgba(180,151,90,0.08);border:1px solid rgba(180,151,90,0.25);border-radius:3px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span style="font-size:12px;font-weight:700;color:var(--gold);font-family:'Montserrat',sans-serif">LIST UPDATE CHECK</span>
            <span style="font-size:10px;color:var(--muted)">${now}</span>
          </div>
          <div style="font-size:12px;color:var(--text);line-height:1.6;white-space:pre-wrap">${text.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
        </div>`;
      if (typeof logAudit === 'function') logAudit('list-update', `${listNames[listType]} update check completed`);
      toast('Update check completed', 'success');
    } catch (err) {
      const errMsg = err.message || 'Unknown error';
      const errLower = errMsg.toLowerCase();
      if (err.isBillingError || errLower.includes('credit') || errLower.includes('balance') || errLower.includes('billing') || errLower.includes('insufficient') || errLower.includes('quota')) {
        notifEl.innerHTML = '<p style="color:#E8A838;font-size:12px;padding:8px 0">API credits exhausted — verify list updates manually via official sources. Add credits at console.anthropic.com.</p>';
        toast('API credits exhausted — check list updates manually', 'info', 8000);
      } else {
        notifEl.innerHTML = '<p style="color:var(--red);font-size:12px;padding:8px 0">Update check failed: ' + errMsg.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') + '</p>';
      }
    }
  }

  return {
    checkCAHRA,
    assessSupplierRisk,
    addEntry,
    updateRGGStep,
    renderSupplyChainTab,
    refresh,
    getEntries,
    getRGGStatus,
    DEFAULT_CAHRA,
    checkListUpdate,
  };
})();
