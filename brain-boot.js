/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║          HAWKEYE STERLING V2 — SUPER-BRAIN BOOT ENGINE  v3.0.0          ║
 * ║          Maximum Compliance Intelligence — Full Autonomy Mode            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Client-side intelligence orchestration layer. Installs global hooks:
 *
 *   window.__brainNotify(event)       — fire-and-forget alert /api/brain
 *   window.__decisionNotify(input)    — full decision pipeline /api/decision
 *   window.__brainAnalyze(input)      — full MegaBrain analysis /api/brain-analyze
 *   window.__brainMemory              — contextual entity memory (IndexedDB)
 *   window.__brainTypology            — 47 FATF/UAE typology scanner
 *   window.__brainXAI                 — Shapley explainability overlay
 *   window.__brainSelfAudit()         — AI governance self-audit trigger
 *   window.__brainAutopilot           — autonomous case dispatcher
 *   window.__brainTelemetry           — live telemetry feed
 *   window.__brainRegulatoryDrift     — regulatory drift watchdog
 *   window.__brainFeedbackLoop        — closed-loop MLRO learning
 *   window.__brainWarRoom             — war room event bus
 *   window.__brainOrchestrate(input)  — multi-model AI orchestration
 *   window.__brainDiagnostics()       — full system health check
 *
 * INTELLIGENCE LAYERS (execution order per analysis):
 *   1.  Entity Memory Graph        — full historical context from IndexedDB
 *   2.  Typology Pre-Scan          — 47 FATF/UAE typologies (zero API cost)
 *   3.  Multi-Model Orchestration  — Claude + Gemini consensus routing
 *   4.  MegaBrain Pipeline         — 40+ subsystems (Bayesian, XAI, Causal)
 *   5.  Shapley XAI Overlay        — feature contribution per verdict
 *   6.  Regulatory Drift Check     — diff against FDL No.10/2025 baseline
 *   7.  Confidence Calibration     — Platt scaling on historical accuracy
 *   8.  Tipping-Off Linter         — blocks output that could tip off subject
 *   9.  Closed-Loop Feedback       — MLRO resolutions feed back into memory
 *  10.  Autonomous Asana Dispatch  — zero-human routing for clear decisions
 *  11.  War Room Emission          — real-time NORAD dashboard updates
 *  12.  Telemetry Recording        — every decision logged for trend analysis
 *  13.  ZK Compliance Proof        — cryptographic seal on every bundle
 *
 * Regulatory basis:
 *   UAE FDL No.10/2025 | Cabinet Res 74/2020 | Cabinet Res 134/2025
 *   FATF Rec 1,6,7,10,12,14,15,18,20,22,23 | NIST AI RMF 1.0
 *   EU AI Act 2024/1689 | ISO/IEC 42001:2023 | UAE AI Charter 2031
 *   LBMA RGG v9 | OECD DDG | MoE Circular 08/AML/2021
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  if (window.__HAWKEYE_BRAIN_INSTALLED) return;
  window.__HAWKEYE_BRAIN_INSTALLED = true;

  /* ── SECTION 0: CONSTANTS ─────────────────────────────────────────────── */
  var V = '3.0.0';
  var EP = {
    brain:       '/api/brain',
    decision:    '/api/decision',
    analyze:     '/api/brain-analyze',
    correlate:   '/api/brain-correlate',
    telemetry:   '/api/brain-telemetry',
    selfAudit:   '/.netlify/functions/ai-governance-self-audit-cron',
    autopilot:   '/.netlify/functions/asana-super-brain-autopilot-cron',
    warRoom:     '/api/warroom-stream',
    orchestrate: '/api/orchestrate',
    drift:       '/api/regulatory-drift-cron',
    diagnostics: '/api/brain-diagnostics',
  };
  var IDB = {
    name: 'HawkeyeBrainMemory', version: 3,
    entities: 'entity_snapshots', decisions: 'decision_history',
    typologies: 'typology_hits', feedback: 'mlro_feedback',
    telemetry: 'telemetry_local', calibration: 'confidence_calibration',
  };

  /* ── SECTION 1: 47 UAE/FATF TYPOLOGY RULES ───────────────────────────── */
  var TR = [
    {id:'T01',name:'Structuring / Smurfing',sev:'high',fatf:'Rec 20',uae:'FDL Art.26',
     fn:function(t){return t.filter(function(x){return x.amount<55000&&x.amount>45000;}).length>=3;}},
    {id:'T02',name:'Rapid Round-Trip / Layering',sev:'high',fatf:'Rec 20',uae:'FDL Art.26',
     fn:function(t){if(t.length<2)return false;var s=t.slice().sort(function(a,b){return new Date(a.date)-new Date(b.date);});for(var i=1;i<s.length;i++){var h=(new Date(s[i].date)-new Date(s[i-1].date))/3600000;if(h<48&&Math.abs(s[i].amount-s[i-1].amount)/s[i-1].amount<0.05)return true;}return false;}},
    {id:'T03',name:'Transaction Velocity Spike',sev:'medium',fatf:'Rec 10',uae:'FDL Art.16',
     fn:function(t,e){var sum=t.reduce(function(s,x){return s+(x.amount||0);},0);return(e.historicalAvgMonthly||0)>0&&sum>e.historicalAvgMonthly*3;}},
    {id:'T04',name:'High-Risk Jurisdiction Exposure',sev:'high',fatf:'Rec 1',uae:'Cabinet Res 134/2025 Art.5',
     fn:function(t){var H=['IR','KP','MM','RU','SY','BY','CU','VE','YE','LY','SO','SD'];return t.some(function(x){return H.indexOf(x.counterpartyCountry)!==-1;});}},
    {id:'T05',name:'PEP Exposure — Undisclosed',sev:'critical',fatf:'Rec 12',uae:'FDL Art.18',
     fn:function(t,e){return e.pepScreenResult==='MATCH'&&!e.pepDisclosed;}},
    {id:'T06',name:'Sanctions List Proximity',sev:'critical',fatf:'Rec 6',uae:'FDL Art.35; Cabinet Res 74/2020',
     fn:function(t,e){return(e.sanctionsMatchScore||0)>0.7;}},
    {id:'T07',name:'Cash-Intensive Transaction Pattern',sev:'medium',fatf:'Rec 22',uae:'MoE Circular 08/AML/2021',
     fn:function(t){return t.filter(function(x){return x.method==='CASH';}).length/Math.max(t.length,1)>0.6;}},
    {id:'T08',name:"Benford's Law Digit Anomaly",sev:'medium',fatf:'Rec 10',uae:'FDL Art.19',
     fn:function(t){if(t.length<10)return false;var c=[0,0,0,0,0,0,0,0,0,0];t.forEach(function(x){var d=parseInt(String(Math.abs(x.amount)).replace('.','')[0]);if(d>=1)c[d]++;});var ex=[0,0.301,0.176,0.125,0.097,0.079,0.067,0.058,0.051,0.046],chi2=0;for(var i=1;i<=9;i++){var o=c[i]/t.length;chi2+=Math.pow(o-ex[i],2)/ex[i];}return chi2>15.5;}},
    {id:'T09',name:'Trade-Based Money Laundering',sev:'high',fatf:'Rec 22',uae:'LBMA RGG v9',
     fn:function(t){return t.some(function(x){return x.type==='TRADE'&&x.invoiceValue&&x.marketValue&&Math.abs(x.invoiceValue-x.marketValue)/x.marketValue>0.2;});}},
    {id:'T10',name:'Dormant Account Sudden Reactivation',sev:'medium',fatf:'Rec 10',uae:'FDL Art.16',
     fn:function(t,e){return e.lastActivityDate&&(Date.now()-new Date(e.lastActivityDate))/86400000>180&&t.length>0;}},
    {id:'T11',name:'UBO Opacity / Complex Ownership',sev:'high',fatf:'Rec 10',uae:'FDL Art.16',
     fn:function(t,e){return e.uboDepth>3||e.uboVerified===false;}},
    {id:'T12',name:'Shell Company Indicators',sev:'high',fatf:'Rec 10',uae:'FDL Art.16',
     fn:function(t,e){var s=0;if(!e.physicalAddress)s++;if(!e.employees||e.employees<2)s++;if(e.incorporationAge<365)s++;if(!e.businessActivity)s++;return s>=3;}},
    {id:'T13',name:'Proliferation Financing Indicators',sev:'critical',fatf:'Rec 7',uae:'Cabinet Res 74/2020',
     fn:function(t,e){return['DUAL_USE','MILITARY','NUCLEAR','CHEMICAL','BIOLOGICAL'].indexOf(e.industrySector)!==-1||e.pfScreenResult==='MATCH';}},
    {id:'T14',name:'Hawala / Informal Value Transfer',sev:'high',fatf:'Rec 14',uae:'FDL Art.26',
     fn:function(t){return t.some(function(x){return x.channel==='HAWALA'||x.channel==='INFORMAL_REMITTANCE';});}},
    {id:'T15',name:'Unregulated VASP / Crypto Exposure',sev:'high',fatf:'Rec 15',uae:'FDL Art.26',
     fn:function(t){return t.some(function(x){return x.channel==='CRYPTO'&&!x.vaspLicensed;});}},
    {id:'T16',name:'Adverse Media — High Severity',sev:'high',fatf:'Rec 10',uae:'FDL Art.16',
     fn:function(t,e){return(e.adverseMediaScore||0)>0.65;}},
    {id:'T17',name:'CDD Documents Expired',sev:'medium',fatf:'Rec 10',uae:'FDL Art.16',
     fn:function(t,e){return e.cddExpiryDate&&new Date(e.cddExpiryDate)<new Date();}},
    {id:'T18',name:'Multi-Jurisdiction Layering',sev:'high',fatf:'Rec 20',uae:'FDL Art.26',
     fn:function(t){var c={};t.forEach(function(x){if(x.counterpartyCountry)c[x.counterpartyCountry]=1;});return Object.keys(c).length>=5;}},
    {id:'T19',name:'Precious Metals Price Anomaly',sev:'high',fatf:'Rec 22',uae:'LBMA RGG v9',
     fn:function(t){return t.some(function(x){return x.commodity==='GOLD'&&x.pricePerGram&&(x.pricePerGram<200||x.pricePerGram>500);});}},
    {id:'T20',name:'Source of Funds — Unverified',sev:'high',fatf:'Rec 10',uae:'FDL Art.17',
     fn:function(t,e){return e.sofVerified===false&&e.riskRating==='HIGH';}},
    {id:'T21',name:'Politically Sensitive Timing',sev:'medium',fatf:'Rec 12',uae:'FDL Art.18',
     fn:function(t,e){return e.isPep&&t.some(function(x){var d=new Date(x.date);return d.getMonth()===10||d.getMonth()===2;});}},
    {id:'T22',name:'Conflict-Affected / High-Risk Area Supply Chain',sev:'critical',fatf:'Rec 22',uae:'LBMA RGG v9; OECD DDG',
     fn:function(t,e){return e.cahraExposure===true;}},
    {id:'T23',name:'Fictitious / Altered Trade Documents',sev:'critical',fatf:'Rec 22',uae:'FDL Art.26',
     fn:function(t){return t.some(function(x){return x.documentIntegrityScore<0.5;});}},
    {id:'T24',name:'Loan-Back / Self-Financing Scheme',sev:'high',fatf:'Rec 20',uae:'FDL Art.26',
     fn:function(t){var l=t.filter(function(x){return x.type==='LOAN';}),r=t.filter(function(x){return x.type==='LOAN_REPAYMENT';});return l.length>0&&r.length>0&&Math.abs(l[0].amount-r[0].amount)<1000;}},
    {id:'T25',name:'Nominee Shareholder / Director Arrangement',sev:'high',fatf:'Rec 10',uae:'FDL Art.16',
     fn:function(t,e){return e.nomineeArrangement===true;}},
    {id:'T26',name:'Overpayment / Refund Scheme',sev:'medium',fatf:'Rec 20',uae:'FDL Art.26',
     fn:function(t){return t.some(function(x){return x.type==='REFUND'&&x.amount>50000;});}},
    {id:'T27',name:'Buy-Back / Repurchase Scheme',sev:'high',fatf:'Rec 22',uae:'MoE Circular 08/AML/2021',
     fn:function(t){var b=t.filter(function(x){return x.type==='BUY';}),s=t.filter(function(x){return x.type==='SELL';});if(!b.length||!s.length)return false;var g=Math.abs(new Date(s[0].date)-new Date(b[0].date))/86400000;return g<7&&Math.abs(b[0].amount-s[0].amount)/b[0].amount<0.03;}},
    {id:'T28',name:'ESG / Greenwashing Fraud Indicators',sev:'medium',fatf:'Rec 1',uae:'UAE Net Zero 2050',
     fn:function(t,e){return(e.esgScore||1)<0.2&&(e.esgClaimsScore||0)>0.8;}},
    {id:'T29',name:'Modern Slavery / Human Trafficking Indicators',sev:'critical',fatf:'Rec 20',uae:'FDL Art.26',
     fn:function(t,e){return e.modernSlaveryRisk==='HIGH';}},
    {id:'T30',name:'Deepfake / AI-Generated Document Detected',sev:'critical',fatf:'Rec 10',uae:'FDL Art.16',
     fn:function(t,e){return(e.deepfakeDocumentScore||0)>0.7;}},
    {id:'T31',name:'STR Narrative Drift vs Prior Filings',sev:'medium',fatf:'Rec 20',uae:'FDL Art.26',
     fn:function(t,e){return(e.narrativeDriftScore||0)>0.5;}},
    {id:'T32',name:'Taint Propagation from Known Bad Actor',sev:'critical',fatf:'Rec 20',uae:'FDL Art.26',
     fn:function(t,e){return(e.taintScore||0)>0.6;}},
    {id:'T33',name:'Regulatory Deadline Breach Risk',sev:'high',fatf:'Rec 18',uae:'FDL Art.21',
     fn:function(t,e){return e.nextRegulatoryDeadline&&(new Date(e.nextRegulatoryDeadline)-Date.now())/86400000<5;}},
    {id:'T34',name:'Four-Eyes Control Bypass',sev:'critical',fatf:'Rec 18',uae:'FDL Art.20; Cabinet Res 134/2025 Art.14',
     fn:function(t,e){return e.fourEyesBypassed===true;}},
    {id:'T35',name:'Insider Risk / Staff Collusion Indicators',sev:'critical',fatf:'Rec 18',uae:'FDL Art.21',
     fn:function(t,e){return(e.insiderRiskScore||0)>0.7;}},
    {id:'T36',name:'Adversarial ML Evasion Attempt',sev:'critical',fatf:'Rec 15',uae:'UAE AI Charter 2031',
     fn:function(t,e){return(e.adversarialMlScore||0)>0.6;}},
    {id:'T37',name:'Suspicious Temporal Pattern (Weekend/Holiday)',sev:'medium',fatf:'Rec 20',uae:'FDL Art.26',
     fn:function(t){var s=t.filter(function(x){var d=new Date(x.date);return d.getDay()===0||d.getDay()===6;});return s.length/Math.max(t.length,1)>0.7;}},
    {id:'T38',name:'Cross-Customer Network Correlation',sev:'high',fatf:'Rec 20',uae:'FDL Art.26',
     fn:function(t,e){return(e.crossCustomerCorrelationScore||0)>0.6;}},
    {id:'T39',name:'VAT Registration Fraud Indicators',sev:'high',fatf:'Rec 20',uae:'FDL Art.26',
     fn:function(t,e){return(e.vatRegistrationAnomalyScore||0)>0.6;}},
    {id:'T40',name:'Gold Fineness / Purity Anomaly',sev:'high',fatf:'Rec 22',uae:'LBMA RGG v9',
     fn:function(t){return t.some(function(x){return x.commodity==='GOLD'&&x.fineness&&(x.fineness<750||x.fineness>999.9);});}},
    {id:'T41',name:'Abnormal Melt Loss / Refinery Discrepancy',sev:'medium',fatf:'Rec 22',uae:'LBMA RGG v9',
     fn:function(t){return t.some(function(x){return x.type==='REFINERY'&&x.meltLossPct&&x.meltLossPct>0.05;});}},
    {id:'T42',name:'Inventory Reconciliation Failure',sev:'high',fatf:'Rec 22',uae:'MoE Circular 08/AML/2021',
     fn:function(t,e){return(e.inventoryDiscrepancyPct||0)>0.03;}},
    {id:'T43',name:'CBUAE FX Threshold Breach',sev:'high',fatf:'Rec 20',uae:'CBUAE Regulations',
     fn:function(t){return t.some(function(x){return x.type==='FX'&&x.amount>100000;});}},
    {id:'T44',name:'Peer Group Statistical Outlier',sev:'medium',fatf:'Rec 10',uae:'FDL Art.16',
     fn:function(t,e){return(e.peerAnomalyZScore||0)>2.5;}},
    {id:'T45',name:'Compliance SLA Breach Predicted',sev:'medium',fatf:'Rec 18',uae:'FDL Art.21',
     fn:function(t,e){return(e.slaPredictedBreachProbability||0)>0.7;}},
    {id:'T46',name:'UAE Free Zone Regulatory Arbitrage',sev:'high',fatf:'Rec 1',uae:'FDL Art.5; Cabinet Res 134/2025',
     fn:function(t,e){return(e.freeZoneRiskScore||0)>0.6;}},
    {id:'T47',name:'Gold Origin Tracing — Chain of Custody Failure',sev:'critical',fatf:'Rec 22',uae:'LBMA RGG v9; OECD DDG',
     fn:function(t,e){return e.goldOriginVerified===false&&(e.goldWeight||0)>100;}},
  ];

  /* ── SECTION 2: UTILITIES ─────────────────────────────────────────────── */
  function san(s,n){return typeof s!=='string'?'':s.replace(/[\r\n\t\u0000-\u001f]/g,' ').trim().slice(0,n||500);}
  function tok(){try{return(typeof localStorage!=='undefined'&&localStorage.getItem('auth.token'))||null;}catch(_){return null;}}
  function hdrs(){var t=tok(),h={'Content-Type':'application/json'};if(t)h['Authorization']='Bearer '+t;return h;}
  function now(){return new Date().toISOString();}
  function uid(){if(typeof crypto!=='undefined'&&crypto.randomUUID)return crypto.randomUUID();return'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return(c==='x'?r:(r&0x3|0x8)).toString(16);});}
  function sf(url,opts,ms){
    ms=ms||30000;
    return new Promise(function(res,rej){
      var ctrl=typeof AbortController!=='undefined'?new AbortController():null;
      var timer=setTimeout(function(){if(ctrl)ctrl.abort();rej(new Error('timeout'));},ms);
      fetch(url,Object.assign({},opts,ctrl?{signal:ctrl.signal}:{}))
        .then(function(r){clearTimeout(timer);return r.ok?r.json():Promise.reject(new Error(r.status));})
        .then(res).catch(function(e){clearTimeout(timer);rej(e);});
    });
  }

  /* ── SECTION 3: INDEXEDDB ENTITY MEMORY GRAPH ────────────────────────── */
  var _db=null;
  function odb(){
    if(_db)return Promise.resolve(_db);
    return new Promise(function(res,rej){
      if(typeof indexedDB==='undefined'){rej(new Error('no IDB'));return;}
      var r=indexedDB.open(IDB.name,IDB.version);
      r.onupgradeneeded=function(e){
        var db=e.target.result;
        var stores=[[IDB.entities,'entityId',['riskRating','lastUpdated']],[IDB.decisions,'decisionId',['entityId','verdict','timestamp']],[IDB.typologies,'hitId',['entityId','typologyId']],[IDB.feedback,'feedbackId',['entityId','resolution']],[IDB.telemetry,'telemetryId',[]],[IDB.calibration,'modelId',[]]];
        stores.forEach(function(s){if(!db.objectStoreNames.contains(s[0])){var os=db.createObjectStore(s[0],{keyPath:s[1]});s[2].forEach(function(i){os.createIndex(i,i,{unique:false});});}});
      };
      r.onsuccess=function(e){_db=e.target.result;res(_db);};
      r.onerror=function(e){rej(e.target.error);};
    });
  }
  function put(store,rec){return odb().then(function(db){return new Promise(function(res,rej){var tx=db.transaction(store,'readwrite');tx.objectStore(store).put(rec).onsuccess=function(e){res(e.target.result);};tx.onerror=function(e){rej(e.target.error);};});});}
  function get(store,key){return odb().then(function(db){return new Promise(function(res,rej){var r=db.transaction(store,'readonly').objectStore(store).get(key);r.onsuccess=function(e){res(e.target.result||null);};r.onerror=function(e){rej(e.target.error);};});});}
  function idx(store,index,val){return odb().then(function(db){return new Promise(function(res,rej){var rows=[];db.transaction(store,'readonly').objectStore(store).index(index).openCursor(IDBKeyRange.only(val)).onsuccess=function(e){var c=e.target.result;if(c){rows.push(c.value);c.continue();}else res(rows);};});});}

  window.__brainMemory={
    version:V,
    saveEntity:function(id,s){return put(IDB.entities,Object.assign({},s,{entityId:id,lastUpdated:now()}));},
    getEntity:function(id){return get(IDB.entities,id);},
    saveDecision:function(id,d){return put(IDB.decisions,Object.assign({},d,{decisionId:uid(),entityId:id,timestamp:now()}));},
    getDecisionHistory:function(id){return idx(IDB.decisions,'entityId',id);},
    saveTypologyHit:function(id,tid,det){return put(IDB.typologies,{hitId:uid(),entityId:id,typologyId:tid,details:det,timestamp:now()});},
    saveFeedback:function(id,r,d){return put(IDB.feedback,{feedbackId:uid(),entityId:id,resolution:r,details:d,timestamp:now()});},
    getFeedbackHistory:function(id){return idx(IDB.feedback,'entityId',id);},
    buildContext:function(id){
      return Promise.all([get(IDB.entities,id),idx(IDB.decisions,'entityId',id),idx(IDB.typologies,'entityId',id),idx(IDB.feedback,'entityId',id)])
        .then(function(r){return{entitySnapshot:r[0]||{},decisionHistory:r[1]||[],typologyHits:r[2]||[],mlroFeedback:r[3]||[],priorStrCount:(r[1]||[]).filter(function(d){return d.verdict==='file_str';}).length,priorFreezeCount:(r[1]||[]).filter(function(d){return d.verdict==='freeze';}).length,falsePositiveRate:(r[3]||[]).filter(function(f){return f.resolution==='false_positive';}).length/Math.max((r[3]||[]).length,1),contextBuiltAt:now()};});
    },
  };

  /* ── SECTION 4: TYPOLOGY SCANNER ─────────────────────────────────────── */
  var SO={critical:0,high:1,medium:2,low:3,info:4};
  window.__brainTypology={
    version:V,ruleCount:TR.length,
    scan:function(entity,txs){
      entity=entity||{};txs=txs||[];
      var hits=[];
      for(var i=0;i<TR.length;i++){try{if(TR[i].fn(txs,entity))hits.push({typologyId:TR[i].id,name:TR[i].name,severity:TR[i].sev,fatfRef:TR[i].fatf,uaeRef:TR[i].uae,detectedAt:now()});}catch(_){}}
      return hits.sort(function(a,b){return(SO[a.severity]||4)-(SO[b.severity]||4);});
    },
    requiresEscalation:function(h){return h.some(function(x){return x.severity==='critical'||x.severity==='high';});},
    summarize:function(h){
      if(!h.length)return'No typology matches in local pre-scan.';
      var c=h.filter(function(x){return x.severity==='critical';}),hi=h.filter(function(x){return x.severity==='high';}),m=h.filter(function(x){return x.severity==='medium';});
      var l=['Local pre-scan: '+h.length+' match(es).'];
      if(c.length)l.push('  CRITICAL: '+c.map(function(x){return x.name;}).join(', '));
      if(hi.length)l.push('  HIGH: '+hi.map(function(x){return x.name;}).join(', '));
      if(m.length)l.push('  MEDIUM: '+m.map(function(x){return x.name;}).join(', '));
      return l.join('\n');
    },
  };

  /* ── SECTION 5: SHAPLEY XAI EXPLAINABILITY ───────────────────────────── */
  window.__brainXAI={
    version:V,
    computeShapley:function(features,modelFn){
      var keys=Object.keys(features),sh={},N=50;
      keys.forEach(function(k){sh[k]=0;});
      for(var s=0;s<N;s++){var perm=keys.slice().sort(function(){return Math.random()-0.5;}),sub={};for(var i=0;i<perm.length;i++){var wo=modelFn(sub);sub[perm[i]]=features[perm[i]];sh[perm[i]]+=(modelFn(sub)-wo)/N;}}
      var tot=Object.values(sh).reduce(function(s,v){return s+Math.abs(v);},0);
      if(tot>0)keys.forEach(function(k){sh[k]=sh[k]/tot;});
      return sh;
    },
    buildProvenance:function(res,features){
      var p={decisionId:res.decisionId||uid(),verdict:res.verdict,confidence:res.confidence,timestamp:now(),regulatoryBasis:res.clampReasons||[],featureContributions:[],topDrivers:[],humanReviewRequired:!!res.requiresHumanReview,tippingOffClean:res.tippingOffClean!==false,zkSealPresent:!!res.zkSeal};
      var sv=res.shapleyValues;
      if(sv){var e=Object.keys(sv).map(function(k){return{feature:k,contribution:sv[k]};}).sort(function(a,b){return Math.abs(b.contribution)-Math.abs(a.contribution);});p.featureContributions=e;p.topDrivers=e.slice(0,5).map(function(x){return x.feature+' ('+(x.contribution*100).toFixed(1)+'%)';});}
      else if(features){var fe=Object.keys(features).map(function(k){return{feature:k,contribution:typeof features[k]==='number'?features[k]:0};}).sort(function(a,b){return Math.abs(b.contribution)-Math.abs(a.contribution);});p.featureContributions=fe.slice(0,10);p.topDrivers=fe.slice(0,5).map(function(x){return x.feature+' (mag:'+x.contribution.toFixed(3)+')';});}
      return p;
    },
    renderProvenanceText:function(p){
      var l=['═══════════════════════════════════════════════════','DECISION PROVENANCE — '+p.decisionId,'═══════════════════════════════════════════════════','Verdict:    '+(p.verdict||'UNKNOWN').toUpperCase(),'Confidence: '+((p.confidence||0)*100).toFixed(1)+'%','Timestamp:  '+p.timestamp,'Human Review Required: '+(p.humanReviewRequired?'YES':'NO'),'Tipping-Off Clean:     '+(p.tippingOffClean?'YES':'BLOCKED'),'ZK Seal Present:       '+(p.zkSealPresent?'YES':'NO'),'','TOP DECISION DRIVERS:'];
      p.topDrivers.forEach(function(d,i){l.push('  '+(i+1)+'. '+d);});
      if(p.regulatoryBasis.length){l.push('');l.push('REGULATORY BASIS:');p.regulatoryBasis.forEach(function(r){l.push('  \u2022 '+r);});}
      l.push('═══════════════════════════════════════════════════');
      return l.join('\n');
    },
  };

  /* ── SECTION 6: CONFIDENCE CALIBRATION (PLATT SCALING) ──────────────── */
  var _cal={};
  function calibrate(raw,modelId){var c=_cal[modelId];if(!c||!c.a)return raw;return 1/(1+Math.exp(c.a*raw+c.b));}
  function trainCal(modelId,preds,actuals){
    var a=1,b=0,lr=0.01;
    for(var ep=0;ep<100;ep++){var dA=0,dB=0;for(var i=0;i<preds.length;i++){var p=1/(1+Math.exp(a*preds[i]+b)),err=p-actuals[i];dA+=err*preds[i]*p*(1-p);dB+=err*p*(1-p);}a-=lr*dA/preds.length;b-=lr*dB/preds.length;}
    _cal[modelId]={a:a,b:b,updatedAt:now()};
    put(IDB.calibration,{modelId:modelId,a:a,b:b,updatedAt:now()});
  }

  /* ── SECTION 7: CORE BRAIN HOOKS (BACKWARD COMPATIBLE v1.1.0) ────────── */
  var VK={str_saved:1,sanctions_match:1,threshold_breach:1,deadline_missed:1,cdd_overdue:1,evidence_break:1,manual:1,typology_hit:1,pep_match:1,freeze_triggered:1,narrative_drift:1,adversarial_detected:1,four_eyes_bypass:1,insider_risk:1,regulatory_deadline:1,gold_origin_failure:1};
  var VS={info:1,low:1,medium:1,high:1,critical:1};

  window.__brainNotify=function brainNotify(event){
    try{
      if(!event||!VK[event.kind]||!VS[event.severity])return false;
      var c={kind:event.kind,severity:event.severity,summary:san(event.summary,500)};
      if(!c.summary)return false;
      if(event.subject)c.subject=san(event.subject,200);
      if(event.refId)c.refId=san(event.refId,64);
      if(typeof event.matchScore==='number'&&isFinite(event.matchScore))c.matchScore=Math.max(0,Math.min(1,event.matchScore));
      if(event.meta&&typeof event.meta==='object')c.meta=event.meta;
      var t=tok();if(!t)return false;
      fetch(EP.brain,{method:'POST',headers:hdrs(),body:JSON.stringify(c),keepalive:true}).catch(function(){});
      window.__brainTelemetry&&window.__brainTelemetry.record({type:'notify',kind:event.kind,severity:event.severity,timestamp:now()});
      return true;
    }catch(_){return false;}
  };
  window.__brainNotify.version=V;
  window.__brainNotify.endpoint=EP.brain;

  window.__decisionNotify=function decisionNotify(input){
    try{
      if(!input||!input.tenantId||!input.topic||!input.entity)return Promise.resolve(null);
      var t=tok();if(!t)return Promise.resolve(null);
      return window.__brainMemory.buildContext(input.entity.id||input.tenantId)
        .then(function(ctx){return sf(EP.decision,{method:'POST',headers:hdrs(),body:JSON.stringify(Object.assign({},input,{memoryContext:ctx})),keepalive:true});})
        .then(function(r){if(r){window.__brainMemory.saveDecision(input.entity.id||input.tenantId,r);r._provenance=window.__brainXAI.buildProvenance(r,input.entity.features);}return r;})
        .catch(function(){return null;});
    }catch(_){return Promise.resolve(null);}
  };
  window.__decisionNotify.version=V;
  window.__decisionNotify.endpoint=EP.decision;

  /* ── SECTION 8: FULL MEGABRAIN ANALYSIS ──────────────────────────────── */
  window.__brainAnalyze=function brainAnalyze(input){
    if(!input||!input.entity)return Promise.reject(new Error('entity required'));
    var eid=input.entity.id||input.tenantId||'unknown',t0=Date.now();
    var hits=window.__brainTypology.scan(input.entity,input.transactions||[]);
    hits.forEach(function(h){window.__brainMemory.saveTypologyHit(eid,h.typologyId,h);
});
    return window.__brainMemory.buildContext(eid)
      .then(function(ctx){
        var t=tok();if(!t)return Promise.reject(new Error('auth required'));
        return sf(EP.analyze,{method:'POST',headers:hdrs(),body:JSON.stringify({tenantId:input.tenantId,topic:input.topic||'compliance_analysis',entity:input.entity,transactions:input.transactions||[],filing:input.filing||null,memoryContext:ctx,typologyPreScan:{hits:hits,summary:window.__brainTypology.summarize(hits),requiresEscalation:window.__brainTypology.requiresEscalation(hits)},requestedAt:now(),clientVersion:V})},60000);
      })
      .then(function(result){
        if(!result)return null;
        result._provenance=window.__brainXAI.buildProvenance(result,input.entity.features);
        result._provenanceText=window.__brainXAI.renderProvenanceText(result._provenance);
        if(typeof result.confidence==='number'){result.rawConfidence=result.confidence;result.confidence=calibrate(result.confidence,'megabrain');}
        window.__brainMemory.saveDecision(eid,{verdict:result.verdict,confidence:result.confidence,typologyHits:hits,provenance:result._provenance,processingMs:Date.now()-t0});
        if(result.verdict&&result.confidence>0.85&&!result.requiresHumanReview)window.__brainAutopilot&&window.__brainAutopilot.dispatch(eid,result);
        if(result.verdict==='freeze'||result.verdict==='file_str')window.__brainWarRoom&&window.__brainWarRoom.emit({type:'critical_verdict',entityId:eid,verdict:result.verdict,confidence:result.confidence,topTypologies:hits.slice(0,3),timestamp:now()});
        window.__brainTelemetry&&window.__brainTelemetry.record({type:'analysis',entityId:eid,verdict:result.verdict,confidence:result.confidence,typologyCount:hits.length,processingMs:Date.now()-t0,timestamp:now()});
        return result;
      })
      .catch(function(err){
        console.warn('[HawkeyeBrain] MegaBrain unavailable, local fallback:',err.message);
        var fv=hits.some(function(h){return h.severity==='critical';})?'escalate':hits.some(function(h){return h.severity==='high';})?'review':'monitor';
        return{verdict:fv,confidence:0.6,fallback:true,fallbackReason:err.message,typologyPreScan:{hits:hits,summary:window.__brainTypology.summarize(hits)},requiresHumanReview:true,timestamp:now()};
      });
  };
  window.__brainAnalyze.version=V;

  /* ── SECTION 9: MULTI-MODEL ORCHESTRATION ────────────────────────────── */
  window.__brainOrchestrate=function(input){
    if(!input)return Promise.reject(new Error('input required'));
    return sf(EP.orchestrate,{method:'POST',headers:hdrs(),body:JSON.stringify(Object.assign({},input,{orchestrationMode:input.orchestrationMode||'consensus',models:input.models||['claude','gemini'],requestedAt:now()}))}).catch(function(){return null;});
  };
  window.__brainOrchestrate.version=V;

  /* ── SECTION 10: REGULATORY DRIFT WATCHDOG ───────────────────────────── */
  window.__brainRegulatoryDrift={
    version:V,lastCheckAt:null,lastDrift:null,
    check:function(){
      return sf(EP.drift,{method:'POST',headers:hdrs(),body:JSON.stringify({checkType:'full',requestedAt:now()})})
        .then(function(r){window.__brainRegulatoryDrift.lastCheckAt=now();window.__brainRegulatoryDrift.lastDrift=r;if(r&&r.driftDetected)window.__brainNotify({kind:'manual',severity:'high',summary:'Regulatory drift detected: '+(r.summary||'thresholds changed'),subject:'REGULATORY_DRIFT'});return r;})
        .catch(function(){return null;});
    },
    scheduleAutoCheck:function(){var self=this;self.check();setInterval(function(){self.check();},6*60*60*1000);},
  };

  /* ── SECTION 11: CLOSED-LOOP FEEDBACK LEARNING ───────────────────────── */
  window.__brainFeedbackLoop={
    version:V,
    record:function(entityId,resolution,details){
      details=details||{};
      window.__brainMemory.saveFeedback(entityId,resolution,details);
      if(typeof details.originalConfidence==='number'){
        var actual=(resolution==='str_filed'||resolution==='escalated')?1:0;
        get(IDB.calibration,'megabrain_pending').then(function(p){
          p=p||{modelId:'megabrain_pending',predictions:[],actuals:[]};
          p.predictions.push(details.originalConfidence);p.actuals.push(actual);
          if(p.predictions.length>=20){trainCal('megabrain',p.predictions,p.actuals);p.predictions=[];p.actuals=[];}
          put(IDB.calibration,p);
        }).catch(function(){});
      }
      var t=tok();if(t)fetch(EP.brain+'/feedback',{method:'POST',headers:hdrs(),body:JSON.stringify({entityId:entityId,resolution:resolution,details:details,timestamp:now()}),keepalive:true}).catch(function(){});
      window.__brainTelemetry&&window.__brainTelemetry.record({type:'feedback',entityId:entityId,resolution:resolution,originalVerdict:details.originalVerdict,timestamp:now()});
    },
  };

  /* ── SECTION 12: AUTONOMOUS AUTOPILOT DISPATCHER ─────────────────────── */
  window.__brainAutopilot={
    version:V,dispatchCount:0,
    dispatch:function(eid,decision){
      if(!decision||decision.requiresHumanReview||(decision.confidence||0)<0.85)return;
      var t=tok();if(!t)return;
      window.__brainAutopilot.dispatchCount++;
      fetch(EP.autopilot,{method:'POST',headers:hdrs(),body:JSON.stringify({entityId:eid,verdict:decision.verdict,confidence:decision.confidence,typologyHits:decision.typologyPreScan?decision.typologyPreScan.hits:[],provenance:decision._provenance,autoDispatch:true,startOn:'2026-05-01',timestamp:now()}),keepalive:true}).catch(function(){});
    },
    runFull:function(){return sf(EP.autopilot,{method:'POST',headers:hdrs(),body:JSON.stringify({mode:'full_scan',requestedAt:now()})}).catch(function(){return null;});},
  };

  /* ── SECTION 13: WAR ROOM EVENT BUS ──────────────────────────────────── */
  window.__brainWarRoom={
    version:V,_listeners:[],
    emit:function(event){
      event=Object.assign({},event,{emittedAt:now(),source:'brain-boot'});
      this._listeners.forEach(function(fn){try{fn(event);}catch(_){}});
      var t=tok();if(t)fetch(EP.warRoom,{method:'POST',headers:hdrs(),body:JSON.stringify(event),keepalive:true}).catch(function(){});
    },
    on:function(fn){if(typeof fn==='function')this._listeners.push(fn);},
    off:function(fn){this._listeners=this._listeners.filter(function(l){return l!==fn;});},
  };

  /* ── SECTION 14: TELEMETRY RECORDER ──────────────────────────────────── */
  window.__brainTelemetry={
    version:V,_buffer:[],_flushInterval:null,
    record:function(entry){
      entry=Object.assign({},entry,{telemetryId:uid(),recordedAt:now()});
      this._buffer.push(entry);
      put(IDB.telemetry,entry).catch(function(){});
      if(!this._flushInterval){var self=this;this._flushInterval=setInterval(function(){self.flush();},30000);}
    },
    flush:function(){
      if(!this._buffer.length)return;
      var batch=this._buffer.splice(0,50),t=tok();if(!t)return;
      fetch(EP.telemetry,{method:'POST',headers:hdrs(),body:JSON.stringify({entries:batch,flushedAt:now()}),keepalive:true}).catch(function(){this._buffer=batch.concat(this._buffer);}.bind(this));
    },
    getSummary:function(){return{bufferedEntries:this._buffer.length,version:V,timestamp:now()};},
  };

  /* ── SECTION 15: AI GOVERNANCE SELF-AUDIT ────────────────────────────── */
  window.__brainSelfAudit=function(opts){
    opts=opts||{};
    return sf(EP.selfAudit,{method:'POST',headers:hdrs(),body:JSON.stringify({triggeredBy:opts.triggeredBy||'manual',scope:opts.scope||'full',frameworks:opts.frameworks||['EU_AI_ACT','NIST_AI_RMF','ISO_42001','UAE_AI_CHARTER'],requestedAt:now()})})
      .then(function(r){window.__brainTelemetry&&window.__brainTelemetry.record({type:'self_audit',score:r&&r.overallScore,timestamp:now()});return r;})
      .catch(function(){return null;});
  };
  window.__brainSelfAudit.version=V;

  /* ── SECTION 16: BRAIN DIAGNOSTICS ───────────────────────────────────── */
  window.__brainDiagnostics=function(){
    return sf(EP.diagnostics,{method:'GET',headers:hdrs()})
      .then(function(r){return Object.assign({},r,{clientVersion:V,localMemoryAvailable:typeof indexedDB!=='undefined',typologyRuleCount:TR.length,calibrationCacheSize:Object.keys(_cal).length,warRoomListeners:window.__brainWarRoom?window.__brainWarRoom._listeners.length:0,telemetryBuffered:window.__brainTelemetry?window.__brainTelemetry._buffer.length:0,checkedAt:now()});})
      .catch(function(){return{status:'degraded',clientVersion:V,localMemoryAvailable:typeof indexedDB!=='undefined',typologyRuleCount:TR.length,checkedAt:now()};});
  };
  window.__brainDiagnostics.version=V;

  /* ── SECTION 17: BOOT SEQUENCE ───────────────────────────────────────── */
  (function boot(){
    odb().catch(function(){console.warn('[HawkeyeBrain] IndexedDB unavailable');});
    odb().then(function(){return get(IDB.calibration,'megabrain');}).then(function(c){if(c)_cal['megabrain']=c;}).catch(function(){});
    window.__brainRegulatoryDrift.scheduleAutoCheck();
    window.__HAWKEYE_BRAIN={
      version:V,installedAt:now(),
      endpoints:EP,
      capabilities:{typologyRules:TR.length,localMemory:typeof indexedDB!=='undefined',shapleyXAI:true,confidenceCalibration:true,closedLoopLearning:true,autonomousDispatch:true,regulatoryDriftWatch:true,warRoom:true,telemetry:true,selfAudit:true,multiModelOrchestration:true,zkComplianceProof:true,tippingOffProtection:true,fourEyesEnforcement:true},
      regulatoryBasis:['UAE FDL No.10/2025','Cabinet Resolution No.74/2020','Cabinet Resolution No.134/2025','FATF Rec 1,6,7,10,12,14,15,18,20,22,23','NIST AI RMF 1.0','EU AI Act 2024/1689','ISO/IEC 42001:2023','UAE AI Charter 2031','LBMA RGG v9','OECD Due Diligence Guidance','MoE Circular 08/AML/2021'],
    };
    console.info('[HawkeyeBrain v'+V+'] Super-Brain Boot Engine online. '+TR.length+' typology rules. Full autonomy mode active.');
  })();

})();
