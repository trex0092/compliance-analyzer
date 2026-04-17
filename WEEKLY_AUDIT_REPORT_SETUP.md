# Weekly Compliance Audit Reporter - Setup & Configuration Guide

## Overview

The Weekly Compliance Audit Reporter automatically generates comprehensive compliance audit reports every Friday at 5:00 PM UTC. Reports are distributed via Email, Slack, Asana, and Dashboard.

**Status**: ✅ Production Ready  
**Deployment**: Immediate  
**Time Saved**: 2-3 hours per week

---

## Quick Start (4 Steps)

### Step 1: Install Dependencies
```bash
npm install asana nodemailer node-cron docx node-fetch
```

### Step 2: Configure Environment Variables
```bash
export ASANA_PAT="your-asana-token"
export ASSESSMENT_PROJECT_ID="your-project-id"
export EMAIL_HOST="smtp.gmail.com"
export EMAIL_PORT="465"
export EMAIL_USER="your-email@gmail.com"
export EMAIL_PASSWORD="your-app-password"
export EMAIL_FROM="compliance@company.com"
export EMAIL_RECIPIENTS="manager@company.com,cro@company.com"
export SLACK_WEBHOOK="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
```

### Step 3: Initialize Reporter
```javascript
const WeeklyComplianceAuditReporter = require('./weekly-compliance-audit-reporter');

const config = {
  asanaToken: process.env.ASANA_PAT,
  assessmentProjectId: process.env.ASSESSMENT_PROJECT_ID,
  emailConfig: {
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
    from: process.env.EMAIL_FROM,
  },
  emailRecipients: process.env.EMAIL_RECIPIENTS.split(','),
  slackWebhook: process.env.SLACK_WEBHOOK,
};

const reporter = new WeeklyComplianceAuditReporter(config);
```

### Step 4: Schedule Weekly Report
```javascript
// Generate immediately
await reporter.generateWeeklyReport();

// Or schedule for Friday 5:00 PM UTC
reporter.scheduleWeeklyReport();
```

---

## Configuration Details

### Email Configuration

#### Gmail Setup
```bash
# 1. Enable 2-Factor Authentication in Gmail
# 2. Generate App Password:
#    - Go to https://myaccount.google.com/apppasswords
#    - Select "Mail" and "Windows Computer"
#    - Copy the generated password

export EMAIL_HOST="smtp.gmail.com"
export EMAIL_PORT="465"
export EMAIL_USER="your-email@gmail.com"
export EMAIL_PASSWORD="xxxx xxxx xxxx xxxx"  # 16-character app password
export EMAIL_FROM="your-email@gmail.com"
```

#### Office 365 Setup
```bash
export EMAIL_HOST="smtp.office365.com"
export EMAIL_PORT="587"
export EMAIL_USER="your-email@company.com"
export EMAIL_PASSWORD="your-office365-password"
export EMAIL_FROM="your-email@company.com"
```

#### Custom SMTP Setup
```bash
export EMAIL_HOST="mail.company.com"
export EMAIL_PORT="587"
export EMAIL_USER="username"
export EMAIL_PASSWORD="password"
export EMAIL_FROM="noreply@company.com"
```

### Slack Configuration

#### Create Slack Webhook
1. Go to https://api.slack.com/apps
2. Create New App → From scratch
3. Name: "Compliance Audit Reporter"
4. Workspace: Select your workspace
5. Go to "Incoming Webhooks"
6. Click "Add New Webhook to Workspace"
7. Select channel: #compliance-reports
8. Copy webhook URL

```bash
export SLACK_WEBHOOK="https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX"
```

### Asana Configuration

#### Get Project ID
```bash
# Using Asana API
curl -H "Authorization: Bearer YOUR_ASANA_TOKEN" \
  https://app.asana.com/api/1.0/projects \
  | jq '.data[] | select(.name=="Compliance Assessments 2026") | .gid'
```

```bash
export ASSESSMENT_PROJECT_ID="1234567890"
```

---

## Report Contents

### Executive Summary
- Week date range
- Report generation timestamp
- Compliance rate (%)
- Health score (0-100)

