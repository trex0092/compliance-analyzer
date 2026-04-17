# Automated Daily Compliance Report Generator - Setup Guide

## Overview

The **Automated Daily Compliance Report Generator** automatically generates professional compliance reports every day at 8:00 AM UTC using enterprise-grade templates with real-time data from Asana.

**Key Features**:
- ✅ Automatic daily generation at 8:00 AM UTC
- ✅ Professional HTML/CSS templates (Refinitiv-inspired)
- ✅ Real-time data integration from Asana
- ✅ Multi-channel distribution (Email, Slack, Dashboard, Asana)
- ✅ PDF export support
- ✅ Execution history tracking
- ✅ Error handling and retry logic
- ✅ On-demand report generation
- ✅ Customizable per project

---

## Installation

### 1. Install Dependencies

```bash
cd /home/ubuntu/compliance-analyzer
npm install nodemailer slack-sdk puppeteer
```

### 2. Load the Module

```javascript
const AutomatedDailyReportGenerator = require('./automated-daily-report-generator');
```

---

## Configuration

### Basic Configuration

```javascript
const config = {
  logger: loggerService,           // Logger instance
  tracer: tracingService,          // Tracing instance
  metrics: metricsService,         // Metrics instance
  asanaClient: asanaClient,        // Asana API client
  emailService: emailService,      // Email service
  slackService: slackService,      // Slack service
  dashboardService: dashboardService, // Dashboard service
  storageService: storageService,  // Storage service
};

const generator = new AutomatedDailyReportGenerator(config);
await generator.initialize();
```

### Project-Specific Configuration

```javascript
const projectConfig = {
  // Project metadata
  organization: 'Global Finance Corp',
  category: 'financial',  // 'financial', 'data_protection', 'regulatory', etc.
  
  // Distribution channels
  email: ['cfo@company.com', 'compliance@company.com'],
  slack: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL',
  dashboard: true,
  asana: true,
  
  // Report settings
  includeTeamMetrics: true,
  includeRiskMatrix: true,
  includeRecommendations: true,
  includeAuditTrail: true,
  
  // Metrics to include
  metrics: [
    'compliance_rate',
    'health_score',
    'risk_score',
    'velocity',
    'team_performance',
  ],
};

// Schedule daily reports
generator.scheduleDaily('project-id', projectConfig);
```

---

## Usage

### Schedule Daily Reports

```javascript
// Schedule for a single project
generator.scheduleDaily('project-123', {
  organization: 'Global Finance Corp',
  category: 'financial',
  email: ['cfo@company.com'],
  slack: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL',
  dashboard: true,
  asana: true,
});

// Schedule for multiple projects
const projects = [
  { id: 'project-123', name: 'Financial Compliance' },
  { id: 'project-456', name: 'Data Protection' },
  { id: 'project-789', name: 'Regulatory Compliance' },
];

for (const project of projects) {
  generator.scheduleDaily(project.id, {
    organization: 'Global Finance Corp',
    category: project.name.toLowerCase().replace(' ', '_'),
    email: ['compliance@company.com'],
    slack: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL',
    dashboard: true,
    asana: true,
  });
}
```

### Generate On-Demand Reports

```javascript
// Generate report immediately
const result = await generator.generateOnDemand('project-123', {
  organization: 'Global Finance Corp',
  category: 'financial',
  email: ['cfo@company.com'],
});

console.log('Report generated:', result.reportPath);
console.log('Distribution:', result.distribution);
```

### Stop Daily Reports

```javascript
// Stop reports for a project
generator.stopDaily('project-123');

// Stop all reports
for (const projectId of generator.scheduledReports.keys()) {
  generator.stopDaily(projectId);
}
```

### Check System Status

```javascript
const status = generator.getStatus();
console.log(status);

// Output:
// {
//   status: 'running',
//   scheduledProjects: ['project-123', 'project-456'],
//   totalScheduled: 2,
//   totalExecutions: 45,
//   successfulExecutions: 44,
//   failedExecutions: 1,
//   lastExecution: { ... }
// }
```

### View Execution History

```javascript
// Get execution history for all projects
const history = generator.getExecutionHistory();

// Get execution history for specific project
const projectHistory = generator.getExecutionHistory('project-123', 10);

console.log(projectHistory);
```

---

## Report Generation Flow

### 1. Daily Execution (8:00 AM UTC)

