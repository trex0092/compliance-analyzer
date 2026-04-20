(function () {
  const STORAGE_KEY = 'fgl_compliance_ops';

  function toast(msg, type, duration) {
    if (typeof window.toast === 'function' && window.toast !== toast) {
      window.toast(msg, type, duration);
      return;
    }
    console.info('[ops toast]', type || 'info', msg);
  }

  function setScopedJson(key, value) {
    if (typeof window.setScopedJson === 'function' && window.setScopedJson !== setScopedJson) {
      window.setScopedJson(key, value);
      return;
    }
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function setVal(id, val) {
    var el = document.getElementById(id);
    if (el) el.value = val;
  }

  function getState() {
    if (typeof safeLocalParse === 'function') {
      const s = safeLocalParse(STORAGE_KEY, null);
      if (s && typeof s === 'object') return ensureDefaults(s);
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return ensureDefaults(parsed);
    } catch (_) {
      return ensureDefaults({});
    }
  }

  function ensureDefaults(state) {
    const s = state || {};
    s.cases = Array.isArray(s.cases) ? s.cases : [];
    s.approvals = Array.isArray(s.approvals) ? s.approvals : [];
    s.kycReviews = Array.isArray(s.kycReviews) ? s.kycReviews : [];
    s.regulatoryChanges = Array.isArray(s.regulatoryChanges) ? s.regulatoryChanges : [];
    s.auditTrail = Array.isArray(s.auditTrail) ? s.auditTrail : [];
    s.screenings = Array.isArray(s.screenings) ? s.screenings : [];
    s.modelMetrics = s.modelMetrics && typeof s.modelMetrics === 'object'
      ? s.modelMetrics
      : { validatedRuns: 0, generatedCases: 0, closedCases: 0, falsePositives: 0 };
    return s;
  }

  function setState(state) {
    if (typeof safeLocalSave === 'function') { safeLocalSave(STORAGE_KEY, state); }
    else { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  }

  function h(str) {
    let hash = 0;
    const txt = String(str || '');
    for (let i = 0; i < txt.length; i += 1) {
      hash = ((hash << 5) - hash) + txt.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  function esc(v) {
    if (typeof escHtml === 'function') return escHtml(v);
    return String(v || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function addAudit(action, detail) {
    const s = getState();
    const prev = s.auditTrail.length ? s.auditTrail[s.auditTrail.length - 1].hash : 'root';
    const rec = {
      ts: new Date().toISOString(),
      action,
      detail,
      prev,
      hash: h(`${prev}|${action}|${JSON.stringify(detail)}|${Date.now()}`)
    };
    s.auditTrail.push(rec);
    if (s.auditTrail.length > 400) s.auditTrail.shift();
    setState(s);
    renderAuditMeta();
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function runScreeningCheck() {
    const name = (byId('opsEntityName')?.value || '').trim();
    const country = (byId('opsEntityCountry')?.value || '').trim();
    const type = (byId('opsEntityType')?.value || 'customer').trim();
    if (!name) {
      toast('Entity name is required', 'error');
      return;
    }

    const raw = `${name} ${country}`.toLowerCase();
    const sanctionsHit = /iran|syria|north korea|russia|sudan|cuba/.test(raw);
    const pepHit = /minister|senator|politically exposed|mp|royal/.test(raw);
    const adverseHit = /fraud|bribery|sanction|money laundering|investigation/.test(raw);

    const s = getState();
    s.screenings.unshift({
      id: Date.now(),
      ts: new Date().toISOString(),
      name,
      country,
      type,
      sanctionsHit,
      pepHit,
      adverseHit,
      overall: sanctionsHit || pepHit || adverseHit ? 'REVIEW' : 'CLEAR'
    });
    s.screenings = s.screenings.slice(0, 120);
    setState(s);

    const out = byId('opsScreeningResult');
    if (out) {
      const flag = sanctionsHit || pepHit || adverseHit;
      out.innerHTML = flag
        ? `Result: <strong style="color:var(--amber)">REVIEW REQUIRED</strong> | Sanctions: ${sanctionsHit ? 'Hit' : 'Clear'} | PEP: ${pepHit ? 'Hit' : 'Clear'} | Adverse: ${adverseHit ? 'Hit' : 'Clear'}`
        : `Result: <strong style="color:var(--green)">CLEAR</strong> | No simulated hit patterns detected.`;
    }

    addAudit('screening-run', { name, country, type, sanctionsHit, pepHit, adverseHit });
    toast('Screening check completed', 'success');
  }

  function runOpsRules() {
    const threshold = Number(byId('opsRuleStructuring')?.value || 10000);
    const rapidDays = Number(byId('opsRuleRapidDays')?.value || 3);
    const corridor = String(byId('opsRuleCorridor')?.value || '').toLowerCase().split(',').map(v => v.trim()).filter(Boolean);

    const list = Array.isArray(window.shipments) ? window.shipments : [];
    const now = new Date();
    const flags = [];

    const byCustomer = new Map();
    list.forEach(sh => {
      const key = String(sh.customerId || sh.supplierCustomer || 'UNKNOWN');
      if (!byCustomer.has(key)) byCustomer.set(key, []);
      byCustomer.get(key).push(sh);

      const c = String(sh.originCountry || '').toLowerCase();
      if (corridor.some(x => c.includes(x))) {
        flags.push(`High-risk corridor: ${key} | origin ${sh.originCountry || 'N/A'}`);
      }
    });

    byCustomer.forEach((arr, cust) => {
      const recent = arr.filter(sh => {
        const t = new Date(sh.createdAt || sh.ts || Date.now());
        return Number.isFinite(t.getTime()) && ((now - t) / (1000 * 60 * 60 * 24)) <= rapidDays;
      });
      const total = recent.reduce((sum, sh) => sum + Number(sh.amount || 0), 0);
      if (total >= threshold) {
        flags.push(`Structuring threshold crossed: ${cust} | ${recent.length} shipments | USD ${total.toFixed(2)}`);
      }
    });

    const el = byId('opsRulesResult');
    if (el) {
      el.innerHTML = flags.length
        ? flags.map(f => `<div style="margin:4px 0;color:var(--amber)">• ${esc(f)}</div>`).join('')
        : '<span style="color:var(--green)">No rule triggers in current shipment set.</span>';
    }

    addAudit('rules-run', { threshold, rapidDays, corridor, flagsCount: flags.length });
    toast(`Rules run completed (${flags.length} trigger(s))`, flags.length ? 'info' : 'success');
  }

  function createCaseFromLatestAnalysis() {
    const res = window.lastResult;
    if (!res || !Array.isArray(res.findings) || !res.findings.length) {
      toast('Run an analysis first', 'error');
      return;
    }

    const critical = res.findings.filter(f => String(f.severity || '').toUpperCase() === 'CRITICAL').length;
    const high = res.findings.filter(f => String(f.severity || '').toUpperCase() === 'HIGH').length;
    const severity = critical > 0 ? 'CRITICAL' : high > 0 ? 'HIGH' : 'MEDIUM';

    const s = getState();
    const id = `CASE-${Date.now()}`;
    s.cases.unshift({
      id,
      ts: new Date().toISOString(),
      status: 'OPEN',
      severity,
      title: `Analysis Case: ${(window.lastQuery || 'Compliance Review').slice(0, 80)}`,
      summary: String(res.summary || '').slice(0, 220),
      owner: 'Compliance Team',
      slaHours: severity === 'CRITICAL' ? 24 : severity === 'HIGH' ? 48 : 72
    });
    s.modelMetrics.generatedCases = Number(s.modelMetrics.generatedCases || 0) + 1;
    s.modelMetrics.validatedRuns = Number(s.modelMetrics.validatedRuns || 0) + 1;
    setState(s);

    addAudit('case-created', { id, severity });
    renderCases();
    renderModelMetrics();
    toast(`Case created: ${id}`, 'success');
  }

  function closeCase(caseId, disposition) {
    const s = getState();
    const c = s.cases.find(x => x.id === caseId);
    if (!c) return;
    c.status = 'CLOSED';
    c.closedAt = new Date().toISOString();
    c.disposition = disposition;
    s.modelMetrics.closedCases = Number(s.modelMetrics.closedCases || 0) + 1;
    if (disposition === 'FALSE_POSITIVE') {
      s.modelMetrics.falsePositives = Number(s.modelMetrics.falsePositives || 0) + 1;
    }
    setState(s);
    addAudit('case-closed', { caseId, disposition });
    renderCases();
    renderModelMetrics();
  }

  function renderCases() {
    const s = getState();
    const el = byId('opsCasesList');
    if (!el) return;
    const open = s.cases.filter(c => c.status === 'OPEN');
    if (!open.length) {
      el.innerHTML = '<p style="color:var(--muted);font-size:13px">No open cases.</p>';
      return;
    }

    el.innerHTML = open.map(c => `
      <div class="asana-item" style="grid-template-columns:1fr auto;gap:10px">
        <div>
          <div class="asana-name">${esc(c.id)} | ${esc(c.severity)} | ${esc(c.title)}</div>
          <div class="asana-meta">SLA ${esc(c.slaHours)}h | Owner ${esc(c.owner)} | ${esc(c.summary)}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-sm btn-green" data-action="closeCaseById" data-arg="${esc(c.id)}" data-arg2="ESCALATED">Escalate</button>
          <button class="btn btn-sm" data-action="closeCaseById" data-arg="${esc(c.id)}" data-arg2="FALSE_POSITIVE">False Positive</button>
        </div>
      </div>
    `).join('');
  }

  function calculateOpsRiskScore() {
    const country = Number(byId('opsRiskCountry')?.value || 0);
    const pep = Number(byId('opsRiskPep')?.value || 0);
    const behavior = Number(byId('opsRiskBehavior')?.value || 0);
    const score = Math.max(0, Math.min(100, country + pep + behavior));
    const tier = score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
    const el = byId('opsRiskResult');
    if (el) {
      el.innerHTML = `Composite Risk Score: <strong style="color:${tier === 'HIGH' ? 'var(--red)' : tier === 'MEDIUM' ? 'var(--amber)' : 'var(--green)'}">${score} (${tier})</strong>`;
    }
    addAudit('risk-score', { score, tier, country, pep, behavior });
    toast(`Risk score computed: ${score} (${tier})`, 'success');
  }

  function enqueueOpsApproval() {
    const type = (byId('opsApprovalType')?.value || '').trim();
    const ref = (byId('opsApprovalRef')?.value || '').trim();
    if (!ref) {
      toast('Reference is required', 'error');
      return;
    }
    const s = getState();
    s.approvals.unshift({ id: `APR-${Date.now()}`, type, ref, status: 'PENDING', ts: new Date().toISOString() });
    s.approvals = s.approvals.slice(0, 180);
    setState(s);
    addAudit('approval-enqueued', { type, ref });
    renderApprovals();
    toast('Approval item queued', 'success');
  }

  function decideApproval(id, approve) {
    const s = getState();
    const a = s.approvals.find(x => x.id === id);
    if (!a) return;
    a.status = approve ? 'APPROVED' : 'REJECTED';
    a.decidedAt = new Date().toISOString();
    setState(s);
    addAudit('approval-decided', { id, status: a.status });
    renderApprovals();
  }

  function renderApprovals() {
    const s = getState();
    const el = byId('opsApprovalsList');
    if (!el) return;
    const pending = s.approvals.filter(a => a.status === 'PENDING');
    if (!pending.length) {
      el.innerHTML = '<p style="color:var(--muted);font-size:13px">No pending approvals.</p>';
      return;
    }
    el.innerHTML = pending.map(a => `
      <div class="asana-item" style="grid-template-columns:1fr auto;gap:10px">
        <div>
          <div class="asana-name">${esc(a.id)} | ${esc(a.type)}</div>
          <div class="asana-meta">Reference ${esc(a.ref)} | Created ${esc(new Date(a.ts).toLocaleString('en-GB'))}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-sm btn-green" data-action="resolveApproval" data-arg="${esc(a.id)}" data-arg2="true">Approve</button>
          <button class="btn btn-sm btn-red" data-action="resolveApproval" data-arg="${esc(a.id)}" data-arg2="false">Reject</button>
        </div>
      </div>
    `).join('');
  }

  function nextDate(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  }

  function generateOpsKycReviews() {
    const list = Array.isArray(window.shipments) ? window.shipments : [];
    const seen = new Set();
    const generated = [];

    list.forEach(sh => {
      const key = String(sh.customerId || sh.supplierCustomer || '').trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      const rr = String(sh.riskRating || '').toUpperCase();
      const risk = rr === 'HIGH' ? 'HIGH' : rr === 'MEDIUM' ? 'MEDIUM' : 'LOW';
      const days = risk === 'HIGH' ? 180 : risk === 'MEDIUM' ? 365 : 540;
      generated.push({ id: `KYC-${Date.now()}-${generated.length}`, customer: key, risk, due: nextDate(days), status: 'DUE' });
    });

    const s = getState();
    s.kycReviews = generated;
    setState(s);
    addAudit('kyc-generated', { count: generated.length });
    renderKyc();
    toast(`KYC review schedule generated (${generated.length})`, 'success');
  }

  function renderKyc() {
    const s = getState();
    const el = byId('opsKycList');
    if (!el) return;
    if (!s.kycReviews.length) {
      el.innerHTML = '<p style="color:var(--muted);font-size:13px">No scheduled reviews.</p>';
      return;
    }
    el.innerHTML = s.kycReviews.map(k => `
      <div class="asana-item" style="grid-template-columns:1fr auto;gap:10px">
        <div>
          <div class="asana-name">${esc(k.customer)} | Risk ${esc(k.risk)}</div>
          <div class="asana-meta">Next review due ${esc(k.due)}</div>
        </div>
        <span class="asana-status s-due">${esc(k.status)}</span>
      </div>
    `).join('');
  }

  function generateOpsStrDraft() {
    const s = getState();
    const openCases = s.cases.filter(c => c.status === 'OPEN');
    if (!openCases.length) {
      toast('No open cases to draft STR from', 'error');
      return;
    }
    const payload = {
      generatedAt: new Date().toISOString(),
      jurisdiction: 'UAE',
      reportingType: 'STR/SAR Draft',
      caseCount: openCases.length,
      cases: openCases.map(c => ({ id: c.id, severity: c.severity, title: c.title, summary: c.summary }))
    };

    const text = JSON.stringify(payload, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ComplianceTasks_STR_Draft_${new Date().toISOString().split('T')[0]}.json`;
    a.click();

    const el = byId('opsStrResult');
    if (el) el.textContent = `STR draft generated with ${openCases.length} case(s).`;
    addAudit('str-draft-generated', { caseCount: openCases.length });
    toast('STR draft exported', 'success');
  }

  function generateOpsSarDraft() {
    const s = getState();
    const openCases = s.cases.filter(c => c.status === 'OPEN');
    if (!openCases.length) {
      toast('No open cases to draft SAR from', 'error');
      return;
    }
    const payload = {
      generatedAt: new Date().toISOString(),
      jurisdiction: 'UAE',
      reportingType: 'SAR Draft — Suspicious Activity Report',
      filingAuthority: 'UAE Financial Intelligence Unit (FIU) via goAML',
      regulatoryBasis: 'Federal Decree-Law No. (10) of 2025, Art. 15-17; Cabinet Resolution No. (134) of 2025',
      caseCount: openCases.length,
      cases: openCases.map(c => ({ id: c.id, severity: c.severity, title: c.title, summary: c.summary })),
      sections: {
        subjectInformation: 'To be completed — Name, ID, nationality, address',
        suspiciousActivity: 'To be completed — Description of suspicious activity or behaviour',
        transactionDetails: 'To be completed — Amounts, dates, counterparties, accounts',
        groundsForSuspicion: 'To be completed — Red flags, indicators, supporting evidence',
        actionsTaken: 'To be completed — Internal escalation, asset freeze, enhanced monitoring'
      }
    };

    const text = JSON.stringify(payload, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ComplianceTasks_SAR_Draft_${new Date().toISOString().split('T')[0]}.json`;
    a.click();

    const el = byId('opsSarResult') || byId('opsStrResult');
    if (el) el.textContent = `SAR draft generated with ${openCases.length} case(s). File for goAML submission.`;
    addAudit('sar-draft-generated', { caseCount: openCases.length });
    toast('SAR draft exported', 'success');
  }

  function addOpsRegulatoryChange() {
    const source = (byId('opsRegSource')?.value || '').trim();
    const owner = (byId('opsRegOwner')?.value || '').trim();
    const due = (byId('opsRegDue')?.value || '').trim();
    const summary = (byId('opsRegSummary')?.value || '').trim();
    if (!source || !owner || !due || !summary) {
      toast('Fill source, owner, due date, and summary', 'error');
      return;
    }

    const s = getState();
    s.regulatoryChanges.unshift({ id: `REG-${Date.now()}`, source, owner, due, summary, status: 'OPEN' });
    s.regulatoryChanges = s.regulatoryChanges.slice(0, 120);
    setState(s);
    addAudit('reg-change-added', { source, owner, due });

    setVal('opsRegSource', '');
    setVal('opsRegOwner', '');
    setVal('opsRegDue', '');
    setVal('opsRegSummary', '');

    renderRegulatoryChanges();
    toast('Regulatory change logged', 'success');
  }

  function renderRegulatoryChanges() {
    const s = getState();
    const el = byId('opsRegList');
    if (!el) return;
    if (!s.regulatoryChanges.length) {
      el.innerHTML = '<p style="color:var(--muted);font-size:13px">No tracked changes.</p>';
      return;
    }
    el.innerHTML = s.regulatoryChanges.map(r => `
      <div class="asana-item" style="grid-template-columns:1fr auto;gap:10px">
        <div>
          <div class="asana-name">${esc(r.id)} | ${esc(r.source)}</div>
          <div class="asana-meta">Owner ${esc(r.owner)} | Due ${esc(r.due)}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:4px">${esc(r.summary)}</div>
        </div>
        <span class="asana-status s-due">${esc(r.status)}</span>
      </div>
    `).join('');
  }

  function renderAuditMeta() {
    const s = getState();
    const el = byId('opsAuditMeta');
    if (!el) return;
    if (!s.auditTrail.length) {
      el.textContent = 'Audit trail empty.';
      return;
    }
    const last = s.auditTrail[s.auditTrail.length - 1];
    el.textContent = `Entries: ${s.auditTrail.length} | Last hash: ${last.hash} | Last action: ${last.action}`;
  }

  function exportOpsAuditTrail() {
    const s = getState();
    if (!s.auditTrail.length) {
      toast('No audit data to export', 'error');
      return;
    }
    const blob = new Blob([JSON.stringify(s.auditTrail, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ComplianceTasks_AuditTrail_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    toast('Audit trail exported', 'success');
  }

  function renderModelMetrics() {
    const s = getState();
    const total = Math.max(1, Number(s.modelMetrics.closedCases || 0));
    const fp = Number(s.modelMetrics.falsePositives || 0);
    const ratio = ((fp / total) * 100).toFixed(1);
    const el = byId('opsModelMetrics');
    if (!el) return;
    el.innerHTML = `Validated runs: <strong>${Number(s.modelMetrics.validatedRuns || 0)}</strong> | Cases generated: <strong>${Number(s.modelMetrics.generatedCases || 0)}</strong> | Cases closed: <strong>${Number(s.modelMetrics.closedCases || 0)}</strong> | False positives: <strong>${fp}</strong> | FP ratio: <strong>${ratio}%</strong>`;
  }

  function loadOpsDemoData() {
    setVal('opsEntityName', 'Al Noor Bullion Trading LLC');
    setVal('opsEntityCountry', 'Iran');
    setVal('opsEntityType', 'supplier');
    setVal('opsRiskCountry', 25);
    setVal('opsRiskPep', 20);
    setVal('opsRiskBehavior', 25);
    setVal('opsApprovalType', 'high-risk-onboarding');
    setVal('opsApprovalRef', 'CUST-DEMO-001');
    setVal('opsRegSource', 'MoE Circular');
    setVal('opsRegOwner', 'Compliance Officer');
    setVal('opsRegDue', new Date(Date.now() + (14 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0]);
    setVal('opsRegSummary', 'Update enhanced due diligence steps for high-risk precious metals suppliers and document escalation thresholds.');

    const demoTs = new Date().toISOString();
    const demoShipments = [
      { id: 'demo-sh-1', invoiceNo: 'INV-DEMO-001', supplierCustomer: 'Al Noor Bullion Trading LLC', productBrand: 'Gold Bar 1kg', material: 'XAU', amount: 6400, originCountry: 'Iran', destinationCountry: 'UAE', customerId: 'CUST-DEMO-001', direction: 'Received', currency: 'USD', riskRating: 'High', createdAt: demoTs },
      { id: 'demo-sh-2', invoiceNo: 'INV-DEMO-002', supplierCustomer: 'Al Noor Bullion Trading LLC', productBrand: 'Gold Bar 500g', material: 'XAU', amount: 5200, originCountry: 'Iran', destinationCountry: 'UAE', customerId: 'CUST-DEMO-001', direction: 'Received', currency: 'USD', riskRating: 'High', createdAt: demoTs }
    ];
    window.shipments = demoShipments;
    setScopedJson('fgl_shipments', demoShipments);
    if (typeof renderShipments === 'function') renderShipments();

    window.lastQuery = 'Demo AML review for high-risk bullion supplier and structuring alerts';
    window.lastArea = 'tbml';
    window.lastResult = {
      summary: 'Demo result: supplier presents elevated sanctions exposure, high-risk geography, and structuring indicators requiring investigation.',
      metrics: { critical: 1, high: 2, medium: 1, compliant: 0 },
      findings: [
        { severity: 'CRITICAL', title: 'High-risk geography exposure', body: 'Supplier origin indicates high sanctions and EDD exposure.', regulatory_ref: 'UAE FDL No.10/2025', recommendation: 'Escalate to MLRO and perform EDD immediately.', asana_task_name: 'Demo EDD escalation' },
        { severity: 'HIGH', title: 'Possible structuring pattern', body: 'Two recent inbound shipments exceed the configured short-window threshold.', regulatory_ref: 'Transaction Monitoring Controls', recommendation: 'Open investigation case and document rationale.', asana_task_name: 'Demo structuring investigation' }
      ]
    };

    const el = byId('opsDemoResult');
    if (el) el.textContent = 'Demo data loaded: entity, shipments, analysis result, approval reference, and regulatory change draft.';
    toast('Demo data loaded', 'success');
  }

  function runOpsDemoDownload() {
    loadOpsDemoData();
    runScreeningCheck();
    runOpsRules();
    calculateOpsRiskScore();
    createCaseFromLatestAnalysis();
    enqueueOpsApproval();
    generateOpsKycReviews();
    addOpsRegulatoryChange();
    generateOpsStrDraft();
    exportOpsAuditTrail();
    renderComplianceOps();
    const el = byId('opsDemoResult');
    if (el) el.textContent = 'Demo workflow completed. STR draft and audit trail downloads were triggered.';
    toast('Demo workflow completed', 'success', 4500);
  }

  function renderComplianceOps() {
    renderCases();
    renderApprovals();
    renderKyc();
    renderRegulatoryChanges();
    renderAuditMeta();
    renderModelMetrics();
  }

  window.runScreeningCheck = runScreeningCheck;
  window.runOpsRules = runOpsRules;
  window.createCaseFromLatestAnalysis = createCaseFromLatestAnalysis;
  window.calculateOpsRiskScore = calculateOpsRiskScore;
  window.loadOpsDemoData = loadOpsDemoData;
  window.runOpsDemoDownload = runOpsDemoDownload;
  window.enqueueOpsApproval = enqueueOpsApproval;
  window.resolveApproval = decideApproval;
  window.generateOpsKycReviews = generateOpsKycReviews;
  window.generateOpsStrDraft = generateOpsStrDraft;
  window.generateOpsSarDraft = generateOpsSarDraft;
  window.addOpsRegulatoryChange = addOpsRegulatoryChange;
  window.exportOpsAuditTrail = exportOpsAuditTrail;
  window.closeCaseById = closeCase;
  window.renderComplianceOps = renderComplianceOps;
})();

