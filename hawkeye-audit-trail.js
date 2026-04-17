/**
 * Hawkeye Sterling V2 - Audit Trail & Evidence Management
 * TIER 3: Comprehensive compliance documentation and audit trails
 * Auto-creates Asana tasks for audit events
 */

class AuditTrailEngine {
  constructor(asanaClient, config = {}) {
    this.asanaClient = asanaClient;
    this.workspaceId = '1213645083721316';
    this.config = config;
    this.auditLog = [];
  }

  /**
   * Log compliance event
   */
  async logEvent(event) {
    const auditEntry = {
      id: `AUDIT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      eventType: event.type,
      actor: event.actor,
      action: event.action,
      entity: event.entity,
      entityId: event.entityId,
      changes: event.changes,
      status: event.status,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      evidence: event.evidence,
      regulatory: event.regulatory,
    };

    this.auditLog.push(auditEntry);

    // Create Asana task for critical events
    if (event.type === 'CRITICAL' || event.type === 'VIOLATION') {
      await this.createAuditEventTask(auditEntry);
    }

    return auditEntry;
  }

  /**
   * Log KYC event
   */
  async logKYCEvent(customerId, action, status, evidence) {
    return this.logEvent({
      type: 'KYC',
      actor: 'Compliance Officer',
      action,
      entity: 'Customer',
      entityId: customerId,
      status,
      evidence,
      regulatory: 'FDL Art.5, FATF Rec.10',
    });
  }

  /**
   * Log CDD event
   */
  async logCDDEvent(entityId, action, status, evidence) {
    return this.logEvent({
      type: 'CDD',
      actor: 'Compliance Officer',
      action,
      entity: 'Entity',
      entityId,
      status,
      evidence,
      regulatory: 'FDL Art.5, FATF Rec.10',
    });
  }

  /**
   * Log STR filing event
   */
  async logSTRFilingEvent(transactionId, status, filingNumber, evidence) {
    return this.logEvent({
      type: 'STR_FILING',
      actor: 'Compliance Officer',
      action: 'File Suspicious Transaction Report',
      entity: 'Transaction',
      entityId: transactionId,
      status,
      changes: { filingNumber },
      evidence,
      regulatory: 'FDL Art.20, FATF Rec.19',
    });
  }

  /**
   * Log sanctions screening event
   */
  async logSanctionsEvent(entityId, action, result, evidence) {
    return this.logEvent({
      type: 'SANCTIONS_SCREENING',
      actor: 'System',
      action,
      entity: 'Individual/Entity',
      entityId,
      status: result.overallRisk,
      changes: { matches: result.matches.length },
      evidence,
      regulatory: 'Cabinet Resolution 74/2020',
    });
  }

  /**
   * Log transaction event
   */
  async logTransactionEvent(transactionId, action, status, amount, evidence) {
    return this.logEvent({
      type: 'TRANSACTION',
      actor: 'System',
      action,
      entity: 'Transaction',
      entityId: transactionId,
      status,
      changes: { amount },
      evidence,
      regulatory: 'FDL Art.1, FATF Rec.10',
    });
  }

  /**
   * Log compliance violation
   */
  async logViolation(violationType, severity, description, evidence) {
    return this.logEvent({
      type: 'CRITICAL',
      actor: 'System',
      action: 'Compliance Violation Detected',
      entity: 'Compliance',
      entityId: `VIOLATION-${Date.now()}`,
      status: severity,
      changes: { violationType, description },
      evidence,
      regulatory: 'Multiple',
    });
  }

  /**
   * Create Asana task for audit event
   */
  async createAuditEventTask(auditEntry) {
    try {
      const taskName = `📋 Audit Event: ${auditEntry.eventType} - ${auditEntry.action}`;

      const taskDescription = `
AUDIT TRAIL EVENT
=================

Event ID: ${auditEntry.id}
Timestamp: ${auditEntry.timestamp}
Event Type: ${auditEntry.eventType}
Actor: ${auditEntry.actor}

Action: ${auditEntry.action}
Entity: ${auditEntry.entity}
Entity ID: ${auditEntry.entityId}
Status: ${auditEntry.status}

CHANGES:
${Object.entries(auditEntry.changes || {}).map(([key, value]) => 
  `- ${key}: ${JSON.stringify(value)}`
).join('\n')}

EVIDENCE:
${auditEntry.evidence ? JSON.stringify(auditEntry.evidence, null, 2) : 'No evidence attached'}

REGULATORY REFERENCE:
${auditEntry.regulatory}

IP ADDRESS: ${auditEntry.ipAddress || 'N/A'}
USER AGENT: ${auditEntry.userAgent || 'N/A'}

ACTIONS REQUIRED:
1. Review audit event
2. Verify compliance
3. Document findings
4. Archive evidence
      `;

      const task = await this.asanaClient.tasks.create({
        workspace: this.workspaceId,
        name: taskName,
        notes: taskDescription,
        custom_fields: {
          'Event Type': auditEntry.eventType,
          'Event ID': auditEntry.id,
          'Status': auditEntry.status,
        },
      });

      console.log(`[Audit Trail] ✅ Audit event task created: ${task.gid}`);
      return task.gid;
    } catch (error) {
      console.error('[Audit Trail] Error creating audit task:', error);
      return null;
    }
  }

  /**
   * Store evidence file
   */
  async storeEvidence(eventId, fileName, fileContent, fileType) {
    const evidence = {
      id: `EVIDENCE-${Date.now()}`,
      eventId,
      fileName,
      fileType,
      size: fileContent.length,
      hash: this.hashContent(fileContent),
      uploadedAt: new Date().toISOString(),
      status: 'STORED',
    };

    // In production: Store file in secure storage (S3, Azure Blob, etc.)
    console.log(`[Audit Trail] 💾 Evidence stored: ${evidence.id}`);

    return evidence;
  }

  /**
   * Hash content for integrity verification
   */
  hashContent(content) {
    // In production: Use proper cryptographic hash (SHA-256)
    return `HASH-${Date.now()}`;
  }

  /**
   * Generate audit report
   */
  async generateAuditReport(dateRange) {
    const report = {
      generatedAt: new Date().toISOString(),
      dateRange,
      totalEvents: this.auditLog.length,
      eventsByType: {},
      eventsByStatus: {},
      criticalEvents: [],
      violations: [],
    };

    // Categorize events
    for (const event of this.auditLog) {
      // By type
      if (!report.eventsByType[event.eventType]) {
        report.eventsByType[event.eventType] = 0;
      }
      report.eventsByType[event.eventType]++;

      // By status
      if (!report.eventsByStatus[event.status]) {
        report.eventsByStatus[event.status] = 0;
      }
      report.eventsByStatus[event.status]++;

      // Critical events
      if (event.type === 'CRITICAL') {
        report.criticalEvents.push(event);
      }

      // Violations
      if (event.type === 'VIOLATION') {
        report.violations.push(event);
      }
    }

    return report;
  }

  /**
   * Export audit trail
   */
  async exportAuditTrail(format = 'json', dateRange = null) {
    let events = this.auditLog;

    if (dateRange) {
      const startDate = new Date(dateRange.start);
      const endDate = new Date(dateRange.end);
      events = events.filter(e => {
        const eventDate = new Date(e.timestamp);
        return eventDate >= startDate && eventDate <= endDate;
      });
    }

    if (format === 'csv') {
      return this.exportAsCSV(events);
    } else if (format === 'json') {
      return JSON.stringify(events, null, 2);
    } else if (format === 'pdf') {
      return this.exportAsPDF(events);
    }

    return events;
  }

  /**
   * Export as CSV
   */
  exportAsCSV(events) {
    const headers = [
      'Event ID',
      'Timestamp',
      'Event Type',
      'Actor',
      'Action',
      'Entity',
      'Entity ID',
      'Status',
      'Regulatory Reference',
    ];

    const rows = events.map(e => [
      e.id,
      e.timestamp,
      e.eventType,
      e.actor,
      e.action,
      e.entity,
      e.entityId,
      e.status,
      e.regulatory,
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    return csv;
  }

  /**
   * Export as PDF
   */
  exportAsPDF(events) {
    // In production: Use PDF library (pdfkit, puppeteer, etc.)
    return `PDF Export: ${events.length} events`;
  }

  /**
   * Search audit log
   */
  searchAuditLog(criteria) {
    return this.auditLog.filter(event => {
      if (criteria.eventType && event.eventType !== criteria.eventType) return false;
      if (criteria.entityId && event.entityId !== criteria.entityId) return false;
      if (criteria.actor && event.actor !== criteria.actor) return false;
      if (criteria.status && event.status !== criteria.status) return false;

      if (criteria.dateRange) {
        const eventDate = new Date(event.timestamp);
        const startDate = new Date(criteria.dateRange.start);
        const endDate = new Date(criteria.dateRange.end);
        if (eventDate < startDate || eventDate > endDate) return false;
      }

      return true;
    });
  }

  /**
   * Get audit statistics
   */
  getAuditStatistics() {
    return {
      totalEvents: this.auditLog.length,
      eventsByType: Object.keys(this.auditLog.reduce((acc, e) => {
        acc[e.eventType] = (acc[e.eventType] || 0) + 1;
        return acc;
      }, {})),
      criticalEventsCount: this.auditLog.filter(e => e.type === 'CRITICAL').length,
      violationsCount: this.auditLog.filter(e => e.type === 'VIOLATION').length,
      lastEventDate: this.auditLog.length > 0 ? this.auditLog[this.auditLog.length - 1].timestamp : null,
    };
  }

  /**
   * Archive audit trail
   */
  async archiveAuditTrail(dateRange) {
    const events = this.searchAuditLog({ dateRange });
    
    // In production: Archive to long-term storage
    console.log(`[Audit Trail] 📦 Archived ${events.length} events`);

    return {
      archivedCount: events.length,
      archiveDate: new Date().toISOString(),
      retentionPeriod: '7 years',
    };
  }
}

module.exports = AuditTrailEngine;
