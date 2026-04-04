/**
 * Shared Asana project resolver — routes tasks to customer-specific projects.
 *
 * Used by: workflow-engine.js, compliance-suite.js, integrations-enhanced.js, analytics-dashboard.js
 *
 * Each customer has two Asana projects:
 *   - asanaComplianceProjectGid: compliance cases, alerts, screening
 *   - asanaWorkflowProjectGid: workflow tasks, approvals, reviews
 */
(function(global) {
  'use strict';

  var DEFAULT_PROJECT = '1213759768596515';

  // Customer registry with Asana project GIDs (mirrors src/domain/customers.ts)
  var CUSTOMER_PROJECTS = {
    'company-1': { name: 'MADISON JEWELLERY TRADING L.L.C', compliance: '1213825539896477', workflow: '1213825580399850' },
    'company-2': { name: 'NAPLES JEWELLERY TRADING L.L.C',  compliance: '1213825365472836', workflow: '1213825542010518' },
    'company-3': { name: 'GRAMALTIN KIYMETLI MADENLER RAFINERI SANAYI VE TICARET ANONIM SIRKETI', compliance: '1213838252710765', workflow: '1213825541970651' },
    'company-4': { name: 'ZOE Precious Metals and Jewelery (FZE)', compliance: '1213825578259027', workflow: '1213825580398407' },
    'company-5': { name: 'FINE GOLD LLC',     compliance: '1213900474912902', workflow: '1213759768596515' },
    'company-6': { name: 'FINE GOLD (BRANCH)', compliance: '1213900370769721', workflow: '1213899469870046' },
  };

  /**
   * Get the active company from the existing getActiveCompany() function.
   * Returns { id, name } or fallback.
   */
  function getActiveCompanyInfo() {
    if (typeof getActiveCompany === 'function') {
      var comp = getActiveCompany();
      if (comp && comp.id) return comp;
      // Try matching by name
      if (comp && comp.name) {
        for (var id in CUSTOMER_PROJECTS) {
          if (CUSTOMER_PROJECTS[id].name === comp.name) {
            return { id: id, name: comp.name };
          }
        }
      }
      return comp || {};
    }
    return {};
  }

  /**
   * Resolve the correct Asana project ID for the active company.
   * @param {'compliance'|'workflow'} type - Project type (default: 'workflow')
   * @param {string} [customerId] - Optional explicit customer ID
   * @returns {string} Asana project GID
   */
  function resolveAsanaProject(type, customerId) {
    type = type || 'workflow';
    var id = customerId || getActiveCompanyInfo().id;

    if (id && CUSTOMER_PROJECTS[id]) {
      var proj = CUSTOMER_PROJECTS[id];
      return type === 'compliance' ? proj.compliance : proj.workflow;
    }

    // Fallback chain: localStorage > global > default
    return localStorage.getItem('asanaProjectId')
      || (typeof ASANA_PROJECT !== 'undefined' ? ASANA_PROJECT : null)
      || DEFAULT_PROJECT;
  }

  /**
   * Get the company name for the active company.
   */
  function resolveEntityName(customerId) {
    var id = customerId || getActiveCompanyInfo().id;
    if (id && CUSTOMER_PROJECTS[id]) return CUSTOMER_PROJECTS[id].name;
    var comp = getActiveCompanyInfo();
    return comp.name || 'Hawkeye Sterling';
  }

  // ─── Retry Queue ───────────────────────────────────────────────────────────

  var QUEUE_KEY = 'asana_retry_queue';
  var MAX_QUEUE = 50;

  function readRetryQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch(e) { return []; }
  }

  function writeRetryQueue(queue) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(0, MAX_QUEUE))); } catch(e) {}
  }

  /**
   * Queue a failed Asana task for retry.
   */
  function queueAsanaRetry(entry) {
    var queue = readRetryQueue();
    // Dedupe by task name
    var exists = queue.some(function(e) { return e.taskName === entry.taskName; });
    if (exists) return;

    entry.attempts = entry.attempts || 0;
    entry.createdAt = entry.createdAt || new Date().toISOString();
    queue.push(entry);
    writeRetryQueue(queue);
    console.warn('[AsanaRetryQueue] Queued:', entry.taskName, '(' + entry.lastError + ')');
  }

  /**
   * Process the retry queue — call periodically.
   */
  async function processAsanaRetryQueue() {
    if (typeof asanaFetch !== 'function') return { processed: 0, succeeded: 0, failed: 0 };
    var queue = readRetryQueue();
    if (!queue.length) return { processed: 0, succeeded: 0, failed: 0 };

    var succeeded = 0;
    var failed = 0;
    var remaining = [];

    for (var i = 0; i < queue.length; i++) {
      var entry = queue[i];
      if (entry.attempts >= 5) { remaining.push(entry); continue; }

      entry.attempts++;
      entry.lastAttemptAt = new Date().toISOString();

      try {
        var res = await asanaFetch('/tasks', { method: 'POST', body: JSON.stringify(entry.body) });
        if (res.ok) { succeeded++; }
        else { entry.lastError = 'HTTP ' + res.status; remaining.push(entry); failed++; }
      } catch(e) {
        entry.lastError = e.message;
        remaining.push(entry);
        failed++;
      }
    }

    writeRetryQueue(remaining);
    return { processed: queue.length, succeeded: succeeded, failed: failed };
  }

  /**
   * Sync status tracking.
   */
  function setAsanaModuleSync(moduleName, patch) {
    try {
      var key = 'asana_sync_' + moduleName;
      var current = JSON.parse(localStorage.getItem(key) || '{}');
      Object.assign(current, patch);
      localStorage.setItem(key, JSON.stringify(current));
    } catch(e) {}
  }

  function getAsanaModuleSync(moduleName) {
    try { return JSON.parse(localStorage.getItem('asana_sync_' + moduleName) || '{}'); } catch(e) { return {}; }
  }

  // Export to global scope
  global.AsanaProjectResolver = {
    resolveProject: resolveAsanaProject,
    resolveEntityName: resolveEntityName,
    getActiveCompanyInfo: getActiveCompanyInfo,
    CUSTOMER_PROJECTS: CUSTOMER_PROJECTS,
    DEFAULT_PROJECT: DEFAULT_PROJECT,
  };

  // Make retry/sync functions globally available (fixes undefined references)
  global.queueAsanaRetry = queueAsanaRetry;
  global.processAsanaRetryQueue = processAsanaRetryQueue;
  global.setAsanaModuleSync = setAsanaModuleSync;
  global.getAsanaModuleSync = getAsanaModuleSync;

})(typeof window !== 'undefined' ? window : globalThis);
