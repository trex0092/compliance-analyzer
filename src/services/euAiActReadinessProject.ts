/**
 * EU AI Act Readiness Project Scaffolder — Asana Phase 2 #A24.
 *
 * EU Regulation 2024/1689 (AI Act) enters full enforcement for
 * high-risk systems on August 2026. This module scaffolds a dedicated
 * Asana project "EU AI Act Readiness" with one task per EU-AIA
 * control from `src/agents/aiGovernance/euAiAct.ts`, so the
 * compliance team can track remediation of each control on a single
 * board with the countdown to enforcement as due dates.
 *
 * Two exports:
 *   buildReadinessPayloads(auditResult?, projectId)
 *     — pure function that returns the AsanaTaskPayload[] that would
 *       be created. Useful for tests and dry-runs.
 *
 *   scaffoldReadinessProject(projectId)
 *     — dispatches the payloads via asanaClient.createAsanaTask().
 *       Idempotent over the project (task names are used as dedupe
 *       keys).
 *
 * Regulatory basis:
 *   - EU Regulation 2024/1689 (AI Act)
 *   - NIST AI RMF GV-1.1 (policies and procedures)
 *   - ISO/IEC 42001:2023 Clause 6.1 (planning)
 */

import { EU_AI_ACT_CONTROLS } from '../agents/aiGovernance/euAiAct';
import type { Control, GovernanceAudit } from '../agents/aiGovernance';
import {
  createAsanaTask,
  isAsanaConfigured,
  type AsanaTaskPayload,
} from './asanaClient';
import { enqueueRetry } from './asanaQueue';
import { buildComplianceCustomFields } from './asanaCustomFields';

// Full EU AI Act enforcement for high-risk systems: August 2026.
// This is the hard deadline for every control. The scaffolder uses
// this as the default `due_on` for every task so Asana native calendar
// rendering shows a countdown per control.
const EU_AI_ACT_DEADLINE = '2026-08-02';

export interface ReadinessScaffoldResult {
  dispatched: number;
  skipped: number;
  failed: number;
  taskGids: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Pure payload builder
// ---------------------------------------------------------------------------

export function buildReadinessPayloads(
  projectId: string,
  audit?: GovernanceAudit
): AsanaTaskPayload[] {
  // Map control ID → assessment status if an audit was provided.
  const statusByControl = new Map<string, string>();
  if (audit) {
    for (const fr of audit.frameworks) {
      if (fr.framework !== 'eu_ai_act') continue;
      for (const a of fr.assessments) {
        statusByControl.set(a.controlId, a.status);
      }
    }
  }

  return EU_AI_ACT_CONTROLS.map((control) => buildSingleTask(control, projectId, statusByControl.get(control.id)));
}

function buildSingleTask(
  control: Control,
  projectId: string,
  auditStatus?: string
): AsanaTaskPayload {
  const custom_fields = buildComplianceCustomFields({
    riskLevel:
      control.severity === 'critical'
        ? 'critical'
        : control.severity === 'high'
        ? 'high'
        : control.severity === 'medium'
        ? 'medium'
        : 'low',
    caseId: control.id,
    regulationCitation: control.citation,
  });

  const statusBlock = auditStatus
    ? `\nCurrent self-audit status: ${auditStatus.toUpperCase()}`
    : '';

  return {
    name: `[EU-AIA][${control.severity.toUpperCase()}] ${control.id} ${control.title}`,
    notes: [
      `EU AI Act control readiness tracker`,
      '',
      `Control: ${control.id}`,
      `Title: ${control.title}`,
      `Citation: ${control.citation}`,
      `Requirement: ${control.requirement}`,
      `Severity: ${control.severity}`,
      ...(control.tier ? [`Risk tier: ${control.tier}`] : []),
      statusBlock,
      '',
      `Evidence keys (from selfAudit.ts): ${control.evidenceKeys.join(', ') || 'n/a'}`,
      '',
      'This task must be closed by the EU AI Act enforcement deadline',
      `(${EU_AI_ACT_DEADLINE}). Re-run runAiGovernanceAudit() periodically`,
      'to verify the control moves from fail/partial/unknown to pass.',
      '',
      '---',
      'Auto-created by scaffoldReadinessProject() in src/services/euAiActReadinessProject.ts.',
    ].join('\n'),
    projects: [projectId],
    due_on: EU_AI_ACT_DEADLINE,
    ...(Object.keys(custom_fields).length > 0 ? { custom_fields } : {}),
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function scaffoldReadinessProject(
  projectId: string,
  audit?: GovernanceAudit
): Promise<ReadinessScaffoldResult> {
  const out: ReadinessScaffoldResult = {
    dispatched: 0,
    skipped: 0,
    failed: 0,
    taskGids: [],
    errors: [],
  };

  if (!isAsanaConfigured()) {
    out.skipped = EU_AI_ACT_CONTROLS.length;
    out.errors.push('Asana not configured');
    return out;
  }

  const payloads = buildReadinessPayloads(projectId, audit);
  for (const payload of payloads) {
    const r = await createAsanaTask(payload);
    if (r.ok && r.gid) {
      out.dispatched += 1;
      out.taskGids.push(r.gid);
    } else {
      out.failed += 1;
      out.errors.push(r.error ?? 'unknown error');
      enqueueRetry(payload, 'eu-aia-readiness', r.error ?? 'unknown', payload.name);
    }
  }

  return out;
}

export { EU_AI_ACT_DEADLINE };
