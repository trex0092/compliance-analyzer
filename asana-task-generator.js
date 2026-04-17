/**
 * Hawkeye Sterling V2 - Asana Task Generator
 * Create formal, humanized, compliance narrations for Asana tasks
 */

class AsanaTaskGenerator {
  constructor(asanaClient, workspaceId) {
    this.asanaClient = asanaClient;
    this.workspaceId = workspaceId;
    this.tasks = [];
  }

  /**
   * Generate formal compliance narration
   */
  generateComplianceNarration(taskType, details) {
    const narrations = {
      KYC_VERIFICATION: `
COMPLIANCE TASK: CUSTOMER KNOW-YOUR-YOUR (KYC) VERIFICATION
============================================================

OBJECTIVE:
Conduct comprehensive Know-Your-Customer (KYC) verification in accordance with Federal Decree-Law No. 20/2018 (AML/CFT Law) and Central Bank of UAE guidelines. This verification is mandatory for all new customer relationships and must be completed before account activation.

SCOPE:
- Verify customer identity using government-issued identification
- Confirm residential address through utility bills or official documentation
- Assess customer risk profile based on occupation, source of funds, and transaction patterns
- Document all verification steps and maintain audit trail
- Update customer risk classification in compliance system

REGULATORY REQUIREMENTS:
- FDL No. 20/2018 Article 5: Customer Due Diligence
- FATF Recommendation 10: Customer Due Diligence
- Cabinet Resolution 134/2025: Enhanced Due Diligence Requirements
- Central Bank of UAE Circular: KYC Standards

DELIVERABLES:
1. Completed KYC verification form
2. Scanned copies of identification documents
3. Address verification documentation
4. Risk assessment report
5. Signed customer declaration
6. Audit trail documentation

TIMELINE: Must be completed within 5 business days of account opening
RESPONSIBLE PARTY: Compliance Officer / KYC Analyst
ESCALATION: If verification cannot be completed, escalate to Compliance Manager

COMPLIANCE SIGN-OFF: This task must be formally approved by authorized compliance personnel before customer account activation.
      `,

      SANCTIONS_SCREENING: `
COMPLIANCE TASK: SANCTIONS LIST SCREENING
===========================================

OBJECTIVE:
Perform comprehensive sanctions screening against international and local sanctions lists to ensure the organization does not engage in transactions with sanctioned individuals, entities, or jurisdictions. This is a mandatory compliance control required by UAE and international regulations.

SCOPE:
- Screen customer name, aliases, and identifiers against OFAC SDN list
- Screen against UN Security Council sanctions designations
- Screen against EU consolidated sanctions list
- Screen against UAE Cabinet Resolution 74/2020 sanctions list
- Document all screening results and maintain audit trail
- Flag any matches for immediate escalation

REGULATORY REQUIREMENTS:
- Cabinet Resolution 74/2020: Sanctions and Terrorist Financing
- FATF Recommendation 6: Targeted Financial Sanctions
- OFAC Compliance Requirements
- UN Security Council Resolution Compliance

SCREENING LISTS:
1. OFAC SDN (Specially Designated Nationals)
2. UN Security Council Consolidated List
3. EU Consolidated Sanctions List
4. UAE Cabinet Resolution 74/2020 List
5. INTERPOL Red Notices
6. World Bank Debarred Entities List

ACTIONS REQUIRED:
- Conduct initial screening before customer onboarding
- Perform periodic re-screening (quarterly minimum)
- Investigate any potential matches
- Document investigation results
- Report matches to relevant authorities if required

ESCALATION PROTOCOL:
- Any match must be immediately escalated to Compliance Manager
- Potential matches must be reported to relevant authorities within 24 hours
- Transaction blocking procedures must be initiated immediately

COMPLIANCE CERTIFICATION: This task requires formal certification that screening has been completed in accordance with all applicable regulations.
      `,

      AML_TRANSACTION_MONITORING: `
COMPLIANCE TASK: ANTI-MONEY LAUNDERING (AML) TRANSACTION MONITORING
====================================================================

OBJECTIVE:
Implement continuous transaction monitoring to detect and report suspicious activities that may indicate money laundering, terrorist financing, or other financial crimes. This is a core AML control required under Federal Decree-Law No. 20/2018.

SCOPE:
- Monitor all customer transactions for suspicious patterns
- Detect structuring, layering, and integration schemes
- Identify rapid movement of funds across multiple accounts
- Flag transactions with high-risk jurisdictions
- Generate alerts for manual review by compliance team
- Document all monitoring activities and investigations

SUSPICIOUS ACTIVITY INDICATORS:
1. Structuring: Multiple transactions below reporting thresholds
2. Layering: Complex transaction chains with no apparent business purpose
3. Integration: Repatriation of funds through seemingly legitimate channels
4. Velocity: Unusually rapid movement of funds
5. Geographic: Transactions with high-risk jurisdictions
6. Behavioral: Deviation from customer's normal transaction patterns

REGULATORY REQUIREMENTS:
- FDL No. 20/2018 Article 20: Transaction Monitoring
- FATF Recommendation 20: Reporting of Suspicious Transactions
- Cabinet Resolution 134/2025: Enhanced Monitoring Requirements
- Central Bank of UAE Guidelines: Transaction Monitoring Standards

MONITORING PROCEDURES:
1. Real-time transaction analysis
2. Pattern recognition and anomaly detection
3. Risk scoring and alert generation
4. Manual review of flagged transactions
5. Investigation and documentation
6. Suspicious Activity Report (SAR) filing if required

REPORTING REQUIREMENTS:
- Suspicious transactions must be reported to FIU within 10 business days
- All investigations must be documented with supporting evidence
- Reports must include detailed analysis and conclusions
- Maintain confidentiality of reporting (no customer notification)

COMPLIANCE SIGN-OFF: This task requires certification that monitoring has been conducted in accordance with all regulatory requirements.
      `,

      REGULATORY_COMPLIANCE_REVIEW: `
COMPLIANCE TASK: REGULATORY COMPLIANCE REVIEW
==============================================

OBJECTIVE:
Conduct comprehensive review of compliance with all applicable regulatory requirements including AML/CFT laws, sanctions regulations, and customer due diligence standards. This review ensures organizational compliance with Federal Decree-Law No. 20/2018 and related regulations.

SCOPE:
- Review all customer files for KYC/CDD completeness
- Verify sanctions screening has been conducted
- Confirm transaction monitoring is functioning
- Review SAR/STR filing procedures
- Assess staff training and awareness
- Evaluate compliance infrastructure and controls
- Identify gaps and remediation requirements

REGULATORY FRAMEWORK:
- Federal Decree-Law No. 20/2018 (AML/CFT Law)
- Cabinet Resolution 134/2025 (Enhanced Requirements)
- Cabinet Resolution 74/2020 (Sanctions)
- FATF Recommendations (10, 11, 12, 18-22)
- Central Bank of UAE Guidelines
- UAE Ministry of Economy Circulars

REVIEW PROCEDURES:
1. Sample testing of customer files (minimum 50 files)
2. Verification of KYC documentation completeness
3. Confirmation of sanctions screening
4. Review of transaction monitoring alerts
5. Assessment of SAR/STR filing procedures
6. Staff interview and training verification
7. System and control testing

DOCUMENTATION REQUIREMENTS:
- Compliance review report with findings
- Gap analysis and remediation plan
- Evidence of testing and verification
- Staff training records
- System audit logs
- Regulatory correspondence

TIMELINE: Quarterly minimum, with annual comprehensive review
RESPONSIBLE PARTY: Compliance Manager / Internal Audit
ESCALATION: Material compliance gaps must be reported to Board within 5 business days

COMPLIANCE CERTIFICATION: This review must be formally certified by authorized compliance personnel and approved by senior management.
      `,

      CUSTOMER_RISK_ASSESSMENT: `
COMPLIANCE TASK: CUSTOMER RISK ASSESSMENT AND CLASSIFICATION
=============================================================

OBJECTIVE:
Conduct comprehensive risk assessment for each customer to determine appropriate due diligence level and ongoing monitoring requirements. Risk classification must be based on objective criteria and documented in compliance system.

SCOPE:
- Assess customer profile and background
- Evaluate occupation and source of funds
- Analyze transaction patterns and behavior
- Determine geographic risk factors
- Identify beneficial ownership structures
- Classify customer into risk category
- Establish ongoing monitoring requirements

RISK ASSESSMENT FACTORS:
1. Customer Type: Individual, Corporate, High-Risk Entity
2. Occupation: Professional, Business, High-Risk Industry
3. Geographic: Domicile, Transaction Destinations, High-Risk Countries
4. Financial: Transaction Volume, Velocity, Complexity
5. Behavioral: Pattern Consistency, Anomalies, Red Flags
6. Beneficial Ownership: Transparency, Complexity, Hidden Interests

RISK CATEGORIES:
- LOW RISK: Standard KYC, Annual Review
- MEDIUM RISK: Enhanced KYC, Quarterly Review
- HIGH RISK: Enhanced Due Diligence, Monthly Review
- CRITICAL RISK: Escalation, Potential Rejection

ENHANCED DUE DILIGENCE (HIGH RISK):
- Verify source of funds with supporting documentation
- Conduct enhanced background checks
- Obtain additional references
- Perform enhanced ongoing monitoring
- Document enhanced due diligence procedures

REGULATORY REQUIREMENTS:
- FDL No. 20/2018 Article 5: Risk-Based Approach
- FATF Recommendation 10: Enhanced Due Diligence
- Cabinet Resolution 134/2025: Risk Assessment Standards
- Central Bank of UAE Guidelines: Risk Classification

DOCUMENTATION:
- Risk Assessment Form (completed and signed)
- Supporting documentation and evidence
- Risk Classification Decision
- Ongoing Monitoring Plan
- Audit Trail

APPROVAL AUTHORITY: Compliance Officer / Risk Committee
REVIEW FREQUENCY: Annual minimum, or upon material change in customer profile

COMPLIANCE CERTIFICATION: Risk assessment must be formally documented and approved before customer account activation.
      `,
    };

    return narrations[taskType] || narrations.REGULATORY_COMPLIANCE_REVIEW;
  }

