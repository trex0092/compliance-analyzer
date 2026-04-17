/**
 * Hawkeye Sterling V2 - Incident Management System
 * Manage compliance incidents and violations
 */

class IncidentManagement {
  constructor() {
    this.incidents = [];
    this.investigations = [];
    this.remediations = [];
  }

  /**
   * Report incident
   */
  reportIncident(incidentData) {
    console.log(`\n🚨 INCIDENT REPORTED: ${incidentData.title}\n`);

    const incident = {
      id: `INC-${Date.now()}`,
      title: incidentData.title,
      description: incidentData.description,
      type: incidentData.type, // AML, KYC, SANCTIONS, REGULATORY, FRAUD, OTHER
      severity: incidentData.severity, // CRITICAL, HIGH, MEDIUM, LOW
      reportedBy: incidentData.reportedBy,
      reportedAt: new Date().toISOString(),
      status: 'OPEN',
      timeline: [
        {
          event: 'REPORTED',
          by: incidentData.reportedBy,
          at: new Date().toISOString(),
          notes: 'Incident reported',
        },
      ],
      investigation: null,
      remediation: null,
      documents: [],
      assignedTo: null,
    };

    this.incidents.push(incident);
    console.log(`✅ Incident created: ${incident.id}`);
    console.log(`   Type: ${incident.type}`);
    console.log(`   Severity: ${incident.severity}\n`);

    return incident;
  }

  /**
   * Start investigation
   */
  startInvestigation(incidentId, investigationData) {
    const incident = this.incidents.find(i => i.id === incidentId);

    if (!incident) {
      console.error('Incident not found');
      return null;
    }

    console.log(`\n🔍 STARTING INVESTIGATION: ${incidentId}\n`);

    const investigation = {
      id: `INV-${Date.now()}`,
      incidentId: incidentId,
      investigator: investigationData.investigator,
      startedAt: new Date().toISOString(),
      status: 'IN_PROGRESS',
      findings: [],
      rootCause: null,
      completedAt: null,
      timeline: [
        {
          event: 'INVESTIGATION_STARTED',
          by: investigationData.investigator,
          at: new Date().toISOString(),
        },
      ],
    };

    this.investigations.push(investigation);
    incident.investigation = investigation.id;
    incident.status = 'UNDER_INVESTIGATION';
    incident.assignedTo = investigationData.investigator;

    incident.timeline.push({
      event: 'INVESTIGATION_STARTED',
      by: investigationData.investigator,
      at: new Date().toISOString(),
      notes: 'Investigation initiated',
    });

    console.log(`✅ Investigation started: ${investigation.id}`);
    console.log(`   Investigator: ${investigation.investigator}\n`);

    return investigation;
  }

  /**
   * Add investigation finding
   */
  addFinding(investigationId, findingData) {
    const investigation = this.investigations.find(i => i.id === investigationId);

    if (!investigation) {
      console.error('Investigation not found');
      return null;
    }

    const finding = {
      id: `FIND-${Date.now()}`,
      title: findingData.title,
      description: findingData.description,
      severity: findingData.severity,
      evidence: findingData.evidence,
      addedAt: new Date().toISOString(),
      addedBy: findingData.addedBy,
    };

    investigation.findings.push(finding);

    console.log(`[Incident Management] ✅ Finding added: ${finding.title}`);
    return finding;
  }

  /**
   * Determine root cause
   */
  determineRootCause(investigationId, rootCauseData) {
    const investigation = this.investigations.find(i => i.id === investigationId);

    if (!investigation) {
      console.error('Investigation not found');
      return null;
    }

    investigation.rootCause = {
      description: rootCauseData.description,
      category: rootCauseData.category, // PROCESS, SYSTEM, HUMAN, EXTERNAL
      contributingFactors: rootCauseData.contributingFactors,
      determinedAt: new Date().toISOString(),
      determinedBy: rootCauseData.determinedBy,
    };

    investigation.timeline.push({
      event: 'ROOT_CAUSE_DETERMINED',
      by: rootCauseData.determinedBy,
      at: new Date().toISOString(),
    });

    console.log(`[Incident Management] ✅ Root cause determined: ${rootCauseData.category}`);
    return investigation.rootCause;
  }

