/**
 * Hawkeye Sterling V2 - Regulatory Update Alerts
 * Auto-notify on new regulations and compliance changes
 * Auto-creates Asana tasks for regulatory updates
 */

class RegulatoryUpdateEngine {
  constructor(asanaClient, config = {}) {
    this.asanaClient = asanaClient;
    this.workspaceId = '1213645083721316';
    this.config = config;
    this.regulatoryUpdates = [];
    this.monitoringActive = false;
  }

  /**
   * Start monitoring for regulatory updates
   */
  async startMonitoring() {
    this.monitoringActive = true;
    console.log('[Regulatory Updates] ✅ Monitoring started');

    // Simulate checking for updates every 6 hours
    this.monitoringInterval = setInterval(async () => {
      await this.checkForUpdates();
    }, 6 * 60 * 60 * 1000);

    // Initial check
    await this.checkForUpdates();
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    this.monitoringActive = false;
    console.log('[Regulatory Updates] ✅ Monitoring stopped');
  }

  /**
   * Check for regulatory updates
   */
  async checkForUpdates() {
    const updates = await this.fetchRegulatoryUpdates();

    for (const update of updates) {
      // Check if already processed
      if (!this.regulatoryUpdates.find(u => u.id === update.id)) {
        this.regulatoryUpdates.push(update);

        // Create Asana task for significant updates
        if (update.severity === 'HIGH' || update.severity === 'CRITICAL') {
          await this.createRegulatoryUpdateTask(update);
        }
      }
    }

    return updates;
  }

  /**
   * Fetch regulatory updates (simulated)
   */
  async fetchRegulatoryUpdates() {
    return [
      {
        id: `UPDATE-${Date.now()}-1`,
        date: new Date().toISOString(),
        source: 'UAE Ministry of Finance',
        title: 'New Cabinet Resolution on AML Requirements',
        description: 'Enhanced KYC requirements for high-risk jurisdictions',
        severity: 'HIGH',
        effectiveDate: '2026-05-01',
        affectedAreas: ['KYC', 'CDD', 'PEP_SCREENING'],
        action: 'Update KYC procedures and checklists',
        regulatoryRef: 'Cabinet Resolution 2026/XX',
      },
      {
        id: `UPDATE-${Date.now()}-2`,
        date: new Date().toISOString(),
        source: 'FATF',
        title: 'Updated FATF Mutual Evaluation Report',
        description: 'New guidance on beneficial ownership verification',
        severity: 'MEDIUM',
        effectiveDate: '2026-06-01',
        affectedAreas: ['BENEFICIAL_OWNERSHIP', 'CDD'],
        action: 'Review and implement new guidance',
        regulatoryRef: 'FATF Recommendation 10',
      },
      {
        id: `UPDATE-${Date.now()}-3`,
        date: new Date().toISOString(),
        source: 'UN Security Council',
        title: 'Updated Sanctions List',
        description: 'New individuals and entities added to sanctions list',
        severity: 'CRITICAL',
        effectiveDate: 'IMMEDIATE',
        affectedAreas: ['SANCTIONS_SCREENING'],
        action: 'Update sanctions screening immediately',
        regulatoryRef: 'UN Security Council Resolution',
      },
    ];
  }