  /**
   * Create Asana task with formal narration
   */
  async createAsanaTask(taskData) {
    try {
      const narration = this.generateComplianceNarration(taskData.type, taskData.details);

      const task = await this.asanaClient.tasks.create({
        workspace: this.workspaceId,
        name: taskData.name,
        notes: narration,
        priority: taskData.priority || 'high',
        due_on: taskData.dueDate,
        assignee: taskData.assignee,
        custom_fields: {
          'Compliance Category': taskData.type,
          'Regulatory Reference': taskData.regulatory || 'FDL No. 20/2018',
          'Task Type': 'COMPLIANCE',
          'Narration Type': 'FORMAL_HUMANIZED',
        },
      });

      this.tasks.push(task);
      console.log(`[Asana] ✅ Task created: ${task.gid} - ${taskData.name}`);
      return task;
    } catch (error) {
      console.error(`[Asana] ❌ Error creating task: ${error.message}`);
      return null;
    }
  }

  /**
   * Create all pending compliance tasks
   */
  async createAllComplianceTasks() {
    console.log('\n📋 CREATING COMPLIANCE TASKS IN ASANA\n');

    const complianceTasks = [
      {
        name: '🔍 KYC Verification - New Customer Onboarding',
        type: 'KYC_VERIFICATION',
        priority: 'high',
        dueDate: '2026-05-15',
        regulatory: 'FDL No. 20/2018 Article 5',
      },
      {
        name: '🚨 Sanctions List Screening - OFAC/UN/EU/UAE',
        type: 'SANCTIONS_SCREENING',
        priority: 'urgent',
        dueDate: '2026-05-10',
        regulatory: 'Cabinet Resolution 74/2020',
      },
      {
        name: '💰 AML Transaction Monitoring - Pattern Detection',
        type: 'AML_TRANSACTION_MONITORING',
        priority: 'high',
        dueDate: '2026-05-20',
        regulatory: 'FDL No. 20/2018 Article 20',
      },
      {
        name: '📊 Regulatory Compliance Review - Quarterly Assessment',
        type: 'REGULATORY_COMPLIANCE_REVIEW',
        priority: 'high',
        dueDate: '2026-05-31',
        regulatory: 'FDL No. 20/2018 & Cabinet Resolution 134/2025',
      },
      {
        name: '⚖️ Customer Risk Assessment - Risk Classification',
        type: 'CUSTOMER_RISK_ASSESSMENT',
        priority: 'high',
        dueDate: '2026-05-25',
        regulatory: 'FATF Recommendation 10',
      },
    ];

    for (const taskData of complianceTasks) {
      await this.createAsanaTask(taskData);
    }

    console.log(`\n✅ Total tasks created: ${this.tasks.length}\n`);
    return this.tasks;
  }

  /**
   * Get task statistics
   */
  getTaskStatistics() {
    return {
      totalTasks: this.tasks.length,
      urgentTasks: this.tasks.filter(t => t.priority === 'urgent').length,
      highPriorityTasks: this.tasks.filter(t => t.priority === 'high').length,
      tasksCreated: new Date().toISOString(),
    };
  }
}

module.exports = AsanaTaskGenerator;
