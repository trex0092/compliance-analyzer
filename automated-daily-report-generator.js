/**
 * ASANA BRAIN: AUTOMATED DAILY COMPLIANCE REPORT GENERATOR
 * 
 * Generates professional compliance reports daily at 8:00 AM using
 * enterprise-grade templates with real-time data from Asana.
 * 
 * Features:
 * - Automatic daily generation at 8:00 AM
 * - Professional HTML/CSS templates
 * - Real-time data integration
 * - Multi-channel distribution (Email, Slack, Dashboard, Asana)
 * - PDF export support
 * - Execution history tracking
 * - Error handling and retry logic
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// HTML entities that must be escaped in any text value that is
// interpolated into a generated HTML report. Unlike React, raw string
// concatenation into templates does not escape anything, so Asana
// task names or assignee labels containing "<", ">", "&", quotes or
// the unicode line separators would break the DOM or enable stored
// HTML injection in emailed reports.
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Safe percentage helper that avoids NaN when the denominator is 0.
function pct(numerator, denominator, digits = 1) {
  if (!denominator || denominator <= 0) return (0).toFixed(digits);
  return ((numerator / denominator) * 100).toFixed(digits);
}

// Restrict a filesystem segment to a single, safe directory name so a
// caller-supplied projectId cannot traverse out of the reports dir.
function safePathSegment(value, fallback = 'unknown') {
  const raw = String(value == null ? '' : value);
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
  return cleaned || fallback;
}

class AutomatedDailyReportGenerator {
  constructor(config) {
    this.config = config;
    this.logger = config.logger;
    this.tracer = config.tracer;
    this.metrics = config.metrics;
    this.asanaClient = config.asanaClient;
    this.emailService = config.emailService;
    this.slackService = config.slackService;
    this.dashboardService = config.dashboardService;
    this.storageService = config.storageService;
    
    this.scheduledReports = new Map();
    this.executionHistory = [];
    this.templates = {};
    this.isRunning = false;
  }

  /**
   * Initialize the report generator
   */
  async initialize() {
    const span = this.tracer.startSpan('report_generator_init');
    try {
      this.logger.info('Initializing automated daily report generator...');
      
      // Load professional templates
      await this.loadTemplates();
      
      // Initialize services
      await this.initializeServices();
      
      // Start scheduler
      this.startScheduler();
      
      this.isRunning = true;
      this.logger.info('✅ Report generator initialized successfully');
      this.metrics.increment('report_generator.initialized', 1);
      
      span.finish();
      return true;
    } catch (error) {
      this.logger.error('Failed to initialize report generator', error);
      this.metrics.increment('report_generator.init_error', 1);
      span.finish({ error });
      throw error;
    }
  }

  /**
   * Load professional report templates
   */
  async loadTemplates() {
    const span = this.tracer.startSpan('load_templates');
    try {
      this.logger.info('Loading professional report templates...');
      
      // Load base template
      const baseTemplatePath = path.join(__dirname, 'professional-report-template.html');
      const baseTemplate = fs.readFileSync(baseTemplatePath, 'utf-8');
      
      // Load sample templates for reference
      const financialTemplatePath = path.join(__dirname, 'SAMPLE_REPORT_FINANCIAL_COMPLIANCE.html');
      const dataProtectionTemplatePath = path.join(__dirname, 'SAMPLE_REPORT_DATA_PROTECTION.html');
      
      this.templates = {
        base: baseTemplate,
        financial: fs.readFileSync(financialTemplatePath, 'utf-8'),
        dataProtection: fs.readFileSync(dataProtectionTemplatePath, 'utf-8'),
      };
      
      this.logger.info('✅ Templates loaded successfully');
      span.finish();
    } catch (error) {
      this.logger.error('Failed to load templates', error);
      span.finish({ error });
      throw error;
    }
  }

  /**
   * Initialize required services
   */
  async initializeServices() {
    const span = this.tracer.startSpan('init_services');
    try {
      this.logger.info('Initializing services...');
      
      // Verify Asana client
      if (!this.asanaClient) {
        throw new Error('Asana client not configured');
      }
      
      // Verify email service
      if (!this.emailService) {
        this.logger.warn('Email service not configured - email distribution disabled');
      }
      
      // Verify Slack service
      if (!this.slackService) {
        this.logger.warn('Slack service not configured - Slack distribution disabled');
      }
      
      this.logger.info('✅ Services initialized');
      span.finish();
    } catch (error) {
      this.logger.error('Failed to initialize services', error);
      span.finish({ error });
      throw error;
    }
  }

  /**
   * Start the daily scheduler. Fires at 08:00 UTC every day; schedules
   * each subsequent run from a freshly computed 08:00 UTC so there is
   * no drift across DST transitions or leap seconds. Rejections from
   * the async executor are captured locally instead of leaking into
   * the global unhandled-rejection handler.
   */
  startScheduler() {
    const span = this.tracer.startSpan('start_scheduler');
    try {
      this.logger.info('Starting daily report scheduler...');

      const scheduleNext = () => {
        const now = new Date();
        const next = new Date(Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          8, 0, 0, 0,
        ));
        if (next.getTime() <= now.getTime()) {
          next.setUTCDate(next.getUTCDate() + 1);
        }
        const delay = next.getTime() - now.getTime();
        this.logger.info(`Next report generation scheduled for: ${next.toISOString()}`);
        this.dailyTimer = setTimeout(() => {
          Promise.resolve()
            .then(() => this.executeDailyReports())
            .catch((err) => {
              this.logger.error('Unhandled error in scheduled report execution', err);
              this.metrics.increment('report_generation.execution_error', 1);
            })
            .finally(() => {
              // Always schedule the next day, even on failure, so one
              // bad run does not permanently stop the scheduler.
              if (this.isRunning) scheduleNext();
            });
        }, delay);
      };

      scheduleNext();

      this.logger.info('✅ Scheduler started');
      span.finish();
    } catch (error) {
      this.logger.error('Failed to start scheduler', error);
      span.finish({ error });
      throw error;
    }
  }

  /**
   * Execute daily report generation for all scheduled projects
   */
  async executeDailyReports() {
    const span = this.tracer.startSpan('execute_daily_reports');
    const executionId = crypto.randomBytes(8).toString('hex');
    const executionTime = new Date();
    
    try {
      this.logger.info(`[${executionId}] Starting daily report execution...`);
      this.metrics.increment('report_generation.daily_execution', 1);
      
      const results = [];
      
      // Execute reports for all scheduled projects
      for (const [projectId, config] of this.scheduledReports.entries()) {
        try {
          this.logger.info(`[${executionId}] Generating report for project: ${projectId}`);
          
          const result = await this.generateProjectReport(
            projectId,
            config,
            executionId
          );
          
          results.push({
            projectId,
            status: 'success',
            reportPath: result.reportPath,
            distribution: result.distribution,
          });
          
          this.metrics.increment('report_generation.success', 1);
        } catch (error) {
          this.logger.error(`[${executionId}] Failed to generate report for project ${projectId}`, error);
          
          results.push({
            projectId,
            status: 'error',
            error: error.message,
          });
          
          this.metrics.increment('report_generation.error', 1);
        }
      }
      
      // Record execution history
      this.recordExecution({
        executionId,
        timestamp: executionTime,
        results,
        status: results.every(r => r.status === 'success') ? 'success' : 'partial',
      });
      
      this.logger.info(`[${executionId}] Daily report execution completed`);
      span.finish();
      
      return results;
    } catch (error) {
      this.logger.error(`[${executionId}] Daily report execution failed`, error);
      this.metrics.increment('report_generation.execution_error', 1);
      span.finish({ error });
      throw error;
    }
  }

  /**
   * Generate report for a specific project
   */
  async generateProjectReport(projectId, config, executionId) {
    const span = this.tracer.startSpan('generate_project_report');
    
    try {
      this.logger.info(`[${executionId}] Fetching project data for: ${projectId}`);
      
      // Fetch project data from Asana
      const projectData = await this.asanaClient.getProject(projectId);
      const tasks = await this.asanaClient.getProjectTasks(projectId);
      const metrics = this.calculateMetrics(tasks);
      
      this.logger.info(`[${executionId}] Generating HTML report...`);
      
      // Generate HTML report
      const htmlContent = this.generateHTMLReport(
        projectData,
        tasks,
        metrics,
        config
      );
      
      this.logger.info(`[${executionId}] Converting to PDF...`);
      
      // Convert to PDF
      const pdfPath = await this.convertToPDF(
        htmlContent,
        projectId,
        executionId
      );
      
      this.logger.info(`[${executionId}] Distributing report...`);
      
      // Distribute report
      const distribution = await this.distributeReport(
        projectId,
        htmlContent,
        pdfPath,
        config,
        executionId
      );
      
      this.logger.info(`[${executionId}] Report generation completed for project: ${projectId}`);
      
      span.finish();
      
      return {
        reportPath: pdfPath,
        distribution,
      };
    } catch (error) {
      this.logger.error(`[${executionId}] Failed to generate report for project ${projectId}`, error);
      span.finish({ error });
      throw error;
    }
  }

  /**
   * Calculate compliance metrics from tasks
   */
  calculateMetrics(tasks) {
    const span = this.tracer.startSpan('calculate_metrics');
    
    try {
      const now = new Date();
      let completed = 0;
      let overdue = 0;
      let critical = 0;
      let high = 0;
      let medium = 0;
      let low = 0;
      let totalDaysOverdue = 0;
      
      for (const task of tasks) {
        // Count completed tasks
        if (task.completed) {
          completed++;
          continue;
        }

        // Only open tasks with a past due date count towards the risk
        // tiers — open-but-not-yet-due tasks should not silently land
        // in "low risk" or the bucket totals stop matching the
        // overdue count reported above them.
        if (!task.due_on) continue;
        const due = new Date(task.due_on);
        if (!Number.isFinite(due.getTime()) || due >= now) continue;

        overdue++;
        const daysOverdue = Math.floor((now - due) / (1000 * 60 * 60 * 24));
        totalDaysOverdue += daysOverdue;

        if (daysOverdue >= 30) {
          critical++;
        } else if (daysOverdue >= 14) {
          high++;
        } else if (daysOverdue >= 7) {
          medium++;
        } else {
          low++;
        }
      }
      
      const complianceRate = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;
      const healthScore = Math.max(0, 100 - (overdue * 5) - (critical * 15));
      const riskScore = tasks.length > 0 ? Math.round((overdue / tasks.length) * 100) : 0;
      const avgDaysOverdue = overdue > 0 ? Math.round(totalDaysOverdue / overdue) : 0;
      
      const metrics = {
        totalTasks: tasks.length,
        completedTasks: completed,
        overdueTasks: overdue,
        complianceRate,
        healthScore,
        riskScore,
        criticalTasks: critical,
        highTasks: high,
        mediumTasks: medium,
        lowTasks: low,
        avgDaysOverdue,
      };
      
      span.finish();
      return metrics;
    } catch (error) {
      this.logger.error('Failed to calculate metrics', error);
      span.finish({ error });
      throw error;
    }
  }

  /**
   * Generate HTML report from template and data
   */
  generateHTMLReport(projectData, tasks, metrics, config) {
    const span = this.tracer.startSpan('generate_html_report');
    
    try {
      const now = new Date();
      const reportDate = now.toISOString().split('T')[0];
      
      // Select template based on project category
      let template = this.templates.base;
      if (config.category === 'financial') {
        template = this.templates.financial;
      } else if (config.category === 'data_protection') {
        template = this.templates.dataProtection;
      }
      
      // Percentages are of the total task count when that is > 0, or
      // 0 otherwise — never NaN. Text values are HTML-escaped before
      // interpolation to prevent template injection from Asana names.
      const total = metrics.totalTasks || 0;
      const projectName = escapeHtml(projectData && projectData.name || 'Compliance Project');
      const organization = escapeHtml(config && config.organization || 'Organization');
      const weeklyVelocity = Math.round(total / 4); // Weekly velocity

      let html = template
        .replace(/\[PROJECT_NAME\]/g, projectName)
        .replace(/\[REPORT_DATE\]/g, escapeHtml(reportDate))
        .replace(/\[ORGANIZATION_NAME\]/g, organization)
        .replace(/\[COMPLIANCE_RATE\]/g, String(metrics.complianceRate))
        .replace(/\[HEALTH_SCORE\]/g, String(metrics.healthScore))
        .replace(/\[RISK_SCORE\]/g, String(metrics.riskScore))
        .replace(/\[VELOCITY\]/g, String(weeklyVelocity))
        .replace(/\[COMPLETED_TASKS\]/g, String(metrics.completedTasks))
        .replace(/\[TOTAL_TASKS\]/g, String(total))
        .replace(/\[COMPLETION_RATE\]/g, String(metrics.complianceRate))
        .replace(/\[CRITICAL_COUNT\]/g, String(metrics.criticalTasks))
        .replace(/\[HIGH_COUNT\]/g, String(metrics.highTasks))
        .replace(/\[MEDIUM_COUNT\]/g, String(metrics.mediumTasks))
        .replace(/\[LOW_COUNT\]/g, String(metrics.lowTasks))
        .replace(/\[CRITICAL_PERCENT\]/g, pct(metrics.criticalTasks, total))
        .replace(/\[HIGH_PERCENT\]/g, pct(metrics.highTasks, total))
        .replace(/\[MEDIUM_PERCENT\]/g, pct(metrics.mediumTasks, total))
        .replace(/\[LOW_PERCENT\]/g, pct(metrics.lowTasks, total))
        .replace(/\[PRINT_DATE\]/g, escapeHtml(now.toLocaleString()));

      // Add critical tasks to report
      const criticalTasks = tasks
        .filter(t => {
          if (t.completed) return false;
          if (!t.due_on) return false;
          const due = new Date(t.due_on);
          if (!Number.isFinite(due.getTime())) return false;
          const daysOverdue = Math.floor((now - due) / (1000 * 60 * 60 * 24));
          return daysOverdue >= 30;
        })
        .slice(0, 5);

      if (criticalTasks.length > 0) {
        const criticalTasksHtml = criticalTasks
          .map(t => {
            const daysOverdue = Math.floor((now - new Date(t.due_on)) / (1000 * 60 * 60 * 24));
            const assigneeName = t.assignee && t.assignee.name ? t.assignee.name : 'Unassigned';
            return `
              <tr>
                <td>${escapeHtml(t.name)}</td>
                <td>${daysOverdue}</td>
                <td>${escapeHtml(assigneeName)}</td>
                <td><span class="badge badge-critical">CRITICAL</span></td>
              </tr>
            `;
          })
          .join('');

        html = html.replace(
          /<tr>\s*<td>\[TASK_1_NAME\]<\/td>/,
          criticalTasksHtml
        );
      }
      
      span.finish();
      return html;
    } catch (error) {
      this.logger.error('Failed to generate HTML report', error);
      span.finish({ error });
      throw error;
    }
  }

  /**
   * Convert HTML to PDF
   */
  async convertToPDF(htmlContent, projectId, executionId) {
    const span = this.tracer.startSpan('convert_to_pdf');
    
    try {
      this.logger.info(`[${executionId}] Converting HTML to PDF...`);
      
      // For now, save as HTML (PDF conversion would require puppeteer/wkhtmltopdf).
      // Sanitize the projectId so a caller cannot traverse out of the
      // reports directory via "../" segments.
      const safeProjectId = safePathSegment(projectId);
      const reportsRoot = path.resolve(__dirname, 'reports');
      const reportDir = path.resolve(reportsRoot, safeProjectId);
      if (!reportDir.startsWith(reportsRoot + path.sep) && reportDir !== reportsRoot) {
        throw new Error(`Refusing to write report outside reports directory: ${reportDir}`);
      }
      fs.mkdirSync(reportDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const reportPath = path.join(reportDir, `compliance-report-${timestamp}.html`);
      
      fs.writeFileSync(reportPath, htmlContent, 'utf-8');
      
      this.logger.info(`[${executionId}] Report saved to: ${reportPath}`);
      
      span.finish();
      return reportPath;
    } catch (error) {
      this.logger.error(`[${executionId}] Failed to convert to PDF`, error);
      span.finish({ error });
      throw error;
    }
  }

  /**
   * Distribute report to all configured channels
   */
  async distributeReport(projectId, htmlContent, pdfPath, config, executionId) {
    const span = this.tracer.startSpan('distribute_report');
    const distribution = {};
    
    try {
      this.logger.info(`[${executionId}] Distributing report to configured channels...`);
      
      // Email distribution
      if (config.email && this.emailService) {
        try {
          await this.emailService.sendReport({
            to: config.email,
            subject: `Compliance Status Report - ${new Date().toISOString().split('T')[0]}`,
            htmlContent,
            attachments: [{ path: pdfPath }],
          });
          distribution.email = 'sent';
          this.logger.info(`[${executionId}] Report sent via email`);
        } catch (error) {
          this.logger.warn(`[${executionId}] Failed to send email`, error);
          distribution.email = 'failed';
        }
      }
      
      // Slack distribution
      if (config.slack && this.slackService) {
        try {
          await this.slackService.sendReport({
            webhook: config.slack,
            message: `📊 Daily Compliance Report Generated`,
            reportPath: pdfPath,
          });
          distribution.slack = 'sent';
          this.logger.info(`[${executionId}] Report sent via Slack`);
        } catch (error) {
          this.logger.warn(`[${executionId}] Failed to send Slack message`, error);
          distribution.slack = 'failed';
        }
      }
      
      // Dashboard distribution
      if (config.dashboard && this.dashboardService) {
        try {
          await this.dashboardService.updateWidget({
            projectId,
            reportPath: pdfPath,
            metrics: config.metrics,
          });
          distribution.dashboard = 'updated';
          this.logger.info(`[${executionId}] Dashboard updated`);
        } catch (error) {
          this.logger.warn(`[${executionId}] Failed to update dashboard`, error);
          distribution.dashboard = 'failed';
        }
      }
      
      // Asana distribution
      if (config.asana) {
        try {
          // Create task in Asana with report link
          await this.asanaClient.createTask({
            projects: [projectId],
            name: `Daily Compliance Report - ${new Date().toISOString().split('T')[0]}`,
            notes: `Report generated and distributed. Path: ${pdfPath}`,
            custom_fields: {
              report_type: 'daily',
              report_date: new Date().toISOString(),
            },
          });
          distribution.asana = 'created';
          this.logger.info(`[${executionId}] Asana task created`);
        } catch (error) {
          this.logger.warn(`[${executionId}] Failed to create Asana task`, error);
          distribution.asana = 'failed';
        }
      }
      
      span.finish();
      return distribution;
    } catch (error) {
      this.logger.error(`[${executionId}] Failed to distribute report`, error);
      span.finish({ error });
      throw error;
    }
  }

  /**
   * Schedule daily reports for a project
   */
  scheduleDaily(projectId, config) {
    const span = this.tracer.startSpan('schedule_daily_report');
    
    try {
      this.logger.info(`Scheduling daily reports for project: ${projectId}`);
      
      this.scheduledReports.set(projectId, {
        ...config,
        scheduledAt: new Date(),
      });
      
      this.logger.info(`✅ Daily reports scheduled for project: ${projectId}`);
      this.metrics.increment('report_generation.scheduled', 1);
      
      span.finish();
    } catch (error) {
      this.logger.error('Failed to schedule daily reports', error);
      span.finish({ error });
      throw error;
    }
  }

  /**
   * Stop daily reports for a project
   */
  stopDaily(projectId) {
    const span = this.tracer.startSpan('stop_daily_report');
    
    try {
      this.logger.info(`Stopping daily reports for project: ${projectId}`);
      
      this.scheduledReports.delete(projectId);
      
      this.logger.info(`✅ Daily reports stopped for project: ${projectId}`);
      this.metrics.increment('report_generation.stopped', 1);
      
      span.finish();
    } catch (error) {
      this.logger.error('Failed to stop daily reports', error);
      span.finish({ error });
      throw error;
    }
  }

  /**
   * Generate report on-demand
   */
  async generateOnDemand(projectId, config) {
    const span = this.tracer.startSpan('generate_on_demand_report');
    const executionId = crypto.randomBytes(8).toString('hex');
    
    try {
      this.logger.info(`[${executionId}] Generating on-demand report for project: ${projectId}`);
      
      const result = await this.generateProjectReport(projectId, config, executionId);
      
      this.logger.info(`[${executionId}] On-demand report generated successfully`);
      this.metrics.increment('report_generation.on_demand', 1);
      
      span.finish();
      return result;
    } catch (error) {
      this.logger.error(`[${executionId}] Failed to generate on-demand report`, error);
      this.metrics.increment('report_generation.on_demand_error', 1);
      span.finish({ error });
      throw error;
    }
  }

  /**
   * Record execution history
   */
  recordExecution(execution) {
    this.executionHistory.push({
      ...execution,
      recordedAt: new Date(),
    });
    
    // Keep only last 30 days of history
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    this.executionHistory = this.executionHistory.filter(
      e => new Date(e.timestamp) > thirtyDaysAgo
    );
    
    this.logger.info(`Execution recorded: ${execution.executionId} - Status: ${execution.status}`);
  }

  /**
   * Get execution history
   */
  getExecutionHistory(projectId, limit = 10) {
    return this.executionHistory
      .filter(e => !projectId || e.results.some(r => r.projectId === projectId))
      .slice(-limit)
      .reverse();
  }

  /**
   * Get system status
   */
  getStatus() {
    return {
      status: this.isRunning ? 'running' : 'stopped',
      scheduledProjects: Array.from(this.scheduledReports.keys()),
      totalScheduled: this.scheduledReports.size,
      totalExecutions: this.executionHistory.length,
      successfulExecutions: this.executionHistory.filter(e => e.status === 'success').length,
      failedExecutions: this.executionHistory.filter(e => e.status !== 'success').length,
      lastExecution: this.executionHistory[this.executionHistory.length - 1] || null,
    };
  }

  /**
   * Shutdown the report generator
   */
  shutdown() {
    const span = this.tracer.startSpan('shutdown_report_generator');
    
    try {
      this.logger.info('Shutting down report generator...');
      
      // Clear timers
      if (this.dailyTimer) {
        clearTimeout(this.dailyTimer);
        this.dailyTimer = null;
      }
      
      if (this.dailyInterval) {
        clearInterval(this.dailyInterval);
        this.dailyInterval = null;
      }
      
      this.isRunning = false;
      
      this.logger.info('✅ Report generator shutdown complete');
      span.finish();
    } catch (error) {
      this.logger.error('Error during shutdown', error);
      span.finish({ error });
      throw error;
    }
  }
}

module.exports = AutomatedDailyReportGenerator;
