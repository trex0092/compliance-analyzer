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
  function today() { const n=new Date(); return String(n.getDate()).padStart(2,'0')+'/'+String(n.getMonth()+1).padStart(2,'0')+'/'+n.getFullYear(); }
  function parseDDMMYYYY(s) { if(!s) return null; const p=s.split('/'); if(p.length!==3) return null; return new Date(p[2],p[1]-1,p[0]); }
  function fmtDate(d) { if(!d) return '\u2014'; const dt = d.includes&&d.includes('/') ? parseDDMMYYYY(d) : new Date(d); if(!dt||isNaN(dt.getTime())) return d; return String(dt.getDate()).padStart(2,'0')+'/'+String(dt.getMonth()+1).padStart(2,'0')+'/'+dt.getFullYear(); }
  function fmtDateDDMMYYYY(dt) { return String(dt.getDate()).padStart(2,'0')+'/'+String(dt.getMonth()+1).padStart(2,'0')+'/'+dt.getFullYear(); }
  function addBusinessDays(date, days) {
    const d = parseDDMMYYYY(date) || new Date(date);
    let added = 0;
    while (added < days) { d.setDate(d.getDate()+1); if(d.getDay()!==0&&d.getDay()!==6) added++; }
    return fmtDateDDMMYYYY(d);
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

      const tfsComp = match.result === 'MATCH'
        ? { label:'POSITIVE MATCH', desc:'Positively identified on sanctions list. Under UAE FDL No.10/2025 (Art.22) and FATF Rec 6: do NOT proceed, freeze assets within 24h, file STR via goAML, escalate to MLRO.', cls:'match' }
        : match.result === 'POTENTIAL_MATCH'
        ? { label:'POTENTIAL MATCH', desc:'Partial or similar name matches found. Enhanced Due Diligence required. Verify identity documents, cross-reference DOB, nationality, and ID numbers. Do NOT proceed until resolved.', cls:'potential' }
        : { label:'NEGATIVE MATCH', desc:'No matches found. Entity cleared for standard CDD. Per FATF Rec 10 and UAE FDL No.10/2025 (Art.16), maintain records for minimum 5 years. Re-screen periodically.', cls:'clear' };

      resultEl.innerHTML =
        '<div class="hs-screen-result '+tfsComp.cls+'">'
          +'<div class="hs-result-header"><span class="hs-badge '+tfsComp.cls+'">'+tfsComp.label+'</span><span class="hs-result-entity">'+match.entity+'</span></div>'
          +matchesHtml
          +(match.recommendation ? '<div class="hs-result-recommendation">'+match.recommendation+'</div>' : '')
          +'<div class="hs-result-basis"><strong>'+tfsComp.label+' \u2014 COMPLIANCE BASIS</strong><p>'+tfsComp.desc+'</p></div>'
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
