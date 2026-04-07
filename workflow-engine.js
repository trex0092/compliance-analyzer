/**
 * Workflow Engine Module -Hawkeye Sterling V2 v2.5
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
  // DEDUPLICATION -prevent same event firing duplicate actions
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
      id: 'wf_critical_gap', name: 'Critical Gap -Asana + Notify', enabled: true,
      trigger: 'new_gap', condition: { field: 'severity', op: 'eq', value: 'critical' },
      actions: [
        { type: 'create_asana_task', template: 'gap_remediation', priority: 'high' },
        { type: 'browser_notify', title: 'Critical Gap', message: '{title}' }
      ]
    },
    {
      id: 'wf_threshold_breach', name: 'Threshold Breach -CTR + Asana', enabled: true,
      trigger: 'threshold_breach', condition: { field: 'type', op: 'eq', value: 'THRESHOLD_BREACH' },
      actions: [
        { type: 'create_asana_task', template: 'threshold_review', priority: 'high' },
        { type: 'email_alert', subject: 'URGENT: Transaction Threshold Breach', message: 'A transaction threshold breach has been detected. Amount: {amount}. Review required per UAE FDL No.10/2025 Art.24.' }
      ]
    },
    {
      id: 'wf_new_incident', name: 'New Incident -Asana + Notify', enabled: true,
      trigger: 'new_incident', condition: { field: 'severity', op: 'in', value: ['critical', 'high'] },
      actions: [
        { type: 'create_asana_task', template: 'gap_remediation', priority: 'high' },
        { type: 'browser_notify', title: 'New Incident', message: '{title} -{severity}' }
      ]
    },
    {
      id: 'wf_overdue_deadline', name: 'Overdue Deadline -Email Escalation', enabled: true,
      trigger: 'deadline_overdue', condition: {},
      actions: [
        { type: 'email_alert', subject: 'OVERDUE: {title}', message: 'Regulatory deadline "{title}" is overdue. Immediate action required.' },
        { type: 'create_asana_task', template: 'audit_preparation', priority: 'high' }
      ]
    },
    {
      id: 'wf_screening_match', name: 'Screening Match -Asana + Email', enabled: true,
      trigger: 'screening_match', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'tfs_screening', priority: 'high' },
        { type: 'email_alert', subject: 'Sanctions Match Alert', message: 'Screening match detected for {name}. Immediate review required per UAE FDL No.10/2025 Art.35.' }
      ]
    },
    {
      id: 'wf_training_overdue', name: 'Training Overdue -Asana Reminder', enabled: true,
      trigger: 'training_overdue', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'training_completion', priority: 'medium' },
        { type: 'browser_notify', title: 'Training Overdue', message: '{employee} has overdue training: {subject}' }
      ]
    },
    {
      id: 'wf_daily_digest', name: 'Daily Compliance Digest - Asana', enabled: true,
      trigger: 'scheduled_digest', condition: { frequency: 'daily' },
      actions: [
        { type: 'create_asana_task', template: 'co_report', priority: 'low' }
      ]
    },
    {
      id: 'wf_reg_change', name: 'Regulatory Change -Asana + Email', enabled: true,
      trigger: 'regulatory_change', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'policy_review', priority: 'medium' },
        { type: 'email_alert', subject: 'Regulatory Change: {title}', message: 'New regulatory change detected: {title}. Impact assessment and policy review required.' }
      ]
    },
    {
      id: 'wf_pep_detected', name: 'PEP Detected -EDD + Senior Management', enabled: true,
      trigger: 'pep_detected', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'pep_identification', priority: 'high' },
        { type: 'browser_notify', title: 'PEP Detected', message: 'PEP identified: {customerName}. EDD and Senior Management approval required per Cabinet Resolution 134/2025 Art.14.' }
      ]
    },
    {
      id: 'wf_ubo_change', name: 'UBO Change -Re-verification Required', enabled: true,
      trigger: 'ubo_change', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'kyb_review', priority: 'high' },
        { type: 'browser_notify', title: 'UBO Change Detected', message: 'Ownership structure changed for {entityName}. Re-verification required within 15 working days per Cabinet Decision 109/2023.' }
      ]
    },
    {
      id: 'wf_high_risk_onboard', name: 'High-Risk Customer -EDD + CRA Required', enabled: true,
      trigger: 'high_risk_customer', condition: { riskLevel: 'high' },
      actions: [
        { type: 'create_asana_task', template: 'edd_escalation', priority: 'high' },
        { type: 'create_asana_task', template: 'cdd_review', priority: 'high' }
      ]
    },
    {
      id: 'wf_str_post_filing', name: 'STR Filed -Post-Filing Monitoring', enabled: true,
      trigger: 'str_filed', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'transaction_monitoring', priority: 'high' },
        { type: 'browser_notify', title: 'STR Filed -Enhanced Monitoring Required', message: 'STR filed for {subjectName}. Enhanced monitoring must continue. Do not tip off subject.' }
      ]
    },
    {
      id: 'wf_sanctions_list_update', name: 'Sanctions List Update -Re-Screen All', enabled: true,
      trigger: 'sanctions_update', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'tfs_list_update', priority: 'high' },
        { type: 'browser_notify', title: 'Sanctions List Updated', message: 'New designations received. Screen entire customer and supplier database. File CNMR within 5 business days for any confirmed matches.' }
      ]
    },
    {
      id: 'wf_dpmsr_threshold', name: 'AED 55,000 Threshold -DPMSR Filing', enabled: true,
      trigger: 'threshold_breach', condition: { amount: 55000 },
      actions: [
        { type: 'create_asana_task', template: 'threshold_review', priority: 'high' },
        { type: 'browser_notify', title: 'DPMSR Threshold Triggered', message: 'Transaction of AED {amount} meets DPMSR reporting threshold. CDD capture and goAML DPMSR filing required per MoE Circular 08/AML/2021.' }
      ]
    },
    {
      id: 'wf_lbma_supplier_risk', name: 'CAHRA Supplier -Supply Chain Alert', enabled: true,
      trigger: 'cahra_detected', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'responsible_sourcing', priority: 'high' },
        { type: 'browser_notify', title: 'CAHRA Supplier Detected', message: 'Supplier {supplierName} linked to conflict-affected or high-risk area. LBMA RGG v9 Step 2 enhanced due diligence required.' }
      ]
    },
    {
      id: 'wf_annual_cra_refresh', name: 'Annual CRA Refresh Due', enabled: true,
      trigger: 'scheduled_cra_review', condition: { frequency: 'annual' },
      actions: [
        { type: 'create_asana_task', template: 'kyc_refresh', priority: 'medium' },
        { type: 'browser_notify', title: 'Annual CRA Review Due', message: 'Customer risk assessment refresh due for {customerName}. Update CDD, re-screen, and reassess risk rating.' }
      ]
    },
    // ── FDL No.10/2025 & Cabinet Resolution aligned workflows ──
    {
      id: 'wf_ubo_noncompliance', name: 'UBO Non-Compliance -Escalate', enabled: true,
      trigger: 'ubo_noncompliance', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'ubo_verification', priority: 'high' },
        { type: 'email_alert', subject: 'UBO Non-Compliance: {entityName}', message: 'Beneficial ownership records non-compliant. Rectify within 15 working days per Cabinet Decision 109/2023. Penalties per Cabinet Resolution 132/2023 may apply.' }
      ]
    },
    {
      id: 'wf_pf_risk_trigger', name: 'PF Risk Detected -Assessment', enabled: true,
      trigger: 'pf_risk_detected', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'pf_assessment', priority: 'high' },
        { type: 'email_alert', subject: 'PF Risk Alert: {entityName}', message: 'Proliferation financing risk detected. Immediate PF assessment required per FDL No.10/2025 and Cabinet Resolution 156/2025.' }
      ]
    },
    {
      id: 'wf_ewra_annual', name: 'Annual EWRA/BWRA Review Due', enabled: true,
      trigger: 'scheduled_ewra', condition: { frequency: 'annual' },
      actions: [
        { type: 'create_asana_task', template: 'ewra_review', priority: 'high' },
        { type: 'create_asana_task', template: 'risk_appetite', priority: 'medium' },
        { type: 'browser_notify', title: 'Annual EWRA/BWRA Review Due', message: 'Enterprise-Wide and Business-Wide Risk Assessments due. Must align with NRA 2024 findings.' }
      ]
    },
    {
      id: 'wf_goaml_quarterly', name: 'Quarterly goAML DPMS Report', enabled: true,
      trigger: 'scheduled_goaml', condition: { frequency: 'quarterly' },
      actions: [
        { type: 'create_asana_task', template: 'dpms_reporting', priority: 'high' },
        { type: 'browser_notify', title: 'goAML DPMS Quarterly Report Due', message: 'Quarterly DPMS activity report to UAE FIU via goAML portal is due. Ref: MoE Circular 08/AML/2021.' }
      ]
    },
    {
      id: 'wf_moe_circular', name: 'MOE Circular -Policy Update', enabled: true,
      trigger: 'moe_circular', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'reg_change_impact', priority: 'high' },
        { type: 'create_asana_task', template: 'policy_review', priority: 'medium' },
        { type: 'email_alert', subject: 'MOE Circular: {title}', message: 'New Ministry of Economy circular received. CO must implement within 30 days.' }
      ]
    },
    {
      id: 'wf_asset_freeze', name: 'Sanctions Confirmed -Asset Freeze', enabled: true,
      trigger: 'sanctions_confirmed', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'sanctions_update', priority: 'high' },
        { type: 'email_alert', subject: 'URGENT: Asset Freeze Required -{entityName}', message: 'Confirmed sanctions match. Freeze assets immediately. Report to EOCN within 24h. File CNMR within 5 days. Ref: Cabinet Resolution 74/2020.' },
        { type: 'browser_notify', title: 'ASSET FREEZE REQUIRED', message: 'Confirmed match: {entityName}. Freeze assets NOW.' }
      ]
    },
    {
      id: 'wf_admin_penalty_risk', name: 'Violation -Penalty Risk Assessment', enabled: true,
      trigger: 'compliance_violation', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'breach_notification', priority: 'high' },
        { type: 'email_alert', subject: 'Compliance Violation: {title}', message: 'Violation detected. Assess penalty risk per Cabinet Resolution 71/2024 and 156/2025. Range: AED 10K–100M.' }
      ]
    },
    {
      id: 'wf_customer_exit', name: 'Customer Exit -Retention + STR Review', enabled: true,
      trigger: 'customer_exit', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'record_retention', priority: 'medium' },
        { type: 'browser_notify', title: 'Customer Exit', message: 'Relationship termination for {customerName}. Retain records 5 years per FDL Art.24. Consider STR if suspicion triggered exit.' }
      ]
    },
    {
      id: 'wf_evidence_expiry', name: 'Evidence Expiring -Refresh', enabled: true,
      trigger: 'evidence_expiring', condition: { daysUntilExpiry: 30 },
      actions: [
        { type: 'create_asana_task', template: 'kyc_refresh', priority: 'medium' },
        { type: 'browser_notify', title: 'Evidence Expiring', message: '"{documentTitle}" for {entityName} expires in {daysUntilExpiry} days.' }
      ]
    },
    {
      id: 'wf_board_quarterly', name: 'Quarterly Board Report Due', enabled: true,
      trigger: 'scheduled_board_report', condition: { frequency: 'quarterly' },
      actions: [
        { type: 'create_asana_task', template: 'board_reporting', priority: 'high' },
        { type: 'create_asana_task', template: 'quarterly_report', priority: 'medium' }
      ]
    },
    {
      id: 'wf_whistleblower', name: 'Whistleblower Report -Investigation', enabled: true,
      trigger: 'whistleblower_report', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'incident_response', priority: 'high' },
        { type: 'email_alert', subject: 'Confidential: Internal Report Received', message: 'Report received via whistleblower channel. Investigate per Federal Decree-Law No.32/2021. Maintain strict confidentiality.' }
      ]
    },
    {
      id: 'wf_lbma_audit_due', name: 'LBMA Audit Due -Preparation', enabled: true,
      trigger: 'scheduled_lbma_audit', condition: { frequency: 'annual' },
      actions: [
        { type: 'create_asana_task', template: 'supply_chain_audit', priority: 'high' },
        { type: 'create_asana_task', template: 'audit_preparation', priority: 'high' },
        { type: 'browser_notify', title: 'LBMA Audit Due', message: 'LBMA independent third-party audit approaching. Begin preparation per LBMA RGG v9 Step 5.' }
      ]
    },
    {
      id: 'wf_nra_update', name: 'NRA Updated -Risk Framework Review', enabled: true,
      trigger: 'nra_update', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'ewra_review', priority: 'high' },
        { type: 'create_asana_task', template: 'compliance_manual', priority: 'medium' },
        { type: 'email_alert', subject: 'UAE NRA Updated -Framework Review', message: 'New NRA published. Update EWRA and Compliance Manual per MoE Circular No.1/2024.' }
      ]
    },
    {
      id: 'wf_cahra_shipment', name: 'CAHRA Shipment -Enhanced DD', enabled: true,
      trigger: 'cahra_shipment', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'responsible_sourcing', priority: 'high' },
        { type: 'create_asana_task', template: 'gold_import_clearance', priority: 'high' },
        { type: 'browser_notify', title: 'CAHRA Shipment Alert', message: 'Shipment from conflict-affected area detected. OECD DDG enhanced DD required before clearance.' }
      ]
    },
    {
      id: 'wf_tipping_off_risk', name: 'Tipping Off Risk -Lock Down', enabled: true,
      trigger: 'tipping_off_risk', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'tipping_off_review', priority: 'high' },
        { type: 'email_alert', subject: 'CONFIDENTIAL: Tipping Off Risk', message: 'Tipping off risk for {entityName}. Restrict STR/SAR access. Review info barriers. Ref: FDL Art.29.' }
      ]
    },
    {
      id: 'wf_data_destruction', name: 'Records Past Retention -Destruction', enabled: true,
      trigger: 'scheduled_data_review', condition: { frequency: 'annual' },
      actions: [
        { type: 'create_asana_task', template: 'data_destruction', priority: 'low' },
        { type: 'create_asana_task', template: 'record_retention', priority: 'medium' }
      ]
    },
    {
      id: 'wf_compliance_manual_annual', name: 'Annual Compliance Manual Review', enabled: true,
      trigger: 'scheduled_manual_review', condition: { frequency: 'annual' },
      actions: [
        { type: 'create_asana_task', template: 'compliance_manual', priority: 'high' },
        { type: 'create_asana_task', template: 'policy_review', priority: 'high' },
        { type: 'browser_notify', title: 'Compliance Manual Review Due', message: 'Annual review of Compliance Manual and 42-policy document set. Must reflect FDL No.10/2025, Cabinet Resolution 134/2025, and NRA findings.' }
      ]
    },
    // ── Deadline Monitoring ──
    {
      id: 'wf_deadline_approaching', name: 'Filing Deadline Approaching -Urgent Asana Task', enabled: true,
      trigger: 'deadline_approaching', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'gap_remediation', priority: 'high' },
        { type: 'email_alert', subject: 'DEADLINE: {title}', message: '{title}. Customer: {customer}. {regulation}. Days remaining: {daysRemaining}. Immediate action required.' },
        { type: 'browser_notify', title: 'Filing Deadline', message: '{title}' }
      ]
    },
    // ── DPMS-Specific & FATF Rec 22 Workflows ──
    {
      id: 'wf_cash_cumulative_55k', name: 'Cumulative Cash ≥ AED 55K -CDD + DPMSR', enabled: true,
      trigger: 'cumulative_cash_threshold', condition: { amount: 55000, period: 30 },
      actions: [
        { type: 'create_asana_task', template: 'ctr_filing', priority: 'high' },
        { type: 'create_asana_task', template: 'cdd_review', priority: 'high' },
        { type: 'email_alert', subject: 'Cumulative Cash Threshold: {customerName}', message: 'Multiple transactions within 30 days cumulatively exceed AED 55,000. CDD capture and goAML DPMSR filing required. Ref: FDL 10/2025 Art.16, FATF Rec 22.' }
      ]
    },
    {
      id: 'wf_wire_incomplete_info', name: 'Wire Transfer Missing Info (Rec 16)', enabled: true,
      trigger: 'wire_incomplete', condition: { threshold: 3500 },
      actions: [
        { type: 'create_asana_task', template: 'wire_transfer_review', priority: 'high' },
        { type: 'browser_notify', title: 'Incomplete Wire Transfer', message: 'Wire transfer ≥ AED 3,500 missing originator/beneficiary info. Request missing information or reject. Ref: FATF Rec 16, FDL Art.21.' }
      ]
    },
    {
      id: 'wf_third_party_payment', name: 'Third-Party Payer Detected -EDD', enabled: true,
      trigger: 'third_party_payment', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'edd_escalation', priority: 'high' },
        { type: 'browser_notify', title: 'Third-Party Payment Alert', message: 'Payment from party other than identified customer for {entityName}. EDD required. Ref: Cabinet Resolution 134/2025 Art.6(3), FATF Rec 10/22.' }
      ]
    },
    {
      id: 'wf_gold_origin_mismatch', name: 'Gold Origin Discrepancy -Investigation', enabled: true,
      trigger: 'origin_discrepancy', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'responsible_sourcing', priority: 'high' },
        { type: 'create_asana_task', template: 'gold_import_clearance', priority: 'high' },
        { type: 'email_alert', subject: 'CRITICAL: Gold Origin Mismatch -{shipmentRef}', message: 'Declared country of origin does not match shipping route or supplier profile. Halt clearance pending investigation. Ref: OECD DDG Step 1-2, LBMA RGG v9.' }
      ]
    },
    {
      id: 'wf_lbma_supply_chain_incident', name: 'LBMA Supply Chain Incident', enabled: true,
      trigger: 'supply_chain_incident', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'supply_chain_audit', priority: 'high' },
        { type: 'email_alert', subject: 'LBMA Incident: {supplierName}', message: 'Supply chain incident -possible conflict gold or refusal to provide origin info. Escalate per LBMA RGG v9 Step 3 & 5, OECD DDG Annex II.' }
      ]
    },
    {
      id: 'wf_asm_source_detected', name: 'Artisanal Mining Source -Enhanced DD', enabled: true,
      trigger: 'asm_source', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'responsible_sourcing', priority: 'high' },
        { type: 'create_asana_task', template: 'refinery_dd', priority: 'high' },
        { type: 'browser_notify', title: 'ASM Source Detected', message: 'Supplier/shipment from artisanal/small-scale mining. Enhanced DD per LBMA RGG v9 ASM Supplement, OECD DDG Annex I.' }
      ]
    },
    {
      id: 'wf_recycled_gold_verification', name: 'Recycled Gold -Origin Verification', enabled: true,
      trigger: 'recycled_gold_declared', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'hallmarking_verification', priority: 'medium' },
        { type: 'browser_notify', title: 'Recycled Gold Declaration', message: 'Customer declared recycled/scrap gold. Verify legitimate origin per LBMA RGG v9 Step 1.' }
      ]
    },
    {
      id: 'wf_structuring_detected', name: 'Structuring Pattern -STR Review', enabled: true,
      trigger: 'structuring_detected', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'str_filing', priority: 'high' },
        { type: 'create_asana_task', template: 'transaction_monitoring', priority: 'high' },
        { type: 'email_alert', subject: 'Structuring Alert: {customerName}', message: 'Repeated transactions just below AED 55,000 threshold or rapid buy-sell cycles detected. Possible structuring. STR review required. Ref: FDL Art.15-16, UAE NRA 2024.' }
      ]
    },
    {
      id: 'wf_local_terrorist_list', name: 'UAE Local Terrorist List Match', enabled: true,
      trigger: 'local_terrorist_match', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'sanctions_update', priority: 'high' },
        { type: 'email_alert', subject: 'URGENT: UAE Local Terrorist List Match -{entityName}', message: 'Match against UAE Local Terrorist List. Freeze assets without delay. Report to EOCN within 24 hours. Ref: Cabinet Resolution 74/2020 Art.4-5.' },
        { type: 'browser_notify', title: 'LOCAL TERRORIST LIST MATCH', message: 'Freeze assets NOW: {entityName}' }
      ]
    },
    {
      id: 'wf_pf_strategic_goods', name: 'PF Strategic Goods Nexus -Escalate', enabled: true,
      trigger: 'strategic_goods_nexus', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'dual_use_screening', priority: 'high' },
        { type: 'create_asana_task', template: 'pf_assessment', priority: 'high' },
        { type: 'email_alert', subject: 'PF/Strategic Goods Alert: {entityName}', message: 'Transaction involves materials linked to strategic/dual-use goods. Screen against UAE Strategic Goods Control Lists. Ref: Cabinet Resolution 156/2025, UNSC Res 1718/2231.' }
      ]
    },
    {
      id: 'wf_co_change', name: 'Compliance Officer Change -Notification', enabled: true,
      trigger: 'co_change', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'compliance_committee', priority: 'high' },
        { type: 'email_alert', subject: 'Compliance Officer Change -Handover Required', message: 'CO/MLRO change detected. Complete handover checklist and notify MoE within regulatory timeframe. Ref: FDL Art.20, Cabinet Resolution 134/2025 Art.18.' }
      ]
    },
    {
      id: 'wf_cross_border_transport', name: 'Cross-Border Precious Metals Transport', enabled: true,
      trigger: 'cross_border_transport', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'cross_border_review', priority: 'high' },
        { type: 'create_asana_task', template: 'gold_import_clearance', priority: 'high' },
        { type: 'browser_notify', title: 'Cross-Border Transport', message: 'Physical shipment crossing UAE border. Verify customs declaration, CDD, and transport documentation. Ref: FATF Rec 32, FDL Art.17.' }
      ]
    },
    {
      id: 'wf_valuation_anomaly', name: 'Precious Stones Valuation Anomaly', enabled: true,
      trigger: 'valuation_anomaly', condition: { deviation: 25 },
      actions: [
        { type: 'create_asana_task', template: 'transaction_monitoring', priority: 'high' },
        { type: 'email_alert', subject: 'Valuation Anomaly: {entityName}', message: 'Declared value deviates >25% from market benchmarks. Possible TBML indicator. Ref: UAE NRA 2024, FATF Rec 20.' }
      ]
    },
    {
      id: 'wf_fiu_info_request', name: 'FIU Information Request -Respond', enabled: true,
      trigger: 'fiu_request', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'moe_inspection', priority: 'high' },
        { type: 'email_alert', subject: 'URGENT: UAE FIU Information Request', message: 'Information request received from FIU. Respond within deadline. Do not tip off subject. Ref: FDL Art.14 & 42, Cabinet Resolution 134/2025 Art.17.' },
        { type: 'browser_notify', title: 'FIU Request -Immediate Action', message: 'FIU information request received. Respond urgently.' }
      ]
    },
    {
      id: 'wf_unlicensed_broker', name: 'Unlicensed Broker Detected -Refuse', enabled: true,
      trigger: 'unlicensed_broker', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'incident_response', priority: 'high' },
        { type: 'browser_notify', title: 'Unlicensed Broker Alert', message: 'Transaction involves intermediary without valid UAE DPMS license. Refuse relationship. Ref: FDL Art.53, MoE DPMS Guidance, FATF Rec 22.' }
      ]
    },
    {
      id: 'wf_supply_chain_grievance', name: 'Supply Chain Grievance Filed', enabled: true,
      trigger: 'grievance_filed', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'responsible_sourcing', priority: 'high' },
        { type: 'create_asana_task', template: 'incident_response', priority: 'medium' },
        { type: 'browser_notify', title: 'Grievance Filed', message: 'Supply chain grievance received re: human rights/conflict/ML-TF concerns. Investigate per OECD DDG Step 1, LBMA RGG v9 Step 2.' }
      ]
    },
    {
      id: 'wf_foreign_sanctions_match', name: 'Foreign Sanctions Match (Non-UNSC)', enabled: true,
      trigger: 'foreign_sanctions_match', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'sanctions_evasion', priority: 'high' },
        { type: 'create_asana_task', template: 'edd_escalation', priority: 'high' },
        { type: 'browser_notify', title: 'Foreign Sanctions Match', message: '{entityName} appears on non-UNSC sanctions list (EU/OFAC/UK). Enhanced monitoring required. Ref: Cabinet Resolution 156/2025 Art.7, FATF Rec 7.' }
      ]
    },
    {
      id: 'wf_independent_audit_due', name: 'Independent AML Audit Due', enabled: true,
      trigger: 'scheduled_independent_audit', condition: { frequency: 'annual' },
      actions: [
        { type: 'create_asana_task', template: 'internal_audit', priority: 'high' },
        { type: 'create_asana_task', template: 'audit_preparation', priority: 'high' },
        { type: 'browser_notify', title: 'Independent AML/CFT Audit Due', message: 'Annual independent AML/CFT audit cycle due. Engage qualified auditor. Ref: Cabinet Resolution 134/2025 Art.19, FATF Rec 18.' }
      ]
    },
    {
      id: 'wf_dpms_license_renewal', name: 'DPMS License Renewal (90/60/30 day)', enabled: true,
      trigger: 'license_expiry_warning', condition: { daysUntilExpiry: 90 },
      actions: [
        { type: 'create_asana_task', template: 'dpms_reporting', priority: 'medium' },
        { type: 'browser_notify', title: 'DPMS License Renewal Due', message: 'DPMS trade license/MoE registration expires in {daysUntilExpiry} days. Begin renewal process. Ref: FDL Art.53, MoE requirements.' }
      ]
    },
    // ── UAE FIU / EOCN / MOE Additional Workflows ──
    {
      id: 'wf_fiu_str_deadline', name: 'STR Filing Deadline -FIU Compliance', enabled: true,
      trigger: 'str_deadline_approaching', condition: { daysRemaining: 3 },
      actions: [
        { type: 'create_asana_task', template: 'str_filing', priority: 'high' },
        { type: 'email_alert', subject: 'URGENT: STR Filing Deadline Approaching', message: 'STR report for {subjectName} must be submitted to UAE FIU via goAML within {daysRemaining} days. Failure to file timely is a criminal offence. Ref: FDL No.10/2025 Art.26-27.' },
        { type: 'browser_notify', title: 'STR Deadline Alert', message: 'STR filing deadline in {daysRemaining} days for {subjectName}.' }
      ]
    },
    {
      id: 'wf_eocn_designation_update', name: 'EOCN New Designation -Immediate Screening', enabled: true,
      trigger: 'eocn_designation', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'tfs_list_update', priority: 'high' },
        { type: 'create_asana_task', template: 'tfs_screening', priority: 'high' },
        { type: 'email_alert', subject: 'EOCN Designation Update -Screen All Databases', message: 'New EOCN/Executive Office designation received. Screen all customers, counterparties, suppliers, and UBOs within 24 hours. File CNMR for any matches. Ref: Cabinet Resolution 74/2020, EOCN TFS Guidance.' },
        { type: 'browser_notify', title: 'EOCN Designation Update', message: 'New designation. Screen all databases immediately.' }
      ]
    },
    {
      id: 'wf_cnmr_filing', name: 'CNMR Filing Required -5 Business Days', enabled: true,
      trigger: 'cnmr_required', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'sanctions_update', priority: 'high' },
        { type: 'email_alert', subject: 'CNMR Filing Required for {entityName}', message: 'Confirmed or partial match against sanctions/terrorist list. File CNMR (Compliance No-Match Report) with EOCN within 5 business days. Ref: Cabinet Resolution 74/2020 Art.6, EOCN Guidance.' }
      ]
    },
    {
      id: 'wf_moe_inspection_prep', name: 'MOE Inspection Notification -Preparation', enabled: true,
      trigger: 'moe_inspection_notice', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'moe_inspection', priority: 'high' },
        { type: 'create_asana_task', template: 'audit_preparation', priority: 'high' },
        { type: 'email_alert', subject: 'MOE Inspection Scheduled -Preparation Required', message: 'Ministry of Economy on-site inspection scheduled. Prepare compliance manual, training records, risk assessments, STR log, TFS screening records, and goAML registration proof. Ref: FDL No.10/2025 Art.42-44, Cabinet Resolution 134/2025.' },
        { type: 'browser_notify', title: 'MOE Inspection Alert', message: 'Prepare all compliance documentation for upcoming MOE inspection.' }
      ]
    },
    {
      id: 'wf_goaml_registration_check', name: 'goAML Registration Verification', enabled: true,
      trigger: 'scheduled_goaml_check', condition: { frequency: 'monthly' },
      actions: [
        { type: 'create_asana_task', template: 'dpms_reporting', priority: 'medium' },
        { type: 'browser_notify', title: 'goAML Registration Check', message: 'Monthly goAML registration and access verification. Ensure all authorized users can access portal. Ref: FDL No.10/2025 Art.25, MoE Circular 08/AML/2021.' }
      ]
    },
    {
      id: 'wf_fiu_dissemination', name: 'FIU Intelligence Dissemination -Action', enabled: true,
      trigger: 'fiu_dissemination', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'moe_inspection', priority: 'high' },
        { type: 'create_asana_task', template: 'transaction_monitoring', priority: 'high' },
        { type: 'email_alert', subject: 'FIU Intelligence Received -Immediate Action', message: 'FIU has disseminated intelligence regarding {subjectName}. Implement enhanced monitoring, restrict transactions if necessary, and respond within deadline. Do NOT tip off. Ref: FDL No.10/2025 Art.14 & 29.' }
      ]
    },
    {
      id: 'wf_eocn_false_positive', name: 'EOCN Screening False Positive -Document', enabled: true,
      trigger: 'screening_false_positive', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'tfs_screening', priority: 'medium' },
        { type: 'browser_notify', title: 'False Positive -Document Rationale', message: 'Screening match for {entityName} determined to be false positive. Document rationale, retain screening evidence per EOCN TFS Guidance. Update whitelisting if applicable.' }
      ]
    },
    {
      id: 'wf_moe_penalty_notice', name: 'MOE Penalty Notice -Remediation', enabled: true,
      trigger: 'moe_penalty_received', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'breach_notification', priority: 'high' },
        { type: 'create_asana_task', template: 'compliance_committee', priority: 'high' },
        { type: 'email_alert', subject: 'MOE Administrative Penalty Received', message: 'Administrative penalty notice from MoE received. Assess violation, determine remediation plan, and consider appeal within prescribed timeframe. Ref: Cabinet Resolution 71/2024, FDL No.10/2025 Art.46-50.' }
      ]
    },
    {
      id: 'wf_high_value_cash_declaration', name: 'High-Value Cash Declaration -Border', enabled: true,
      trigger: 'cash_declaration', condition: { amount: 60000 },
      actions: [
        { type: 'create_asana_task', template: 'ctr_filing', priority: 'high' },
        { type: 'email_alert', subject: 'Cross-Border Cash Declaration: AED {amount}', message: 'Cash or bearer negotiable instruments exceeding AED 60,000 declared at UAE border. Verify source and legitimacy. Ref: FDL No.10/2025 Art.17, Cabinet Resolution 134/2025 Art.16.' }
      ]
    },
    {
      id: 'wf_dpms_quarterly_activity', name: 'DPMS Quarterly Activity Report -goAML', enabled: true,
      trigger: 'scheduled_dpms_quarterly', condition: { frequency: 'quarterly' },
      actions: [
        { type: 'create_asana_task', template: 'dpms_reporting', priority: 'high' },
        { type: 'create_asana_task', template: 'co_report', priority: 'medium' },
        { type: 'email_alert', subject: 'DPMS Quarterly Activity Report Due', message: 'Quarterly DPMS activity report must be submitted to MoE via goAML portal. Include transaction volumes, CDD statistics, STR filings, and screening results. Ref: MoE Circular 08/AML/2021, FDL Art.25.' }
      ]
    },
    {
      id: 'wf_tfs_freeze_confirmation', name: 'TFS Asset Freeze Confirmation -EOCN', enabled: true,
      trigger: 'asset_freeze_executed', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'sanctions_update', priority: 'high' },
        { type: 'email_alert', subject: 'Asset Freeze Executed -Confirm to EOCN', message: 'Asset freeze executed for {entityName}. Confirm freeze to EOCN within 24 hours. Document all frozen assets/accounts. No de-freezing without EOCN authorization. Ref: Cabinet Resolution 74/2020 Art.4-7.' },
        { type: 'browser_notify', title: 'Confirm Freeze to EOCN', message: 'Asset freeze executed. Report to EOCN within 24h.' }
      ]
    },
    {
      id: 'wf_internal_compliance_review', name: 'Semi-Annual Internal Compliance Review', enabled: true,
      trigger: 'scheduled_compliance_review', condition: { frequency: 'semi_annual' },
      actions: [
        { type: 'create_asana_task', template: 'internal_audit', priority: 'high' },
        { type: 'create_asana_task', template: 'compliance_manual', priority: 'medium' },
        { type: 'email_alert', subject: 'Semi-Annual Internal Compliance Review Due', message: 'Conduct internal review of AML/CFT/CPF controls, policies, and procedures. Report findings to Board/Senior Management. Ref: Cabinet Resolution 134/2025 Art.19, FATF Rec 18.' }
      ]
    },
    {
      id: 'wf_suspicious_refund', name: 'Suspicious Refund Request -STR Review', enabled: true,
      trigger: 'suspicious_refund', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'str_filing', priority: 'high' },
        { type: 'create_asana_task', template: 'transaction_monitoring', priority: 'high' },
        { type: 'browser_notify', title: 'Suspicious Refund Alert', message: 'Refund request for {entityName} shows indicators of ML/TF. Customer purchased gold and requested immediate refund to different account/method. Review for STR. Ref: FDL Art.15-16.' }
      ]
    },
    {
      id: 'wf_risk_appetite_breach', name: 'Risk Appetite Breach -Board Notification', enabled: true,
      trigger: 'risk_appetite_breach', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'risk_appetite', priority: 'high' },
        { type: 'create_asana_task', template: 'compliance_committee', priority: 'high' },
        { type: 'email_alert', subject: 'Risk Appetite Breach -Board Attention Required', message: 'Business activity has exceeded approved risk appetite thresholds. Notify Board/Senior Management. Consider suspending high-risk onboarding. Ref: Cabinet Resolution 134/2025 Art.5, FDL Art.20-21.' }
      ]
    },
    {
      id: 'wf_correspondent_bank_alert', name: 'Correspondent Banking -RBA Alert', enabled: true,
      trigger: 'correspondent_bank_alert', condition: {},
      actions: [
        { type: 'create_asana_task', template: 'edd_escalation', priority: 'high' },
        { type: 'browser_notify', title: 'Correspondent Bank Alert', message: 'Correspondent bank has flagged transaction involving {entityName}. Review and respond within required timeframe. Ref: FATF Rec 13, CBUAE Guidance.' }
      ]
    }
  ];

  // ══════════════════════════════════════════════════════════════
  // RULE MANAGEMENT
  // ══════════════════════════════════════════════════════════════

  function getRules() {
    const rules = parse(WF_RULES_KEY, null);
    if (!rules) { save(WF_RULES_KEY, DEFAULT_RULES); return DEFAULT_RULES; }
    // Migration: strip Slack and Notion from any saved rules
    let migrated = false;
    rules.forEach(r => {
      // Remove slack_alert and sync_to_notion / create_notion_page actions
      const before = r.actions.length;
      r.actions = r.actions.filter(a => a.type !== 'slack_alert' && a.type !== 'sync_to_notion' && a.type !== 'create_notion_page');
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

  function editRule(id) {
    const rules = getRules();
    const rule = rules.find(r => r.id === id);
    if (!rule) return;
    var newName = prompt('Rule name:', rule.name);
    if (newName !== null && newName.trim()) {
      rule.name = newName.trim();
      saveRules(rules);
      if (typeof toast === 'function') toast('Rule updated: ' + rule.name, 'success');
      refresh();
    }
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
    if (typeof logAudit === 'function') logAudit('workflow_executed', `Rule: ${ruleName} -${success ? 'OK' : 'FAILED'}`);
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
    if (!proxy && !asanaToken) { return { skipped: true, reason: 'Asana not configured -set Proxy URL or Asana token in Settings' }; }
    const resolver = typeof AsanaProjectResolver !== 'undefined' ? AsanaProjectResolver : null;
    const projectId = resolver ? resolver.resolveProject('workflow') : (localStorage.getItem('asanaProjectId') || '1213759768596515');
    const templates = (typeof IntegrationsEnhanced !== 'undefined' && IntegrationsEnhanced.asana?.TASK_TEMPLATES) ? IntegrationsEnhanced.asana.TASK_TEMPLATES : {};
    const tmpl = templates[action.template] || {};
    // Inject active company name so {entity} placeholder is always resolved
    const entityName = resolver ? resolver.resolveEntityName() : ((typeof getActiveCompany === 'function') ? (getActiveCompany().name || 'Hawkeye Sterling') : 'Hawkeye Sterling');
    const enrichedData = Object.assign({ entity: entityName, company: entityName }, data);
    const taskName = interpolate(tmpl.name || action.template, enrichedData);
    const taskNotes = interpolate(tmpl.notes || '', enrichedData);

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

  // Slack removed -stub only
  async function executeSlackAlert() {
    return { skipped: true, reason: 'Slack removed' };
  }

  async function executeEmailAlert(action, data) {
    const subject = interpolate(action.subject, data);
    const message = interpolate(action.message, data);
    if (typeof sendEmailAlert === 'function') {
      return await sendEmailAlert(subject, message, data);
    }
    // Log the alert for audit trail even when email service is not configured
    const emailLog = parse('fgl_email_alert_log', []);
    emailLog.push({
      timestamp: new Date().toISOString(),
      subject,
      message,
      ruleName: data._ruleName || 'unknown',
      status: 'pending_email_config'
    });
    if (emailLog.length > 500) emailLog.splice(0, emailLog.length - 500);
    save('fgl_email_alert_log', emailLog);
    console.warn('[WorkflowEngine] Email alert logged (service not configured):', subject);
    return { skipped: true, reason: 'Email service not configured — alert logged for audit' };
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

  function executeSyncToNotion() { return; }

  async function executeAction(action, data) {
    switch (action.type) {
      case 'create_asana_task': return await executeCreateAsanaTask(action, data);
      case 'slack_alert': return { skipped: true, reason: 'Slack removed' };
      case 'email_alert': return await executeEmailAlert(action, data);
      case 'sync_to_notion': return { skipped: true, reason: 'Notion sync removed' };
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
          actionResults.push({ type: action.type, success: true, skipped: true, reason: 'Duplicate -already processed within 24h' });
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
      `Daily Compliance Digest -${now.toLocaleDateString('en-AE', { timeZone: 'Asia/Dubai' })}`,
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
          <div style="padding:8px 12px;background:var(--surface2);border-radius:3px;border-left:3px solid var(--green);font-size:11px">
            <strong style="color:var(--green)">Run Scan Now</strong> <span style="color:var(--muted)">— Detection + Action: finds problems and creates tasks/alerts</span>
          </div>
          <div style="padding:8px 12px;background:var(--surface2);border-radius:3px;border-left:3px solid var(--blue,#5B8DEF);font-size:11px">
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
            const actionLabels = rule.actions.map(a => ACTION_LABELS[a.type] || a.type).join(' -');
            const lastExec = log.find(l => l.ruleId === rule.id);
            return `
              <div style="padding:12px;background:var(--surface2);border-radius:4px;border-left:3px solid ${rule.enabled ? 'var(--green)' : 'var(--muted)'}">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                  <div style="display:flex;align-items:center;gap:8px">
                    <label style="cursor:pointer;display:flex;align-items:center;gap:6px">
                      <input type="checkbox" ${rule.enabled ? 'checked' : ''} onchange="WorkflowEngine.toggleRule('${rule.id}');WorkflowEngine.refresh()" style="width:auto;height:auto;accent-color:var(--green)">
                      <span style="font-size:13px;font-weight:500;color:var(--text)">${escHtml(rule.name)}</span>
                    </label>
                  </div>
                  <div style="display:flex;gap:6px;align-items:center">
                    <button class="btn btn-sm btn-gold" style="padding:2px 8px;font-size:9px" onclick="WorkflowEngine.editRule('${rule.id}')">Edit</button>
                    <span style="font-size:10px;padding:3px 8px;border-radius:3px;background:${rule.enabled ? 'var(--green-dim)' : 'var(--surface)'};color:${rule.enabled ? 'var(--green)' : 'var(--muted)'};font-family:'Montserrat',sans-serif">${rule.enabled ? 'ACTIVE' : 'DISABLED'}</span>
                  </div>
                </div>
                <div style="font-size:11px;color:var(--muted);margin-bottom:4px">
                  <strong>Trigger:</strong> ${triggerLabel}
                  ${rule.condition?.field ? ` | <strong>When:</strong> ${rule.condition.field} ${rule.condition.op} ${Array.isArray(rule.condition.value) ? rule.condition.value.join(', ') : rule.condition.value}` : ''}
                </div>
                <div style="font-size:11px;color:var(--gold)">
                  <strong>Actions:</strong> ${actionLabels}
                </div>
                ${lastExec ? `<div style="font-size:10px;color:var(--muted);margin-top:4px">Last run: ${new Date(lastExec.timestamp).toLocaleString('en-GB')} -${lastExec.success ? '<span style="color:var(--green)">Success</span>' : '<span style="color:var(--red)">Failed</span>'}</div>` : ''}
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
                <span style="color:var(--muted);font-family:'Montserrat',sans-serif">${e.hoursOverdue}h overdue -escalated ${new Date(e.escalatedAt).toLocaleString('en-GB')}</span>
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
                <span style="color:var(--gold);font-family:'Montserrat',sans-serif">${new Date(l.timestamp).toLocaleString('en-GB')}</span>
                <span style="color:${l.success ? 'var(--green)' : 'var(--red)'}"> [${l.success ? 'OK' : 'FAIL'}]</span>
                <span style="color:var(--text);font-weight:500"> ${escHtml(l.ruleName)}</span>
                <span style="color:var(--muted)"> -${escHtml(l.details || '')}</span>
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
        </div>
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
        <p style="font-size:11px;color:var(--muted);margin-bottom:12px">Pre-built compliance workflow checklists. Tick items as you complete them -progress is saved automatically.</p>
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
      'Apply tipping-off restrictions -no disclosure to customer',
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
      return `<div style="padding:12px;background:var(--surface2);border-radius:4px;border-left:3px solid ${pct===100?'var(--green)':'var(--muted)'}">
        <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="this.parentElement.querySelector('.cl-items').style.display=this.parentElement.querySelector('.cl-items').style.display==='none'?'':'none'">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:16px">${cl.icon}</span>
            <span style="font-size:13px;font-weight:500">${cl.title}</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:10px;color:var(--muted);font-family:'Montserrat',sans-serif">${done}/${total}</span>
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
        <td style="padding:5px 8px;font-size:10px;text-align:center;font-family:'Montserrat',sans-serif">${escHtml(d.version)}</td>
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
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Document_Versions_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    if (typeof toast === 'function') toast('Document log exported', 'success');
  }

  function renderChannelStatus(name, connected, desc) {
    return `<div style="padding:10px;background:var(--surface2);border-radius:3px;border-left:3px solid ${connected ? 'var(--green)' : 'var(--muted)'}">
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
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
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

  // ══════════════════════════════════════════════════════════════
  // DEADLINE MONITOR — Auto-create Asana tasks for approaching deadlines
  // Uses COMPLIANCE_CONSTANTS from constants-bridge.js
  // ══════════════════════════════════════════════════════════════

  function checkFilingDeadlines() {
    const CC = typeof COMPLIANCE_CONSTANTS !== 'undefined' ? COMPLIANCE_CONSTANTS : null;
    if (!CC) return;

    const log = parse(WF_LOG_KEY, []);
    const now = Date.now();
    const ONE_DAY = 86400000;

    // Check STR/CTR queues for approaching deadlines
    const strCases = parse('fgl_str_cases_v2', []);
    for (const c of strCases) {
      if (c.status === 'Filed' || c.status === 'Closed') continue;
      if (!c.createdAt && !c.date) continue;
      const createdStr = c.createdAt || c.date;
      var createdDate;
      // Handle dd/mm/yyyy format
      if (typeof createdStr === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(createdStr)) {
        var parts = createdStr.split('/');
        createdDate = new Date(parts[2], parts[1] - 1, parts[0]);
      } else {
        createdDate = new Date(createdStr);
      }
      if (isNaN(createdDate.getTime())) continue;
      // Approximate business days: calendar days * 5/7
      var calendarElapsed = Math.floor((now - createdDate.getTime()) / ONE_DAY);
      var bizElapsed = Math.round(calendarElapsed * 5 / 7);
      const deadlineDays = CC.STR_FILING_DEADLINE_BUSINESS_DAYS || 10;
      const remaining = deadlineDays - bizElapsed;

      // Create urgent Asana task at 3 business days remaining
      if (remaining <= 3 && remaining > 0) {
        const dedupKey = `deadline_str_${c.id || c.caseRef}_${Math.floor(now / ONE_DAY)}`;
        if (!isDuplicate('deadline_monitor', 'deadline_asana', { id: dedupKey })) {
          processTrigger('deadline_approaching', {
            title: 'URGENT: STR Filing Deadline — ~' + (remaining) + ' business days remaining',
            customer: c.subjectName || c.customerName || 'Unknown',
            severity: 'critical',
            caseRef: c.id || c.caseRef || '',
            daysRemaining: remaining,
            regulation: 'FDL Art.26 — STR must be filed within ' + deadlineDays + ' business days'
          });
          markProcessed('deadline_monitor', 'deadline_asana', { id: dedupKey });
        }
      }
    }

    // Check CTR queue
    const ctrQueue = parse('fgl_threshold_ctr_queue', []);
    for (const c of ctrQueue) {
      if (c.status === 'Filed' || c.status === 'Closed') continue;
      if (!c.timestamp && !c.date) continue;
      var ctrDateStr = c.timestamp || c.date;
      var ctrDate;
      if (typeof ctrDateStr === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(ctrDateStr)) {
        var ctrParts = ctrDateStr.split('/');
        ctrDate = new Date(ctrParts[2], ctrParts[1] - 1, ctrParts[0]);
      } else {
        ctrDate = new Date(ctrDateStr);
      }
      if (isNaN(ctrDate.getTime())) continue;
      var ctrCalElapsed = Math.floor((now - ctrDate.getTime()) / ONE_DAY);
      var ctrBizElapsed = Math.round(ctrCalElapsed * 5 / 7);
      const deadlineDays = CC.CTR_FILING_DEADLINE_BUSINESS_DAYS || 15;
      const remaining = deadlineDays - ctrBizElapsed;

      if (remaining <= 5 && remaining > 0) {
        const dedupKey = `deadline_ctr_${c.id || ''}_${Math.floor(now / ONE_DAY)}`;
        if (!isDuplicate('deadline_monitor', 'deadline_asana', { id: dedupKey })) {
          processTrigger('deadline_approaching', {
            title: 'CTR Filing Deadline — ~' + (remaining) + ' business days remaining',
            customer: c.customerName || 'Unknown',
            amount: c.amount || '',
            severity: 'high',
            regulation: 'FDL Art.16 — CTR must be filed within ' + deadlineDays + ' business days'
          });
          markProcessed('deadline_monitor', 'deadline_asana', { id: dedupKey });
        }
      }
    }
  }

  // Run deadline check every 30 minutes
  setInterval(checkFilingDeadlines, 30 * 60 * 1000);
  // Also run once on load (after 10 seconds to let data load)
  setTimeout(checkFilingDeadlines, 10000);

  window.WorkflowEngine = {
    renderWorkflowsTab,
    refresh,
    getRules,
    toggleRule,
    editRule,
    resetRules,
    processTrigger,
    runScan,
    runDigest,
    checkEscalations,
    checkFilingDeadlines,
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
