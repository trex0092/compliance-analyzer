/**
 * Hawkeye Sterling V2 - Intelligent Case Management
 * TIER 3: Auto-route cases, prioritize investigations
 * Auto-creates Asana tasks for case management
 */

class CaseManagementEngine {
  constructor(asanaClient, config = {}) {
    this.asanaClient = asanaClient;
    this.workspaceId = '1213645083721316';
    this.config = config;
    this.cases = [];
    this.caseCounter = 0;
  }

  /**
   * Create compliance case
   */
  async createCase(caseData) {
    this.caseCounter++;

    const newCase = {
      id: `CASE-${this.caseCounter}-${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: 'OPEN',
      priority: this.calculatePriority(caseData),
      type: caseData.type, // STR, KYC_VIOLATION, SANCTIONS_MATCH, etc.
      title: caseData.title,
      description: caseData.description,
      entityId: caseData.entityId,
      entityName: caseData.entityName,
      assignedTo: await this.assignCase(caseData),
      findings: caseData.findings || [],
      evidence: [],
      timeline: [],
      status: 'OPEN',
      dueDate: this.calculateDueDate(caseData.priority),
      escalationLevel: this.calculateEscalationLevel(caseData),
    };

    this.cases.push(newCase);

    // Create Asana task for case
    await this.createCaseTask(newCase);

    return newCase;
  }

  /**
   * Calculate case priority
   */
  calculatePriority(caseData) {
    let priority = 0;

    // Risk score
    if (caseData.riskScore >= 80) priority += 40;
    else if (caseData.riskScore >= 70) priority += 30;
    else if (caseData.riskScore >= 50) priority += 20;

    // Case type
    if (caseData.type === 'SANCTIONS_MATCH') priority += 50;
    if (caseData.type === 'STR') priority += 40;
    if (caseData.type === 'KYC_VIOLATION') priority += 30;

    // Regulatory urgency
    if (caseData.regulatoryDeadline) priority += 20;

    // Escalation
    if (caseData.escalated) priority += 30;

    return Math.min(100, priority);
  }

  /**
   * Assign case to appropriate team member
   */
  async assignCase(caseData) {
    // In production: Use ML to assign based on expertise, workload, etc.
    const assignees = [
      { name: 'Luisa Fernanda', role: 'Compliance Officer', expertise: ['STR', 'KYC', 'AML'] },
      { name: 'Ahmed Al-Mansouri', role: 'Risk Manager', expertise: ['SANCTIONS', 'RISK'] },
      { name: 'Sarah Johnson', role: 'Compliance Analyst', expertise: ['CDD', 'MONITORING'] },
    ];

    // Simple assignment based on case type
    let assignee = assignees[0];
    
    if (caseData.type === 'SANCTIONS_MATCH') {
      assignee = assignees[1];
    } else if (caseData.type === 'CDD') {
      assignee = assignees[2];
    }

    return assignee.name;
  }

  /**
   * Calculate case due date
   */
  calculateDueDate(priority) {
    const now = new Date();
    let daysToAdd = 30;

    if (priority >= 80) daysToAdd = 3;
    else if (priority >= 70) daysToAdd = 7;
    else if (priority >= 50) daysToAdd = 14;

    now.setDate(now.getDate() + daysToAdd);
    return now.toISOString();
  }

  /**
   * Calculate escalation level
   */
  calculateEscalationLevel(caseData) {
    if (caseData.type === 'SANCTIONS_MATCH') return 'EXECUTIVE';
    if (caseData.riskScore >= 80) return 'SENIOR_MANAGEMENT';
    if (caseData.riskScore >= 70) return 'MANAGEMENT';
    return 'TEAM';
  }

  /**
   * Update case status
   */
  async updateCaseStatus(caseId, newStatus, notes) {
    const caseItem = this.cases.find(c => c.id === caseId);
    if (!caseItem) throw new Error('Case not found');

    const oldStatus = caseItem.status;
    caseItem.status = newStatus;
    caseItem.timeline.push({
      timestamp: new Date().toISOString(),
      action: `Status changed from ${oldStatus} to ${newStatus}`,
      notes,
    });

    // Create Asana task update
    await this.createCaseUpdateTask(caseItem, `Status: ${oldStatus} → ${newStatus}`);

    return caseItem;
  }

  /**
   * Add finding to case
   */
  async addFinding(caseId, finding) {
    const caseItem = this.cases.find(c => c.id === caseId);
    if (!caseItem) throw new Error('Case not found');

    caseItem.findings.push({
      id: `FINDING-${Date.now()}`,
      timestamp: new Date().toISOString(),
      ...finding,
    });

    caseItem.timeline.push({
      timestamp: new Date().toISOString(),
      action: 'Finding added',
      details: finding.description,
    });

    return caseItem;
  }

  /**
   * Add evidence to case
   */
  async addEvidence(caseId, evidence) {
    const caseItem = this.cases.find(c => c.id === caseId);
    if (!caseItem) throw new Error('Case not found');

    const evidenceItem = {
      id: `EVIDENCE-${Date.now()}`,
      timestamp: new Date().toISOString(),
      ...evidence,
    };

    caseItem.evidence.push(evidenceItem);

    caseItem.timeline.push({
      timestamp: new Date().toISOString(),
      action: 'Evidence added',
      details: evidence.description,
    });

    return caseItem;
  }

  /**
   * Close case
   */
  async closeCase(caseId, resolution, findings) {
    const caseItem = this.cases.find(c => c.id === caseId);
    if (!caseItem) throw new Error('Case not found');

    caseItem.status = 'CLOSED';
    caseItem.closedAt = new Date().toISOString();
    caseItem.resolution = resolution;
    caseItem.finalFindings = findings;

    caseItem.timeline.push({
      timestamp: new Date().toISOString(),
      action: 'Case closed',
      resolution,
    });

    // Create Asana task for case closure
    await this.createCaseClosureTask(caseItem);

    return caseItem;
  }

  /**
   * Create Asana task for case
   */
  async createCaseTask(caseItem) {
    try {
      const taskName = `🔍 Case: ${caseItem.title} [${caseItem.priority}% Priority]`;

      const taskDescription = `
COMPLIANCE CASE
===============

Case ID: ${caseItem.id}
Type: ${caseItem.type}
Status: ${caseItem.status}
Priority: ${caseItem.priority}%
Escalation Level: ${caseItem.escalationLevel}

Entity: ${caseItem.entityName}
Entity ID: ${caseItem.entityId}

Assigned To: ${caseItem.assignedTo}
Due Date: ${caseItem.dueDate}

DESCRIPTION:
${caseItem.description}

FINDINGS:
${caseItem.findings.map(f => `- ${f.description}`).join('\n') || 'No findings yet'}

EVIDENCE:
${caseItem.evidence.map(e => `- ${e.description}`).join('\n') || 'No evidence yet'}

TIMELINE:
${caseItem.timeline.map(t => `- ${t.timestamp}: ${t.action}`).join('\n')}

NEXT STEPS:
1. Review case details
2. Gather additional evidence
3. Conduct investigation
4. Document findings
5. Prepare report
6. Close case with resolution
      `;

      const task = await this.asanaClient.tasks.create({
        workspace: this.workspaceId,
        name: taskName,
        notes: taskDescription,
        assignee: this.getAsaneeId(caseItem.assignedTo),
        custom_fields: {
          'Case ID': caseItem.id,
          'Case Type': caseItem.type,
          'Priority': caseItem.priority,
          'Escalation': caseItem.escalationLevel,
        },
      });

      console.log(`[Case Management] ✅ Case task created: ${task.gid}`);
      return task.gid;
    } catch (error) {
      console.error('[Case Management] Error creating case task:', error);
      return null;
    }
  }

  /**
   * Create Asana task for case update
   */
  async createCaseUpdateTask(caseItem, update) {
    try {
      const taskName = `📝 Case Update: ${caseItem.title} - ${update}`;

      const task = await this.asanaClient.tasks.create({
        workspace: this.workspaceId,
        name: taskName,
        notes: `Case ID: ${caseItem.id}\nUpdate: ${update}\nStatus: ${caseItem.status}`,
        custom_fields: {
          'Case ID': caseItem.id,
          'Update Type': 'STATUS_CHANGE',
        },
      });

      console.log(`[Case Management] ✅ Case update task created: ${task.gid}`);
      return task.gid;
    } catch (error) {
      console.error('[Case Management] Error creating update task:', error);
      return null;
    }
  }

  /**
   * Create Asana task for case closure
   */
  async createCaseClosureTask(caseItem) {
    try {
      const taskName = `✅ Case Closed: ${caseItem.title} - ${caseItem.resolution}`;

      const taskDescription = `
CASE CLOSURE REPORT
===================

Case ID: ${caseItem.id}
Type: ${caseItem.type}
Closed At: ${caseItem.closedAt}

RESOLUTION: ${caseItem.resolution}

FINAL FINDINGS:
${caseItem.finalFindings || 'No findings'}

EVIDENCE SUMMARY:
Total Evidence Items: ${caseItem.evidence.length}
${caseItem.evidence.map(e => `- ${e.description}`).join('\n')}

CASE TIMELINE:
${caseItem.timeline.map(t => `- ${t.timestamp}: ${t.action}`).join('\n')}

ACTIONS COMPLETED:
✅ Investigation completed
✅ Evidence gathered
✅ Findings documented
✅ Case resolved
✅ Documentation archived
      `;

      const task = await this.asanaClient.tasks.create({
        workspace: this.workspaceId,
        name: taskName,
        notes: taskDescription,
        custom_fields: {
          'Case ID': caseItem.id,
          'Status': 'CLOSED',
          'Resolution': caseItem.resolution,
        },
      });

      console.log(`[Case Management] ✅ Case closure task created: ${task.gid}`);
      return task.gid;
    } catch (error) {
      console.error('[Case Management] Error creating closure task:', error);
      return null;
    }
  }

  /**
   * Get Asana user ID (placeholder)
   */
  getAsaneeId(assigneeName) {
    // In production: Map assignee names to Asana user IDs
    return null;
  }

  /**
   * Get open cases
   */
  getOpenCases() {
    return this.cases.filter(c => c.status === 'OPEN');
  }

  /**
   * Get cases by priority
   */
  getCasesByPriority() {
    return this.cases.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get case statistics
   */
  getCaseStatistics() {
    return {
      totalCases: this.cases.length,
      openCases: this.cases.filter(c => c.status === 'OPEN').length,
      closedCases: this.cases.filter(c => c.status === 'CLOSED').length,
      averagePriority: Math.round(this.cases.reduce((acc, c) => acc + c.priority, 0) / this.cases.length),
      casesByType: this.cases.reduce((acc, c) => {
        acc[c.type] = (acc[c.type] || 0) + 1;
        return acc;
      }, {}),
    };
  }
}

module.exports = CaseManagementEngine;
