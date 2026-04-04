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
      subtitle: 'Immediate regulatory action required under UAE law',
      regulatory:
        '<ul>'
        +'<li><strong>UAE Federal Decree-Law No.(10) of 2025, Art.22:</strong> Reporting entities must immediately freeze all funds, financial assets, and economic resources of designated persons and entities without prior notice.</li>'
        +'<li><strong>Cabinet Decision No.(74) of 2020 (TFS Implementation):</strong> All natural and legal persons must comply with Targeted Financial Sanctions without delay. Non-compliance constitutes a criminal offence under UAE law.</li>'
        +'<li><strong>FATF Recommendations 6 &amp; 7:</strong> Countries must implement targeted financial sanctions related to terrorism (UNSCR 1267/1989/2253) and proliferation financing (UNSCR 1718/2231) without delay.</li>'
        +'<li><strong>MoE Circular 08/AML/2021:</strong> DPMS must screen all customers, beneficial owners, and counterparties against the UAE Local Terrorist List and UNSC Consolidated List before establishing or continuing any business relationship.</li>'
        +'<li><strong>Cabinet Resolution No.(134) of 2025, Art.13:</strong> Enhanced monitoring obligations for designated persons including transaction surveillance and ongoing screening.</li>'
        +'</ul>',
      actions:
        '<div class="hs-action-item critical"><span class="hs-action-num">1</span><div><strong>FREEZE ALL ASSETS IMMEDIATELY</strong><p>Freeze all funds, financial assets, and economic resources. This must occur within 24 hours of identification. No prior court order or notice is required. (FDL Art.22, Cabinet Decision 74/2020)</p></div></div>'
        +'<div class="hs-action-item critical"><span class="hs-action-num">2</span><div><strong>FILE FUNDS FREEZE REPORT (FFR) VIA goAML</strong><p>Submit a Funds Freeze Report to the UAE Financial Intelligence Unit via the goAML portal immediately. Include all details of the frozen assets, the designated person, and the sanctions list match. (FDL Art.22/23)</p></div></div>'
        +'<div class="hs-action-item critical"><span class="hs-action-num">3</span><div><strong>FILE CNMR TO EOCN WITHIN 5 BUSINESS DAYS</strong><p>Submit a Confirmed Name Match Report (CNMR) to the Executive Office for Control &amp; Non-Proliferation (EOCN) within 5 business days of identification. Include match details, actions taken, and frozen asset values. (Cabinet Decision 74/2020, EOCN TFS Guidance)</p></div></div>'
        +'<div class="hs-action-item critical"><span class="hs-action-num">4</span><div><strong>FILE STR VIA goAML WITHIN 30 DAYS</strong><p>Submit a Suspicious Transaction Report to the FIU via goAML. Include full transaction history, customer profile, and the basis for the sanctions match. (FDL Art.23, MoE Circular 08/AML/2021)</p></div></div>'
        +'<div class="hs-action-item critical"><span class="hs-action-num">5</span><div><strong>NOTIFY MLRO &amp; SENIOR MANAGEMENT</strong><p>The Money Laundering Reporting Officer and Senior Management must be notified immediately. Document all notifications with timestamps. (FDL Art.20, Cabinet Resolution 134/2025)</p></div></div>'
        +'<div class="hs-action-item critical"><span class="hs-action-num">6</span><div><strong>NOTIFY SUPERVISORY AUTHORITY (MoE)</strong><p>Notify the Ministry of Economy as your designated supervisory authority. For DPMS under MoE supervision, this is mandatory. (FDL Art.35, MoE Circular 08/AML/2021)</p></div></div>'
        +'<div class="hs-action-item critical"><span class="hs-action-num">7</span><div><strong>DO NOT PROCEED WITH TRANSACTION OR BUSINESS RELATIONSHIP</strong><p>Any ongoing business relationship must be terminated. No new transactions may be processed. Tipping off the designated person is a criminal offence. (FDL Art.26 \u2014 Tipping Off Prohibition)</p></div></div>',
      deadlines:
        '<ul>'
        +'<li><strong>Asset Freeze:</strong> Within 24 hours of positive identification</li>'
        +'<li><strong>FFR via goAML:</strong> Immediately / within 24 hours</li>'
        +'<li><strong>CNMR to EOCN:</strong> Within 5 business days</li>'
        +'<li><strong>STR via goAML:</strong> Within 30 calendar days</li>'
        +'<li><strong>MoE Notification:</strong> Without delay</li>'
        +'</ul>',
      records:
        '<p>All records relating to this screening, the confirmed match, actions taken, freeze orders, STR filings, and communications with EOCN/FIU must be retained for a minimum of <strong>5 years</strong> from the date of the last transaction or termination of the business relationship, whichever is later. (FDL Art.25, Cabinet Resolution 134/2025 Art.24)</p>',
      footer: 'PENALTIES: Failure to comply with TFS obligations may result in administrative fines of up to AED 5,000,000 and/or criminal prosecution under UAE Federal Decree-Law No.(10) of 2025 Art.36-42. Individual officers may face personal liability.'
    };

    if (result === 'POTENTIAL_MATCH') return {
      cls: 'potential',
      label: 'POTENTIAL MATCH \u2014 ENHANCED DUE DILIGENCE REQUIRED',
      icon: '\u26A0',
      subtitle: 'Partial or similar name match detected \u2014 resolution required before proceeding',
      regulatory:
        '<ul>'
        +'<li><strong>UAE Federal Decree-Law No.(10) of 2025, Art.16-18:</strong> Where there are reasonable grounds to suspect a match, the reporting entity must apply Enhanced Due Diligence (EDD) measures to verify the identity of the person and determine whether the match is a true positive or false positive.</li>'
        +'<li><strong>Cabinet Decision No.(74) of 2020:</strong> Partial Name Match Reports (PNMR) must be filed with EOCN within 5 business days when a potential match cannot be immediately confirmed or excluded.</li>'
        +'<li><strong>FATF Recommendation 10:</strong> Where ML/TF risk is higher, enhanced measures must be applied including obtaining additional identification information and enhanced monitoring.</li>'
        +'<li><strong>MoE Circular 08/AML/2021:</strong> DPMS must conduct enhanced verification for any screening result that cannot be definitively resolved as negative. All transactions must be suspended until the match is resolved.</li>'
        +'<li><strong>Cabinet Resolution No.(134) of 2025, Art.8:</strong> EDD requirements include verifying source of funds, source of wealth, and obtaining senior management approval before proceeding.</li>'
        +'</ul>',
      actions:
        '<div class="hs-action-item warning"><span class="hs-action-num">1</span><div><strong>SUSPEND ALL PENDING TRANSACTIONS</strong><p>Do not process any transactions for the screened entity until the potential match is fully resolved. Document the suspension with date and reason. (FDL Art.16, Cabinet Decision 74/2020)</p></div></div>'
        +'<div class="hs-action-item warning"><span class="hs-action-num">2</span><div><strong>CONDUCT ENHANCED IDENTITY VERIFICATION</strong><p>Obtain and cross-reference: date of birth, place of birth, nationality, passport/EID number, photograph, address, and any other identifying data. Compare each data point against the sanctioned entry to confirm or exclude the match. (FDL Art.16-18, FATF Rec 10)</p></div></div>'
        +'<div class="hs-action-item warning"><span class="hs-action-num">3</span><div><strong>FILE PNMR TO EOCN WITHIN 5 BUSINESS DAYS</strong><p>If the match cannot be definitively resolved, submit a Partial Name Match Report (PNMR) to the Executive Office for Control &amp; Non-Proliferation (EOCN) within 5 business days. Include all data gathered during the verification process. (Cabinet Decision 74/2020, EOCN TFS Guidance)</p></div></div>'
        +'<div class="hs-action-item warning"><span class="hs-action-num">4</span><div><strong>ESCALATE TO COMPLIANCE OFFICER / MLRO</strong><p>The match resolution must be reviewed and approved by the Compliance Officer or MLRO before the entity is cleared or escalated further. Document all decisions with rationale. (FDL Art.20)</p></div></div>'
        +'<div class="hs-action-item warning"><span class="hs-action-num">5</span><div><strong>APPLY EDD IF MATCH IS RULED OUT</strong><p>Even if the match is ruled out as a false positive, consider applying EDD given the name similarity. Monitor the business relationship with enhanced scrutiny. (Cabinet Resolution 134/2025 Art.8)</p></div></div>'
        +'<div class="hs-action-item warning"><span class="hs-action-num">6</span><div><strong>DOCUMENT DIFFERENTIATION BASIS</strong><p>If ruled as false positive, document precisely how the entity was differentiated (different DOB, different nationality, different ID number, etc.). This record is essential for audit and regulatory inspection. (FDL Art.25)</p></div></div>',
      deadlines:
        '<ul>'
        +'<li><strong>Transaction Suspension:</strong> Immediately upon detection</li>'
        +'<li><strong>PNMR to EOCN:</strong> Within 5 business days (if unresolved)</li>'
        +'<li><strong>Match Resolution:</strong> Must be completed before any transaction proceeds</li>'
        +'<li><strong>Compliance Officer Review:</strong> Within 48 hours of detection</li>'
        +'</ul>',
      records:
        '<p>Retain all screening records, verification documents, correspondence with EOCN, PNMR filings, and the final match resolution decision for a minimum of <strong>5 years</strong>. Include the differentiation basis and all supporting evidence. (FDL Art.25, Cabinet Resolution 134/2025 Art.24)</p>',
      footer: 'NOTE: Processing a transaction for a potentially sanctioned person without completing due diligence constitutes a regulatory breach. If the potential match is subsequently confirmed, all prior transactions may be subject to investigation.'
    };

    // CLEAR / NEGATIVE
    return {
      cls: 'clear',
      label: 'NEGATIVE MATCH \u2014 NO SANCTIONS HIT',
      icon: '\u2705',
      subtitle: 'Entity cleared against all screened sanctions lists, PEP databases, and adverse media sources',
      regulatory:
        '<ul>'
        +'<li><strong>UAE Federal Decree-Law No.(10) of 2025, Art.12-16:</strong> Standard Customer Due Diligence (CDD) applies. The entity may proceed for onboarding or transaction processing subject to the completion of all required CDD measures.</li>'
        +'<li><strong>Cabinet Decision No.(74) of 2020:</strong> A negative screening result against the UAE Local Terrorist List and UNSC Consolidated List satisfies the mandatory TFS screening obligation for new and existing business relationships.</li>'
        +'<li><strong>FATF Recommendation 10:</strong> CDD measures must still be applied including identifying the customer, verifying identity using reliable documents, identifying beneficial owners, and understanding the purpose of the business relationship.</li>'
        +'<li><strong>MoE Circular 08/AML/2021:</strong> DPMS must retain the negative screening result as part of the customer file and re-screen at defined intervals or upon trigger events (list updates, periodic review, transaction triggers).</li>'
        +'<li><strong>Cabinet Resolution No.(134) of 2025, Art.6:</strong> Standard CDD must be completed before establishing the business relationship. Risk assessment must be documented.</li>'
        +'</ul>',
      actions:
        '<div class="hs-action-item ok"><span class="hs-action-num">1</span><div><strong>PROCEED WITH STANDARD CDD</strong><p>The entity has been cleared. Complete all standard Customer Due Diligence requirements: verify identity, identify beneficial owners (UBOs with >25% ownership), determine source of funds/wealth, and assess the customer risk profile. (FDL Art.12-16)</p></div></div>'
        +'<div class="hs-action-item ok"><span class="hs-action-num">2</span><div><strong>RECORD THE SCREENING RESULT</strong><p>Save this negative screening result to the customer file. Include: entity name as screened, lists checked, date of screening, screening officer name, and the screening reference ID. (FDL Art.25, MoE Circular 08/AML/2021)</p></div></div>'
        +'<div class="hs-action-item ok"><span class="hs-action-num">3</span><div><strong>SCHEDULE PERIODIC RE-SCREENING</strong><p>Set a re-screening date based on the customer risk level: High Risk \u2014 every 3 months, Medium Risk \u2014 every 6 months, Low Risk \u2014 every 12 months. Also re-screen upon any sanctions list update trigger. (Cabinet Resolution 134/2025 Art.13)</p></div></div>'
        +'<div class="hs-action-item ok"><span class="hs-action-num">4</span><div><strong>COMPLETE RISK ASSESSMENT</strong><p>Assign an initial risk rating based on customer type, jurisdiction, products/services, delivery channel, and any other relevant risk factors. Document the risk assessment in the customer file. (FDL Art.14, Cabinet Resolution 134/2025 Art.4-5)</p></div></div>'
        +'<div class="hs-action-item ok"><span class="hs-action-num">5</span><div><strong>APPLY ONGOING MONITORING</strong><p>Monitor the business relationship on an ongoing basis. Ensure transactions are consistent with the known customer profile, source of funds, and risk rating. Report any suspicious activity. (FDL Art.17)</p></div></div>',
      deadlines:
        '<ul>'
        +'<li><strong>CDD Completion:</strong> Before establishing the business relationship</li>'
        +'<li><strong>Risk Assessment:</strong> At onboarding and upon trigger events</li>'
        +'<li><strong>Re-screening (High Risk):</strong> Every 3 months</li>'
        +'<li><strong>Re-screening (Medium Risk):</strong> Every 6 months</li>'
        +'<li><strong>Re-screening (Low Risk):</strong> Every 12 months</li>'
        +'<li><strong>Record Retention:</strong> Minimum 5 years from last transaction</li>'
        +'</ul>',
      records:
        '<p>Retain screening records, CDD documents, risk assessments, and all transaction records for a minimum of <strong>5 years</strong> from the date of the last transaction or termination of the business relationship, whichever is later. For DPMS under MoE supervision, the recommended retention period is <strong>10 years</strong>. (FDL Art.25, Cabinet Resolution 134/2025 Art.24, MoE Circular 08/AML/2021)</p>',
      footer: 'IMPORTANT: A negative screening result is point-in-time only. Sanctions lists are updated frequently. Continuous monitoring and periodic re-screening are mandatory regulatory obligations.'
    };
  }

  // ── AI SCREENING (Quick Screen Tab) ──
  async function runQuickScreen() {
    const name = document.getElementById('qs-name')?.value?.trim();
    const type = document.getElementById('qs-type')?.value;
    const country = document.getElementById('qs-country')?.value?.trim() || '';
    if (!name) { toast('Enter entity name', 'error'); return; }

    const resultEl = document.getElementById('qs-result');
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.innerHTML = '<p class="hs-screening-status">Screening in progress \u2014 deep sanctions, PEP & adverse media check...</p>';
    }

    const match = await TFSEngine.screenEntity(name, type, country);
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
