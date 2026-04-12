/**
 * Asana Screening Task Sync
 *
 * Syncs comprehensive compliance screening reports to Asana as structured
 * tasks with subtasks, custom fields, attachments and due dates.
 * Integrates with the existing asanaClient / asanaSync family.
 *
 * Each ScreeningComplianceReport becomes:
 *  - One parent Asana task (summary)
 *  - Subtasks for each critical/high finding
 *  - Subtasks for each overdue filing
 *  - Custom fields: risk score, CDD level, sanctions flag, ESG grade
 *  - Due date = next review date from the report
 *
 * Regulatory: FDL No.10/2025 Art.20-21 (CO record-keeping duties),
 *             FDL No.10/2025 Art.24 (10-year retention), Cabinet Res 71/2024.
 */

import type { ScreeningComplianceReport, ComplianceFinding } from './screeningComplianceReport';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AsanaTaskPayload {
  name: string;
  notes: string;
  due_on?: string;
  assignee?: string;
  projects?: string[];
  tags?: string[];
  custom_fields?: Record<string, unknown>;
  parent?: string;
}

export interface AsanaSyncConfig {
  projectGid: string;
  workspaceGid: string;
  /** Asana custom field GIDs — must be pre-created in your workspace */
  customFieldGids: {
    riskScore: string;
    cddLevel: string;
    sanctionsFlag: string;
    esgGrade: string;
    overallStatus: string;
    entityId: string;
  };
  /** Asana user GID to assign critical findings to (e.g. MLRO) */
  defaultAssigneeGid?: string;
  /** Asana project GID for overdue filings (can be same project) */
  filingsProjectGid?: string;
}

export interface AsanaSyncPayload {
  parentTask: AsanaTaskPayload;
  subtasks: AsanaTaskPayload[];
  attachmentMarkdown: string; // full report as markdown attachment content
}

export interface AsanaSyncResult {
  reportId: string;
  entityId: string;
  parentTaskName: string;
  subtasksCreated: number;
  status: 'prepared' | 'error';
  payload: AsanaSyncPayload;
  errorMessage?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function severityEmoji(severity: string): string {
  const map: Record<string, string> = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🟢',
    info: 'ℹ️',
  };
  return map[severity] ?? '⚪';
}

