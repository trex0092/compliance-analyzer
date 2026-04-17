/**
 * Daily Compliance Reporter Configuration
 * Configure automatic daily compliance reports
 */

module.exports = {
  // Report generation time (24-hour format)
  reportTime: '09:00', // 9 AM daily

  // Email recipients for daily reports
  recipients: [
    'compliance-officer@company.com',
    'risk-manager@company.com',
    'compliance-team@company.com',
  ],

  // Slack webhook for notifications
  slackWebhook: process.env.SLACK_WEBHOOK_URL || null,

  // Google Drive folder ID for archiving reports
  googleDriveFolder: process.env.GOOGLE_DRIVE_FOLDER_ID || null,

  // Report format and content
  reportFormat: {
    includeExecutiveSummary: true,
    includeThreatAssessment: true,
    includePredictiveInsights: true,
    includeRecommendations: true,
    includeTeamPerformance: true,
    includeComplianceChecklist: true,
  },

  // Email template configuration
  emailConfig: {
    from: 'compliance-reports@company.com',
    subject: 'Daily Compliance Report - {DATE}',
    includeAttachments: true,
    attachmentFormat: 'pdf', // 'pdf' or 'xlsx'
  },

  // Slack notification configuration
  slackConfig: {
    channel: '#compliance-reports',
    mentionOnCritical: ['@compliance-officer', '@risk-manager'],
    includeChart: true,
  },

  // Database archival
  archiveConfig: {
    enabled: true,
    retentionDays: 365,
    compressAfterDays: 30,
  },

  // Alert thresholds
  alertThresholds: {
    criticalComplianceScore: 60,
    warningComplianceScore: 75,
    criticalThreatCount: 5,
    warningThreatCount: 3,
    criticalOverdueCount: 3,
    warningOverdueCount: 1,
  },

  // Advanced options
  advancedOptions: {
    enablePredictiveAlerts: true,
    enableAnomalyDetection: true,
    enableRiskForecasting: true,
    enableAutomationSuggestions: true,
    enableComplianceBenchmarking: true,
  },
};
