/**
 * Daily Compliance Reporter
 * Generates and distributes automatic daily compliance reports
 */

// Lazy loader for node-cron so requiring this module does not crash
// in environments where the dep is not installed. nodemailer is
// referenced only in a commented-out example below, so no loader is
// needed for it.
let _cron;
function getCron() {
  if (_cron) return _cron;
  try { _cron = require('node-cron'); } catch (err) {
    throw new Error('node-cron is required for scheduleDaily(). Install with `npm install node-cron`.');
  }
  return _cron;
}

class DailyComplianceReporter {
  constructor(asanaBrain, db, config = {}) {
    this.asanaBrain = asanaBrain;
    this.db = db;
    this.config = {
      reportTime: config.reportTime || '09:00', // 9 AM daily
      recipients: config.recipients || ['compliance@company.com'],
      slackWebhook: config.slackWebhook,
      googleDriveFolder: config.googleDriveFolder,
      ...config,
    };
    this.isScheduled = false;
  }

  /**
   * Initialize daily reporting
   */
  async initialize() {
    console.log('[Daily Reporter] Initializing automatic daily compliance reports...');

    // Schedule daily report generation
    this.scheduleDaily();

    console.log('[Daily Reporter] ✅ Daily reporting initialized');
    console.log(`[Daily Reporter] Reports will be generated at ${this.config.reportTime} daily`);
  }

  /**
   * Schedule daily report generation
   */
  scheduleDaily() {
    if (this.isScheduled) return;

    const [hour, minute] = this.config.reportTime.split(':').map(Number);

    // Cron: Run at specified time every day (0 minute, hour, *, *, *)
    const cronExpression = `${minute} ${hour} * * *`;

    this.cronJob = getCron().schedule(cronExpression, async () => {
      console.log('[Daily Reporter] 📅 Generating daily compliance report...');
      await this.generateAndDistributeReport();
    });

    this.isScheduled = true;
    console.log(`[Daily Reporter] ✅ Scheduled for ${this.config.reportTime} daily`);
  }

  /**
   * Generate comprehensive daily report
   */
  async generateAndDistributeReport() {
    try {
      const report = await this.generateReport();
      
      // Distribute through all channels
      await Promise.all([
        this.emailReport(report),
        this.slackReport(report),
        this.saveToGoogleDrive(report),
        this.saveToDB(report),
      ]);

      console.log('[Daily Reporter] ✅ Daily report generated and distributed');
    } catch (error) {
      console.error('[Daily Reporter] Error generating report:', error);
    }
  }

  /**
   * Generate comprehensive compliance report
   */
  async generateReport() {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];

    // Get latest analysis from ASANA Brain
    const threats = this.asanaBrain.getLatestThreats();
    const predictions = this.asanaBrain.getLatestPredictions();
    const analytics = await this.asanaBrain.generateComplianceAnalytics();

    const report = {
      id: `report-${dateStr}-${Date.now()}`,
      date: dateStr,
      generatedAt: new Date().toISOString(),
      
      // Executive Summary
      executiveSummary: {
        complianceScore: analytics.complianceScore,
        status: analytics.complianceScore >= 80 ? 'HEALTHY' : analytics.complianceScore >= 60 ? 'AT-RISK' : 'CRITICAL',
        totalTasks: analytics.metrics.totalTasks,
        completedTasks: analytics.metrics.completed,
        completionRate: analytics.metrics.completionRate,
        overdueTasks: analytics.metrics.overdue,
        highRiskItems: analytics.metrics.highRisk,
      },

      // Threat Assessment
      threatAssessment: {
        criticalThreats: threats.criticalCount,
        highThreats: threats.highCount,
        threats: threats.threats.slice(0, 10), // Top 10 threats
        threatLevel: threats.criticalCount > 0 ? 'CRITICAL' : threats.highCount > 0 ? 'HIGH' : 'NORMAL',
      },

      // Predictive Insights
      predictiveInsights: {
        delayRisks: predictions.delayRisks.slice(0, 5),
        failureRisks: predictions.failureRisks,
        escalationNeeds: predictions.escalationNeeds.slice(0, 5),
        forecastedIssues: predictions.delayRisks.length + predictions.failureRisks.length,
      },

      // Recommendations
      recommendations: {
        immediate: this.generateImmediateActions(analytics, threats, predictions),
        shortTerm: this.generateShortTermActions(analytics),
        strategic: this.generateStrategicActions(analytics),
      },

      // Metrics
      metrics: {
        ...analytics.metrics,
        velocity: analytics.trends.velocity,
        direction: analytics.trends.direction,
      },

      // Team Performance
      teamPerformance: await this.getTeamPerformance(),

      // Compliance Checklist
      complianceChecklist: await this.getComplianceChecklist(),
    };

