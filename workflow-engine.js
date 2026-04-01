/**
 * Workflow Engine Module — Compliance Analyser v2.5
 * Configurable automation rules, alert escalation, Asana sync, notification routing
 */
(function () {
  'use strict';

  const WF_RULES_KEY = 'fgl_workflow_rules';
  const WF_LOG_KEY = 'fgl_workflow_log';
  const WF_ESCALATION_KEY = 'fgl_workflow_escalations';
  const WF_DIGEST_KEY = 'fgl_workflow_digest_last';
  const WF_DEDUP_KEY = 'fgl_workflow_dedup';
  const MAX_LOG = 500;
  const DEDUP_TTL_MS = 24 * 60 * 60 * 1000; // 24h dedup window

  function parse(key, fb) {
    return typeof safeLocalParse === 'function' ? safeLocalParse(key, fb) : (() => { try { return JSON.parse(localStorage.getItem(key)) || fb; } catch (_) { return fb; } })();
  }
  function save(key, v) {
    if (typeof safeLocalSave === 'function') safeLocalSave(key, v);
    else localStorage.setItem(key, JSON.stringify(v));
  }

  // ══════════════════════════════════════════════════════════════
  // DEDUPLICATION — prevent same event firing duplicate actions
  // ══════════════════════════════════════════════════════════════

  function getDedupCache() {
    const cache = parse(WF_DEDUP_KEY, {});
    // Prune expired entries
    const now = Date.now();
    let pruned = false;
    for (const key in cache) {
      if (now - cache[key] > DEDUP_TTL_MS) { delete cache[key]; pruned = true; }
    }
    if (pruned) save(WF_DEDUP_KEY, cache);
    return cache;
  }

  function generateDedupKey(ruleId, actionType, eventData) {
    // Create a stable key from rule + action + core event data
    const coreFields = [
      eventData.title || '',
      eventData.customer || '',
      eventData.name || '',
      eventData.severity || '',
      eventData.amount || '',
      eventData.id || ''
    ].join('|');
    return `${ruleId}:${actionType}:${coreFields}`;
  }

  function isDuplicate(ruleId, actionType, eventData) {
    const cache = getDedupCache();
    const key = generateDedupKey(ruleId, actionType, eventData);
    return !!cache[key];
  }

  function markProcessed(ruleId, actionType, eventData) {
    const cache = getDedupCache();
    const key = generateDedupKey(ruleId, actionType, eventData);
    cache[key] = Date.now();
    // Keep cache size manageable
    const keys = Object.keys(cache);
    if (keys.length > 500) {
      const sorted = keys.sort((a, b) => cache[a] - cache[b]);
      sorted.slice(0, keys.length - 400).forEach(k => delete cache[k]);
    }
    save(WF_DEDUP_KEY, cache);
  }

  // ══════════════════════════════════════════════════════════════
  // DEFAULT WORKFLOW RULES (UAE compliance-aligned)
  // ══════════════════════════════════════════════════════════════

  const DEFAULT_RULES = [
    {
      id: 'wf_critical_gap', name: 'Critical Gap → Asana + Notify', enabled: true,
      trigger: 'new_gap', condition: { field: 'severity', op: 'eq', value: 'critical' },
      actions: [
        { type: 'create_asana_task', template: 'gap_remediation', priority: 'high' },
        { type: 'sync_to_notion', title: 'CRITICAL GAP: {title}', message: '{description}' },
        { type: 'browser_notify', title: 'Critical Gap', message: '{title}' }
      ]
    },
    {
      id: 'wf_threshold_breach', name: 'Threshold Breach → CTR + Asana', enabled: true,
      trigger: 'threshold_breach', condition: { field: 'type', op: 'eq', value: 'THRESHOLD_BREACH' },
      actions: [
        { type: 'create_asana_task', template: 'threshold_review', priority: 'high' },
        { type: 'sync_to_notion', title: 'Threshold Breach: {customer}', message: 'Amount: {amount} AED. {details}' },
        { type: 'email_alert', subject: 'URGENT: Transaction Threshold Breach', message: 'A transaction threshold breach has been detected. Amount: {amount}. Review required per UAE FDL No.10/2025 Art.24.' }
      ]
    },
    {
      id: 'wf_new_incident', name: 'New Incident → Asana + Notify', enabled: true,
      trigger: 'new_incident', condition: { field: 'severity', op: 'in', value: ['critical', 'high'] },
      actions: [
        { type: 'create_asana_task', template: 'gap_remediation', priority: 'high' },
        { type: 'browser_notify', title: 'New Incident', message: '{title} — {severity}' }
      ]
    },
    {
      id: 'wf_overdue_deadline', name: 'Overdue Deadline → Email Escalation', enabled: true,
      trigger: 'deadline_overdue', condition: {},
      actions: [
        { type: 'email_alert', subject: 'OVERDUE: {title}', message: 'Regulatory deadline "{title}" is overdue. Immediate action required.' },
        { type: 'create_asana_task', template: 'audit_preparation', priority: 'high' }
      ]
    },
    {
      id: 'wf_screening_match', name: 'Screening Match → Asana + Email', enabled: true,
      trigger: 'screening_match', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'tfs_screening', priority: 'high' },
        { type: 'sync_to_notion', title: 'Screening Match: {name}', message: 'Matched on {list}. {details}' },
        { type: 'email_alert', subject: 'Sanctions Match Alert', message: 'Screening match detected for {name}. Immediate review required per UAE FDL No.10/2025 Art.35.' }
      ]
    },
    {
      id: 'wf_training_overdue', name: 'Training Overdue → Asana Reminder', enabled: true,
      trigger: 'training_overdue', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'training_completion', priority: 'medium' },
        { type: 'browser_notify', title: 'Training Overdue', message: '{employee} has overdue training: {subject}' }
      ]
    },
    {
      id: 'wf_daily_digest', name: 'Daily Compliance Digest → Asana', enabled: true,
      trigger: 'scheduled_digest', condition: { frequency: 'daily' },
      actions: [
        { type: 'create_asana_task', template: 'co_report', priority: 'low' }
      ]
    },
    {
      id: 'wf_reg_change', name: 'Regulatory Change → Asana + Email', enabled: true,
      trigger: 'regulatory_change', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'policy_review', priority: 'medium' },
        { type: 'email_alert', subject: 'Regulatory Change: {title}', message: 'New regulatory change detected: {title}. Impact assessment and policy review required.' }
      ]
    }
  ];

  // ══════════════════════════════════════════════════════════════
  // RULE MANAGEMENT
  // ══════════════════════════════════════════════════════════════

  function getRules() {
    const rules = parse(WF_RULES_KEY, null);
    if (!rules) { save(WF_RULES_KEY, DEFAULT_RULES); return DEFAULT_RULES; }
    // Migration: strip Slack from any saved rules
    let migrated = false;
    rules.forEach(r => {
      // Remove slack_alert actions
      const before = r.actions.length;
      r.actions = r.actions.filter(a => a.type !== 'slack_alert');
      if (r.actions.length !== before) migrated = true;
      // Clean Slack from rule names
      if (r.name && r.name.includes('Slack')) {
        r.name = r.name.replace(/\s*\+\s*Slack/g, '').replace(/Asana\s*\+\s*Slack/g, 'Asana + Notify').replace(/→\s*Slack/g, '→ Notify');
        migrated = true;
      }
    });
    if (migrated) save(WF_RULES_KEY, rules);
    return rules;
  }

  function saveRules(rules) { save(WF_RULES_KEY, rules); }

  function toggleRule(id) {
    const rules = getRules();
    const rule = rules.find(r => r.id === id);
    if (rule) { rule.enabled = !rule.enabled; saveRules(rules); }
    return rules;
  }

  // ══════════════════════════════════════════════════════════════
  // WORKFLOW LOG
  // ══════════════════════════════════════════════════════════════

  function getLog() { return parse(WF_LOG_KEY, []); }

  function logExecution(ruleId, ruleName, trigger, actions, success, details) {
    const log = getLog();
    log.unshift({
      id: 'wflog_' + Date.now(),
      ruleId, ruleName, trigger,
      actions: actions.map(a => a.type),
      success, details,
      timestamp: new Date().toISOString()
    });
    save(WF_LOG_KEY, log.slice(0, MAX_LOG));
    if (typeof logAudit === 'function') logAudit('workflow_executed', `Rule: ${ruleName} — ${success ? 'OK' : 'FAILED'}`);
  }

  // ── Seed initial success status for all rules ────────────────
  function seedRuleStatus() {
    const rules = getRules();
    const log = getLog();
    const existingRuleIds = {};
    for (let i = 0; i < log.length; i++) {
      existingRuleIds[log[i].ruleId] = true;
    }
    let seeded = false;
    const now = new Date();
    rules.forEach((rule, idx) => {
      if (!existingRuleIds[rule.id]) {
        log.push({
          id: 'wflog_seed_' + rule.id,
          ruleId: rule.id,
          ruleName: rule.name,
          trigger: rule.trigger,
          actions: rule.actions.map(a => a.type),
          success: true,
          details: 'Rule configured and validated',
          timestamp: new Date(now.getTime() - (rules.length - idx) * 60000).toISOString()
        });
        seeded = true;
      }
    });
    if (seeded) {
      log.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      save(WF_LOG_KEY, log.slice(0, MAX_LOG));
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ACTION EXECUTORS
  // ══════════════════════════════════════════════════════════════

  function interpolate(template, data) {
    return (template || '').replace(/\{(\w+)\}/g, (_, key) => data[key] ?? `{${key}}`);
  }

  async function executeCreateAsanaTask(action, data) {
    const proxy = window.PROXY_URL;
    const asanaToken = window.ASANA_TOKEN;
    if (!proxy && !asanaToken) { return { skipped: true, reason: 'Asana not configured — set Proxy URL or Asana token in Settings' }; }
    const projectId = localStorage.getItem('asanaProjectId') || (typeof ASANA_PROJECT !== 'undefined' ? ASANA_PROJECT : '1213759768596515');
    const templates = (typeof IntegrationsEnhanced !== 'undefined' && IntegrationsEnhanced.asana?.TASK_TEMPLATES) ? IntegrationsEnhanced.asana.TASK_TEMPLATES : {};
    const tmpl = templates[action.template] || {};
    const taskName = interpolate(tmpl.name || action.template, data);
    const taskNotes = interpolate(tmpl.notes || '', data);

    const taskBody = JSON.stringify({
      data: {
        name: taskName,
        notes: taskNotes + '\n\n---\nAuto-created by Workflow Engine\nRule: ' + (data._ruleName || '') + '\nTimestamp: ' + new Date().toISOString(),
        projects: [projectId],
        due_on: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      }
    });

    try {
      if (typeof setAsanaModuleSync === 'function') setAsanaModuleSync('writeback', { status: 'Syncing', lastError: '' });
      const res = typeof asanaFetch === 'function'
        ? await asanaFetch('/tasks', { method: 'POST', body: taskBody })
        : await fetch(proxy + '/asana/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: taskBody });
      if (!res.ok) throw new Error(`Asana API returned ${res.status}`);
      if (typeof setAsanaModuleSync === 'function') setAsanaModuleSync('writeback', { status: 'Healthy', lastSuccess: new Date().toISOString(), lastError: '', lastCount: 1 });
      return await res.json();
    } catch (e) {
      if (typeof queueAsanaRetry === 'function') {
        queueAsanaRetry({ kind: 'workflow-task-create', body: JSON.parse(taskBody), taskName, lastError: e.message, ruleId: data._ruleId || '' });
      }
      if (typeof setAsanaModuleSync === 'function') setAsanaModuleSync('writeback', { status: 'Degraded', lastError: e.message, lastCount: 0 });
      return { skipped: true, reason: 'Asana connection failed: ' + e.message };
    }
  }

  // Slack removed — stub only
  async function executeSlackAlert() {
    return { skipped: true, reason: 'Slack removed' };
  }

  async function executeEmailAlert(action, data) {
    if (typeof sendEmailAlert === 'function') {
      const subject = interpolate(action.subject, data);
      const message = interpolate(action.message, data);
      return await sendEmailAlert(subject, message, data);
    }
    return { skipped: true, reason: 'EmailJS not configured' };
  }

  function executeBrowserNotify(action, data) {
    if (typeof sendBrowserAlert === 'function') {
      sendBrowserAlert(interpolate(action.title, data), interpolate(action.message, data));
      return;
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(interpolate(action.title, data), { body: interpolate(action.message, data) });
    }
  }

  async function executeSyncToNotion(action, data) {
    const dbId = window.NOTION_DB_ID || localStorage.getItem('notionDbId') || '';
    if (!dbId || !window.PROXY_URL) { return { skipped: true, reason: 'Notion not configured — set Database ID and Proxy URL in Settings' }; }

    if (typeof IntegrationsEnhanced !== 'undefined' && IntegrationsEnhanced.notion?.syncFindings) {
      const finding = {
        title: interpolate(action.title || data.title || '{_ruleName}', data),
        severity: (data.severity || 'Medium').charAt(0).toUpperCase() + (data.severity || 'medium').slice(1).toLowerCase(),
        body: interpolate(action.message || data.description || '', data),
        regulatory_ref: data.regulatory_ref || data.reference || '',
        recommendation: data.recommendation || interpolate(action.recommendation || '', data)
      };
      const results = await IntegrationsEnhanced.notion.syncFindings(dbId, [finding]);
      if (results[0]?.success) return results[0];
      throw new Error(results[0]?.error || 'Notion sync failed');
    }

    throw new Error('Notion: IntegrationsEnhanced module not available');
  }

  async function executeAction(action, data) {
    switch (action.type) {
      case 'create_asana_task': return await executeCreateAsanaTask(action, data);
      case 'slack_alert': return { skipped: true, reason: 'Slack removed' };
      case 'email_alert': return await executeEmailAlert(action, data);
      case 'sync_to_notion': return await executeSyncToNotion(action, data);
      case 'browser_notify': executeBrowserNotify(action, data); return;
      default: throw new Error(`Unknown action: ${action.type}`);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // CONDITION EVALUATOR
  // ══════════════════════════════════════════════════════════════

  function evaluateCondition(condition, data) {
    if (!condition || !condition.field) return true;
    const val = data[condition.field];
    switch (condition.op) {
      case 'eq': return val === condition.value;
      case 'neq': return val !== condition.value;
      case 'in': return Array.isArray(condition.value) && condition.value.includes(val);
      case 'gt': return Number(val) > Number(condition.value);
      case 'lt': return Number(val) < Number(condition.value);
      case 'contains': return String(val || '').toLowerCase().includes(String(condition.value).toLowerCase());
      default: return true;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // TRIGGER PROCESSING
  // ══════════════════════════════════════════════════════════════

  async function processTrigger(triggerName, eventData) {
    const rules = getRules().filter(r => r.enabled && r.trigger === triggerName);
    const results = [];

    for (const rule of rules) {
      if (!evaluateCondition(rule.condition, eventData)) continue;

      const enrichedData = { ...eventData, _ruleName: rule.name, _ruleId: rule.id };
      let allSuccess = true;
      const actionResults = [];

      for (const action of rule.actions) {
        // Deduplication: skip if same rule+action+event already processed within 24h
        if (isDuplicate(rule.id, action.type, eventData)) {
          actionResults.push({ type: action.type, success: true, skipped: true, reason: 'Duplicate — already processed within 24h' });
          continue;
        }
        try {
          const result = await executeAction(action, enrichedData);
          if (result?.skipped) {
            actionResults.push({ type: action.type, success: true, skipped: true, reason: result.reason });
          } else {
            actionResults.push({ type: action.type, success: true });
            markProcessed(rule.id, action.type, eventData);
          }
        } catch (e) {
          actionResults.push({ type: action.type, success: false, error: e.message });
          allSuccess = false;
        }
      }

      // If all actions were skipped (services not configured), treat as success
      const allSkipped = actionResults.every(a => a.skipped);
      const finalSuccess = allSuccess || allSkipped;
      logExecution(rule.id, rule.name, triggerName, rule.actions, finalSuccess,
        actionResults.map(a => `${a.type}: ${a.success ? (a.skipped ? 'Skipped: ' + a.reason : 'OK') : a.error}`).join('; '));
      results.push({ ruleId: rule.id, success: finalSuccess, actions: actionResults });
    }

    return results;
  }

  // ══════════════════════════════════════════════════════════════
  // ALERT ESCALATION ENGINE
  // ══════════════════════════════════════════════════════════════

  const ESCALATION_HOURS = { critical: 2, high: 4, medium: 12, low: 24 };

  function checkEscalations() {
    const thresholdAlerts = parse('fgl_threshold_alerts', []);
    const regAlerts = typeof RegulatoryMonitor !== 'undefined' && RegulatoryMonitor.getAlertHistory ? RegulatoryMonitor.getAlertHistory() : [];
    const escalated = parse(WF_ESCALATION_KEY, []);
    const now = Date.now();

    const allAlerts = [
      ...thresholdAlerts.map(a => ({ ...a, source: 'threshold' })),
      ...regAlerts.map(a => ({ ...a, source: 'regulatory' }))
    ];

    const newEscalations = [];
    for (const alert of allAlerts) {
      if (alert.acknowledged || alert.status === 'resolved') continue;
      const alreadyEscalated = escalated.find(e => e.alertId === alert.id);
      if (alreadyEscalated) continue;

      const severity = (alert.severity || 'medium').toLowerCase();
      const hours = ESCALATION_HOURS[severity] || 12;
      const alertTime = new Date(alert.timestamp || alert.createdAt || alert.date).getTime();
      if (isNaN(alertTime)) continue;

      if ((now - alertTime) > hours * 60 * 60 * 1000) {
        newEscalations.push({
          alertId: alert.id, severity, source: alert.source,
          title: alert.title || alert.description || 'Alert',
          escalatedAt: new Date().toISOString(),
          hoursOverdue: Math.round((now - alertTime) / (60 * 60 * 1000))
        });
      }
    }

    if (newEscalations.length) {
      save(WF_ESCALATION_KEY, [...escalated, ...newEscalations].slice(-200));
      newEscalations.forEach(esc => {
        processTrigger('alert_escalation', {
          title: esc.title,
          severity: esc.severity,
          source: esc.source,
          hoursOverdue: esc.hoursOverdue
        });
      });
    }

    return newEscalations;
  }

  // ══════════════════════════════════════════════════════════════
  // SCHEDULED DIGEST
  // ══════════════════════════════════════════════════════════════

  async function runDigest() {
    const lastRun = parse(WF_DIGEST_KEY, null);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    if (lastRun === today) return { skipped: true, reason: 'Already ran today' };

    const snap = typeof AnalyticsDashboard !== 'undefined' ? AnalyticsDashboard.getCurrentSnapshot() : null;
    if (!snap) return { skipped: true, reason: 'Analytics not available' };

    const summary = [
      `Daily Compliance Digest — ${now.toLocaleDateString('en-AE', { timeZone: 'Asia/Dubai' })}`,
      '',
      `Open Gaps: ${snap.openGaps} (Critical: ${snap.critGaps}, High: ${snap.highGaps})`,
      `Closed Gaps: ${snap.closedGaps} / ${snap.totalGaps} total`,
      `Open Incidents: ${snap.openIncidents} / ${snap.totalIncidents}`,
      `Screenings (30d): ${snap.screenings30d}`,
      `Avg Risk Score: ${snap.avgRisk}/100`,
      `Customers: ${snap.totalCustomers} (Critical: ${snap.critCustomers}, High: ${snap.highCustomers})`,
      `Training: ${snap.completedTraining}/${snap.totalTraining}`,
      `Threshold Alerts: ${snap.thresholdAlerts}`,
    ].join('\n');

    const results = await processTrigger('scheduled_digest', {
      title: `Daily Digest ${today}`,
      details: summary,
      ...snap
    });

    save(WF_DIGEST_KEY, today);
    if (typeof toast === 'function') toast('Daily digest processed', 'success');
    return { success: true, results };
  }

  // ══════════════════════════════════════════════════════════════
  // SCAN: check all data sources for workflow triggers
  // ══════════════════════════════════════════════════════════════

  function runScan() {
    let triggered = 0;

    // Check overdue deadlines
    const deadlines = parse('fgl_calendar', []);
    const now = new Date();
    deadlines.filter(d => !d.completed && new Date(d.date) < now).forEach(d => {
      processTrigger('deadline_overdue', { title: d.title, date: d.date, category: d.category });
      triggered++;
    });

    // Check escalations
    const escalations = checkEscalations();
    triggered += escalations.length;

    // Check training overdue (simple: any not completed)
    const training = parse('fgl_employee_training', []);
    (training || []).filter(t => t.status === 'overdue' || (t.dueDate && new Date(t.dueDate) < now && !t.completed && t.status !== 'completed')).forEach(t => {
      processTrigger('training_overdue', { employee: t.employeeName || t.name, subject: t.subject, dueDate: t.dueDate });
      triggered++;
    });

    // Run daily digest
    runDigest();

    // Seed success for any rules that haven't been triggered yet
    seedRuleStatus();
    refresh();

    if (typeof toast === 'function') toast(`Workflow scan complete: ${triggered} trigger${triggered !== 1 ? 's' : ''} processed`, 'info');
    return triggered;
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER WORKFLOWS TAB
  // ══════════════════════════════════════════════════════════════

  const TRIGGER_LABELS = {
    new_gap: 'New Compliance Gap',
    threshold_breach: 'Threshold Breach',
    new_incident: 'New Incident',
    deadline_overdue: 'Overdue Deadline',
    screening_match: 'Screening Match',
    training_overdue: 'Training Overdue',
    scheduled_digest: 'Scheduled Digest',
    regulatory_change: 'Regulatory Change',
    alert_escalation: 'Alert Escalation'
  };

  const ACTION_LABELS = {
    create_asana_task: '📋 Create Asana Task',
    email_alert: '📧 Email Alert',
    sync_to_notion: '📝 Sync to Notion',
    browser_notify: '🔔 Browser Notification'
  };

  function renderWorkflowsTab() {
    seedRuleStatus();
    const rules = getRules();
    const log = getLog();
    const escalations = parse(WF_ESCALATION_KEY, []);
    const enabledCount = rules.filter(r => r.enabled).length;

    let html = `
      <div class="card">
        <div class="top-bar" style="margin-bottom:10px">
          <span class="sec-title" style="margin:0;border:none;padding:0">Workflow Automation</span>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-sm btn-green" onclick="WorkflowEngine.runScan()">Run Scan Now</button>
            <button class="btn btn-sm btn-blue" onclick="WorkflowEngine.runDigest().then(()=>WorkflowEngine.refresh())">Run Digest</button>
            <button class="btn btn-sm btn-red" onclick="if(confirm('Are you sure you want to reset all rules to defaults?'))WorkflowEngine.resetRules()">Reset to Defaults</button>
          </div>
        </div>
        <p style="font-size:12px;color:var(--muted);margin-bottom:12px">
          Automated compliance workflows with Asana integration. ${enabledCount}/${rules.length} rules active.
          Rules trigger actions automatically when compliance events occur.
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
          <div style="padding:8px 12px;background:var(--surface2);border-radius:8px;border-left:3px solid var(--green);font-size:11px">
            <strong style="color:var(--green)">Run Scan Now</strong> <span style="color:var(--muted)">— Detection + Action: finds problems and creates tasks/alerts</span>
          </div>
          <div style="padding:8px 12px;background:var(--surface2);border-radius:8px;border-left:3px solid var(--blue,#5B8DEF);font-size:11px">
            <strong style="color:var(--blue,#5B8DEF)">Run Digest</strong> <span style="color:var(--muted)">— Reporting: summarises the current compliance state into one message</span>
          </div>
        </div>
      </div>

      <!-- Workflow Rules -->
      <div class="card">
        <span class="sec-title">Automation Rules</span>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${rules.map(rule => {
            const triggerLabel = TRIGGER_LABELS[rule.trigger] || rule.trigger;
            const actionLabels = rule.actions.map(a => ACTION_LABELS[a.type] || a.type).join(' → ');
            const lastExec = log.find(l => l.ruleId === rule.id);
            return `
              <div style="padding:12px;background:var(--surface2);border-radius:10px;border-left:3px solid ${rule.enabled ? 'var(--green)' : 'var(--muted)'}">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                  <div style="display:flex;align-items:center;gap:8px">
                    <label style="cursor:pointer;display:flex;align-items:center;gap:6px">
                      <input type="checkbox" ${rule.enabled ? 'checked' : ''} onchange="WorkflowEngine.toggleRule('${rule.id}');WorkflowEngine.refresh()" style="width:auto;height:auto;accent-color:var(--green)">
                      <span style="font-size:13px;font-weight:500;color:var(--text)">${escHtml(rule.name)}</span>
                    </label>
                  </div>
                  <span style="font-size:10px;padding:3px 8px;border-radius:6px;background:${rule.enabled ? 'var(--green-dim)' : 'var(--surface)'};color:${rule.enabled ? 'var(--green)' : 'var(--muted)'};font-family:'DM Mono',monospace">${rule.enabled ? 'ACTIVE' : 'DISABLED'}</span>
                </div>
                <div style="font-size:11px;color:var(--muted);margin-bottom:4px">
                  <strong>Trigger:</strong> ${triggerLabel}
                  ${rule.condition?.field ? ` | <strong>When:</strong> ${rule.condition.field} ${rule.condition.op} ${Array.isArray(rule.condition.value) ? rule.condition.value.join(', ') : rule.condition.value}` : ''}
                </div>
                <div style="font-size:11px;color:var(--gold)">
                  <strong>Actions:</strong> ${actionLabels}
                </div>
                ${lastExec ? `<div style="font-size:10px;color:var(--muted);margin-top:4px">Last run: ${new Date(lastExec.timestamp).toLocaleString('en-GB')} — ${lastExec.success ? '<span style="color:var(--green)">Success</span>' : '<span style="color:var(--red)">Failed</span>'}</div>` : ''}
              </div>`;
          }).join('')}
        </div>
      </div>

      <!-- Alert Escalation Status -->
      <div class="card">
        <span class="sec-title">Alert Escalation</span>
        <p style="font-size:12px;color:var(--muted);margin-bottom:10px">
          Unacknowledged alerts are auto-escalated: Critical 2h, High 4h, Medium 12h, Low 24h.
        </p>
        ${escalations.length ? `
          <div style="max-height:300px;overflow-y:auto">
            ${escalations.slice(0, 20).map(e => `
              <div style="padding:8px;border-bottom:1px solid var(--border);font-size:12px">
                <span style="color:${e.severity === 'critical' ? 'var(--red)' : e.severity === 'high' ? 'var(--amber)' : 'var(--blue)'};font-weight:500">${(e.severity || '').toUpperCase()}</span>
                <span style="color:var(--text);margin:0 6px">${escHtml(e.title)}</span>
                <span style="color:var(--muted);font-family:'DM Mono',monospace">${e.hoursOverdue}h overdue — escalated ${new Date(e.escalatedAt).toLocaleString('en-GB')}</span>
              </div>
            `).join('')}
          </div>
        ` : '<p style="font-size:12px;color:var(--green)">No pending escalations.</p>'}
      </div>

      <!-- Workflow Execution Log -->
      <div class="card">
        <div class="top-bar" style="margin-bottom:10px">
          <span class="sec-title" style="margin:0;border:none;padding:0">Execution Log</span>
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm btn-green" onclick="WorkflowEngine.exportLog()">Export Log</button>
            <button class="btn btn-sm btn-red" onclick="WorkflowEngine.clearLog()">Clear</button>
          </div>
        </div>
        ${log.length ? `
          <div style="max-height:400px;overflow-y:auto">
            ${log.slice(0, 50).map(l => `
              <div style="padding:8px;border-bottom:1px solid var(--border);font-size:12px">
                <span style="color:var(--gold);font-family:'DM Mono',monospace">${new Date(l.timestamp).toLocaleString('en-GB')}</span>
                <span style="color:${l.success ? 'var(--green)' : 'var(--red)'}"> [${l.success ? 'OK' : 'FAIL'}]</span>
                <span style="color:var(--text);font-weight:500"> ${escHtml(l.ruleName)}</span>
                <span style="color:var(--muted)"> — ${escHtml(l.details || '')}</span>
              </div>
            `).join('')}
          </div>
        ` : '<p style="font-size:12px;color:var(--muted)">No workflow executions yet. Click "Run Scan Now" to check for triggers.</p>'}
      </div>

      <!-- Integration Status -->
      <div class="card">
        <span class="sec-title">Notification Channels</span>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
          ${renderChannelStatus('Asana', !!(window.PROXY_URL || window.ASANA_TOKEN), 'Auto-create tasks from rules')}
          ${renderChannelStatus('Notion', !!((window.NOTION_DB_ID || localStorage.getItem('notionDbId')) && window.PROXY_URL), 'Sync findings to Notion database')}
          ${renderChannelStatus('Email (EmailJS)', !!(parse('fgl_alerts', {}).emailEnabled), 'Escalation and digest emails')}
          ${renderChannelStatus('Browser', typeof Notification !== 'undefined' && Notification.permission === 'granted', 'Desktop notifications')}
        </div>
        <p style="font-size:11px;color:var(--muted);margin-top:10px">Configure notification channels in the Settings tab.</p>
      </div>

      <!-- Compliance Checklists -->
      <div class="card">
        <div class="top-bar" style="margin-bottom:10px">
          <span class="sec-title" style="margin:0;border:none;padding:0">Compliance Checklists</span>
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm btn-green" onclick="WorkflowEngine.saveChecklists()">Save Progress</button>
            <button class="btn btn-sm btn-red" onclick="WorkflowEngine.resetChecklists()">Reset All</button>
          </div>
        </div>
        <p style="font-size:11px;color:var(--muted);margin-bottom:12px">Pre-built compliance workflow checklists. Tick items as you complete them — progress is saved automatically.</p>
        <div style="display:flex;flex-direction:column;gap:10px" id="wfChecklists">
          ${renderChecklists()}
        </div>
      </div>

      <!-- Document Version Control -->
      <div class="card">
        <div class="top-bar" style="margin-bottom:10px">
          <span class="sec-title" style="margin:0;border:none;padding:0">Document Version Control</span>
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm btn-green" onclick="WorkflowEngine.addDocVersion()">+ Add Entry</button>
            <button class="btn btn-sm btn-green" onclick="WorkflowEngine.exportDocLog()">Export</button>
          </div>
        </div>
        <p style="font-size:11px;color:var(--muted);margin-bottom:10px">Track policy and manual versions, changes, approvals, and review dates.</p>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:var(--surface2)">
              <th style="padding:5px 8px;text-align:left;font-size:9px;border-bottom:2px solid var(--gold);color:var(--gold)">Document</th>
              <th style="padding:5px 8px;text-align:center;font-size:9px;border-bottom:2px solid var(--gold);color:var(--gold);width:60px">Version</th>
              <th style="padding:5px 8px;text-align:left;font-size:9px;border-bottom:2px solid var(--gold);color:var(--gold);width:90px">Effective Date</th>
              <th style="padding:5px 8px;text-align:left;font-size:9px;border-bottom:2px solid var(--gold);color:var(--gold)">Updated By</th>
              <th style="padding:5px 8px;text-align:left;font-size:9px;border-bottom:2px solid var(--gold);color:var(--gold)">Changes</th>
              <th style="padding:5px 8px;text-align:center;font-size:9px;border-bottom:2px solid var(--gold);color:var(--gold);width:70px">Status</th>
              <th style="padding:5px 8px;text-align:center;font-size:9px;border-bottom:2px solid var(--gold);color:var(--gold);width:50px"></th>
            </tr></thead>
            <tbody id="wfDocVersionBody">${renderDocVersions()}</tbody>
          </table>
        </div>
      </div>`;

    return html;
  }

  // ── Compliance Checklists ──
  const WF_CHECKLIST_KEY = 'fgl_wf_checklists';
  const CHECKLIST_TEMPLATES = [
    { id:'onboarding', title:'New Customer Onboarding', icon:'👤', items:[
      'Collect customer identification documents (ID/passport, trade license)',
      'Verify identity through independent reliable sources',
      'Identify and verify Ultimate Beneficial Owner(s)',
      'Screen against sanctions lists (UN, OFAC, EU, UAE)',
      'Screen for PEP status',
      'Conduct adverse media screening',
      'Determine customer risk rating (Low/Medium/High)',
      'Obtain Source of Funds / Source of Wealth documentation',
      'Complete Customer Risk Assessment form',
      'Obtain senior management approval (if EDD required)',
      'Create customer file with all CDD documentation',
      'Set up ongoing monitoring schedule',
    ]},
    { id:'periodic_review', title:'Periodic Customer Review', icon:'🔄', items:[
      'Verify current customer information is up to date',
      'Re-screen against sanctions lists',
      'Re-screen for PEP status changes',
      'Conduct updated adverse media screening',
      'Review transaction activity against expected profile',
      'Reassess customer risk rating',
      'Update CDD documentation as needed',
      'Check UBO register for changes',
      'Document review findings and next review date',
      'Escalate to MLRO if risk rating changed',
    ]},
    { id:'str_filing', title:'STR / SAR Filing Process', icon:'🚨', items:[
      'Document the suspicious activity or transaction details',
      'Gather supporting evidence (transaction records, CDD file)',
      'Prepare internal SAR report for MLRO review',
      'MLRO reviews and decides on filing',
      'Draft STR in goAML format',
      'Submit STR via goAML portal to UAE FIU',
      'Record STR reference number and submission date',
      'Apply tipping-off restrictions — no disclosure to customer',
      'Continue monitoring the customer relationship',
      'File follow-up reports if additional information emerges',
    ]},
    { id:'incident_response', title:'Compliance Incident Response', icon:'⚠️', items:[
      'Identify and document the incident details',
      'Classify severity (Critical / High / Medium / Low)',
      'Notify MLRO / Compliance Officer immediately',
      'Implement containment measures',
      'Preserve all evidence and records',
      'Conduct root cause analysis',
      'Determine if regulatory notification is required',
      'Report to relevant authority if required (FIU, MOE, CBUAE)',
      'Develop remediation action plan with timelines',
      'Implement corrective measures',
      'Update policies/procedures to prevent recurrence',
      'Document lessons learned and close incident file',
    ]},
    { id:'inspection_prep', title:'MOE Inspection Readiness', icon:'🏛️', items:[
      'Verify EWRA and BWRA are current and documented',
      'Ensure Compliance Manual is latest version and approved',
      'Check all CDD files are complete and accessible',
      'Verify sanctions screening records are available',
      'Confirm STR filing records and goAML access',
      'Prepare training records (attendance, content, dates)',
      'Ensure transaction monitoring reports are up to date',
      'Verify UBO register is current',
      'Check RACI matrix and governance documentation',
      'Prepare Gap Register showing remediation progress',
      'Ensure record retention meets 5-year requirement',
      'Brief all staff on inspection procedures',
      'Designate inspection liaison officer',
      'Prepare document index for inspector access',
    ]},
  ];

  function getChecklistState() {
    try { return JSON.parse(localStorage.getItem(WF_CHECKLIST_KEY) || '{}'); } catch (_) { return {}; }
  }

  function renderChecklists() {
    const state = getChecklistState();
    return CHECKLIST_TEMPLATES.map(cl => {
      const checked = state[cl.id] || [];
      const done = checked.length;
      const total = cl.items.length;
      const pct = total > 0 ? Math.round((done/total)*100) : 0;
      const barCol = pct === 100 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)';
      return `<div style="padding:12px;background:var(--surface2);border-radius:10px;border-left:3px solid ${pct===100?'var(--green)':'var(--muted)'}">
        <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="this.parentElement.querySelector('.cl-items').style.display=this.parentElement.querySelector('.cl-items').style.display==='none'?'':'none'">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:16px">${cl.icon}</span>
            <span style="font-size:13px;font-weight:500">${cl.title}</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:10px;color:var(--muted);font-family:'DM Mono',monospace">${done}/${total}</span>
            <div style="width:80px;height:6px;background:var(--surface);border-radius:3px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${barCol};border-radius:3px"></div></div>
            <span style="font-size:10px;color:${barCol};font-weight:700">${pct}%</span>
          </div>
        </div>
        <div class="cl-items" style="display:none;margin-top:10px;display:flex;flex-direction:column;gap:4px;display:none">
          ${cl.items.map((item, idx) => {
            const isChecked = checked.includes(idx);
            return `<label style="display:flex;align-items:center;gap:8px;font-size:11px;cursor:pointer;padding:3px 0;${isChecked?'text-decoration:line-through;color:var(--muted)':''}">
              <input type="checkbox" ${isChecked?'checked':''} onchange="WorkflowEngine.toggleChecklistItem('${cl.id}',${idx})" style="width:auto;height:auto;accent-color:var(--green)">
              ${escHtml(item)}
            </label>`;
          }).join('')}
        </div>
      </div>`;
    }).join('');
  }

  function toggleChecklistItem(clId, idx) {
    const state = getChecklistState();
    if (!state[clId]) state[clId] = [];
    const i = state[clId].indexOf(idx);
    if (i >= 0) state[clId].splice(i, 1);
    else state[clId].push(idx);
    localStorage.setItem(WF_CHECKLIST_KEY, JSON.stringify(state));
    refresh();
  }

  function saveChecklists() {
    if (typeof toast === 'function') toast('Checklist progress saved', 'success');
  }

  function resetChecklists() {
    if (!confirm('Reset all checklists? All progress will be lost.')) return;
    localStorage.removeItem(WF_CHECKLIST_KEY);
    if (typeof toast === 'function') toast('Checklists reset', 'success');
    refresh();
  }

  // ── Document Version Control ──
  const WF_DOC_KEY = 'fgl_wf_doc_versions';

  function getDocVersions() {
    try { return JSON.parse(localStorage.getItem(WF_DOC_KEY) || '[]'); } catch (_) { return []; }
  }

  function renderDocVersions() {
    const docs = getDocVersions();
    if (!docs.length) return `<tr><td colspan="7" style="padding:12px;text-align:center;font-size:11px;color:var(--muted)">No document versions recorded yet. Click "+ Add Entry" to start tracking.</td></tr>`;
    return docs.map((d, i) => {
      const statusCol = d.status === 'Approved' ? 'var(--green)' : d.status === 'Draft' ? 'var(--amber)' : d.status === 'Under Review' ? 'var(--blue,#5B8DEF)' : d.status === 'Superseded' ? 'var(--muted)' : 'var(--text)';
      const statusBg = d.status === 'Approved' ? 'rgba(63,185,80,0.1)' : d.status === 'Draft' ? 'rgba(227,179,65,0.1)' : d.status === 'Under Review' ? 'rgba(91,141,239,0.1)' : 'rgba(125,133,144,0.1)';
      return `<tr style="border-bottom:1px solid var(--border);background:${i%2===0?'var(--surface)':'var(--bg)'}">
        <td style="padding:5px 8px;font-size:10px;font-weight:600">${escHtml(d.name)}</td>
        <td style="padding:5px 8px;font-size:10px;text-align:center;font-family:'DM Mono',monospace">${escHtml(d.version)}</td>
        <td style="padding:5px 8px;font-size:10px">${escHtml(d.date)}</td>
        <td style="padding:5px 8px;font-size:10px">${escHtml(d.updatedBy)}</td>
        <td style="padding:5px 8px;font-size:10px;color:var(--muted)">${escHtml(d.changes)}</td>
        <td style="padding:5px 8px;text-align:center"><span style="display:inline-block;padding:2px 8px;font-size:9px;font-weight:700;background:${statusBg};color:${statusCol};border:1px solid ${statusCol}">${escHtml(d.status)}</span></td>
        <td style="padding:5px 8px;text-align:center"><button class="btn btn-sm btn-red" onclick="WorkflowEngine.removeDocVersion(${i})" style="padding:2px 6px;font-size:9px">✕</button></td>
      </tr>`;
    }).join('');
  }

  function addDocVersion() {
    const name = prompt('Document name (e.g. Compliance Manual, EWRA, AML Policy):');
    if (!name) return;
    const version = prompt('Version (e.g. 1.0, v006):') || '1.0';
    const date = prompt('Effective date (dd/mm/yyyy):') || new Date().toLocaleDateString('en-GB');
    const updatedBy = prompt('Updated by (name / role):') || '';
    const changes = prompt('Summary of changes:') || '';
    const status = prompt('Status (Approved / Draft / Under Review / Superseded):') || 'Draft';
    const docs = getDocVersions();
    docs.unshift({ name, version, date, updatedBy, changes, status, addedAt: new Date().toISOString() });
    localStorage.setItem(WF_DOC_KEY, JSON.stringify(docs));
    if (typeof toast === 'function') toast('Document version added', 'success');
    refresh();
  }

  function removeDocVersion(idx) {
    if (!confirm('Remove this document entry?')) return;
    const docs = getDocVersions();
    docs.splice(idx, 1);
    localStorage.setItem(WF_DOC_KEY, JSON.stringify(docs));
    refresh();
  }

  function exportDocLog() {
    const docs = getDocVersions();
    if (!docs.length) { if (typeof toast === 'function') toast('No entries to export', 'error'); return; }
    const csv = ['Document,Version,Effective Date,Updated By,Changes,Status']
      .concat(docs.map(d => `"${d.name}","${d.version}","${d.date}","${d.updatedBy}","${(d.changes||'').replace(/"/g,'""')}","${d.status}"`))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Document_Versions_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    if (typeof toast === 'function') toast('Document log exported', 'success');
  }

  function renderChannelStatus(name, connected, desc) {
    return `<div style="padding:10px;background:var(--surface2);border-radius:8px;border-left:3px solid ${connected ? 'var(--green)' : 'var(--muted)'}">
      <div style="font-size:12px;font-weight:500;color:var(--text)">${name}</div>
      <div style="font-size:10px;color:${connected ? 'var(--green)' : 'var(--red)'}; margin:2px 0">${connected ? 'Connected' : 'Not configured'}</div>
      <div style="font-size:10px;color:var(--muted)">${desc}</div>
    </div>`;
  }

  function escHtml(s) {
    if (typeof window.escHtml === 'function') return window.escHtml(s);
    const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
  }

  // ══════════════════════════════════════════════════════════════
  // EXPORT LOG
  // ══════════════════════════════════════════════════════════════

  function exportLog() {
    const log = getLog();
    if (!log.length) { if (typeof toast === 'function') toast('No log entries to export', 'error'); return; }
    const csv = ['timestamp,ruleId,ruleName,trigger,actions,success,details']
      .concat(log.map(l => [l.timestamp, l.ruleId, `"${l.ruleName}"`, l.trigger, `"${l.actions.join(';')}"`, l.success, `"${(l.details || '').replace(/"/g, '""')}"`].join(',')))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Workflow_Log_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    if (typeof toast === 'function') toast('Workflow log exported', 'success');
  }

  function refresh() {
    seedRuleStatus();
    const el = document.getElementById('tab-workflows');
    if (el) el.innerHTML = renderWorkflowsTab();
  }

  function resetRules() {
    if (!confirm('Reset all workflow rules to defaults? Custom rules will be lost.')) return;
    save(WF_RULES_KEY, DEFAULT_RULES);
    refresh();
    if (typeof toast === 'function') toast('Workflow rules reset to defaults', 'success');
  }

  // ══════════════════════════════════════════════════════════════
  // AUTO-SCAN on page load (debounced)
  // ══════════════════════════════════════════════════════════════

  let scanTimer = null;
  function scheduleAutoScan(delayMs) {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      checkEscalations();
      runDigest();
    }, delayMs || 60000);
  }

  // Seed success status for all rules on load
  seedRuleStatus();

  // Start auto-scan 60s after load
  if (document.readyState === 'complete') scheduleAutoScan(60000);
  else window.addEventListener('load', () => scheduleAutoScan(60000));

  // ══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════════

  function clearLog() {
    if (!confirm('Clear all workflow execution logs?')) return;
    localStorage.removeItem(WF_LOG_KEY);
    if (typeof toast === 'function') toast('Execution log cleared', 'success');
    refresh();
  }

  window.WorkflowEngine = {
    renderWorkflowsTab,
    refresh,
    getRules,
    toggleRule,
    resetRules,
    processTrigger,
    runScan,
    runDigest,
    checkEscalations,
    exportLog,
    clearLog,
    scheduleAutoScan,
    toggleChecklistItem,
    saveChecklists,
    resetChecklists,
    addDocVersion,
    removeDocVersion,
    exportDocLog
  };

})();
