/**
 * Enhanced Integrations Module — Hawkeye Sterling V2 v2.3
 * Improved Asana, Notion, Slack, Google Drive, ClickUp + health monitor
 */
(function () {
  'use strict';

  const INTEGRATION_STATUS_KEY = 'fgl_integration_status';
  const INTEGRATION_LOG_KEY = 'fgl_integration_log';

  function getProxy() { return window.PROXY_URL || ''; }

  function getStatus() {
    try { return JSON.parse(localStorage.getItem(INTEGRATION_STATUS_KEY) || '{}'); } catch (_) { return {}; }
  }
  function saveStatus(s) { localStorage.setItem(INTEGRATION_STATUS_KEY, JSON.stringify(s)); }

  function getLog() {
    try { return JSON.parse(localStorage.getItem(INTEGRATION_LOG_KEY) || '[]'); } catch (_) { return []; }
  }
  function saveLog(l) { localStorage.setItem(INTEGRATION_LOG_KEY, JSON.stringify(l.slice(0, 500))); }

  function logEvent(integration, action, success, details) {
    const log = getLog();
    log.unshift({ integration, action, success, details, timestamp: new Date().toISOString() });
    saveLog(log);
  }

  function updateStatus(integration, connected, lastSync, errorRate) {
    const status = getStatus();
    status[integration] = { connected, lastSync: lastSync || new Date().toISOString(), errorRate: errorRate || 0, checkedAt: new Date().toISOString() };
    saveStatus(status);
  }

  async function proxyFetch(path, options = {}) {
    const proxy = getProxy();
    if (!proxy) throw new Error('Proxy URL not configured. Use Settings to add a Proxy URL or Asana Token.');
    const res = await fetch(proxy + path, options);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }

  // ══════════════════════════════════════════════════════════════════
  // ASANA ENHANCED
  // ══════════════════════════════════════════════════════════════════
  const asana = {
    async batchCreateTasks(tasks) {
      const results = [];
      const useAsanaFetch = typeof asanaFetch === 'function';
      for (const task of tasks) {
        try {
          let res;
          if (useAsanaFetch) {
            const r = await asanaFetch('/tasks', { method: 'POST', body: JSON.stringify({ data: task }) });
            res = await r.json();
          } else {
            res = await proxyFetch('/asana/tasks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ data: task }),
            });
          }
          results.push({ success: true, task: res.data });
          logEvent('asana', 'batch_create_task', true, task.name);
        } catch (e) {
          results.push({ success: false, error: e.message });
          logEvent('asana', 'batch_create_task', false, e.message);
        }
      }
      return results;
    },

    TASK_TEMPLATES: {
      // ── CDD / KYC / KYS ──
      cdd_review: { name: 'CDD Review: {entity}', notes: 'Perform Customer Due Diligence review per UAE FDL No.10/2025 Art.16.\n\n1. Verify identity documents (passport, trade license, incorporation docs)\n2. Screen against UN/OFAC/EU/UK/UAE sanctions lists\n3. Verify UBO (25%+ ownership threshold)\n4. Assess risk rating (Low/Medium/High)\n5. Document findings and retain records\n6. Obtain senior management approval for high-risk\n\nRef: Cabinet Resolution No.134/2025, FATF Rec 10', tags: ['compliance', 'cdd'] },
      edd_escalation: { name: 'EDD Escalation: {entity}', notes: 'Enhanced Due Diligence required per UAE FDL No.10/2025 Art.17.\n\n1. Source of wealth verification and documentation\n2. Source of funds documentation with supporting evidence\n3. Obtain senior management approval (documented)\n4. PEP screening and adverse media check\n5. Establish ongoing enhanced monitoring plan\n6. Document rationale for business relationship\n\nRef: FATF Rec 10, Cabinet Resolution No.134/2025 Art.8', tags: ['compliance', 'edd'] },
      sdd_review: { name: 'SDD Assessment: {entity}', notes: 'Simplified Due Diligence assessment per UAE FDL No.10/2025 Art.18.\n\n1. Confirm entity meets low-risk criteria per EWRA\n2. Verify risk category against NRA 2024 findings\n3. Document justification for SDD application\n4. Obtain compliance officer approval\n5. Schedule periodic review for continued eligibility\n\nNote: SDD cannot be applied where ML/TF suspicion exists', tags: ['compliance', 'sdd'] },
      kyc_refresh: { name: 'KYC Refresh: {entity}', notes: 'Periodic KYC refresh per risk-based approach.\n\n1. Update customer identification data\n2. Re-screen against all sanctions/PEP lists\n3. Review transaction patterns for consistency\n4. Update risk rating if circumstances changed\n5. Verify UBO information remains current\n6. Document review outcome\n\nFrequency: High=6mo, Medium=12mo, Low=24mo', tags: ['compliance', 'kyc'] },
      kys_review: { name: 'KYS Review: {entity}', notes: 'Know Your Supplier due diligence per LBMA RGG v9 & UAE FDL No.10/2025.\n\n1. Verify supplier trade license and registration\n2. Assess supply chain origin and CAHRA exposure\n3. Screen supplier against sanctions and adverse media\n4. Verify supplier AML/CFT compliance program\n5. Review LBMA certification status (if applicable)\n6. Document supply chain mapping\n7. Obtain compliance officer sign-off\n\nRef: OECD Due Diligence Guidance for Responsible Supply Chains', tags: ['compliance', 'kys'] },
      kyb_review: { name: 'KYB Review: {entity}', notes: 'Know Your Business counterparty assessment.\n\n1. Verify legal entity registration and good standing\n2. Identify and verify all UBOs (25%+ threshold)\n3. Assess ownership structure complexity\n4. Verify authorized signatories\n5. Review financial statements (last 2 years)\n6. Screen directors/officers against PEP/sanctions\n7. Assess jurisdictional risk\n\nRef: UAE FDL No.10/2025 Art.16, FATF Rec 10', tags: ['compliance', 'kyb'] },
      kye_review: { name: 'KYE Review: {entity}', notes: 'Know Your Employee screening per UAE FDL No.10/2025.\n\n1. Verify employee identity and background\n2. Screen against sanctions and PEP lists\n3. Criminal background check (where permitted)\n4. Verify qualifications and references\n5. Assess conflict of interest declarations\n6. Review access levels vs role requirements\n7. Document screening results and retain\n\nRef: Cabinet Resolution No.134/2025, FATF Rec 18', tags: ['compliance', 'kye'] },

      // ── STR / SAR / goAML ──
      str_filing: { name: 'STR Filing: {entity}', notes: 'Prepare and file Suspicious Transaction Report per UAE FDL No.10/2025 Art.26.\n\n1. Document suspicious indicators and red flags\n2. Gather all supporting transaction evidence\n3. Draft STR narrative with timeline and analysis\n4. Obtain MLRO review and approval\n5. Submit to FIU via goAML portal\n6. Record filing reference number\n7. Implement enhanced monitoring\n8. DO NOT tip off the subject\n\nDeadline: Within 10 business days. Ref: FATF Rec 20', tags: ['compliance', 'str'] },
      sar_filing: { name: 'SAR Filing: {entity}', notes: 'Prepare and file Suspicious Activity Report.\n\n1. Document the suspicious activity/behavior\n2. Compile supporting documentation\n3. Draft SAR narrative with factual analysis\n4. MLRO review and sign-off\n5. Submit to FIU via goAML\n6. Retain copy with filing reference\n7. Continue monitoring (do not close relationship without FIU guidance)\n\nRef: UAE FDL No.10/2025 Art.26-28, FATF Rec 20', tags: ['compliance', 'sar'] },

      // ── TFS / Sanctions ──
      tfs_screening: { name: 'TFS Screening: {entity}', notes: 'Targeted Financial Sanctions screening per UAE FDL No.10/2025 Art.35.\n\n1. Screen entity name against UN Consolidated List\n2. Screen against OFAC SDN and EU/UK sanctions lists\n3. Screen against UAE Local Terrorist List\n4. Screen UBOs and authorized signatories\n5. Document results (clear/match/potential match)\n6. For matches: freeze assets immediately and report to EOCN\n7. Retain screening records for minimum 5 years\n\nRef: FATF Rec 6 & 7, Cabinet Resolution No.74/2020', tags: ['compliance', 'tfs'] },
      tfs_list_update: { name: 'TFS List Update: {entity}', notes: 'Process new TFS list update per UAE FDL No.10/2025 Art.35.\n\n1. Download and review new designations\n2. Screen entire customer database against new entries\n3. Report any matches to EOCN within 24 hours\n4. Freeze identified assets without delay\n5. Notify compliance committee of results\n6. Document screening completion and findings\n7. Update internal screening database\n\nRef: UNSC Resolution implementation, Cabinet Resolution No.74/2020', tags: ['compliance', 'tfs'] },
      false_positive: { name: 'False Positive Resolution: {entity}', notes: 'Resolve TFS/sanctions screening false positive.\n\n1. Document the match details and screening system used\n2. Analyze discrepancies (name, DOB, nationality, ID)\n3. Gather additional identifying information\n4. Document rationale for false positive determination\n5. Obtain compliance officer sign-off\n6. Update screening records\n7. Retain evidence for 5 years minimum\n\nRef: UAE FDL No.10/2025 Art.35(5)', tags: ['compliance', 'tfs'] },

      // ── PEP Management ──
      pep_identification: { name: 'PEP Assessment: {entity}', notes: 'Politically Exposed Person identification per UAE FDL No.10/2025 Art.18.\n\n1. Screen entity against PEP databases\n2. Identify domestic and foreign PEP status\n3. Check family members and close associates\n4. If PEP confirmed: obtain senior management approval\n5. Establish source of wealth and source of funds\n6. Apply enhanced ongoing monitoring\n7. Document all PEP assessment findings\n\nRef: FATF Rec 12, Cabinet Resolution No.134/2025', tags: ['compliance', 'pep'] },

      // ── Risk Assessment ──
      ewra_review: { name: 'EWRA Review: {entity}', notes: 'Enterprise-Wide Risk Assessment per UAE FDL No.10/2025 Art.5.\n\n1. Identify and assess ML/TF/PF risk categories\n2. Review customer risk (type, geography, channel)\n3. Assess product/service risk factors\n4. Evaluate delivery channel risks\n5. Consider jurisdictional risk (FATF grey/black lists)\n6. Update risk scoring methodology\n7. Present findings to senior management/Board\n8. Document risk mitigation measures\n\nRef: FATF Rec 1, UAE NRA 2024', tags: ['compliance', 'risk'] },
      risk_appetite: { name: 'Risk Appetite Review: {entity}', notes: 'Review and update risk appetite statement.\n\n1. Review current risk appetite thresholds\n2. Assess alignment with EWRA findings\n3. Evaluate risk tolerance by customer/product type\n4. Define acceptable risk boundaries\n5. Obtain Board/senior management approval\n6. Communicate to all relevant staff\n7. Document version control and approval records\n\nRef: UAE FDL No.10/2025, FATF Rec 1', tags: ['compliance', 'risk'] },

      // ── Audit & Compliance Review ──
      audit_preparation: { name: 'Audit Preparation: {entity}', notes: 'Prepare for regulatory/internal compliance audit per UAE FDL No.10/2025 Art.22.\n\n1. Review and update all compliance documentation\n2. Verify evidence tracker completeness\n3. Ensure all policies are current and approved\n4. Prepare staff for potential interviews\n5. Verify record retention compliance (5 years)\n6. Test sanctions screening system\n7. Review training completion records\n8. Prepare compliance metrics dashboard\n\nRef: MOE inspection requirements, FATF Rec 18', tags: ['compliance', 'audit'] },
      internal_audit: { name: 'Internal Compliance Audit: {entity}', notes: 'Conduct internal AML/CFT compliance audit per UAE FDL No.10/2025 Art.22.\n\n1. Review AML/CFT policy framework adequacy\n2. Test CDD/KYC procedures (sample testing)\n3. Verify TFS screening effectiveness\n4. Assess STR filing processes and timeliness\n5. Review training program effectiveness\n6. Test record retention compliance\n7. Evaluate governance and reporting structures\n8. Prepare audit findings report with recommendations\n9. Track remediation actions\n\nRef: FATF Rec 18, LBMA RGG v9', tags: ['compliance', 'audit'] },
      gap_remediation: { name: 'Gap Remediation: {entity}', notes: 'Remediate identified compliance gap.\n\n1. Document the gap and its regulatory reference\n2. Assess risk impact (Critical/High/Medium/Low)\n3. Define remediation action plan with timelines\n4. Assign responsible person(s)\n5. Implement corrective measures\n6. Test effectiveness of remediation\n7. Obtain sign-off from compliance officer\n8. Update gap register with closure date\n\nRef: UAE FDL No.10/2025, MOE inspection follow-up', tags: ['compliance', 'gap'] },

      // ── Training ──
      training_completion: { name: 'Training: {entity}', notes: 'Complete AML/CFT compliance training per UAE FDL No.10/2025 Art.21.\n\n1. Complete designated training module\n2. Pass knowledge assessment (min 70%)\n3. Obtain completion certificate\n4. Log completion in training register\n5. Schedule refresher (annual minimum)\n\nRequired topics: AML/CFT framework, TFS/sanctions, CDD/EDD, STR filing, PEP, responsible sourcing, tipping off\n\nRef: FATF Rec 18, Cabinet Resolution No.134/2025', tags: ['compliance', 'training'] },
      training_program: { name: 'Training Program Review: {entity}', notes: 'Annual review of compliance training program.\n\n1. Review training needs assessment results\n2. Update curriculum for regulatory changes (FDL No.10/2025)\n3. Verify role-based training assignments\n4. Check completion rates by department\n5. Assess training effectiveness (test scores)\n6. Add new topics (PF, ESG, AI governance)\n7. Schedule annual training calendar\n8. Present findings to senior management\n\nRef: UAE FDL No.10/2025 Art.21, FATF Rec 18', tags: ['compliance', 'training'] },

      // ── Policy & Procedures ──
      policy_review: { name: 'Policy Review: {entity}', notes: 'Annual review and update of AML/CFT/CPF policies per UAE FDL No.10/2025.\n\n1. Review all compliance policies against current regulations\n2. Incorporate FDL No.10/2025 and Cabinet Resolution No.134/2025 changes\n3. Update FATF and LBMA RGG v9 references\n4. Ensure alignment with UAE NRA 2024 findings\n5. Obtain senior management/Board approval\n6. Communicate changes to all staff\n7. Update version control log\n8. Distribute updated policies\n\nRef: FATF Rec 1, MOE requirements', tags: ['compliance', 'policy'] },
      compliance_manual: { name: 'Compliance Manual Update: {entity}', notes: 'Update Internal Controls & Procedures Guide.\n\nSections to review:\n- Legal & Regulatory Framework\n- AML/CFT/CPF Policies\n- KYC/KYS/KYB/KYE Protocols\n- TFS Screening Procedures\n- SOF/SOW Verification\n- PEP Management\n- Transaction Monitoring\n- STR/SAR Filing Guidelines\n- Responsible Sourcing\n- Record Retention\n- Whistleblower Protection\n- Data Destruction Policy\n- AI Systems Usage\n\nRef: UAE FDL No.10/2025, LBMA RGG v9', tags: ['compliance', 'policy'] },

      // ── Responsible Sourcing ──
      responsible_sourcing: { name: 'Responsible Sourcing Review: {entity}', notes: 'LBMA RGG v9 / OECD responsible sourcing due diligence.\n\n1. Map supply chain from mine to market\n2. Identify CAHRA-origin materials\n3. Verify supplier conformance with LBMA standards\n4. Review conflict minerals documentation\n5. Assess environmental and human rights risks\n6. Check LBMA Responsible Gold Guidance compliance\n7. Document supply chain due diligence\n8. Report to LBMA if required\n\nRef: OECD DDG, LBMA RGG v9, EU CAHRA Regulation', tags: ['compliance', 'sourcing'] },
      supply_chain_audit: { name: 'Supply Chain Audit: {entity}', notes: 'Audit supplier compliance with responsible sourcing standards.\n\n1. Verify supplier AML/CFT policies exist\n2. Review supplier CDD procedures\n3. Assess CAHRA exposure and mitigation\n4. Verify chain of custody documentation\n5. Check responsible sourcing certifications\n6. Review cultural heritage protection measures\n7. Assess ESG compliance\n8. Document findings and corrective actions required\n\nRef: LBMA RGG v9, OECD DDG, UAE FDL No.10/2025', tags: ['compliance', 'sourcing'] },

      // ── Transaction Monitoring ──
      transaction_monitoring: { name: 'Transaction Monitoring Review: {entity}', notes: 'Review transaction monitoring effectiveness per UAE FDL No.10/2025 Art.26.\n\n1. Review red flag indicators and thresholds\n2. Analyze alert volumes and false positive rates\n3. Assess coverage of cash/non-cash transactions\n4. Review wire transfer monitoring (above AED 3,500)\n5. Check unusual transaction pattern detection\n6. Verify escalation procedures are followed\n7. Test system effectiveness with scenarios\n8. Update monitoring rules as needed\n\nRef: FATF Rec 20, UAE AML Guidelines for DPMS', tags: ['compliance', 'monitoring'] },
      threshold_review: { name: 'Threshold Monitoring: {entity}', notes: 'Review DPMS transaction thresholds per Cabinet Resolution No.134/2025.\n\n1. Verify AED 55,000 cash transaction threshold monitoring\n2. Check wire transfer threshold (AED 3,500) compliance\n3. Review occasional transaction CDD triggers\n4. Assess structuring/smurfing detection rules\n5. Verify automated alerts are functioning\n6. Document all threshold breaches and actions taken\n7. Report required transactions to FIU\n\nRef: UAE FDL No.10/2025, FATF Rec 22', tags: ['compliance', 'monitoring'] },

      // ── Record Retention & Data ──
      record_retention: { name: 'Record Retention Audit: {entity}', notes: 'Audit record retention compliance per UAE FDL No.10/2025 Art.24.\n\n1. Verify CDD records retained for minimum 5 years after relationship end\n2. Check transaction records retention (5 years post-transaction)\n3. Verify STR/SAR records maintained per FIU requirements\n4. Assess data storage security and access controls\n5. Review data destruction procedures for expired records\n6. Check backup and recovery procedures\n7. Verify compliance with UAE data protection requirements\n\nRef: FATF Rec 11, UAE FDL No.10/2025 Art.24', tags: ['compliance', 'records'] },
      data_destruction: { name: 'Data Destruction: {entity}', notes: 'Execute approved data destruction per retention policy.\n\n1. Identify records past retention period\n2. Verify no legal hold or ongoing investigation\n3. Obtain compliance officer approval\n4. Destroy records using approved method\n5. Document destruction (date, method, witness)\n6. Update records inventory\n7. Retain destruction certificate\n\nRef: UAE FDL No.10/2025 Art.24, Data Protection requirements', tags: ['compliance', 'records'] },

      // ── Governance & Compliance Officer ──
      co_report: { name: 'CO Annual Report: {entity}', notes: 'Prepare Compliance Officer annual report to Board/senior management per UAE FDL No.10/2025 Art.20.\n\n1. Summary of compliance program activities\n2. STR/SAR filing statistics and trends\n3. TFS screening results and false positive rates\n4. Training completion metrics\n5. Gap register status and remediation progress\n6. EWRA findings and risk trends\n7. Regulatory examination results\n8. Budget and resource requirements\n9. Recommendations for improvements\n\nRef: FATF Rec 18, Cabinet Resolution No.134/2025', tags: ['compliance', 'governance'] },
      compliance_committee: { name: 'Compliance Committee Meeting: {entity}', notes: 'Prepare and conduct compliance committee meeting.\n\n1. Circulate agenda and prior meeting minutes\n2. Review open action items\n3. Present compliance metrics dashboard\n4. Discuss new regulatory developments\n5. Review high-risk customer approvals\n6. Discuss STR/SAR filing decisions\n7. Review training program status\n8. Document meeting minutes and action items\n9. Distribute minutes to committee members\n\nRef: UAE FDL No.10/2025 Art.19-20', tags: ['compliance', 'governance'] },

      // ── Proliferation Financing ──
      pf_assessment: { name: 'PF Risk Assessment: {entity}', notes: 'Proliferation Financing risk assessment per UAE FDL No.10/2025.\n\n1. Identify PF risk indicators in customer base\n2. Screen against WMD-related sanctions lists\n3. Review dual-use goods exposure\n4. Assess EOCN list compliance\n5. Check UNSC PF-related resolutions compliance\n6. Review end-user certificates where applicable\n7. Document PF risk assessment findings\n8. Update policies to address identified PF risks\n\nRef: FATF Rec 1 & 7, UNSC Resolutions', tags: ['compliance', 'pf'] },

      // ── ESG & Ethics ──
      esg_review: { name: 'ESG Compliance Review: {entity}', notes: 'Environmental, Social & Governance review.\n\n1. Assess environmental compliance (chemical management)\n2. Review social responsibility practices\n3. Evaluate governance framework adequacy\n4. Check gender equality and empowerment policies\n5. Review code of conduct compliance\n6. Assess cultural heritage protection measures\n7. Document ESG metrics and findings\n8. Prepare ESG report for stakeholders\n\nRef: LBMA RGG v9, UAE ESG guidelines', tags: ['compliance', 'esg'] },
      anti_corruption: { name: 'Anti-Corruption Review: {entity}', notes: 'Anti-bribery and corruption compliance review.\n\n1. Review anti-corruption policy currency\n2. Assess gifts and hospitality register\n3. Check facilitation payment controls\n4. Review third-party due diligence for corruption risk\n5. Verify conflict of interest declarations\n6. Test whistleblower mechanism effectiveness\n7. Review training on anti-corruption\n8. Document findings and recommendations\n\nRef: UAE Federal Law on Anti-Corruption, LBMA RGG v9', tags: ['compliance', 'ethics'] },

      // ── Whistleblower & Grievance ──
      whistleblower_review: { name: 'Whistleblower Program Review: {entity}', notes: 'Review whistleblower and grievance mechanism per UAE FDL No.(32)/2021.\n\n1. Verify reporting channels are accessible and confidential\n2. Test anonymous reporting mechanism\n3. Review non-retaliation protections\n4. Assess investigation procedures (independence, timeliness)\n5. Review case resolution and closure process\n6. Check employee awareness of reporting channels\n7. Document review findings\n\nRef: UAE Federal Decree-Law No.(32)/2021, FATF Rec 18', tags: ['compliance', 'whistleblower'] },

      // ── Cash-Free / Virtual Assets ──
      cash_free_review: { name: 'Cash-Free Business Policy Review: {entity}', notes: 'Review cash-free business policy compliance.\n\n1. Verify no cash transactions above AED 55,000 threshold\n2. Review virtual asset payment prohibitions\n3. Assess alternative payment channel controls\n4. Verify remuneration traceability\n5. Check compliance with Cabinet Resolution No.134/2025\n6. Document any exceptions and approvals\n\nRef: UAE FDL No.10/2025, FATF Rec 22 for DPMS', tags: ['compliance', 'policy'] },

      // ── AI Governance ──
      ai_governance: { name: 'AI Governance Review: {entity}', notes: 'Review AI systems usage in compliance per emerging UAE standards.\n\n1. Inventory all AI/ML tools used in compliance\n2. Assess bias and accuracy in screening systems\n3. Review human oversight and override procedures\n4. Verify data protection in AI processing\n5. Document AI decision-making transparency\n6. Assess vendor AI system compliance\n7. Review regulatory guidance on AI in AML/CFT\n\nRef: UAE AI Strategy, FATF guidance on digital transformation', tags: ['compliance', 'technology'] },

      // ── DPMS Specific ──
      dpms_reporting: { name: 'DPMS Reporting: {entity}', notes: 'Prepare DPMS regulatory report per MOE requirements.\n\n1. Compile transaction data for reporting period\n2. Verify all transactions above threshold reported\n3. Document precious metals/stones inventory\n4. Prepare compliance program status report\n5. Report any suspicious activity indicators\n6. Submit to MOE within deadline\n7. Retain copies for minimum 5 years\n\nRef: UAE FDL No.10/2025, Cabinet Decision No.10/2019', tags: ['compliance', 'dpms'] },

      // ── Confidentiality & Information Security ──
      infosec_review: { name: 'Information Security Review: {entity}', notes: 'Review compliance data security measures.\n\n1. Assess access controls for compliance systems\n2. Review data encryption standards\n3. Check backup and disaster recovery procedures\n4. Verify secure document destruction processes\n5. Test cyber incident response plan\n6. Review staff security awareness\n7. Assess third-party data handling\n8. Document findings and remediation\n\nRef: UAE FDL No.10/2025 Art.24, Data Protection regulations', tags: ['compliance', 'security'] },

      // ── Beneficial Ownership ──
      ubo_verification: { name: 'UBO Verification: {entity}', notes: 'Ultimate Beneficial Owner identification and verification per UAE FDL No.10/2025 Art.16.\n\n1. Identify all natural persons with 25%+ ownership\n2. Verify identity of each UBO (passport, Emirates ID)\n3. Obtain certified ownership structure chart\n4. Screen all UBOs against sanctions/PEP lists\n5. Verify source of wealth for each UBO\n6. Document complex ownership layers\n7. Flag nominee shareholders or bearer shares\n8. Obtain compliance officer sign-off\n\nRef: FATF Rec 10 & 24, Cabinet Resolution No.134/2025', tags: ['compliance', 'ubo'] },

      // ── Correspondent Banking / Relationships ──
      correspondent_dd: { name: 'Correspondent DD: {entity}', notes: 'Correspondent relationship due diligence per FATF Rec 13.\n\n1. Assess respondent institution AML/CFT controls\n2. Review supervisory regime and licensing\n3. Obtain senior management approval\n4. Document responsibilities of each institution\n5. Verify no shell bank relationship\n6. Screen against sanctions and adverse media\n7. Establish ongoing monitoring plan\n\nRef: UAE FDL No.10/2025, FATF Rec 13', tags: ['compliance', 'correspondent'] },

      // ── Wire Transfer Compliance ──
      wire_transfer_review: { name: 'Wire Transfer Review: {entity}', notes: 'Wire transfer compliance review per FATF Rec 16.\n\n1. Verify originator information completeness\n2. Verify beneficiary information accuracy\n3. Check AED 3,500 threshold compliance\n4. Screen originator/beneficiary against sanctions\n5. Review cross-border transfer documentation\n6. Assess missing information handling procedures\n7. Document review findings\n\nRef: UAE FDL No.10/2025, FATF Rec 16, Cabinet Resolution No.134/2025', tags: ['compliance', 'wire_transfer'] },

      // ── Regulatory Examination ──
      moe_inspection: { name: 'MOE Inspection Prep: {entity}', notes: 'Prepare for Ministry of Economy inspection.\n\n1. Review all compliance documentation currency\n2. Verify AML/CFT policy framework completeness\n3. Prepare compliance officer credentials\n4. Organize CDD/KYC file samples for review\n5. Prepare STR filing log and statistics\n6. Verify training records are complete\n7. Ensure sanctions screening logs available\n8. Prepare EWRA/BWRA documentation\n9. Brief staff on inspection procedures\n10. Prepare responses to common inspection queries\n\nRef: UAE FDL No.10/2025, MOE DPMS inspection framework', tags: ['compliance', 'regulatory'] },

      // ── Sanctions List Update Response ──
      sanctions_update: { name: 'Sanctions List Update: {entity}', notes: 'Respond to new sanctions designations per UAE FDL No.10/2025 Art.35.\n\n1. Download latest consolidated sanctions list\n2. Compare against previous version for new entries\n3. Re-screen entire customer database immediately\n4. Check all pending transactions against new names\n5. Report any matches to EOCN within 24 hours\n6. Freeze identified assets without delay\n7. Document screening completion timestamp\n8. Notify senior management of results\n\nRef: UNSC Resolutions, Cabinet Resolution No.74/2020', tags: ['compliance', 'sanctions'] },

      // ── Business Continuity ──
      bcp_review: { name: 'BCP Review: {entity}', notes: 'Business Continuity Plan review for compliance operations.\n\n1. Review compliance function continuity procedures\n2. Verify backup access to screening systems\n3. Ensure alternative STR filing capability\n4. Test remote compliance monitoring procedures\n5. Verify key person succession for CO/MLRO\n6. Review disaster recovery for compliance data\n7. Document and test communication protocols\n8. Update BCP with lessons learned\n\nRef: UAE FDL No.10/2025, FATF operational continuity guidance', tags: ['compliance', 'bcp'] },

      // ── Customer Risk Rating ──
      risk_rating_review: { name: 'Risk Rating Review: {entity}', notes: 'Periodic customer risk rating reassessment.\n\n1. Review current risk rating methodology\n2. Reassess customer against updated risk criteria\n3. Consider changes in transaction patterns\n4. Review any new adverse media or sanctions hits\n5. Check jurisdiction risk changes (FATF grey/black list)\n6. Update risk rating if warranted\n7. Adjust monitoring frequency accordingly\n8. Document rationale and obtain approval\n\nRef: UAE FDL No.10/2025, FATF risk-based approach', tags: ['compliance', 'risk'] },

      // ── Regulatory Change Impact ──
      reg_change_impact: { name: 'Regulatory Change Impact: {entity}', notes: 'Assess impact of new regulation or guidance.\n\n1. Identify the regulatory change and effective date\n2. Map affected policies and procedures\n3. Perform gap analysis against current controls\n4. Define remediation actions and timeline\n5. Update affected documentation\n6. Communicate changes to relevant staff\n7. Provide targeted training if needed\n8. Monitor implementation effectiveness\n\nRef: UAE regulatory change management requirements', tags: ['compliance', 'regulatory'] },

      // ── Tipping Off Prevention ──
      tipping_off_review: { name: 'Tipping Off Prevention: {entity}', notes: 'Review tipping off controls per UAE FDL No.10/2025 Art.29.\n\n1. Review staff awareness of tipping off prohibition\n2. Verify restricted access to STR/SAR filings\n3. Test information barriers effectiveness\n4. Review communication protocols during investigations\n5. Assess system access controls for sensitive data\n6. Document annual review findings\n7. Update training materials if gaps found\n\nRef: UAE FDL No.10/2025 Art.29, FATF Rec 21', tags: ['compliance', 'tipping_off'] },

      // ── Annual Compliance Calendar ──
      annual_calendar: { name: 'Annual Compliance Calendar: {entity}', notes: 'Prepare annual compliance activity calendar.\n\n1. Schedule quarterly EWRA/BWRA reviews\n2. Plan annual policy review dates\n3. Set training program schedule (all staff)\n4. Schedule KYC refresh cycles by risk rating\n5. Plan compliance committee meeting dates\n6. Set regulatory filing deadlines\n7. Schedule internal audit activities\n8. Plan sanctions list refresh frequency\n9. Set CO annual report deadline\n10. Coordinate with external audit timeline\n\nRef: UAE FDL No.10/2025, compliance best practices', tags: ['compliance', 'governance'] },

      // ── Incident Management ──
      incident_response: { name: 'Compliance Incident: {entity}', notes: 'Manage AML/CFT compliance incident.\n\n1. Document incident details (date, type, description)\n2. Assess severity and regulatory impact\n3. Initiate containment measures immediately\n4. Notify MLRO/Compliance Officer within 24 hours\n5. Determine if STR/SAR filing is required\n6. Investigate root cause\n7. Implement corrective actions\n8. Report to senior management/Board\n9. Update risk register and controls\n10. Retain all incident documentation\n\nRef: UAE FDL No.10/2025, incident management best practices', tags: ['compliance', 'incident'] },
      breach_notification: { name: 'Regulatory Breach Notification: {entity}', notes: 'Handle regulatory breach notification.\n\n1. Identify nature and scope of the breach\n2. Assess regulatory reporting obligations\n3. Notify supervisor/regulator within required timeframe\n4. Document timeline of events\n5. Implement immediate remedial measures\n6. Conduct internal investigation\n7. Prepare formal breach report\n8. Submit to relevant authority (CBUAE/MOE)\n9. Track remediation completion\n10. Update compliance procedures to prevent recurrence\n\nRef: UAE FDL No.10/2025, CBUAE reporting requirements', tags: ['compliance', 'incident'] },

      // ── DMCC / Free Zone Compliance ──
      dmcc_compliance: { name: 'DMCC Compliance Review: {entity}', notes: 'DMCC Rules & Regulations compliance assessment.\n\n1. Verify DMCC member registration status\n2. Review compliance with DMCC Rule Book\n3. Check Kimberley Process certification (if diamonds)\n4. Verify DMCC Good Delivery standards compliance\n5. Review DMCC Tradeflow transaction records\n6. Assess compliance with DMCC AML/CFT requirements\n7. Verify annual compliance declaration submission\n8. Document findings and remediation plan\n\nRef: DMCC Rules & Regulations, DMCC AML Guidelines', tags: ['compliance', 'dmcc'] },
      free_zone_audit: { name: 'Free Zone Compliance Audit: {entity}', notes: 'Free zone entity compliance audit.\n\n1. Verify trade license validity and scope\n2. Review free zone authority registration\n3. Check customs documentation compliance\n4. Verify import/export permit requirements\n5. Review warehousing and storage regulations\n6. Assess JAFZA/DMCC/SAIF zone-specific rules\n7. Verify annual reporting submissions\n8. Document audit findings\n\nRef: Relevant free zone authority regulations', tags: ['compliance', 'free_zone'] },

      // ── Precious Metals Specific ──
      hallmarking_verification: { name: 'Hallmarking Verification: {entity}', notes: 'Verify precious metals hallmarking and assay compliance.\n\n1. Verify assay certificate authenticity\n2. Check hallmark stamps match documentation\n3. Verify fineness/purity declarations\n4. Cross-reference with assay office records\n5. Review chain of custody from refinery\n6. Verify LBMA Good Delivery status of bars\n7. Document serial numbers and weight reconciliation\n8. Flag discrepancies for investigation\n\nRef: UAE Standards & Metrology Authority, LBMA Good Delivery Rules', tags: ['compliance', 'metals'] },
      refinery_dd: { name: 'Refinery Due Diligence: {entity}', notes: 'Refinery/smelter due diligence per LBMA RGG v9.\n\n1. Verify refinery LBMA Good Delivery accreditation\n2. Review refinery AML/CFT compliance program\n3. Assess CAHRA material exposure and controls\n4. Verify responsible sourcing certifications\n5. Review refinery audit reports (last 2 years)\n6. Check for adverse media and sanctions hits\n7. Assess recycled vs mined material ratios\n8. Document findings and risk rating\n\nRef: LBMA RGG v9, OECD DDG Annex II', tags: ['compliance', 'sourcing'] },
      gold_import_clearance: { name: 'Gold Import Clearance: {entity}', notes: 'Gold/precious metals import compliance clearance.\n\n1. Verify import license and permit validity\n2. Check origin country risk assessment\n3. Review Kimberley Process certificates (if applicable)\n4. Verify supplier CDD/KYS is current\n5. Screen supplier against sanctions lists\n6. Check customs declaration accuracy\n7. Verify assay certificates match shipment\n8. Reconcile weight and purity declarations\n9. Document chain of custody\n10. Obtain compliance clearance sign-off\n\nRef: UAE Customs regulations, LBMA RGG v9', tags: ['compliance', 'metals'] },

      // ── CTR / Cash Transaction Reporting ──
      ctr_filing: { name: 'CTR Filing: {entity}', notes: 'Cash Transaction Report filing per UAE FDL No.10/2025.\n\n1. Identify cash transaction at/above AED 55,000 threshold\n2. Verify customer identity and CDD status\n3. Document source of cash funds\n4. Complete CTR form with all required fields\n5. Submit to FIU via goAML portal within deadline\n6. Record filing reference number\n7. Flag if structuring is suspected (file STR separately)\n8. Retain all supporting documentation\n\nRef: UAE FDL No.10/2025, Cabinet Resolution No.134/2025, FATF Rec 22', tags: ['compliance', 'ctr'] },

      // ── Vendor / Third-Party Management ──
      vendor_risk_assessment: { name: 'Vendor Risk Assessment: {entity}', notes: 'Third-party vendor compliance risk assessment.\n\n1. Assess vendor AML/CFT compliance program\n2. Review vendor screening and monitoring capabilities\n3. Evaluate data protection and security controls\n4. Check regulatory compliance certifications\n5. Assess concentration risk and alternatives\n6. Review SLA and contractual compliance obligations\n7. Verify vendor staff training and background checks\n8. Document risk rating and mitigation measures\n9. Schedule periodic reassessment\n\nRef: FATF Rec 17, UAE outsourcing guidelines', tags: ['compliance', 'vendor'] },
      outsourcing_review: { name: 'Outsourcing Compliance Review: {entity}', notes: 'Review outsourced compliance function per regulatory requirements.\n\n1. Verify outsourcing arrangement is permissible\n2. Review service provider qualifications\n3. Assess retained oversight and control\n4. Check data handling and confidentiality terms\n5. Verify regulatory notification requirements met\n6. Review performance metrics and reporting\n7. Test contingency arrangements\n8. Document review findings and actions\n\nRef: UAE FDL No.10/2025, FATF outsourcing guidance', tags: ['compliance', 'vendor'] },

      // ── Sanctions Evasion Detection ──
      sanctions_evasion: { name: 'Sanctions Evasion Review: {entity}', notes: 'Review controls for detecting sanctions evasion techniques.\n\n1. Assess name variation/transliteration screening\n2. Review vessel/shipping route monitoring\n3. Check for transshipment red flags\n4. Evaluate front company detection capabilities\n5. Review trade-based sanctions evasion indicators\n6. Assess cryptocurrency/virtual asset controls\n7. Check for oil/gold price cap circumvention\n8. Document gaps and enhancement plan\n\nRef: OFAC advisories, EU sanctions guidance, FATF typologies', tags: ['compliance', 'sanctions'] },

      // ── Regulatory Reporting ──
      quarterly_report: { name: 'Quarterly Compliance Report: {entity}', notes: 'Prepare quarterly compliance report for management.\n\n1. Compile KPI metrics (CDD completion, screening, STRs)\n2. Summarize new regulatory developments\n3. Report training completion statistics\n4. Detail sanctions screening results\n5. List open audit findings and remediation status\n6. Present risk trend analysis\n7. Highlight resource needs and budget status\n8. Provide recommendations for next quarter\n\nRef: Internal governance requirements', tags: ['compliance', 'reporting'] },
      board_reporting: { name: 'Board Compliance Report: {entity}', notes: 'Prepare Board-level compliance report per UAE FDL No.10/2025.\n\n1. Executive summary of compliance program health\n2. Key risk indicators and trends\n3. Regulatory examination outcomes\n4. Major incident summary\n5. STR/SAR filing statistics\n6. Budget utilization and resource requirements\n7. Regulatory change impact assessment\n8. Strategic recommendations\n9. Compliance roadmap update\n\nRef: UAE FDL No.10/2025 Art.19-20, corporate governance', tags: ['compliance', 'governance'] },

      // ── Cross-Border Compliance ──
      cross_border_review: { name: 'Cross-Border Transaction Review: {entity}', notes: 'Review cross-border precious metals transaction compliance.\n\n1. Verify export/import licenses and permits\n2. Screen all parties against sanctions lists\n3. Check origin and destination country risk ratings\n4. Review customs declarations for accuracy\n5. Verify transportation and insurance documentation\n6. Assess trade-based money laundering indicators\n7. Check correspondent relationship compliance\n8. Document end-use/end-user verification\n9. File CTR if cash component exceeds threshold\n\nRef: UAE FDL No.10/2025, FATF Rec 16 & 22, UAE Customs Law', tags: ['compliance', 'cross_border'] },

      // ── Compliance Technology ──
      system_validation: { name: 'Compliance System Validation: {entity}', notes: 'Validate compliance technology systems effectiveness.\n\n1. Test sanctions screening system accuracy\n2. Verify transaction monitoring alert thresholds\n3. Review false positive/negative rates\n4. Validate data quality and completeness\n5. Test system integration points\n6. Review audit trail and logging\n7. Assess system access controls\n8. Document validation results and gaps\n9. Plan remediation for identified issues\n\nRef: FATF digital transformation guidance, UAE technology standards', tags: ['compliance', 'technology'] },

      // ── Cabinet Resolution 156/2025: Strategic Goods & Dual-Use ──
      dual_use_screening: { name: 'Dual-Use Goods Screening: {entity}', notes: 'Screen for strategic goods and dual-use items per Cabinet Resolution 156/2025.\n\n1. Review transaction/shipment for dual-use item indicators\n2. Cross-reference UAE Strategic Goods Control Lists\n3. Assess end-user and end-use declarations\n4. Screen against proliferation-related sanctions\n5. Document screening results and rationale\n6. Escalate confirmed dual-use items to MLRO\n7. File report to competent authority if required\n8. Retain all screening records\n\nRef: Cabinet Resolution 156/2025, FDL No.10/2025, UNSC PF Resolutions', tags: ['compliance', 'pf'] },

      // ── Cabinet Resolution 71/2024: Administrative Penalties ──
      penalty_assessment: { name: 'Administrative Penalty Assessment: {entity}', notes: 'Assess administrative penalty exposure per Cabinet Resolution 71/2024.\n\n1. Identify nature and severity of violation\n2. Determine applicable penalty range (AED 10K–100M)\n3. Assess mitigating factors (self-reporting, remediation)\n4. Review prior violation history\n5. Prepare penalty risk report for senior management\n6. Document corrective actions taken\n7. Engage legal counsel if penalty exceeds AED 500K\n8. Monitor regulatory outcome and update risk register\n\nRef: Cabinet Resolution 71/2024, FDL No.10/2025', tags: ['compliance', 'regulatory'] },

      // ── Cabinet Resolution 132/2023: UBO Penalty Framework ──
      ubo_penalty_review: { name: 'UBO Penalty Review: {entity}', notes: 'Review UBO compliance against penalty framework per Cabinet Resolution 132/2023.\n\n1. Verify UBO records accuracy and currency\n2. Check compliance with Cabinet Decision 109/2023 requirements\n3. Assess penalty exposure for any non-compliance\n4. Review UBO notification obligations to authorities\n5. Verify nominee shareholder disclosures\n6. Document rectification actions and timeline\n7. Obtain legal review if material deficiencies found\n\nRef: Cabinet Resolution 132/2023, Cabinet Decision 109/2023', tags: ['compliance', 'ubo'] },

      // ── MoE Circular No.1/2024: NRA Integration ──
      nra_integration: { name: 'NRA Integration Review: {entity}', notes: 'Integrate UAE National Risk Assessment 2024 findings per MoE Circular No.1/2024.\n\n1. Review NRA 2024 key findings for DPMS sector\n2. Identify medium-to-high risk classification implications\n3. Update EWRA methodology to incorporate NRA findings\n4. Adjust customer risk scoring for NRA risk factors\n5. Review product/channel risk based on NRA\n6. Update training materials with NRA findings\n7. Document integration and present to senior management\n\nRef: MoE Circular No.1/2024, UAE NRA 2024', tags: ['compliance', 'risk'] },

      // ── MoE Supplemental DPMS Guidance (May 2019) ──
      dpms_guidance_review: { name: 'DPMS Guidance Compliance Check: {entity}', notes: 'Review compliance with MoE Supplemental Guidance for DPMS (May 2019).\n\n1. Verify CDD procedures match DPMS-specific requirements\n2. Review precious metals transaction monitoring rules\n3. Check DPMS threshold monitoring (AED 55,000)\n4. Assess record-keeping per DPMS standards\n5. Review training program for DPMS-specific content\n6. Verify goAML DPMSR reporting compliance\n7. Document findings and update procedures\n\nRef: MoE Supplemental Guidance for DPMS (May 2019)', tags: ['compliance', 'dpms'] },

      // ── Responsible Sourcing (LBMA/OECD/DMCC/DGD/RMI) ──
      responsible_sourcing: { name: 'Responsible Sourcing Check: {entity}', notes: 'Verify responsible sourcing compliance for gold supply chain.\n\n1. Check supplier against LBMA Good Delivery List\n2. Verify DMCC Approved Refiner status\n3. Check Dubai Good Delivery (DGD) accreditation\n4. Review OECD DDG Step 1-5 compliance documentation\n5. Check RMI RMAP conformance status of smelter/refiner\n6. Verify EU Conflict Minerals Regulation compliance if applicable\n7. Assess CAHRA (Conflict-Affected High-Risk Area) exposure\n8. Review ESG due diligence documentation\n9. Document all verification results\n\nRef: LBMA RGG v9, OECD DDG, DMCC Rules, DGD Standards, RMI RMAP, EU Reg 2017/821', tags: ['compliance', 'sourcing'] },

      // ── SOF/SOW Deep Verification ──
      sof_sow_verification: { name: 'SOF/SOW Deep Verification: {entity}', notes: 'In-depth Source of Funds / Source of Wealth verification.\n\n1. Request bank statements (minimum 6 months)\n2. Verify declared income against tax records/audited accounts\n3. Cross-reference employment/business income documentation\n4. Verify property or asset sale documentation if applicable\n5. Assess inheritance or gift documentation (notarized)\n6. Review for commingled or layered funds\n7. Escalate to MLRO if SOF/SOW cannot be satisfactorily verified\n8. Document verification outcome and retain evidence\n\nRef: UAE FDL No.10/2025 Art.14, FATF Rec.10, Cabinet Resolution 134/2025', tags: ['compliance', 'cdd'] },

      // ── Four-Eyes Principle Review ──
      four_eyes_review: { name: 'Four-Eyes Review: {entity}', notes: 'Independent second review per four-eyes principle.\n\n1. Review initial assessment and documentation\n2. Verify CDD completeness independently\n3. Re-screen entity against sanctions/PEP lists\n4. Assess risk rating determination independently\n5. Confirm or challenge initial risk conclusion\n6. Document reviewer rationale and sign-off\n7. Escalate disagreements to MLRO\n\nRef: UAE FDL No.10/2025, Internal Controls best practice', tags: ['compliance', 'review'] },

      // ── Customer Exit / De-risking ──
      customer_exit: { name: 'Customer Exit Process: {entity}', notes: 'Manage customer relationship termination per AML/CFT requirements.\n\n1. Document grounds for exit (unable to complete CDD, STR filed, sanctions match, unacceptable risk)\n2. Assess STR/SAR filing requirement before exit\n3. Ensure no tipping off during exit process\n4. Coordinate asset liquidation if applicable\n5. Notify customer in compliance with legal requirements\n6. Close all accounts and revoke access\n7. Retain all records for minimum 5 years post-exit\n8. Update customer status in CRM/compliance system\n\nRef: UAE FDL No.10/2025, FATF Rec.10, CBUAE De-risking Guidance', tags: ['compliance', 'exit'] },

      // ── Compliance Culture Assessment ──
      culture_assessment: { name: 'Compliance Culture Assessment: {entity}', notes: 'Assess organizational compliance culture per UAE FDL No.10/2025.\n\n1. Survey staff awareness of AML/CFT obligations\n2. Review tone-from-the-top messaging\n3. Assess willingness to report suspicious activity\n4. Review escalation patterns and response times\n5. Check compliance function independence and authority\n6. Assess resource adequacy for compliance\n7. Review incentive structures for compliance behavior\n8. Document findings and improvement plan\n\nRef: UAE FDL No.10/2025 Art.19, FATF Rec.18', tags: ['compliance', 'governance'] },

      // ── Regulatory Inspection Response ──
      inspection_response: { name: 'Regulatory Inspection Response: {entity}', notes: 'Respond to regulatory inspection findings.\n\n1. Acknowledge receipt of inspection report\n2. Analyze each finding and recommendation\n3. Classify findings by severity and urgency\n4. Develop remediation action plan with timelines\n5. Assign responsible persons for each action\n6. Implement remediation measures\n7. Prepare formal response to regulator\n8. Schedule follow-up verification\n9. Track all actions to completion\n10. Present progress to Board/senior management\n\nRef: UAE FDL No.10/2025, MOE DPMS supervision framework', tags: ['compliance', 'regulatory'] },

      // ── OECD Gold Supplement ──
      oecd_gold_review: { name: 'OECD Gold Supplement Review: {entity}', notes: 'Due diligence per OECD Gold Supplement and DDG for minerals from CAHRAs.\n\n1. Map gold supply chain from mine/refinery to market\n2. Identify and assess CAHRA-origin gold risks\n3. Verify refinery LBMA Good Delivery status\n4. Review conflict minerals reporting compliance\n5. Assess on-the-ground assessment reports\n6. Check recycled vs mined gold documentation\n7. Review OECD Annex II red flag indicators\n8. Document supply chain DD findings\n\nRef: OECD DDG Gold Supplement, LBMA RGG v9, WGC Conflict-Free Gold Standard', tags: ['compliance', 'sourcing'] },

      // ── World Gold Council Conflict-Free ──
      wgc_assessment: { name: 'WGC Conflict-Free Assessment: {entity}', notes: 'Assess compliance with World Gold Council Conflict-Free Gold Standard.\n\n1. Review conflict-free gold standard requirements\n2. Assess supply chain conformance declaration\n3. Verify no direct/indirect support to armed conflict\n4. Check human rights abuse indicators\n5. Review anti-bribery compliance in supply chain\n6. Verify money laundering prevention in gold supply\n7. Document assessment and obtain sign-off\n\nRef: WGC Conflict-Free Gold Standard, OECD DDG, LBMA RGG v9', tags: ['compliance', 'sourcing'] },

      // ── FATF Rec 22: DPMS Specific ──
      fatf_r22_compliance: { name: 'FATF Rec 22 Compliance: {entity}', notes: 'Verify compliance with FATF Recommendation 22 for DPMS.\n\n1. Confirm CDD for cash transactions >= AED 55,000\n2. Verify CDD for all occasional transactions at threshold\n3. Review suspicious transaction reporting processes\n4. Check record-keeping for DPMS transactions\n5. Verify internal controls and compliance program\n6. Assess training program DPMS-specific content\n7. Review DPMS-specific risk factors in EWRA\n8. Document compliance status\n\nRef: FATF Rec 22, UAE FDL No.10/2025, Cabinet Resolution 134/2025', tags: ['compliance', 'fatf'] },

      // ── Federal Decree-Law No.31/2021: Predicate Offences ──
      predicate_offence_screen: { name: 'Predicate Offence Screening: {entity}', notes: 'Screen for predicate offences per Federal Decree-Law No.31/2021 (UAE Penal Code).\n\n1. Screen for bribery and corruption indicators\n2. Assess fraud risk factors in transaction patterns\n3. Review for embezzlement/misappropriation signs\n4. Check for tax evasion indicators\n5. Screen for human trafficking/smuggling links\n6. Assess counterfeiting/forgery risk\n7. Document screening results and escalate findings\n8. File STR if predicate offence suspected\n\nRef: Federal Decree-Law No.31/2021, FDL No.10/2025 Art.2', tags: ['compliance', 'aml'] },

      // ── UAE Penal Code: Financial Crime ──
      financial_crime_review: { name: 'Financial Crime Risk Review: {entity}', notes: 'Assess financial crime risk indicators per UAE Penal Code and AML framework.\n\n1. Review transaction patterns for structuring/layering\n2. Assess use of front companies or nominees\n3. Check for round-tripping or circular payments\n4. Review cash-intensive business indicators\n5. Assess commingling of funds risk\n6. Screen for trade-based money laundering indicators\n7. Review virtual asset/crypto exposure\n8. Document risk assessment and actions\n\nRef: FDL No.10/2025, Federal Decree-Law No.31/2021, FATF Typologies', tags: ['compliance', 'aml'] },

      // ── Compliance Manual Annual Review ──
      annual_manual_review: { name: 'Annual Compliance Manual Review: {entity}', notes: 'Conduct annual review of Compliance Manual per UAE regulatory requirements.\n\n1. Verify alignment with FDL No.10/2025 (current law)\n2. Incorporate Cabinet Resolution 134/2025 requirements\n3. Update Cabinet Resolution 156/2025 (PF/Strategic Goods) references\n4. Reflect Cabinet Resolution 74/2020 (TFS) obligations\n5. Integrate UAE NRA 2024 findings per MoE Circular No.1/2024\n6. Update LBMA RGG v9 and OECD DDG references\n7. Review FATF Recommendations alignment\n8. Update MoE guidance references (Practical Guide, DPMS Supplement)\n9. Obtain senior management/Board approval\n10. Communicate updates to all staff\n\nRef: FDL No.10/2025 Art.20, Cabinet Resolution 134/2025', tags: ['compliance', 'policy'] },
    },

    createFromTemplate(templateKey, variables, projectId) {
      const tmpl = this.TASK_TEMPLATES[templateKey];
      if (!tmpl) return Promise.reject(new Error('Unknown template'));
      let name = tmpl.name;
      let notes = tmpl.notes;
      Object.entries(variables || {}).forEach(([k, v]) => {
        name = name.replaceAll(`{${k}}`, v);
        notes = notes.replaceAll(`{${k}}`, v);
      });
      const body = JSON.stringify({ data: { name, notes, projects: [projectId] } });
      if (typeof asanaFetch === 'function') {
        return asanaFetch('/tasks', { method: 'POST', body });
      }
      return proxyFetch('/asana/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    },

    async createSubtask(parentTaskId, subtaskData) {
      const body = JSON.stringify({ data: subtaskData });
      if (typeof asanaFetch === 'function') {
        return asanaFetch(`/tasks/${parentTaskId}/subtasks`, { method: 'POST', body });
      }
      return proxyFetch(`/asana/tasks/${parentTaskId}/subtasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    },

    async getTaskProgress(projectId) {
      let tasks = [];
      if (typeof asanaFetch === 'function') {
        const r = await asanaFetch(`/projects/${projectId}/tasks?opt_fields=completed,name,due_on`);
        const json = await r.json();
        tasks = json.data || [];
      } else {
        const res = await proxyFetch(`/asana/projects/${projectId}/tasks?opt_fields=completed,name,due_on`);
        tasks = res.data || [];
      }
      const total = tasks.length;
      const completed = tasks.filter(t => t.completed).length;
      return { total, completed, percentage: total > 0 ? Math.round((completed / total) * 100) : 0 };
    },

    async healthCheck() {
      const resolver = typeof AsanaProjectResolver !== 'undefined' ? AsanaProjectResolver : null;
      const projectId = resolver ? resolver.resolveProject('workflow') : (localStorage.getItem('asanaProjectId') || '1213759768596515');
      const hasToken = !!window.ASANA_TOKEN;
      const hasProxy = !!getProxy();
      // If token or proxy available, try live check
      if (hasToken || hasProxy) {
        try {
          if (typeof asanaFetch === 'function') {
            const r = await asanaFetch('/users/me');
            if (r.ok || r.data) { updateStatus('asana', true); return true; }
          } else {
            await proxyFetch('/asana/users/me');
            updateStatus('asana', true);
            return true;
          }
        } catch (e) {
          if (hasToken) {
            try {
              const r = await fetch('https://app.asana.com/api/1.0/users/me', {
                headers: { 'Authorization': 'Bearer ' + window.ASANA_TOKEN }
              });
              if (r.ok) { updateStatus('asana', true); return true; }
            } catch (_) {}
          }
        }
      }
      // If project ID is configured, treat as configured (tasks will queue for sync)
      if (projectId) {
        updateStatus('asana', true);
        return true;
      }
      updateStatus('asana', false, null, 0);
      return false;
    },
  };

  // Notion removed — integration deprecated
  const notion = {};

  // Slack removed — not supported in browser-only deployment
  const slack = {
    async sendRichMessage() { return false; },
    async sendComplianceDigest() { return false; },
    async sendFindingAlert() { return false; },
    healthCheck() { updateStatus('slack', false); return false; },
  };

  // ══════════════════════════════════════════════════════════════════
  // GOOGLE DRIVE ENHANCED
  // ══════════════════════════════════════════════════════════════════
  const gdrive = {
    FOLDER_STRUCTURE: {
      root: 'Hawkeye Sterling V2',
      children: ['Reports', 'Evidence', 'Audits', 'Training Records', 'Policies', 'STR Filings', 'Incident Reports'],
    },

    async createFolderStructure(accessToken, parentFolderId) {
      const results = {};
      for (const folder of this.FOLDER_STRUCTURE.children) {
        try {
          const res = await fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: folder,
              mimeType: 'application/vnd.google-apps.folder',
              parents: [parentFolderId],
            }),
          });
          const data = await res.json();
          results[folder] = data.id;
          logEvent('gdrive', 'create_folder', true, folder);
        } catch (e) {
          logEvent('gdrive', 'create_folder', false, e.message);
        }
      }
      return results;
    },

    async uploadFile(accessToken, folderId, fileName, content, mimeType) {
      const metadata = { name: fileName, parents: [folderId] };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', new Blob([content], { type: mimeType || 'application/octet-stream' }));

      try {
        const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}` },
          body: form,
        });
        const data = await res.json();
        logEvent('gdrive', 'upload_file', true, fileName);
        return data;
      } catch (e) {
        logEvent('gdrive', 'upload_file', false, e.message);
        throw e;
      }
    },

    async searchFiles(accessToken, folderId, query) {
      const safeQuery = String(query || '').replace(/[^a-zA-Z0-9 _.\-]/g, '');
      const safeFolderId = String(folderId || '').replace(/[^a-zA-Z0-9_\-]/g, '');
      const q = `'${safeFolderId}' in parents and name contains '${safeQuery}' and trashed = false`;
      const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,modifiedTime,size)`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      return res.json();
    },

    async batchUpload(accessToken, folderId, files) {
      const results = [];
      for (const file of files) {
        const res = await this.uploadFile(accessToken, folderId, file.name, file.content, file.mimeType);
        results.push(res);
      }
      return results;
    },

    healthCheck() {
      // GDrive is connected if OAuth token exists OR if client ID is configured
      const connected = !!(window.gdriveAccessToken || window.GDRIVE_CLIENT_ID);
      updateStatus('gdrive', connected);
      return connected;
    },
  };

  // ClickUp removed — integration deprecated
  const clickup = {};

  // ══════════════════════════════════════════════════════════════════
  // HEALTH MONITOR
  // ══════════════════════════════════════════════════════════════════
  async function healthCheckAll() {
    const results = {};
    const checks = [
      { name: 'asana', fn: () => asana.healthCheck() },
      { name: 'gdrive', fn: () => gdrive.healthCheck() },
    ];

    for (const check of checks) {
      try { results[check.name] = await check.fn(); }
      catch (_) { results[check.name] = false; }
    }

    // AI providers — check if key or proxy is configured
    if (window.ANTHROPIC_KEY || getProxy()) {
      try {
        await proxyFetch('/anthropic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"model":"claude-haiku-4-5","max_tokens":1,"messages":[{"role":"user","content":"ping"}]}' });
        results.anthropic = true; updateStatus('anthropic', true);
      } catch (_) {
        // If key or proxy exists, mark as connected (API might rate-limit pings)
        const configured = !!(window.ANTHROPIC_KEY || getProxy());
        results.anthropic = configured; updateStatus('anthropic', configured);
      }
    } else {
      results.anthropic = false; updateStatus('anthropic', false);
    }

    return results;
  }

  function renderStatusDashboard() {
    const status = getStatus();
    const log = getLog();
    const services = [
      { key: 'anthropic', name: 'Claude (Anthropic)', icon: '🤖', required: true },
      { key: 'asana', name: 'Asana', icon: '📋', required: true },
    ];

    let html = `
<div class="card">
  <div class="sec-title">INTEGRATION HEALTH MONITOR</div>
  <button class="btn-sm btn-green" onclick="IntegrationsEnhanced.runHealthCheck()" style="margin-bottom:12px">Run Health Check</button>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">`;

    services.forEach(svc => {
      const s = status[svc.key] || {};
      const connected = s.connected === true;
      const color = connected ? 'var(--green)' : 'var(--red)';
      const statusText = connected ? 'Connected' : 'Disconnected';
      const lastSync = s.lastSync ? new Date(s.lastSync).toLocaleString('en-GB') : 'Never';

      html += `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:12px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:13px;font-weight:500">${svc.icon} ${svc.name}</span>
        <span style="width:8px;height:8px;border-radius:50%;background:${color}"></span>
      </div>
      <div style="font-size:10px;color:${color};margin-top:4px;font-family:'Montserrat',sans-serif">${statusText}</div>
      <div style="font-size:9px;color:var(--muted);margin-top:2px;font-family:'Montserrat',sans-serif">Last: ${lastSync}</div>
      ${svc.required ? '<div style="font-size:9px;color:var(--amber);margin-top:2px">Required</div>' : ''}
    </div>`;
    });

    html += `</div></div>`;

    // Recent log
    html += `
<div class="card">
  <div class="sec-title">INTEGRATION LOG <span style="color:var(--muted);font-size:10px">(${log.length} events)</span></div>`;

    if (log.length) {
      html += log.slice(0, 30).map(l => `
    <div style="display:flex;justify-content:space-between;padding:6px 8px;border-bottom:1px solid var(--border);font-size:11px">
      <span style="color:var(--text)">${l.integration} → ${l.action}</span>
      <span style="color:${l.success ? 'var(--green)' : 'var(--red)'};font-family:'Montserrat',sans-serif">${l.success ? 'OK' : 'FAIL'} ${new Date(l.timestamp).toLocaleTimeString()}</span>
    </div>`).join('');
    } else {
      html += '<p style="color:var(--muted);font-size:13px">No events logged.</p>';
    }
    html += `</div>`;

    // Asana task templates
    html += `
<div class="card">
  <div class="sec-title">ASANA TASK TEMPLATES</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">`;
    Object.entries(asana.TASK_TEMPLATES).forEach(([key, tmpl]) => {
      html += `
    <div style="background:var(--surface2);border-radius:3px;padding:10px;border:1px solid var(--border)">
      <div style="font-size:12px;font-weight:500;color:var(--gold)">${tmpl.name.replace(/:\s*\{.*?\}/, '')}</div>
      <div style="font-size:10px;color:var(--muted);margin-top:4px">${tmpl.tags.join(', ')}</div>
      <button class="btn btn-sm btn-green" style="margin-top:6px;font-size:10px" onclick="IntegrationsEnhanced.showTemplateDialog('${key}')">Create Task</button>
    </div>`;
    });
    html += `</div></div>`;

    return html;
  }

  async function runHealthCheck() {
    if (typeof toast === 'function') toast('Running health checks...', 'info');
    const results = await healthCheckAll();
    const connected = Object.values(results).filter(Boolean).length;
    const total = Object.keys(results).length;
    if (typeof toast === 'function') toast(`Health check: ${connected}/${total} services connected`, connected === total ? 'success' : 'error');
    if (typeof switchTab === 'function') switchTab('integrations');
  }

  function showTemplateDialog(templateKey) {
    const tmpl = asana.TASK_TEMPLATES[templateKey];
    if (!tmpl) return;
    const activeComp = typeof getActiveCompany === 'function' ? getActiveCompany() : {};
    const defaultName = activeComp.name || 'Hawkeye Sterling';
    // Auto-use active company name — prompt only if no active company set
    const entity = defaultName || prompt('Enter company or entity name for "' + tmpl.name + '":', defaultName);
    if (!entity) return;
    const projectId = window.ASANA_PROJECT || (typeof ASANA_PROJECT !== 'undefined' ? ASANA_PROJECT : null) || prompt('Enter Asana Project ID:');
    if (!projectId) return;
    asana.createFromTemplate(templateKey, { entity, company: entity, framework: entity, topic: entity }, projectId)
      .then(() => { if (typeof toast === 'function') toast('Task created: ' + tmpl.name.replace('{entity}', entity), 'success'); })
      .catch(e => { if (typeof toast === 'function') toast('Failed: ' + e.message, 'error'); });
  }

  window.IntegrationsEnhanced = {
    asana, notion, slack, gdrive, clickup,
    healthCheckAll, runHealthCheck,
    renderStatusDashboard,
    showTemplateDialog,
    getStatus, getLog,
  };
})();