```
┌─────────────────────────────────────┐
│  Daily Scheduler Triggers (8:00 AM) │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  For Each Scheduled Project:        │
│  1. Fetch project data from Asana   │
│  2. Calculate compliance metrics    │
│  3. Generate HTML report            │
│  4. Convert to PDF                  │
│  5. Distribute to channels          │
│  6. Record execution history        │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Distribution Channels:             │
│  • Email (HTML + PDF attachment)    │
│  • Slack (Formatted message)        │
│  • Dashboard (Widget update)        │
│  • Asana (Task creation)            │
└─────────────────────────────────────┘
```

### 2. Data Collection

```javascript
// Fetch from Asana
const projectData = await asanaClient.getProject(projectId);
const tasks = await asanaClient.getProjectTasks(projectId);

// Calculate metrics
const metrics = {
  totalTasks: 100,
  completedTasks: 89,
  overdueTasks: 11,
  complianceRate: 89%,
  healthScore: 82,
  riskScore: 8.3%,
  criticalTasks: 1,
  highTasks: 3,
  mediumTasks: 7,
  lowTasks: 89,
};
```

### 3. Report Generation

```javascript
// Load template
const template = loadTemplate('financial');

// Replace placeholders
const html = template
  .replace('[PROJECT_NAME]', projectData.name)
  .replace('[COMPLIANCE_RATE]', metrics.complianceRate)
  .replace('[HEALTH_SCORE]', metrics.healthScore)
  // ... more replacements

// Convert to PDF
const pdfPath = await convertToPDF(html, projectId);
```

### 4. Distribution

```javascript
// Email
await emailService.sendReport({
  to: config.email,
  subject: 'Compliance Status Report - 2026-05-01',
  htmlContent: html,
  attachments: [{ path: pdfPath }],
});

// Slack
await slackService.sendReport({
  webhook: config.slack,
  message: '📊 Daily Compliance Report Generated',
  reportPath: pdfPath,
});

// Dashboard
await dashboardService.updateWidget({
  projectId,
  reportPath: pdfPath,
  metrics: metrics,
});

// Asana
await asanaClient.createTask({
  projects: [projectId],
  name: 'Daily Compliance Report - 2026-05-01',
  notes: `Report generated and distributed. Path: ${pdfPath}`,
});
```

---

## Email Configuration

### Gmail (with App Password)

```javascript
const emailService = {
  service: 'gmail',
  auth: {
    user: 'your-email@gmail.com',
    pass: 'your-app-password', // Generate at: https://myaccount.google.com/apppasswords
  },
};
```

### Office 365

```javascript
const emailService = {
  host: 'smtp.office365.com',
  port: 587,
  secure: false,
  auth: {
    user: 'your-email@company.com',
    pass: 'your-password',
  },
};
```

### Custom SMTP

```javascript
const emailService = {
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  auth: {
    user: 'username',
    pass: 'password',
  },
};
```

---

## Slack Configuration

### Create Incoming Webhook

1. Go to: https://api.slack.com/apps
2. Create New App → From scratch
3. App name: "ASANA Brain Reports"
4. Select workspace
5. Go to "Incoming Webhooks"
6. Click "Add New Webhook to Workspace"
7. Select channel: #compliance-reports
8. Copy webhook URL

### Configure in Code

```javascript
const slackConfig = {
  webhook: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX',
};
```

---

## Report Templates

### Available Templates

1. **Financial Compliance** - For financial reconciliation tasks
2. **Data Protection** - For privacy and data protection tasks
3. **Regulatory Compliance** - For regulatory requirements
4. **Operational Compliance** - For operational controls
5. **Custom** - Create your own template

### Template Placeholders

```html
<!-- Project Information -->
[PROJECT_NAME]
[ORGANIZATION_NAME]
[REPORT_DATE]

<!-- Metrics -->
[COMPLIANCE_RATE]
[HEALTH_SCORE]
[RISK_SCORE]
[VELOCITY]

<!-- Task Counts -->
[COMPLETED_TASKS]
[TOTAL_TASKS]
[COMPLETION_RATE]
[CRITICAL_COUNT]
[HIGH_COUNT]
[MEDIUM_COUNT]
[LOW_COUNT]

<!-- Percentages -->
[CRITICAL_PERCENT]
[HIGH_PERCENT]
[MEDIUM_PERCENT]
[LOW_PERCENT]

<!-- Timestamps -->
[PRINT_DATE]
```

---

## Monitoring & Troubleshooting

### Check Execution History

```javascript
const history = generator.getExecutionHistory();

for (const execution of history) {
  console.log(`Execution ID: ${execution.executionId}`);
  console.log(`Timestamp: ${execution.timestamp}`);
  console.log(`Status: ${execution.status}`);
  console.log(`Results:`, execution.results);
}
```

### Common Issues

