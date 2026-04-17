/**
 * PHASE 2: AUTOMATED TASK CREATION PIPELINE
 * Unified service for creating Asana tasks from findings with formal narrations
 * 
 * TARGET: 100% automation, zero manual task creation
 */

const logger = require('./logger-service');
const tracer = require('./tracer-service');
const metrics = require('./metrics-service');

class TaskCreationService {
  constructor(asanaSyncEngine, config = {}) {
    this.asanaSyncEngine = asanaSyncEngine;
    this.config = {
      defaultProjectId: config.defaultProjectId || process.env.ASANA_DEFAULT_PROJECT_ID,
      ...config,
    };

    this.taskTemplates = this.initializeTemplates();
  }

  /**
   * Initialize formal task templates
   */
  initializeTemplates() {
    return {
      STR: {
        prefix: '🔴 STR',
        category: 'Suspicious Transaction Report',
        template: this.createSTRTemplate.bind(this),
      },
      KYC: {
        prefix: '🟠 KYC',
        category: 'Know Your Customer',
        template: this.createKYCTemplate.bind(this),
      },
      CDD: {
        prefix: '🟠 CDD',
        category: 'Customer Due Diligence',
        template: this.createCDDTemplate.bind(this),
      },
      Sanctions: {
        prefix: '🔴 SANCTIONS',
        category: 'Sanctions Screening Match',
        template: this.createSanctionsTemplate.bind(this),
      },
      AML: {
        prefix: '🟡 AML',
        category: 'Anti-Money Laundering',
        template: this.createAMLTemplate.bind(this),
      },
      Incident: {
        prefix: '🔴 INCIDENT',
        category: 'Compliance Incident',
        template: this.createIncidentTemplate.bind(this),
      },
    };
  }