function buildFindingSubtask(finding: ComplianceFinding, assignee?: string): AsanaTaskPayload {
  return {
    name: `${severityEmoji(finding.severity)} [${finding.severity.toUpperCase()}] ${finding.section.replace(/_/g, ' ')}: ${finding.finding.slice(0, 100)}`,
    notes: [
      `**Finding:** ${finding.finding}`,
      `**Framework:** ${finding.framework}`,
      `**Regulatory Ref:** ${finding.regulatoryRef}`,
      `**Remediation:** ${finding.remediation}`,
      finding.penaltyExposure ? `**Penalty Exposure:** ${finding.penaltyExposure}` : '',
      finding.deadline ? `**Deadline:** ${finding.deadline}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    due_on: finding.deadline ?? undefined,
    assignee,
    tags: [finding.framework, finding.severity, 'compliance-finding'],
  };
}

function buildFilingSubtask(
  report: ScreeningComplianceReport,
  assignee?: string
): AsanaTaskPayload[] {
  return report.overdueFilings.map((filing) => ({
    name: `🚨 OVERDUE ${filing.filingType} — ${filing.referenceNumber}`,
    notes: [
      `**Filing Type:** ${filing.filingType}`,
      `**Reference:** ${filing.referenceNumber}`,
      `**Filing Date:** ${filing.filingDate}`,
      `**Status:** ${filing.status.toUpperCase()}`,
      `**Deadline Met:** ${filing.deadlineMet ? 'Yes' : 'NO — OVERDUE'}`,
      filing.remarks ? `**Remarks:** ${filing.remarks}` : '',
      '',
      '**Action:** Submit immediately via goAML. Document reason for delay.',
      '**Regulatory Ref:** FDL No.10/2025 Art.26-27; MoE Circular 08/AML/2021',
      '**Penalty Exposure:** AED 10K–100M (Cabinet Res 71/2024)',
    ]
      .filter(Boolean)
      .join('\n\n'),
    due_on: new Date().toISOString().split('T')[0], // overdue → due today
    assignee,
    tags: ['overdue-filing', filing.filingType, 'compliance-finding'],
  }));
}

function buildAttachmentMarkdown(report: ScreeningComplianceReport): string {
  const lines: string[] = [
    `# Screening Compliance Report`,
    `**Report ID:** ${report.reportId}`,
    `**Entity:** ${report.entityName} (${report.entityId})`,
    `**Period:** ${report.reportingPeriod.start} → ${report.reportingPeriod.end}`,
    `**Generated:** ${report.generatedAt}`,
    `**Prepared by:** ${report.preparedBy}`,
    report.reviewedBy ? `**Reviewed by:** ${report.reviewedBy}` : '',
    '',
    '---',
    '',
    '## Executive Summary',
    report.executiveSummary,
    '',
    '---',
    '',
    `## Overall Status: ${report.overallStatus.toUpperCase().replace('_', ' ')}`,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Overall Risk Score | ${report.overallRiskScore}/100 |`,
    `| Critical Findings | ${report.criticalFindingsCount} |`,
    `| High Findings | ${report.highFindingsCount} |`,
    `| Overdue Filings | ${report.overdueFilings.length} |`,
    `| Sanctions Exposure | ${report.sanctionsExposure ? '⚠ YES' : '✓ None'} |`,
    `| PEP Links | ${report.pepExposure ? '⚠ YES' : '✓ None'} |`,
    `| ESG Risk | ${report.esgRiskLevel?.toUpperCase() ?? 'N/A'} |`,
    '',
    '---',
    '',
    '## Findings',
    ...report.findings.map(
      (f) =>
        `### ${severityEmoji(f.severity)} [${f.severity.toUpperCase()}] ${f.finding}\n` +
        `- **Section:** ${f.section.replace(/_/g, ' ')}\n` +
        `- **Framework:** ${f.framework}\n` +
        `- **Regulatory Ref:** ${f.regulatoryRef}\n` +
        `- **Remediation:** ${f.remediation}\n` +
        (f.penaltyExposure ? `- **Penalty:** ${f.penaltyExposure}\n` : '')
    ),
    '',
    '---',
    '',
    '## Section Summaries',
    ...report.sections.map(
      (s) => `### ${s.title}\n**Status:** ${s.status.toUpperCase()}\n${s.summary}\n`
    ),
    '',
    '---',
    '',
    '## Recommended Actions',
    ...report.recommendedActions.map((r, i) => `${i + 1}. ${r}`),
    '',
    '---',
    '',
    '## Regulatory References',
    ...report.regulatoryRefs.map((r) => `- ${r}`),
    '',
    '---',
    '',
    `**Next Review Date:** ${report.nextReviewDate}`,
    '',
    `_${report.disclaimer}_`,
  ];

  return lines.filter((l) => l !== undefined).join('\n');
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function buildAsanaSyncPayload(
  report: ScreeningComplianceReport,
  config: AsanaSyncConfig
): AsanaSyncResult {
  try {
    const assignee = config.defaultAssigneeGid;

    // Parent task
    const parentTask: AsanaTaskPayload = {
      name: `[Compliance Report] ${report.entityName} — ${report.reportingPeriod.start} to ${report.reportingPeriod.end}`,
      notes: report.executiveSummary,
      due_on: report.nextReviewDate,
      assignee,
      projects: [config.projectGid],
      tags: ['compliance-report', report.overallStatus, report.entityId],
      custom_fields: {
        [config.customFieldGids.riskScore]: report.overallRiskScore,
        [config.customFieldGids.cddLevel]:
          report.sections.find((s) => s.section === 'cdd_edd_status')?.details?.cddLevel ?? 'CDD',
        [config.customFieldGids.sanctionsFlag]: report.sanctionsExposure,
        [config.customFieldGids.esgGrade]: report.esgRiskLevel ?? 'N/A',
        [config.customFieldGids.overallStatus]: report.overallStatus,
        [config.customFieldGids.entityId]: report.entityId,
      },
    };

    // Subtasks for critical + high findings
    const findingSubtasks = report.findings
      .filter((f) => f.severity === 'critical' || f.severity === 'high')
      .map((f) => buildFindingSubtask(f, assignee));

    // Subtasks for overdue filings
    const filingSubtasks = buildFilingSubtask(report, assignee);

    const subtasks = [...findingSubtasks, ...filingSubtasks];

    const attachmentMarkdown = buildAttachmentMarkdown(report);

    return {
      reportId: report.reportId,
      entityId: report.entityId,
      parentTaskName: parentTask.name,
      subtasksCreated: subtasks.length,
      status: 'prepared',
      payload: { parentTask, subtasks, attachmentMarkdown },
    };
  } catch (err) {
    return {
      reportId: report.reportId,
      entityId: report.entityId,
      parentTaskName: '',
      subtasksCreated: 0,
      status: 'error',
      payload: { parentTask: { name: '', notes: '' }, subtasks: [], attachmentMarkdown: '' },
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Build a minimal Asana task for a single screening alert (used by the brain
 * when a verdict of 'escalate' or 'freeze' is returned).
 */
export function buildScreeningAlertTask(
  entityId: string,
  verdict: string,
  confidence: number,
  narrativeSummary: string,
  assignee?: string
): AsanaTaskPayload {
  const urgency =
    verdict === 'freeze' ? '🔴 FREEZE' : verdict === 'escalate' ? '🟠 ESCALATE' : '🟡 FLAG';
  return {
    name: `${urgency} Screening Alert — ${entityId} — ${new Date().toISOString().split('T')[0]}`,
    notes: [
      `**Entity:** ${entityId}`,
      `**Verdict:** ${verdict.toUpperCase()}`,
      `**Confidence:** ${(confidence * 100).toFixed(1)}%`,
      `**Generated:** ${new Date().toISOString()}`,
      '',
      '**Summary:**',
      narrativeSummary,
      '',
      '**Action Required:**',
      verdict === 'freeze'
        ? 'IMMEDIATE: Execute asset freeze. Notify EOCN within 24h. Four-eyes required. DO NOT notify subject.'
        : verdict === 'escalate'
          ? 'Escalate to Compliance Officer within 2 business hours. Run full EDD.'
          : 'Review flagged indicators. Determine if STR/SAR filing is required.',
      '',
      '**Regulatory Ref:** FDL No.10/2025 Art.26-27; Cabinet Res 74/2020 Art.4-7',
    ].join('\n'),
    due_on: new Date().toISOString().split('T')[0],
    assignee,
    tags: ['screening-alert', verdict, entityId],
  };
}
