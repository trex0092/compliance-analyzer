/**
 * Regulatory Monitor Module — Hawkeye Sterling V2 v2.3
 * Real-time regulatory monitoring, framework database, alerts, and health scoring
 */
(function () {
  'use strict';

  const REG_MONITOR_KEY = 'fgl_reg_monitor';
  const REG_ALERTS_KEY = 'fgl_reg_alerts';
  const REG_CHANGES_KEY = 'fgl_reg_changes';
  const REG_SCORES_KEY = 'fgl_reg_scores_history';

  const FRAMEWORKS = {
    uae_fdl: {
      id: 'uae_fdl', name: 'UAE FDL No.10/2025', jurisdiction: 'UAE',
      icon: '🇦🇪', category: 'AML/CFT',
      description: 'Federal Decree-Law on Anti-Money Laundering for precious metals and stones dealers',
      last_updated: '2025-01-15',
      key_requirements: [
        'Customer Due Diligence (CDD) for all transactions',
        'Enhanced Due Diligence (EDD) for high-risk customers',
        'Suspicious Transaction Reporting (STR) to UAE FIU',
        'Record keeping for minimum 5 years',
        'Compliance Officer appointment',
        'Employee training programs',
        'Risk-based approach implementation',
        'Sanctions screening obligations',
      ],
      risk_areas: ['Customer identification', 'Transaction monitoring', 'Sanctions compliance', 'Record keeping'],
      penalties: 'Fines up to AED 50M, license revocation, criminal prosecution',
    },
    fatf: {
      id: 'fatf', name: 'FATF Recommendations', jurisdiction: 'International',
      icon: '🌍', category: 'AML/CFT',
      description: 'Financial Action Task Force 40 Recommendations on money laundering and terrorist financing',
      last_updated: '2024-11-01',
      key_requirements: [
        'Risk assessment and risk-based approach (Rec 1)',
        'National cooperation and coordination (Rec 2)',
        'Money laundering offence (Rec 3)',
        'Confiscation and provisional measures (Rec 4)',
        'Customer due diligence (Rec 10)',
        'Record keeping (Rec 11)',
        'Politically exposed persons (Rec 12)',
        'Correspondent banking (Rec 13)',
        'Wire transfers (Rec 16)',
        'Suspicious transaction reporting (Rec 20)',
        'Designated non-financial businesses (Rec 22-23)',
        'Precious metals and stones dealers (Rec 22)',
      ],
      risk_areas: ['ML/TF risk assessment', 'CDD gaps', 'STR filing', 'DNFBP compliance'],
      penalties: 'FATF grey/black listing, restricted international banking access',
    },
    eu_amld6: {
      id: 'eu_amld6', name: 'EU 6th Anti-Money Laundering Directive', jurisdiction: 'European Union',
      icon: '🇪🇺', category: 'AML/CFT',
      description: '6AMLD expanding ML predicate offences and harmonizing penalties across EU',
      last_updated: '2024-07-01',
      key_requirements: [
        'Extended list of 22 predicate offences',
        'Criminal liability for legal persons',
        'Minimum 4-year imprisonment for ML offences',
        'Aiding, abetting, inciting, and attempting ML is punishable',
        'Self-laundering is criminalized',
        'Harmonized sanctions across member states',
        'Enhanced cooperation between FIUs',
        'Dual criminality not required for prosecution',
      ],
      risk_areas: ['Predicate offence coverage', 'Corporate liability', 'Cross-border cooperation'],
      penalties: 'Min 4 years imprisonment, unlimited corporate fines',
    },
    uk_fca: {
      id: 'uk_fca', name: 'UK FCA AML Requirements', jurisdiction: 'United Kingdom',
      icon: '🇬🇧', category: 'AML/CFT',
      description: 'Financial Conduct Authority anti-money laundering regulations for regulated firms',
      last_updated: '2024-09-01',
      key_requirements: [
        'Risk-sensitive CDD measures',
        'Ongoing monitoring of business relationships',
        'Enhanced due diligence for high-risk situations',
        'PEP screening and management',
        'Sanctions compliance (OFSI)',
        'SAR filing to NCA UKFIU',
        'Annual MLRO report to board',
        'Staff training and awareness',
        'Reliance and outsourcing controls',
        'Record keeping (5 years from end of relationship)',
      ],
      risk_areas: ['CDD adequacy', 'Transaction monitoring', 'SAR quality', 'Governance'],
      penalties: 'Unlimited fines, public censure, enforcement actions',
    },
    us_bsa: {
      id: 'us_bsa', name: 'US Bank Secrecy Act / AML', jurisdiction: 'United States',
      icon: '🇺🇸', category: 'AML/CFT',
      description: 'Bank Secrecy Act and related AML requirements enforced by FinCEN',
      last_updated: '2024-06-01',
      key_requirements: [
        'AML program with internal controls',
        'BSA/AML compliance officer designation',
        'Independent testing/audit',
        'Customer Identification Program (CIP)',
        'Currency Transaction Reports (CTR) for $10,000+',
        'Suspicious Activity Reports (SAR)',
        'OFAC sanctions screening',
        'Beneficial ownership requirements (CDD Rule)',
        'Section 314(a) information sharing',
        'Record keeping (5 years)',
      ],
      risk_areas: ['CTR filing', 'SAR quality', 'OFAC compliance', 'Beneficial ownership'],
      penalties: 'Civil penalties up to $1M per violation, criminal prosecution',
    },
    oecd_ddg: {
      id: 'oecd_ddg', name: 'OECD Due Diligence Guidance', jurisdiction: 'International',
      icon: '🏛️', category: 'Responsible Sourcing',
      description: 'OECD Due Diligence Guidance for Responsible Supply Chains of Minerals from Conflict-Affected Areas',
      last_updated: '2024-03-01',
      key_requirements: [
        'Step 1: Establish strong management systems',
        'Step 2: Identify and assess supply chain risks',
        'Step 3: Design and implement risk mitigation strategy',
        'Step 4: Independent third-party audit',
        'Step 5: Report annually on due diligence',
        'Conflict mineral sourcing controls',
        'Supply chain mapping and traceability',
        'Grievance mechanism establishment',
      ],
      risk_areas: ['Supply chain transparency', 'Conflict minerals', 'Third-party audits'],
      penalties: 'Exclusion from responsible sourcing programs, reputational damage',
    },
    lbma_rgg: {
      id: 'lbma_rgg', name: 'LBMA Responsible Gold Guidance V9', jurisdiction: 'International',
      icon: '🥇', category: 'Responsible Sourcing',
      description: 'London Bullion Market Association guidance for responsible gold sourcing',
      last_updated: '2024-01-01',
      key_requirements: [
        'Know Your Customer (KYC) for all counterparties',
        'Conflict-affected and high-risk area (CAHRA) assessment',
        'Supply chain due diligence policy',
        'Transaction monitoring for red flags',
        'Incident management and reporting',
        'Annual independent audit',
        'Public reporting of due diligence',
        'Recycled gold source verification',
        'Artisanal and small-scale mining (ASM) due diligence',
      ],
      risk_areas: ['CAHRA sourcing', 'KYC gaps', 'Audit compliance', 'ASM risks'],
      penalties: 'Removal from LBMA Good Delivery List, market access restrictions',
    },
    basel_aml: {
      id: 'basel_aml', name: 'Basel AML Index', jurisdiction: 'International',
      icon: '📊', category: 'Risk Assessment',
      description: 'Basel Institute on Governance AML risk rating methodology',
      last_updated: '2024-10-01',
      key_requirements: [
        'Country risk assessment using Basel AML Index scores',
        'Integration of risk scores into CDD processes',
        'Regular update of country risk ratings',
        'Enhanced measures for high-risk jurisdictions',
        'Documentation of risk-based decisions',
        'Monitoring of jurisdiction risk changes',
      ],
      risk_areas: ['Country risk scoring', 'Risk-based approach', 'Jurisdiction monitoring'],
      penalties: 'Regulatory criticism for inadequate risk assessment',
    },
  };

  function getMonitorState() {
    try { return JSON.parse(localStorage.getItem(REG_MONITOR_KEY) || '{}'); } catch (_) { return {}; }
  }
  function saveMonitorState(s) { localStorage.setItem(REG_MONITOR_KEY, JSON.stringify(s)); }

  function getAlertHistory() {
    try { return JSON.parse(localStorage.getItem(REG_ALERTS_KEY) || '[]'); } catch (_) { return []; }
  }
  function saveAlerts(a) { localStorage.setItem(REG_ALERTS_KEY, JSON.stringify(a.slice(0, 500))); }

  function getRegChanges() {
    try { return JSON.parse(localStorage.getItem(REG_CHANGES_KEY) || '[]'); } catch (_) { return []; }
  }
  function saveRegChanges(c) { localStorage.setItem(REG_CHANGES_KEY, JSON.stringify(c)); }

  function getScoreHistory() {
    try { return JSON.parse(localStorage.getItem(REG_SCORES_KEY) || '[]'); } catch (_) { return []; }
  }
  function saveScoreHistory(h) { localStorage.setItem(REG_SCORES_KEY, JSON.stringify(h.slice(0, 365))); }

  // ── Health Score Calculation ──
  function calculateHealthScore() {
    const state = getMonitorState();
    const scores = {};
    let totalScore = 0;
    let count = 0;

    Object.keys(FRAMEWORKS).forEach(fwId => {
      const fw = FRAMEWORKS[fwId];
      const fwState = state[fwId] || {};
      const reqCount = fw.key_requirements.length;
      const completedCount = (fwState.completedRequirements || []).length;
      const score = reqCount > 0 ? Math.round((completedCount / reqCount) * 100) : 0;
      scores[fwId] = { score, completed: completedCount, total: reqCount, status: getStatusFromScore(score) };
      totalScore += score;
      count++;
    });

    const overall = count > 0 ? Math.round(totalScore / count) : 0;

    // Save to history
    const history = getScoreHistory();
    history.unshift({ date: new Date().toISOString(), overall, scores });
    saveScoreHistory(history);

    return { overall, status: getStatusFromScore(overall), frameworks: scores };
  }

  function getStatusFromScore(score) {
    if (score >= 80) return 'Compliant';
    if (score >= 60) return 'Partially Compliant';
    if (score >= 40) return 'At Risk';
    return 'Non-Compliant';
  }

  function getStatusColor(status) {
    const colors = { 'Compliant': 'green', 'Partially Compliant': 'amber', 'At Risk': 'amber', 'Non-Compliant': 'red' };
    return colors[status] || 'muted';
  }

  // ── Toggle Requirement Completion ──
  function toggleRequirement(fwId, reqIndex) {
    const state = getMonitorState();
    if (!state[fwId]) state[fwId] = { completedRequirements: [] };
    const completed = state[fwId].completedRequirements;
    const idx = completed.indexOf(reqIndex);
    if (idx === -1) completed.push(reqIndex);
    else completed.splice(idx, 1);
    saveMonitorState(state);
  }

  // ── Alert System ──
  function createAlert(alert) {
    const alerts = getAlertHistory();
    const today = new Date().toISOString().slice(0, 10);
    const isDup = alerts.some(a => a.type === alert.type && a.framework === alert.framework && a.message === alert.message && a.createdAt && a.createdAt.slice(0, 10) === today);
    if (isDup) return;
    alerts.unshift({
      id: crypto.randomUUID(),
      ...alert,
      createdAt: new Date().toISOString(),
      acknowledged: false,
    });
    saveAlerts(alerts);
  }

  function acknowledgeAlert(id) {
    const alerts = getAlertHistory();
    const a = alerts.find(x => x.id === id);
    if (a) { a.acknowledged = true; a.acknowledgedAt = new Date().toISOString(); }
    saveAlerts(alerts);
  }

  function checkAlerts() {
    const health = calculateHealthScore();
    const newAlerts = [];

    Object.entries(health.frameworks).forEach(([fwId, data]) => {
      if (data.score < 40) {
        newAlerts.push({
          severity: 'Critical',
          framework: FRAMEWORKS[fwId].name,
          message: `${FRAMEWORKS[fwId].name} compliance score is ${data.score}% — immediate action required`,
          type: 'low_score',
        });
      } else if (data.score < 60) {
        newAlerts.push({
          severity: 'High',
          framework: FRAMEWORKS[fwId].name,
          message: `${FRAMEWORKS[fwId].name} compliance score is ${data.score}% — attention needed`,
          type: 'low_score',
        });
      }
    });

    // Check overdue regulatory changes
    const changes = getRegChanges();
    const now = new Date();
    changes.filter(c => c.status !== 'completed' && c.deadline && new Date(c.deadline + 'T23:59:59') < now).forEach(c => {
      newAlerts.push({
        severity: 'High',
        framework: c.framework || 'General',
        message: `Overdue regulatory change: ${c.title} (deadline: ${c.deadline})`,
        type: 'overdue_change',
      });
    });

    newAlerts.forEach(a => createAlert(a));
    return newAlerts;
  }

  // ── Regulatory Change Tracker ──
  function addRegChange(change) {
    const changes = getRegChanges();
    changes.unshift({
      id: crypto.randomUUID(),
      ...change,
      status: change.status || 'pending',
      createdAt: new Date().toISOString(),
    });
    saveRegChanges(changes);
  }

  function updateRegChange(id, updates) {
    const changes = getRegChanges();
    const c = changes.find(x => x.id === id);
    if (c) Object.assign(c, updates);
    saveRegChanges(changes);
  }

  // ── Render Monitor Dashboard ──
  function renderMonitorDashboard() {
    const health = calculateHealthScore();
    const alerts = getAlertHistory();
    const changes = getRegChanges();
    const unackAlerts = alerts.filter(a => !a.acknowledged);
    const state = getMonitorState();

    const overallColor = getStatusColor(health.status);
    const scoreBarColor = health.overall >= 80 ? 'var(--green)' : health.overall >= 60 ? 'var(--amber)' : 'var(--red)';

    let html = `
<div class="card">
  <div style="display:flex;align-items:center;gap:20px;margin-bottom:16px">
    <div style="text-align:center">
      <div style="font-size:48px;font-family:'Cinzel',serif;color:${scoreBarColor}">${health.overall}</div>
      <div style="font-size:10px;color:var(--muted);font-family:'Montserrat',sans-serif">OVERALL SCORE</div>
    </div>
    <div style="flex:1">
      <div style="background:var(--surface2);border-radius:3px;height:12px;overflow:hidden">
        <div style="width:${health.overall}%;height:100%;background:${scoreBarColor};border-radius:3px;transition:width 0.5s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:10px;color:var(--muted);font-family:'Montserrat',sans-serif">
        <span>Status: <span style="color:var(--${overallColor})">${health.status}</span></span>
        <span>${unackAlerts.length} unacknowledged alert${unackAlerts.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  </div>
</div>

<div class="card">
  <div class="sec-title">FRAMEWORK COMPLIANCE STATUS</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px">`;

    Object.entries(FRAMEWORKS).forEach(([fwId, fw]) => {
      const fwScore = health.frameworks[fwId] || { score: 0, completed: 0, total: fw.key_requirements.length, status: 'Non-Compliant' };
      const col = getStatusColor(fwScore.status);
      const barCol = fwScore.score >= 80 ? 'var(--green)' : fwScore.score >= 60 ? 'var(--amber)' : 'var(--red)';

      html += `
    <div style="background:var(--surface);border:1px solid var(--border);border-left:3px solid ${barCol};border-radius:4px;padding:12px;cursor:pointer" onclick="RegulatoryMonitor.expandFramework('${fwId}')">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:13px;font-weight:500">${fw.icon} ${fw.name}</div>
        <span style="font-size:20px;font-family:'Cinzel',serif;color:${barCol}">${fwScore.score}%</span>
      </div>
      <div style="font-size:10px;color:var(--muted);margin:4px 0">${fw.jurisdiction} | ${fw.category}</div>
      <div style="font-size:9px;color:var(--muted);margin:4px 0;line-height:1.4;max-height:28px;overflow:hidden">${fw.description}</div>
      <div style="background:var(--surface2);border-radius:4px;height:6px;overflow:hidden;margin-top:6px">
        <div style="width:${fwScore.score}%;height:100%;background:${barCol};border-radius:4px"></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
        <div style="font-size:10px;color:var(--muted);font-family:'Montserrat',sans-serif">${fwScore.completed}/${fwScore.total} requirements met</div>
        <span style="font-size:9px;padding:1px 6px;background:${fwScore.score >= 80 ? 'rgba(63,185,80,0.1)' : fwScore.score >= 60 ? 'rgba(227,179,65,0.1)' : 'rgba(248,81,73,0.1)'};color:${barCol};border:1px solid ${barCol};font-family:'Montserrat',sans-serif">${fwScore.status}</span>
      </div>
      <div style="font-size:9px;color:var(--muted);margin-top:4px;font-family:'Montserrat',sans-serif">Updated: ${fw.last_updated} | ${fw.risk_areas.length} risk areas | ${fw.penalties.split(',')[0]}</div>
    </div>`;
    });

    html += `</div></div>`;

    // Framework detail expandable
    html += `<div id="frameworkDetail" class="card" style="display:none"></div>`;

    // Alerts
    html += `
<div class="card">
  <div class="sec-title">ALERTS <span style="color:var(--muted);font-size:10px">(${unackAlerts.length} unacknowledged)</span></div>
  <div style="margin-bottom:8px"><button class="btn-sm btn-green" onclick="RegulatoryMonitor.checkAlerts();switchTab('monitor')">Run Alert Check</button></div>`;

    if (alerts.length) {
      html += alerts.slice(0, 20).map(a => {
        const sevClass = a.severity === 'Critical' ? 'b-c' : a.severity === 'High' ? 'b-h' : 'b-m';
        return `
      <div class="asana-item" style="${a.acknowledged ? 'opacity:0.5' : ''}">
        <div>
          <div class="asana-name"><span class="badge ${sevClass}">${a.severity}</span> ${a.message}</div>
          <div class="asana-meta">${a.framework} | ${new Date(a.createdAt).toLocaleString('en-GB')}</div>
        </div>
        ${!a.acknowledged ? `<button class="btn-sm" onclick="RegulatoryMonitor.acknowledgeAlert('${a.id}');switchTab('monitor')">Ack</button>` : '<span class="asana-status s-ok">ACK</span>'}
      </div>`;
      }).join('');
    } else {
      html += '<p style="color:var(--muted);font-size:13px">No alerts.</p>';
    }
    html += `</div>`;

    return html;
  }

  // ── Render Regulatory Change Tracker (own tab) ──
  function renderChangeTrackerTab() {
    const changes = getRegChanges();
    const overdueCount = changes.filter(c => c.status !== 'completed' && c.deadline && new Date(c.deadline + 'T23:59:59') < new Date()).length;
    const pendingCount = changes.filter(c => c.status !== 'completed').length;
    const completedCount = changes.filter(c => c.status === 'completed').length;

    let html = `
<div class="card">
  <div class="top-bar" style="margin-bottom:10px">
    <span class="sec-title" style="margin:0;border:none;padding:0">Regulatory Change Tracker</span>
    <span style="font-size:11px;color:var(--muted);font-family:'Montserrat',sans-serif">Track regulatory updates, impact assessments, and compliance deadlines</span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
    <div style="background:var(--surface2);border-radius:3px;padding:10px;text-align:center">
      <div style="font-size:20px;font-weight:500;color:var(--amber)">${pendingCount}</div>
      <div style="font-size:10px;color:var(--muted);font-family:'Montserrat',sans-serif">Pending</div>
    </div>
    <div style="background:var(--surface2);border-radius:3px;padding:10px;text-align:center">
      <div style="font-size:20px;font-weight:500;color:var(--red)">${overdueCount}</div>
      <div style="font-size:10px;color:var(--muted);font-family:'Montserrat',sans-serif">Overdue</div>
    </div>
    <div style="background:var(--surface2);border-radius:3px;padding:10px;text-align:center">
      <div style="font-size:20px;font-weight:500;color:var(--green)">${completedCount}</div>
      <div style="font-size:10px;color:var(--muted);font-family:'Montserrat',sans-serif">Completed</div>
    </div>
  </div>
</div>

<div class="card">
  <span class="sec-title">Add New Regulatory Change</span>
  <div class="row row-3" style="margin-bottom:8px">
    <div><label class="lbl">TITLE</label><input id="regChangeTitle" placeholder="Change title" /></div>
    <div><label class="lbl">FRAMEWORK</label><select id="regChangeFw">${Object.entries(FRAMEWORKS).map(([k, v]) => `<option value="${v.name}">${v.icon} ${v.name}</option>`).join('')}</select></div>
    <div><label class="lbl">DEADLINE</label><input id="regChangeDeadline" type="text" placeholder="dd/mm/yyyy" oninput="if(window.csFormatDateInput)csFormatDateInput(this);else if(window.maFormatDateInput)maFormatDateInput(this)" maxlength="10" /></div>
  </div>
  <div style="margin-bottom:8px"><label class="lbl">IMPACT</label><textarea id="regChangeImpact" rows="2" placeholder="Describe impact on current compliance program..."></textarea></div>
  <div style="display:flex;gap:6px;margin-top:4px">
    <button class="btn btn-sm btn-green" onclick="RegulatoryMonitor.addChangeFromUI();switchTab('regchanges')">Add Change</button>
    <button class="btn btn-sm btn-red" onclick="if(confirm('Clear ALL regulatory changes?')){RegulatoryMonitor.clearAllChanges();switchTab('regchanges')}">Clear All</button>
  </div>
</div>

<div class="card">
  <span class="sec-title">Tracked Changes <span style="color:var(--muted);font-size:10px">(${changes.length} total)</span></span>`;

    if (changes.length) {
      html += changes.map(c => {
        const overdue = c.status !== 'completed' && new Date(c.deadline) < new Date();
        return `
      <div class="asana-item">
        <div>
          <div class="asana-name">${c.title}</div>
          <div class="asana-meta">${c.framework} | Deadline: ${c.deadline || 'N/A'} | ${c.impact || ''}</div>
        </div>
        <div style="display:flex;gap:4px">
          <span class="asana-status ${overdue ? 's-overdue' : c.status === 'completed' ? 's-ok' : 's-due'}">${overdue ? 'OVERDUE' : c.status}</span>
          ${c.status !== 'completed' ? `<button class="btn-sm btn-green" onclick="RegulatoryMonitor.updateRegChange('${c.id}',{status:'completed'});switchTab('regchanges')">✓</button>` : ''}
        </div>
      </div>`;
      }).join('');
    } else {
      html += '<p style="color:var(--muted);font-size:13px">No tracked regulatory changes. Use the form above to add one.</p>';
    }
    html += `</div>`;

    return html;
  }

  function expandFramework(fwId) {
    const fw = FRAMEWORKS[fwId];
    if (!fw) return;
    const state = getMonitorState();
    const completed = (state[fwId]?.completedRequirements) || [];
    const el = document.getElementById('frameworkDetail');
    if (!el) return;

    el.style.display = 'block';
    el.innerHTML = `
<div class="sec-title">${fw.icon} ${fw.name} — REQUIREMENTS CHECKLIST</div>
<p style="font-size:12px;color:var(--muted);margin-bottom:12px">${fw.description}</p>
<p style="font-size:11px;color:var(--muted);font-family:'Montserrat',sans-serif;margin-bottom:12px">
  Jurisdiction: ${fw.jurisdiction} | Category: ${fw.category} | Updated: ${fw.last_updated}<br>
  Penalties: ${fw.penalties}
</p>
<div style="margin-bottom:12px">
${fw.key_requirements.map((req, i) => {
  const done = completed.includes(i);
  return `<div style="display:flex;align-items:center;gap:8px;padding:8px;background:${done ? 'var(--green-dim)' : 'var(--surface2)'};border-radius:3px;margin-bottom:4px;cursor:pointer" onclick="RegulatoryMonitor.toggleRequirement('${fwId}',${i});switchTab('monitor')">
    <span style="font-size:16px">${done ? '✅' : '⬜'}</span>
    <span style="font-size:12px;color:${done ? 'var(--green)' : 'var(--text)'}">${req}</span>
  </div>`;
}).join('')}
</div>
<div style="font-size:11px;color:var(--muted);font-family:'Montserrat',sans-serif">
  <strong>Risk Areas:</strong> ${fw.risk_areas.join(' | ')}
</div>
<button class="btn-sm" onclick="document.getElementById('frameworkDetail').style.display='none'" style="margin-top:8px">Close</button>`;
    el.scrollIntoView({ behavior: 'smooth' });
  }

  function addChangeFromUI() {
    const title = document.getElementById('regChangeTitle')?.value;
    const framework = document.getElementById('regChangeFw')?.value;
    const deadline = document.getElementById('regChangeDeadline')?.value;
    const impact = document.getElementById('regChangeImpact')?.value;
    if (!title) { if (typeof toast === 'function') toast('Title required', 'error'); return; }
    addRegChange({ title, framework, deadline, impact });
    if (typeof toast === 'function') toast('Regulatory change added', 'success');
  }

  function clearAllChanges() {
    saveRegChanges([]);
    if (typeof toast === 'function') toast('All regulatory changes cleared', 'success');
  }

  window.RegulatoryMonitor = {
    FRAMEWORKS,
    getFrameworks: () => FRAMEWORKS,
    calculateHealthScore,
    checkAlerts,
    getAlertHistory,
    acknowledgeAlert,
    addRegChange,
    addChangeFromUI,
    clearAllChanges,
    updateRegChange,
    toggleRequirement,
    renderMonitorDashboard,
    renderChangeTrackerTab,
    expandFramework,
    renderFrameworkDetail: expandFramework,
  };
})();
