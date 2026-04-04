/**
 * Hawkeye Sterling — Screening Application Controller
 * TFS Workflow UI with full 4-outcome process
 * Extracted from compliance-suite.js for Hawkeye Sterling standalone use.
 * Regulatory: Cabinet Decision No.(74) of 2020 | EOCN TFS Guidance
 */
const HawkeyeApp = (function() {
  'use strict';

  const SK = { TFS_EVENTS: 'hs_tfs_events_v1' };

  function load(key) { try { return JSON.parse(localStorage.getItem(key)||'null'); } catch{ return null; } }
  function save(key,val) { try { localStorage.setItem(key,JSON.stringify(val)); } catch(e){} }
  function today() { return new Date().toISOString().slice(0,10); }
  function fmtDate(d) { if(!d) return '\u2014'; return new Date(d).toLocaleDateString('en-GB'); }
  function addBusinessDays(date, days) {
    const d = new Date(date);
    let added = 0;
    while (added < days) { d.setDate(d.getDate()+1); if(d.getDay()!==0&&d.getDay()!==6) added++; }
    return d.toISOString().slice(0,10);
  }

  // Toast notification
  function toast(msg, type, duration) {
    const el = document.getElementById('hs-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'hs-toast show ' + (type || 'info');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.className = 'hs-toast', duration || 4000);
  }

  function badge(status) {
    const map = {
      'Confirmed Match':'#D94F4F','Partial Match':'#E8A030','False Positive':'#3DA876',
      'Negative \u2013 No Match':'#3DA876','Frozen':'#D94F4F','CNMR Filed':'#3DA876',
      'PNMR Filed':'#3DA876','Pending Review':'#E8A030','Cleared':'#3DA876',
      'Overdue':'#D94F4F','Current':'#3DA876','Due Soon':'#E8A030',
    };
    const col = map[status]||'#7A7870';
    return '<span class="hs-outcome-badge" style="background:'+col+'22;color:'+col+';border-color:'+col+'44">'+status+'</span>';
  }

  // ── TABS ──
  function switchTab(name) {
    document.querySelectorAll('.hs-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.hs-tab-content').forEach(t => t.classList.remove('active'));
    const btn = document.querySelector('[data-tab="'+name+'"]');
    if (btn) btn.classList.add('active');
    const content = document.getElementById('tab-'+name);
    if (content) content.classList.add('active');
    if (name === 'lists') TFSEngine.renderListPanel();
    if (name === 'workflow') renderTFSWorkflow();
    if (name === 'history') TFSEngine.renderMatchHistory();
    if (name === 'screen') {} // screen tab is static form
  }

  // ── TFS WORKFLOW ──
  function renderTFSWorkflow() {
    const el = document.getElementById('tfs-workflow-content');
    if (!el) return;
    const events = load(SK.TFS_EVENTS)||[];

    let eventsHtml = '';
    if (events.length === 0) {
      eventsHtml = '<p class="hs-empty">No TFS screening events recorded. Click "+ New Screening Event" to begin.</p>';
    } else {
      eventsHtml = events.map((e,i) => {
        const isConfirmed = e.outcome==='Confirmed Match';
        const isPartial = e.outcome==='Partial Match';
        const cnmrDeadline = e.screeningDate ? addBusinessDays(e.screeningDate, 5) : null;
        const cnmrOverdue = cnmrDeadline && new Date(cnmrDeadline)<new Date() && (e.cnmrStatus==='Pending');
        return '<div class="hs-event-card '+(isConfirmed?'critical':isPartial?'warning':'ok')+'">'
          +'<div class="hs-event-header">'
            +'<div class="hs-event-info">'
              +'<div class="hs-event-title">'+e.screenedName+' '+badge(e.outcome)+(cnmrOverdue?badge('Overdue'):'')+'</div>'
              +'<div class="hs-event-meta">Lists: '+e.listsScreened+' | Event: '+e.eventType+' | Date: '+fmtDate(e.screeningDate)+'</div>'
              +(isConfirmed?'<div class="hs-event-actions-req">Freeze: '+(e.frozenWithin24h||'Not confirmed')+' | FFR: '+(e.ffrFiled||'Pending')+' | CNMR: '+(e.cnmrStatus||'Pending')+' (deadline: '+fmtDate(cnmrDeadline)+')</div>':'')
              +(isPartial?'<div class="hs-event-actions-req">Transaction Suspended: '+(e.txSuspended||'Pending')+' | PNMR: '+(e.pnmrStatus||'Pending')+' (deadline: '+fmtDate(cnmrDeadline)+')</div>':'')
              +'<div class="hs-event-ref">Reviewer: '+(e.reviewedBy||'\u2014')+' | Ref: '+e.id+'</div>'
            +'</div>'
            +'<div class="hs-event-btns">'
              +'<button class="hs-btn hs-btn-sm" onclick="HawkeyeApp.editTFS('+i+')">View/Edit</button>'
              +'<button class="hs-btn hs-btn-sm hs-btn-danger" onclick="HawkeyeApp.deleteTFS('+i+')">Delete</button>'
            +'</div>'
          +'</div>'
          +(e.notes?'<div class="hs-event-notes">'+e.notes+'</div>':'')
        +'</div>';
      }).join('');
    }

    el.innerHTML = '<div class="hs-card">'
      +'<div class="hs-card-header">'
        +'<div>'
          +'<h3 class="hs-card-title">TFS Workflow \u2014 Full 4-Outcome Process</h3>'
          +'<p class="hs-card-subtitle">Cabinet Decision No.(74) of 2020 | EOCN Executive Office TFS Guidance</p>'
        +'</div>'
        +'<div class="hs-card-actions">'
          +'<button class="hs-btn hs-btn-sm" onclick="HawkeyeApp.renderTFSWorkflow()">Refresh</button>'
          +'<button class="hs-btn hs-btn-gold" onclick="HawkeyeApp.openTFSForm()">+ New Screening Event</button>'
        +'</div>'
      +'</div>'
      +'<div class="hs-mandatory-lists">'
        +'<div class="hs-mandatory-card mandatory">'
          +'<h4>MANDATORY UAE Lists</h4>'
          +'<p>\u2705 <strong>UAE Local Terrorist List</strong> \u2014 EOCN / Executive Office</p>'
          +'<p>\u2705 <strong>UNSC Consolidated Sanctions List</strong> \u2014 UN Security Council</p>'
          +'<p class="hs-reg-note">Cabinet Decision No.(74)/2020 \u2014 These two lists are legally mandatory for all UAE reporting entities.</p>'
        +'</div>'
        +'<div class="hs-mandatory-card enhanced">'
          +'<h4>ENHANCED CONTROLS (Not Legally Mandatory)</h4>'
          +'<p>\u2B1C OFAC SDN \u2014 US unilateral sanctions</p>'
          +'<p>\u2B1C EU Consolidated Sanctions</p>'
          +'<p>\u2B1C UK OFSI Consolidated</p>'
          +'<p>\u2B1C Interpol Red Notices</p>'
          +'<p class="hs-reg-note">EOCN Guidance \u2014 For non-UAE unilateral/multilateral lists, consult your supervisory authority.</p>'
        +'</div>'
      +'</div>'
      +eventsHtml
    +'</div>';
  }

  // ── TFS FORM MODAL ──
  function openTFSForm() {
    const modal = document.getElementById('tfsModal');
    if (!modal) return;
    document.getElementById('tfs-edit-idx').value = '-1';
    ['tfs-name','tfs-reviewer','tfs-notes','tfs-fp-evidence','tfs-pnmr-ref','tfs-ffr-ref','tfs-cnmr-ref'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
    ['tfs-fp-basis','tfs-tx-suspended','tfs-pnmr-status','tfs-frozen','tfs-ffr','tfs-cnmr-status','tfs-supervisor','tfs-mlro','tfs-mgmt'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
    ['tfs-list-uae','tfs-list-un','tfs-list-ofac','tfs-list-eu','tfs-list-uk','tfs-list-interpol','tfs-list-adverse','tfs-list-pep'].forEach(id=>{const e=document.getElementById(id);if(e)e.checked=true;});
    document.getElementById('tfs-date').value = today();
    document.getElementById('tfs-outcome').value = '';
    if (document.getElementById('tfs-freeze-dt')) document.getElementById('tfs-freeze-dt').value = '';
    if (document.getElementById('tfs-cnmr-deadline')) document.getElementById('tfs-cnmr-deadline').value = '';
    if (document.getElementById('tfs-pnmr-deadline')) document.getElementById('tfs-pnmr-deadline').value = '';
    ['tfs-fp-section','tfs-partial-section','tfs-confirmed-section'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none';});
    ['Negative_\u2013_No_Match','False_Positive','Partial_Match','Confirmed_Match'].forEach(v=>{const btn=document.getElementById('tfs-btn-'+v);if(btn){btn.style.borderColor='rgba(201,168,76,0.15)';btn.style.background='rgba(201,168,76,0.03)';}});
    modal.classList.add('open');
  }

  function closeTFSForm() {
    document.getElementById('tfsModal').classList.remove('open');
  }

  function selectOutcome(val) {
    document.getElementById('tfs-outcome').value = val;
    ['Negative_\u2013_No_Match','False_Positive','Partial_Match','Confirmed_Match'].forEach(v => {
      const btn = document.getElementById('tfs-btn-'+v);
      if (btn) { btn.style.background='rgba(201,168,76,0.03)'; btn.style.borderColor='rgba(201,168,76,0.15)'; }
    });
    const key = val.replace(/\s/g,'_');
    const btn = document.getElementById('tfs-btn-'+key);
    if (btn) {
      const cols = {'Negative_\u2013_No_Match':'#3DA876','False_Positive':'#3DA876','Partial_Match':'#E8A030','Confirmed_Match':'#D94F4F'};
      btn.style.borderColor = cols[key]||'var(--gold)';
      btn.style.background = (cols[key]||'#C9A84C')+'22';
    }
    document.getElementById('tfs-fp-section').style.display = val==='False Positive'?'block':'none';
    document.getElementById('tfs-partial-section').style.display = val==='Partial Match'?'block':'none';
    document.getElementById('tfs-confirmed-section').style.display = val==='Confirmed Match'?'block':'none';
    const dateEl = document.getElementById('tfs-date');
    if (dateEl && dateEl.value && (val==='Confirmed Match'||val==='Partial Match')) {
      const dl = addBusinessDays(dateEl.value, 5);
      ['tfs-cnmr-deadline','tfs-pnmr-deadline'].forEach(id => {
        const el = document.getElementById(id); if(el) el.value = dl;
      });
    }
  }

  function editTFS(idx) {
    const events = load(SK.TFS_EVENTS)||[];
    const e = events[idx];
    if (!e) return;
    openTFSForm();
    document.getElementById('tfs-edit-idx').value = idx;
    document.getElementById('tfs-name').value = e.screenedName||'';
    if (document.getElementById('tfs-entity-type')) document.getElementById('tfs-entity-type').value = e.entityType||'Individual';
    if (document.getElementById('tfs-dob')) document.getElementById('tfs-dob').value = e.dob||'';
    if (document.getElementById('tfs-country')) document.getElementById('tfs-country').value = e.country||'';
    if (document.getElementById('tfs-idnumber')) document.getElementById('tfs-idnumber').value = e.idNumber||'';
    document.getElementById('tfs-event').value = e.eventType||'';
    document.getElementById('tfs-date').value = e.screeningDate||today();
    document.getElementById('tfs-reviewer').value = e.reviewedBy||'';
    document.getElementById('tfs-notes').value = e.notes||'';
    if (e.outcome) { setTimeout(()=>selectOutcome(e.outcome), 100); }
    if (e.listsScreened) {
      ['uae','un','ofac','eu','uk','interpol','adverse','pep'].forEach(l=>{
        const el = document.getElementById('tfs-list-'+l);
        if(el) el.checked = e.listsScreened.toLowerCase().includes(l);
      });
    }
  }

  function saveTFS() {
    const name = document.getElementById('tfs-name').value.trim();
    const outcome = document.getElementById('tfs-outcome').value;
    if (!name) { toast('Screened name is required','error'); return; }
    if (!outcome) { toast('Select a screening outcome','error'); return; }
    const lists = [];
    if (document.getElementById('tfs-list-uae')?.checked) lists.push('UAE Local Terrorist List (EOCN)');
    if (document.getElementById('tfs-list-un')?.checked) lists.push('UNSC Consolidated');
    if (document.getElementById('tfs-list-ofac')?.checked) lists.push('OFAC SDN');
    if (document.getElementById('tfs-list-eu')?.checked) lists.push('EU Consolidated');
    if (document.getElementById('tfs-list-uk')?.checked) lists.push('UK OFSI');
    if (document.getElementById('tfs-list-interpol')?.checked) lists.push('Interpol');
    if (document.getElementById('tfs-list-adverse')?.checked) lists.push('Adverse Media');
    if (document.getElementById('tfs-list-pep')?.checked) lists.push('PEP');
    const events = load(SK.TFS_EVENTS)||[];
    const editIdx = parseInt(document.getElementById('tfs-edit-idx').value);
    const record = {
      id: editIdx>=0 ? events[editIdx].id : 'HS-'+Date.now(),
      screenedName: name,
      entityType: document.getElementById('tfs-entity-type')?.value || 'Individual',
      dob: document.getElementById('tfs-dob')?.value || '',
      country: document.getElementById('tfs-country')?.value?.trim() || '',
      idNumber: document.getElementById('tfs-idnumber')?.value?.trim() || '',
      eventType: document.getElementById('tfs-event').value,
      listsScreened: lists.join(' | '),
      screeningDate: document.getElementById('tfs-date').value,
      reviewedBy: document.getElementById('tfs-reviewer').value,
      outcome,
      notes: document.getElementById('tfs-notes').value,
      fpBasis: document.getElementById('tfs-fp-basis')?.value||null,
      fpEvidence: document.getElementById('tfs-fp-evidence')?.value||null,
      txSuspended: document.getElementById('tfs-tx-suspended')?.value||null,
      pnmrStatus: document.getElementById('tfs-pnmr-status')?.value||null,
      pnmrDeadline: document.getElementById('tfs-pnmr-deadline')?.value||null,
      pnmrRef: document.getElementById('tfs-pnmr-ref')?.value||null,
      frozenWithin24h: document.getElementById('tfs-frozen')?.value||null,
      freezeDateTime: document.getElementById('tfs-freeze-dt')?.value||null,
      ffrFiled: document.getElementById('tfs-ffr')?.value||null,
      ffrRef: document.getElementById('tfs-ffr-ref')?.value||null,
      cnmrStatus: document.getElementById('tfs-cnmr-status')?.value||null,
      cnmrDeadline: document.getElementById('tfs-cnmr-deadline')?.value||null,
      cnmrRef: document.getElementById('tfs-cnmr-ref')?.value||null,
      supervisorNotified: document.getElementById('tfs-supervisor')?.value||null,
      mlroNotified: document.getElementById('tfs-mlro')?.value||null,
      mgmtNotified: document.getElementById('tfs-mgmt')?.value||null,
      updatedAt: new Date().toISOString(),
    };
    if (editIdx>=0) { events[editIdx]=record; } else { events.unshift(record); }
    save(SK.TFS_EVENTS, events);
    closeTFSForm();
    if (outcome==='Confirmed Match') toast('CONFIRMED MATCH saved \u2014 ensure freeze, FFR, and CNMR obligations are met','error');
    else if (outcome==='Partial Match') toast('PARTIAL MATCH saved \u2014 PNMR must be filed within 5 business days','info');
    else toast('TFS event saved \u2014 '+outcome,'success');
    renderTFSWorkflow();
  }

  function deleteTFS(idx) {
    if (!confirm('Delete this TFS screening event?')) return;
    const events = load(SK.TFS_EVENTS)||[];
    events.splice(idx,1);
    save(SK.TFS_EVENTS, events);
    renderTFSWorkflow();
  }

  // ── UAE MOE COMPLIANCE GUIDANCE PER OUTCOME ──
  function getComplianceGuidance(result) {
    if (result === 'MATCH') return {
      cls: 'match',
      label: 'CONFIRMED MATCH \u2014 SANCTIONS HIT',
      icon: '\u26D4',
      subtitle: 'IMMEDIATE regulatory action required under UAE law \u2014 ZERO DELAY',
      regulatory:
        '<ul>'
        +'<li><strong>UAE Federal Decree-Law No.(10) of 2025, Art.22 (Targeted Financial Sanctions):</strong> All natural and legal persons in the UAE shall, <em>immediately and without delay and without prior notice</em>, freeze all funds, financial assets, economic resources, and proceeds of any designated person or entity listed under UNSC Resolutions or the UAE Local Terrorist List. This obligation is absolute and requires no court order.</li>'
        +'<li><strong>UAE Federal Decree-Law No.(10) of 2025, Art.18 (Suspicious Transaction Reporting):</strong> Where there is suspicion or reasonable grounds to suspect that funds are proceeds of crime, or are related to or intended for use in money laundering, terrorism financing, or financing of illegal organisations, the reporting entity shall report <em>immediately and directly</em> to the FIU via goAML. <strong>NO PRIOR CONSENT IS REQUIRED</strong> \u2014 not from management, not from the customer, not from any other party. The obligation to report is individual, mandatory, and cannot be delegated or deferred.</li>'
        +'<li><strong>UAE Federal Decree-Law No.(10) of 2025, Art.16 (Obligation to Report):</strong> The STR must be filed <em>regardless of the value of the transaction</em> and regardless of whether the transaction was completed, attempted, or merely suspected. Filing must occur without delay via goAML.</li>'
        +'<li><strong>UAE Federal Decree-Law No.(10) of 2025, Art.29 (Tipping Off):</strong> It is <em>strictly prohibited</em> to inform the customer, beneficial owner, or any third party that an STR has been or will be filed, or that a money laundering or terrorism financing investigation is underway. Tipping off is a <strong>criminal offence</strong> punishable by imprisonment.</li>'
        +'<li><strong>Cabinet Decision No.(74) of 2020 (TFS Implementation):</strong> All natural and legal persons must comply with Targeted Financial Sanctions without delay. A Confirmed Name Match Report (CNMR) must be filed with EOCN within 5 business days. Non-compliance constitutes a criminal offence.</li>'
        +'<li><strong>FATF Recommendations 6 &amp; 7:</strong> Implement targeted financial sanctions related to terrorism (UNSCR 1267/1989/2253) and proliferation financing (UNSCR 1718/2231) without delay.</li>'
        +'<li><strong>MoE Circular 08/AML/2021 (DPMS Obligations):</strong> Dealers in Precious Metals &amp; Stones must screen all customers, UBOs, and counterparties. Upon confirmed match, immediately freeze assets and report to the FIU and supervisory authority.</li>'
        +'<li><strong>Cabinet Resolution No.(134) of 2025, Art.13:</strong> Enhanced monitoring obligations for designated persons including transaction surveillance, ongoing screening, and immediate escalation.</li>'
        +'</ul>',
      actions:
        '<div class="hs-action-item critical"><span class="hs-action-num">1</span><div><strong>FREEZE ALL FUNDS &amp; ASSETS \u2014 IMMEDIATELY, WITHOUT DELAY</strong><p>Freeze ALL funds, financial assets, economic resources, and proceeds. This must happen <strong>IMMEDIATELY upon identification</strong> \u2014 not within 24 hours, not within a day \u2014 <strong>INSTANTLY</strong>. No prior court order, no prior notice to the designated person, no management approval needed for the freeze itself. This is a direct legal obligation under FDL No.10/2025 Art.22. Failure to freeze immediately is a criminal offence.</p></div></div>'
        +'<div class="hs-action-item critical"><span class="hs-action-num">2</span><div><strong>FILE STR VIA goAML \u2014 WITHOUT ANY PRIOR CONSENT</strong><p>File a <strong>Suspicious Transaction Report (STR)</strong> directly to the UAE FIU through the goAML portal. If the suspicious activity involved an attempted or non-executed transaction, file a <strong>Suspicious Activity Report (SAR)</strong> instead. <strong>YOU DO NOT NEED ANY PRIOR CONSENT OR APPROVAL</strong> \u2014 not from your manager, not from the board, not from the customer. File immediately regardless of value. For DPMS entities, also consider filing a <strong>DPMSR</strong> (Dealers in Precious Metals and Stones Report) if the activity relates to precious metals/stones transactions. (FDL Art.18)</p><div class="hs-goaml-ref">goAML Report Types: <span class="hs-goaml-tag str">STR</span> <span class="hs-goaml-tag sar">SAR</span> <span class="hs-goaml-tag dpmsr">DPMSR</span></div></div></div>'
        +'<div class="hs-action-item critical"><span class="hs-action-num">3</span><div><strong>FILE FUNDS FREEZE REPORT (FFR) VIA goAML</strong><p>Submit an <strong>FFR (Funds Freeze Report)</strong> to the FIU via goAML immediately after executing the freeze. Include: details of the frozen assets (type, value, location), the designated person/entity details, the sanctions list matched, and the exact date/time of freeze execution. The FFR is a dedicated goAML report type specifically for notifying the FIU of asset freezing actions under TFS. (FDL Art.22-23, EOCN TFS Guidance)</p><div class="hs-goaml-ref">goAML Report Type: <span class="hs-goaml-tag ffr">FFR</span></div></div></div>'
        +'<div class="hs-action-item critical"><span class="hs-action-num">4</span><div><strong>FILE CNMR TO EOCN WITHIN 5 BUSINESS DAYS</strong><p>Submit a Confirmed Name Match Report to the Executive Office for Control &amp; Non-Proliferation (EOCN) at <a href="https://www.uaeiec.gov.ae/en-us/un-page" target="_blank" style="color:var(--gold)">www.uaeiec.gov.ae</a> within 5 business days. Include: match details, actions taken, frozen asset values, sanctions list reference, and all supporting documentation. (Cabinet Decision 74/2020, EOCN TFS Guidance)</p></div></div>'
        +'<div class="hs-action-item critical"><span class="hs-action-num">5</span><div><strong>NOTIFY MLRO &amp; SENIOR MANAGEMENT</strong><p>The MLRO must be notified immediately. Senior Management must be informed of the confirmed match and freeze action. Document all notifications with exact timestamps. The MLRO has independent authority to file STRs. (FDL Art.20, Cabinet Resolution 134/2025)</p></div></div>'
        +'<div class="hs-action-item critical"><span class="hs-action-num">6</span><div><strong>NOTIFY SUPERVISORY AUTHORITY (MoE / CBUAE)</strong><p>Notify your designated supervisory authority. For DPMS: Ministry of Economy. For financial institutions: CBUAE. For DIFC entities: DFSA. Notification must be without delay. (FDL Art.35, MoE Circular 08/AML/2021)</p></div></div>'
        +'<div class="hs-action-item critical"><span class="hs-action-num">7</span><div><strong>DO NOT TIP OFF \u2014 CRIMINAL OFFENCE</strong><p>Under <strong>NO CIRCUMSTANCES</strong> inform the customer, their representatives, beneficial owners, or any third party that: (a) an STR has been filed, (b) assets have been frozen due to sanctions, (c) an investigation is underway. Tipping off is a <strong>criminal offence</strong> punishable by imprisonment and fines under FDL Art.29. This includes indirect disclosure.</p></div></div>'
        +'<div class="hs-action-item critical"><span class="hs-action-num">8</span><div><strong>TERMINATE BUSINESS RELATIONSHIP</strong><p>Immediately cease all business dealings with the designated person/entity. No new transactions may be initiated, processed, or facilitated. Existing business relationships must be terminated. All related accounts and facilities must be restricted. (FDL Art.22, Cabinet Decision 74/2020)</p></div></div>',
      deadlines:
        '<ul>'
        +'<li><strong>Asset Freeze:</strong> IMMEDIATELY upon identification \u2014 zero delay (FDL Art.22)</li>'
        +'<li><strong>STR via goAML:</strong> Without delay, max 10 business days \u2014 NO prior consent required (FDL Art.18)</li>'
        +'<li><strong>FFR via goAML:</strong> Within 2 business days of freeze execution (EOCN TFS Guidance)</li>'
        +'<li><strong>EOCN Notification:</strong> Within 24 hours of freeze action (EOCN TFS Guidance)</li>'
        +'<li><strong>CNMR to EOCN:</strong> Within 5 business days (Cabinet Decision 74/2020)</li>'
        +'<li><strong>MLRO Notification:</strong> Immediately (FDL Art.20)</li>'
        +'<li><strong>MoE / Supervisory Authority:</strong> Without delay (FDL Art.17)</li>'
        +'</ul>',
      records:
        '<p>All records must be retained for a minimum of <strong>5 years</strong> from the most recent of: last transaction, account closure, termination of business relationship, completion of supervisory inspection, or final judicial judgment. Records include: screening results, STR filings, FFR filings, CNMR filings, freeze orders, correspondence with EOCN/FIU/MoE, customer files, and all transaction records. Records must be sufficient to permit reconstruction of individual transactions and immediately available to competent authorities upon request. (FDL Art.25, Cabinet Resolution 134/2025 Art.25(2))</p>',
      footer: 'CRIMINAL PENALTIES per FDL No.10/2025: TFS non-compliance \u2014 imprisonment + fine not less than AED 20,000, up to AED 10,000,000 (Art.22-23). Money laundering \u2014 imprisonment 1-10 years + fine AED 100,000-5,000,000 (Art.30). Terrorism financing \u2014 life imprisonment or 10+ years + fine AED 1,000,000-10,000,000 (Art.32). Tipping off \u2014 imprisonment not less than 1 year + fine AED 100,000-500,000 (Art.29). Administrative penalties \u2014 fines AED 10,000-5,000,000 + license suspension (Art.17). Legal entities \u2014 fine AED 200,000-10,000,000. NO statute of limitations for ML/TF/PF crimes (Art.37). CO, MLRO, and Senior Management face PERSONAL criminal liability.'
    };

    if (result === 'POTENTIAL_MATCH') return {
      cls: 'potential',
      label: 'POTENTIAL MATCH \u2014 ENHANCED DUE DILIGENCE REQUIRED',
      icon: '\u26A0',
      subtitle: 'Partial or similar name match detected \u2014 ALL transactions SUSPENDED until resolved',
      regulatory:
        '<ul>'
        +'<li><strong>UAE Federal Decree-Law No.(10) of 2025, Art.16-18 (Enhanced Due Diligence):</strong> Where there are reasonable grounds to suspect a match or where the customer poses a higher risk, the reporting entity must apply Enhanced Due Diligence (EDD) measures. This includes obtaining additional identification data, verifying source of funds and source of wealth, and conducting enhanced ongoing monitoring.</li>'
        +'<li><strong>UAE Federal Decree-Law No.(10) of 2025, Art.18 (STR Obligation):</strong> If during the verification process, suspicion of ML/TF arises \u2014 even before the match is confirmed \u2014 an STR must be filed via goAML <strong>immediately and without any prior consent</strong>. The obligation to report does not depend on match confirmation.</li>'
        +'<li><strong>Cabinet Decision No.(74) of 2020 (TFS Implementation):</strong> Partial Name Match Reports (PNMR) must be filed with EOCN within 5 business days when a potential match cannot be immediately confirmed or excluded. All related transactions must be suspended pending resolution.</li>'
        +'<li><strong>MoE Circular 08/AML/2021 (DPMS):</strong> DPMS must suspend all transactions for any entity with an unresolved potential match. Enhanced verification is mandatory before any business may proceed.</li>'
        +'<li><strong>Cabinet Resolution No.(134) of 2025, Art.8:</strong> EDD requirements include verifying source of funds, source of wealth, purpose of the business relationship, and obtaining senior management approval before proceeding with higher-risk customers.</li>'
        +'<li><strong>FATF Recommendation 10:</strong> Where ML/TF risk is higher, enhanced measures must be applied including obtaining additional identification information and enhanced monitoring of the business relationship.</li>'
        +'</ul>',
      actions:
        '<div class="hs-action-item warning"><span class="hs-action-num">1</span><div><strong>SUSPEND ALL TRANSACTIONS IMMEDIATELY</strong><p>Do not process, facilitate, or approve any transactions for the screened entity until the potential match is fully resolved. This includes pending, in-progress, and future transactions. Document the suspension with exact date, time, and reason. (FDL Art.16, Cabinet Decision 74/2020)</p></div></div>'
        +'<div class="hs-action-item warning"><span class="hs-action-num">2</span><div><strong>CONDUCT ENHANCED IDENTITY VERIFICATION</strong><p>Obtain and cross-reference ALL available identifying data: full legal name, date of birth, place of birth, nationality, passport number, Emirates ID, trade license number, photograph, physical address, and any other distinguishing data. Compare EACH data point against the sanctioned entry. (FDL Art.16-18, FATF Rec 10)</p></div></div>'
        +'<div class="hs-action-item warning"><span class="hs-action-num">3</span><div><strong>FILE STR/SAR VIA goAML IF SUSPICION ARISES \u2014 NO PRIOR CONSENT NEEDED</strong><p>If at any point during the verification you develop suspicion of ML/TF, file an <strong>STR</strong> (for executed transactions) or <strong>SAR</strong> (for attempted/non-executed transactions) via goAML <strong>immediately and without any prior consent</strong>. For DPMS entities, also file a <strong>DPMSR</strong> if applicable. If the entity involves a high-risk country, additionally file an <strong>HRC</strong> (transaction) or <strong>HRCA</strong> (activity). (FDL Art.18)</p><div class="hs-goaml-ref">goAML Report Types: <span class="hs-goaml-tag str">STR</span> <span class="hs-goaml-tag sar">SAR</span> <span class="hs-goaml-tag dpmsr">DPMSR</span> <span class="hs-goaml-tag hrc">HRC</span></div></div></div>'
        +'<div class="hs-action-item warning"><span class="hs-action-num">4</span><div><strong>FILE PNMR VIA goAML &amp; TO EOCN WITHIN 5 BUSINESS DAYS</strong><p>If the match cannot be definitively resolved, submit a <strong>PNMR (Partial Name Match Report)</strong> \u2014 this is a dedicated goAML report type for partial sanctions/watchlist hits. File via goAML to the FIU AND submit to the EOCN at <a href="https://www.uaeiec.gov.ae/en-us/un-page" target="_blank" style="color:var(--gold)">www.uaeiec.gov.ae</a> within 5 business days. Include all identifying data gathered, the basis for the potential match, and actions taken. (Cabinet Decision 74/2020, EOCN TFS Guidance)</p><div class="hs-goaml-ref">goAML Report Type: <span class="hs-goaml-tag pnmr">PNMR</span></div></div></div>'
        +'<div class="hs-action-item warning"><span class="hs-action-num">5</span><div><strong>ESCALATE TO COMPLIANCE OFFICER / MLRO</strong><p>The match resolution must be reviewed and approved by the Compliance Officer or MLRO. The MLRO has independent authority to escalate or file STRs without management consent. Document all decisions with rationale and timestamps. (FDL Art.20)</p></div></div>'
        +'<div class="hs-action-item warning"><span class="hs-action-num">6</span><div><strong>DO NOT TIP OFF</strong><p>Do not inform the customer or any third party that a potential match has been detected or that verification is underway. Tipping off is a criminal offence under FDL Art.29, even at the potential match stage.</p></div></div>'
        +'<div class="hs-action-item warning"><span class="hs-action-num">7</span><div><strong>DOCUMENT DIFFERENTIATION BASIS (IF FALSE POSITIVE)</strong><p>If ruled as false positive, document precisely how the entity was differentiated: different DOB, different nationality, different ID number, different photograph, etc. This record is essential for regulatory audit and inspection. Retain for minimum 5 years. (FDL Art.25)</p></div></div>',
      deadlines:
        '<ul>'
        +'<li><strong>Transaction Suspension:</strong> IMMEDIATELY upon detection</li>'
        +'<li><strong>STR (if suspicion arises):</strong> IMMEDIATELY \u2014 no prior consent needed (FDL Art.18)</li>'
        +'<li><strong>PNMR to EOCN:</strong> Within 5 business days if unresolved (Cabinet Decision 74/2020)</li>'
        +'<li><strong>CO/MLRO Review:</strong> Within 48 hours of detection</li>'
        +'<li><strong>Match Resolution:</strong> Must be completed before ANY transaction proceeds</li>'
        +'</ul>',
      records:
        '<p>Retain all screening records, verification documents, PNMR filings, correspondence with EOCN, and the final match resolution decision for a minimum of <strong>5 years</strong> from the date of the last transaction or termination of the business relationship. Include the differentiation basis and all supporting evidence. For DPMS, recommended retention is <strong>10 years</strong>. (FDL Art.25, Cabinet Resolution 134/2025 Art.24)</p>',
      footer: 'WARNING: Processing a transaction for a potentially sanctioned person without completing EDD and resolving the match constitutes a regulatory breach under FDL No.10/2025. If the potential match is subsequently confirmed as a true positive, all prior transactions may be subject to criminal investigation. The tipping off prohibition (Art.29) applies from the moment a potential match is detected.'
    };

    // CLEAR / NEGATIVE
    return {
      cls: 'clear',
      label: 'NEGATIVE MATCH \u2014 NO SANCTIONS HIT',
      icon: '\u2705',
      subtitle: 'Entity cleared against all screened sanctions lists, PEP databases, and adverse media sources',
      regulatory:
        '<ul>'
        +'<li><strong>UAE Federal Decree-Law No.(10) of 2025, Art.12-16 (Customer Due Diligence):</strong> Standard CDD applies. The entity may proceed for onboarding or transaction processing subject to the completion of all required CDD measures including: customer identification, identity verification, UBO identification, and understanding the purpose of the business relationship.</li>'
        +'<li><strong>UAE Federal Decree-Law No.(10) of 2025, Art.18 (Ongoing STR Obligation):</strong> Even with a negative screening result, if at any future point suspicion of ML/TF arises during the business relationship, an STR must be filed via goAML <strong>immediately and without any prior consent</strong>. The STR obligation is continuous and independent of screening results.</li>'
        +'<li><strong>UAE Federal Decree-Law No.(10) of 2025, Art.17 (Ongoing Monitoring):</strong> The reporting entity must conduct ongoing monitoring of the business relationship to ensure that transactions are consistent with the known customer profile, business activity, risk rating, and source of funds.</li>'
        +'<li><strong>Cabinet Decision No.(74) of 2020:</strong> A negative screening result against the UAE Local Terrorist List and UNSC Consolidated List satisfies the mandatory TFS screening obligation for this point in time. Re-screening is required at regular intervals and upon trigger events.</li>'
        +'<li><strong>MoE Circular 08/AML/2021 (DPMS):</strong> Retain the negative screening result in the customer file. Re-screen at defined intervals or upon trigger events (list updates, periodic review, transaction triggers, change in customer circumstances).</li>'
        +'<li><strong>Cabinet Resolution No.(134) of 2025, Art.6:</strong> Standard CDD must be completed before establishing the business relationship. Risk assessment must be documented and reviewed periodically.</li>'
        +'</ul>',
      actions:
        '<div class="hs-action-item ok"><span class="hs-action-num">1</span><div><strong>PROCEED WITH STANDARD CDD</strong><p>The entity has been cleared against sanctions lists. Complete all standard Customer Due Diligence: verify identity using reliable, independent source documents; identify all beneficial owners (UBOs with &gt;25% ownership per FATF Rec 24); determine source of funds and source of wealth; assess the customer risk profile. (FDL Art.12-16)</p></div></div>'
        +'<div class="hs-action-item ok"><span class="hs-action-num">2</span><div><strong>RECORD THE SCREENING RESULT</strong><p>Save this negative screening result to the customer file. Include: entity name as screened, all lists checked, date and time of screening, screening officer name, screening reference ID, and the AI/system used. This record must be available for regulatory inspection. (FDL Art.25, MoE Circular 08/AML/2021)</p></div></div>'
        +'<div class="hs-action-item ok"><span class="hs-action-num">3</span><div><strong>SCHEDULE PERIODIC RE-SCREENING</strong><p>Set re-screening based on risk: <strong>High Risk</strong> \u2014 every 3 months; <strong>Medium Risk</strong> \u2014 every 6 months; <strong>Low Risk</strong> \u2014 every 12 months. Also re-screen upon: sanctions list update, change in customer circumstances, trigger transaction, or adverse media alert. (Cabinet Resolution 134/2025 Art.13)</p></div></div>'
        +'<div class="hs-action-item ok"><span class="hs-action-num">4</span><div><strong>COMPLETE RISK ASSESSMENT</strong><p>Assign an initial risk rating based on: customer type, jurisdiction of incorporation/residence, products and services used, delivery channel, transaction patterns, and any other relevant risk factors per your firm\'s Enterprise-Wide Risk Assessment (EWRA). (FDL Art.14, Cabinet Resolution 134/2025 Art.4-5)</p></div></div>'
        +'<div class="hs-action-item ok"><span class="hs-action-num">5</span><div><strong>ONGOING MONITORING &amp; REPORTING OBLIGATIONS</strong><p>Monitor the business relationship continuously. If at ANY POINT suspicion of ML/TF arises, file the appropriate goAML report <strong>immediately and without any prior consent</strong>:<br>\u2022 <strong>STR</strong> \u2014 for suspicious executed transactions<br>\u2022 <strong>SAR</strong> \u2014 for suspicious activity or attempted/non-executed transactions<br>\u2022 <strong>DPMSR</strong> \u2014 for DPMS-specific threshold or suspicious activities<br>\u2022 <strong>HRC/HRCA</strong> \u2014 for transactions/activity involving high-risk countries<br>The reporting obligation under FDL Art.18 applies throughout the ENTIRE business relationship. (FDL Art.18-17)</p><div class="hs-goaml-ref">goAML Report Types: <span class="hs-goaml-tag str">STR</span> <span class="hs-goaml-tag sar">SAR</span> <span class="hs-goaml-tag dpmsr">DPMSR</span> <span class="hs-goaml-tag hrc">HRC</span> <span class="hs-goaml-tag hrca">HRCA</span></div></div></div>',
      deadlines:
        '<ul>'
        +'<li><strong>CDD Completion:</strong> Before establishing the business relationship (FDL Art.12)</li>'
        +'<li><strong>Risk Assessment:</strong> At onboarding and upon trigger events (Cabinet Resolution 134/2025)</li>'
        +'<li><strong>Re-screening (High Risk):</strong> Every 3 months</li>'
        +'<li><strong>Re-screening (Medium Risk):</strong> Every 6 months</li>'
        +'<li><strong>Re-screening (Low Risk):</strong> Every 12 months</li>'
        +'<li><strong>STR (if suspicion arises):</strong> IMMEDIATELY \u2014 no prior consent needed (FDL Art.18)</li>'
        +'<li><strong>Record Retention:</strong> Minimum 5 years / 5 years per FDL Art.25</li>'
        +'</ul>',
      records:
        '<p>Retain screening records, CDD documents, risk assessments, transaction records, and all correspondence for a minimum of <strong>5 years</strong> from the date of the last transaction or termination of the business relationship (whichever is later). For DPMS under MoE supervision, the recommended retention period is <strong>10 years</strong>. Records must be sufficient to permit reconstruction of individual transactions and must be available to competent authorities and supervisors upon request. (FDL Art.25, Cabinet Resolution 134/2025 Art.24, MoE Circular 08/AML/2021)</p>',
      footer: 'IMPORTANT: A negative screening result is POINT-IN-TIME only. Sanctions lists are updated frequently \u2014 sometimes daily. Continuous monitoring and periodic re-screening are MANDATORY regulatory obligations under FDL No.10/2025 and Cabinet Resolution 134/2025. If suspicion of ML/TF arises at any point in the business relationship, file an STR via goAML IMMEDIATELY without any prior consent (FDL Art.18).'
    };
  }

  // ── AI SCREENING (Quick Screen Tab) ──
  async function runQuickScreen() {
    const name = document.getElementById('qs-name')?.value?.trim();
    const type = document.getElementById('qs-type')?.value;
    const country = document.getElementById('qs-country')?.value?.trim() || '';
    const dob = document.getElementById('qs-dob')?.value || '';
    const idNum = document.getElementById('qs-idnum')?.value?.trim() || '';
    const ongoing = document.getElementById('qs-ongoing')?.checked || false;
    if (!name) { toast('Enter entity name', 'error'); return; }

    const resultEl = document.getElementById('qs-result');
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.innerHTML = '<p class="hs-screening-status">Screening in progress \u2014 deep sanctions, PEP & adverse media check...</p>';
    }

    // Build enhanced entity description with DOB and ID
    let entityDesc = name + ' (' + type + ')';
    if (dob) entityDesc += ', DOB/DOI: ' + dob;
    if (country) entityDesc += ', ' + country;
    if (idNum) entityDesc += ', ID: ' + idNum;

    const match = await TFSEngine.screenEntity(entityDesc, type, country);
    if (match && resultEl) {
      const matchesHtml = (match.matches || []).map(m =>
        '<div class="hs-match-hit"><strong>'+m.list+'</strong> \u2014 '+m.matchType+' ('+Math.round((m.confidence||0)*100)+'%)<div class="hs-hit-detail">'+(m.details||'')+'</div></div>'
      ).join('');

      const complianceGuidance = getComplianceGuidance(match.result);

      resultEl.innerHTML =
        '<div class="hs-screen-result '+complianceGuidance.cls+'">'
          +'<div class="hs-result-header"><span class="hs-badge '+complianceGuidance.cls+'">'+complianceGuidance.label+'</span><span class="hs-result-entity">'+match.entity+'</span></div>'
          +matchesHtml
          +(match.recommendation ? '<div class="hs-result-recommendation">'+match.recommendation+'</div>' : '')
          +'<div class="hs-compliance-panel '+complianceGuidance.cls+'">'
            +'<div class="hs-compliance-header"><div class="hs-compliance-icon">'+complianceGuidance.icon+'</div><div><div class="hs-compliance-title">'+complianceGuidance.label+'</div><div class="hs-compliance-subtitle">'+complianceGuidance.subtitle+'</div></div></div>'
            +'<div class="hs-compliance-section"><div class="hs-compliance-section-title">REGULATORY BASIS</div><div class="hs-compliance-body">'+complianceGuidance.regulatory+'</div></div>'
            +'<div class="hs-compliance-section"><div class="hs-compliance-section-title">REQUIRED ACTIONS</div><div class="hs-compliance-actions">'+complianceGuidance.actions+'</div></div>'
            +'<div class="hs-compliance-section"><div class="hs-compliance-section-title">COMPLIANCE DEADLINES</div><div class="hs-compliance-body">'+complianceGuidance.deadlines+'</div></div>'
            +'<div class="hs-compliance-section"><div class="hs-compliance-section-title">RECORD KEEPING</div><div class="hs-compliance-body">'+complianceGuidance.records+'</div></div>'
            +'<div class="hs-compliance-footer">'+complianceGuidance.footer+'</div>'
          +'</div>'
        +'</div>';
    }
    TFSEngine.renderMatchHistory();
  }

  // Init
  function init() {
    document.querySelectorAll('.hs-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
    // Date change auto-calc
    const dateEl = document.getElementById('tfs-date');
    if (dateEl) dateEl.addEventListener('change', function() {
      const dl = addBusinessDays(this.value, 5);
      ['tfs-cnmr-deadline','tfs-pnmr-deadline'].forEach(id => {
        const el = document.getElementById(id); if(el) el.value = dl;
      });
    });
    switchTab('screen');
    TFSEngine.renderListPanel();
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    toast,
    switchTab,
    renderTFSWorkflow,
    openTFSForm,
    closeTFSForm,
    selectOutcome,
    editTFS,
    saveTFS,
    deleteTFS,
    runQuickScreen,
    init,
  };
})();