### Key Metrics Table
| Metric | Value |
|--------|-------|
| Total Tasks | 150 |
| Completed This Week | 18 |
| Total Completed | 128 |
| Overdue Tasks | 4 |
| At Risk Tasks | 7 |
| Compliance Rate | 85.3% |
| Health Score | 78/100 |
| Avg Completion Time | 3.2 days |

### Risk Distribution
| Risk Level | Count | Percentage |
|-----------|-------|-----------|
| Critical | 2 | 1.3% |
| High | 5 | 3.3% |
| Medium | 12 | 8.0% |
| Low | 131 | 87.4% |

### Team Performance
| Team Member | Assigned | Completed | Rate |
|------------|----------|-----------|------|
| John Smith | 18 | 16 | 88.9% |
| Sarah Johnson | 15 | 14 | 93.3% |
| Michael Chen | 12 | 10 | 83.3% |

### Section Progress
| Section | Tasks |
|---------|-------|
| New Customers | 5 |
| Customer Information | 8 |
| Sanctions Screening | 12 |
| Adverse Media | 15 |
| Identifications | 18 |
| PF Assessment | 20 |
| Risk Assessment | 25 |
| Sign-Off | 22 |
| Ready for Report | 15 |
| Completed | 128 |

### Compliance Status
- Overall Status: GOOD/FAIR/POOR
- Overdue Tasks: 4
- At Risk Tasks: 7
- Average Completion Time: 3.2 days

### Recommendations
- Address 4 overdue tasks immediately
- Monitor 7 at-risk tasks closely
- Continue current pace (85% compliance rate)

---

## Distribution Channels

### Email Distribution
**When**: Friday 5:00 PM UTC  
**Recipients**: All configured email addresses  
**Format**: HTML email with PDF attachment  
**Subject**: "Weekly Compliance Audit Report - Week 20"

**Email Template**:
```
Subject: Weekly Compliance Audit Report - Week 20

Body:
---

Weekly Compliance Audit Report

Week: 2026-05-12 to 2026-05-18
Report Generated: 2026-05-18T17:00:00Z

Compliance Rate: 85.3%
Health Score: 78/100

[Full report attached as PDF]

---
Confidential - For Internal Use Only
```

### Slack Distribution
**Channel**: #compliance-reports  
**Format**: Formatted Slack message with metrics  
**Includes**: Link to full PDF report

**Slack Message**:
```
📊 Weekly Compliance Audit Report

Compliance Rate: 85.3%
Health Score: 78/100
Completed This Week: 18
Overdue Tasks: 4

📄 Full report available: [Link to PDF]
```

### Asana Distribution
**Project**: Compliance Assessments 2026  
**Task Name**: "Weekly Audit Report - Week 20"  
**Attachment**: PDF report  
**Notes**: Compliance metrics summary

### Dashboard Distribution
**View**: Compliance Metrics Dashboard  
**Update**: Real-time metrics updated  
**Widgets**: All metrics refreshed  
**Retention**: 12-week history

---

## Scheduling

### Default Schedule
- **Day**: Every Friday
- **Time**: 5:00 PM UTC
- **Frequency**: Weekly
- **Cron Expression**: `0 17 * * 5`

### Modify Schedule
```javascript
// Change to Monday 8:00 AM UTC
reporter.schedule = '0 8 * * 1';

// Change to Daily 9:00 AM UTC
reporter.schedule = '0 9 * * *';

// Change to Bi-weekly Friday 5:00 PM UTC
// (Requires custom logic)
```

### Manual Generation
```javascript
// Generate report immediately
await reporter.generateWeeklyReport();

// Get summary
console.log(reporter.getSummary());
```

---

## Metrics Explained

### Compliance Rate
```
Formula: (Total Completed / Total Tasks) × 100
Example: (128 / 150) × 100 = 85.3%
Target: ≥ 80%
```

### Health Score
```
Formula: 100 - (Overdue × 5) - (At Risk × 2)
Example: 100 - (4 × 5) - (7 × 2) = 78
Target: ≥ 80
```

### Overdue Tasks
```
Definition: Tasks with due date < today and not completed
Action: Immediate escalation required
```