  /**
   * Create Asana task for regulatory update
   */
  async createRegulatoryUpdateTask(update) {
    try {
      const priorityMap = {
        'CRITICAL': 'urgent',
        'HIGH': 'high',
        'MEDIUM': 'medium',
        'LOW': 'low',
      };

      const taskName = `📋 REGULATORY UPDATE: ${update.title}`;

      const taskDescription = `
REGULATORY UPDATE NOTIFICATION
==============================

Source: ${update.source}
Date: ${update.date}
Severity: ${update.severity}

TITLE: ${update.title}

DESCRIPTION:
${update.description}

EFFECTIVE DATE: ${update.effectiveDate}

AFFECTED AREAS:
${update.affectedAreas.map(area => `- ${area}`).join('\n')}

REQUIRED ACTION:
${update.action}

REGULATORY REFERENCE:
${update.regulatoryRef}

COMPLIANCE STEPS:
1. Review regulatory update
2. Assess impact on current procedures
3. Identify required changes
4. Update policies and procedures
5. Train staff on changes
6. Document compliance
7. Implement changes by effective date
8. Verify implementation

DEADLINE: ${update.effectiveDate}
      `;

      const task = await this.asanaClient.tasks.create({
        workspace: this.workspaceId,
        name: taskName,
        notes: taskDescription,
        priority: priorityMap[update.severity] || 'medium',
        custom_fields: {
          'Update Type': 'REGULATORY',
          'Source': update.source,
          'Severity': update.severity,
          'Effective Date': update.effectiveDate,
        },
      });

      console.log(`[Regulatory Updates] ✅ Regulatory update task created: ${task.gid}`);
      return task.gid;
    } catch (error) {
      console.error('[Regulatory Updates] Error creating task:', error);
      return null;
    }
  }

  /**
   * Get regulatory updates by severity
   */
  getUpdatesBySeverity(severity) {
    return this.regulatoryUpdates.filter(u => u.severity === severity);
  }

  /**
   * Get pending updates (not yet effective)
   */
  getPendingUpdates() {
    const now = new Date();
    return this.regulatoryUpdates.filter(u => new Date(u.effectiveDate) > now);
  }

  /**
   * Get updates by affected area
   */
  getUpdatesByArea(area) {
    return this.regulatoryUpdates.filter(u => u.affectedAreas.includes(area));
  }

  /**
   * Generate regulatory update report
   */
  generateUpdateReport() {
    return {
      generatedAt: new Date().toISOString(),
      totalUpdates: this.regulatoryUpdates.length,
      criticalUpdates: this.getUpdatesBySeverity('CRITICAL').length,
      highUpdates: this.getUpdatesBySeverity('HIGH').length,
      mediumUpdates: this.getUpdatesBySeverity('MEDIUM').length,
      lowUpdates: this.getUpdatesBySeverity('LOW').length,
      pendingUpdates: this.getPendingUpdates().length,
      updatesBySource: this.groupBySource(),
      updatesByArea: this.groupByArea(),
      upcomingDeadlines: this.getUpcomingDeadlines(),
    };
  }

  /**
   * Group updates by source
   */
  groupBySource() {
    return this.regulatoryUpdates.reduce((acc, u) => {
      acc[u.source] = (acc[u.source] || 0) + 1;
      return acc;
    }, {});
  }

  /**
   * Group updates by affected area
   */
  groupByArea() {
    const grouped = {};
    for (const update of this.regulatoryUpdates) {
      for (const area of update.affectedAreas) {
        grouped[area] = (grouped[area] || 0) + 1;
      }
    }
    return grouped;
  }

  /**
   * Get upcoming deadlines
   */
  getUpcomingDeadlines() {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    return this.regulatoryUpdates
      .filter(u => {
        const effectiveDate = new Date(u.effectiveDate);
        return effectiveDate > now && effectiveDate <= thirtyDaysFromNow;
      })
      .sort((a, b) => new Date(a.effectiveDate) - new Date(b.effectiveDate));
  }

  /**
   * Export regulatory updates
   */
  exportUpdates(format = 'json') {
    if (format === 'csv') {
      return this.exportAsCSV();
    } else if (format === 'json') {
      return JSON.stringify(this.regulatoryUpdates, null, 2);
    }
    return this.regulatoryUpdates;
  }

  /**
   * Export as CSV
   */
  exportAsCSV() {
    const headers = [
      'Date',
      'Source',
      'Title',
      'Severity',
      'Effective Date',
      'Affected Areas',
      'Action',
    ];

    const rows = this.regulatoryUpdates.map(u => [
      u.date,
      u.source,
      u.title,
      u.severity,
      u.effectiveDate,
      u.affectedAreas.join('; '),
      u.action,
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    return csv;
  }
}

module.exports = RegulatoryUpdateEngine;