  /**
   * Create task from finding
   */
  async createTaskFromFinding(finding) {
    const span = tracer.startSpan('create_task_from_finding', { 'finding.id': finding.id });

    try {
      logger.info('Creating task from finding', {
        findingId: finding.id,
        findingType: finding.type,
        riskLevel: finding.riskLevel,
      });

      // Validate finding
      this.validateFinding(finding);

      // Generate formal narration
      const narration = await this.generateFormalNarration(finding);

      // Create task data
      const taskData = {
        name: this.generateTaskName(finding),
        description: narration,
        projectId: finding.projectId || this.config.defaultProjectId,
        priority: this.mapRiskToPriority(finding.riskLevel),
        dueDate: this.calculateDueDate(finding),
        customFields: {
          system_id: finding.id,
          finding_type: finding.type,
          risk_level: finding.riskLevel,
          created_by: 'system',
          created_timestamp: new Date().toISOString(),
        },
      };

      // Create task in Asana
      const task = await this.asanaSyncEngine.createTaskFromFinding({
        ...finding,
        ...taskData,
      });

      logger.info('Task created successfully', {
        findingId: finding.id,
        taskId: task.gid,
      });

      metrics.increment('task.creation.success', 1);
      span.setTag('task_id', task.gid);
      span.finish();

      return {
        success: true,
        taskId: task.gid,
        findingId: finding.id,
        narration,
      };
    } catch (error) {
      logger.error('Task creation failed', {
        findingId: finding.id,
        error: error.message,
      });
      metrics.increment('task.creation.errors', 1);
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * Generate formal compliance narration
   */
  async generateFormalNarration(finding) {
    const span = tracer.startSpan('generate_formal_narration');

    try {
      const template = this.taskTemplates[finding.type];
      if (!template) {
        throw new Error(`No template for finding type: ${finding.type}`);
      }

      const narration = await template.template(finding);

      logger.info('Formal narration generated', {
        findingId: finding.id,
        length: narration.length,
      });

      span.finish();
      return narration;
    } catch (error) {
      logger.error('Narration generation failed', { error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * Create STR template
   */
  async createSTRTemplate(finding) {
    return `
# Suspicious Transaction Report (STR) - Compliance Task

## Executive Summary
A suspicious transaction has been identified requiring immediate investigation and reporting in accordance with regulatory requirements.

## Finding Details
- **Finding ID:** ${finding.id}
- **Transaction ID:** ${finding.transactionId || 'N/A'}
- **Customer Name:** ${finding.customerName || 'N/A'}
- **Transaction Amount:** ${finding.amount || 'N/A'}
- **Transaction Date:** ${finding.transactionDate || 'N/A'}
- **Detection Date:** ${new Date().toISOString()}

## Suspicious Indicators
${finding.indicators?.map(i => `- ${i}`).join('\n') || '- Transaction pattern inconsistent with customer profile'}

## Risk Assessment
- **Risk Level:** ${finding.riskLevel}
- **Risk Score:** ${finding.riskScore || 'N/A'}
- **Confidence Level:** ${finding.confidence || 'N/A'}%

## Regulatory Context
This matter falls under the purview of:
- Federal Decree-Law No. 20/2018 (UAE AML Law)
- FATF Recommendations on Money Laundering and Terrorist Financing
- Applicable Cabinet Resolutions

## Required Actions
1. **Investigation:** Conduct thorough investigation of transaction source and destination
2. **Documentation:** Gather supporting evidence and documentation
3. **Analysis:** Analyze customer profile and transaction history
4. **Reporting:** Prepare STR filing if warranted
5. **Escalation:** Escalate to compliance officer for final determination

## Evidence
${finding.evidence || 'Evidence to be attached separately'}

## Recommended Next Steps
${finding.recommendedAction || 'Initiate formal investigation protocol'}

## Compliance Notes
- This task must be completed within regulatory timeframes
- All documentation must be retained for audit purposes
- Confidentiality must be maintained throughout investigation
- Escalation to FIU may be required based on findings

**Task Created:** ${new Date().toISOString()}
**Created By:** Compliance Intelligence System
    `.trim();
  }

  /**
   * Create KYC template
   */
  async createKYCTemplate(finding) {
    return `
# Know Your Customer (KYC) - Compliance Task

## Executive Summary
A KYC verification issue has been identified requiring immediate remediation.

## Customer Information
- **Customer ID:** ${finding.customerId || 'N/A'}
- **Customer Name:** ${finding.customerName || 'N/A'}
- **Account Number:** ${finding.accountNumber || 'N/A'}
- **Onboarding Date:** ${finding.onboardingDate || 'N/A'}

## KYC Deficiency
- **Issue:** ${finding.issue || 'N/A'}
- **Missing Information:** ${finding.missingInfo || 'N/A'}
- **Risk Level:** ${finding.riskLevel}

## Regulatory Requirements
- Federal Decree-Law No. 20/2018 (UAE AML Law)
- FATF Recommendation 10 (Customer Due Diligence)
- Applicable regulatory guidelines

## Remediation Steps
1. **Contact Customer:** Reach out to customer for missing information
2. **Collect Documents:** Obtain required identification and verification documents
3. **Verify Information:** Conduct independent verification
4. **Update Records:** Update customer profile with verified information
5. **Document:** Maintain audit trail of remediation process

## Deadline
- **Compliance Deadline:** ${this.calculateDueDate(finding)}
- **Escalation Threshold:** 3 days before deadline

## Notes
- Customer communication log must be maintained
- All documentation must be filed appropriately
- Escalate if customer does not respond within 5 business days

**Task Created:** ${new Date().toISOString()}
**Created By:** Compliance Intelligence System
    `.trim();
  }

  /**
   * Create CDD template
   */
  async createCDDTemplate(finding) {
    return `
# Customer Due Diligence (CDD) - Compliance Task

## Executive Summary
Enhanced customer due diligence is required for this customer.

## Customer Details
- **Customer ID:** ${finding.customerId || 'N/A'}
- **Customer Name:** ${finding.customerName || 'N/A'}
- **Risk Category:** ${finding.riskCategory || 'N/A'}
- **CDD Trigger:** ${finding.cddTrigger || 'N/A'}

## CDD Requirements
${finding.cddRequirements?.map(r => `- ${r}`).join('\n') || '- Enhanced verification'}

## Investigation Scope
- Business activities and sources of funds
- Beneficial ownership structure
- Geographic risk assessment
- Transaction pattern analysis
- Sanctions and PEP screening

## Regulatory Framework
- Federal Decree-Law No. 20/2018
- FATF Recommendations 12-17
- Applicable regulatory guidelines

## Action Items
1. **Gather Information:** Collect comprehensive customer information
2. **Conduct Research:** Perform background and source of funds investigation
3. **Document Findings:** Prepare detailed CDD report
4. **Risk Assessment:** Determine appropriate risk rating
5. **Approval:** Obtain compliance officer approval

## Timeline
- **Completion Deadline:** ${this.calculateDueDate(finding)}
- **Review Deadline:** ${this.calculateReviewDate(finding)}

**Task Created:** ${new Date().toISOString()}
**Created By:** Compliance Intelligence System
    `.trim();
  }

  /**
   * Create Sanctions template
   */
  async createSanctionsTemplate(finding) {
    return `
# Sanctions Screening Match - Compliance Task

## URGENT: POTENTIAL SANCTIONS MATCH DETECTED

## Match Details
- **Match ID:** ${finding.matchId || 'N/A'}
- **Match Confidence:** ${finding.confidence || 'N/A'}%
- **Matched Name:** ${finding.matchedName || 'N/A'}
- **Sanctions List:** ${finding.sanctionsList || 'N/A'}

## Customer Information
- **Customer ID:** ${finding.customerId || 'N/A'}
- **Customer Name:** ${finding.customerName || 'N/A'}
- **Account Status:** ${finding.accountStatus || 'N/A'}

## Sanctions Lists Checked
- OFAC SDN List
- UN Security Council Lists
- EU Sanctions Lists
- UAE Sanctions Lists

## Immediate Actions Required
1. **BLOCK ACCOUNT:** Immediately block all transactions
2. **ESCALATE:** Escalate to senior compliance officer
3. **INVESTIGATE:** Conduct thorough name matching investigation
4. **DOCUMENT:** Document all findings and actions taken
5. **REPORT:** File required reports if match is confirmed

## Investigation Checklist
- [ ] Verify customer identity documentation
- [ ] Compare with sanctions list records
- [ ] Check alternative spellings and variations
- [ ] Research customer background
- [ ] Determine false positive likelihood

## Regulatory Obligations
- Federal Decree-Law No. 20/2018
- OFAC Regulations
- UN Security Council Resolutions
- EU Sanctions Regulations

## Timeline
- **Immediate Action:** Within 1 hour
- **Initial Investigation:** Within 24 hours
- **Final Determination:** Within 5 business days

## Escalation
**This matter requires IMMEDIATE ESCALATION to:**
- Compliance Officer
- Risk Management
- Legal Department

**CRITICAL PRIORITY - DO NOT DELAY**

**Task Created:** ${new Date().toISOString()}
**Created By:** Compliance Intelligence System
    `.trim();
  }

  /**
   * Create AML template
   */
  async createAMLTemplate(finding) {
    return `
# Anti-Money Laundering (AML) - Compliance Task

## Executive Summary
An AML concern has been identified requiring investigation and documentation.

## Finding Details
- **Finding ID:** ${finding.id}
- **Finding Type:** ${finding.type}
- **Risk Level:** ${finding.riskLevel}
- **Detection Date:** ${new Date().toISOString()}

## AML Concern
${finding.concern || 'Potential money laundering activity detected'}

## Investigation Parameters
- **Customer Profile:** ${finding.customerProfile || 'N/A'}
- **Transaction Pattern:** ${finding.transactionPattern || 'N/A'}
- **Geographic Risk:** ${finding.geographicRisk || 'N/A'}
- **Beneficial Ownership:** ${finding.beneficialOwnership || 'N/A'}

## Regulatory Framework
- Federal Decree-Law No. 20/2018 (UAE AML Law)
- FATF Recommendations 1-40
- Applicable regulatory guidelines

## Investigation Steps
1. **Analyze Transactions:** Review transaction history and patterns
2. **Customer Research:** Conduct background investigation
3. **Source of Funds:** Verify legitimate source of funds
4. **Documentation:** Gather supporting evidence
5. **Determination:** Make final AML assessment

## Reporting Obligations
- If confirmed: File STR with FIU
- If unconfirmed: Document investigation and close
- Maintain audit trail for regulatory review

## Timeline
- **Investigation Period:** ${this.calculateDueDate(finding)}
- **Reporting Deadline:** 10 business days if STR required

**Task Created:** ${new Date().toISOString()}
**Created By:** Compliance Intelligence System
    `.trim();
  }

  /**
   * Create Incident template
   */
  async createIncidentTemplate(finding) {
    return `
# Compliance Incident - Urgent Response Required

## INCIDENT ALERT

## Incident Details
- **Incident ID:** ${finding.id}
- **Incident Type:** ${finding.incidentType || 'N/A'}
- **Severity:** ${finding.riskLevel}
- **Detection Time:** ${new Date().toISOString()}

## Incident Description
${finding.description || 'Compliance incident detected'}

## Immediate Response Required
1. **Contain:** Prevent further impact
2. **Assess:** Determine scope and severity
3. **Notify:** Escalate to management
4. **Investigate:** Conduct root cause analysis
5. **Remediate:** Implement corrective actions

## Regulatory Implications
- Potential regulatory breach
- Reporting obligations may apply
- Documentation required for audit trail

## Investigation Scope
- Root cause analysis
- Impact assessment
- Remediation plan
- Prevention measures

## Escalation Path
1. Immediate: Compliance Officer
2. 1 Hour: Risk Management
3. 2 Hours: Senior Management
4. 4 Hours: Board/Executive Committee (if critical)

## Timeline
- **Immediate Action:** Now
- **Initial Assessment:** 2 hours
- **Investigation:** 24 hours
- **Remediation Plan:** 48 hours
- **Implementation:** 5 business days

## Critical Success Factors
- Rapid response
- Thorough investigation
- Effective remediation
- Regulatory compliance
- Documentation completeness

**INCIDENT PRIORITY: CRITICAL**

**Task Created:** ${new Date().toISOString()}
**Created By:** Compliance Intelligence System
    `.trim();
  }

  /**
   * Validate finding
   */
  validateFinding(finding) {
    if (!finding.id) throw new Error('Finding ID is required');
    if (!finding.type) throw new Error('Finding type is required');
    if (!finding.riskLevel) throw new Error('Risk level is required');
    if (!finding.title) throw new Error('Finding title is required');
  }

  /**
   * Generate task name
   */
  generateTaskName(finding) {
    const template = this.taskTemplates[finding.type];
    const prefix = template?.prefix || finding.type;
    return `${prefix}: ${finding.title}`;
  }

  /**
   * Map risk to priority
   */
  mapRiskToPriority(riskLevel) {
    const mapping = {
      'Critical': 'urgent',
      'High': 'high',
      'Medium': 'normal',
      'Low': 'low',
    };
    return mapping[riskLevel] || 'normal';
  }

  /**
   * Calculate due date
   */
  calculateDueDate(finding) {
    const daysMap = {
      'Critical': 1,
      'High': 3,
      'Medium': 7,
      'Low': 14,
    };
    const days = daysMap[finding.riskLevel] || 7;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + days);
    return dueDate.toISOString().split('T')[0];
  }

  /**
   * Calculate review date
   */
  calculateReviewDate(finding) {
    const daysMap = {
      'Critical': 0.5,
      'High': 1,
      'Medium': 3,
      'Low': 7,
    };
    const days = daysMap[finding.riskLevel] || 3;
    const reviewDate = new Date();
    reviewDate.setDate(reviewDate.getDate() + days);
    return reviewDate.toISOString().split('T')[0];
  }
}

module.exports = TaskCreationService;
