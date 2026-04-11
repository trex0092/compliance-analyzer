/**
 * Asana Brain Dispatcher — wires Phase 3 degradation + Phase 5 governance
 * remediation into actual Asana task creation.
 *
 * Phase 3 built `subsystemScoring.ts :: buildRepairTaskPayload()` which
 * produced a task payload but never dispatched it. Phase 5 built
 * `runAiGovernanceAgent()` which produced a remediation array but never
 * routed those items anywhere. This module closes both loops.
 *
 * Two public functions:
 *
 *   dispatchSubsystemRepair(report)
 *     — when a Weaponized Brain subsystem's rolling score drops below
 *       autoRepairThreshold, this function creates a BRAIN-REPAIR
 *       Asana task so a compliance engineer can review. Never
 *       auto-rewrites code (Cabinet Res 134/2025 Art.19 safety line).
 *
 *   dispatchGovernanceRemediation(audit)
 *     — walks every critical/high finding from an AI Governance audit
 *       and creates one Asana task per finding. Used by the Phase 5
 *       self-audit path and by customer-facing audit workflows.
 *
 * Both functions are async, use the existing asanaClient + retry
 * queue, and return a summary of how many tasks were created / failed.
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (internal review before policy change)
 *   - EU AI Act Art.72 (post-market monitoring)
 *   - NIST AI RMF MG-2.1 (incident response)
 *   - FDL No.10/2025 Art.20-21 (CO duty of care)
 */

import {
  buildRepairTaskPayload,
  type SubsystemScoreReport,
} from './subsystemScoring';
import type { GovernanceAudit } from '../agents/aiGovernance';
import {
  createAsanaTask,
  isAsanaConfigured,
  type AsanaTaskPayload,
} from './asanaClient';
import { enqueueRetry } from './asanaQueue';
import { buildComplianceCustomFields } from './asanaCustomFields';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DispatchSummary {
  dispatched: number;
  failed: number;
  skipped: number;
  taskGids: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Phase 3 loop: subsystem degradation → Asana task
// ---------------------------------------------------------------------------

export async function dispatchSubsystemRepair(
  report: SubsystemScoreReport,
  projectId: string
): Promise<DispatchSummary> {
  const summary: DispatchSummary = {
    dispatched: 0,
    failed: 0,
    skipped: 0,
    taskGids: [],
    errors: [],
  };

  if (report.recommendation !== 'open_repair_task') {
    summary.skipped = 1;
    return summary;
  }

  if (!isAsanaConfigured()) {
    summary.skipped = 1;
    summary.errors.push('Asana not configured');
    return summary;
  }

  const base = buildRepairTaskPayload(report);
  const custom_fields = buildComplianceCustomFields({
    riskLevel:
      base.priority === 'critical'
        ? 'critical'
        : base.priority === 'high'
        ? 'high'
        : base.priority === 'medium'
        ? 'medium'
        : 'low',
    caseId: `BRAIN-REPAIR-${report.subsystem}`,
    confidence: report.total / 100,
    regulationCitation: 'Cabinet Res 134/2025 Art.19 + NIST AI RMF MS-2.1',
  });

  const payload: AsanaTaskPayload = {
    name: base.name,
    notes: base.notes,
    projects: [projectId],
    ...(Object.keys(custom_fields).length > 0 ? { custom_fields } : {}),
  };

  const result = await createAsanaTask(payload);
  if (result.ok && result.gid) {
    summary.dispatched = 1;
    summary.taskGids.push(result.gid);
  } else {
    summary.failed = 1;
    summary.errors.push(result.error ?? 'unknown error');
    enqueueRetry(payload, 'brain-repair-dispatch', result.error ?? 'unknown', report.subsystem);
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Phase 5 loop: AI Governance remediation → Asana tasks
// ---------------------------------------------------------------------------

export async function dispatchGovernanceRemediation(
  audit: GovernanceAudit,
  projectId: string
): Promise<DispatchSummary> {
  const summary: DispatchSummary = {
    dispatched: 0,
    failed: 0,
    skipped: 0,
    taskGids: [],
    errors: [],
  };

  if (!isAsanaConfigured()) {
    summary.skipped = audit.remediation.length;
    summary.errors.push('Asana not configured');
    return summary;
  }

  for (const item of audit.remediation) {
    const custom_fields = buildComplianceCustomFields({
      riskLevel:
        item.severity === 'critical'
          ? 'critical'
          : item.severity === 'high'
          ? 'high'
          : item.severity === 'medium'
          ? 'medium'
          : 'low',
      caseId: `GOV-REPAIR-${item.controlId}`,
      regulationCitation: item.citation,
    });

    const payload: AsanaTaskPayload = {
      name: `[GOV-REPAIR][${item.severity.toUpperCase()}] ${item.controlId} ${item.title}`,
      notes: [
        `AI Governance control failure detected in ${audit.auditTarget}.`,
        '',
        `Framework: ${item.framework}`,
        `Control ID: ${item.controlId}`,
        `Severity: ${item.severity}`,
        `Citation: ${item.citation}`,
        '',
        `Audit timestamp: ${audit.auditedAt}`,
        `Audited by: ${audit.auditedBy}`,
        `EU AI Act tier: ${audit.euAiActTier}`,
        `Overall audit score: ${audit.overallScore}/100`,
        '',
        '---',
        'Auto-created by AsanaBrainDispatcher from runAiGovernanceAgent() output.',
        'A compliance engineer must review this finding and propose remediation.',
        'Do NOT auto-remediate AI governance controls without human review',
        '(Cabinet Res 134/2025 Art.19 + EU AI Act Art.27).',
      ].join('\n'),
      projects: [projectId],
      ...(Object.keys(custom_fields).length > 0 ? { custom_fields } : {}),
    };

    const result = await createAsanaTask(payload);
    if (result.ok && result.gid) {
      summary.dispatched += 1;
      summary.taskGids.push(result.gid);
    } else {
      summary.failed += 1;
      summary.errors.push(`${item.controlId}: ${result.error ?? 'unknown'}`);
      enqueueRetry(payload, 'gov-repair-dispatch', result.error ?? 'unknown', item.controlId);
    }
  }

  return summary;
}