  /**
   * Create remediation plan
   */
  createRemediationPlan(incidentId, remediationData) {
    const incident = this.incidents.find(i => i.id === incidentId);

    if (!incident) {
      console.error('Incident not found');
      return null;
    }

    console.log(`\n🔧 CREATING REMEDIATION PLAN: ${incidentId}\n`);

    const remediation = {
      id: `REM-${Date.now()}`,
      incidentId: incidentId,
      title: remediationData.title,
      description: remediationData.description,
      actions: remediationData.actions || [],
      timeline: remediationData.timeline,
      owner: remediationData.owner,
      status: 'PLANNED',
      createdAt: new Date().toISOString(),
      completionDate: remediationData.completionDate,
      progress: 0,
    };

    this.remediations.push(remediation);
    incident.remediation = remediation.id;
    incident.status = 'REMEDIATION_IN_PROGRESS';

    incident.timeline.push({
      event: 'REMEDIATION_PLAN_CREATED',
      by: remediationData.owner,
      at: new Date().toISOString(),
      notes: 'Remediation plan created',
    });

    console.log(`✅ Remediation plan created: ${remediation.id}`);
    console.log(`   Owner: ${remediation.owner}`);
    console.log(`   Actions: ${remediation.actions.length}`);
    console.log(`   Target completion: ${remediation.completionDate}\n`);

    return remediation;
  }

  /**
   * Track remediation progress
   */
  updateRemediationProgress(remediationId, progressData) {
    const remediation = this.remediations.find(r => r.id === remediationId);

    if (!remediation) {
      console.error('Remediation not found');
      return null;
    }

    remediation.progress = progressData.progress;
    remediation.completedActions = progressData.completedActions || [];
    remediation.lastUpdated = new Date().toISOString();
    remediation.updatedBy = progressData.updatedBy;

    if (remediation.progress === 100) {
      remediation.status = 'COMPLETED';
      remediation.completedAt = new Date().toISOString();
    }

    console.log(`[Incident Management] ✅ Remediation progress updated: ${remediation.progress}%`);
    return remediation;
  }

  /**
   * Close incident
   */
  closeIncident(incidentId, closureData) {
    const incident = this.incidents.find(i => i.id === incidentId);

    if (!incident) {
      console.error('Incident not found');
      return null;
    }

    incident.status = 'CLOSED';
    incident.closedAt = new Date().toISOString();
    incident.closedBy = closureData.closedBy;
    incident.closureNotes = closureData.notes;

    incident.timeline.push({
      event: 'INCIDENT_CLOSED',
      by: closureData.closedBy,
      at: new Date().toISOString(),
      notes: closureData.notes,
    });

    console.log(`[Incident Management] ✅ Incident closed: ${incidentId}`);
    return incident;
  }

  /**
   * Generate incident report
   */
  generateIncidentReport(incidentId) {
    const incident = this.incidents.find(i => i.id === incidentId);

    if (!incident) {
      console.error('Incident not found');
      return null;
    }

    const investigation = this.investigations.find(i => i.id === incident.investigation);
    const remediation = this.remediations.find(r => r.id === incident.remediation);

    console.log(`\n📋 INCIDENT REPORT: ${incident.id}\n`);
    console.log(`Title: ${incident.title}`);
    console.log(`Type: ${incident.type}`);
    console.log(`Severity: ${incident.severity}`);
    console.log(`Status: ${incident.status}`);
    console.log(`Reported: ${incident.reportedAt}`);

    if (investigation) {
      console.log(`\nInvestigation: ${investigation.id}`);
      console.log(`Findings: ${investigation.findings.length}`);
      if (investigation.rootCause) {
        console.log(`Root Cause: ${investigation.rootCause.category}`);
      }
    }

    if (remediation) {
      console.log(`\nRemediation: ${remediation.id}`);
      console.log(`Progress: ${remediation.progress}%`);
      console.log(`Target Completion: ${remediation.completionDate}`);
    }

    console.log();

    return {
      incident: incident,
      investigation: investigation,
      remediation: remediation,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get incident statistics
   */
  getIncidentStatistics() {
    return {
      totalIncidents: this.incidents.length,
      openIncidents: this.incidents.filter(i => i.status === 'OPEN').length,
      underInvestigation: this.incidents.filter(i => i.status === 'UNDER_INVESTIGATION').length,
      remediationInProgress: this.incidents.filter(i => i.status === 'REMEDIATION_IN_PROGRESS').length,
      closedIncidents: this.incidents.filter(i => i.status === 'CLOSED').length,
      bySeverity: {
        CRITICAL: this.incidents.filter(i => i.severity === 'CRITICAL').length,
        HIGH: this.incidents.filter(i => i.severity === 'HIGH').length,
        MEDIUM: this.incidents.filter(i => i.severity === 'MEDIUM').length,
        LOW: this.incidents.filter(i => i.severity === 'LOW').length,
      },
      byType: {
        AML: this.incidents.filter(i => i.type === 'AML').length,
        KYC: this.incidents.filter(i => i.type === 'KYC').length,
        SANCTIONS: this.incidents.filter(i => i.type === 'SANCTIONS').length,
        REGULATORY: this.incidents.filter(i => i.type === 'REGULATORY').length,
      },
    };
  }
}

module.exports = IncidentManagement;
