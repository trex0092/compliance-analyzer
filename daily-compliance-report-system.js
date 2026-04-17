/**
 * ASANA BRAIN: AUTOMATED DAILY COMPLIANCE STATUS REPORT SYSTEM
 * 
 * Automatically generates and distributes daily compliance status reports
 * based on the Compliance Metrics Dashboard
 * 
 * Features:
 * - Daily report generation at 8:00 AM
 * - Multi-channel distribution (Email, Slack, Dashboard)
 * - Executive summary with key metrics
 * - Risk analysis and recommendations
 * - Trend analysis and forecasting
 * - Historical tracking
 * 
 * Status: Production Ready
 * Version: 1.0
 * Date: May 1, 2026
 */

const cron = require('node-cron');
const nodemailer = require('nodemailer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// HTML-escape every operator-controlled value before it hits the
// report template. Without this, a task title or project name
// containing HTML would corrupt the generated report and enable
// injection into the emailed body.
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Safe percentage helper to avoid NaN when the denominator is zero
// (which happens for empty projects).
function pct(numerator, denominator, digits = 1) {
  if (!denominator || denominator <= 0) return (0).toFixed(digits);
  return ((numerator / denominator) * 100).toFixed(digits);
}

// Clamp a filesystem path segment so a caller-supplied projectId
// cannot traverse out of the reports directory.
function safePathSegment(value, fallback = 'unknown') {
  const raw = String(value == null ? '' : value);
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
  return cleaned || fallback;
}

class DailyComplianceReportSystem {
  constructor(config) {
    this.config = config;
    this.logger = config.logger;
    this.tracer = config.tracer;
    this.metrics = config.metrics;
    this.asanaClient = config.asanaClient;
    this.dashboardService = config.dashboardService;
    this.notificationService = config.notificationService;
    this.storageService = config.storageService;
    this.emailTransporter = this.initializeEmailTransporter();
    this.reportSchedules = new Map();
  }

  /**
   * Initialize email transporter for sending reports
   */
  initializeEmailTransporter() {
    return nodemailer.createTransport({
      host: this.config.emailConfig?.host || 'smtp.gmail.com',
      port: this.config.emailConfig?.port || 587,
      secure: this.config.emailConfig?.secure || false,
      auth: {
        user: this.config.emailConfig?.user,
        pass: this.config.emailConfig?.password,
      },
    });
  }

  /**
   * Schedule daily compliance report generation
   * Runs at 8:00 AM every day
   */
  scheduleDaily(projectId, recipients = {}) {
    const span = this.tracer.startSpan('schedule_daily_report');

    try {
      // Cancel existing schedule if any
      if (this.reportSchedules.has(projectId)) {
        this.reportSchedules.get(projectId).stop();
      }

      // Schedule report generation at 8:00 AM daily
      const schedule = cron.schedule('0 8 * * *', async () => {
        await this.generateAndDistributeReport(projectId, recipients);
      });

      this.reportSchedules.set(projectId, schedule);

      this.logger.info('Daily compliance report scheduled', {
        projectId,
        time: '8:00 AM',
        recipients: Object.keys(recipients),
      });

      span.finish();
      return {
        success: true,
        message: 'Daily compliance report scheduled successfully',
        projectId,
        time: '8:00 AM',
      };
    } catch (error) {
      this.logger.error('Failed to schedule daily report', { error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * Generate and distribute compliance report
   */
  async generateAndDistributeReport(projectId, recipients = {}) {
    const span = this.tracer.startSpan('generate_and_distribute_report');

    try {
      // Get project and tasks
      const project = await this.asanaClient.getProject(projectId);
      const tasks = await this.asanaClient.getTasks(projectId);

      // Generate metrics
      const metrics = await this.dashboardService.generateComplianceMetrics(tasks);

      // Generate report
      const report = await this.generateComplianceReport(project, tasks, metrics);

      // Save report
      const reportPath = await this.saveReport(report, projectId);

      // Distribute report
      const distribution = await this.distributeReport(report, reportPath, recipients);

      this.logger.info('Compliance report generated and distributed', {
        projectId,
        reportPath,
        distribution,
      });

      this.metrics.increment('daily_report.generated', 1);
      span.finish();

      return {
        success: true,
        reportPath,
        distribution,
      };
    } catch (error) {
      this.logger.error('Failed to generate and distribute report', { error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * Generate comprehensive compliance report
   */
  async generateComplianceReport(project, tasks, metrics) {
    const reportDate = new Date();
    const reportId = `compliance-report-${project.id}-${reportDate.toISOString().split('T')[0]}`;

    // Precompute daysOverdue once per task to avoid re-parsing the
    // due date in every filter, sort and percentage call.
    const annotatedTasks = tasks.map(t => ({
      task: t,
      daysOverdue: this.calculateDaysOverdue(t),
    }));

    const criticalTasks = annotatedTasks.filter(x => x.daysOverdue > 30).map(x => x.task);
    const highRiskTasks = annotatedTasks.filter(x => x.daysOverdue > 14 && x.daysOverdue <= 30).map(x => x.task);
    const mediumRiskTasks = annotatedTasks.filter(x => x.daysOverdue > 7 && x.daysOverdue <= 14).map(x => x.task);
    // "Low" means "overdue 1-7 days", not "every remaining task".
    // The old `tasks.length - critical - high - medium` formula
    // silently included completed and not-yet-due tasks, so the four
    // buckets did not add up to the overdue total elsewhere in the
    // report.
    const lowRiskTasks = annotatedTasks
      .filter(x => x.daysOverdue > 0 && x.daysOverdue <= 7)
      .map(x => x.task);

    const riskMatrix = {
      critical: criticalTasks.length,
      high: highRiskTasks.length,
      medium: mediumRiskTasks.length,
      low: lowRiskTasks.length,
    };

    // Get historical data for trend analysis
    const historicalMetrics = await this.getHistoricalMetrics(project.id, 30);
    const trend = this.calculateTrend(metrics, historicalMetrics);

    // Generate recommendations
    const recommendations = this.generateRecommendations(metrics, riskMatrix, trend);

    // Build report
    const report = {
      id: reportId,
      projectId: project.id,
      projectName: project.name,
      reportDate,
      generatedAt: new Date(),
      
      // Executive Summary
      executiveSummary: {
        title: `Compliance Status Report - ${project.name}`,
        date: reportDate.toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        }),
        overallStatus: this.determineOverallStatus(metrics),
        healthScore: metrics.healthScore,
        complianceRate: metrics.complianceRate,
        riskScore: metrics.riskScore,
      },

      // Key Metrics
      metrics: {
        totalTasks: metrics.totalTasks,
        completedTasks: metrics.completedTasks,
        inProgressTasks: metrics.inProgressTasks,
        overdueTasks: metrics.overdueTasks,
        atRiskTasks: metrics.atRiskTasks,
        criticalTasks: metrics.criticalTasks,
        complianceRate: metrics.complianceRate.toFixed(1),
        riskScore: metrics.riskScore.toFixed(1),
        healthScore: metrics.healthScore.toFixed(1),
        velocity: metrics.velocity,
      },

      // Risk Matrix
      riskMatrix: {
        critical: {
          count: riskMatrix.critical,
          percentage: pct(riskMatrix.critical, tasks.length),
          tasks: criticalTasks.slice(0, 5).map(t => ({
            id: t.id,
            title: t.title,
            daysOverdue: this.calculateDaysOverdue(t),
            assignee: t.assignee_id,
          })),
        },
        high: {
          count: riskMatrix.high,
          percentage: pct(riskMatrix.high, tasks.length),
          tasks: highRiskTasks.slice(0, 5).map(t => ({
            id: t.id,
            title: t.title,
            daysOverdue: this.calculateDaysOverdue(t),
            assignee: t.assignee_id,
          })),
        },
        medium: {
          count: riskMatrix.medium,
          percentage: pct(riskMatrix.medium, tasks.length),
          tasks: mediumRiskTasks.slice(0, 3).map(t => ({
            id: t.id,
            title: t.title,
            daysOverdue: this.calculateDaysOverdue(t),
            assignee: t.assignee_id,
          })),
        },
        low: {
          count: riskMatrix.low,
          percentage: pct(riskMatrix.low, tasks.length),
        },
      },

      // Trend Analysis
      trend: {
        direction: trend.direction,
        changePercentage: trend.changePercentage.toFixed(1),
        previousRate: trend.previousRate.toFixed(1),
        currentRate: metrics.complianceRate.toFixed(1),
        forecast30Days: metrics.forecast.toFixed(1),
        analysis: trend.analysis,
      },

      // Top Issues
      topIssues: this.identifyTopIssues(tasks, metrics),

      // Recommendations
      recommendations: recommendations,

      // Action Items
      actionItems: this.generateActionItems(riskMatrix, metrics),

      // Compliance Status by Category
      complianceByCategory: this.analyzeComplianceByCategory(tasks),

      // Team Performance
      teamPerformance: this.analyzeTeamPerformance(tasks),

      // Historical Data
      historicalData: {
        last7Days: historicalMetrics.last7Days,
        last30Days: historicalMetrics.last30Days,
        trend: trend,
      },

      // Regulatory Framework Status
      regulatoryStatus: this.analyzeRegulatoryStatus(tasks),

      // Next Steps
      nextSteps: this.generateNextSteps(metrics, riskMatrix),
    };

    return report;
  }

  /**
   * Determine overall compliance status
   */
  determineOverallStatus(metrics) {
    if (metrics.complianceRate >= 90) return 'EXCELLENT';
    if (metrics.complianceRate >= 75) return 'GOOD';
    if (metrics.complianceRate >= 60) return 'FAIR';
    if (metrics.complianceRate >= 50) return 'POOR';
    return 'CRITICAL';
  }

  /**
   * Calculate days overdue for a task
   */
  calculateDaysOverdue(task) {
    if (!task.due_date || task.status === 'completed') return 0;
    const dueDate = new Date(task.due_date);
    const today = new Date();
    return Math.max(0, Math.floor((today - dueDate) / (1000 * 60 * 60 * 24)));
  }

  /**
   * Calculate trend compared to historical data
   */
  calculateTrend(metrics, historicalMetrics) {
    const previousRate = historicalMetrics.last7Days?.[0]?.complianceRate || metrics.complianceRate;
    const changePercentage = metrics.complianceRate - previousRate;

    let direction = 'STABLE';
    let analysis = 'Compliance rate is stable';

    if (changePercentage > 5) {
      direction = 'IMPROVING';
      analysis = `Compliance rate improved by ${changePercentage.toFixed(1)}% compared to last week`;
    } else if (changePercentage < -5) {
      direction = 'DECLINING';
      analysis = `Compliance rate declined by ${Math.abs(changePercentage).toFixed(1)}% compared to last week`;
    }

    return {
      direction,
      changePercentage,
      previousRate,
      analysis,
    };
  }

  /**
   * Generate recommendations based on metrics
   */
  generateRecommendations(metrics, riskMatrix, trend) {
    const recommendations = [];

    // Compliance rate recommendations
    if (metrics.complianceRate < 50) {
      recommendations.push({
        priority: 'CRITICAL',
        category: 'Compliance Rate',
        recommendation: 'Compliance rate is critically low. Allocate emergency resources immediately.',
        action: 'Schedule emergency meeting with compliance team',
      });
    } else if (metrics.complianceRate < 70) {
      recommendations.push({
        priority: 'HIGH',
        category: 'Compliance Rate',
        recommendation: 'Compliance rate needs improvement. Increase focus on task completion.',
        action: 'Review task priorities and resource allocation',
      });
    }

    // Risk score recommendations
    if (metrics.riskScore > 20) {
      recommendations.push({
        priority: 'HIGH',
        category: 'Risk Management',
        recommendation: 'Risk score is elevated. Escalate high-risk tasks to management.',
        action: 'Implement risk mitigation plan for high-risk tasks',
      });
    }

    // Critical tasks recommendations
    if (riskMatrix.critical > 0) {
      recommendations.push({
        priority: 'CRITICAL',
        category: 'Critical Tasks',
        recommendation: `${riskMatrix.critical} tasks are 30+ days overdue. Immediate action required.`,
        action: 'Escalate to C-suite and implement crisis management',
      });
    }

    // Trend recommendations
    if (trend.direction === 'DECLINING') {
      recommendations.push({
        priority: 'HIGH',
        category: 'Trend Analysis',
        recommendation: 'Compliance trend is declining. Investigate root causes.',
        action: 'Conduct compliance trend analysis and identify issues',
      });
    } else if (trend.direction === 'IMPROVING') {
      recommendations.push({
        priority: 'LOW',
        category: 'Positive Trend',
        recommendation: 'Compliance trend is improving. Continue current efforts.',
        action: 'Maintain current resource allocation and monitoring',
      });
    }

    // Forecast recommendations
    if (metrics.forecast < metrics.complianceRate) {
      recommendations.push({
        priority: 'MEDIUM',
        category: 'Forecasting',
        recommendation: 'Projected compliance rate will decrease. Adjust resource allocation.',
        action: 'Review task pipeline and adjust resources accordingly',
      });
    }

    return recommendations;
  }

  /**
   * Identify top issues
   */
  identifyTopIssues(tasks, metrics) {
    const issues = [];

    // Precompute daysOverdue so the sort comparator and loop below
    // don't each re-parse the due date per task.
    const mostOverdue = tasks
      .filter(t => t.status !== 'completed')
      .map(t => ({ task: t, daysOverdue: this.calculateDaysOverdue(t) }))
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
      .slice(0, 5);

    for (const { task, daysOverdue } of mostOverdue) {
      issues.push({
        issue: `Task overdue: ${task.title}`,
        daysOverdue,
        priority: daysOverdue > 30 ? 'CRITICAL' : 'HIGH',
        assignee: task.assignee_id,
      });
    }

    // Identify unassigned tasks
    const unassigned = tasks.filter(t => !t.assignee_id && t.status !== 'completed');
    if (unassigned.length > 0) {
      issues.push({
        issue: `${unassigned.length} tasks are unassigned`,
        count: unassigned.length,
        priority: 'HIGH',
      });
    }

    // Identify incomplete documentation
    const incompleteDoc = tasks.filter(t => 
      (!t.description || t.description.length < 100) && t.status !== 'completed'
    );
    if (incompleteDoc.length > 0) {
      issues.push({
        issue: `${incompleteDoc.length} tasks have incomplete documentation`,
        count: incompleteDoc.length,
        priority: 'MEDIUM',
      });
    }

    return issues;
  }

  /**
   * Generate action items
   */
  generateActionItems(riskMatrix, metrics) {
    const actionItems = [];

    if (riskMatrix.critical > 0) {
      actionItems.push({
        priority: 'CRITICAL',
        action: `Address ${riskMatrix.critical} critical tasks`,
        owner: 'CRO',
        dueDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), // Tomorrow
        status: 'OPEN',
      });
    }

    if (riskMatrix.high > 0) {
      actionItems.push({
        priority: 'HIGH',
        action: `Address ${riskMatrix.high} high-risk tasks`,
        owner: 'Compliance Manager',
        dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
        status: 'OPEN',
      });
    }

    if (metrics.complianceRate < 70) {
      actionItems.push({
        priority: 'HIGH',
        action: 'Improve compliance rate to 70%+',
        owner: 'Compliance Team',
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 2 weeks
        status: 'OPEN',
      });
    }

    return actionItems;
  }

  /**
   * Analyze compliance by category
   */
  analyzeComplianceByCategory(tasks) {
    const categories = {};

    for (const task of tasks) {
      const category = task.category || 'Other';
      if (!categories[category]) {
        categories[category] = {
          total: 0,
          completed: 0,
          inProgress: 0,
          overdue: 0,
        };
      }

      categories[category].total++;

      if (task.status === 'completed') {
        categories[category].completed++;
      } else if (task.status === 'in_progress') {
        categories[category].inProgress++;
      }

      if (this.calculateDaysOverdue(task) > 0) {
        categories[category].overdue++;
      }
    }

    // Calculate percentages
    for (const category in categories) {
      const cat = categories[category];
      cat.completionRate = ((cat.completed / cat.total) * 100).toFixed(1);
      cat.overdueRate = ((cat.overdue / cat.total) * 100).toFixed(1);
    }

    return categories;
  }

  /**
   * Analyze team performance
   */
  analyzeTeamPerformance(tasks) {
    const teamMembers = {};

    for (const task of tasks) {
      const assignee = task.assignee_id || 'Unassigned';
      if (!teamMembers[assignee]) {
        teamMembers[assignee] = {
          total: 0,
          completed: 0,
          inProgress: 0,
          overdue: 0,
        };
      }

      teamMembers[assignee].total++;

      if (task.status === 'completed') {
        teamMembers[assignee].completed++;
      } else if (task.status === 'in_progress') {
        teamMembers[assignee].inProgress++;
      }

      if (this.calculateDaysOverdue(task) > 0) {
        teamMembers[assignee].overdue++;
      }
    }

    // Calculate percentages and sort by performance. Keep a numeric
    // copy of the rate for the sort so two members with e.g. 9.9%
    // vs 10.1% don't get compared lexicographically via their
    // toFixed-derived strings.
    const performance = [];
    for (const member in teamMembers) {
      const tm = teamMembers[member];
      const rateNum = tm.total > 0 ? (tm.completed / tm.total) * 100 : 0;
      performance.push({
        member,
        total: tm.total,
        completed: tm.completed,
        inProgress: tm.inProgress,
        overdue: tm.overdue,
        completionRate: rateNum.toFixed(1),
        _rate: rateNum,
      });
    }

    return performance
      .sort((a, b) => b._rate - a._rate)
      .map(({ _rate, ...row }) => row);
  }

  /**
   * Analyze regulatory framework status
   */
  analyzeRegulatoryStatus(tasks) {
    const frameworks = {
      SOX: { total: 0, completed: 0, overdue: 0 },
      HIPAA: { total: 0, completed: 0, overdue: 0 },
      GDPR: { total: 0, completed: 0, overdue: 0 },
      Other: { total: 0, completed: 0, overdue: 0 },
    };

    for (const task of tasks) {
      const framework = task.regulatoryFramework || 'Other';
      if (!frameworks[framework]) {
        frameworks[framework] = { total: 0, completed: 0, overdue: 0 };
      }

      frameworks[framework].total++;

      if (task.status === 'completed') {
        frameworks[framework].completed++;
      }

      if (this.calculateDaysOverdue(task) > 0) {
        frameworks[framework].overdue++;
      }
    }

    // Calculate compliance rates
    for (const framework in frameworks) {
      const fw = frameworks[framework];
      fw.complianceRate = fw.total > 0 ? ((fw.completed / fw.total) * 100).toFixed(1) : 0;
    }

    return frameworks;
  }

  /**
   * Generate next steps
   */
  generateNextSteps(metrics, riskMatrix) {
    const nextSteps = [];

    // Immediate actions
    if (riskMatrix.critical > 0) {
      nextSteps.push({
        timeframe: 'IMMEDIATE (Today)',
        actions: [
          'Escalate critical tasks to C-suite',
          'Schedule emergency compliance meeting',
          'Allocate emergency resources',
          'Implement crisis management protocol',
        ],
      });
    }

    // Short-term actions
    if (riskMatrix.high > 0 || metrics.complianceRate < 70) {
      nextSteps.push({
        timeframe: 'SHORT-TERM (This Week)',
        actions: [
          'Escalate high-risk tasks to management',
          'Review resource allocation',
          'Implement action plan for compliance improvement',
          'Conduct team meeting to discuss priorities',
        ],
      });
    }

    // Medium-term actions
    nextSteps.push({
      timeframe: 'MEDIUM-TERM (This Month)',
      actions: [
        'Monitor compliance progress',
        'Track metric trends',
        'Prepare for regulatory audit',
        'Document remediation efforts',
      ],
    });

    // Long-term actions
    nextSteps.push({
      timeframe: 'LONG-TERM (Ongoing)',
      actions: [
        'Maintain compliance rate above 90%',
        'Continuously improve processes',
        'Enhance team training and awareness',
        'Strengthen compliance culture',
      ],
    });

    return nextSteps;
  }

  /**
   * Get historical metrics
   */
  async getHistoricalMetrics(projectId, days = 30) {
    // This would retrieve historical data from database
    // For now, return empty arrays
    return {
      last7Days: [],
      last30Days: [],
    };
  }

  /**
   * Save report to file
   */
  async saveReport(report, projectId) {
    const span = this.tracer.startSpan('save_report');

    try {
      // Sanitize projectId so an external caller cannot escape the
      // reports root via "../" segments.
      const safeProjectId = safePathSegment(projectId);
      const reportsRoot = path.resolve(process.cwd(), 'reports');
      const reportsDir = path.resolve(reportsRoot, safeProjectId);
      if (!reportsDir.startsWith(reportsRoot + path.sep) && reportsDir !== reportsRoot) {
        throw new Error(`Refusing to write report outside reports directory: ${reportsDir}`);
      }
      fs.mkdirSync(reportsDir, { recursive: true });

      const fileName = `compliance-report-${report.reportDate.toISOString().split('T')[0]}.json`;
      const filePath = path.join(reportsDir, fileName);

      // Save JSON report
      fs.writeFileSync(filePath, JSON.stringify(report, null, 2));

      // Generate HTML report
      const htmlReport = this.generateHTMLReport(report);
      const htmlFilePath = filePath.replace('.json', '.html');
      fs.writeFileSync(htmlFilePath, htmlReport);

      this.logger.info('Report saved', { filePath, htmlFilePath });
      span.finish();

      return filePath;
    } catch (error) {
      this.logger.error('Failed to save report', { error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * Generate HTML report
   */
  generateHTMLReport(report) {
    // Every operator-controlled string is escaped before it lands in
    // the template. Asana project names, task titles, recommendation
    // text and next-step actions are all externally editable, so any
    // one of them could inject markup or a <script> that survives
    // the email client if left raw.
    const summary = report.executiveSummary || {};
    const metrics = report.metrics || {};
    const risk = report.riskMatrix || {
      critical: { count: 0, percentage: '0.0' },
      high: { count: 0, percentage: '0.0' },
      medium: { count: 0, percentage: '0.0' },
      low: { count: 0, percentage: '0.0' },
    };
    const trend = report.trend || {};
    const status = String(summary.overallStatus || 'UNKNOWN').toLowerCase();
    const safeStatusClass = status.replace(/[^a-z-]/g, '');
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(summary.title)}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 20px;
      background-color: #f5f5f5;
    }
    .header {
      background-color: #1a1a1a;
      color: white;
      padding: 20px;
      border-radius: 5px;
      margin-bottom: 20px;
    }
    .section {
      background-color: white;
      padding: 20px;
      margin-bottom: 20px;
      border-radius: 5px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .metric {
      display: inline-block;
      width: 23%;
      margin: 1%;
      padding: 15px;
      background-color: #f9f9f9;
      border-left: 4px solid #007bff;
      border-radius: 3px;
    }
    .metric-value {
      font-size: 28px;
      font-weight: bold;
      color: #007bff;
    }
    .metric-label {
      font-size: 12px;
      color: #666;
      margin-top: 5px;
    }
    .status-excellent { color: #28a745; }
    .status-good { color: #17a2b8; }
    .status-fair { color: #ffc107; }
    .status-poor { color: #fd7e14; }
    .status-critical { color: #dc3545; }
    .risk-critical { background-color: #f8d7da; border-left-color: #dc3545; }
    .risk-high { background-color: #fff3cd; border-left-color: #ffc107; }
    .risk-medium { background-color: #d1ecf1; border-left-color: #17a2b8; }
    .risk-low { background-color: #d4edda; border-left-color: #28a745; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    th, td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }
    th {
      background-color: #f9f9f9;
      font-weight: bold;
    }
    .recommendation {
      padding: 10px;
      margin: 5px 0;
      border-left: 4px solid #007bff;
      background-color: #f0f7ff;
    }
    .recommendation.critical { border-left-color: #dc3545; background-color: #f8d7da; }
    .recommendation.high { border-left-color: #ffc107; background-color: #fff3cd; }
    .recommendation.medium { border-left-color: #17a2b8; background-color: #d1ecf1; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(summary.title)}</h1>
    <p>Generated: ${escapeHtml(summary.date)}</p>
    <p>Project: ${escapeHtml(report.projectName)}</p>
  </div>

  <div class="section">
    <h2>Executive Summary</h2>
    <p>Overall Status: <strong class="status-${safeStatusClass}">${escapeHtml(summary.overallStatus)}</strong></p>

    <div class="metric">
      <div class="metric-value">${escapeHtml(metrics.complianceRate)}%</div>
      <div class="metric-label">Compliance Rate</div>
    </div>
    <div class="metric">
      <div class="metric-value">${escapeHtml(metrics.healthScore)}</div>
      <div class="metric-label">Health Score</div>
    </div>
    <div class="metric">
      <div class="metric-value">${escapeHtml(metrics.riskScore)}%</div>
      <div class="metric-label">Risk Score</div>
    </div>
    <div class="metric">
      <div class="metric-value">${escapeHtml(metrics.completedTasks)}/${escapeHtml(metrics.totalTasks)}</div>
      <div class="metric-label">Tasks Completed</div>
    </div>
  </div>

  <div class="section">
    <h2>Risk Matrix</h2>
    <table>
      <tr>
        <th>Risk Level</th>
        <th>Count</th>
        <th>Percentage</th>
      </tr>
      <tr class="risk-critical">
        <td>Critical (30+ days)</td>
        <td>${escapeHtml(risk.critical.count)}</td>
        <td>${escapeHtml(risk.critical.percentage)}%</td>
      </tr>
      <tr class="risk-high">
        <td>High (14-29 days)</td>
        <td>${escapeHtml(risk.high.count)}</td>
        <td>${escapeHtml(risk.high.percentage)}%</td>
      </tr>
      <tr class="risk-medium">
        <td>Medium (7-13 days)</td>
        <td>${escapeHtml(risk.medium.count)}</td>
        <td>${escapeHtml(risk.medium.percentage)}%</td>
      </tr>
      <tr class="risk-low">
        <td>Low (0-6 days)</td>
        <td>${escapeHtml(risk.low.count)}</td>
        <td>${escapeHtml(risk.low.percentage)}%</td>
      </tr>
    </table>
  </div>

  <div class="section">
    <h2>Trend Analysis</h2>
    <p>Direction: <strong>${escapeHtml(trend.direction)}</strong></p>
    <p>Change: ${escapeHtml(trend.changePercentage)}% (Previous: ${escapeHtml(trend.previousRate)}%, Current: ${escapeHtml(trend.currentRate)}%)</p>
    <p>30-Day Forecast: ${escapeHtml(trend.forecast30Days)}%</p>
    <p>Analysis: ${escapeHtml(trend.analysis)}</p>
  </div>

  <div class="section">
    <h2>Recommendations</h2>
    ${(report.recommendations || []).map(rec => {
      const priority = String(rec.priority || '').toLowerCase().replace(/[^a-z]/g, '');
      return `
      <div class="recommendation ${priority}">
        <strong>[${escapeHtml(rec.priority)}] ${escapeHtml(rec.category)}</strong><br>
        ${escapeHtml(rec.recommendation)}<br>
        <em>Action: ${escapeHtml(rec.action)}</em>
      </div>
    `;
    }).join('')}
  </div>

  <div class="section">
    <h2>Top Issues</h2>
    <table>
      <tr>
        <th>Issue</th>
        <th>Priority</th>
        <th>Details</th>
      </tr>
      ${(report.topIssues || []).map(issue => `
        <tr>
          <td>${escapeHtml(issue.issue)}</td>
          <td>${escapeHtml(issue.priority)}</td>
          <td>${escapeHtml(issue.daysOverdue ? issue.daysOverdue + ' days overdue' : issue.count ? issue.count + ' items' : '')}</td>
        </tr>
      `).join('')}
    </table>
  </div>

  <div class="section">
    <h2>Next Steps</h2>
    ${(report.nextSteps || []).map(step => `
      <h3>${escapeHtml(step.timeframe)}</h3>
      <ul>
        ${(step.actions || []).map(action => `<li>${escapeHtml(action)}</li>`).join('')}
      </ul>
    `).join('')}
  </div>

  <div class="section" style="text-align: center; color: #666; font-size: 12px;">
    <p>This report was automatically generated by ASANA Brain Compliance Intelligence System</p>
    <p>Generated: ${escapeHtml(new Date().toISOString())}</p>
  </div>
</body>
</html>
    `;
  }

  /**
   * Distribute report via multiple channels
   */
  async distributeReport(report, reportPath, recipients = {}) {
    const span = this.tracer.startSpan('distribute_report');
    const distribution = {};

    try {
      // Email distribution
      if (recipients.email && recipients.email.length > 0) {
        distribution.email = await this.sendEmailReport(report, reportPath, recipients.email);
      }

      // Slack distribution
      if (recipients.slack && recipients.slack.length > 0) {
        distribution.slack = await this.sendSlackReport(report, recipients.slack);
      }

      // Dashboard distribution
      if (recipients.dashboard) {
        distribution.dashboard = await this.sendDashboardReport(report);
      }

      // Asana distribution
      if (recipients.asana) {
        distribution.asana = await this.sendAsanaReport(report);
      }

      this.logger.info('Report distributed', { distribution });
      span.finish();

      return distribution;
    } catch (error) {
      this.logger.error('Failed to distribute report', { error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * Send report via email
   */
  async sendEmailReport(report, reportPath, recipients) {
    try {
      const htmlContent = fs.readFileSync(reportPath.replace('.json', '.html'), 'utf-8');

      const mailOptions = {
        from: this.config.emailConfig?.from || 'compliance@company.com',
        to: recipients.join(','),
        subject: `Daily Compliance Status Report - ${report.projectName} - ${report.reportDate.toLocaleDateString()}`,
        html: htmlContent,
        attachments: [
          {
            filename: `compliance-report-${report.reportDate.toISOString().split('T')[0]}.json`,
            path: reportPath,
          },
        ],
      };

      await this.emailTransporter.sendMail(mailOptions);

      this.logger.info('Email report sent', { recipients, count: recipients.length });
      return { success: true, recipients: recipients.length };
    } catch (error) {
      this.logger.error('Failed to send email report', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Send report via Slack
   */
  async sendSlackReport(report, slackChannels) {
    try {
      const message = {
        text: `Daily Compliance Status Report - ${report.projectName}`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `📊 Daily Compliance Report - ${report.projectName}`,
            },
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Compliance Rate:*\n${report.metrics.complianceRate}%`,
              },
              {
                type: 'mrkdwn',
                text: `*Health Score:*\n${report.metrics.healthScore}`,
              },
              {
                type: 'mrkdwn',
                text: `*Risk Score:*\n${report.metrics.riskScore}%`,
              },
              {
                type: 'mrkdwn',
                text: `*Status:*\n${report.executiveSummary.overallStatus}`,
              },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Risk Matrix:*\n🔴 Critical: ${report.riskMatrix.critical.count} | 🟠 High: ${report.riskMatrix.high.count} | 🟡 Medium: ${report.riskMatrix.medium.count} | 🟢 Low: ${report.riskMatrix.low.count}`,
            },
          },
        ],
      };

      for (const channel of slackChannels) {
        await axios.post(channel, message);
      }

      this.logger.info('Slack report sent', { channels: slackChannels.length });
      return { success: true, channels: slackChannels.length };
    } catch (error) {
      this.logger.error('Failed to send Slack report', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Send report to dashboard
   */
  async sendDashboardReport(report) {
    try {
      await this.dashboardService.updateWidget('daily-report', {
        report,
        timestamp: new Date(),
      });

      this.logger.info('Dashboard report updated');
      return { success: true };
    } catch (error) {
      this.logger.error('Failed to update dashboard', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Send report to Asana
   */
  async sendAsanaReport(report) {
    try {
      // Asana's createTask accepts `notes` / `html_notes`, not
      // `description` — passing `description` silently drops the
      // body. Keep the notes compact so the payload always fits
      // inside Asana's field limit; the full JSON is attached
      // separately via email.
      const summary = report.executiveSummary || {};
      const metrics = report.metrics || {};
      const notes = [
        `Daily Compliance Report — ${report.projectName}`,
        `Generated: ${report.generatedAt && report.generatedAt.toISOString ? report.generatedAt.toISOString() : ''}`,
        `Overall status: ${summary.overallStatus}`,
        `Compliance rate: ${metrics.complianceRate}%`,
        `Health score: ${metrics.healthScore}`,
        `Risk score: ${metrics.riskScore}%`,
      ].join('\n');

      const task = await this.asanaClient.createTask({
        projects: [report.projectId],
        name: `Daily Compliance Report - ${report.reportDate.toLocaleDateString()}`,
        notes,
        custom_fields: {
          'Report Type': 'Daily Compliance',
          'Compliance Rate': report.metrics.complianceRate,
          'Health Score': report.metrics.healthScore,
        },
      });

      this.logger.info('Asana report task created', { taskId: task.id });
      return { success: true, taskId: task.id };
    } catch (error) {
      this.logger.error('Failed to create Asana report task', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Stop daily report generation
   */
  stopDaily(projectId) {
    if (this.reportSchedules.has(projectId)) {
      this.reportSchedules.get(projectId).stop();
      this.reportSchedules.delete(projectId);

      this.logger.info('Daily compliance report stopped', { projectId });
      return { success: true, message: 'Daily compliance report stopped' };
    }

    return { success: false, message: 'No active schedule found' };
  }

  /**
   * Generate report on-demand
   */
  async generateOnDemand(projectId, recipients = {}) {
    return await this.generateAndDistributeReport(projectId, recipients);
  }
}

module.exports = DailyComplianceReportSystem;