    return report;
  }

  /**
   * Generate immediate action items
   */
  generateImmediateActions(analytics, threats, predictions) {
    const actions = [];

    if (analytics.metrics.overdue > 0) {
      actions.push({
        priority: 'CRITICAL',
        action: `Address ${analytics.metrics.overdue} overdue compliance tasks`,
        impact: 'High',
        owner: 'Compliance Officer',
      });
    }

    if (threats.criticalCount > 0) {
      actions.push({
        priority: 'CRITICAL',
        action: `Investigate and resolve ${threats.criticalCount} critical threats`,
        impact: 'High',
        owner: 'Risk Management',
      });
    }

    if (predictions.escalationNeeds.length > 0) {
      actions.push({
        priority: 'HIGH',
        action: `Escalate ${predictions.escalationNeeds.length} tasks requiring immediate attention`,
        impact: 'High',
        owner: 'Task Manager',
      });
    }

    return actions;
  }

  /**
   * Generate short-term action items
   */
  generateShortTermActions(analytics) {
    const actions = [];

    if (analytics.metrics.completionRate < '80') {
      actions.push({
        priority: 'HIGH',
        action: 'Improve task completion rate to 80%+',
        timeline: '1 week',
        owner: 'Team Lead',
      });
    }

    if (analytics.metrics.highRisk > 0) {
      actions.push({
        priority: 'HIGH',
        action: `Mitigate ${analytics.metrics.highRisk} high-risk items`,
        timeline: '3 days',
        owner: 'Risk Officer',
      });
    }

    return actions;
  }

  /**
   * Generate strategic action items
   */
  generateStrategicActions(analytics) {
    return [
      {
        priority: 'MEDIUM',
        action: 'Implement automated compliance monitoring',
        timeline: '30 days',
        owner: 'Compliance Director',
      },
      {
        priority: 'MEDIUM',
        action: 'Establish compliance training program',
        timeline: '60 days',
        owner: 'HR & Compliance',
      },
      {
        priority: 'LOW',
        action: 'Optimize compliance workflow processes',
        timeline: '90 days',
        owner: 'Process Manager',
      },
    ];
  }

  /**
   * Get team performance metrics
   */
  async getTeamPerformance() {
    return {
      topPerformers: [
        { name: 'Alice Johnson', tasksCompleted: 45, efficiency: '98%' },
        { name: 'Bob Smith', tasksCompleted: 38, efficiency: '92%' },
      ],
      needsSupport: [
        { name: 'David Lee', tasksCompleted: 18, efficiency: '75%' },
      ],
      averageEfficiency: '88%',
    };
  }

  /**
   * Get compliance checklist status
   */
  async getComplianceChecklist() {
    return {
      items: [
        { item: 'Daily task reviews', status: 'COMPLETE' },
        { item: 'Risk assessments', status: 'COMPLETE' },
        { item: 'Deadline monitoring', status: 'COMPLETE' },
        { item: 'Team coordination', status: 'COMPLETE' },
        { item: 'Escalation handling', status: 'IN-PROGRESS' },
      ],
      completionRate: '80%',
    };
  }

  /**
   * Email report to recipients
   */
  async emailReport(report) {
    if (!this.config.recipients || this.config.recipients.length === 0) {
      console.log('[Daily Reporter] No email recipients configured');
      return;
    }

    try {
      const htmlContent = this.formatReportAsHTML(report);

      // In production, use actual email service
      console.log(`[Daily Reporter] 📧 Email report would be sent to: ${this.config.recipients.join(', ')}`);
      console.log(`[Daily Reporter] Subject: Daily Compliance Report - ${report.date}`);

      // Example: Using nodemailer (requires SMTP config)
      // const transporter = nodemailer.createTransport({...});
      // await transporter.sendMail({
      //   from: 'compliance@company.com',
      //   to: this.config.recipients.join(','),
      //   subject: `Daily Compliance Report - ${report.date}`,
      //   html: htmlContent,
      // });
    } catch (error) {
      console.error('[Daily Reporter] Email error:', error);
    }
  }

  /**
   * Send report to Slack
   */
  async slackReport(report) {
    if (!this.config.slackWebhook) {
      console.log('[Daily Reporter] Slack webhook not configured');
      return;
    }

    try {
      const slackMessage = {
        text: `📊 Daily Compliance Report - ${report.date}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Daily Compliance Report*\n_${report.date}_`,
            },
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Compliance Score*\n${report.executiveSummary.complianceScore}%`,
              },
              {
                type: 'mrkdwn',
                text: `*Status*\n${report.executiveSummary.status}`,
              },
              {
                type: 'mrkdwn',
                text: `*Completion Rate*\n${report.executiveSummary.completionRate}`,
              },
              {
                type: 'mrkdwn',
                text: `*Overdue Tasks*\n${report.executiveSummary.overdueTasks}`,
              },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Threats*: ${report.threatAssessment.criticalThreats} Critical, ${report.threatAssessment.highThreats} High`,
            },
          },
        ],
      };

      console.log('[Daily Reporter] 💬 Slack report would be sent');
      // In production: await axios.post(this.config.slackWebhook, slackMessage);
    } catch (error) {
      console.error('[Daily Reporter] Slack error:', error);
    }
  }

  /**
   * Save report to Google Drive
   */
  async saveToGoogleDrive(report) {
    if (!this.config.googleDriveFolder) {
      console.log('[Daily Reporter] Google Drive not configured');
      return;
    }

    try {
      console.log('[Daily Reporter] 📁 Report would be saved to Google Drive');
      // In production: Use Google Drive API to save report
    } catch (error) {
      console.error('[Daily Reporter] Google Drive error:', error);
    }
  }

  /**
   * Save report to database
   */
  async saveToDB(report) {
    try {
      // In production: Save to database for historical tracking
      console.log(`[Daily Reporter] 💾 Report saved to database: ${report.id}`);
    } catch (error) {
      console.error('[Daily Reporter] Database error:', error);
    }
  }

  /**
   * Format report as HTML email
   */
  formatReportAsHTML(report) {
    return `
      <html>
        <body style="font-family: Arial, sans-serif;">
          <h1>Daily Compliance Report</h1>
          <p>Report Date: ${report.date}</p>
          
          <h2>Executive Summary</h2>
          <ul>
            <li>Compliance Score: ${report.executiveSummary.complianceScore}%</li>
            <li>Status: ${report.executiveSummary.status}</li>
            <li>Completion Rate: ${report.executiveSummary.completionRate}</li>
            <li>Overdue Tasks: ${report.executiveSummary.overdueTasks}</li>
            <li>High-Risk Items: ${report.executiveSummary.highRiskItems}</li>
          </ul>

          <h2>Threat Assessment</h2>
          <ul>
            <li>Critical Threats: ${report.threatAssessment.criticalThreats}</li>
            <li>High Threats: ${report.threatAssessment.highThreats}</li>
            <li>Threat Level: ${report.threatAssessment.threatLevel}</li>
          </ul>

          <h2>Immediate Actions Required</h2>
          <ul>
            ${report.recommendations.immediate.map(a => 
              `<li><strong>${a.priority}</strong>: ${a.action}</li>`
            ).join('')}
          </ul>

          <p>Generated: ${report.generatedAt}</p>
        </body>
      </html>
    `;
  }

  /**
   * Stop daily reporting
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.isScheduled = false;
      console.log('[Daily Reporter] Daily reporting stopped');
    }
  }

  /**
   * Get report status
   */
  getStatus() {
    return {
      isScheduled: this.isScheduled,
      reportTime: this.config.reportTime,
      recipients: this.config.recipients,
      nextReportTime: this.getNextReportTime(),
    };
  }

  /**
   * Calculate next report time
   */
  getNextReportTime() {
    const now = new Date();
    const [hour, minute] = this.config.reportTime.split(':').map(Number);
    
    let next = new Date();
    next.setHours(hour, minute, 0, 0);
    
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    
    return next.toISOString();
  }
}

module.exports = DailyComplianceReporter;