**Issue**: Reports not generating at 8:00 AM
- **Solution**: Check system timezone. Ensure server time is correct.
- **Command**: `date` to verify current time

**Issue**: Email not sending
- **Solution**: Verify email credentials and SMTP settings
- **Check**: `npm test` to run email service tests

**Issue**: Slack messages not appearing
- **Solution**: Verify webhook URL and channel permissions
- **Check**: Test webhook manually: `curl -X POST -H 'Content-type: application/json' --data '{"text":"Test"}' YOUR_WEBHOOK_URL`

**Issue**: Reports incomplete or missing data
- **Solution**: Check Asana API connectivity and project permissions
- **Check**: Verify Asana PAT token is valid

### Enable Debug Logging

```javascript
const config = {
  ...otherConfig,
  logLevel: 'debug',  // 'error', 'warn', 'info', 'debug'
};

const generator = new AutomatedDailyReportGenerator(config);
```

---

## Performance Optimization

### Batch Processing

```javascript
// Process multiple projects in parallel
const projectIds = ['project-1', 'project-2', 'project-3'];
await Promise.all(
  projectIds.map(id => generator.generateOnDemand(id, config))
);
```

### Caching

```javascript
// Cache project data to reduce API calls
const projectCache = new Map();
const cacheExpiry = 60 * 60 * 1000; // 1 hour

async function getCachedProject(projectId) {
  const cached = projectCache.get(projectId);
  if (cached && Date.now() - cached.timestamp < cacheExpiry) {
    return cached.data;
  }
  
  const data = await asanaClient.getProject(projectId);
  projectCache.set(projectId, { data, timestamp: Date.now() });
  return data;
}
```

### Scheduling

```javascript
// Stagger report generation to avoid resource spikes
const projects = ['project-1', 'project-2', 'project-3'];
const delayBetweenReports = 5 * 60 * 1000; // 5 minutes

for (let i = 0; i < projects.length; i++) {
  setTimeout(() => {
    generator.scheduleDaily(projects[i], config);
  }, i * delayBetweenReports);
}
```

---

## Best Practices

1. **Test Before Deployment**
   - Generate on-demand report first
   - Verify email/Slack delivery
   - Check report quality

2. **Monitor Execution**
   - Check execution history regularly
   - Set up alerts for failures
   - Review metrics trends

3. **Maintain Templates**
   - Keep templates updated
   - Test template changes
   - Version control templates

4. **Secure Credentials**
   - Use environment variables for secrets
   - Rotate API tokens regularly
   - Never commit credentials to Git

5. **Optimize Performance**
   - Cache frequently accessed data
   - Batch process multiple projects
   - Monitor resource usage

---

## Complete Example

```javascript
const AutomatedDailyReportGenerator = require('./automated-daily-report-generator');

// Initialize services
const logger = new LoggerService();
const tracer = new TracingService();
const metrics = new MetricsService();
const asanaClient = new AsanaAPIClient(process.env.ASANA_PAT);
const emailService = new EmailService(process.env.SMTP_CONFIG);
const slackService = new SlackService();
const dashboardService = new DashboardService();

// Create generator
const generator = new AutomatedDailyReportGenerator({
  logger,
  tracer,
  metrics,
  asanaClient,
  emailService,
  slackService,
  dashboardService,
});

// Initialize
await generator.initialize();

// Schedule reports for multiple projects
const projects = [
  {
    id: 'financial-2026',
    organization: 'Global Finance Corp',
    category: 'financial',
    email: ['cfo@company.com', 'compliance@company.com'],
    slack: process.env.SLACK_WEBHOOK,
    dashboard: true,
    asana: true,
  },
  {
    id: 'data-protection-2026',
    organization: 'TechCorp International',
    category: 'data_protection',
    email: ['cpo@company.com'],
    slack: process.env.SLACK_WEBHOOK,
    dashboard: true,
    asana: true,
  },
];

for (const project of projects) {
  generator.scheduleDaily(project.id, project);
  console.log(`✅ Scheduled daily reports for: ${project.id}`);
}

// Check status
const status = generator.getStatus();
console.log('Generator Status:', status);

// Shutdown on process exit
process.on('SIGINT', () => {
  generator.shutdown();
  process.exit(0);
});
```

---

## Support

For issues or questions:
1. Check execution history: `generator.getExecutionHistory()`
2. Review logs: Check logger output
3. Test on-demand: `generator.generateOnDemand(projectId, config)`
4. Verify configuration: Check all service connections

---

**Status**: ✅ Production Ready
**Last Updated**: May 1, 2026
**Version**: 1.0.0
