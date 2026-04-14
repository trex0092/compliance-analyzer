// ======= CDN AVAILABILITY GUARDS =======
function requireJsPDF() {
  if (!window.jspdf) { toast('PDF library not loaded — check your internet connection and reload.', 'error', 5000); return null; }
  return window.jspdf;
}
function requireChart() {
  if (!window.Chart) { toast('Chart library not loaded — check your internet connection and reload.', 'error', 5000); return null; }
  return window.Chart;
}
// ======= DELEGATED EVENT HELPERS =======
// These named functions replace complex multi-statement inline onclick handlers
// so that data-action delegation can reference them by name.

/** Close the Asana task edit modal */
window._closeEditAsanaModal = function () {
  var el = document.getElementById('editAsanaTaskModal');
  if (el) el.classList.remove('open');
};

/** Connect Google Drive (prevents default on anchor click) */
window._connectGoogleDriveLink = function () {
  if (typeof connectGoogleDrive === 'function') connectGoogleDrive();
};

/** Copy board report to clipboard */
window._copyBoardReport = function () {
  var el = document.querySelector('#boardReportPreview .summary-box');
  if (el) {
    navigator.clipboard.writeText(el.textContent);
    if (typeof toast === 'function') toast('Copied', 'success');
  }
};

/** Open edit Asana task modal — reads data attributes for all 4 args */
window._openEditAsanaTaskFromEl = function () {
  // This is handled by the supplementary click delegation below
};

/** Format date input on typing (adapts oninput handler for data-input delegation) */
window._formatDateInput = function (e) {
  var el = e.target;
  if (typeof window.csFormatDateInput === 'function') window.csFormatDateInput(el);
  else if (typeof window.maFormatDateInput === 'function') window.maFormatDateInput(el);
};

/** Change user role from select (onchange with this.value via data-change) */
window._changeUserRoleFromSelect = function (e) {
  var el = e.target;
  var userId = el.getAttribute('data-user-id');
  if (typeof changeUserRole === 'function') changeUserRole(Number(userId), el.value);
};

/** Wrapper for raciColorChange that adapts event to element (data-change passes e) */
window._raciColorChangeFromEvent = function (e) {
  if (typeof raciColorChange === 'function') raciColorChange(e.target);
};

/** Change incident status from select (onchange with this.value via data-change) */
window._changeIncidentStatusFromSelect = function (e) {
  var el = e.target;
  var incidentId = el.getAttribute('data-incident-id');
  if (typeof changeIncidentStatus === 'function') changeIncidentStatus(Number(incidentId), el.value);
};

/**
 * Supplementary click delegation for actions that require element context.
 * The main app-events.js delegation passes (arg, arg2) strings. These actions
 * need the actual clicked element, so we handle them here with direct DOM access.
 */
document.addEventListener('click', function (e) {
  var target = e.target.closest('[data-action]');
  if (!target) return;
  var action = target.getAttribute('data-action');

  switch (action) {
    case '_connectGoogleDriveLink':
      e.preventDefault();
      if (typeof connectGoogleDrive === 'function') connectGoogleDrive();
      e.stopImmediatePropagation();
      break;
    case '_openEditAsanaTaskFromEl':
      if (typeof openEditAsanaTask === 'function') {
        openEditAsanaTask(
          target.getAttribute('data-gid') || '',
          target.getAttribute('data-task-name') || '',
          target.getAttribute('data-due') || '',
          target.getAttribute('data-assignee') || ''
        );
      }
      e.stopImmediatePropagation();
      break;
    case '_removeClosestTr':
      var tr = target.closest('tr');
      if (tr) tr.remove();
      e.stopImmediatePropagation();
      break;
    case '_removeParentElement':
      if (target.parentElement) target.parentElement.remove();
      e.stopImmediatePropagation();
      break;
    case '_toggleIncExpand':
      target.classList.toggle('inc-expand');
      e.stopImmediatePropagation();
      break;
    case '_copyClosestSummaryBox':
      var card = target.closest('.card');
      if (card) {
        var box = card.querySelector('.summary-box');
        if (box && typeof copyElText === 'function') copyElText(box);
      }
      e.stopImmediatePropagation();
      break;
    case '_openSafeUrlFromDataUrl':
      var url = target.getAttribute('data-url');
      if (url && typeof openSafeUrl === 'function') openSafeUrl(url);
      e.stopImmediatePropagation();
      break;
    case '_stopAndDeleteLocalShipment':
      e.stopPropagation();
      var shipId = target.getAttribute('data-arg');
      if (typeof deleteLocalShipment === 'function') deleteLocalShipment(Number(shipId));
      e.stopImmediatePropagation();
      break;
    case '_stopAndDeleteEmployee':
      e.stopPropagation();
      var empId = target.getAttribute('data-arg');
      if (typeof deleteEmployee === 'function') deleteEmployee(Number(empId));
      e.stopImmediatePropagation();
      break;
    case '_deleteUploadedFile':
      if (typeof deleteUploadedFile === 'function') {
        deleteUploadedFile(
          target.getAttribute('data-file-key') || '',
          target.getAttribute('data-file-name') || ''
        );
      }
      e.stopImmediatePropagation();
      break;
    case '_removeGenericAttachment':
      if (typeof removeGenericAttachment === 'function') {
        removeGenericAttachment(
          target.getAttribute('data-store-key') || '',
          Number(target.getAttribute('data-attach-id')),
          target.getAttribute('data-arr-name') || '',
          target.getAttribute('data-render-fn') || ''
        );
      }
      e.stopImmediatePropagation();
      break;
    case '_removeCProgAttachment':
      if (typeof removeCProgAttachment === 'function') {
        removeCProgAttachment(
          target.getAttribute('data-section') || '',
          Number(target.getAttribute('data-attach-id'))
        );
      }
      e.stopImmediatePropagation();
      break;
    case '_addPreloadedDeadline':
      if (typeof addPreloadedDeadline === 'function') {
        addPreloadedDeadline(
          target.getAttribute('data-title') || '',
          target.getAttribute('data-category') || '',
          Number(target.getAttribute('data-month') || 0),
          Number(target.getAttribute('data-day') || 0)
        );
      }
      e.stopImmediatePropagation();
      break;
    case '_editDefinition':
      if (typeof editDefinition === 'function') {
        editDefinition(
          target.getAttribute('data-section') || '',
          target.getAttribute('data-term') || ''
        );
      }
      e.stopImmediatePropagation();
      break;
    case '_downloadStrDraft':
      if (typeof downloadStrDraft === 'function') {
        downloadStrDraft(target.getAttribute('data-name') || '');
      }
      e.stopImmediatePropagation();
      break;
  }
});

// ======= STATE =======
var ANTHROPIC_KEY = '';
var ASANA_TOKEN = '';
var PROXY_URL = '';
// Detect billing/credit errors from error object or message string
function isBillingError(e) {
  if (e && e.isBillingError) return true;
  var m = (e && (e.message || '')).toLowerCase();
  return m.includes('credit') || m.includes('balance') || m.includes('billing') || m.includes('insufficient') || m.includes('quota') || m.includes('payment');
}
var SCHEDULE_EMAIL = '';
var OPENAI_KEY = '';
var NOTION_TOKEN = ''; // removed — use Asana
var NOTION_DB_ID = ''; // removed — use Asana
var CLICKUP_TOKEN = ''; // removed — use Asana
var CLICKUP_LIST_ID = ''; // removed — use Asana
var GEMINI_KEY = '';
var COPILOT_KEY = ''; // GitHub Copilot / GitHub Models API token
var TAVILY_KEY = '';
var HAWKEYE_BRAIN_TOKEN_VALUE = ''; // Brain Console toast stream auth (Tier-3 #10)
var GDRIVE_CLIENT_ID = '';
var GDRIVE_FOLDER_ID = '';
var gdriveAccessToken = '';
var AI_PROVIDER = 'gemini'; // 'claude', 'openai', 'gemini', 'copilot', or 'mixed'

// ─── Server-Side Auth Bridge ────────────────────────────────────────────────
// Wraps calls to the server-side /api/auth/* endpoints. Falls back to
// client-side auth (AuthRBAC) when server auth is unavailable.
var ServerAuth = {
  _token: null,
  _user: null,
  isAvailable: function() { return true; }, // server-side auth is always available on Netlify

  login: async function(username, password) {
    try {
      var res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
      });
      var data = await res.json();
      if (data.success && data.token) {
        ServerAuth._token = data.token;
        ServerAuth._user = data.user;
        sessionStorage.setItem('fgl_server_token', data.token);
        return data;
      }
      throw new Error(data.error || 'Login failed');
    } catch (e) {
      // Fall back to client-side auth if server endpoint not deployed yet
      if (e.message && e.message.includes('Failed to fetch')) {
        console.warn('[ServerAuth] Server auth unavailable, falling back to client-side');
        return null;
      }
      throw e;
    }
  },

  register: async function(username, password, displayName) {
    var res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password, displayName: displayName })
    });
    return res.json();
  },

  validate: async function() {
    var token = ServerAuth._token || sessionStorage.getItem('fgl_server_token');
    if (!token) return null;
    try {
      var res = await fetch('/api/auth/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token })
      });
      var data = await res.json();
      if (data.valid) {
        ServerAuth._token = token;
        ServerAuth._user = data.user;
        return data.user;
      }
    } catch (e) { /* server auth unavailable */ }
    ServerAuth._token = null;
    sessionStorage.removeItem('fgl_server_token');
    return null;
  },

  getToken: function() { return ServerAuth._token || sessionStorage.getItem('fgl_server_token') || ''; },
  getUser: function() { return ServerAuth._user; }
};

// ─── AI Proxy Bridge ────────────────────────────────────────────────────────
// Routes AI API calls through the server-side /api/ai-proxy when no local
// API keys are configured. This keeps keys in server env vars.
async function aiProxyCall(provider, path, payload, stream) {
  var token = ServerAuth.getToken();
  var res = await fetch('/api/ai-proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({ provider: provider, path: path, payload: payload, stream: !!stream })
  });
  if (!res.ok) {
    var errData = {};
    try { errData = await res.json(); } catch(_) {}
    throw new Error(errData.error || ('AI proxy returned ' + res.status));
  }
  return res.json();
}

// Provider health tracking for mixed mode — skip providers that are failing
var _providerHealth = { claude: { ok: true, failedAt: 0 }, gemini: { ok: true, failedAt: 0 }, copilot: { ok: true, failedAt: 0 } };
var PROVIDER_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes before retrying a failed provider
var lastResult = null;
var lastQuery = '';
var lastArea = '';
var REMEMBER_KEYS = false;
const ASANA_PROJECT_MAP = {
  'company-1': { compliance: '1213825539896477', workflow: '1213825580399850', nameMatch: 'MADISON' },
  'company-2': { compliance: '1213825365472836', workflow: '1213825542010518', nameMatch: 'NAPLES' },
  'company-3': { compliance: '1213838252710765', workflow: '1213825541970651', nameMatch: 'GRAMALTIN' },
  'company-4': { compliance: '1213825578259027', workflow: '1213825580398407', nameMatch: 'ZOE' },
  'company-5': { compliance: '1213900474912902', workflow: '1213759768596515', nameMatch: 'FG LLC' },
  'company-6': { compliance: '1213900370769721', workflow: '1213899469870046', nameMatch: 'FG BRANCH' }
};
// Auto-resolve project GIDs from Asana workspace (runs once on connect)
var _asanaProjectsResolved = false;
async function resolveAsanaProjectGIDs() {
  if (_asanaProjectsResolved || (!ASANA_TOKEN && !PROXY_URL)) return;
  try {
    const r = await asanaFetch('/projects?workspace=' + ASANA_WORKSPACE + '&opt_fields=name,archived&limit=100');
    const data = await r.json();
    if (!data.data) return;
    const projects = data.data.filter(p => !p.archived);
    for (const compId in ASANA_PROJECT_MAP) {
      const entry = ASANA_PROJECT_MAP[compId];
      const nameKey = entry.nameMatch;
      if (!nameKey) continue;
      const complianceProj = projects.find(p => p.name.includes(nameKey) && p.name.includes('COMPLIANCE PROGRAMME'));
      const trainingProj = projects.find(p => p.name.includes(nameKey) && p.name.includes('TRAINING'));
      if (complianceProj) entry.compliance = complianceProj.gid;
      if (trainingProj) entry.workflow = trainingProj.gid;
      if (!trainingProj && complianceProj) entry.workflow = complianceProj.gid;
    }
    _asanaProjectsResolved = true;
  } catch(_) {}
}
function getAsanaProject() {
  const entry = ASANA_PROJECT_MAP[activeCompanyId] || ASANA_PROJECT_MAP['company-5'];
  return entry.workflow;
}
function getAsanaComplianceProject() {
  const entry = ASANA_PROJECT_MAP[activeCompanyId] || ASANA_PROJECT_MAP['company-5'];
  return entry.compliance;
}
const ASANA_WORKSPACE = '1213645083721316';
const KEYS_STORAGE = 'fgl_keys';
const SHIPMENTS_STORAGE = 'fgl_shipments';
const ALERTS_STORAGE = 'fgl_alerts';
const EMAIL_TEST_STATUS_STORAGE = 'fgl_email_test_status';
const COMPLIANCE_OPS_STORAGE = 'fgl_compliance_ops';
const ASANA_SYNC_STORAGE = 'fgl_asana_sync';
const COMPANY_PROFILES_STORAGE = 'fgl_company_profiles';
const ACTIVE_COMPANY_STORAGE = 'fgl_active_company';
const TRAINING_STORAGE = 'fgl_employee_training';

// Keys that are GLOBAL (shared across all companies — settings/credentials)
const GLOBAL_KEYS = new Set([
  KEYS_STORAGE, ALERTS_STORAGE, EMAIL_TEST_STATUS_STORAGE,
  ASANA_SYNC_STORAGE, COMPANY_PROFILES_STORAGE, ACTIVE_COMPANY_STORAGE
]);
// All other keys are automatically company-scoped
function scopeKey(key) {
  if (GLOBAL_KEYS.has(key)) return key;
  if (typeof activeCompanyId === 'string' && activeCompanyId) return key + '__' + activeCompanyId;
  return key;
}
const TRAINING_SUBJECT_CATALOG = [
  'AML/CFT Legal Framework and Law Transition Awareness',
  'Ethical Conduct, Compliance Culture and Individual Accountability',
  'Targeted Financial Sanctions (TFS) and Screening',
  'Source of Funds (SOF) and Source of Wealth (SOW) Verification',
  'Proliferation Financing (PF) Awareness and Control Measures',
  'Customer Due Diligence (CDD) and Onboarding Controls',
  'Third-Party, Agent and Supplier Due Diligence (KYS)',
  'Risk-Based Approach (RBA) and NRA Alignment',
  'Politically Exposed Persons (PEP) and Ultimate Beneficial Owner (UBO) Identification',
  'Tipping Off: Prohibition and Obligations',
  'Senior Management and Governance Responsibilities',
  'Role-Based AML/CFT Responsibilities',
  'Responsible Sourcing and Supply Chain Due Diligence',
  'Ethical Sourcing Framework for Precious Metals',
  'Responsible Mining and Cultural Heritage Protection',
  'Enhanced Due Diligence (EDD) and High-Risk Countries',
  'AI Governance, Ethics, and Human Oversight in Compliance (Cabinet Res 134/2025 Art.24)',
  'UAE FIU DPMS Sector Typologies and Emerging ML/TF/PF Indicators (2025 Guidance)',
  'Transaction Monitoring and Red Flag Identification',
  'Internal Escalation, Whistleblowing and Protection Mechanisms',
  'Understanding Risk Assessments (BWRA and EWRA)',
  'Suspicious Transaction Reporting (STR) and Audit Readiness',
  'DPMS Reporting and Regulatory Obligations',
  'Beneficial Ownership and Complex Structures',
  'Data Retention, Record Keeping and Data Destruction',
  'Use of Artificial Intelligence (AI) in Compliance',
  'Employee Screening, Fit and Proper Standards (KYE)',
  'Grievance Mechanisms and Whistleblower Policy',
  'Independent AML/CFT Audit and Remediation Tracking',
  'Remuneration Practices, Traceability and Non-Retaliation Policy',
  'AML/CFT Year-End Review, ESG Performance and Continuous Improvement',
  'Training Effectiveness Review and Management Attestation',
  'GOAML Registration - what it is, required documents, and submission timelines',
  'Tax Evasion Risks and Typologies - under-reporting, false invoicing, use of shell or offshore entities, unexplained wealth indicators, manipulation of import/export values',
  'Corporate Responsibility and Human Rights - OECD risk identification regarding social harms and UN Guiding Principles on Business and Human Rights',
  'International Efforts to Fight ML/TF - FATF Recommendations, LBMA guidelines, OECD guidelines, and MOE Regulations as a consolidated foundational overview',
  'ML/TF Foundational Concepts - definitions and the three stages of money laundering (placement, layering, integration) and conceptual distinctions between ML, TF, and PF',
  'Anti-Corruption and Bribery Prevention - forms of bribery, forms of corruption, facilitation payments, gifts and hospitality policy, conflict of interest, and staff reporting obligations',
  'Gender Equality and Women\'s Empowerment - UAE legal framework on gender equality, equal pay, boardroom inclusion, anti-trafficking, and policy commitments',
  'Responsible Chemical Management in Supply Chain - mercury prohibition, Minamata Convention, International Cyanide Management Code, AML/CFT classification of Chloroauric Acid Solution and Potassium Dicyanoaurate as Non-Listed High-Risk Materials requiring EDD, and associated control obligations',
  'Confidentiality and Information Security Policy - restricted access to sensitive data, controlled disclosure of STR/SAR information, prohibited use of personal devices or unauthorized platforms, breach reporting obligations, and secure disposal of confidential records',
  'Code of Conduct, Professional Ethics and Human Rights Policy - human rights obligations, business integrity standards, labor and employment standards, environmental responsibility, supply chain responsibility, community engagement, data privacy, and implementation framework',
  'LBMA Responsible Gold Guidance v9 — 5-Step Framework and Compliance Requirements',
  'OECD Due Diligence Guidance for Responsible Supply Chains of Minerals from CAHRAs',
  'Conflict-Affected and High-Risk Areas (CAHRA) Identification and Mapping',
  'Artisanal and Small-Scale Mining (ASM) Due Diligence and Red Flags',
  'Gold Assaying, Hallmarking and Purity Verification Standards',
  'Responsible Sourcing: LBMA RGG, OECD DDG, DMCC, DGD, RMI Standards',
  'Dubai Multi Commodities Centre (DMCC) Rules and Regulations',
  'UAE Ministry of Economy (MOE) DPMS Supervisory Framework and Inspection Process',
  'goAML Portal — System Navigation, STR Filing and Report Submission',
  'Sanctions Lists Management — UN, OFAC, EU, UK, UAE Local Lists',
  'FATF Mutual Evaluation Process and UAE National Risk Assessment (NRA)',
  'FATF Grey List / Black List — Implications and Required Actions for DPMS',
  'Correspondent Banking Relationships and De-Risking Impact on DPMS',
  'Trade-Based Money Laundering (TBML) — Typologies and Detection in Precious Metals',
  'Cash Courier and Cross-Border Transportation of Gold — Declaration Requirements',
  'Free Trade Zone Compliance — JAFZA, DAFZA, DMCC Regulatory Requirements',
  'Customer Risk Profiling and Segmentation Methodology',
  'Ongoing Customer Monitoring and Trigger Events for Re-Assessment',
  'Shell Companies, Nominee Arrangements and Layered Ownership Structures',
  'EU Conflict Minerals Regulation and OECD Due Diligence for Precious Metals',
  'Environmental, Social and Governance (ESG) in Precious Metals Industry',
  'Refinery Operations — Chain of Custody and Material Traceability',
  'Import/Export Documentation — Customs Declarations, Certificates of Origin',
  'Insurance and Logistics Compliance for Precious Metals Shipments',
  'Business Continuity and Disaster Recovery for Compliance Functions',
  'Regulatory Change Management — Monitoring, Impact Assessment, Implementation',
  'Internal Controls Testing and Compliance Programme Effectiveness Review',
  'Board and Audit Committee AML/CFT Oversight Responsibilities',
  'MLRO Role, Responsibilities and Annual Reporting Requirements',
  'Compliance Programme Documentation and MOE Inspection File Preparation',
  'Financial Crime Risk in Jewellery Retail — Point of Sale Red Flags',
  'High-Value Dealer Obligations — AED 55,000 Threshold and Cash Reporting',
  'Structuring and Smurfing Detection in Precious Metals Transactions',
  'Hawala and Informal Value Transfer Systems — Recognition and Reporting',
  'Cybersecurity Fundamentals for Compliance Staff',
  'Social Engineering and Fraud Prevention Awareness',
  'UAE Personal Data Protection Law (PDPL) — Compliance Requirements',
  'Cross-Border Wire Transfer Rules and Originator/Beneficiary Information',
  'Compliance Technology — Screening Tools, Case Management, Analytics'
];

function safeLocalParse(key, fallback) {
  try {
    const sk = scopeKey(key);
    const raw = localStorage.getItem(sk);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}
function safeLocalSave(key, value) {
  try { localStorage.setItem(scopeKey(key), JSON.stringify(value)); }
  catch(e) { if (e.name==='QuotaExceededError'||e.code===22) { console.error('[Storage] Quota exceeded for key:',key); toast('Storage full — please export and clear old data','error',5000); } else { throw e; } }
}
function safeLocalRemove(key) {
  localStorage.removeItem(scopeKey(key));
}

function normaliseProxyUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return '';
    return u.toString().replace(/\/+$/, '');
  } catch (_) {
    return '';
  }
}

function createDefaultCompanyProfiles() {
  return [
    { id: 'company-1', name: 'MADISON JEWELLERY TRADING L.L.C', activity: 'Jewellery Trading', location: 'Dubai, UAE' },
    { id: 'company-2', name: 'NAPLES JEWELLERY TRADING L.L.C', activity: 'Jewellery Trading', location: 'Dubai, UAE' },
    { id: 'company-3', name: 'GRAMALTIN KIYMETLI MADENLER RAFINERI SANAYI VE TICARET ANONIM SIRKETI', activity: 'Precious Metal Refining & Trading', location: 'Sharjah, UAE' },
    { id: 'company-4', name: 'ZOE Precious Metals and Jewelery (FZE)', activity: 'Precious Metals and Jewelery', location: 'Sharjah, UAE' },
    { id: 'company-5', name: 'FINE GOLD LLC', activity: 'Non-Manufactured Precious Metal Trading', location: 'Dubai, UAE' },
    { id: 'company-6', name: 'FINE GOLD (BRANCH)', activity: 'Non-Manufactured Precious Metal Trading', location: 'Sharjah, UAE' }
  ].map((c) => ({
    id: c.id,
    name: c.name,
    activity: c.activity || '',
    location: c.location || 'Dubai, UAE',
    links: { website: '', asana: '', drive: '', registry: '', portal: '' }
  }));
}

function getDefaultAlertSettings() {
  return { browserEnabled: true, emailEnabled: false, hourlyReminderEnabled: true, lastHourlyReminderTs: '', emails: [], ejsServiceId: '', ejsTemplateId: '', ejsPublicKey: '' };
}

function getDefaultEmailTestStatus() {
  return { ok: null, ts: '', detail: '' };
}

function getDefaultAsanaSyncState() {
  return {
    modules: {
      tasks: { status: 'Idle', lastSuccess: '', lastError: '', lastCount: 0 },
      shipments: { status: 'Idle', lastSuccess: '', lastError: '', lastCount: 0 },
      evidence: { status: 'Idle', lastSuccess: '', lastError: '', lastCount: 0 },
      writeback: { status: 'Idle', lastSuccess: '', lastError: '', lastCount: 0 }
    },
    retryQueue: [],
    conflicts: []
  };
}

let companyProfiles = safeLocalParse(COMPANY_PROFILES_STORAGE, createDefaultCompanyProfiles());
if (!Array.isArray(companyProfiles) || companyProfiles.length < 6) companyProfiles = createDefaultCompanyProfiles();
let activeCompanyId = safeLocalParse(ACTIVE_COMPANY_STORAGE, 'company-1');
if (typeof activeCompanyId !== 'string' || !companyProfiles.find(c => c.id === activeCompanyId)) activeCompanyId = companyProfiles[0].id;

function getActiveCompany() {
  return companyProfiles.find(c => c.id === activeCompanyId) || companyProfiles[0];
}

function getCompanyStorageKey(baseKey) {
  return `${baseKey}__${activeCompanyId}`;
}

function safeScopedParse(baseKey, fallback) {
  return safeLocalParse(getCompanyStorageKey(baseKey), fallback);
}

function setScopedJson(baseKey, value) {
  localStorage.setItem(getCompanyStorageKey(baseKey), JSON.stringify(value));
}

function removeScopedJson(baseKey) {
  localStorage.removeItem(getCompanyStorageKey(baseKey));
}

function persistCompanyProfiles() {
  localStorage.setItem(COMPANY_PROFILES_STORAGE, JSON.stringify(companyProfiles));
  localStorage.setItem(ACTIVE_COMPANY_STORAGE, JSON.stringify(activeCompanyId));
}

let evidenceData = safeLocalParse('fgl_evidence', {});
let schedules = safeLocalParse('fgl_schedules', []);
let history = safeLocalParse('fgl_history', []);
let employeeTraining = safeLocalParse(TRAINING_STORAGE, []);
let shipments = safeScopedParse(SHIPMENTS_STORAGE, []);
window.shipments = shipments;
let alertSettings = safeLocalParse(ALERTS_STORAGE, getDefaultAlertSettings());
let emailTestStatus = safeLocalParse(EMAIL_TEST_STATUS_STORAGE, getDefaultEmailTestStatus());
let editingShipmentId = null;
let metalsLastUpdated = null;
let metalsFetchInFlight = false;
let reminderTimer = null;
let proxyFallbackNotified = false;
let asanaAutoRefreshTimer = null;
const REMINDER_INTERVAL_MS = 30 * 60 * 1000;
const ASANA_AUTO_REFRESH_MS = 20 * 60 * 1000;

let asanaSyncState = safeLocalParse(ASANA_SYNC_STORAGE, getDefaultAsanaSyncState());

function buildTrainingEmployeeKey(employeeName, department) {
  return `${String(employeeName || '').trim().toLowerCase()}::${String(department || '').trim().toLowerCase()}`;
}

function normalizeEmployeeTrainingRecords(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  const map = new Map();
  rows.forEach((r) => {
    if (!r || typeof r !== 'object') return;
    if (r.subjects && typeof r.subjects === 'object' && r.employeeName) {
      const key = buildTrainingEmployeeKey(r.employeeName, r.department);
      if (!key || key === '::') return;
      if (!map.has(key)) {
        map.set(key, {
          id: String(r.id || `et-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
          employeeName: String(r.employeeName || '').trim(),
          department: String(r.department || '').trim(),
          totalTrainings: Number.isFinite(Number(r.totalTrainings)) ? Math.max(0, Math.floor(Number(r.totalTrainings))) : TRAINING_SUBJECT_CATALOG.length,
          subjects: Object.assign({}, r.subjects),
          updatedAt: String(r.updatedAt || '')
        });
      } else {
        const existing = map.get(key);
        existing.subjects = Object.assign({}, existing.subjects, r.subjects);
        existing.totalTrainings = Math.max(existing.totalTrainings, Number.isFinite(Number(r.totalTrainings)) ? Math.max(0, Math.floor(Number(r.totalTrainings))) : 0);
        existing.updatedAt = String(r.updatedAt || existing.updatedAt || '');
      }
      return;
    }

    const employeeName = String(r.employeeName || '').trim();
    const department = String(r.department || '').trim();
    const subject = String(r.subject || '').trim();
    const key = buildTrainingEmployeeKey(employeeName, department);
    if (!employeeName || !department || !subject || !key || key === '::') return;
    if (!map.has(key)) {
      map.set(key, {
        id: `et-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        employeeName,
        department,
        totalTrainings: Number.isFinite(Number(r.totalTrainings)) ? Math.max(0, Math.floor(Number(r.totalTrainings))) : TRAINING_SUBJECT_CATALOG.length,
        subjects: {},
        updatedAt: ''
      });
    }
    const entry = map.get(key);
    entry.subjects[subject] = !!r.completed;
    entry.totalTrainings = Math.max(entry.totalTrainings, Number.isFinite(Number(r.totalTrainings)) ? Math.max(0, Math.floor(Number(r.totalTrainings))) : 0);
    entry.updatedAt = new Date().toISOString();
  });

  return Array.from(map.values())
    .sort((a, b) => String(a.employeeName || '').localeCompare(String(b.employeeName || '')))
    .map((x) => ({
      id: x.id,
      employeeName: x.employeeName,
      department: x.department,
      totalTrainings: x.totalTrainings || TRAINING_SUBJECT_CATALOG.length,
      subjects: x.subjects || {},
      updatedAt: x.updatedAt || ''
    }));
}

employeeTraining = normalizeEmployeeTrainingRecords(employeeTraining);

function loadScopedCompanyState() {
  shipments = safeScopedParse(SHIPMENTS_STORAGE, []);
  window.shipments = shipments;
  // Reload all company-scoped data for the newly active company
  employeeTraining = safeLocalParse(TRAINING_STORAGE, []);
  evidenceData = safeLocalParse('fgl_evidence', {});
  schedules = safeLocalParse('fgl_schedules', []);
  history = safeLocalParse('fgl_history', []);
  // Re-render all tabs that display company-scoped data
  const initModules = [
    ['Screening', loadScreeningHistory],
    ['Onboarding', renderOnboardingList],
    ['Incidents', renderIncidents],
    ['Deadlines', renderDeadlines],
    ['Vault', renderVaultDocs],
    ['Dashboard', refreshDashboard],
    ['Definitions', renderDefinitions],
    ['TFS', () => { if (typeof TFSRefresh !== 'undefined' && TFSRefresh.refresh) TFSRefresh.refresh(); }],
    ['Reports', () => { if (typeof ReportGenerator !== 'undefined' && ReportGenerator.renderReportTab) ReportGenerator.renderReportTab(); }]
  ];
  initModules.forEach(([name, fn]) => {
    try { fn(); } catch(e) { console.warn(`[Init] ${name} module failed:`, e.message); }
  });
}

function persistAsanaSyncState() {
  localStorage.setItem(ASANA_SYNC_STORAGE, JSON.stringify(asanaSyncState));
}

function ensureAsanaSyncStateShape() {
  const defaults = {
    tasks: { status: 'Idle', lastSuccess: '', lastError: '', lastCount: 0 },
    shipments: { status: 'Idle', lastSuccess: '', lastError: '', lastCount: 0 },
    evidence: { status: 'Idle', lastSuccess: '', lastError: '', lastCount: 0 },
    writeback: { status: 'Idle', lastSuccess: '', lastError: '', lastCount: 0 }
  };
  asanaSyncState.modules = asanaSyncState.modules && typeof asanaSyncState.modules === 'object' ? asanaSyncState.modules : {};
  Object.keys(defaults).forEach((key) => {
    asanaSyncState.modules[key] = Object.assign({}, defaults[key], asanaSyncState.modules[key] || {});
  });
  asanaSyncState.retryQueue = Array.isArray(asanaSyncState.retryQueue) ? asanaSyncState.retryQueue : [];
  asanaSyncState.conflicts = Array.isArray(asanaSyncState.conflicts) ? asanaSyncState.conflicts : [];
}

function setAsanaModuleSync(moduleName, patch) {
  ensureAsanaSyncStateShape();
  asanaSyncState.modules[moduleName] = Object.assign({}, asanaSyncState.modules[moduleName] || {}, patch || {});
  persistAsanaSyncState();
  renderAsanaSyncOverview();
}

function queueAsanaRetry(entry) {
  ensureAsanaSyncStateShape();
  asanaSyncState.retryQueue.unshift(Object.assign({
    id: `retry-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    ts: new Date().toISOString()
  }, entry || {}));
  asanaSyncState.retryQueue = asanaSyncState.retryQueue.slice(0, 40);
  persistAsanaSyncState();
  renderAsanaSyncOverview();
}

function recordAsanaConflict(conflict) {
  ensureAsanaSyncStateShape();
  asanaSyncState.conflicts.unshift(Object.assign({ ts: new Date().toISOString() }, conflict || {}));
  asanaSyncState.conflicts = asanaSyncState.conflicts.slice(0, 20);
  persistAsanaSyncState();
  renderAsanaSyncOverview();
}

function formatSyncTs(ts) {
  if (!ts) return 'never';
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return 'never';
  return d.toLocaleString('en-AE', { timeZone: 'Asia/Dubai', dateStyle: 'short', timeStyle: 'short' });
}

function renderAsanaSyncOverview() {
  ensureAsanaSyncStateShape();
  const wrap = document.getElementById('asanaSyncOverview');
  const evidenceMeta = document.getElementById('evidenceSyncMeta');
  const tasks = asanaSyncState.modules.tasks;
  const evidenceModule = asanaSyncState.modules.evidence;
  const writebackModule = asanaSyncState.modules.writeback;
  const retryCount = asanaSyncState.retryQueue.length;
  const conflictCount = asanaSyncState.conflicts.length;
  if (wrap) {
    wrap.innerHTML = `
      <div class="row" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
        <div class="price-cell"><div class="price-head"><span class="price-sym">TASKS</span><span class="sync-status ${tasks.status === 'Healthy' ? 'sync-ok' : tasks.status === 'Error' ? 'sync-failed' : 'sync-pending'}">${escHtml(tasks.status)}</span></div><div class="price-sub">Last success: ${escHtml(formatSyncTs(tasks.lastSuccess))}</div></div>
        <div class="price-cell"><div class="price-head"><span class="price-sym">EVIDENCE</span><span class="sync-status ${evidenceModule.status === 'Healthy' ? 'sync-ok' : evidenceModule.status === 'Error' ? 'sync-failed' : 'sync-pending'}">${escHtml(evidenceModule.status)}</span></div><div class="price-sub">Last success: ${escHtml(formatSyncTs(evidenceModule.lastSuccess))}</div></div>
        <div class="price-cell"><div class="price-head"><span class="price-sym">WRITE-BACK</span><span class="sync-status ${writebackModule.status === 'Healthy' ? 'sync-ok' : writebackModule.status === 'Conflict' || writebackModule.status === 'Error' ? 'sync-failed' : 'sync-pending'}">${escHtml(writebackModule.status)}</span></div><div class="price-sub">Retries: ${retryCount} | Conflicts: ${conflictCount}</div></div>
      </div>
      <div class="token-note">Auto-refresh every 20 minutes while the page is open. Failed writes are queued and retried automatically.</div>
      ${tasks.lastError && tasks.status === 'Error' ? '<div style="color:var(--amber);font-size:12px;margin-top:6px">Asana: ' + escHtml('Could not connect — check your Asana token in Settings') + '</div>' : ''}`;
  }
  if (evidenceMeta) evidenceMeta.textContent = `Evidence sync: ${evidenceModule.status} | Last ${formatSyncTs(evidenceModule.lastSuccess)}`;
}

function normaliseAlertEmails(values) {
  const list = Array.isArray(values) ? values : [];
  const seen = new Set();
  const clean = [];
  list.forEach(v => {
    const email = String(v || '').trim();
    if (!email) return;
    const key = email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    clean.push(email);
  });
  return clean;
}

if (!Array.isArray(alertSettings.emails)) {
  const legacyEmail = String(alertSettings.email || '').trim();
  alertSettings.emails = legacyEmail ? [legacyEmail] : [];
}
alertSettings.emails = normaliseAlertEmails(alertSettings.emails);
alertSettings.hourlyReminderEnabled = !!alertSettings.hourlyReminderEnabled;
alertSettings.lastHourlyReminderTs = String(alertSettings.lastHourlyReminderTs || '');

// ======= TOAST =======
function toast(msg, type='info', dur=3000) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `toast show ${type}`;
  setTimeout(() => t.className = 'toast', dur);
}

function clearAppData() {
  if (!confirm('This will clear app saved data on this browser. Continue?')) return;
  [KEYS_STORAGE, ALERTS_STORAGE, EMAIL_TEST_STATUS_STORAGE, COMPLIANCE_OPS_STORAGE, ASANA_SYNC_STORAGE, 'fgl_evidence', 'fgl_schedules', 'fgl_history'].forEach(k => localStorage.removeItem(k));
  companyProfiles.forEach((c) => localStorage.removeItem(`${SHIPMENTS_STORAGE}__${c.id}`));
  toast('App data cleared','info');
}

// ======= SETUP =======
function persistKeys() {
  if (!REMEMBER_KEYS) {
    localStorage.setItem(KEYS_STORAGE, JSON.stringify({ proxyUrl: PROXY_URL, asanaToken: ASANA_TOKEN, aiProvider: AI_PROVIDER, gdriveFolderId: GDRIVE_FOLDER_ID, gdriveClientId: GDRIVE_CLIENT_ID, rememberKeys: false }));
    return;
  }

  localStorage.setItem(KEYS_STORAGE, JSON.stringify({
    anthropicKey: ANTHROPIC_KEY,
    openaiKey: OPENAI_KEY,
    geminiKey: GEMINI_KEY,
    copilotKey: COPILOT_KEY,
    aiProvider: AI_PROVIDER,
    asanaToken: ASANA_TOKEN,
    scheduleEmail: SCHEDULE_EMAIL,
    proxyUrl: PROXY_URL,
    tavilyKey: TAVILY_KEY,
    hawkeyeBrainToken: HAWKEYE_BRAIN_TOKEN_VALUE,
    gdriveClientId: GDRIVE_CLIENT_ID,
    gdriveFolderId: GDRIVE_FOLDER_ID,
    rememberKeys: REMEMBER_KEYS
  }));
}

function syncRememberCheckboxes() {
  const r1 = document.getElementById('rememberKeys');
  const r2 = document.getElementById('rememberKeys2');
  if (r1) r1.checked = REMEMBER_KEYS;
  if (r2) r2.checked = REMEMBER_KEYS;
}

function setRememberKeys(enabled) {
  REMEMBER_KEYS = !!enabled;
  syncRememberCheckboxes();
  if (!REMEMBER_KEYS) {
    // Keep proxy URL persisted even when secret key persistence is disabled.
    persistKeys();
    toast('Key persistence disabled','info');
    return;
  }
  persistKeys();
  toast('Key persistence enabled','success');
}

function hydrateKeys() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEYS_STORAGE) || '{}'); } catch (_) { saved = {}; }
  REMEMBER_KEYS = saved.rememberKeys === true;
  ANTHROPIC_KEY = (saved.anthropicKey || '').trim();
  ASANA_TOKEN = (saved.asanaToken || '').trim();
  SCHEDULE_EMAIL = (saved.scheduleEmail || '').trim();
  PROXY_URL = normaliseProxyUrl(saved.proxyUrl || '');
  OPENAI_KEY = (saved.openaiKey || '').trim();
  GEMINI_KEY = (saved.geminiKey || '').trim();
  COPILOT_KEY = (saved.copilotKey || '').trim();
  TAVILY_KEY = (saved.tavilyKey || '').trim();
  HAWKEYE_BRAIN_TOKEN_VALUE = (saved.hawkeyeBrainToken || '').trim();
  // Inject into window so brain-console.js + toastStreamPoller.ts
  // pick it up without a page reload.
  if (HAWKEYE_BRAIN_TOKEN_VALUE) {
    window.HAWKEYE_BRAIN_TOKEN = HAWKEYE_BRAIN_TOKEN_VALUE;
  }
  GDRIVE_CLIENT_ID = (saved.gdriveClientId || '').trim();
  GDRIVE_FOLDER_ID = (saved.gdriveFolderId || '').trim();
  AI_PROVIDER = saved.aiProvider || 'gemini';
  // Auto-detect best provider if none was explicitly saved
  if (!saved.aiProvider) {
    if (GEMINI_KEY) AI_PROVIDER = 'gemini';
    else if (COPILOT_KEY) AI_PROVIDER = 'copilot';
    else if (ANTHROPIC_KEY) AI_PROVIDER = 'claude';
    else if (OPENAI_KEY) AI_PROVIDER = 'openai';
    // If multiple keys exist, prefer mixed mode
    var keyCount = [GEMINI_KEY, COPILOT_KEY, ANTHROPIC_KEY, OPENAI_KEY].filter(Boolean).length;
    if (keyCount >= 2) AI_PROVIDER = 'mixed';
  }

  const fieldMap = {
    anthropicKey: ANTHROPIC_KEY, anthropicKey2: ANTHROPIC_KEY,
    geminiKey2: GEMINI_KEY, openaiKey2: OPENAI_KEY, copilotKey2: COPILOT_KEY,
    asanaToken: ASANA_TOKEN, asanaToken2: ASANA_TOKEN,
    scheduleEmail: SCHEDULE_EMAIL, schedEmail2: SCHEDULE_EMAIL,
    proxyUrl: PROXY_URL, proxyUrl2: PROXY_URL,
    tavilyKey2: TAVILY_KEY,
    hawkeyeBrainToken2: HAWKEYE_BRAIN_TOKEN_VALUE,
    gdriveClientId: GDRIVE_CLIENT_ID, gdriveClientId2: GDRIVE_CLIENT_ID,
    gdriveFolderId: GDRIVE_FOLDER_ID, gdriveFolderId2: GDRIVE_FOLDER_ID,
  };
  for (const [id, val] of Object.entries(fieldMap)) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }
  // Set AI provider dropdown and show correct key section
  const providerSelect = document.getElementById('aiProvider2');
  if (providerSelect) {
    providerSelect.value = AI_PROVIDER;
    document.querySelectorAll('.ai-key-section').forEach(function(s) { s.style.display = 'none'; });
    if (AI_PROVIDER === 'mixed') {
      ['copilotKeySection','geminiKeySection','claudeKeySection'].forEach(function(id) { var el = document.getElementById(id); if (el) el.style.display = 'block'; });
    } else if (AI_PROVIDER === 'copilot') { var cps = document.getElementById('copilotKeySection'); if (cps) cps.style.display = 'block'; }
    else if (AI_PROVIDER === 'gemini') { var gs = document.getElementById('geminiKeySection'); if (gs) gs.style.display = 'block'; }
    else if (AI_PROVIDER === 'openai') { var os = document.getElementById('openaiKeySection'); if (os) os.style.display = 'block'; }
    else { var cs = document.getElementById('claudeKeySection'); if (cs) cs.style.display = 'block'; }
  }
  syncRememberCheckboxes();
}

function openMainPanel() {
  document.getElementById('setupPanel').style.display = 'none';
  document.getElementById('mainPanel').style.display = 'block';
  renderCompanySelectors();
  renderSchedules();
  renderHistory();
  renderEvidence();
  const today = new Date();
  today.setDate(today.getDate() + 7);
  document.getElementById('schedNextRun').value = today.toISOString().split('T')[0];
}

function saveSetup() {
  ANTHROPIC_KEY = document.getElementById('anthropicKey').value.trim();
  ASANA_TOKEN = document.getElementById('asanaToken').value.trim();
  SCHEDULE_EMAIL = document.getElementById('scheduleEmail')?.value?.trim() || '';
  PROXY_URL = normaliseProxyUrl(document.getElementById('proxyUrl')?.value || '');
  GDRIVE_CLIENT_ID = document.getElementById('gdriveClientId')?.value.trim() || '';
  GDRIVE_FOLDER_ID = document.getElementById('gdriveFolderId')?.value.trim() || '';
  REMEMBER_KEYS = !!document.getElementById('rememberKeys')?.checked;
  if (!ANTHROPIC_KEY && !PROXY_URL) { toast('No API key set — AI analysis disabled. Add a key in Settings anytime.','info',5000); }
  else if (ANTHROPIC_KEY && !PROXY_URL) { toast('⚠ Direct browser API access — use a Proxy URL for production security.','error',8000); }
  persistKeys();
  openMainPanel();
  startAsanaAutoRefresh();
  renderAsanaSyncOverview();
  toast('Analyzer ready','success');
}
function updateKeys() {
  if (document.getElementById('anthropicKey2').value.trim()) ANTHROPIC_KEY = document.getElementById('anthropicKey2').value.trim();
  if (document.getElementById('geminiKey2')?.value.trim()) GEMINI_KEY = document.getElementById('geminiKey2').value.trim();
  if (document.getElementById('openaiKey2')?.value.trim()) OPENAI_KEY = document.getElementById('openaiKey2').value.trim();
  if (document.getElementById('copilotKey2')?.value.trim()) COPILOT_KEY = document.getElementById('copilotKey2').value.trim();
  if (document.getElementById('aiProvider2')?.value) AI_PROVIDER = document.getElementById('aiProvider2').value;
  if (document.getElementById('asanaToken2').value.trim()) ASANA_TOKEN = document.getElementById('asanaToken2').value.trim();
  if (document.getElementById('gdriveClientId2')?.value.trim()) GDRIVE_CLIENT_ID = document.getElementById('gdriveClientId2').value.trim();
  if (document.getElementById('gdriveFolderId2')?.value.trim()) GDRIVE_FOLDER_ID = document.getElementById('gdriveFolderId2').value.trim();
  if (document.getElementById('proxyUrl2')?.value.trim()) PROXY_URL = normaliseProxyUrl(document.getElementById('proxyUrl2').value);
  if (document.getElementById('tavilyKey2')?.value.trim()) TAVILY_KEY = document.getElementById('tavilyKey2').value.trim();
  if (document.getElementById('hawkeyeBrainToken2')?.value.trim()) {
    HAWKEYE_BRAIN_TOKEN_VALUE = document.getElementById('hawkeyeBrainToken2').value.trim();
    // Inject into window immediately so the toast stream poller +
    // Brain Console probe pick it up without a reload.
    window.HAWKEYE_BRAIN_TOKEN = HAWKEYE_BRAIN_TOKEN_VALUE;
  }
  persistKeys();

  // Sync setup panel fields
  const syncMap = {
    anthropicKey: ANTHROPIC_KEY, asanaToken: ASANA_TOKEN, scheduleEmail: SCHEDULE_EMAIL,
    proxyUrl: PROXY_URL, openaiKey: OPENAI_KEY,
    geminiKey: GEMINI_KEY, copilotKey: COPILOT_KEY, tavilyKey: TAVILY_KEY,
    gdriveClientId: GDRIVE_CLIENT_ID, gdriveFolderId: GDRIVE_FOLDER_ID
  };
  for (const [id, val] of Object.entries(syncMap)) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }
  syncRememberCheckboxes();
  startAsanaAutoRefresh();
  renderAsanaSyncOverview();

  toast('Keys updated','success');
}

function initialiseApp() {
  var steps = [
    ['SyncState', ensureAsanaSyncStateShape],
    ['HydrateKeys', hydrateKeys],
    ['GDrive', handleGDriveCallback],
    ['Companies', renderCompanySelectors],
    ['Training', renderTrainingSubjectOptions],
    ['RememberKeys', function() {
      var r1 = document.getElementById('rememberKeys');
      var r2 = document.getElementById('rememberKeys2');
      if (r1) r1.addEventListener('change', function(e) { setRememberKeys(!!e.target.checked); });
      if (r2) r2.addEventListener('change', function(e) { setRememberKeys(!!e.target.checked); });
    }],
    ['AlertEmails', function() {
      if ((!alertSettings.emails || !alertSettings.emails.length) && SCHEDULE_EMAIL) {
        alertSettings.emails = normaliseAlertEmails([SCHEDULE_EMAIL]);
      }
    }],
    ['AlertUI', syncAlertSettingsUI],
    ['EmpTraining', renderEmployeeTraining],
    ['Shipments', renderShipments],
    ['AsanaOverview', renderAsanaSyncOverview],
    ['CompanyBar', updateCompanyBar],
    ['ReminderTicker', startReminderTicker],
    ['AsanaRefresh', startAsanaAutoRefresh]
  ];
  steps.forEach(function(s) {
    try { s[1](); } catch(e) { console.warn('[Init] ' + s[0] + ':', e.message); }
  });
  setTimeout(function() { try { runAlertScanner(); } catch(e) { console.warn('[Init] AlertScanner:', e.message); } }, 3000);
  window._keysLoaded = !!(ANTHROPIC_KEY || PROXY_URL);
}


// ======= ALERT SCANNER =======
function runAlertScanner() {
  const now = new Date(); now.setHours(0,0,0,0);
  const employees = safeLocalParse(EMPLOYEE_INFO_STORAGE, []);
  const gaps = safeLocalParse('fgl_gaps_v2', []);
  let expiredDocs = [], expiringDocs = [], overdueGaps = [], expiringGaps = [];

  // Document expiry scan (configurable window)
  var _alertCfg = typeof complianceConfig !== 'undefined' ? complianceConfig : { docExpiryDays: 10, gapRemediationDays: 15 };
  employees.forEach(e => {
    ['eidExpiry','passportExpiry'].forEach(field => {
      if (!e[field]) return;
      const exp = new Date(e[field]); exp.setHours(0,0,0,0);
      const diff = Math.ceil((exp - now) / 86400000);
      const docType = field === 'eidExpiry' ? 'Emirates ID' : 'Passport';
      if (diff < 0) expiredDocs.push({ name: e.name, doc: docType, expiry: e[field], days: Math.abs(diff) });
      else if (diff <= _alertCfg.docExpiryDays) expiringDocs.push({ name: e.name, doc: docType, expiry: e[field], days: diff });
    });
  });

  // Gap closure scan (configurable window)
  gaps.filter(g => g.status !== 'closed' && g.status !== 'resolved').forEach(g => {
    const created = new Date(g.createdAt); created.setHours(0,0,0,0);
    const deadline = new Date(created.getTime() + _alertCfg.gapRemediationDays * 86400000);
    const daysLeft = Math.ceil((deadline - now) / 86400000);
    if (daysLeft < 0) overdueGaps.push({ title: g.title, severity: g.severity, created: g.createdAt, overdue: Math.abs(daysLeft) });
    else if (daysLeft <= 5) expiringGaps.push({ title: g.title, severity: g.severity, created: g.createdAt, daysLeft });
  });

  // Update alert banner
  const banner = document.getElementById('alertBanner');
  const hasAlerts = expiredDocs.length || expiringDocs.length || overdueGaps.length;
  if (banner) banner.style.display = hasAlerts ? 'block' : 'none';

  const expiredEl = document.getElementById('alertBannerExpired');
  const expiringEl = document.getElementById('alertBannerExpiring');
  const gapEl = document.getElementById('alertBannerGaps');
  if (expiredEl) { expiredEl.style.display = expiredDocs.length ? 'inline' : 'none'; document.getElementById('alertExpiredCount').textContent = expiredDocs.length; }
  if (expiringEl) { expiringEl.style.display = expiringDocs.length ? 'inline' : 'none'; document.getElementById('alertExpiringCount').textContent = expiringDocs.length; }
  if (gapEl) { gapEl.style.display = overdueGaps.length ? 'inline' : 'none'; document.getElementById('alertGapCount').textContent = overdueGaps.length; }

  // Toast notifications
  if (expiredDocs.length) toast(`⚠️ ${expiredDocs.length} document${expiredDocs.length>1?'s':''} EXPIRED — immediate renewal required`, 'error', 6000);
  if (expiringDocs.length) toast(`⚠️ ${expiringDocs.length} document${expiringDocs.length>1?'s':''} expiring within ${_alertCfg.docExpiryDays} days`, 'error', 5000);
  if (overdueGaps.length) toast(`⚠️ ${overdueGaps.length} gap${overdueGaps.length>1?'s':''} exceeded ${_alertCfg.gapRemediationDays}-day remediation window`, 'error', 5000);

  // Browser push notification
  if (hasAlerts && 'Notification' in window) {
    const parts = [];
    if (expiredDocs.length) parts.push(expiredDocs.length + ' expired');
    if (expiringDocs.length) parts.push(expiringDocs.length + ' expiring in 10 days');
    if (overdueGaps.length) parts.push(overdueGaps.length + ' gaps overdue');
    if (Notification.permission === 'granted') {
      new Notification('Hawkeye Sterling V2 — Document Alert', { body: parts.join(', ') + '. Click to review.', icon: '⚠️' });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(p => { if (p === 'granted') new Notification('Hawkeye Sterling V2 — Document Alert', { body: parts.join(', ') + '. Click to review.' }); });
    }
  }

  // Trigger Asana tasks for expired docs
  if (expiredDocs.length && typeof WorkflowEngine !== 'undefined') {
    expiredDocs.forEach(d => {
      WorkflowEngine.processTrigger('deadline_overdue', {
        title: `URGENT: Renew ${d.doc} — ${d.name}`,
        date: d.expiry,
        category: 'Document Expiry',
        description: `${d.doc} for ${d.name} expired ${d.days} day${d.days>1?'s':''} ago. Initiate renewal process immediately.`
      });
    });
  }

  return { expiredDocs, expiringDocs, overdueGaps, expiringGaps };
}

// ======= TABS =======
function switchTab(name) {
  if (window.MobileResponsive) MobileResponsive.closeMenu();
  document.querySelectorAll('.tab').forEach(t => {
    const tabName = t.getAttribute('data-action') === 'switchTab' ? t.getAttribute('data-arg') : t.getAttribute('onclick')?.match(/switchTab\('(\w+)'\)/)?.[1];
    t.classList.toggle('active', tabName === name);
  });
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  const tabEl = document.getElementById('tab-'+name);
  if (tabEl) tabEl.classList.add('active');
  if (name==='complianceprog') { loadDriveLink(); initEWRA(); initBWRA(); loadComplianceManual(); renderCProgAttachments('ewra'); renderCProgAttachments('bwra'); renderCProgAttachments('manual'); }
  if (name==='drive') renderDrive();
  if (name==='asana') { var hasPrev = asanaSyncState && asanaSyncState.modules && asanaSyncState.modules.tasks && asanaSyncState.modules.tasks.lastSuccess; loadAsanaTasks(!!hasPrev); }
  if (name==='shipments') { renderShipments(); refreshMetalsPrices(false); }
  if (name==='iarreport') { renderIARReports(); if (!iarUboCount) { addIARUboRow(); addIARUboRow(); } if (!iarManagerCount) { addIARManagerRow(); } }
  if (name==='screening') { if (typeof initSanctionsRefreshStatus === 'function') initSanctionsRefreshStatus(); if (typeof renderTFS2 === 'function') { var tfsEl=document.getElementById('tfs-embedded-content'); if(tfsEl&&!tfsEl.innerHTML.trim()) renderTFS2(); } }
  if (name==='riskassessment') { if (typeof renderCRA === 'function') { var craEl=document.getElementById('cra-embedded-content'); if(craEl&&!craEl.innerHTML.trim()) renderCRA(); } }
  if (name==='evidence') renderEvidence();
  if (name==='schedule') { renderSchedules(); renderHistory(); }
  if (name==='ops' && typeof renderComplianceOps === 'function') renderComplianceOps();
  if (name==='training') { renderEmployeeTraining(); }
  if (name==='learning') { if (typeof renderExternalLinks === 'function') renderExternalLinks(); }
  if (name==='gdrive') refreshGDriveFileList();
  if (name==='dashboard' && typeof refreshDashboard === 'function') refreshDashboard();
  if (name==='calendar' && typeof renderPreloadedCalendar === 'function') renderPreloadedCalendar();
  if (name==='raci') { renderRACIMatrix(); loadRACIHistory(); }
  if (name==='employees') renderEmployeeDirectory();
  if (name==='localshipments') renderLocalShipments();
  if (name==='settings') { if (typeof renderUserManagement === 'function') renderUserManagement(); applyRoleRestrictions(); if (typeof loadComplianceConfigUI === 'function') loadComplianceConfigUI(); if (typeof checkStorageQuota === 'function') checkStorageQuota(); if (typeof initCloudSyncUI === 'function') initCloudSyncUI(); }
  if (name==='uploads') loadUploadedFiles();
  if (name==='incidents') { if (typeof updateIncidentMetrics === 'function') updateIncidentMetrics(); }
  if (name==='riskassessment') renderRiskAssessment();
  if (name==='metalstrading') { if (typeof mtInit === 'function') mtInit(); }
  if (name==='brain') { if (window.BrainConsole && typeof window.BrainConsole.init === 'function') window.BrainConsole.init(); }
}

function persistEmployeeTraining() {
  safeLocalSave(TRAINING_STORAGE, employeeTraining);
}

function renderTrainingSubjectOptions() {
  const subjectSelect = document.getElementById('trainingSubject');
  if (!subjectSelect) return;
  subjectSelect.innerHTML = `<option value="">Select training subject</option>${TRAINING_SUBJECT_CATALOG.map((subject) => `<option value="${escHtml(subject)}">${escHtml(subject)}</option>`).join('')}`;
}

function renderEmployeeTraining() {
  const list = document.getElementById('employeeTrainingList');
  const meta = document.getElementById('trainingCountMeta');
  const records = normalizeEmployeeTrainingRecords(employeeTraining);
  employeeTraining = records;
  if (meta) meta.textContent = `${records.length} employee${records.length === 1 ? '' : 's'}`;
  if (!list) return;
  if (!records.length) {
    list.innerHTML = '<p style="color:var(--muted);font-size:13px">No employee training records yet.</p>';
    return;
  }
  list.innerHTML = records.map((r) => {
    const target = Math.max(1, Number(r.totalTrainings) || TRAINING_SUBJECT_CATALOG.length);
    function isSubjectCompleted(sub) {
      const v = r.subjects && r.subjects[sub];
      if (!v) return false;
      if (typeof v === 'object') return !!v.completed;
      return !!v;
    }
    function subjectMeta(sub) {
      const v = r.subjects && r.subjects[sub];
      if (!v || typeof v !== 'object') return '';
      const parts = [];
      if (v.provider) parts.push('Provider: ' + v.provider);
      if (v.duration) parts.push(v.duration + ' hrs');
      return parts.length ? ' <span style="color:var(--amber);font-size:11px">(' + escHtml(parts.join(' · ')) + ')</span>' : '';
    }
    const completedCount = TRAINING_SUBJECT_CATALOG.filter(isSubjectCompleted).length;
    const completedSubjects = TRAINING_SUBJECT_CATALOG.filter(isSubjectCompleted);
    const pendingSubjects = TRAINING_SUBJECT_CATALOG.filter((s) => !isSubjectCompleted(s));
    const progress = Math.min(100, Math.round((completedCount / target) * 100));
    const pendingList = pendingSubjects.length
      ? pendingSubjects.map((s) => `<li style="margin-bottom:4px">${escHtml(s)}${subjectMeta(s)}</li>`).join('')
      : '<li>All catalog subjects completed</li>';
    const completedList = completedSubjects.length
      ? completedSubjects.map((s) => `<li style="margin-bottom:4px">${escHtml(s)}${subjectMeta(s)}</li>`).join('')
      : '<li>No completed trainings yet</li>';
    return `<div class="card" style="margin-bottom:10px"><div class="top-bar" style="margin-bottom:6px"><div><div class="asana-name">${escHtml(r.employeeName || '')}</div><div class="asana-meta">Department: ${escHtml(r.department || '')} | Completed ${completedCount}/${target} (${progress}%)</div></div><button class="btn btn-sm btn-red" data-action="deleteEmployeeTraining" data-arg="${escJsStr(r.id)}">Remove Employee</button></div><div style="height:8px;border:1px solid var(--border);border-radius:999px;overflow:hidden;background:rgba(201,168,76,0.05);margin-bottom:8px"><div style="height:100%;width:${progress}%;background:var(--green)"></div></div><details><summary style="cursor:pointer;color:var(--muted);font-size:12px;font-family:'Montserrat',sans-serif">Completed trainings (${completedSubjects.length})</summary><ul style="margin:8px 0 0 16px;color:var(--muted);font-size:12px">${completedList}</ul></details><details style="margin-top:8px"><summary style="cursor:pointer;color:var(--muted);font-size:12px;font-family:'Montserrat',sans-serif">Pending trainings (${pendingSubjects.length})</summary><ul style="margin:8px 0 0 16px;color:var(--muted);font-size:12px">${pendingList}</ul></details></div>`;
  }).join('');
}

function addEmployeeTraining() {
  const employeeName = String(document.getElementById('trainingEmployeeName')?.value || '').trim();
  const department = String(document.getElementById('trainingDepartment')?.value || '').trim();
  const totalTrainingsRaw = String(document.getElementById('trainingTotal')?.value || '').trim();
  const subject = String(document.getElementById('trainingSubject')?.value || '').trim();
  const provider = String(document.getElementById('trainingProvider')?.value || '').trim();
  const duration = String(document.getElementById('trainingDuration')?.value || '').trim();
  const completed = String(document.getElementById('trainingCompleted')?.value || 'no') === 'yes';
  const totalTrainings = Number(totalTrainingsRaw);
  if (!employeeName) { toast('Employee name is required','error'); return; }
  if (!department) { toast('Department is required','error'); return; }
  if (totalTrainingsRaw === '' || !Number.isFinite(totalTrainings) || totalTrainings < 0) { toast('Total trainings must be 0 or higher','error'); return; }
  if (!subject) { toast('Training subject is required','error'); return; }
  employeeTraining = normalizeEmployeeTrainingRecords(employeeTraining);
  const nameKey = String(employeeName).trim().toLowerCase();
  let rec = employeeTraining.find((x) => String(x.employeeName || '').trim().toLowerCase() === nameKey);
  if (!rec) {
    rec = {
      id: `et-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      employeeName,
      department,
      totalTrainings: Math.floor(totalTrainings),
      subjects: {},
      updatedAt: new Date().toISOString()
    };
    employeeTraining.unshift(rec);
  }
  rec.department = department;
  rec.totalTrainings = Math.max(1, Math.floor(totalTrainings));
  rec.subjects = rec.subjects && typeof rec.subjects === 'object' ? rec.subjects : {};
  rec.subjects[subject] = { completed, provider: provider || '', duration: duration || '' };
  rec.updatedAt = new Date().toISOString();
  employeeTraining = employeeTraining.slice(0, 500).sort((a, b) => String(a.employeeName || '').localeCompare(String(b.employeeName || '')));
  persistEmployeeTraining();
  ['trainingEmployeeName','trainingDepartment','trainingTotal','trainingSubject','trainingProvider','trainingDuration'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const c = document.getElementById('trainingCompleted');
  if (c) c.value = 'no';
  renderEmployeeTraining();
  toast('Employee training record added','success');
}

function deleteEmployeeTraining(id) {
  if (!confirm('Are you sure you want to remove this employee training record?')) return;
  employeeTraining = normalizeEmployeeTrainingRecords(employeeTraining).filter(r => r.id !== id);
  persistEmployeeTraining();
  renderEmployeeTraining();
  toast('Employee training summary removed','info');
}

function clearTraining() {
  if (!confirm('Clear ALL training records? This cannot be undone.')) return;
  employeeTraining = [];
  persistEmployeeTraining();
  renderEmployeeTraining();
  toast('All training records cleared', 'success');
}

function exportTrainingPDF() {
  if (!requireJsPDF()) return;
  if (!employeeTraining.length) { toast('No training records to export','error'); return; }
  const doc = new jspdf.jsPDF();
  const pw = doc.internal.pageSize.getWidth();
  doc.setFillColor(30,30,30); doc.rect(0,0,pw,28,'F');
  doc.setFontSize(16); doc.setTextColor(180,151,90); doc.text('Employee Training Report', 14, 18);
  doc.setFontSize(8); doc.setTextColor(120); doc.text('Generated: '+new Date().toLocaleDateString('en-GB'), pw-14, 18, {align:'right'});
  let y = 36;
  employeeTraining.forEach((r, idx) => {
    if (y > 255) { doc.addPage(); y = 20; }
    doc.setFillColor(40,40,40); doc.rect(14, y-4, pw-28, 8, 'F');
    doc.setFontSize(10); doc.setTextColor(180,151,90); doc.text((idx+1)+'. '+(r.employeeName||''), 16, y+1);
    doc.setTextColor(120); doc.text(r.department||'', pw-16, y+1, {align:'right'});
    y += 10;
    doc.setFontSize(8); doc.setTextColor(160);
    doc.text('Total Trainings: '+(r.totalTrainings||0), 16, y); y += 5;
    const subs = r.subjects && typeof r.subjects === 'object' ? r.subjects : {};
    Object.entries(subs).forEach(([subj, info]) => {
      const status = info.completed ? 'Completed' : 'Pending';
      const color = info.completed ? [39,174,96] : [232,168,56];
      doc.setTextColor(...color);
      doc.text('  '+subj+': '+status+(info.provider?' | '+info.provider:'')+(info.duration?' | '+info.duration+'h':''), 16, y); y += 4;
    });
    doc.setTextColor(160); y += 4;
  });
  doc.save('Employee_Training_'+new Date().toISOString().slice(0,10)+'.pdf');
  toast('PDF exported','success');
}

function exportTrainingDOCX() {
  if (!employeeTraining.length) { toast('No training records to export','error'); return; }
  let html = wordDocHeader('Employee Training Report');
  html += '<table><tr><th>#</th><th>Employee</th><th>Department</th><th>Total</th><th>Subject</th><th>Provider</th><th>Duration</th><th>Status</th></tr>';
  employeeTraining.forEach((r, idx) => {
    const subs = r.subjects && typeof r.subjects === 'object' ? r.subjects : {};
    const entries = Object.entries(subs);
    if (!entries.length) {
      html += '<tr><td>'+(idx+1)+'</td><td>'+(r.employeeName||'')+'</td><td>'+(r.department||'')+'</td><td>'+(r.totalTrainings||0)+'</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>';
    } else {
      entries.forEach(([subj, info], si) => {
        html += '<tr>'+(si===0?'<td rowspan="'+entries.length+'">'+(idx+1)+'</td><td rowspan="'+entries.length+'">'+(r.employeeName||'')+'</td><td rowspan="'+entries.length+'">'+(r.department||'')+'</td><td rowspan="'+entries.length+'">'+(r.totalTrainings||0)+'</td>':'');
        html += '<td>'+subj+'</td><td>'+(info.provider||'')+'</td><td>'+(info.duration||'')+'</td><td class="'+(info.completed?'done':'pending')+'">'+(info.completed?'Completed':'Pending')+'</td></tr>';
      });
    }
  });
  html += '</table>' + wordDocFooter();
  downloadWordDoc(html, 'Employee_Training_'+new Date().toISOString().slice(0,10)+'.doc');
  toast('Word exported','success');
}

function exportTrainingCSV() {
  if (!employeeTraining.length) { toast('No training records to export','error'); return; }
  const headers = ['Employee','Department','Total Trainings','Subject','Provider','Duration (Hrs)','Completed'];
  const rows = [];
  employeeTraining.forEach(r => {
    const subs = r.subjects && typeof r.subjects === 'object' ? r.subjects : {};
    const entries = Object.entries(subs);
    if (!entries.length) { rows.push([r.employeeName, r.department, r.totalTrainings, '', '', '', '']); }
    else { entries.forEach(([subj, info]) => { rows.push([r.employeeName, r.department, r.totalTrainings, subj, info.provider||'', info.duration||'', info.completed?'Yes':'No']); }); }
  });
  const csv = [headers,...rows].map(r=>r.map(c=>'"'+String(c||'').replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob = new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='Employee_Training_'+new Date().toISOString().slice(0,10)+'.csv';a.click();
  toast('CSV exported','success');
}

// ======= EXTERNAL LEARNING LINKS =======
const DEFAULT_EXT_LINKS = [
  { id:'el-1', name:'UN CC:e-Learn', url:'https://unccelearn.org/', category:'Environment & SDG', desc:'United Nations climate change e-learning platform' },
  { id:'el-2', name:'OmniCampus', url:'https://edu.omnicamp.us/en/dashboard', category:'General Education', desc:'Online learning and certification platform' },
  { id:'el-3', name:'OHCHR E-Learning', url:'https://elearning.ohchr.org/', category:'Human Rights', desc:'UN Office of the High Commissioner for Human Rights courses' },
  { id:'el-4', name:'Kaggle', url:'https://www.kaggle.com/', category:'Data & Analytics', desc:'Data science competitions and machine learning courses' },
  { id:'el-5', name:'Learn Prompting', url:'https://learnprompting.org/', category:'AI & Technology', desc:'Prompt engineering and AI interaction courses' },
  { id:'el-6', name:'Anthropic Academy', url:'https://anthropic.skilljar.com/', category:'AI & Technology', desc:'AI Fluency Framework — Foundations by Anthropic' },
  { id:'el-7', name:'Dub AI', url:'https://omp.dub.ai/my-modules', category:'AI & Technology', desc:'AI-powered learning modules and certifications' },
  { id:'el-8', name:'Academia de IA', url:'https://academiadeia.beehiiv.com/', category:'AI & Technology', desc:'AI Academy newsletter and learning resources' },
  { id:'el-9', name:'SVCH.io', url:'https://svch.io/es/panel/', category:'General Education', desc:'Online learning management platform' },
  { id:'el-10', name:'Domestika', url:'https://www.domestika.org/', category:'General Education', desc:'Creative and professional online courses' },
  { id:'el-11', name:'AI Automation A-Z', url:'https://www.domestika.org/', category:'AI & Technology', desc:'Complete AI Automation course from A to Z' },
  { id:'el-12', name:'ED4S', url:'https://learn.ed4s.org/collections', category:'Environment & SDG', desc:'Education for Sustainability learning collections' },
  { id:'el-13', name:'Project Management Institute (PMI)', url:'https://www.pmi.org/', category:'Project Management', desc:'Home of project management certifications and resources' },
  { id:'el-14', name:'University of Maryland (Canvas)', url:'https://umd.instructure.com/', category:'General Education', desc:'University of Maryland online courses via Canvas LMS' },
  { id:'el-15', name:'Santander Open Academy', url:'https://www.santanderopenacademy.com/', category:'General Education', desc:'Santander Bank scholarships and e-learning platform' },
  { id:'el-16', name:'Cisco Networking Academy', url:'https://www.netacad.com/', category:'AI & Technology', desc:'Cisco networking, cybersecurity and IT courses' },
  { id:'el-17', name:'Capacitate para el Empleo', url:'https://capacitateparaelempleo.org/', category:'General Education', desc:'Carlos Slim Foundation free employment training (Spanish)' },
  { id:'el-18', name:'Securiti AI Academy', url:'https://education.securiti.ai/', category:'Compliance & AML', desc:'Data privacy, security and AI governance training' },
  { id:'el-19', name:'Cognitive Class (IBM)', url:'https://cognitiveclass.ai/', category:'Data & Analytics', desc:'IBM data science, AI and cloud computing courses' },
  { id:'el-20', name:'Napkin AI — Compliance Governance', url:'https://www.napkin.ai/', category:'Compliance & AML', desc:'AI-powered compliance governance visual tool' },
  { id:'el-21', name:'Position Green Academy', url:'https://academy.positiongreen.com/', category:'Environment & SDG', desc:'ESG and sustainability reporting courses' },
  { id:'el-22', name:'Sumsub', url:'https://cockpit.sumsub.com/', category:'Compliance & AML', desc:'KYC/AML identity verification and compliance platform' },
  { id:'el-23', name:'TMC MOOC (University of Helsinki)', url:'https://tmc.mooc.fi/', category:'AI & Technology', desc:'University of Helsinki programming and AI MOOCs' },
  { id:'el-24', name:'ADBI E-Learning', url:'https://elearning-adbi.org/courses/', category:'Finance & Trade', desc:'Asian Development Bank Institute training courses' },
  { id:'el-25', name:'Free Academy AI', url:'https://freeacademy.ai/courses', category:'AI & Technology', desc:'Free AI and machine learning courses' },
  { id:'el-26', name:'ACAMS', url:'https://www.acams.org/en/learning', category:'Compliance & AML', desc:'Association of Certified Anti-Money Laundering Specialists' },
  { id:'el-27', name:'IMO (International Maritime Organization)', url:'https://lms.imo.org/', category:'Compliance & AML', desc:'Maritime safety and environmental protection courses' },
  { id:'el-28', name:'OECD Academy', url:'https://oecdacademy.oecd.org/', category:'Finance & Trade', desc:'OECD policy and governance training courses' },
  { id:'el-29', name:'InforMEA', url:'https://elearning.informea.org/', category:'Environment & SDG', desc:'UN multilateral environmental agreements e-learning' },
  { id:'el-30', name:'UN SDG:Learn', url:'https://www.unsdglearn.org/', category:'Environment & SDG', desc:'UN Sustainable Development Goals learning platform' },
  { id:'el-31', name:'ITC Learning (International Trade Centre)', url:'https://learning.intracen.org/', category:'Finance & Trade', desc:'International Trade Centre SME competitiveness courses' },
  { id:'el-32', name:'Oxford Home Study', url:'https://www.oxfordhomestudy.com/', category:'General Education', desc:'Free and certified online diploma courses' },
  { id:'el-33', name:'atingi', url:'https://online.atingi.org/', category:'General Education', desc:'GIZ digital learning platform for development' },
  { id:'el-34', name:'AUSTRAC E-Learn', url:'https://elearn.austrac.gov.au/', category:'Compliance & AML', desc:'Australian AML/CTF regulator training courses' },
  { id:'el-35', name:'DeepLearning.AI', url:'https://learn.deeplearning.ai/', category:'AI & Technology', desc:'Andrew Ng deep learning and AI courses' },
  { id:'el-36', name:'ISC2', url:'https://www.isc2.org/', category:'AI & Technology', desc:'Cybersecurity certifications (CISSP, CCSP, etc.)' },
  { id:'el-37', name:'FutureLearn', url:'https://www.futurelearn.com/', category:'General Education', desc:'University-backed online courses and micro-credentials' },
  { id:'el-38', name:'ITC-ILO eCampus', url:'https://ecampus.itcilo.org/', category:'Finance & Trade', desc:'International Training Centre of the ILO e-learning' },
  { id:'el-39', name:'CISI (Chartered Institute for Securities & Investment)', url:'https://www.cisi.org/', category:'Finance & Trade', desc:'Financial services qualifications and CPD' },
  { id:'el-40', name:'Accountability Framework', url:'https://learn.accountability-framework.org/', category:'Supply Chain', desc:'Ethical supply chain and accountability training' },
  { id:'el-41', name:'Proforest Academy', url:'https://www.proforestacademy.net/', category:'Supply Chain', desc:'Responsible sourcing and sustainability training' },
  { id:'el-42', name:'BMJ Learning', url:'https://new-learning.bmj.com/', category:'General Education', desc:'British Medical Journal continuing education' },
  { id:'el-43', name:'Epigeum (Oxford University Press)', url:'https://courses.epigeum.com/', category:'General Education', desc:'Research integrity and professional development' },
  { id:'el-44', name:'FAO E-Learning', url:'https://elearning.fao.org/', category:'Environment & SDG', desc:'Food and Agriculture Organization training courses' },
  { id:'el-45', name:'ACHP Reach360', url:'https://achp.reach360.com/', category:'Compliance & AML', desc:'Advisory Council on Historic Preservation learning' },
  { id:'el-46', name:'iMooX', url:'https://imoox.at/courses', category:'General Education', desc:'Austrian MOOC platform — free online courses' },
  { id:'el-47', name:'UN Global Compact Academy', url:'https://academy.unglobalcompact.org/', category:'Environment & SDG', desc:'Corporate sustainability and SDG training' },
  { id:'el-48', name:'International Trade Academy', url:'https://www.internationaltrade.academy/', category:'Finance & Trade', desc:'Trade compliance and export control courses' },
  { id:'el-49', name:'UNODC E-Learning', url:'https://elearningunodc.org/', category:'Compliance & AML', desc:'UN Office on Drugs and Crime training modules' },
  { id:'el-50', name:'UNSSC (UN System Staff College)', url:'https://elounge.unssc.org/', category:'General Education', desc:'UN System Staff College learning platform' },
  { id:'el-51', name:'LIFE Global', url:'https://www.life-global.org/', category:'Environment & SDG', desc:'Learning in Future Environments global courses' },
  { id:'el-52', name:'Council of Europe E-Learning', url:'https://help.elearning.ext.coe.int/', category:'Human Rights', desc:'Council of Europe HELP e-learning on human rights' },
  { id:'el-53', name:'Responsible Business Academy', url:'https://academy.responsiblebusiness.org/', category:'Supply Chain', desc:'Responsible business conduct training' },
  { id:'el-54', name:'Geneva Centre for Human Rights', url:'https://apps.elearning.gchumanrights.org/', category:'Human Rights', desc:'Geneva Academy human rights e-learning' },
  { id:'el-55', name:'Youth for Human Rights', url:'https://www.youthforhumanrights.org/', category:'Human Rights', desc:'Human rights education for youth' },
  { id:'el-56', name:'UNESCAP E-Learning', url:'https://e-learning.unescap.org/', category:'Environment & SDG', desc:'UN Economic and Social Commission for Asia and the Pacific' },
  { id:'el-57', name:'Holcim Academy', url:'https://holcimacademy.com/', category:'General Education', desc:'Holcim building solutions training academy' },
  { id:'el-58', name:'UN Women Training Centre', url:'https://portal.trainingcentre.unwomen.org/', category:'Human Rights', desc:'Gender equality and women empowerment training' },
  { id:'el-59', name:'E-Learning College', url:'https://www.elearningcollege.com/', category:'General Education', desc:'Accredited online diploma and certificate courses' },
  { id:'el-60', name:'UNESCO OpenLearning', url:'https://openlearning.unesco.org/', category:'General Education', desc:'UNESCO open educational resources and courses' },
  { id:'el-61', name:'Wilfrid Laurier University', url:'https://continuingeducation.wlu.ca/', category:'General Education', desc:'Continuing education and professional development' },
  { id:'el-62', name:'UNICEF Agora', url:'https://agora.unicef.org/', category:'Human Rights', desc:'UNICEF learning and development platform' },
  { id:'el-63', name:'READY (UN OCHA)', url:'https://ready.csod.com/', category:'Human Rights', desc:'UN humanitarian response training platform' },
  { id:'el-64', name:'IACA (International Anti-Corruption Academy)', url:'https://iaca-online-training.thinkific.com/', category:'Compliance & AML', desc:'Anti-corruption and integrity training' },
  { id:'el-65', name:'Blockchain Council', url:'https://www.blockchain-council.org/', category:'AI & Technology', desc:'Blockchain and Web3 certifications' },
  { id:'el-66', name:'TRREE (Training and Resources in Research Ethics)', url:'https://elearning.trree.org/', category:'General Education', desc:'Research ethics evaluation training' },
  { id:'el-67', name:'edX (SDG Academy)', url:'https://www.edx.org/', category:'Environment & SDG', desc:'Ethics in Action — SDG Academy courses on edX' },
  { id:'el-68', name:'GEI in Research (PEP Network)', url:'https://gei-in-research.pep-net.org/', category:'Data & Analytics', desc:'Gender equality and inclusion in research' },
  { id:'el-69', name:'UNU eCampus', url:'https://activities.ehs.unu.edu/ecampus/', category:'Environment & SDG', desc:'United Nations University e-learning campus' },
  { id:'el-70', name:'UN Statistics E-Learning', url:'https://learning.officialstatistics.org/', category:'Data & Analytics', desc:'Official statistics and data science courses' },
  { id:'el-71', name:'Supply Chain School', url:'https://learn.supplychainschool.co.uk/', category:'Supply Chain', desc:'Sustainability in supply chains learning platform' },
  { id:'el-72', name:'UNIDO Hub', url:'https://hub.unido.org/', category:'Finance & Trade', desc:'UN Industrial Development Organization training' },
  { id:'el-73', name:'NightCourses', url:'https://www.nightcourses.com/', category:'General Education', desc:'Evening and part-time course directory' },
  { id:'el-74', name:'MSBM (Metropolitan School of Business & Management)', url:'https://portal.msbm.org.uk/', category:'General Education', desc:'UK business and management short courses' },
  { id:'el-75', name:'UAE IEC — UN Sanctions List', url:'https://www.uaeiec.gov.ae/en-us/un-page', category:'Sanctions & Screening', desc:'UAE International Executive Council — UN Sanctions compliance page' },
  { id:'el-76', name:'OFAC Sanctions Search', url:'https://sanctionssearch.ofac.treas.gov/', category:'Sanctions & Screening', desc:'US Treasury OFAC Specially Designated Nationals (SDN) search tool' },
  { id:'el-77', name:'EU Sanctions Map', url:'https://www.sanctionsmap.eu/#/main', category:'Sanctions & Screening', desc:'European Union interactive sanctions map and consolidated list' },
  { id:'el-78', name:'UN Security Council Consolidated List Updates', url:'https://main.un.org/securitycouncil/en/content/list-updates-unsc-consolidated-list', category:'Sanctions & Screening', desc:'United Nations Security Council sanctions list updates and notifications' },
  { id:'el-79', name:'INTERPOL Red Notices', url:'https://www.interpol.int/How-we-work/Notices/Red-Notices/View-Red-Notices', category:'Sanctions & Screening', desc:'INTERPOL Red Notices — international wanted persons search' }
];

function getExtLinksKey() { return typeof scopeKey === 'function' ? scopeKey('fgl_ext_learning_links') : 'fgl_ext_learning_links'; }
function resetExtLinksToDefault() {
  if (!confirm('Reset learning links to default list? Your custom links will be removed.')) return;
  safeLocalSave(getExtLinksKey(), DEFAULT_EXT_LINKS.slice());
  renderExternalLinks();
  toast('Learning links refreshed to defaults','success');
}

function getExtLinks() {
  let links = safeLocalParse(getExtLinksKey(), null);
  if (links === null) { links = DEFAULT_EXT_LINKS.slice(); safeLocalSave(getExtLinksKey(), links); }
  return links;
}
function saveExtLinks(links) { safeLocalSave(getExtLinksKey(), links); }

function toggleAddExtLink() {
  const form = document.getElementById('extLinkAddForm');
  if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

function addExternalLink() {
  const name = (document.getElementById('extLinkName')?.value || '').trim();
  const url = (document.getElementById('extLinkUrl')?.value || '').trim();
  const category = (document.getElementById('extLinkCategory')?.value || 'Other');
  const desc = (document.getElementById('extLinkDesc')?.value || '').trim();
  if (!name) { toast('Institution name is required','error'); return; }
  if (!url) { toast('Website URL is required','error'); return; }
  const links = getExtLinks();
  links.unshift({ id: 'el-' + Date.now(), name, url: url.startsWith('http') ? url : 'https://' + url, category, desc });
  saveExtLinks(links);
  document.getElementById('extLinkName').value = '';
  document.getElementById('extLinkUrl').value = '';
  document.getElementById('extLinkDesc').value = '';
  toggleAddExtLink();
  renderExternalLinks();
  toast('Link added: ' + name, 'success');
}

function deleteExtLink(id) {
  if (!confirm('Remove this learning link?')) return;
  const links = getExtLinks().filter(l => l.id !== id);
  saveExtLinks(links);
  renderExternalLinks();
  toast('Link removed','success');
}

function renderExternalLinks() {
  const el = document.getElementById('externalLinksList');
  const meta = document.getElementById('extLinksMeta');
  if (!el) return;
  const allLinks = getExtLinks();
  const search = (document.getElementById('extLinkSearch')?.value || '').trim().toLowerCase();
  const filtered = search ? allLinks.filter(l => (l.name + ' ' + l.category + ' ' + l.desc + ' ' + l.url).toLowerCase().includes(search)) : allLinks;
  if (meta) meta.textContent = filtered.length + ' link' + (filtered.length === 1 ? '' : 's') + (search ? ' (filtered)' : '');
  if (!filtered.length) { el.innerHTML = '<p style="color:var(--muted);font-size:13px">No links found.</p>'; return; }
  const cats = {};
  filtered.forEach(l => { const c = l.category || 'Other'; if (!cats[c]) cats[c] = []; cats[c].push(l); });
  const catColors = { 'Compliance & AML':'#e74c3c', 'AI & Technology':'#9b59b6', 'Human Rights':'#3498db', 'Project Management':'#e67e22', 'Supply Chain':'#1abc9c', 'Data & Analytics':'#2ecc71', 'Finance & Trade':'#f39c12', 'Environment & SDG':'#27ae60', 'General Education':'#b4975a', 'Other':'#95a5a6' };
  el.innerHTML = Object.entries(cats).sort((a,b) => a[0].localeCompare(b[0])).map(([cat, links]) =>
    '<div style="margin-bottom:14px"><div style="font-size:11px;font-weight:700;color:' + (catColors[cat]||'var(--gold)') + ';font-family:\'Montserrat\',sans-serif;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px">' + escHtml(cat) + ' (' + links.length + ')</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:8px">' +
    links.map(l => '<div style="background:rgba(201,168,76,0.05);border:1px solid var(--border);border-radius:3px;padding:10px 12px;display:flex;align-items:flex-start;gap:10px;transition:border-color .2s" onmouseenter="this.style.borderColor=\'var(--gold)\'" onmouseleave="this.style.borderColor=\'var(--border)\'">' +
      '<div style="flex:1;min-width:0">' +
        '<a href="' + escHtml(l.url) + '" target="_blank" rel="noopener" style="color:var(--gold);font-size:12px;font-weight:600;text-decoration:none;font-family:\'Montserrat\',sans-serif;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + escHtml(l.url) + '">' + escHtml(l.name) + '</a>' +
        (l.desc ? '<div style="color:var(--muted);font-size:10px;margin-top:2px;line-height:1.3">' + escHtml(l.desc) + '</div>' : '') +
        '<div style="color:var(--text);font-size:9px;margin-top:3px;opacity:0.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(l.url) + '</div>' +
      '</div>' +
      '<button data-action="deleteExtLink" data-arg="' + l.id + '" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:0;line-height:1;opacity:0.6" title="Remove">&times;</button>' +
    '</div>').join('') +
    '</div></div>'
  ).join('');
}

function renderCompanySelectors() {
  const editorSelect = document.getElementById('companyEditorSelect');
  const active = getActiveCompany();
  const themeByCompany = {
    'company-1': 'company-theme-madison',
    'company-2': 'company-theme-naples',
    'company-3': 'company-theme-gramaltin',
    'company-4': 'company-theme-zoe',
    'company-5': 'company-theme-finegold',
    'company-6': 'company-theme-branch'
  };
  const allThemes = ['company-theme-madison','company-theme-naples','company-theme-gramaltin','company-theme-zoe','company-theme-finegold','company-theme-branch'];
  const activeTheme = themeByCompany[active.id] || 'company-theme-madison';
  const options = companyProfiles.map(c => `<option value="${escHtml(c.id)}">${escHtml(c.name)}</option>`).join('');
  if (editorSelect) {
    editorSelect.innerHTML = options;
    editorSelect.value = active.id;
  }
  const badge = document.getElementById('activeCompanyName');
  if (badge) badge.textContent = active.name;
  const badgeWrap = document.getElementById('activeCompanyBadge');
  if (badgeWrap) {
    badgeWrap.classList.remove(...allThemes);
    badgeWrap.classList.add(activeTheme);
  }
}


function loadCompanyProfileEditor(companyId) {
  const company = companyProfiles.find(c => c.id === companyId) || getActiveCompany();
  // Switch active company so header badge updates
  if (company.id !== activeCompanyId) {
    switchActiveCompany(company.id);
    return; // switchActiveCompany calls renderCompaniesTab which re-calls this
  }
  const links = company.links || {};
  const asana = document.getElementById('companyLinkAsana');
  const portal = document.getElementById('companyLinkPortal');
  const drive = document.getElementById('companyLinkDrive');
  const licenseNo = document.getElementById('companyLicenseNo');
  const licenseExpiry = document.getElementById('companyLicenseExpiry');
  const description = document.getElementById('companyDescription');
  const complianceProgram = document.getElementById('companyComplianceProgram');
  if (asana) asana.value = links.asana || '';
  if (portal) portal.value = links.portal || '';
  if (drive) drive.value = links.drive || '';
  if (licenseNo) licenseNo.value = company.licenseNo || '';
  if (licenseExpiry) licenseExpiry.value = company.licenseExpiry || '';
  if (description) description.value = company.description || '';
  if (complianceProgram) complianceProgram.value = company.complianceProgram || '';
  renderCompanyLinksPanelFor(company);
}

function renderCompanyLinksPanelFor(company) {
  const panel = document.getElementById('companyLinksPanel');
  const meta = document.getElementById('companyLinksMeta');
  const links = company.links || {};
  if (meta) meta.textContent = `Selected company: ${company.name}`;
  if (!panel) return;
  let html = '';
  // Company details summary
  const details = [];
  if (company.licenseNo) details.push(`License: ${escHtml(company.licenseNo)}`);
  if (company.licenseExpiry) details.push(`Expires: ${escHtml(company.licenseExpiry)}`);
  if (company.description) details.push(`${escHtml(company.description)}`);
  if (company.complianceProgram) details.push(`Programme: ${escHtml(company.complianceProgram)}`);
  if (details.length) {
    html += `<div style="background:rgba(201,168,76,0.05);border-radius:3px;padding:10px 12px;margin-bottom:8px">
      <div style="font-size:11px;font-weight:700;color:var(--amber);margin-bottom:4px;font-family:'Montserrat',sans-serif;letter-spacing:1px">COMPANY PROFILE</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.6">${details.join(' · ')}</div>
    </div>`;
  }
  // Links
  const items = [
    { label: 'Asana Workspace', url: links.asana },
    { label: 'Google Drive', url: links.drive },
    { label: 'External Portal', url: links.portal }
  ].filter(x => x.url);
  if (items.length) {
    html += items.map(item => `<div class="asana-item"><div><div class="asana-name">${escHtml(item.label)}</div><div class="asana-meta">${escHtml(item.url)}</div></div><button class="btn btn-sm" data-action="openSafeUrl" data-arg="${escJsStr(item.url)}">Open</button></div>`).join('');
  }
  if (!html) {
    panel.innerHTML = '<p style="color:var(--muted);font-size:13px">No external links configured for this company.</p>';
    return;
  }
  panel.innerHTML = html;
}

function renderCompanyLinksPanel() {
  renderCompanyLinksPanelFor(getActiveCompany());
}

function renderCompaniesTab() {
  renderCompanySelectors();
  loadCompanyProfileEditor(getActiveCompany().id);
  renderCompanyLinksPanel();
}

function saveCompanyProfileEdits() {
  const companyId = (document.getElementById('companyEditorSelect')?.value || getActiveCompany().id);
  const company = companyProfiles.find(c => c.id === companyId);
  if (!company) return;
  company.name = (document.getElementById('companyEditorName')?.value || company.name).trim() || company.name;
  company.licenseNo = (document.getElementById('companyLicenseNo')?.value || '').trim();
  company.licenseExpiry = document.getElementById('companyLicenseExpiry')?.value || '';
  company.description = (document.getElementById('companyDescription')?.value || '').trim();
  company.complianceProgram = (document.getElementById('companyComplianceProgram')?.value || '').trim();
  company.links = {
    website: normaliseProxyUrl(document.getElementById('companyLinkWebsite')?.value || '') || String(document.getElementById('companyLinkWebsite')?.value || '').trim(),
    asana: String(document.getElementById('companyLinkAsana')?.value || '').trim(),
    drive: String(document.getElementById('companyLinkDrive')?.value || '').trim(),
    registry: String(document.getElementById('companyLinkRegistry')?.value || '').trim(),
    portal: String(document.getElementById('companyLinkPortal')?.value || '').trim()
  };
  persistCompanyProfiles();
  renderCompaniesTab();
  toast(`Saved profile for ${company.name}`, 'success');
}

// ======= COMPANY LOGO (auto-loaded from assets/logos/) =======
const COMPANY_LOGO_FILES = {
  'company-1': 'assets/logos/madison.png',
  'company-2': 'assets/logos/naples.png',
  'company-3': 'assets/logos/gramaltin.png',
  'company-4': 'assets/logos/zoe.png',
  'company-5': 'assets/logos/finegold.png',
  'company-6': 'assets/logos/finegold.png'
};
const _logoCache = {};

function preloadCompanyLogos() {
  Object.entries(COMPANY_LOGO_FILES).forEach(([cId, path]) => {
    if (_logoCache[cId]) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        _logoCache[cId] = canvas.toDataURL('image/png');
      } catch(e) { /* CORS or other issue */ }
    };
    img.src = path + '?v=' + Date.now();
  });
}

function getCompanyLogoBase64(companyId) {
  const cId = companyId || activeCompanyId;
  return _logoCache[cId] || '';
}

document.addEventListener('DOMContentLoaded', function() { setTimeout(preloadCompanyLogos, 500); });

// Company color palette — each entity gets a unique accent
const COMPANY_COLORS = [
  { bg: 'rgba(56,132,244,0.08)', border: 'rgba(56,132,244,0.4)', text: '#3884F4', icon: '💎', iconBg: 'rgba(56,132,244,0.15)' },   // Gramaltin - Blue Diamond
  { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.4)', text: '#10B981', icon: '🏛️', iconBg: 'rgba(16,185,129,0.15)' },   // Madison - Emerald Building
  { bg: 'rgba(236,72,153,0.08)', border: 'rgba(236,72,153,0.4)', text: '#EC4899', icon: '👑', iconBg: 'rgba(236,72,153,0.15)' },   // Naples - Pink Crown
  { bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.4)', text: '#8B5CF6', icon: '✨', iconBg: 'rgba(139,92,246,0.15)' },   // Zoe - Violet Sparkle
  { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.4)', text: '#F59E0B', icon: '🥇', iconBg: 'rgba(245,158,11,0.15)' },   // Fine Gold LLC - Gold Medal
  { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.4)', text: '#EF4444', icon: '🔶', iconBg: 'rgba(239,68,68,0.15)' },     // Fine Gold Branch - Red Diamond
];

function getCompanyColor(companyId) {
  const idx = companyProfiles.findIndex(c => c.id === companyId);
  return COMPANY_COLORS[idx >= 0 ? idx % COMPANY_COLORS.length : 0];
}

function updateCompanyBar() {
  const company = getActiveCompany();
  const color = getCompanyColor(activeCompanyId);
  const bar = document.getElementById('companyBar');
  const nameEl = document.getElementById('cbCompanyName');
  const iconEl = document.getElementById('cbIcon');
  const selectEl = document.getElementById('cbCompanySelect');
  if (!bar) return;

  bar.style.background = color.bg;
  bar.style.borderColor = color.border;
  bar.style.color = color.text;
  nameEl.textContent = company.name;

  // Company icon in bar
  if (iconEl) {
    iconEl.textContent = color.icon;
    iconEl.style.background = color.iconBg;
  }

  // Populate dropdowns (old bar + header)
  const optionsHtml = companyProfiles.map(c => {
    const cc = getCompanyColor(c.id);
    return `<option value="${c.id}" ${c.id === activeCompanyId ? 'selected' : ''}>${c.name}</option>`;
  }).join('');
  if (selectEl) selectEl.innerHTML = optionsHtml;
  const headerSelect = document.getElementById('headerCompanySelect');
  if (headerSelect) {
    headerSelect.innerHTML = optionsHtml;
    headerSelect.style.color = color.text;
    headerSelect.style.borderColor = color.border;
  }

  // Update header logo icon and title color
  // Logo icon kept as SVG - no emoji override
  const logoText = document.querySelector('.logo-text');
  if (logoText) logoText.style.color = color.text;
}

function switchActiveCompany(companyId) {
  if (!companyProfiles.find(c => c.id === companyId)) return;
  activeCompanyId = companyId;
  persistCompanyProfiles();
  loadScopedCompanyState();
  renderShipments();
  renderCompaniesTab();
  renderAsanaSyncOverview();
  updateCompanyBar();
  toast(`Switched to ${getActiveCompany().name}`, 'info');
}

function startAsanaAutoRefresh() {
  if (asanaAutoRefreshTimer) clearInterval(asanaAutoRefreshTimer);
  if (!ASANA_TOKEN && !PROXY_URL) return;
  // Auto-resolve project GIDs from Asana workspace on first connect
  resolveAsanaProjectGIDs().catch(function(){});
  asanaAutoRefreshTimer = setInterval(async () => {
    if (document.hidden) return;
    try {
      await loadAsanaTasks(true);
    } catch (_) {}
    try {
      await processAsanaRetryQueue(true);
    } catch (_) {}
  }, ASANA_AUTO_REFRESH_MS);
}

document.addEventListener('visibilitychange', function() {
  if (document.hidden) return;
  if (ASANA_TOKEN || PROXY_URL) {
    loadAsanaTasks(true).catch(() => {});
    processAsanaRetryQueue(true).catch(() => {});
  }
});

// ======= ALERT SETTINGS =======
function syncAlertSettingsUI() {
  const b = document.getElementById('browserAlertsEnabled');
  const e = document.getElementById('emailAlertsEnabled');
  const h = document.getElementById('hourlyReminderEnabled');
  const e1 = document.getElementById('alertEmail1');
  if (b) b.checked = !!alertSettings.browserEnabled;
  if (e) e.checked = !!alertSettings.emailEnabled;
  if (h) h.checked = !!alertSettings.hourlyReminderEnabled;
  const emails = normaliseAlertEmails(alertSettings.emails || []).slice(0, 1);
  if (e1) e1.value = emails[0] || '';
  const svc = document.getElementById('ejsServiceId');
  const tpl = document.getElementById('ejsTemplateId');
  const pub = document.getElementById('ejsPublicKey');
  if (svc) svc.value = alertSettings.ejsServiceId || '';
  if (tpl) tpl.value = alertSettings.ejsTemplateId || '';
  if (pub) pub.value = alertSettings.ejsPublicKey || '';
  renderEmailDeliveryStatus();
}

function persistEmailTestStatus() {
  localStorage.setItem(EMAIL_TEST_STATUS_STORAGE, JSON.stringify(emailTestStatus));
}

function renderEmailDeliveryStatus() {
  const el = document.getElementById('emailDeliveryStatus');
  if (!el) return;
  if (!emailTestStatus || !emailTestStatus.ts) {
    el.textContent = 'No email test sent yet.';
    el.style.color = 'var(--muted)';
    return;
  }
  const when = new Date(emailTestStatus.ts).toLocaleString('en-GB');
  const status = emailTestStatus.ok ? 'SUCCESS' : 'FAILED';
  const detail = (emailTestStatus.detail || '').trim();
  el.textContent = `Last test: ${status} at ${when}${detail ? ` | ${detail}` : ''}`;
  el.style.color = emailTestStatus.ok ? 'var(--green)' : 'var(--red)';
}

function persistAlertSettings() {
  localStorage.setItem(ALERTS_STORAGE, JSON.stringify(alertSettings));
}

function updateAlertSettings() {
  alertSettings.browserEnabled = !!document.getElementById('browserAlertsEnabled')?.checked;
  alertSettings.emailEnabled = !!document.getElementById('emailAlertsEnabled')?.checked;
  alertSettings.hourlyReminderEnabled = !!document.getElementById('hourlyReminderEnabled')?.checked;
  alertSettings.emails = normaliseAlertEmails([
    document.getElementById('alertEmail1')?.value
  ]).slice(0, 1);
  alertSettings.ejsServiceId = (document.getElementById('ejsServiceId')?.value || '').trim();
  alertSettings.ejsTemplateId = (document.getElementById('ejsTemplateId')?.value || '').trim();
  alertSettings.ejsPublicKey = (document.getElementById('ejsPublicKey')?.value || '').trim();
  persistAlertSettings();
  toast(`Alert settings saved (${alertSettings.emails.length} recipient${alertSettings.emails.length===1?'':'s'})`,'success');
}

function buildReminderDigest() {
  const today = new Date().toISOString().split('T')[0];
  const due = schedules.filter(s => s.nextRun <= today);
  const upcoming = schedules
    .filter(s => s.nextRun > today)
    .sort((a,b) => String(a.nextRun).localeCompare(String(b.nextRun)))
    .slice(0, 5);

  if (!due.length && !upcoming.length) {
    return {
      subject: 'Compliance Reminder - No pending scheduled analyses',
      message: 'No due or upcoming scheduled analyses were found.',
      payload: { type: 'hourly-reminder', dueCount: 0, upcomingCount: 0 }
    };
  }

  const dueLines = due.map(s => `- DUE: ${s.label} (${s.area}) | next run ${s.nextRun}`);
  const upcomingLines = upcoming.map(s => `- Upcoming: ${s.label} (${s.area}) | next run ${s.nextRun}`);
  const lines = [
    `Due now: ${due.length}`,
    `Upcoming: ${upcoming.length}`,
    '',
    'Tasks / Reminders / Things to do:',
    ...dueLines,
    ...upcomingLines
  ];

  return {
    subject: `Compliance Reminder - ${due.length} due, ${upcoming.length} upcoming`,
    message: lines.join('\n'),
    payload: {
      type: 'hourly-reminder',
      dueCount: due.length,
      upcomingCount: upcoming.length,
      due: due.map(s => ({ id: s.id, label: s.label, area: s.area, nextRun: s.nextRun })),
      upcoming: upcoming.map(s => ({ id: s.id, label: s.label, area: s.area, nextRun: s.nextRun }))
    }
  };
}

async function runReminderCheck() {
  if (!alertSettings.hourlyReminderEnabled || !alertSettings.emailEnabled) return;
  const now = Date.now();
  const last = alertSettings.lastHourlyReminderTs ? new Date(alertSettings.lastHourlyReminderTs).getTime() : 0;
  if (last && (now - last) < REMINDER_INTERVAL_MS) return;

  const digest = buildReminderDigest();
  const result = await sendEmailAlert(digest.subject, digest.message, digest.payload);
  if (result && result.ok) {
    alertSettings.lastHourlyReminderTs = new Date().toISOString();
    persistAlertSettings();
  }
}

function startReminderTicker() {
  if (reminderTimer) clearInterval(reminderTimer);
  runReminderCheck();
  reminderTimer = setInterval(() => runReminderCheck(), 60000);
}

async function sendTestEmailAlert() {
  const e1 = document.getElementById('alertEmail1');
  const defaultEmail = 'fernanda.mejia@finegold.ae';
  if (e1 && !String(e1.value || '').trim()) e1.value = defaultEmail;

  updateAlertSettings();
  if (!alertSettings.emailEnabled) {
    toast('Enable email alerts first, then send test email','error', 3500);
    return;
  }

  const result = await sendEmailAlert(
    'Compliance Tasks Test Email',
    'This is a test email from Compliance Tasks alerts.',
    {
      test: true,
      environment: 'browser-app',
      requestedBy: 'fernanda.mejia@finegold.ae',
      sentAt: new Date().toISOString()
    }
  );
  emailTestStatus = {
    ok: !!result?.ok,
    ts: new Date().toISOString(),
    detail: result?.detail || ''
  };
  persistEmailTestStatus();
  renderEmailDeliveryStatus();
  if (result?.ok) toast('Test email sent via EmailJS','success', 3500);
  else toast('Test email failed. Check status details in Settings.','error', 4000);
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    toast('This browser does not support notifications','error');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission === 'granted') toast('Notification permission granted','success');
  else toast('Notification permission not granted','info');
}

function sendBrowserAlert(title, message) {
  if (!alertSettings.browserEnabled || !('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try { new Notification(title, { body: message }); } catch (_) {}
  }
}

function getEmailAlertFailureMeta(detail) {
  const text = String(detail || '').toLowerCase();
  const isClientAuthError =
    text.includes('unrecognized client_id') ||
    text.includes('invalid public key') ||
    text.includes('public key is invalid') ||
    text.includes('invalid client');
  const isOriginBlocked =
    text.includes('origin') && (text.includes('not allowed') || text.includes('denied') || text.includes('forbidden'));
  const isServiceOrTemplateError =
    text.includes('service') && text.includes('not found') ||
    text.includes('template') && text.includes('not found');
  const isRateLimit = text.includes('rate limit') || text.includes('too many requests');
  const isNetworkError = text.includes('network') || text.includes('failed to fetch') || text.includes('timeout');
  return { isClientAuthError, isOriginBlocked, isServiceOrTemplateError, isRateLimit, isNetworkError };
}

async function sendEmailAlert(subject, message, payload) {
  if (!alertSettings.emailEnabled) return;
  if (typeof emailjs === 'undefined') { console.warn('[Email] EmailJS not loaded'); return { ok: false, detail: 'EmailJS library not loaded' }; }
  const recipients = normaliseAlertEmails(alertSettings.emails || []).slice(0, 1);
  const { ejsServiceId, ejsTemplateId, ejsPublicKey } = alertSettings;
  if (!ejsServiceId || !ejsTemplateId || !ejsPublicKey || !recipients.length) {
    const missing = [];
    if (!recipients.length) missing.push('recipient email');
    if (!ejsServiceId) missing.push('Service ID');
    if (!ejsTemplateId) missing.push('Template ID');
    if (!ejsPublicKey) missing.push('Public Key');
    const detail = 'Missing: ' + missing.join(', ');
    toast('Email alerts: ' + detail + ' — check Settings','error', 5000);
    return { ok: false, detail };
  }
  try {
    emailjs.init({ publicKey: ejsPublicKey });
    const r = await emailjs.send(ejsServiceId, ejsTemplateId, {
      to_email: recipients[0],
      subject,
      message,
      from_name: 'Compliance Tasks Analyzer',
      reply_to: recipients[0],
      payload_json: JSON.stringify(payload || {}, null, 2)
    });
    return { ok: true, detail: `EmailJS: ${r.status} ${r.text}` };
  } catch (err) {
    const detail = err?.text || err?.message || String(err);
    const failureMeta = getEmailAlertFailureMeta(detail);
    if (failureMeta.isClientAuthError) {
      alertSettings.emailEnabled = false;
      persistAlertSettings();
      syncAlertSettingsUI();
      toast('Email alerts paused: EmailJS credentials rejected (client/public key). Update Settings and re-enable email alerts.','error', 7000);
    } else if (failureMeta.isOriginBlocked) {
      toast(`EmailJS blocked this origin (${window.location.origin}). Add it in EmailJS dashboard > Account > Security > Allowed origins.`, 'error', 8000);
    } else if (failureMeta.isServiceOrTemplateError) {
      toast('EmailJS service/template not found. Re-check Service ID and Template ID in Settings.','error', 7000);
    } else if (failureMeta.isRateLimit) {
      toast('EmailJS rate limit reached. Wait and retry in a few minutes.','error', 6000);
    } else if (failureMeta.isNetworkError) {
      toast('Network issue while sending email alert. Check internet or firewall and retry.','error', 6000);
    } else {
      toast('Email alert failed: ' + detail,'error', 5000);
    }
    return { ok: false, detail, fatalAuth: failureMeta.isClientAuthError };
  }
}

async function triggerAlert(subject, message, payload) {
  sendBrowserAlert(subject, message);
  await sendEmailAlert(subject, message, payload || {});
}

// ======= LIVE METALS =======
function setMetalsUiState(xau, xag, state, sourceLabel) {
  const xauEl = document.getElementById('xauPrice');
  const xagEl = document.getElementById('xagPrice');
  const xauState = document.getElementById('xauState');
  const xagState = document.getElementById('xagState');
  const xauMeta = document.getElementById('xauMeta');
  const xagMeta = document.getElementById('xagMeta');
  const src = document.getElementById('metalsSource');
  if (xauEl) xauEl.textContent = Number.isFinite(xau) ? `$${xau.toFixed(2)}` : '--';
  if (xagEl) xagEl.textContent = Number.isFinite(xag) ? `$${xag.toFixed(2)}` : '--';
  if (xauState) xauState.textContent = state || 'Live';
  if (xagState) xagState.textContent = state || 'Live';
  const ts = metalsLastUpdated ? new Date(metalsLastUpdated).toLocaleTimeString() : 'n/a';
  if (xauMeta) xauMeta.textContent = `Spot ounce · Updated ${ts}`;
  if (xagMeta) xagMeta.textContent = `Spot ounce · Updated ${ts}`;
  if (src) src.textContent = `Source: ${sourceLabel || 'n/a'}`;
  const liveBadge = document.getElementById('metalsLiveBadge');
  const liveDot = document.getElementById('metalsLiveDot');
  const liveText = document.getElementById('metalsLiveText');
  const isLive = (state || '').toLowerCase() === 'live';
  if (liveBadge) liveBadge.classList.toggle('offline', !isLive);
  if (liveText) liveText.textContent = isLive ? 'LIVE' : 'OFFLINE';
  if (liveDot) {
    liveDot.classList.remove('pulse');
    void liveDot.offsetWidth;
    liveDot.classList.add('pulse');
  }
}

function parseReutersMetals(html) {
  if (!html) return null;
  const cleaned = String(html).replace(/\s+/g, ' ');
  const xauMatch = cleaned.match(/XAU[^0-9]{0,20}([0-9]{3,5}(?:\.[0-9]+)?)/i) || cleaned.match(/Gold[^0-9]{0,30}([0-9]{3,5}(?:\.[0-9]+)?)/i);
  const xagMatch = cleaned.match(/XAG[^0-9]{0,20}([0-9]{1,4}(?:\.[0-9]+)?)/i) || cleaned.match(/Silver[^0-9]{0,30}([0-9]{1,4}(?:\.[0-9]+)?)/i);
  const xau = xauMatch ? Number(xauMatch[1]) : NaN;
  const xag = xagMatch ? Number(xagMatch[1]) : NaN;
  if (!Number.isFinite(xau) || !Number.isFinite(xag)) return null;
  return { xau, xag, source: 'Reuters (proxy parse)' };
}

async function fetchReutersMetals() {
  const reutersUrl = 'https://www.reuters.com/markets/commodities/';
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(reutersUrl)}&t=${Date.now()}`;
  const r = await fetch(proxyUrl, { cache: 'no-store' });
  if (!r.ok) throw new Error('Reuters source unavailable');
  const html = await r.text();
  const parsed = parseReutersMetals(html);
  if (!parsed) throw new Error('Reuters parse failed');
  return parsed;
}

async function fetchFallbackMetals() {
  const r = await fetch(`https://api.metals.live/v1/spot?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('Fallback source unavailable');
  const data = await r.json();
  const rows = Array.isArray(data) ? data : [];
  const xauRow = rows.find(v => typeof v === 'object' && v && Object.prototype.hasOwnProperty.call(v,'gold'));
  const xagRow = rows.find(v => typeof v === 'object' && v && Object.prototype.hasOwnProperty.call(v,'silver'));
  const xau = Number(xauRow?.gold);
  const xag = Number(xagRow?.silver);
  if (!Number.isFinite(xau) || !Number.isFinite(xag)) throw new Error('Fallback parse failed');
  return { xau, xag, source: 'metals.live fallback' };
}

async function fetchGoldPriceOrg() {
  const r = await fetch(`https://data-asg.goldprice.org/dbXRates/USD?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('GoldPrice.org source unavailable');
  const data = await r.json();
  const items = data?.items || [];
  const row = items[0];
  if (!row) throw new Error('GoldPrice.org no data');
  const xau = Number(row.xauPrice);
  const xag = Number(row.xagPrice);
  if (!Number.isFinite(xau) || !Number.isFinite(xag)) throw new Error('GoldPrice.org parse failed');
  return { xau, xag, source: 'goldprice.org' };
}

async function fetchGoldApiMetals() {
  const [xauR, xagR] = await Promise.all([
    fetch(`https://api.gold-api.com/price/XAU?t=${Date.now()}`, { cache: 'no-store' }),
    fetch(`https://api.gold-api.com/price/XAG?t=${Date.now()}`, { cache: 'no-store' })
  ]);
  if (!xauR.ok || !xagR.ok) throw new Error('Gold API source unavailable');
  const [xauD, xagD] = await Promise.all([xauR.json(), xagR.json()]);
  const xau = Number(xauD?.price ?? xauD?.value ?? xauD?.ask);
  const xag = Number(xagD?.price ?? xagD?.value ?? xagD?.ask);
  if (!Number.isFinite(xau) || !Number.isFinite(xag)) throw new Error('Gold API parse failed');
  return { xau, xag, source: 'gold-api.com' };
}

async function fetchMetalPriceApi() {
  var metalPriceKey = (typeof METAL_PRICE_API_KEY !== 'undefined' && METAL_PRICE_API_KEY) || 'demo';
  const r = await fetch(`https://api.metalpriceapi.com/v1/latest?api_key=${encodeURIComponent(metalPriceKey)}&base=USD&currencies=XAU,XAG&t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('MetalPriceAPI unavailable');
  const data = await r.json();
  if (!data.success && !data.rates) throw new Error('MetalPriceAPI no data');
  const rates = data.rates || {};
  const xau = rates.USDXAU ? 1 / rates.USDXAU : NaN;
  const xag = rates.USDXAG ? 1 / rates.USDXAG : NaN;
  if (!Number.isFinite(xau) || !Number.isFinite(xag)) throw new Error('MetalPriceAPI parse failed');
  return { xau, xag, source: 'metalpriceapi.com' };
}

async function fetchForexRateApi() {
  const r = await fetch(`https://open.er-api.com/v6/latest/XAU?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('ExchangeRate API unavailable');
  const data = await r.json();
  if (data.result !== 'success') throw new Error('ExchangeRate API error');
  const xauUsd = data.rates?.USD;
  if (!xauUsd) throw new Error('No XAU/USD rate');
  // Fetch silver separately
  const r2 = await fetch(`https://open.er-api.com/v6/latest/XAG?t=${Date.now()}`, { cache: 'no-store' });
  const data2 = await r2.json();
  const xagUsd = data2.rates?.USD || NaN;
  if (!Number.isFinite(xauUsd) || !Number.isFinite(xagUsd)) throw new Error('ExchangeRate parse failed');
  return { xau: xauUsd, xag: xagUsd, source: 'open.er-api.com' };
}

async function fetchMetalsViaProxy() {
  if (!PROXY_URL) throw new Error('No proxy');
  const r = await fetch(PROXY_URL + '/metals/prices', { cache: 'no-store' });
  if (!r.ok) throw new Error(`Proxy metals: ${r.status}`);
  const data = await r.json();
  const xau = Number(data.xau ?? data.gold ?? data.XAU);
  const xag = Number(data.xag ?? data.silver ?? data.XAG);
  if (!Number.isFinite(xau) || !Number.isFinite(xag)) throw new Error('Proxy metals parse failed');
  return { xau, xag, source: 'proxy' };
}

async function fetchMetalsAllOrigins() {
  const apiUrl = 'https://api.metals.live/v1/spot';
  const r = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(apiUrl)}&t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('AllOrigins metals unavailable');
  const data = await r.json();
  const rows = Array.isArray(data) ? data : [];
  const xauRow = rows.find(v => typeof v === 'object' && v && Object.prototype.hasOwnProperty.call(v, 'gold'));
  const xagRow = rows.find(v => typeof v === 'object' && v && Object.prototype.hasOwnProperty.call(v, 'silver'));
  const xau = Number(xauRow?.gold);
  const xag = Number(xagRow?.silver);
  if (!Number.isFinite(xau) || !Number.isFinite(xag)) throw new Error('AllOrigins metals parse failed');
  return { xau, xag, source: 'metals.live (cors proxy)' };
}

async function refreshMetalsPrices(showToast) {
  if (metalsFetchInFlight) return;
  metalsFetchInFlight = true;
  const src = document.getElementById('metalsSource');
  if (src) src.textContent = 'Source: Updating...';
  const sources = [fetchMetalsViaProxy, fetchMetalsAllOrigins, fetchGoldPriceOrg, fetchGoldApiMetals, fetchFallbackMetals, fetchMetalPriceApi, fetchForexRateApi, fetchReutersMetals];
  let quote = null;
  for (const fn of sources) {
    try { quote = await fn(); break; } catch (e) { /* try next */ }
  }
  if (quote) {
    metalsLastUpdated = Date.now();
    setMetalsUiState(quote.xau, quote.xag, 'Live', quote.source);
    if (showToast) toast('XAU/XAG prices updated','success');
  } else {
    setMetalsUiState(NaN, NaN, 'Unavailable', 'All sources unavailable');
    if (showToast) toast('Price update failed. Please retry in a few seconds.','error', 4000);
  }
  metalsFetchInFlight = false;
}

// ======= SHIPMENTS =======
function getShipmentFormValue(id) {
  return (document.getElementById(id)?.value || '').trim();
}

function clearShipmentForm() {
  ['shInvoiceNo','shSupplierCustomer','shProductBrand','shCurrency','shCddReviewDate','shRiskRating','shOriginCountry','shSubSupplierInvoice','shMaterial','shDeliveryNote','shTaxInvoice','shCollectionNote','shBrinksLoomisLoi','shPackingList','shBarList','shAwbBill','shCustomerInvoice','shCertificateOrigin','shTransportationOrder','shFolderNo','shAmount','shSoc','shConsignee','shCustomBoe','shAdvancePayment','shShipmentClearance','shTfsCompletedAt','shScreeningSystem','shFalsePositiveResolution'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'SELECT') el.value = '';
    else el.value = '';
  });
  const tfsCheck = document.getElementById('shTfsCompleted');
  if (tfsCheck) tfsCheck.checked = false;
}

function onTFSToggle() {
  const cb = document.getElementById('shTfsCompleted');
  const ts = document.getElementById('shTfsCompletedAt');
  if (!cb || !ts) return;
  if (cb.checked) {
    const now = new Date().toISOString();
    ts.value = now;
  } else {
    ts.value = '';
  }
}

function setCDDToday() {
  const el = document.getElementById('shCddReviewDate');
  if (!el) return;
  el.value = new Date().toISOString().split('T')[0];
}

function setShipmentFormMode(isEdit) {
  const saveBtn = document.getElementById('shSaveBtn');
  const cancelBtn = document.getElementById('shCancelEditBtn');
  if (saveBtn) saveBtn.textContent = isEdit ? 'Update Shipment' : 'Add Shipment';
  if (cancelBtn) cancelBtn.style.display = isEdit ? 'inline-block' : 'none';
}

function startEditShipment(id) {
  const s = shipments.find(x => x.id === id);
  if (!s) return;
  editingShipmentId = id;
  const fieldMap = {
    shInvoiceNo: s.invoiceNo,
    shSupplierCustomer: s.supplierCustomer,
    shProductBrand: s.productBrand,
    shCurrency: s.currency,
    shCddReviewDate: s.cddReviewDate,
    shRiskRating: s.riskRating,
    shOriginCountry: s.originCountry,
    shSubSupplierInvoice: s.subSupplierInvoice,
    shMaterial: s.material,
    shDeliveryNote: s.deliveryNote,
    shTaxInvoice: s.taxInvoice,
    shCollectionNote: s.collectionNote,
    shBrinksLoomisLoi: s.brinksLoomisLoi,
    shPackingList: s.packingList,
    shBarList: s.barList,
    shAwbBill: s.awbBill,
    shCustomerInvoice: s.customerInvoice,
    shCertificateOrigin: s.certificateOrigin,
    shTransportationOrder: s.transportationOrder,
    shFolderNo: s.folderNo,
    shAmount: s.amount,
    shSoc: s.soc,
    shTfsCompletedAt: s.tfsCompletedAt,
    shScreeningSystem: s.screeningSystem,
    shFalsePositiveResolution: s.falsePositiveResolution,
    shConsignee: s.consignee,
    shCustomBoe: s.customBoe,
    shAdvancePayment: s.advancePayment,
    shShipmentClearance: s.shipmentClearance
  };
  Object.entries(fieldMap).forEach(([idKey, val]) => {
    const el = document.getElementById(idKey);
    if (el) el.value = val || '';
  });
  setShipmentFormMode(true);
  toast('Shipment loaded for editing','info');
}

function cancelShipmentEdit() {
  editingShipmentId = null;
  clearShipmentForm();
  setShipmentFormMode(false);
}

function evaluateShipmentRisk(sh) {
  let score = 0;
  const reasons = [];
  const amount = Number(sh.amount || 0);

  if (!sh.invoiceNo) { score += 1; reasons.push('Invoice No is missing'); }
  if (!sh.supplierCustomer) { score += 1; reasons.push('Supplier/Customer is missing'); }
  if (!sh.productBrand) { score += 1; reasons.push('Product/Brand is missing'); }
  if (!sh.currency) { score += 1; reasons.push('Currency is missing'); }
  if (!sh.material) { score += 1; reasons.push('Material is missing'); }
  if (!sh.folderNo) { score += 1; reasons.push('Internal Folder No is missing'); }
  if (!sh.cddReviewDate) { score += 1; reasons.push('Last CDD Review Date is missing'); }
  if (!sh.riskRating) { score += 1; reasons.push('Risk Rating is missing'); }
  if (!sh.tfsCompleted) { score += 3; reasons.push('TFS Screening not completed before processing'); }
  if (sh.tfsCompleted && !sh.screeningSystem) { score += 1; reasons.push('Screening system not specified'); }

  const checklist = [
    ['subSupplierInvoice', 'Sub Supplier/Invoice'],
    ['deliveryNote', 'Delivery Note'],
    ['taxInvoice', 'Tax Invoice'],
    ['collectionNote', 'Collection Note'],
    ['brinksLoomisLoi', 'Brinks/Loomis LOI Release'],
    ['packingList', 'Packing List'],
    ['barList', 'Bar List'],
    ['awbBill', 'AWB Bill'],
    ['customerInvoice', 'Customer Invoice'],
    ['certificateOrigin', 'Certificate of Origin'],
    ['transportationOrder', 'Transportation Order'],
    ['soc', 'SOC']
  ];

  checklist.forEach(([key, label]) => {
    const v = sh[key];
    if (!v || v === 'Pending') { score += 1; reasons.push(`${label} is pending`); }
    if (v === 'N/A') { score += 0.5; reasons.push(`${label} marked N/A`); }
  });

  if (amount >= 500000) { score += 3; reasons.push('Amount exceeds 500,000'); }
  else if (amount >= 100000) { score += 2; reasons.push('Amount exceeds 100,000'); }

  var cfg = typeof complianceConfig !== 'undefined' ? complianceConfig : { riskCritical: 12, riskHigh: 8, riskMedium: 4 };
  if (score >= cfg.riskCritical) return { level: 'CRITICAL', score, reasons };
  if (score >= cfg.riskHigh) return { level: 'HIGH', score, reasons };
  if (score >= cfg.riskMedium) return { level: 'MEDIUM', score, reasons };
  return { level: 'LOW', score, reasons };
}

async function processAsanaRetryQueue(silent = true) {
  ensureAsanaSyncStateShape();
  if (!asanaSyncState.retryQueue.length) return;
  const queue = [...asanaSyncState.retryQueue];
  const remaining = [];
  let completed = 0;
  setAsanaModuleSync('writeback', { status: 'Retrying', lastError: '' });

  for (const item of queue) {
    try {
      if (item.kind === 'manual-task-create' || item.kind === 'workflow-task-create') {
        const r = await asanaFetch('/tasks', { method: 'POST', body: JSON.stringify(item.body) });
        const d = await r.json();
        if (d.errors) throw new Error(d.errors[0]?.message || 'Asana error');
        const taskGid = d.data?.gid;
        if (item.sectionGid && taskGid) {
          await asanaFetch(`/sections/${item.sectionGid}/addTask`, {
            method: 'POST',
            body: JSON.stringify({ data: { task: taskGid } })
          });
        }
      }
      completed += 1;
    } catch (e) {
      remaining.push(Object.assign({}, item, { lastError: String(e.message || e), attempts: Number(item.attempts || 0) + 1, ts: new Date().toISOString() }));
    }
  }

  asanaSyncState.retryQueue = remaining.slice(0, 40);
  persistAsanaSyncState();
  renderShipments();
  setAsanaModuleSync('writeback', {
    status: remaining.length ? 'Degraded' : 'Healthy',
    lastSuccess: completed ? new Date().toISOString() : asanaSyncState.modules.writeback.lastSuccess,
    lastError: remaining[0]?.lastError || '',
    lastCount: completed
  });
  if (!silent && (completed || remaining.length)) toast(`Retry queue processed: ${completed} completed, ${remaining.length} remaining`, remaining.length ? 'info' : 'success', 4000);
}

async function pushConnectedAppEvent(eventType, shipment) {
  if (!alertSettings.webhookUrl) return;
  try {
    var webhookUrl = alertSettings.webhookUrl;
    if (!/^https?:\/\//i.test(webhookUrl)) { console.warn('[Webhook] Invalid URL scheme:', webhookUrl); return; }
    var controller = new AbortController();
    var timeout = setTimeout(function() { controller.abort(); }, 10000);
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        kind: 'shipment-sync',
        eventType: eventType,
        shipment: shipment,
        source: 'Compliance Tasks Hawkeye Sterling V2',
        ts: new Date().toISOString()
      })
    });
    clearTimeout(timeout);
  } catch(e) { console.warn('[Webhook] Push failed:', e); }
}

function refreshShipmentData() {
  shipments = safeScopedParse(SHIPMENTS_STORAGE, []);
  renderShipments();
  toast('Shipment data refreshed', 'success');
}

async function addShipment() {
  const shipment = {
    id: Date.now(),
    customerId: '',
    direction: '',
    currency: getShipmentFormValue('shCurrency'),
    cddReviewDate: getShipmentFormValue('shCddReviewDate'),
    riskRating: getShipmentFormValue('shRiskRating'),
    originCountry: getShipmentFormValue('shOriginCountry'),
    destinationCountry: '',
    invoiceNo: getShipmentFormValue('shInvoiceNo'),
    supplierCustomer: getShipmentFormValue('shSupplierCustomer'),
    productBrand: getShipmentFormValue('shProductBrand'),
    subSupplierInvoice: getShipmentFormValue('shSubSupplierInvoice'),
    material: getShipmentFormValue('shMaterial'),
    deliveryNote: getShipmentFormValue('shDeliveryNote'),
    taxInvoice: getShipmentFormValue('shTaxInvoice'),
    collectionNote: getShipmentFormValue('shCollectionNote'),
    brinksLoomisLoi: getShipmentFormValue('shBrinksLoomisLoi'),
    packingList: getShipmentFormValue('shPackingList'),
    barList: getShipmentFormValue('shBarList'),
    awbBill: getShipmentFormValue('shAwbBill'),
    customerInvoice: getShipmentFormValue('shCustomerInvoice'),
    certificateOrigin: getShipmentFormValue('shCertificateOrigin'),
    transportationOrder: getShipmentFormValue('shTransportationOrder'),
    folderNo: getShipmentFormValue('shFolderNo'),
    amount: getShipmentFormValue('shAmount'),
    soc: getShipmentFormValue('shSoc'),
    consignee: getShipmentFormValue('shConsignee'),
    customBoe: getShipmentFormValue('shCustomBoe'),
    advancePayment: getShipmentFormValue('shAdvancePayment'),
    shipmentClearance: getShipmentFormValue('shShipmentClearance'),
    tfsCompleted: !!document.getElementById('shTfsCompleted')?.checked,
    tfsCompletedAt: getShipmentFormValue('shTfsCompletedAt'),
    screeningSystem: getShipmentFormValue('shScreeningSystem'),
    falsePositiveResolution: getShipmentFormValue('shFalsePositiveResolution'),
    createdAt: new Date().toISOString(),
    syncStatus: 'Pending',
    syncMessage: ''
  };

  if (!shipment.amount || isNaN(Number(shipment.amount)) || Number(shipment.amount) <= 0) {
    toast('Amount is required','error');
    return;
  }
  if (!shipment.tfsCompleted) {
    toast('TFS Screening must be completed before processing shipment','error');
    return;
  }
  if (!shipment.screeningSystem) {
    toast('Select Screening System Used for TFS compliance','error');
    return;
  }

  const risk = evaluateShipmentRisk(shipment);
  shipment.riskLevel = risk.level;
  shipment.riskScore = risk.score;
  shipment.riskReasons = risk.reasons;

  const isEdit = editingShipmentId !== null;
  if (isEdit) shipment.id = editingShipmentId;

  if (isEdit) {
    shipments = shipments.map(s => s.id === editingShipmentId ? shipment : s);
  } else {
    shipments.unshift(shipment);
  }
  window.shipments = shipments;
  setScopedJson(SHIPMENTS_STORAGE, shipments);
  renderShipments();
  cancelShipmentEdit();

  toast(`Shipment ${isEdit ? 'updated' : 'added'} (${risk.level})`, risk.level === 'CRITICAL' || risk.level === 'HIGH' ? 'error' : 'success');

  if (risk.level === 'CRITICAL' || risk.level === 'HIGH') {
    triggerAlert(
      `Shipment Risk Alert: ${risk.level}`,
      `Amount ${shipment.amount} with score ${risk.score}`,
      { type: 'shipment-risk', shipment }
    );
  }
}

async function deleteShipment(id) {
  if (!confirm('Are you sure you want to delete this shipment?')) return;
  const toDelete = shipments.find(s => s.id === id);
  if (!toDelete) return;

  try {
    await pushConnectedAppEvent('deleted', toDelete);
  } catch (e) {
    console.warn('Connected app sync failed on delete:', e.message);
  }

  shipments = shipments.filter(s => s.id !== id);
  window.shipments = shipments;
  setScopedJson(SHIPMENTS_STORAGE, shipments);
  renderShipments();
  toast('Shipment removed','info');
}

function clearShipments() {
  if (!confirm('This will remove all shipment records. Continue?')) return;
  shipments = [];
  window.shipments = shipments;
  setScopedJson(SHIPMENTS_STORAGE, shipments);
  cancelShipmentEdit();
  renderShipments();
  toast('All shipment records cleared','info');
}

function exportShipmentsCSV() {
  if (!shipments.length) { toast('No shipment records to export','info'); return; }
  const headers = ['Customer ID','Shipment Direction','Currency','Material','Last CDD Review Date','Risk Rating','Origin Country','Destination Country','Invoice No','Supplier/Customer','Product/Brand','Sub Supplier/Invoice','Delivery Note','Tax Invoice','Collection Note','Brinks/Loomis LOI Release','Packing List','Bar List','AWB Bill','Customer Invoice','Certificate of Origin','Transportation Order','Internal Folder No','Amount','SOC','Consignee','Custom (BOE)','Advance Payment','Shipment Clearance','TFS Screening Completed','TFS Completion Timestamp','Screening System Used','False Positive Resolution','Risk Level','Risk Score','Created At'];
  const rows = [headers];
  shipments.forEach(s => {
    rows.push([
      s.customerId || '', s.direction || '', s.currency || '', s.material || '', s.cddReviewDate || '', s.riskRating || '', s.originCountry || '', s.destinationCountry || '',
      s.invoiceNo || '', s.supplierCustomer || '', s.productBrand || '', s.subSupplierInvoice || '',
      s.deliveryNote || '', s.taxInvoice || '', s.collectionNote || '', s.brinksLoomisLoi || '',
      s.packingList || '', s.barList || '', s.awbBill || '', s.customerInvoice || '',
      s.certificateOrigin || '', s.transportationOrder || '', s.folderNo || '', s.amount || '', s.soc || '',
      s.consignee || '', s.customBoe || '', s.advancePayment || '', s.shipmentClearance || '',
      s.tfsCompleted ? 'Yes' : 'No', s.tfsCompletedAt || '', s.screeningSystem || '', s.falsePositiveResolution || '',
      s.riskLevel || '', String(s.riskScore || 0), s.createdAt || ''
    ]);
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ComplianceTasks_Shipments_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  toast('Shipment register exported','success');
}

function shipmentTableHTML(list, title) {
  const company = getActiveCompany();
  const headers = ['Invoice No','Supplier/Customer','Product/Brand','Material','Amount','Currency','SOC','Origin','Destination','Risk Rating','Risk Score','TFS Screening','Created'];
  let html = wordDocHeader(title || 'Shipment Register');
  html += '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:10px">';
  html += '<tr>' + headers.map(h => '<th style="background:#B4975A;color:#fff;padding:6px;text-align:left">' + h + '</th>').join('') + '</tr>';
  list.forEach((s, i) => {
    const bg = i % 2 === 0 ? '#fff' : '#f5f5f5';
    html += '<tr style="background:' + bg + '">';
    html += '<td style="padding:4px">' + escHtml(s.invoiceNo) + '</td>';
    html += '<td style="padding:4px">' + escHtml(s.supplierCustomer) + '</td>';
    html += '<td style="padding:4px">' + escHtml(s.productBrand) + '</td>';
    html += '<td style="padding:4px">' + escHtml(s.material) + '</td>';
    html += '<td style="padding:4px">' + escHtml(s.amount) + '</td>';
    html += '<td style="padding:4px">' + escHtml(s.currency) + '</td>';
    html += '<td style="padding:4px">' + escHtml(s.soc) + '</td>';
    html += '<td style="padding:4px">' + escHtml(s.originCountry) + '</td>';
    html += '<td style="padding:4px">' + escHtml(s.destinationCountry) + '</td>';
    html += '<td style="padding:4px">' + escHtml(s.riskRating) + '</td>';
    html += '<td style="padding:4px">' + (s.riskScore || 0) + '</td>';
    html += '<td style="padding:4px">' + (s.tfsCompleted ? 'Yes' : 'No') + '</td>';
    html += '<td style="padding:4px">' + escHtml(s.createdAt ? s.createdAt.split('T')[0] : '') + '</td>';
    html += '</tr>';
  });
  html += '</table>';
  html += '<p style="margin-top:16px;font-size:9px;color:#888">Total records: ' + list.length + ' | Generated: ' + new Date().toLocaleDateString('en-GB') + '</p>';
  html += wordDocFooter();
  return html;
}

function exportShipmentsDOCX() {
  if (!shipments.length) { toast('No shipment records to export','info'); return; }
  const html = shipmentTableHTML(shipments, 'IAR Shipment Register');
  downloadWordDoc(html, 'IAR_Shipments_' + new Date().toISOString().slice(0,10) + '.doc');
  toast('Word export complete','success');
}

function exportShipmentsExcel() {
  if (!shipments.length) { toast('No shipment records to export','info'); return; }
  const headers = ['Invoice No','Supplier/Customer','Product/Brand','Material','Sub Supplier','Amount','SOC','Currency','Origin Country','Destination Country','Risk Rating','Risk Score','TFS Screening','Screening System','Created At'];
  let xml = '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>';
  xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">';
  xml += '<Styles><Style ss:ID="hdr"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#B4975A" ss:Pattern="Solid"/></Style></Styles>';
  xml += '<Worksheet ss:Name="Shipments"><Table>';
  xml += '<Row>' + headers.map(h => '<Cell ss:StyleID="hdr"><Data ss:Type="String">' + escHtml(h) + '</Data></Cell>').join('') + '</Row>';
  shipments.forEach(s => {
    xml += '<Row>';
    xml += '<Cell><Data ss:Type="String">' + escHtml(s.invoiceNo) + '</Data></Cell>';
    xml += '<Cell><Data ss:Type="String">' + escHtml(s.supplierCustomer) + '</Data></Cell>';
    xml += '<Cell><Data ss:Type="String">' + escHtml(s.productBrand) + '</Data></Cell>';
    xml += '<Cell><Data ss:Type="String">' + escHtml(s.material) + '</Data></Cell>';
    xml += '<Cell><Data ss:Type="String">' + escHtml(s.subSupplierInvoice) + '</Data></Cell>';
    xml += '<Cell><Data ss:Type="Number">' + (s.amount || 0) + '</Data></Cell>';
    xml += '<Cell><Data ss:Type="String">' + escHtml(s.soc) + '</Data></Cell>';
    xml += '<Cell><Data ss:Type="String">' + escHtml(s.currency) + '</Data></Cell>';
    xml += '<Cell><Data ss:Type="String">' + escHtml(s.originCountry) + '</Data></Cell>';
    xml += '<Cell><Data ss:Type="String">' + escHtml(s.destinationCountry) + '</Data></Cell>';
    xml += '<Cell><Data ss:Type="String">' + escHtml(s.riskRating) + '</Data></Cell>';
    xml += '<Cell><Data ss:Type="Number">' + (s.riskScore || 0) + '</Data></Cell>';
    xml += '<Cell><Data ss:Type="String">' + (s.tfsCompleted ? 'Yes' : 'No') + '</Data></Cell>';
    xml += '<Cell><Data ss:Type="String">' + escHtml(s.screeningSystem) + '</Data></Cell>';
    xml += '<Cell><Data ss:Type="String">' + escHtml(s.createdAt) + '</Data></Cell>';
    xml += '</Row>';
  });
  xml += '</Table></Worksheet></Workbook>';
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'IAR_Shipments_' + new Date().toISOString().slice(0,10) + '.xls'; a.click();
  toast('Excel export complete','success');
}

function exportShipmentsPDF() {
  if (!requireJsPDF()) return;
  if (!shipments.length) { toast('No shipment records to export','info'); return; }
  const html = shipmentTableHTML(shipments, 'IAR Shipment Register');
  const win = window.open('', '_blank');
  if (!win) { toast('Pop-up blocked — allow pop-ups for this site','error'); return; }
  win.document.write(html + '<script>setTimeout(function(){window.print();},500)<\/script>');
  win.document.close();
  toast('PDF print dialog opened','success');
}

function countShipmentDataGaps(s) {
  const keys = [
    'invoiceNo','supplierCustomer','productBrand','customerId','direction','currency','material',
    'cddReviewDate','screeningSystem','subSupplierInvoice','deliveryNote','taxInvoice','collectionNote','brinksLoomisLoi','packingList',
    'barList','awbBill','customerInvoice','certificateOrigin','transportationOrder','folderNo','soc'
  ];
  let gaps = 0;
  keys.forEach((k) => {
    const v = s[k];
    if (!v || v === 'Pending' || v === 'N/A') gaps += 1;
  });
  return gaps;
}

function buildTransactionMonitoringFindings() {
  const findings = [];
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const reportingThreshold = 50000;
  const cahras = ['afghanistan','democratic republic of congo','drc','south sudan','sudan','yemen','myanmar','syria','iraq','iran','libya','somalia','central african republic'];

  shipments.forEach((s) => {
    const amount = Number(s.amount || 0);
    const gaps = countShipmentDataGaps(s);
    const threshold = s.riskRating === 'High' ? 50000 : s.riskRating === 'Low' ? 200000 : 100000;
    const origin = String(s.originCountry || '').toLowerCase();
    const destination = String(s.destinationCountry || '').toLowerCase();

    if ((s.riskLevel === 'CRITICAL' || amount >= 500000) && gaps >= 4) {
      findings.push({
        level: 'CRITICAL',
        reportType: 'STR',
        title: `High-value shipment with significant documentation gaps`,
        detail: `Customer ID ${s.customerId || 'NO-ID'} | Amount ${amount} ${s.currency || ''} | Gaps ${gaps}`,
        recommendation: 'Suggested STR: suspicious completed transaction pattern with material red flags. Include full transaction trail and supporting evidence in GOAML filing.'
      });
    }

    if (amount >= 100000 && amount % 10000 === 0) {
      findings.push({
        level: 'MEDIUM',
        reportType: 'SAR',
        title: 'Rounded high-value transaction pattern detected',
        detail: `Customer ID ${s.customerId || 'NO-ID'} | Amount ${amount} ${s.currency || ''}`,
        recommendation: 'Suggested SAR: monitor for structuring behavior and escalate to STR if transaction intent/evidence confirms suspicion.'
      });
    }

    if (amount > threshold) {
      findings.push({
        level: 'HIGH',
        reportType: 'STR',
        title: 'High-value transaction above customer risk threshold',
        detail: `Customer ID ${s.customerId || 'NO-ID'} | Amount ${amount} ${s.currency || ''} | Risk Rating ${s.riskRating || 'N/A'} | Threshold ${threshold}`,
        recommendation: 'Suggested STR: threshold breach indicates elevated ML/TF exposure. Document rationale, approvals, and supporting screening evidence.'
      });
    }

    if (!s.tfsCompleted || !s.screeningSystem) {
      findings.push({
        level: 'CRITICAL',
        reportType: 'SAR',
        title: 'TFS control gap detected before shipment processing',
        detail: `Customer ID ${s.customerId || 'NO-ID'} | TFS completed: ${s.tfsCompleted ? 'Yes' : 'No'} | System: ${s.screeningSystem || 'N/A'}`,
        recommendation: 'Suggested SAR: control deficiency with potential sanctions exposure. Stop processing until TFS controls are documented and cleared.'
      });
    }

    if (cahras.some(c => origin.includes(c) || destination.includes(c))) {
      findings.push({
        level: 'HIGH',
        reportType: 'SAR',
        title: 'CAHRA origin/destination detected',
        detail: `Customer ID ${s.customerId || 'NO-ID'} | Origin ${s.originCountry || 'N/A'} | Destination ${s.destinationCountry || 'N/A'}`,
        recommendation: 'Suggested SAR: enhanced due diligence required for CAHRA-linked corridor. Validate supply-chain provenance and counterpart screening outcomes.'
      });
    }
  });

  const grouped = {};
  shipments.forEach((s) => {
    const key = `${s.customerId || 'NO-ID'}|${s.supplierCustomer || 'Unknown Supplier/Customer'}`;
    if (!grouped[key]) grouped[key] = { customerId: s.customerId || 'NO-ID', supplierCustomer: s.supplierCustomer || 'Unknown Supplier/Customer', total: 0, recent: 0, highRisk: 0, highValue: 0 };
    grouped[key].total += 1;
    const ts = new Date(s.createdAt || 0).getTime();
    if (ts >= sevenDaysAgo) grouped[key].recent += 1;
    if (s.riskLevel === 'HIGH' || s.riskLevel === 'CRITICAL') grouped[key].highRisk += 1;
    if (Number(s.amount || 0) >= 100000) grouped[key].highValue += 1;
  });

  Object.values(grouped).forEach((c) => {
    if (c.recent >= 5) {
      findings.push({
        level: 'HIGH',
        reportType: 'SAR',
        title: 'Rapid shipment velocity in 7-day window',
        detail: `${c.supplierCustomer} (${c.customerId}) | ${c.recent} shipments in 7 days`,
        recommendation: 'Suggested SAR: unusual customer behavior pattern. Increase enhanced monitoring and review source of funds/source of wealth evidence.'
      });
    }
    if (c.highRisk >= 3 || c.highValue >= 3) {
      findings.push({
        level: 'HIGH',
        reportType: 'STR',
        title: 'Repeated high-risk/high-value transactions for same customer',
        detail: `${c.supplierCustomer} (${c.customerId}) | High-risk: ${c.highRisk}, High-value: ${c.highValue}`,
        recommendation: 'Suggested STR: repeated suspicious transaction behavior observed. Prepare consolidated transaction narrative and supporting documents for FIU submission.'
      });
    }

    // Structuring: repeated shipments just below reporting threshold.
    const sameCustomer = shipments.filter(s => (s.customerId || 'NO-ID') === c.customerId);
    const nearThreshold = sameCustomer.filter(s => {
      const amt = Number(s.amount || 0);
      return amt >= (reportingThreshold * 0.85) && amt < reportingThreshold;
    });
    if (nearThreshold.length >= 3) {
      findings.push({
        level: 'HIGH',
        reportType: 'STR',
        title: 'Structuring pattern detected below reporting threshold',
        detail: `${c.supplierCustomer} (${c.customerId}) | ${nearThreshold.length} shipments between ${Math.round(reportingThreshold * 0.85)} and ${reportingThreshold}`,
        recommendation: 'Suggested STR: repeated near-threshold transaction values indicate potential structuring. Compile timeline and transaction linkage analysis.'
      });
    }

    // Unusual velocity: recent 7-day volume significantly above baseline.
    const older = Math.max(c.total - c.recent, 0);
    const baselineWeekly = Math.max(older / 4, 1);
    if (c.recent >= 4 && c.recent > baselineWeekly * 2) {
      findings.push({
        level: 'HIGH',
        reportType: 'SAR',
        title: 'Unusual transaction velocity versus customer baseline',
        detail: `${c.supplierCustomer} (${c.customerId}) | Recent 7d: ${c.recent} | Baseline weekly: ${baselineWeekly.toFixed(1)}`,
        recommendation: 'Suggested SAR: velocity spike inconsistent with expected behavior. Document trigger rationale and enhanced monitoring actions.'
      });
    }
  });

  return findings.slice(0, 20);
}

function renderTransactionMonitoring() {
  const el = document.getElementById('shipmentMonitoringSummary');
  if (!el) return;

  const findings = buildTransactionMonitoringFindings();
  if (!findings.length) {
    el.innerHTML = '<p style="color:var(--green);font-size:13px">No red-flag thresholds triggered based on current shipment data.</p>';
    return;
  }

  const sarCount = findings.filter(f => f.reportType === 'SAR').length;
  const strCount = findings.filter(f => f.reportType === 'STR').length;
  const rows = findings.map((f) => {
    const cls = f.level === 'CRITICAL' ? 's-overdue' : f.level === 'HIGH' ? 's-due' : 's-ok';
    return `<div class="asana-item" style="grid-template-columns:1fr auto;gap:10px">
      <div>
        <div class="asana-name">${escHtml(f.title)}</div>
        <div class="asana-meta">${escHtml(f.detail)}</div>
        <div class="token-note" style="margin-top:6px">${escHtml(f.recommendation)}</div>
      </div>
      <span class="asana-status ${cls}">${escHtml(f.reportType)}</span>
    </div>`;
  }).join('');

  el.innerHTML = `<div style="margin-bottom:8px;font-size:11px;color:var(--muted);font-family:'Montserrat',sans-serif">Suggested filings -> SAR: ${sarCount} | STR: ${strCount}</div>${rows}`;
}

function renderShipments() {
  const list = document.getElementById('shipmentsList');
  const metrics = document.getElementById('shipmentMetrics');
  const meta = document.getElementById('shipmentCountMeta');
  const customerSummary = document.getElementById('customerShipmentSummary');
  if (!list || !metrics || !meta || !customerSummary) return;

  const counts = {
    critical: shipments.filter(s => s.riskLevel === 'CRITICAL').length,
    high: shipments.filter(s => s.riskLevel === 'HIGH').length,
    medium: shipments.filter(s => s.riskLevel === 'MEDIUM').length,
    low: shipments.filter(s => s.riskLevel === 'LOW').length
  };

  metrics.innerHTML = `
    <div class="metric m-c"><div class="metric-num">${counts.critical}</div><div class="metric-lbl">Critical</div></div>
    <div class="metric m-h"><div class="metric-num">${counts.high}</div><div class="metric-lbl">High</div></div>
    <div class="metric m-m"><div class="metric-num">${counts.medium}</div><div class="metric-lbl">Medium</div></div>
    <div class="metric m-ok"><div class="metric-num">${counts.low}</div><div class="metric-lbl">Low</div></div>`;

  meta.textContent = `${shipments.length} record${shipments.length===1?'':'s'}`;

  if (!shipments.length) {
    list.innerHTML = '<p style="color:var(--muted);font-size:13px">No shipments added yet.</p>';
    customerSummary.innerHTML = '<p style="color:var(--muted);font-size:13px">No customer shipment data yet.</p>';
    renderTransactionMonitoring();
    return;
  }

  list.innerHTML = shipments.map((s) => {
    const sClass = s.riskLevel === 'CRITICAL' ? 's-overdue' : s.riskLevel === 'HIGH' ? 's-due' : s.riskLevel === 'MEDIUM' ? 's-ok' : 's-none';
    const syncClass = s.syncStatus === 'Synced' ? 'sync-ok' : (s.syncStatus === 'Failed' || s.syncStatus === 'Conflict') ? 'sync-failed' : 'sync-pending';
    const ts = escHtml(new Date(s.createdAt).toLocaleString('en-AE',{timeZone:'Asia/Dubai',dateStyle:'medium',timeStyle:'short'}));
    const reasons = escHtml((s.riskReasons || []).slice(0, 4).join(' · '));
    const amount = escHtml(s.amount || '0');
    const soc = escHtml(s.soc || 'N/A');
    const customerId = escHtml(s.customerId || 'No ID');
    const direction = escHtml(s.direction || 'N/A');
    const currency = escHtml(s.currency || 'N/A');
    const material = escHtml(s.material || 'N/A');
    const cdd = escHtml(s.cddReviewDate || 'N/A');
    const rating = escHtml(s.riskRating || 'N/A');
    const invoice = escHtml(s.invoiceNo || 'N/A');
    const supplier = escHtml(s.supplierCustomer || 'N/A');
    const origin = escHtml(s.originCountry || 'N/A');
    const destination = escHtml(s.destinationCountry || 'N/A');
    const folderNo = escHtml(s.folderNo || 'N/A');
    const consignee = escHtml(s.consignee || 'N/A');
    const customBoe = escHtml(s.customBoe || 'N/A');
    const tfs = s.tfsCompleted ? 'Completed' : 'Missing';
    const riskLevel = escHtml(s.riskLevel || 'LOW');
    const riskScore = escHtml(s.riskScore || 0);
    const syncStatus = escHtml(s.syncStatus || 'Pending');
    return `<div class="asana-item" style="grid-template-columns:1fr auto;gap:10px">
      <div>
        <div class="asana-name">Amount: ${amount} · SOC: ${soc}</div>
        <div class="asana-meta">Customer ID: ${customerId} · Direction: ${direction} · Currency: ${currency} · Material: ${material} · Last CDD: ${cdd} · Risk Rating: ${rating} · Invoice: ${invoice} · Supplier/Customer: ${supplier} · Origin: ${origin} · Destination: ${destination} · Internal Folder No: ${folderNo} · Consignee: ${consignee} · Custom (BOE): ${customBoe} · Advance Payment: ${escHtml(s.advancePayment||'—')} · Clearance: ${escHtml(s.shipmentClearance||'—')} · TFS: ${tfs} · ${ts}</div>
        ${(s.riskReasons && s.riskReasons.length) ? `<div class="token-note" style="margin-top:6px"><details><summary style="cursor:pointer;color:var(--amber)">Risk Breakdown: Score ${s.riskScore} = ${s.riskReasons.length} factor(s)</summary><ul style="margin:6px 0 0 16px;font-size:11px;color:var(--muted)">${s.riskReasons.map(function(r){return '<li>'+escHtml(r)+'</li>';}).join('')}</ul></details></div>` : ''}
        ${s.syncMessage ? `<div class="token-note" style="margin-top:4px;color:var(--amber)">Sync note: ${escHtml(s.syncMessage)}</div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="asana-status ${sClass}">${riskLevel} · ${riskScore}</span>
        <span class="sync-status ${syncClass}">${syncStatus}</span>
        <button class="btn btn-sm btn-gold" data-action="startEditShipment" data-arg="${s.id}">Edit</button>
        <button class="btn btn-sm btn-red" data-action="deleteShipment" data-arg="${s.id}">Delete</button>
      </div>
    </div>`;
  }).join('');

  const grouped = {};
  shipments.forEach((s) => {
    const key = `${s.customerId || 'NO-ID'}|${s.supplierCustomer || 'Unknown Supplier/Customer'}`;
    if (!grouped[key]) grouped[key] = { customerId: s.customerId || 'NO-ID', supplierCustomer: s.supplierCustomer || 'Unknown Supplier/Customer', total: 0, sent: 0, received: 0 };
    grouped[key].total += 1;
    if (s.direction === 'Sent') grouped[key].sent += 1;
    if (s.direction === 'Received') grouped[key].received += 1;
  });
  const rows = Object.values(grouped).sort((a, b) => b.total - a.total);
  customerSummary.innerHTML = rows.map((r) => `
    <div class="asana-item" style="grid-template-columns:1fr auto;gap:10px">
      <div>
        <div class="asana-name">${escHtml(r.supplierCustomer)} (${escHtml(r.customerId)})</div>
        <div class="asana-meta">Total Shipments: ${r.total} · Sent: ${r.sent} · Received: ${r.received}</div>
      </div>
      <span class="asana-status s-none">${r.total} total</span>
    </div>
  `).join('');

  renderTransactionMonitoring();
}

// ======= IAR COMPLIANCE REPORT =======
let iarReports = safeLocalParse('fgl_iar_reports', []);
let editingIARReportId = null;

const IAR_FIELDS = [
  'iarLegalName','iarCountryReg','iarTradeLicense','iarDateIncorp','iarNatureBiz','iarSector','iarComplexOwnership',
  'iarRelType','iarRelPurpose','iarTxnVolume','iarTxnFreq','iarSettlement',
  'iarPepCheck','iarUnSanctions','iarOfac','iarEuSanctions','iarUaeTerrorism','iarFatfGrey',
  'iarCriminal','iarMoneyLaundering','iarTfPf','iarRegActions','iarNegReputation','iarPolitical','iarHrViolations',
  'iarSourceFunds','iarSourceWealth'
];
const IAR_CHECKBOXES = ['iarDestIAR','iarDestGram','iarDestFG','iarDestIGR'];

let iarUboCount = 0;

function getIARVal(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }

function addIARUboRow(name, shares, findings) {
  iarUboCount++;
  const n = iarUboCount;
  const container = document.getElementById('iarUboContainer');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'row';
  row.id = `iarUboRow${n}`;
  row.style.cssText = 'grid-template-columns:1fr 1fr 1fr auto;margin-bottom:4px';
  row.innerHTML = `
    <div><span class="lbl">Name ${n}</span><input type="text" id="iarUboName${n}" placeholder="Full name" value="${escHtml(name||'')}" /></div>
    <div><span class="lbl">Shares %</span><input type="number" id="iarUboShares${n}" placeholder="0" min="0" max="100" step="0.01" value="${escHtml(shares||'')}" /></div>
    <div><span class="lbl">Findings</span><select id="iarUboFindings${n}"><option value="">Select</option><option value="Clear"${findings==='Clear'?' selected':''}>Clear</option><option value="Match"${findings==='Match'?' selected':''}>Match</option><option value="Potential Match"${findings==='Potential Match'?' selected':''}>Potential Match</option></select></div>
    <div style="padding-top:20px"><button class="btn btn-sm btn-red" data-action="removeIARUboRow" data-arg="${n}">✕</button></div>
  `;
  container.appendChild(row);
}

function removeIARUboRow(n) {
  const row = document.getElementById(`iarUboRow${n}`);
  if (row) row.remove();
}

function collectIARUbos() {
  const ubos = [];
  for (let i = 1; i <= iarUboCount; i++) {
    const nameEl = document.getElementById(`iarUboName${i}`);
    if (!nameEl) continue;
    const name = nameEl.value.trim();
    const shares = document.getElementById(`iarUboShares${i}`)?.value?.trim() || '';
    const findings = document.getElementById(`iarUboFindings${i}`)?.value || '';
    if (name) ubos.push({ name, shares, findings });
  }
  return ubos;
}

let iarManagerCount = 0;

function addIARManagerRow(name, role, findings) {
  iarManagerCount++;
  const n = iarManagerCount;
  const container = document.getElementById('iarManagerContainer');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'row';
  row.id = `iarMgrRow${n}`;
  row.style.cssText = 'grid-template-columns:1fr 1fr 1fr auto;margin-bottom:4px';
  row.innerHTML = `
    <div><span class="lbl">Name ${n}</span><input type="text" id="iarMgrName${n}" placeholder="Full name" value="${escHtml(name||'')}" /></div>
    <div><span class="lbl">Role / Title</span><input type="text" id="iarMgrRole${n}" placeholder="e.g., Managing Director, Authorized Signatory" value="${escHtml(role||'')}" /></div>
    <div><span class="lbl">Findings</span><select id="iarMgrFindings${n}"><option value="">Select</option><option value="Clear"${findings==='Clear'?' selected':''}>Clear</option><option value="Match"${findings==='Match'?' selected':''}>Match</option><option value="Potential Match"${findings==='Potential Match'?' selected':''}>Potential Match</option></select></div>
    <div style="padding-top:20px"><button class="btn btn-sm btn-red" data-action="removeIARManagerRow" data-arg="${n}">✕</button></div>
  `;
  container.appendChild(row);
}

function removeIARManagerRow(n) {
  const row = document.getElementById(`iarMgrRow${n}`);
  if (row) row.remove();
}

function collectIARManagers() {
  const managers = [];
  for (let i = 1; i <= iarManagerCount; i++) {
    const nameEl = document.getElementById(`iarMgrName${i}`);
    if (!nameEl) continue;
    const name = nameEl.value.trim();
    const role = document.getElementById(`iarMgrRole${i}`)?.value?.trim() || '';
    const findings = document.getElementById(`iarMgrFindings${i}`)?.value || '';
    if (name) managers.push({ name, role, findings });
  }
  return managers;
}

function loadIARManagers(managers) {
  const container = document.getElementById('iarManagerContainer');
  if (container) container.innerHTML = '';
  iarManagerCount = 0;
  (managers || []).forEach(m => addIARManagerRow(m.name, m.role, m.findings));
}

function loadIARUbos(ubos) {
  const container = document.getElementById('iarUboContainer');
  if (container) container.innerHTML = '';
  iarUboCount = 0;
  (ubos || []).forEach(u => addIARUboRow(u.name, u.shares, u.findings));
}

function addIARReport() {
  const report = { id: editingIARReportId || Date.now(), createdAt: new Date().toISOString() };
  IAR_FIELDS.forEach(id => { report[id] = getIARVal(id); });
  IAR_CHECKBOXES.forEach(id => { report[id] = !!document.getElementById(id)?.checked; });
  report.ubos = collectIARUbos();
  report.managers = collectIARManagers();

  if (!report.iarLegalName) { toast('Legal Name is required','error'); return; }

  if (editingIARReportId) {
    const idx = iarReports.findIndex(x => x.id === editingIARReportId);
    if (idx !== -1) iarReports[idx] = report;
    editingIARReportId = null;
    document.getElementById('iarSaveBtn').textContent = 'Save IAR Compliance Report';
    document.getElementById('iarCancelEditBtn').style.display = 'none';
    toast('IAR Compliance Report updated','success');
  } else {
    iarReports.unshift(report);
    toast('IAR Compliance Report saved','success');
  }
  safeLocalSave('fgl_iar_reports', iarReports);
  clearIARReportForm();
  renderIARReports();
}

function clearIARReportForm() {
  IAR_FIELDS.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  IAR_CHECKBOXES.forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
  loadIARUbos([]);
  addIARUboRow(); addIARUboRow();
  loadIARManagers([]);
  addIARManagerRow();
}

function startEditIARReport(id) {
  const r = iarReports.find(x => x.id === id);
  if (!r) return;
  editingIARReportId = id;
  IAR_FIELDS.forEach(fid => { const el = document.getElementById(fid); if (el) el.value = r[fid] || ''; });
  IAR_CHECKBOXES.forEach(fid => { const el = document.getElementById(fid); if (el) el.checked = !!r[fid]; });
  loadIARUbos(r.ubos || []);
  loadIARManagers(r.managers || []);
  document.getElementById('iarSaveBtn').textContent = 'Update IAR Compliance Report';
  document.getElementById('iarCancelEditBtn').style.display = 'inline-block';
  toast('Report loaded for editing','info');
}

function cancelIARReportEdit() {
  editingIARReportId = null;
  clearIARReportForm();
  document.getElementById('iarSaveBtn').textContent = 'Save IAR Compliance Report';
  document.getElementById('iarCancelEditBtn').style.display = 'none';
}

function deleteIARReport(id) {
  if (!confirm('Delete this IAR Compliance Report?')) return;
  iarReports = iarReports.filter(x => x.id !== id);
  safeLocalSave('fgl_iar_reports', iarReports);
  renderIARReports();
  toast('IAR Compliance Report deleted','info');
}

function clearIARReports() {
  if (!confirm('Clear ALL IAR Compliance Reports?')) return;
  iarReports = [];
  safeLocalSave('fgl_iar_reports', iarReports);
  renderIARReports();
  toast('All IAR reports cleared','info');
}

function exportIARReportCSV() {
  if (!iarReports.length) { toast('No IAR reports to export','info'); return; }
  const maxUbos = Math.max(2, ...iarReports.map(r => (r.ubos||[]).length));
  const maxMgrs = Math.max(1, ...iarReports.map(r => (r.managers||[]).length));
  const uboHeaders = [];
  for (let i = 1; i <= maxUbos; i++) { uboHeaders.push(`UBO Name ${i}`,`UBO Shares ${i}`,`UBO Findings ${i}`); }
  const mgrHeaders = [];
  for (let i = 1; i <= maxMgrs; i++) { mgrHeaders.push(`Manager Name ${i}`,`Manager Role ${i}`,`Manager Findings ${i}`); }
  const headers = ['Legal Name','Country of Registration','Trade License','Date of Incorporation','Nature of Business','Sector','Complex Ownership','Relationship Type','Purpose','Txn Volume','Txn Frequency','Settlement','Dest: IAR','Dest: Gramaltin','Dest: Fine Gold','Dest: IGR Ausom','PEP Check','UN Sanctions','OFAC','EU Sanctions','UAE Terrorism','FATF Grey','Criminal/Fraud','Money Laundering','TF/PF','Reg Actions','Neg Reputation','Political/PEP','HR/Env Violations',...uboHeaders,...mgrHeaders,'Source of Funds','Source of Wealth','Created At'];
  const rows = [headers];
  iarReports.forEach(r => {
    const uboData = [];
    for (let i = 0; i < maxUbos; i++) {
      const u = (r.ubos||[])[i] || {};
      uboData.push(u.name||'', u.shares||'', u.findings||'');
    }
    const mgrData = [];
    for (let i = 0; i < maxMgrs; i++) {
      const m = (r.managers||[])[i] || {};
      mgrData.push(m.name||'', m.role||'', m.findings||'');
    }
    rows.push([
      r.iarLegalName||'', r.iarCountryReg||'', r.iarTradeLicense||'', r.iarDateIncorp||'', r.iarNatureBiz||'', r.iarSector||'', r.iarComplexOwnership||'',
      r.iarRelType||'', r.iarRelPurpose||'', r.iarTxnVolume||'', r.iarTxnFreq||'', r.iarSettlement||'',
      r.iarDestIAR?'Yes':'No', r.iarDestGram?'Yes':'No', r.iarDestFG?'Yes':'No', r.iarDestIGR?'Yes':'No',
      r.iarPepCheck||'', r.iarUnSanctions||'', r.iarOfac||'', r.iarEuSanctions||'', r.iarUaeTerrorism||'', r.iarFatfGrey||'',
      r.iarCriminal||'', r.iarMoneyLaundering||'', r.iarTfPf||'', r.iarRegActions||'', r.iarNegReputation||'', r.iarPolitical||'', r.iarHrViolations||'',
      ...uboData, ...mgrData,
      r.iarSourceFunds||'', r.iarSourceWealth||'', r.createdAt||''
    ]);
  });
  const csv = rows.map(r => r.map(v => { let s=String(v).replace(/"/g,'""'); if(/^[=+\-@\t\r]/.test(s)) s="'"+s; return '"'+s+'"'; }).join(',')).join('\n');
  const blob = new Blob(['\ufeff'+csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `IAR_ComplianceReport_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  toast('IAR Compliance Reports exported','success');
}

function exportIARReportPDF() {
  if (!requireJsPDF()) return;
  if (!iarReports.length) { toast('No IAR reports to export','error'); return; }
  const doc = new jspdf.jsPDF();
  const pw = doc.internal.pageSize.getWidth();
  doc.setFillColor(30,30,30); doc.rect(0,0,pw,28,'F');
  doc.setFontSize(16); doc.setTextColor(180,151,90); doc.text('IAR Compliance Reports', 14, 18);
  doc.setFontSize(8); doc.setTextColor(120); doc.text('Generated: '+new Date().toLocaleDateString('en-GB'), pw-14, 18, {align:'right'});
  let y = 36;
  iarReports.forEach((r, idx) => {
    if (y > 240) { doc.addPage(); y = 20; }
    const sanctions = ['iarPepCheck','iarUnSanctions','iarOfac','iarEuSanctions','iarUaeTerrorism','iarFatfGrey'].filter(k=>r[k]==='Match'||r[k]==='Potential Match');
    const adverse = ['iarCriminal','iarMoneyLaundering','iarTfPf','iarRegActions','iarNegReputation','iarPolitical','iarHrViolations'].filter(k=>r[k]==='Found');
    const isRisk = sanctions.length||adverse.length;
    doc.setFillColor(40,40,40); doc.rect(14, y-4, pw-28, 8, 'F');
    doc.setFontSize(10); doc.setTextColor(180,151,90); doc.text((idx+1)+'. '+(r.iarLegalName||'Unnamed'), 16, y+1);
    doc.setTextColor(isRisk?217:39, isRisk?79:174, isRisk?79:96); doc.text(isRisk?'HIGH RISK':'CLEAR', pw-16, y+1, {align:'right'});
    y += 10;
    doc.setFontSize(8); doc.setTextColor(160);
    doc.text('Country: '+(r.iarCountryReg||'—')+'  |  License: '+(r.iarTradeLicense||'—')+'  |  Sector: '+(r.iarSector||'—')+'  |  Nature: '+(r.iarNatureBiz||'—'), 16, y); y+=5;
    doc.text('Relationship: '+(r.iarRelType||'—')+'  |  Volume: '+(r.iarTxnVolume||'—')+'  |  Frequency: '+(r.iarTxnFreq||'—')+'  |  Settlement: '+(r.iarSettlement||'—'), 16, y); y+=5;
    if (r.ubos && r.ubos.length) { doc.text('UBOs: '+r.ubos.map(u=>u.name+' ('+u.shares+'%)').join(', '), 16, y); y+=5; }
    if (r.managers && r.managers.length) { doc.text('Managers: '+r.managers.map(m=>m.name+' ('+m.role+') - '+m.findings).join(', '), 16, y); y+=5; }
    if (r.iarSourceFunds) { doc.text('Source of Funds: '+r.iarSourceFunds, 16, y); y+=5; }
    if (r.iarSourceWealth) { doc.text('Source of Wealth: '+r.iarSourceWealth, 16, y); y+=5; }
    if (sanctions.length) { doc.setTextColor(217,79,79); doc.text('Sanctions Hits: '+sanctions.join(', '), 16, y); y+=5; }
    if (adverse.length) { doc.setTextColor(232,168,56); doc.text('Adverse Media: '+adverse.join(', '), 16, y); y+=5; }
    doc.setTextColor(160);
    y += 6;
  });
  doc.save('IAR_Compliance_Reports_'+new Date().toISOString().slice(0,10)+'.pdf');
  toast('PDF exported','success');
}

function exportIARReportDOCX() {
  if (!iarReports.length) { toast('No IAR reports to export','error'); return; }
  let html = wordDocHeader('IAR Compliance Reports');
  html += '<table><tr><th>#</th><th>Legal Name</th><th>Country</th><th>Sector</th><th>Nature of Business</th><th>Relationship</th><th>Volume</th><th>UBOs</th><th>Managers</th><th>SOF</th><th>SOW</th><th>Risk Status</th></tr>';
  iarReports.forEach((r, idx) => {
    const sanctions = ['iarPepCheck','iarUnSanctions','iarOfac','iarEuSanctions','iarUaeTerrorism','iarFatfGrey'].filter(k=>r[k]==='Match'||r[k]==='Potential Match');
    const adverse = ['iarCriminal','iarMoneyLaundering','iarTfPf','iarRegActions','iarNegReputation','iarPolitical','iarHrViolations'].filter(k=>r[k]==='Found');
    const isRisk = sanctions.length||adverse.length;
    const ubos = (r.ubos||[]).map(u=>u.name+' ('+u.shares+'%)').join(', ')||'—';
    const mgrs = (r.managers||[]).map(m=>m.name+' ('+m.role+')').join(', ')||'—';
    html += '<tr><td>'+(idx+1)+'</td><td>'+(r.iarLegalName||'')+'</td><td>'+(r.iarCountryReg||'')+'</td><td>'+(r.iarSector||'')+'</td><td>'+(r.iarNatureBiz||'')+'</td><td>'+(r.iarRelType||'')+'</td><td>'+(r.iarTxnVolume||'')+'</td><td>'+ubos+'</td><td>'+mgrs+'</td><td>'+(r.iarSourceFunds||'—')+'</td><td>'+(r.iarSourceWealth||'—')+'</td><td class="'+(isRisk?'risk':'clear')+'">'+(isRisk?'HIGH RISK':'CLEAR')+'</td></tr>';
  });
  html += '</table>' + wordDocFooter();
  downloadWordDoc(html, 'IAR_Compliance_Reports_'+new Date().toISOString().slice(0,10)+'.doc');
  toast('Word exported','success');
}

function renderIARReports() {
  const list = document.getElementById('iarReportsList');
  const meta = document.getElementById('iarReportCountMeta');
  if (!list) return;
  if (meta) meta.textContent = `${iarReports.length} records`;
  if (!iarReports.length) {
    list.innerHTML = '<p style="color:var(--muted);font-size:13px">No IAR compliance reports yet.</p>';
    return;
  }
  list.innerHTML = iarReports.map(r => {
    const dests = [r.iarDestIAR&&'IAR', r.iarDestGram&&'Gramaltin', r.iarDestFG&&'Fine Gold', r.iarDestIGR&&'IGR Ausom'].filter(Boolean).join(', ') || 'None';
    const sanctions = ['iarPepCheck','iarUnSanctions','iarOfac','iarEuSanctions','iarUaeTerrorism','iarFatfGrey'].filter(k => r[k] === 'Match' || r[k] === 'Potential Match');
    const adverse = ['iarCriminal','iarMoneyLaundering','iarTfPf','iarRegActions','iarNegReputation','iarPolitical','iarHrViolations'].filter(k => r[k] === 'Found');
    const uboMatches = (r.ubos||[]).filter(u => u.findings === 'Match' || u.findings === 'Potential Match');
    const mgrMatches = (r.managers||[]).filter(m => m.findings === 'Match' || m.findings === 'Potential Match');
    const isComplex = r.iarComplexOwnership === 'Yes';
    const isHighFreq = r.iarTxnFreq === 'Daily' || r.iarTxnFreq === 'Weekly';
    // Risk scoring: High = sanctions/adverse/UBO matches; Medium = complex ownership, high frequency, FATF grey, potential matches; Low = all clear
    let riskScore = 0;
    let riskFactors = [];
    if (sanctions.length) { riskScore += 3; riskFactors.push(`${sanctions.length} sanctions flag(s) detected`); }
    if (adverse.length) { riskScore += 3; riskFactors.push(`${adverse.length} adverse media flag(s) found`); }
    if (uboMatches.length) { riskScore += 2; riskFactors.push(`${uboMatches.length} UBO screening match(es)`); }
    if (mgrMatches.length) { riskScore += 2; riskFactors.push(`${mgrMatches.length} Manager screening match(es)`); }
    if (isComplex) { riskScore += 1; riskFactors.push('Complex ownership structure'); }
    if (isHighFreq) { riskScore += 1; riskFactors.push('High transaction frequency'); }
    if (r.iarFatfGrey === 'Listed') { riskScore += 2; riskFactors.push('FATF Grey List jurisdiction'); }
    if (r.iarPepCheck === 'Match' || r.iarPepCheck === 'Potential Match') { riskScore += 2; riskFactors.push('PEP status identified — EDD required'); }
    let riskLevel, riskClass, riskColor, riskExplanation;
    if (riskScore >= 3) {
      riskLevel = 'HIGH RISK';
      riskClass = 's-red';
      riskColor = 'var(--red)';
      riskExplanation = 'Immediate action required: Enhanced Due Diligence (EDD), senior management approval, increased monitoring frequency, and potential STR filing obligation under FDL No.10/2025.';
    } else if (riskScore >= 1) {
      riskLevel = 'MEDIUM RISK';
      riskClass = 's-amber';
      riskColor = 'var(--amber)';
      riskExplanation = 'Elevated risk indicators present: Apply enhanced monitoring, additional documentation requirements, and periodic risk reassessment per risk-based approach.';
    } else {
      riskLevel = 'LOW RISK';
      riskClass = 's-ok';
      riskColor = 'var(--green)';
      riskExplanation = 'Standard risk profile: All sanctions, adverse media, and UBO screenings clear. Apply standard CDD and routine monitoring procedures.';
    }
    const ts = r.createdAt ? new Date(r.createdAt).toLocaleString('en-GB') : '';
    return `<div class="asana-item" style="grid-template-columns:1fr auto;gap:10px">
      <div>
        <div class="asana-name">${escHtml(r.iarLegalName||'N/A')} — ${escHtml(r.iarCountryReg||'N/A')}</div>
        <div class="asana-meta">Sector: ${escHtml(r.iarSector||'N/A')} · Rel: ${escHtml(r.iarRelType||'N/A')} · Dest: ${escHtml(dests)} · Complex: ${escHtml(r.iarComplexOwnership||'N/A')} · UBOs: ${(r.ubos||[]).length} · ${ts}</div>
        ${(r.ubos||[]).length ? `<div class="token-note" style="margin-top:4px">UBOs: ${(r.ubos||[]).map(u => `${escHtml(u.name)} (${escHtml(u.shares||'?')}% - ${escHtml(u.findings||'N/A')})`).join(' · ')}</div>` : ''}
        ${(r.managers||[]).length ? `<div class="token-note" style="margin-top:3px">Managers: ${(r.managers||[]).map(m => `${escHtml(m.name)} (${escHtml(m.role||'N/A')} - ${escHtml(m.findings||'N/A')})`).join(' · ')}</div>` : ''}
        ${sanctions.length ? `<div class="token-note" style="margin-top:4px;color:var(--red)">Sanctions flags: ${sanctions.length}</div>` : ''}
        ${adverse.length ? `<div class="token-note" style="margin-top:2px;color:var(--red)">Adverse media flags: ${adverse.length}</div>` : ''}
        ${riskFactors.length ? `<div class="token-note" style="margin-top:4px;color:${riskColor};font-size:10px">Risk factors: ${riskFactors.join(' | ')}</div>` : ''}
        <div class="token-note" style="margin-top:3px;font-size:10px;color:var(--muted);font-style:italic">${riskExplanation}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="asana-status ${riskClass}">${riskLevel}</span>
        <button class="btn btn-sm btn-gold" data-action="startEditIARReport" data-arg="${r.id}">Edit</button>
        <button class="btn btn-sm btn-red" data-action="deleteIARReport" data-arg="${r.id}">Delete</button>
      </div>
    </div>`;
  }).join('');
}

// ======= ANALYSIS =======
function setQ(t) { document.getElementById('queryInput').value = t; }

function buildSystemPrompt(area, asanaCtx, companyName) {
  const entityCtx = companyName
    ? `\n\nACTIVE ENTITY UNDER ANALYSIS: ${companyName}\nIMPORTANT: This analysis is SPECIFICALLY for the entity "${companyName}". All findings, recommendations, risk assessments, and regulatory references MUST be directed at and applicable to this specific entity. Do NOT mix information from other entities. Reference "${companyName}" by name throughout your analysis.\n`
    : '';
  return `You are a senior AML/CFT compliance analyst for Compliance Tasks, a UAE-based DPMS (Designated Precious Metals and Stones) entity in Dubai. Trade License 643756. MLRO: Luisa Fernanda.${entityCtx}

REGULATORY FRAMEWORKS:
- UAE Federal Decree-Law No.(10) of 2025 on AML/CFT
- Cabinet Resolution No.(134) of 2025 (Executive Regulations)
- Cabinet Resolution No.(156) of 2025 (Administrative violations - penalties up to AED 5,000,000)
- Cabinet Resolution No.(74) of 2020 (TFS/UN Sanctions)
- Cabinet Decision No.(109) of 2023 (UBO disclosure)
- FATF Recommendations 2023 (Rec 1, 6, 10, 12, 18, 19, 20, 22, 23)
- FATF Guidance for DPMS 2020
- LBMA Responsible Gold Guidance v9 Steps 1-5
- UAE FIU GOAML Guidance (STR/SAR/FFR/PNMR)
- OECD Due Diligence Guidance - Conflict Minerals (CAHRAs)
- UAE NRA 2024; MoE DPMS Supervision Framework

RACI MATRIX (FG/RACI/004 v005, effective March 02, 2026):
Roles: CM=Compliance Department, MD=Managing Director, FIN=Finance, OPS=Operations
Key accountability assignments:
- AML/CFT/CPF policy development: CM(R), MD(A), FIN(C), OPS(C)
- CDD on new clients: CM(A), MD(I), FIN(C), OPS(R)
- EDD for PEPs/high-risk: CM(R), MD(A), FIN(C), OPS(C)
- UBO identification: CM(A), MD(I), FIN(C), OPS(R)
- Transaction monitoring: CM(A), MD(I), FIN(R), OPS(R)
- STR/SAR filing on goAML: CM(R), MD(I), FIN(C), OPS(C)
- CTR filing (AED 55,000 cash threshold): CM(R), MD(A), FIN(C), OPS(R)
- Sanctions screening (pre-onboarding): CM(A), MD(I), FIN(C), OPS(R)
- Ongoing re-screening: CM(A), MD(I), FIN(R), OPS(R)
- Adverse media monitoring: CM(R), MD(A), FIN(I), OPS(I)
- TFS/FFR/PNMR escalation: CM(R), MD(A), FIN(C), OPS(C)
- PF and TFS controls: CM(R), MD(A), FIN(C), OPS(C)
- EWRA/BWRA: CM(R), MD(A), FIN(C), OPS(C)
- Quarterly EWRA/BWRA material change review: CM(R), MD(A), FIN(C), OPS(C)
- Training programme: CM(R), MD(A), FIN(C), OPS(C)
- Internal compliance audit: CM(R), MD(A), FIN(C), OPS(C)
- LBMA responsible sourcing: CM(R), MD(A), FIN(C), OPS(C)
- Supplier due diligence (KYS): CM(A), MD(I), FIN(C), OPS(R)
- Document retention (10-year): CM(A), MD(I), FIN(R), OPS(R)
- Whistleblower handling: CM(R), MD(A), FIN(C), OPS(C)
- Anti-bribery/corruption: CM(R), MD(A), FIN(C), OPS(C)
- KYE screening and annual recertification: CM(R), MD(A), FIN(C), OPS(C)
- DPMSR submission to MoE: CM(R), MD(A), FIN(C), OPS(C)

COMPLIANCE TASKS STATUS (March 2026):
- Gap assessment: 42 gaps identified, compliance maturity 79%
- 4 Critical gaps: conflicting CDD review frequencies (FG/KYC vs FG/AML), no LBMA independent audit, missing CRA form and UBO Register, duplicate document coding
- Active documents: Compliance Manual v005 (FG/CML/005), Responsible Sourcing Manual v002, EWRA, BWRA, Training Calendar FG/CCT/004, RACI Matrix FG/RACI/004 v005, Responsible AI Policy, Transaction Monitoring Template
- 137 compliance tasks in Asana
- Remediation target: December 2026
${asanaCtx}

ANALYSIS AREA: ${area}

Respond ONLY with valid JSON. No preamble. No markdown fences.
{
  "summary": "3-4 sentence executive summary written in formal compliance language. State the overall compliance posture, key risk areas identified, and immediate priority actions. Reference specific regulations where applicable.",
  "risk_rating": "LOW|MEDIUM|HIGH|CRITICAL",
  "risk_rating_justification": "Professional explanation of why this overall risk rating was assigned, referencing the key factors that drove the assessment (e.g., regulatory gaps, sanctions exposure, governance weaknesses, documentation deficiencies). Include the compliance implication and urgency level.",
  "metrics": {"critical": n, "high": n, "medium": n, "compliant": n},
  "findings": [
    {
      "severity": "CRITICAL|HIGH|MEDIUM|COMPLIANT",
      "title": "Concise professional title (e.g., 'Deficiency in CDD Review Frequency Alignment')",
      "body": "Detailed professional explanation: describe the specific gap or compliance status, the regulatory obligation that applies, the current state of controls, and the risk exposure if left unaddressed. Use formal compliance language. Reference specific articles, recommendations, or guidance steps.",
      "regulatory_ref": "Exact article/recommendation/step citation (e.g., 'FDL No.10/2025 Art.16; FATF Rec.10; Cabinet Resolution 134/2025 Art.12')",
      "recommendation": "Specific, actionable remediation step with clear timeline and responsible party. Example: 'The Compliance Department (CM) must update CDD review schedules within 30 days to align FG/KYC/001 with FG/AML/001, subject to MD approval.'",
      "risk_impact": "Brief statement of the compliance consequence if this finding is not addressed (e.g., 'Regulatory penalty exposure up to AED 5,000,000 under Cabinet Resolution 156/2025; potential licence revocation risk.')",
      "asana_task_name": "suggested Asana task name if action needed, else empty string"
    }
  ]
}
Rules:
- Minimum 5, maximum 12 findings per analysis.
- Every finding MUST cite a specific regulatory provision (article number, FATF recommendation, LBMA step, or cabinet resolution article).
- Recommendations MUST include a specific timeline (e.g., 'within 14 days', 'by Q2 2026') and identify the responsible RACI role.
- Always flag tipping-off risk (Article 25 FDL No.10/2025) where STR/SAR is involved.
- Always flag the 10-year retention obligation for documentation-related findings.
- Include at least one COMPLIANT finding to acknowledge areas of strength.
- Use formal, professional compliance language throughout. Avoid colloquial terms.
- For CRITICAL findings, recommend immediate escalation to senior management.
- Reference the UAE NRA 2024 findings where relevant to risk assessment gaps.
- Cross-reference RACI matrix assignments when recommending responsible parties.`;
}

function parseAnalysisPayload(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('Empty analysis response');

  const cleaned = raw
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  // Fallback: extract the largest JSON object block from mixed text.
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const candidate = cleaned.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch (_) {}
  }

  throw new Error('Could not parse analysis response');
}

function fallbackAnalysisFromText(raw) {
  const text = String(raw || '').replace(/```[\s\S]*?```/g, '').trim();

  // Last-resort: try to salvage partial JSON by fixing common issues
  try {
    // Remove trailing commas before } or ]
    let fixed = text.replace(/,\s*([}\]])/g, '$1');
    // Try wrapping in braces if it looks like bare JSON content
    if (!fixed.startsWith('{')) fixed = '{' + fixed;
    if (!fixed.endsWith('}')) fixed = fixed + '}';
    const parsed = JSON.parse(fixed);
    if (parsed.findings || parsed.summary) return parsed;
  } catch (_) {}

  // Try extracting individual JSON objects that look like findings
  try {
    const findingsMatch = text.match(/"findings"\s*:\s*\[[\s\S]*\]/);
    if (findingsMatch) {
      const arrMatch = findingsMatch[0].match(/\[[\s\S]*\]/);
      if (arrMatch) {
        const findings = (() => { try { return JSON.parse(arrMatch[0]); } catch(_) { return []; } })();
        const summaryMatch = text.match(/"summary"\s*:\s*"([^"]+)"/);
        return {
          summary: summaryMatch ? summaryMatch[1] : 'Analysis completed. Findings extracted from partial response.',
          metrics: {
            critical: findings.filter(f => (f.severity||'').toUpperCase() === 'CRITICAL').length,
            high: findings.filter(f => (f.severity||'').toUpperCase() === 'HIGH').length,
            medium: findings.filter(f => (f.severity||'').toUpperCase() === 'MEDIUM').length,
            compliant: findings.filter(f => (f.severity||'').toUpperCase() === 'COMPLIANT').length
          },
          findings
        };
      }
    }
  } catch (_) {}

  // True text fallback — strip JSON artifacts and extract meaningful lines
  const cleanText = text
    .replace(/[{}\[\]]/g, '')
    .replace(/"(summary|metrics|findings|severity|title|body|regulatory_ref|recommendation|asana_task_name|critical|high|medium|compliant)"\s*:/gi, '')
    .replace(/"/g, '')
    .trim();
  const lines = cleanText.split(/\r?\n/).map(x => x.trim()).filter(l => l.length > 20);
  const summary = (lines.slice(0, 3).join(' ') || 'Analysis completed. Response format could not be parsed — please retry.').slice(0, 420);

  return {
    summary,
    metrics: { critical: 0, high: 0, medium: 1, compliant: 0 },
    findings: [{
      severity: 'MEDIUM',
      title: 'Response Format Error — Manual Review Required',
      body: 'The AI response could not be parsed into structured findings. This may be due to a temporary issue. Please retry the analysis.',
      regulatory_ref: 'N/A',
      recommendation: 'Retry the analysis. If the issue persists, check your API configuration in Settings.',
      asana_task_name: ''
    }]
  };
}

function normalizeAnalysisResult(obj) {
  const src = obj && typeof obj === 'object' ? obj : {};
  const metrics = src.metrics && typeof src.metrics === 'object' ? src.metrics : {};
  const findings = Array.isArray(src.findings) ? src.findings : [];
  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  return {
    summary: typeof src.summary === 'string' ? src.summary : '',
    risk_rating: typeof src.risk_rating === 'string' ? src.risk_rating.toUpperCase() : '',
    risk_rating_justification: typeof src.risk_rating_justification === 'string' ? src.risk_rating_justification : '',
    metrics: {
      critical: toNum(metrics.critical),
      high: toNum(metrics.high),
      medium: toNum(metrics.medium),
      compliant: toNum(metrics.compliant)
    },
    findings: findings.map((f) => ({
      severity: (f && typeof f.severity === 'string' ? f.severity : 'MEDIUM').toUpperCase(),
      title: f && typeof f.title === 'string' ? f.title : '',
      body: f && typeof f.body === 'string' ? f.body : '',
      regulatory_ref: f && typeof f.regulatory_ref === 'string' ? f.regulatory_ref : '',
      recommendation: f && typeof f.recommendation === 'string' ? f.recommendation : '',
      risk_impact: f && typeof f.risk_impact === 'string' ? f.risk_impact : '',
      asana_task_name: f && typeof f.asana_task_name === 'string' ? f.asana_task_name : ''
    }))
  };
}

async function callAnthropic(body) {
  const fetchWithTimeout = async (url, options, timeoutMs = 60000) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: c.signal });
    } finally {
      clearTimeout(t);
    }
  };

  const notifyProxyFallback = () => {
    if (proxyFallbackNotified) return;
    proxyFallbackNotified = true;
  };

  const directEndpoint = 'https://api.anthropic.com/v1/messages';
  const doDirectCall = async () => {
    const r = await fetchWithTimeout(directEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    });
    return r;
  };

  let r;
  if (PROXY_URL) {
    try {
      r = await fetchWithTimeout(`${PROXY_URL}/anthropic`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body)
      });
    } catch (e) {
      if (!ANTHROPIC_KEY) throw e;
      notifyProxyFallback();
      r = await doDirectCall();
    }
  } else {
    r = await doDirectCall();
  }

  if (!r.ok) {
    let errDetail = '';
    try {
      const errJson = await r.json();
      errDetail = errJson?.error?.message || JSON.stringify(errJson);
    } catch (_) {
      try { errDetail = await r.text(); } catch (_) {}
    }
    const err = new Error(`Anthropic API ${r.status}: ${errDetail || r.statusText}`);
    // Tag billing/credit errors so callers can detect and handle gracefully
    // Rate-limit check first (more specific); billing second (mutually exclusive)
    if (r.status === 400 || r.status === 402 || r.status === 429) {
      const lower = (errDetail || '').toLowerCase();
      if (r.status === 429 && !lower.includes('credit') && !lower.includes('balance')) {
        err.isRateLimitError = true;
      } else if (lower.includes('credit') || lower.includes('balance') || lower.includes('billing') || lower.includes('payment') || lower.includes('insufficient') || r.status === 402) {
        err.isBillingError = true;
      }
    }
    throw err;
  }

  const data = await r.json();
  if (data.error) {
    const err = new Error(data.error.message || 'API error');
    const lower = (data.error.message || '').toLowerCase();
    if (lower.includes('credit') || lower.includes('balance') || lower.includes('billing') || lower.includes('payment') || lower.includes('insufficient')) {
      err.isBillingError = true;
    }
    throw err;
  }
  return data;
}

async function repairAnalysisPayload(rawText) {
  const repairSystem = 'You repair malformed model output into strict JSON. Return only valid JSON, no markdown, no prose.';
  const repairUser = `Convert this content to valid JSON matching schema:\n{"summary":"string","risk_rating":"LOW|MEDIUM|HIGH|CRITICAL","risk_rating_justification":"string","metrics":{"critical":0,"high":0,"medium":0,"compliant":0},"findings":[{"severity":"CRITICAL|HIGH|MEDIUM|COMPLIANT","title":"string","body":"string","regulatory_ref":"string","recommendation":"string","risk_impact":"string","asana_task_name":"string"}]}\n\nContent to repair:\n${rawText}`;
  const repaired = await callAnthropic({
    model: 'claude-haiku-4-5',
    max_tokens: 1400,
    temperature: 0,
    system: repairSystem,
    messages: [{ role: 'user', content: repairUser }]
  });

  const repairedRaw = (repaired.content || [])
    .filter(block => block && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n') || '{}';

  return parseAnalysisPayload(repairedRaw);
}

async function runAnalysis(queryOverride, areaOverride) {
  const query = queryOverride || document.getElementById('queryInput').value.trim();
  const area = areaOverride || document.getElementById('areaSelect').value;
  if (!query) { document.getElementById('queryInput').focus(); return; }
  if (!ANTHROPIC_KEY && !OPENAI_KEY && !GEMINI_KEY && !COPILOT_KEY && !PROXY_URL) { toast('An AI API key (Anthropic, OpenAI, or Gemini) or Proxy URL required. Check Settings.','error'); return; }

  const btn = document.getElementById('analyseBtn');
  if (btn) btn.disabled = true;
  document.getElementById('results').style.display = 'none';
  const sb = document.getElementById('statusBar'); sb.style.display = 'flex';

  let asanaCtx = '';
  if ((ASANA_TOKEN || PROXY_URL) && (!queryOverride) && document.getElementById('includeAsana').value==='yes') {
    document.getElementById('statusText').textContent = 'Reading Asana task status...';
    try {
      const r = await asanaFetch(`/projects/${getAsanaProject()}/tasks?opt_fields=name,completed,due_on&limit=100`);
      const d = await r.json();
      const today = new Date(); today.setHours(0,0,0,0);
      const overdue = (d.data||[]).filter(t=>!t.completed&&t.due_on&&new Date(t.due_on)<today).map(t=>t.name).slice(0,12);
      if (overdue.length) asanaCtx = `\n\nLIVE ASANA DATA - Overdue tasks (${overdue.length}): ${overdue.join('; ')}`;
    } catch(e) { console.warn('[Analysis] Asana context unavailable:', e.message); }
  }

  const activeCompany = getActiveCompany();
  const companyName = activeCompany ? activeCompany.name : '';
  const companyLicense = activeCompany?.licenseNo ? ` (License: ${activeCompany.licenseNo})` : '';
  const companyDesc = activeCompany?.description ? ` — ${activeCompany.description}` : '';
  document.getElementById('statusText').textContent = `Running regulatory analysis for ${companyName || 'active entity'}...`;
  try {
    const data = await callAI({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      temperature: 0,
      system: buildSystemPrompt(area, asanaCtx, companyName),
      messages: [{ role: 'user', content: `Analyze for entity "${companyName || 'Compliance Tasks'}"${companyLicense}${companyDesc}: ${query}` }]
    });

    document.getElementById('statusText').textContent = 'Processing findings...';
    const raw = (data.content || [])
      .filter(block => block && block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('\n') || '{}';

    let parsed;
    try {
      parsed = parseAnalysisPayload(raw);
    } catch (_) {
      document.getElementById('statusText').textContent = 'Repairing response format...';
      try {
        parsed = await repairAnalysisPayload(raw);
      } catch (_) {
        parsed = fallbackAnalysisFromText(raw);
      }
    }

    const result = normalizeAnalysisResult(parsed);
    sb.style.display = 'none';
    lastResult = result; lastQuery = query; lastArea = area;
    renderResults(result, query);
    if (btn) btn.disabled = false;
  } catch(e) {
    sb.style.display = 'none';
    if (btn) btn.disabled = false;
    if (isBillingError(e)) {
      toast('API credits exhausted — AI analysis unavailable. Add credits at console.anthropic.com.', 'info', 8000);
      return;
    }
    const raw = String(e && e.message ? e.message : e || 'Unknown error');
    const help = /Failed to fetch|NetworkError/i.test(raw)
      ? PROXY_URL
        ? ' Network/CORS issue. Check your Worker URL and confirm the Worker is deployed.'
        : ' Network/CORS issue. Confirm internet access or configure a Proxy URL in Settings to avoid CORS restrictions.'
      : '';
    toast('Analysis error: ' + raw + help, 'error', 8000);
  }
}

function renderResults(r, query) {
  const m = r.metrics || {};
  // Overall risk rating banner
  const rr = (r.risk_rating || '').toUpperCase();
  const rrColors = { CRITICAL: {bg:'rgba(217,79,79,0.15)',color:'#D94F4F',border:'rgba(217,79,79,0.3)'}, HIGH: {bg:'rgba(217,79,79,0.15)',color:'#D94F4F',border:'rgba(217,79,79,0.3)'}, MEDIUM: {bg:'rgba(232,168,56,0.15)',color:'#E8A838',border:'rgba(232,168,56,0.3)'}, LOW: {bg:'rgba(61,168,118,0.15)',color:'#3DA876',border:'rgba(61,168,118,0.3)'} };
  const rrStyle = rrColors[rr] || rrColors.MEDIUM;
  const rrBanner = rr ? `<div style="background:${rrStyle.bg};border:1px solid ${rrStyle.border};border-radius:3px;padding:12px 16px;margin-bottom:12px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <span style="font-size:11px;font-weight:700;color:${rrStyle.color};padding:3px 10px;border-radius:4px;background:${rrStyle.bg};border:1px solid ${rrStyle.border};font-family:'Montserrat',sans-serif;letter-spacing:1px">OVERALL RISK: ${escHtml(rr)}</span>
    </div>
    ${r.risk_rating_justification ? `<div style="font-size:12px;color:var(--muted);line-height:1.5;font-style:italic">${escHtml(r.risk_rating_justification)}</div>` : ''}
  </div>` : '';
  document.getElementById('metrics').innerHTML = `
    <div class="metric m-c"><div class="metric-num">${m.critical||0}</div><div class="metric-lbl">Critical</div></div>
    <div class="metric m-h"><div class="metric-num">${m.high||0}</div><div class="metric-lbl">High</div></div>
    <div class="metric m-m"><div class="metric-num">${m.medium||0}</div><div class="metric-lbl">Medium</div></div>
    <div class="metric m-ok"><div class="metric-num">${m.compliant||0}</div><div class="metric-lbl">Compliant</div></div>`;
  const ts = new Date().toLocaleString('en-AE',{timeZone:'Asia/Dubai',dateStyle:'full',timeStyle:'short'});
  document.getElementById('reportTimestamp').textContent = `Generated: ${ts} (Dubai time)  |  Query: ${query}`;
  document.getElementById('summaryBox').innerHTML = (r.summary ? escHtml(r.summary) : '') + rrBanner;
  const c = document.getElementById('findingsContainer'); c.innerHTML = '';
  const wb = document.getElementById('writebackPanel'); wb.innerHTML = '';
  if (!(r.findings||[]).length) { c.innerHTML = '<p style="font-size:13px;color:var(--green);padding:16px">No compliance gaps identified for this query. Your framework appears well-aligned.</p>'; }
  (r.findings||[]).forEach((f,i) => {
    const s = (f.severity||'medium').toLowerCase();
    const sc = s==='critical'?'critical':s==='high'?'high':s==='compliant'?'ok':'medium';
    const bc = `b-${sc==='ok'?'ok':sc}`;
    const el = document.createElement('div');
    el.className = `finding f-${sc}`; el.style.animationDelay = `${i*0.08}s`;
    const sev = escHtml(f.severity || 'MEDIUM');
    const title = escHtml(f.title || '');
    const body = escHtml(f.body || '');
    const ref = escHtml(f.regulatory_ref || '');
    const rec = escHtml(f.recommendation || '');
    const impact = escHtml(f.risk_impact || '');
    const impactHtml = impact ? `<div style="font-size:11px;color:var(--amber);margin-top:6px;padding:6px 10px;background:rgba(232,168,56,0.08);border-radius:3px;border-left:2px solid var(--amber)"><strong>Risk Impact:</strong> ${impact}</div>` : '';
    const taskBtn = f.asana_task_name
      ? `<div class="writeback-row"><button class="btn btn-sm btn-green" data-action="prefillCreateTask" data-arg="${escJsStr(f.asana_task_name)}" data-arg2="${escJsStr((f.body||'') + (f.regulatory_ref ? ' Ref: ' + f.regulatory_ref : ''))}">+ Create Asana Task</button></div>`
      : '';
    el.innerHTML = `<div class="f-head"><div class="f-head-left"><span class="badge ${bc}">${sev}</span><div class="f-title">${title}</div></div></div><div class="f-body">${body}</div>${ref?`<div class="f-ref">${ref}</div>`:''} ${rec?`<div class="rec">${rec}</div>`:''}${impactHtml}${taskBtn}`;
    c.appendChild(el);
  });
  document.getElementById('results').style.display = 'block';

  if ((m.critical || 0) > 0) {
    triggerAlert(
      `Critical Analysis Findings: ${m.critical}`,
      `Query returned ${m.critical} critical finding(s).`,
      { type: 'analysis-critical', query, metrics: m }
    );
  }
}

// Proxied Asana fetch: routes through PROXY_URL when set, otherwise direct.
async function asanaFetch(apiPath, opts = {}) {
  if (!ASANA_TOKEN && !PROXY_URL) {
    throw new Error('Asana not configured — set Asana Token or Proxy URL in Settings');
  }

  const fetchWithTimeout = async (url, options, timeoutMs = 15000) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: c.signal });
    } finally {
      clearTimeout(t);
    }
  };

  const notifyProxyFallback = () => {
    if (proxyFallbackNotified) return;
    proxyFallbackNotified = true;
  };

  const doDirectAsanaFetch = async () => {
    if (!ASANA_TOKEN) throw new Error('Asana token not set — enter your PAT in Settings');
    const headers = { 'Authorization': `Bearer ${ASANA_TOKEN}`, 'Accept': 'application/json' };
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(`https://app.asana.com/api/1.0${apiPath}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body,
    });
  };

  if (PROXY_URL) {
    try {
      return await fetchWithTimeout(`${PROXY_URL}/asana${apiPath}`, {
        method: opts.method || 'GET',
        headers: opts.body ? { 'Content-Type': 'application/json' } : {},
        body: opts.body,
      });
    } catch (e) {
      if (!ASANA_TOKEN) throw e;
      notifyProxyFallback();
      return doDirectAsanaFetch();
    }
  }
  return doDirectAsanaFetch();
}

function getCompanyDocColor(companyId) {
  const colors = {
    'company-1': '#E8A838',
    'company-2': '#E87A38',
    'company-3': '#9B59B6',
    'company-4': '#27AE60',
    'company-5': '#1a1a6e',
    'company-6': '#1a1a6e'
  };
  return colors[companyId] || '#1a1a6e';
}

function wordDocHeader(reportTitle, extraStyle) {
  const company = typeof getActiveCompany === 'function' ? getActiveCompany() : {};
  const cId = company.id || 'company-5';
  const headerColor = getCompanyDocColor(cId);
  const cName = (company.name || 'HAWKEYE STERLING V2').toUpperCase();
  const license = company.licenseNo ? 'License No. ' + escHtml(company.licenseNo) : '';
  const activity = company.activity || 'Non-Manufactured Precious Metal Trading';
  const loc = company.location || 'Dubai, UAE';
  const year = new Date().getFullYear();
  const logo = typeof getCompanyLogoBase64 === 'function' ? getCompanyLogoBase64(cId) : '';
  const baseStyle = '@page{margin:1.27cm 1.27cm 1.27cm 1.27cm}' +
    'body{font-family:"Arial Narrow",Arial,sans-serif;font-size:8pt;margin:0}' +
    'table{border-collapse:collapse;width:100%;margin-top:6pt}' +
    'th{background:' + headerColor + ';color:#fff;padding:4pt 6pt;text-align:left;font-size:7pt;font-weight:700}' +
    'td{border:1px solid #ccc;padding:3pt 6pt;font-size:7pt;vertical-align:top}' +
    'tr:nth-child(even){background:#f5f5f5}' +
    'h1{font-size:9pt;color:' + headerColor + ';margin:0 0 2pt 0;font-weight:700}' +
    'h2{font-size:8pt;color:#1a1a2e;margin:10pt 0 3pt 0;font-weight:700}' +
    'h3{font-size:7.5pt;color:' + headerColor + ';margin:6pt 0 2pt 0;font-weight:700}' +
    '.header-top{color:' + headerColor + ';font-size:10pt;font-weight:700;margin:0 0 1pt 0;letter-spacing:0.5pt}' +
    '.header-sub{color:#888;font-size:7pt;margin:0 0 8pt 0}' +
    '.report-title{text-align:center;font-size:9pt;font-weight:700;text-transform:uppercase;text-decoration:underline;margin:10pt 0 2pt 0;color:#1a1a2e}' +
    '.report-entity{text-align:center;font-size:8pt;font-weight:700;margin:0 0 8pt 0;color:#333}' +
    '.meta{color:#888;font-size:6.5pt;margin:2pt 0 6pt 0}' +
    '.match{color:#c0392b;font-weight:bold}.clear{color:#27ae60;font-weight:bold}' +
    '.high{color:#E8A838}.critical{color:#D94F4F}.medium{color:#5B8DEF}.low{color:#27AE60}' +
    '.done{color:#27AE60}.pending{color:#E8A838}.miss{color:#D94F4F}' +
    '.risk{color:#D94F4F;font-weight:700}' +
    (extraStyle || '');
  let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">' +
    '<head><meta charset="utf-8">' +
    '<style>' + baseStyle + '</style>' +
    '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->' +
    '</head><body>';
  if (logo) {
    html += '<table style="border:none;margin:0 0 4pt 0"><tr><td style="border:none;width:60pt;padding:0;vertical-align:middle"><img src="' + logo + '" style="max-height:50pt;max-width:55pt" /></td>' +
      '<td style="border:none;padding:0 0 0 6pt;vertical-align:middle"><p class="header-top">' + escHtml(cName) + '</p>' +
      '<p class="header-sub">' + escHtml(activity) + (license ? ' | ' + license : '') + ' | ' + escHtml(loc) + '</p></td></tr></table>';
  } else {
    html += '<p class="header-top">' + escHtml(cName) + '</p>' +
      '<p class="header-sub">' + escHtml(activity) + (license ? ' | ' + license : '') + ' | ' + escHtml(loc) + '</p>';
  }
  html += '<p class="report-title">' + escHtml(reportTitle).toUpperCase() + ' ' + year + '</p>' +
    '<p class="report-entity">' + escHtml(company.name || '') + ' | ' + escHtml(activity) + ' | ' + escHtml(loc) + ' | ' + year + '</p>';
  return html;
}

function wordDocFooter() { return '</body></html>'; }

function downloadWordDoc(html, filename) {
  const blob = new Blob(['\ufeff' + html], { type: 'application/msword' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escJsStr(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/</g, '\\x3C');
}

function safeUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim(), window.location.href);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return u.toString();
  } catch (_) {
    return '';
  }
}

function openSafeUrl(raw) {
  const u = safeUrl(raw);
  if (!u) {
    toast('Blocked unsafe URL','error');
    return;
  }
  window.open(u, '_blank', 'noopener,noreferrer');
}

function resetAnalysis() {
  document.getElementById('results').style.display = 'none';
  document.getElementById('queryInput').value = '';
  lastResult = null;
}

// ======= ASANA AUTO-SYNC HELPER =======
async function autoSyncToAsana(taskName, taskNotes, dueInDays) {
  if (!ASANA_TOKEN && !PROXY_URL) return null;
  try {
    const due = new Date(); due.setDate(due.getDate() + (dueInDays || 14));
    const body = { data: { name: taskName, notes: taskNotes, projects: [getAsanaProject()], due_on: due.toISOString().split('T')[0] } };
    setAsanaModuleSync('writeback', { status: 'Syncing', lastError: '' });
    const r = await asanaFetch('/tasks', { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok) throw new Error('Asana API returned ' + r.status);
    const d = await r.json();
    if (d.errors) throw new Error(d.errors[0]?.message || 'Asana error');
    setAsanaModuleSync('writeback', { status: 'Healthy', lastSuccess: new Date().toISOString(), lastError: '', lastCount: 1 });
    return d.data?.gid || null;
  } catch (e) {
    setAsanaModuleSync('writeback', { status: 'Degraded', lastError: e.message });
    return null;
  }
}

// ======= SCREENING PROJECT — Single Asana project for ALL screening tasks =======
const SCREENING_PROJECT_CACHE_KEY = 'fgl_asana_screening_project_gid';

/**
 * Find or create a single "SCREENINGS" project in Asana.
 * ALL screening tasks go into this one project.
 */
async function getOrCreateScreeningProject() {
  if (!ASANA_TOKEN && !PROXY_URL) return null;
  const projectName = 'SCREENINGS';

  // Check cache
  const cachedGid = localStorage.getItem(SCREENING_PROJECT_CACHE_KEY);
  if (cachedGid) {
    try {
      const check = await asanaFetch('/projects/' + cachedGid + '?opt_fields=name,archived');
      const checkData = await check.json();
      if (checkData.data && !checkData.data.archived) return cachedGid;
      localStorage.removeItem(SCREENING_PROJECT_CACHE_KEY);
    } catch(_) {
      return cachedGid; // Network error — use cached
    }
  }

  // Search for existing SCREENINGS project
  try {
    const searchR = await asanaFetch('/projects?workspace=' + ASANA_WORKSPACE + '&opt_fields=name,archived&limit=100');
    const searchData = await searchR.json();
    if (searchData.data) {
      const existing = searchData.data.find(p => !p.archived && p.name === projectName);
      if (existing) {
        localStorage.setItem(SCREENING_PROJECT_CACHE_KEY, existing.gid);
        return existing.gid;
      }
    }
  } catch(_) {}

  // Create SCREENINGS project
  try {
    const createBody = {
      data: {
        name: projectName,
        notes: 'TFS / Sanctions Screening — All screening tasks\nCreated by Hawkeye Sterling V2.\n\nRegulatory Basis: UAE FDL No.10/2025, FATF Rec 6, Cabinet Decision No.74/2020',
        layout: 'list',
        default_view: 'list'
      }
    };
    const createR = await asanaFetch('/projects', { method: 'POST', body: JSON.stringify(createBody) });
    const createData = await createR.json();
    if (createData.errors) throw new Error(createData.errors[0]?.message || 'Asana error');
    const newGid = createData.data?.gid;
    if (newGid) {
      localStorage.setItem(SCREENING_PROJECT_CACHE_KEY, newGid);
      return newGid;
    }
  } catch(e) {
    console.error('[SCREENINGS] Failed to create project:', e.message);
  }
  return null;
}

/**
 * Sync a screening task to the SCREENINGS project in Asana.
 */
async function syncScreeningToAsana(entityName, taskName, taskNotes, dueInDays) {
  if (!ASANA_TOKEN && !PROXY_URL) return null;
  try {
    const projectGid = await getOrCreateScreeningProject();
    if (!projectGid) {
      return autoSyncToAsana(taskName, taskNotes, dueInDays);
    }
    const due = new Date(); due.setDate(due.getDate() + (dueInDays || 14));
    const body = { data: { name: taskName, notes: taskNotes, projects: [projectGid], due_on: due.toISOString().split('T')[0] } };
    setAsanaModuleSync('writeback', { status: 'Syncing', lastError: '' });
    const r = await asanaFetch('/tasks', { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok) throw new Error('Asana API returned ' + r.status);
    const d = await r.json();
    if (d.errors) throw new Error(d.errors[0]?.message || 'Asana error');
    setAsanaModuleSync('writeback', { status: 'Healthy', lastSuccess: new Date().toISOString(), lastError: '', lastCount: 1 });
    return d.data?.gid || null;
  } catch (e) {
    setAsanaModuleSync('writeback', { status: 'Degraded', lastError: e.message });
    // Fallback: try default sync
    return autoSyncToAsana(taskName, taskNotes, dueInDays);
  }
}

// ======= ASANA WRITE-BACK =======
let pendingTaskData = {};

function prefillCreateTask(name, notes) {
  if (!ASANA_TOKEN && !PROXY_URL) { toast('Asana token or Proxy URL required. Add it in Settings.','error'); return; }
  document.getElementById('newTaskName').value = name;
  document.getElementById('newTaskNotes').value = notes;
  const d = new Date(); d.setDate(d.getDate()+14);
  document.getElementById('newTaskDue').value = d.toISOString().split('T')[0];
  document.getElementById('createTaskModal').classList.add('open');
}

function closeModal() { document.getElementById('createTaskModal').classList.remove('open'); }

async function submitCreateTask() {
  const name = document.getElementById('newTaskName').value.trim();
  const notes = document.getElementById('newTaskNotes').value.trim();
  const due = document.getElementById('newTaskDue').value;
  const priorityGid = document.getElementById('newTaskPriority').value;
  const sectionGid = document.getElementById('newTaskSection').value;
  if (!name) { toast('Task name is required','error'); return; }
  if (!ASANA_TOKEN && !PROXY_URL) { toast('Asana token required','error'); return; }

  const body = { data: { name, notes, projects: [getAsanaProject()] } };
  if (due) body.data.due_on = due;
  if (priorityGid) body.data.custom_fields = { '1213759653333851': priorityGid };

  try {
    setAsanaModuleSync('writeback', { status: 'Syncing', lastError: '' });
    const r = await asanaFetch('/tasks', { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok) throw new Error('Asana API returned ' + r.status);
    const d = await r.json();
    if (d.errors) throw new Error(d.errors[0]?.message || 'Asana error');
    const taskGid = d.data?.gid;
    if (sectionGid && taskGid) {
      await asanaFetch(`/sections/${sectionGid}/addTask`, {
        method: 'POST',
        body: JSON.stringify({ data: { task: taskGid } })
      });
    }
    closeModal();
    setAsanaModuleSync('writeback', { status: 'Healthy', lastSuccess: new Date().toISOString(), lastError: '', lastCount: 1 });
    toast(`Task created in Asana: ${name}`, 'success', 4000);

    // Save gap to dynamic gap register and fire workflow trigger
    const gapEntry = { id: Date.now(), title: name, description: notes, severity: name.match(/^CRITICAL/i) ? 'critical' : name.match(/^HIGH/i) ? 'high' : name.match(/^MEDIUM/i) ? 'medium' : 'low', status: 'open', asanaGid: taskGid || '', createdAt: new Date().toISOString() };
    const gapList = safeLocalParse('fgl_gaps_v2', []);
    gapList.unshift(gapEntry);
    safeLocalSave('fgl_gaps_v2', gapList);
    logAudit('gap_created', `Gap created: ${name}`);
    if (typeof WorkflowEngine !== 'undefined') WorkflowEngine.processTrigger('new_gap', { title: name, severity: gapEntry.severity, description: notes });
  } catch(e) {
    queueAsanaRetry({ kind: 'manual-task-create', body, sectionGid, taskName: name, lastError: e.message });
    setAsanaModuleSync('writeback', { status: 'Degraded', lastError: e.message, lastCount: 0 });
    toast('Failed to create task: ' + e.message, 'error', 5000);
  }
}

// ======= ASANA READ =======
async function loadAsanaTasks(silent) {
  if (!ASANA_TOKEN && !PROXY_URL) {
    document.getElementById('asanaContent').innerHTML = '<p style="color:var(--amber);font-size:13px;font-family:\'Montserrat\',sans-serif">No Asana token configured. Add it in Settings to see live tasks.</p>';
    setAsanaModuleSync('tasks', { status: 'Idle', lastError: 'No Asana token configured' });
    return;
  }
  if (!silent) document.getElementById('asanaContent').innerHTML = '<p style="color:var(--muted);font-size:13px">Loading from Asana...</p>';
  setAsanaModuleSync('tasks', { status: 'Refreshing', lastError: '' });
  try {
    var projectGid = getAsanaProject();
    var r, d;
    try {
      r = await asanaFetch(`/projects/${projectGid}/tasks?opt_fields=name,completed,due_on,assignee.name,memberships.section.name&limit=100`);
      d = await r.json();
      if (d.errors) throw new Error(d.errors[0]?.message);
    } catch(primaryErr) {
      // Fallback: try SCREENINGS project
      var screeningsGid = localStorage.getItem('fgl_asana_screening_project_gid');
      if (screeningsGid && screeningsGid !== projectGid) {
        r = await asanaFetch(`/projects/${screeningsGid}/tasks?opt_fields=name,completed,due_on,assignee.name,memberships.section.name&limit=100`);
        d = await r.json();
        if (d.errors) throw new Error(d.errors[0]?.message);
      } else {
        throw primaryErr;
      }
    }
    const tasks = d.data || [];
    const today = new Date(); today.setHours(0,0,0,0);
    const week = new Date(today); week.setDate(week.getDate()+7);
    const overdue = tasks.filter(t=>!t.completed&&t.due_on&&new Date(t.due_on)<today);
    const dueWeek = tasks.filter(t=>!t.completed&&t.due_on&&new Date(t.due_on)>=today&&new Date(t.due_on)<=week);
    const noDue = tasks.filter(t=>!t.completed&&!t.due_on);
    const done = tasks.filter(t=>t.completed);
    let html = `<div class="metrics" style="margin-bottom:1rem">
      <div class="metric m-c"><div class="metric-num">${overdue.length}</div><div class="metric-lbl">Overdue</div></div>
      <div class="metric m-h"><div class="metric-num">${dueWeek.length}</div><div class="metric-lbl">Due This Week</div></div>
      <div class="metric m-m"><div class="metric-num">${noDue.length}</div><div class="metric-lbl">No Date</div></div>
      <div class="metric m-ok"><div class="metric-num">${done.length}</div><div class="metric-lbl">Completed</div></div>
    </div>`;
    if (overdue.length) {
      html += `<div class="sec-title">Overdue Tasks (${overdue.length})</div>`;
      overdue.forEach(t => { html += `<div class="asana-item"><div><div class="asana-name">${escHtml(t.name)}</div><div class="asana-meta">Due: ${escHtml(t.due_on)}${t.assignee ? ' | ' + escHtml(t.assignee.name) : ''}</div></div><div style="display:flex;gap:4px;align-items:center"><button class="btn btn-sm btn-green" style="padding:2px 8px;font-size:9px" data-action="_openEditAsanaTaskFromEl" data-gid="${escHtml(t.gid)}" data-task-name="${escHtml(t.name)}" data-due="${t.due_on||''}" data-assignee="${t.assignee?escHtml(t.assignee.name):''}">Edit</button><span class="asana-status s-overdue">OVERDUE</span></div></div>`; });
    }
    if (dueWeek.length) {
      html += `<div class="sec-title" style="margin-top:1rem">Due This Week (${dueWeek.length})</div>`;
      dueWeek.forEach(t => { html += `<div class="asana-item"><div><div class="asana-name">${escHtml(t.name)}</div><div class="asana-meta">Due: ${escHtml(t.due_on)}${t.assignee ? ' | ' + escHtml(t.assignee.name) : ''}</div></div><div style="display:flex;gap:4px;align-items:center"><button class="btn btn-sm btn-green" style="padding:2px 8px;font-size:9px" data-action="_openEditAsanaTaskFromEl" data-gid="${escHtml(t.gid)}" data-task-name="${escHtml(t.name)}" data-due="${t.due_on||''}" data-assignee="${t.assignee?escHtml(t.assignee.name):''}">Edit</button><span class="asana-status s-due">DUE SOON</span></div></div>`; });
    }
    if (!overdue.length && !dueWeek.length) html += '<p style="color:var(--green);font-size:13px">No overdue or imminently due tasks.</p>';
    document.getElementById('asanaContent').innerHTML = html;
    setAsanaModuleSync('tasks', { status: 'Healthy', lastSuccess: new Date().toISOString(), lastError: '', lastCount: tasks.length });
  } catch(e) {
    var prevSync = asanaSyncState && asanaSyncState.modules && asanaSyncState.modules.tasks;
    var hadPreviousSuccess = prevSync && prevSync.lastSuccess;
    if (silent && hadPreviousSuccess) {
      // Silent refresh failed but we had a previous success — keep Healthy, don't alarm user
      setAsanaModuleSync('tasks', { status: 'Healthy', lastError: 'Retry pending: ' + e.message });
    } else if (!silent && hadPreviousSuccess) {
      // Explicit refresh failed but had previous success — show warning, don't wipe data
      toast('Asana refresh failed — retrying. Previous data still shown.', 'info', 3000);
      setAsanaModuleSync('tasks', { status: 'Healthy', lastError: 'Last refresh failed: ' + e.message });
      // Auto-retry once after 3 seconds
      setTimeout(function() { loadAsanaTasks(true).catch(function(){}); }, 3000);
    } else {
      // Never connected successfully
      if (!silent) {
        document.getElementById('asanaContent').innerHTML = `<p style="color:var(--amber);font-size:13px">Could not connect to Asana. Check your token in Settings or try again.</p>`;
        toast('Asana connection issue — check Settings', 'error', 4000);
      }
      setAsanaModuleSync('tasks', { status: 'Error', lastError: e.message, lastCount: 0 });
    }
  }
}

// ======= EDIT ASANA TASK =======
function openEditAsanaTask(gid, name, dueOn, assigneeName) {
  var old = document.getElementById('editAsanaTaskModal');
  if (old) old.remove();

  var html = `<div class="modal-overlay" id="editAsanaTaskModal">
    <div class="modal" style="max-width:500px;width:95%">
      <button class="modal-close" data-action="_closeEditAsanaModal">✕</button>
      <div class="modal-title">Edit Asana Task</div>
      <input type="hidden" id="eat-gid" value="${escHtml(gid)}">
      <div style="margin-bottom:10px"><span class="lbl">Task Name *</span><input id="eat-name" value="${name.replace(/"/g,'&quot;')}"></div>
      <div class="row row-2" style="margin-bottom:10px">
        <div><span class="lbl">Due Date</span><input type="text" id="eat-due" value="${dueOn || ''}" placeholder="dd/mm/yyyy" data-input="_formatDateInput" maxlength="10"></div>
        <div><span class="lbl">Assignee</span><input id="eat-assignee" value="${(assigneeName || '').replace(/"/g,'&quot;')}" placeholder="Name or email"></div>
      </div>
      <div style="margin-bottom:10px"><span class="lbl">Notes (append)</span><textarea id="eat-notes" placeholder="Add notes to this task..." style="min-height:60px"></textarea></div>
      <div style="display:flex;gap:8px;margin-top:1rem">
        <button class="btn btn-green" data-action="saveEditAsanaTask" style="flex:1;padding:12px;font-weight:600">Save & Update Asana</button>
        <button class="btn btn-sm btn-gold" data-action="markAsanaTaskComplete" style="padding:12px 16px">Mark Complete</button>
        <button class="btn btn-sm" data-action="_closeEditAsanaModal" style="padding:12px 16px">Cancel</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  document.getElementById('editAsanaTaskModal').classList.add('open');
}

async function saveEditAsanaTask() {
  var gid = document.getElementById('eat-gid').value;
  var name = document.getElementById('eat-name').value.trim();
  var dueOn = document.getElementById('eat-due').value;
  var assignee = document.getElementById('eat-assignee').value.trim();
  var notes = document.getElementById('eat-notes').value.trim();
  if (!gid) return;
  if (!name) { toast('Task name is required', 'error'); return; }

  var updateData = { name: name };
  if (dueOn) updateData.due_on = dueOn;

  toast('Updating task in Asana...', 'info', 5000);
  try {
    // Update task name and due date
    var r = await asanaFetch('/tasks/' + gid, {
      method: 'PUT',
      body: JSON.stringify({ data: updateData })
    });
    var d = await r.json();
    if (d.errors) throw new Error(d.errors[0]?.message || 'Asana error');

    // Append notes if provided
    if (notes) {
      await asanaFetch('/tasks/' + gid + '/stories', {
        method: 'POST',
        body: JSON.stringify({ data: { text: notes } })
      });
    }

    // Assign if provided (search for user by name)
    if (assignee) {
      try {
        var usersR = await asanaFetch('/workspaces/' + ASANA_WORKSPACE + '/users?opt_fields=name,email&limit=50');
        var usersD = await usersR.json();
        if (usersD.data) {
          var match = usersD.data.find(u =>
            u.name.toLowerCase().includes(assignee.toLowerCase()) ||
            (u.email && u.email.toLowerCase().includes(assignee.toLowerCase()))
          );
          if (match) {
            await asanaFetch('/tasks/' + gid, {
              method: 'PUT',
              body: JSON.stringify({ data: { assignee: match.gid } })
            });
          }
        }
      } catch(_) {}
    }

    document.getElementById('editAsanaTaskModal').classList.remove('open');
    toast('Task updated in Asana', 'success');
    loadAsanaTasks(false);
  } catch(e) {
    toast('Failed to update: ' + e.message, 'error');
  }
}

async function markAsanaTaskComplete() {
  var gid = document.getElementById('eat-gid').value;
  if (!gid) return;
  if (!confirm('Mark this task as complete in Asana?')) return;
  try {
    var r = await asanaFetch('/tasks/' + gid, {
      method: 'PUT',
      body: JSON.stringify({ data: { completed: true } })
    });
    var d = await r.json();
    if (d.errors) throw new Error(d.errors[0]?.message);
    document.getElementById('editAsanaTaskModal').classList.remove('open');
    toast('Task marked complete', 'success');
    loadAsanaTasks(false);
  } catch(e) {
    toast('Failed: ' + e.message, 'error');
  }
}

// ======= PDF EXPORT =======
async function exportPDF() {
  if (!requireJsPDF()) return;
  if (!lastResult) { toast('Run an analysis first','error'); return; }
  toast('Generating PDF...','info',2000);
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'mm', format:'a4' });
    const W = 190; let y = 20;
    const addLine = (text, size=10, bold=false, color=[240,237,232], indent=0) => {
      doc.setFontSize(size); doc.setFont('helvetica', bold?'bold':'normal');
      doc.setTextColor(...color);
      const lines = doc.splitTextToSize(text, W - indent);
      lines.forEach(l => { if(y>270){doc.addPage();y=20;} doc.text(l, 20+indent, y); y += size*0.4+2; });
      y += 1;
    };
    const addDivider = () => { doc.setDrawColor(60,60,60); doc.line(20,y,200,y); y+=4; };
    // Header
    doc.setFillColor(14,15,17); doc.rect(0,0,210,297,'F');
    doc.setFillColor(201,168,76); doc.rect(0,0,210,2,'F');
    addLine('COMPLIANCE TASKS', 18, true, [201,168,76]);
    addLine('COMPLIANCE ANALYSIS REPORT', 11, false, [122,120,112]);
    addLine(`Generated: ${new Date().toLocaleString('en-AE',{timeZone:'Asia/Dubai'})} (Dubai time)`, 9, false, [122,120,112]);
    addLine(`Query: ${lastQuery}`, 9, false, [122,120,112]);
    y += 4; addDivider();
    // Metrics
    const m = lastResult.metrics||{};
    addLine('FINDINGS SUMMARY', 9, true, [122,120,112]);
    addLine(`Critical: ${m.critical||0}  |  High: ${m.high||0}  |  Medium: ${m.medium||0}  |  Compliant: ${m.compliant||0}`, 10, false, [240,237,232]);
    y+=3; addDivider();
    // Summary
    addLine('EXECUTIVE SUMMARY', 9, true, [122,120,112]);
    addLine(lastResult.summary||'', 10, false, [240,237,232]);
    y+=3; addDivider();
    // Findings
    addLine('FINDINGS AND RECOMMENDATIONS', 9, true, [122,120,112]);
    (lastResult.findings||[]).forEach((f,i) => {
      y+=2;
      const col = f.severity==='CRITICAL'?[217,79,79]:f.severity==='HIGH'?[232,160,48]:f.severity==='COMPLIANT'?[61,168,118]:[74,143,193];
      addLine(`[${f.severity||'MEDIUM'}] ${f.title||''}`, 11, true, col);
      addLine(f.body||'', 10, false, [200,197,192], 4);
      if(f.regulatory_ref) addLine(`Ref: ${f.regulatory_ref}`, 9, false, [201,168,76], 4);
      if(f.recommendation) addLine(`Action: ${f.recommendation}`, 10, false, [240,237,232], 4);
      y+=2;
    });
    y+=4; addDivider();
    // Footer
    addLine('Compliance Tasks | Trade License 643756 | Compliance Officer: Luisa Fernanda', 8, false, [80,78,76]);
    addLine('UAE FDL No.(10) of 2025 | FATF | LBMA RGG v9 | UAE FIU | OECD', 8, false, [80,78,76]);
    doc.setFillColor(201,168,76); doc.rect(0,295,210,2,'F');
    const fname = `ComplianceTasks_Compliance_Report_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(fname);
    toast(`PDF saved: ${fname}`, 'success', 4000);
  } catch(e) {
    toast('PDF error: ' + e.message, 'error', 5000);
  }
}

// ======= COPY REPORT =======
function copyReport() {
  if (!lastResult) { toast('Run an analysis first','error'); return; }
  const s = lastResult.summary||'';
  const f = (lastResult.findings||[]).map(f=>`[${f.severity}] ${f.title}\n${f.body}\nRef: ${f.regulatory_ref}\nAction: ${f.recommendation}`).join('\n\n---\n\n');
  const ts = new Date().toLocaleString('en-AE',{timeZone:'Asia/Dubai'});
  navigator.clipboard.writeText(`COMPLIANCE TASKS - COMPLIANCE ANALYSIS REPORT\nGenerated: ${ts}\nQuery: ${lastQuery}\n\nSUMMARY\n${s}\n\nFINDINGS\n${f}`);
  toast('Report copied to clipboard','success');
}

// ======= SAVE TO HISTORY =======
function saveToScheduleHistory() {
  if (!lastResult) { toast('Run an analysis first','error'); return; }
  const entry = { ts: new Date().toISOString(), query: lastQuery, area: lastArea, metrics: lastResult.metrics, summary: lastResult.summary };
  history.unshift(entry);
  if (history.length > 20) history.pop();
  safeLocalSave('fgl_history', history);
  renderHistory();
  toast('Saved to analysis history','success');
}

// ======= SCHEDULED ANALYSIS =======
document.getElementById('schedTopic').addEventListener('change', function() {
  document.getElementById('schedCustomRow').style.display = this.value==='custom' ? 'block' : 'none';
});

function addSchedule() {
  const topicSel = document.getElementById('schedTopic').value;
  const topic = topicSel==='custom' ? document.getElementById('schedCustomTopic').value.trim() : topicSel;
  const freq = document.getElementById('schedFreq').value;
  const nextRun = document.getElementById('schedNextRun').value;
  const area = document.getElementById('schedArea').value;
  if (!topic) { toast('Please select or enter a topic','error'); return; }
  if (!nextRun) { toast('Please set a next run date','error'); return; }
  const s = { id: Date.now(), topic, freq, nextRun, area, label: topicSel==='custom'?topic:document.getElementById('schedTopic').selectedOptions[0].text };
  schedules.push(s);
  safeLocalSave('fgl_schedules', schedules);
  renderSchedules();
  toast('Schedule added','success');
}

function deleteSchedule(id) {
  if (!confirm('Are you sure you want to delete this schedule?')) return;
  schedules = schedules.filter(s=>s.id!==id);
  safeLocalSave('fgl_schedules', schedules);
  renderSchedules();
  toast('Schedule removed','info');
}

function renderSchedules() {
  const el = document.getElementById('scheduleList');
  if (!schedules.length) { el.innerHTML = '<p style="color:var(--muted);font-size:13px">No schedules configured.</p>'; return; }
  const today = new Date().toISOString().split('T')[0];
  el.innerHTML = schedules.map(s => {
    const isDue = s.nextRun <= today;
    return `<div class="schedule-item">
      <div class="schedule-info">
        <div class="schedule-name">${escHtml(s.label)}</div>
        <div class="schedule-meta">${escHtml(s.freq.toUpperCase())} · Area: ${escHtml(s.area)}</div>
        <div class="schedule-next">${isDue ? '⚡ DUE NOW' : 'Next: '+s.nextRun}</div>
      </div>
      <div style="display:flex;gap:6px">
        ${isDue ? `<button class="btn btn-sm btn-green" data-action="runScheduledAnalysis" data-arg="${s.id}">Run Now</button>` : ''}
        <button class="btn btn-sm btn-red" data-action="deleteSchedule" data-arg="${s.id}">Remove</button>
      </div>
    </div>`;
  }).join('');
}

async function runScheduledAnalysis(id) {
  const s = schedules.find(x=>x.id===id);
  if (!s) return;
  switchTab('analyse');
  document.getElementById('areaSelect').value = s.area;
  toast(`Running scheduled analysis: ${s.label}`, 'info', 3000);
  await runAnalysis(s.topic, s.area);
  // Advance next run date
  const next = new Date(s.nextRun);
  if (s.freq==='weekly') next.setDate(next.getDate()+7);
  else if (s.freq==='monthly') { const d=next.getDate(); next.setDate(1); next.setMonth(next.getMonth()+1); next.setDate(Math.min(d, new Date(next.getFullYear(),next.getMonth()+1,0).getDate())); }
  else if (s.freq==='quarterly') { const d=next.getDate(); next.setDate(1); next.setMonth(next.getMonth()+3); next.setDate(Math.min(d, new Date(next.getFullYear(),next.getMonth()+1,0).getDate())); }
  s.nextRun = next.toISOString().split('T')[0];
  safeLocalSave('fgl_schedules', schedules);
  renderSchedules();
}

async function runDueSchedules() {
  const today = new Date().toISOString().split('T')[0];
  const due = schedules.filter(s=>s.nextRun<=today);
  if (!due.length) { toast('No schedules due today','info'); return; }
  toast(`Running ${due.length} due schedule(s)...`,'info',3000);
  for (const s of due) { await runScheduledAnalysis(s.id); await new Promise(r=>setTimeout(r,1500)); }
}

function renderHistory() {
  const el = document.getElementById('scheduleHistory');
  if (!history.length) { el.innerHTML = '<p style="color:var(--muted);font-size:13px">No saved reports.</p>'; return; }
  el.innerHTML = history.map((h,i) => {
    const m = h.metrics||{};
    const ts = new Date(h.ts).toLocaleString('en-AE',{timeZone:'Asia/Dubai',dateStyle:'medium',timeStyle:'short'});
    return `<div class="asana-item" style="flex-direction:column;align-items:flex-start;gap:6px">
      <div style="display:flex;width:100%;justify-content:space-between;align-items:center">
        <div class="asana-name" style="font-size:12px">${escHtml(h.query.substring(0,80))}${h.query.length>80?'...':''}</div>
        <span style="font-size:10px;color:var(--muted);font-family:'Montserrat',sans-serif;flex-shrink:0;margin-left:10px">${ts}</span>
      </div>
      <div style="font-size:11px;color:var(--muted)">${h.summary?escHtml(h.summary.substring(0,120))+'...':''}</div>
      <div style="display:flex;gap:8px">
        <span style="font-size:10px;color:var(--red);font-family:'Montserrat',sans-serif">C:${m.critical||0}</span>
        <span style="font-size:10px;color:var(--amber);font-family:'Montserrat',sans-serif">H:${m.high||0}</span>
        <span style="font-size:10px;color:var(--blue);font-family:'Montserrat',sans-serif">M:${m.medium||0}</span>
        <span style="font-size:10px;color:var(--green);font-family:'Montserrat',sans-serif">OK:${m.compliant||0}</span>
      </div>
    </div>`;
  }).join('');
}

// ======= EVIDENCE TRACKER =======
const CRITICAL_TASKS = [
  {id:'gap001', name:'CRITICAL: Resolve CDD Review Frequency Conflict (GAP-001)', folder:'01 - Compliance Manual and Policies'},
  {id:'gap002', name:'CRITICAL: Commission LBMA Independent Third-Party Audit (GAP-002)', folder:'08 - Responsible Sourcing / LBMA Audit'},
  {id:'gap003', name:'CRITICAL: Create Customer Risk Assessment Form (GAP-003)', folder:'02 - Risk Assessments'},
  {id:'gap004', name:'CRITICAL: Populate UBO Register (GAP-004)', folder:'04 - UBO Register'},
  {id:'gap005', name:'CRITICAL: Resolve Duplicate Document Coding (GAP-005)', folder:'01 - Compliance Manual and Policies'}
];

async function loadEvidenceFromAsana() {
  if (!ASANA_TOKEN && !PROXY_URL) { toast('Asana token required','error'); return; }
  toast('Loading tasks from Asana...','info',2000);
  setAsanaModuleSync('evidence', { status: 'Refreshing', lastError: '' });
  try {
    const r = await asanaFetch(`/projects/${getAsanaProject()}/tasks?opt_fields=name,gid,completed&limit=100`);
    const d = await r.json();
    if (d.errors) throw new Error(d.errors[0]?.message);
    const tasks = (d.data||[]).filter(t=>!t.completed).slice(0,30);
    tasks.forEach(t => { if (!evidenceData[t.gid]) evidenceData[t.gid] = { name: t.name, link: '', asanaGid: t.gid }; });
    safeLocalSave('fgl_evidence', evidenceData);
    renderEvidence(tasks);
    setAsanaModuleSync('evidence', { status: 'Healthy', lastSuccess: new Date().toISOString(), lastError: '', lastCount: tasks.length });
    toast(`Loaded ${tasks.length} tasks`,'success');
  } catch(e) {
    setAsanaModuleSync('evidence', { status: 'Error', lastError: e.message, lastCount: 0 });
    toast('Error: '+e.message,'error',5000);
  }
}

function renderEvidence(tasks) {
  const el = document.getElementById('evidenceList');
  // Merge critical tasks with asana tasks
  const allItems = [...CRITICAL_TASKS.map(t=>({id:t.id, name:t.name, folder:t.folder}))];
  Object.entries(evidenceData).forEach(([id,v]) => { if (!allItems.find(x=>x.id===id)) allItems.push({id, name:v.name, folder:''}); });
  const na = allItems.filter(t=>(evidenceData[t.id]?.link||'')==='N/A').length;
  const linked = allItems.filter(t=>(evidenceData[t.id]?.link||'').trim().length>5 && evidenceData[t.id]?.link!=='N/A').length;
  const missing = allItems.filter(t=>!(evidenceData[t.id]?.link||'').trim()).length;
  const partial = allItems.length - linked - missing - na;
  document.getElementById('evCountLinked').textContent = linked;
  document.getElementById('evCountPartial').textContent = partial;
  document.getElementById('evCountMissing').textContent = missing;
  if (!allItems.length) { el.innerHTML='<p style="color:var(--muted);font-size:13px">No tasks loaded.</p>'; return; }
  el.innerHTML = allItems.map(t => {
    const saved = evidenceData[t.id]?.link || '';
    const hasLink = saved.trim().length > 5;
    return `<div class="evidence-item">
      <div class="evidence-header">
        <div><div class="evidence-name">${escHtml(t.name)}</div>${t.folder?`<div class="evidence-meta">Drive folder: ${escHtml(t.folder)}</div>`:''}</div>
        <div class="evidence-status">
          <div class="ev-dot ${hasLink?'ev-linked':'ev-missing'}"></div>
          <span class="ev-label" style="color:${saved==='N/A'?'#4A8FC1':hasLink?'var(--green)':'var(--red)'};">${saved==='N/A'?'N/A':hasLink?'LINKED':'MISSING'}</span>
        </div>
      </div>
      <div class="ev-link-input">
        <input type="text" placeholder="Paste Google Drive folder URL..." value="${escHtml(saved)}" id="ev_${t.id}" />
        <button class="btn btn-sm btn-green" data-action="saveEvidenceLink" data-arg="${t.id}">Save</button>
        <button class="btn btn-sm" style="background:rgba(74,143,193,0.15);color:#4A8FC1;border:1px solid rgba(74,143,193,0.4)" data-action="markEvidenceNA" data-arg="${t.id}">N/A</button>
        ${hasLink?`<button class="btn btn-sm" data-action="_openSafeUrlFromDataUrl" data-url="${escHtml(saved)}">Open</button>`:''}
      </div>
    </div>`;
  }).join('');
}

function saveEvidenceLink(id) {
  const val = document.getElementById(`ev_${id}`)?.value?.trim();
  if (!evidenceData[id]) evidenceData[id] = { name: '', link: '' };
  evidenceData[id].link = val || '';
  safeLocalSave('fgl_evidence', evidenceData);
  renderEvidence();
  toast(val ? 'Evidence link saved' : 'Link cleared','success');
}

function markEvidenceNA(id) {
  if (!evidenceData[id]) evidenceData[id] = { name: '', link: '' };
  evidenceData[id].link = 'N/A';
  safeLocalSave('fgl_evidence', evidenceData);
  renderEvidence();
  toast('Marked as Not Applicable','info');
}

function exportEvidenceCSV() {
  const rows = [['Task Name','Drive Link','Status']];
  Object.values(evidenceData).forEach(v => {
    rows.push([`"${v.name}"`, `"${v.link||''}"`, v.link?'LINKED':'MISSING']);
  });
  const csv = rows.map(r=>r.join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=`ComplianceTasks_Evidence_Tracker_${new Date().toISOString().split('T')[0]}.csv`; a.click();
  toast('Evidence tracker exported as CSV','success');
}
function exportEvidencePDF() {
  if (!requireJsPDF()) return;
  const entries = Object.values(evidenceData);
  if (!entries.length) { toast('No evidence data to export','error'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const pw = doc.internal.pageSize.getWidth();
  doc.setFillColor(30,30,30); doc.rect(0,0,pw,28,'F');
  doc.setFontSize(16); doc.setTextColor(180,151,90); doc.text('Evidence Upload Tracker', 14, 18);
  doc.setFontSize(8); doc.setTextColor(120); doc.text('Generated: '+new Date().toLocaleDateString('en-GB'), pw-14, 18, {align:'right'});
  let y = 36;
  entries.forEach((v, i) => {
    if (y > 270) { doc.addPage(); y = 20; }
    const status = v.link ? 'LINKED' : 'MISSING';
    doc.setFontSize(10); doc.setTextColor(v.link ? 39 : 217, v.link ? 174 : 79, v.link ? 96 : 79);
    doc.text((i+1)+'. ['+status+'] '+(v.name||''), 14, y);
    if (v.link) { doc.setTextColor(120); doc.setFontSize(8); doc.text(v.link, 14, y+4); y += 4; }
    y += 8;
  });
  doc.save('Evidence_Tracker_'+new Date().toISOString().slice(0,10)+'.pdf');
  toast('PDF exported','success');
}
function exportEvidenceDOCX() {
  const entries = Object.values(evidenceData);
  if (!entries.length) { toast('No evidence data to export','error'); return; }
  let html = wordDocHeader('Evidence Upload Tracker');
  html += '<table><tr><th>#</th><th>Task Name</th><th>Drive Link</th><th>Status</th></tr>';
  entries.forEach((v, i) => {
    html += '<tr><td>'+(i+1)+'</td><td>'+(v.name||'')+'</td><td>'+(v.link||'—')+'</td><td class="'+(v.link?'ok':'miss')+'">'+(v.link?'Linked':'Missing')+'</td></tr>';
  });
  html += '</table>' + wordDocFooter();
  downloadWordDoc(html, 'Evidence_Tracker_'+new Date().toISOString().slice(0,10)+'.doc');
  toast('Word exported','success');
}

// ======= IAR REPORT ATTACHMENTS =======
let iarAttachments = safeLocalParse('fgl_iar_attachments', []);
function attachIARFile(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  if (file.size > 5 * 1024 * 1024) { toast('Max 5MB','error'); input.value=''; return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    iarAttachments.push({ id: Date.now(), name: file.name, data: e.target.result, addedAt: new Date().toISOString() });
    safeLocalSave('fgl_iar_attachments', iarAttachments);
    renderIARAttachments();
    toast('File attached: ' + file.name, 'success');
  };
  reader.readAsDataURL(file);
  input.value = '';
}
function renderIARAttachments() {
  const el = document.getElementById('iarAttachments');
  if (!el) return;
  el.innerHTML = iarAttachments.map(a => `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(201,168,76,0.05);border-radius:3px;padding:3px 8px;font-size:10px"><span style="color:var(--gold);cursor:pointer" data-action="downloadGenericAttachment" data-arg="fgl_iar_attachments" data-arg2="${a.id}">📎 ${escHtml(a.name)}</span><span style="color:var(--red);cursor:pointer;font-weight:700" data-action="_removeGenericAttachment" data-store-key="fgl_iar_attachments" data-attach-id="${a.id}" data-arr-name="iarAttachments" data-render-fn="renderIARAttachments">&times;</span></span>`).join('');
}

// ======= DRIVE STRUCTURE =======
function saveDriveLink() {
  const link = document.getElementById('driveMainLink').value.trim();
  if (!link) { toast('Enter a Google Drive folder link', 'error'); return; }
  localStorage.setItem('fgl_drive_link', link);
  toast('Drive link saved', 'success');
  renderDriveStatus();
}

function loadDriveLink() {
  let link = localStorage.getItem('fgl_drive_link') || '';
  if (!link && GDRIVE_FOLDER_ID) {
    link = 'https://drive.google.com/drive/folders/' + GDRIVE_FOLDER_ID;
    localStorage.setItem('fgl_drive_link', link);
  }
  const el = document.getElementById('driveMainLink');
  if (el && link) el.value = link;
  renderDriveStatus();
}

function renderDriveStatus() {
  const link = localStorage.getItem('fgl_drive_link') || '';
  const el = document.getElementById('driveSavedStatus');
  if (!el) return;
  if (link) {
    let fullLink = link;
    if (!fullLink.startsWith('http') && !fullLink.startsWith('//')) fullLink = 'https://drive.google.com/drive/folders/' + fullLink.replace(/^\/+/, '');
    el.innerHTML = '<span style="color:var(--green)">Saved</span> — <a href="' + escHtml(fullLink) + '" target="_blank" rel="noopener" style="color:var(--gold);text-decoration:underline">Open in Google Drive</a>';
  } else {
    el.textContent = 'No link saved yet.';
  }
}

function renderDrive() { loadDriveLink(); }

// ======= COMPLIANCE PROGRAMME SUB-TABS =======
function switchCProgSub(sub) {
  document.querySelectorAll('.cprog-section').forEach(s => s.style.display = 'none');
  document.querySelectorAll('.cprog-sub').forEach(b => b.classList.remove('active'));
  const el = document.getElementById('cprog-' + sub);
  if (el) el.style.display = '';
  event.target.classList.add('active');
}

// ── EWRA ──
const EWRA_KEY = 'fgl_ewra';
const EWRA_INHERENT_RISKS = [
  { cat: 'Customer Risk', factor: 'PEPs, high-net-worth individuals, shell companies' },
  { cat: 'Customer Risk', factor: 'Non-face-to-face relationships' },
  { cat: 'Geographic Risk', factor: 'Customers from FATF grey/black list jurisdictions' },
  { cat: 'Geographic Risk', factor: 'Cross-border transactions with high-risk countries' },
  { cat: 'Product/Service Risk', factor: 'Large value gold/precious metals transactions' },
  { cat: 'Product/Service Risk', factor: 'Cash-intensive transactions' },
  { cat: 'Product/Service Risk', factor: 'Anonymous or bearer instruments' },
  { cat: 'Delivery Channel Risk', factor: 'Non-face-to-face onboarding' },
  { cat: 'Delivery Channel Risk', factor: 'Third-party intermediaries' },
  { cat: 'Transaction Risk', factor: 'Unusual transaction patterns or structuring' },
  { cat: 'Transaction Risk', factor: 'Transactions with no apparent economic purpose' },
  { cat: 'New Technology Risk', factor: 'Digital/tokenised precious metals' },
];
const EWRA_CONTROLS = [
  'CDD / KYC Programme',
  'EDD Procedures',
  'Transaction Monitoring',
  'Sanctions Screening',
  'STR Filing Process',
  'Staff Training',
  'Record Keeping',
  'Internal Audit',
  'Compliance Officer Oversight',
  'Board / Senior Management Oversight',
];

function initEWRA() {
  const body = document.getElementById('ewraInherentBody');
  if (!body || body.children.length) return;
  const riskSel = '<select style="font-size:10px;width:90px"><option value="">Select</option><option value="1">Low</option><option value="2">Medium</option><option value="3">High</option><option value="4">Very High</option></select>';
  body.innerHTML = EWRA_INHERENT_RISKS.map((r, i) => `<tr style="border-bottom:1px solid var(--border);background:${i%2===0?'var(--surface)':'var(--bg)'}">
    <td style="padding:5px 8px;font-size:10px;font-weight:600">${r.cat}</td>
    <td style="padding:5px 8px;font-size:10px">${r.factor}</td>
    <td style="padding:5px 8px;text-align:center" class="ewra-likelihood">${riskSel}</td>
    <td style="padding:5px 8px;text-align:center" class="ewra-impact">${riskSel}</td>
    <td style="padding:5px 8px;text-align:center;font-weight:700;font-size:10px" class="ewra-inherent">—</td>
  </tr>`).join('');
  body.querySelectorAll('select').forEach(s => s.addEventListener('change', updateEWRAScores));

  const ctrlBody = document.getElementById('ewraControlBody');
  if (ctrlBody && !ctrlBody.children.length) {
    const effSel = '<select style="font-size:10px;width:110px"><option value="">Select</option><option value="3">Effective</option><option value="2">Partially Effective</option><option value="1">Ineffective</option><option value="0">Not Implemented</option></select>';
    ctrlBody.innerHTML = EWRA_CONTROLS.map((c, i) => `<tr style="border-bottom:1px solid var(--border);background:${i%2===0?'var(--surface)':'var(--bg)'}">
      <td style="padding:5px 8px;font-size:10px;font-weight:600">${c}</td>
      <td style="padding:5px 8px;text-align:center">${effSel}</td>
      <td style="padding:5px 8px"><input type="text" placeholder="Notes..." style="font-size:10px;width:100%" /></td>
    </tr>`).join('');
  }
  loadEWRA();
}

function updateEWRAScores() {
  document.querySelectorAll('#ewraInherentBody tr').forEach(row => {
    const l = parseInt(row.querySelector('.ewra-likelihood select')?.value) || 0;
    const im = parseInt(row.querySelector('.ewra-impact select')?.value) || 0;
    const cell = row.querySelector('.ewra-inherent');
    if (!l || !im) { cell.textContent = '—'; cell.style.color = ''; return; }
    const score = l * im;
    const level = score >= 9 ? 'VERY HIGH' : score >= 6 ? 'HIGH' : score >= 3 ? 'MEDIUM' : 'LOW';
    const color = score >= 9 ? 'var(--red)' : score >= 6 ? 'var(--amber)' : score >= 3 ? 'var(--gold)' : 'var(--green)';
    cell.textContent = level;
    cell.style.color = color;
  });
}

function saveEWRA() {
  const data = {
    entityName: document.getElementById('ewraEntityName')?.value || '',
    licenseNo: document.getElementById('ewraLicenseNo')?.value || '',
    date: document.getElementById('ewraDate')?.value || '',
    period: document.getElementById('ewraPeriod')?.value || '',
    preparedBy: document.getElementById('ewraPreparedBy')?.value || '',
    approvedBy: document.getElementById('ewraApprovedBy')?.value || '',
    residualRisk: document.getElementById('ewraResidualRisk')?.value || '',
    findings: document.getElementById('ewraFindings')?.value || '',
    actionPlan: document.getElementById('ewraActionPlan')?.value || '',
    nextReview: document.getElementById('ewraNextReview')?.value || '',
    inherentRisks: [],
    controls: [],
    savedAt: new Date().toISOString()
  };
  document.querySelectorAll('#ewraInherentBody tr').forEach(row => {
    data.inherentRisks.push({
      likelihood: row.querySelector('.ewra-likelihood select')?.value || '',
      impact: row.querySelector('.ewra-impact select')?.value || ''
    });
  });
  document.querySelectorAll('#ewraControlBody tr').forEach(row => {
    data.controls.push({
      effectiveness: row.querySelector('select')?.value || '',
      notes: row.querySelector('input')?.value || ''
    });
  });
  const list = safeLocalParse(EWRA_KEY, []);
  list.unshift(data);
  if (list.length > 20) list.pop();
  safeLocalSave(EWRA_KEY, list);
  renderEWRASaved();
  toast('EWRA saved', 'success');
  // Asana sync
  autoSyncToAsana(
    `EWRA: ${data.entityName||'Entity'} — Residual Risk: ${data.residualRisk||'TBD'}`,
    `Entity-Wide Risk Assessment Saved\nEntity: ${data.entityName}\nPeriod: ${data.period}\nResidual Risk: ${data.residualRisk}\nPrepared By: ${data.preparedBy}\nApproved By: ${data.approvedBy}\nNext Review: ${data.nextReview}\n\nKey Findings:\n${data.findings}\n\nAction Plan:\n${data.actionPlan}`,
    data.residualRisk==='Very High'||data.residualRisk==='High'?14:30
  ).then(gid => { if (gid) toast('EWRA synced to Asana','success',2000); });
}

function loadEWRA() {
  const list = safeLocalParse(EWRA_KEY, []);
  if (!list.length) return;
  const d = list[0];
  ['ewraEntityName','ewraLicenseNo','ewraDate','ewraPeriod','ewraPreparedBy','ewraApprovedBy','ewraNextReview'].forEach(id => {
    const el = document.getElementById(id); if (el && d[id.replace('ewra','').charAt(0).toLowerCase()+id.replace('ewra','').slice(1)]) el.value = d[id.replace('ewra','').charAt(0).toLowerCase()+id.replace('ewra','').slice(1)];
  });
  if (d.entityName) { const e = document.getElementById('ewraEntityName'); if (e) e.value = d.entityName; }
  if (d.licenseNo) { const e = document.getElementById('ewraLicenseNo'); if (e) e.value = d.licenseNo; }
  if (d.date) { const e = document.getElementById('ewraDate'); if (e) e.value = d.date; }
  if (d.period) { const e = document.getElementById('ewraPeriod'); if (e) e.value = d.period; }
  if (d.preparedBy) { const e = document.getElementById('ewraPreparedBy'); if (e) e.value = d.preparedBy; }
  if (d.approvedBy) { const e = document.getElementById('ewraApprovedBy'); if (e) e.value = d.approvedBy; }
  if (d.residualRisk) { const e = document.getElementById('ewraResidualRisk'); if (e) e.value = d.residualRisk; }
  if (d.findings) { const e = document.getElementById('ewraFindings'); if (e) e.value = d.findings; }
  if (d.actionPlan) { const e = document.getElementById('ewraActionPlan'); if (e) e.value = d.actionPlan; }
  if (d.nextReview) { const e = document.getElementById('ewraNextReview'); if (e) e.value = d.nextReview; }
  if (d.inherentRisks) {
    document.querySelectorAll('#ewraInherentBody tr').forEach((row, i) => {
      if (d.inherentRisks[i]) {
        const ls = row.querySelector('.ewra-likelihood select'); if (ls) ls.value = d.inherentRisks[i].likelihood || '';
        const is = row.querySelector('.ewra-impact select'); if (is) is.value = d.inherentRisks[i].impact || '';
      }
    });
    updateEWRAScores();
  }
  if (d.controls) {
    document.querySelectorAll('#ewraControlBody tr').forEach((row, i) => {
      if (d.controls[i]) {
        const s = row.querySelector('select'); if (s) s.value = d.controls[i].effectiveness || '';
        const inp = row.querySelector('input'); if (inp) inp.value = d.controls[i].notes || '';
      }
    });
  }
  renderEWRASaved();
}

function renderEWRASaved() {
  const list = safeLocalParse(EWRA_KEY, []);
  const el = document.getElementById('ewraSavedList');
  if (!el) return;
  if (!list.length) { el.innerHTML = '<p style="font-size:11px;color:var(--muted)">No saved EWRA assessments.</p>'; return; }
  el.innerHTML = '<span class="sec-title">Saved EWRA Assessments</span>' + list.slice(0, 10).map((d, i) => `<div style="padding:6px 10px;border-bottom:1px solid var(--border);font-size:10px;display:flex;justify-content:space-between;align-items:center">
    <span>${d.entityName || 'Unnamed'} — ${d.residualRisk || 'N/A'} risk — ${d.date || 'No date'}</span>
    <span style="color:var(--muted);font-family:'Montserrat',sans-serif">${new Date(d.savedAt).toLocaleString('en-GB')}</span>
  </div>`).join('');
}

function clearEWRA() {
  if (!confirm('Clear EWRA form? Saved assessments will not be deleted.')) return;
  ['ewraEntityName','ewraLicenseNo','ewraDate','ewraPeriod','ewraPreparedBy','ewraApprovedBy','ewraNextReview'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  const r = document.getElementById('ewraResidualRisk'); if (r) r.value = '';
  ['ewraFindings','ewraActionPlan'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  document.querySelectorAll('#ewraInherentBody select, #ewraControlBody select').forEach(s => s.value = '');
  document.querySelectorAll('#ewraControlBody input').forEach(i => i.value = '');
  updateEWRAScores();
  toast('EWRA form cleared', 'success');
}

function exportEWRAPDF() { toast('EWRA export — use browser Print (Ctrl+P) for PDF', 'info'); }

// ── Compliance Programme Attach File ──
function attachCProgFile(input, section) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  if (file.size > 5 * 1024 * 1024) { toast('Max 5MB','error'); input.value=''; return; }
  var key = 'fgl_cprog_attachments_' + section;
  var reader = new FileReader();
  reader.onload = function(e) {
    var list = safeLocalParse(key, []);
    list.push({ id: Date.now(), name: file.name, size: file.size, data: e.target.result, addedAt: new Date().toISOString() });
    safeLocalSave(key, list);
    renderCProgAttachments(section);
    toast('File attached: ' + file.name, 'success');
  };
  reader.readAsDataURL(file);
  input.value = '';
}
function renderCProgAttachments(section) {
  var el = document.getElementById('cprogAttachments_' + section);
  if (!el) return;
  var key = 'fgl_cprog_attachments_' + section;
  var list = safeLocalParse(key, []);
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = list.map(function(a) {
    var sizeKB = a.size ? (a.size / 1024).toFixed(1) + ' KB' : '';
    return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:11px"><span style="color:var(--green)">📎 ' + escHtml(a.name) + ' (' + sizeKB + ')</span>'
      + '<a href="' + a.data + '" download="' + escHtml(a.name) + '" class="btn btn-sm btn-green" style="padding:1px 6px;font-size:9px">Download</a>'
      + '<button class="btn btn-sm btn-red" style="padding:1px 6px;font-size:9px" data-action="_removeCProgAttachment" data-section="' + section + '" data-attach-id="' + a.id + '">Remove</button></div>';
  }).join('');
}
function removeCProgAttachment(section, id) {
  var key = 'fgl_cprog_attachments_' + section;
  var list = safeLocalParse(key, []).filter(function(a) { return a.id !== id; });
  safeLocalSave(key, list);
  renderCProgAttachments(section);
  toast('Attachment removed');
}

// ── Gap Register Export ──
function exportGapRegisterPDF() {
  if (!window.jspdf) { toast('PDF library not loaded','error'); return; }
  var gaps = document.getElementById('tab-gaps');
  if (!gaps) return;
  var doc = new window.jspdf.jsPDF({ unit:'mm', format:'a4' });
  doc.setFontSize(16); doc.text('Gap Register — Hawkeye Sterling V2', 14, 20);
  doc.setFontSize(10); doc.text('Generated: ' + new Date().toLocaleString('en-GB'), 14, 28);
  var y = 36;
  var items = gaps.querySelectorAll('.finding');
  items.forEach(function(f) {
    var title = f.querySelector('.f-title')?.textContent || '';
    var body = f.querySelector('.f-body')?.textContent || '';
    var ref = f.querySelector('.f-ref')?.textContent || '';
    var rec = f.querySelector('.rec')?.textContent || '';
    if (y > 260) { doc.addPage(); y = 20; }
    doc.setFontSize(11); doc.setFont(undefined,'bold'); doc.text(title.substring(0,90), 14, y); y += 6;
    doc.setFontSize(9); doc.setFont(undefined,'normal');
    if (body) { var lines = doc.splitTextToSize(body, 180); doc.text(lines, 14, y); y += lines.length * 4 + 2; }
    if (ref) { doc.setTextColor(150,100,50); var rl = doc.splitTextToSize('Ref: '+ref, 180); doc.text(rl, 14, y); y += rl.length * 4 + 2; doc.setTextColor(0,0,0); }
    if (rec) { var rcl = doc.splitTextToSize('Action: '+rec, 180); doc.text(rcl, 14, y); y += rcl.length * 4 + 4; }
    y += 4;
  });
  doc.save('Gap_Register_' + new Date().toISOString().split('T')[0] + '.pdf');
  toast('PDF exported','success');
}
function exportGapRegisterDOCX() {
  var gaps = document.getElementById('tab-gaps');
  if (!gaps) return;
  var html = '<html><head><meta charset="utf-8"><style>body{font-family:Calibri,sans-serif;font-size:11pt}h1{font-size:16pt;color:#1a1a6e}h3{font-size:12pt;margin-top:14pt}.ref{color:#96641e;font-size:9pt;font-style:italic}.rec{background:#f5f0e0;padding:6pt;border-left:3pt solid #c8a020;margin:6pt 0}</style></head><body>';
  html += '<h1>Gap Register — Hawkeye Sterling V2</h1><p>Generated: ' + new Date().toLocaleString('en-GB') + '</p>';
  gaps.querySelectorAll('.finding').forEach(function(f) {
    var badge = f.querySelector('.badge')?.textContent || '';
    var title = f.querySelector('.f-title')?.textContent || '';
    var body = f.querySelector('.f-body')?.textContent || '';
    var ref = f.querySelector('.f-ref')?.textContent || '';
    var rec = f.querySelector('.rec')?.textContent || '';
    html += '<h3>' + badge + ' ' + title + '</h3>';
    if (body) html += '<p>' + body + '</p>';
    if (ref) html += '<p class="ref">' + ref + '</p>';
    if (rec) html += '<div class="rec">' + rec + '</div>';
  });
  html += '</body></html>';
  var blob = new Blob(['\ufeff' + html], { type: 'application/msword;charset=utf-8' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'Gap_Register_' + new Date().toISOString().split('T')[0] + '.doc'; a.click();
  toast('Word exported','success');
}

// ── BWRA ──
const BWRA_KEY = 'fgl_bwra';

function initBWRA() {
  if (document.getElementById('bwraProductBody')?.children.length) return;
  addBWRAProductRow(); addBWRAProductRow();
  addBWRACustomerRow(); addBWRACustomerRow();
  addBWRAGeoRow(); addBWRAGeoRow();
  loadBWRA();
}

function addBWRAProductRow() {
  const body = document.getElementById('bwraProductBody'); if (!body) return;
  const riskSel = '<select style="font-size:10px"><option value="">Select</option><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option></select>';
  const volSel = '<select style="font-size:10px"><option value="">Select</option><option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option></select>';
  const tr = document.createElement('tr');
  tr.style.borderBottom = '1px solid var(--border)';
  tr.innerHTML = `<td style="padding:5px 8px"><input type="text" placeholder="Product name..." style="font-size:10px;width:100%" /></td>
    <td style="padding:5px 8px;text-align:center">${volSel}</td>
    <td style="padding:5px 8px;text-align:center">${riskSel}</td>
    <td style="padding:5px 8px"><input type="text" placeholder="Risk factors..." style="font-size:10px;width:100%" /></td>`;
  body.appendChild(tr);
}

function addBWRACustomerRow() {
  const body = document.getElementById('bwraCustomerBody'); if (!body) return;
  const riskSel = '<select style="font-size:10px"><option value="">Select</option><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option></select>';
  const tr = document.createElement('tr');
  tr.style.borderBottom = '1px solid var(--border)';
  tr.innerHTML = `<td style="padding:5px 8px"><input type="text" placeholder="Customer category..." style="font-size:10px;width:100%" /></td>
    <td style="padding:5px 8px;text-align:center"><input type="text" placeholder="%" style="font-size:10px;width:60px;text-align:center" /></td>
    <td style="padding:5px 8px;text-align:center">${riskSel}</td>
    <td style="padding:5px 8px"><input type="text" placeholder="Risk indicators..." style="font-size:10px;width:100%" /></td>`;
  body.appendChild(tr);
}

function addBWRAGeoRow() {
  const body = document.getElementById('bwraGeoBody'); if (!body) return;
  const riskSel = '<select style="font-size:10px"><option value="">Select</option><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option></select>';
  const fatfSel = '<select style="font-size:10px"><option value="">Select</option><option value="Compliant">Compliant</option><option value="Grey List">Grey List</option><option value="Black List">Black List</option></select>';
  const tr = document.createElement('tr');
  tr.style.borderBottom = '1px solid var(--border)';
  tr.innerHTML = `<td style="padding:5px 8px"><input type="text" placeholder="Country..." style="font-size:10px;width:100%" /></td>
    <td style="padding:5px 8px;text-align:center">${fatfSel}</td>
    <td style="padding:5px 8px;text-align:center">${riskSel}</td>
    <td style="padding:5px 8px"><input type="text" placeholder="Notes..." style="font-size:10px;width:100%" /></td>`;
  body.appendChild(tr);
}

function saveBWRA() {
  const data = {
    businessName: document.getElementById('bwraBusinessName')?.value || '',
    date: document.getElementById('bwraDate')?.value || '',
    activities: document.getElementById('bwraActivities')?.value || '',
    preparedBy: document.getElementById('bwraPreparedBy')?.value || '',
    overallRisk: document.getElementById('bwraOverallRisk')?.value || '',
    nextReview: document.getElementById('bwraNextReview')?.value || '',
    summary: document.getElementById('bwraSummary')?.value || '',
    channels: {
      face: document.getElementById('bwraChFace')?.value || '',
      online: document.getElementById('bwraChOnline')?.value || '',
      thirdParty: document.getElementById('bwraChThirdParty')?.value || '',
      cash: document.getElementById('bwraChCash')?.value || ''
    },
    products: [], customers: [], geographies: [],
    savedAt: new Date().toISOString()
  };
  document.querySelectorAll('#bwraProductBody tr').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const sel = row.querySelectorAll('select');
    data.products.push({ name: inputs[0]?.value||'', volume: sel[0]?.value||'', risk: sel[1]?.value||'', factors: inputs[1]?.value||'' });
  });
  document.querySelectorAll('#bwraCustomerBody tr').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const sel = row.querySelector('select');
    data.customers.push({ category: inputs[0]?.value||'', pct: inputs[1]?.value||'', risk: sel?.value||'', indicators: inputs[2]?.value||'' });
  });
  document.querySelectorAll('#bwraGeoBody tr').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const sels = row.querySelectorAll('select');
    data.geographies.push({ country: inputs[0]?.value||'', fatf: sels[0]?.value||'', risk: sels[1]?.value||'', notes: inputs[1]?.value||'' });
  });
  const list = safeLocalParse(BWRA_KEY, []);
  list.unshift(data);
  if (list.length > 20) list.pop();
  safeLocalSave(BWRA_KEY, list);
  renderBWRASaved();
  toast('BWRA saved', 'success');
  // Asana sync
  autoSyncToAsana(
    `BWRA: ${data.businessName||'Business'} — Overall Risk: ${data.overallRisk||'TBD'}`,
    `Business-Wide Risk Assessment Saved\nBusiness: ${data.businessName}\nActivities: ${data.activities}\nOverall Risk: ${data.overallRisk}\nPrepared By: ${data.preparedBy}\nNext Review: ${data.nextReview}\n\nSummary:\n${data.summary}`,
    data.overallRisk==='Very High'||data.overallRisk==='High'?14:30
  ).then(gid => { if (gid) toast('BWRA synced to Asana','success',2000); });
}

function loadBWRA() {
  const list = safeLocalParse(BWRA_KEY, []);
  if (!list.length) { renderBWRASaved(); return; }
  const d = list[0];
  if (d.businessName) { const e = document.getElementById('bwraBusinessName'); if (e) e.value = d.businessName; }
  if (d.date) { const e = document.getElementById('bwraDate'); if (e) e.value = d.date; }
  if (d.activities) { const e = document.getElementById('bwraActivities'); if (e) e.value = d.activities; }
  if (d.preparedBy) { const e = document.getElementById('bwraPreparedBy'); if (e) e.value = d.preparedBy; }
  if (d.overallRisk) { const e = document.getElementById('bwraOverallRisk'); if (e) e.value = d.overallRisk; }
  if (d.nextReview) { const e = document.getElementById('bwraNextReview'); if (e) e.value = d.nextReview; }
  if (d.summary) { const e = document.getElementById('bwraSummary'); if (e) e.value = d.summary; }
  if (d.channels) {
    if (d.channels.face) { const e = document.getElementById('bwraChFace'); if (e) e.value = d.channels.face; }
    if (d.channels.online) { const e = document.getElementById('bwraChOnline'); if (e) e.value = d.channels.online; }
    if (d.channels.thirdParty) { const e = document.getElementById('bwraChThirdParty'); if (e) e.value = d.channels.thirdParty; }
    if (d.channels.cash) { const e = document.getElementById('bwraChCash'); if (e) e.value = d.channels.cash; }
  }
  renderBWRASaved();
}

function renderBWRASaved() {
  const list = safeLocalParse(BWRA_KEY, []);
  const el = document.getElementById('bwraSavedList');
  if (!el) return;
  if (!list.length) { el.innerHTML = '<p style="font-size:11px;color:var(--muted)">No saved BWRA assessments.</p>'; return; }
  el.innerHTML = '<span class="sec-title">Saved BWRA Assessments</span>' + list.slice(0, 10).map(d => `<div style="padding:6px 10px;border-bottom:1px solid var(--border);font-size:10px;display:flex;justify-content:space-between;align-items:center">
    <span>${d.businessName || 'Unnamed'} — ${d.overallRisk || 'N/A'} risk — ${d.date || 'No date'}</span>
    <span style="color:var(--muted);font-family:'Montserrat',sans-serif">${new Date(d.savedAt).toLocaleString('en-GB')}</span>
  </div>`).join('');
}

function clearBWRA() {
  if (!confirm('Clear BWRA form? Saved assessments will not be deleted.')) return;
  ['bwraBusinessName','bwraDate','bwraActivities','bwraPreparedBy','bwraNextReview'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  const r = document.getElementById('bwraOverallRisk'); if (r) r.value = '';
  const s = document.getElementById('bwraSummary'); if (s) s.value = '';
  ['bwraChFace','bwraChOnline','bwraChThirdParty','bwraChCash'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  ['bwraProductBody','bwraCustomerBody','bwraGeoBody'].forEach(id => { const e = document.getElementById(id); if (e) e.innerHTML = ''; });
  addBWRAProductRow(); addBWRAProductRow();
  addBWRACustomerRow(); addBWRACustomerRow();
  addBWRAGeoRow(); addBWRAGeoRow();
  toast('BWRA form cleared', 'success');
}

function exportBWRAPDF() { toast('BWRA export — use browser Print (Ctrl+P) for PDF', 'info'); }

// ── COMPLIANCE MANUAL ──
const CM_KEY = 'fgl_compliance_manual';
const CM_FIELDS = ['cmOverview','cmPurpose','cmVersion','cmEffectiveDate','cmMLRO','cmDeputyMLRO','cmReviewedBy','cmNextReview'];

function saveComplianceManual() {
  const data = { savedAt: new Date().toISOString() };
  CM_FIELDS.forEach(id => { const e = document.getElementById(id); if (e) data[id] = e.value || ''; });
  safeLocalSave(CM_KEY, data);
  const el = document.getElementById('cmSavedStatus');
  if (el) el.innerHTML = '<span style="color:var(--green);font-size:11px">Manual saved — ' + new Date().toLocaleString('en-GB') + '</span>';
  toast('Compliance Manual saved', 'success');
  // Asana sync
  autoSyncToAsana(
    `Compliance Manual Updated — v${data.cmVersion||'N/A'}`,
    `Compliance Manual has been updated.\nVersion: ${data.cmVersion||'N/A'}\nEffective Date: ${data.cmEffectiveDate||'N/A'}\nMLRO: ${data.cmMLRO||'N/A'}\nReviewed By: ${data.cmReviewedBy||'N/A'}\nNext Review: ${data.cmNextReview||'N/A'}`,
    30
  ).then(gid => { if (gid) toast('Manual update synced to Asana','success',2000); });
}

function loadComplianceManual() {
  const data = safeLocalParse(CM_KEY, null);
  if (!data) return;
  CM_FIELDS.forEach(id => { const e = document.getElementById(id); if (e && data[id]) e.value = data[id]; });
  const el = document.getElementById('cmSavedStatus');
  if (el && data.savedAt) el.innerHTML = '<span style="color:var(--green);font-size:11px">Last saved: ' + new Date(data.savedAt).toLocaleString('en-GB') + '</span>';
}

function clearComplianceManual() {
  if (!confirm('Clear the Compliance Manual form?')) return;
  CM_FIELDS.forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  const el = document.getElementById('cmSavedStatus'); if (el) el.innerHTML = '';
  toast('Compliance Manual cleared', 'success');
}

function exportManualPDF() { toast('Manual export — use browser Print (Ctrl+P) for PDF', 'info'); }

// Close modal on overlay click
var _taskModal = document.getElementById('createTaskModal'); if (_taskModal) _taskModal.addEventListener('click', function(e) { if(e.target===this) closeModal(); });

// ======= OPENAI INTEGRATION =======
async function callOpenAI(body) {
  const openaiBody = {
    model: 'gpt-4o',
    messages: [],
    max_tokens: body.max_tokens || 4096,
    temperature: body.temperature !== undefined ? body.temperature : 0.2,
  };
  if (body.system) openaiBody.messages.push({ role: 'system', content: body.system });
  if (body.messages) openaiBody.messages.push(...body.messages);

  let r;
  if (PROXY_URL) {
    try {
      r = await fetch(`${PROXY_URL}/openai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(openaiBody)
      });
    } catch (e) {
      if (!OPENAI_KEY) throw e;
      r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify(openaiBody)
      });
    }
  } else {
    r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify(openaiBody)
    });
  }

  if (!r.ok) {
    let errDetail = '';
    try { const ej = await r.json(); errDetail = ej?.error?.message || JSON.stringify(ej); } catch (_) {}
    const err = new Error(`OpenAI API ${r.status}: ${errDetail || r.statusText}`);
    if (r.status === 402 || r.status === 429) {
      const lower = (errDetail || '').toLowerCase();
      if (lower.includes('quota') || lower.includes('billing') || lower.includes('insufficient') || lower.includes('exceeded') || r.status === 402) {
        err.isBillingError = true;
      }
    }
    throw err;
  }

  const data = await r.json();
  // Convert OpenAI response to Anthropic-like format for compatibility
  const text = data.choices?.[0]?.message?.content || '';
  return { content: [{ type: 'text', text }] };
}

/**
 * GitHub Copilot / GitHub Models API (FREE tier)
 * Uses OpenAI-compatible endpoint at https://models.inference.ai.azure.com
 * Free tier: GPT-4o-mini, Phi, Mistral, and more — no billing required.
 * Get token: github.com/settings/tokens → Fine-grained → Models: read
 */
async function callCopilot(body) {
  if (!COPILOT_KEY) throw new Error('GitHub Copilot token not configured');
  // Map Claude model names to GitHub Models equivalents
  var copilotModel = 'gpt-4o-mini'; // Free tier default — fast and capable
  if (body.model) {
    var m = body.model.toLowerCase();
    if (m.includes('opus') || m.includes('pro') || m.includes('sonnet')) copilotModel = 'gpt-4o';
  }

  const copilotBody = {
    model: copilotModel,
    messages: [],
    max_tokens: body.max_tokens || 4096,
    temperature: body.temperature !== undefined ? body.temperature : 0.2,
  };
  if (body.system) copilotBody.messages.push({ role: 'system', content: body.system });
  if (body.messages) copilotBody.messages.push(...body.messages.map(function(m) {
    return { role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) };
  }));

  const r = await fetch('https://models.inference.ai.azure.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${COPILOT_KEY}`
    },
    body: JSON.stringify(copilotBody)
  });

  if (!r.ok) {
    let errDetail = '';
    try { const ej = await r.json(); errDetail = ej?.error?.message || JSON.stringify(ej); } catch (_) {}
    const err = new Error(`Copilot API ${r.status}: ${errDetail || r.statusText}`);
    if (r.status === 429 || r.status === 402) err.isBillingError = true;
    throw err;
  }

  const data = await r.json();
  const text = data.choices?.[0]?.message?.content || '';
  return { content: [{ type: 'text', text }] };
}

async function callGemini(body) {
  // Map Claude model names to Gemini equivalents
  var geminiModel = 'gemini-2.5-flash';
  if (body.model) {
    var m = body.model.toLowerCase();
    if (m.includes('haiku') || m.includes('fast') || m.includes('flash')) geminiModel = 'gemini-2.5-flash';
    else if (m.includes('opus') || m.includes('pro')) geminiModel = 'gemini-2.5-pro';
    else if (m.includes('sonnet')) geminiModel = 'gemini-2.5-flash';
  }

  const contents = [];
  if (body.messages) {
    for (const m of body.messages) {
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] });
    }
  }
  const geminiBody = {
    contents,
    generationConfig: {
      maxOutputTokens: body.max_tokens || 4096,
      temperature: body.temperature !== undefined ? body.temperature : 0.2,
    }
  };
  if (body.system) geminiBody.systemInstruction = { parts: [{ text: body.system }] };

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${GEMINI_KEY}`;
  let r;
  if (PROXY_URL) {
    try {
      r = await fetch(`${PROXY_URL}/gemini`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...geminiBody, model: geminiModel })
      });
    } catch (e) {
      if (!GEMINI_KEY) throw e;
      r = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody)
      });
    }
  } else {
    r = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody)
    });
  }

  if (!r.ok) {
    let errDetail = '';
    try { const ej = await r.json(); errDetail = ej?.error?.message || JSON.stringify(ej); } catch (_) {}
    const err = new Error(`Gemini API ${r.status}: ${errDetail || r.statusText}`);
    if (r.status === 402 || r.status === 429) {
      const lower = (errDetail || '').toLowerCase();
      if (lower.includes('quota') || lower.includes('billing') || lower.includes('exceeded') || lower.includes('exhausted') || lower.includes('insufficient') || r.status === 402) {
        err.isBillingError = true;
      }
    }
    throw err;
  }

  const data = await r.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { content: [{ type: 'text', text }] };
}

// AI response cache — avoids duplicate API calls for identical prompts within session
const _aiCache = new Map();
const AI_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function callAI(body) {
  // Generate cache key from the user message content (last message)
  const msgs = body.messages || [];
  const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1].content : '';
  const cacheKey = (body.model || '') + '|' + (typeof lastMsg === 'string' ? lastMsg : JSON.stringify(lastMsg));
  if (cacheKey.length < 5000) { // Only cache reasonably-sized prompts
    const cached = _aiCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < AI_CACHE_TTL_MS) {
      return cached.result;
    }
  }
  const result = await _callAIUncached(body);
  if (cacheKey.length < 5000) {
    _aiCache.set(cacheKey, { result, ts: Date.now() });
    // Limit cache size
    if (_aiCache.size > 100) {
      const oldest = _aiCache.keys().next().value;
      _aiCache.delete(oldest);
    }
  }
  return result;
}

/**
 * Route AI calls to the configured provider.
 * In 'mixed' mode: rotates Copilot(free) → Gemini → Claude with auto-fallback.
 * If one provider fails (rate limit / billing), it's cooled down for 5 minutes
 * and the next provider in the chain is tried automatically.
 */
async function _callAIUncached(body) {
  if (AI_PROVIDER === 'mixed') {
    return _callAIMixed(body);
  }
  if (AI_PROVIDER === 'copilot' && COPILOT_KEY) {
    return callCopilot(body);
  }
  if (AI_PROVIDER === 'gemini' && (GEMINI_KEY || PROXY_URL)) {
    return callGemini(body);
  }
  if (AI_PROVIDER === 'openai' && (OPENAI_KEY || PROXY_URL)) {
    return callOpenAI(body);
  }
  return callAnthropic(body);
}

/**
 * Mixed mode: try providers in order of cost (free first).
 * Order: Copilot (free) → Gemini → Claude
 * Auto-skips providers that are in cooldown (failed recently).
 */
var _mixedCallCount = 0;
async function _callAIMixed(body) {
  var now = Date.now();
  // Build priority list: free providers first
  var providers = [];
  if (COPILOT_KEY) providers.push({ name: 'copilot', fn: callCopilot, health: _providerHealth.copilot });
  if (GEMINI_KEY || PROXY_URL) providers.push({ name: 'gemini', fn: callGemini, health: _providerHealth.gemini });
  if (ANTHROPIC_KEY || PROXY_URL) providers.push({ name: 'claude', fn: callAnthropic, health: _providerHealth.claude });

  if (providers.length === 0) {
    throw new Error('No AI providers configured. Add at least one API key in Settings.');
  }

  // Filter to healthy providers (or all if none are healthy)
  var healthy = providers.filter(function(p) { return p.health.ok || (now - p.health.failedAt > PROVIDER_COOLDOWN_MS); });
  if (healthy.length === 0) healthy = providers; // reset all cooldowns

  // Round-robin among healthy providers to spread load
  var startIdx = _mixedCallCount % healthy.length;
  _mixedCallCount++;

  for (var attempt = 0; attempt < healthy.length; attempt++) {
    var idx = (startIdx + attempt) % healthy.length;
    var provider = healthy[idx];
    try {
      var result = await provider.fn(body);
      // Mark healthy on success
      provider.health.ok = true;
      return result;
    } catch (e) {
      console.warn('[Mixed] ' + provider.name + ' failed: ' + (e.message || e));
      // Mark as failed, try next
      provider.health.ok = false;
      provider.health.failedAt = Date.now();
      if (attempt === healthy.length - 1) throw e; // all failed, throw last error
    }
  }
}

// ======= LIVE WEB SEARCH FOR SCREENING (Tavily — free 1,000/month) =======
/**
 * Search the live web for adverse media, sanctions, and compliance-relevant information.
 * Uses Tavily API (free tier: 1,000 searches/month at tavily.com).
 * Returns aggregated search results as text to feed into the AI screening.
 */
async function searchWebForScreening(entityName, entityType, country) {
  if (!TAVILY_KEY) return null;

  // Single search query (saves Tavily credits — 1 query instead of 3)
  const query = entityName + ' sanctions adverse media investigation fraud corruption ' + (country || '');
  let allResults = [];

  {
    try {
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: TAVILY_KEY,
          query: query,
          search_depth: 'basic',
          include_answer: true,
          max_results: 3,
          include_domains: [],
          exclude_domains: []
        })
      });
      const data = await r.json();
      if (data.answer) allResults.push('SEARCH ANSWER: ' + data.answer);
      if (data.results) {
        data.results.forEach(function(res) {
          allResults.push('SOURCE: ' + res.url + '\nTITLE: ' + (res.title || '') + '\nCONTENT: ' + (res.content || '').substring(0, 500));
        });
      }
    } catch(e) {
      console.warn('[Tavily] Search failed for query:', query, e.message);
    }
  }

  if (allResults.length === 0) return null;
  return '=== LIVE WEB SEARCH RESULTS (searched ' + new Date().toISOString().split('T')[0] + ') ===\n\n' + allResults.join('\n\n---\n\n');
}

// ======= GOOGLE DRIVE INTEGRATION =======
function connectGoogleDrive() {
  if (!GDRIVE_CLIENT_ID) { toast('Google Drive Client ID not configured', 'error'); return; }
  const redirectUri = window.location.origin + window.location.pathname;
  const scope = 'https://www.googleapis.com/auth/drive.file';
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(GDRIVE_CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent(scope)}`;
  window.location.href = authUrl;
}

function handleGDriveCallback() {
  const hash = window.location.hash;
  if (!hash.includes('access_token')) return;
  const params = new URLSearchParams(hash.substring(1));
  gdriveAccessToken = params.get('access_token') || '';
  if (gdriveAccessToken) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    const statusEl = document.getElementById('gdriveStatus');
    if (statusEl) statusEl.textContent = 'Connected to Google Drive';
    toast('Google Drive connected!', 'success');
    logAudit('Google Drive connected', 'OAuth token obtained');
  }
}

async function uploadToGDrive(fileName, content, mimeType = 'text/plain') {
  if (!gdriveAccessToken) { toast('Google Drive not connected. Click "Connect Google Drive" in Settings.', 'error'); return null; }
  const metadata = { name: fileName, mimeType };
  if (GDRIVE_FOLDER_ID) metadata.parents = [GDRIVE_FOLDER_ID];

  const boundary = '-------fgl_boundary';
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n${content}\r\n--${boundary}--`;

  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${gdriveAccessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body
  });
  if (!r.ok) {
    const err = await r.text();
    toast(`Google Drive upload failed: ${r.status}`, 'error');
    throw new Error(`GDrive ${r.status}: ${err}`);
  }
  const data = await r.json();
  toast(`Saved to Google Drive: ${fileName}`, 'success');
  logAudit('Google Drive upload', `File: ${fileName}, ID: ${data.id}`);
  return data;
}

async function listGDriveFiles() {
  if (!gdriveAccessToken) { toast('Google Drive not connected', 'error'); return []; }
  let query = "mimeType != 'application/vnd.google-apps.folder' and trashed = false";
  if (GDRIVE_FOLDER_ID) query += ` and '${GDRIVE_FOLDER_ID}' in parents`;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&orderBy=modifiedTime desc&pageSize=50`, {
    headers: { 'Authorization': `Bearer ${gdriveAccessToken}` }
  });
  if (!r.ok) { toast('Failed to list Drive files', 'error'); return []; }
  const data = await r.json();
  return data.files || [];
}

async function shareAnalysisToGDrive() {
  if (!lastResult) { toast('No analysis to save', 'error'); return; }
  const findings = (lastResult.findings || []).map(f => `[${f.severity}] ${f.title}\n${f.body || ''}\nRef: ${f.regulatory_ref || 'N/A'}\nAction: ${f.recommendation || 'N/A'}`).join('\n\n---\n\n');
  const text = `Summary:\n${lastResult.summary || 'N/A'}\n\nFindings:\n${findings || 'None'}`;
  const fileName = `FGL_Analysis_${lastArea || 'report'}_${new Date().toISOString().slice(0,10)}.txt`;
  const content = `Hawkeye Sterling V2 Report\nDate: ${new Date().toISOString()}\nQuery: ${lastQuery}\nArea: ${lastArea}\n\n${text}`;
  await uploadToGDrive(fileName, content, 'text/plain');
}

async function refreshGDriveFileList() {
  const statusEl = document.getElementById('gdriveConnectionStatus');
  const listEl = document.getElementById('gdriveFileList');
  if (!gdriveAccessToken) {
    if (GDRIVE_CLIENT_ID) {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--amber)">Configured</span> — <a href="#" data-action="_connectGoogleDriveLink" style="color:var(--gold);text-decoration:underline;cursor:pointer">Click here to authorize</a>';
    } else {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--red)">Not configured.</span> Go to Settings and enter your Google Drive Client ID.';
    }
    return;
  }
  if (statusEl) statusEl.innerHTML = '<span style="color:var(--green)">Connected</span>' + (GDRIVE_FOLDER_ID ? ` · Folder: ${escHtml(GDRIVE_FOLDER_ID)}` : ' · Root folder');
  if (listEl) listEl.innerHTML = '<p style="color:var(--muted);font-size:12px">Loading...</p>';
  try {
    const files = await listGDriveFiles();
    if (!files.length) { listEl.innerHTML = '<p style="color:var(--muted);font-size:13px">No files found in this folder.</p>'; return; }
    listEl.innerHTML = '<table style="width:100%;font-size:12px;border-collapse:collapse">' +
      '<tr style="border-bottom:1px solid var(--border)"><th style="text-align:left;padding:6px">Name</th><th style="text-align:left;padding:6px">Modified</th><th style="padding:6px">Link</th></tr>' +
      files.map(f => `<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px">${escHtml(f.name)}</td><td style="padding:6px;color:var(--muted)">${new Date(f.modifiedTime).toLocaleDateString('en-GB')}</td><td style="padding:6px;text-align:center">${f.webViewLink ? `<a href="${escHtml(f.webViewLink)}" target="_blank" rel="noopener" style="color:var(--gold)">Open</a>` : '-'}</td></tr>`).join('') +
      '</table>';
  } catch (e) { listEl.innerHTML = `<p style="color:var(--red);font-size:12px">Error: ${escHtml(e.message)}</p>`; }
}

async function uploadAnalysisHistoryToGDrive() {
  if (!gdriveAccessToken) { toast('Google Drive not connected', 'error'); return; }
  let history = [];
  try { history = safeLocalParse('fgl_history', []); } catch (_) {}
  if (!history.length) { toast('No analysis history to upload', 'error'); return; }
  const content = history.map((h, i) => `--- Analysis ${i + 1} ---\nDate: ${h.date || 'N/A'}\nQuery: ${h.query || 'N/A'}\nArea: ${h.area || 'N/A'}\nResult: ${h.result || 'N/A'}\n`).join('\n');
  const fileName = `FGL_Analysis_History_${new Date().toISOString().slice(0,10)}.txt`;
  await uploadToGDrive(fileName, content, 'text/plain');
}

// ======= NOTION INTEGRATION (removed — use Asana) =======
function saveToNotion() { toast('Notion integration removed — use Asana', 'info'); }
function testNotionConnection() { toast('Notion integration removed — use Asana', 'info'); }
function shareToNotion() { toast('Notion integration removed — use Asana', 'info'); }

// Slack removed — not supported in browser-only deployment
async function sendSlackMessage() {}
async function sendAnalysisToSlack() {}
async function sendSlackAlert() {}
function shareToSlack() {}

// ======= CLICKUP INTEGRATION (removed — use Asana) =======
function createClickUpTask() { toast('ClickUp integration removed — use Asana', 'info'); }
function shareToClickUp() { toast('ClickUp integration removed — use Asana', 'info'); }
function createClickUpTasksFromFindings() { toast('ClickUp integration removed — use Asana', 'info'); }

// ======= AUTHENTICATION & USER MANAGEMENT =======
const USERS_STORAGE = 'fgl_users';
const SESSION_STORAGE = 'fgl_session';
let currentUser = null;

// PBKDF2 password hashing with per-user random salt (100K iterations)
async function hashPassword(password, existingSalt) {
  var salt = existingSalt || crypto.getRandomValues(new Uint8Array(16));
  var enc = new TextEncoder();
  var keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  var bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' }, keyMaterial, 256);
  var hash = Array.from(new Uint8Array(bits)).map(function(b){ return b.toString(16).padStart(2, '0'); }).join('');
  var saltHex = Array.from(new Uint8Array(salt)).map(function(b){ return b.toString(16).padStart(2, '0'); }).join('');
  return { hash: hash, salt: saltHex };
}
function hexToBytes(hex) {
  var bytes = new Uint8Array(hex.length / 2);
  for (var i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  return bytes;
}

function getUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_STORAGE) || 'null'); } catch(_) { return null; }
}

async function initDefaultUsers() {
  const existing = getUsers();
  if (!existing || !existing.length) {
    // No hardcoded credentials — force user through setup wizard.
    // Show setup screen so user creates their own admin account.
    return;
  }
}

async function completeSetup() {
  const displayName = document.getElementById('setupDisplayName').value.trim();
  const username = document.getElementById('setupUsername').value.trim().toLowerCase().replace(/\s/g, '');
  const password = document.getElementById('setupPassword').value;
  const confirm = document.getElementById('setupPasswordConfirm').value;
  const errorEl = document.getElementById('setupError');

  if (!displayName) { errorEl.textContent = 'Enter your display name'; return; }
  if (!username || username.length < 3) { errorEl.textContent = 'Username must be at least 3 characters'; return; }
  if (!/^[a-z0-9_]+$/.test(username)) { errorEl.textContent = 'Username: lowercase letters, numbers, underscore only'; return; }
  if (!password || password.length < 10) { errorEl.textContent = 'Password must be at least 10 characters with uppercase, lowercase, digit, and special character'; return; }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) { errorEl.textContent = 'Password needs uppercase, lowercase, digit, and special character'; return; }
  if (password !== confirm) { errorEl.textContent = 'Passwords do not match'; return; }

  const cred = await hashPassword(password);
  const users = [{
    id: Date.now(), username, passwordHash: cred.hash, passwordSalt: cred.salt,
    displayName, role: 'admin', active: true, createdAt: new Date().toISOString()
  }];
  localStorage.setItem(USERS_STORAGE, JSON.stringify(users));

  // Auto-login
  currentUser = { id: users[0].id, username, displayName, role: 'admin' };
  localStorage.setItem(SESSION_STORAGE, JSON.stringify(currentUser));
  showMainApp();
  toast('Welcome, ' + displayName + '! Your account has been created.', 'success');
}

async function attemptLogin() {
  const username = document.getElementById('loginUser').value.trim().toLowerCase();
  const password = document.getElementById('loginPass').value;
  const errorEl = document.getElementById('loginError');
  if (!username || !password) { errorEl.textContent = 'Enter username and password'; return; }

  const users = getUsers() || [];
  if (!users.length) { errorEl.textContent = 'No accounts exist. Please complete setup first.'; return; }
  const matchUser = users.find(function(u) { return u.username === username && u.active; });
  if (!matchUser) { errorEl.textContent = 'Invalid credentials or account disabled'; return; }
  var userSalt = matchUser.passwordSalt ? hexToBytes(matchUser.passwordSalt) : null;
  var cred = await hashPassword(password, userSalt);
  if (cred.hash !== matchUser.passwordHash) { errorEl.textContent = 'Invalid credentials or account disabled'; return; }
  var user = matchUser;

  currentUser = { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
  localStorage.setItem(SESSION_STORAGE, JSON.stringify(currentUser));
  showMainApp();
  logAudit('login', `${user.displayName} (${user.role}) logged in`);
}

function showMainApp() {
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('mainApp').style.display = 'block';
  // If keys were already saved, skip setup and go straight to main panel
  if (ANTHROPIC_KEY || PROXY_URL) {
    openMainPanel();
  }
  // Update user info display
  const nameEl = document.getElementById('currentUserName');
  const roleEl = document.getElementById('currentUserRole');
  if (nameEl) nameEl.textContent = currentUser.displayName;
  if (roleEl) {
    const roleLabels = { admin: 'ADMIN', co: 'COMPLIANCE OFFICER', viewer: 'VIEWER' };
    const roleClasses = { admin: 'role-admin', co: 'role-co', viewer: 'role-viewer' };
    roleEl.textContent = roleLabels[currentUser.role] || currentUser.role;
    roleEl.className = 'role-badge ' + (roleClasses[currentUser.role] || '');
  }
  applyRoleRestrictions();
  refreshReminders();
}

function logoutUser() {
  if (!confirm('Logout?')) return;
  localStorage.removeItem(SESSION_STORAGE);
  currentUser = null;
  document.getElementById('mainApp').style.display = 'none';
  document.getElementById('loginOverlay').style.display = 'flex';
  document.getElementById('loginPass').value = '';
  document.getElementById('loginError').textContent = '';
}

function checkSession() {
  const saved = localStorage.getItem(SESSION_STORAGE);
  if (saved) {
    try {
      const session = JSON.parse(saved);
      // Validate: user must exist in fgl_users and be active
      const users = getUsers() || [];
      const user = users.find(u => u.id === session.id && u.active);
      if (!user) {
        // Stale session — user doesn't exist anymore
        localStorage.removeItem(SESSION_STORAGE);
        return false;
      }
      currentUser = session;
      showMainApp();
      return true;
    } catch(_) {
      localStorage.removeItem(SESSION_STORAGE);
    }
  }
  return false;
}

function applyRoleRestrictions() {
  if (!currentUser) return;
  const role = currentUser.role;
  // Viewer: hide action buttons, disable forms
  if (role === 'viewer') {
    document.querySelectorAll('.btn-gold, .btn-green, .btn-red').forEach(btn => {
      if (!btn.closest('#loginOverlay') && !btn.closest('#currentUserInfo')) {
        btn.style.opacity = '0.4';
        btn.style.pointerEvents = 'none';
        btn.title = 'View-only access';
      }
    });
    document.querySelectorAll('#mainApp textarea, #mainApp input:not([type=radio]):not([type=checkbox])').forEach(el => {
      if (!el.closest('#setupPanel') && !el.closest('.notif-panel') && !el.id?.startsWith('incFilter') && !el.id?.startsWith('incSearch')) {
        el.readOnly = true;
        el.style.opacity = '0.6';
      }
    });
  }
  // Hide user management for non-admin
  const umSection = document.getElementById('userMgmtSection');
  if (umSection) umSection.style.display = role === 'admin' ? 'block' : 'none';
}

function getUserRole() { return currentUser ? currentUser.role : 'viewer'; }
function isAdmin() { return currentUser && currentUser.role === 'admin'; }

// User Management Panel (rendered in Settings tab)
function renderUserManagement() {
  const el = document.getElementById('userMgmtList');
  if (!el || !isAdmin()) return;
  const users = getUsers() || [];
  el.innerHTML = users.map(u => {
    const roleClasses = { admin: 'role-admin', co: 'role-co', viewer: 'role-viewer' };
    const roleLabels = { admin: 'Admin', co: 'Compliance Officer', viewer: 'Viewer' };
    return `<div class="asana-item" style="margin-bottom:4px">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="asana-name" style="margin:0">${escHtml(u.displayName)}</span>
          <span class="role-badge ${roleClasses[u.role]||''}">${roleLabels[u.role]||u.role}</span>
          ${!u.active ? '<span style="font-size:9px;color:var(--red)">DISABLED</span>' : ''}
        </div>
        <div class="asana-meta">@${escHtml(u.username)} · Created: ${new Date(u.createdAt).toLocaleDateString('en-GB')}</div>
      </div>
      <div style="display:flex;gap:4px;align-items:center;flex-shrink:0">
        <select data-change="_changeUserRoleFromSelect" data-user-id="${u.id}" style="width:auto;height:24px;font-size:9px;padding:2px">
          <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
          <option value="co" ${u.role==='co'?'selected':''}>CO</option>
          <option value="viewer" ${u.role==='viewer'?'selected':''}>Viewer</option>
        </select>
        <button class="btn btn-sm" data-action="toggleUserActive" data-arg="${u.id}" style="padding:2px 6px;font-size:9px">${u.active?'Disable':'Enable'}</button>
        <button class="btn btn-sm" data-action="resetUserPassword" data-arg="${u.id}" style="padding:2px 6px;font-size:9px">Reset PW</button>
      </div>
    </div>`;
  }).join('');
}

async function addNewUser() {
  const username = prompt('Username (lowercase, no spaces):');
  if (!username) return;
  const displayName = prompt('Display Name:');
  if (!displayName) return;
  const role = prompt('Role (admin / co / viewer):', 'co');
  if (!['admin','co','viewer'].includes(role)) { toast('Invalid role','error'); return; }
  const password = prompt('Initial password:');
  if (!password || password.length < 4) { toast('Password must be 4+ characters','error'); return; }

  const users = getUsers() || [];
  if (users.find(u => u.username === username.toLowerCase().trim())) { toast('Username already exists','error'); return; }
  const newCred = await hashPassword(password);
  users.push({
    id: Date.now(), username: username.toLowerCase().trim(),
    passwordHash: newCred.hash, passwordSalt: newCred.salt,
    displayName: escHtml(displayName.trim()), role, active: true,
    createdAt: new Date().toISOString()
  });
  localStorage.setItem(USERS_STORAGE, JSON.stringify(users));
  renderUserManagement();
  toast(`User ${displayName} created`, 'success');
  logAudit('user_mgmt', `Created user: ${displayName} (${role})`);
}

function changeUserRole(userId, newRole) {
  const users = getUsers() || [];
  const u = users.find(x => x.id === userId);
  if (u) { u.role = newRole; localStorage.setItem(USERS_STORAGE, JSON.stringify(users)); renderUserManagement(); logAudit('user_mgmt', `Changed ${u.displayName} role to ${newRole}`); toast(`Role updated`,'success'); }
}

function toggleUserActive(userId) {
  const users = getUsers() || [];
  const u = users.find(x => x.id === userId);
  if (u) { u.active = !u.active; localStorage.setItem(USERS_STORAGE, JSON.stringify(users)); renderUserManagement(); logAudit('user_mgmt', `${u.active?'Enabled':'Disabled'} user: ${u.displayName}`); toast(`User ${u.active?'enabled':'disabled'}`,'success'); }
}

async function resetUserPassword(userId) {
  const newPw = prompt('Enter new password (4+ characters):');
  if (!newPw || newPw.length < 4) { toast('Password too short','error'); return; }
  const users = getUsers() || [];
  const u = users.find(x => x.id === userId);
  if (u) { var rc = await hashPassword(newPw); u.passwordHash = rc.hash; u.passwordSalt = rc.salt; localStorage.setItem(USERS_STORAGE, JSON.stringify(users)); toast(`Password reset for ${u.displayName}`,'success'); logAudit('user_mgmt', `Password reset: ${u.displayName}`); }
}

// ======= REMINDERS & NOTIFICATIONS =======
function refreshReminders() {
  const alerts = [];
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // 1. Company License Expiry
  (companyProfiles || []).forEach(c => {
    if (c.licenseExpiry) {
      const exp = new Date(c.licenseExpiry);
      if (exp < now) {
        alerts.push({ type: 'red', title: 'LICENSE EXPIRED', detail: `${c.name} — expired ${c.licenseExpiry}`, category: 'license' });
      } else if (exp < in30) {
        alerts.push({ type: 'amber', title: 'LICENSE EXPIRING SOON', detail: `${c.name} — expires ${c.licenseExpiry}`, category: 'license' });
      }
    }
  });

  // 2. Incident Deadlines
  const incidents = safeLocalParse('fgl_incidents', []);
  incidents.filter(i => i.status !== 'closed' && i.deadline).forEach(i => {
    const dl = new Date(i.deadline);
    if (dl < now) {
      alerts.push({ type: 'red', title: 'INCIDENT OVERDUE', detail: `${i.title} — deadline was ${i.deadline}`, category: 'incident' });
    } else if (dl < in7) {
      alerts.push({ type: 'amber', title: 'INCIDENT DUE SOON', detail: `${i.title} — due ${i.deadline}`, category: 'incident' });
    }
  });

  // 3. Calendar / Compliance Deadlines
  const deadlines = safeLocalParse('fgl_calendar', []);
  deadlines.filter(d => !d.completed).forEach(d => {
    const dt = new Date(d.date);
    if (dt < now) {
      alerts.push({ type: 'red', title: 'DEADLINE OVERDUE', detail: `${d.title || d.template || 'Task'} — was due ${d.date}`, category: 'deadline' });
    } else if (dt < in7) {
      alerts.push({ type: 'amber', title: 'DEADLINE APPROACHING', detail: `${d.title || d.template || 'Task'} — due ${d.date}`, category: 'deadline' });
    }
  });

  // 4. Open Incidents (critical/high without action)
  incidents.filter(i => i.status === 'open' && (i.severity === 'critical' || i.severity === 'high')).forEach(i => {
    const created = new Date(i.createdAt || i.date);
    const daysSince = Math.floor((now - created) / (24*60*60*1000));
    if (daysSince > 3) {
      alerts.push({ type: 'red', title: 'CRITICAL INCIDENT UNRESOLVED', detail: `${i.title} — open for ${daysSince} days`, category: 'incident' });
    }
  });

  // 5. Onboarding reviews overdue (90-day review cycle)
  const customers = safeLocalParse('fgl_onboarding', []);
  customers.forEach(c => {
    const onboardDate = new Date(c.date);
    const reviewDue = new Date(onboardDate.getTime() + 90 * 24 * 60 * 60 * 1000);
    if (reviewDue < now && c.risk && (c.risk.level === 'HIGH' || c.risk.level === 'CRITICAL')) {
      alerts.push({ type: 'amber', title: 'KYC REVIEW DUE', detail: `${c.name} (${c.risk.level}) — onboarded ${new Date(c.date).toLocaleDateString('en-GB')}, review overdue`, category: 'kyc' });
    }
  });

  // 6. Whistleblower reports pending
  const wbReports = safeLocalParse('fgl_whistleblower_reports', []);
  const openWB = wbReports.filter(r => r.status === 'open' && r.urgency === 'high');
  if (openWB.length) {
    alerts.push({ type: 'red', title: 'URGENT WB REPORTS', detail: `${openWB.length} high-urgency whistleblower report(s) awaiting investigation`, category: 'whistleblower' });
  }

  // 7. Sanctions lists not refreshed in 30+ days
  const sanctionsRefresh = safeLocalParse('fgl_sanctions_refresh', null);
  if (!sanctionsRefresh || !sanctionsRefresh.timestamp) {
    alerts.push({ type: 'amber', title: 'SANCTIONS LISTS', detail: 'Lists have never been refreshed — run a refresh check', category: 'sanctions' });
  } else {
    const lastRefresh = new Date(sanctionsRefresh.timestamp);
    const daysSince = Math.floor((now - lastRefresh) / (24*60*60*1000));
    if (daysSince > 30) {
      alerts.push({ type: 'red', title: 'SANCTIONS REFRESH OVERDUE', detail: `Last refreshed ${daysSince} days ago — update immediately`, category: 'sanctions' });
    } else if (daysSince > 7) {
      alerts.push({ type: 'amber', title: 'SANCTIONS REFRESH DUE', detail: `Last refreshed ${daysSince} days ago`, category: 'sanctions' });
    }
  }

  // Render
  const listEl = document.getElementById('notifList');
  const badgeEl = document.getElementById('notifBadge');
  if (listEl) {
    if (!alerts.length) {
      listEl.innerHTML = '<div class="notif-item ni-green"><div class="ni-title">ALL CLEAR</div><div class="ni-detail">No pending reminders or expired documents.</div></div>';
    } else {
      listEl.innerHTML = alerts.map(a => `<div class="notif-item ni-${escHtml(a.type)}"><div class="ni-title">${escHtml(a.title)}</div><div class="ni-detail">${escHtml(a.detail)}</div></div>`).join('');
    }
  }
  if (badgeEl) {
    const critical = alerts.filter(a => a.type === 'red').length;
    const total = alerts.length;
    if (total > 0) {
      badgeEl.style.display = 'flex';
      badgeEl.textContent = total;
      badgeEl.style.background = critical > 0 ? '#EF4444' : '#F59E0B';
    } else {
      badgeEl.style.display = 'none';
    }
  }
}

function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  if (panel) panel.classList.toggle('open');
}

// Close notif panel on outside click
document.addEventListener('click', function(e) {
  const wrap = document.getElementById('notifBellWrap');
  const panel = document.getElementById('notifPanel');
  if (wrap && panel && !wrap.contains(e.target)) panel.classList.remove('open');
});

// ======= SCREENING (Sanctions + PEP) =======
const SCREENING_STORAGE = 'fgl_screenings';

async function runScreening() {
  const name = document.getElementById('screenName').value.trim();
  if (!name) { toast('Enter entity name','error'); return; }
  const type = document.getElementById('screenType').value;
  const country = document.getElementById('screenCountry').value.trim();
  const idNum = document.getElementById('screenId').value.trim();
  const sanctionsLists = [];
  if (document.getElementById('screenSL_UAE')?.checked) sanctionsLists.push('UAE Local Terrorist List (EOCN)');
  if (document.getElementById('screenSL_UN')?.checked) sanctionsLists.push('UN Consolidated Sanctions List (UNSC)');
  if (document.getElementById('screenSL_OFAC')?.checked) sanctionsLists.push('OFAC SDN List');
  if (document.getElementById('screenSL_UK')?.checked) sanctionsLists.push('UK OFSI Consolidated Financial Sanctions List');
  if (document.getElementById('screenSL_EU')?.checked) sanctionsLists.push('EU Consolidated Financial Sanctions List');
  if (document.getElementById('screenSL_INTERPOL')?.checked) sanctionsLists.push('INTERPOL Red Notices');
  const checkSanctions = sanctionsLists.length > 0;

  const adverseMediaCategories = [];
  if (document.getElementById('screenAMCriminal')?.checked) adverseMediaCategories.push('Criminal / Fraud Allegations');
  if (document.getElementById('screenAMML')?.checked) adverseMediaCategories.push('Money Laundering');
  if (document.getElementById('screenAMTF')?.checked) adverseMediaCategories.push('Terrorist Financing, or Proliferation Financing Links');
  if (document.getElementById('screenAMReg')?.checked) adverseMediaCategories.push('Regulatory Actions, Fines, or Investigations');
  if (document.getElementById('screenAMRep')?.checked) adverseMediaCategories.push('Negative Reputation or Commercial Disputes');
  if (document.getElementById('screenAMPEP')?.checked) adverseMediaCategories.push('Political Controversy or PEP Connections');
  if (document.getElementById('screenAMHR')?.checked) adverseMediaCategories.push('Human Rights, Environmental, or Ethical Violations');

  const sb = document.getElementById('screeningStatus'); sb.style.display = 'flex';
  document.getElementById('screeningStatusText').textContent = 'Running screening checks...';

  const prompt = `MAXIMUM DEPTH SCREENING — LEAVE NO STONE UNTURNED. Return ONLY a single-line compact JSON object, no markdown.

Entity: ${name} | Type: ${type} | Country: ${country || 'N/A'} | ID: ${idNum || 'N/A'}

You MUST check ALL of the following regardless of selections:
1. ALL SANCTIONS: OFAC SDN/SSI/CAPTA, UN Consolidated, EU Consolidated, UK OFSI, UAE EOCN, UAE Central Bank, Swiss SECO, Australian DFAT, Canadian SEMA, country-specific programs.
2. PEP: heads of state, ministers, military, judiciary, SOE executives, family, associates.
3. EXHAUSTIVE ADVERSE MEDIA: Search your ENTIRE knowledge — criminal investigations, money laundering, fraud, corruption, environmental crimes (illegal mining/gold/deforestation), human rights, regulatory fines, lawsuits, terrorism financing, narcotics, sanctions evasion. Sources: ICIJ, OCCRP, Reporter Brasil, Mongabay, Amazon Watch, Global Witness, Turkish Minute, Middle East Eye, Al Jazeera, Bellingcat, BBC, Reuters, Bloomberg, FT, local media. NGOs: Transparency International, BHRRC, Amnesty, HRW. Gold/metals: LBMA, DMCC.
4. UAE-SPECIFIC: EOCN, UAE Central Bank circulars, MENAFATF, DMCC disciplinary.

ACCURACY: NEVER fabricate sanctions. Adverse media is SEPARATE from sanctions. POTENTIAL_MATCH = adverse media but no confirmed sanctions. MATCH = confirmed on sanctions list.
Keep strings under 50 chars. Max 2 items per array. No nested objects.

JSON: {"result":"CLEAR|MATCH|POTENTIAL_MATCH","risk_level":"LOW|MEDIUM|HIGH|CRITICAL","sanctions_hits":[{"list":"name","match_type":"exact|partial","details":"short"}],"adverse_media_hits":[{"category":"cat","source":"src","date":"date","details":"short"}],"risk_factors":["short"],"recommended_actions":["short"],"summary":"one line"}`;

  if (!ANTHROPIC_KEY && !OPENAI_KEY && !GEMINI_KEY && !COPILOT_KEY && !PROXY_URL) {
    sb.style.display='none';
    toast('AI API key required. Configure Anthropic, OpenAI, Gemini key or Proxy URL in Settings.','error',5000);
    return;
  }

  // Repair truncated JSON by closing open strings, arrays, objects
  function repairJSON(str) {
    try { return JSON.parse(str); } catch(_) {}
    // Try to extract JSON object
    const m = str.match(/\{[\s\S]*/);
    if (!m) return null;
    let s = m[0];
    // Remove trailing incomplete string value
    s = s.replace(/,"[^"]*$/,'').replace(/:"[^"]*$/,'');
    // Count and close brackets
    let braces = 0, brackets = 0, inStr = false, escaped = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') braces++;
      if (c === '}') braces--;
      if (c === '[') brackets++;
      if (c === ']') brackets--;
    }
    if (inStr) s += '"';
    while (brackets > 0) { s += ']'; brackets--; }
    while (braces > 0) { s += '}'; braces--; }
    try { return JSON.parse(s); } catch(_) { return null; }
  }

  try {
    const data = await callAI({ model:'claude-haiku-4-5', max_tokens:1024, temperature:0, system:'Sanctions screening expert. Return ONLY raw compact JSON. No markdown. No code fences. No explanation. Keep strings very short.', messages:[{role:'user',content:prompt}] });
    const raw = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
    let cleaned = raw.replace(/```json?\n?/g,'').replace(/```/g,'').trim();
    let result = repairJSON(cleaned);
    if (!result) {
      toast('Retrying screening...','info',2000);
      const retry = await callAI({ model:'claude-haiku-4-5', max_tokens:1024, temperature:0, system:'Return ONLY raw compact JSON. No markdown. No fences.', messages:[{role:'user',content:prompt}] });
      const retryRaw = (retry.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
      let retryCleaned = retryRaw.replace(/```json?\n?/g,'').replace(/```/g,'').trim();
      result = repairJSON(retryCleaned);
      if (!result) throw new Error('Could not parse screening response');
    }
    if (!result.result) result.result = 'POTENTIAL_MATCH';
    if (!result.risk_level) result.risk_level = 'MEDIUM';
    if (!result.summary) result.summary = 'Screening completed';
    if (!result.sanctions_hits) result.sanctions_hits = [];
    if (!result.adverse_media_hits) result.adverse_media_hits = [];
    if (!result.risk_factors) result.risk_factors = [];
    if (!result.recommended_actions) result.recommended_actions = [];

    const record = { id:Date.now(), name, type, country, date:new Date().toISOString(), result };
    const history = safeLocalParse(SCREENING_STORAGE, []);
    history.unshift(record);
    safeLocalSave(SCREENING_STORAGE, history.slice(0,200));
    logAudit('screening', `Screened ${name}: ${result.result}`);
    if (result.result !== 'CLEAR' && typeof WorkflowEngine !== 'undefined') WorkflowEngine.processTrigger('screening_match', { name, type, country, result: result.result, list: result.matchedList || '', details: result.summary || '' });

    renderScreeningResult(result, name);
    loadScreeningHistory();
    sb.style.display='none';
    toast(`Screening complete: ${result.result}`, result.result === 'CLEAR' ? 'success' : 'info');

    // Asana sync for non-clear screenings
    if (result.result !== 'CLEAR') {
      autoSyncToAsana(
        `SCREENING ${result.result}: ${name}`,
        `Sanctions/Adverse Media Screening Result\nEntity: ${name}\nType: ${type}\nCountry: ${country}\nResult: ${result.result}\nRisk Level: ${result.risk_level}\n\nSummary: ${result.summary}\n\nSanctions Hits: ${(result.sanctions_hits||[]).length}\nAdverse Media Hits: ${(result.adverse_media_hits||[]).length}\n\nRecommended Actions:\n${(result.recommended_actions||[]).map(a=>'• '+a).join('\n')}`,
        result.result === 'MATCH' ? 1 : 7
      ).then(gid => { if (gid) toast('Screening result synced to Asana','success',2000); });
    }
  } catch(e) {
    sb.style.display='none';
    // Check if a result was already rendered despite the error
    const resEl = document.getElementById('screeningResults');
    if (resEl && resEl.style.display === 'block' && resEl.querySelector('#screeningResultsContent')?.innerHTML?.length > 50) {
      // Result rendered successfully, suppress error
      return;
    }
    if (isBillingError(e)) {
      toast('API credits exhausted — AI screening unavailable. Add credits at console.anthropic.com or perform manual screening.','info',8000);
      const manualResult = {
        result: 'MANUAL_REVIEW',
        risk_level: 'UNKNOWN',
        summary: 'AI screening unavailable (API credits exhausted). Manual screening required against official sanctions lists.',
        sanctions_hits: [],
        adverse_media_hits: [],
        risk_factors: ['AI screening unavailable — manual verification required'],
        recommended_actions: [
          'Screen against UN Consolidated List (scsanctions.un.org)',
          'Screen against OFAC SDN (ofac.treasury.gov)',
          'Screen against UAE EOCN local terrorist list',
          'Screen against EU/UK consolidated lists',
          'Document manual screening results'
        ]
      };
      const record = { id:Date.now(), name, type, country, date:new Date().toISOString(), result: manualResult };
      const history = safeLocalParse(SCREENING_STORAGE, []);
      history.unshift(record);
      safeLocalSave(SCREENING_STORAGE, history.slice(0,200));
      logAudit('screening', `Screened ${name}: MANUAL_REVIEW (API credits exhausted)`);
      renderScreeningResult(manualResult, name);
      loadScreeningHistory();
    } else {
      toast(`Screening error: ${e.message}`,'error');
    }
  }
}

const SANCTIONS_REFRESH_STORAGE = 'fgl_sanctions_refresh';
async function refreshSanctionsLists() {
  const btn = document.getElementById('btnRefreshSanctions');
  const statusEl = document.getElementById('sanctionsListStatus');
  if (!statusEl) { toast('Sanctions status element not found','error'); return; }
  if (btn) btn.disabled = true;
  if (btn) btn.textContent = '⏳ Refreshing...';
  statusEl.style.display = 'block';
  statusEl.style.background = 'var(--gold-dim)';
  statusEl.style.color = 'var(--gold)';
  statusEl.textContent = 'Checking sanctions list sources for updates...';

  const lists = [
    { id: 'UAE', name: 'UAE Local Terrorist List (EOCN)', source: 'UAE Executive Office / EOCN' },
    { id: 'UN', name: 'UN Consolidated Sanctions List', source: 'UN Security Council' },
    { id: 'OFAC', name: 'OFAC SDN List', source: 'US Treasury / OFAC' },
    { id: 'UK', name: 'UK OFSI Consolidated List', source: 'HM Treasury' },
    { id: 'EU', name: 'EU Consolidated Sanctions List', source: 'European Commission' },
    { id: 'INTERPOL', name: 'INTERPOL Red Notices', source: 'INTERPOL' }
  ];

  try {
    const data = await callAI({ model:'claude-haiku-4-5', max_tokens:2000, temperature:0,
      system:'You are a sanctions compliance data specialist. Return only valid JSON.',
      messages:[{role:'user',content:`Provide the current status of these sanctions lists as of today (${new Date().toISOString().slice(0,10)}). For each list, indicate if it has been recently updated and approximate entry count.
Lists: ${lists.map(l=>l.name).join(', ')}
Return JSON array: [{"id":"UAE","lastUpdate":"YYYY-MM-DD","entries":150,"status":"CURRENT|UPDATED|NEEDS_CHECK","notes":"brief note"}]`}]
    });
    const raw = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
    let cleaned = raw.replace(/```json?\n?/g,'').replace(/```/g,'').trim();
    // Extract JSON array if surrounded by extra text
    const arrMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrMatch) cleaned = arrMatch[0];
    let results;
    try {
      results = JSON.parse(cleaned);
    } catch(_) {
      // Fallback: build default status entries if AI returned bad JSON
      results = lists.map(l => ({ id: l.id, lastUpdate: new Date().toISOString().slice(0,10), entries: 0, status: 'CURRENT', notes: 'Status checked' }));
    }

    const refreshRecord = { timestamp: new Date().toISOString(), results };
    safeLocalSave(SANCTIONS_REFRESH_STORAGE, refreshRecord);

    statusEl.style.background = 'rgba(16,185,129,0.12)';
    statusEl.style.color = '#10B981';
    statusEl.innerHTML = `✅ All ${lists.length} sanctions lists checked — <strong>${new Date().toLocaleString('en-GB')}</strong>`;

    const lastEl = document.getElementById('sanctionsLastRefresh');
    if (lastEl) lastEl.innerHTML = results.map(r => `<span style="margin-right:12px">${escHtml(r.id)}: ${r.status === 'CURRENT' ? '🟢' : r.status === 'UPDATED' ? '🟡' : '🔴'} ${escHtml(r.lastUpdate)} (${(r.entries||0).toLocaleString('en-GB')} entries)</span>`).join('');

    logAudit('sanctions_refresh', `Refreshed ${lists.length} sanctions lists`);
    toast('Sanctions lists refreshed', 'success');
  } catch(e) {
    if (isBillingError(e)) {
      // API credits exhausted — fall back to local-only status update
      const fallbackResults = lists.map(l => ({ id: l.id, lastUpdate: 'N/A', entries: 0, status: 'NEEDS_CHECK', notes: 'API unavailable — verify manually' }));
      const refreshRecord = { timestamp: new Date().toISOString(), results: fallbackResults, offline: true };
      safeLocalSave(SANCTIONS_REFRESH_STORAGE, refreshRecord);

      statusEl.style.background = 'rgba(232,168,56,0.12)';
      statusEl.style.color = '#E8A838';
      statusEl.innerHTML = `⚠ AI API credits exhausted — lists recorded as NEEDS_CHECK. Please verify sanctions lists manually via official sources or add API credits in <a href="https://console.anthropic.com" target="_blank" rel="noopener" style="color:#E8A838;text-decoration:underline">console.anthropic.com</a>.`;

      const lastEl = document.getElementById('sanctionsLastRefresh');
      if (lastEl) lastEl.innerHTML = fallbackResults.map(r => `<span style="margin-right:12px">${escHtml(r.id)}: 🟡 NEEDS_CHECK</span>`).join('');

      logAudit('sanctions_refresh', 'Sanctions refresh attempted — API credits exhausted, manual verification required');
      toast('API credits exhausted — verify sanctions lists manually', 'info', 8000);
    } else {
      statusEl.style.background = 'var(--red-dim)';
      statusEl.style.color = 'var(--red)';
      statusEl.textContent = `❌ Refresh failed: ${e.message}`;
      toast('Sanctions refresh failed', 'error');
    }
  }
  if (btn) { btn.disabled = false; btn.textContent = '🔄 Refresh Lists'; }
}

function initSanctionsRefreshStatus() {
  const saved = safeLocalParse(SANCTIONS_REFRESH_STORAGE, null);
  if (saved && saved.timestamp) {
    const lastEl = document.getElementById('sanctionsLastRefresh');
    if (lastEl) {
      const dt = new Date(saved.timestamp);
      lastEl.innerHTML = `Last refresh: ${dt.toLocaleString('en-GB')}` + (saved.results ? ' — ' + saved.results.map(r => `<span style="margin-right:8px">${escHtml(r.id)}: ${r.status === 'CURRENT' ? '🟢' : r.status === 'UPDATED' ? '🟡' : '🔴'}</span>`).join('') : '');
    }
  }
}

function getComplianceDescription(result) {
  if (result === 'MATCH') return {
    label: 'POSITIVE MATCH',
    desc: 'The screened entity has been positively identified on one or more sanctions lists, PEP databases, or adverse media sources. Under Cabinet Decision No.(74) of 2020 and EOCN Executive Office Guidance on TFS, and FATF Recommendation 6, the business relationship must NOT proceed. Immediately freeze assets without delay (within 24 hours of confirmation). File a Funds Freeze Report (FFR) via goAML and submit a Confirmed Name Match Report (CNMR) to EOCN within 5 business days. Escalate to MLRO and senior management immediately.',
    color: '#D94F4F', bg: 'rgba(217,79,79,0.08)', border: '#D94F4F'
  };
  if (result === 'POTENTIAL_MATCH') return {
    label: 'POTENTIAL MATCH',
    desc: 'The screened entity has partial or similar name matches against sanctions lists, PEP databases, or adverse media sources. Under UAE CBUAE Guidance on TFS (2021) and FATF Recommendation 10, Enhanced Due Diligence (EDD) is required. The compliance officer must manually verify identity documents, cross-reference date of birth, nationality, and ID numbers to confirm or dismiss the match. Do NOT proceed with the business relationship until the match is resolved and documented. If confirmed, treat as Positive Match.',
    color: '#E8A838', bg: 'rgba(232,168,56,0.08)', border: '#E8A838'
  };
  if (result === 'MANUAL_REVIEW') return {
    label: 'MANUAL REVIEW REQUIRED',
    desc: 'AI-powered screening is currently unavailable (API credits exhausted). The compliance officer must perform manual screening against all mandatory sanctions lists: UAE Local Terrorist List (EOCN), UNSC Consolidated List (Cabinet Decision 74/2020), OFAC SDN, EU Consolidated, and UK OFSI. Document all manual checks with timestamps and sources. Do NOT proceed with onboarding until manual screening is completed and documented. Add API credits at console.anthropic.com to restore AI screening.',
    color: '#E8A838', bg: 'rgba(232,168,56,0.08)', border: '#E8A838'
  };
  return {
    label: 'NEGATIVE MATCH',
    desc: 'No matches found against sanctions lists, PEP databases, or adverse media sources. The entity is cleared for onboarding or transaction processing under standard Customer Due Diligence (CDD). Per FATF Recommendation 10 and UAE Federal Decree-Law No.10/2025 (Art.16), maintain records of the screening for a minimum of 5 years. Re-screen periodically or upon trigger events (e.g., change in ownership, high-value transaction, updated sanctions lists).',
    color: '#27AE60', bg: 'rgba(39,174,96,0.08)', border: '#27AE60'
  };
}

function renderScreeningResult(result, name) {
  const el = document.getElementById('screeningResults');
  const cls = result.result==='CLEAR'?'f-ok':result.result==='MATCH'?'f-critical':'f-high';
  const badge = result.result==='CLEAR'?'b-ok':result.result==='MATCH'?'b-c':'b-h';
  const comp = getComplianceDescription(result.result);
  el.style.display='block';
  el.querySelector('#screeningResultsContent').innerHTML = `
    <div class="finding ${cls}" style="animation:none;opacity:1">
      <div class="f-head"><div class="f-head-left"><span class="badge ${badge}">${comp.label}</span><span class="f-title">${escHtml(name||'')}</span></div><span class="badge" style="background:rgba(201,168,76,0.05)">${escHtml(result.risk_level||'')} RISK</span></div>
      <div class="f-body">${escHtml(result.summary||'')} </div>
      ${(result.sanctions_hits||[]).length?`<div class="rec" style="margin-top:8px"><strong>Sanctions Hits:</strong> ${result.sanctions_hits.map(h=>`${escHtml(h.list)} (${escHtml(h.match_type)}): ${escHtml(h.details)}`).join('; ')}</div>`:''}
      ${(result.adverse_media_hits||[]).length?`<div class="rec" style="margin-top:8px"><strong>Adverse Media Hits:</strong><ul style="margin:4px 0 0 16px;font-size:12px">${result.adverse_media_hits.map(h=>`<li><strong>${escHtml(h.category)}</strong> — ${escHtml(h.details)}${h.source?' <span style="color:var(--muted)">('+escHtml(h.source)+')</span>':''}${h.date?' <span style="color:var(--muted)">['+escHtml(h.date)+']</span>':''}</li>`).join('')}</ul></div>`:''}
      ${(result.risk_factors||[]).length?`<div class="rec" style="margin-top:8px"><strong>Risk Factors:</strong> ${escHtml(result.risk_factors.join(', '))}</div>`:''}
      ${(result.recommended_actions||[]).length?`<div class="rec" style="margin-top:8px"><strong>Actions:</strong> ${escHtml(result.recommended_actions.join('; '))}</div>`:''}
    </div>
    <div style="margin-top:10px;padding:12px 14px;border-left:4px solid ${comp.border};background:${comp.bg};border-radius:3px">
      <div style="font-size:12px;font-weight:600;color:${comp.color};margin-bottom:4px;font-family:'Montserrat',sans-serif">${comp.label} — COMPLIANCE BASIS</div>
      <div style="font-size:12px;color:var(--text);line-height:1.5">${comp.desc}</div>
    </div>`;
}

function loadScreeningHistory() {
  const history = safeLocalParse(SCREENING_STORAGE, []);
  const el = document.getElementById('screeningHistoryList');
  if (!history.length) { el.innerHTML='<p style="font-size:13px;color:var(--muted)">No screenings yet.</p>'; return; }
  var _scrCfg = typeof complianceConfig !== 'undefined' ? complianceConfig : { screeningStaleDays: 90 };
  el.innerHTML = history.slice(0,50).map(h=>{
    const r = h.result||{};
    const comp = getComplianceDescription(r.result);
    const cls = r.result==='CLEAR'?'b-ok':r.result==='MATCH'?'b-c':'b-h';
    const ageDays = Math.floor((Date.now() - new Date(h.date).getTime()) / 86400000);
    const ageLabel = ageDays <= 30 ? '🟢 ' + ageDays + 'd ago' : ageDays <= _scrCfg.screeningStaleDays ? '🟡 ' + ageDays + 'd ago' : '🔴 ' + ageDays + 'd ago — STALE';
    return `<div class="asana-item"><div><div class="asana-name">${escHtml(h.name||'')}</div><div class="asana-meta">${escHtml(h.type||'')} | ${escHtml(h.country||'—')} | ${new Date(h.date).toLocaleDateString('en-GB')} | <span style="font-size:10px">${ageLabel}</span></div></div><span class="badge ${cls}">${comp.label}</span></div>`;
  }).join('');
}

function exportScreeningPDF() {
  if (!requireJsPDF()) return;
  const history = safeLocalParse(SCREENING_STORAGE, []);
  if (!history.length) { toast('No screening history to export','error'); return; }
  const doc = new jspdf.jsPDF();
  doc.setFontSize(16); doc.setTextColor(180,151,90);
  doc.text('Screening History Report', 14, 20);
  doc.setFontSize(9); doc.setTextColor(100);
  doc.text('Generated: ' + new Date().toLocaleString('en-GB'), 14, 27);
  doc.text('FGL Hawkeye Sterling V2', 14, 32);
  let y = 42;
  history.forEach((h, i) => {
    if (y > 265) { doc.addPage(); y = 20; }
    const r = h.result || {};
    doc.setFontSize(10); doc.setTextColor(40);
    doc.text(`${i+1}. ${h.name}`, 14, y);
    doc.setFontSize(8); doc.setTextColor(80);
    doc.text(`Type: ${h.type} | Country: ${h.country||'N/A'} | Date: ${new Date(h.date).toLocaleDateString('en-GB')} | Result: ${r.result||'N/A'} | Risk: ${r.risk_level||'N/A'}`, 14, y+5);
    if (r.summary) {
      const lines = doc.splitTextToSize('Summary: ' + r.summary, 180);
      doc.text(lines, 14, y+10);
      y += 10 + lines.length * 3.5;
    } else { y += 10; }
    if (r.sanctions_hits && r.sanctions_hits.length) {
      doc.text('Sanctions Hits: ' + r.sanctions_hits.map(s => s.list + ' (' + s.match_type + ')').join(', '), 14, y);
      y += 5;
    }
    if (r.adverse_media_hits && r.adverse_media_hits.length) {
      doc.text('Adverse Media: ' + r.adverse_media_hits.map(a => a.category).join(', '), 14, y);
      y += 5;
    }
    if (r.recommended_actions && r.recommended_actions.length) {
      doc.text('Actions: ' + r.recommended_actions.join('; '), 14, y);
      y += 5;
    }
    y += 6;
  });
  doc.save('FGL_Screening_History.pdf');
  toast('PDF exported', 'success');
}

function exportScreeningDOCX() {
  const history = safeLocalParse(SCREENING_STORAGE, []);
  if (!history.length) { toast('No screening history to export','error'); return; }
  let html = wordDocHeader('Screening History Report');
  html += '<table><tr><th>#</th><th>Entity</th><th>Type</th><th>Country</th><th>Date</th><th>Result</th><th>Risk</th><th>Summary</th></tr>';
  history.forEach((h, i) => {
    const r = h.result || {};
    const cls = r.result === 'CLEAR' ? 'clear' : 'match';
    html += `<tr><td>${i+1}</td><td>${h.name}</td><td>${h.type}</td><td>${h.country||'N/A'}</td><td>${new Date(h.date).toLocaleDateString('en-GB')}</td><td class="${cls}">${r.result||'N/A'}</td><td>${r.risk_level||'N/A'}</td><td>${r.summary||''}</td></tr>`;
  });
  html += '</table>' + wordDocFooter();
  downloadWordDoc(html, 'FGL_Screening_History.doc');
  toast('Word document exported', 'success');
}

function exportScreeningCSV() {
  const history = safeLocalParse(SCREENING_STORAGE, []);
  if (!history.length) { toast('No screening history to export','error'); return; }
  const headers = ['#','Entity','Type','Country','Date','Result','Risk Level','Summary','Sanctions Hits','Adverse Media','Recommended Actions'];
  const rows = history.map((h, i) => {
    const r = h.result || {};
    return [
      i+1, h.name, h.type, h.country||'', new Date(h.date).toLocaleDateString('en-GB'),
      r.result||'', r.risk_level||'', r.summary||'',
      (r.sanctions_hits||[]).map(s=>s.list+' ('+s.match_type+')').join('; '),
      (r.adverse_media_hits||[]).map(a=>a.category+': '+a.details).join('; '),
      (r.recommended_actions||[]).join('; ')
    ];
  });
  const csv = [headers, ...rows].map(r => r.map(c => '"' + String(c).replace(/"/g,'""') + '"').join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'FGL_Screening_History.csv'; a.click(); URL.revokeObjectURL(a.href);
  toast('Excel/CSV exported', 'success');
}

function clearScreeningHistory() {
  if (!confirm('Clear all screening history? This cannot be undone.')) return;
  safeLocalRemove(SCREENING_STORAGE);
  loadScreeningHistory();
  document.getElementById('screeningResults').style.display = 'none';
  logAudit('screening', 'Screening history cleared');
  toast('Screening history cleared', 'success');
}

// ======= LOCAL SHIPMENTS =======
const LOCAL_SHIPMENTS_STORAGE = 'fgl_local_shipments';
let editingLocalShipmentId = null;

function getLsVal(id) { const el = document.getElementById(id); return el ? (el.type==='checkbox'?el.checked:el.value.trim()) : ''; }

function addLocalShipment() {
  const invoiceNo = getLsVal('lsInvoiceNo');
  if (!invoiceNo) { toast('Enter invoice number','error'); return; }
  const record = {
    id: editingLocalShipmentId || Date.now(),
    invoiceNo, supplierCustomer: getLsVal('lsSupplierCustomer'), productBrand: getLsVal('lsProductBrand'),
    material: getLsVal('lsMaterial'), subSupplierInvoice: getLsVal('lsSubSupplierInvoice'), amount: getLsVal('lsAmount'),
    soc: getLsVal('lsSoc'), currency: getLsVal('lsCurrency'),
    deliveryNote: getLsVal('lsDeliveryNote'), taxInvoice: getLsVal('lsTaxInvoice'), collectionNote: getLsVal('lsCollectionNote'),
    brinksLoomisLoi: getLsVal('lsBrinksLoomisLoi'), packingList: getLsVal('lsPackingList'), barList: getLsVal('lsBarList'),
    customerInvoice: getLsVal('lsCustomerInvoice'),
    transportationOrder: getLsVal('lsTransportationOrder'), folderNo: getLsVal('lsFolderNo'),
    consignee: getLsVal('lsConsignee'), customBoe: getLsVal('lsCustomBoe'),
    createdAt: new Date().toISOString()
  };
  const list = safeLocalParse(LOCAL_SHIPMENTS_STORAGE, []);
  const idx = list.findIndex(s => s.id === record.id);
  if (idx >= 0) list[idx] = record; else list.unshift(record);
  safeLocalSave(LOCAL_SHIPMENTS_STORAGE, list);
  logAudit('local-shipment', `Local shipment ${editingLocalShipmentId?'updated':'added'}: ${invoiceNo}`);
  clearLocalShipmentForm();
  renderLocalShipments();
  toast(editingLocalShipmentId ? 'Shipment updated' : 'Local shipment added', 'success');
  editingLocalShipmentId = null;
  document.getElementById('lsSaveBtn').textContent = 'Add Local Shipment';
  document.getElementById('lsCancelEditBtn').style.display = 'none';
}

function renderLocalShipments() {
  const list = safeLocalParse(LOCAL_SHIPMENTS_STORAGE, []);
  const el = document.getElementById('localShipmentsList');
  if (!el) return;
  if (!list.length) { el.innerHTML='<p style="font-size:13px;color:var(--muted)">No local shipments recorded.</p>'; return; }
  el.innerHTML = list.map(s => {
    const docs = [s.deliveryNote,s.taxInvoice,s.collectionNote,s.brinksLoomisLoi,s.packingList,s.barList,s.customerInvoice,s.transportationOrder,s.customBoe].filter(d=>d==='Provided').length;
    const total = 9;
    const pct = Math.round(docs/total*100);
    const color = pct===100?'var(--green)':pct>=60?'var(--amber)':'var(--red)';
    return `<div class="asana-item" style="cursor:pointer" data-action="editLocalShipment" data-arg="${s.id}">
      <div>
        <div class="asana-name">${escHtml(s.invoiceNo)} — ${escHtml(s.supplierCustomer||'—')}</div>
        <div class="asana-meta">${escHtml(s.material||'—')} | Amt: ${escHtml(s.amount||'0')} ${escHtml(s.currency||'')} | Folder: ${escHtml(s.folderNo||'—')} | Docs: ${docs}/${total}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:10px;font-weight:700;color:${color}">${pct}%</span>
        <button class="btn btn-sm btn-red" style="padding:2px 8px;font-size:10px" data-action="_stopAndDeleteLocalShipment" data-arg="${s.id}">Delete</button>
      </div>
    </div>`;
  }).join('');
}

function editLocalShipment(id) {
  const list = safeLocalParse(LOCAL_SHIPMENTS_STORAGE, []);
  const s = list.find(x => x.id === id);
  if (!s) return;
  editingLocalShipmentId = id;
  const map = {
    lsInvoiceNo:s.invoiceNo, lsSupplierCustomer:s.supplierCustomer, lsProductBrand:s.productBrand,
    lsMaterial:s.material, lsSubSupplierInvoice:s.subSupplierInvoice, lsAmount:s.amount,
    lsSoc:s.soc, lsCurrency:s.currency,
    lsDeliveryNote:s.deliveryNote, lsTaxInvoice:s.taxInvoice, lsCollectionNote:s.collectionNote,
    lsBrinksLoomisLoi:s.brinksLoomisLoi, lsPackingList:s.packingList, lsBarList:s.barList,
    lsCustomerInvoice:s.customerInvoice,
    lsTransportationOrder:s.transportationOrder, lsFolderNo:s.folderNo,
    lsConsignee:s.consignee, lsCustomBoe:s.customBoe
  };
  Object.entries(map).forEach(([k,v]) => { const el=document.getElementById(k); if(el) el.value=v||''; });
  document.getElementById('lsSaveBtn').textContent = 'Update Shipment';
  document.getElementById('lsCancelEditBtn').style.display = '';
}

function cancelLocalShipmentEdit() {
  editingLocalShipmentId = null;
  clearLocalShipmentForm();
  document.getElementById('lsSaveBtn').textContent = 'Add Local Shipment';
  document.getElementById('lsCancelEditBtn').style.display = 'none';
}

function deleteLocalShipment(id) {
  if (!confirm('Delete this local shipment?')) return;
  let list = safeLocalParse(LOCAL_SHIPMENTS_STORAGE, []);
  list = list.filter(x => x.id !== id);
  safeLocalSave(LOCAL_SHIPMENTS_STORAGE, list);
  renderLocalShipments();
  toast('Local shipment deleted', 'success');
}

function clearLocalShipmentForm() {
  ['lsInvoiceNo','lsSupplierCustomer','lsProductBrand','lsMaterial','lsSubSupplierInvoice','lsAmount','lsSoc','lsCurrency','lsDeliveryNote','lsTaxInvoice','lsCollectionNote','lsBrinksLoomisLoi','lsPackingList','lsBarList','lsCustomerInvoice','lsTransportationOrder','lsFolderNo','lsConsignee','lsCustomBoe'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
}

function clearLocalShipments() {
  if (!confirm('Clear ALL local shipments? This cannot be undone.')) return;
  safeLocalRemove(LOCAL_SHIPMENTS_STORAGE);
  renderLocalShipments();
  toast('All local shipments cleared', 'success');
}

function exportLocalShipmentsCSV() {
  const list = safeLocalParse(LOCAL_SHIPMENTS_STORAGE, []);
  if (!list.length) { toast('No local shipments to export','error'); return; }
  const headers = ['Invoice No','Supplier/Customer','Product/Brand','Material','Sub Supplier','Amount','SOC','Currency','Delivery Note','Tax Invoice','Collection Note','Brinks/Loomis','Packing List','Bar List','Customer Invoice','Transportation Order','Folder No','Consignee','Custom BOE'];
  const rows = list.map(s => [s.invoiceNo,s.supplierCustomer,s.productBrand,s.material,s.subSupplierInvoice,s.amount,s.soc,s.currency,s.deliveryNote,s.taxInvoice,s.collectionNote,s.brinksLoomisLoi,s.packingList,s.barList,s.customerInvoice,s.transportationOrder,s.folderNo,s.consignee,s.customBoe]);
  const csv = [headers,...rows].map(r=>r.map(c=>'"'+String(c||'').replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob = new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='Local_Shipments_'+new Date().toISOString().slice(0,10)+'.csv';a.click();
  toast('CSV exported','success');
}

function exportLocalShipmentsDOCX() {
  const list = safeLocalParse(LOCAL_SHIPMENTS_STORAGE, []);
  if (!list.length) { toast('No local shipments to export','error'); return; }
  const html = shipmentTableHTML(list, 'Local Shipment Register');
  downloadWordDoc(html, 'Local_Shipments_' + new Date().toISOString().slice(0,10) + '.doc');
  toast('Word export complete','success');
}

function exportLocalShipmentsExcel() {
  const list = safeLocalParse(LOCAL_SHIPMENTS_STORAGE, []);
  if (!list.length) { toast('No local shipments to export','error'); return; }
  const headers = ['Invoice No','Supplier/Customer','Product/Brand','Material','Sub Supplier','Amount','SOC','Currency','Delivery Note','Tax Invoice','Collection Note','Brinks/Loomis','Packing List','Bar List','Customer Invoice','Transportation Order','Folder No','Consignee','Custom BOE'];
  let xml = '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>';
  xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">';
  xml += '<Styles><Style ss:ID="hdr"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#B4975A" ss:Pattern="Solid"/></Style></Styles>';
  xml += '<Worksheet ss:Name="Local Shipments"><Table>';
  xml += '<Row>' + headers.map(h => '<Cell ss:StyleID="hdr"><Data ss:Type="String">' + escHtml(h) + '</Data></Cell>').join('') + '</Row>';
  list.forEach(s => {
    xml += '<Row>';
    [s.invoiceNo,s.supplierCustomer,s.productBrand,s.material,s.subSupplierInvoice,s.amount,s.soc,s.currency,s.deliveryNote,s.taxInvoice,s.collectionNote,s.brinksLoomisLoi,s.packingList,s.barList,s.customerInvoice,s.transportationOrder,s.folderNo,s.consignee,s.customBoe].forEach(v => {
      xml += '<Cell><Data ss:Type="String">' + escHtml(v) + '</Data></Cell>';
    });
    xml += '</Row>';
  });
  xml += '</Table></Worksheet></Workbook>';
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'Local_Shipments_' + new Date().toISOString().slice(0,10) + '.xls'; a.click();
  toast('Excel export complete','success');
}

function exportLocalShipmentsPDF() {
  if (!requireJsPDF()) return;
  const list = safeLocalParse(LOCAL_SHIPMENTS_STORAGE, []);
  if (!list.length) { toast('No local shipments to export','error'); return; }
  const html = shipmentTableHTML(list, 'Local Shipment Register');
  const win = window.open('', '_blank');
  if (!win) { toast('Pop-up blocked — allow pop-ups for this site','error'); return; }
  win.document.write(html + '<script>setTimeout(function(){window.print();},500)<\/script>');
  win.document.close();
  toast('PDF print dialog opened','success');
}

// ======= EMPLOYEE INFO =======
const EMPLOYEE_INFO_STORAGE = 'fgl_employee_info';

function updateBizSelection() {
  const checked = [...document.querySelectorAll('.emp-biz-cb:checked')].map(cb => cb.value);
  const container = document.querySelector('#empBusinessUnit > div:first-child');
  const ph = document.getElementById('empBizPlaceholder');
  // Remove old chips
  container.querySelectorAll('.biz-chip').forEach(c => c.remove());
  if (!checked.length) { ph.style.display=''; return; }
  ph.style.display='none';
  checked.forEach(v => {
    const chip = document.createElement('span');
    chip.className='biz-chip';
    chip.style.cssText='background:rgba(180,151,90,0.15);color:var(--gold);border:1px solid rgba(180,151,90,0.3);border-radius:4px;padding:2px 6px;font-size:10px;white-space:nowrap';
    chip.textContent=v;
    container.appendChild(chip);
  });
}
function getSelectedBizUnits() {
  return [...document.querySelectorAll('.emp-biz-cb:checked')].map(cb => cb.value).join(', ');
}
function setSelectedBizUnits(val) {
  const vals = (val||'').split(',').map(s=>s.trim()).filter(Boolean);
  document.querySelectorAll('.emp-biz-cb').forEach(cb => { cb.checked = vals.includes(cb.value); });
  updateBizSelection();
}
// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
  const dd = document.getElementById('empBizDropdown');
  const bu = document.getElementById('empBusinessUnit');
  if (dd && bu && !bu.contains(e.target)) dd.style.display='none';
});

function saveEmployee() {
  const name = document.getElementById('empName').value.trim();
  if (!name) { toast('Enter employee name','error'); return; }
  const record = {
    id: Date.now(), name,
    dob: document.getElementById('empDOB').value||'',
    nationality: document.getElementById('empNationality').value.trim()||'',
    email: document.getElementById('empEmail').value.trim()||'',
    emiratesId: document.getElementById('empEID').value.trim()||'',
    eidExpiry: document.getElementById('empEIDExpiry').value||'',
    passport: document.getElementById('empPassport').value.trim()||'',
    passportExpiry: document.getElementById('empPassportExpiry').value||'',
    designation: document.getElementById('empDesignation').value.trim()||'',
    joinDate: document.getElementById('empJoinDate').value||'',
    businessUnit: getSelectedBizUnits(),
    createdAt: new Date().toISOString()
  };
  const list = safeLocalParse(EMPLOYEE_INFO_STORAGE, []);
  const existing = list.findIndex(e => e.id === record.id || e.name.toLowerCase() === name.toLowerCase());
  if (existing >= 0) list[existing] = { ...list[existing], ...record, id: list[existing].id };
  else list.unshift(record);
  safeLocalSave(EMPLOYEE_INFO_STORAGE, list);
  logAudit('employee', `Employee saved: ${name}`);
  renderEmployeeDirectory();
  resetEmployeeForm();
  toast(`${name} saved`,'success');
}

function getDocExpiryStatus(expiryDate) {
  if (!expiryDate) return { status: 'none', label: '—', days: null };
  const now = new Date(); now.setHours(0,0,0,0);
  const exp = new Date(expiryDate); exp.setHours(0,0,0,0);
  const diff = Math.ceil((exp - now) / 86400000);
  if (diff < 0) return { status: 'expired', label: `⚠️ EXPIRED (${Math.abs(diff)}d overdue)`, days: diff, color: 'var(--red)', bg: 'rgba(248,81,73,0.12)', border: 'rgba(248,81,73,0.3)' };
  if (diff <= 10) return { status: 'expiring', label: `⚠️ ${diff} DAYS LEFT`, days: diff, color: 'var(--amber)', bg: 'rgba(227,179,65,0.12)', border: 'rgba(227,179,65,0.3)' };
  return { status: 'valid', label: `✅ VALID`, days: diff, color: 'var(--green)', bg: 'rgba(63,185,80,0.12)', border: 'rgba(63,185,80,0.3)' };
}

function renderEmployeeDirectory() {
  let list = safeLocalParse(EMPLOYEE_INFO_STORAGE, []);
  const el = document.getElementById('employeeDirectoryList');
  if (!el) return;
  const q = (document.getElementById('empSearch')?.value||'').toLowerCase().trim();
  if (q) list = list.filter(e => (e.name||'').toLowerCase().includes(q) || (e.designation||'').toLowerCase().includes(q) || (e.businessUnit||'').toLowerCase().includes(q) || (e.nationality||'').toLowerCase().includes(q) || (e.email||'').toLowerCase().includes(q));
  if (!list.length) { el.innerHTML='<p style="font-size:13px;color:var(--muted)">'+(q?'No employees matching "'+escHtml(q)+'"':'No employees added yet.')+'</p>'; return; }
  el.innerHTML = list.map(e => {
    const eidStatus = getDocExpiryStatus(e.eidExpiry);
    const ppStatus = getDocExpiryStatus(e.passportExpiry);
    const hasAlert = eidStatus.status === 'expired' || eidStatus.status === 'expiring' || ppStatus.status === 'expired' || ppStatus.status === 'expiring';
    const hasExpired = eidStatus.status === 'expired' || ppStatus.status === 'expired';

    let docBadges = '';
    if (e.eidExpiry) docBadges += `<span style="display:inline-block;padding:2px 8px;font-size:9px;font-weight:700;background:${eidStatus.bg||'transparent'};color:${eidStatus.color||'var(--muted)'};border:1px solid ${eidStatus.border||'var(--border)'};margin-right:4px">EID: ${eidStatus.label}</span>`;
    if (e.passportExpiry) docBadges += `<span style="display:inline-block;padding:2px 8px;font-size:9px;font-weight:700;background:${ppStatus.bg||'transparent'};color:${ppStatus.color||'var(--muted)'};border:1px solid ${ppStatus.border||'var(--border)'}">PP: ${ppStatus.label}</span>`;

    return `<div class="asana-item" style="cursor:pointer;border-left:3px solid ${hasExpired?'var(--red)':hasAlert?'var(--amber)':'var(--green)'}" data-action="editEmployee" data-arg="${e.id}">
      <div>
        <div class="asana-name">${escHtml(e.name)}</div>
        <div class="asana-meta">${escHtml(e.designation||'—')} | ${escHtml(e.businessUnit||'—')} | ${escHtml(e.nationality||'—')} | Joined: ${escHtml(e.joinDate||'—')}</div>
        <div style="margin-top:4px">${docBadges}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        ${hasExpired?'<span class="badge b-c" style="font-size:10px;padding:3px 8px">⚠️ RENEW</span>':hasAlert?'<span class="badge" style="font-size:10px;padding:3px 8px;background:rgba(227,179,65,0.12);color:var(--amber);border:1px solid rgba(227,179,65,0.3)">⚠️ EXPIRING</span>':'<span class="badge b-ok" style="font-size:10px;padding:3px 8px">✅ ACTIVE</span>'}
        <button class="btn btn-sm btn-red" style="padding:2px 8px;font-size:10px" data-action="_stopAndDeleteEmployee" data-arg="${e.id}">Delete</button>
      </div>
    </div>`;
  }).join('');
}

function editEmployee(id) {
  const list = safeLocalParse(EMPLOYEE_INFO_STORAGE, []);
  const e = list.find(x => x.id === id);
  if (!e) return;
  document.getElementById('empName').value = e.name||'';
  document.getElementById('empDOB').value = e.dob||'';
  document.getElementById('empNationality').value = e.nationality||'';
  document.getElementById('empEmail').value = e.email||'';
  document.getElementById('empEID').value = e.emiratesId||'';
  document.getElementById('empEIDExpiry').value = e.eidExpiry||'';
  document.getElementById('empPassport').value = e.passport||'';
  document.getElementById('empPassportExpiry').value = e.passportExpiry||'';
  document.getElementById('empDesignation').value = e.designation||'';
  document.getElementById('empJoinDate').value = e.joinDate||'';
  setSelectedBizUnits(e.businessUnit||'');
}

function deleteEmployee(id) {
  if (!confirm('Delete this employee record?')) return;
  let list = safeLocalParse(EMPLOYEE_INFO_STORAGE, []);
  list = list.filter(x => x.id !== id);
  safeLocalSave(EMPLOYEE_INFO_STORAGE, list);
  renderEmployeeDirectory();
  toast('Employee deleted', 'success');
}

function resetEmployeeForm() {
  ['empName','empDOB','empNationality','empEmail','empEID','empEIDExpiry','empPassport','empPassportExpiry','empDesignation','empJoinDate'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
  setSelectedBizUnits('');
}

function clearEmployees() {
  if (!confirm('Clear all employee records? This cannot be undone.')) return;
  safeLocalRemove(EMPLOYEE_INFO_STORAGE);
  renderEmployeeDirectory();
  toast('All employee records cleared', 'success');
}

function exportEmployeeCSV() {
  const list = safeLocalParse(EMPLOYEE_INFO_STORAGE, []);
  if (!list.length) { toast('No employees to export','error'); return; }
  const headers = ['Name','Date of Birth','Nationality','Email','Emirates ID','EID Expiry','Passport','Passport Expiry','Designation','Date of Joining','Business Unit'];
  const rows = list.map(e => [e.name, e.dob, e.nationality, e.email, e.emiratesId, e.eidExpiry, e.passport, e.passportExpiry, e.designation, e.joinDate, e.businessUnit]);
  const csv = [headers, ...rows].map(r => r.map(c => '"' + String(c||'').replace(/"/g,'""') + '"').join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'FGL_Employee_Directory.csv'; a.click(); URL.revokeObjectURL(a.href);
  toast('Employee CSV exported', 'success');
}

// ======= DRIVE LINK FIX =======
function openDriveLink() {
  let link = (document.getElementById('driveMainLink').value || '').trim();
  if (!link) { toast('No Drive link saved','error'); return; }
  if (!link.startsWith('http') && !link.startsWith('//')) {
    link = 'https://drive.google.com/drive/folders/' + link.replace(/^\/+/, '');
  }
  window.open(link, '_blank');
}

// ======= TRAINING ATTACHMENTS =======
let trainingAttachments = safeLocalParse('fgl_training_attachments', []);
function attachTrainingFile(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  if (file.size > 5 * 1024 * 1024) { toast('Max 5MB','error'); input.value=''; return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    trainingAttachments.push({ id: Date.now(), name: file.name, data: e.target.result, addedAt: new Date().toISOString() });
    safeLocalSave('fgl_training_attachments', trainingAttachments);
    renderTrainingAttachments();
    toast('File attached: ' + file.name, 'success');
  };
  reader.readAsDataURL(file);
  input.value='';
}
function renderTrainingAttachments() {
  const el = document.getElementById('trainingAttachments');
  if (!el) return;
  el.innerHTML = trainingAttachments.map(a => `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(201,168,76,0.05);border-radius:3px;padding:3px 8px;font-size:10px"><span style="color:var(--gold);cursor:pointer" data-action="downloadGenericAttachment" data-arg="fgl_training_attachments" data-arg2="${a.id}">📎 ${escHtml(a.name)}</span><span style="color:var(--red);cursor:pointer;font-weight:700" data-action="_removeGenericAttachment" data-store-key="fgl_training_attachments" data-attach-id="${a.id}" data-arr-name="trainingAttachments" data-render-fn="renderTrainingAttachments">&times;</span></span>`).join('');
}

// ======= EMPLOYEE ATTACHMENTS & EXPORTS =======
let empAttachments = safeLocalParse('fgl_emp_attachments', []);
function attachEmployeeFile(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  if (file.size > 5 * 1024 * 1024) { toast('Max 5MB','error'); input.value=''; return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    empAttachments.push({ id: Date.now(), name: file.name, data: e.target.result, addedAt: new Date().toISOString() });
    safeLocalSave('fgl_emp_attachments', empAttachments);
    renderEmpAttachments();
    toast('File attached: ' + file.name, 'success');
  };
  reader.readAsDataURL(file);
  input.value='';
}
function renderEmpAttachments() {
  const el = document.getElementById('empAttachments');
  if (!el) return;
  el.innerHTML = empAttachments.map(a => `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(201,168,76,0.05);border-radius:3px;padding:3px 8px;font-size:10px"><span style="color:var(--gold);cursor:pointer" data-action="downloadGenericAttachment" data-arg="fgl_emp_attachments" data-arg2="${a.id}">📎 ${escHtml(a.name)}</span><span style="color:var(--red);cursor:pointer;font-weight:700" data-action="_removeGenericAttachment" data-store-key="fgl_emp_attachments" data-attach-id="${a.id}" data-arr-name="empAttachments" data-render-fn="renderEmpAttachments">&times;</span></span>`).join('');
}
function exportEmployeePDF() {
  if (!requireJsPDF()) return;
  const list = safeLocalParse(EMPLOYEE_INFO_STORAGE, []);
  if (!list.length) { toast('No employees','error'); return; }
  if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') { toast('jsPDF not loaded','error'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('l','mm','a4');
  doc.setFontSize(16); doc.setTextColor(180,151,90); doc.text('Employee Directory', 14, 18);
  doc.setFontSize(9); doc.setTextColor(100); doc.text('Generated: ' + new Date().toLocaleDateString('en-GB'), 14, 24);
  let y = 32;
  const headers = ['Name','Nationality','Email','Emirates ID','Passport','Designation','Joining'];
  doc.setFontSize(7); doc.setTextColor(255);
  doc.setFillColor(30,42,56); doc.rect(14, y, 270, 6, 'F');
  headers.forEach((h, i) => doc.text(h, 16 + i * 38, y + 4));
  y += 8; doc.setTextColor(60);
  list.forEach(e => {
    if (y > 190) { doc.addPage(); y = 20; }
    [e.name, e.nationality, e.email, e.emiratesId, e.passport, e.designation, e.joinDate].forEach((v, i) => doc.text(String(v||'').substring(0,22), 16 + i * 38, y));
    y += 6;
  });
  doc.save('Employee_Directory.pdf');
  toast('PDF exported','success');
}
function exportEmployeeDOCX() {
  const list = safeLocalParse(EMPLOYEE_INFO_STORAGE, []);
  if (!list.length) { toast('No employees','error'); return; }
  let html = wordDocHeader('Employee Directory');
  html += '<table><tr><th>Name</th><th>DOB</th><th>Nationality</th><th>Email</th><th>Emirates ID</th><th>Passport</th><th>Designation</th><th>Joining</th></tr>';
  list.forEach(e => html += `<tr><td>${e.name||''}</td><td>${e.dob||''}</td><td>${e.nationality||''}</td><td>${e.email||''}</td><td>${e.emiratesId||''}</td><td>${e.passport||''}</td><td>${e.designation||''}</td><td>${e.joinDate||''}</td></tr>`);
  html += '</table>' + wordDocFooter();
  downloadWordDoc(html, 'Employee_Directory.doc');
  toast('Word exported','success');
}

// ======= COMPANY ATTACHMENTS & EXPORTS =======
function getCompanyAttachKey() { return typeof scopeKey === 'function' ? scopeKey('fgl_company_attachments') : 'fgl_company_attachments'; }
function getCompanyAttachments() { return safeLocalParse(getCompanyAttachKey(), []); }
function attachCompanyFile(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  if (file.size > 5 * 1024 * 1024) { toast('Max 5MB','error'); input.value=''; return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    const list = getCompanyAttachments();
    list.push({ id: Date.now(), name: file.name, data: e.target.result, addedAt: new Date().toISOString() });
    safeLocalSave(getCompanyAttachKey(), list);
    renderCompanyAttachments();
    toast('File attached: ' + file.name, 'success');
  };
  reader.readAsDataURL(file);
  input.value='';
}
function renderCompanyAttachments() {
  const el = document.getElementById('companyAttachments');
  if (!el) return;
  const key = getCompanyAttachKey();
  const list = getCompanyAttachments();
  el.innerHTML = list.map(a => `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(201,168,76,0.05);border-radius:3px;padding:3px 8px;font-size:10px"><span style="color:var(--gold);cursor:pointer" data-action="downloadGenericAttachment" data-arg="${key}" data-arg2="${a.id}">📎 ${escHtml(a.name)}</span><span style="color:var(--red);cursor:pointer;font-weight:700" data-action="_removeGenericAttachment" data-store-key="${key}" data-attach-id="${a.id}" data-arr-name="" data-render-fn="renderCompanyAttachments">&times;</span></span>`).join('');
}
function exportCompanyPDF() {
  if (!requireJsPDF()) return;
  const company = getActiveCompany();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16); doc.setTextColor(180,151,90); doc.text(company.name, 14, 18);
  doc.setFontSize(10); doc.setTextColor(60); doc.text('Company Profile — Generated: ' + new Date().toLocaleDateString('en-GB'), 14, 26);
  doc.save(company.name.replace(/\s+/g,'_') + '_Profile.pdf');
  toast('PDF exported','success');
}
function exportCompanyDOCX() {
  const company = getActiveCompany();
  let html = wordDocHeader('Company Profile');
  html += '<table><tr><th>Field</th><th>Details</th></tr>';
  html += '<tr><td><b>Company Name</b></td><td>' + escHtml(company.name || '') + '</td></tr>';
  html += '<tr><td><b>Activity</b></td><td>' + escHtml(company.activity || '') + '</td></tr>';
  html += '<tr><td><b>License No.</b></td><td>' + escHtml(company.licenseNo || '') + '</td></tr>';
  html += '<tr><td><b>Location</b></td><td>' + escHtml(company.location || 'Dubai, UAE') + '</td></tr>';
  html += '</table>' + wordDocFooter();
  downloadWordDoc(html, company.name.replace(/\s+/g,'_') + '_Profile.doc');
  toast('Word exported','success');
}
function exportCompanyCSV() {
  const profiles = safeLocalParse('fgl_companies', []);
  if (!profiles.length) { toast('No companies','error'); return; }
  const csv = ['Name'].concat(profiles.map(c => '"' + (c.name||'').replace(/"/g,'""') + '"')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'Company_Profiles.csv'; a.click(); URL.revokeObjectURL(a.href);
  toast('CSV exported','success');
}

// ======= GENERIC ATTACHMENT HELPERS =======
function downloadGenericAttachment(storageKey, id) {
  const list = safeLocalParse(storageKey, []);
  const a = list.find(x => x.id === id);
  if (!a) return;
  const link = document.createElement('a');
  link.href = a.data; link.download = a.name; link.click();
}
function removeGenericAttachment(storageKey, id, varName, renderFn) {
  if (!confirm('Are you sure you want to remove this attachment?')) return;
  let list = safeLocalParse(storageKey, []);
  list = list.filter(x => x.id !== id);
  safeLocalSave(storageKey, list);
  if (varName === 'trainingAttachments') trainingAttachments = list;
  if (varName === 'empAttachments') empAttachments = list;
  if (varName === 'companyAttachments') companyAttachments = list;
  if (typeof window[renderFn] === 'function') window[renderFn]();
  toast('Attachment removed','info');
}

// ======= RACI MATRIX =======
const RACI_STORAGE = 'fgl_raci';
// Pre-seeded RACI activities removed per operator request — the matrix now
// starts empty and every subject is added manually via "+ ADD ACTIVITY".
const RACI_DEFAULT_ACTIVITIES = [];

function renderRACIMatrix() {
  const body = document.getElementById('raciBody');
  if (!body) return;
  let saved = safeLocalParse(RACI_STORAGE + '_draft', null);
  // Detect old format (no sections or desc) and force upgrade
  if (saved && saved.length && !saved.some(r => r.section) && !saved.some(r => r.desc)) {
    safeLocalRemove(RACI_STORAGE + '_draft');
    saved = null;
  }
  const rows = saved || RACI_DEFAULT_ACTIVITIES;
  body.innerHTML = rows.map((r, i) => r.section ? raciSectionHtml(r) : raciRowHtml(r, i)).join('');
}

const RACI_COLORS = {'R':'background:rgba(61,168,118,0.15);color:#3DA876;border:1px solid rgba(61,168,118,0.3)','A':'background:rgba(232,168,56,0.15);color:#E8A838;border:1px solid rgba(232,168,56,0.3)','C':'background:rgba(91,141,239,0.15);color:#5B8DEF;border:1px solid rgba(91,141,239,0.3)','I':'background:rgba(155,89,182,0.15);color:#9B59B6;border:1px solid rgba(155,89,182,0.3)'};
function raciBgFor(v) { return RACI_COLORS[v]||''; }

function raciSectionHtml(r) {
  return `<tr class="raci-section" data-section="${escHtml(r.section)}"><td colspan="7" style="padding:10px 8px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--gold);font-family:'Montserrat',sans-serif;background:rgba(201,168,76,0.05);border-bottom:2px solid var(--gold)">${escHtml(r.section)}</td></tr>`;
}

window.raciColorChange = function(el) {
  var c = {R:'background:rgba(61,168,118,0.15);color:#3DA876;border:1px solid rgba(61,168,118,0.3)',A:'background:rgba(232,168,56,0.15);color:#E8A838;border:1px solid rgba(232,168,56,0.3)',C:'background:rgba(91,141,239,0.15);color:#5B8DEF;border:1px solid rgba(91,141,239,0.3)',I:'background:rgba(155,89,182,0.15);color:#9B59B6;border:1px solid rgba(155,89,182,0.3)'};
  el.style.cssText='width:32px;text-align:center;font-weight:700;font-size:10px;padding:1px;border-radius:3px;'+(c[el.value]||'');
};
function raciRowHtml(r, i) {
  const opts = v => ['','R','A','C','I'].map(o => `<option value="${o}"${v===o?' selected':''}>${o}</option>`).join('');
  const sel = (cls, v) => `<select class="${cls}" style="width:32px;text-align:center;font-weight:700;font-size:10px;padding:1px;border-radius:3px;${raciBgFor(v)}" data-change="_raciColorChangeFromEvent">${opts(v)}</select>`;
  return `<tr>
    <td style="padding:4px 6px;border-bottom:1px solid var(--border);vertical-align:middle"><input type="text" class="raci-activity" value="${escHtml(r.activity||'')}" style="width:100%;border:none;background:transparent;font-size:10px;font-weight:500" title="${escHtml(r.activity||'')}" /></td>
    <td style="padding:2px;border-bottom:1px solid var(--border);text-align:center;vertical-align:middle">${sel('raci-cm',r.cm)}</td>
    <td style="padding:2px;border-bottom:1px solid var(--border);text-align:center;vertical-align:middle">${sel('raci-md',r.md)}</td>
    <td style="padding:2px;border-bottom:1px solid var(--border);text-align:center;vertical-align:middle">${sel('raci-fin',r.fin)}</td>
    <td style="padding:2px;border-bottom:1px solid var(--border);text-align:center;vertical-align:middle">${sel('raci-ops',r.ops)}</td>
    <td style="padding:4px 6px;border-bottom:1px solid var(--border);vertical-align:top"><div class="raci-desc" contenteditable="true" style="font-size:9px;color:var(--muted);line-height:1.4;max-height:120px;overflow-y:auto;outline:none;word-break:break-word">${escHtml(r.desc||'')}</div></td>
    <td style="padding:2px;border-bottom:1px solid var(--border);text-align:center;vertical-align:middle;width:28px"><button style="background:var(--red);color:#fff;border:none;border-radius:3px;width:20px;height:20px;font-size:10px;cursor:pointer;line-height:1" data-action="_removeClosestTr">X</button></td>
  </tr>`;
}

function exportRACIDOCX() {
  const rows = collectRACIRows();
  if (!rows.length) { toast('No activities to export','error'); return; }
  const roles = { cm: document.getElementById('raciCM')?.value||'Compliance Dept.', md: document.getElementById('raciMD')?.value||'Managing Director', fin: document.getElementById('raciFIN')?.value||'Finance Dept.', ops: document.getElementById('raciOPS')?.value||'Operations Dept.' };
  const docRef = document.getElementById('raciDocRef')?.value?.trim()||'';
  const effDate = document.getElementById('raciEffDate')?.value||'';
  const colorFor = v => ({R:'#3DA876',A:'#E8A838',C:'#5B8DEF',I:'#9B59B6'}[v]||'#888');
  const company = typeof getActiveCompany === 'function' ? getActiveCompany() : {};
  const headerColor = getCompanyDocColor(company.id || 'company-5');
  let html = wordDocHeader('RACI Matrix — Compliance Roles and Responsibilities', '.sec{background:' + headerColor + ';color:#fff;font-weight:700;font-size:7pt;text-transform:uppercase;letter-spacing:0.5pt;padding:4pt 6pt}');
  if (docRef||effDate) html += '<p class="meta">' + (docRef?docRef:'') + (effDate?' | Effective: '+effDate:'') + '</p>';
  html += '<p class="meta">CM = '+roles.cm+' | MD = '+roles.md+' | FIN = '+roles.fin+' | OPS = '+roles.ops+'</p>';
  html += '<table><tr><th>Activity / Obligation</th><th>CM</th><th>MD</th><th>FIN</th><th>OPS</th><th>Core Responsibilities</th></tr>';
  rows.forEach(r => {
    if (r.section) { html += '<tr><td colspan="6" class="sec">'+escHtml(r.section)+'</td></tr>'; return; }
    html += '<tr><td>'+escHtml(r.activity||'')+'</td>';
    ['cm','md','fin','ops'].forEach(k => { const v=r[k]||''; html += '<td style="text-align:center;font-weight:700;color:'+colorFor(v)+'">'+v+'</td>'; });
    html += '<td style="font-size:6.5pt;color:#666">'+escHtml(r.desc||'')+'</td></tr>';
  });
  html += '</table>' + wordDocFooter();
  downloadWordDoc(html, 'RACI_Matrix_'+new Date().toISOString().slice(0,10)+'.doc');
  toast('Word exported','success');
}

// ======= RACI ATTACHMENTS =======
let raciAttachments = safeLocalParse('fgl_raci_attachments', []);

function attachRACIFile(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  if (file.size > 5 * 1024 * 1024) { toast('File too large (max 5MB)', 'error'); input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    raciAttachments.push({ id: Date.now(), name: file.name, size: file.size, type: file.type, data: e.target.result, addedAt: new Date().toISOString() });
    safeLocalSave('fgl_raci_attachments', raciAttachments);
    renderRACIAttachments();
    toast('File attached: ' + file.name, 'success');
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function renderRACIAttachments() {
  const el = document.getElementById('raciAttachments');
  if (!el) return;
  if (!raciAttachments.length) { el.innerHTML = ''; return; }
  el.innerHTML = raciAttachments.map(a => `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(201,168,76,0.05);border-radius:3px;padding:3px 8px;font-size:10px;margin:2px">
    <span style="color:var(--gold);cursor:pointer" data-action="downloadRACIAttachment" data-arg="${a.id}" title="Download">📎 ${escHtml(a.name)}</span>
    <span style="color:var(--red);cursor:pointer;font-weight:700" data-action="removeRACIAttachment" data-arg="${a.id}" title="Remove">&times;</span>
  </span>`).join('');
}

function downloadRACIAttachment(id) {
  const a = raciAttachments.find(x => x.id === id);
  if (!a) return;
  const link = document.createElement('a');
  link.href = a.data;
  link.download = a.name;
  link.click();
}

function removeRACIAttachment(id) {
  if (!confirm('Are you sure you want to remove this attachment?')) return;
  raciAttachments = raciAttachments.filter(x => x.id !== id);
  safeLocalSave('fgl_raci_attachments', raciAttachments);
  renderRACIAttachments();
  toast('Attachment removed', 'info');
}

// Init render on tab switch
document.addEventListener('DOMContentLoaded', function() { setTimeout(renderRACIAttachments, 500); });

function exportRACICSV() {
  const rows = collectRACIRows();
  if (!rows.length) { toast('No activities to export','error'); return; }
  const headers = ['Section','Activity / Obligation','CM','MD','FIN','OPS','Core Responsibilities'];
  let currentSection = '';
  const csvRows = rows.map(r => {
    if (r.section) { currentSection = r.section; return null; }
    return [currentSection, r.activity||'', r.cm||'', r.md||'', r.fin||'', r.ops||'', r.desc||''];
  }).filter(Boolean);
  const csv = [headers,...csvRows].map(r=>r.map(c=>'"'+String(c||'').replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob = new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='RACI_Matrix_'+new Date().toISOString().slice(0,10)+'.csv';a.click();
  toast('CSV exported','success');
}

function addRACIRow(activity, cm, md, fin, ops, desc) {
  const body = document.getElementById('raciBody');
  if (!body) return;
  const i = body.children.length;
  body.insertAdjacentHTML('beforeend', raciRowHtml({ activity:activity||'', cm:cm||'', md:md||'', fin:fin||'', ops:ops||'', desc:desc||'' }, i));
}

function toggleAddActivityForm() {
  const form = document.getElementById('addActivityForm');
  if (!form) return;
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
  if (form.style.display === 'block') {
    document.getElementById('newRaciActivity').value = '';
    document.getElementById('newRaciCM').value = '';
    document.getElementById('newRaciMD').value = '';
    document.getElementById('newRaciFIN').value = '';
    document.getElementById('newRaciOPS').value = '';
    document.getElementById('newRaciDesc').value = '';
    ['newRaciCM','newRaciMD','newRaciFIN','newRaciOPS'].forEach(id => { const el = document.getElementById(id); if (el) el.style.cssText = ''; });
    document.getElementById('newRaciActivity').focus();
  }
}

function submitNewActivity() {
  const activity = document.getElementById('newRaciActivity')?.value?.trim() || '';
  if (!activity) { toast('Activity / Obligation name is required', 'error'); return; }
  const cm = document.getElementById('newRaciCM')?.value || '';
  const md = document.getElementById('newRaciMD')?.value || '';
  const fin = document.getElementById('newRaciFIN')?.value || '';
  const ops = document.getElementById('newRaciOPS')?.value || '';
  const desc = document.getElementById('newRaciDesc')?.value?.trim() || '';
  addRACIRow(activity, cm, md, fin, ops, desc);
  toggleAddActivityForm();
  toast('Activity added to matrix', 'success');
}

function collectRACIRows() {
  const rows = [];
  document.querySelectorAll('#raciBody tr').forEach(tr => {
    if (tr.classList.contains('raci-section')) {
      rows.push({ section: tr.dataset.section||'' });
    } else {
      rows.push({
        activity: tr.querySelector('.raci-activity')?.value?.trim()||'',
        cm: tr.querySelector('.raci-cm')?.value||'',
        md: tr.querySelector('.raci-md')?.value||'',
        fin: tr.querySelector('.raci-fin')?.value||'',
        ops: tr.querySelector('.raci-ops')?.value||'',
        desc: (tr.querySelector('.raci-desc')?.value ?? tr.querySelector('.raci-desc')?.textContent ?? '').trim()
      });
    }
  });
  return rows.filter(r => r.section || r.activity);
}

function saveRACIMatrix() {
  const rows = collectRACIRows();
  if (!rows.length) { toast('Add at least one activity','error'); return; }
  const record = {
    id: Date.now(),
    docRef: document.getElementById('raciDocRef')?.value?.trim()||'',
    effDate: document.getElementById('raciEffDate')?.value||'',
    roles: { cm: document.getElementById('raciCM')?.value||'Compliance Dept.', md: document.getElementById('raciMD')?.value||'Managing Director', fin: document.getElementById('raciFIN')?.value||'Finance Dept.', ops: document.getElementById('raciOPS')?.value||'Operations Dept.' },
    rows,
    date: new Date().toISOString()
  };
  const list = safeLocalParse(RACI_STORAGE, []);
  list.unshift(record);
  safeLocalSave(RACI_STORAGE, list);
  safeLocalSave(RACI_STORAGE + '_draft', rows);
  logAudit('raci', `RACI Matrix saved: ${record.docRef || 'No ref'} with ${rows.length} activities`);
  loadRACIHistory();
  toast('RACI Matrix saved','success');
}

function loadRACIHistory() {
  const list = safeLocalParse(RACI_STORAGE, []);
  const el = document.getElementById('raciHistoryList');
  if (!el) return;
  if (!list.length) { el.innerHTML='<p style="font-size:13px;color:var(--muted)">No RACI records saved yet.</p>'; return; }
  el.innerHTML = list.map(r => `<div class="asana-item"><div><div class="asana-name">${escHtml(r.docRef||'RACI Matrix')}</div><div class="asana-meta">${r.rows.length} activities | ${escHtml(r.effDate||'No date')} | Saved: ${new Date(r.date).toLocaleDateString('en-GB')}</div></div><span class="badge b-ok">SAVED</span></div>`).join('');
}

function clearRACIMatrix() {
  if (!confirm('Clear all saved RACI records? This cannot be undone.')) return;
  safeLocalRemove(RACI_STORAGE);
  safeLocalRemove(RACI_STORAGE + '_draft');
  renderRACIMatrix();
  loadRACIHistory();
  toast('RACI records cleared', 'success');
}

function exportRACIPDF() {
  if (!requireJsPDF()) return;
  const rows = collectRACIRows();
  if (!rows.length) { toast('No activities to export','error'); return; }
  const doc = new jspdf.jsPDF('landscape');
  const pageW = doc.internal.pageSize.getWidth();
  const docRef = document.getElementById('raciDocRef')?.value?.trim()||'';
  const effDate = document.getElementById('raciEffDate')?.value||'';
  const roles = { cm: document.getElementById('raciCM')?.value||'Compliance Dept.', md: document.getElementById('raciMD')?.value||'Managing Director', fin: document.getElementById('raciFIN')?.value||'Finance Dept.', ops: document.getElementById('raciOPS')?.value||'Operations Dept.' };

  doc.setFontSize(14); doc.setTextColor(180,151,90);
  doc.text('RACI Matrix - Compliance Roles and Responsibilities', 14, 18);
  doc.setFontSize(8); doc.setTextColor(80);
  if (docRef) doc.text(docRef + (effDate ? ' | Effective: ' + effDate : ''), 14, 24);
  doc.text('CM = ' + roles.cm + '   MD = ' + roles.md + '   FIN = ' + roles.fin + '   OPS = ' + roles.ops, 14, 29);

  const colorFor = v => { if(v==='R') return [39,174,96]; if(v==='A') return [232,168,56]; if(v==='C') return [91,141,239]; if(v==='I') return [155,89,182]; return [120,120,120]; };
  let y = 36;
  // Column header
  function drawHeader() {
    doc.setFillColor(40,40,40); doc.rect(14, y-4, pageW-28, 7, 'F');
    doc.setTextColor(180,151,90); doc.setFontSize(7);
    doc.text('Activity / Obligation', 16, y); doc.text('CM', 120, y); doc.text('MD', 130, y); doc.text('FIN', 140, y); doc.text('OPS', 150, y); doc.text('Core Responsibilities', 160, y);
    y += 6;
  }
  drawHeader();

  rows.forEach(r => {
    if (r.section) {
      if (y > 180) { doc.addPage(); y = 16; drawHeader(); }
      doc.setFillColor(50,50,50); doc.rect(14, y-4, pageW-28, 7, 'F');
      doc.setTextColor(180,151,90); doc.setFontSize(8); doc.setFont(undefined,'bold');
      doc.text(r.section.toUpperCase(), 16, y);
      doc.setFont(undefined,'normal');
      y += 7;
    } else {
      const actLines = doc.splitTextToSize(r.activity||'', 100);
      const descLines = doc.splitTextToSize(r.desc||'', 120);
      const lineH = Math.max(actLines.length, descLines.length) * 3.2 + 3;
      if (y + lineH > 190) { doc.addPage(); y = 16; drawHeader(); }
      doc.setFontSize(7); doc.setTextColor(40);
      doc.text(actLines, 16, y);
      [['cm',120],['md',130],['fin',140],['ops',150]].forEach(([k,x]) => {
        if (r[k]) { const c = colorFor(r[k]); doc.setTextColor(c[0],c[1],c[2]); doc.setFont(undefined,'bold'); doc.text(r[k], x, y); doc.setFont(undefined,'normal'); }
      });
      doc.setTextColor(80); doc.text(descLines, 160, y);
      y += lineH;
    }
  });

  // Footer on all pages
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(6); doc.setTextColor(140);
    doc.text('Confidential | FGL Hawkeye Sterling V2 | RACI Matrix | Page ' + p + '/' + totalPages, 14, 200);
  }
  doc.save('FGL_RACI_Matrix.pdf');
  toast('RACI PDF exported', 'success');
}

// ======= ONBOARDING (CDD/EDD + Risk Scoring) =======
const ONBOARDING_STORAGE = 'fgl_onboarding';
let obUboCount = 0;

function addObUboRow(name, shares, findings) {
  obUboCount++;
  const row = document.createElement('div');
  row.className = 'row';
  row.style.cssText = 'margin-bottom:8px;display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:end';
  row.id = 'obUboRow' + obUboCount;
  row.innerHTML = `
    <div><span class="lbl">Name ${obUboCount}</span><input type="text" class="ob-ubo-name" placeholder="Full name" value="${escHtml(name||'')}"/></div>
    <div><span class="lbl">Shares %</span><input type="number" class="ob-ubo-shares" placeholder="0" value="${shares||''}"/></div>
    <div><span class="lbl">Findings</span><select class="ob-ubo-findings"><option value="">Select</option><option value="Clear"${findings==='Clear'?' selected':''}>Clear</option><option value="Match"${findings==='Match'?' selected':''}>Match</option><option value="Potential Match"${findings==='Potential Match'?' selected':''}>Potential Match</option><option value="PEP"${findings==='PEP'?' selected':''}>PEP</option><option value="Adverse Media"${findings==='Adverse Media'?' selected':''}>Adverse Media</option></select></div>
    <button class="btn btn-sm btn-red" style="height:36px" data-action="_removeParentElement">X</button>`;
  document.getElementById('obUboContainer').appendChild(row);
}

function collectObUbos() {
  const ubos = [];
  document.querySelectorAll('#obUboContainer .row').forEach(row => {
    const name = row.querySelector('.ob-ubo-name')?.value?.trim();
    if (name) ubos.push({ name, shares: row.querySelector('.ob-ubo-shares')?.value||'', findings: row.querySelector('.ob-ubo-findings')?.value||'' });
  });
  return ubos;
}

function calculateRiskScore() {
  const country = document.getElementById('obCountry').value.trim().toLowerCase();
  const isPEP = document.getElementById('obPEP').checked;
  const isCAHRA = document.getElementById('obCAHRA').checked;
  const turnover = parseFloat(document.getElementById('obTurnover').value)||0;
  const override = document.getElementById('obRiskOverride').value;

  let score = 0;
  const factors = [];

  const highRiskCountries = ['iran','north korea','dprk','syria','yemen','myanmar','afghanistan','libya','iraq','sudan','somalia','south sudan','congo','mali','central african republic'];
  if (highRiskCountries.some(c=>country.includes(c))) { score+=40; factors.push('High-risk country'); }
  if (isPEP) { score+=30; factors.push('PEP/PEP-related'); }
  if (isCAHRA) { score+=25; factors.push('CAHRA jurisdiction'); }
  if (turnover>1000000) { score+=15; factors.push('High turnover (>$1M)'); }
  if (turnover>5000000) { score+=10; factors.push('Very high turnover (>$5M)'); }

  const docs = document.querySelectorAll('.ob-doc');
  let docsCollected = 0;
  docs.forEach(d=>{ if(d.checked) docsCollected++; });
  if (docsCollected < 4) { score+=15; factors.push(`Incomplete documentation (${docsCollected}/${docs.length})`); }

  let level = score>=60?'CRITICAL':score>=40?'HIGH':score>=20?'MEDIUM':'LOW';
  if (override!=='auto' && ['LOW','MEDIUM','HIGH','CRITICAL'].includes(override.toUpperCase())) level = override.toUpperCase();

  const cls = level==='CRITICAL'||level==='PROHIBITED'?'f-critical':level==='HIGH'?'f-high':level==='MEDIUM'?'f-medium':'f-ok';
  const badge = level==='CRITICAL'||level==='PROHIBITED'?'b-c':level==='HIGH'?'b-h':level==='MEDIUM'?'b-m':'b-ok';
  const edd = level==='HIGH'||level==='CRITICAL'?'<div class="rec" style="margin-top:8px"><strong>EDD Required:</strong> Enhanced Due Diligence must be performed. Senior management approval needed.</div>':'';

  document.getElementById('riskScoreResult').style.display='block';
  document.getElementById('riskScoreResult').innerHTML = `
    <div class="finding ${cls}" style="animation:none;opacity:1">
      <div class="f-head"><div class="f-head-left"><span class="badge ${badge}">RISK: ${level}</span><span class="f-title">Score: ${score}/100</span></div></div>
      <div class="f-body"><strong>Risk Factors:</strong> ${factors.length?escHtml(factors.join(', ')):'No elevated risk factors identified'}</div>
      <div class="f-body" style="margin-top:6px"><strong>CDD Level:</strong> ${level==='LOW'?'Simplified':'Standard'} Due Diligence ${level==='HIGH'||level==='CRITICAL'?'+ Enhanced Due Diligence':''}${level==='CRITICAL'?' + Senior Management Approval':''}</div>
      ${edd}
    </div>`;
  return { score, level, factors };
}

function completeOnboarding() {
  const name = document.getElementById('obName').value.trim();
  if (!name) { toast('Enter customer name','error'); return; }
  if (!document.getElementById('obCountry').value.trim()) { toast('Enter country','error'); return; }
  if (!document.getElementById('obActivity').value.trim()) { toast('Enter business activity','error'); return; }
  const risk = calculateRiskScore();
  const docs = []; document.querySelectorAll('.ob-doc').forEach(d=>{ if(d.checked) docs.push(d.dataset.doc); });

  const record = {
    id: Date.now(), name, type: document.getElementById('obType').value,
    country: document.getElementById('obCountry').value.trim(),
    activity: document.getElementById('obActivity').value.trim(),
    turnover: document.getElementById('obTurnover').value,
    sourceFunds: '',
    sourceWealth: '',
    ubos: collectObUbos(),
    isPEP: document.getElementById('obPEP').checked,
    isCAHRA: document.getElementById('obCAHRA').checked,
    officer: document.getElementById('obOfficer').value.trim(),
    notes: document.getElementById('obNotes').value.trim(),
    docs, risk, date: new Date().toISOString(), status: 'active'
  };

  const list = safeLocalParse(ONBOARDING_STORAGE, []);
  list.unshift(record);
  safeLocalSave(ONBOARDING_STORAGE, list);
  logAudit('onboarding', `Onboarded ${name} — Risk: ${risk.level}`);
  renderOnboardingList();
  toast(`${name} onboarded — ${risk.level} risk`,'success');
  // Asana sync — create CDD task
  const dueDays = risk.level === 'HIGH' ? 7 : risk.level === 'MEDIUM' ? 14 : 30;
  autoSyncToAsana(
    `CDD: ${name} — ${risk.level} Risk Onboarding`,
    `New customer onboarded.\nEntity: ${name}\nType: ${record.type}\nCountry: ${record.country}\nActivity: ${record.activity}\nRisk Level: ${risk.level} (Score: ${risk.score})\nPEP: ${record.isPEP?'Yes':'No'} | CAHRA: ${record.isCAHRA?'Yes':'No'}\nOfficer: ${record.officer}\n\nAction Required: Complete CDD file, verify documents, set up ongoing monitoring.`,
    dueDays
  ).then(gid => { if (gid) toast('Asana task created for onboarding','success',2000); });
}

function renderOnboardingList() {
  const list = safeLocalParse(ONBOARDING_STORAGE, []);
  const el = document.getElementById('onboardingList');
  if (!list.length) { el.innerHTML='<p style="font-size:13px;color:var(--muted)">No customers onboarded yet.</p>'; return; }
  el.innerHTML = list.map(c=>{
    const badge = c.risk.level==='CRITICAL'?'b-c':c.risk.level==='HIGH'?'b-h':c.risk.level==='MEDIUM'?'b-m':'b-ok';
    return `<div class="asana-item"><div><div class="asana-name">${escHtml(c.name)}</div><div class="asana-meta">${escHtml(c.type)} | ${escHtml(c.country)} | ${new Date(c.date).toLocaleDateString('en-GB')} | Score: ${c.risk.score}</div></div><span class="badge ${badge}">${escHtml(c.risk.level)}</span></div>`;
  }).join('');
}

function resetOnboarding() {
  ['obName','obCountry','obActivity','obTurnover','obOfficer','obNotes'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  document.getElementById('obPEP').checked=false; document.getElementById('obCAHRA').checked=false;
  document.querySelectorAll('.ob-doc').forEach(d=>d.checked=false);
  document.getElementById('obUboContainer').innerHTML=''; obUboCount=0;
  document.getElementById('riskScoreResult').style.display='none';
}

// ======= STR GENERATOR =======
async function generateSTRDraft() {
  const subject = document.getElementById('strSubject').value.trim();
  const amount = document.getElementById('strAmount').value;
  const indicators = document.getElementById('strIndicators').value.trim();
  if (!subject||!indicators) { toast('Fill in subject and indicators','error'); return; }

  try {
    const data = await callAI({ model:'claude-haiku-4-5', max_tokens:2000, temperature:0,
      system:'You are a UAE AML compliance expert. Draft a Suspicious Transaction Report (STR) for goAML filing. Include all required fields: reporter info placeholders, subject details, transaction details, grounds for suspicion, and recommended actions. Format as a professional report.',
      messages:[{role:'user',content:`Draft STR for:\nSubject: ${subject}\nAmount: USD ${amount||'Unknown'}\nSuspicious Indicators: ${indicators}`}]
    });
    const text = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
    var strMissing = typeof validateSTRDraft === 'function' ? validateSTRDraft(text) : [];
    var strWarning = strMissing.length ? '<div style="margin-top:8px;padding:10px;border-radius:3px;background:var(--red-dim);border:1px solid rgba(217,79,79,0.3);font-size:11px;color:var(--red)"><strong>Missing mandatory fields:</strong> ' + strMissing.join(', ') + '<br>Review and add these before goAML submission.</div>' : '<div style="margin-top:8px;padding:10px;border-radius:3px;background:var(--green-dim);border:1px solid rgba(61,168,118,0.3);font-size:11px;color:var(--green)">All mandatory STR fields detected.</div>';
    document.getElementById('strDraftResult').style.display='block';
    document.getElementById('strDraftResult').innerHTML = `<div class="summary-box" style="white-space:pre-wrap;font-size:12px">${escHtml(text)}</div>${strWarning}<div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-sm btn-green" data-action="copySTR">Copy STR</button></div>`;
    logAudit('str', `STR drafted for ${subject}`);
  } catch(e) { if(isBillingError(e)){toast('API credits exhausted — STR generation unavailable. Add credits at console.anthropic.com.','info',8000)}else{toast(`STR error: ${e.message}`,'error')} }
}
function copySTR() { const t=document.querySelector('#strDraftResult .summary-box'); if(t){navigator.clipboard.writeText(t.textContent);toast('STR copied','success');} }
function generateSTR() { switchTab('incidents'); document.getElementById('strSubject').focus(); }

async function generateSTRFromOnboarding() {
  const name = document.getElementById('obName').value.trim();
  const type = document.getElementById('obType').value;
  const country = document.getElementById('obCountry').value.trim();
  const revenue = document.getElementById('obRevenue').value.trim();
  const isPEP = document.getElementById('obPEP').checked;
  const isCAHRA = document.getElementById('obCAHRA').checked;
  const officer = document.getElementById('obOfficer').value.trim();
  const notes = document.getElementById('obNotes').value.trim();
  if (!name) { toast('Enter customer name before generating STR draft', 'error'); return; }

  const riskOverride = document.getElementById('obRiskOverride')?.value || 'auto';
  const sanctions = document.getElementById('obSanctionsClear')?.checked ? 'Clear' : 'Not screened';

  const prompt = `Draft a Suspicious Transaction Report (STR) for goAML UAE filing based on this customer onboarding data:
Customer Name: ${name}
Entity Type: ${type}
Country: ${country || 'Not specified'}
Annual Revenue: ${revenue || 'Not specified'}
PEP Status: ${isPEP ? 'YES — Politically Exposed Person' : 'No'}
High-Risk Jurisdiction (CAHRA): ${isCAHRA ? 'YES' : 'No'}
Sanctions Screening: ${sanctions}
Risk Rating: ${riskOverride}
Onboarding Officer: ${officer || 'Not specified'}
Notes: ${notes || 'None'}

Include: reporter info placeholders, subject details, grounds for suspicion based on risk indicators, transaction patterns to monitor, and recommended actions. Format as a professional STR report ready for goAML submission.`;

  try {
    toast('Generating STR draft...', 'info');
    const data = await callAI({ model:'claude-haiku-4-5', max_tokens:1024, temperature:0,
      system:'You are a UAE AML/CFT compliance expert specializing in STR/SAR drafting for goAML. Generate professional, detailed Suspicious Transaction Reports aligned with UAE Central Bank and FIU requirements under Federal Decree-Law No. 20/2018.',
      messages:[{role:'user',content:prompt}]
    });
    const text = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
    const resultDiv = document.getElementById('riskScoreResult');
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<div style="margin-top:12px"><span class="sec-title" style="color:var(--amber)">STR Draft — ' + escHtml(name) + '</span>' +
      '<div class="summary-box" style="white-space:pre-wrap;font-size:12px;max-height:400px;overflow-y:auto">' + escHtml(text) + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:8px">' +
      '<button class="btn btn-sm btn-green" data-action="_copyClosestSummaryBox">Copy STR</button>' +
      '<button class="btn btn-sm btn-blue" data-action="_downloadStrDraft" data-name="' + escHtml(name) + '">Download</button>' +
      '</div></div>';
    logAudit('str', 'STR draft generated from onboarding for ' + name);
    toast('STR draft generated', 'success');
  } catch(e) { if(isBillingError(e)){toast('API credits exhausted — STR generation unavailable. Add credits at console.anthropic.com.','info',8000)}else{toast('STR error: ' + e.message, 'error')} }
}

function copyElText(el) { if(el){navigator.clipboard.writeText(el.textContent);toast('Copied to clipboard','success');} }

function downloadStrDraft(name) {
  const el = document.querySelector('#riskScoreResult .summary-box');
  if (!el) return;
  const blob = new Blob([el.textContent], {type:'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'STR_Draft_' + name.replace(/[^a-zA-Z0-9]/g,'_') + '_' + new Date().toISOString().split('T')[0] + '.txt';
  a.click();
  toast('STR draft downloaded','success');
}
function generateSTRFromIncident() {
  document.getElementById('strSubject').value = document.getElementById('incTitle').value;
  document.getElementById('strIndicators').value = document.getElementById('incDescription').value;
  document.getElementById('strSubject').scrollIntoView({behavior:'smooth'});
}

// ======= RISK ASSESSMENT =======
const RA_STORAGE = 'fgl_risk_assessments';
const RA_COUNTRY_SCORES={"Åland Islands":1,"Svalbard and Mayen":1,"Tokelau":1,"Finland":1,"Faroe islands":1,"Iceland":1,"Norway":1,"Denmark":1,"Greenland":1,"San Marino":1,"Sweden":1,"Estonia":1,"Vatican City State (Holy See)":1,"Lithuania":1,"Andorra":1,"Bermuda":1,"New Zealand":1,"Liechtenstein":1,"Christmas Island":1,"Cocos (Keeling) Islands":1,"Norfolk Island":1,"French Polynesia":1,"Mayotte":1,"New Caledonia":1,"Saint Berthélemy":1,"Saint Martin (French part)":1,"Saint Pierre and Miquelon":1,"Wallis and Futuna":1,"Brunei Darussalam":1,"British Indian Ocean Territory":1,"Falkland Islands (Malvinas)":1,"French Guiana":1,"Pitcairn":1,"Saint Helena, Ascension and Tristan":1,"Guadeloupe":1,"Martinique":1,"Réunion":1,"Latvia":1,"Portugal":1,"Singapore":1,"Bonaire, Sint Eustatius and Saba":1,"South Korea":1,"Uruguay":1,"Puerto Rico":1,"Oman":1,"Australia":1,"Guernsey":1,"Austria":1,"Japan":1,"Bhutan":1,"Czech Republic":1,"Macau":1,"Isle of Man":1,"Belgium":1,"Poland":1,"Luxembourg":1,"Jersey":1,"Ireland":1,"Germany":1,"American Samoa":1,"France":1,"North Mariana Islands":1,"Switzerland":1,"Cook Islands":1,"Guam":1,"Spain":1,"Taiwan":1,"Canada":1,"United States Virgin Islands":1,"Qatar":1,"Saudi Arabia":1,"United Kingdom":1,"Italy":1,"Chile":1,"United States":1,"Bahrain":1,"El Salvador":1,"United Arab Emirates":1,"Mauritius":1,"Slovenia":1,"Malawi":2,"Mongolia":2,"Fiji":2,"Malta":2,"Georgia":2,"Slovakia":2,"Solomon Islands":2,"Mauritania":2,"Gambia":2,"Aruba":2,"Marshall Islands":2,"Cape Verde":2,"Niue":2,"Tonga":2,"Romania":2,"Greece":2,"Costa Rica":2,"Nauru":2,"Lesotho":2,"Montserrat":2,"Ghana":2,"Timor-Leste":2,"Dominican Republic":2,"Kazakhstan":2,"Anguilla":2,"Hong Kong":2,"Uzbekistan":2,"Antigua and Barbuda":2,"Grenada":2,"Micronesia":2,"South Africa":2,"Sri Lanka":2,"Maldives":2,"Cyprus":2,"Samoa":2,"Tuvalu":2,"Argentina":2,"Palau":2,"Suriname":2,"Congo (Brazzaville)":2,"Croatia":2,"St Kitts & Nevis":2,"Sao Tome & Prin.":2,"North Macedonia":2,"Serbia":2,"Comoros":2,"Montenegro":2,"Djibouti":2,"Indonesia":2,"Azerbaijan":2,"Ecuador":2,"Belarus":2,"Dominica":2,"India":2,"Thailand":2,"Tunisia":2,"China":2,"Israel":2,"Brazil":2,"St Maarten":2,"Gibraltar":2,"Bosnia-Herzegovina":2,"Cayman Islands":2,"Vanuatu":2,"Trinidad & Tobago":2,"Jamaica":2,"Morocco":2,"Western Sahara":2,"Seychelles":2,"Peru":2,"Egypt":2,"Guyana":2,"St Lucia":2,"Armenia":2,"Malaysia":2,"Moldova":2,"Bangladesh":2,"Turkey":2,"Barbados":2,"Jordan":2,"Panama":2,"Tanzania":2,"Hungary":2,"West Bank (Palestinian Territory, Occupied)":3,"Gaza Strip":3,"Namibia":3,"Botswana":3,"Kuwait":3,"Zambia":3,"Rwanda":3,"Monaco":3,"Bulgaria":3,"Togo":3,"Eswatini":3,"Kyrgyzstan":3,"Madagascar":3,"Guatemala":3,"Papua New Guinea":3,"Gabon":3,"Honduras":3,"Equatorial Guinea":3,"Algeria":3,"Mexico":3,"Bolivia":3,"Ethiopia":3,"Liberia":3,"Nigeria":3,"Guinea":3,"Sudan":3,"Cambodia":3,"Kenya":3,"Ukraine":3,"Eritrea":3,"Senegal":3,"Kosovo":3,"Cuba":3,"Uganda":3,"Burkina Faso":3,"Guinea Bissau":3,"Central African Republic":3,"Pakistan":3,"Venezuela":3,"Zimbabwe":3,"Lebanon":3,"Burundi":3,"Iraq":3,"Nicaragua":3,"Philippines":3,"Russian Federation":3,"Mozambique":3,"Libya":3,"Haiti":3,"South Sudan":3,"Somalia":3,"Mali":3,"Yemen":3,"The Democratic Republic Of Congo":3,"Syria":3,"Myanmar":3,"Afghanistan":3,"North Korea":3,"Islamic Republic of Iran":3,"Angola":3,"Turkmenistan":3,"Paraguay":3,"Colombia":3,"Cameroon":3,"Cote D'Ivoire":3,"Chad":3,"Sierra Leone":3,"Tajikistan":3,"British Virgin Islands":3,"Benin":3,"Niger":3,"Lao People's Democratic Republic":3,"Nepal":3};

const RA_RECYCLED_SCORES={"LBMA GD Bullion/DGD Good Delivery":1,"Rudimentary Bars":2,"Gold & Silver Coins":1,"Industrial Waste":1,"Gold Jewellery":2,"Collected waste":2,"Silver/Gold Grains":1,"Broken jewellery":2,"Gold-Processing Chemicals":3,"Others":0};
const RA_MINED_SCORES={"LSM Large Scale Mining":2,"MSM -Medium Scale Mining":2,"ASM - Artisanal Mining":3};
const RA_ACTIVITY_SCORES={"Regulated Financial Entities":1,"Non-Manufactured Precious Metal Trading":3,"Mineral Proccessing Facility":3,"Mining Company":3,"Jewellery Trading":3,"Precious Metal Refinery":3,"Wholesalers/Pawn Shops":3};

const RA_SCORE_LABEL={0:"No Risk",1:"Low",2:"Medium",3:"High"};

function raYearsScore(y){const n=parseInt(y,10);if(isNaN(n)||n<0)return null;if(n===0)return 3;if(n===1)return 2;return 1;}

const RA_CRITERIA = [
  {key:"jurisdiction",label:"Jurisdiction of incorporation / operation",type:"country"},
  {key:"businessActivity",label:"Nature & complexity of business activities",type:"select",opts:Object.keys(RA_ACTIVITY_SCORES)},
  {key:"amlControl",label:"Adequate & effective AML/CFT control environment?",type:"yesno",invert:true,note:"Yes = adequate controls present"},
  {key:"sanctionsPersons",label:"Beneficial owners / directors / senior mgmt subject to sanctions?",type:"yesno"},
  {key:"criminalProceedings",label:"Entity subject to criminal proceedings or legal investigations?",type:"yesno"},
  {key:"adverseMedia",label:"Beneficial owners / directors subject to adverse media?",type:"yesno"},
  {key:"entitySanctions",label:"Entity subject to national or international sanctions?",type:"yesno"},
  {key:"sourceOfFunds",label:"Concerns regarding source of funds / source of wealth?",type:"yesno"},
  {key:"yearsEstablished",label:"Entity newly established / limited operational history",type:"years",sublabel:"Years in operation"},
  {key:"highRiskIndustries",label:"Entity involved in high-risk industries (arms, gaming, casinos)?",type:"yesno"},
  {key:"peps",label:"Beneficial owners / controllers / senior mgmt are PEPs?",type:"yesno"},
  {key:"governmentOwned",label:"Entity owned / controlled by government or state authority?",type:"yesno"},
  {key:"relationshipYears",label:"Duration of business relationship",type:"years",sublabel:"Years of relationship"},
  {key:"recycled1",label:"Recycled Material Source — Supplier 1",type:"select",opts:Object.keys(RA_RECYCLED_SCORES)},
  {key:"recycled2",label:"Recycled Material Source — Supplier 2",type:"select",opts:Object.keys(RA_RECYCLED_SCORES)},
  {key:"recycled3",label:"Recycled Material Source — Supplier 3",type:"select",opts:Object.keys(RA_RECYCLED_SCORES)},
  {key:"mined1",label:"Mined Material Source — Supplier 1",type:"select",opts:Object.keys(RA_MINED_SCORES)},
  {key:"mined2",label:"Mined Material Source — Supplier 2",type:"select",opts:Object.keys(RA_MINED_SCORES)},
  {key:"mined3",label:"Mined Material Source — Supplier 3",type:"select",opts:Object.keys(RA_MINED_SCORES)},
  {key:"nonFaceToFace",label:"Customer onboarded through non-face-to-face channels?",type:"yesno"},
];

function renderRiskAssessment() {
  const body = document.getElementById('raCriteriaBody');
  if (!body) return;
  const countries = ["",...Object.keys(RA_COUNTRY_SCORES).sort()];
  body.innerHTML = RA_CRITERIA.map((c,i) => {
    let input = '';
    if (c.type === 'country') {
      input = `<select id="ra_${c.key}" style="width:100%;font-size:10px;padding:3px 6px" data-change="updateRiskScores">
        ${countries.map(co=>`<option value="${co}">${co||'— Select —'}</option>`).join('')}
      </select>`;
    } else if (c.type === 'select') {
      const opts = ["— Select —",...c.opts];
      input = `<select id="ra_${c.key}" style="width:100%;font-size:10px;padding:3px 6px" data-change="updateRiskScores">
        ${opts.map(o=>`<option value="${o}">${o}</option>`).join('')}
      </select>`;
    } else if (c.type === 'yesno') {
      input = `<div style="display:flex;gap:4px;align-items:center">
        <label style="cursor:pointer;padding:2px 10px;border:1px solid var(--border);font-size:10px;transition:all 0.15s" id="ra_${c.key}_yes" data-action="raSetYesNo" data-arg="${c.key}" data-arg2="Yes">Yes</label>
        <label style="cursor:pointer;padding:2px 10px;border:1px solid var(--border);font-size:10px;transition:all 0.15s" id="ra_${c.key}_no" data-action="raSetYesNo" data-arg="${c.key}" data-arg2="No">No</label>
        <input type="hidden" id="ra_${c.key}" value="" />
        ${c.note?`<span style="font-size:9px;color:var(--muted)">${c.note}</span>`:''}
      </div>`;
    } else if (c.type === 'years') {
      input = `<div style="display:flex;align-items:center;gap:6px">
        <input type="number" min="0" max="100" id="ra_${c.key}" style="width:50px;text-align:center;padding:3px 6px;font-size:10px" placeholder="0" data-input="updateRiskScores" />
        <span style="font-size:9px;color:var(--muted)">${c.sublabel||''}</span>
      </div>`;
    }
    return `<tr style="border-bottom:1px solid var(--border);background:${i%2===0?'var(--surface)':'var(--bg)'}">
      <td style="padding:5px 8px;color:var(--muted);font-size:10px;font-weight:600">${i+1}</td>
      <td style="padding:5px 8px;font-size:10px;line-height:1.4">${c.label}</td>
      <td style="padding:5px 8px;font-size:10px">${input}</td>
      <td style="padding:5px 8px;text-align:center" id="ra_score_${c.key}"><span style="background:var(--border);color:var(--gold);font-weight:700;font-size:11px;padding:2px 8px;display:inline-block;min-width:24px">—</span></td>
      <td style="padding:5px 8px;text-align:center" id="ra_risk_${c.key}"><span class="badge" style="font-size:9px;padding:2px 8px;background:transparent;color:var(--muted);border:1px solid transparent">—</span></td>
    </tr>`;
  }).join('');
  updateRiskScores();
  renderRAHistory();
}

function raSetYesNo(key, val) {
  document.getElementById('ra_'+key).value = val;
  const yesEl = document.getElementById('ra_'+key+'_yes');
  const noEl = document.getElementById('ra_'+key+'_no');
  if (yesEl) { yesEl.style.border = val==='Yes'?'1px solid var(--gold)':'1px solid var(--border)'; yesEl.style.background = val==='Yes'?'rgba(201,168,76,0.15)':'transparent'; yesEl.style.color = val==='Yes'?'var(--gold)':'var(--muted)'; }
  if (noEl) { noEl.style.border = val==='No'?'1px solid var(--gold)':'1px solid var(--border)'; noEl.style.background = val==='No'?'rgba(201,168,76,0.15)':'transparent'; noEl.style.color = val==='No'?'var(--gold)':'var(--muted)'; }
  updateRiskScores();
}

function updateRiskScores() {
  let total = 0;
  RA_CRITERIA.forEach(c => {
    const el = document.getElementById('ra_'+c.key);
    if (!el) return;
    const val = el.value;
    let score = null;

    if (c.type === 'country') {
      score = val && val !== '' ? (RA_COUNTRY_SCORES[val] ?? null) : null;
    } else if (c.type === 'select') {
      if (val && val !== '— Select —') {
        if (c.opts.some(o => Object.keys(RA_RECYCLED_SCORES).includes(o))) score = RA_RECYCLED_SCORES[val] ?? null;
        else if (c.opts.some(o => Object.keys(RA_MINED_SCORES).includes(o))) score = RA_MINED_SCORES[val] ?? null;
        else score = RA_ACTIVITY_SCORES[val] ?? null;
      }
    } else if (c.type === 'yesno') {
      if (val) { score = c.invert ? (val==='Yes'?1:3) : (val==='Yes'?3:1); }
    } else if (c.type === 'years') {
      score = val !== '' ? raYearsScore(val) : null;
    }

    // Update score cell
    const scoreEl = document.getElementById('ra_score_'+c.key);
    if (scoreEl) scoreEl.innerHTML = `<span style="background:var(--border);color:var(--gold);font-weight:700;font-size:13px;padding:2px 8px;display:inline-block;min-width:28px">${score !== null ? score : '—'}</span>`;

    // Update risk cell
    const riskEl = document.getElementById('ra_risk_'+c.key);
    if (riskEl) {
      const label = score !== null ? (RA_SCORE_LABEL[score]||'—') : '—';
      const cls = score===null?'':'risk-'+['norisk','low','medium','high'][score];
      const colors = {0:'var(--muted)',1:'var(--green)',2:'var(--amber)',3:'var(--red)'};
      const bgs = {0:'rgba(125,133,144,0.12)',1:'rgba(63,185,80,0.12)',2:'rgba(227,179,65,0.12)',3:'rgba(248,81,73,0.12)'};
      const borders = {0:'rgba(125,133,144,0.3)',1:'rgba(63,185,80,0.3)',2:'rgba(227,179,65,0.3)',3:'rgba(248,81,73,0.3)'};
      if (score !== null) {
        riskEl.innerHTML = `<span style="display:inline-block;padding:3px 10px;font-size:10px;letter-spacing:1px;text-transform:uppercase;font-weight:700;background:${bgs[score]};color:${colors[score]};border:1px solid ${borders[score]}">${label}</span>`;
      } else {
        riskEl.innerHTML = `<span style="color:var(--muted);font-size:10px">—</span>`;
      }
    }

    if (score !== null) total += score;
  });

  // Update total
  document.getElementById('raTotalScore').textContent = total;

  // Determination
  let det, detColor, detBg, detIcon;
  if (total >= 23) { det='EDD — ENHANCED DUE DILIGENCE'; detColor='var(--red)'; detBg='rgba(248,81,73,0.08)'; detIcon='⚠'; }
  else if (total >= 20) { det='SDD — SIMPLIFIED DUE DILIGENCE'; detColor='var(--amber)'; detBg='rgba(227,179,65,0.08)'; detIcon='◈'; }
  else { det='CDD — STANDARD CUSTOMER DUE DILIGENCE'; detColor='var(--green)'; detBg='rgba(63,185,80,0.08)'; detIcon='✓'; }

  const detEl = document.getElementById('raDetermination');
  if (detEl) { detEl.style.border='1px solid '+detColor; detEl.style.background=detBg; }
  const detLabelEl = document.getElementById('raDetLabel');
  if (detLabelEl) detLabelEl.textContent = det;
  const detIconEl = document.getElementById('raDetIcon');
  if (detIconEl) detIconEl.textContent = detIcon;
  const detRangeEl = document.getElementById('raDetRange');
  if (detRangeEl) detRangeEl.textContent = total>=23?'Score ≥ 23':total>=20?'Score 20–22':'Score 0–19';

  // Legend highlights
  ['Low','Medium','High'].forEach(l => {
    const el = document.getElementById('raLegend'+l);
    if (!el) return;
    const active = (l==='Low'&&total<20)||(l==='Medium'&&total>=20&&total<23)||(l==='High'&&total>=23);
    el.style.opacity = active?'1':'0.4';
    el.style.borderColor = active?(l==='Low'?'var(--green)':l==='Medium'?'var(--amber)':'var(--red)'):'var(--border)';
    el.style.background = active?(l==='Low'?'rgba(63,185,80,0.08)':l==='Medium'?'rgba(227,179,65,0.08)':'rgba(248,81,73,0.08)'):'transparent';
  });
}

function getRiskAssessmentData() {
  const data = { entityName: document.getElementById('raEntityName')?.value||'', assessDate: document.getElementById('raAssessDate')?.value||'', responses: {} };
  RA_CRITERIA.forEach(c => { const el = document.getElementById('ra_'+c.key); if (el) data.responses[c.key] = el.value; });
  data.totalScore = parseInt(document.getElementById('raTotalScore')?.textContent||'0',10);
  data.determination = data.totalScore >= 23 ? 'EDD — ENHANCED DUE DILIGENCE' : data.totalScore >= 20 ? 'SDD — SIMPLIFIED DUE DILIGENCE' : 'CDD — STANDARD CUSTOMER DUE DILIGENCE';
  return data;
}

function clearRiskAssessment() {
  if (!confirm('Clear the risk assessment form?')) return;
  document.getElementById('raEntityName').value = '';
  document.getElementById('raAssessDate').value = '';
  RA_CRITERIA.forEach(c => { const el = document.getElementById('ra_'+c.key); if (el) el.value = c.type==='select'||c.type==='country'?(c.type==='country'?'':'— Select —'):''; });
  renderRiskAssessment();
  document.getElementById('raConfirmation').style.display = 'none';
  toast('Risk assessment cleared','info');
}

function saveRiskAssessment() {
  const data = getRiskAssessmentData();
  if (!data.entityName) { toast('Enter entity name','error'); return; }
  data.id = Date.now();
  data.status = 'draft';
  data.savedAt = new Date().toISOString();
  const list = safeLocalParse(RA_STORAGE, []);
  list.unshift(data);
  safeLocalSave(RA_STORAGE, list);
  renderRAHistory();
  toast('Risk assessment draft saved','success');
  logAudit('risk_assessment','Draft saved for '+data.entityName);
}

function finaliseRiskAssessment() {
  const data = getRiskAssessmentData();
  if (!data.entityName) { toast('Enter entity name','error'); return; }
  data.id = Date.now();
  data.status = 'finalised';
  data.savedAt = new Date().toISOString();
  const list = safeLocalParse(RA_STORAGE, []);
  list.unshift(data);
  safeLocalSave(RA_STORAGE, list);
  renderRAHistory();
  const conf = document.getElementById('raConfirmation');
  if (conf) { conf.style.display = 'block'; conf.innerHTML = `<strong>Assessment recorded.</strong> Entity: <em>${escHtml(data.entityName)}</em> — Determination: <strong>${data.determination}</strong> — Score: ${data.totalScore}`; }
  generateEvalReport(data);
  toast('Risk assessment finalised','success');
  logAudit('risk_assessment','Finalised for '+data.entityName+' — '+data.determination+' (Score: '+data.totalScore+')');
  // Asana sync — create risk assessment follow-up task
  const det = data.totalScore >= 23 ? 'EDD' : data.totalScore >= 20 ? 'SDD' : 'CDD';
  autoSyncToAsana(
    `Risk Assessment: ${data.entityName} — ${det} (Score: ${data.totalScore})`,
    `Entity Risk Assessment Finalised\nEntity: ${data.entityName}\nDate: ${data.assessDate||new Date().toLocaleDateString('en-GB')}\nTotal Score: ${data.totalScore}\nDetermination: ${data.determination}\n\nAction Required:\n${det==='EDD'?'• Obtain Senior Management approval\n• Verify Source of Funds/Wealth\n• Complete enhanced UBO verification\n• Assign dedicated compliance officer\n• Set up enhanced monitoring':'• Complete standard CDD documentation\n• Set up ongoing monitoring schedule\n• Document risk rationale in customer file'}`,
    det==='EDD'?7:det==='SDD'?14:30
  ).then(gid => { if (gid) toast('Asana task created for risk assessment','success',2000); });
}

function generateEvalReport(data) {
  const el = document.getElementById('raEvalReport');
  if (!el) return;
  const total = data.totalScore || 0;
  const det = total < 20 ? 'CDD' : total < 23 ? 'SDD' : 'EDD';
  const detFull = det === 'CDD' ? 'Standard Customer Due Diligence' : det === 'SDD' ? 'Simplified Due Diligence' : 'Enhanced Due Diligence';
  const detColor = det === 'CDD' ? 'var(--green)' : det === 'SDD' ? 'var(--amber)' : 'var(--red)';
  const riskLevel = det === 'CDD' ? 'LOW' : det === 'SDD' ? 'MEDIUM' : 'HIGH';

  const MITIGATION = {
    jurisdiction: {
      high: 'Obtain independent legal opinion on AML regime adequacy. Apply FATF grey/black list screening per Cabinet Resolution 134/2025 Art.14. Conduct Enhanced Geographic Due Diligence with quarterly reassessment. Require senior management sign-off per FDL 10/2025 Art.18.',
      medium: 'Monitor FATF mutual evaluation reports for the jurisdiction. Apply additional CDD measures per Cabinet Resolution 134/2025 Art.13. Document geographic risk rationale in customer file.',
      low: 'Standard geographic risk controls. Annual jurisdiction risk review as part of EWRA cycle per FDL 10/2025 Art.4.'
    },
    businessActivity: {
      high: 'Classify as high-risk under BWRA. Apply EDD including senior management approval per FDL 10/2025 Art.18. Conduct enhanced transaction monitoring with lower reporting thresholds. Quarterly relationship reviews.',
      medium: 'Apply sector-specific CDD measures. Monitor for industry-specific red flags per CBUAE guidance. Semi-annual activity reviews.',
      low: 'Standard activity monitoring. Annual review of business activity risk per EWRA methodology.'
    },
    amlControl: {
      high: 'Entity lacks adequate AML/CFT controls — apply EDD per FDL 10/2025 Art.18(2). Require entity to provide evidence of compliance programme. Consider relationship termination if no remediation within 90 days per Art.19. File STR if suspicion arises per Art.15.',
      medium: 'Request evidence of AML/CFT programme including policies, training records, and screening procedures. Set 60-day remediation timeline.',
      low: 'AML/CFT controls verified as adequate. Document control assessment in CDD file per Cabinet Resolution 134/2025 Art.8.'
    },
    sanctionsPersons: {
      high: 'IMMEDIATE ACTION: Freeze relationship per Cabinet Resolution 74/2020 on TFS. File FFR via goAML and CNMR to EOCN within 5 business days per Cabinet Decision No.(74) of 2020 and EOCN TFS Guidance. No transactions permitted. Notify Compliance Officer and Board immediately.',
      medium: 'Conduct enhanced screening against all sanctions lists (UN, OFAC, EU, UAE Local). Obtain clearance documentation. Apply ongoing enhanced monitoring.',
      low: 'Standard sanctions screening completed with no matches. Document results per record-keeping requirements (5-year retention).'
    },
    criminalProceedings: {
      high: 'Apply EDD. Obtain detailed legal status report. Consider STR filing per FDL 10/2025 Art.15-16. Restrict transaction limits pending resolution. Quarterly legal status updates required. Senior management approval for relationship continuance.',
      medium: 'Investigate nature and status of proceedings. Apply enhanced monitoring. Document findings in customer file.',
      low: 'No criminal proceedings identified. Standard monitoring per ongoing due diligence requirements.'
    },
    adverseMedia: {
      high: 'Conduct comprehensive adverse media analysis using multiple sources. Assess materiality of findings against MOE regulatory criteria. Apply EDD per FDL 10/2025 Art.18. Consider relationship exit per Art.19 if findings indicate ML/TF nexus.',
      medium: 'Document adverse media findings. Assess relevance to ML/TF/PF risks. Increase monitoring frequency. Escalate to MLRO for assessment.',
      low: 'No material adverse media identified. Annual adverse media screening as part of periodic review cycle.'
    },
    entitySanctions: {
      high: 'CRITICAL: Entity is sanctioned — FULL FREEZE per Cabinet Resolution 74/2020. Report to Executive Office (EOCN) and UAE FIU immediately. No business relationship permitted. Criminal liability under FDL 10/2025 Art.65 for non-compliance.',
      medium: 'Closely monitor for sanctions list additions. Apply enhanced screening on all connected parties. Weekly sanctions list refresh.',
      low: 'No sanctions match. Standard TFS screening per Cabinet Resolution 74/2020 ongoing obligations.'
    },
    sourceOfFunds: {
      high: 'Require comprehensive SOF/SOW documentation per FDL 10/2025 Art.18(3). Verify through independent sources (bank statements, audited accounts, tax returns). Consider STR if concerns cannot be resolved per Art.15. Senior management approval required.',
      medium: 'Request additional SOF/SOW documentation. Cross-reference with declared business activity. Apply enhanced transaction monitoring for consistency.',
      low: 'SOF/SOW verified and consistent with business profile. Document in CDD file per Cabinet Resolution 134/2025 Art.9.'
    },
    yearsEstablished: {
      high: 'Newly established entity — apply EDD per MOE guidance. Require business plan, financial projections, and beneficial ownership transparency. Quarterly reviews for first 2 years. Senior management approval per FDL 10/2025 Art.18.',
      medium: 'Limited operational history (1 year). Apply additional CDD measures. Semi-annual reviews. Verify establishment documents and trade license status.',
      low: 'Established entity with operational track record. Standard periodic review per risk-based approach.'
    },
    highRiskIndustries: {
      high: 'High-risk industry involvement confirmed — automatic EDD trigger per Cabinet Resolution 134/2025 Art.14(d). Enhanced transaction monitoring, SOF/SOW verification for all transactions, senior management approval. Quarterly MLRO reviews.',
      medium: 'Indirect exposure to high-risk industries. Apply additional monitoring. Document industry risk assessment rationale.',
      low: 'No high-risk industry involvement. Standard monitoring per BWRA activity risk category.'
    },
    peps: {
      high: 'PEP identified — mandatory EDD per FDL 10/2025 Art.20. Senior management approval for establishing/continuing relationship. Enhanced SOW verification. Annual senior management review. Source of wealth must be independently verified.',
      medium: 'PEP family member or close associate identified. Apply PEP-adjacent EDD measures per Cabinet Resolution 134/2025 Art.16. Enhanced monitoring.',
      low: 'No PEP status identified. Annual PEP screening as part of ongoing CDD per regulatory requirements.'
    },
    governmentOwned: {
      high: 'Government-owned entity — assess corruption and sanction risks. Apply EDD if from high-risk jurisdiction per FDL 10/2025 Art.18. Verify authorized signatories and decision-makers. Enhanced anti-corruption due diligence.',
      medium: 'Partial government ownership. Verify governance structure, authorized representatives, and potential PEP connections.',
      low: 'No government ownership. Standard CDD measures per applicable requirements.'
    },
    relationshipYears: {
      high: 'New relationship — apply enhanced onboarding CDD per FDL 10/2025 Art.9-11. Establish transaction baselines. Monthly monitoring for first year. Require all CDD documentation before first transaction per Art.12.',
      medium: 'Short relationship duration (1 year). Apply enhanced monitoring. Verify that initial CDD documentation is complete and current.',
      low: 'Established relationship with transaction history. Apply standard periodic review per risk-based approach.'
    },
    recycled1: { high: 'High-risk recycled material source — apply LBMA RGG Step 3 risk mitigation. Verify material provenance through chain of custody documentation. On-site supplier audit required. Quarterly material source reviews.', medium: 'Medium-risk recycled source. Obtain supplier declarations and material certifications. Semi-annual review.', low: 'Low-risk recycled source (LBMA Good Delivery). Standard supply chain monitoring per LBMA RGG v9.' },
    recycled2: { high: 'High-risk recycled material source — apply LBMA RGG Step 3 risk mitigation. Verify material provenance. On-site supplier audit required.', medium: 'Medium-risk source. Obtain material certifications and supplier declarations.', low: 'Low-risk source. Standard supply chain monitoring.' },
    recycled3: { high: 'High-risk recycled material source — apply LBMA RGG Step 3 risk mitigation. Verify material provenance. On-site supplier audit required.', medium: 'Medium-risk source. Obtain material certifications and supplier declarations.', low: 'Low-risk source. Standard supply chain monitoring.' },
    mined1: { high: 'ASM-sourced material — apply OECD Due Diligence Guidance Annex II. Conduct on-the-ground risk assessment. Verify CAHRA status. Implement LBMA RGG Step 4 independent audit requirements. Quarterly traceability reviews.', medium: 'Medium/large-scale mining. Verify mining licenses, environmental permits, and labour compliance. Annual site visits.', low: 'Low-risk mined source. Standard LBMA RGG Step 1-2 controls.' },
    mined2: { high: 'ASM-sourced — apply OECD Annex II due diligence. On-the-ground assessment required. CAHRA screening.', medium: 'Medium-scale mining. Verify licenses and permits. Annual review.', low: 'Low-risk source. Standard supply chain controls.' },
    mined3: { high: 'ASM-sourced — apply OECD Annex II due diligence. On-the-ground assessment required. CAHRA screening.', medium: 'Medium-scale mining. Verify licenses and permits. Annual review.', low: 'Low-risk source. Standard supply chain controls.' },
    nonFaceToFace: {
      high: 'Non-face-to-face onboarding — apply EDD per Cabinet Resolution 134/2025 Art.14(e). Verify identity through certified document copies, video verification, or reliable electronic identification. Apply additional transaction limits until face-to-face verification is completed.',
      medium: 'Partial remote onboarding. Supplement with additional verification measures. Plan face-to-face meeting within 90 days.',
      low: 'Face-to-face onboarding completed. Standard identification and verification per FDL 10/2025 Art.9.'
    }
  };

  let criteriaRows = '';
  let highCount = 0, mediumCount = 0, lowCount = 0;

  RA_CRITERIA.forEach((c, i) => {
    const val = data.responses[c.key] || '';
    let score = null;
    if (c.type === 'country') score = RA_COUNTRY_SCORES[val] ?? null;
    else if (c.type === 'select') {
      if (c.opts.some(o => Object.keys(RA_RECYCLED_SCORES).includes(o))) score = RA_RECYCLED_SCORES[val] ?? null;
      else if (c.opts.some(o => Object.keys(RA_MINED_SCORES).includes(o))) score = RA_MINED_SCORES[val] ?? null;
      else score = RA_ACTIVITY_SCORES[val] ?? null;
    } else if (c.type === 'yesno') {
      if (val === 'Yes') score = c.invert ? 1 : 3;
      else if (val === 'No') score = c.invert ? 3 : 1;
    } else if (c.type === 'years') score = raYearsScore(val);

    if (score === null) return;
    const level = score >= 3 ? 'HIGH' : score === 2 ? 'MEDIUM' : 'LOW';
    const lColor = score >= 3 ? 'var(--red)' : score === 2 ? 'var(--amber)' : 'var(--green)';
    const lBg = score >= 3 ? 'rgba(248,81,73,0.08)' : score === 2 ? 'rgba(227,179,65,0.08)' : 'rgba(63,185,80,0.08)';
    if (score >= 3) highCount++; else if (score === 2) mediumCount++; else lowCount++;

    const mit = MITIGATION[c.key] || {};
    const plan = score >= 3 ? (mit.high||'Apply Enhanced Due Diligence measures per FDL 10/2025.') : score === 2 ? (mit.medium||'Apply additional CDD measures. Monitor and reassess.') : (mit.low||'Standard due diligence measures. Periodic review.');

    criteriaRows += `<tr style="border-bottom:1px solid var(--border);background:${i%2===0?'var(--surface)':'var(--bg)'}">
      <td style="padding:6px 8px;font-size:10px;color:var(--muted);font-weight:600;vertical-align:top">${i+1}</td>
      <td style="padding:6px 8px;font-size:10px;vertical-align:top;font-weight:600">${c.label}</td>
      <td style="padding:6px 8px;font-size:10px;vertical-align:top">${escHtml(val)||'—'}</td>
      <td style="padding:6px 8px;text-align:center;vertical-align:top"><span style="display:inline-block;padding:2px 8px;font-size:9px;font-weight:700;background:${lBg};color:${lColor};border:1px solid ${lColor}">${level}</span></td>
      <td style="padding:6px 8px;font-size:9px;line-height:1.4;color:var(--muted);vertical-align:top">${plan}</td>
    </tr>`;
  });

  const overallPlan = det === 'EDD' ?
    `<div style="padding:12px;background:rgba(248,81,73,0.06);border:1px solid var(--red);margin-bottom:12px;font-size:10px;line-height:1.6">
      <strong style="color:var(--red);font-size:11px">⚠️ EDD REQUIRED — ENHANCED DUE DILIGENCE IMPLEMENTATION PLAN</strong><br><br>
      <strong>Regulatory Basis:</strong> FDL No.10/2025 Art.18, Cabinet Resolution 134/2025 Art.14-16<br><br>
      <strong>Immediate Actions (0-15 days):</strong><br>
      • Obtain Senior Management approval for relationship establishment/continuation (Art.18(1))<br>
      • Verify Source of Funds and Source of Wealth through independent documentary evidence (Art.18(3))<br>
      • Complete enhanced UBO verification to natural person level (Cabinet Decision 109/2023)<br>
      • Screen all connected parties against UN, OFAC, EU, UK, UAE sanctions lists (Cabinet Resolution 74/2020)<br>
      • Assign dedicated compliance officer for ongoing monitoring<br><br>
      <strong>Short-Term Actions (15-60 days):</strong><br>
      • Conduct on-site visit or video verification for all principals<br>
      • Obtain certified copies of all corporate and identity documents<br>
      • Establish enhanced transaction monitoring with lower alert thresholds<br>
      • Prepare EDD file with documented risk rationale per MOE inspection requirements<br>
      • Request and verify audited financial statements for last 3 years<br><br>
      <strong>Ongoing Obligations:</strong><br>
      • Quarterly relationship review by MLRO with documented findings<br>
      • Annual Senior Management re-approval with updated risk assessment<br>
      • Enhanced sanctions screening — daily batch + real-time for transactions<br>
      • Transaction monitoring against established baseline — any deviation triggers STR evaluation<br>
      • File STR/SAR via goAML within 3 business days if suspicion arises (Art.15-16)<br>
      • Retain all EDD records for minimum 5 years post-relationship end (Art.24)<br><br>
      <strong>Penalties for Non-Compliance:</strong> Up to AED 5,000,000 per violation (Art.65); potential criminal liability including imprisonment (Art.66-67)
    </div>` :
  det === 'SDD' ?
    `<div style="padding:12px;background:rgba(227,179,65,0.06);border:1px solid var(--amber);margin-bottom:12px;font-size:10px;line-height:1.6">
      <strong style="color:var(--amber);font-size:11px">◆ SDD APPLICABLE — SIMPLIFIED DUE DILIGENCE WITH MONITORING</strong><br><br>
      <strong>Regulatory Basis:</strong> FDL No.10/2025 Art.17, Cabinet Resolution 134/2025 Art.12<br><br>
      <strong>Required Actions:</strong><br>
      • Verify customer identity per standard CDD (Art.9-11) — simplified documentation acceptable<br>
      • Confirm low-risk factors are documented and justified per EWRA/BWRA methodology<br>
      • Apply reduced monitoring frequency (semi-annual reviews acceptable)<br>
      • Maintain CDD file with SDD eligibility justification per MOE guidance<br><br>
      <strong>Ongoing Obligations:</strong><br>
      • Semi-annual transaction monitoring review<br>
      • Annual reassessment of SDD eligibility — any risk elevation triggers immediate CDD/EDD upgrade<br>
      • Monitor for triggering events: change of ownership, adverse media, jurisdiction risk changes<br>
      • Standard sanctions screening (daily batch) per Cabinet Resolution 74/2020<br>
      • Record retention: minimum 5 years post-relationship (Art.24)<br><br>
      <strong>Important:</strong> SDD does NOT exempt from STR filing obligations (Art.15). Any suspicion regardless of risk tier must be reported via goAML immediately.
    </div>` :
    `<div style="padding:12px;background:rgba(63,185,80,0.06);border:1px solid var(--green);margin-bottom:12px;font-size:10px;line-height:1.6">
      <strong style="color:var(--green);font-size:11px">✓ CDD — STANDARD CUSTOMER DUE DILIGENCE</strong><br><br>
      <strong>Regulatory Basis:</strong> FDL No.10/2025 Art.9-13, Cabinet Resolution 134/2025 Art.7-11<br><br>
      <strong>Required Actions:</strong><br>
      • Verify identity of customer and beneficial owners using reliable independent sources (Art.9-10)<br>
      • Obtain purpose and intended nature of business relationship (Art.11)<br>
      • Verify Source of Funds for transactions above AED 55,000 threshold (Art.13)<br>
      • Screen against all applicable sanctions lists (Cabinet Resolution 74/2020)<br>
      • Document CDD in customer file per MOE record-keeping standards<br><br>
      <strong>Ongoing Obligations:</strong><br>
      • Annual periodic review with updated CDD documentation<br>
      • Ongoing transaction monitoring against customer profile<br>
      • Daily batch sanctions screening per TFS requirements<br>
      • Report any suspicious activity via goAML (Art.15-16) — no threshold for STR filing<br>
      • Record retention: minimum 5 years post-relationship (Art.24)<br><br>
      <strong>Monitor For:</strong> Any risk elevation trigger (PEP identification, adverse media, jurisdiction changes, unusual transactions) requiring immediate reassessment and potential EDD upgrade.
    </div>`;

  el.style.display = 'block';
  el.innerHTML = `
    <div style="border:1px solid var(--border);padding:16px;background:var(--surface)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-size:13px;font-weight:700;font-family:'Montserrat',sans-serif;letter-spacing:1px;color:var(--gold)">ENTITY RISK EVALUATION REPORT</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">UAE MOE Regulations — FDL No.10/2025 & Cabinet Resolution 134/2025</div>
        </div>
        <div style="text-align:right">
          <span style="display:inline-block;padding:4px 14px;font-size:12px;font-weight:700;background:${det==='EDD'?'rgba(248,81,73,0.12)':det==='SDD'?'rgba(227,179,65,0.12)':'rgba(63,185,80,0.12)'};color:${detColor};border:2px solid ${detColor}">${riskLevel} RISK — ${det}</span>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:14px">
        <div style="background:rgba(201,168,76,0.05);padding:8px;text-align:center"><div style="font-size:9px;color:var(--muted);font-family:'Montserrat',sans-serif">ENTITY</div><div style="font-size:11px;font-weight:600;margin-top:2px">${escHtml(data.entityName)}</div></div>
        <div style="background:rgba(201,168,76,0.05);padding:8px;text-align:center"><div style="font-size:9px;color:var(--muted);font-family:'Montserrat',sans-serif">TOTAL SCORE</div><div style="font-size:16px;font-weight:700;color:${detColor};margin-top:2px">${total}</div></div>
        <div style="background:rgba(201,168,76,0.05);padding:8px;text-align:center"><div style="font-size:9px;color:var(--muted);font-family:'Montserrat',sans-serif">DETERMINATION</div><div style="font-size:11px;font-weight:600;color:${detColor};margin-top:2px">${detFull}</div></div>
        <div style="background:rgba(201,168,76,0.05);padding:8px;text-align:center"><div style="font-size:9px;color:var(--muted);font-family:'Montserrat',sans-serif">DATE</div><div style="font-size:11px;font-weight:600;margin-top:2px">${data.assessDate||new Date().toLocaleDateString('en-GB')}</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">
        <div style="background:rgba(248,81,73,0.06);border:1px solid var(--red);padding:8px;text-align:center"><span style="font-size:16px;font-weight:700;color:var(--red)">${highCount}</span><div style="font-size:9px;color:var(--red);font-family:'Montserrat',sans-serif;margin-top:2px">HIGH RISK</div></div>
        <div style="background:rgba(227,179,65,0.06);border:1px solid var(--amber);padding:8px;text-align:center"><span style="font-size:16px;font-weight:700;color:var(--amber)">${mediumCount}</span><div style="font-size:9px;color:var(--amber);font-family:'Montserrat',sans-serif;margin-top:2px">MEDIUM RISK</div></div>
        <div style="background:rgba(63,185,80,0.06);border:1px solid var(--green);padding:8px;text-align:center"><span style="font-size:16px;font-weight:700;color:var(--green)">${lowCount}</span><div style="font-size:9px;color:var(--green);font-family:'Montserrat',sans-serif;margin-top:2px">LOW RISK</div></div>
      </div>

      ${overallPlan}

      <div style="font-size:11px;font-weight:700;font-family:'Montserrat',sans-serif;color:var(--gold);margin-bottom:8px;letter-spacing:0.5px">DETAILED CRITERIA EVALUATION</div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:rgba(201,168,76,0.05)">
            <th style="padding:5px 8px;text-align:left;border-bottom:2px solid var(--gold);width:25px;color:var(--gold);font-size:9px">#</th>
            <th style="padding:5px 8px;text-align:left;border-bottom:2px solid var(--gold);color:var(--gold);font-size:9px">CRITERION</th>
            <th style="padding:5px 8px;text-align:left;border-bottom:2px solid var(--gold);width:140px;color:var(--gold);font-size:9px">RESPONSE</th>
            <th style="padding:5px 8px;text-align:center;border-bottom:2px solid var(--gold);width:60px;color:var(--gold);font-size:9px">RISK</th>
            <th style="padding:5px 8px;text-align:left;border-bottom:2px solid var(--gold);color:var(--gold);font-size:9px">MITIGATION PLAN / REGULATORY ACTION</th>
          </tr></thead>
          <tbody>${criteriaRows}</tbody>
        </table>
      </div>

      <div style="margin-top:14px;padding:10px;background:rgba(201,168,76,0.05);font-size:9px;line-height:1.5;color:var(--muted)">
        <strong style="color:var(--text)">Regulatory References:</strong> UAE Federal Decree-Law No.10/2025 on Anti-Money Laundering and Combating the Financing of Terrorism and Illegal Organizations | Cabinet Resolution No.134/2025 on the Implementing Regulation | Cabinet Resolution No.74/2020 on Targeted Financial Sanctions | Cabinet Decision No.109/2023 on Beneficial Ownership | FATF Recommendations (updated Feb 2025) | LBMA Responsible Gold Guidance v9 | OECD Due Diligence Guidance for Responsible Supply Chains | UAE National Risk Assessment 2024 | Ministry of Economy DPMS Supervisory Guidance (March 2026)
      </div>
    </div>`;
  el.scrollIntoView({behavior:'smooth', block:'start'});
}

function renderRAHistory() {
  const list = safeLocalParse(RA_STORAGE, []);
  const el = document.getElementById('raHistoryList');
  if (!el) return;
  if (!list.length) { el.innerHTML = '<p style="font-size:13px;color:var(--muted)">No assessments recorded yet.</p>'; return; }
  el.innerHTML = list.map(a => {
    const colors = { 'CDD':'var(--green)', 'SDD':'var(--amber)', 'EDD':'var(--red)' };
    const detType = a.determination?.startsWith('EDD')?'EDD':a.determination?.startsWith('SDD')?'SDD':'CDD';
    const color = colors[detType]||'var(--muted)';
    return `<div style="padding:10px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div>
        <strong style="font-size:13px">${escHtml(a.entityName)}</strong>
        <span style="font-size:10px;color:var(--muted);margin-left:8px">${a.savedAt?new Date(a.savedAt).toLocaleString('en-GB'):''}</span>
        <span style="font-size:9px;margin-left:8px;padding:2px 6px;border:1px solid var(--border);color:var(--muted)">${a.status?.toUpperCase()||'DRAFT'}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-weight:700;color:${color};font-size:13px">Score: ${a.totalScore}</span>
        <span style="font-size:10px;padding:3px 8px;border:1px solid ${color};color:${color};font-weight:600">${detType}</span>
        <button class="btn btn-sm btn-red" style="padding:2px 6px;font-size:9px" data-action="deleteRiskAssessment" data-arg="${a.id}">Delete</button>
      </div>
    </div>`;
  }).join('');
}

function deleteRiskAssessment(id) {
  let list = safeLocalParse(RA_STORAGE, []);
  list = list.filter(a => a.id !== id);
  safeLocalSave(RA_STORAGE, list);
  renderRAHistory();
  toast('Assessment deleted','info');
}

function _raScoreForKey(key) {
  const el = document.getElementById('ra_score_'+key);
  const txt = el?.textContent?.trim()||'';
  const n = parseInt(txt);
  return isNaN(n) ? null : n;
}

function exportRiskAssessmentPDF() {
  if (!requireJsPDF()) return;
  const data = getRiskAssessmentData();
  if (!data.entityName) { toast('Enter entity name first','error'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4' });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const gold = [201,168,76], darkBg = [30,27,24], white = [255,255,255];
  const green = [63,185,80], amber = [227,179,65], red = [248,81,73], muted = [140,137,132];
  const lightGold = [252,248,235], lightGreen = [235,250,237], lightAmber = [255,248,230], lightRed = [255,237,236];
  const dateStr = data.assessDate || new Date().toLocaleDateString('en-GB');
  const total = data.totalScore || 0;
  const det = total >= 23 ? 'EDD' : total >= 20 ? 'SDD' : 'CDD';
  const detFull = det === 'EDD' ? 'ENHANCED DUE DILIGENCE' : det === 'SDD' ? 'SIMPLIFIED DUE DILIGENCE' : 'STANDARD CUSTOMER DUE DILIGENCE';
  const detColor = det === 'EDD' ? red : det === 'SDD' ? amber : green;
  const detBg = det === 'EDD' ? lightRed : det === 'SDD' ? lightAmber : lightGreen;

  // ── Header band ──
  doc.setFillColor(...darkBg); doc.rect(0, 0, pw, 38, 'F');
  doc.setFillColor(...gold); doc.rect(0, 38, pw, 1.5, 'F');
  doc.setTextColor(...gold); doc.setFontSize(18); doc.setFont(undefined,'bold');
  doc.text('ENTITY RISK ASSESSMENT', 14, 16);
  doc.setFontSize(10); doc.setFont(undefined,'normal'); doc.setTextColor(200,197,192);
  doc.text('DPMS AML/CFT — UAE Federal Decree-Law No.10/2025', 14, 23);
  doc.setFontSize(9); doc.text('Generated: ' + new Date().toLocaleString('en-GB'), 14, 30);
  doc.text('Confidential — For Internal Use Only', pw - 14, 30, { align:'right' });

  // ── Entity info boxes ──
  let y = 46;
  const boxW = (pw - 28 - 12) / 4;
  [{lbl:'ENTITY', val:data.entityName}, {lbl:'DATE', val:dateStr}, {lbl:'TOTAL SCORE', val:String(total)}, {lbl:'DETERMINATION', val:det}].forEach((b, i) => {
    const bx = 14 + i * (boxW + 4);
    doc.setFillColor(...(i===3 ? detBg : [245,242,237])); doc.roundedRect(bx, y, boxW, 18, 2, 2, 'F');
    doc.setFontSize(7); doc.setTextColor(...gold); doc.setFont(undefined,'bold');
    doc.text(b.lbl, bx + boxW/2, y + 6, { align:'center' });
    doc.setFontSize(i===2 ? 14 : 9); doc.setTextColor(...(i===3 ? detColor : darkBg)); doc.setFont(undefined, i===2?'bold':'normal');
    doc.text(b.val, bx + boxW/2, y + 14, { align:'center', maxWidth: boxW - 4 });
  });
  y += 24;

  // ── Determination banner ──
  doc.setFillColor(...detBg); doc.roundedRect(14, y, pw - 28, 10, 2, 2, 'F');
  doc.setDrawColor(...detColor); doc.setLineWidth(0.5); doc.roundedRect(14, y, pw - 28, 10, 2, 2, 'S');
  doc.setFontSize(9); doc.setTextColor(...detColor); doc.setFont(undefined,'bold');
  doc.text(detFull, pw/2, y + 6.5, { align:'center' });
  y += 16;

  // ── Criteria table ──
  doc.setFillColor(...darkBg); doc.rect(14, y, pw - 28, 8, 'F');
  doc.setFontSize(7); doc.setTextColor(...gold); doc.setFont(undefined,'bold');
  doc.text('#', 18, y + 5.5); doc.text('ASSESSMENT CRITERION', 28, y + 5.5);
  doc.text('RECORDED RESPONSE', 115, y + 5.5); doc.text('SCORE', 163, y + 5.5);
  doc.text('RISK LEVEL', 178, y + 5.5);
  y += 8;
  doc.setFillColor(...gold); doc.rect(14, y, pw - 28, 0.5, 'F'); y += 1;

  const riskLabels = { 1:'LOW', 2:'MEDIUM', 3:'HIGH' };

  RA_CRITERIA.forEach((c, i) => {
    if (y > ph - 20) { doc.addPage(); y = 14; }
    const val = data.responses[c.key] || '—';
    const score = _raScoreForKey(c.key);
    const riskLbl = score !== null ? (riskLabels[score] || '—') : '—';
    const rowColor = score === 3 ? lightRed : score === 2 ? lightAmber : score === 1 ? lightGreen : [250,248,245];
    const txtColor = score === 3 ? red : score === 2 ? amber : score === 1 ? green : muted;

    // Row background
    doc.setFillColor(...(i % 2 === 0 ? rowColor : [255,255,255])); doc.rect(14, y, pw - 28, 7, 'F');
    // Row border
    doc.setDrawColor(230,228,224); doc.setLineWidth(0.15); doc.line(14, y + 7, pw - 14, y + 7);

    doc.setFontSize(7); doc.setFont(undefined,'normal'); doc.setTextColor(...darkBg);
    doc.text(String(i + 1), 18, y + 4.8);
    doc.setFont(undefined,'bold');
    const labelLines = doc.splitTextToSize(c.label, 82);
    doc.text(labelLines[0], 28, y + 4.8);

    doc.setFont(undefined,'normal'); doc.setTextColor(100,97,92);
    const valTrunc = String(val).length > 28 ? String(val).substring(0,26)+'..' : String(val);
    doc.text(valTrunc, 115, y + 4.8);

    // Score badge
    if (score !== null) {
      doc.setFillColor(...(score===3?red:score===2?amber:green));
      doc.roundedRect(163, y + 1, 10, 5, 1, 1, 'F');
      doc.setTextColor(...white); doc.setFontSize(7); doc.setFont(undefined,'bold');
      doc.text(String(score), 168, y + 4.5, { align:'center' });
    } else {
      doc.setTextColor(...muted); doc.setFontSize(7); doc.text('—', 168, y + 4.8, { align:'center' });
    }

    // Risk level badge
    if (score !== null) {
      doc.setFillColor(...(score===3?lightRed:score===2?lightAmber:lightGreen));
      doc.roundedRect(178, y + 1, 16, 5, 1, 1, 'F');
      doc.setTextColor(...txtColor); doc.setFontSize(6); doc.setFont(undefined,'bold');
      doc.text(riskLbl, 186, y + 4.5, { align:'center' });
    }
    y += 7;
  });

  // ── Total row ──
  if (y > ph - 20) { doc.addPage(); y = 14; }
  doc.setFillColor(...darkBg); doc.rect(14, y, pw - 28, 9, 'F');
  doc.setTextColor(...gold); doc.setFontSize(9); doc.setFont(undefined,'bold');
  doc.text('TOTAL RISK SCORE', 28, y + 6);
  doc.setFillColor(...detColor); doc.roundedRect(163, y + 1.5, 10, 6, 1.5, 1.5, 'F');
  doc.setTextColor(...white); doc.setFontSize(10); doc.text(String(total), 168, y + 5.8, { align:'center' });
  doc.setTextColor(...detColor); doc.setFontSize(8); doc.text(det, 186, y + 6, { align:'center' });
  y += 14;

  // ── Scoring legend ──
  if (y > ph - 30) { doc.addPage(); y = 14; }
  doc.setFontSize(8); doc.setTextColor(...gold); doc.setFont(undefined,'bold');
  doc.text('SCORING METHODOLOGY', 14, y); y += 5;
  doc.setFontSize(7); doc.setFont(undefined,'normal');
  [{lbl:'CDD — Standard Due Diligence', range:'Score 0–19', col:green, bg:lightGreen},
   {lbl:'SDD — Simplified Due Diligence', range:'Score 20–22', col:amber, bg:lightAmber},
   {lbl:'EDD — Enhanced Due Diligence', range:'Score 23+', col:red, bg:lightRed}].forEach(l => {
    doc.setFillColor(...l.bg); doc.roundedRect(14, y - 3, pw/3 - 10, 7, 1, 1, 'F');
    doc.setTextColor(...l.col); doc.setFont(undefined,'bold'); doc.text(l.lbl, 16, y + 1.5);
    doc.setFont(undefined,'normal'); doc.setTextColor(...muted); doc.text(l.range, 16 + pw/3 - 16, y + 1.5, { align:'right' });
    y += 8;
  });

  // ── Footer ──
  y += 4;
  doc.setDrawColor(...gold); doc.setLineWidth(0.3); doc.line(14, y, pw - 14, y); y += 4;
  doc.setFontSize(6); doc.setTextColor(...muted);
  doc.text('Regulatory References: UAE Federal Decree-Law No.10/2025 | Cabinet Resolution 134/2025 | Cabinet Resolution 74/2020 | FATF Recommendations | LBMA RGG v9', 14, y);
  y += 3;
  doc.text('This document is auto-generated by the Hawkeye Sterling V2. For official use, verify all data against source records.', 14, y);

  doc.save('Risk_Assessment_'+data.entityName.replace(/[^a-zA-Z0-9]/g,'_')+'_'+new Date().toISOString().split('T')[0]+'.pdf');
  toast('PDF exported','success');
}

function exportRiskAssessmentDOCX() {
  const data = getRiskAssessmentData();
  if (!data.entityName) { toast('Enter entity name first','error'); return; }
  const total = data.totalScore || 0;
  const det = total >= 23 ? 'EDD' : total >= 20 ? 'SDD' : 'CDD';
  const detFull = det === 'EDD' ? 'ENHANCED DUE DILIGENCE' : det === 'SDD' ? 'SIMPLIFIED DUE DILIGENCE' : 'STANDARD CUSTOMER DUE DILIGENCE';
  const detColor = det === 'EDD' ? '#F85149' : det === 'SDD' ? '#E3B341' : '#3FB950';
  const detBg = det === 'EDD' ? '#FFF0EF' : det === 'SDD' ? '#FFF8E0' : '#EBF9ED';
  const dateStr = data.assessDate || new Date().toLocaleDateString('en-GB');
  const riskLabels = { 1:'LOW', 2:'MEDIUM', 3:'HIGH' };

  let rows = '';
  RA_CRITERIA.forEach((c, i) => {
    const val = data.responses[c.key] || '—';
    const score = _raScoreForKey(c.key);
    const riskLbl = score !== null ? (riskLabels[score] || '—') : '—';
    const scoreColor = score === 3 ? '#F85149' : score === 2 ? '#E3B341' : score === 1 ? '#3FB950' : '#888';
    const riskBg = score === 3 ? '#FFF0EF' : score === 2 ? '#FFF8E0' : score === 1 ? '#EBF9ED' : '#F8F7F5';
    const rowBg = i % 2 === 0 ? '#FAFAF8' : '#FFFFFF';
    rows += `<tr style="background:${rowBg}">
      <td style="text-align:center;color:#888;font-weight:bold">${i+1}</td>
      <td style="font-weight:600">${escHtml(c.label)}</td>
      <td>${escHtml(val)}</td>
      <td style="text-align:center"><span style="display:inline-block;padding:2px 8px;background:${scoreColor};color:white;font-weight:bold;border-radius:4px;min-width:20px">${score !== null ? score : '—'}</span></td>
      <td style="text-align:center"><span style="display:inline-block;padding:2px 10px;background:${riskBg};color:${scoreColor};font-weight:bold;border:1px solid ${scoreColor};border-radius:4px;font-size:8pt">${riskLbl}</span></td>
    </tr>`;
  });

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<style>
  @page { margin: 2cm; }
  body { font-family: Calibri, Arial, sans-serif; font-size: 10pt; color: #1E1B18; }
  h1 { font-size: 20pt; color: #C9A84C; margin: 0 0 4px 0; letter-spacing: 1px; }
  h2 { font-size: 10pt; color: #8C8984; margin: 0 0 16px 0; font-weight: normal; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { background: #1E1B18; color: #C9A84C; padding: 6px 10px; font-size: 8pt; text-align: left; letter-spacing: 0.5px; border: none; }
  td { border-bottom: 1px solid #E6E4E0; padding: 5px 10px; font-size: 9pt; }
  .info-table { margin-bottom: 14px; }
  .info-table td { border: 1px solid #E6E4E0; padding: 8px 14px; font-size: 9pt; }
  .info-label { background: #FAF8F3; color: #C9A84C; font-size: 7pt; font-weight: bold; letter-spacing: 1px; padding: 4px 14px; }
  .info-value { font-size: 11pt; font-weight: 600; padding: 6px 14px; }
  .det-banner { padding: 8px 16px; text-align: center; font-weight: bold; font-size: 11pt; margin: 10px 0 6px 0; border: 2px solid ${detColor}; background: ${detBg}; color: ${detColor}; letter-spacing: 1px; }
  .total-row td { background: #1E1B18; color: #C9A84C; font-weight: bold; font-size: 10pt; border: none; padding: 8px 10px; }
  .footer { margin-top: 16px; font-size: 7pt; color: #8C8984; border-top: 1px solid #C9A84C; padding-top: 8px; }
  .legend { margin-top: 12px; }
  .legend td { font-size: 8pt; padding: 4px 10px; }
</style>
</head>
<body>
  <h1>ENTITY RISK ASSESSMENT</h1>
  <h2>DPMS AML/CFT — UAE Federal Decree-Law No.10/2025</h2>

  <table class="info-table" style="width:100%">
    <tr>
      <td class="info-label">ENTITY</td>
      <td class="info-label">ASSESSMENT DATE</td>
      <td class="info-label">TOTAL SCORE</td>
      <td class="info-label">DETERMINATION</td>
    </tr>
    <tr>
      <td class="info-value">${escHtml(data.entityName)}</td>
      <td class="info-value">${dateStr}</td>
      <td class="info-value" style="text-align:center;color:${detColor};font-size:16pt">${total}</td>
      <td class="info-value" style="text-align:center;color:${detColor}">${det}</td>
    </tr>
  </table>

  <div class="det-banner">${detFull}</div>

  <table>
    <tr>
      <th style="width:30px;text-align:center">#</th>
      <th>ASSESSMENT CRITERION</th>
      <th style="width:150px">RECORDED RESPONSE</th>
      <th style="width:50px;text-align:center">SCORE</th>
      <th style="width:80px;text-align:center">RISK LEVEL</th>
    </tr>
    ${rows}
    <tr class="total-row">
      <td colspan="3" style="text-align:right;padding-right:20px">TOTAL RISK SCORE</td>
      <td style="text-align:center;font-size:14pt;color:${detColor}">${total}</td>
      <td style="text-align:center;color:${detColor}">${det}</td>
    </tr>
  </table>

  <table class="legend" style="width:auto;margin-top:14px">
    <tr><td style="font-weight:bold;color:#C9A84C;font-size:8pt;border:none" colspan="2">SCORING METHODOLOGY</td></tr>
    <tr><td style="background:#EBF9ED;color:#3FB950;font-weight:bold;border:1px solid #3FB950">CDD — Standard Due Diligence</td><td style="border:1px solid #E6E4E0">Score 0–19</td></tr>
    <tr><td style="background:#FFF8E0;color:#E3B341;font-weight:bold;border:1px solid #E3B341">SDD — Simplified Due Diligence</td><td style="border:1px solid #E6E4E0">Score 20–22</td></tr>
    <tr><td style="background:#FFF0EF;color:#F85149;font-weight:bold;border:1px solid #F85149">EDD — Enhanced Due Diligence</td><td style="border:1px solid #E6E4E0">Score 23+</td></tr>
  </table>

  <div class="footer">
    <strong>Regulatory References:</strong> UAE Federal Decree-Law No.10/2025 | Cabinet Resolution No.134/2025 | Cabinet Resolution No.74/2020 | FATF Recommendations | LBMA Responsible Gold Guidance v9<br>
    Generated: ${new Date().toLocaleString('en-GB')} — Confidential — For Internal Use Only
  </div>
</body></html>`;

  const blob = new Blob(['\ufeff' + html], { type: 'application/msword;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Risk_Assessment_' + data.entityName.replace(/[^a-zA-Z0-9]/g,'_') + '_' + new Date().toISOString().split('T')[0] + '.doc';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  toast('Word document exported','success');
}

// ======= INCIDENTS =======
const INCIDENTS_STORAGE = 'fgl_incidents';
function showNewIncidentForm() { document.getElementById('newIncidentForm').style.display='block'; document.getElementById('incDate').value=new Date().toISOString().split('T')[0]; }
function hideNewIncidentForm() { document.getElementById('newIncidentForm').style.display='none'; }

function saveIncident() {
  const title = document.getElementById('incTitle').value.trim();
  if (!title) { toast('Enter incident title','error'); return; }
  const incident = {
    id:Date.now(), title, type:document.getElementById('incType').value,
    severity:document.getElementById('incSeverity').value, date:document.getElementById('incDate').value,
    deadline:document.getElementById('incDeadline')?.value || '',
    description:document.getElementById('incDescription').value.trim(),
    entities:document.getElementById('incEntities').value.trim(),
    reporter:document.getElementById('incReporter').value.trim(),
    department:document.getElementById('incDepartment')?.value?.trim() || '',
    rootCause:document.getElementById('incRootCause')?.value || '',
    immediateActions:document.getElementById('incImmediateActions')?.value?.trim() || '',
    remediation:document.getElementById('incRemediation').value.trim(),
    regNotify:document.getElementById('incRegNotify')?.value || 'no',
    financialImpact:document.getElementById('incFinancialImpact')?.value || '',
    status:'open', createdAt:new Date().toISOString()
  };
  const list = safeLocalParse(INCIDENTS_STORAGE, []);
  list.unshift(incident);
  safeLocalSave(INCIDENTS_STORAGE, list);
  logAudit('incident', `Incident logged: ${title} (${incident.severity})`);
  if (typeof WorkflowEngine !== 'undefined') WorkflowEngine.processTrigger('new_incident', { title, severity: incident.severity, type: incident.type, description: incident.description });
  renderIncidents();
  hideNewIncidentForm();
  ['incTitle','incDescription','incEntities','incReporter','incDepartment','incImmediateActions','incRemediation','incFinancialImpact'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
  toast('Incident saved','success');
  // Asana sync — create incident task
  const sevDays = incident.severity==='critical'?1:incident.severity==='high'?3:incident.severity==='medium'?7:14;
  autoSyncToAsana(
    `${incident.severity.toUpperCase()} INCIDENT: ${title}`,
    `Compliance Incident Logged\nSeverity: ${incident.severity.toUpperCase()}\nType: ${incident.type}\nDate: ${incident.date}\nReporter: ${incident.reporter}\nEntities: ${incident.entities}\n\nDescription:\n${incident.description}\n\nImmediate Actions:\n${incident.immediateActions}\n\nRemediation Plan:\n${incident.remediation}\n\nRegulatory Notification: ${incident.regNotify}`,
    sevDays
  ).then(gid => { if (gid) toast('Asana incident task created','success',2000); });
}

function updateIncidentMetrics() {
  const list = safeLocalParse(INCIDENTS_STORAGE, []);
  const el = id => document.getElementById(id);
  if (el('incMetricTotal')) el('incMetricTotal').textContent = list.length;
  if (el('incMetricOpen')) el('incMetricOpen').textContent = list.filter(i => i.status === 'open').length;
  if (el('incMetricInvestigating')) el('incMetricInvestigating').textContent = list.filter(i => i.status === 'investigating' || i.status === 'escalated').length;
  if (el('incMetricClosed')) el('incMetricClosed').textContent = list.filter(i => i.status === 'closed').length;
  if (el('incMetricCritical')) el('incMetricCritical').textContent = list.filter(i => i.severity === 'critical' || i.severity === 'high').length;
}

function renderIncidents() {
  let list = safeLocalParse(INCIDENTS_STORAGE, []);
  const el = document.getElementById('incidentsList');
  updateIncidentMetrics();

  // Apply filters
  const fStatus = document.getElementById('incFilterStatus')?.value || '';
  const fSeverity = document.getElementById('incFilterSeverity')?.value || '';
  const fType = document.getElementById('incFilterType')?.value || '';
  const fSearch = (document.getElementById('incSearch')?.value || '').toLowerCase().trim();
  if (fStatus) list = list.filter(i => i.status === fStatus);
  if (fSeverity) list = list.filter(i => i.severity === fSeverity);
  if (fType) list = list.filter(i => i.type === fType);
  if (fSearch) list = list.filter(i => (i.title||'').toLowerCase().includes(fSearch) || (i.description||'').toLowerCase().includes(fSearch) || (i.reporter||'').toLowerCase().includes(fSearch) || (i.entities||'').toLowerCase().includes(fSearch));

  if (!list.length) { el.innerHTML='<p style="font-size:13px;color:var(--muted)">No incidents match the current filters.</p>'; return; }
  el.innerHTML = list.map(i => {
    const badge = i.severity==='critical'?'b-c':i.severity==='high'?'b-h':i.severity==='medium'?'b-m':'b-ok';
    const statusMap = {open:'s-overdue',investigating:'s-due',escalated:'s-due',closed:'s-ok'};
    const statusBadge = statusMap[i.status] || 's-overdue';
    const typeLabels = {breach:'Compliance Breach',suspicious:'Suspicious Activity',fraud:'Fraud',data_breach:'Data Breach',sanctions_hit:'Sanctions Hit',regulatory:'Regulatory Notice',whistleblower:'Whistleblower',str_filed:'STR/SAR Filed',aml_violation:'AML Violation',kyc_failure:'KYC/CDD Failure',tfs_violation:'TFS Violation',pep_issue:'PEP Issue',money_laundering:'Money Laundering',other:'Other'};
    const typeLabel = typeLabels[i.type] || i.type;
    const hasDeadline = i.deadline && i.status !== 'closed';
    const isOverdue = hasDeadline && new Date(i.deadline) < new Date();
    const regFlag = i.regNotify && i.regNotify !== 'no';
    return `<div class="asana-item" style="margin-bottom:6px;${i.severity==='critical'?'border-left:3px solid var(--red);':''}">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap">
          <span class="asana-name" style="margin:0">${escHtml(i.title)}</span>
          ${i.wbRef ? `<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(16,185,129,0.12);color:#10B981;font-family:'Montserrat',sans-serif">${escHtml(i.wbRef)}</span>` : ''}
          ${regFlag ? '<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(239,68,68,0.12);color:#EF4444">REG. NOTIFY</span>' : ''}
          ${isOverdue ? '<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--red-dim);color:var(--red)">OVERDUE</span>' : ''}
        </div>
        <div class="asana-meta">${escHtml(typeLabel)} | ${escHtml(i.date||'—')} | ${escHtml(i.reporter||'Unknown')}${i.department ? ' | Dept: '+escHtml(i.department) : ''}${i.rootCause ? ' | Cause: '+escHtml(i.rootCause.replace(/_/g,' ')) : ''}${i.financialImpact ? ' | USD '+Number(i.financialImpact).toLocaleString('en-GB') : ''}</div>
        ${i.description ? `<div style="font-size:11px;color:var(--muted);margin-top:3px;cursor:pointer" data-action="_toggleIncExpand" class="inc-desc">${escHtml((i.description||'').slice(0,100))}${i.description.length>100?'... <span style=color:var(--gold)>[more]</span>':''}</div>` : ''}
      </div>
      <div style="display:flex;gap:4px;align-items:center;flex-shrink:0;flex-wrap:wrap">
        <span class="badge ${badge}" style="font-size:9px">${(i.severity||'').toUpperCase()}</span>
        <span class="asana-status ${statusBadge}" style="font-size:9px">${i.status}</span>
        <select data-change="_changeIncidentStatusFromSelect" data-incident-id="${i.id}" style="width:auto;height:24px;font-size:9px;padding:2px 4px">
          <option value="" disabled selected>Action</option>
          <option value="open">Open</option>
          <option value="investigating">Investigate</option>
          <option value="escalated">Escalate</option>
          <option value="closed">Close</option>
        </select>
        <button class="btn btn-sm btn-red" data-action="deleteIncident" data-arg="${i.id}" style="padding:2px 6px;font-size:9px">Del</button>
      </div>
    </div>`;
  }).join('');
}

function changeIncidentStatus(id, newStatus) {
  if (!newStatus) return;
  const list = safeLocalParse(INCIDENTS_STORAGE, []);
  const i = list.find(x => x.id === id);
  if (i) { i.status = newStatus; safeLocalSave(INCIDENTS_STORAGE, list); renderIncidents(); logAudit('incident', `Incident ${newStatus}: ${i.title}`); toast(`Incident ${newStatus}`, 'success'); }
}

function closeIncident(id) {
  const list = safeLocalParse(INCIDENTS_STORAGE, []);
  const i = list.find(x=>x.id===id);
  if (i) { i.status = i.status==='closed'?'open':'closed'; safeLocalSave(INCIDENTS_STORAGE, list); renderIncidents(); logAudit('incident',`Incident ${i.status}: ${i.title}`); }
}

function deleteIncident(id) {
  if (!confirm('Delete this incident? This cannot be undone.')) return;
  let list = safeLocalParse(INCIDENTS_STORAGE, []);
  const incident = list.find(x=>x.id===id);
  list = list.filter(x=>x.id!==id);
  safeLocalSave(INCIDENTS_STORAGE, list);
  renderIncidents();
  logAudit('incident', `Incident deleted: ${incident?.title||id}`);
  toast('Incident deleted', 'success');
}

function clearIncidents() {
  if (!confirm('Clear ALL incidents? This cannot be undone.')) return;
  safeLocalRemove(INCIDENTS_STORAGE);
  renderIncidents();
  toast('All incidents cleared', 'success');
}

function clearSTRForm() {
  ['strSubject','strAmount','strIndicators','strSanctionsList','strDate'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
  const r = document.getElementById('strDraftResult'); if (r) r.style.display = 'none';
}

function exportIncidentsPDF() {
  if (!requireJsPDF()) return;
  const list = safeLocalParse(INCIDENTS_STORAGE, []);
  if (!list.length) { toast('No incidents to export','error'); return; }
  const doc = new jspdf.jsPDF();
  const pw = doc.internal.pageSize.getWidth();
  doc.setFillColor(30,30,30); doc.rect(0,0,pw,28,'F');
  doc.setFontSize(16); doc.setTextColor(180,151,90); doc.text('Incident Register Report', 14, 18);
  doc.setFontSize(8); doc.setTextColor(120); doc.text('Generated: ' + new Date().toLocaleDateString('en-GB'), pw-14, 18, {align:'right'});
  let y = 36;
  list.forEach((inc, idx) => {
    if (y > 260) { doc.addPage(); y = 20; }
    doc.setFillColor(40,40,40); doc.rect(14, y-4, pw-28, 8, 'F');
    doc.setFontSize(10); doc.setTextColor(180,151,90); doc.text((idx+1) + '. ' + (inc.title||'Untitled'), 16, y+1);
    const sevColor = inc.severity==='critical'?[217,79,79]:inc.severity==='high'?[232,168,56]:inc.severity==='medium'?[91,141,239]:[39,174,96];
    doc.setTextColor(...sevColor); doc.text(inc.severity?.toUpperCase()||'', pw-16, y+1, {align:'right'});
    y += 10;
    doc.setFontSize(8); doc.setTextColor(160);
    doc.text('Type: ' + (inc.type||'—') + '  |  Date: ' + (inc.date||'—') + '  |  Status: ' + (inc.status||'open') + '  |  Reporter: ' + (inc.reporter||'Unknown'), 16, y); y += 5;
    if (inc.description) { const lines = doc.splitTextToSize(inc.description, pw-32); doc.text(lines, 16, y); y += lines.length * 4; }
    if (inc.remediation) { y += 2; doc.setTextColor(120); doc.text('Remediation:', 16, y); y += 4; doc.setTextColor(160); const rl = doc.splitTextToSize(inc.remediation, pw-32); doc.text(rl, 16, y); y += rl.length * 4; }
    y += 8;
  });
  doc.save('Incident_Register_' + new Date().toISOString().slice(0,10) + '.pdf');
  toast('PDF exported','success');
}

function exportIncidentsDOCX() {
  const list = safeLocalParse(INCIDENTS_STORAGE, []);
  if (!list.length) { toast('No incidents to export','error'); return; }
  let html = wordDocHeader('Incident Register Report');
  html += '<table><tr><th>#</th><th>Title</th><th>Type</th><th>Severity</th><th>Date</th><th>Status</th><th>Reporter</th><th>Description</th><th>Remediation</th></tr>';
  list.forEach((inc, idx) => {
    html += '<tr><td>' + (idx+1) + '</td><td>' + (inc.title||'') + '</td><td>' + (inc.type||'') + '</td><td class="' + (inc.severity||'') + '">' + (inc.severity?.toUpperCase()||'') + '</td><td>' + (inc.date||'') + '</td><td>' + (inc.status||'open') + '</td><td>' + (inc.reporter||'') + '</td><td>' + (inc.description||'') + '</td><td>' + (inc.remediation||'') + '</td></tr>';
  });
  html += '</table>' + wordDocFooter();
  downloadWordDoc(html, 'Incident_Register_'+new Date().toISOString().slice(0,10)+'.doc');
  toast('Word exported','success');
}

function exportIncidentsCSV() {
  const list = safeLocalParse(INCIDENTS_STORAGE, []);
  if (!list.length) { toast('No incidents to export','error'); return; }
  const headers = ['Title','Type','Severity','Date','Status','Reporter','Entities','Description','Remediation'];
  const rows = list.map(i => [i.title, i.type, i.severity, i.date, i.status, i.reporter, i.entities, i.description, i.remediation]);
  const csv = [headers, ...rows].map(r => r.map(c => '"' + String(c||'').replace(/"/g,'""') + '"').join(',')).join('\n');
  const blob = new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='Incident_Register_'+new Date().toISOString().slice(0,10)+'.csv'; a.click();
  toast('CSV exported','success');
}

const WB_REPORTS_STORAGE = 'fgl_whistleblower_reports';

function generateWBRefNumber() {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth()+1).padStart(2,'0');
  const seq = (safeLocalParse(WB_REPORTS_STORAGE, []).length + 1).toString().padStart(4,'0');
  return `WB-${y}${m}-${seq}`;
}

function submitWhistleblower() {
  const report = document.getElementById('wbReport').value.trim();
  if (!report) { toast('Enter report details','error'); return; }
  const urgency = document.getElementById('wbUrgency').value;
  const category = document.getElementById('wbCategory').value;
  const refNumber = generateWBRefNumber();
  const followUp = document.querySelector('input[name="wbFollowUp"]:checked')?.value || 'no_contact';

  // Save to WB-specific log
  const wbRecord = {
    id: Date.now(), refNumber, description: report, category, urgency,
    department: document.getElementById('wbDepartment')?.value || '',
    incidentDate: document.getElementById('wbIncidentDate')?.value || '',
    location: document.getElementById('wbLocation')?.value || '',
    frequency: document.getElementById('wbFrequency')?.value || 'one_time',
    peopleCount: document.getElementById('wbPeopleCount')?.value || 'unknown',
    hasEvidence: document.getElementById('wbHasEvidence')?.value || 'no',
    evidenceDesc: document.getElementById('wbEvidenceDesc')?.value?.trim() || '',
    reportedBefore: document.getElementById('wbReportedBefore')?.value || 'no',
    followUpMethod: followUp,
    anonEmail: followUp === 'anon_email' ? (document.getElementById('wbAnonEmail')?.value?.trim() || '') : '',
    status: 'open', createdAt: new Date().toISOString()
  };
  const wbList = safeLocalParse(WB_REPORTS_STORAGE, []);
  wbList.unshift(wbRecord);
  safeLocalSave(WB_REPORTS_STORAGE, wbList);

  // Also save to main incidents register
  const incident = {
    id: wbRecord.id, title: `Whistleblower Report — ${refNumber}`, type: 'whistleblower',
    severity: urgency === 'high' ? 'high' : urgency === 'medium' ? 'medium' : 'low',
    date: new Date().toISOString().split('T')[0], description: report,
    entities: '', reporter: 'Anonymous', remediation: '',
    category, department: wbRecord.department, status: 'open', createdAt: wbRecord.createdAt,
    wbRef: refNumber
  };
  const list = safeLocalParse(INCIDENTS_STORAGE, []);
  list.unshift(incident);
  safeLocalSave(INCIDENTS_STORAGE, list);

  logAudit('whistleblower', `Anonymous report submitted: ${refNumber}`);
  renderIncidents();
  renderWBReports();

  // Show confirmation with reference number
  const conf = document.getElementById('wbSubmitConfirmation');
  if (conf) {
    conf.style.display = 'block';
    conf.innerHTML = `<div style="font-size:12px;font-weight:700;color:#10B981;margin-bottom:4px">REPORT SUBMITTED SUCCESSFULLY</div>
      <div style="font-size:13px;color:var(--text);margin-bottom:6px">Your reference number: <strong style="font-size:16px;color:var(--gold);letter-spacing:1px">${refNumber}</strong></div>
      <div style="font-size:11px;color:var(--muted)">Save this reference number to track the status of your report. No identifying information has been stored.</div>`;
    setTimeout(() => { conf.style.display = 'none'; }, 15000);
  }

  // Clear form
  document.getElementById('wbReport').value = '';
  document.getElementById('wbEvidenceDesc').value = '';
  document.getElementById('wbAnonEmail').value = '';
  if (document.getElementById('wbIncidentDate')) document.getElementById('wbIncidentDate').value = '';

  toast('Whistleblower report submitted — Ref: ' + refNumber, 'success');
}

function toggleWBLog() {
  const s = document.getElementById('wbLogSection');
  if (s) { s.style.display = s.style.display === 'none' ? 'block' : 'none'; renderWBReports(); }
}

function renderWBReports() {
  const list = safeLocalParse(WB_REPORTS_STORAGE, []);
  const el = document.getElementById('wbReportsList');
  if (!el) return;
  if (!list.length) { el.innerHTML = '<p style="font-size:13px;color:var(--muted)">No whistleblower reports recorded.</p>'; return; }
  el.innerHTML = list.map(r => {
    const urgBadge = r.urgency === 'high' ? 'b-c' : r.urgency === 'medium' ? 'b-m' : 'b-ok';
    const statusBadge = r.status === 'open' ? 's-overdue' : r.status === 'investigating' ? 's-due' : 's-ok';
    const statusLabel = r.status === 'open' ? 'Open' : r.status === 'investigating' ? 'Investigating' : 'Resolved';
    const dt = new Date(r.createdAt).toLocaleDateString('en-GB');
    return `<div class="asana-item" style="margin-bottom:6px">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-size:12px;font-weight:700;color:var(--gold);font-family:'Montserrat',sans-serif">${r.refNumber}</span>
          <span class="badge ${urgBadge}" style="font-size:9px">${(r.urgency||'medium').toUpperCase()}</span>
          <span class="asana-status ${statusBadge}">${statusLabel}</span>
        </div>
        <div style="font-size:12px;color:var(--text);margin-bottom:3px">${escHtml((r.description||'').slice(0,120))}${r.description.length>120?'...':''}</div>
        <div class="asana-meta">${r.category||'—'} | ${r.department||'—'} | ${r.frequency||'—'} | Evidence: ${r.hasEvidence === 'no' ? 'None' : 'Yes'} | ${dt}</div>
      </div>
      <div style="display:flex;gap:4px;align-items:center;flex-shrink:0">
        <button class="btn btn-sm" data-action="updateWBStatus" data-arg="${r.id}" data-arg2="investigating" style="padding:3px 6px;font-size:9px">Investigate</button>
        <button class="btn btn-sm btn-green" data-action="updateWBStatus" data-arg="${r.id}" data-arg2="resolved" style="padding:3px 6px;font-size:9px">Resolve</button>
      </div>
    </div>`;
  }).join('');
}

function updateWBStatus(id, newStatus) {
  const list = safeLocalParse(WB_REPORTS_STORAGE, []);
  const r = list.find(x => x.id === id);
  if (r) { r.status = newStatus; safeLocalSave(WB_REPORTS_STORAGE, list); renderWBReports(); logAudit('whistleblower', `Report ${r.refNumber} status: ${newStatus}`); toast(`Report ${r.refNumber} — ${newStatus}`, 'success'); }
  // Also update in incidents
  const incList = safeLocalParse(INCIDENTS_STORAGE, []);
  const inc = incList.find(x => x.id === id);
  if (inc) { inc.status = newStatus === 'resolved' ? 'closed' : newStatus; safeLocalSave(INCIDENTS_STORAGE, incList); renderIncidents(); }
}

function clearWBReports() {
  if (!confirm('Clear ALL whistleblower reports? This cannot be undone.')) return;
  safeLocalRemove(WB_REPORTS_STORAGE); renderWBReports(); toast('All whistleblower reports cleared', 'success');
}

function exportWBReportsPDF() {
  if (!requireJsPDF()) return;
  const list = safeLocalParse(WB_REPORTS_STORAGE, []);
  if (!list.length) { toast('No reports to export','error'); return; }
  const doc = new jspdf.jsPDF();
  const pw = doc.internal.pageSize.getWidth();
  doc.setFillColor(30,30,30); doc.rect(0,0,pw,28,'F');
  doc.setFontSize(16); doc.setTextColor(180,151,90); doc.text('Whistleblower Reports — Confidential', 14, 18);
  doc.setFontSize(8); doc.setTextColor(120); doc.text('Generated: ' + new Date().toLocaleDateString('en-GB'), pw-14, 18, {align:'right'});
  let y = 36;
  list.forEach((r, idx) => {
    if (y > 250) { doc.addPage(); y = 20; }
    doc.setFillColor(40,40,40); doc.rect(14, y-4, pw-28, 8, 'F');
    doc.setFontSize(10); doc.setTextColor(180,151,90); doc.text(r.refNumber + ' — ' + (r.category||''), 16, y+1);
    doc.setTextColor(r.urgency==='high'?[217,79,79]:r.urgency==='medium'?[232,168,56]:[76,175,80]); doc.text((r.urgency||'').toUpperCase(), pw-16, y+1, {align:'right'});
    y += 10;
    doc.setFontSize(8); doc.setTextColor(160);
    doc.text(`Status: ${r.status} | Dept: ${r.department||'—'} | Location: ${r.location||'—'} | Frequency: ${r.frequency||'—'} | Evidence: ${r.hasEvidence||'—'}`, 16, y); y += 5;
    if (r.description) { const lines = doc.splitTextToSize(r.description, pw-32); doc.text(lines, 16, y); y += lines.length * 4; }
    y += 8;
  });
  doc.save('Whistleblower_Reports_CONFIDENTIAL_' + new Date().toISOString().slice(0,10) + '.pdf');
  toast('PDF exported','success');
}

function exportWBReportsDOCX() {
  const list = safeLocalParse(WB_REPORTS_STORAGE, []);
  if (!list.length) { toast('No reports to export','error'); return; }
  let html = wordDocHeader('Whistleblower Reports — Confidential');
  html += '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:10px">';
  html += '<tr><th style="background:#B4975A;color:#fff">Ref</th><th style="background:#B4975A;color:#fff">Category</th><th style="background:#B4975A;color:#fff">Urgency</th><th style="background:#B4975A;color:#fff">Status</th><th style="background:#B4975A;color:#fff">Department</th><th style="background:#B4975A;color:#fff">Description</th></tr>';
  list.forEach(r => {
    html += '<tr><td>' + escHtml(r.refNumber) + '</td><td>' + escHtml(r.category) + '</td><td>' + escHtml(r.urgency) + '</td><td>' + escHtml(r.status) + '</td><td>' + escHtml(r.department) + '</td><td>' + escHtml(r.description) + '</td></tr>';
  });
  html += '</table>' + wordDocFooter();
  downloadWordDoc(html, 'Whistleblower_Reports_' + new Date().toISOString().slice(0,10) + '.doc');
  toast('Word export complete','success');
}

function exportWBReportsCSV() {
  const list = safeLocalParse(WB_REPORTS_STORAGE, []);
  if (!list.length) { toast('No reports to export','error'); return; }
  const headers = ['Ref Number','Category','Urgency','Status','Department','Location','Frequency','Has Evidence','Description','Date'];
  const rows = list.map(r => [r.refNumber,r.category,r.urgency,r.status,r.department,r.location,r.frequency,r.hasEvidence,r.description,r.date]);
  const csv = [headers,...rows].map(r=>r.map(c=>'"'+String(c||'').replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob = new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='Whistleblower_Reports_'+new Date().toISOString().slice(0,10)+'.csv';a.click();
  toast('CSV exported','success');
}

// ======= DASHBOARD =======
const AUDIT_STORAGE = 'fgl_audit_trail';
function logAudit(action, detail) {
  const trail = safeLocalParse(AUDIT_STORAGE, []);
  trail.unshift({ ts:new Date().toISOString(), action, detail, user:'Current User' });
  safeLocalSave(AUDIT_STORAGE, trail.slice(0,500));
}

function refreshDashboard() {
  const gaps = safeLocalParse('fgl_gaps_v2', []);
  const incidents = safeLocalParse(INCIDENTS_STORAGE, []);
  const screenings = safeLocalParse(SCREENING_STORAGE, []);
  const customers = safeLocalParse(ONBOARDING_STORAGE, []);
  const deadlines = safeLocalParse(CALENDAR_STORAGE, []);

  const openGaps = gaps.filter(g=>g.status!=='closed'&&g.status!=='resolved').length;
  const openIncidents = incidents.filter(i=>i.status==='open').length;
  const now = new Date();
  const thirtyDaysAgo = new Date(now-30*24*60*60*1000);
  const recentScreenings = screenings.filter(s=>new Date(s.date)>thirtyDaysAgo).length;

  document.getElementById('dashOpenGaps').textContent = openGaps;
  document.getElementById('dashOverdueTasks').textContent = openIncidents;
  document.getElementById('dashPendingReviews').textContent = deadlines.filter(d=>new Date(d.date)<=new Date(now.getTime()+7*24*60*60*1000)&&!d.completed).length;
  document.getElementById('dashScreenings').textContent = recentScreenings;

  const avgRisk = customers.length ? Math.round(customers.reduce((s,c)=>s+(c.risk?.score||0),0)/customers.length) : 0;
  document.getElementById('dashRiskScore').textContent = customers.length ? avgRisk+'/100' : '—';

  let crit=0,high=0,med=0,low=0;
  customers.forEach(c=>{ const l=c.risk?.level||'LOW'; if(l==='CRITICAL')crit++;else if(l==='HIGH')high++;else if(l==='MEDIUM')med++;else low++; });
  document.getElementById('heatCritical').textContent=crit;
  document.getElementById('heatHigh').textContent=high;
  document.getElementById('heatMedium').textContent=med;
  document.getElementById('heatLow').textContent=low;

  const trail = safeLocalParse(AUDIT_STORAGE, []);
  const trailEl = document.getElementById('auditTrailList');
  trailEl.innerHTML = trail.length ? trail.slice(0,50).map(t=>`<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12px"><span style="color:var(--gold);font-family:'Montserrat',sans-serif">${new Date(t.ts).toLocaleString('en-GB')}</span> <span style="color:var(--muted)">[${escHtml(t.action)}]</span> ${escHtml(t.detail)}</div>`).join('') : '<p style="font-size:13px;color:var(--muted)">No activity yet.</p>';

  // Key Compliance Indicators
  const indicatorsEl = document.getElementById('dashComplianceIndicators');
  if (indicatorsEl) {
    const training = safeLocalParse(TRAINING_STORAGE, []);
    const riskAssessments = safeLocalParse(RA_STORAGE, []);
    const ewra = safeLocalParse('fgl_ewra', []);
    const bwra = safeLocalParse('fgl_bwra', []);
    const approvals = safeLocalParse('fgl_mgmt_approvals', []);
    const wfLog = safeLocalParse('fgl_workflow_log', []);
    const totalEmployees = training.length;
    const trainedCount = training.filter(t => {
      const subs = t.subjects || {};
      const done = Object.values(subs).filter(v => v === true || (v && v.completed)).length;
      return done > 0;
    }).length;
    const raCount = riskAssessments.length;
    const lastRA = riskAssessments[0];
    const totalCustomers = customers.length;
    const highRiskCustomers = customers.filter(c => (c.risk?.level||'').toUpperCase() === 'HIGH' || (c.risk?.level||'').toUpperCase() === 'CRITICAL').length;
    const pendingDeadlines = deadlines.filter(d => !d.completed && new Date(d.date) > now).length;
    const overdueDeadlines = deadlines.filter(d => !d.completed && new Date(d.date) <= now).length;

    const indicators = [
      { lbl:'EMPLOYEES TRAINED', val: totalEmployees ? trainedCount+'/'+totalEmployees : '0', col: trainedCount===totalEmployees && totalEmployees>0 ? 'var(--green)' : 'var(--amber)', icon:'👥' },
      { lbl:'RISK ASSESSMENTS', val: String(raCount), col: raCount > 0 ? 'var(--green)' : 'var(--red)', icon:'⚖️' },
      { lbl:'LAST RA SCORE', val: lastRA ? lastRA.totalScore+' ('+lastRA.determination+')' : '—', col: lastRA ? (lastRA.totalScore>=23?'var(--red)':lastRA.totalScore>=20?'var(--amber)':'var(--green)') : 'var(--muted)', icon:'📊' },
      { lbl:'EWRA / BWRA', val: ewra.length+' / '+bwra.length, col: ewra.length>0&&bwra.length>0 ? 'var(--green)' : 'var(--amber)', icon:'📋' },
      { lbl:'CUSTOMERS ONBOARDED', val: String(totalCustomers), col: 'var(--gold)', icon:'🏢' },
      { lbl:'HIGH-RISK CUSTOMERS', val: String(highRiskCustomers), col: highRiskCustomers > 0 ? 'var(--red)' : 'var(--green)', icon:'⚠️' },
      { lbl:'PENDING DEADLINES', val: String(pendingDeadlines), col: 'var(--blue,#5B8DEF)', icon:'📅' },
      { lbl:'OVERDUE DEADLINES', val: String(overdueDeadlines), col: overdueDeadlines > 0 ? 'var(--red)' : 'var(--green)', icon:'🔴' },
      { lbl:'APPROVALS', val: String(approvals.length), col: 'var(--gold)', icon:'✅' },
      { lbl:'WORKFLOW RUNS', val: String(wfLog.length), col: 'var(--gold)', icon:'⚡' },
      { lbl:'OPEN INCIDENTS', val: String(openIncidents), col: openIncidents > 0 ? 'var(--red)' : 'var(--green)', icon:'🚨' },
      { lbl:'SCREENINGS (30D)', val: String(recentScreenings), col: recentScreenings > 0 ? 'var(--green)' : 'var(--amber)', icon:'🔍' },
    ];
    indicatorsEl.innerHTML = indicators.map(ind => `<div style="background:rgba(201,168,76,0.05);border-radius:3px;padding:10px;border-left:3px solid ${ind.col}">
      <div style="font-size:9px;color:var(--muted);font-family:'Montserrat',sans-serif;letter-spacing:0.5px">${escHtml(ind.icon)} ${escHtml(ind.lbl)}</div>
      <div style="font-size:16px;font-weight:700;color:${ind.col};margin-top:4px">${ind.val}</div>
    </div>`).join('');
  }

  // Upcoming Deadlines widget
  const deadlinesEl = document.getElementById('dashUpcomingDeadlines');
  if (deadlinesEl) {
    const upcoming = deadlines.filter(d => !d.completed).sort((a,b) => new Date(a.date)-new Date(b.date)).slice(0,10);
    if (upcoming.length) {
      deadlinesEl.innerHTML = upcoming.map(d => {
        const due = new Date(d.date);
        const diff = Math.ceil((due - now)/(1000*60*60*24));
        const col = diff < 0 ? 'var(--red)' : diff <= 7 ? 'var(--amber)' : 'var(--green)';
        const label = diff < 0 ? Math.abs(diff)+'d OVERDUE' : diff === 0 ? 'TODAY' : diff+'d left';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:11px">
          <div><span style="font-weight:600">${escHtml(d.title)}</span> <span style="color:var(--muted);font-size:10px;margin-left:6px">${d.category||''}</span></div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:10px;color:var(--muted);font-family:'Montserrat',sans-serif">${d.date}</span>
            <span style="font-size:9px;padding:2px 8px;font-weight:700;background:${diff<0?'rgba(248,81,73,0.1)':diff<=7?'rgba(227,179,65,0.1)':'rgba(63,185,80,0.1)'};color:${col};border:1px solid ${col}">${label}</span>
          </div>
        </div>`;
      }).join('');
    } else {
      deadlinesEl.innerHTML = '<p style="font-size:11px;color:var(--muted)">No upcoming deadlines. Add them in the Calendar tab.</p>';
    }
  }

  // Capture analytics snapshot and notify workflow engine
  if (typeof AnalyticsDashboard !== 'undefined') AnalyticsDashboard.captureSnapshot();
}

async function exportBoardReport() {
  const gaps = safeLocalParse('fgl_gaps_v2', []);
  const incidents = safeLocalParse(INCIDENTS_STORAGE, []);
  const screenings = safeLocalParse(SCREENING_STORAGE, []);
  const customers = safeLocalParse(ONBOARDING_STORAGE, []);

  try {
    const data = await callAI({ model:'claude-haiku-4-5', max_tokens:2000, temperature:0,
      system:'You are a MLRO writing a board compliance report. Be concise, professional, structured.',
      messages:[{role:'user',content:`Generate a Board/MLRO Compliance Report based on:\nOpen Gaps: ${gaps.filter(g=>g.status!=='closed').length}\nTotal Incidents: ${incidents.length} (Open: ${incidents.filter(i=>i.status==='open').length})\nScreenings (30d): ${screenings.length}\nCustomers Onboarded: ${customers.length}\nHigh Risk Customers: ${customers.filter(c=>c.risk?.level==='HIGH'||c.risk?.level==='CRITICAL').length}\n\nIncident Summary: ${incidents.slice(0,5).map(i=>`${i.severity}: ${i.title}`).join('; ')}`}]
    });
    const text = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
    document.getElementById('boardReportPreview').innerHTML = `<div class="summary-box" style="white-space:pre-wrap;font-size:12px">${escHtml(text)}</div><div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-sm btn-green" data-action="_copyBoardReport">Copy Report</button></div>`;
    logAudit('board_report', 'Board report generated');
  } catch(e) { if(isBillingError(e)){toast('API credits exhausted — report generation unavailable. Add credits at console.anthropic.com.','info',8000)}else{toast(`Report error: ${e.message}`,'error')} }
}

// ======= REGULATORY CALENDAR =======
const CALENDAR_STORAGE = 'fgl_calendar';
const UAE_CALENDAR = [
  // Regulatory Filings
  {title:'UAE Central Bank AML/CFT Annual Return',category:'regulatory',month:3,day:31,recurring:true},
  {title:'goAML System — Annual STR Review',category:'regulatory',month:1,day:31,recurring:true},
  {title:'MOE DPMS Annual Compliance Report',category:'regulatory',month:3,day:31,recurring:true},
  {title:'MOE DPMS Supervisory Inspection Readiness Review',category:'regulatory',month:0,day:0,recurring:false,note:'As scheduled by MOE'},
  {title:'FIU Annual Activity Report Submission',category:'regulatory',month:2,day:28,recurring:true},
  {title:'Beneficial Ownership Register — Annual Update (Cabinet Decision 109/2023)',category:'regulatory',month:6,day:30,recurring:true},
  {title:'TFS Compliance Declaration — Annual',category:'regulatory',month:1,day:31,recurring:true},
  // Licenses & Registrations
  {title:'Trade License Renewal',category:'license',month:12,day:31,recurring:true},
  {title:'DMCC Membership Renewal',category:'license',month:0,day:0,recurring:false,note:'Per license expiry date'},
  {title:'Dubai Good Delivery (DGD) Accreditation Renewal',category:'license',month:0,day:0,recurring:false,note:'Per accreditation cycle'},
  {title:'LBMA Good Delivery Accreditation Review',category:'license',month:0,day:0,recurring:false,note:'Per LBMA cycle'},
  {title:'Import/Export Permit Renewal',category:'license',month:0,day:0,recurring:false,note:'Per permit expiry'},
  // Audits & Assurance
  {title:'LBMA Responsible Gold Guidance — Annual Report',category:'audit',month:6,day:30,recurring:true},
  {title:'Independent AML/CFT Audit',category:'audit',month:12,day:1,recurring:true},
  {title:'LBMA Independent Third-Party Audit (Step 5)',category:'audit',month:6,day:30,recurring:true},
  {title:'Internal Compliance Audit — Annual',category:'audit',month:9,day:30,recurring:true},
  {title:'External Financial Audit',category:'audit',month:4,day:30,recurring:true},
  {title:'Supply Chain Due Diligence Audit',category:'audit',month:0,day:0,recurring:false,note:'Annual — per OECD Guidance'},
  // Risk Assessments
  {title:'EWRA — Entity-Wide Risk Assessment Annual Review',category:'review',month:1,day:31,recurring:true},
  {title:'BWRA — Business-Wide Risk Assessment Annual Review',category:'review',month:1,day:31,recurring:true},
  {title:'Risk Assessment Update — Bi-Annual',category:'review',month:6,day:30,recurring:true},
  {title:'Customer Risk Re-Classification Review',category:'review',month:0,day:0,recurring:false,note:'Annual for all active customers'},
  {title:'New Product/Service Risk Assessment',category:'review',month:0,day:0,recurring:false,note:'Before launch of any new product'},
  // Policies & Manuals
  {title:'AML/CFT Policy Annual Review',category:'review',month:1,day:1,recurring:true},
  {title:'Compliance Manual Annual Update',category:'review',month:2,day:1,recurring:true},
  {title:'Responsible Sourcing Policy Review',category:'review',month:3,day:1,recurring:true},
  {title:'Sanctions & TFS Policy Review',category:'review',month:1,day:1,recurring:true},
  {title:'Data Protection & Privacy Policy Review',category:'review',month:6,day:1,recurring:true},
  {title:'Whistleblower Policy Review',category:'review',month:6,day:1,recurring:true},
  // Training
  {title:'Employee AML/CFT Training — Annual',category:'training',month:3,day:1,recurring:true},
  {title:'Board & Senior Management AML Briefing',category:'training',month:1,day:15,recurring:true},
  {title:'New Employee Induction — AML/CFT Module',category:'training',month:0,day:0,recurring:false,note:'Within 30 days of joining'},
  {title:'Sanctions & TFS Awareness Training',category:'training',month:6,day:1,recurring:true},
  {title:'Responsible Sourcing & LBMA Training',category:'training',month:4,day:1,recurring:true},
  {title:'goAML System Training Refresher',category:'training',month:9,day:1,recurring:true},
  {title:'Red Flag Indicators Workshop — DPMS Specific',category:'training',month:6,day:15,recurring:true},
  // Ongoing Monitoring
  {title:'Sanctions List Update Check',category:'regulatory',month:0,day:0,recurring:false,note:'Daily / Weekly'},
  {title:'Transaction Monitoring Review',category:'review',month:0,day:0,recurring:false,note:'Quarterly'},
  {title:'UBO Verification Refresh',category:'review',month:0,day:0,recurring:false,note:'Annual for all active customers'},
  {title:'PEP Screening Refresh — All Customers',category:'review',month:0,day:0,recurring:false,note:'Quarterly'},
  {title:'Adverse Media Screening — All Customers',category:'review',month:0,day:0,recurring:false,note:'Quarterly'},
  {title:'High-Risk Customer Enhanced Review',category:'review',month:0,day:0,recurring:false,note:'Quarterly'},
  {title:'Medium-Risk Customer Periodic Review',category:'review',month:0,day:0,recurring:false,note:'Semi-Annual'},
  {title:'Low-Risk Customer Periodic Review',category:'review',month:0,day:0,recurring:false,note:'Annual'},
  // FATF & International
  {title:'FATF Grey/Black List Review',category:'fatf',month:2,day:1,recurring:true},
  {title:'FATF Plenary Outcomes Review',category:'fatf',month:6,day:15,recurring:true},
  {title:'FATF Plenary Outcomes Review — October',category:'fatf',month:10,day:15,recurring:true},
  {title:'UAE National Risk Assessment — Monitor Updates',category:'regulatory',month:0,day:0,recurring:false,note:'As published'},
  {title:'Basel AML Index — Annual Country Risk Update',category:'review',month:9,day:1,recurring:true},
  // Governance & Reporting
  {title:'Compliance Committee Meeting — Quarterly',category:'review',month:0,day:0,recurring:false,note:'Quarterly'},
  {title:'MLRO Annual Report to Board',category:'regulatory',month:1,day:31,recurring:true},
  {title:'Board Compliance Oversight Meeting',category:'review',month:0,day:0,recurring:false,note:'Semi-Annual'},
  {title:'Compliance KPI Dashboard Review',category:'review',month:0,day:0,recurring:false,note:'Monthly'},
  {title:'Incident & Breach Log Review',category:'review',month:0,day:0,recurring:false,note:'Quarterly'},
  {title:'Gap Register Status Review',category:'review',month:0,day:0,recurring:false,note:'Monthly'},
  {title:'RACI Matrix Annual Review',category:'review',month:3,day:1,recurring:true},

  // ─── Sanctions & TFS (UN, OFAC, EU, UK, UAE EOCN, HMT) ───
  {title:'UN Security Council Consolidated List Refresh',category:'regulatory',month:0,day:0,recurring:false,note:'Daily — automated TFS engine check'},
  {title:'OFAC SDN List Refresh',category:'regulatory',month:0,day:0,recurring:false,note:'Daily — Cabinet Res 74/2020'},
  {title:'EU Consolidated Sanctions List Refresh',category:'regulatory',month:0,day:0,recurring:false,note:'Daily — Council Reg 2580/2001'},
  {title:'UK HMT OFSI Consolidated List Refresh',category:'regulatory',month:0,day:0,recurring:false,note:'Daily — UK SAMLA 2018'},
  {title:'UAE EOCN Local Terrorist List Refresh',category:'regulatory',month:0,day:0,recurring:false,note:'Real-time — Cabinet Res 74/2020 Art.4'},
  {title:'EOCN 24h Asset Freeze Response Window',category:'regulatory',month:0,day:0,recurring:false,note:'Event-driven — Cabinet Res 74/2020 Art.4-7 (24 clock hours, NOT business days)'},
  {title:'CNMR Filing — 5 Business Day Deadline',category:'regulatory',month:0,day:0,recurring:false,note:'Event-driven — Cabinet Res 74/2020 (post-freeze report to EOCN)'},
  {title:'TFS False-Positive Audit Review',category:'audit',month:6,day:30,recurring:true,note:'Semi-annual'},

  // ─── goAML Filings (FIU UAE) ───
  {title:'goAML Portal Account Re-Verification',category:'regulatory',month:0,day:1,recurring:true,note:'Annual'},
  {title:'STR (Suspicious Transaction Report) — 10 Business Day Filing',category:'regulatory',month:0,day:0,recurring:false,note:'Event-driven — FDL No.10/2025 Art.26-27'},
  {title:'SAR (Suspicious Activity Report) — 10 Business Day Filing',category:'regulatory',month:0,day:0,recurring:false,note:'Event-driven — FDL No.10/2025 Art.26-27'},
  {title:'CTR (Cash Transaction Report) — 15 Business Day Filing',category:'regulatory',month:0,day:0,recurring:false,note:'Event-driven — AED 55K threshold (MoE Circular 08/AML/2021)'},
  {title:'DPMSR (DPMS Report) — Quarterly Filing',category:'regulatory',month:2,day:31,recurring:true,note:'Q1 — MoE Circular 08/AML/2021'},
  {title:'DPMSR (DPMS Report) — Quarterly Filing',category:'regulatory',month:5,day:30,recurring:true,note:'Q2'},
  {title:'DPMSR (DPMS Report) — Quarterly Filing',category:'regulatory',month:8,day:30,recurring:true,note:'Q3'},
  {title:'DPMSR (DPMS Report) — Quarterly Filing',category:'regulatory',month:11,day:31,recurring:true,note:'Q4'},
  {title:'goAML XML Schema Compatibility Check',category:'regulatory',month:0,day:0,recurring:false,note:'On every FIU schema update'},

  // ─── DPMS-Specific Thresholds & Reports (MoE Circular 08/AML/2021) ───
  {title:'AED 55,000 DPMS Cash Transaction Threshold Review',category:'review',month:0,day:0,recurring:false,note:'Per-transaction trigger — MoE Circular 08/AML/2021'},
  {title:'AED 60,000 Cross-Border Cash/BNI Declaration',category:'regulatory',month:0,day:0,recurring:false,note:'Per-transaction trigger — Cabinet Res 134/2025 Art.16'},
  {title:'DPMS Sector Risk Assessment — Annual',category:'review',month:1,day:31,recurring:true,note:'MoE Circular 08/AML/2021'},
  {title:'High-Value Goods Transaction Pattern Analysis',category:'review',month:0,day:0,recurring:false,note:'Quarterly'},

  // ─── UBO & Beneficial Ownership (Cabinet Decision 109/2023) ───
  {title:'UBO Re-Verification Window — 15 Working Days After Change',category:'regulatory',month:0,day:0,recurring:false,note:'Event-driven — Cabinet Decision 109/2023'},
  {title:'UBO Register Annual Submission to Registrar',category:'regulatory',month:6,day:30,recurring:true},
  {title:'25%+ Ownership Threshold Audit',category:'audit',month:0,day:0,recurring:false,note:'Quarterly'},
  {title:'Shell Company / Layering Detection Review',category:'review',month:0,day:0,recurring:false,note:'Quarterly'},

  // ─── Customer Due Diligence (CDD/EDD/SDD) ───
  {title:'EDD (Enhanced Due Diligence) Review — High-Risk Customers',category:'review',month:0,day:0,recurring:false,note:'Every 3 months — Cabinet Res 134/2025 Art.7-10'},
  {title:'CDD (Standard Due Diligence) Review',category:'review',month:0,day:0,recurring:false,note:'Every 6 months'},
  {title:'SDD (Simplified Due Diligence) Review',category:'review',month:0,day:0,recurring:false,note:'Annual'},
  {title:'Customer Source of Funds Re-Verification',category:'review',month:0,day:0,recurring:false,note:'Annual or on material change'},
  {title:'Customer Source of Wealth Re-Verification',category:'review',month:0,day:0,recurring:false,note:'Annual for high-risk'},
  {title:'PEP Status Re-Screening',category:'review',month:0,day:0,recurring:false,note:'Quarterly — Cabinet Res 134/2025 Art.14'},

  // ─── LBMA & Responsible Sourcing of Gold ───
  {title:'LBMA RGG v9 Annual Compliance Report',category:'audit',month:6,day:30,recurring:true},
  {title:'LBMA Step 1 — Strong Management Systems Review',category:'audit',month:3,day:1,recurring:true},
  {title:'LBMA Step 2 — Risk Identification & Assessment',category:'audit',month:3,day:15,recurring:true},
  {title:'LBMA Step 3 — Risk Management Strategy',category:'audit',month:3,day:30,recurring:true},
  {title:'LBMA Step 4 — Independent Audit',category:'audit',month:6,day:30,recurring:true},
  {title:'LBMA Step 5 — Annual Report Publication',category:'audit',month:8,day:31,recurring:true},
  {title:'CAHRA (Conflict-Affected & High-Risk Areas) Mitigation Review',category:'review',month:0,day:0,recurring:false,note:'Quarterly — OECD Annex II'},
  {title:'ASM (Artisanal & Small-Scale Mining) Compliance Audit',category:'audit',month:6,day:30,recurring:true},
  {title:'Refiner Due Diligence Review',category:'review',month:0,day:0,recurring:false,note:'Quarterly — UAE MoE RSG'},
  {title:'Origin Traceability Records Review',category:'review',month:0,day:0,recurring:false,note:'Per shipment + monthly aggregate'},
  {title:'Dubai Good Delivery (DGD) Hallmark & Assay Verification',category:'review',month:0,day:0,recurring:false,note:'Per refining batch'},

  // ─── PF / Dual-Use / Strategic Goods (Cabinet Res 156/2025) ───
  {title:'Proliferation Financing Risk Assessment',category:'review',month:5,day:1,recurring:true,note:'Cabinet Res 156/2025'},
  {title:'Strategic Goods Screening Review',category:'review',month:0,day:0,recurring:false,note:'Quarterly'},
  {title:'Dual-Use Goods Export Control Audit',category:'audit',month:9,day:1,recurring:true},

  // ─── Penalties & Enforcement ───
  {title:'Cabinet Res 71/2024 Penalty Schedule Review',category:'review',month:0,day:1,recurring:true,note:'Annual — AED 10K-100M penalty range'},
  {title:'Internal Penalty Self-Assessment',category:'review',month:5,day:30,recurring:true},

  // ─── AI Governance & Algorithmic Compliance ───
  {title:'EU AI Act (Reg 2024/1689) Compliance Self-Audit',category:'audit',month:7,day:31,recurring:true,note:'Annual'},
  {title:'NIST AI RMF 1.0 Annual Review',category:'review',month:7,day:31,recurring:true},
  {title:'ISO/IEC 42001:2023 AI Management System Audit',category:'audit',month:9,day:30,recurring:true},
  {title:'UAE AI Charter Compliance Review',category:'review',month:11,day:1,recurring:true},
  {title:'AI Decision Provenance Spot-Check',category:'review',month:0,day:0,recurring:false,note:'Monthly'},
  {title:'AI Output Human Review Log Audit',category:'audit',month:0,day:0,recurring:false,note:'Quarterly — Cabinet Res 134/2025 Art.24'},
  {title:'AI Model Bias & Fairness Re-Test',category:'review',month:5,day:1,recurring:true},

  // ─── Data Protection (UAE PDPL / GDPR) ───
  {title:'PDPL (UAE Federal Decree-Law 45/2021) Compliance Audit',category:'audit',month:8,day:31,recurring:true},
  {title:'Data Subject Access Request (DSAR) Backlog Review',category:'review',month:0,day:0,recurring:false,note:'Monthly'},
  {title:'Data Breach Response Plan Drill',category:'training',month:5,day:15,recurring:true},
  {title:'Customer Data Retention Audit (10-Year Rule)',category:'audit',month:11,day:30,recurring:true,note:'FDL No.10/2025 Art.24'},

  // ─── Tax & VAT (UAE FTA) ───
  {title:'VAT Return Filing — Q1',category:'regulatory',month:3,day:28,recurring:true,note:'UAE FTA'},
  {title:'VAT Return Filing — Q2',category:'regulatory',month:6,day:28,recurring:true},
  {title:'VAT Return Filing — Q3',category:'regulatory',month:9,day:28,recurring:true},
  {title:'VAT Return Filing — Q4',category:'regulatory',month:0,day:28,recurring:true},
  {title:'Corporate Tax Filing (UAE)',category:'regulatory',month:8,day:30,recurring:true,note:'Annual — within 9 months of fiscal year end'},
  {title:'Excise Tax Filing — Monthly',category:'regulatory',month:0,day:15,recurring:false,note:'Monthly — UAE FTA'},

  // ─── Operational & Internal Controls ───
  {title:'Four-Eyes Approval Sample Audit',category:'audit',month:0,day:0,recurring:false,note:'Monthly — Cabinet Res 134/2025 Art.19'},
  {title:'MLRO Independence Self-Assessment',category:'review',month:5,day:1,recurring:true},
  {title:'Compliance Officer Change Notification',category:'regulatory',month:0,day:0,recurring:false,note:'Event-driven — Cabinet Res 134/2025 Art.18'},
  {title:'Internal Whistleblower Channel Test',category:'review',month:5,day:1,recurring:true},
  {title:'Information Security & Cyber Resilience Drill',category:'training',month:8,day:1,recurring:true},
  {title:'Business Continuity Plan Test',category:'training',month:9,day:1,recurring:true},
  {title:'Disaster Recovery Drill',category:'training',month:10,day:1,recurring:true},
  {title:'Penetration Test (External Vendor)',category:'audit',month:5,day:30,recurring:true},
  {title:'Red-Team Exercise — Compliance Workflows',category:'audit',month:11,day:1,recurring:true},

  // ─── Regulatory Watch & Horizon Scanning ───
  {title:'New MoE Circular Impact Assessment — 30-Day Window',category:'regulatory',month:0,day:0,recurring:false,note:'Event-driven — policy update deadline'},
  {title:'CBUAE Notice & Guidance Review',category:'regulatory',month:0,day:0,recurring:false,note:'Weekly'},
  {title:'EU AML Package Updates Tracking',category:'regulatory',month:0,day:0,recurring:false,note:'Monthly'},
  {title:'OECD Common Reporting Standard (CRS) Review',category:'regulatory',month:4,day:30,recurring:true},
  {title:'FATCA Reporting (US Persons)',category:'regulatory',month:5,day:30,recurring:true},

  // ─── Counterparty & Supplier Management ───
  {title:'Counterparty Sanctions Re-Screening — All Active',category:'review',month:0,day:0,recurring:false,note:'Monthly'},
  {title:'Supplier RGG Compliance Re-Verification',category:'review',month:0,day:0,recurring:false,note:'Annual + on material change'},
  {title:'New Supplier Onboarding KYC',category:'review',month:0,day:0,recurring:false,note:'Per supplier — pre-engagement'},
  {title:'Counterparty CRA (Counterparty Risk Assessment) Refresh',category:'review',month:0,day:0,recurring:false,note:'Annual'},

  // ─── ESG & Sustainability ───
  {title:'Annual ESG Disclosure',category:'review',month:2,day:31,recurring:true},
  {title:'Carbon Footprint Reporting',category:'review',month:5,day:30,recurring:true},
  {title:'Modern Slavery Statement (UK MSA equivalent)',category:'regulatory',month:8,day:30,recurring:true},
  {title:'Conflict Minerals Disclosure',category:'regulatory',month:4,day:31,recurring:true,note:'Dodd-Frank Sec.1502'},

  // ─── Board, Governance & Senior Management ───
  {title:'Board Audit Committee Meeting',category:'review',month:0,day:0,recurring:false,note:'Quarterly'},
  {title:'Board Risk Committee Meeting',category:'review',month:0,day:0,recurring:false,note:'Quarterly'},
  {title:'Senior Management AML Effectiveness Review',category:'review',month:5,day:1,recurring:true},
  {title:'Risk Appetite Statement Annual Review',category:'review',month:1,day:31,recurring:true,note:'Cabinet Res 134/2025 Art.5'},
  {title:'Compliance Programme Effectiveness Review',category:'review',month:1,day:31,recurring:true,note:'Annual'},
  {title:'Board Compliance Training (CO duty of care)',category:'training',month:1,day:15,recurring:true,note:'FDL No.10/2025 Art.20-21'},
];

function showNewDeadlineForm() { document.getElementById('newDeadlineForm').style.display='block'; }
function hideNewDeadlineForm() { document.getElementById('newDeadlineForm').style.display='none'; }

function saveDeadline() {
  const title = document.getElementById('calTitle').value.trim();
  const date = document.getElementById('calDate').value;
  if (!title||!date) { toast('Fill in title and date','error'); return; }
  const dl = {
    id:Date.now(), title, date, category:document.getElementById('calCategory').value,
    remind:parseInt(document.getElementById('calRemind').value)||7,
    notes:document.getElementById('calNotes').value.trim(), completed:false
  };
  const list = safeLocalParse(CALENDAR_STORAGE, []);
  list.push(dl);
  list.sort((a,b)=>new Date(a.date)-new Date(b.date));
  safeLocalSave(CALENDAR_STORAGE, list);
  renderDeadlines();
  hideNewDeadlineForm();
  logAudit('calendar', `Deadline added: ${title} (${date})`);
  toast('Deadline saved','success');
  // Asana sync — create deadline task
  const dueDate = new Date(date);
  const remindDate = new Date(dueDate); remindDate.setDate(remindDate.getDate() - (dl.remind||7));
  autoSyncToAsana(
    `DEADLINE: ${title}`,
    `Compliance Deadline\nTitle: ${title}\nDue Date: ${date}\nCategory: ${dl.category}\nReminder: ${dl.remind} days before\n${dl.notes?'Notes: '+dl.notes:''}`,
    Math.max(1, Math.ceil((dueDate - new Date())/(1000*60*60*24)))
  ).then(gid => { if (gid) toast('Deadline synced to Asana','success',2000); });
}

function renderDeadlines() {
  const list = safeLocalParse(CALENDAR_STORAGE, []);
  const el = document.getElementById('deadlinesList');
  const now = new Date(); now.setHours(0,0,0,0);
  if (!list.length) { el.innerHTML='<p style="font-size:13px;color:var(--muted)">No deadlines set. Add one above or use the pre-loaded UAE calendar.</p>'; return; }
  el.innerHTML = list.map(d=>{
    const due = new Date(d.date);
    const diff = Math.ceil((due-now)/(1000*60*60*24));
    const status = d.completed?'s-ok':diff<0?'s-overdue':diff<=7?'s-due':'s-ok';
    const label = d.completed?'DONE':diff<0?`${-diff}d OVERDUE`:diff===0?'TODAY':`${diff}d left`;
    return `<div class="asana-item"><div><div class="asana-name">${d.title}</div><div class="asana-meta">${d.category} | ${d.date} ${d.notes?'| '+d.notes:''}</div></div><div style="display:flex;gap:6px"><span class="asana-status ${status}">${label}</span><button class="btn btn-sm btn-green" data-action="toggleDeadline" data-arg="${d.id}" style="padding:3px 8px;font-size:10px">${d.completed?'Undo':'Done'}</button></div></div>`;
  }).join('');
}

function toggleDeadline(id) {
  const list = safeLocalParse(CALENDAR_STORAGE, []);
  const d = list.find(x=>x.id===id);
  if(d) { d.completed=!d.completed; safeLocalSave(CALENDAR_STORAGE, list); renderDeadlines(); }
}

function renderPreloadedCalendar() {
  document.getElementById('preloadedCalendar').innerHTML = UAE_CALENDAR.map(c=>
    `<div class="asana-item"><div><div class="asana-name">${c.title}</div><div class="asana-meta">${c.category} ${c.recurring?'| Recurring':''}${c.note?' | '+c.note:''}</div></div><button class="btn btn-sm btn-green" data-action="_addPreloadedDeadline" data-title="${c.title.replace(/"/g,'&quot;')}" data-category="${c.category}" data-month="${c.month||0}" data-day="${c.day||0}" style="padding:3px 8px;font-size:10px">+ Add</button></div>`
  ).join('');
}

function addPreloadedDeadline(title, category, month, day) {
  const year = new Date().getFullYear();
  document.getElementById('calTitle').value = title;
  document.getElementById('calCategory').value = category;
  const m = (month && day) ? String(month).padStart(2,'0') : '12';
  const d = (month && day) ? String(day).padStart(2,'0') : '31';
  document.getElementById('calDate').value = `${year}-${m}-${d}`;
  showNewDeadlineForm();
  if (!month || !day) toast('Edit the date and save','info');
}

// ======= DOCUMENT VAULT =======
const VAULT_STORAGE = 'fgl_vault';
function showNewVaultDoc() { document.getElementById('newVaultForm').style.display='block'; }
function hideNewVaultDoc() { document.getElementById('newVaultForm').style.display='none'; }

function saveVaultDoc() {
  const name = document.getElementById('vaultName').value.trim();
  if (!name) { toast('Enter document name','error'); return; }
  const doc = {
    id:Date.now(), name, category:document.getElementById('vaultCategory').value,
    url:document.getElementById('vaultUrl').value.trim(),
    expiry:document.getElementById('vaultExpiry').value,
    tags:(document.getElementById('vaultTags').value||'').split(',').map(t=>t.trim()).filter(Boolean),
    version:document.getElementById('vaultVersion').value.trim(),
    notes:document.getElementById('vaultNotes').value.trim(),
    addedAt:new Date().toISOString()
  };
  const list = safeLocalParse(VAULT_STORAGE, []);
  list.unshift(doc);
  safeLocalSave(VAULT_STORAGE, list);
  renderVaultDocs();
  hideNewVaultDoc();
  logAudit('vault', `Document added: ${name}`);
  toast('Document saved','success');
}

function renderVaultDocs(filter='') {
  const list = safeLocalParse(VAULT_STORAGE, []);
  const el = document.getElementById('vaultDocsList');
  const filtered = filter ? list.filter(d=>d.name.toLowerCase().includes(filter)||d.tags.some(t=>t.toLowerCase().includes(filter))||d.category.includes(filter)) : list;
  if (!filtered.length) { el.innerHTML='<p style="font-size:13px;color:var(--muted)">No documents stored.</p>'; return; }
  const now = new Date();
  el.innerHTML = filtered.map(d=>{
    const expiring = d.expiry && new Date(d.expiry) < new Date(now.getTime()+30*24*60*60*1000);
    const expired = d.expiry && new Date(d.expiry) < now;
    const status = expired?'s-overdue':expiring?'s-due':'s-ok';
    const label = expired?'EXPIRED':expiring?'EXPIRING SOON':d.expiry?'Valid':'—';
    return `<div class="asana-item"><div><div class="asana-name">${d.url?`<a href="${escHtml(d.url)}" target="_blank" style="color:var(--gold)">${escHtml(d.name)}</a>`:escHtml(d.name)} <span style="color:var(--muted);font-size:10px">${escHtml(d.version||'')} </span></div><div class="asana-meta">${escHtml(d.category)} ${d.tags.length?'| '+escHtml(d.tags.join(', ')):''}${d.expiry?' | Exp: '+escHtml(d.expiry):''}</div></div><div style="display:flex;gap:6px"><span class="asana-status ${status}">${label}</span><button class="btn btn-sm btn-red" data-action="deleteVaultDoc" data-arg="${d.id}" style="padding:3px 8px;font-size:10px">Del</button></div></div>`;
  }).join('');
}

function filterVaultDocs() { renderVaultDocs(document.getElementById('vaultSearch').value.toLowerCase().trim()); }
function deleteVaultDoc(id) { const list=safeLocalParse(VAULT_STORAGE,[]).filter(d=>d.id!==id); safeLocalSave(VAULT_STORAGE,list); renderVaultDocs(); }

// ======= DEFINITIONS =======
const DEF_ABBREVIATIONS = [
  ['AML','Anti-Money Laundering'],
  ['CBUAE','Central Bank of the United Arab Emirates'],
  ['MOE','Ministry of Economy'],
  ['CDD','Customer Due Diligence'],
  ['EDD','Enhanced Due Diligence'],
  ['SDD','Simplified Due Diligence'],
  ['EWRA','Enterprise-Wide Risk Assessment'],
  ['CFT','Combating the Financing of Terrorism'],
  ['CO','Compliance Officer'],
  ['CP','Customer Profile'],
  ['DNFBPs','Designated Non-Financial Businesses and Professions'],
  ['DPMS','Dealers in Precious Metals and Stones'],
  ['EDD','Enhanced Due Diligence'],
  ['EOCN','Executive Office for Control and Non-Proliferation'],
  ['EU','European Union'],
  ['FATF','Financial Action Task Force'],
  ['FIU','Financial Intelligence Unit'],
  ['FPEP','Foreign Politically Exposed Person'],
  ['KYC','Know Your Customer'],
  ['KYS','Know Your Supplier'],
  ['KYB','Know Your Business'],
  ['KYE','Know Your Employee'],
  ['MLRO','Money Laundering Reporting Officer'],
  ['MENAFATF','Middle East and North Africa FATF'],
  ['OFAC','Office of Foreign Assets Control'],
  ['PEP','Politically Exposed Person'],
  ['PF','Proliferation of Funds (used in context of proliferation financing)'],
  ['PMS','Precious Metals and Stones'],
  ['RBA','Risk-Based Approach'],
  ['SAR','Suspicious Activity Report'],
  ['STR','Suspicious Transaction Report'],
  ['TBML','Trade-Based Money Laundering'],
  ['TF','Terrorist Financing'],
  ['UBO','Ultimate Beneficial Owner'],
  ['UN','United Nations'],
  ['WMD','Weapons of Mass Destruction'],
  ['CAHRA','Conflict-Affected and High-Risk Areas']
];

const DEF_KEY_DEFINITIONS = [
  ['AML / CFT','Anti-Money Laundering and Combating the Financing of Terrorism and Illegal Organizations.'],
  ['Money Laundering (ML)','Any act where a person knows that funds or property are the proceeds of a felony or misdemeanor and intentionally conducts transactions to conceal, disguise, transfer, possess, or assist another to acquire such funds or property, to show them as legitimate.'],
  ['Financing of Terrorism (FT)','Providing, collecting, or managing funds or other assets, by any means, knowing that they will be used, in whole or in part, to commit a terrorist act, by a terrorist organization or terrorist individual, or to support them, whether or not a terrorist act occurs.'],
  ['Illegal Organizations','Groups or entities designated under UAE law as unlawful because they engage in, support, or finance terrorism or other criminal activities, including those listed under the UAE terrorism lists and relevant UN Security Council resolutions.'],
  ['Funds / Property','Any type of asset, tangible or intangible, movable or immovable, corporeal or incorporeal, and the rights attached to such assets, regardless of how they are obtained or in what form they are held (cash, precious metals, crypto-assets, documents, electronic records, etc.).'],
  ['Financial Group','A group of financial institutions under common control, including the parent company, its branches, and subsidiaries, which implement group-wide AML/CFT policies, procedures and controls under the oversight of a governing body.'],
  ['Virtual Asset (VA)','A digital representation of value that can be traded or transferred digitally and used for payment or investment purposes, but does not include digital representations of fiat currency, securities or other financial assets already regulated as such.'],
  ['Virtual Asset Service Provider (VASP)','Any natural or legal person that, as a business, conducts one or more VA activities for or on behalf of others, such as operating VA platforms, exchanging VAs for fiat or other VAs, transferring VAs, providing VA brokerage, or providing VA custody and management services subject to licensing and supervision in the UAE.'],
  ['Occasional Transaction','A transaction conducted for a customer who does not have, and does not intend to have, an ongoing business relationship with the institution (a one-off cash purchase or single VA transfer) that meets or exceeds the threshold set in UAE AML regulations.'],
  ['Competent Authority','Any government authority in the UAE that has legal responsibility to implement, supervise or enforce provisions of the Federal AML/CFT laws and implement regulations (for example MOE, CBUAE, SCA, FIU, law-enforcement authorities).'],
  ['Financial Intelligence Unit (FIU Unit)','The national central unit that receives, analyses, and disseminates suspicious transaction/activity reports and other financial intelligence to competent authorities to combat money laundering, terrorism financing and financing of illegal organizations.'],
  ['Freezing','A temporary prohibition on the transfer, conversion, disposal or movement of funds or property, imposed by a competent authority or by operation of targeted financial sanctions, without affecting ownership rights, pending a final decision by a court or authority.'],
  ['Confiscation','A permanent deprivation of funds or property by a court decision, transferring them to the State due to their connection with a money-laundering offence, predicate offence, financing of terrorism or financing of illegal organizations.'],
  ['Beneficial Owner','The natural person who ultimately owns or exercises effective control, directly or indirectly, over a client, or on whose behalf a transaction is conducted, or who exercises effective ultimate control over a legal person or legal arrangement.'],
  ['Ultimate Beneficial Owner (UBO)','A natural person who owns or controls a customer and/or the natural person on whose behalf a transaction is conducted, including those exercising ultimate effective control over a legal person. A natural person holding 25% or more of the ownership interest in a legal person is treated as a UBO.'],
  ['Business Relationship','Any ongoing commercial or financial relationship established between financial institutions or DNFBPs and their customers in relation to activities or services provided by them.']
];

const DEF_LEGAL_DEFINITIONS = [
  ['Client / Customer','Any person who carries out, or attempts to carry out, any of the activities specified in the Implementing Regulations of the Decree-Law with a financial institution or DNFBP.'],
  ['Competent Authorities','UAE government authorities entrusted with implementing provisions of the AML/CFT Decree-Law.'],
  ['Confiscation','Permanent expropriation of private funds proceeds or instrumentalities by an injunction issued by a competent court.'],
  ['Controlled Delivery','A process by which a competent authority allows entry or transfer of illegal or suspicious funds or crime proceeds into or out of the UAE to investigating a crime or identifying offenders.'],
  ['Crime','Money laundering and related predicate offences, or financing of terrorism or illegal organizations.'],
  ['Customer Due Diligence (CDD)','The process of identifying and verifying the client/beneficial owner (natural or legal person or arrangement), understanding the nature of their activity, purpose of the business relationship, and the ownership and control structure.'],
  ['Designated Non-financial Businesses & Professions (DNFBPs)','Any person conducting one or more of the commercial or professional activities defined in Cabinet Decision No. (10) of 2019 (real estate brokers, DPMS, auditors, company service providers, etc.).'],
  ['Financial Institutions','Any person conducting one or more of the activities or operations defined in the Implementing Regulation of the Decree-Law on behalf of or for a client (banks, money exchanges, finance companies).'],
  ['Financing Illegal Organizations','Any physical or legal action aiming at providing funding or support to an illegal organization or any of its activities or members.'],
  ['Financing of Terrorism','Any acts mentioned in Articles 29 and 30 of Federal Law No. (7) of 2014 on Combating Terrorism Offences.'],
  ['Freezing or Seizure','Temporary attachment over the movement, conversion, transfer, replacement or disposal of funds by order of a competent authority.'],
  ['Funds','Any assets, tangible and intangible, movable or immovable, including national and foreign currencies and documents or instruments evidencing ownership of such assets, including electronic digital forms and any associated rights, interests, profits or income.'],
  ['High-Risk Customer','A customer representing higher ML/TF risk, including geography (high-risk country), non-residency, complex structures, unclear economic purpose, cash-intensive activities, dealings with unknown third parties, or other high-risk characteristics identified by regulators or the institution.'],
  ['Law-Enforcement Authorities','Federal and local authorities mandated to combat, investigate and collect evidence on crimes, including AML/CFT crimes and financing of illegal organizations.'],
  ['Legal Arrangement','A relationship created by contract between two or more parties that does not result in separate legal personalities, such as trusts or similar arrangements.'],
  ['Legal Person','Any entity other than a natural person that can establish a permanent customer relationship or own property in its own name (companies, partnerships, foundations, associations).'],
  ['Local Terrorist List','The terrorism lists issued by the UAE Cabinet under Article 63(1) of Federal Law No. (7) of 2014 on Combating Terrorism Offences.'],
  ['Non-Profit Organizations (NPOs)','Any organized group of a continuing nature, established for a temporary or permanent period, comprising natural or legal persons or non-profit legal arrangements to collect, receive or disburse funds for charitable, religious, cultural, educational, social or similar purposes.'],
  ['Politically Exposed Persons (PEPs)','Natural persons who are or have been entrusted with prominent public functions (domestic or foreign), such as heads of state or government, senior politicians, senior government, judicial or military officials, senior executives of state-owned enterprises, senior officials of political parties or international organizations.'],
  ['Predicate Offence','Any act constituting an offence or misdemeanor under UAE law, whether committed inside or outside the State, when punishable in both jurisdictions.'],
  ['Proceeds','Funds generated directly or indirectly from the commission of any crime or felony, including profits, economic benefits and other derived assets.'],
  ['Purpose of Transaction','The reason why a customer is conducting a transaction or how the funds will be used (family support, education, medical expenses, tourism, debt settlement, financial investment, trading). Supporting documentation may be requested to verify the purpose.'],
  ['Registrar','The authority responsible for the register of commercial names for all types of establishments registered in the UAE.'],
  ['Settlor','A natural or legal person who transfers control of their funds to a trustee under a legal document.'],
  ['Shell Bank','A bank with no physical presence in the country in which it is incorporated and licensed, and which is unaffiliated with a regulated financial group subject to effective consolidated supervision.'],
  ['Source of Funds','The origin of the customer\'s funds relating to a transaction or service and the link between such funds and the customer\'s source of wealth.'],
  ['Source of Wealth','How the customer\'s overall wealth or net worth has been generated or accumulated.'],
  ['Supervisory Authority','Federal and local authorities entrusted by legislation to supervise financial institutions, DNFBPs and NPOs, or the authority responsible for approving the conduct of a regulated activity where no specific supervisor is designated.'],
  ['Suspicious Transactions','Transactions relating to funds where there are reasonable grounds to suspect that they are proceeds of crime or connected to terrorist financing or financing of illegal organizations, whether completed or attempted.'],
  ['Targeted Financial Sanctions (TFS)','Sanctions applied to specific individuals, entities, groups or undertakings, including asset freezing and prohibitions on making funds or other assets available to, or for the benefit of, designated persons or entities.'],
  ['The Executive Office','The Executive Office of the Committee for Goods and Materials Subject to Import and Export Control (responsible for UN TFS implementation and related lists).'],
  ['Transaction','Any disposal or use of funds or proceeds, including deposits, withdrawals, conversions, sales, purchases, inward and outward remittances.'],
  ['UN Consolidated List','The list of individuals and entities designated by the United Nations Security Council related to terrorism, terrorist financing or proliferation of WMD and its financing, including relevant details and reasons for listing.'],
  ['Undercover Operation','Search and investigation activities carried out by authorized officers who assume a covert or false identity to obtain evidence or information relating to a crime.'],
  ['Wire Transfer','A financial transaction conducted by a financial institution (or intermediary) on behalf of an originator whose funds are made available to a beneficiary at another financial institution, regardless of whether the originator and beneficiary are the same person.'],
  ['Immediately','Within 24 hours of a listing decision by the UNSC, its Sanctions Committees or the UAE Cabinet.'],
  ['FATF','The Financial Action Task Force (FATF) is an inter-governmental body that sets international standards on AML/CFT and proliferation financing and evaluates jurisdictions\' compliance through mutual evaluations and grey/black-listing processes.'],
  ['LBMA','The London Bullion Market Association (LBMA) is the global authority for the wholesale over-the-counter market for gold and silver. LBMA\'s Responsible Gold Guidance (RGG) supports its Responsible Sourcing Program.']
];

const DEF_CUSTOM_STORAGE = 'fgl_definitions_custom';
const DEF_CHANGELOG_STORAGE = 'fgl_definitions_changelog';

function getCustomDefinitions() { return safeLocalParse(DEF_CUSTOM_STORAGE, { abbreviation: [], key: [], legal: [] }); }
function saveCustomDefinitions(data) { safeLocalSave(DEF_CUSTOM_STORAGE, data); }
function getDefChangeLog() { return safeLocalParse(DEF_CHANGELOG_STORAGE, []); }
function saveDefChangeLog(log) { safeLocalSave(DEF_CHANGELOG_STORAGE, log); }

function getMergedDefinitions(section) {
  const custom = getCustomDefinitions();
  const base = section === 'abbreviation' ? DEF_ABBREVIATIONS : section === 'key' ? DEF_KEY_DEFINITIONS : DEF_LEGAL_DEFINITIONS;
  const customItems = custom[section] || [];
  // Merge: custom overrides base by term, then append new
  const merged = base.map(e => [...e]);
  customItems.forEach(entry => {
    const idx = merged.findIndex(([t]) => t.toLowerCase() === entry[0].toLowerCase());
    if (idx >= 0) merged[idx] = [...entry];
    else merged.push([...entry]);
  });
  return merged;
}

function renderDefinitions() {
  const abBody = document.getElementById('defAbbrevBody');
  const keyBody = document.getElementById('defKeyBody');
  const legalBody = document.getElementById('defLegalBody');
  if (!abBody) return;
  const custom = getCustomDefinitions();
  const customTerms = new Set([...(custom.abbreviation||[]), ...(custom.key||[]), ...(custom.legal||[])].map(([t])=>t.toLowerCase()));
  const rowStyle = 'padding:8px 12px;border-bottom:1px solid var(--border);vertical-align:top';
  function renderRows(data, section, isGold) {
    const cTerms = new Set((custom[section]||[]).map(([t])=>t.toLowerCase()));
    const isAbbrev = section === 'abbreviation';
    return data.map(entry => {
      const term = entry[0];
      const fullTerm = entry[1] || '';
      const definition = entry[2] || '';
      const isCustom = cTerms.has(term.toLowerCase());
      const badge = isCustom ? ' <span style="font-size:9px;padding:1px 5px;border-radius:4px;background:rgba(91,141,239,0.2);color:#5B8DEF;margin-left:4px">UPDATED</span>' : '';
      const editBtn = `<button class="btn btn-sm btn-gold" style="padding:1px 6px;font-size:9px;margin-left:4px" data-action="_editDefinition" data-section="${section}" data-term="${term.replace(/"/g,'&quot;')}">Edit</button>`;
      const termColor = isGold ? 'color:var(--gold)' : 'color:var(--text)';
      return `<tr class="def-row"><td style="${rowStyle};font-weight:700;${termColor};white-space:nowrap">${escHtml(term)}${badge}${editBtn}</td><td style="${rowStyle};line-height:1.5">${escHtml(fullTerm)}</td></tr>`;
    }).join('');
  }
  abBody.innerHTML = renderRows(getMergedDefinitions('abbreviation'), 'abbreviation', true);
  keyBody.innerHTML = renderRows(getMergedDefinitions('key'), 'key', false);
  legalBody.innerHTML = renderRows(getMergedDefinitions('legal'), 'legal', false);
  renderDefChangeLog();
}

function filterDefinitions(q) {
  const query = q.toLowerCase();
  document.querySelectorAll('.def-row').forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(query) ? '' : 'none';
  });
}

function exportDefinitionsPDF() {
  if (!requireJsPDF()) return;
  const doc = new jspdf.jsPDF('portrait');
  const pageW = doc.internal.pageSize.getWidth();
  const company = typeof getActiveCompany === 'function' ? getActiveCompany() : null;
  doc.setFontSize(16); doc.setTextColor(180,151,90);
  doc.text('AML/CFT Compliance Definitions', 14, 18);
  if (company && company.name) { doc.setFontSize(9); doc.setTextColor(120); doc.text(company.name, 14, 25); }
  doc.setFontSize(8); doc.setTextColor(100);
  doc.text('Generated: ' + new Date().toLocaleDateString('en-GB'), pageW - 14, 18, { align: 'right' });

  let y = 32;
  function checkPage(needed) { if (y + needed > doc.internal.pageSize.getHeight() - 15) { doc.addPage(); y = 18; } }
  function section(title, data) {
    checkPage(14);
    doc.setFontSize(11); doc.setTextColor(180,151,90); doc.text(title, 14, y); y += 8;
    data.forEach(([term, def]) => {
      const lines = doc.splitTextToSize(def, pageW - 60);
      checkPage(6 + lines.length * 4);
      doc.setFontSize(8); doc.setTextColor(200,200,200); doc.setFont(undefined,'bold'); doc.text(term, 14, y);
      doc.setFont(undefined,'normal'); doc.setTextColor(160);
      lines.forEach((l,i) => { doc.text(l, 56, y + i * 4); }); y += Math.max(6, lines.length * 4 + 3);
    });
    y += 4;
  }
  section('Abbreviations & Acronyms', getMergedDefinitions('abbreviation'));
  section('Key Regulatory Definitions', getMergedDefinitions('key'));
  section('Detailed Legal & Regulatory Definitions', getMergedDefinitions('legal'));
  doc.save('AML_CFT_Definitions.pdf');
  toast('Definitions PDF exported', 'success');
}

function exportDefinitionsDOCX() {
  let html = wordDocHeader('AML/CFT Compliance Definitions');
  function addTable(title, data, col1) {
    html += '<h2>' + title + '</h2><table><tr><th>' + col1 + '</th><th>Definition</th></tr>';
    data.forEach(([t,d]) => { html += '<tr><td><b>' + t + '</b></td><td>' + d + '</td></tr>'; });
    html += '</table>';
  }
  addTable('Abbreviations & Acronyms', getMergedDefinitions('abbreviation'), 'Abbreviation');
  addTable('Key Regulatory Definitions', getMergedDefinitions('key'), 'Term');
  addTable('Detailed Legal & Regulatory Definitions', getMergedDefinitions('legal'), 'Term');
  html += wordDocFooter();
  downloadWordDoc(html, 'AML_CFT_Definitions.doc');
  toast('Definitions Word document exported', 'success');
}

function exportDefinitionsCSV() {
  const sections = [
    { name: 'Abbreviation', data: getMergedDefinitions('abbreviation') },
    { name: 'Key Definition', data: getMergedDefinitions('key') },
    { name: 'Legal Definition', data: getMergedDefinitions('legal') }
  ];
  const headers = ['Section','Term','Definition'];
  const rows = [];
  sections.forEach(s => s.data.forEach(([t,d]) => rows.push([s.name, t, d])));
  if (!rows.length) { toast('No definitions to export','error'); return; }
  const csv = [headers,...rows].map(r=>r.map(c=>'"'+String(c||'').replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob = new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='AML_CFT_Definitions_'+new Date().toISOString().slice(0,10)+'.csv';a.click();
  toast('Definitions CSV exported','success');
}

function toggleDefUpdateForm() {
  const form = document.getElementById('defUpdateForm');
  if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

function editDefinition(section, term) {
  const merged = getMergedDefinitions(section);
  const entry = merged.find(([t]) => t === term);
  if (!entry) return;
  document.getElementById('defUpdateSection').value = section;
  document.getElementById('defUpdateTerm').value = entry[0];
  document.getElementById('defUpdateDefinition').value = entry[1];
  const descEl = document.getElementById('defUpdateDescription');
  if (descEl) { descEl.value = entry[2] || ''; descEl.parentElement.style.display = section === 'abbreviation' ? '' : 'none'; }
  document.getElementById('defUpdateSource').value = '';
  document.getElementById('defUpdateReason').value = '';
  document.getElementById('defUpdateForm').style.display = 'block';
  document.getElementById('defUpdateTerm').focus();
}

function submitDefUpdate() {
  const section = document.getElementById('defUpdateSection').value;
  const term = document.getElementById('defUpdateTerm').value.trim();
  const definition = document.getElementById('defUpdateDefinition').value.trim();
  const description = (document.getElementById('defUpdateDescription')?.value || '').trim();
  const source = document.getElementById('defUpdateSource').value.trim();
  const reason = document.getElementById('defUpdateReason').value.trim();
  if (!term || !definition) { toast('Term and definition are required', 'error'); return; }

  const custom = getCustomDefinitions();
  if (!custom[section]) custom[section] = [];
  // Check if updating existing or adding new
  const existingIdx = custom[section].findIndex(([t]) => t.toLowerCase() === term.toLowerCase());
  const base = section === 'abbreviation' ? DEF_ABBREVIATIONS : section === 'key' ? DEF_KEY_DEFINITIONS : DEF_LEGAL_DEFINITIONS;
  const wasInBase = base.some(([t]) => t.toLowerCase() === term.toLowerCase());
  const action = existingIdx >= 0 || wasInBase ? 'Updated' : 'Added';

  const entry = section === 'abbreviation' && description ? [term, definition, description] : [term, definition];
  if (existingIdx >= 0) custom[section][existingIdx] = entry;
  else custom[section].push(entry);
  saveCustomDefinitions(custom);

  // Log the change
  const log = getDefChangeLog();
  const company = typeof getActiveCompany === 'function' ? getActiveCompany() : null;
  log.unshift({
    id: Date.now(),
    date: new Date().toISOString(),
    action: action,
    section: section === 'abbreviation' ? 'Abbreviations' : section === 'key' ? 'Key Definitions' : 'Legal Definitions',
    term: term,
    definition: definition,
    source: source,
    reason: reason,
    company: company ? company.name : '',
    user: 'Compliance Officer'
  });
  saveDefChangeLog(log.slice(0, 500));

  // Clear form
  document.getElementById('defUpdateTerm').value = '';
  document.getElementById('defUpdateDefinition').value = '';
  if (document.getElementById('defUpdateDescription')) document.getElementById('defUpdateDescription').value = '';
  document.getElementById('defUpdateSource').value = '';
  document.getElementById('defUpdateReason').value = '';
  document.getElementById('defUpdateForm').style.display = 'none';

  renderDefinitions();
  toast(`Definition ${action.toLowerCase()}: ${term}`, 'success');
}

function renderDefChangeLog() {
  const el = document.getElementById('defChangeLogList');
  if (!el) return;
  const log = getDefChangeLog();
  if (!log.length) { el.innerHTML = '<p style="font-size:13px;color:var(--muted)">No regulatory updates recorded yet.</p>'; return; }
  el.innerHTML = log.slice(0, 50).map(entry => {
    const date = new Date(entry.date).toLocaleDateString('en-GB');
    const actionBadge = entry.action === 'Added'
      ? '<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(61,168,118,0.2);color:var(--green)">NEW</span>'
      : entry.action === 'Deleted'
        ? '<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(217,79,79,0.2);color:var(--red)">REMOVED</span>'
        : '<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(91,141,239,0.2);color:#5B8DEF">UPDATED</span>';
    return `<div class="asana-item" style="padding:8px 12px">
      <div>
        <div class="asana-name">${actionBadge} <strong>${entry.term}</strong> <span style="color:var(--muted);font-size:11px">(${entry.section})</span></div>
        <div class="asana-meta">${date}${entry.source ? ' | Source: ' + entry.source : ''}${entry.reason ? ' | Reason: ' + entry.reason : ''}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:3px;line-height:1.4;max-height:40px;overflow:hidden">${entry.definition}</div>
      </div>
      <div><button class="btn btn-sm btn-red" style="padding:2px 6px;font-size:9px" data-action="deleteDefChangeEntry" data-arg="${entry.id}">Delete</button></div>
    </div>`;
  }).join('');
}

function deleteDefChangeEntry(id) {
  const log = getDefChangeLog().filter(e => e.id !== id);
  saveDefChangeLog(log);
  renderDefChangeLog();
  toast('Change log entry removed', 'success');
}

function clearDefChangeLog() {
  if (!confirm('Clear entire regulatory change log? This cannot be undone.')) return;
  safeLocalRemove(DEF_CHANGELOG_STORAGE);
  renderDefChangeLog();
  toast('Change log cleared', 'success');
}

function exportDefChangeLogPDF() {
  if (!requireJsPDF()) return;
  const log = getDefChangeLog();
  if (!log.length) { toast('No changes to export', 'error'); return; }
  const doc = new jspdf.jsPDF('portrait');
  const pageW = doc.internal.pageSize.getWidth();
  const company = typeof getActiveCompany === 'function' ? getActiveCompany() : null;
  doc.setFontSize(14); doc.setTextColor(180,151,90);
  doc.text('Regulatory Change Log — Definitions', 14, 18);
  if (company && company.name) { doc.setFontSize(9); doc.setTextColor(120); doc.text(company.name, 14, 25); }
  doc.setFontSize(8); doc.setTextColor(100);
  doc.text('Generated: ' + new Date().toLocaleDateString('en-GB'), pageW - 14, 18, { align: 'right' });
  let y = 34;
  log.forEach((entry, i) => {
    if (y > doc.internal.pageSize.getHeight() - 25) { doc.addPage(); y = 18; }
    const date = new Date(entry.date).toLocaleDateString('en-GB');
    doc.setFontSize(9); doc.setTextColor(180,151,90); doc.setFont(undefined,'bold');
    doc.text(`${i+1}. [${entry.action}] ${entry.term}`, 14, y);
    doc.setFont(undefined,'normal'); doc.setFontSize(7); doc.setTextColor(140);
    doc.text(`${date} | ${entry.section}${entry.source ? ' | ' + entry.source : ''}${entry.reason ? ' | ' + entry.reason : ''}`, 14, y + 4);
    const lines = doc.splitTextToSize(entry.definition, pageW - 28);
    doc.setTextColor(160);
    lines.slice(0, 3).forEach((l, li) => { doc.text(l, 14, y + 8 + li * 3.5); });
    y += 10 + Math.min(lines.length, 3) * 3.5 + 4;
  });
  doc.save('Regulatory_Change_Log_' + new Date().toISOString().slice(0,10) + '.pdf');
  toast('Change log PDF exported', 'success');
}

function exportDefChangeLogDOCX() {
  const log = getDefChangeLog();
  if (!log.length) { toast('No changes to export','error'); return; }
  let html = wordDocHeader('Regulatory Change Log — Definitions');
  html += '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:10px">';
  html += '<tr><th style="background:#B4975A;color:#fff">Date</th><th style="background:#B4975A;color:#fff">Action</th><th style="background:#B4975A;color:#fff">Section</th><th style="background:#B4975A;color:#fff">Term</th><th style="background:#B4975A;color:#fff">Definition</th><th style="background:#B4975A;color:#fff">Source</th><th style="background:#B4975A;color:#fff">Reason</th></tr>';
  log.forEach(e => {
    const date = new Date(e.date).toLocaleDateString('en-GB');
    html += '<tr><td>' + date + '</td><td>' + escHtml(e.action) + '</td><td>' + escHtml(e.section) + '</td><td>' + escHtml(e.term) + '</td><td>' + escHtml(e.definition) + '</td><td>' + escHtml(e.source) + '</td><td>' + escHtml(e.reason) + '</td></tr>';
  });
  html += '</table>' + wordDocFooter();
  downloadWordDoc(html, 'Regulatory_Change_Log_' + new Date().toISOString().slice(0,10) + '.doc');
  toast('Word export complete','success');
}

function exportDefChangeLogCSV() {
  const log = getDefChangeLog();
  if (!log.length) { toast('No changes to export','error'); return; }
  const headers = ['Date','Action','Section','Term','Definition','Source','Reason'];
  const rows = log.map(e => [new Date(e.date).toLocaleDateString('en-GB'), e.action, e.section, e.term, e.definition, e.source, e.reason]);
  const csv = [headers,...rows].map(r=>r.map(c=>'"'+String(c||'').replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob = new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='Regulatory_Change_Log_'+new Date().toISOString().slice(0,10)+'.csv';a.click();
  toast('CSV exported','success');
}

// ======= EXCEL EXPORT HELPER =======
function buildExcelXML(sheetName, headers, rows) {
  let xml = '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>';
  xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">';
  xml += '<Styles><Style ss:ID="hdr"><Font ss:Bold="1" ss:Color="#FFFFFF" ss:Name="Arial Narrow" ss:Size="8"/><Interior ss:Color="#B4975A" ss:Pattern="Solid"/></Style>';
  xml += '<Style ss:ID="cell"><Font ss:Name="Arial Narrow" ss:Size="8"/></Style></Styles>';
  xml += '<Worksheet ss:Name="' + escHtml(sheetName) + '"><Table>';
  xml += '<Row>' + headers.map(h => '<Cell ss:StyleID="hdr"><Data ss:Type="String">' + escHtml(h) + '</Data></Cell>').join('') + '</Row>';
  rows.forEach(row => {
    xml += '<Row>' + row.map(v => {
      const val = String(v || '');
      const type = !isNaN(val) && val !== '' ? 'Number' : 'String';
      return '<Cell ss:StyleID="cell"><Data ss:Type="' + type + '">' + escHtml(val) + '</Data></Cell>';
    }).join('') + '</Row>';
  });
  xml += '</Table></Worksheet></Workbook>';
  return xml;
}

function downloadExcel(xml, filename) {
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = filename; a.click();
  toast('Excel export complete', 'success');
}

function exportIARReportExcel() {
  if (!iarReports.length) { toast('No IAR reports to export', 'error'); return; }
  const headers = ['Legal Name','Country','Trade License','Nature of Business','Sector','Relationship Type','Purpose','Txn Volume','Txn Frequency','Settlement','PEP Check','UN Sanctions','OFAC','EU Sanctions','UAE Terrorism','FATF Grey','Criminal','Money Laundering','TF/PF','Regulatory','Negative Reputation','Political','HR Violations','Source of Funds','Source of Wealth','Created'];
  const rows = iarReports.map(r => [r.iarLegalName,r.iarCountryReg,r.iarTradeLicense,r.iarNatureBiz,r.iarSector,r.iarRelType,r.iarRelPurpose,r.iarTxnVolume,r.iarTxnFreq,r.iarSettlement,r.iarPepCheck,r.iarUnSanctions,r.iarOfac,r.iarEuSanctions,r.iarUaeTerrorism,r.iarFatfGrey,r.iarCriminal,r.iarMoneyLaundering,r.iarTfPf,r.iarRegActions,r.iarNegReputation,r.iarPolitical,r.iarHrViolations,r.iarSourceFunds,r.iarSourceWealth,r.createdAt]);
  downloadExcel(buildExcelXML('IAR Reports', headers, rows), 'IAR_Reports_' + new Date().toISOString().slice(0,10) + '.xls');
}

function exportEvidenceExcel() {
  const entries = Object.values(evidenceData);
  if (!entries.length) { toast('No evidence data to export', 'error'); return; }
  const headers = ['Task Name','Status','Drive Link','Notes','Last Updated'];
  const rows = entries.map(e => [e.taskName, e.status, e.driveLink, e.notes, e.updatedAt]);
  downloadExcel(buildExcelXML('Evidence Tracker', headers, rows), 'Evidence_Tracker_' + new Date().toISOString().slice(0,10) + '.xls');
}

function exportCompanyExcel() {
  const company = getActiveCompany();
  const headers = ['Field','Value'];
  const rows = [['Company Name',company.name],['Activity',company.activity],['Location',company.location],['License No',company.licenseNo],['Registration Date',company.regDate],['Compliance Program',company.complianceProgram],['Description',company.description]];
  downloadExcel(buildExcelXML('Company Profile', headers, rows), 'Company_Profile_' + new Date().toISOString().slice(0,10) + '.xls');
}

function exportTrainingExcel() {
  if (!employeeTraining.length) { toast('No training records to export', 'error'); return; }
  const headers = ['Employee','Department','Course','Status','Score','Completion Date','Expiry Date','Certificate','Notes'];
  const rows = employeeTraining.map(t => [t.employee, t.department, t.course, t.status, t.score, t.completionDate, t.expiryDate, t.certificate, t.notes]);
  downloadExcel(buildExcelXML('Training Records', headers, rows), 'Training_Records_' + new Date().toISOString().slice(0,10) + '.xls');
}

function exportEmployeeExcel() {
  const list = safeLocalParse(EMPLOYEE_INFO_STORAGE, []);
  if (!list.length) { toast('No employees', 'error'); return; }
  const headers = ['Full Name','Position','Department','Business Unit','Email','Phone','Emirates ID','Join Date','Nationality','Passport No','Screening Status','Training Status'];
  const rows = list.map(e => [e.fullName, e.position, e.department, e.businessUnit, e.email, e.phone, e.emiratesId, e.joinDate, e.nationality, e.passportNo, e.screeningStatus, e.trainingStatus]);
  downloadExcel(buildExcelXML('Employee Directory', headers, rows), 'Employee_Directory_' + new Date().toISOString().slice(0,10) + '.xls');
}

function exportScreeningExcel() {
  const history = safeLocalParse(SCREENING_STORAGE, []);
  if (!history.length) { toast('No screening history to export', 'error'); return; }
  const headers = ['#','Entity','Type','Country','Date','Result','Risk Level','Summary','Sanctions Hits','Adverse Media','Recommended Actions'];
  const rows = history.map((r, i) => [i+1, r.entity_name, r.entity_type, r.country, r.date, r.overall_result, r.risk_level, r.summary, (r.sanctions_hits||[]).map(s=>s.list).join('; '), (r.adverse_media_hits||[]).map(a=>a.category).join('; '), (r.recommended_actions||[]).join('; ')]);
  downloadExcel(buildExcelXML('Screening History', headers, rows), 'Screening_History_' + new Date().toISOString().slice(0,10) + '.xls');
}

function exportIncidentsExcel() {
  const list = safeLocalParse(INCIDENTS_STORAGE, []);
  if (!list.length) { toast('No incidents to export', 'error'); return; }
  const headers = ['ID','Title','Type','Severity','Status','Date Reported','Description','Actions Taken','Assigned To'];
  const rows = list.map(i => [i.id, i.title, i.type, i.severity, i.status, i.dateReported, i.description, i.actionsTaken, i.assignedTo]);
  downloadExcel(buildExcelXML('Incidents', headers, rows), 'Incidents_' + new Date().toISOString().slice(0,10) + '.xls');
}

function exportWBReportsExcel() {
  const list = safeLocalParse(WB_REPORTS_STORAGE, []);
  if (!list.length) { toast('No reports to export', 'error'); return; }
  const headers = ['Ref Number','Category','Urgency','Status','Department','Location','Frequency','Has Evidence','Description','Date'];
  const rows = list.map(r => [r.refNumber, r.category, r.urgency, r.status, r.department, r.location, r.frequency, r.hasEvidence, r.description, r.date]);
  downloadExcel(buildExcelXML('Whistleblower Reports', headers, rows), 'Whistleblower_Reports_' + new Date().toISOString().slice(0,10) + '.xls');
}

function exportRACIExcel() {
  const rows = collectRACIRows();
  if (!rows.length) { toast('No activities to export', 'error'); return; }
  const headers = ['Section','Activity','Compliance Manager','Managing Director','Finance','Operations','Description'];
  const data = rows.map(r => r.section ? [r.section,'','','','','',''] : ['', r.activity, r.cm, r.md, r.fin, r.ops, r.desc]);
  downloadExcel(buildExcelXML('RACI Matrix', headers, data), 'RACI_Matrix_' + new Date().toISOString().slice(0,10) + '.xls');
}

function exportDefinitionsExcel() {
  const sections = [
    { name: 'Abbreviation', data: getMergedDefinitions('abbreviation') },
    { name: 'Key Definition', data: getMergedDefinitions('key') },
    { name: 'Legal Definition', data: getMergedDefinitions('legal') }
  ];
  const headers = ['Section','Term','Definition'];
  const rows = [];
  sections.forEach(s => s.data.forEach(([t,d]) => rows.push([s.name, t, d])));
  if (!rows.length) { toast('No definitions to export', 'error'); return; }
  downloadExcel(buildExcelXML('Definitions', headers, rows), 'AML_CFT_Definitions_' + new Date().toISOString().slice(0,10) + '.xls');
}

function exportDefChangeLogExcel() {
  const log = getDefChangeLog();
  if (!log.length) { toast('No changes to export', 'error'); return; }
  const headers = ['Date','Action','Section','Term','Definition','Source','Reason'];
  const rows = log.map(e => [new Date(e.date).toLocaleDateString('en-GB'), e.action, e.section, e.term, e.definition, e.source, e.reason]);
  downloadExcel(buildExcelXML('Regulatory Change Log', headers, rows), 'Regulatory_Change_Log_' + new Date().toISOString().slice(0,10) + '.xls');
}

// ======= DATA UPLOAD FUNCTIONS =======
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function getCategoryLabel(val) {
  var labels = {general:'General',evidence:'Evidence',shipments:'Shipment Records',kyc:'KYC Documents',reports:'Reports',policies:'Policies & Procedures',training:'Training Materials',audit:'Audit Records',screening:'Screening Results',incidents:'Incident Reports'};
  return labels[val] || val;
}

async function uploadFileToServer() {
  var fileInput = document.getElementById('uploadFileInput');
  var categorySelect = document.getElementById('uploadCategory');
  var file = fileInput.files && fileInput.files[0];
  if (!file) { toast('Please select a file to upload', 'error'); return; }
  if (file.size > 50 * 1024 * 1024) { toast('File too large. Maximum size is 50 MB.', 'error'); return; }

  var btn = document.getElementById('uploadBtn');
  var progress = document.getElementById('uploadProgress');
  var progressBar = document.getElementById('uploadProgressBar');
  var statusText = document.getElementById('uploadStatusText');

  btn.disabled = true;
  btn.textContent = 'Uploading...';
  progress.style.display = 'block';
  progressBar.style.width = '10%';
  statusText.textContent = 'Uploading ' + file.name + '...';

  var formData = new FormData();
  formData.append('file', file);
  formData.append('category', categorySelect.value);

  try {
    progressBar.style.width = '50%';
    var response = await fetch('/api/upload', { method: 'POST', body: formData });
    progressBar.style.width = '80%';

    if (!response.ok) {
      var err = await response.json().catch(function() { return { error: 'Upload failed' }; });
      throw new Error(err.error || 'Upload failed with status ' + response.status);
    }

    var result = await response.json();
    progressBar.style.width = '100%';
    statusText.textContent = 'Upload complete!';
    toast('File uploaded: ' + result.name, 'success');
    fileInput.value = '';
    logAudit('Data Upload', 'Uploaded file: ' + result.name + ' (category: ' + result.category + ')');

    setTimeout(function() {
      progress.style.display = 'none';
      progressBar.style.width = '0%';
    }, 2000);

    loadUploadedFiles();
  } catch (e) {
    progressBar.style.width = '0%';
    progress.style.display = 'none';
    toast('Upload failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '📤 Upload';
  }
}

async function loadUploadedFiles() {
  var listEl = document.getElementById('uploadedFilesList');
  var countEl = document.getElementById('uploadFileCount');
  var category = document.getElementById('filterCategory').value;
  listEl.innerHTML = '<p style="text-align:center;color:var(--muted);font-size:12px;padding:20px">Loading files...</p>';

  try {
    var url = '/api/files' + (category ? '?category=' + encodeURIComponent(category) : '');
    var response = await fetch(url);
    if (!response.ok) throw new Error('Failed to load files');
    var data = await response.json();
    var files = data.files || [];

    countEl.textContent = files.length + ' file' + (files.length !== 1 ? 's' : '');

    if (!files.length) {
      listEl.innerHTML = '<p style="text-align:center;color:var(--muted);font-size:12px;padding:20px">No files uploaded yet. Use the form above to upload your first document.</p>';
      return;
    }

    var html = '<table style="width:100%;font-size:11px"><thead><tr><th style="text-align:left;padding:6px 8px">File Name</th><th style="text-align:left;padding:6px 8px">Category</th><th style="text-align:right;padding:6px 8px">Size</th><th style="text-align:left;padding:6px 8px">Uploaded</th><th style="text-align:center;padding:6px 8px">Actions</th></tr></thead><tbody>';

    files.forEach(function(f) {
      var date = f.uploadedAt ? new Date(f.uploadedAt).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
      html += '<tr style="border-bottom:1px solid var(--border)">';
      html += '<td style="padding:6px 8px;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(f.name) + '">' + escHtml(f.name) + '</td>';
      html += '<td style="padding:6px 8px"><span style="background:rgba(201,168,76,0.05);border-radius:4px;padding:2px 6px;font-size:10px">' + escHtml(getCategoryLabel(f.category)) + '</span></td>';
      html += '<td style="padding:6px 8px;text-align:right;color:var(--muted)">' + formatFileSize(f.size) + '</td>';
      html += '<td style="padding:6px 8px;color:var(--muted)">' + date + '</td>';
      html += '<td style="padding:6px 8px;text-align:center;white-space:nowrap">';
      html += '<a href="/api/file?key=' + encodeURIComponent(f.key) + '" download style="color:var(--gold);text-decoration:none;margin-right:8px;cursor:pointer" title="Download">⬇️</a>';
      html += '<span style="color:var(--red);cursor:pointer" data-action="_deleteUploadedFile" data-file-key="' + escHtml(f.key) + '" data-file-name="' + escHtml(f.name) + '" title="Delete">🗑️</span>';
      html += '</td></tr>';
    });

    html += '</tbody></table>';
    listEl.innerHTML = html;
  } catch (e) {
    listEl.innerHTML = '<p style="text-align:center;color:var(--red);font-size:12px;padding:20px">Failed to load files: ' + escHtml(e.message) + '</p>';
    countEl.textContent = '';
  }
}

async function deleteUploadedFile(key, name) {
  if (!confirm('Delete "' + name + '"? This cannot be undone.')) return;
  try {
    var response = await fetch('/api/file?key=' + encodeURIComponent(key), { method: 'DELETE' });
    if (!response.ok) throw new Error('Delete failed');
    toast('Deleted: ' + name, 'success');
    logAudit('Data Delete', 'Deleted file: ' + name);
    loadUploadedFiles();
  } catch (e) {
    toast('Delete failed: ' + e.message, 'error');
  }
}

// ======= DRAG & DROP UPLOAD =======
function showSelectedFile(input) {
  var el = document.getElementById('selectedFileName');
  if (input.files && input.files.length > 1) {
    el.style.display = 'block';
    var totalSize = 0;
    for (var i = 0; i < input.files.length; i++) totalSize += input.files[i].size;
    el.textContent = input.files.length + ' files selected (' + formatFileSize(totalSize) + ' total)';
  } else if (input.files && input.files[0]) {
    el.style.display = 'block';
    el.textContent = input.files[0].name + ' (' + formatFileSize(input.files[0].size) + ')';
  } else {
    el.style.display = 'none';
  }
}
(function initDropzone() {
  function setup() {
    var dz = document.getElementById('uploadDropzone');
    if (!dz) return;
    ['dragenter','dragover'].forEach(function(evt) {
      dz.addEventListener(evt, function(e) { e.preventDefault(); e.stopPropagation(); dz.classList.add('drag-over'); });
    });
    ['dragleave','drop'].forEach(function(evt) {
      dz.addEventListener(evt, function(e) { e.preventDefault(); e.stopPropagation(); dz.classList.remove('drag-over'); });
    });
    dz.addEventListener('drop', function(e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length > 0) {
        var input = document.getElementById('uploadFileInput');
        input.files = files;
        showSelectedFile(input);
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();

// ======= CLOUD SYNC =======
var CLOUD_SYNC_KEYS = [
  'fgl_shipments', 'fgl_gaps_v2', 'fgl_screening', 'fgl_employees',
  'fgl_onboarding', 'fgl_incidents', 'fgl_audit_log', 'fgl_risk_assessments',
  'fgl_iar_reports', 'fgl_deadlines', 'fgl_schedule_history', 'fgl_analysis_history',
  'fgl_compliance_config', 'fgl_custom_red_flags', 'fgl_training_records',
  'fgl_company_profiles', 'fgl_active_company'
];

function getCloudSyncUid() {
  // Use a hash of the session user to scope cloud data
  var session = safeLocalParse('fgl_session', null);
  if (!session || !session.username) return null;
  // Simple hash for uid
  var str = 'compliance-sync-' + session.username;
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return 'u' + Math.abs(hash).toString(36) + str.length.toString(36);
}

async function cloudSyncPush() {
  var uid = getCloudSyncUid();
  if (!uid) { toast('Log in first to sync data', 'error'); return; }
  var statusEl = document.getElementById('cloudSyncStatus');
  if (statusEl) statusEl.innerHTML = '<span style="color:var(--gold)">Uploading data to cloud...</span>';

  try {
    var syncData = {};
    // Collect all localStorage keys that match our sync list (including company-scoped ones)
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      var shouldSync = CLOUD_SYNC_KEYS.some(function(sk) { return key === sk || key.startsWith(sk + '__'); });
      if (shouldSync) {
        syncData[key] = localStorage.getItem(key);
      }
    }

    var payload = JSON.stringify(syncData);
    var response = await fetch('/api/sync?uid=' + encodeURIComponent(uid), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });

    if (!response.ok) {
      var err = await response.json().catch(function() { return { error: 'Upload failed' }; });
      throw new Error(err.error || 'Sync failed');
    }

    var result = await response.json();
    var keyCount = Object.keys(syncData).length;
    var sizeKB = (payload.length / 1024).toFixed(1);
    safeLocalSave('fgl_last_cloud_sync', result.lastSync);

    if (statusEl) statusEl.innerHTML = '<span style="color:var(--green)">Synced ' + keyCount + ' data keys (' + sizeKB + ' KB) — ' + new Date(result.lastSync).toLocaleString('en-GB') + '</span>';
    toast('Data uploaded to cloud (' + sizeKB + ' KB)', 'success');
    logAudit('Cloud Sync', 'Pushed ' + keyCount + ' keys (' + sizeKB + ' KB) to cloud');
  } catch (e) {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--red)">Sync failed: ' + escHtml(String(e.message || e)) + '</span>';
    toast('Cloud sync failed: ' + escHtml(String(e.message || e)), 'error');
  }
}

async function cloudSyncPull() {
  var uid = getCloudSyncUid();
  if (!uid) { toast('Log in first to sync data', 'error'); return; }
  if (!confirm('Download cloud data? This will REPLACE your local data with the cloud version. Continue?')) return;

  var statusEl = document.getElementById('cloudSyncStatus');
  if (statusEl) statusEl.innerHTML = '<span style="color:var(--gold)">Downloading data from cloud...</span>';

  try {
    var response = await fetch('/api/sync?uid=' + encodeURIComponent(uid));
    if (!response.ok) throw new Error('Download failed');

    var result = await response.json();
    if (!result.found || !result.data) {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--amber)">No cloud data found. Upload first from your main device.</span>';
      toast('No cloud data found — upload from your main device first', 'info');
      return;
    }

    var data = result.data;
    var keyCount = 0;
    Object.keys(data).forEach(function(key) {
      localStorage.setItem(key, data[key]);
      keyCount++;
    });

    safeLocalSave('fgl_last_cloud_sync', result.lastSync);
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--green)">Downloaded ' + keyCount + ' data keys — Last sync: ' + new Date(result.lastSync).toLocaleString('en-GB') + '</span>';
    toast('Cloud data downloaded! Reloading...', 'success');
    logAudit('Cloud Sync', 'Pulled ' + keyCount + ' keys from cloud');

    // Reload to apply all data
    setTimeout(function() { location.reload(); }, 1500);
  } catch (e) {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--red)">Download failed: ' + escHtml(String(e.message || e)) + '</span>';
    toast('Cloud download failed: ' + escHtml(String(e.message || e)), 'error');
  }
}

var _autoSyncInterval = null;
function toggleAutoSync(enabled) {
  safeLocalSave('fgl_auto_sync_enabled', enabled);
  if (enabled && !_autoSyncInterval) {
    _autoSyncInterval = setInterval(function() {
      cloudSyncPush().catch(function() {});
    }, 300000); // 5 minutes
    toast('Auto-sync enabled (every 5 min)', 'success');
  } else if (!enabled && _autoSyncInterval) {
    clearInterval(_autoSyncInterval);
    _autoSyncInterval = null;
    toast('Auto-sync disabled', 'info');
  }
}

function initCloudSyncUI() {
  var lastSync = safeLocalParse('fgl_last_cloud_sync', null);
  var statusEl = document.getElementById('cloudSyncStatus');
  if (statusEl && lastSync) {
    statusEl.innerHTML = '<span style="color:var(--green)">Last sync: ' + new Date(lastSync).toLocaleString('en-GB') + '</span>';
  }
  var autoEnabled = safeLocalParse('fgl_auto_sync_enabled', false);
  var checkbox = document.getElementById('autoSyncEnabled');
  if (checkbox) checkbox.checked = autoEnabled;
  if (autoEnabled) toggleAutoSync(true);
}

// ======= COMPLIANCE CONFIG (Configurable thresholds) =======
var COMPLIANCE_CONFIG_STORAGE = 'fgl_compliance_config';
function getDefaultComplianceConfig() {
  return {
    docExpiryDays: 10,
    gapRemediationDays: 15,
    screeningStaleDays: 90,
    autoRescreenDays: 0,
    riskCritical: 12,
    riskHigh: 8,
    riskMedium: 4,
    highRiskCountries: 'iran,north korea,dprk,syria,yemen,myanmar,afghanistan,libya,iraq,sudan,somalia,south sudan,congo,mali,central african republic'
  };
}
var complianceConfig = safeLocalParse(COMPLIANCE_CONFIG_STORAGE, getDefaultComplianceConfig());
if (!complianceConfig.docExpiryDays) complianceConfig = getDefaultComplianceConfig();

function saveComplianceConfig() {
  complianceConfig = {
    docExpiryDays: Number(document.getElementById('cfgDocExpiryDays').value) || 10,
    gapRemediationDays: Number(document.getElementById('cfgGapRemediationDays').value) || 15,
    screeningStaleDays: Number(document.getElementById('cfgScreeningStaleDays').value) || 90,
    autoRescreenDays: Number(document.getElementById('cfgAutoRescreenDays').value) || 0,
    riskCritical: Number(document.getElementById('cfgRiskCritical').value) || 12,
    riskHigh: Number(document.getElementById('cfgRiskHigh').value) || 8,
    riskMedium: Number(document.getElementById('cfgRiskMedium').value) || 4,
    highRiskCountries: (document.getElementById('cfgHighRiskCountries').value || '').toLowerCase().trim()
  };
  if (complianceConfig.riskCritical <= complianceConfig.riskHigh || complianceConfig.riskHigh <= complianceConfig.riskMedium) { toast('Risk thresholds must be ordered: Critical > High > Medium','error'); return; }
  safeLocalSave(COMPLIANCE_CONFIG_STORAGE, complianceConfig);
  toast('Compliance configuration saved', 'success');
  runAlertScanner();
}
function resetComplianceConfig() {
  complianceConfig = getDefaultComplianceConfig();
  safeLocalSave(COMPLIANCE_CONFIG_STORAGE, complianceConfig);
  loadComplianceConfigUI();
  toast('Configuration reset to defaults', 'info');
}
function loadComplianceConfigUI() {
  var c = complianceConfig;
  var set = function(id, v) { var el = document.getElementById(id); if (el) el.value = v; };
  set('cfgDocExpiryDays', c.docExpiryDays);
  set('cfgGapRemediationDays', c.gapRemediationDays);
  set('cfgScreeningStaleDays', c.screeningStaleDays);
  set('cfgAutoRescreenDays', c.autoRescreenDays);
  set('cfgRiskCritical', c.riskCritical);
  set('cfgRiskHigh', c.riskHigh);
  set('cfgRiskMedium', c.riskMedium);
  set('cfgHighRiskCountries', c.highRiskCountries);
}

// ======= BULK FILE UPLOAD =======
async function uploadMultipleFiles() {
  var input = document.getElementById('uploadFileInput');
  var files = input.files;
  if (!files || !files.length) { toast('Select files to upload', 'error'); return; }
  var category = document.getElementById('uploadCategory').value;
  var btn = document.getElementById('uploadBtn');
  var progress = document.getElementById('uploadProgress');
  var progressBar = document.getElementById('uploadProgressBar');
  var statusText = document.getElementById('uploadStatusText');
  btn.disabled = true; btn.textContent = 'Uploading...';
  progress.style.display = 'block';
  var total = files.length, completed = 0, failed = 0;
  for (var i = 0; i < total; i++) {
    var file = files[i];
    if (file.size > 50 * 1024 * 1024) { failed++; toast(file.name + ' too large, skipped', 'error'); continue; }
    statusText.textContent = 'Uploading ' + (i+1) + '/' + total + ': ' + file.name;
    progressBar.style.width = Math.round(((i+0.5)/total)*100) + '%';
    var formData = new FormData();
    formData.append('file', file);
    formData.append('category', category);
    try {
      var response = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!response.ok) throw new Error('Failed');
      completed++;
    } catch(e) { failed++; }
    progressBar.style.width = Math.round(((i+1)/total)*100) + '%';
  }
  statusText.textContent = completed + ' uploaded' + (failed ? ', ' + failed + ' failed' : '');
  toast(completed + ' file(s) uploaded' + (failed ? ', ' + failed + ' failed' : ''), failed ? 'error' : 'success');
  logAudit('Bulk Upload', completed + ' files uploaded, ' + failed + ' failed');
  input.value = '';
  var selName = document.getElementById('selectedFileName');
  if (selName) selName.style.display = 'none';
  setTimeout(function() { progress.style.display = 'none'; progressBar.style.width = '0%'; }, 2000);
  btn.disabled = false; btn.textContent = '📤 Upload File';
  loadUploadedFiles();
}

// ======= EXPORT CONFIRMATION =======
var _origExportPDF = typeof exportPDF === 'function' ? exportPDF : null;
var _origExportShipmentsCSV = typeof exportShipmentsCSV === 'function' ? exportShipmentsCSV : null;
var _origExportScreeningPDF = typeof exportScreeningPDF === 'function' ? exportScreeningPDF : null;
var _origExportBoardReport = typeof exportBoardReport === 'function' ? exportBoardReport : null;
function wrapExportConfirm(origFn, name) {
  return function() {
    if (!confirm('Export ' + name + '? This may contain sensitive compliance data.')) return;
    origFn.apply(this, arguments);
  };
}
if (_origExportScreeningPDF) exportScreeningPDF = wrapExportConfirm(_origExportScreeningPDF, 'Screening History PDF');
if (_origExportBoardReport) exportBoardReport = wrapExportConfirm(_origExportBoardReport, 'Board Report');

// ======= LOCALSTORAGE QUOTA WARNING =======
var _origSafeLocalSave = safeLocalSave;
safeLocalSave = function(key, value) {
  try {
    _origSafeLocalSave(key, value);
  } catch(e) {
    if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
      toast('Storage full! Data may not be saved. Export your data and clear old records.', 'error', 8000);
      console.error('[Storage] Quota exceeded for key:', key);
    } else {
      throw e;
    }
  }
};
function checkStorageQuota() {
  var el = document.getElementById('storageQuotaInfo');
  if (!el) return;
  try {
    var total = 0;
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      total += (localStorage.getItem(k) || '').length;
    }
    var mb = (total / (1024*1024)).toFixed(2);
    var pct = Math.min(100, (total / (5*1024*1024)) * 100).toFixed(0);
    el.innerHTML = 'Storage used: <strong>' + mb + ' MB</strong> (~' + pct + '% of ~5 MB limit)';
    if (pct > 80) el.style.color = 'var(--red)';
    else if (pct > 60) el.style.color = 'var(--amber)';
    else el.style.color = 'var(--muted)';
  } catch(e) { el.textContent = 'Unable to check storage quota'; }
}

// ======= OFFLINE INDEXEDDB CACHE =======
var ComplianceCache = (function() {
  var DB_NAME = 'ComplianceAnalyzerCache';
  var DB_VERSION = 1;
  var STORE = 'offlineData';
  function openDB() {
    return new Promise(function(resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function(e) { e.target.result.createObjectStore(STORE); };
      req.onsuccess = function(e) { resolve(e.target.result); };
      req.onerror = function(e) { reject(e.target.error); };
    });
  }
  return {
    save: async function(key, data) {
      var db = await openDB();
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ data: data, ts: Date.now() }, key);
        tx.oncomplete = resolve;
        tx.onerror = function() { reject(tx.error); };
      });
    },
    load: async function(key) {
      var db = await openDB();
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get(key);
        req.onsuccess = function() { resolve(req.result ? req.result.data : null); };
        req.onerror = function() { reject(req.error); };
      });
    },
    syncAll: async function() {
      try {
        var keys = ['fgl_shipments','fgl_gaps_v2','fgl_screening','fgl_employees','fgl_onboarding','fgl_incidents','fgl_audit_log'];
        for (var i = 0; i < keys.length; i++) {
          var raw = localStorage.getItem(keys[i]);
          if (raw) await ComplianceCache.save(keys[i], JSON.parse(raw));
        }
        console.log('[OfflineCache] Synced to IndexedDB');
      } catch(e) { console.warn('[OfflineCache] Sync failed:', e); }
    }
  };
})();
// Auto-sync to IndexedDB every 2 minutes
setInterval(function() { ComplianceCache.syncAll(); }, 120000);

// ======= CROSS-SHIPMENT ANOMALY DETECTION =======
function detectShipmentAnomalies() {
  var anomalies = [];
  var now = new Date();
  var byCustomer = {};
  var byDay = {};
  (window.shipments || []).forEach(function(s) {
    var cust = s.supplierCustomer || s.customerId || 'Unknown';
    if (!byCustomer[cust]) byCustomer[cust] = [];
    byCustomer[cust].push(s);
    var day = (s.createdAt || '').slice(0, 10);
    var key = cust + '|' + day;
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(s);
  });
  // Anomaly 1: Same customer, same day, different methods
  Object.keys(byDay).forEach(function(key) {
    var group = byDay[key];
    if (group.length < 2) return;
    var currencies = new Set(group.map(function(s) { return s.currency; }).filter(Boolean));
    var directions = new Set(group.map(function(s) { return s.direction; }).filter(Boolean));
    if (currencies.size > 1 || directions.size > 1) {
      anomalies.push({ type: 'CONFLICTING_METHODS', severity: 'HIGH', customer: key.split('|')[0], date: key.split('|')[1], count: group.length, detail: 'Same customer, same day: ' + currencies.size + ' currencies, ' + directions.size + ' directions' });
    }
  });
  // Anomaly 2: Volume spike (>3x average in last 7 days)
  Object.keys(byCustomer).forEach(function(cust) {
    var items = byCustomer[cust];
    if (items.length < 4) return;
    var weekAgo = new Date(now.getTime() - 7 * 86400000);
    var recent = items.filter(function(s) { return new Date(s.createdAt) > weekAgo; });
    var older = items.filter(function(s) { return new Date(s.createdAt) <= weekAgo; });
    if (older.length < 2) return;
    var olderWeeks = Math.max(1, Math.ceil(older.length / 4));
    var avgPerWeek = older.length / olderWeeks;
    if (recent.length > avgPerWeek * 3 && recent.length >= 3) {
      anomalies.push({ type: 'VOLUME_SPIKE', severity: 'CRITICAL', customer: cust, count: recent.length, detail: cust + ': ' + recent.length + ' shipments this week vs avg ' + avgPerWeek.toFixed(1) + '/week' });
    }
  });
  // Anomaly 3: Structuring — multiple just-below-threshold amounts
  Object.keys(byCustomer).forEach(function(cust) {
    var items = byCustomer[cust];
    var weekAgo = new Date(now.getTime() - 7 * 86400000);
    var recent = items.filter(function(s) { return new Date(s.createdAt) > weekAgo && Number(s.amount) > 0; });
    var justBelow = recent.filter(function(s) { var a = Number(s.amount); return a >= 40000 && a < 55000; });
    if (justBelow.length >= 3) {
      anomalies.push({ type: 'STRUCTURING', severity: 'CRITICAL', customer: cust, count: justBelow.length, detail: cust + ': ' + justBelow.length + ' transactions just below AED 55,000 threshold in 7 days' });
    }
  });
  return anomalies;
}

// ======= BI-DIRECTIONAL ASANA SYNC =======
async function pullAsanaTaskStatuses() {
  if (!ASANA_TOKEN && !PROXY_URL) return;
  try {
    var projectId = ASANA_PROJECT_MAP[activeCompanyId]?.compliance;
    if (!projectId) return;
    var r = await asanaFetch('/projects/' + projectId + '/tasks?opt_fields=gid,name,completed,completed_at,modified_at&completed_since=now');
    var data = await r.json();
    if (!data.data) return;
    var completedTasks = data.data.filter(function(t) { return t.completed; });
    if (completedTasks.length) {
      toast(completedTasks.length + ' Asana task(s) completed — synced', 'success', 3000);
      logAudit('Asana Bi-Sync', completedTasks.length + ' completed tasks pulled from Asana');
    }
    return completedTasks;
  } catch(e) { console.warn('[Asana Bi-Sync]', e.message); return []; }
}

// ======= SCHEDULED AUTO RE-SCREENING =======
var AUTO_RESCREEN_STORAGE = 'fgl_auto_rescreen_last';
function checkAutoRescreen() {
  if (!complianceConfig.autoRescreenDays || complianceConfig.autoRescreenDays <= 0) return;
  var lastRun = safeLocalParse(AUTO_RESCREEN_STORAGE, null);
  var now = Date.now();
  var interval = complianceConfig.autoRescreenDays * 86400000;
  if (lastRun && (now - lastRun) < interval) return;
  var history = safeLocalParse(SCREENING_STORAGE, []);
  var stale = history.filter(function(h) {
    var age = (now - new Date(h.date).getTime()) / 86400000;
    return age > complianceConfig.screeningStaleDays;
  });
  if (stale.length > 0) {
    toast(stale.length + ' screening(s) overdue for re-check — review in Screening tab', 'error', 6000);
    logAudit('Auto Re-screen', stale.length + ' stale screenings detected');
  }
  safeLocalSave(AUTO_RESCREEN_STORAGE, now);
}
setInterval(function() { try { checkAutoRescreen(); } catch(e){} }, 3600000);

// ======= STR TEMPLATE VALIDATION =======
var STR_MANDATORY_FIELDS = [
  'Filing Institution',
  'Reporting Officer',
  'Subject Name',
  'Subject Identification',
  'Transaction Date',
  'Transaction Amount',
  'Transaction Currency',
  'Transaction Method',
  'Grounds for Suspicion',
  'goAML Reference'
];
function validateSTRDraft(text) {
  var missing = [];
  var lower = text.toLowerCase();
  STR_MANDATORY_FIELDS.forEach(function(field) {
    var patterns = [field.toLowerCase(), field.toLowerCase().replace(/ /g, '_'), field.toLowerCase().replace(/ /g, '-')];
    var found = patterns.some(function(p) { return lower.indexOf(p) !== -1; });
    if (!found) missing.push(field);
  });
  return missing;
}


// ======= INIT NEW FEATURES =======
function initNewFeatures() {
  var features = [
    ['Screening', loadScreeningHistory],
    ['Onboarding', renderOnboardingList],
    ['Incidents', renderIncidents],
    ['Deadlines', renderDeadlines],
    ['Calendar', renderPreloadedCalendar],
    ['Vault', renderVaultDocs],
    ['Dashboard', refreshDashboard],
    ['Definitions', renderDefinitions],

    ['ComplianceConfig', loadComplianceConfigUI],
    ['StorageQuota', checkStorageQuota],
    ['OfflineCache', function() { ComplianceCache.syncAll(); }],
    ['AutoRescreen', checkAutoRescreen],
    ['CloudSync', initCloudSyncUI]
  ];
  features.forEach(function(f) {
    try { f[1](); } catch(e) { console.warn('[Init] ' + f[0] + ' failed:', e.message); }
  });
}

// Boot: check session, then init
(async function boot() {
  // Clean up ghost users created by old auth-rbac.js module
  try {
    var ghostUsers = getUsers() || [];
    if (ghostUsers.length === 1 && ghostUsers[0].username === 'admin' && ghostUsers[0].mustChangePassword) {
      localStorage.removeItem(USERS_STORAGE);
      localStorage.removeItem(SESSION_STORAGE);
    }
  } catch(_) {}

  try {
    initialiseApp();
  } catch(e) { console.error('[Boot] initialiseApp failed:', e); }
  try {
    initNewFeatures();
  } catch(e) { console.error('[Boot] initNewFeatures failed:', e); }
  try {
    if (checkSession()) {
      if (window._keysLoaded) {
        openMainPanel();
        toast('Saved configuration loaded','info', 2500);
      }
    } else {
      // Check for existing users — require setup wizard if none exist
      var users = getUsers();
      if (!users || !users.length) {
        // No users — show setup wizard (do NOT auto-create with hardcoded credentials)
        document.getElementById('mainApp').style.display = 'none';
      }
      // Login as first active admin only if users exist
      var allUsers = getUsers() || [];
      var adminUser = allUsers.find(function(u) { return u.active && u.role === 'admin'; });
      if (adminUser) {
        currentUser = { id: adminUser.id, username: adminUser.username, displayName: adminUser.displayName, role: adminUser.role };
        localStorage.setItem(SESSION_STORAGE, JSON.stringify(currentUser));
        showMainApp();
      } else {
        document.getElementById('mainApp').style.display = 'none';
        document.getElementById('loginOverlay').style.display = 'flex';
        await initDefaultUsers();
      }
    }
  } catch(e) {
    console.error('[Boot] session check failed:', e);
    // Fallback: if boot fails and no session, ensure login is visible
    try {
      document.getElementById('mainApp').style.display = 'none';
      document.getElementById('loginOverlay').style.display = 'flex';
      var fallbackUsers = getUsers();
      if (!fallbackUsers || !fallbackUsers.length) {
        document.getElementById('loginBox').style.display = 'none';
        document.getElementById('setupWizard').style.display = 'block';
      }
    } catch(_) {}
  }
  setInterval(function() { try { if (currentUser) refreshReminders(); } catch(_) {} }, 5 * 60 * 1000);

  // Safety net: if after boot, no session and no users, ensure setup wizard is shown
  setTimeout(function() {
    if (!currentUser) {
      var u = getUsers();
      if (!u || !u.length) {
        var lb = document.getElementById('loginBox');
        var sw = document.getElementById('setupWizard');
        if (lb) lb.style.display = 'none';
        if (sw) sw.style.display = 'block';
      }
      var lo = document.getElementById('loginOverlay');
      if (lo) lo.style.display = 'flex';
    }
  }, 500);
})();