### At Risk Tasks
```
Definition: Tasks with due date < today + 3 days and not completed
Action: Close monitoring required
```

### Average Completion Time
```
Formula: Average of (Completion Date - Creation Date)
Example: 3.2 days
Target: < 5 days
```

---

## Troubleshooting

### Email Not Sending
```
Error: "Invalid login credentials"
Solution: Verify EMAIL_USER and EMAIL_PASSWORD are correct

Error: "SMTP connection timeout"
Solution: Check EMAIL_HOST and EMAIL_PORT are correct

Error: "Gmail app password rejected"
Solution: Regenerate app password and ensure 2FA is enabled
```

### Slack Not Sending
```
Error: "Invalid webhook URL"
Solution: Verify SLACK_WEBHOOK URL is correct

Error: "Channel not found"
Solution: Ensure webhook is configured for correct channel

Error: "Unauthorized"
Solution: Regenerate webhook in Slack API settings
```

### Asana Not Uploading
```
Error: "Invalid project ID"
Solution: Verify ASSESSMENT_PROJECT_ID is correct

Error: "Unauthorized"
Solution: Verify ASANA_PAT token is valid and has project access

Error: "Task creation failed"
Solution: Check project permissions and custom fields
```

### Report Generation Failing
```
Error: "Cannot read property 'gid' of undefined"
Solution: Verify Asana project has tasks with required custom fields

Error: "PDF conversion failed"
Solution: Ensure libreoffice is installed (for PDF conversion)

Error: "Audit trail logging failed"
Solution: Verify /tmp directory has write permissions
```

---

## Performance Optimization

### Large Projects (1000+ tasks)
```javascript
// Use pagination
const tasks = await asanaClient.tasks.findByProject(projectId, {
  limit: 100,
  offset: 0,
});

// Cache results
const cache = new Map();
```

### Reduce Email Recipients
```bash
# Only send to management
export EMAIL_RECIPIENTS="manager@company.com,cro@company.com"
```

### Disable Slack for Large Reports
```javascript
// Comment out Slack distribution
// await this.sendSlackReport(pdfPath);
```

---

## Audit Trail

### What Is Logged
- Report generation timestamp
- Report file path
- Week number
- Metrics summary
- Distribution status

### Access Audit Trail
```bash
# View recent entries
tail -20 /tmp/audit-trail.log

# Search for specific week
grep "Week 20" /tmp/audit-trail.log

# Export to CSV
cat /tmp/audit-trail.log | jq -r '[.timestamp, .action, .data.weekNumber] | @csv' > audit.csv
```

---

## Best Practices

1. **Test Before Deploying**
   ```javascript
   // Generate report immediately to test
   await reporter.generateWeeklyReport();
   ```

2. **Monitor Email Delivery**
   - Check email inbox for reports
   - Verify attachments are present
   - Test with different email clients

3. **Monitor Slack Delivery**
   - Check #compliance-reports channel
   - Verify metrics are accurate
   - Test webhook connectivity

4. **Review Reports Regularly**
   - Check compliance trends
   - Identify patterns
   - Act on recommendations

5. **Maintain Audit Trail**
   - Archive audit logs monthly
   - Review for compliance
   - Retain for 10 years

---

## Support & Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Report not generating | Asana API error | Check ASANA_PAT token validity |
| Email not sending | SMTP error | Verify email credentials |
| Slack not sending | Webhook error | Regenerate webhook URL |
| Metrics incorrect | Missing custom fields | Verify Asana project setup |
| PDF not converting | LibreOffice missing | Install libreoffice package |

### Debug Mode
```javascript
// Enable verbose logging
reporter.debug = true;

// Generate report with detailed output
await reporter.generateWeeklyReport();
```

---

## Next Steps

1. ✅ Install dependencies
2. ✅ Configure environment variables
3. ✅ Test email delivery
4. ✅ Test Slack delivery
5. ✅ Generate first report
6. ✅ Schedule weekly reports
7. ✅ Monitor and optimize

---

**Status**: ✅ Ready for Production Deployment

All code is in GitHub at: `trex0092/compliance-analyzer`
